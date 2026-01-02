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
  QueryFormOrderBy,
} from '@superset-ui/core';
import { MetricsLayoutEnum, PivotTableQueryFormData } from './types';
import {
  collectMetricFormattingMetrics,
  mergeMetrics,
  normalizeSubtotalLevels,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
} from './utils';

export const QUERY_NAME_PREFIX = 'pivot_v3';
export const formatQueryName = (rowDepth: number, colDepth: number) =>
  `${QUERY_NAME_PREFIX}|row${rowDepth}|col${colDepth}`;

const normalizeColumn = (
  col: QueryFormColumn,
  time_grain_sqla?: string,
  isTemporal?: boolean,
) => {
  if (isPhysicalColumn(col) && time_grain_sqla && isTemporal) {
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

export default function buildQuery(formData: PivotTableQueryFormData) {
  const {
    groupbyColumns = [],
    groupbyRows = [],
    extra_form_data,
    startCollapsed = true,
    rowTotals,
    colTotals,
    colSubTotals,
    rowSubtotalLevels,
    colSubtotalLevels,
    initialDepth = 1,
  } = formData;

  const time_grain_sqla =
    extra_form_data?.time_grain_sqla || formData.time_grain_sqla;

  const rowGroupbyRaw = ensureIsArray<QueryFormColumn>(groupbyRows);
  const colGroupbyRaw = ensureIsArray<QueryFormColumn>(groupbyColumns);
  const metrics = ensureIsArray(formData.metrics);
  const formattingMetrics = collectMetricFormattingMetrics(
    formData.metricFormatting,
  );
  const metricsForQuery = mergeMetrics(metrics, formattingMetrics);
  const placement = resolveMetricPlacement(rowGroupbyRaw, colGroupbyRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  const rowGroupby = stripMetricsPlaceholder(placement.rows);
  const colGroupby = stripMetricsPlaceholder(placement.cols);
  const metricsOnRows = placement.layout === MetricsLayoutEnum.ROWS;
  const metricInsertIndex =
    placement.metricPosition >= 0 ? placement.metricPosition : undefined;

  const isTotalsEnabled = rowTotals || colTotals || colSubTotals;
  const isLevelTotalsEnabled =
    (rowSubtotalLevels && rowSubtotalLevels.length > 0) ||
    (colSubtotalLevels && colSubtotalLevels.length > 0);
  const requireMultiQuery = startCollapsed || isTotalsEnabled || isLevelTotalsEnabled;

  const initialDepthResolved = Math.max(initialDepth || 1, 1);
  const adjustForMetricFront = (depth: number, onAxis: boolean) => {
    if (!onAxis) {
      return depth;
    }
    // If metrics sit at position 0 on this axis, one visible level is the metric tier itself.
    if (metricInsertIndex === 0) {
      return Math.max(depth - 1, 0);
    }
    return depth;
  };

  const rowDepthLimit = Math.min(
    rowGroupby.length,
    adjustForMetricFront(initialDepthResolved, metricsOnRows),
  );
  const colDepthLimit = Math.min(
    colGroupby.length,
    adjustForMetricFront(initialDepthResolved, !metricsOnRows),
  );

  const rowSubTotalsEnabled = formData.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(rowGroupby.length - 1, 0);
  const rowLevels = normalizeSubtotalLevels(
    rowSubtotalLevels,
    maxRowSubtotalDepth,
    rowTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(colGroupby.length - 1, 0);
  const colSubtotalLevelsRaw = ensureIsArray<number>(colSubtotalLevels);
  const colSubtotalsLegacyEnabled =
    colSubtotalLevelsRaw.length === 0 && !!colSubTotals;
  const colLevelsBase = normalizeSubtotalLevels(
    colSubtotalLevelsRaw,
    maxColSubtotalDepth,
    false,
    colSubtotalsLegacyEnabled,
  ).filter(level => level > 0);
  const colLevels = colTotals ? [0, ...colLevelsBase] : colLevelsBase;

  const temporalLookup = formData?.temporal_columns_lookup || {};
  const isTemporalColumn = (col: QueryFormColumn) =>
    isPhysicalColumn(col) &&
    (temporalLookup?.[col as string] || formData.granularity_sqla === col);

  return buildQueryContext(formData, baseQueryObject => {
    const { series_limit_metric, order_desc } = baseQueryObject;
    const queryMetrics =
      metricsForQuery.length > 0 ? metricsForQuery : baseQueryObject.metrics;
    let orderby: QueryFormOrderBy[] | undefined;
    if (series_limit_metric) {
      orderby = [[series_limit_metric, !order_desc]];
    } else if (Array.isArray(metrics) && metrics[0]) {
      orderby = [[metrics[0], !order_desc]];
    } else if (Array.isArray(queryMetrics) && queryMetrics[0]) {
      orderby = [[queryMetrics[0], !order_desc]];
    }

    if (!requireMultiQuery) {
      return [
        {
          ...baseQueryObject,
          metrics: queryMetrics,
          orderby,
          columns: [...rowGroupby, ...colGroupby].map(col =>
            normalizeColumn(col, time_grain_sqla, isTemporalColumn(col)),
          ),
          query_name: formatQueryName(rowGroupby.length, colGroupby.length),
        },
      ];
    }

    const rowLevelsForInitial = startCollapsed
      ? rowLevels.filter(level => level <= rowDepthLimit)
      : rowLevels;
    const colLevelsForInitial = startCollapsed
      ? colLevels.filter(level => level <= colDepthLimit)
      : colLevels;

    const rowDepths = new Set<number>(rowLevelsForInitial);
    const colDepths = new Set<number>(colLevelsForInitial);

    // always include the initial visible depth for each axis
    rowDepths.add(rowDepthLimit || 0);
    colDepths.add(colDepthLimit || 0);
    if (metricsOnRows && metricInsertIndex === 0 && colTotals) {
      rowDepths.add(0);
    }

    const queries = Array.from(rowDepths).flatMap(rowDepth =>
      Array.from(colDepths).map(colDepth => ({
        ...baseQueryObject,
        metrics: queryMetrics,
        orderby,
        columns: [
          ...rowGroupby
            .slice(0, rowDepth)
            .map(col =>
              normalizeColumn(col, time_grain_sqla, isTemporalColumn(col)),
            ),
          ...colGroupby
            .slice(0, colDepth)
            .map(col =>
              normalizeColumn(col, time_grain_sqla, isTemporalColumn(col)),
            ),
        ],
        query_name: formatQueryName(rowDepth, colDepth),
      })),
    );

    if (rowTotals && colTotals) {
      const hasGrandTotalSlice = queries.some(
        query => query.query_name === formatQueryName(0, 0),
      );
      if (!hasGrandTotalSlice) {
        queries.unshift({
          ...baseQueryObject,
          metrics: queryMetrics,
          orderby,
          columns: [],
          query_name: formatQueryName(0, 0),
        });
      }
    }

    if (queries.length === 0) {
      queries.push({
        ...baseQueryObject,
        metrics: queryMetrics,
        orderby,
        columns: [],
        query_name: formatQueryName(0, 0),
      });
    }

    return queries;
  });
}
