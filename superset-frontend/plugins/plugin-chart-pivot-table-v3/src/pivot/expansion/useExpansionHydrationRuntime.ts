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
import { useCallback, type MutableRefObject } from 'react';
import {
  type PivotAxis,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import {
  type ExpansionVisibilityConfig,
  type HydrationPrefetchAction,
  type PruneMergedTree,
} from './engine';
import {
  type ExpansionFetchRuntime,
  type ExpansionRequestHelpers,
  runHydrationExpansionFetchLoop,
} from './fetchExecution';
import { type ChartDataWarning } from '../data/ChartDataClient';
import {
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { type FetchedFactCoverageState } from './fetchedRequests';
import { type LatestRequestLifecycle } from '../runtime/requestLifecycle';

const MAX_HYDRATION_ITERATIONS = 12;

type ExpansionHydrationCommit = {
  tree?: PivotTreeData;
  expandedRows?: Set<string>;
  expandedCols?: Set<string>;
  pendingRows?: Set<string>;
  pendingCols?: Set<string>;
};

export type HydrateExpansionOptions = {
  showLoader?: boolean;
  activeAxis?: PivotAxis;
  planRows?: boolean;
  planCols?: boolean;
};

export type HydrateExpansionReason = 'prefetch' | 'cross-axis';

export const scheduleInitialHydrationPrefetch = ({
  action,
  shouldPlanRows,
  shouldPlanCols,
  setHydratingState,
  hydrate,
  reportAsyncError,
}: {
  action: HydrationPrefetchAction;
  shouldPlanRows: boolean;
  shouldPlanCols: boolean;
  setHydratingState: (value: boolean) => void;
  hydrate: (
    reason: HydrateExpansionReason,
    options?: HydrateExpansionOptions,
  ) => Promise<void>;
  reportAsyncError: (error: unknown) => void;
}) => {
  if (action.kind === 'idle') {
    return false;
  }
  if (action.kind === 'skip-root') {
    setHydratingState(false);
    return true;
  }
  if (!action.showLoader) {
    setHydratingState(false);
  }
  hydrate('prefetch', {
    showLoader: action.showLoader,
    planRows: shouldPlanRows,
    planCols: shouldPlanCols,
  }).catch(reportAsyncError);
  return true;
};

export const useExpansionHydrationRuntime = ({
  expansionRequestLifecycle,
  expansionRequestHelpers,
  treeRef,
  fetchFormDataRef,
  factStoreRef,
  fetchedCoverageRef,
  pendingRowsRef,
  pendingColsRef,
  clearLoadingState,
  setHydratingState,
  addWarnings,
  updateLoadingKey,
  buildDesiredExpanded,
  visibilityConfig,
  getCoverageKey,
  pruneMergedTree,
  seedFetchedCoverageFromFactBatches,
  seedFetchedCoverageFromLoadedMetricNodes,
  resolveExpandedForMetrics,
  commitExpansionState,
  persistExpansionState,
}: {
  expansionRequestLifecycle: LatestRequestLifecycle;
  expansionRequestHelpers: ExpansionRequestHelpers;
  treeRef: MutableRefObject<PivotTreeData>;
  fetchFormDataRef: MutableRefObject<PivotTableQueryFormData>;
  factStoreRef: MutableRefObject<PivotFactStore | undefined>;
  fetchedCoverageRef: MutableRefObject<FetchedFactCoverageState>;
  pendingRowsRef: MutableRefObject<Set<string>>;
  pendingColsRef: MutableRefObject<Set<string>>;
  clearLoadingState: () => void;
  setHydratingState: (value: boolean) => void;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  updateLoadingKey: (key: string, delta: number) => void;
  buildDesiredExpanded: (axis: PivotAxis, tree: PivotTreeData) => Set<string>;
  visibilityConfig: ExpansionVisibilityConfig;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
  pruneMergedTree: PruneMergedTree;
  seedFetchedCoverageFromFactBatches: (batches: PivotFactStoreBatch[]) => void;
  seedFetchedCoverageFromLoadedMetricNodes: (
    loadedTree: PivotTreeData,
    visibleRowDepth: number,
    visibleColDepth: number,
  ) => void;
  resolveExpandedForMetrics: (
    axis: PivotAxis,
    nextExpanded: Set<string>,
    nextTree: PivotTreeData,
  ) => Set<string>;
  commitExpansionState: (commit: ExpansionHydrationCommit) => void;
  persistExpansionState: (nextRows: Set<string>, nextCols: Set<string>) => void;
}) =>
  useCallback(
    async (
      reason: HydrateExpansionReason,
      options?: HydrateExpansionOptions,
    ) => {
      const shouldShowLoader = options?.showLoader ?? false;
      const shouldPlanRows = options?.planRows ?? true;
      const shouldPlanCols = options?.planCols ?? true;
      const requestScope = expansionRequestLifecycle.beginScope();
      const transactionId = requestScope.id;
      clearLoadingState();
      if (shouldShowLoader) {
        setHydratingState(true);
      }

      try {
        const fetchRuntime: ExpansionFetchRuntime = {
          requestScope,
          fetchFormData: fetchFormDataRef.current,
          factStore: factStoreRef.current,
          trackRequestInScope: expansionRequestHelpers.trackRequestInScope,
          addWarnings,
          updateLoadingKey,
        };
        const result = await runHydrationExpansionFetchLoop({
          reason,
          baseTree: treeRef.current,
          maxIterations: MAX_HYDRATION_ITERATIONS,
          isCurrent: requestScope.isCurrent,
          buildDesiredExpanded,
          fetchedCoverage: fetchedCoverageRef.current,
          config: visibilityConfig,
          getCoverageKey,
          activeAxis: options?.activeAxis,
          pendingRows: pendingRowsRef.current,
          pendingCols: pendingColsRef.current,
          planRows: shouldPlanRows,
          planCols: shouldPlanCols,
          pruneMergedTree,
          fetchRuntime,
          transactionId,
          buildRequestGroupId: expansionRequestHelpers.buildRequestGroupId,
          seedFetchedCoverage: seedFetchedCoverageFromFactBatches,
          seedLoadedMetricNodeCoverage:
            seedFetchedCoverageFromLoadedMetricNodes,
        });
        if (result.status === 'complete') {
          const resolvedRows = resolveExpandedForMetrics(
            'row',
            result.desiredRows,
            result.tree,
          );
          const resolvedCols = resolveExpandedForMetrics(
            'col',
            result.desiredCols,
            result.tree,
          );
          commitExpansionState({
            tree: result.tree,
            expandedRows: resolvedRows,
            expandedCols: resolvedCols,
            pendingRows: new Set(),
            pendingCols: new Set(),
          });
          if (reason === 'cross-axis') {
            persistExpansionState(resolvedRows, resolvedCols);
          }
        }
      } finally {
        if (shouldShowLoader) {
          setHydratingState(false);
        }
      }
    },
    [
      addWarnings,
      buildDesiredExpanded,
      clearLoadingState,
      commitExpansionState,
      expansionRequestHelpers,
      expansionRequestLifecycle,
      factStoreRef,
      fetchedCoverageRef,
      fetchFormDataRef,
      getCoverageKey,
      pendingColsRef,
      pendingRowsRef,
      persistExpansionState,
      pruneMergedTree,
      resolveExpandedForMetrics,
      seedFetchedCoverageFromFactBatches,
      seedFetchedCoverageFromLoadedMetricNodes,
      setHydratingState,
      treeRef,
      updateLoadingKey,
      visibilityConfig,
    ],
  );
