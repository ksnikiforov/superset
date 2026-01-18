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
  getColumnLabel,
  SMART_DATE_ID,
  TimeFormats,
  ensureIsArray,
} from '@superset-ui/core';
import { getColorFormatters } from '@superset-ui/chart-controls';
import {
  MetricsLayoutEnum,
  PivotTableQueryFormData,
  PivotTreeData,
  TotalPosition,
} from './types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  collectDimensionFormattingMetricsForQuery,
  collectMetricFormattingMetricsForQuery,
  collectMetricDatabarMetricsForQuery,
  getMetricKeys,
  getStableColumnKey,
  mergeTrees,
  mergeMetrics,
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  normalizeMetricDatabarMapWithKeys,
  parseDepth,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
  normalizeSubtotalLevels,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  serializeCellKey,
  serializePath,
  collectDimensionSortingMetricsForQuery,
} from './utils';

const { DATABASE_DATETIME } = TimeFormats;

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
    datasource: { verboseMap = {}, columnFormats = {}, currencyFormats = {} },
    emitCrossFilters,
    theme,
    ownState,
  } = chartProps;
  const metrics = ensureIsArray(formData.metrics || []);
  const metricFormatting = normalizeMetricFormattingMapWithKeys(
    formData.metricFormatting,
    metrics,
  );
  const metricDatabars = normalizeMetricDatabarMapWithKeys(
    formData.metricDatabars,
    metrics,
  );
  const formattingMetrics =
    collectMetricFormattingMetricsForQuery(metricFormatting);
  const databarMetrics = collectMetricDatabarMetricsForQuery(metricDatabars);
  const metricsForQuery = mergeMetrics(metrics, formattingMetrics);
  const groupbyRowsRaw = ensureIsArray(formData.groupbyRows || []);
  const groupbyColumnsRaw = ensureIsArray(formData.groupbyColumns || []);
  const placement = resolveMetricPlacement(groupbyRowsRaw, groupbyColumnsRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  const groupbyRows = stripMetricsPlaceholder(placement.rows);
  const groupbyColumns = stripMetricsPlaceholder(placement.cols);
  const rowFormatting = normalizeDimensionFormattingMapWithKeys(
    formData.rowFormatting,
    groupbyRows,
  );
  const colFormatting = normalizeDimensionFormattingMapWithKeys(
    formData.colFormatting,
    groupbyColumns,
  );
  const rowSorting = normalizeDimensionSortingMapWithKeys(
    formData.rowSorting,
    groupbyRows,
  );
  const colSorting = normalizeDimensionSortingMapWithKeys(
    formData.colSorting,
    groupbyColumns,
  );
  const rowFormattingMetrics = collectDimensionFormattingMetricsForQuery(
    rowFormatting,
    groupbyRows,
  );
  const colFormattingMetrics = collectDimensionFormattingMetricsForQuery(
    colFormatting,
    groupbyColumns,
  );
  const rowSortingMetrics = collectDimensionSortingMetricsForQuery(
    rowSorting,
    groupbyRows,
  );
  const colSortingMetrics = collectDimensionSortingMetricsForQuery(
    colSorting,
    groupbyColumns,
  );
  const metricsForQueryWithFormatting = mergeMetrics(metricsForQuery, [
    ...databarMetrics,
    ...rowFormattingMetrics,
    ...colFormattingMetrics,
    ...rowSortingMetrics,
    ...colSortingMetrics,
  ]);
  const rowSubTotalsEnabled = formData.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(groupbyRows.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    formData.rowSubtotalLevels,
    maxRowSubtotalDepth,
    formData.colTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(groupbyColumns.length - 1, 0);
  const colSubtotalLevelsRaw = ensureIsArray<number>(
    formData.colSubtotalLevels,
  );
  const colSubtotalLevels = normalizeSubtotalLevels(
    colSubtotalLevelsRaw,
    maxColSubtotalDepth,
    false,
    false,
  ).filter(level => level > 0);
  const rowTotalPosition =
    (formData.rowTotalPosition as TotalPosition) || 'start';
  const rowSubtotalPosition =
    (formData.rowSubtotalPosition as TotalPosition) || 'start';
  const colTotalPosition =
    (formData.colTotalPosition as TotalPosition) || 'start';
  const colSubtotalPosition =
    (formData.colSubtotalPosition as TotalPosition) || 'start';
  const pivotTheme = formData.pivotTheme || 'none';
  const pivotThemeColors = formData.pivotThemeColors || '';
  const metricsLayout = placement.layout;
  const metricInsertIndex =
    metricsLayout === MetricsLayoutEnum.ROWS
      ? placement.metricPosition >= 0
        ? Math.min(placement.metricPosition, groupbyRows.length)
        : groupbyRows.length
      : placement.metricPosition >= 0
        ? Math.min(placement.metricPosition, groupbyColumns.length)
        : groupbyColumns.length;
  const granularity = extractTimegrain(rawFormData);
  const metricKeysForQuery = getMetricKeys(metricsForQueryWithFormatting);
  const metricKeySetForQuery = new Set(metricKeysForQuery.filter(key => key));
  const queryFormData: PivotTableQueryFormData = {
    ...rawFormData,
    metricsLayout,
  };

  const resolveQueryDepth = (query: (typeof queriesData)[number]) => {
    const queryName = (query as any)?.query_name || (query as any)?.queryName;
    let { rowDepth, colDepth } = parseDepth(queryName);
    const hasQueryName = !!queryName;
    const colSet = new Set(
      (query.colnames || []).map((name: any) => String(name)),
    );
    const inferredRowDepth = groupbyRows.filter(col =>
      colSet.has(String(getColumnLabel(col))),
    ).length;
    const inferredColDepth = groupbyColumns.filter(col =>
      colSet.has(String(getColumnLabel(col))),
    ).length;
    if (colSet.size > 0) {
      rowDepth = inferredRowDepth;
      colDepth = inferredColDepth;
    }
    const hasGroupbyCols = inferredRowDepth > 0 || inferredColDepth > 0;
    const hasMetricCols =
      metricKeySetForQuery.size > 0 &&
      Array.from(metricKeySetForQuery).some(key => colSet.has(String(key)));
    const isMetricOnlyQuery =
      colSet.size > 0 && !hasGroupbyCols && hasMetricCols;
    if (
      rowDepth === 0 &&
      colDepth === 0 &&
      (query.data || []).length > 0 &&
      !isMetricOnlyQuery &&
      hasQueryName
    ) {
      rowDepth = groupbyRows.length;
      colDepth = groupbyColumns.length;
    }
    rowDepth = Math.min(rowDepth || 0, groupbyRows.length);
    colDepth = Math.min(colDepth || 0, groupbyColumns.length);
    return { rowDepth, colDepth };
  };

  const combinedData = queriesData.flatMap(({ data }) => data || []);
  const colTypeMap: Record<string, GenericDataType> = {};
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
  const baseTree =
    ownState?.treeData && ownState?.treeDataSignature === treeDataSignature
      ? ownState.treeData
      : ({} as PivotTreeData);
  const nextTreeRaw = queriesData.reduce<PivotTreeData>((acc, query) => {
    const { rowDepth, colDepth } = resolveQueryDepth(query);
    const branch = buildTreeFromRecords(
      query.data || [],
      metricsForQueryWithFormatting,
      groupbyRows,
      groupbyColumns,
      rowDepth,
      colDepth,
    );
    return mergeTrees(acc, branch);
  }, baseTree);
  const rowSubtotalDepths = rowSubtotalLevels.filter(level => level > 0);
  const nextTreeWithRowSubtotals = rowSubtotalDepths.reduce(
    (acc, depth) => injectRowSubtotalLeaves(acc, depth, groupbyRows.length),
    nextTreeRaw,
  );
  const nextTree = applyMetricAxis(
    nextTreeWithRowSubtotals,
    metrics,
    metricsLayout,
    groupbyRows,
    groupbyColumns,
    metricInsertIndex,
  );
  const rootKey = serializePath([]);
  const zeroDepthQuery = queriesData.find(query => {
    const { rowDepth: rd, colDepth: cd } = resolveQueryDepth(query);
    return rd === 0 && cd === 0;
  });
  const grandTotalRecord = zeroDepthQuery?.data?.[0];
  if (grandTotalRecord) {
    const grandValues = metricKeysForQuery.reduce(
      (acc, key) => {
        if (!key) return acc;
        return { ...acc, [key]: (grandTotalRecord as any)[key] };
      },
      {} as Record<string, DataRecordValue>,
    );
    if (Object.keys(grandValues).length > 0) {
      const rootCellKey = serializeCellKey(rootKey, rootKey);
      nextTree.rows[rootKey] = {
        ...nextTree.rows[rootKey],
        values: { ...(nextTree.rows[rootKey]?.values || {}), ...grandValues },
      };
      nextTree.cols[rootKey] = {
        ...nextTree.cols[rootKey],
        values: { ...(nextTree.cols[rootKey]?.values || {}), ...grandValues },
      };
      nextTree.cells[rootCellKey] = {
        rowKey: rootKey,
        colKey: rootKey,
        values: {
          ...(nextTree.cells[rootCellKey]?.values || {}),
          ...grandValues,
        },
        isSubtotal: true,
      };
    }
  }
  const nextTreeLabeled = labelRowSubtotalLeaves(nextTree, metrics);
  if (nextTreeLabeled.rows[rootKey]) {
    nextTreeLabeled.rows[rootKey] = {
      ...nextTreeLabeled.rows[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }
  if (nextTreeLabeled.cols[rootKey]) {
    nextTreeLabeled.cols[rootKey] = {
      ...nextTreeLabeled.cols[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }

  const { selectedFilters } = filterState;

  return {
    width,
    height,
    margin: (formData as any).margin ?? 0,
    data: nextTreeLabeled,
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
    startCollapsed: formData.startCollapsed ?? true,
    initialDepth: formData.initialDepth ?? 1,
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
    treeData: nextTreeLabeled,
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
