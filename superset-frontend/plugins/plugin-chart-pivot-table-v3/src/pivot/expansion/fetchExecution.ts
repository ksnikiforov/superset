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
import { parsePath, serializePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { type LayoutContext } from '../layout/LayoutContext';
import { pathsFromAxisScope } from '../runtime/coverage';
import { type PivotFactStore } from '../runtime/factStore';
import {
  type LatestRequestScope,
  yieldToMainThread,
} from '../runtime/requestLifecycle';
import { stableStringify } from '../shared/stableStringify';
import { planHydrationIteration } from './stateTransitions';
import type { PivotProgram } from '../runtime/types';
import {
  type BatchGroup,
  createExpansionCoverageDiff,
  type ExpansionCoverageTarget,
  type ExpansionFetchTarget,
  isIntersectionCoverageTarget,
} from './planner';
import {
  fetchPivotExpansion,
  type FetchPivotExpansionRequest,
} from './fetchPivotExpansion';

export type ExpansionFetchRuntime = {
  requestScope: LatestRequestScope;
  instanceId: string;
  fetchFormData: PivotTableQueryFormData;
  layout: LayoutContext;
  factStore: PivotFactStore;
  materializeLoadedTree: () => PivotTreeData;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  setLoadingKeys: (keys: Set<string>) => void;
};

type HydrationFetchLoopParams = {
  baseTree: PivotTreeData;
  maxIterations: number;
  isCurrent: () => boolean;
  buildDesiredExpanded: (
    axis: 'row' | 'col',
    tree: PivotTreeData,
  ) => Set<string>;
  program: PivotProgram;
  fetchRuntime: ExpansionFetchRuntime;
};

type ExpansionQueryRequest = Omit<
  FetchPivotExpansionRequest,
  'formData' | 'requestGroupId' | 'factStore'
>;

export const MAX_BATCH_SIBLINGS = 50;

type BatchPlan = {
  batches: BatchGroup[];
  singles: ExpansionCoverageTarget[];
};

type BatchSeed = {
  targets: ExpansionCoverageTarget[];
};

const isNullish = (value: unknown) => value === null || value === undefined;

const chunkTargets = (
  targets: ExpansionCoverageTarget[],
  chunkSize: number,
): ExpansionCoverageTarget[][] => {
  const sorted = [...targets].sort((a, b) =>
    a.pathKey.localeCompare(b.pathKey),
  );
  const chunks: ExpansionCoverageTarget[][] = [];
  for (let idx = 0; idx < sorted.length; idx += chunkSize) {
    chunks.push(sorted.slice(idx, idx + chunkSize));
  }
  return chunks;
};

export const optimizeExpansionFetchPlan = ({
  targets,
  maxBatchSize = MAX_BATCH_SIBLINGS,
}: {
  targets: ExpansionCoverageTarget[];
  maxBatchSize?: number;
}): BatchPlan => {
  const singles: ExpansionCoverageTarget[] = [];
  const groups = new Map<string, BatchSeed>();

  targets.forEach(target => {
    const path = parsePath(target.pathKey);
    if (path.length === 0) {
      singles.push(target);
      return;
    }
    const parentPathKey = serializePath(path.slice(0, -1));
    const siblingValue = path[path.length - 1];
    const groupKey = stableStringify([
      target.axis,
      parentPathKey,
      isNullish(siblingValue) ? 'null' : 'value',
      target.need.rowDepth,
      target.need.columnDepth,
      target.need.rowDimensions,
      target.need.columnDimensions,
      target.need.valueKeys,
      target.axis === 'row' ? target.need.columnScope : target.need.rowScope,
    ]);
    const seed = groups.get(groupKey) ?? { targets: [] };
    seed.targets.push(target);
    groups.set(groupKey, seed);
  });

  const batches: BatchGroup[] = [];
  groups.forEach(seed => {
    chunkTargets(seed.targets, maxBatchSize).forEach(chunk => {
      const group = { targets: chunk };
      if (group.targets.length <= 1) {
        singles.push(...group.targets);
        return;
      }
      batches.push(group);
    });
  });

  return { batches, singles };
};

const buildExpansionRequestGroupId = ({
  runtime,
  request,
}: {
  runtime: ExpansionFetchRuntime;
  request: ExpansionQueryRequest;
}) =>
  stableStringify({
    instanceId: runtime.instanceId,
    transactionId: runtime.requestScope.id,
    request,
  });

const createRuntimeExpansionCoverageDiff = ({
  runtime,
}: {
  runtime: ExpansionFetchRuntime;
}) =>
  createExpansionCoverageDiff({
    factSelectors: runtime.factStore.getCoverageSelectors(),
  });

const resolveExpansionFetchPlan = (
  targets: ExpansionFetchTarget[],
): {
  singles: ExpansionCoverageTarget[];
  batches: BatchGroup[];
  intersections: ExpansionCoverageTarget[];
} => {
  const { batches, singles } = optimizeExpansionFetchPlan({
    targets: targets.filter(target => !isIntersectionCoverageTarget(target)),
  });
  return {
    singles,
    batches,
    intersections: targets.filter(isIntersectionCoverageTarget),
  };
};

const executeExpansionQueryTask = async ({
  request,
  runtime,
}: {
  request: ExpansionQueryRequest;
  runtime: ExpansionFetchRuntime;
}): Promise<void> => {
  const { requestScope, addWarnings } = runtime;
  const requestGroupId = buildExpansionRequestGroupId({ runtime, request });
  const token = requestScope.beginRequest(requestGroupId);
  try {
    const result = await fetchPivotExpansion({
      ...request,
      layout: runtime.layout,
      requestGroupId,
      formData: runtime.fetchFormData,
      factStore: runtime.factStore,
      shouldContinue: requestScope.isCurrent,
      yieldToMain: yieldToMainThread,
    });
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
    }
  } finally {
    requestScope.finish(token);
  }
};

const filterMissingIntersectionTargets = ({
  intersections,
  runtime,
}: {
  intersections: ExpansionCoverageTarget[];
  runtime: ExpansionFetchRuntime;
}) => {
  const missingRequests = createRuntimeExpansionCoverageDiff({
    runtime,
  })(intersections);
  const missingKeys = new Set(
    missingRequests.map(request => stableStringify(request.need)),
  );
  return intersections.filter(target =>
    missingKeys.has(stableStringify(target.need)),
  );
};

const setPhaseLoadingKeys = (
  runtime: ExpansionFetchRuntime,
  loadingKeys: string[],
) => {
  if (runtime.requestScope.isCurrent()) {
    runtime.setLoadingKeys(new Set(loadingKeys));
  }
};

const loadingKeysForIntersection = (target: ExpansionCoverageTarget) => [
  ...pathsFromAxisScope(target.need.rowScope).map(serializePath),
  ...pathsFromAxisScope(target.need.columnScope).map(serializePath),
];

export const fetchExpansionTargetDeltas = async ({
  targets,
  runtime,
}: {
  targets: ExpansionFetchTarget[];
  runtime: ExpansionFetchRuntime;
}): Promise<boolean> => {
  const { batches, singles, intersections } =
    resolveExpansionFetchPlan(targets);
  setPhaseLoadingKeys(runtime, [
    ...singles.map(target => target.pathKey),
    ...batches.flatMap(batch => batch.targets.map(target => target.pathKey)),
  ]);
  const branchFetchPromises: Array<Promise<void>> = [
    ...singles.map(target =>
      executeExpansionQueryTask({
        runtime,
        request: {
          kind: 'branch',
          target,
        },
      }),
    ),
    ...batches.map(batch =>
      executeExpansionQueryTask({
        runtime,
        request: {
          kind: 'batch',
          batch,
        },
      }),
    ),
  ];
  await Promise.all(branchFetchPromises);
  if (!runtime.requestScope.isCurrent()) {
    return false;
  }
  const missingIntersections = filterMissingIntersectionTargets({
    intersections,
    runtime,
  });
  setPhaseLoadingKeys(
    runtime,
    missingIntersections.flatMap(loadingKeysForIntersection),
  );
  await Promise.all(
    missingIntersections.map(target =>
      executeExpansionQueryTask({
        runtime,
        request: {
          kind: 'intersection',
          target,
        },
      }),
    ),
  );
  if (!runtime.requestScope.isCurrent()) {
    return false;
  }
  setPhaseLoadingKeys(runtime, []);
  return branchFetchPromises.length + missingIntersections.length > 0;
};

export const runHydrationExpansionFetchLoop = async ({
  baseTree,
  maxIterations,
  isCurrent,
  buildDesiredExpanded,
  program,
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
      program,
    });
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
      runtime: fetchRuntime,
    });
    currentTree = didFetch ? fetchRuntime.materializeLoadedTree() : currentTree;
    if (!isCurrent()) {
      return { status: 'stale' as const };
    }
  }
  return { status: 'exhausted' as const };
};
