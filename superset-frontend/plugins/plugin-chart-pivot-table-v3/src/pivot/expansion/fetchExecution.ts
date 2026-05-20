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
  materializeLoadedTree: () => Promise<PivotTreeData>;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  setLoadingKeys: (keys: Set<string>) => void;
};

type HydrationFetchLoopParams = {
  baseTree: PivotTreeData;
  maxIterations: number;
  buildDesiredExpanded: (
    axis: 'row' | 'col',
    tree: PivotTreeData,
  ) => Set<string>;
  program: PivotProgram;
  fetchRuntime: ExpansionFetchRuntime;
};

const executeExpansionQueryTask = async ({
  targets,
  runtime,
}: {
  targets: ExpansionCoverageTarget[];
  runtime: ExpansionFetchRuntime;
}): Promise<boolean> => {
  const { requestScope, addWarnings } = runtime;
  const requestGroupId = `${runtime.instanceId}:${requestScope.id}`;
  requestScope.beginRequest(requestGroupId);
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
    requestScope.finish(requestGroupId);
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
  if (runtime.requestScope.isCurrent()) {
    runtime.setLoadingKeys(new Set(targets.flatMap(loadingKeysForTarget)));
  }
  const didFetch = await executeExpansionQueryTask({
    targets,
    runtime,
  });
  if (!runtime.requestScope.isCurrent()) {
    return false;
  }
  runtime.setLoadingKeys(new Set());
  return didFetch;
};

export const runHydrationExpansionFetchLoop = async ({
  baseTree,
  maxIterations,
  buildDesiredExpanded,
  program,
  fetchRuntime,
}: HydrationFetchLoopParams) => {
  let currentTree = baseTree;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (!fetchRuntime.requestScope.isCurrent()) {
      return { status: 'stale' as const };
    }
    const treeForIteration = currentTree;
    const desired = {
      row: buildDesiredExpanded('row', treeForIteration),
      col: buildDesiredExpanded('col', treeForIteration),
    };
    const hydrationPlan = planHydrationIteration({
      tree: treeForIteration,
      desired,
      factSelectors: fetchRuntime.factStore.getCoverageSelectors(),
      program,
    });
    if (hydrationPlan.kind === 'complete') {
      return {
        status: 'complete' as const,
        tree: treeForIteration,
        desired,
      };
    }

    // eslint-disable-next-line no-await-in-loop
    const didFetch = await fetchExpansionTargetDeltas({
      targets: hydrationPlan.targets,
      runtime: fetchRuntime,
    });
    if (didFetch) {
      // eslint-disable-next-line no-await-in-loop
      currentTree = await fetchRuntime.materializeLoadedTree();
    }
    if (!fetchRuntime.requestScope.isCurrent()) {
      return { status: 'stale' as const };
    }
  }
  return { status: 'exhausted' as const };
};
