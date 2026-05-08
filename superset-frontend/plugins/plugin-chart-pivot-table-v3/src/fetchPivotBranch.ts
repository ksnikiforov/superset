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
  readPivotBranchFactCache,
  writePivotBranchFactCache,
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
import { buildFactCoverage } from './pivot/runtime/coverage';
import {
  buildFactStoreBatchesFromSpecs,
  buildBranchTreeFromFactStore,
  canMaterializeSpecsFromFactStore,
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
  upsertQueryResultsIntoFactStore,
} from './pivot/runtime/ingestQueryResults';
import { appendLoadedBranchCoverageMarkers } from './pivot/runtime/loadedBranchCoverage';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
  cached?: boolean;
  factStoreHit?: boolean;
  factBatches: PivotFactStoreBatch[];
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
  factStore?: PivotFactStore;
}

export const stableStringify = stableStringifyBase;

export const clearPivotBranchCache = () => clearPivotBranchCacheBase();

export type ResolvedFetchContext = ResolvedQueryFetchContext & {
  cacheKey: string;
  layout: LayoutContext;
};

type ResolvedBranchPlan = {
  ctx: ResolvedFetchContext;
  treeSnapshot: PivotTreeData;
  specs: ReturnType<typeof buildBranchQuerySpecs>;
};

const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

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
      metricsLayoutResolved: layout.metricsLayoutResolved,
      metricInsertIndex: layout.metricInsertIndex,
      timeOffsets: queryCtx.requiredTimeOffsets,
      measureLeafSelection: buildMeasureLeafSelectionSignature(
        queryCtx.materializedMeasureHierarchy,
      ),
    },
  });
  return { ...queryCtx, cacheKey, layout };
};

const resolveBranchPlan = (
  params: FetchPivotBranchParams,
): ResolvedBranchPlan => {
  const ctx = resolveFetchContext(params);
  const treeSnapshot = params.currentTree ?? { rows: {}, cols: {}, cells: {} };
  const specs = buildBranchQuerySpecs({
    formData: params.formData,
    layout: ctx.layout,
    axis: params.axis,
    path: params.path,
    currentTree: treeSnapshot,
    visibleRowDepth: params.visibleRowDepth,
    visibleColDepth: params.visibleColDepth,
  });
  return { ctx, treeSnapshot, specs };
};

const resolvePivotBranchLocalResultFromPlan = (
  params: FetchPivotBranchParams,
  { ctx, specs }: ResolvedBranchPlan,
): FetchPivotBranchResult | undefined => {
  if (specs.length === 0) {
    const batch: PivotFactStoreBatch = {
      coverage: buildFactCoverage({
        reason: 'expand',
        rowDimensions: ctx.layout.pivotProgram.rowDimensions,
        columnDimensions: ctx.layout.pivotProgram.columnDimensions,
        rowDepth: params.visibleRowDepth ?? ctx.rowDepth,
        columnDepth: params.visibleColDepth ?? ctx.colDepth,
      }),
      scope: {
        kind: 'branch',
        axis: params.axis,
        path: params.path,
      },
      facts: [],
    };
    params.factStore?.upsertBatch(batch);
    return { data: undefined, factBatches: [batch] };
  }
  if (
    params.factStore &&
    canMaterializeSpecsFromFactStore({
      specs,
      store: params.factStore,
    })
  ) {
    const factBatches = buildFactStoreBatchesFromSpecs({
      specs,
      store: params.factStore,
    });
    const data = buildBranchTreeFromFactStore({
      specs,
      store: params.factStore,
      formData: params.formData,
      measureHierarchy: ctx.layout.measureHierarchy,
    });
    return {
      data,
      factStoreHit: true,
      factBatches: appendLoadedBranchCoverageMarkers({
        existingBatches: factBatches,
        axis: params.axis,
        tree: data,
        basePaths: [params.path],
        pivotProgram: ctx.layout.pivotProgram,
        visibleRowDepth: params.visibleRowDepth ?? ctx.rowDepth,
        visibleColDepth: params.visibleColDepth ?? ctx.colDepth,
      }),
    };
  }
  const cachedFactBatches = readPivotBranchFactCache(ctx.cacheKey);
  if (!cachedFactBatches) {
    return undefined;
  }
  const store = params.factStore ?? createPivotFactStore();
  store.upsertBatches(cachedFactBatches);
  const data = buildBranchTreeFromFactStore({
    specs,
    store,
    formData: params.formData,
    measureHierarchy: ctx.layout.measureHierarchy,
  });
  return {
    data,
    cached: true,
    factBatches: appendLoadedBranchCoverageMarkers({
      existingBatches: cachedFactBatches,
      axis: params.axis,
      tree: data,
      basePaths: [params.path],
      pivotProgram: ctx.layout.pivotProgram,
      visibleRowDepth: params.visibleRowDepth ?? ctx.rowDepth,
      visibleColDepth: params.visibleColDepth ?? ctx.colDepth,
    }),
  };
};

export const resolvePivotBranchLocalResult = (
  params: FetchPivotBranchParams,
): FetchPivotBranchResult | undefined =>
  resolvePivotBranchLocalResultFromPlan(params, resolveBranchPlan(params));

export const peekPivotBranchCache = (params: FetchPivotBranchParams) => {
  const result = resolvePivotBranchLocalResult({
    ...params,
    factStore: undefined,
  });
  return result?.cached ? result.data : undefined;
};

// Exported for tests
export const resolveFetchContextForTest = resolveFetchContext;

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
  factStore,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const plan = resolveBranchPlan({
    formData,
    axis,
    path,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });
  const { ctx, specs } = plan;
  const { metricsForQuery, requiredTimeOffsets, cacheKey, layout } = ctx;
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

  const localResult = resolvePivotBranchLocalResultFromPlan(
    {
      formData,
      axis,
      path,
      currentTree,
      visibleRowDepth,
      visibleColDepth,
      factStore,
    },
    plan,
  );
  if (localResult) {
    return localResult;
  }

  try {
    const results = await supersetChartDataClient.fetch({
      formData: queryFormData,
      specs,
      requestGroupId,
    });
    const warnings = results.flatMap(result => result.warnings ?? []);
    const store = factStore ?? createPivotFactStore();
    const factBatches = upsertQueryResultsIntoFactStore({
      store,
      specs,
      results,
      fallback: 'empty',
    });
    const labeledBranch = buildBranchTreeFromFactStore({
      specs,
      store,
      formData,
      measureHierarchy: layout.measureHierarchy,
    });
    writePivotBranchFactCache(cacheKey, factBatches);
    return {
      data: labeledBranch,
      factBatches: appendLoadedBranchCoverageMarkers({
        existingBatches: factBatches,
        axis,
        tree: labeledBranch,
        basePaths: [path],
        pivotProgram: layout.pivotProgram,
        visibleRowDepth: visibleRowDepth ?? ctx.rowDepth,
        visibleColDepth: visibleColDepth ?? ctx.colDepth,
      }),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { factBatches: EMPTY_FACT_BATCHES };
    }
    return {
      factBatches: EMPTY_FACT_BATCHES,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
