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
} from '../../types';
import { serializePath } from '../core/path';
import { type LayoutContext } from '../layout/LayoutContext';
import {
  pathsFromAxisScope,
  type PivotAxisCoverageNeed,
} from '../runtime/coverage';
import { type PivotFactStore } from '../runtime/factStore';
import { materializeLoadedPivotTreeFromFactStoreAsync } from '../runtime/materializePivotTree';
import type { PivotProgram } from '../runtime/types';
import {
  type LatestRequestLifecycle,
  yieldToMainThread,
} from '../runtime/requestLifecycle';
import { rootKey } from '../viewModel';
import { fetchPivotExpansion } from './fetchPivotExpansion';
import {
  type ExpansionCoverageTarget,
  planHydrationIteration,
} from './planner';

type AxisSetMap = Record<PivotAxis, Set<string>>;

export const buildExpansionHydrationLoadingKeys = (
  targets: ExpansionCoverageTarget[],
) =>
  new Set(
    targets.flatMap(({ need, pathKey }) =>
      need.rowScope.kind === 'root' || need.columnScope.kind === 'root'
        ? [pathKey]
        : [need.rowScope, need.columnScope]
            .flatMap(pathsFromAxisScope)
            .map(serializePath),
    ),
  );

export const resolveExpansionHydrationLoadingKeys = ({
  targets,
  visibleLoadingKeys,
}: {
  targets: ExpansionCoverageTarget[];
  visibleLoadingKeys?: Set<string>;
}) => visibleLoadingKeys ?? buildExpansionHydrationLoadingKeys(targets);

export const executeExpansionHydrationForIntent = async ({
  axisCoverageNeeds,
  completeBehavior = 'returnTree',
  currentTree,
  expanded,
  getExpanded = () => expanded,
  getCommittedExpanded = () => expanded,
  expansionInstanceId,
  factStore,
  fetchFormData,
  fetchLayout,
  lifecycle,
  onLoadingKeys,
  program,
  queryContextKey,
  visibleLoadingKeys,
}: {
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  completeBehavior?: 'returnTree' | 'skip';
  currentTree: PivotTreeData;
  expanded: AxisSetMap;
  getExpanded?: () => AxisSetMap;
  getCommittedExpanded?: () => AxisSetMap;
  expansionInstanceId: string;
  factStore: PivotFactStore;
  fetchFormData: PivotTableQueryFormData;
  fetchLayout: LayoutContext;
  lifecycle: LatestRequestLifecycle;
  onLoadingKeys: (scopeId: number, loadingKeys: Set<string>) => void;
  program: PivotProgram;
  queryContextKey: string;
  visibleLoadingKeys?: Set<string>;
}) => {
  const rootCoverageNeeds =
    factStore.getFactBatches(queryContextKey).length === 0
      ? fetchLayout.rootCoverageNeeds
      : [];
  const requested = { row: new Set(expanded.row), col: new Set(expanded.col) };
  const plan = planHydrationIteration({
    desired: {
      row: new Set([rootKey, ...requested.row]),
      col: new Set([rootKey, ...requested.col]),
    },
    axisCoverageNeeds,
    rootCoverageNeeds,
    factSelectors: factStore.getCoverageSelectors(queryContextKey),
    program,
    queryContextKey,
  });
  if (plan.kind === 'complete') {
    return completeBehavior === 'returnTree' ? { tree: currentTree } : {};
  }

  const scope = lifecycle.beginScope({
    cancelActive: false,
    latestOnly: false,
  });

  try {
    if (!scope.isCurrent()) {
      return {};
    }

    onLoadingKeys(
      scope.id,
      resolveExpansionHydrationLoadingKeys({
        targets: plan.targets,
        visibleLoadingKeys,
      }),
    );
    const requestGroupId = `${expansionInstanceId}:${scope.id}`;
    scope.beginRequest(requestGroupId);
    try {
      const { warnings } = await fetchPivotExpansion({
        targets: plan.targets,
        layout: fetchLayout,
        requestGroupId,
        formData: fetchFormData,
        factStore,
        shouldContinue: scope.isCurrent,
        yieldToMain: yieldToMainThread,
      });
      const sameSet = (left: Set<string>, right: Set<string>) =>
        left.size === right.size && [...left].every(key => right.has(key));
      const revealableIntent = () => {
        const desired = getExpanded();
        const committed = getCommittedExpanded();
        const bothAxesPending =
          !sameSet(desired.row, committed.row) &&
          !sameSet(desired.col, committed.col);
        const candidate = bothAxesPending
          ? desired
          : {
              row: new Set([...committed.row, ...requested.row]),
              col: new Set([...committed.col, ...requested.col]),
            };
        const ready =
          planHydrationIteration({
            desired: {
              row: new Set([rootKey, ...candidate.row]),
              col: new Set([rootKey, ...candidate.col]),
            },
            axisCoverageNeeds,
            rootCoverageNeeds,
            factSelectors: factStore.getCoverageSelectors(queryContextKey),
            program,
            queryContextKey,
          }).kind === 'complete';
        return ready ? candidate : undefined;
      };
      if (!scope.isCurrent() || !revealableIntent()) return {};
      const tree = await materializeLoadedPivotTreeFromFactStoreAsync({
        store: factStore,
        layout: fetchLayout,
        formData: fetchFormData,
        shouldContinue: scope.isCurrent,
        yieldToMain: yieldToMainThread,
      });
      const revealedExpanded = revealableIntent();
      return scope.isCurrent() && revealedExpanded
        ? { tree, warnings, revealedExpanded }
        : {};
    } finally {
      scope.finish(requestGroupId);
    }
  } finally {
    onLoadingKeys(scope.id, new Set());
  }
};
