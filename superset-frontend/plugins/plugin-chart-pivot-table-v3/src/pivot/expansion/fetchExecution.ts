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
import { type PivotTableQueryFormData, type PivotTreeData } from '../../types';
import {
  fetchPivotBranch,
  resolvePivotBranchLocalResult,
} from '../../fetchPivotBranch';
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { buildBatchSignature } from '../query/batchSignature';
import { fetchPivotBranchesBatch } from '../query/fetchPivotBranchesBatch';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
  type FetchTarget,
} from '../query/fetchPlanOptimizer';
import {
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import {
  type LatestRequestLifecycle,
  type LatestRequestScope,
} from '../runtime/requestLifecycle';
import { stableStringify } from '../shared/stableStringify';

const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

export type ExpansionFetchResult = {
  targets: FetchTarget[];
  data?: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
};

export type TrackExpansionRequest = <T>(
  requestScope: LatestRequestScope,
  requestGroupId: string,
  fetcher: () => Promise<T>,
) => Promise<T>;

export type BuildExpansionRequestGroupId = (
  payload: Record<string, unknown>,
  transactionId?: number,
) => string;

export type ExpansionRequestHelpers = {
  buildRequestGroupId: BuildExpansionRequestGroupId;
  trackRequestInScope: TrackExpansionRequest;
};

export const createExpansionRequestHelpers = ({
  lifecycle,
  instanceId,
}: {
  lifecycle: LatestRequestLifecycle;
  instanceId: string;
}): ExpansionRequestHelpers => ({
  buildRequestGroupId(
    payload: Record<string, unknown>,
    transactionId: number = lifecycle.currentId(),
  ) {
    return stableStringify({
      instanceId,
      transactionId,
      ...payload,
    });
  },
  async trackRequestInScope<T>(
    requestScope: LatestRequestScope,
    requestGroupId: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const token = requestScope.beginRequest(requestGroupId);
    try {
      return await fetcher();
    } finally {
      lifecycle.finish(token);
    }
  },
});

export type ExpansionFetchRuntime = {
  requestScope: LatestRequestScope;
  fetchFormData: PivotTableQueryFormData;
  factStore?: PivotFactStore;
  trackRequestInScope: TrackExpansionRequest;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  updateLoadingKey: (key: string, delta: number) => void;
};

export type ExpansionFetchContext = {
  visibleRowDepth: number;
  visibleColDepth: number;
};

export type FetchResultDelta = {
  targets: FetchTarget[];
  data: PivotTreeData;
};

const resolveExpansionFetchPlan = ({
  targets,
  formData,
  visibleRowDepth,
  visibleColDepth,
  factStore,
}: {
  targets: FetchTarget[];
  formData: PivotTableQueryFormData;
  visibleRowDepth: number;
  visibleColDepth: number;
  factStore?: PivotFactStore;
}): {
  localResults: ExpansionFetchResult[];
  singles: FetchTarget[];
  batches: BatchGroup[];
} => {
  const localResults: ExpansionFetchResult[] = [];
  const batchCandidates: BatchCandidate[] = [];
  for (const target of targets) {
    const path = parsePath(target.pathKey);
    const localResult = resolvePivotBranchLocalResult({
      axis: target.axis,
      path,
      formData,
      visibleRowDepth,
      visibleColDepth,
      factStore,
    });
    if (localResult) {
      localResults.push({
        targets: [target],
        data: localResult.data,
        factBatches: localResult.factBatches ?? EMPTY_FACT_BATCHES,
      });
      continue;
    }
    const batchSignature = buildBatchSignature({
      formData,
      axis: target.axis,
      path,
      visibleRowDepth,
      visibleColDepth,
    });
    batchCandidates.push({ ...target, batchSignature });
  }
  const { batches, singles } = optimizeFetchPlan({
    targets: batchCandidates,
  });
  return { localResults, singles, batches };
};

const fetchExpansionSingleTarget = async ({
  target,
  context,
  requestGroupId,
  runtime,
}: {
  target: FetchTarget;
  context: ExpansionFetchContext;
  requestGroupId: string;
  runtime: ExpansionFetchRuntime;
}): Promise<ExpansionFetchResult> => {
  const path = parsePath(target.pathKey);
  const {
    addWarnings,
    factStore,
    fetchFormData,
    requestScope,
    trackRequestInScope,
    updateLoadingKey,
  } = runtime;
  if (requestScope.isCurrent()) {
    updateLoadingKey(target.pathKey, 1);
  }
  try {
    const result = await trackRequestInScope(requestScope, requestGroupId, () =>
      fetchPivotBranch({
        axis: target.axis,
        path,
        formData: fetchFormData,
        visibleRowDepth: context.visibleRowDepth,
        visibleColDepth: context.visibleColDepth,
        requestGroupId,
        factStore,
      }),
    );
    if (!result) {
      return {
        targets: [target],
        data: undefined,
        factBatches: EMPTY_FACT_BATCHES,
      };
    }
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
      if (result.error) {
        throw result.error;
      }
    }
    return {
      targets: [target],
      data: result.data,
      factBatches: result.factBatches ?? EMPTY_FACT_BATCHES,
    };
  } finally {
    if (requestScope.isCurrent()) {
      updateLoadingKey(target.pathKey, -1);
    }
  }
};

const fetchExpansionBatchTarget = async ({
  batch,
  context,
  requestGroupId,
  runtime,
}: {
  batch: BatchGroup;
  context: ExpansionFetchContext;
  requestGroupId: string;
  runtime: ExpansionFetchRuntime;
}): Promise<ExpansionFetchResult> => {
  const {
    addWarnings,
    factStore,
    fetchFormData,
    requestScope,
    trackRequestInScope,
    updateLoadingKey,
  } = runtime;
  if (requestScope.isCurrent()) {
    batch.targets.forEach(target => updateLoadingKey(target.pathKey, 1));
  }
  try {
    const result = await trackRequestInScope(requestScope, requestGroupId, () =>
      fetchPivotBranchesBatch({
        formData: fetchFormData,
        batch,
        visibleRowDepth: context.visibleRowDepth,
        visibleColDepth: context.visibleColDepth,
        requestGroupId,
        factStore,
      }),
    );
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
      if (result.error) {
        throw result.error;
      }
    }
    return {
      targets: batch.targets,
      data: result.data,
      factBatches: result.factBatches ?? EMPTY_FACT_BATCHES,
    };
  } finally {
    if (requestScope.isCurrent()) {
      batch.targets.forEach(target => updateLoadingKey(target.pathKey, -1));
    }
  }
};

export const fetchExpansionTargets = async ({
  targets,
  context,
  runtime,
  singleRequestKind,
  batchRequestKind = singleRequestKind,
  transactionId,
  buildRequestGroupId,
}: {
  targets: FetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
  singleRequestKind: string;
  batchRequestKind?: string;
  transactionId: number;
  buildRequestGroupId: BuildExpansionRequestGroupId;
}): Promise<ExpansionFetchResult[]> => {
  const { localResults, batches, singles } = resolveExpansionFetchPlan({
    targets,
    formData: runtime.fetchFormData,
    visibleRowDepth: context.visibleRowDepth,
    visibleColDepth: context.visibleColDepth,
    factStore: runtime.factStore,
  });
  const { visibleRowDepth, visibleColDepth } = context;
  const buildSingleRequestGroupId = (target: FetchTarget) =>
    buildRequestGroupId(
      {
        kind: singleRequestKind,
        ...target,
        visibleRowDepth,
        visibleColDepth,
      },
      transactionId,
    );
  const buildBatchRequestGroupId = (batch: BatchGroup) =>
    buildRequestGroupId(
      {
        kind: batchRequestKind,
        axis: batch.axis,
        parentPathKey: batch.parentPathKey,
        childDepth: batch.childDepth,
        requiredOppositeDepth: batch.requiredOppositeDepth,
        signature: batch.signature,
        targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
        visibleRowDepth,
        visibleColDepth,
      },
      transactionId,
    );
  const fetchPromises: Array<Promise<ExpansionFetchResult>> = [
    ...singles.map(target =>
      fetchExpansionSingleTarget({
        target,
        context,
        requestGroupId: buildSingleRequestGroupId(target),
        runtime,
      }),
    ),
    ...batches.map(batch =>
      fetchExpansionBatchTarget({
        batch,
        context,
        requestGroupId: buildBatchRequestGroupId(batch),
        runtime,
      }),
    ),
  ];
  const fetchedResults = await Promise.all(fetchPromises);
  return [...localResults, ...fetchedResults];
};

export const fetchExpansionTargetDeltas = async ({
  targets,
  context,
  runtime,
  singleRequestKind,
  batchRequestKind,
  transactionId,
  buildRequestGroupId,
  seedFetchedCoverage,
  seedLoadedMetricNodeCoverage,
}: {
  targets: FetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
  singleRequestKind: string;
  batchRequestKind?: string;
  transactionId: number;
  buildRequestGroupId: BuildExpansionRequestGroupId;
  seedFetchedCoverage: (factBatches: PivotFactStoreBatch[]) => void;
  seedLoadedMetricNodeCoverage: (
    loadedTree: PivotTreeData,
    visibleRowDepth: number,
    visibleColDepth: number,
  ) => void;
}): Promise<FetchResultDelta[]> => {
  const results = await fetchExpansionTargets({
    targets,
    context,
    runtime,
    singleRequestKind,
    batchRequestKind,
    transactionId,
    buildRequestGroupId,
  });
  const deltas: FetchResultDelta[] = [];
  results.forEach(result => {
    seedFetchedCoverage(result.factBatches);
    if (!result.data) {
      return;
    }
    seedLoadedMetricNodeCoverage(
      result.data,
      context.visibleRowDepth,
      context.visibleColDepth,
    );
    deltas.push({
      targets: result.targets,
      data: result.data,
    });
  });
  return deltas;
};
