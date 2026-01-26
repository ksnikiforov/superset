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
  DataRecordValue,
  extractTimegrain,
  GenericDataType,
  getTimeFormatter,
  getTimeFormatterForGranularity,
  getMetricLabel,
  SMART_DATE_ID,
  TimeFormats,
} from '@superset-ui/core';
import { getColorFormatters } from '@superset-ui/chart-controls';
import {
  PivotTableProps,
  PivotTableQueryFormData,
  PivotTreeData,
} from './types';
import {
  getMetricKeys,
  getMetricKey,
  getStableColumnKey,
  mergeMetrics,
  mergeTrees,
  normalizeDimensionSortingMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  normalizeMetricDatabarMapWithKeys,
  serializePath,
} from './utils';
import { buildBranchTreeFromResults } from './fetchPivotBranch';
import { buildLayoutContext } from './pivot/layout/LayoutContext';
import { resolveInteractionFormData } from './pivot/layout/resolveInteractionLayout';
import { applyMeasureLeafValuesToTree } from './pivot/measureLeaves';
import { buildInitialQuerySpecs } from './pivot/query/specs';

const { DATABASE_DATETIME } = TimeFormats;

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
    hooks: { setDataMask = () => {}, onContextMenu, setControlValue },
    filterState,
    datasource,
    emitCrossFilters,
    theme,
    ownState,
  } = chartProps;
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
  const {
    verboseMap = {},
    columnFormats = {},
    currencyFormats = {},
    columns = [],
  } = datasource || {};
  const layout = buildLayoutContext(formData);
  const {
    metrics,
    groupbyRows,
    groupbyColumns,
    rowSubTotals: rowSubTotalsEnabled,
    rowSubtotalLevels,
    colSubtotalLevelsForQuery: colSubtotalLevels,
    rowTotalPosition,
    rowSubtotalPosition,
    colTotalPosition,
    colSubtotalPosition,
    metricsLayoutResolved: metricsLayout,
    metricInsertIndex,
  } = layout;
  const metricLabelMap = metrics.reduce<Record<string, string>>(
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
  const metricFormatting = normalizeMetricFormattingMapWithKeys(
    formData.metricFormatting,
    metrics,
  );
  const metricDatabars = normalizeMetricDatabarMapWithKeys(
    formData.metricDatabars,
    metrics,
  );
  const rowSorting = normalizeDimensionSortingMapWithKeys(
    formData.rowSorting,
    groupbyRows,
  );
  const colSorting = normalizeDimensionSortingMapWithKeys(
    formData.colSorting,
    groupbyColumns,
  );
  const initialSpecs = buildInitialQuerySpecs(formData, layout);
  const planMetrics = initialSpecs.reduce(
    (acc, spec) => mergeMetrics(acc, spec.metrics),
    metrics,
  );
  const pivotTheme = formData.pivotTheme || 'none';
  const pivotThemeColors = formData.pivotThemeColors || '';
  const granularity = extractTimegrain(rawFormData);
  const metricKeysForQuery = getMetricKeys(planMetrics);
  const queryFormData: PivotTableQueryFormData = {
    ...rawFormData,
    ...formData,
    metricsLayout,
    metricLabelMap,
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

  const temporalColumns = Object.keys(colTypeMap).filter(
    colname => colTypeMap[colname] === GenericDataType.Temporal,
  );
  const dateFormatters = temporalColumns.reduce(
    (
      acc: Record<string, ((value: DataRecordValue) => string) | undefined>,
      temporalColname,
    ) => {
      let formatter: ((value: DataRecordValue) => string) | undefined;
      if (formData.dateFormat === SMART_DATE_ID) {
        if (granularity) {
          const base = getTimeFormatterForGranularity(granularity);
          formatter = (value: DataRecordValue) =>
            base(value as number | Date | null | undefined);
        } else if (
          combinedData.every(
            row =>
              row[temporalColname] === null ||
              row[temporalColname] === undefined ||
              typeof row[temporalColname] === 'number',
          )
        ) {
          const base = getTimeFormatter(DATABASE_DATETIME);
          formatter = (value: DataRecordValue) =>
            base(value as number | Date | null | undefined);
        }
      } else if (formData.dateFormat) {
        const base = getTimeFormatter(formData.dateFormat);
        formatter = (value: DataRecordValue) =>
          base(value as number | Date | null | undefined);
      }
      if (formatter) {
        acc[temporalColname] = formatter;
      }
      return acc;
    },
    {},
  );

  const metricColorFormatters = getColorFormatters(
    formData.conditional_formatting,
    combinedData,
    theme,
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
  const rootKey = serializePath([]);
  const emptyTree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const getQueryName = (result: unknown): string | undefined => {
    if (!result || typeof result !== 'object') {
      return undefined;
    }
    const record = result as Record<string, unknown>;
    const { query } = record;
    if (query && typeof query === 'object') {
      const queryRecord = query as Record<string, unknown>;
      const name = queryRecord.query_name;
      if (typeof name === 'string') {
        return name;
      }
    }
    const name = record.query_name;
    return typeof name === 'string' ? name : undefined;
  };
  const resultsByName = new Map<string, (typeof queriesData)[number]>();
  queriesData.forEach(result => {
    const name = getQueryName(result);
    if (name) {
      resultsByName.set(name, result);
    }
  });
  const nextTreeWithLabels = initialSpecs.reduce((acc, spec, idx) => {
    const result =
      resultsByName.get(spec.queryName) ??
      queriesData[idx] ??
      ({
        data: [],
        colnames: [],
        coltypes: [],
      } as (typeof queriesData)[number]);
    const nextTree = buildBranchTreeFromResults({
      results: [result],
      queryPairs: [
        { rowDepth: spec.meta.rowDepth, colDepth: spec.meta.colDepth },
      ],
      metricsForQuery: spec.metrics,
      formData,
      measureHierarchy: layout.measureHierarchy,
      rowGroupby: spec.meta.rowGroupbyForQueryFull,
      colGroupby: spec.meta.colGroupbyForQueryFull,
      rowSubtotalLevels: spec.meta.rowSubtotalLevels,
      colSubtotalLevels: spec.meta.colSubtotalLevels,
      metricsLayoutResolved: spec.meta.metricsLayoutResolved,
      metricInsertIndex: spec.meta.metricInsertIndex,
    });
    return mergeTrees(acc, nextTree);
  }, emptyTree);
  if (nextTreeWithLabels.rows[rootKey]) {
    nextTreeWithLabels.rows[rootKey] = {
      ...nextTreeWithLabels.rows[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }
  if (nextTreeWithLabels.cols[rootKey]) {
    nextTreeWithLabels.cols[rootKey] = {
      ...nextTreeWithLabels.cols[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }
  const nextTreeWithLeaves = applyMeasureLeafValuesToTree({
    tree: nextTreeWithLabels,
    measureHierarchy: layout.measureHierarchy,
  });

  const isDevBuild =
    process.env.WEBPACK_MODE === 'development' ||
    process.env.NODE_ENV === 'test';
  if (isDevBuild) {
    if (
      Object.keys(nextTreeWithLabels.rows).length > 0 &&
      !nextTreeWithLabels.rows[rootKey]
    ) {
      throw new Error(
        'PivotTable v3 invariant violated: missing row root node',
      );
    }
    if (
      Object.keys(nextTreeWithLabels.cols).length > 0 &&
      !nextTreeWithLabels.cols[rootKey]
    ) {
      throw new Error(
        'PivotTable v3 invariant violated: missing column root node',
      );
    }
  }

  const { selectedFilters } = filterState;

  return {
    width,
    height,
    margin: formData.margin ?? 0,
    data: nextTreeWithLeaves,
    formData: {
      ...formData,
      metricsLayout,
      treeDataSignature,
      metricLabelMap,
      metricsBase: rawFormData.metrics ?? baseFormData.metrics,
      measureLeavesByMetricBase:
        rawFormData.measureLeavesByMetric ?? baseFormData.measureLeavesByMetric,
    },
    queryFormData,
    metrics,
    metricFormatting,
    metricDatabars,
    metricFormattingScope: formData.metricFormattingScope,
    groupbyRows,
    groupbyColumns,
    aggregateFunction: formData.aggregateFunction,
    rowSorting,
    colSorting,
    startCollapsed: layout.startCollapsed,
    initialDepth: layout.initialDepth,
    rowTotals: formData.rowTotals,
    colTotals: formData.colTotals,
    rowSubTotals: rowSubTotalsEnabled,
    rowSubtotalLevels,
    colSubtotalLevels,
    rowOrder: formData.rowOrder,
    colOrder: formData.colOrder,
    valueFormat: formData.valueFormat,
    dateFormat: formData.dateFormat,
    currencyFormat: formData.currencyFormat,
    allowRenderHtml: formData.allowRenderHtml,
    metricsLayout,
    emitCrossFilters,
    setDataMask,
    setControlValue,
    selectedFilters,
    verboseMap,
    columnFormats,
    currencyFormats,
    metricColorFormatters,
    dateFormatters,
    onContextMenu,
    timeGrainSqla: formData.timeGrainSqla ?? formData.time_grain_sqla,
    treeData: nextTreeWithLeaves,
    colTypeMap,
    rowTotalPosition,
    rowSubtotalPosition,
    colTotalPosition,
    colSubtotalPosition,
    pivotTheme,
    pivotThemeColors,
    stickyHeaders: formData.stickyHeaders ?? true,
  };
}
