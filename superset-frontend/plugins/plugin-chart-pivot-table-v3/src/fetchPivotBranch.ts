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
  PivotTableQueryFormData,
  PivotTreeData,
} from './types';
import {
  METRICS_PLACEHOLDER,
  buildTreeFromRecords,
  applyMetricAxis,
  mergeTrees,
  getMetricKeys,
  serializePath,
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
}: FetchPivotBranchParams): ResolvedFetchContext => {
  const rowGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyRows);
  const colGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyColumns);
  const rowGroupby = stripMetricsPlaceholder(rowGroupbyRaw);
  const colGroupby = stripMetricsPlaceholder(colGroupbyRaw);

  const rowPlaceholderIndex = rowGroupbyRaw.indexOf(METRICS_PLACEHOLDER);
  const colPlaceholderIndex = colGroupbyRaw.indexOf(METRICS_PLACEHOLDER);
  const metricsAxis: PivotAxis | undefined =
    rowPlaceholderIndex >= 0
      ? 'row'
      : colPlaceholderIndex >= 0
      ? 'col'
      : formData.metricsLayout === 'ROWS'
      ? 'row'
      : 'col';
  const metricsLayoutResolved =
    metricsAxis === 'row'
      ? MetricsLayoutEnum.ROWS
      : MetricsLayoutEnum.COLUMNS;
  const metrics = ensureIsArray(formData.metrics);
  const metricInsertIndex =
    metricsAxis === 'row'
      ? rowPlaceholderIndex >= 0
        ? Math.min(rowPlaceholderIndex, rowGroupby.length)
        : rowGroupby.length
      : colPlaceholderIndex >= 0
      ? Math.min(colPlaceholderIndex, colGroupby.length)
      : colGroupby.length;

  const normalizePath = (p: PivotPath, targetAxis: PivotAxis) => {
    if (metricsAxis !== targetAxis) {
      return p;
    }
    return [...p.slice(0, metricInsertIndex), ...p.slice(metricInsertIndex + 1)];
  };

  const sanitizedPath = normalizePath(path, axis);
  const defaultIncrement = Math.max(
    formData.maxDepthPerFetch || 0,
    maxDepthPerFetch || 0,
  );
  const depthIncrement =
    defaultIncrement > 0
      ? defaultIncrement
      : Number.MAX_SAFE_INTEGER;

  const rowDepth =
    axis === 'row'
      ? Math.min(rowGroupby.length, sanitizedPath.length + depthIncrement)
      : rowGroupby.length;
  const colDepth =
    axis === 'col'
      ? Math.min(colGroupby.length, sanitizedPath.length + depthIncrement)
      : colGroupby.length;

  const cacheKey = buildCacheKey(
    axis,
    path,
    rowDepth,
    colDepth,
    rowGroupbyRaw,
    colGroupbyRaw,
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

export async function fetchPivotBranch({
  formData,
  axis,
  path,
  maxDepthPerFetch,
  currentTree,
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
  } = resolveFetchContext({ formData, axis, path, maxDepthPerFetch });

  const cached = cache.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const columns = [
    ...rowGroupby.slice(0, rowDepth),
    ...colGroupby.slice(0, colDepth),
  ];

  const filters =
    axis === 'row'
      ? buildPathFilters(rowGroupby, sanitizedPath)
      : buildPathFilters(colGroupby, sanitizedPath);

  const queryContext = buildQueryContext(formData, (baseQueryObject: QueryObject) => [
    {
      ...baseQueryObject,
      columns,
      filters: [
        ...(baseQueryObject.filters || []),
        ...(filters as QueryObjectFilterClause[]),
      ],
      query_name: `${formatQueryName(rowDepth, colDepth)}|branch:${axis}:${serializePath(
        path,
      )}`,
    },
  ]);

  try {
    const { json = {} } = await SupersetClient.post({
      endpoint: '/api/v1/chart/data',
      jsonPayload: queryContext,
    });
    const [result] = (json as any).result || [];
    const branchTree = buildTreeFromRecords(
      result?.data || [],
      formData.metrics,
      rowGroupby,
      colGroupby,
      rowDepth,
      colDepth,
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
