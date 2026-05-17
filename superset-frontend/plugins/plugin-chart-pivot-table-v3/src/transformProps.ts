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
  GenericDataType,
  getTimeFormatter,
  getMetricLabel,
  SMART_DATE_ID,
  TimeFormats,
} from '@superset-ui/core';
import { PivotTableProps, PivotTableQueryFormData } from './types';
import {
  buildResolvedMetricLabelMap,
  getStableColumnKey,
  mergeMetrics,
  coerceEpochMsStringToNumber,
} from './utils';
import { getMetricKeys, getMetricKey } from './pivot/core/tokens';
import { buildLayoutContext } from './pivot/layout/LayoutContext';
import { resolveInteractionFormData } from './pivot/layout/resolveInteractionLayout';
import { normalizeFormDataExtraFilters } from './pivot/query/normalizeExtraFormData';
import { buildInitialQuerySpecs } from './pivot/query/specs';
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
    chartId,
    appSection,
    emitCrossFilters,
    theme,
    ownState,
  } = chartProps;
  const { setDataMask = () => {}, onContextMenu, setControlValue } = hooks;
  const baseFormData = rawFormDataCamel as PivotTableQueryFormData;
  const rawFormData = rawFormDataBase as PivotTableQueryFormData;
  const runtimeLayout =
    baseFormData.pivotRuntimeLayout ??
    (ownState?.pivotRuntimeLayout as
      | PivotTableQueryFormData['pivotRuntimeLayout']
      | undefined);
  const formData = resolveInteractionFormData({
    formData: baseFormData,
    runtimeLayout,
  });
  const metricsForLabels = ensureIsArray(
    rawFormData.metrics ?? baseFormData.metrics ?? formData.metrics,
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
    ...(formData.metricLabelMap ?? {}),
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
    ...(formData.verboseMap ?? {}),
  };
  const metricLabelMap = Object.fromEntries(
    buildResolvedMetricLabelMap({
      metrics: metricsForLabels,
      metricLabelMap: baseMetricLabelOverrides,
      verboseMap,
    }),
  );
  const formDataWithMetricLabels = { ...formData, metricLabelMap };
  const layout = buildLayoutContext(formDataWithMetricLabels);
  const {
    metrics,
    groupbyRows,
    groupbyColumns,
    rowSubtotalLevels,
    colSubtotalLevelsForQuery: colSubtotalLevels,
    metricsLayoutResolved: metricsLayout,
    metricInsertIndex,
  } = layout;
  const initialSpecs = buildInitialQuerySpecs(formDataWithMetricLabels, layout);
  const planMetrics = initialSpecs.reduce(
    (acc, spec) => mergeMetrics(acc, spec.metrics),
    metrics,
  );
  const metricKeysForQuery = getMetricKeys(planMetrics);
  const queryFormData: PivotTableQueryFormData = {
    ...rawFormData,
    ...formDataWithMetricLabels,
    metricsLayout,
    metricLabelMap,
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

  Object.entries(formData.temporal_columns_lookup ?? {}).forEach(
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
    if (formData.dateFormat === SMART_DATE_ID) {
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
    } else if (formData.dateFormat) {
      const base = getTimeFormatter(formData.dateFormat);
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
  const normalizedQueryFormData = normalizeFormDataExtraFilters(
    queryFormDataWithTypes,
  );

  const treeDataSignature = JSON.stringify({
    rows: groupbyRows.map(getStableColumnKey),
    cols: groupbyColumns.map(getStableColumnKey),
    metrics: metricKeysForQuery,
    metricsLayout,
    metricInsertIndex,
    rowSubtotalLevels,
    colSubtotalLevels,
    measureHierarchy: layout.measureHierarchy,
  });
  const formDataForTree: PivotTableQueryFormData = {
    ...formDataWithMetricLabels,
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
    ...normalizedQueryFormData,
    dateFormatters,
    columnFormats,
    currencyFormats,
  };

  return {
    width,
    height,
    data: nextTreeWithLeaves,
    factBatches,
    formData: {
      ...formDataWithMetricLabels,
      slice_id: formDataWithMetricLabels.slice_id ?? chartId,
      metricsLayout,
      treeDataSignature,
      metricLabelMap,
      extra_form_data: normalizedQueryFormData.extra_form_data,
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
