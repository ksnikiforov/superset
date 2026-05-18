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
import type { PivotProgram } from '../runtime/types';
import {
  buildFactValueKeys,
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import {
  createExpansionCoverageDiff,
  type PivotAxisCoverageNeed,
} from '../runtime/coverage';
import {
  addAncestors,
  buildVisiblePersistedExpansionState,
  computeVisibleDepths,
  planInitialHydrationPrefetch,
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
  createExpansionRequestHelpers,
  runHydrationExpansionFetchLoop,
  type ExpansionFetchRuntime,
} from './fetchExecution';
import {
  createLatestRequestLifecycle,
  type LatestRequestScope,
} from '../runtime/requestLifecycle';
import { buildLayoutContext } from '../layout/LayoutContext';
import { materializeLoadedPivotTreeFromFactStore } from '../runtime/materializePivotTree';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { getStableColumnKey } from '../../utils';

const MAX_HYDRATION_ITERATIONS = 12;
type ExpansionStateCommit = {
  tree?: PivotTreeData;
  expandedRows?: Set<string>;
  expandedCols?: Set<string>;
  pendingRows?: Set<string>;
  pendingCols?: Set<string>;
};

type HydrateExpansionOptions = {
  showLoader?: boolean;
  activeAxis?: PivotAxis;
  planRows?: boolean;
  planCols?: boolean;
  persistOnComplete?: boolean;
};

type ExpansionRuntimeState = {
  pendingRows: Set<string>;
  pendingCols: Set<string>;
  loadingCounts: Map<string, number>;
  isHydrating: boolean;
};

type ExpansionRuntimeAction =
  | {
      type: 'setPending';
      axis: PivotAxis;
      keys: Set<string>;
    }
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
  pendingRows: new Set(),
  pendingCols: new Set(),
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
    case 'setPending':
      return action.axis === 'row'
        ? { ...state, pendingRows: new Set(action.keys) }
        : { ...state, pendingCols: new Set(action.keys) };
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
  init: (params: {
    persistedState: unknown;
    defaultRowKeys: string[];
    defaultColKeys: string[];
  }) => PivotExpansionStateKeys;
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
    rowKeys: state.rowKeys,
    colKeys: state.colKeys,
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
    init: ({ persistedState, defaultRowKeys, defaultColKeys }) => {
      if (memory) {
        return memory;
      }
      const seed = coerceExpansionState(persistedState);
      memory =
        seed ??
        ({
          rowKeys: defaultRowKeys,
          colKeys: defaultColKeys,
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
  pendingRows: Set<string>;
  pendingCols: Set<string>;
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
    store.upsertBatches(factBatches);
    factStoreRef.current = store;
  }
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const expandedRowsRef = useRef(expandedRows);
  const expandedColsRef = useRef(expandedCols);
  const [runtimeState, dispatchRuntimeState] = useReducer(
    expansionRuntimeReducer,
    undefined,
    createExpansionRuntimeState,
  );
  const { loadingCounts, pendingCols, pendingRows, isHydrating } = runtimeState;
  const loadingKeys = useMemo(
    () => new Set(loadingCounts.keys()),
    [loadingCounts],
  );
  const pendingRowsRef = useRef(pendingRows);
  const pendingColsRef = useRef(pendingCols);
  const fetchFormDataRef = useRef(fetchFormData);
  const explicitExpandedRowsRef = useRef<Set<string>>(new Set());
  const explicitExpandedColsRef = useRef<Set<string>>(new Set());
  const explicitCollapsedRowsRef = useRef<Set<string>>(new Set());
  const explicitCollapsedColsRef = useRef<Set<string>>(new Set());
  const inFlightExpandedRowsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpandedColsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpansionIdRef = useRef(0);
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

  const expansionRequestHelpers = useMemo(
    () =>
      createExpansionRequestHelpers({
        lifecycle: expansionRequestLifecycle,
        instanceId: requestGroupPrefixRef.current,
      }),
    [expansionRequestLifecycle],
  );
  const expansionStateStoreRef = useRef<ExpansionStateStore>();
  const persistedExpansionStateRef = useRef<unknown>(persistedExpansionState);
  const dataEpochRef = useRef(0);
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
  useSyncRef(expandedRowsRef, expandedRows);
  useSyncRef(expandedColsRef, expandedCols);
  useSyncRef(pendingRowsRef, pendingRows);
  useSyncRef(pendingColsRef, pendingCols);
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

  const collectInFlightExpansion = useCallback((axis: PivotAxis) => {
    const merged = new Set<string>();
    (axis === 'row'
      ? inFlightExpandedRowsRef.current
      : inFlightExpandedColsRef.current
    ).forEach(keys => keys.forEach(key => merged.add(key)));
    return merged;
  }, []);

  const hasOtherAxisInFlight = useCallback((axis: PivotAxis) => {
    const otherMap =
      axis === 'row'
        ? inFlightExpandedColsRef.current
        : inFlightExpandedRowsRef.current;
    return otherMap.size > 0;
  }, []);

  const trackInFlightExpansion = useCallback(
    (
      axis: PivotAxis,
      resolvedExpanded: Set<string>,
      committedExpanded: Set<string>,
    ) => {
      const inFlightId = inFlightExpansionIdRef.current + 1;
      inFlightExpansionIdRef.current = inFlightId;
      const inFlightMap =
        axis === 'row'
          ? inFlightExpandedRowsRef.current
          : inFlightExpandedColsRef.current;
      const inFlightKeys = new Set(resolvedExpanded);
      committedExpanded.forEach(key => inFlightKeys.delete(key));
      if (inFlightKeys.size > 0) {
        inFlightMap.set(inFlightId, inFlightKeys);
      }
      return {
        clear: () => inFlightMap.delete(inFlightId),
      };
    },
    [],
  );

  const clearInFlightExpansions = useCallback(() => {
    inFlightExpandedRowsRef.current.clear();
    inFlightExpandedColsRef.current.clear();
    inFlightExpansionIdRef.current = 0;
  }, []);

  const commitExpansionState = useCallback(
    ({
      tree: nextTree,
      expandedRows: nextExpandedRows,
      expandedCols: nextExpandedCols,
      pendingRows: nextPendingRows,
      pendingCols: nextPendingCols,
    }: ExpansionStateCommit) => {
      if (nextTree) {
        treeRef.current = nextTree;
      }
      if (nextExpandedRows) {
        expandedRowsRef.current = nextExpandedRows;
      }
      if (nextExpandedCols) {
        expandedColsRef.current = nextExpandedCols;
      }
      if (nextPendingRows) {
        pendingRowsRef.current = nextPendingRows;
      }
      if (nextPendingCols) {
        pendingColsRef.current = nextPendingCols;
      }
      unstable_batchedUpdates(() => {
        if (nextTree) {
          setTree(nextTree);
        }
        if (nextExpandedRows) {
          setExpandedRows(nextExpandedRows);
        }
        if (nextExpandedCols) {
          setExpandedCols(nextExpandedCols);
        }
        if (nextPendingRows) {
          dispatchRuntimeState({
            type: 'setPending',
            axis: 'row',
            keys: nextPendingRows,
          });
        }
        if (nextPendingCols) {
          dispatchRuntimeState({
            type: 'setPending',
            axis: 'col',
            keys: nextPendingCols,
          });
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
        explicitExpandedRows: explicitExpandedRowsRef.current,
        explicitExpandedCols: explicitExpandedColsRef.current,
        groupbyRowKeys,
        groupbyColumnKeys,
      });
      explicitExpandedRowsRef.current = visible.visibleExpandedRows;
      explicitExpandedColsRef.current = visible.visibleExpandedCols;
      explicitCollapsedRowsRef.current = visible.visibleCollapsedRows;
      explicitCollapsedColsRef.current = visible.visibleCollapsedCols;
      expansionStateStoreRef.current?.write(visible.persistedState);
    },
    [groupbyColumnKeys, groupbyRowKeys],
  );

  const resolveExpandedForMetrics = useCallback(
    (axis: PivotAxis, nextExpanded: Set<string>, nextTree: PivotTreeData) =>
      resolveExpandedForMetricsBase({
        axis,
        expanded: nextExpanded,
        tree: nextTree,
        collapsed:
          axis === 'row'
            ? explicitCollapsedRowsRef.current
            : explicitCollapsedColsRef.current,
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
        manualExpanded:
          axis === 'row'
            ? explicitExpandedRowsRef.current
            : explicitExpandedColsRef.current,
        manualCollapsed:
          axis === 'row'
            ? explicitCollapsedRowsRef.current
            : explicitCollapsedColsRef.current,
        pendingKeys:
          axis === 'row' ? pendingRowsRef.current : pendingColsRef.current,
        inFlightKeys: collectInFlightExpansion(axis),
      }),
    [axisCoverageNeeds, collectInFlightExpansion, pivotProgram],
  );

  const buildFetchRuntime = useCallback(
    (requestScope: LatestRequestScope): ExpansionFetchRuntime => ({
      requestScope,
      fetchFormData: fetchFormDataRef.current,
      program: pivotProgram,
      factStore: factStoreRef.current,
      materializeLoadedTree: () =>
        factStoreRef.current
          ? materializeLoadedPivotTreeFromFactStore({
              store: factStoreRef.current,
              layout: buildLayoutContext(fetchFormDataRef.current),
              formData: fetchFormDataRef.current,
            })
          : treeRef.current,
      buildRequestGroupId: expansionRequestHelpers.buildRequestGroupId,
      trackRequestInScope: expansionRequestHelpers.trackRequestInScope,
      addWarnings,
      updateLoadingKey,
    }),
    [addWarnings, expansionRequestHelpers, pivotProgram, updateLoadingKey],
  );

  const expandSameAxis = useCallback(
    async (axis: PivotAxis, node: PivotTreeNode) => {
      const requestScope = expansionRequestLifecycle.currentScope();
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const manualExpandedRef =
        axis === 'row' ? explicitExpandedRowsRef : explicitExpandedColsRef;
      const manualCollapsedRef =
        axis === 'row' ? explicitCollapsedRowsRef : explicitCollapsedColsRef;

      const nextManualExpanded = new Set(manualExpandedRef.current);
      addAncestors(node.path, nextManualExpanded, expanded);
      manualExpandedRef.current = nextManualExpanded;
      const nextManualCollapsed = new Set(manualCollapsedRef.current);
      nextManualCollapsed.delete(node.key);
      manualCollapsedRef.current = nextManualCollapsed;

      const baseExpanded = new Set(expanded);
      addAncestors(node.path, baseExpanded, expanded);

      const requestEpoch = dataEpochRef.current;
      const initialTree = treeRef.current;
      const initialResolvedExpanded = resolveExpandedForMetrics(
        axis,
        baseExpanded,
        initialTree,
      );
      const inFlight = trackInFlightExpansion(
        axis,
        initialResolvedExpanded,
        expanded,
      );

      try {
        const fetchLoop = await runHydrationExpansionFetchLoop({
          baseTree: initialTree,
          maxIterations: MAX_HYDRATION_ITERATIONS,
          isCurrent: () =>
            dataEpochRef.current === requestEpoch && requestScope.isCurrent(),
          buildDesiredExpanded: (desiredAxis, treeForExpansion) =>
            desiredAxis === axis
              ? resolveExpandedForMetrics(axis, baseExpanded, treeForExpansion)
              : desiredAxis === 'row'
                ? expandedRowsRef.current
                : expandedColsRef.current,
          config: planningConfig,
          activeAxis: axis,
          pendingRows: pendingRowsRef.current,
          pendingCols: pendingColsRef.current,
          planRows: axis === 'row',
          planCols: axis === 'col',
          fetchRuntime: buildFetchRuntime(requestScope),
        });

        if (fetchLoop.status !== 'complete' || !requestScope.isCurrent()) {
          return;
        }
        const committedExpanded =
          axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
        const combinedExpanded = new Set(committedExpanded);
        manualExpandedRef.current.forEach(key => combinedExpanded.add(key));
        const finalExpanded = resolveExpandedForMetrics(
          axis,
          combinedExpanded,
          fetchLoop.tree,
        );
        commitExpansionState({
          tree: fetchLoop.tree,
          expandedRows: axis === 'row' ? finalExpanded : undefined,
          expandedCols: axis === 'col' ? finalExpanded : undefined,
        });
        persistExpansionState(
          axis === 'row' ? finalExpanded : expandedRowsRef.current,
          axis === 'col' ? finalExpanded : expandedColsRef.current,
        );
      } finally {
        inFlight.clear();
      }
    },
    [
      buildFetchRuntime,
      commitExpansionState,
      expansionRequestLifecycle,
      persistExpansionState,
      resolveExpandedForMetrics,
      trackInFlightExpansion,
      planningConfig,
    ],
  );

  const collapseNode = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const pending =
        axis === 'row' ? pendingRowsRef.current : pendingColsRef.current;
      const manualExpandedRef =
        axis === 'row' ? explicitExpandedRowsRef : explicitExpandedColsRef;
      const manualCollapsedRef =
        axis === 'row' ? explicitCollapsedRowsRef : explicitCollapsedColsRef;
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
        expandedRows: axis === 'row' ? resolvedExpanded : undefined,
        expandedCols: axis === 'col' ? resolvedExpanded : undefined,
        pendingRows: axis === 'row' ? collapsedState.nextPending : undefined,
        pendingCols: axis === 'col' ? collapsedState.nextPending : undefined,
      });
      persistExpansionState(
        axis === 'row' ? resolvedExpanded : expandedRowsRef.current,
        axis === 'col' ? resolvedExpanded : expandedColsRef.current,
      );
    },
    [commitExpansionState, persistExpansionState, resolveExpandedForMetrics],
  );

  const hydrateAtomic = useCallback(
    async (options?: HydrateExpansionOptions) => {
      const shouldShowLoader = options?.showLoader ?? false;
      const shouldPlanRows = options?.planRows ?? true;
      const shouldPlanCols = options?.planCols ?? true;
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
          activeAxis: options?.activeAxis,
          pendingRows: pendingRowsRef.current,
          pendingCols: pendingColsRef.current,
          planRows: shouldPlanRows,
          planCols: shouldPlanCols,
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
            expandedRows: resolvedRows,
            expandedCols: resolvedCols,
            pendingRows: new Set(),
            pendingCols: new Set(),
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
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const pending =
        axis === 'row' ? pendingRowsRef.current : pendingColsRef.current;
      const otherPending =
        axis === 'row' ? pendingColsRef.current : pendingRowsRef.current;
      const otherInFlight = hasOtherAxisInFlight(axis);
      const manualExpandedRef =
        axis === 'row' ? explicitExpandedRowsRef : explicitExpandedColsRef;
      const manualCollapsedRef =
        axis === 'row' ? explicitCollapsedRowsRef : explicitCollapsedColsRef;
      const { visibleRowDepth, visibleColDepth } = computeVisibleDepths({
        tree: treeRef.current,
        expandedRows: expandedRowsRef.current,
        expandedCols: expandedColsRef.current,
        config: planningConfig,
      });
      const toggleDecision = resolveExpansionToggleDecision({
        axis,
        node,
        expanded,
        pending,
        otherPending,
        otherInFlight,
        visibleRowDepth,
        visibleColDepth,
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

      if (toggleDecision.kind === 'cross-axis-hydration') {
        commitExpansionState({
          pendingRows: axis === 'row' ? toggleDecision.nextPending : undefined,
          pendingCols: axis === 'col' ? toggleDecision.nextPending : undefined,
        });
        manualExpandedRef.current = toggleDecision.nextManualExpanded;
        manualCollapsedRef.current = toggleDecision.nextManualCollapsed;
        hydrateAtomic({
          activeAxis: axis,
          showLoader: false,
          persistOnComplete: true,
        }).catch(reportAsyncError);
        return;
      }
      expandSameAxis(axis, node).catch(reportAsyncError);
    },
    [
      collapseNode,
      commitExpansionState,
      expansionRequestLifecycle,
      expandSameAxis,
      hasOtherAxisInFlight,
      hydrateAtomic,
      reportAsyncError,
      clearLoadingState,
      setHydratingState,
      planningConfig,
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
      expansionStateStoreRef.current?.init({
        persistedState: persistedExpansionStateRef.current,
        defaultRowKeys: groupbyRowKeys,
        defaultColKeys: groupbyColumnKeys,
      }) ??
      ({
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
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
      sessionLayout: {
        rows: sessionExpansionState.rowKeys,
        cols: sessionExpansionState.colKeys,
      },
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

    dataEpochRef.current += 1;
    expansionRequestLifecycle.invalidate();
    const nextFactStore = createPivotFactStore();
    nextFactStore.upsertBatches(factBatches);
    factStoreRef.current = nextFactStore;
    setHydratingState(false);
    warningsRef.current = new Map();
    setWarnings([]);
    setErrorMessage(undefined);
    clearLoadingState();
    clearInFlightExpansions();

    const reinitializedExpansion = resolveReinitializedExpansionState({
      tree: normalizedTree,
      currentLayout,
      sessionState: sessionExpansionState,
      persistedExpansionState: persistedExpansionStateRef.current,
      shouldPersistExpansionState,
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
    explicitExpandedRowsRef.current = new Set(persistedState.rows);
    explicitExpandedColsRef.current = new Set(persistedState.cols);
    explicitCollapsedRowsRef.current = new Set(persistedState.collapsedRows);
    explicitCollapsedColsRef.current = new Set(persistedState.collapsedCols);
    expansionStateStoreRef.current?.write(persistedState, {
      persist:
        reinitializedExpansion.shouldResetPersistedLayout ||
        (!isInitialMount && shouldResetExpanded),
    });

    const resolvedRows = resolveExpandedForMetrics(
      'row',
      reinitializedExpansion.expandedRows,
      normalizedTree,
    );
    const resolvedCols = resolveExpandedForMetrics(
      'col',
      reinitializedExpansion.expandedCols,
      normalizedTree,
    );

    commitExpansionState({
      tree: normalizedTree,
      expandedRows: resolvedRows,
      expandedCols: resolvedCols,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    const {
      shouldPlanRows,
      shouldPlanCols,
      action: prefetchAction,
    } = planInitialHydrationPrefetch({
      tree: normalizedTree,
      resolvedRows,
      resolvedCols,
      persistedState,
      axisCoverageNeeds,
      getMissingExpansionCoverage: createExpansionCoverageDiff({
        factBatches: factStoreRef.current?.getCoverageBatches() ?? [],
        program: pivotProgram,
        valueKeys: buildFactValueKeys({
          metricKeys: pivotProgram.metricKeys,
        }),
      }),
      config: planningConfig,
    });
    if (prefetchAction.kind === 'hydrate') {
      if (!prefetchAction.showLoader) {
        setHydratingState(false);
      }
      hydrateAtomic({
        showLoader: prefetchAction.showLoader,
        planRows: shouldPlanRows,
        planCols: shouldPlanCols,
      }).catch(reportAsyncError);
      return;
    }
    setHydratingState(false);
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
    clearInFlightExpansions,
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
    pendingRows,
    pendingCols,
    isHydrating,
    errorMessage,
    warnings,
    handleToggle,
    handleRetry,
  };
};
