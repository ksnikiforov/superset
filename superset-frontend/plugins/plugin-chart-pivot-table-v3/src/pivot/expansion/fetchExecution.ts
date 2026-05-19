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
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { type LayoutContext } from '../layout/LayoutContext';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
  type FetchTarget,
} from '../query/fetchPlanOptimizer';
import { buildFactValueKeys, type PivotFactStore } from '../runtime/factStore';
import { type LatestRequestScope } from '../runtime/requestLifecycle';
import { createExpansionCoverageDiff } from '../runtime/coverage';
import { stableStringify } from '../shared/stableStringify';
import {
  planHydrationIteration,
  type ExpansionPlanningConfig,
} from './stateTransitions';
import {
  type ExpansionFetchTarget,
  type IntersectionFetchTarget,
  isIntersectionFetchTarget,
} from './planner';
import { rootKey } from '../viewModel';
import {
  fetchPivotExpansion,
  type FetchPivotExpansionRequest,
} from './fetchPivotExpansion';

export type ExpansionFetchRuntime = {
  requestScope: LatestRequestScope;
  instanceId: string;
  fetchFormData: PivotTableQueryFormData;
  layout: LayoutContext;
  factStore?: PivotFactStore;
  materializeLoadedTree: () => PivotTreeData;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  updateLoadingKey: (key: string, delta: number) => void;
};

export type ExpansionFetchContext = {
  visibleRowDepth: number;
  visibleColDepth: number;
};

type HydrationFetchLoopParams = {
  baseTree: PivotTreeData;
  maxIterations: number;
  isCurrent: () => boolean;
  buildDesiredExpanded: (
    axis: 'row' | 'col',
    tree: PivotTreeData,
  ) => Set<string>;
  config: ExpansionPlanningConfig;
  fetchRuntime: ExpansionFetchRuntime;
};

type ExpansionQueryRequest = Omit<
  FetchPivotExpansionRequest,
  'formData' | 'requestGroupId' | 'factStore'
>;

const buildExpansionRequestGroupId = ({
  runtime,
  payload,
}: {
  runtime: ExpansionFetchRuntime;
  payload: Record<string, unknown>;
}) =>
  stableStringify({
    instanceId: runtime.instanceId,
    transactionId: runtime.requestScope.id,
    ...payload,
  });

const createRuntimeExpansionCoverageDiff = ({
  runtime,
}: {
  runtime: ExpansionFetchRuntime;
}) =>
  createExpansionCoverageDiff({
    factSelectors: runtime.factStore?.getCoverageSelectors() ?? [],
    program: runtime.layout.pivotProgram,
    valueKeys: buildFactValueKeys({
      metricKeys: runtime.layout.pivotProgram.metricKeys,
    }),
  });

const resolveExpansionFetchPlan = ({
  targets,
  visibleRowDepth,
  visibleColDepth,
}: {
  targets: ExpansionFetchTarget[];
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
    const batchSignature = `${target.axis}|${visibleRowDepth}|${visibleColDepth}`;
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

const executeExpansionQueryTask = async ({
  payload,
  request,
  runtime,
  loadingKeys,
}: {
  payload: Record<string, unknown>;
  request: ExpansionQueryRequest;
  runtime: ExpansionFetchRuntime;
  loadingKeys: string[];
}): Promise<void> => {
  const { requestScope, updateLoadingKey, addWarnings } = runtime;
  if (requestScope.isCurrent()) {
    loadingKeys.forEach(key => updateLoadingKey(key, 1));
  }
  const requestGroupId = buildExpansionRequestGroupId({ runtime, payload });
  const token = requestScope.beginRequest(requestGroupId);
  try {
    const result = await fetchPivotExpansion({
      ...request,
      layout: runtime.layout,
      requestGroupId,
      formData: runtime.fetchFormData,
      factStore: runtime.factStore,
    });
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
    }
  } finally {
    requestScope.finish(token);
    if (requestScope.isCurrent()) {
      loadingKeys.forEach(key => updateLoadingKey(key, -1));
    }
  }
};

const filterMissingIntersectionTargets = ({
  intersections,
  context,
  runtime,
}: {
  intersections: IntersectionFetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
}) => {
  const missingRequests = createRuntimeExpansionCoverageDiff({
    runtime,
  })(
    intersections.map(target => ({
      axis: 'row' as const,
      pathKey: rootKey,
      rowDepth: context.visibleRowDepth,
      columnDepth: context.visibleColDepth,
      rowPathKeys: target.rowPathKeys,
      columnPathKeys: target.columnPathKeys,
    })),
  );
  const missingKeys = new Set(
    missingRequests.map(request =>
      stableStringify([
        request.rowPathKeys ?? [],
        request.columnPathKeys ?? [],
      ]),
    ),
  );
  return intersections.filter(target =>
    missingKeys.has(
      stableStringify([target.rowPathKeys, target.columnPathKeys]),
    ),
  );
};

export const fetchExpansionTargetDeltas = async ({
  targets,
  context,
  runtime,
}: {
  targets: ExpansionFetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
}): Promise<boolean> => {
  const { batches, singles, intersections } = resolveExpansionFetchPlan({
    targets,
    visibleRowDepth: context.visibleRowDepth,
    visibleColDepth: context.visibleColDepth,
  });
  const { visibleRowDepth, visibleColDepth } = context;
  const branchFetchPromises: Array<Promise<void>> = [
    ...singles.map(target =>
      executeExpansionQueryTask({
        runtime,
        payload: {
          kind: 'branch',
          ...target,
          visibleRowDepth,
          visibleColDepth,
        },
        request: {
          kind: 'branch',
          axis: target.axis,
          path: parsePath(target.pathKey),
          visibleRowDepth,
          visibleColDepth,
        },
        loadingKeys: [target.pathKey],
      }),
    ),
    ...batches.map(batch =>
      executeExpansionQueryTask({
        runtime,
        payload: {
          kind: 'batch',
          axis: batch.axis,
          parentPathKey: batch.parentPathKey,
          signature: batch.signature,
          targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
          visibleRowDepth,
          visibleColDepth,
        },
        request: {
          kind: 'batch',
          batch,
          visibleRowDepth,
          visibleColDepth,
        },
        loadingKeys: batch.targets.map(target => target.pathKey),
      }),
    ),
  ];
  await Promise.all(branchFetchPromises);
  if (!runtime.requestScope.isCurrent()) {
    return false;
  }
  const missingIntersections = filterMissingIntersectionTargets({
    intersections,
    context,
    runtime,
  });
  await Promise.all(
    missingIntersections.map(target =>
      executeExpansionQueryTask({
        runtime,
        payload: {
          kind: 'hydrate:intersection',
          rowPathKeys: [...target.rowPathKeys].sort(),
          columnPathKeys: [...target.columnPathKeys].sort(),
          visibleRowDepth,
          visibleColDepth,
        },
        request: {
          kind: 'intersection',
          rowPathKeys: target.rowPathKeys,
          columnPathKeys: target.columnPathKeys,
          visibleRowDepth,
          visibleColDepth,
        },
        loadingKeys: [...target.rowPathKeys, ...target.columnPathKeys],
      }),
    ),
  );
  if (!runtime.requestScope.isCurrent()) {
    return false;
  }
  return branchFetchPromises.length + missingIntersections.length > 0;
};

export const runHydrationExpansionFetchLoop = async ({
  baseTree,
  maxIterations,
  isCurrent,
  buildDesiredExpanded,
  config,
  fetchRuntime,
}: HydrationFetchLoopParams) => {
  let currentTree = baseTree;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (!isCurrent()) {
      return { status: 'stale' as const };
    }
    const desiredRows = buildDesiredExpanded('row', currentTree);
    const desiredCols = buildDesiredExpanded('col', currentTree);
    const hydrationPlan = planHydrationIteration({
      tree: currentTree,
      desiredRows,
      desiredCols,
      getMissingExpansionCoverage: createRuntimeExpansionCoverageDiff({
        runtime: fetchRuntime,
      }),
      config,
    });
    const { visibleRowDepth, visibleColDepth } = hydrationPlan;

    if (hydrationPlan.kind === 'complete') {
      return {
        status: 'complete' as const,
        tree: currentTree,
        desiredRows,
        desiredCols,
      };
    }

    // eslint-disable-next-line no-await-in-loop
    const didFetch = await fetchExpansionTargetDeltas({
      targets: hydrationPlan.targets,
      context: { visibleRowDepth, visibleColDepth },
      runtime: fetchRuntime,
    });
    currentTree = didFetch ? fetchRuntime.materializeLoadedTree() : currentTree;
    if (!isCurrent()) {
      return { status: 'stale' as const };
    }
  }
  return { status: 'exhausted' as const };
};
