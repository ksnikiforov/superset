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
  SMART_DATE_ID,
  TimeFormats,
  ensureIsArray,
} from '@superset-ui/core';
import { getColorFormatters } from '@superset-ui/chart-controls';
import { PivotTableQueryFormData, PivotTreeData } from './types';
import {
  getMetricKeys,
  getStableColumnKey,
  mergeMetrics,
  mergeTrees,
  normalizeDimensionSortingMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  normalizeMetricDatabarMapWithKeys,
  serializePath,
} from './utils';
import { buildInitialQueryPlanFromLayout } from './pivot/engine/initialQueryPlan';
import { buildBranchTreeFromResults } from './fetchPivotBranch';
import { buildLayoutContext } from './pivot/layout/LayoutContext';

const { DATABASE_DATETIME } = TimeFormats;

declare const process: {
  env?: {
    NODE_ENV?: string;
    WEBPACK_MODE?: string;
  };
};

export default function transformProps(
  chartProps: ChartProps<PivotTableQueryFormData>,
) {
  const {
    width,
    height,
    queriesData,
    formData,
    rawFormData,
    hooks: { setDataMask = () => {}, onContextMenu, setControlValue },
    filterState,
    datasource,
    emitCrossFilters,
    theme,
  } = chartProps;
  const {
    verboseMap = {},
    columnFormats = {},
    currencyFormats = {},
    columns = [],
  } = datasource || {};
  const layout = buildLayoutContext(formData, datasource);
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
  const initialPlan = buildInitialQueryPlanFromLayout(layout, formData);
  const planMetrics = initialPlan.targets.reduce(
    (acc, target) => mergeMetrics(acc, target.metricsForQuery),
    metrics,
  );
  const pivotTheme = formData.pivotTheme || 'none';
  const pivotThemeColors = formData.pivotThemeColors || '';
  const granularity = extractTimegrain(rawFormData);
  const metricKeysForQuery = getMetricKeys(planMetrics);
  const queryFormData: PivotTableQueryFormData = {
    ...rawFormData,
    metricsLayout,
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
  });
  const rootKey = serializePath([]);
  const emptyTree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  let queryIndex = 0;
  const nextTreeWithLabels = initialPlan.targets.reduce((acc, target) => {
    const slice = queriesData.slice(
      queryIndex,
      queryIndex + target.queryPairs.length,
    );
    queryIndex += target.queryPairs.length;
    const nextTree = buildBranchTreeFromResults({
      results: slice,
      queryPairs: target.queryPairs,
      metricsForQuery: target.metricsForQuery,
      formData,
      rowGroupby: target.rowGroupbyForQueryFull,
      colGroupby: target.colGroupbyForQueryFull,
      rowSubtotalLevels: target.rowSubtotalLevels,
      colSubtotalLevels: target.colSubtotalLevels,
      metricsLayoutResolved: target.metricsLayoutResolved,
      metricInsertIndex: target.metricInsertIndex,
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

  const isDevBuild =
    process.env?.WEBPACK_MODE === 'development' ||
    process.env?.NODE_ENV === 'test';
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
    margin: (formData as any).margin ?? 0,
    data: nextTreeWithLabels,
    formData: {
      ...formData,
      metricsLayout,
      treeDataSignature,
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
    timeGrainSqla: formData.time_grain_sqla,
    treeData: nextTreeWithLabels,
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
