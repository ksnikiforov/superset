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
import { serializePath } from '../core/path';
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
import { type ExpansionCoverageTarget } from './planner';
import { fetchPivotExpansion } from './fetchPivotExpansion';

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

const buildExpansionRequestGroupId = ({
  runtime,
  targets,
}: {
  runtime: ExpansionFetchRuntime;
  targets: ExpansionCoverageTarget[];
}) =>
  stableStringify({
    instanceId: runtime.instanceId,
    transactionId: runtime.requestScope.id,
    targets,
  });

const executeExpansionQueryTask = async ({
  targets,
  runtime,
}: {
  targets: ExpansionCoverageTarget[];
  runtime: ExpansionFetchRuntime;
}): Promise<boolean> => {
  const { requestScope, addWarnings } = runtime;
  const requestGroupId = buildExpansionRequestGroupId({ runtime, targets });
  const token = requestScope.beginRequest(requestGroupId);
  try {
    const result = await fetchPivotExpansion({
      targets,
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
    return Boolean(result.didFetch);
  } finally {
    requestScope.finish(token);
  }
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

const loadingKeysForTarget = (target: ExpansionCoverageTarget) => {
  if (
    target.need.rowScope.kind !== 'root' &&
    target.need.columnScope.kind !== 'root'
  ) {
    return loadingKeysForIntersection(target);
  }
  return [target.pathKey];
};

export const fetchExpansionTargetDeltas = async ({
  targets,
  runtime,
}: {
  targets: ExpansionCoverageTarget[];
  runtime: ExpansionFetchRuntime;
}): Promise<boolean> => {
  setPhaseLoadingKeys(runtime, targets.flatMap(loadingKeysForTarget));
  const didFetch = await executeExpansionQueryTask({
    targets,
    runtime,
  });
  if (!runtime.requestScope.isCurrent()) {
    return false;
  }
  setPhaseLoadingKeys(runtime, []);
  return didFetch;
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
      factSelectors: fetchRuntime.factStore.getCoverageSelectors(),
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
