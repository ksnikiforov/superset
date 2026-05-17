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
  fetchPivotIntersection,
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
  buildFactValueKeys,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import {
  type LatestRequestLifecycle,
  type LatestRequestScope,
} from '../runtime/requestLifecycle';
import { createExpansionCoverageDiff } from '../runtime/coverage';
import { stableStringify } from '../shared/stableStringify';
import {
  applyExpansionFetchDelta,
  computeVisibleDepths,
  runHydrationLoop,
  type ExpansionVisibilityConfig,
} from './stateTransitions';
import {
  buildGroupedFetchTargets,
  type ExpansionFetchTarget,
  type IntersectionFetchTarget,
  isIntersectionFetchTarget,
  planExpansionForAxis,
} from './planner';
import type { PivotProgram } from '../runtime/types';

type ExpansionFetchResult = {
  targets: ExpansionFetchTarget[];
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
};

export type TrackExpansionRequest = <T>(
  requestScope: LatestRequestScope,
  requestGroupId: string,
  fetcher: () => Promise<T>,
) => Promise<T>;

export type BuildExpansionRequestGroupId = (
  payload: Record<string, unknown>,
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
  buildRequestGroupId(payload: Record<string, unknown>) {
    return stableStringify({
      instanceId,
      transactionId: lifecycle.currentId(),
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
  targets: ExpansionFetchTarget[];
  data: PivotTreeData;
};

type ExpansionFetcherResult = {
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  warnings?: ChartDataWarning[];
  error?: unknown;
};

const createRuntimeExpansionCoverageDiff = ({
  runtime,
  program,
}: {
  runtime: ExpansionFetchRuntime;
  program: PivotProgram;
}) =>
  createExpansionCoverageDiff({
    factBatches: runtime.factStore?.getCoverageBatches() ?? [],
    program,
    valueKeys: buildFactValueKeys({
      metricKeys: program.metricKeys,
    }),
  });

const resolveExpansionFetchPlan = ({
  targets,
  formData,
  visibleRowDepth,
  visibleColDepth,
}: {
  targets: ExpansionFetchTarget[];
  formData: PivotTableQueryFormData;
  visibleRowDepth: number;
  visibleColDepth: number;
}): {
  singles: FetchTarget[];
  batches: BatchGroup[];
  intersections: IntersectionFetchTarget[];
} => {
  const batchCandidates: BatchCandidate[] = [];
  for (const target of targets) {
    if (isIntersectionFetchTarget(target)) {
      continue;
    }
    const path = parsePath(target.pathKey);
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
  return {
    singles,
    batches,
    intersections: targets.filter(isIntersectionFetchTarget),
  };
};

const executeExpansionFetch = async ({
  runtime,
  requestGroupId,
  loadingKeys,
  targets,
  fetcher,
}: {
  runtime: ExpansionFetchRuntime;
  requestGroupId: string;
  loadingKeys: string[];
  targets: ExpansionFetchTarget[];
  fetcher: () => Promise<ExpansionFetcherResult>;
}): Promise<ExpansionFetchResult> => {
  const { requestScope, trackRequestInScope, updateLoadingKey, addWarnings } =
    runtime;
  if (requestScope.isCurrent()) {
    loadingKeys.forEach(key => updateLoadingKey(key, 1));
  }
  try {
    const result = await trackRequestInScope(
      requestScope,
      requestGroupId,
      fetcher,
    );
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
      if (result.error) {
        throw result.error;
      }
    }
    return {
      targets,
      data: result.data,
      factBatches: result.factBatches,
    };
  } finally {
    if (requestScope.isCurrent()) {
      loadingKeys.forEach(key => updateLoadingKey(key, -1));
    }
  }
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
  return executeExpansionFetch({
    runtime,
    requestGroupId,
    loadingKeys: [target.pathKey],
    targets: [target],
    fetcher: () =>
      fetchPivotBranch({
        axis: target.axis,
        path,
        formData: runtime.fetchFormData,
        visibleRowDepth: context.visibleRowDepth,
        visibleColDepth: context.visibleColDepth,
        requestGroupId,
        factStore: runtime.factStore,
      }),
  });
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
  const loadingKeys = batch.targets.map(target => target.pathKey);
  return executeExpansionFetch({
    runtime,
    requestGroupId,
    loadingKeys,
    targets: batch.targets,
    fetcher: () =>
      fetchPivotBranchesBatch({
        formData: runtime.fetchFormData,
        batch,
        visibleRowDepth: context.visibleRowDepth,
        visibleColDepth: context.visibleColDepth,
        requestGroupId,
        factStore: runtime.factStore,
      }),
  });
};

const fetchExpansionIntersectionTarget = async ({
  target,
  context,
  requestGroupId,
  runtime,
}: {
  target: IntersectionFetchTarget;
  context: ExpansionFetchContext;
  requestGroupId: string;
  runtime: ExpansionFetchRuntime;
}): Promise<ExpansionFetchResult> => {
  const loadingKeys = [...target.rowPathKeys, ...target.columnPathKeys];
  return executeExpansionFetch({
    runtime,
    requestGroupId,
    loadingKeys,
    targets: [
      ...target.rowPathKeys.map(pathKey => ({
        axis: 'row' as const,
        pathKey,
      })),
      ...target.columnPathKeys.map(pathKey => ({
        axis: 'col' as const,
        pathKey,
      })),
    ],
    fetcher: () =>
      fetchPivotIntersection({
        formData: runtime.fetchFormData,
        rowPathKeys: target.rowPathKeys,
        columnPathKeys: target.columnPathKeys,
        visibleRowDepth: context.visibleRowDepth,
        visibleColDepth: context.visibleColDepth,
        requestGroupId,
        factStore: runtime.factStore,
      }),
  });
};

export const fetchExpansionTargetDeltas = async ({
  targets,
  context,
  runtime,
  singleRequestKind,
  batchRequestKind = singleRequestKind,
  buildRequestGroupId,
}: {
  targets: ExpansionFetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
  singleRequestKind: string;
  batchRequestKind?: string;
  buildRequestGroupId: BuildExpansionRequestGroupId;
}): Promise<FetchResultDelta[]> => {
  const { batches, singles, intersections } = resolveExpansionFetchPlan({
    targets,
    formData: runtime.fetchFormData,
    visibleRowDepth: context.visibleRowDepth,
    visibleColDepth: context.visibleColDepth,
  });
  const { visibleRowDepth, visibleColDepth } = context;
  const buildSingleRequestGroupId = (target: FetchTarget) =>
    buildRequestGroupId({
      kind: singleRequestKind,
      ...target,
      visibleRowDepth,
      visibleColDepth,
    });
  const buildBatchRequestGroupId = (batch: BatchGroup) =>
    buildRequestGroupId({
      kind: batchRequestKind,
      axis: batch.axis,
      parentPathKey: batch.parentPathKey,
      signature: batch.signature,
      targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
      visibleRowDepth,
      visibleColDepth,
    });
  const buildIntersectionRequestGroupId = (target: IntersectionFetchTarget) =>
    buildRequestGroupId({
      kind: 'hydrate:intersection',
      rowPathKeys: [...target.rowPathKeys].sort(),
      columnPathKeys: [...target.columnPathKeys].sort(),
      visibleRowDepth,
      visibleColDepth,
    });
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
    ...intersections.map(target =>
      fetchExpansionIntersectionTarget({
        target,
        context,
        requestGroupId: buildIntersectionRequestGroupId(target),
        runtime,
      }),
    ),
  ];
  const results = await Promise.all(fetchPromises);
  if (!runtime.requestScope.isCurrent()) {
    return [];
  }
  const deltas: FetchResultDelta[] = [];
  results.forEach(result => {
    runtime.factStore?.upsertBatches(result.factBatches);
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
  buildRequestGroupId,
  ...hydrationLoopParams
}: Omit<HydrationLoopParams, 'fetchDeltas' | 'getMissingExpansionCoverage'> & {
  reason: 'prefetch' | 'cross-axis';
  fetchRuntime: ExpansionFetchRuntime;
  buildRequestGroupId: BuildExpansionRequestGroupId;
}) =>
  runHydrationLoop({
    ...hydrationLoopParams,
    getMissingExpansionCoverage: () =>
      createRuntimeExpansionCoverageDiff({
        runtime: fetchRuntime,
        program: hydrationLoopParams.config.program,
      }),
    fetchDeltas: ({ targets, context }) =>
      fetchExpansionTargetDeltas({
        targets,
        context,
        runtime: fetchRuntime,
        singleRequestKind: `hydrate:${reason}`,
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

export const runSameAxisExpansionFetchLoop = async ({
  axis,
  baseExpanded,
  initialResolvedExpanded,
  initialTree,
  maxIterations,
  requestEpoch,
  getDataEpoch,
  getExpandedRows,
  getExpandedCols,
  config,
  fetchRuntime,
  buildRequestGroupId,
  resolveExpandedForMetrics,
  pruneMergedTree,
}: {
  axis: PivotAxis;
  baseExpanded: Set<string>;
  initialResolvedExpanded: Set<string>;
  initialTree: PivotTreeData;
  maxIterations: number;
  requestEpoch: number;
  getDataEpoch: () => number;
  getExpandedRows: () => Set<string>;
  getExpandedCols: () => Set<string>;
  config: ExpansionVisibilityConfig;
  fetchRuntime: ExpansionFetchRuntime;
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
  const { requestScope } = fetchRuntime;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (getDataEpoch() !== requestEpoch || !requestScope.isCurrent()) {
      return { status: 'stale' };
    }
    const expandedRowsForDepth =
      axis === 'row' ? resolvedExpanded : getExpandedRows();
    const expandedColsForDepth =
      axis === 'col' ? resolvedExpanded : getExpandedCols();
    const { visibleRowDepth, visibleColDepth } = computeVisibleDepths({
      tree: currentTree,
      expandedRows: expandedRowsForDepth,
      expandedCols: expandedColsForDepth,
      config,
    });
    const nodes = axis === 'row' ? currentTree.rows : currentTree.cols;
    const plan = planExpansionForAxis({
      axis,
      program: config.program,
      expandedKeys: resolvedExpanded,
      nodes,
      coverage: { rowDepth: visibleRowDepth, columnDepth: visibleColDepth },
      getMissingExpansionCoverage: createRuntimeExpansionCoverageDiff({
        runtime: fetchRuntime,
        program: config.program,
      }),
    });
    if (plan.fetchRequests.length === 0) {
      break;
    }
    const targets = buildGroupedFetchTargets({
      axis,
      program: config.program,
      requests: plan.fetchRequests,
      nodes,
    });

    // eslint-disable-next-line no-await-in-loop
    const resultDeltas = await fetchExpansionTargetDeltas({
      targets,
      context: { visibleRowDepth, visibleColDepth },
      runtime: fetchRuntime,
      singleRequestKind: 'branch',
      batchRequestKind: 'batch',
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
