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
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
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
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { type PivotAxisCoverageNeed } from '../runtime/coverage';
import {
  buildVisiblePersistedExpansionState,
  resolveCollapsedExpansionState,
  resolveExpansionToggleDecision,
  resolveExpansionReinitializationDecision,
  resolveReinitializedExpansionState,
  resolveExpandedForMetrics as resolveExpandedForMetricsBase,
  resolveLayoutTransition,
  type ExpansionPlanningConfig,
} from './stateTransitions';
import { useSyncRef } from '../shared/useSyncRef';
import {
  runHydrationExpansionFetchLoop,
  type ExpansionFetchRuntime,
} from './fetchExecution';
import {
  createLatestRequestLifecycle,
  type LatestRequestScope,
} from '../runtime/requestLifecycle';
import { materializeLoadedPivotTreeFromFactStore } from '../runtime/materializePivotTree';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { getStableColumnKey } from '../../utils';

const MAX_HYDRATION_ITERATIONS = 12;
type AxisSetMap = Record<PivotAxis, Set<string>>;
type AxisSetRefs = Record<PivotAxis, MutableRefObject<Set<string>>>;
type ExpansionStateCommit = {
  tree?: PivotTreeData;
  expanded?: Partial<AxisSetMap>;
  pending?: Partial<AxisSetMap>;
};

type HydrateExpansionOptions = {
  showLoader?: boolean;
  persistOnComplete?: boolean;
};

type ExpansionRuntimeState = {
  loadingCounts: Map<string, number>;
  isHydrating: boolean;
};

type ExpansionRuntimeAction =
  | {
      type: 'updateLoadingKey';
      key: string;
      delta: number;
    }
  | {
      type: 'clearLoading';
    }
  | {
      type: 'setHydrating';
      value: boolean;
    };

const createExpansionRuntimeState = (): ExpansionRuntimeState => ({
  loadingCounts: new Map(),
  isHydrating: false,
});

const updateLoadingCounts = ({
  loadingCounts,
  key,
  delta,
}: {
  loadingCounts: Map<string, number>;
  key: string;
  delta: number;
}) => {
  const counts = new Map(loadingCounts);
  const nextCount = (counts.get(key) ?? 0) + delta;
  if (nextCount <= 0) {
    counts.delete(key);
  } else {
    counts.set(key, nextCount);
  }
  return counts;
};

const expansionRuntimeReducer = (
  state: ExpansionRuntimeState,
  action: ExpansionRuntimeAction,
): ExpansionRuntimeState => {
  switch (action.type) {
    case 'updateLoadingKey':
      return {
        ...state,
        loadingCounts: updateLoadingCounts({
          loadingCounts: state.loadingCounts,
          key: action.key,
          delta: action.delta,
        }),
      };
    case 'clearLoading':
      return {
        ...state,
        loadingCounts: new Map(),
      };
    case 'setHydrating':
      return {
        ...state,
        isHydrating: action.value,
      };
    default:
      return state;
  }
};

type ExpansionStateStore = {
  init: (persistedState: unknown) => PivotExpansionStateKeys;
  updateDeps: (deps: ExpansionStateStoreDeps) => void;
  write: (
    nextState: PivotExpansionStateKeys,
    options?: { persist?: boolean },
  ) => void;
};

type ExpansionStateStoreDeps = {
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

const createExpansionStateStore = (
  initialDeps: ExpansionStateStoreDeps,
): ExpansionStateStore => {
  let deps = initialDeps;
  let memory: PivotExpansionStateKeys | undefined;

  const persist = (state: PivotExpansionStateKeys) => {
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

  return {
    init: persistedState => {
      if (memory) {
        return memory;
      }
      const seed = coerceExpansionState(persistedState);
      memory =
        seed ??
        ({
          rows: [],
          cols: [],
          collapsedRows: [],
          collapsedCols: [],
        } satisfies PivotExpansionStateKeys);
      return memory;
    },
    updateDeps: nextDeps => {
      deps = nextDeps;
    },
    write: (nextState, options) => {
      memory = nextState;
      if (options?.persist === false) {
        return;
      }
      persist(nextState);
    },
  };
};

export type ExpansionEngineResult = {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  loadingKeys: Set<string>;
  isHydrating: boolean;
  errorMessage?: string;
  warnings: ChartDataWarning[];
  handleToggle: (axis: PivotAxis, node: PivotTreeNode) => void;
  handleRetry: () => void;
};

export type ExpansionEngineConfig = {
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  expandedStateSignature: string;
  expandedStateSharedSignature: string;
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
  expandedStateSignature,
  expandedStateSharedSignature,
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
    const store = createPivotFactStore();
    factBatches.forEach(store.upsertBatch);
    factStoreRef.current = store;
  }
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const expandedRefs: AxisSetRefs = {
    row: useRef(expandedRows),
    col: useRef(expandedCols),
  };
  const [runtimeState, dispatchRuntimeState] = useReducer(
    expansionRuntimeReducer,
    undefined,
    createExpansionRuntimeState,
  );
  const { loadingCounts, isHydrating } = runtimeState;
  const loadingKeys = useMemo(
    () => new Set(loadingCounts.keys()),
    [loadingCounts],
  );
  const pendingRefs: AxisSetRefs = {
    row: useRef(new Set()),
    col: useRef(new Set()),
  };
  const fetchFormDataRef = useRef(fetchFormData);
  const explicitExpandedRefs: AxisSetRefs = {
    row: useRef(new Set()),
    col: useRef(new Set()),
  };
  const explicitCollapsedRefs: AxisSetRefs = {
    row: useRef(new Set()),
    col: useRef(new Set()),
  };
  const [errorMessage, setErrorMessage] = useState<string>();
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const warningsRef = useRef<Map<string, ChartDataWarning>>(new Map());
  const expandedStateSignatureRef = useRef<string | null>(null);
  const expandedStateSharedSignatureRef = useRef<string | null>(null);
  const requestGroupPrefixRef = useRef(nanoid());
  const expansionRequestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );

  const expansionStateStoreRef = useRef<ExpansionStateStore>();
  const persistedExpansionStateRef = useRef<unknown>(persistedExpansionState);
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

  if (!expansionStateStoreRef.current) {
    expansionStateStoreRef.current = createExpansionStateStore({
      shouldPersist: shouldPersistExpansionState,
      setControlValue,
      setDataMask,
      mergeOwnState,
    });
  }

  useEffect(() => {
    expansionStateStoreRef.current?.updateDeps({
      shouldPersist: shouldPersistExpansionState,
      setControlValue,
      setDataMask,
      mergeOwnState,
    });
  }, [
    mergeOwnState,
    setControlValue,
    setDataMask,
    shouldPersistExpansionState,
  ]);

  useEffect(
    () => () => {
      expansionRequestLifecycle.invalidate();
    },
    [expansionRequestLifecycle],
  );

  useSyncRef(persistedExpansionStateRef, persistedExpansionState);
  useSyncRef(treeRef, tree);
  useSyncRef(expandedRefs.row, expandedRows);
  useSyncRef(expandedRefs.col, expandedCols);
  useSyncRef(fetchFormDataRef, fetchFormData);

  const updateLoadingKey = useCallback((key: string, delta: number) => {
    dispatchRuntimeState({ type: 'updateLoadingKey', key, delta });
  }, []);

  const clearLoadingState = useCallback(() => {
    dispatchRuntimeState({ type: 'clearLoading' });
  }, []);

  const setHydratingState = useCallback((value: boolean) => {
    dispatchRuntimeState({ type: 'setHydrating', value });
  }, []);

  const commitExpansionState = useCallback(
    ({
      tree: nextTree,
      expanded: nextExpanded,
      pending: nextPending,
    }: ExpansionStateCommit) => {
      if (nextTree) {
        treeRef.current = nextTree;
      }
      (['row', 'col'] as const).forEach(axis => {
        const expanded = nextExpanded?.[axis];
        const pending = nextPending?.[axis];
        if (expanded) {
          expandedRefs[axis].current = expanded;
        }
        if (pending) {
          pendingRefs[axis].current = pending;
        }
      });
      unstable_batchedUpdates(() => {
        if (nextTree) {
          setTree(nextTree);
        }
        if (nextExpanded?.row) {
          setExpandedRows(nextExpanded.row);
        }
        if (nextExpanded?.col) {
          setExpandedCols(nextExpanded.col);
        }
      });
    },
    [],
  );

  const reportAsyncError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expansionRequestLifecycle.invalidate();
      clearLoadingState();
      setHydratingState(false);
      setErrorMessage(message);
    },
    [clearLoadingState, expansionRequestLifecycle, setHydratingState],
  );

  const addWarnings = useCallback(
    (nextWarnings?: ChartDataWarning[]) => {
      if (!nextWarnings || nextWarnings.length === 0) {
        return;
      }
      const map = new Map(warningsRef.current);
      let didChange = false;
      nextWarnings.forEach(warning => {
        const key = stableStringify(warning);
        if (map.has(key)) {
          return;
        }
        map.set(key, warning);
        didChange = true;
      });
      if (!didChange) {
        return;
      }
      warningsRef.current = map;
      setWarnings(Array.from(map.values()));
    },
    [setWarnings],
  );

  const planningConfig = useMemo<ExpansionPlanningConfig>(
    () => ({
      program: pivotProgram,
    }),
    [pivotProgram],
  );

  const persistExpansionState = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>) => {
      const visible = buildVisiblePersistedExpansionState({
        tree: treeRef.current,
        expandedRows: nextRows,
        expandedCols: nextCols,
        explicitExpandedRows: explicitExpandedRefs.row.current,
        explicitExpandedCols: explicitExpandedRefs.col.current,
        explicitCollapsedRows: explicitCollapsedRefs.row.current,
        explicitCollapsedCols: explicitCollapsedRefs.col.current,
      });
      explicitExpandedRefs.row.current = visible.visibleExpandedRows;
      explicitExpandedRefs.col.current = visible.visibleExpandedCols;
      explicitCollapsedRefs.row.current = visible.visibleCollapsedRows;
      explicitCollapsedRefs.col.current = visible.visibleCollapsedCols;
      expansionStateStoreRef.current?.write(visible.persistedState);
    },
    [],
  );

  const resolveExpandedForMetrics = useCallback(
    (axis: PivotAxis, nextExpanded: Set<string>, nextTree: PivotTreeData) =>
      resolveExpandedForMetricsBase({
        axis,
        expanded: nextExpanded,
        tree: nextTree,
        collapsed: explicitCollapsedRefs[axis].current,
        program: pivotProgram,
      }),
    [pivotProgram],
  );

  const buildDesiredExpanded = useCallback(
    (axis: PivotAxis, nextTree: PivotTreeData) =>
      buildDesiredExpandedKeys({
        axis,
        tree: nextTree,
        axisCoverageNeeds,
        program: pivotProgram,
        manualExpanded: explicitExpandedRefs[axis].current,
        manualCollapsed: explicitCollapsedRefs[axis].current,
        pendingKeys: pendingRefs[axis].current,
      }),
    [axisCoverageNeeds, pivotProgram],
  );

  const buildFetchRuntime = useCallback(
    (requestScope: LatestRequestScope): ExpansionFetchRuntime => ({
      requestScope,
      instanceId: requestGroupPrefixRef.current,
      fetchFormData: fetchFormDataRef.current,
      layout: fetchLayout,
      factStore: factStoreRef.current,
      materializeLoadedTree: () =>
        factStoreRef.current
          ? materializeLoadedPivotTreeFromFactStore({
              store: factStoreRef.current,
              layout: fetchLayout,
              formData: fetchFormDataRef.current,
            })
          : treeRef.current,
      addWarnings,
      updateLoadingKey,
    }),
    [addWarnings, fetchLayout, updateLoadingKey],
  );

  const collapseNode = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded = expandedRefs[axis].current;
      const pending = pendingRefs[axis].current;
      const manualExpandedRef = explicitExpandedRefs[axis];
      const manualCollapsedRef = explicitCollapsedRefs[axis];
      const nodes =
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols;
      const collapsedState = resolveCollapsedExpansionState({
        node,
        expanded,
        pending,
        manualExpanded: manualExpandedRef.current,
        manualCollapsed: manualCollapsedRef.current,
        nodes,
      });
      manualExpandedRef.current = collapsedState.nextManualExpanded;
      manualCollapsedRef.current = collapsedState.nextManualCollapsed;

      const resolvedExpanded = resolveExpandedForMetrics(
        axis,
        collapsedState.nextExpanded,
        treeRef.current,
      );
      commitExpansionState({
        expanded: { [axis]: resolvedExpanded },
        pending: { [axis]: collapsedState.nextPending },
      });
      persistExpansionState(
        axis === 'row' ? resolvedExpanded : expandedRefs.row.current,
        axis === 'col' ? resolvedExpanded : expandedRefs.col.current,
      );
    },
    [commitExpansionState, persistExpansionState, resolveExpandedForMetrics],
  );

  const hydrateAtomic = useCallback(
    async (options?: HydrateExpansionOptions) => {
      const shouldShowLoader = options?.showLoader ?? false;
      const shouldPersist = options?.persistOnComplete ?? false;
      const requestScope = expansionRequestLifecycle.beginScope();
      clearLoadingState();
      if (shouldShowLoader) {
        setHydratingState(true);
      }

      try {
        const result = await runHydrationExpansionFetchLoop({
          baseTree: treeRef.current,
          maxIterations: MAX_HYDRATION_ITERATIONS,
          isCurrent: requestScope.isCurrent,
          buildDesiredExpanded,
          config: planningConfig,
          fetchRuntime: buildFetchRuntime(requestScope),
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
            expanded: { row: resolvedRows, col: resolvedCols },
            pending: { row: new Set(), col: new Set() },
          });
          if (shouldPersist) {
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
      buildDesiredExpanded,
      buildFetchRuntime,
      clearLoadingState,
      commitExpansionState,
      expansionRequestLifecycle,
      persistExpansionState,
      resolveExpandedForMetrics,
      setHydratingState,
      planningConfig,
    ],
  );

  const handleToggle = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded = expandedRefs[axis].current;
      const pending = pendingRefs[axis].current;
      const manualExpandedRef = explicitExpandedRefs[axis];
      const manualCollapsedRef = explicitCollapsedRefs[axis];
      const toggleDecision = resolveExpansionToggleDecision({
        node,
        expanded,
        pending,
        manualExpanded: manualExpandedRef.current,
        manualCollapsed: manualCollapsedRef.current,
      });
      if (toggleDecision.kind === 'collapse') {
        expansionRequestLifecycle.invalidate();
        clearLoadingState();
        setHydratingState(false);
        collapseNode(axis, node);
        return;
      }

      if (toggleDecision.kind === 'expand') {
        commitExpansionState({
          pending: { [axis]: toggleDecision.nextPending },
        });
        manualExpandedRef.current = toggleDecision.nextManualExpanded;
        manualCollapsedRef.current = toggleDecision.nextManualCollapsed;
        hydrateAtomic({
          showLoader: false,
          persistOnComplete: true,
        }).catch(reportAsyncError);
      }
    },
    [
      collapseNode,
      commitExpansionState,
      expansionRequestLifecycle,
      hydrateAtomic,
      reportAsyncError,
      clearLoadingState,
      setHydratingState,
    ],
  );

  useEffect(() => {
    const previousSignature = expandedStateSignatureRef.current;
    expandedStateSignatureRef.current = expandedStateSignature;
    const previousSharedSignature = expandedStateSharedSignatureRef.current;
    expandedStateSharedSignatureRef.current = expandedStateSharedSignature;
    const hasNewData = previousDataRef.current !== data;
    const reinitializationDecision = resolveExpansionReinitializationDecision({
      previousSignature,
      expandedStateSignature,
      previousSharedSignature,
      expandedStateSharedSignature,
      hasNewData,
    });
    const {
      shouldResetExpandedState,
      isInitialMount,
      sharedSignatureChanged,
      shouldReinitialize,
    } = reinitializationDecision;
    const sessionExpansionState =
      expansionStateStoreRef.current?.init(
        persistedExpansionStateRef.current,
      ) ??
      ({
        rows: [],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      } satisfies PivotExpansionStateKeys);
    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
    if (!shouldReinitialize) {
      return;
    }
    previousLayoutRef.current = currentLayout;
    previousDataRef.current = data;
    const {
      rowsChanged,
      colsChanged,
      shouldExpandRows,
      shouldExpandCols,
      normalizedTree,
      rowStablePrefix,
      colStablePrefix,
    } = resolveLayoutTransition({
      data,
      currentTree: treeRef.current,
      previousLayout,
      currentLayout,
      hasNewData,
    });
    const shouldResetExpandedRows =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (rowsChanged && !shouldExpandRows));
    const shouldResetExpandedCols =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (colsChanged && !shouldExpandCols));
    const shouldResetExpanded =
      shouldResetExpandedRows || shouldResetExpandedCols;

    expansionRequestLifecycle.invalidate();
    const nextFactStore = createPivotFactStore();
    factBatches.forEach(nextFactStore.upsertBatch);
    factStoreRef.current = nextFactStore;
    setHydratingState(false);
    warningsRef.current = new Map();
    setWarnings([]);
    setErrorMessage(undefined);
    clearLoadingState();
    const reinitializedExpansion = resolveReinitializedExpansionState({
      tree: normalizedTree,
      sessionState: sessionExpansionState,
      axisCoverageNeeds,
      rowStablePrefix,
      colStablePrefix,
      shouldResetExpandedRows,
      shouldResetExpandedCols,
      rowsChanged,
      colsChanged,
      hasNewData,
      program: pivotProgram,
    });
    const { persistedState } = reinitializedExpansion;
    explicitExpandedRefs.row.current = new Set(persistedState.rows);
    explicitExpandedRefs.col.current = new Set(persistedState.cols);
    explicitCollapsedRefs.row.current = new Set(persistedState.collapsedRows);
    explicitCollapsedRefs.col.current = new Set(persistedState.collapsedCols);
    expansionStateStoreRef.current?.write(persistedState, {
      persist: !isInitialMount && shouldResetExpanded,
    });

    const resolvedRows = resolveExpandedForMetrics(
      'row',
      reinitializedExpansion.expanded.row,
      normalizedTree,
    );
    const resolvedCols = resolveExpandedForMetrics(
      'col',
      reinitializedExpansion.expanded.col,
      normalizedTree,
    );

    commitExpansionState({
      tree: normalizedTree,
      expanded: { row: resolvedRows, col: resolvedCols },
      pending: { row: new Set(), col: new Set() },
    });

    const shouldHydrateExpansionIntent =
      axisCoverageNeeds.length > 0 ||
      persistedState.rows.length > 0 ||
      persistedState.cols.length > 0 ||
      persistedState.collapsedRows.length > 0 ||
      persistedState.collapsedCols.length > 0;
    if (shouldHydrateExpansionIntent) {
      hydrateAtomic({
        showLoader: false,
      }).catch(reportAsyncError);
    }
  }, [
    clearLoadingState,
    commitExpansionState,
    data,
    expandedStateSignature,
    expandedStateSharedSignature,
    factBatches,
    axisCoverageNeeds,
    groupbyColumnKeys,
    groupbyRowKeys,
    pivotProgram,
    shouldPersistExpansionState,
    hydrateAtomic,
    expansionRequestLifecycle,
    resolveExpandedForMetrics,
    reportAsyncError,
    setHydratingState,
    planningConfig,
  ]);

  const handleRetry = useCallback(() => {
    setErrorMessage(undefined);
    warningsRef.current = new Map();
    setWarnings([]);

    hydrateAtomic({ showLoader: true }).catch(reportAsyncError);
  }, [hydrateAtomic, reportAsyncError]);

  return {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    isHydrating,
    errorMessage,
    warnings,
    handleToggle,
    handleRetry,
  };
};
