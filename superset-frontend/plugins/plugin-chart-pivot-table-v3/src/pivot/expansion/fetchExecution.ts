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
import { mergeTrees } from '../core/tree';
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { buildBatchSignature } from '../query/batchSignature';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
  type FetchTarget,
} from '../query/fetchPlanOptimizer';
import { buildFactValueKeys, type PivotFactStore } from '../runtime/factStore';
import {
  type LatestRequestLifecycle,
  type LatestRequestScope,
} from '../runtime/requestLifecycle';
import { createExpansionCoverageDiff } from '../runtime/coverage';
import { stableStringify } from '../shared/stableStringify';
import {
  computeVisibleDepths,
  runHydrationLoop,
  type ExpansionVisibilityConfig,
  type PruneMergedTree,
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
};

export type TrackExpansionRequest = <T>(
  requestScope: LatestRequestScope,
  requestGroupId: string,
  fetcher: () => Promise<T>,
) => Promise<T>;

type BuildExpansionRequestGroupId = (
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
  buildRequestGroupId: BuildExpansionRequestGroupId;
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
  warnings?: ChartDataWarning[];
  error?: unknown;
};

type FetchDeltaEntry = {
  axis: PivotAxis;
  pathKey: string;
  data: PivotTreeData;
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
}: {
  targets: ExpansionFetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
  singleRequestKind: string;
  batchRequestKind?: string;
}): Promise<FetchResultDelta[]> => {
  const { batches, singles, intersections } = resolveExpansionFetchPlan({
    targets,
    formData: runtime.fetchFormData,
    visibleRowDepth: context.visibleRowDepth,
    visibleColDepth: context.visibleColDepth,
  });
  const { visibleRowDepth, visibleColDepth } = context;
  const buildSingleRequestGroupId = (target: FetchTarget) =>
    runtime.buildRequestGroupId({
      kind: singleRequestKind,
      ...target,
      visibleRowDepth,
      visibleColDepth,
    });
  const buildBatchRequestGroupId = (batch: BatchGroup) =>
    runtime.buildRequestGroupId({
      kind: batchRequestKind,
      axis: batch.axis,
      parentPathKey: batch.parentPathKey,
      signature: batch.signature,
      targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
      visibleRowDepth,
      visibleColDepth,
    });
  const buildIntersectionRequestGroupId = (target: IntersectionFetchTarget) =>
    runtime.buildRequestGroupId({
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
    deltas.push({
      targets: result.targets,
      data: result.data,
    });
  });
  return deltas;
};

const getOrderedFetchDeltaEntries = (
  deltas: FetchResultDelta[],
): FetchDeltaEntry[] =>
  deltas
    .flatMap(({ targets, data }) =>
      targets.flatMap(target => {
        if (!('axis' in target)) {
          return [];
        }
        return [{ axis: target.axis, pathKey: target.pathKey, data }];
      }),
    )
    .sort((left, right) => {
      const axisCompare = left.axis.localeCompare(right.axis);
      if (axisCompare !== 0) {
        return axisCompare;
      }
      const depthCompare =
        parsePath(left.pathKey).length - parsePath(right.pathKey).length;
      if (depthCompare !== 0) {
        return depthCompare;
      }
      return left.pathKey.localeCompare(right.pathKey);
    });

const applyFetchDeltasToTree = ({
  tree,
  deltas,
  pruneMergedTree,
}: {
  tree: PivotTreeData;
  deltas: FetchResultDelta[];
  pruneMergedTree: (params: {
    axis: PivotAxis;
    tree: PivotTreeData;
    parent?: PivotTreeNode;
    branch?: PivotTreeData;
  }) => PivotTreeData;
}) => {
  const entries = getOrderedFetchDeltaEntries(deltas);
  let mergedTree = entries.reduce(
    (nextTree, entry) => mergeTrees(nextTree, entry.data),
    tree,
  );
  entries.forEach(entry => {
    const parent =
      entry.axis === 'row'
        ? mergedTree.rows[entry.pathKey]
        : mergedTree.cols[entry.pathKey];
    mergedTree = pruneMergedTree({
      axis: entry.axis,
      tree: mergedTree,
      parent,
      branch: entry.data,
    });
  });
  return mergedTree;
};

type HydrationLoopParams = Parameters<typeof runHydrationLoop>[0];

export const runHydrationExpansionFetchLoop = ({
  reason,
  fetchRuntime,
  pruneMergedTree,
  ...hydrationLoopParams
}: Omit<HydrationLoopParams, 'fetchTree' | 'getMissingExpansionCoverage'> & {
  reason: 'prefetch' | 'cross-axis';
  fetchRuntime: ExpansionFetchRuntime;
  pruneMergedTree: PruneMergedTree;
}) =>
  runHydrationLoop({
    ...hydrationLoopParams,
    getMissingExpansionCoverage: () =>
      createRuntimeExpansionCoverageDiff({
        runtime: fetchRuntime,
        program: hydrationLoopParams.config.program,
      }),
    fetchTree: async ({ targets, context, tree }) => {
      const deltas = await fetchExpansionTargetDeltas({
        targets,
        context,
        runtime: fetchRuntime,
        singleRequestKind: `hydrate:${reason}`,
      });
      return applyFetchDeltasToTree({
        tree,
        deltas,
        pruneMergedTree,
      });
    },
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
    });
    if (getDataEpoch() !== requestEpoch || !requestScope.isCurrent()) {
      return { status: 'stale' };
    }
    resultDeltas.forEach(({ targets: deltaTargets }) => {
      deltaTargets.forEach(target => {
        if ('axis' in target) {
          touchedKeys.add(target.pathKey);
        }
      });
    });
    currentTree = applyFetchDeltasToTree({
      tree: currentTree,
      deltas: resultDeltas,
      pruneMergedTree,
    });
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
