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
  type PivotExpansionStateKeys,
  coerceExpansionStateForLayout,
} from './stateModel';
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { stableStringify } from '../shared/stableStringify';
import { type LayoutContext } from '../layout/LayoutContext';
import type { PivotProgram } from '../runtime/types';
import {
  bindPivotFactBatchToQueryContext,
  buildPivotFactQueryContextKey,
  createPivotFactStoreFromBatches,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { type PivotAxisCoverageNeed } from '../runtime/coverage';
import {
  PIVOT_AXES,
  resolveCollapsedExpansionState,
  resolveExpandedByAxisForTree,
  resolveExpansionToggleDecision,
  resolveExpansionReinitializationPlan,
  resolveExpandedForMetrics as resolveExpandedForMetricsBase,
} from './stateTransitions';
import { useSyncRef } from '../shared/useSyncRef';
import { createLatestRequestLifecycle } from '../runtime/requestLifecycle';
import { StaleChunkedWorkError } from '../runtime/chunkedWork';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { getStableColumnKey } from '../../utils';
import { executeExpansionHydrationForIntent } from './hydrationExecutor';
import { planHydrationIteration } from './planner';
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

const hasCells = (tree: PivotTreeData) => Object.keys(tree.cells).length > 0;
const hasDisplayableTree = (tree: PivotTreeData) =>
  hasCells(tree) ||
  Object.keys(tree.rows).some(key => key !== rootKey) ||
  Object.keys(tree.cols).some(key => key !== rootKey);
const hasExpandedIntent = (state: PivotExpansionStateKeys) =>
  state.rows.length > 0 || state.cols.length > 0;
const emptyExpandedByAxis = (): AxisSetMap => ({
  row: new Set(),
  col: new Set(),
});

type ExpansionPersistenceDeps = {
  shouldPersist: boolean;
  setControlValue?: HandlerFunction;
  setDataMask?: SetDataMaskHook;
  mergeOwnState?: (partial: JsonObject) => JsonObject;
};

type ExpansionLayoutKeys = {
  rowKeys: string[];
  colKeys: string[];
};

const toPersistedPayload = (
  state: PivotExpansionStateKeys,
  layoutKeys: ExpansionLayoutKeys,
): PivotExpansionState => {
  const toPathArray = (keys: string[]) => keys.map(key => parsePath(key));
  return {
    rowKeys: layoutKeys.rowKeys,
    colKeys: layoutKeys.colKeys,
    rows: toPathArray(state.rows),
    cols: toPathArray(state.cols),
    collapsedRows: toPathArray(state.collapsedRows ?? []),
    collapsedCols: toPathArray(state.collapsedCols ?? []),
  };
};

const persistExpansionStateKeys = (
  state: PivotExpansionStateKeys,
  deps: ExpansionPersistenceDeps,
  layoutKeys: ExpansionLayoutKeys,
) => {
  if (!deps.shouldPersist) {
    return;
  }
  const payload = toPersistedPayload(state, layoutKeys);
  if (deps.setControlValue) {
    deps.setControlValue('pivotExpansionState', payload);
    return;
  }
  if (deps.setDataMask && deps.mergeOwnState) {
    const nextOwnState = deps.mergeOwnState({ pivotExpansionState: payload });
    deps.setDataMask({ ownState: { ...nextOwnState } });
  }
};

const needsExpansionHydration = ({
  state,
  axisCoverageNeeds,
  factStore,
  program,
  queryContextKey,
}: {
  state: PivotExpansionStateKeys;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  factStore: PivotFactStore;
  program: PivotProgram;
  queryContextKey: string;
}) => {
  if (!hasExpandedIntent(state)) {
    return false;
  }
  const intent = expansionStateKeysToIntent(state);
  return (
    planHydrationIteration({
      desired: {
        row: new Set([rootKey, ...intent.expanded.row]),
        col: new Set([rootKey, ...intent.expanded.col]),
      },
      axisCoverageNeeds,
      factSelectors: factStore.getCoverageSelectors(queryContextKey),
      program,
      queryContextKey,
    }).kind === 'fetch'
  );
};

export type ExpansionEngineResult = {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  loadingKeys: Set<string>;
  isInitialExpansionHydrating: boolean;
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
  const queryContextKey = useMemo(
    () => buildPivotFactQueryContextKey(fetchFormData),
    [fetchFormData],
  );
  const currentFactBatches = useMemo(
    () =>
      factBatches.map(batch =>
        bindPivotFactBatchToQueryContext(batch, queryContextKey),
      ),
    [factBatches, queryContextKey],
  );
  const groupbyRowKeys = useMemo(
    () => pivotProgram.rowDimensions.map(getStableColumnKey),
    [pivotProgram.rowDimensions],
  );
  const groupbyColumnKeys = useMemo(
    () => pivotProgram.columnDimensions.map(getStableColumnKey),
    [pivotProgram.columnDimensions],
  );
  const initialExpansionState = useMemo(
    () =>
      coerceExpansionStateForLayout({
        value: persistedExpansionState,
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
      }) ?? createEmptyExpansionState(),
    [groupbyColumnKeys, groupbyRowKeys, persistedExpansionState],
  );
  const initialLayout = useMemo(
    () => ({
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    }),
    [groupbyColumnKeys, groupbyRowKeys],
  );
  const initialReinitializationPlan = useMemo(
    () =>
      resolveExpansionReinitializationPlan({
        previousSemanticSignature: null,
        nextSemanticSignature: expansionSemanticSignature,
        previousQueryContextKey: queryContextKey,
        nextQueryContextKey: queryContextKey,
        previousData: null,
        data,
        currentTree: data,
        previousLayout: initialLayout,
        currentLayout: initialLayout,
        sessionState: initialExpansionState,
        axisCoverageNeeds,
        program: pivotProgram,
        isLeafTierVisible:
          fetchLayout.measureHierarchy.leafTierVisibility === 'visible',
      }),
    [
      axisCoverageNeeds,
      data,
      expansionSemanticSignature,
      fetchLayout.measureHierarchy.leafTierVisibility,
      initialExpansionState,
      initialLayout,
      pivotProgram,
      queryContextKey,
    ],
  );
  const initialFactStore = useMemo(
    () => createPivotFactStoreFromBatches(currentFactBatches),
    [currentFactBatches],
  );
  const [tree, setTree] = useState<PivotTreeData>(
    () => initialReinitializationPlan?.tree ?? data,
  );
  const treeRef = useRef(tree);
  const factStoreRef = useRef<PivotFactStore>();
  if (!factStoreRef.current) {
    factStoreRef.current = initialFactStore;
  }
  const initialExpanded =
    initialReinitializationPlan?.expanded ?? emptyExpandedByAxis();
  const [expandedByAxis, setExpandedByAxis] = useState<AxisSetMap>(
    () => initialExpanded,
  );
  const { row: expandedRows, col: expandedCols } = expandedByAxis;
  const expandedRef = useRef(expandedByAxis);
  const initialPersistedState =
    initialReinitializationPlan?.persistedState ?? initialExpansionState;
  const [isInitialExpansionHydrating, setIsInitialExpansionHydrating] =
    useState(() =>
      needsExpansionHydration({
        state: initialPersistedState,
        axisCoverageNeeds,
        factStore: initialFactStore,
        program: pivotProgram,
        queryContextKey,
      }),
    );
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const loadingScopesRef = useRef<Map<number, Set<string>>>(new Map());
  const expansionIntentRef = useRef<ExpansionIntentSets>(
    expansionStateKeysToIntent(initialPersistedState),
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
  const previousLayoutRef = useRef({
    rows: groupbyRowKeys,
    cols: groupbyColumnKeys,
  });
  const previousQueryContextKeyRef = useRef(queryContextKey);

  useEffect(
    () => () => {
      expansionRequestLifecycle.invalidate();
    },
    [expansionRequestLifecycle],
  );

  useEffect(() => {
    currentFactBatches.forEach(batch => {
      factStoreRef.current?.upsertBatch(batch);
    });
  }, [currentFactBatches]);

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

  const updateLoadingScope = useCallback(
    (scopeId: number, nextScopeKeys: Set<string>) => {
      if (nextScopeKeys.size === 0) {
        loadingScopesRef.current.delete(scopeId);
      } else {
        loadingScopesRef.current.set(scopeId, new Set(nextScopeKeys));
      }
      setLoadingKeys(
        new Set(
          Array.from(loadingScopesRef.current.values()).flatMap(scopeKeys =>
            Array.from(scopeKeys),
          ),
        ),
      );
    },
    [],
  );

  const clearLoadingKeys = useCallback(() => {
    loadingScopesRef.current.clear();
    setLoadingKeys(new Set());
  }, []);

  const reportAsyncError = useCallback(
    (error: unknown) => {
      if (error instanceof StaleChunkedWorkError) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      expansionRequestLifecycle.invalidate();
      clearLoadingKeys();
      setErrorMessage(message);
    },
    [clearLoadingKeys, expansionRequestLifecycle],
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
      { rowKeys: groupbyRowKeys, colKeys: groupbyColumnKeys },
    );
  }, [groupbyColumnKeys, groupbyRowKeys]);

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

      const resolvedExpanded = resolveExpandedForMetricsBase({
        axis,
        expanded: collapsedState.nextExpanded,
        tree: treeRef.current,
        collapsed: expansionIntentRef.current.collapsed[axis],
        program: pivotProgram,
        isLeafTierVisible:
          fetchLayout.measureHierarchy.leafTierVisibility === 'visible',
      });
      commitExpansionState({
        expanded: { [axis]: resolvedExpanded },
      });
      persistExpansionState();
    },
    [
      commitExpansionState,
      fetchLayout.measureHierarchy.leafTierVisibility,
      persistExpansionState,
      pivotProgram,
    ],
  );

  const hydrateAtomic = useCallback(
    async ({
      persistOnComplete = false,
      skipWhenComplete = false,
      visibleLoadingKeys,
    }: {
      persistOnComplete?: boolean;
      skipWhenComplete?: boolean;
      visibleLoadingKeys?: Set<string>;
    } = {}) => {
      const factStore = factStoreRef.current as PivotFactStore;
      currentFactBatches.forEach(batch => {
        factStore.upsertBatch(batch);
      });
      const result = await executeExpansionHydrationForIntent({
        axisCoverageNeeds,
        completeBehavior: skipWhenComplete ? 'skip' : 'returnTree',
        currentTree: treeRef.current,
        expanded: expansionIntentRef.current.expanded,
        expansionInstanceId,
        factStore,
        fetchFormData,
        fetchLayout,
        lifecycle: expansionRequestLifecycle,
        onLoadingKeys: updateLoadingScope,
        program: pivotProgram,
        queryContextKey,
        visibleLoadingKeys,
      });
      if (!result.tree) {
        return;
      }
      if (
        skipWhenComplete &&
        hasCells(treeRef.current) &&
        !hasCells(result.tree)
      ) {
        return;
      }
      addWarnings('warnings' in result ? result.warnings : undefined);
      onFactBatchesChange?.(factStore.getFactBatches(queryContextKey));
      commitExpansionState({
        tree: result.tree,
        expanded: resolveExpandedByAxisForTree({
          tree: result.tree,
          axisCoverageNeeds,
          manualExpanded: expansionIntentRef.current.expanded,
          manualCollapsed: expansionIntentRef.current.collapsed,
          program: pivotProgram,
          isLeafTierVisible:
            fetchLayout.measureHierarchy.leafTierVisibility === 'visible',
        }),
      });
      if (persistOnComplete) {
        persistExpansionState();
      }
    },
    [
      axisCoverageNeeds,
      commitExpansionState,
      expansionRequestLifecycle,
      expansionInstanceId,
      fetchFormData,
      fetchLayout,
      addWarnings,
      currentFactBatches,
      onFactBatchesChange,
      persistExpansionState,
      pivotProgram,
      queryContextKey,
      updateLoadingScope,
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
        clearLoadingKeys();
        collapseNode(axis, node);
        return;
      }

      if (toggleDecision.kind === 'expand') {
        expansionIntentRef.current.expanded[axis] =
          toggleDecision.nextManualExpanded ?? new Set<string>();
        expansionIntentRef.current.collapsed[axis] =
          toggleDecision.nextManualCollapsed ?? new Set<string>();
        hydrateAtomic({
          persistOnComplete: true,
          visibleLoadingKeys: new Set([node.key]),
        }).catch(reportAsyncError);
      }
    },
    [
      clearLoadingKeys,
      collapseNode,
      expansionRequestLifecycle,
      hydrateAtomic,
      reportAsyncError,
    ],
  );

  useEffect(() => {
    const previousSemanticSignature = expansionSemanticSignatureRef.current;
    const previousQueryContextKey = previousQueryContextKeyRef.current;
    expansionSemanticSignatureRef.current = expansionSemanticSignature;
    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const reinitializationPlan = resolveExpansionReinitializationPlan({
      previousSemanticSignature,
      nextSemanticSignature: expansionSemanticSignature,
      previousQueryContextKey,
      nextQueryContextKey: queryContextKey,
      previousData: previousDataRef.current,
      data,
      currentTree: treeRef.current,
      previousLayout: previousLayoutRef.current,
      currentLayout,
      sessionState: expansionIntentToStateKeys(expansionIntentRef.current),
      axisCoverageNeeds,
      program: pivotProgram,
      isLeafTierVisible:
        fetchLayout.measureHierarchy.leafTierVisibility === 'visible',
    });
    if (!reinitializationPlan) {
      return;
    }
    previousLayoutRef.current = currentLayout;
    previousDataRef.current = data;
    previousQueryContextKeyRef.current = queryContextKey;

    expansionRequestLifecycle.invalidate();
    const nextFactStore = createPivotFactStoreFromBatches(currentFactBatches);
    factStoreRef.current = nextFactStore;
    setWarnings([]);
    setErrorMessage(undefined);
    clearLoadingKeys();
    expansionIntentRef.current = expansionStateKeysToIntent(
      reinitializationPlan.persistedState,
    );
    if (reinitializationPlan.shouldPersistReset) {
      persistExpansionStateKeys(
        reinitializationPlan.persistedState,
        expansionPersistenceDepsRef.current,
        { rowKeys: currentLayout.rows, colKeys: currentLayout.cols },
      );
    }

    const shouldHydrateExpansion = needsExpansionHydration({
      state: reinitializationPlan.persistedState,
      axisCoverageNeeds,
      factStore: nextFactStore,
      program: pivotProgram,
      queryContextKey,
    });
    const isInitialMount = previousSemanticSignature === null;
    const shouldPreserveVisibleTreeDuringHydration =
      !isInitialMount &&
      previousSemanticSignature === expansionSemanticSignature &&
      shouldHydrateExpansion;
    if (!shouldPreserveVisibleTreeDuringHydration) {
      commitExpansionState({
        tree: reinitializationPlan.tree,
        expanded: reinitializationPlan.expanded,
      });
    }

    const shouldBlockInitialRender =
      isInitialMount &&
      shouldHydrateExpansion &&
      !hasDisplayableTree(reinitializationPlan.tree);
    setIsInitialExpansionHydrating(shouldBlockInitialRender);
    const hydration = hydrateAtomic({
      skipWhenComplete: true,
      visibleLoadingKeys:
        previousSemanticSignature === null ? undefined : new Set(),
    });
    hydration.catch(reportAsyncError).finally(() => {
      if (shouldBlockInitialRender) {
        setIsInitialExpansionHydrating(false);
      }
    });
  }, [
    commitExpansionState,
    data,
    expansionSemanticSignature,
    currentFactBatches,
    axisCoverageNeeds,
    groupbyColumnKeys,
    groupbyRowKeys,
    pivotProgram,
    fetchLayout.measureHierarchy.leafTierVisibility,
    hydrateAtomic,
    expansionRequestLifecycle,
    queryContextKey,
    reportAsyncError,
    clearLoadingKeys,
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
    isInitialExpansionHydrating,
    errorMessage,
    warnings,
    handleToggle,
    handleRetry,
  };
};
