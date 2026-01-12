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
  BinaryQueryObjectFilterClause,
  buildQueryContext,
  ensureIsArray,
  getColumnLabel,
  QueryFormColumn,
  QueryFormMetric,
  QueryObject,
  QueryObjectFilterClause,
  SupersetClient,
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
  collectMetricFormattingMetricsForQuery,
  collectMetricDatabarMetricsForQuery,
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  getMetricKeys,
  mergeMetrics,
  serializePath,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
  normalizeSubtotalLevels,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from './utils';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
  cached?: boolean;
  error?: Error;
}

export interface FetchPivotBranchParams {
  formData: PivotTableQueryFormData;
  axis: PivotAxis;
  path: PivotPath;
  maxDepthPerFetch?: number;
  currentTree?: PivotTreeData;
  visibleRowDepth?: number;
  visibleColDepth?: number;
}

const cache = new Map<string, PivotTreeData>();

const stableStringify = (value: unknown): string => {
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
): PivotTableQueryFormData['extra_form_data'] | undefined => {
  if (formData.extra_form_data) {
    return formData.extra_form_data;
  }
  const candidate = (
    formData as PivotTableQueryFormData & {
      extraFormData?: PivotTableQueryFormData['extra_form_data'];
    }
  ).extraFormData;
  return candidate;
};

const getTimeRange = (formData: PivotTableQueryFormData) => {
  if (formData.time_range) {
    return formData.time_range;
  }
  const candidate = (
    formData as PivotTableQueryFormData & { timeRange?: string }
  ).timeRange;
  return candidate;
};

const buildFilterKey = (formData: PivotTableQueryFormData) =>
  stableStringify({
    time_range: getTimeRange(formData),
    since: formData.since,
    until: formData.until,
    filters: formData.filters,
    adhoc_filters: formData.adhoc_filters,
    extra_filters: formData.extra_filters,
    extra_form_data: getExtraFormData(formData),
  });

const buildCacheKey = (
  axis: PivotAxis,
  path: PivotPath,
  rowDepth: number,
  colDepth: number,
  rowGroupbyRaw: QueryFormColumn[],
  colGroupbyRaw: QueryFormColumn[],
  metrics: QueryFormMetric[],
  aggregateFunction?: string,
  filterKey?: string,
) =>
  [
    axis,
    serializePath(path),
    rowDepth,
    colDepth,
    serializePath(rowGroupbyRaw.map(getColumnLabel)),
    serializePath(colGroupbyRaw.map(getColumnLabel)),
    serializePath(getMetricKeys(metrics)),
    aggregateFunction || '',
    filterKey || '',
  ].join('|');

export const peekPivotBranchCacheByKey = (key: string) => cache.get(key);
export const clearPivotBranchCache = () => cache.clear();

const buildPathFilters = (
  groupby: QueryFormColumn[],
  path: PivotPath,
): BinaryQueryObjectFilterClause[] =>
  path.map((value, index) => ({
    col: getColumnLabel(groupby[index]),
    op: value === null || value === undefined ? 'IS NULL' : ('==' as const),
    val: value === null || value === undefined ? null : value,
  }));

interface ResolvedFetchContext {
  rowGroupbyRaw: QueryFormColumn[];
  colGroupbyRaw: QueryFormColumn[];
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
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
  hasRowSorting: boolean;
  hasColSorting: boolean;
}

const resolveFetchContext = ({
  formData,
  axis,
  path,
  maxDepthPerFetch,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
}: FetchPivotBranchParams): ResolvedFetchContext => {
  const rowGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyRows);
  const colGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyColumns);
  const metrics = ensureIsArray(formData.metrics);
  const metricFormattingMetrics = collectMetricFormattingMetricsForQuery(
    formData.metricFormatting,
    metrics,
  );
  const metricDatabarMetrics = collectMetricDatabarMetricsForQuery(
    formData.metricDatabars,
    metrics,
  );
  const rowFormattingMetrics = collectDimensionFormattingMetricsForQuery(
    formData.rowFormatting,
    rowGroupbyRaw,
    metrics,
  );
  const colFormattingMetrics = collectDimensionFormattingMetricsForQuery(
    formData.colFormatting,
    colGroupbyRaw,
    metrics,
  );
  const rowSortingMetrics = collectDimensionSortingMetricsForQuery(
    formData.rowSorting,
    rowGroupbyRaw,
    metrics,
  );
  const colSortingMetrics = collectDimensionSortingMetricsForQuery(
    formData.colSorting,
    colGroupbyRaw,
    metrics,
  );
  const formattingMetrics = [
    ...metricFormattingMetrics,
    ...metricDatabarMetrics,
    ...rowFormattingMetrics,
    ...colFormattingMetrics,
    ...rowSortingMetrics,
    ...colSortingMetrics,
  ];
  const metricsForQuery = mergeMetrics(metrics, formattingMetrics);
  const metricLabels = getMetricKeys(metrics);
  const metricLabelSet = new Set(metricLabels);
  const placement = resolveMetricPlacement(rowGroupbyRaw, colGroupbyRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  let rowGroupby = stripMetricsPlaceholder(placement.rows);
  let colGroupby = stripMetricsPlaceholder(placement.cols);
  const metricsLayoutResolved = placement.layout;
  const metricsAxis: PivotAxis =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS ? 'row' : 'col';
  const metricInsertIndexBase =
    placement.metricPosition >= 0
      ? placement.metricPosition
      : metricsAxis === 'row'
      ? rowGroupby.length
      : colGroupby.length;
  const metricIndexInPath =
    metricsAxis === axis
      ? path.findIndex(val => metricLabelSet.has(String(val ?? '')))
      : -1;
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

  const rowSubTotalsEnabled = formData.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(rowGroupby.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    formData.rowSubtotalLevels,
    maxRowSubtotalDepth,
    formData.rowTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(colGroupby.length - 1, 0);
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

  const metricInsertIndex =
    (shouldCollapseRowDims || shouldCollapseColDims) && metricIndexInPath >= 0
      ? metricIndexInPath
      : metricInsertIndexBase;

  const stripMetricFromPath = (p: PivotPath, targetAxis: PivotAxis) => {
    if (metricsAxis !== targetAxis) {
      return p;
    }
    const idx = p.findIndex(val => metricLabelSet.has(String(val ?? '')));
    if (idx < 0) {
      return p;
    }
    return [...p.slice(0, idx), ...p.slice(idx + 1)];
  };

  const sanitizedPath = stripMetricFromPath(path, axis);
  const defaultIncrement = Math.max(
    formData.maxDepthPerFetch || 0,
    maxDepthPerFetch || 0,
  );
  const depthIncrement =
    defaultIncrement > 0
      ? defaultIncrement
      : Number.MAX_SAFE_INTEGER;

  const getCurrentDepth = (
    nodes: Record<string, PivotTreeNode> | undefined,
    targetAxis: PivotAxis,
  ) =>
    Math.max(
      0,
      ...Object.values(nodes || {}).map(node =>
        stripMetricFromPath(node.path, targetAxis).length,
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
  const cacheKey = buildCacheKey(
    axis,
    path,
    rowDepth,
    colDepth,
    rowGroupby,
    colGroupby,
    metricsForQuery.length > 0 ? metricsForQuery : metrics,
    formData.aggregateFunction,
    filterKey,
  );

  return {
    rowGroupbyRaw,
    colGroupbyRaw,
    rowGroupby,
    colGroupby,
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
    hasRowFormatting: rowFormattingMetrics.length > 0,
    hasColFormatting: colFormattingMetrics.length > 0,
    hasRowSorting: rowSortingMetrics.length > 0,
    hasColSorting: colSortingMetrics.length > 0,
  };
};

export const peekPivotBranchCache = (params: FetchPivotBranchParams) => {
  const ctx = resolveFetchContext(params);
  return cache.get(ctx.cacheKey);
};

// Exported for tests
export const resolveFetchContextForTest = resolveFetchContext;

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
    if (!baseColPath || baseColPath.length !== depth || baseColPath.length === 0) {
      return;
    }
    const subtotalColKey = serializePath([...baseColPath, SUBTOTAL_TOKEN]);
    const cellKey = `${cell.rowKey}|${subtotalColKey}`;
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
  maxDepthPerFetch,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const {
    rowGroupby,
    colGroupby,
    rowGroupbyRaw,
    colGroupbyRaw,
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
    hasRowSorting,
    hasColSorting,
  } = resolveFetchContext({
    formData,
    axis,
    path,
    maxDepthPerFetch,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });
  const queryFormData =
    metricsForQuery.length > 0
      ? { ...formData, metrics: metricsForQuery }
      : formData;

  const cached = cache.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

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
    for (let depth = 1; depth <= colDepth; depth += 1) {
      addDepthPair(rowDepth, depth);
      if (rowDepth > 0) {
        addDepthPair(Math.max(rowDepth - 1, 0), depth);
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
    axis === 'col' && (hasColFormatting || hasColSorting);
  const includeColTotalForRowFormatting =
    axis === 'row' && (hasRowFormatting || hasRowSorting);
  const effectiveRowLevels = Array.from(
    new Set([
      ...rowSubtotalLevels,
      ...(includeRowTotalForColFormatting ? [0] : []),
    ]),
  ).filter(level => level <= rowDepth);
  const effectiveColLevels = Array.from(
    new Set([
      ...colSubtotalLevels,
      ...(formData.colTotals ? [0] : []),
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
    sanitizedPath.length,
  );
  const hasRowTotals = formData.rowTotals || rowSubtotalLevels.includes(0);
  const hasColTotals = formData.colTotals;
  const shouldIncludeGrandTotalPair =
    (rowGroupby.length === 0 && colGroupby.length === 0) ||
    (hasRowTotals && hasColTotals) ||
    (metricsLayoutResolved === MetricsLayoutEnum.ROWS &&
      metricInsertIndex === 0 &&
      hasColTotals) ||
    (metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
      metricInsertIndex === 0 &&
      hasRowTotals);
  const filteredQueryPairs = shouldIncludeGrandTotalPair
    ? queryPairs
    : queryPairs.filter(pair => !(pair.rowDepth === 0 && pair.colDepth === 0));

  const filters =
    axis === 'row'
      ? buildPathFilters(rowGroupby, sanitizedPath)
      : buildPathFilters(colGroupby, sanitizedPath);

  const queryContext = buildQueryContext(
    queryFormData,
    (baseQueryObject: QueryObject) =>
      filteredQueryPairs.map(pair => ({
        ...baseQueryObject,
        columns: [
          ...rowGroupby.slice(0, pair.rowDepth),
          ...colGroupby.slice(0, pair.colDepth),
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
    const branchTree = filteredQueryPairs.reduce<PivotTreeData>(
      (acc, pair, idx) =>
        mergeTrees(
          acc,
          (() => {
            let tree = buildTreeFromRecords(
              results[idx]?.data || [],
              metricsForQuery.length > 0 ? metricsForQuery : formData.metrics,
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
    const labeledBranch = labelRowSubtotalLeaves(
      branchWithMetrics,
      ensureIsArray(formData.metrics),
    );
    const merged = mergeTrees(currentTree, labeledBranch);
    cache.set(cacheKey, merged);
    return { data: merged };
  } catch (error) {
    return { error: error as Error };
  }
}
