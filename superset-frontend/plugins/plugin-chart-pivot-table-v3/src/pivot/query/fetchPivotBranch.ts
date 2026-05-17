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
  type MeasureHierarchy,
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { getMetricKeys } from '../core/tokens';
import { parsePath } from '../core/path';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import {
  buildLayoutContext,
  type LayoutContext,
} from '../layout/LayoutContext';
import {
  resolveFetchContext as resolveFetchContextBase,
  type ResolvedFetchContext as ResolvedQueryFetchContext,
} from './resolveFetchContext';
import {
  buildBatchQuerySpecs,
  buildBranchQuerySpecs,
  buildIntersectionQuerySpecs,
  type PlannedQuerySpec,
} from './specs';
import { buildFactCoverage } from '../runtime/coverage';
import {
  buildFactValueKeys,
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { upsertQueryResultsIntoFactStore } from '../runtime/ingestQueryResults';
import { isAbortError } from '../runtime/requestLifecycle';
import {
  buildBranchTreeFromFactStore,
  buildFactStoreBatchesFromSpecs,
  factStoreSelectorFromSpec,
} from '../runtime/materializePivotTree';
import { type BatchGroup } from './fetchPlanOptimizer';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
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

export type FetchPivotBranchesBatchParams = {
  formData: PivotTableQueryFormData;
  batch: BatchGroup;
  visibleRowDepth: number;
  visibleColDepth: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

export type FetchPivotBranchesBatchResult = FetchPivotBranchResult;

export type FetchPivotIntersectionParams = {
  formData: PivotTableQueryFormData;
  rowPathKeys: string[];
  columnPathKeys: string[];
  visibleRowDepth: number;
  visibleColDepth: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

export type FetchPivotIntersectionResult = FetchPivotBranchResult;

type ResolvedFetchContext = ResolvedQueryFetchContext & {
  layout: LayoutContext;
};

type ResolvedBranchPlan = {
  ctx: ResolvedFetchContext;
  specs: PlannedQuerySpec[];
};

const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

export const fetchPivotQuerySpecsIntoBranchTree = async ({
  formData,
  specs,
  requestGroupId,
  factStore,
  measureHierarchy,
}: {
  formData: PivotTableQueryFormData;
  specs: PlannedQuerySpec[];
  requestGroupId?: string;
  factStore?: PivotFactStore;
  measureHierarchy: MeasureHierarchy;
}): Promise<FetchPivotBranchResult> => {
  const store = factStore ?? createPivotFactStore();
  if (specs.length === 0) {
    return { factBatches: EMPTY_FACT_BATCHES };
  }
  const missingSpecs = specs.filter(
    spec => !store.hasCompatibleCoverage(factStoreSelectorFromSpec(spec)),
  );
  if (missingSpecs.length === 0) {
    return {
      data: buildBranchTreeFromFactStore({
        specs,
        store,
        formData,
        measureHierarchy,
      }),
      factBatches: buildFactStoreBatchesFromSpecs({ specs, store }),
    };
  }
  const metricsForQuery = missingSpecs[0]?.metrics ?? specs[0].metrics;
  const timeOffsets = Array.from(
    new Set([
      ...(formData.time_offsets ?? []),
      ...missingSpecs.flatMap(spec => spec.meta.requiredTimeOffsets),
    ]),
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

  try {
    const results = await supersetChartDataClient.fetch({
      formData: queryFormData,
      specs: missingSpecs,
      requestGroupId,
    });
    const warnings = results.flatMap(result => result.warnings ?? []);
    const factBatches = upsertQueryResultsIntoFactStore({
      store,
      specs: missingSpecs,
      results,
    });
    const data = buildBranchTreeFromFactStore({
      specs,
      store,
      formData,
      measureHierarchy,
    });
    return {
      data,
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
};

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
      valueKeys: buildFactValueKeys({
        metricKeys: getMetricKeys(ctx.metricsForQuery),
        requiredTimeOffsets: ctx.requiredTimeOffsets,
      }),
      facts: [],
    };
    params.factStore?.upsertBatch(batch);
    return { data: undefined, factBatches: [batch] };
  }
  return undefined;
};

export const resolvePivotBranchLocalResult = (
  params: FetchPivotBranchParams,
): FetchPivotBranchResult | undefined =>
  resolvePivotBranchLocalResultFromPlan(params, resolveBranchPlan(params));

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

  return fetchPivotQuerySpecsIntoBranchTree({
    formData,
    specs,
    requestGroupId,
    factStore,
    measureHierarchy: ctx.layout.measureHierarchy,
  });
}

export const fetchPivotBranchesBatch = async ({
  formData,
  batch,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
  const layout = buildLayoutContext(formData);
  const specs = buildBatchQuerySpecs({
    formData,
    layout,
    batch,
    visibleRowDepth,
    visibleColDepth,
    chunkIndex: 0,
  });
  if (specs.length === 0) {
    const batchMarker: PivotFactStoreBatch = {
      coverage: buildFactCoverage({
        reason: 'expand',
        rowDimensions: layout.pivotProgram.rowDimensions,
        columnDimensions: layout.pivotProgram.columnDimensions,
        rowDepth: visibleRowDepth,
        columnDepth: visibleColDepth,
      }),
      scope: {
        kind: 'batch',
        axis: batch.axis,
        parentPath: parsePath(batch.parentPathKey),
        siblingValues: batch.siblingValues,
      },
      valueKeys: buildFactValueKeys({
        metricKeys: layout.pivotProgram.metricKeys,
      }),
      facts: [],
    };
    factStore?.upsertBatch(batchMarker);
    return { data: undefined, factBatches: [batchMarker] };
  }
  return fetchPivotQuerySpecsIntoBranchTree({
    formData,
    specs,
    requestGroupId,
    factStore,
    measureHierarchy: layout.measureHierarchy,
  });
};

export const fetchPivotIntersection = async ({
  formData,
  rowPathKeys,
  columnPathKeys,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotIntersectionParams): Promise<FetchPivotIntersectionResult> => {
  const layout = buildLayoutContext(formData);
  const specs = buildIntersectionQuerySpecs({
    formData,
    layout,
    rowPathKeys,
    columnPathKeys,
    visibleRowDepth,
    visibleColDepth,
  });
  return fetchPivotQuerySpecsIntoBranchTree({
    formData,
    specs,
    requestGroupId,
    factStore,
    measureHierarchy: layout.measureHierarchy,
  });
};
