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
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  fetchPivotBranch,
  fetchPivotBranchesBatch,
  resolvePivotBranchLocalResult,
} from '../query/fetchPivotBranch';
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { buildBatchSignature } from '../query/batchSignature';
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
import { type PivotExpansionCoverageDiff } from '../runtime/coverage';
import { stableStringify } from '../shared/stableStringify';
import { applyExpansionFetchDelta, runHydrationLoop } from './stateTransitions';
import {
  buildGroupedFetchTargets,
  planExpansionForAxis,
  type PivotExpansionNodeFetchPredicate,
} from './planner';

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
        factBatches: localResult.factBatches,
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
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
      if (result.error) {
        throw result.error;
      }
    }
    return {
      targets: [target],
      data: result.data,
      factBatches: result.factBatches,
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
      factBatches: result.factBatches,
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
}: {
  targets: FetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
  singleRequestKind: string;
  batchRequestKind?: string;
  transactionId: number;
  buildRequestGroupId: BuildExpansionRequestGroupId;
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
  if (!runtime.requestScope.isCurrent()) {
    return [];
  }
  const deltas: FetchResultDelta[] = [];
  results.forEach(result => {
    runtime.factStore?.upsertBatches(result.factBatches);
    if (!result.data) {
      return;
    }
    deltas.push({
      targets: result.targets,
      data: result.data,
    });
  });
  return deltas;
};

type HydrationLoopParams = Parameters<typeof runHydrationLoop>[0];

export const runHydrationExpansionFetchLoop = ({
  reason,
  fetchRuntime,
  transactionId,
  buildRequestGroupId,
  ...hydrationLoopParams
}: Omit<HydrationLoopParams, 'fetchDeltas'> & {
  reason: 'prefetch' | 'cross-axis';
  fetchRuntime: ExpansionFetchRuntime;
  transactionId: number;
  buildRequestGroupId: BuildExpansionRequestGroupId;
}) =>
  runHydrationLoop({
    ...hydrationLoopParams,
    fetchDeltas: ({ targets, context }) =>
      fetchExpansionTargetDeltas({
        targets,
        context,
        runtime: fetchRuntime,
        singleRequestKind: `hydrate:${reason}`,
        transactionId,
        buildRequestGroupId,
      }),
  });

export type SameAxisExpansionFetchLoopResult =
  | {
      status: 'complete';
      tree: PivotTreeData;
      touchedKeys: string[];
    }
  | {
      status: 'stale';
    };

type SameAxisVisibleDepths = {
  visibleRowDepth: number;
  visibleColDepth: number;
};

export const runSameAxisExpansionFetchLoop = async ({
  axis,
  baseExpanded,
  initialResolvedExpanded,
  initialTree,
  maxIterations,
  requestScope,
  requestEpoch,
  getDataEpoch,
  getExpandedRows,
  getExpandedCols,
  computeVisibleDepths,
  getMissingExpansionCoverage,
  getCoverageKey,
  shouldFetchChildren,
  fetchRuntime,
  transactionId,
  buildRequestGroupId,
  resolveExpandedForMetrics,
  pruneMergedTree,
}: {
  axis: PivotAxis;
  baseExpanded: Set<string>;
  initialResolvedExpanded: Set<string>;
  initialTree: PivotTreeData;
  maxIterations: number;
  requestScope: LatestRequestScope;
  requestEpoch: number;
  getDataEpoch: () => number;
  getExpandedRows: () => Set<string>;
  getExpandedCols: () => Set<string>;
  computeVisibleDepths: (
    expandedRows: Set<string>,
    expandedCols: Set<string>,
    tree: PivotTreeData,
  ) => SameAxisVisibleDepths;
  getMissingExpansionCoverage: () => PivotExpansionCoverageDiff;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
  shouldFetchChildren: PivotExpansionNodeFetchPredicate;
  fetchRuntime: ExpansionFetchRuntime;
  transactionId: number;
  buildRequestGroupId: BuildExpansionRequestGroupId;
  resolveExpandedForMetrics: (
    axis: PivotAxis,
    nextExpanded: Set<string>,
    nextTree: PivotTreeData,
  ) => Set<string>;
  pruneMergedTree: (params: {
    axis: PivotAxis;
    tree: PivotTreeData;
    parent?: PivotTreeNode;
    branch?: PivotTreeData;
  }) => PivotTreeData;
}): Promise<SameAxisExpansionFetchLoopResult> => {
  let currentTree = initialTree;
  let resolvedExpanded = initialResolvedExpanded;
  const touchedKeys = new Set<string>();

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (getDataEpoch() !== requestEpoch || !requestScope.isCurrent()) {
      return { status: 'stale' };
    }
    const expandedRowsForDepth =
      axis === 'row' ? resolvedExpanded : getExpandedRows();
    const expandedColsForDepth =
      axis === 'col' ? resolvedExpanded : getExpandedCols();
    const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
      expandedRowsForDepth,
      expandedColsForDepth,
      currentTree,
    );
    const nodes = axis === 'row' ? currentTree.rows : currentTree.cols;
    const plan = planExpansionForAxis({
      axis,
      expandedKeys: resolvedExpanded,
      nodes,
      coverage: { rowDepth: visibleRowDepth, columnDepth: visibleColDepth },
      getMissingExpansionCoverage: getMissingExpansionCoverage(),
      getCoverageKey,
      shouldFetchChildren,
    });
    if (plan.fetchRequests.length === 0) {
      break;
    }
    const targets = buildGroupedFetchTargets({
      axis,
      requests: plan.fetchRequests,
      nodes,
      getCoverageKey,
    });

    // eslint-disable-next-line no-await-in-loop
    const resultDeltas = await fetchExpansionTargetDeltas({
      targets,
      context: { visibleRowDepth, visibleColDepth },
      runtime: fetchRuntime,
      singleRequestKind: 'branch',
      batchRequestKind: 'batch',
      transactionId,
      buildRequestGroupId,
    });
    if (getDataEpoch() !== requestEpoch || !requestScope.isCurrent()) {
      return { status: 'stale' };
    }
    for (const { targets: deltaTargets, data: deltaTree } of resultDeltas) {
      deltaTargets.forEach(target => {
        touchedKeys.add(target.pathKey);
      });
      currentTree = applyExpansionFetchDelta({
        tree: currentTree,
        axis,
        keys: deltaTargets.map(target => target.pathKey),
        branch: deltaTree,
        pruneMergedTree,
      });
    }
    if (resultDeltas.length === 0) {
      break;
    }
    resolvedExpanded = resolveExpandedForMetrics(
      axis,
      baseExpanded,
      currentTree,
    );
  }

  if (!requestScope.isCurrent()) {
    return { status: 'stale' };
  }

  return {
    status: 'complete',
    tree: currentTree,
    touchedKeys: Array.from(touchedKeys),
  };
};
