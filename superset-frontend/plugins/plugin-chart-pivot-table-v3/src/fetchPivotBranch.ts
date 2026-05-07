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
  PivotAxis,
  PivotPath,
  PivotTableQueryFormData,
  PivotTreeData,
} from './types';
import {
  buildFilterSignature,
  buildPivotBranchCacheKey,
  clearPivotBranchCache as clearPivotBranchCacheBase,
  readPivotBranchCache,
  writePivotBranchCache,
} from './pivot/data/cache';
import { type ChartDataWarning } from './pivot/data/ChartDataClient';
import { supersetChartDataClient } from './pivot/data/SupersetChartDataClient';
import {
  buildLayoutContext,
  type LayoutContext,
} from './pivot/layout/LayoutContext';
import {
  resolveFetchContext as resolveFetchContextBase,
  type ResolvedFetchContext as ResolvedQueryFetchContext,
} from './pivot/query/resolveFetchContext';
import { buildBranchQuerySpecs } from './pivot/query/specs';
import { stableStringify as stableStringifyBase } from './pivot/shared/stableStringify';
import { buildBranchTreeFromSpecResults } from './pivot/runtime/ingestQueryResults';

export { buildBranchTreeFromResults } from './pivot/runtime/ingestQueryResults';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
  cached?: boolean;
  warnings?: ChartDataWarning[];
  error?: Error;
}

export interface FetchPivotBranchParams {
  formData: PivotTableQueryFormData;
  axis: PivotAxis;
  path: PivotPath;
  currentTree?: PivotTreeData;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  targetRowDepth?: number;
  targetColDepth?: number;
  requestGroupId?: string;
}

export const stableStringify = stableStringifyBase;

export const peekPivotBranchCacheByKey = (key: string) =>
  readPivotBranchCache(key);
export const clearPivotBranchCache = () => clearPivotBranchCacheBase();

export type ResolvedFetchContext = ResolvedQueryFetchContext & {
  cacheKey: string;
  layout: LayoutContext;
};

const buildMeasureLeafSelectionSignature = (
  measureHierarchy: LayoutContext['measureHierarchy'],
): string => {
  if (measureHierarchy.kind !== 'measureStackV1') {
    return '';
  }
  return measureHierarchy.groups
    .map(group => ({
      metricKey: group.metricKey,
      leafIds: group.leaves.map(leaf => leaf.id).sort(),
    }))
    .sort((left, right) => left.metricKey.localeCompare(right.metricKey))
    .map(group => `${group.metricKey}:${group.leafIds.join(',')}`)
    .join('|');
};

const resolveFetchContext = ({
  formData,
  axis,
  path,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  targetRowDepth,
  targetColDepth,
}: FetchPivotBranchParams): ResolvedFetchContext => {
  const layout = buildLayoutContext(formData);
  const queryCtx = resolveFetchContextBase({
    formData,
    layout,
    axis,
    path,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
    targetRowDepth,
    targetColDepth,
  });
  const filterSignature = buildFilterSignature(formData);
  const cacheKey = buildPivotBranchCacheKey({
    axis,
    path,
    rowDepth: queryCtx.rowDepth,
    colDepth: queryCtx.colDepth,
    rowGroupby: queryCtx.rowGroupbyForQuery,
    colGroupby: queryCtx.colGroupbyForQuery,
    metrics:
      queryCtx.metricsForQuery.length > 0
        ? queryCtx.metricsForQuery
        : queryCtx.materializedMetrics,
    aggregateFunction: formData.aggregateFunction,
    filterSignature,
    cacheMeta: {
      datasource: formData.datasource,
      granularity: formData.granularity,
      granularity_sqla: formData.granularity_sqla,
      rowTotals: formData.rowTotals ?? false,
      colTotals: formData.colTotals ?? false,
      rowSubTotals: formData.rowSubTotals ?? true,
      rowSubtotalLevels: queryCtx.rowSubtotalLevels,
      colSubtotalLevels: queryCtx.colSubtotalLevels,
      metricsLayoutResolved: queryCtx.metricsLayoutResolved,
      metricInsertIndex: queryCtx.metricInsertIndex,
      timeOffsets: queryCtx.requiredTimeOffsets,
      measureLeafSelection: buildMeasureLeafSelectionSignature(
        queryCtx.materializedMeasureHierarchy,
      ),
    },
  });
  return { ...queryCtx, cacheKey, layout };
};

export const peekPivotBranchCache = (params: FetchPivotBranchParams) => {
  const ctx = resolveFetchContext(params);
  return readPivotBranchCache(ctx.cacheKey);
};

// Exported for tests
export const resolveFetchContextForTest = resolveFetchContext;
export const resolveFetchContextForBatch = resolveFetchContext;

const isAbortError = (error: unknown): boolean => {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
};

export async function fetchPivotBranch({
  formData,
  axis,
  path,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const { metricsForQuery, requiredTimeOffsets, cacheKey, layout } =
    resolveFetchContext({
      formData,
      axis,
      path,
      currentTree,
      visibleRowDepth,
      visibleColDepth,
    });
  const treeSnapshot = currentTree ?? { rows: {}, cols: {}, cells: {} };
  const timeOffsets = Array.from(
    new Set([...(formData.time_offsets ?? []), ...requiredTimeOffsets]),
  );
  const queryFormData =
    metricsForQuery.length > 0
      ? {
          ...formData,
          metrics: metricsForQuery,
          ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
        }
      : {
          ...formData,
          ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
        };

  const cached = readPivotBranchCache(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const specs = buildBranchQuerySpecs({
    formData,
    layout,
    axis,
    path,
    currentTree: treeSnapshot,
    visibleRowDepth,
    visibleColDepth,
  });
  if (specs.length === 0) {
    return { data: undefined };
  }

  try {
    const results = await supersetChartDataClient.fetch({
      formData: queryFormData,
      specs,
      requestGroupId,
    });
    const warnings = results.flatMap(result => result.warnings ?? []);
    const labeledBranch = buildBranchTreeFromSpecResults({
      specs,
      results,
      formData,
      measureHierarchy: layout.measureHierarchy,
    });
    writePivotBranchCache(cacheKey, labeledBranch);
    return {
      data: labeledBranch,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
