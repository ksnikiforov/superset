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
  getMetricKeys,
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

const buildCacheKey = (
  axis: PivotAxis,
  path: PivotPath,
  rowDepth: number,
  colDepth: number,
  rowGroupbyRaw: QueryFormColumn[],
  colGroupbyRaw: QueryFormColumn[],
  metrics: QueryFormMetric[],
  aggregateFunction?: string,
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
  ].join('|');

export const peekPivotBranchCacheByKey = (key: string) => cache.get(key);

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
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
  sanitizedPath: PivotPath;
  rowDepth: number;
  colDepth: number;
  cacheKey: string;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
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

  const cacheKey = buildCacheKey(
    axis,
    path,
    rowDepth,
    colDepth,
    rowGroupby,
    colGroupby,
    metrics,
    formData.aggregateFunction,
  );

  return {
    rowGroupbyRaw,
    colGroupbyRaw,
    rowGroupby,
    colGroupby,
    metrics,
    metricsLayoutResolved,
    metricInsertIndex,
    sanitizedPath,
    rowDepth,
    colDepth,
    cacheKey,
    rowSubtotalLevels,
    colSubtotalLevels,
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
    metricsLayoutResolved,
    metricInsertIndex,
    sanitizedPath,
    rowDepth,
    colDepth,
    cacheKey,
    rowSubtotalLevels,
    colSubtotalLevels,
  } = resolveFetchContext({
    formData,
    axis,
    path,
    maxDepthPerFetch,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });

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
  const effectiveRowLevels = Array.from(new Set(rowSubtotalLevels)).filter(
    level => level <= rowDepth,
  );
  const effectiveColLevels = Array.from(
    new Set([
      ...colSubtotalLevels,
      ...(formData.colTotals ? [0] : []),
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

  const filters =
    axis === 'row'
      ? buildPathFilters(rowGroupby, sanitizedPath)
      : buildPathFilters(colGroupby, sanitizedPath);

  const queryContext = buildQueryContext(
    formData,
    (baseQueryObject: QueryObject) =>
      queryPairs.map(pair => ({
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
    const branchTree = queryPairs.reduce<PivotTreeData>(
      (acc, pair, idx) =>
        mergeTrees(
          acc,
          (() => {
            let tree = buildTreeFromRecords(
              results[idx]?.data || [],
              formData.metrics,
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
