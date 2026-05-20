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
import { type PivotFactStore } from '../runtime/factStore';
import {
  type LatestRequestScope,
  yieldToMainThread,
} from '../runtime/requestLifecycle';
import { stableStringify } from '../shared/stableStringify';
import { planHydrationIteration } from './stateTransitions';
import type { PivotProgram } from '../runtime/types';
import {
  type BatchCandidate,
  type BatchGroup,
  createExpansionCoverageDiff,
  type ExpansionFetchTarget,
  type FetchTarget,
  type IntersectionFetchTarget,
  isIntersectionFetchTarget,
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
  updateLoadingKey: (key: string, delta: number) => void;
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
  singles: BatchCandidate[];
};

type CandidateWithPath = BatchCandidate & {
  parentPathKey: string;
  siblingValue: BatchGroup['siblingValues'][number];
};

type BatchGroupSeed = {
  axis: BatchGroup['axis'];
  signature: string;
  parentPathKey: string;
  nonNullTargets: CandidateWithPath[];
  nullTargets: CandidateWithPath[];
};

const isNullish = (value: unknown) => value === null || value === undefined;

const chunkTargets = (
  targets: CandidateWithPath[],
  chunkSize: number,
): CandidateWithPath[][] => {
  const sorted = [...targets].sort((a, b) =>
    a.pathKey.localeCompare(b.pathKey),
  );
  const chunks: CandidateWithPath[][] = [];
  for (let idx = 0; idx < sorted.length; idx += chunkSize) {
    chunks.push(sorted.slice(idx, idx + chunkSize));
  }
  return chunks;
};

const buildBatchGroups = (
  seed: BatchGroupSeed,
  targets: CandidateWithPath[],
  maxBatchSize: number,
): BatchGroup[] =>
  chunkTargets(targets, maxBatchSize).map(chunk => ({
    axis: seed.axis,
    signature: seed.signature,
    parentPathKey: seed.parentPathKey,
    siblingValues: chunk.map(target => target.siblingValue),
    targets: chunk,
  }));

export const optimizeExpansionFetchPlan = ({
  targets,
  maxBatchSize = MAX_BATCH_SIBLINGS,
}: {
  targets: BatchCandidate[];
  maxBatchSize?: number;
}): BatchPlan => {
  const singles: BatchCandidate[] = [];
  const groups = new Map<string, BatchGroupSeed>();

  targets.forEach(target => {
    const path = parsePath(target.pathKey);
    if (path.length === 0) {
      singles.push(target);
      return;
    }
    const parentPathKey = serializePath(path.slice(0, -1));
    const siblingValue = path[path.length - 1];
    const groupKey = JSON.stringify([
      target.axis,
      target.batchSignature,
      parentPathKey,
    ]);
    const seed = groups.get(groupKey) ?? {
      axis: target.axis,
      signature: target.batchSignature,
      parentPathKey,
      nonNullTargets: [],
      nullTargets: [],
    };
    const candidate = {
      ...target,
      parentPathKey,
      siblingValue,
    };
    if (isNullish(siblingValue)) {
      seed.nullTargets.push(candidate);
    } else {
      seed.nonNullTargets.push(candidate);
    }
    groups.set(groupKey, seed);
  });

  const batches: BatchGroup[] = [];
  groups.forEach(seed => {
    [
      ...buildBatchGroups(seed, seed.nonNullTargets, maxBatchSize),
      ...buildBatchGroups(seed, seed.nullTargets, maxBatchSize),
    ].forEach(group => {
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
  singles: FetchTarget[];
  batches: BatchGroup[];
  intersections: IntersectionFetchTarget[];
} => {
  const batchCandidates: BatchCandidate[] = [];
  for (const target of targets) {
    if (isIntersectionFetchTarget(target)) {
      continue;
    }
    const { rowDepth, columnDepth } = target.coverageTarget.need;
    const batchSignature = `${target.axis}|${rowDepth}|${columnDepth}`;
    batchCandidates.push({ ...target, batchSignature });
  }
  const { batches, singles } = optimizeExpansionFetchPlan({
    targets: batchCandidates,
  });
  return {
    singles,
    batches,
    intersections: targets.filter(isIntersectionFetchTarget),
  };
};

const executeExpansionQueryTask = async ({
  request,
  runtime,
  loadingKeys,
}: {
  request: ExpansionQueryRequest;
  runtime: ExpansionFetchRuntime;
  loadingKeys: string[];
}): Promise<void> => {
  const { requestScope, updateLoadingKey, addWarnings } = runtime;
  if (requestScope.isCurrent()) {
    loadingKeys.forEach(key => updateLoadingKey(key, 1));
  }
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
    if (requestScope.isCurrent()) {
      loadingKeys.forEach(key => updateLoadingKey(key, -1));
    }
  }
};

const filterMissingIntersectionTargets = ({
  intersections,
  runtime,
}: {
  intersections: IntersectionFetchTarget[];
  runtime: ExpansionFetchRuntime;
}) => {
  const missingRequests = createRuntimeExpansionCoverageDiff({
    runtime,
  })(intersections.map(target => target.coverageTarget));
  const missingKeys = new Set(
    missingRequests.map(request => stableStringify(request.need)),
  );
  return intersections.filter(target =>
    missingKeys.has(stableStringify(target.coverageTarget.need)),
  );
};

export const fetchExpansionTargetDeltas = async ({
  targets,
  runtime,
}: {
  targets: ExpansionFetchTarget[];
  runtime: ExpansionFetchRuntime;
}): Promise<boolean> => {
  const { batches, singles, intersections } =
    resolveExpansionFetchPlan(targets);
  const branchFetchPromises: Array<Promise<void>> = [
    ...singles.map(target =>
      executeExpansionQueryTask({
        runtime,
        request: {
          kind: 'branch',
          target,
        },
        loadingKeys: [target.pathKey],
      }),
    ),
    ...batches.map(batch =>
      executeExpansionQueryTask({
        runtime,
        request: {
          kind: 'batch',
          batch,
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
    runtime,
  });
  await Promise.all(
    missingIntersections.map(target =>
      executeExpansionQueryTask({
        runtime,
        request: {
          kind: 'intersection',
          target,
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
