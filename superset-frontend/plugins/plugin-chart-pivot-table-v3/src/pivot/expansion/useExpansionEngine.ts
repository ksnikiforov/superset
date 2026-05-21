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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import {
  type HandlerFunction,
  type JsonObject,
  type SetDataMaskHook,
} from '@superset-ui/core';
import { nanoid } from 'nanoid';
import {
  type PivotAxis,
  type PivotExpansionState,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  buildDesiredExpandedKeys,
  type PivotExpansionStateKeys,
  coerceExpansionState,
} from './stateModel';
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { stableStringify } from '../shared/stableStringify';
import { type LayoutContext } from '../layout/LayoutContext';
import type { PivotProgram } from '../runtime/types';
import {
  buildPivotFactQueryContextKey,
  createPivotFactStoreFromBatches,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { type PivotAxisCoverageNeed } from '../runtime/coverage';
import {
  PIVOT_AXES,
  resolveCollapsedExpansionState,
  resolveExpansionToggleDecision,
  resolveReinitializedExpansionState,
  resolveExpandedForMetrics as resolveExpandedForMetricsBase,
  resolveLayoutTransition,
} from './stateTransitions';
import {
  buildExpandedKeysForCoverageNeeds,
  planHydrationIteration,
} from './planner';
import { useSyncRef } from '../shared/useSyncRef';
import { createLatestRequestLifecycle } from '../runtime/requestLifecycle';
import { StaleChunkedWorkError } from '../runtime/chunkedWork';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { getStableColumnKey } from '../../utils';
import { executeExpansionHydration } from './hydrationExecutor';
import { rootKey } from '../viewModel';

type AxisSetMap = Record<PivotAxis, Set<string>>;
type ExpansionIntentSets = {
  expanded: AxisSetMap;
  collapsed: AxisSetMap;
};
type ExpansionStateCommit = {
  tree?: PivotTreeData;
  expanded?: Partial<AxisSetMap>;
};

const createEmptyExpansionState = (): PivotExpansionStateKeys => ({
  rows: [],
  cols: [],
  collapsedRows: [],
  collapsedCols: [],
});

const expansionStateKeysToIntent = (
  state: PivotExpansionStateKeys,
): ExpansionIntentSets => ({
  expanded: {
    row: new Set(state.rows),
    col: new Set(state.cols),
  },
  collapsed: {
    row: new Set(state.collapsedRows),
    col: new Set(state.collapsedCols),
  },
});

const expansionIntentToStateKeys = (
  intent: ExpansionIntentSets,
): PivotExpansionStateKeys => ({
  rows: Array.from(intent.expanded.row).filter(key => key !== rootKey),
  cols: Array.from(intent.expanded.col).filter(key => key !== rootKey),
  collapsedRows: Array.from(intent.collapsed.row).filter(
    key => key !== rootKey,
  ),
  collapsedCols: Array.from(intent.collapsed.col).filter(
    key => key !== rootKey,
  ),
});

type ExpansionPersistenceDeps = {
  shouldPersist: boolean;
  setControlValue?: HandlerFunction;
  setDataMask?: SetDataMaskHook;
  mergeOwnState?: (partial: JsonObject) => JsonObject;
};

const toPersistedPayload = (
  state: PivotExpansionStateKeys,
): PivotExpansionState => {
  const toPathArray = (keys: string[]) => keys.map(key => parsePath(key));
  return {
    rows: toPathArray(state.rows),
    cols: toPathArray(state.cols),
    collapsedRows: toPathArray(state.collapsedRows ?? []),
    collapsedCols: toPathArray(state.collapsedCols ?? []),
  };
};

const persistExpansionStateKeys = (
  state: PivotExpansionStateKeys,
  deps: ExpansionPersistenceDeps,
) => {
  if (!deps.shouldPersist) {
    return;
  }
  const payload = toPersistedPayload(state);
  if (deps.setControlValue) {
    deps.setControlValue('pivotExpansionState', payload);
    return;
  }
  if (deps.setDataMask && deps.mergeOwnState) {
    const nextOwnState = deps.mergeOwnState({ pivotExpansionState: payload });
    deps.setDataMask({ ownState: { ...nextOwnState } });
  }
};

export type ExpansionEngineResult = {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  loadingKeys: Set<string>;
  errorMessage?: string;
  warnings: ChartDataWarning[];
  handleToggle: (axis: PivotAxis, node: PivotTreeNode) => void;
  handleRetry: () => void;
};

export type ExpansionEngineConfig = {
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  onFactBatchesChange?: (factBatches: PivotFactStoreBatch[]) => void;
  expansionSemanticSignature: string;
  fetchFormData: PivotTableQueryFormData;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  pivotProgram: PivotProgram;
  fetchLayout: LayoutContext;
  setControlValue?: HandlerFunction;
  setDataMask?: SetDataMaskHook;
  mergeOwnState?: (partial: JsonObject) => JsonObject;
  persistedExpansionState?: unknown;
  shouldPersistExpansionState: boolean;
};

export const useExpansionEngine = ({
  data,
  factBatches,
  onFactBatchesChange,
  expansionSemanticSignature,
  fetchFormData,
  axisCoverageNeeds,
  pivotProgram,
  fetchLayout,
  setControlValue,
  setDataMask,
  mergeOwnState,
  persistedExpansionState,
  shouldPersistExpansionState,
}: ExpansionEngineConfig): ExpansionEngineResult => {
  const [tree, setTree] = useState<PivotTreeData>(data);
  const treeRef = useRef(tree);
  const factStoreRef = useRef<PivotFactStore>();
  if (!factStoreRef.current) {
    factStoreRef.current = createPivotFactStoreFromBatches(factBatches);
  }
  const [expandedByAxis, setExpandedByAxis] = useState<AxisSetMap>(() => ({
    row: new Set(),
    col: new Set(),
  }));
  const { row: expandedRows, col: expandedCols } = expandedByAxis;
  const expandedRef = useRef(expandedByAxis);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const initialExpansionState =
    coerceExpansionState(persistedExpansionState) ??
    createEmptyExpansionState();
  const expansionIntentRef = useRef<ExpansionIntentSets>(
    expansionStateKeysToIntent(initialExpansionState),
  );
  const [errorMessage, setErrorMessage] = useState<string>();
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const expansionSemanticSignatureRef = useRef<string | null>(null);
  const expansionInstanceId = useMemo(nanoid, []);
  const expansionRequestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );
  const queryContextKey = useMemo(
    () => buildPivotFactQueryContextKey(fetchFormData),
    [fetchFormData],
  );

  const expansionPersistenceDepsRef = useRef<ExpansionPersistenceDeps>({
    shouldPersist: shouldPersistExpansionState,
    setControlValue,
    setDataMask,
    mergeOwnState,
  });
  expansionPersistenceDepsRef.current = {
    shouldPersist: shouldPersistExpansionState,
    setControlValue,
    setDataMask,
    mergeOwnState,
  };
  const previousDataRef = useRef<PivotTreeData | null>(null);
  const groupbyRowKeys = useMemo(
    () => pivotProgram.rowDimensions.map(getStableColumnKey),
    [pivotProgram.rowDimensions],
  );
  const groupbyColumnKeys = useMemo(
    () => pivotProgram.columnDimensions.map(getStableColumnKey),
    [pivotProgram.columnDimensions],
  );
  const previousLayoutRef = useRef({
    rows: groupbyRowKeys,
    cols: groupbyColumnKeys,
  });

  useEffect(
    () => () => {
      expansionRequestLifecycle.invalidate();
    },
    [expansionRequestLifecycle],
  );

  useSyncRef(treeRef, tree);
  useSyncRef(expandedRef, expandedByAxis);

  const commitExpansionState = useCallback(
    ({ tree: nextTree, expanded: nextExpanded }: ExpansionStateCommit) => {
      if (nextTree) {
        treeRef.current = nextTree;
      }
      PIVOT_AXES.forEach(axis => {
        const expanded = nextExpanded?.[axis];
        if (expanded) {
          expandedRef.current[axis] = expanded;
        }
      });
      unstable_batchedUpdates(() => {
        if (nextTree) {
          setTree(nextTree);
        }
        if (nextExpanded?.row || nextExpanded?.col) {
          setExpandedByAxis(current => ({
            row: nextExpanded.row ?? current.row,
            col: nextExpanded.col ?? current.col,
          }));
        }
      });
    },
    [],
  );

  const reportAsyncError = useCallback(
    (error: unknown) => {
      if (error instanceof StaleChunkedWorkError) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      expansionRequestLifecycle.invalidate();
      setLoadingKeys(new Set());
      setErrorMessage(message);
    },
    [expansionRequestLifecycle],
  );

  const addWarnings = useCallback((nextWarnings?: ChartDataWarning[]) => {
    if (!nextWarnings || nextWarnings.length === 0) {
      return;
    }
    setWarnings(current => {
      const map = new Map(
        current.map(warning => [stableStringify(warning), warning]),
      );
      nextWarnings.forEach(warning => {
        map.set(stableStringify(warning), warning);
      });
      const next = Array.from(map.values());
      if (next.length === current.length) {
        return current;
      }
      return next;
    });
  }, []);

  const persistExpansionState = useCallback(() => {
    persistExpansionStateKeys(
      expansionIntentToStateKeys(expansionIntentRef.current),
      expansionPersistenceDepsRef.current,
    );
  }, []);

  const resolveExpandedForMetrics = useCallback(
    (axis: PivotAxis, nextExpanded: Set<string>, nextTree: PivotTreeData) =>
      resolveExpandedForMetricsBase({
        axis,
        expanded: nextExpanded,
        tree: nextTree,
        collapsed: expansionIntentRef.current.collapsed[axis],
        program: pivotProgram,
        isLeafTierVisible:
          fetchLayout.measureHierarchy.leafTierVisibility === 'visible',
      }),
    [fetchLayout.measureHierarchy.leafTierVisibility, pivotProgram],
  );

  const resolveExpandedByAxisForMetrics = useCallback(
    (expanded: AxisSetMap, nextTree: PivotTreeData): AxisSetMap =>
      Object.fromEntries(
        PIVOT_AXES.map(axis => [
          axis,
          resolveExpandedForMetrics(axis, expanded[axis], nextTree),
        ]),
      ) as AxisSetMap,
    [resolveExpandedForMetrics],
  );

  const buildDesiredExpanded = useCallback(
    (axis: PivotAxis, nextTree: PivotTreeData) => {
      const nodes = axis === 'row' ? nextTree.rows : nextTree.cols;
      const baseExpanded = buildExpandedKeysForCoverageNeeds({
        axis,
        tree: nextTree,
        axisCoverageNeeds,
        program: pivotProgram,
      });
      return buildDesiredExpandedKeys({
        axis,
        nodes,
        baseExpanded,
        program: pivotProgram,
        manualExpanded: expansionIntentRef.current.expanded[axis],
        manualCollapsed: expansionIntentRef.current.collapsed[axis],
      });
    },
    [axisCoverageNeeds, pivotProgram],
  );

  const collapseNode = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded = expandedRef.current[axis];
      const nodes =
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols;
      const collapsedState = resolveCollapsedExpansionState({
        node,
        expanded,
        manualExpanded: expansionIntentRef.current.expanded[axis],
        manualCollapsed: expansionIntentRef.current.collapsed[axis],
        nodes,
      });
      expansionIntentRef.current.expanded[axis] =
        collapsedState.nextManualExpanded;
      expansionIntentRef.current.collapsed[axis] =
        collapsedState.nextManualCollapsed;

      const resolvedExpanded = resolveExpandedForMetrics(
        axis,
        collapsedState.nextExpanded,
        treeRef.current,
      );
      commitExpansionState({
        expanded: { [axis]: resolvedExpanded },
      });
      persistExpansionState();
    },
    [commitExpansionState, persistExpansionState, resolveExpandedForMetrics],
  );

  const planHydrationFromIntent = useCallback(() => {
    const factStore = factStoreRef.current as PivotFactStore;
    return planHydrationIteration({
      desired: {
        row: new Set([rootKey, ...expansionIntentRef.current.expanded.row]),
        col: new Set([rootKey, ...expansionIntentRef.current.expanded.col]),
      },
      axisCoverageNeeds,
      factSelectors: factStore.getCoverageSelectors(queryContextKey),
      program: pivotProgram,
      queryContextKey,
    });
  }, [axisCoverageNeeds, pivotProgram, queryContextKey]);

  const hydrateAtomic = useCallback(
    async (persistOnComplete = false) => {
      const factStore = factStoreRef.current as PivotFactStore;
      const plan = planHydrationFromIntent();

      const result =
        plan.kind === 'complete'
          ? { tree: treeRef.current }
          : await executeExpansionHydration({
              expansionInstanceId,
              factStore,
              fetchFormData,
              fetchLayout,
              onLoadingKeys: setLoadingKeys,
              targets: plan.targets,
              lifecycle: expansionRequestLifecycle,
            });
      if (!result.tree) {
        return;
      }
      addWarnings('warnings' in result ? result.warnings : undefined);
      onFactBatchesChange?.(factStore.getFactBatches());
      commitExpansionState({
        tree: result.tree,
        expanded: resolveExpandedByAxisForMetrics(
          {
            row: buildDesiredExpanded('row', result.tree),
            col: buildDesiredExpanded('col', result.tree),
          },
          result.tree,
        ),
      });
      if (persistOnComplete) {
        persistExpansionState();
      }
    },
    [
      buildDesiredExpanded,
      commitExpansionState,
      expansionRequestLifecycle,
      expansionInstanceId,
      fetchFormData,
      fetchLayout,
      addWarnings,
      onFactBatchesChange,
      persistExpansionState,
      planHydrationFromIntent,
      resolveExpandedByAxisForMetrics,
    ],
  );

  const handleToggle = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded = expandedRef.current[axis];
      const toggleDecision = resolveExpansionToggleDecision({
        node,
        expanded,
        manualExpanded: expansionIntentRef.current.expanded[axis],
        manualCollapsed: expansionIntentRef.current.collapsed[axis],
      });
      if (toggleDecision.kind === 'collapse') {
        expansionRequestLifecycle.invalidate();
        setLoadingKeys(new Set());
        collapseNode(axis, node);
        return;
      }

      if (toggleDecision.kind === 'expand') {
        expansionIntentRef.current.expanded[axis] =
          toggleDecision.nextManualExpanded ?? new Set<string>();
        expansionIntentRef.current.collapsed[axis] =
          toggleDecision.nextManualCollapsed ?? new Set<string>();
        hydrateAtomic(true).catch(reportAsyncError);
      }
    },
    [collapseNode, expansionRequestLifecycle, hydrateAtomic, reportAsyncError],
  );

  useEffect(() => {
    const previousSemanticSignature = expansionSemanticSignatureRef.current;
    expansionSemanticSignatureRef.current = expansionSemanticSignature;
    const hasNewData = previousDataRef.current !== data;
    const sessionExpansionState = expansionIntentToStateKeys(
      expansionIntentRef.current,
    );
    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
    const normalizedTree = hasNewData ? data : treeRef.current;
    const layoutTransition = resolveLayoutTransition({
      previousLayout,
      currentLayout,
    });
    const layoutChanged = PIVOT_AXES.some(
      axis => layoutTransition[axis].changed,
    );
    const isInitialMount = previousSemanticSignature === null;
    const semanticSignatureChanged =
      previousSemanticSignature !== expansionSemanticSignature;
    const shouldReinitialize =
      isInitialMount || semanticSignatureChanged || layoutChanged || hasNewData;
    if (!shouldReinitialize) {
      return;
    }
    previousLayoutRef.current = currentLayout;
    previousDataRef.current = data;
    const shouldResetAxis = (axis: PivotAxis) =>
      semanticSignatureChanged ||
      (layoutTransition[axis].changed && !layoutTransition[axis].shouldExpand);
    const resetExpanded = {
      row: shouldResetAxis('row'),
      col: shouldResetAxis('col'),
    };
    const shouldResetExpanded = PIVOT_AXES.some(axis => resetExpanded[axis]);

    expansionRequestLifecycle.invalidate();
    factStoreRef.current = createPivotFactStoreFromBatches(factBatches);
    setWarnings([]);
    setErrorMessage(undefined);
    setLoadingKeys(new Set());
    const reinitializedExpansion = resolveReinitializedExpansionState({
      tree: normalizedTree,
      sessionState: sessionExpansionState,
      axisCoverageNeeds,
      layoutTransition,
      resetExpanded,
      hasNewData,
      program: pivotProgram,
    });
    const { persistedState } = reinitializedExpansion;
    expansionIntentRef.current = expansionStateKeysToIntent(persistedState);
    if (!isInitialMount && shouldResetExpanded) {
      persistExpansionStateKeys(
        persistedState,
        expansionPersistenceDepsRef.current,
      );
    }

    const resolvedExpanded = resolveExpandedByAxisForMetrics(
      reinitializedExpansion.expanded,
      normalizedTree,
    );

    commitExpansionState({
      tree: normalizedTree,
      expanded: resolvedExpanded,
    });

    if (planHydrationFromIntent().kind === 'fetch') {
      hydrateAtomic().catch(reportAsyncError);
    }
  }, [
    commitExpansionState,
    data,
    expansionSemanticSignature,
    factBatches,
    axisCoverageNeeds,
    groupbyColumnKeys,
    groupbyRowKeys,
    pivotProgram,
    hydrateAtomic,
    planHydrationFromIntent,
    expansionRequestLifecycle,
    resolveExpandedByAxisForMetrics,
    reportAsyncError,
  ]);

  const handleRetry = useCallback(() => {
    setErrorMessage(undefined);
    setWarnings([]);

    hydrateAtomic().catch(reportAsyncError);
  }, [hydrateAtomic, reportAsyncError]);

  return {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    errorMessage,
    warnings,
    handleToggle,
    handleRetry,
  };
};
