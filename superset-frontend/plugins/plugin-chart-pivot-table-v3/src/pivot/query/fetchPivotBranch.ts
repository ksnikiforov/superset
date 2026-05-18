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
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
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
import { type PivotFactStore } from '../runtime/factStore';
import { upsertQueryResultsIntoFactStore } from '../runtime/ingestQueryResults';
import { isAbortError } from '../runtime/requestLifecycle';
import { factStoreSelectorFromSpec } from '../runtime/materializePivotTree';
import { type BatchGroup } from './fetchPlanOptimizer';

export interface FetchPivotBranchResult {
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

const fetchPivotQuerySpecsIntoFactStore = async ({
  formData,
  specs,
  requestGroupId,
  factStore,
}: {
  formData: PivotTableQueryFormData;
  specs: PlannedQuerySpec[];
  requestGroupId?: string;
  factStore?: PivotFactStore;
}): Promise<FetchPivotBranchResult> => {
  if (specs.length === 0) {
    return {};
  }
  const missingSpecs = specs.filter(
    spec => !factStore?.hasCompatibleCoverage(factStoreSelectorFromSpec(spec)),
  );
  if (missingSpecs.length === 0) {
    return {};
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
    if (factStore) {
      upsertQueryResultsIntoFactStore({
        store: factStore,
        specs: missingSpecs,
        results,
      });
    }
    return {
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

export async function fetchPivotBranch({
  formData,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const ctx = resolveBranchFetchContext({
    formData,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });
  const specs = buildBranchQuerySpecs({
    formData,
    layout: ctx.layout,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });

  return fetchPivotQuerySpecsIntoFactStore({
    formData,
    specs,
    requestGroupId,
    factStore,
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
  return fetchPivotQuerySpecsIntoFactStore({
    formData,
    specs,
    requestGroupId,
    factStore,
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
  return fetchPivotQuerySpecsIntoFactStore({
    formData,
    specs,
    requestGroupId,
    factStore,
  });
};
