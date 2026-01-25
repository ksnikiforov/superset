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
  type AdhocColumn,
  isPhysicalColumn,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  type PivotAxis,
  type PivotPath,
  type PivotTreeData,
  type PivotTreeNode,
  type PivotTableQueryFormData,
} from '../../types';
import {
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  decodeMetricKey,
  isMeasureLeafToken,
  hasTotalSorting,
} from '../../utils';
import {
  buildLayoutContext,
  type LayoutContext,
} from '../layout/LayoutContext';
import { buildQueryShape } from './queryShape';
import { type QueryIntent } from './queryIntent';

export type ResolveFetchContextParams = {
  formData: PivotTableQueryFormData;
  layout?: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  metricPath?: PivotPath;
  currentTree?: PivotTreeData;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  targetRowDepth?: number;
  targetColDepth?: number;
};

export type ResolvedFetchContext = {
  rowGroupbyRaw: QueryFormColumn[];
  colGroupbyRaw: QueryFormColumn[];
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowGroupbyForQueryFull: QueryFormColumn[];
  colGroupbyForQueryFull: QueryFormColumn[];
  rowGroupbyForQuery: QueryFormColumn[];
  colGroupbyForQuery: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricsForQuery: QueryFormMetric[];
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
  sanitizedPath: PivotPath;
  rowDepth: number;
  colDepth: number;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  hasRowFormatting: boolean;
  hasColFormatting: boolean;
  hasRowTotalSorting: boolean;
  hasColTotalSorting: boolean;
  timeGrainSqla?: string;
};

export const resolveFetchContext = ({
  formData,
  layout: layoutParam,
  axis,
  path,
  metricPath,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  targetRowDepth,
  targetColDepth,
}: ResolveFetchContextParams): ResolvedFetchContext => {
  const layout = layoutParam ?? buildLayoutContext(formData);
  const rowGroupbyRaw = layout.groupbyRowsRaw;
  const colGroupbyRaw = layout.groupbyColumnsRaw;
  const {
    metrics,
    metricLabelSet,
    metricsLayoutResolved,
    metricInsertIndex: metricInsertIndexBase,
  } = layout;
  const extraFormData = formData.extra_form_data;
  const timeGrainSqla =
    extraFormData?.time_grain_sqla || formData.time_grain_sqla;
  const temporalLookup = formData?.temporal_columns_lookup || {};
  const isTemporalColumn = (col: QueryFormColumn) =>
    isPhysicalColumn(col) &&
    (temporalLookup?.[col as string] || formData.granularity_sqla === col);
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
  let rowGroupby = layout.groupbyRows;
  let colGroupby = layout.groupbyColumns;
  const metricsAxis: PivotAxis =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS ? 'row' : 'col';
  const pathForMetrics = metricPath ?? path;
  const getMetricIndex = (candidatePath: PivotPath) =>
    candidatePath.findIndex(val => {
      const decoded = decodeMetricKey(val);
      if (decoded !== undefined && metricLabelSet.has(decoded)) {
        return true;
      }
      return typeof val === 'string' && metricLabelSet.has(val);
    });
  const metricIndexInPath =
    metricsAxis === axis ? getMetricIndex(pathForMetrics) : -1;
  const shouldCollapseRowDims =
    metricsAxis === 'row' &&
    axis === 'row' &&
    metricIndexInPath >= 0 &&
    metricIndexInPath < metricInsertIndexBase;
  const shouldCollapseColDims =
    metricsAxis === 'col' &&
    axis === 'col' &&
    metricIndexInPath >= 0 &&
    metricIndexInPath < metricInsertIndexBase;

  if (shouldCollapseRowDims) {
    rowGroupby = rowGroupby.filter(
      (_, idx) => idx < metricIndexInPath || idx >= metricInsertIndexBase,
    );
  }
  if (shouldCollapseColDims) {
    colGroupby = colGroupby.filter(
      (_, idx) => idx < metricIndexInPath || idx >= metricInsertIndexBase,
    );
  }

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

  const metricInsertIndex =
    (shouldCollapseRowDims || shouldCollapseColDims) && metricIndexInPath >= 0
      ? metricIndexInPath
      : metricInsertIndexBase;

  const stripMetricFromPath = (
    p: PivotPath,
    targetAxis: PivotAxis,
    metricIndexOverride?: number,
  ) => {
    if (metricsAxis !== targetAxis) {
      return p.filter(val => !isMeasureLeafToken(val));
    }
    const idx =
      metricIndexOverride !== undefined
        ? metricIndexOverride
        : getMetricIndex(p);
    if (idx < 0) {
      return p.filter(val => !isMeasureLeafToken(val));
    }
    return [...p.slice(0, idx), ...p.slice(idx + 1)].filter(
      val => !isMeasureLeafToken(val),
    );
  };

  const sanitizedPath = stripMetricFromPath(path, axis, metricIndexInPath);
  const depthIncrement = 1;

  const getCurrentDepth = (
    nodes: Record<string, PivotTreeNode> | undefined,
    targetAxis: PivotAxis,
  ) =>
    Math.max(
      0,
      ...Object.values(nodes || {}).map(
        node => stripMetricFromPath(node.path, targetAxis).length,
      ),
    );

  const currentRowDepth =
    visibleRowDepth !== undefined
      ? Math.min(visibleRowDepth, rowGroupby.length)
      : getCurrentDepth(currentTree?.rows, 'row');
  const currentColDepth =
    visibleColDepth !== undefined
      ? Math.min(visibleColDepth, colGroupby.length)
      : getCurrentDepth(currentTree?.cols, 'col');

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

  const rowGroupbyForQueryFull = rowGroupby.map(col =>
    normalizeColumn(col, timeGrainSqla, isTemporalColumn(col)),
  );
  const colGroupbyForQueryFull = colGroupby.map(col =>
    normalizeColumn(col, timeGrainSqla, isTemporalColumn(col)),
  );
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
    rowGroupby: rowGroupbyForQueryFull,
    colGroupby: colGroupbyForQueryFull,
    metrics,
    metricFormattingScope: formData.metricFormattingScope,
    metricFormatting: formData.metricFormatting,
    metricDatabars: formData.metricDatabars,
    rowFormatting: formData.rowFormatting,
    colFormatting: formData.colFormatting,
    rowSorting: formData.rowSorting,
    colSorting: formData.colSorting,
    measureHierarchy: layout.measureHierarchy,
  });
  const rowGroupbyForQuery = queryShape.rowGroupby;
  const colGroupbyForQuery = queryShape.colGroupby;
  const metricsForQuery = queryShape.metrics;

  return {
    rowGroupbyRaw,
    colGroupbyRaw,
    rowGroupby,
    colGroupby,
    rowGroupbyForQueryFull,
    colGroupbyForQueryFull,
    rowGroupbyForQuery,
    colGroupbyForQuery,
    metrics,
    metricsForQuery,
    metricsLayoutResolved,
    metricInsertIndex,
    sanitizedPath,
    rowDepth,
    colDepth,
    rowSubtotalLevels,
    colSubtotalLevels,
    hasRowFormatting,
    hasColFormatting,
    hasRowTotalSorting,
    hasColTotalSorting,
    timeGrainSqla,
  };
};

export const resolveFetchContextForBatch = resolveFetchContext;
