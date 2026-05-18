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
import {
  createPivotFactStore,
  type PivotFactStore,
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
    return {};
  }
  const missingSpecs = specs.filter(
    spec => !store.hasCompatibleCoverage(factStoreSelectorFromSpec(spec)),
  );
  if (missingSpecs.length === 0) {
    const factBatches = buildFactStoreBatchesFromSpecs({ specs, store });
    store.registerCompatibleCoverageBatches(factBatches);
    return {
      data: buildBranchTreeFromFactStore({
        specs,
        store,
        formData,
        measureHierarchy,
      }),
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
    store.registerCompatibleCoverageBatches(factBatches);
    const data = buildBranchTreeFromFactStore({
      specs,
      store,
      formData,
      measureHierarchy,
    });
    return {
      data,
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
): {
  ctx: ResolvedFetchContext;
  specs: PlannedQuerySpec[];
} => {
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
