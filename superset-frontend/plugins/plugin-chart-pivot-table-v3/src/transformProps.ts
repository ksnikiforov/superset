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
  collectMetricFormattingMetrics,
  getMetricKeys,
  mergeTrees,
  mergeMetrics,
  parseDepth,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
  normalizeSubtotalLevels,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  serializePath,
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
    hooks: { setDataMask = () => {}, onContextMenu },
    filterState,
    datasource: { verboseMap = {}, columnFormats = {}, currencyFormats = {} },
    emitCrossFilters,
    theme,
    ownState,
  } = chartProps;
  const metrics = ensureIsArray(formData.metrics || []);
  const metricFormatting = formData.metricFormatting || {};
  const formattingMetrics = collectMetricFormattingMetrics(metricFormatting);
  const metricsForQuery = mergeMetrics(metrics, formattingMetrics);
  const groupbyRowsRaw = ensureIsArray(formData.groupbyRows || []);
  const groupbyColumnsRaw = ensureIsArray(formData.groupbyColumns || []);
  const placement = resolveMetricPlacement(groupbyRowsRaw, groupbyColumnsRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  const groupbyRows = stripMetricsPlaceholder(placement.rows);
  const groupbyColumns = stripMetricsPlaceholder(placement.cols);
  const rowSubTotalsEnabled = formData.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(groupbyRows.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    formData.rowSubtotalLevels,
    maxRowSubtotalDepth,
    formData.rowTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(groupbyColumns.length - 1, 0);
  const colSubtotalLevelsRaw = ensureIsArray<number>(
    formData.colSubtotalLevels,
  );
  const colSubtotalsLegacyEnabled =
    colSubtotalLevelsRaw.length === 0 && !!formData.colSubTotals;
  const colSubtotalLevels = normalizeSubtotalLevels(
    colSubtotalLevelsRaw,
    maxColSubtotalDepth,
    false,
    colSubtotalsLegacyEnabled,
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
  const maxDepthPerFetch = 1;
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
  const metricKeys = getMetricKeys(metrics);
  const metricKeySet = new Set(metricKeys.filter(key => key));
  const metricKeysForQuery = getMetricKeys(metricsForQuery);
  const metricKeySetForQuery = new Set(metricKeysForQuery.filter(key => key));

  const resolveQueryDepth = (query: typeof queriesData[number]) => {
    const queryName = (query as any)?.query_name || (query as any)?.queryName;
    let { rowDepth, colDepth } = parseDepth(queryName);
    const colSet = new Set((query.colnames || []).map((name: any) => String(name)));
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
    const isMetricOnlyQuery = colSet.size > 0 && !hasGroupbyCols && hasMetricCols;
    if (
      rowDepth === 0 &&
      colDepth === 0 &&
      (query.data || []).length > 0 &&
      !isMetricOnlyQuery
    ) {
      rowDepth = groupbyRows.length;
      colDepth = groupbyColumns.length;
    }
    rowDepth = Math.min(rowDepth || 0, groupbyRows.length);
    colDepth = Math.min(colDepth || 0, groupbyColumns.length);
    return { rowDepth, colDepth };
  };

  const combinedData = queriesData.flatMap(({ data }) => data || []);
  const colnames = queriesData[0]?.colnames || [];
  const coltypes = queriesData[0]?.coltypes || [];
  const colTypeMap: Record<string, GenericDataType> = {};
  colnames.forEach((name: string, idx: number) => {
    colTypeMap[name] = coltypes[idx];
  });

  const dateFormatters = colnames
    .filter(
      (colname: string, index: number) =>
        coltypes[index] === GenericDataType.Temporal,
    )
    .reduce(
      (
        acc: Record<string, ((value: DataRecordValue) => string) | undefined>,
        temporalColname: string,
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
    // @ts-ignore legacy conditional formatting name
    formData.conditionalFormatting || formData.conditional_formatting,
    combinedData,
    theme,
  );

  const nextTreeRaw = queriesData.reduce<PivotTreeData>((acc, query) => {
    const { rowDepth, colDepth } = resolveQueryDepth(query);
    const branch = buildTreeFromRecords(
      query.data || [],
      metricsForQuery,
      groupbyRows,
      groupbyColumns,
      rowDepth,
      colDepth,
    );
    return mergeTrees(acc, branch);
  }, ownState?.treeData || ({} as PivotTreeData));
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
    const grandValues = metricKeysForQuery.reduce((acc, key) => {
      if (!key) return acc;
      return { ...acc, [key]: (grandTotalRecord as any)[key] };
    }, {} as Record<string, DataRecordValue>);
    if (Object.keys(grandValues).length > 0) {
      nextTree.rows[rootKey] = {
        ...nextTree.rows[rootKey],
        values: { ...(nextTree.rows[rootKey]?.values || {}), ...grandValues },
      };
      nextTree.cols[rootKey] = {
        ...nextTree.cols[rootKey],
        values: { ...(nextTree.cols[rootKey]?.values || {}), ...grandValues },
      };
      nextTree.cells[`${rootKey}|${rootKey}`] = {
        rowKey: rootKey,
        colKey: rootKey,
        values: {
          ...(nextTree.cells[`${rootKey}|${rootKey}`]?.values || {}),
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
    formData: { ...formData, metricsLayout, maxDepthPerFetch },
    metrics,
    metricFormatting,
    metricFormattingScope: formData.metricFormattingScope,
    groupbyRows,
    groupbyColumns,
    aggregateFunction: formData.aggregateFunction,
    startCollapsed: formData.startCollapsed ?? true,
    initialDepth: formData.initialDepth ?? 1,
    maxDepthPerFetch,
    rowTotals: formData.rowTotals,
    colTotals: formData.colTotals,
    rowSubTotals: rowSubTotalsEnabled,
    colSubTotals: formData.colSubTotals,
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
  };
}
