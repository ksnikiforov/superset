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
  getMetricKeys,
  getStableColumnKey,
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  normalizeMetricDatabarMapWithKeys,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
  normalizeSubtotalLevels,
  labelRowSubtotalLeaves,
  serializeCellKey,
  serializePath,
} from './utils';
import { buildQueryShape } from './pivot/engine/query/queryShape';
import { type QueryIntent } from './pivot/engine/query/queryIntent';

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
  const metrics = ensureIsArray(formData.metrics || []);
  const metricFormatting = normalizeMetricFormattingMapWithKeys(
    formData.metricFormatting,
    metrics,
  );
  const metricDatabars = normalizeMetricDatabarMapWithKeys(
    formData.metricDatabars,
    metrics,
  );
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
  const needsTotals =
    !!formData.rowTotals ||
    !!formData.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const intent: QueryIntent = {
    kind: 'wholeLevel',
    targetRowDepth: groupbyRows.length,
    targetColDepth: groupbyColumns.length,
    needsValueCells: true,
    needsTotals,
    needsMetricFormatting: Object.keys(metricFormatting || {}).length > 0,
    needsDatabars: Object.keys(metricDatabars || {}).length > 0,
    needsRowOrdering: Object.keys(rowSorting || {}).length > 0,
    needsColOrdering: Object.keys(colSorting || {}).length > 0,
    needsRowDimensionFormatting: Object.keys(rowFormatting || {}).length > 0,
    needsColDimensionFormatting: Object.keys(colFormatting || {}).length > 0,
  };
  const { metrics: metricsForQueryWithFormatting } = buildQueryShape({
    intent,
    rowGroupby: groupbyRows,
    colGroupby: groupbyColumns,
    metrics,
    metricFormattingScope: formData.metricFormattingScope,
    metricFormatting,
    metricDatabars,
    rowFormatting,
    colFormatting,
    rowSorting,
    colSorting,
  });
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
  const baseTree = buildTreeFromRecords(
    [],
    metricsForQueryWithFormatting,
    groupbyRows,
    groupbyColumns,
    0,
    0,
  );
  const nextTree = applyMetricAxis(
    baseTree,
    metrics,
    metricsLayout,
    groupbyRows,
    groupbyColumns,
    metricInsertIndex,
  );
  const rootKey = serializePath([]);
  const bootstrapQuery = queriesData[0];
  const bootstrapRecord = bootstrapQuery?.data?.[0];
  const bootstrapKeys = (bootstrapQuery?.colnames || [])
    .map((name: string) => String(name))
    .filter(key => metricKeySetForQuery.has(key));
  if (bootstrapRecord && bootstrapKeys.length > 0) {
    const grandValues = bootstrapKeys.reduce(
      (acc, key) => ({ ...acc, [key]: (bootstrapRecord as any)[key] }),
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
