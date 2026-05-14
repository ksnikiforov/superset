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
import { buildFactCoverage } from './pivot/runtime/coverage';
import {
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from './pivot/runtime/factStore';
import { upsertQueryResultsIntoFactStore } from './pivot/runtime/ingestQueryResults';
import {
  buildBranchTreeFromFactStore,
  buildFactStoreBatchesFromSpecs,
  canMaterializeSpecsFromFactStore,
} from './pivot/runtime/materializePivotTree';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
  factStoreHit?: boolean;
  factBatches: PivotFactStoreBatch[];
  warnings?: ChartDataWarning[];
  error?: Error;
}

export interface FetchPivotBranchParams {
  formData: PivotTableQueryFormData;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
}

export type ResolvedFetchContext = ResolvedQueryFetchContext & {
  layout: LayoutContext;
};

type ResolvedBranchPlan = {
  ctx: ResolvedFetchContext;
  specs: ReturnType<typeof buildBranchQuerySpecs>;
};

const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

export const resolveBranchFetchContext = ({
  formData,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
}: FetchPivotBranchParams): ResolvedFetchContext => {
  const layout = buildLayoutContext(formData);
  const queryCtx = resolveFetchContextBase({
    formData,
    layout,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });
  return { ...queryCtx, layout };
};

const resolveBranchPlan = (
  params: FetchPivotBranchParams,
): ResolvedBranchPlan => {
  const ctx = resolveBranchFetchContext(params);
  const specs = buildBranchQuerySpecs({
    formData: params.formData,
    layout: ctx.layout,
    axis: params.axis,
    path: params.path,
    visibleRowDepth: params.visibleRowDepth,
    visibleColDepth: params.visibleColDepth,
  });
  return { ctx, specs };
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
      factBatches,
    };
  }
  return undefined;
};

export const resolvePivotBranchLocalResult = (
  params: FetchPivotBranchParams,
): FetchPivotBranchResult | undefined =>
  resolvePivotBranchLocalResultFromPlan(params, resolveBranchPlan(params));

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
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const plan = resolveBranchPlan({
    formData,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });
  const { ctx, specs } = plan;
  const { metricsForQuery, requiredTimeOffsets, layout } = ctx;
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
    return {
      data: labeledBranch,
      factBatches,
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
