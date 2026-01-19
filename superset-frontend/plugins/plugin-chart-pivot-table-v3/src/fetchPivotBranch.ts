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
  BinaryQueryObjectFilterClause,
  buildQueryContext,
  ensureIsArray,
  getColumnLabel,
  isPhysicalColumn,
  QueryFormColumn,
  QueryFormMetric,
  QueryObject,
  QueryObjectFilterClause,
  SupersetClient,
  UnaryQueryObjectFilterClause,
} from '@superset-ui/core';
import { formatQueryName } from './buildQuery';
import {
  MetricsLayoutEnum,
  PivotAxis,
  PivotPath,
  PivotTreeNode,
  PivotTableQueryFormData,
  PivotTreeData,
} from './types';
import {
  buildTreeFromRecords,
  applyMetricAxis,
  mergeTrees,
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  getMetricKeys,
  serializePath,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
  normalizeSubtotalLevels,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  decodeMetricKey,
  serializeCellKey,
  hasTotalSorting,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from './utils';
import { buildQueryShape } from './pivot/engine/query/queryShape';
import { type QueryIntent } from './pivot/engine/query/queryIntent';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
  cached?: boolean;
  error?: Error;
}

export interface FetchPivotBranchParams {
  formData: PivotTableQueryFormData;
  axis: PivotAxis;
  path: PivotPath;
  metricPath?: PivotPath;
  currentTree?: PivotTreeData;
  visibleRowDepth?: number;
  visibleColDepth?: number;
}

const cache = new Map<string, PivotTreeData>();
const CACHE_MAX_ENTRIES = 200;

const touchCache = (key: string, value: PivotTreeData) => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
};

const readCache = (key: string) => {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }
  touchCache(key, cached);
  return cached;
};

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'undefined' : serialized;
};

const getExtraFormData = (
  formData: PivotTableQueryFormData,
): PivotTableQueryFormData['extra_form_data'] | undefined =>
  formData.extra_form_data;

const getTimeRange = (formData: PivotTableQueryFormData) => formData.time_range;

const buildFilterKey = (formData: PivotTableQueryFormData) =>
  stableStringify({
    time_range: getTimeRange(formData),
    since: formData.since,
    until: formData.until,
    filters: formData.filters,
    adhoc_filters: formData.adhoc_filters,
    extra_filters: formData.extra_filters,
    extra_form_data: getExtraFormData(formData),
    time_grain_sqla: getExtraFormData(formData)?.time_grain_sqla,
    granularity: formData.granularity,
    granularity_sqla: formData.granularity_sqla,
    row_limit: formData.row_limit,
    row_offset: formData.row_offset,
    series_limit: formData.series_limit,
    series_limit_metric: formData.series_limit_metric,
    order_desc: formData.order_desc,
    row_order: formData.rowOrder,
    col_order: formData.colOrder,
    post_processing: formData.post_processing,
  });

const buildCacheKey = (
  axis: PivotAxis,
  path: PivotPath,
  rowDepth: number,
  colDepth: number,
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  metrics: QueryFormMetric[],
  aggregateFunction?: string,
  filterKey?: string,
  cacheMeta?: Record<string, unknown>,
) =>
  stableStringify({
    axis,
    path: serializePath(path),
    rowDepth,
    colDepth,
    rowGroupby: rowGroupby.map(getColumnLabel),
    colGroupby: colGroupby.map(getColumnLabel),
    metrics: getMetricKeys(metrics),
    aggregateFunction: aggregateFunction || '',
    filterKey: filterKey || '',
    ...(cacheMeta || {}),
  });

export const peekPivotBranchCacheByKey = (key: string) => readCache(key);
export const clearPivotBranchCache = () => cache.clear();

const buildPathFilters = (
  groupby: QueryFormColumn[],
  path: PivotPath,
): QueryObjectFilterClause[] =>
  path.map((value, index) => {
    if (value === null || value === undefined) {
      return {
        col: getColumnLabel(groupby[index]),
        op: 'IS NULL',
      } as UnaryQueryObjectFilterClause;
    }
    return {
      col: getColumnLabel(groupby[index]),
      op: '==',
      val: value,
    } as BinaryQueryObjectFilterClause;
  });

export interface ResolvedFetchContext {
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
  cacheKey: string;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  hasRowFormatting: boolean;
  hasColFormatting: boolean;
  hasRowTotalSorting: boolean;
  hasColTotalSorting: boolean;
  timeGrainSqla?: string;
}

const resolveFetchContext = ({
  formData,
  axis,
  path,
  metricPath,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
}: FetchPivotBranchParams): ResolvedFetchContext => {
  const rowGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyRows);
  const colGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyColumns);
  const metrics = ensureIsArray(formData.metrics);
  const metricLabels = getMetricKeys(metrics);
  const metricLabelSet = new Set(metricLabels);
  const extraFormData = getExtraFormData(formData);
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
  const placement = resolveMetricPlacement(rowGroupbyRaw, colGroupbyRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  let rowGroupby = stripMetricsPlaceholder(placement.rows);
  let colGroupby = stripMetricsPlaceholder(placement.cols);
  const metricsLayoutResolved = placement.layout;
  const metricsAxis: PivotAxis =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS ? 'row' : 'col';
  const pathForMetrics = metricPath ?? path;
  const metricInsertIndexBase =
    placement.metricPosition >= 0
      ? placement.metricPosition
      : metricsAxis === 'row'
        ? rowGroupby.length
        : colGroupby.length;
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

  const rowSubTotalsEnabled = formData.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(rowGroupby.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    formData.rowSubtotalLevels,
    maxRowSubtotalDepth,
    formData.colTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(colGroupby.length - 1, 0);
  const colSubtotalLevelsRaw = ensureIsArray<number>(
    formData.colSubtotalLevels,
  );
  const colSubtotalLevels = normalizeSubtotalLevels(
    colSubtotalLevelsRaw,
    maxColSubtotalDepth,
    false,
    false,
  ).filter(level => level > 0);

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
      return p;
    }
    const idx =
      metricIndexOverride !== undefined
        ? metricIndexOverride
        : getMetricIndex(p);
    if (idx < 0) {
      return p;
    }
    return [...p.slice(0, idx), ...p.slice(idx + 1)];
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

  const rowDepth =
    axis === 'row'
      ? Math.min(rowGroupby.length, sanitizedPath.length + depthIncrement)
      : Math.min(rowGroupby.length, currentRowDepth);
  const colDepth =
    axis === 'col'
      ? Math.min(colGroupby.length, sanitizedPath.length + depthIncrement)
      : Math.min(colGroupby.length, currentColDepth);

  const filterKey = buildFilterKey(formData);
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
  });
  const rowGroupbyForQuery = queryShape.rowGroupby;
  const colGroupbyForQuery = queryShape.colGroupby;
  const metricsForQuery = queryShape.metrics;
  const cacheKey = buildCacheKey(
    axis,
    pathForMetrics,
    rowDepth,
    colDepth,
    rowGroupbyForQuery,
    colGroupbyForQuery,
    metricsForQuery.length > 0 ? metricsForQuery : metrics,
    formData.aggregateFunction,
    filterKey,
    {
      datasource: formData.datasource,
      time_grain_sqla: timeGrainSqla,
      granularity: formData.granularity,
      granularity_sqla: formData.granularity_sqla,
      rowTotals: formData.rowTotals,
      colTotals: formData.colTotals,
      rowSubTotals: formData.rowSubTotals,
      rowSubtotalLevels,
      colSubtotalLevels,
      metricsLayoutResolved,
      metricInsertIndex,
    },
  );

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
    cacheKey,
    rowSubtotalLevels,
    colSubtotalLevels,
    hasRowFormatting,
    hasColFormatting,
    hasRowTotalSorting,
    hasColTotalSorting,
    timeGrainSqla,
  };
};

export const peekPivotBranchCache = (params: FetchPivotBranchParams) => {
  const ctx = resolveFetchContext(params);
  return readCache(ctx.cacheKey);
};

// Exported for tests
export const resolveFetchContextForTest = resolveFetchContext;
export const resolveFetchContextForBatch = resolveFetchContext;

export const buildBranchQueryPairs = ({
  axis,
  pathLength,
  rowDepth,
  colDepth,
  rowGroupby,
  colGroupby,
  rowSubtotalLevels,
  colSubtotalLevels,
  hasRowFormatting,
  hasColFormatting,
  hasRowTotalSorting,
  hasColTotalSorting,
  metricsLayoutResolved,
  metricInsertIndex,
  formData,
}: {
  axis: PivotAxis;
  pathLength: number;
  rowDepth: number;
  colDepth: number;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  hasRowFormatting: boolean;
  hasColFormatting: boolean;
  hasRowTotalSorting: boolean;
  hasColTotalSorting: boolean;
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
  formData: PivotTableQueryFormData;
}) => {
  const depthPairs: Array<{ rowDepth: number; colDepth: number }> = [];
  const addDepthPair = (rowDepthVal: number, colDepthVal: number) => {
    const key = `${rowDepthVal}|${colDepthVal}`;
    if (depthPairs.find(pair => `${pair.rowDepth}|${pair.colDepth}` === key)) {
      return;
    }
    depthPairs.push({ rowDepth: rowDepthVal, colDepth: colDepthVal });
  };
  addDepthPair(rowDepth, colDepth);

  const needsMetricFrontRoot =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS &&
    metricInsertIndex === 0 &&
    axis === 'col' &&
    rowDepth > 0;
  if (needsMetricFrontRoot) {
    addDepthPair(0, colDepth);
  }
  const needsMetricFrontColumnRootForRows =
    metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndex === 0 &&
    axis === 'row' &&
    colDepth > 0;
  if (needsMetricFrontColumnRootForRows) {
    addDepthPair(rowDepth, 0);
  }
  if (axis === 'col' && rowDepth > 0 && colDepth > 0) {
    addDepthPair(Math.max(rowDepth - 1, 0), colDepth);
  }
  if (axis === 'col' && colDepth > 0 && rowDepth > 0) {
    const colParentDepth = Math.max(colDepth - 1, 0);
    for (let depth = 1; depth <= rowDepth; depth += 1) {
      addDepthPair(depth, colDepth);
      if (colParentDepth !== colDepth) {
        addDepthPair(depth, colParentDepth);
      }
    }
  }
  if (axis === 'row' && colDepth > 0) {
    const rowParentDepth = Math.max(rowDepth - 1, 0);
    for (let depth = 1; depth <= colDepth; depth += 1) {
      addDepthPair(rowDepth, depth);
      if (rowDepth > 0) {
        addDepthPair(rowParentDepth, depth);
      }
    }
  }
  if (metricsLayoutResolved === MetricsLayoutEnum.COLUMNS && colDepth > 0) {
    const colParentDepth = Math.max(colDepth - 1, 0);
    if (axis === 'col') {
      addDepthPair(rowDepth, colParentDepth);
      if (rowDepth > 0) {
        addDepthPair(Math.max(rowDepth - 1, 0), colDepth);
        addDepthPair(Math.max(rowDepth - 1, 0), colParentDepth);
      }
    } else if (axis === 'row') {
      addDepthPair(rowDepth, colParentDepth);
      if (rowDepth > 0) {
        addDepthPair(Math.max(rowDepth - 1, 0), colDepth);
        addDepthPair(Math.max(rowDepth - 1, 0), colParentDepth);
      }
    }
  }

  const includeRowTotalForColFormatting =
    axis === 'col' && (hasColFormatting || hasColTotalSorting);
  const includeColTotalForRowFormatting =
    axis === 'row' && (hasRowFormatting || hasRowTotalSorting);
  const effectiveRowLevels = Array.from(
    new Set([
      ...rowSubtotalLevels,
      ...(includeRowTotalForColFormatting ? [0] : []),
    ]),
  ).filter(level => level <= rowDepth);
  const effectiveColLevels = Array.from(
    new Set([
      ...colSubtotalLevels,
      ...(formData.rowTotals ? [0] : []),
      ...(includeColTotalForRowFormatting ? [0] : []),
    ]),
  ).filter(level => level <= colDepth);
  const subtotalRowDepths = new Set<number>([rowDepth, ...effectiveRowLevels]);
  const subtotalColDepths = new Set<number>([colDepth, ...effectiveColLevels]);
  subtotalRowDepths.forEach(rowDepthVal => {
    subtotalColDepths.forEach(colDepthVal =>
      addDepthPair(rowDepthVal, colDepthVal),
    );
  });
  const queryPairs = filterDepthPairsForAxis(
    depthPairs,
    axis,
    pathLength,
  );
  const hasTotalRow = formData.colTotals || rowSubtotalLevels.includes(0);
  const hasTotalColumn = formData.rowTotals || colSubtotalLevels.includes(0);
  const shouldIncludeGrandTotalPair =
    (rowGroupby.length === 0 && colGroupby.length === 0) ||
    (hasTotalRow && hasTotalColumn) ||
    (metricsLayoutResolved === MetricsLayoutEnum.ROWS &&
      metricInsertIndex === 0 &&
      hasTotalColumn) ||
    (metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
      metricInsertIndex === 0 &&
      hasTotalRow);
  return shouldIncludeGrandTotalPair
    ? queryPairs
    : queryPairs.filter(pair => !(pair.rowDepth === 0 && pair.colDepth === 0));
};

export const buildBranchTreeFromResults = ({
  results,
  queryPairs,
  metricsForQuery,
  formData,
  rowGroupby,
  colGroupby,
  rowSubtotalLevels,
  colSubtotalLevels,
  metricsLayoutResolved,
  metricInsertIndex,
}: {
  results: Array<{ data?: Record<string, unknown>[] }>;
  queryPairs: Array<{ rowDepth: number; colDepth: number }>;
  metricsForQuery: QueryFormMetric[];
  formData: PivotTableQueryFormData;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
}): PivotTreeData => {
  const queryMetrics =
    metricsForQuery.length > 0 ? metricsForQuery : formData.metrics;
  const branchTree = queryPairs.reduce<PivotTreeData>(
    (acc, pair, idx) =>
      mergeTrees(
        acc,
        (() => {
          let tree = buildTreeFromRecords(
            results[idx]?.data || [],
            queryMetrics,
            rowGroupby,
            colGroupby,
            pair.rowDepth,
            pair.colDepth,
          );
          if (colSubtotalLevels.includes(pair.colDepth)) {
            tree = injectColumnSubtotalLeaves(
              tree,
              pair.colDepth,
              colGroupby.length,
            );
          }
          const rowSubtotalDepths = rowSubtotalLevels.filter(
            level => level > 0 && level <= pair.rowDepth,
          );
          rowSubtotalDepths.forEach(depth => {
            tree = injectRowSubtotalLeaves(tree, depth, rowGroupby.length);
          });
          return tree;
        })(),
      ),
    {} as PivotTreeData,
  );
  const branchWithMetrics = applyMetricAxis(
    branchTree,
    ensureIsArray(formData.metrics),
    metricsLayoutResolved,
    rowGroupby,
    colGroupby,
    metricInsertIndex,
  );
  return labelRowSubtotalLeaves(
    branchWithMetrics,
    ensureIsArray(formData.metrics),
  );
};

const filterDepthPairsForAxis = (
  pairs: Array<{ rowDepth: number; colDepth: number }>,
  axis: PivotAxis,
  pathLength: number,
) => {
  if (pathLength === 0) {
    return pairs;
  }
  return pairs.filter(pair =>
    axis === 'row' ? pair.rowDepth >= pathLength : pair.colDepth >= pathLength,
  );
};

const injectColumnSubtotalLeaves = (
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) => {
  if (depth <= 0 || depth >= fullDepth) {
    return tree;
  }
  const next: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };
  const subtotalNodes = Object.values(tree.cols).filter(
    node => node.path.length === depth && node.path.length > 0,
  );
  subtotalNodes.forEach(node => {
    const subtotalPath = [...node.path, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    if (!next.cols[subtotalKey]) {
      next.cols[subtotalKey] = {
        ...node,
        key: subtotalKey,
        path: subtotalPath,
        label: SUBTOTAL_LABEL,
        formattedLabel: SUBTOTAL_LABEL,
        level: subtotalPath.length,
        hasChildren: subtotalPath.length < fullDepth,
        isSubtotal: true,
      };
    }
  });
  Object.values(tree.cells).forEach(cell => {
    const baseColPath = tree.cols[cell.colKey]?.path;
    if (
      !baseColPath ||
      baseColPath.length !== depth ||
      baseColPath.length === 0
    ) {
      return;
    }
    const subtotalColKey = serializePath([...baseColPath, SUBTOTAL_TOKEN]);
    const cellKey = serializeCellKey(cell.rowKey, subtotalColKey);
    next.cells[cellKey] = {
      ...cell,
      colKey: subtotalColKey,
      isSubtotal: true,
    };
  });
  return next;
};

export async function fetchPivotBranch({
  formData,
  axis,
  path,
  metricPath,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const {
    rowGroupby,
    colGroupby,
    rowGroupbyForQuery,
    colGroupbyForQuery,
    rowGroupbyForQueryFull,
    colGroupbyForQueryFull,
    metricsForQuery,
    metricsLayoutResolved,
    metricInsertIndex,
    sanitizedPath,
    rowDepth,
    colDepth,
    cacheKey,
    rowSubtotalLevels,
    colSubtotalLevels,
    hasRowFormatting,
    hasColFormatting,
    hasRowTotalSorting,
    hasColTotalSorting,
  } = resolveFetchContext({
    formData,
    axis,
    path,
    metricPath,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });
  const queryFormData =
    metricsForQuery.length > 0
      ? { ...formData, metrics: metricsForQuery }
      : formData;

  const cached = readCache(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const filteredQueryPairs = buildBranchQueryPairs({
    axis,
    pathLength: sanitizedPath.length,
    rowDepth,
    colDepth,
    rowGroupby,
    colGroupby,
    rowSubtotalLevels,
    colSubtotalLevels,
    hasRowFormatting,
    hasColFormatting,
    hasRowTotalSorting,
    hasColTotalSorting,
    metricsLayoutResolved,
    metricInsertIndex,
    formData,
  });

  const filters =
    axis === 'row'
      ? buildPathFilters(rowGroupbyForQuery, sanitizedPath)
      : buildPathFilters(colGroupbyForQuery, sanitizedPath);

  const queryContext = buildQueryContext(
    queryFormData,
    (baseQueryObject: QueryObject) =>
      filteredQueryPairs.map(pair => ({
        ...baseQueryObject,
        columns: [
          ...rowGroupbyForQuery.slice(0, pair.rowDepth),
          ...colGroupbyForQuery.slice(0, pair.colDepth),
        ],
        filters: [
          ...(baseQueryObject.filters || []),
          ...(filters as QueryObjectFilterClause[]),
        ],
        query_name: `${formatQueryName(pair.rowDepth, pair.colDepth)}|branch:${axis}:${serializePath(
          path,
        )}`,
      })),
  );

  try {
    const { json = {} } = await SupersetClient.post({
      endpoint: '/api/v1/chart/data',
      jsonPayload: queryContext,
    });
    const results = ((json as any).result || []) as any[];
    const labeledBranch = buildBranchTreeFromResults({
      results,
      queryPairs: filteredQueryPairs,
      metricsForQuery,
      formData,
      rowGroupby: rowGroupbyForQueryFull,
      colGroupby: colGroupbyForQueryFull,
      rowSubtotalLevels,
      colSubtotalLevels,
      metricsLayoutResolved,
      metricInsertIndex,
    });
    touchCache(cacheKey, labeledBranch);
    return { data: labeledBranch };
  } catch (error) {
    return { error: error as Error };
  }
}
