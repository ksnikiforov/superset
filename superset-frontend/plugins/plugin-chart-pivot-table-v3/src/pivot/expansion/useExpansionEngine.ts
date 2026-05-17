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
import {
  buildAxisCoverageKeyFromPathKey,
  getNextAxisLevelForPath,
  isValuesAtAxisEnd,
  shouldAutoExpandValuesLevel,
} from '../runtime/projection';
import { isSubtotalToken } from '../core/tokens';
import type { PivotProgram } from '../runtime/types';
import {
  buildFactValueKeys,
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import {
  createExpansionCoverageDiff,
  type PivotExpansionCoverageDiff,
} from '../runtime/coverage';
import {
  addAncestors,
  buildVisiblePersistedExpansionState,
  computeVisibleDepths as computeVisibleDepthsBase,
  mergeSameAxisExpansionTree,
  planInitialHydrationPrefetch,
  resolveCollapsedExpansionState,
  resolveExpansionToggleDecision,
  resolveExpansionReinitializationDecision,
  resolveReinitializedExpansionState,
  resolveExpandedForMetrics as resolveExpandedForMetricsBase,
  resolveLayoutTransition,
  type ExpansionVisibilityConfig,
} from './stateTransitions';
import { useSyncRef } from '../shared/useSyncRef';
import {
  createExpansionRequestHelpers,
  runHydrationExpansionFetchLoop,
  runSameAxisExpansionFetchLoop,
  type ExpansionFetchRuntime,
} from './fetchExecution';
import { type PivotExpansionNodeFetchPredicate } from './planner';
import {
  createLatestRequestLifecycle,
  type LatestRequestScope,
} from '../runtime/requestLifecycle';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import type { RenderModelConfig } from '../render/renderModel';
import { getStableColumnKey } from '../../utils';
import { countDimDepth as countDimDepthBase } from '../metricsTotals';

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
};

type HydrateExpansionReason = 'prefetch' | 'cross-axis';

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
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  isMetricTokenValue: (value: unknown) => boolean;
  pivotProgram: PivotProgram;
  buildRenderModelConfig: (params: {
    tree: PivotTreeData;
    expandedRows: Set<string>;
    expandedCols: Set<string>;
  }) => RenderModelConfig;
  expandRowsLevelRaw?: number;
  expandColumnsLevelRaw?: number;
  setControlValue?: HandlerFunction;
  setDataMask?: SetDataMaskHook;
  mergeOwnState?: (partial: JsonObject) => JsonObject;
  persistedExpansionState?: unknown;
  shouldPersistExpansionState: boolean;
  pruneMergedTree: (params: {
    axis: PivotAxis;
    tree: PivotTreeData;
    parent?: PivotTreeNode;
    branch?: PivotTreeData;
  }) => PivotTreeData;
};

export const useExpansionEngine = ({
  data,
  factBatches,
  expandedStateSignature,
  expandedStateSharedSignature,
  fetchFormData,
  resolvedExpandRowsLevel,
  resolvedExpandColumnsLevel,
  isMetricTokenValue,
  pivotProgram,
  buildRenderModelConfig,
  expandRowsLevelRaw,
  expandColumnsLevelRaw,
  setControlValue,
  setDataMask,
  mergeOwnState,
  persistedExpansionState,
  shouldPersistExpansionState,
  pruneMergedTree,
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
  const fetchCoverageSignature = stableStringify({
    groupbyRows: fetchFormData.groupbyRows,
    groupbyColumns: fetchFormData.groupbyColumns,
    metrics: fetchFormData.metrics,
    metricsLayout: fetchFormData.metricsLayout,
  });
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
  const prevAutoExpandRowsRef = useRef<number | null>(null);
  const prevAutoExpandColsRef = useRef<number | null>(null);
  const prevExpandRowsLevelRawRef = useRef<number | undefined>(undefined);
  const prevExpandColsLevelRawRef = useRef<number | undefined>(undefined);
  const autoExpandRowsLevelRef = useRef<number>(resolvedExpandRowsLevel);
  const autoExpandColsLevelRef = useRef<number>(resolvedExpandColumnsLevel);
  const expandedStateSignatureRef = useRef<string | null>(null);
  const expandedStateSharedSignatureRef = useRef<string | null>(null);
  const requestGroupPrefixRef = useRef(nanoid());
  const fetchCoverageSignatureRef = useRef(fetchCoverageSignature);
  const expansionRequestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );

  if (fetchCoverageSignatureRef.current !== fetchCoverageSignature) {
    expansionRequestLifecycle.invalidate();
    factStoreRef.current = createPivotFactStore();
    fetchCoverageSignatureRef.current = fetchCoverageSignature;
  }

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
  const metricLabelSet = useMemo(
    () => new Set(pivotProgram.metricKeys),
    [pivotProgram.metricKeys],
  );
  const countDimDepth = useCallback(
    (path: PivotTreeNode['path']) =>
      countDimDepthBase(
        path.filter(val => !isSubtotalToken(val)),
        metricLabelSet,
      ),
    [metricLabelSet],
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

  const getCoverageKey = useCallback(
    (axis: PivotAxis, key: string) =>
      buildAxisCoverageKeyFromPathKey({
        program: pivotProgram,
        axis,
        key,
      }),
    [pivotProgram],
  );

  const getMissingExpansionCoverage = useCallback(
    (): PivotExpansionCoverageDiff =>
      createExpansionCoverageDiff({
        factBatches: factStoreRef.current?.getCoverageBatches() ?? [],
        program: pivotProgram,
        valueKeys: buildFactValueKeys({
          metricKeys: pivotProgram.metricKeys,
        }),
      }),
    [pivotProgram],
  );

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

  const shouldFetchChildren = useCallback<PivotExpansionNodeFetchPredicate>(
    ({ axis, path }) =>
      getNextAxisLevelForPath({
        program: pivotProgram,
        axis,
        path: path.filter(value => !isSubtotalToken(value)),
      })?.kind === 'dimension',
    [pivotProgram],
  );

  const visibilityConfig = useMemo<ExpansionVisibilityConfig>(
    () => ({
      metricLabelSet,
      isMetricTokenValue,
      countDimDepth,
      shouldFetchChildren,
      buildRenderModelConfig,
    }),
    [
      buildRenderModelConfig,
      countDimDepth,
      isMetricTokenValue,
      metricLabelSet,
      shouldFetchChildren,
    ],
  );

  const persistExpansionState = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>) => {
      const visible = buildVisiblePersistedExpansionState({
        tree: treeRef.current,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: visibilityConfig,
        explicitExpandedRows: explicitExpandedRowsRef.current,
        explicitExpandedCols: explicitExpandedColsRef.current,
        explicitCollapsedRows: explicitCollapsedRowsRef.current,
        explicitCollapsedCols: explicitCollapsedColsRef.current,
        resolvedExpandRowsLevel,
        resolvedExpandColumnsLevel,
        groupbyRowKeys,
        groupbyColumnKeys,
      });
      explicitExpandedRowsRef.current = visible.visibleExpandedRows;
      explicitExpandedColsRef.current = visible.visibleExpandedCols;
      explicitCollapsedRowsRef.current = visible.visibleCollapsedRows;
      explicitCollapsedColsRef.current = visible.visibleCollapsedCols;
      expansionStateStoreRef.current?.write(visible.persistedState);
    },
    [
      groupbyColumnKeys,
      groupbyRowKeys,
      resolvedExpandColumnsLevel,
      resolvedExpandRowsLevel,
      visibilityConfig,
    ],
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
        isMetricTokenValue,
      }),
    [isMetricTokenValue, pivotProgram],
  );

  const buildDesiredExpanded = useCallback(
    (axis: PivotAxis, nextTree: PivotTreeData) => {
      const autoExpandLevel =
        axis === 'row'
          ? autoExpandRowsLevelRef.current
          : autoExpandColsLevelRef.current;
      return buildDesiredExpandedKeys({
        axis,
        tree: nextTree,
        autoExpandLevel,
        metricLabelSet,
        includeMetricDepthZero: shouldAutoExpandValuesLevel(
          pivotProgram,
          axis,
          autoExpandLevel,
        ),
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
      });
    },
    [collectInFlightExpansion, metricLabelSet, pivotProgram],
  );

  const computeVisibleDepths = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>, nextTree: PivotTreeData) =>
      computeVisibleDepthsBase({
        tree: nextTree,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: visibilityConfig,
      }),
    [visibilityConfig],
  );

  const buildFetchRuntime = useCallback(
    (requestScope: LatestRequestScope): ExpansionFetchRuntime => ({
      requestScope,
      fetchFormData: fetchFormDataRef.current,
      factStore: factStoreRef.current,
      trackRequestInScope: expansionRequestHelpers.trackRequestInScope,
      addWarnings,
      updateLoadingKey,
    }),
    [addWarnings, expansionRequestHelpers, updateLoadingKey],
  );

  const expandSameAxis = useCallback(
    async (axis: PivotAxis, node: PivotTreeNode) => {
      const requestScope = expansionRequestLifecycle.currentScope();
      const requestId = requestScope.id;
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
      const resolvedExpanded = resolveExpandedForMetrics(
        axis,
        baseExpanded,
        initialTree,
      );
      const inFlight = trackInFlightExpansion(axis, resolvedExpanded, expanded);

      try {
        const fetchLoop = await runSameAxisExpansionFetchLoop({
          axis,
          baseExpanded,
          initialResolvedExpanded: resolvedExpanded,
          initialTree,
          maxIterations: MAX_HYDRATION_ITERATIONS,
          requestScope,
          requestEpoch,
          getDataEpoch: () => dataEpochRef.current,
          getExpandedRows: () => expandedRowsRef.current,
          getExpandedCols: () => expandedColsRef.current,
          computeVisibleDepths,
          getMissingExpansionCoverage,
          getCoverageKey,
          shouldFetchChildren,
          fetchRuntime: buildFetchRuntime(requestScope),
          transactionId: requestId,
          buildRequestGroupId: expansionRequestHelpers.buildRequestGroupId,
          resolveExpandedForMetrics,
          pruneMergedTree,
        });

        if (fetchLoop.status === 'stale' || !requestScope.isCurrent()) {
          return;
        }
        const committedExpanded =
          axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
        const combinedExpanded = new Set(committedExpanded);
        manualExpandedRef.current.forEach(key => combinedExpanded.add(key));
        const preserveMetricChildren =
          axis === 'col' && isValuesAtAxisEnd(pivotProgram, 'col');
        const mergedTree = mergeSameAxisExpansionTree({
          currentTree: fetchLoop.tree,
          previousTree: treeRef.current,
          axis,
          touchedKeys: fetchLoop.touchedKeys,
          preserveMetricChildren,
          isMetricTokenValue,
        });
        const finalExpanded = resolveExpandedForMetrics(
          axis,
          combinedExpanded,
          mergedTree,
        );
        commitExpansionState({
          tree: mergedTree,
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
      computeVisibleDepths,
      commitExpansionState,
      expansionRequestHelpers.buildRequestGroupId,
      expansionRequestLifecycle,
      getCoverageKey,
      getMissingExpansionCoverage,
      isMetricTokenValue,
      pivotProgram,
      persistExpansionState,
      pruneMergedTree,
      resolveExpandedForMetrics,
      trackInFlightExpansion,
      shouldFetchChildren,
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
        const result = await runHydrationExpansionFetchLoop({
          reason,
          baseTree: treeRef.current,
          maxIterations: MAX_HYDRATION_ITERATIONS,
          isCurrent: requestScope.isCurrent,
          buildDesiredExpanded,
          getMissingExpansionCoverage,
          config: visibilityConfig,
          getCoverageKey,
          activeAxis: options?.activeAxis,
          pendingRows: pendingRowsRef.current,
          pendingCols: pendingColsRef.current,
          planRows: shouldPlanRows,
          planCols: shouldPlanCols,
          pruneMergedTree,
          fetchRuntime: buildFetchRuntime(requestScope),
          transactionId,
          buildRequestGroupId: expansionRequestHelpers.buildRequestGroupId,
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
      buildDesiredExpanded,
      buildFetchRuntime,
      clearLoadingState,
      commitExpansionState,
      expansionRequestHelpers,
      expansionRequestLifecycle,
      getCoverageKey,
      getMissingExpansionCoverage,
      persistExpansionState,
      pruneMergedTree,
      resolveExpandedForMetrics,
      setHydratingState,
      visibilityConfig,
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
      const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
        expandedRowsRef.current,
        expandedColsRef.current,
        treeRef.current,
      );
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
        hydrateAtomic('cross-axis', {
          activeAxis: axis,
          showLoader: false,
        }).catch(reportAsyncError);
        return;
      }
      expandSameAxis(axis, node).catch(reportAsyncError);
    },
    [
      collapseNode,
      commitExpansionState,
      computeVisibleDepths,
      expansionRequestLifecycle,
      expandSameAxis,
      hasOtherAxisInFlight,
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
    const prevExpandRowsLevelRaw = prevExpandRowsLevelRawRef.current;
    const prevExpandColsLevelRaw = prevExpandColsLevelRawRef.current;
    const hasNewData = previousDataRef.current !== data;
    const reinitializationDecision = resolveExpansionReinitializationDecision({
      previousSignature,
      expandedStateSignature,
      previousSharedSignature,
      expandedStateSharedSignature,
      prevExpandRowsLevelRaw,
      prevExpandColsLevelRaw,
      expandRowsLevelRaw,
      expandColumnsLevelRaw,
      resolvedExpandRowsLevel,
      resolvedExpandColumnsLevel,
      hasNewData,
    });
    const {
      shouldResetExpandedState,
      isInitialMount,
      sharedSignatureChanged,
      effectiveExpandRowsLevel,
      effectiveExpandColsLevel,
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
      autoExpandRowsLevelForDesired,
      autoExpandColsLevelForDesired,
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
      effectiveExpandRowsLevel,
      effectiveExpandColsLevel,
    });
    const shouldResetExpandedRows =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (rowsChanged && !shouldExpandRows));
    const shouldResetExpandedCols =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (colsChanged && !shouldExpandCols));
    const shouldResetExpanded =
      shouldResetExpandedRows || shouldResetExpandedCols;
    autoExpandRowsLevelRef.current = autoExpandRowsLevelForDesired;
    autoExpandColsLevelRef.current = autoExpandColsLevelForDesired;

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
      effectiveExpandRowsLevel,
      effectiveExpandColsLevel,
      autoExpandRowsLevelForDesired,
      autoExpandColsLevelForDesired,
      prevAutoExpandRows: prevAutoExpandRowsRef.current,
      prevAutoExpandCols: prevAutoExpandColsRef.current,
      rowStablePrefix,
      colStablePrefix,
      shouldResetExpandedRows,
      shouldResetExpandedCols,
      rowsChanged,
      colsChanged,
      hasNewData,
      program: pivotProgram,
      metricLabelSet,
      countDimDepth,
      isMetricTokenValue,
    });
    if (reinitializedExpansion.clearedState) {
      expansionStateStoreRef.current?.write(
        reinitializedExpansion.clearedState,
      );
    }
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

    prevAutoExpandRowsRef.current = effectiveExpandRowsLevel;
    prevAutoExpandColsRef.current = effectiveExpandColsLevel;
    prevExpandRowsLevelRawRef.current = expandRowsLevelRaw;
    prevExpandColsLevelRawRef.current = expandColumnsLevelRaw;

    const {
      shouldPlanRows,
      shouldPlanCols,
      action: prefetchAction,
    } = planInitialHydrationPrefetch({
      tree: normalizedTree,
      resolvedRows,
      resolvedCols,
      persistedState,
      effectiveExpandRowsLevel,
      effectiveExpandColsLevel,
      autoExpandRowsLevelForDesired,
      autoExpandColsLevelForDesired,
      getMissingExpansionCoverage: getMissingExpansionCoverage(),
      config: visibilityConfig,
      getCoverageKey,
    });
    if (prefetchAction.kind === 'hydrate') {
      if (!prefetchAction.showLoader) {
        setHydratingState(false);
      }
      hydrateAtomic('prefetch', {
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
    countDimDepth,
    data,
    expandedStateSignature,
    expandedStateSharedSignature,
    factBatches,
    expandColumnsLevelRaw,
    expandRowsLevelRaw,
    groupbyColumnKeys,
    groupbyRowKeys,
    isMetricTokenValue,
    metricLabelSet,
    pivotProgram,
    shouldPersistExpansionState,
    resolvedExpandColumnsLevel,
    resolvedExpandRowsLevel,
    hydrateAtomic,
    clearInFlightExpansions,
    expansionRequestLifecycle,
    resolveExpandedForMetrics,
    reportAsyncError,
    getCoverageKey,
    getMissingExpansionCoverage,
    setHydratingState,
    visibilityConfig,
  ]);

  const handleRetry = useCallback(() => {
    setErrorMessage(undefined);
    warningsRef.current = new Map();
    setWarnings([]);

    hydrateAtomic('prefetch', { showLoader: true }).catch(reportAsyncError);
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
