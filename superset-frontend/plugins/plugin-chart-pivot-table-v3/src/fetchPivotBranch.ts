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
  const placement = resolveMetricPlacement(rowGroupbyRaw, colGroupbyRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  const rowGroupby = stripMetricsPlaceholder(placement.rows);
  const colGroupby = stripMetricsPlaceholder(placement.cols);
  const metricsLayoutResolved = placement.layout;
  const metricsAxis: PivotAxis =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS ? 'row' : 'col';
  const metricInsertIndex =
    placement.metricPosition >= 0
      ? placement.metricPosition
      : metricsAxis === 'row'
      ? rowGroupby.length
      : colGroupby.length;

  const stripMetricFromPath = (p: PivotPath, targetAxis: PivotAxis) => {
    if (metricsAxis !== targetAxis || placement.metricPosition < 0) {
      return p;
    }
    return [...p.slice(0, metricInsertIndex), ...p.slice(metricInsertIndex + 1)];
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
    placement.rows,
    placement.cols,
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
  };
};

export const peekPivotBranchCache = (params: FetchPivotBranchParams) => {
  const ctx = resolveFetchContext(params);
  return cache.get(ctx.cacheKey);
};

// Exported for tests
export const resolveFetchContextForTest = resolveFetchContext;

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

  const depthPairs: Array<{ rowDepth: number; colDepth: number }> = [
    { rowDepth, colDepth },
  ];

  const needsMetricFrontRoot =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS &&
    metricInsertIndex === 0 &&
    axis === 'col' &&
    rowDepth > 0;
  if (needsMetricFrontRoot) {
    depthPairs.push({ rowDepth: 0, colDepth });
  }
  const needsMetricFrontColumnRootForRows =
    metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndex === 0 &&
    axis === 'row' &&
    colDepth > 0;
  if (needsMetricFrontColumnRootForRows) {
    depthPairs.push({ rowDepth, colDepth: 0 });
  }

  const filters =
    axis === 'row'
      ? buildPathFilters(rowGroupby, sanitizedPath)
      : buildPathFilters(colGroupby, sanitizedPath);

  const queryContext = buildQueryContext(
    formData,
    (baseQueryObject: QueryObject) =>
      depthPairs.map(pair => ({
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
    const branchTree = depthPairs.reduce<PivotTreeData>(
      (acc, pair, idx) =>
        mergeTrees(
          acc,
          buildTreeFromRecords(
            results[idx]?.data || [],
            formData.metrics,
            rowGroupby,
            colGroupby,
            pair.rowDepth,
            pair.colDepth,
          ),
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
    const merged = mergeTrees(currentTree, branchWithMetrics);
    cache.set(cacheKey, merged);
    return { data: merged };
  } catch (error) {
    return { error: error as Error };
  }
}
