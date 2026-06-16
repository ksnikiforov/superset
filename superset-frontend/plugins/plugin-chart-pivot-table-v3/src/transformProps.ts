/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import {
  ChartProps,
  Column,
  DataRecordValue,
  ensureIsArray,
  getTimeFormatter,
  getMetricLabel,
  SMART_DATE_ID,
  TimeFormats,
} from '@superset-ui/core';
import { GenericDataType } from '@apache-superset/core/common';
import {
  MetricsLayoutEnum,
  PivotTableProps,
  PivotTableQueryFormData,
} from './types';
import {
  buildResolvedMetricLabelMap,
  getStableColumnKey,
  mergeMetrics,
  coerceEpochMsStringToNumber,
} from './utils';
import { getMetricKeys, getMetricKey } from './pivot/metrics';
import { buildRuntimeLayoutFromFormData } from './pivot/layout/resolveInteractionLayout';
import { buildInitialPivotUpdatePlan } from './pivot/query/specs';
import { buildInitialRuntimeFromSpecResults } from './pivot/runtime/ingestQueryResults';

const { DATABASE_DATETIME } = TimeFormats;

type DatasetColumnMeta = Pick<
  Column,
  'column_name' | 'verbose_name' | 'python_date_format' | 'type_generic'
>;

declare const process: {
  env: {
    NODE_ENV?: string;
    WEBPACK_MODE?: string;
  };
};

export default function transformProps(
  chartProps: ChartProps,
): PivotTableProps {
  const {
    width,
    height,
    queriesData,
    formData: rawFormDataCamel,
    rawFormData: rawFormDataBase,
    hooks,
    filterState,
    datasource,
    rawDatasource,
    appSection,
    emitCrossFilters,
    theme,
    ownState,
  } = chartProps;
  const chartId = (chartProps as ChartProps & { chartId?: number | string })
    .chartId;
  const { setDataMask = () => {}, onContextMenu, setControlValue } = hooks;
  const baseFormData = rawFormDataCamel as PivotTableQueryFormData;
  const rawFormData = rawFormDataBase as PivotTableQueryFormData;
  const runtimeLayout =
    baseFormData.pivotRuntimeLayout ??
    (ownState?.pivotRuntimeLayout as
      | PivotTableQueryFormData['pivotRuntimeLayout']
      | undefined) ??
    buildRuntimeLayoutFromFormData(baseFormData);
  const metricsForLabels = ensureIsArray(
    rawFormData.metrics ?? baseFormData.metrics ?? runtimeLayout.metrics,
  );
  const metricLabelMapBase = metricsForLabels.reduce<Record<string, string>>(
    (acc, metric) => {
      const key = getMetricKey(metric);
      if (!key) {
        return acc;
      }
      let label = getMetricLabel(metric) || key;
      if (typeof metric === 'string') {
        const savedMetric = datasource?.metrics?.find(
          candidate => candidate.metric_name === metric,
        );
        if (savedMetric?.verbose_name) {
          label = savedMetric.verbose_name;
        }
      }
      acc[key] = label;
      return acc;
    },
    {},
  );
  const baseMetricLabelOverrides = {
    ...metricLabelMapBase,
    ...(baseFormData.metricLabelMap ?? {}),
  };
  const datasourceVerboseMap = datasource?.verboseMap ?? {};
  const columnFormats = datasource?.columnFormats ?? {};
  const currencyFormats = datasource?.currencyFormats ?? {};
  const datasourceColumns = datasource?.columns ?? [];
  const rawDatasourceRecord = (rawDatasource ?? {}) as {
    verboseMap?: Record<string, string>;
    verbose_map?: Record<string, string>;
    columns?: DatasetColumnMeta[] | DatasetColumnMeta;
  };
  const rawDatasourceVerboseMap =
    rawDatasourceRecord.verboseMap ?? rawDatasourceRecord.verbose_map ?? {};
  const rawDatasourceColumns = ensureIsArray<DatasetColumnMeta>(
    rawDatasourceRecord.columns,
  );
  const columns =
    datasourceColumns.length > 0 ? datasourceColumns : rawDatasourceColumns;
  const columnVerboseMap = columns.reduce<Record<string, string>>(
    (acc, column) => {
      if (column.column_name && column.verbose_name) {
        acc[column.column_name] = column.verbose_name;
      }
      return acc;
    },
    {},
  );
  const verboseMap = {
    ...columnVerboseMap,
    ...rawDatasourceVerboseMap,
    ...datasourceVerboseMap,
    ...(baseFormData.verboseMap ?? {}),
  };
  const metricLabelMap = Object.fromEntries(
    buildResolvedMetricLabelMap({
      metrics: metricsForLabels,
      metricLabelMap: baseMetricLabelOverrides,
      verboseMap,
    }),
  );
  const formDataWithMetricLabels = { ...baseFormData, metricLabelMap };
  const {
    formData: plannedFormData,
    layout,
    specs: initialSpecs,
  } = buildInitialPivotUpdatePlan({
    formData: formDataWithMetricLabels,
    runtimeLayout,
  });
  const {
    metrics,
    rowSubtotalLevels,
    colSubtotalLevelsForQuery: colSubtotalLevels,
  } = layout;
  const { rowDimensions, columnDimensions, valueAxis, metricInsertIndex } =
    layout.pivotProgram;
  const metricsLayout =
    valueAxis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;
  const planMetrics = initialSpecs.reduce(
    (acc, spec) => mergeMetrics(acc, spec.metrics),
    metrics,
  );
  const metricKeysForQuery = getMetricKeys(planMetrics);
  const queryFormData: PivotTableQueryFormData = {
    ...rawFormData,
    ...plannedFormData,
    metricsLayout,
    metricLabelMap,
    verboseMap,
    columnFormats,
    currencyFormats,
  };

  const combinedData = queriesData.flatMap(({ data }) => data || []);
  const colTypeMap: Record<string, GenericDataType> = {};
  columns.forEach(column => {
    const columnName = column.column_name;
    if (columnName && column.type_generic !== undefined) {
      colTypeMap[columnName] = column.type_generic;
    }
  });
  queriesData.forEach(query => {
    const colnames = query?.colnames || [];
    const coltypes = query?.coltypes || [];
    colnames.forEach((name: string, idx: number) => {
      const coltype = coltypes[idx];
      if (coltype !== undefined) {
        colTypeMap[name] = coltype;
      }
    });
  });
  const colTypeMapWithAliases: Record<string, GenericDataType> = {
    ...colTypeMap,
  };
  columns.forEach(column => {
    const columnName = column.column_name;
    const type = columnName ? colTypeMap[columnName] : undefined;
    if (type === undefined) {
      return;
    }
    const verbose = column.verbose_name || verboseMap[columnName];
    if (verbose) {
      colTypeMapWithAliases[verbose] = type;
    }
  });

  Object.entries(baseFormData.temporal_columns_lookup ?? {}).forEach(
    ([columnName, isTemporal]) => {
      if (!isTemporal) {
        return;
      }
      colTypeMapWithAliases[columnName] = GenericDataType.Temporal;
      const verbose = verboseMap[columnName];
      if (verbose) {
        colTypeMapWithAliases[verbose] = GenericDataType.Temporal;
      }
    },
  );
  const temporalColumns = Object.keys(colTypeMapWithAliases).filter(
    colname => colTypeMapWithAliases[colname] === GenericDataType.Temporal,
  );
  const dateFormatters = columns.reduce<
    Record<string, ((value: DataRecordValue) => string) | undefined>
  >((acc, column) => {
    const columnName = column.column_name;
    const format = column.python_date_format;
    if (columnName && typeof format === 'string' && format.length > 0) {
      const base = getTimeFormatter(format);
      const formatter = (value: DataRecordValue) =>
        base(
          coerceEpochMsStringToNumber(value) as
            | number
            | Date
            | null
            | undefined,
        );
      acc[columnName] = formatter;
      if (column.verbose_name) {
        acc[column.verbose_name] = formatter;
      }
      const verbose = verboseMap[columnName];
      if (verbose) {
        acc[verbose] = formatter;
      }
    }
    return acc;
  }, {});
  temporalColumns.forEach(temporalColname => {
    if (dateFormatters[temporalColname]) {
      return;
    }
    let formatter: ((value: DataRecordValue) => string) | undefined;
    if (baseFormData.dateFormat === SMART_DATE_ID) {
      if (
        combinedData.every(row => {
          const value = row[temporalColname];
          if (value === null || value === undefined) {
            return true;
          }
          const normalized = coerceEpochMsStringToNumber(value);
          return typeof normalized === 'number' || normalized instanceof Date;
        })
      ) {
        const base = getTimeFormatter(DATABASE_DATETIME);
        formatter = (value: DataRecordValue) =>
          base(
            coerceEpochMsStringToNumber(value) as
              | number
              | Date
              | null
              | undefined,
          );
      }
    } else if (baseFormData.dateFormat) {
      const base = getTimeFormatter(baseFormData.dateFormat);
      formatter = (value: DataRecordValue) =>
        base(
          coerceEpochMsStringToNumber(value) as
            | number
            | Date
            | null
            | undefined,
        );
    }
    if (formatter) {
      dateFormatters[temporalColname] = formatter;
    }
  });

  const queryFormDataWithTypes: PivotTableQueryFormData = {
    ...queryFormData,
    colTypeMap: colTypeMapWithAliases,
  };

  const treeDataSignature = JSON.stringify({
    rows: rowDimensions.map(getStableColumnKey),
    cols: columnDimensions.map(getStableColumnKey),
    metrics: metricKeysForQuery,
    metricsLayout,
    metricInsertIndex,
    rowSubtotalLevels,
    colSubtotalLevels,
    measureHierarchy: layout.measureHierarchy,
  });
  const formDataForTree: PivotTableQueryFormData = {
    ...plannedFormData,
    dateFormatters,
    colTypeMap: colTypeMapWithAliases,
    columnFormats,
    currencyFormats,
  };
  const { tree: nextTreeWithLeaves, factBatches } =
    buildInitialRuntimeFromSpecResults({
      specs: initialSpecs,
      results: queriesData,
      layout,
      formData: formDataForTree,
    });
  const rootKey = '';

  const isDevBuild =
    process.env.WEBPACK_MODE === 'development' ||
    process.env.NODE_ENV === 'test';
  if (isDevBuild) {
    if (
      Object.keys(nextTreeWithLeaves.rows).length > 0 &&
      !nextTreeWithLeaves.rows[rootKey]
    ) {
      throw new Error(
        'PivotTable v3 invariant violated: missing row root node',
      );
    }
    if (
      Object.keys(nextTreeWithLeaves.cols).length > 0 &&
      !nextTreeWithLeaves.cols[rootKey]
    ) {
      throw new Error(
        'PivotTable v3 invariant violated: missing column root node',
      );
    }
  }

  const { selectedFilters } = filterState;

  const queryFormDataWithFormatters: PivotTableQueryFormData = {
    ...queryFormDataWithTypes,
    dateFormatters,
    columnFormats,
    currencyFormats,
  };

  return {
    width,
    height,
    data: nextTreeWithLeaves,
    factBatches,
    treeDataSignature,
    formData: {
      ...plannedFormData,
      slice_id: plannedFormData.slice_id ?? chartId,
      metricsLayout,
      metricLabelMap,
      verboseMap,
      extra_form_data: queryFormDataWithTypes.extra_form_data,
      dateFormatters,
      colTypeMap: colTypeMapWithAliases,
      columnFormats,
      currencyFormats,
    },
    sourceMetrics: rawFormData.metrics ?? baseFormData.metrics ?? [],
    sourceMeasureLeavesByMetric:
      rawFormData.measureLeavesByMetric ??
      baseFormData.measureLeavesByMetric ??
      {},
    ownState,
    appSection,
    theme,
    queryFormData: queryFormDataWithFormatters,
    emitCrossFilters,
    setDataMask,
    setControlValue,
    selectedFilters,
    onContextMenu,
  };
}
