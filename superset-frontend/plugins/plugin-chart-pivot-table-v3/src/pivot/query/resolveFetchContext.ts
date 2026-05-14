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
import { type QueryFormColumn, type QueryFormMetric } from '@superset-ui/core';
import {
  type MeasureHierarchy,
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
} from '../../types';
import {
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  hasTotalSorting,
} from '../../utils';
import { getMetricKey } from '../core/tokens';
import {
  buildLayoutContext,
  type LayoutContext,
} from '../layout/LayoutContext';
import { collectRequiredTimeOffsets } from '../measureLeaves';
import {
  type PivotAxisProjection,
  resolveAxisProjection,
} from '../runtime/projection';
import { buildBranchFactCoverages } from '../runtime/coverage';
import { type PivotCoverageReason } from '../runtime/types';
import { buildQueryShape } from './queryShape';
import { type QueryIntent } from './queryIntent';

export type ResolveFetchContextParams = {
  formData: PivotTableQueryFormData;
  layout?: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  targetRowDepth?: number;
  targetColDepth?: number;
};

export type ResolvedFetchContext = {
  projection: PivotAxisProjection;
  rowGroupbyForQuery: QueryFormColumn[];
  colGroupbyForQuery: QueryFormColumn[];
  materializedMetrics: QueryFormMetric[];
  metricsForQuery: QueryFormMetric[];
  materializedMeasureHierarchy: MeasureHierarchy;
  requiredTimeOffsets: string[];
  sanitizedPath: PivotPath;
  rowDepth: number;
  colDepth: number;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  hasRowFormatting: boolean;
  hasColFormatting: boolean;
  hasRowTotalSorting: boolean;
  hasColTotalSorting: boolean;
};

const filterMetricsByScope = (
  metrics: QueryFormMetric[],
  metricKeys: string[],
): QueryFormMetric[] => {
  if (metricKeys.length === 0) {
    return metrics;
  }
  const metricKeySet = new Set(metricKeys);
  return metrics.filter(metric => metricKeySet.has(getMetricKey(metric)));
};

const filterMeasureHierarchyByScope = ({
  measureHierarchy,
  metricKeys,
  leafIds,
}: {
  measureHierarchy: MeasureHierarchy;
  metricKeys: string[];
  leafIds: string[];
}): MeasureHierarchy => {
  if (measureHierarchy.kind === 'flatMetrics') {
    return metricKeys.length > 0
      ? {
          kind: 'flatMetrics',
          metricKeys: measureHierarchy.metricKeys.filter(metricKey =>
            metricKeys.includes(metricKey),
          ),
        }
      : measureHierarchy;
  }

  const metricKeySet = metricKeys.length > 0 ? new Set(metricKeys) : undefined;
  const leafIdSet = leafIds.length > 0 ? new Set(leafIds) : undefined;
  return {
    ...measureHierarchy,
    groups: measureHierarchy.groups
      .filter(group => !metricKeySet || metricKeySet.has(group.metricKey))
      .map(group => ({
        ...group,
        leaves: leafIdSet
          ? group.leaves.filter(leaf => leafIdSet.has(leaf.id))
          : group.leaves,
      }))
      .filter(group => group.leaves.length > 0),
  };
};

export const resolveFetchContext = ({
  formData,
  layout: layoutParam,
  axis,
  path,
  visibleRowDepth = 0,
  visibleColDepth = 0,
  targetRowDepth,
  targetColDepth,
}: ResolveFetchContextParams): ResolvedFetchContext => {
  const layout = layoutParam ?? buildLayoutContext(formData);
  const { metrics } = layout;
  const rowGroupby = layout.groupbyRows;
  const colGroupby = layout.groupbyColumns;

  const hasRowTotalSorting = hasTotalSorting(formData.rowSorting, rowGroupby);
  const hasColTotalSorting = hasTotalSorting(formData.colSorting, colGroupby);

  const maxRowSubtotalDepth = Math.max(rowGroupby.length - 1, 0);
  const rowSubtotalLevels = layout.rowSubtotalLevels.filter(
    level => level <= maxRowSubtotalDepth,
  );
  const maxColSubtotalDepth = Math.max(colGroupby.length - 1, 0);
  const colSubtotalLevels = layout.colSubtotalLevelsForQuery.filter(
    level => level <= maxColSubtotalDepth,
  );

  const projection = resolveAxisProjection({
    program: layout.pivotProgram,
    axis,
    path,
  });
  const sanitizedPath = projection.filterDimensionPath;
  const depthIncrement = 1;

  const currentRowDepth = Math.min(visibleRowDepth, rowGroupby.length);
  const currentColDepth = Math.min(visibleColDepth, colGroupby.length);

  let rowDepth =
    axis === 'row'
      ? Math.min(rowGroupby.length, sanitizedPath.length + depthIncrement)
      : Math.min(rowGroupby.length, currentRowDepth);
  let colDepth =
    axis === 'col'
      ? Math.min(colGroupby.length, sanitizedPath.length + depthIncrement)
      : Math.min(colGroupby.length, currentColDepth);
  if (targetRowDepth !== undefined) {
    rowDepth = Math.min(rowGroupby.length, Math.max(targetRowDepth, 0));
  }
  if (targetColDepth !== undefined) {
    colDepth = Math.min(colGroupby.length, Math.max(targetColDepth, 0));
  }

  const needsMetricFormatting =
    Object.keys(formData.metricFormatting || {}).length > 0;
  const needsDatabars = Object.keys(formData.metricDatabars || {}).length > 0;
  const hasRowFormatting =
    collectDimensionFormattingMetricsForQuery(
      formData.rowFormatting,
      rowGroupby,
      metrics,
    ).length > 0;
  const hasColFormatting =
    collectDimensionFormattingMetricsForQuery(
      formData.colFormatting,
      colGroupby,
      metrics,
    ).length > 0;
  const needsRowOrdering =
    collectDimensionSortingMetricsForQuery(
      formData.rowSorting,
      rowGroupby,
      metrics,
    ).length > 0;
  const needsColOrdering =
    collectDimensionSortingMetricsForQuery(
      formData.colSorting,
      colGroupby,
      metrics,
    ).length > 0;
  const materializedMetrics = filterMetricsByScope(
    metrics,
    projection.metricKeys,
  );
  const materializedMeasureHierarchy = filterMeasureHierarchyByScope({
    measureHierarchy: layout.measureHierarchy,
    metricKeys: projection.metricKeys,
    leafIds: projection.measureLeafIds,
  });
  const requiredTimeOffsets = collectRequiredTimeOffsets(
    materializedMeasureHierarchy,
  );
  const needsTotals =
    !!formData.rowTotals ||
    !!formData.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const intent: QueryIntent = {
    kind: 'branch',
    axis,
    targetRowDepth: rowDepth,
    targetColDepth: colDepth,
    needsValueCells: true,
    needsTotals,
    needsMetricFormatting,
    needsDatabars,
    needsRowOrdering,
    needsColOrdering,
    needsRowDimensionFormatting: hasRowFormatting,
    needsColDimensionFormatting: hasColFormatting,
  };
  const queryShape = buildQueryShape({
    intent,
    rowGroupby,
    colGroupby,
    metrics: materializedMetrics,
    availableMetrics: metrics,
    metricFormattingScope: formData.metricFormattingScope,
    metricFormatting: formData.metricFormatting,
    metricDatabars: formData.metricDatabars,
    rowFormatting: formData.rowFormatting,
    colFormatting: formData.colFormatting,
    rowSorting: formData.rowSorting,
    colSorting: formData.colSorting,
    measureHierarchy: materializedMeasureHierarchy,
  });
  const rowGroupbyForQuery = queryShape.rowGroupby;
  const colGroupbyForQuery = queryShape.colGroupby;
  const metricsForQuery = queryShape.metrics;

  return {
    projection,
    rowGroupbyForQuery,
    colGroupbyForQuery,
    materializedMetrics,
    metricsForQuery,
    materializedMeasureHierarchy,
    requiredTimeOffsets,
    sanitizedPath,
    rowDepth,
    colDepth,
    rowSubtotalLevels,
    colSubtotalLevels,
    hasRowFormatting,
    hasColFormatting,
    hasRowTotalSorting,
    hasColTotalSorting,
  };
};

export const buildFetchContextFactCoverages = ({
  layout,
  axis,
  ctx,
  reason = 'expand',
}: {
  layout: LayoutContext;
  axis: PivotAxis;
  ctx: ResolvedFetchContext;
  reason?: PivotCoverageReason;
}) =>
  buildBranchFactCoverages({
    program: layout.pivotProgram,
    axis,
    projection: ctx.projection,
    rowDepth: ctx.rowDepth,
    columnDepth: ctx.colDepth,
    rowSubtotalLevels: ctx.rowSubtotalLevels,
    columnSubtotalLevels: ctx.colSubtotalLevels,
    rowTotals: layout.rowTotals,
    columnTotals: layout.colTotals,
    includeRowTotalForColumnFormatting:
      axis === 'col' && (ctx.hasColFormatting || ctx.hasColTotalSorting),
    includeColumnTotalForRowFormatting:
      axis === 'row' && (ctx.hasRowFormatting || ctx.hasRowTotalSorting),
    reason,
  });
