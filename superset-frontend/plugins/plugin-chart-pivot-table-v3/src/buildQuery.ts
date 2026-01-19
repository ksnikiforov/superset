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
  AdhocColumn,
  buildQueryContext,
  ensureIsArray,
  isPhysicalColumn,
  QueryFormColumn,
  QueryFormMetric,
  QueryFormOrderBy,
} from '@superset-ui/core';
import { MetricsLayoutEnum, PivotTableQueryFormData } from './types';
import {
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  normalizeSubtotalLevels,
  resolveExpandLevel,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
} from './utils';
import { buildQueryShape } from './pivot/engine/query/queryShape';
import { type QueryIntent } from './pivot/engine/query/queryIntent';

export const QUERY_NAME_PREFIX = 'pivot_v3';
export const formatQueryName = (rowDepth: number, colDepth: number) =>
  `${QUERY_NAME_PREFIX}|row${rowDepth}|col${colDepth}`;
export type QueryDepthPair = { rowDepth: number; colDepth: number };
export const resolveQueryPairs = ({
  groupbyRows,
  groupbyColumns,
  rowSubtotalLevels,
  colSubtotalLevels,
  targetRowDepth,
  targetColDepth,
  rowTotals,
  colTotals,
}: {
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  targetRowDepth: number;
  targetColDepth: number;
  rowTotals?: boolean;
  colTotals?: boolean;
}): QueryDepthPair[] => {
  const rowDepths = new Set<number>();
  const colDepths = new Set<number>();
  const addDepth = (
    target: Set<number>,
    value: number,
    maxDepth: number,
  ) => {
    const resolved = Math.min(Math.max(value, 0), maxDepth);
    target.add(resolved);
  };
  addDepth(rowDepths, targetRowDepth, groupbyRows.length);
  addDepth(colDepths, targetColDepth, groupbyColumns.length);
  rowSubtotalLevels.forEach(level =>
    addDepth(rowDepths, level, groupbyRows.length),
  );
  colSubtotalLevels.forEach(level =>
    addDepth(colDepths, level, groupbyColumns.length),
  );
  if (colTotals || rowSubtotalLevels.includes(0)) {
    addDepth(rowDepths, 0, groupbyRows.length);
  }
  if (rowTotals || colSubtotalLevels.includes(0)) {
    addDepth(colDepths, 0, groupbyColumns.length);
  }
  const queryPairs: QueryDepthPair[] = [];
  const queryPairKeys = new Set<string>();
  rowDepths.forEach(rowDepth => {
    colDepths.forEach(colDepth => {
      const key = `${rowDepth}|${colDepth}`;
      if (queryPairKeys.has(key)) {
        return;
      }
      queryPairKeys.add(key);
      queryPairs.push({ rowDepth, colDepth });
    });
  });
  queryPairs.sort((a, b) =>
    a.rowDepth === b.rowDepth
      ? a.colDepth - b.colDepth
      : a.rowDepth - b.rowDepth,
  );
  return queryPairs;
};

export default function buildQuery(formData: PivotTableQueryFormData) {
  const metrics = ensureIsArray(formData.metrics);
  const groupbyRowsRaw = ensureIsArray<QueryFormColumn>(
    formData.groupbyRows || [],
  );
  const groupbyColumnsRaw = ensureIsArray<QueryFormColumn>(
    formData.groupbyColumns || [],
  );
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
  const resolvedStartCollapsed = formData.startCollapsed ?? true;
  const resolvedInitialDepth = formData.initialDepth ?? 1;
  const resolvedExpandRowsLevel = resolveExpandLevel(
    formData.expandRowsLevel,
    groupbyRows.length,
    resolvedStartCollapsed,
    resolvedInitialDepth,
  );
  const resolvedExpandColumnsLevel = resolveExpandLevel(
    formData.expandColumnsLevel,
    groupbyColumns.length,
    resolvedStartCollapsed,
    resolvedInitialDepth,
  );
  const baseRowDepth = groupbyRows.length > 0 ? 1 : 0;
  const baseColDepth = groupbyColumns.length > 0 ? 1 : 0;
  const targetRowDepth = Math.min(
    Math.max(resolvedExpandRowsLevel, baseRowDepth),
    groupbyRows.length,
  );
  const targetColDepth = Math.min(
    Math.max(resolvedExpandColumnsLevel, baseColDepth),
    groupbyColumns.length,
  );
  const needsTotals =
    !!formData.rowTotals ||
    !!formData.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const intent: QueryIntent = {
    kind: 'wholeLevel',
    targetRowDepth,
    targetColDepth,
    needsValueCells: true,
    needsTotals,
    needsMetricFormatting: Object.keys(formData.metricFormatting || {}).length > 0,
    needsDatabars: Object.keys(formData.metricDatabars || {}).length > 0,
    needsRowOrdering: Object.keys(rowSorting || {}).length > 0,
    needsColOrdering: Object.keys(colSorting || {}).length > 0,
    needsRowDimensionFormatting: Object.keys(rowFormatting || {}).length > 0,
    needsColDimensionFormatting: Object.keys(colFormatting || {}).length > 0,
  };
  const { metrics: metricsForQuery } = buildQueryShape({
    intent,
    rowGroupby: groupbyRows,
    colGroupby: groupbyColumns,
    metrics,
    metricFormattingScope: formData.metricFormattingScope,
    metricFormatting: formData.metricFormatting,
    metricDatabars: formData.metricDatabars,
    rowFormatting,
    colFormatting,
    rowSorting,
    colSorting,
  });
  const metricsForQueryResolved =
    metricsForQuery.length > 0 ? metricsForQuery : metrics;
  const temporalLookup = formData?.temporal_columns_lookup || {};
  const timeGrainSqla =
    formData.extra_form_data?.time_grain_sqla || formData.time_grain_sqla;
  const isTemporalColumn = (col: QueryFormColumn) =>
    isPhysicalColumn(col) &&
    (temporalLookup?.[col as string] || formData.granularity_sqla === col);
  const normalizeColumn = (
    col: QueryFormColumn,
    time_grain_sqla?: string,
  ): QueryFormColumn => {
    if (isPhysicalColumn(col) && time_grain_sqla && isTemporalColumn(col)) {
      return {
        timeGrain: time_grain_sqla,
        columnType: 'BASE_AXIS',
        sqlExpression: col,
        label: col,
        expressionType: 'SQL',
      } as AdhocColumn;
    }
    return col;
  };
  const rowGroupbyForQuery = groupbyRows.map(col =>
    normalizeColumn(col, timeGrainSqla),
  );
  const colGroupbyForQuery = groupbyColumns.map(col =>
    normalizeColumn(col, timeGrainSqla),
  );
  const queryPairs = resolveQueryPairs({
    groupbyRows,
    groupbyColumns,
    rowSubtotalLevels,
    colSubtotalLevels,
    targetRowDepth,
    targetColDepth,
    rowTotals: formData.rowTotals,
    colTotals: formData.colTotals,
  });

  return buildQueryContext(formData, baseQueryObject => {
    const { series_limit_metric, order_desc } = baseQueryObject;
    const queryMetrics =
      metricsForQueryResolved.length > 0
        ? metricsForQueryResolved
        : baseQueryObject.metrics;
    let orderby: QueryFormOrderBy[] | undefined;
    if (series_limit_metric) {
      orderby = [[series_limit_metric, !order_desc]];
    } else if (Array.isArray(queryMetrics)) {
      orderby = queryMetrics[0] ? [[queryMetrics[0], !order_desc]] : undefined;
    }
    return queryPairs.map(pair => ({
      ...baseQueryObject,
      metrics: queryMetrics as QueryFormMetric[],
      orderby,
      columns: [
        ...rowGroupbyForQuery.slice(0, pair.rowDepth),
        ...colGroupbyForQuery.slice(0, pair.colDepth),
      ],
      query_name: formatQueryName(pair.rowDepth, pair.colDepth),
    }));
  });
}
