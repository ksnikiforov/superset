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
import {
  type PivotAxis,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  buildDesiredExpandedKeys,
  type PivotExpansionStateKeys,
} from '../engine/expansionStateModel';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { stableStringify } from '../shared/stableStringify';
import { createExpansionStateStore, type ExpansionStateStore } from './store';
import {
  buildAxisCoverageKeyFromPathKey,
  getNextAxisLevelForPath,
} from '../runtime/paths';
import { isSubtotalToken } from '../core/tokens';
import type { PivotProgram } from '../runtime/types';
import {
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
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
  type ExpansionVisibilityConfig,
} from './engine';
import {
  createFetchedFactCoverageState,
  pruneFetchedCoverageForCollapsedNode,
  seedFetchedCoverageFromFactBatches as seedFetchedCoverageStateFromFactBatches,
  seedFetchedCoverageFromLoadedMetricNodes as seedFetchedLoadedMetricNodeCoverage,
} from './fetchedRequests';
import { resolveLayoutTransition } from './layoutTransition';
import {
  createExpansionRuntimeState,
  expansionRuntimeReducer,
} from './runtimeState';
import { useSyncRef } from '../shared/useSyncRef';
import {
  runSameAxisExpansionFetchLoop,
  type ExpansionFetchRuntime,
} from './fetchExecution';
import { useExpansionRequestRuntime } from './useExpansionRequestRuntime';
import { useExpansionInFlight } from './useExpansionInFlight';
import { useExpansionHydrationRuntime } from './useExpansionHydrationRuntime';

const MAX_HYDRATION_ITERATIONS = 12;
const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

type ExpansionStateCommit = {
  tree?: PivotTreeData;
  expandedRows?: Set<string>;
  expandedCols?: Set<string>;
  pendingRows?: Set<string>;
  pendingCols?: Set<string>;
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
  factBatches?: PivotFactStoreBatch[];
  expandedStateSignature: string;
  expandedStateSharedSignature: string;
  fetchFormData: PivotTableQueryFormData;
  groupbyRowKeys: string[];
  groupbyColumnKeys: string[];
  groupbyRowsLength: number;
  groupbyColumnsLength: number;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  shouldExpandMetricRows: boolean;
  shouldExpandMetricCols: boolean;
  metricLabelSet: Set<string>;
  metricIndexForRows?: number;
  metricIndexForCols?: number;
  isMetricTokenValue: (value: unknown) => boolean;
  pivotProgram: PivotProgram;
  countDimDepth: (path: PivotTreeNode['path']) => number;
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
  factBatches = EMPTY_FACT_BATCHES,
  expandedStateSignature,
  expandedStateSharedSignature,
  fetchFormData,
  groupbyRowKeys,
  groupbyColumnKeys,
  groupbyRowsLength,
  groupbyColumnsLength,
  resolvedExpandRowsLevel,
  resolvedExpandColumnsLevel,
  shouldExpandMetricRows,
  shouldExpandMetricCols,
  metricLabelSet,
  metricIndexForRows,
  metricIndexForCols,
  isMetricTokenValue,
  pivotProgram,
  countDimDepth,
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
  const inFlightExpansion = useExpansionInFlight();
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
  const fetchedCoverageRef = useRef(createFetchedFactCoverageState());
  const { expansionRequestLifecycle, expansionRequestHelpers } =
    useExpansionRequestRuntime({
      fetchCoverageSignature,
      resetFetchedCoverage: () => {
        fetchedCoverageRef.current = createFetchedFactCoverageState();
      },
    });
  const expansionStateStoreRef = useRef<ExpansionStateStore>();
  const persistedExpansionStateRef = useRef<unknown>(persistedExpansionState);
  const dataEpochRef = useRef(0);
  const previousDataRef = useRef<PivotTreeData | null>(null);
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

  const getCoverageKey = useCallback(
    (axis: PivotAxis, key: string) =>
      buildAxisCoverageKeyFromPathKey({
        program: pivotProgram,
        axis,
        key,
      }),
    [pivotProgram],
  );

  const seedFetchedCoverageFromFactBatches = useCallback(
    (batches: PivotFactStoreBatch[]) => {
      seedFetchedCoverageStateFromFactBatches({
        fetchedCoverage: fetchedCoverageRef.current,
        getCoverageKey,
        batches,
      });
    },
    [getCoverageKey],
  );

  const seedFetchedCoverageFromLoadedMetricNodes = useCallback(
    (
      loadedTree: PivotTreeData,
      visibleRowDepth: number,
      visibleColDepth: number,
    ) => {
      seedFetchedLoadedMetricNodeCoverage({
        fetchedCoverage: fetchedCoverageRef.current,
        getCoverageKey,
        tree: loadedTree,
        visibleRowDepth,
        visibleColDepth,
        isMetricTokenValue,
      });
    },
    [getCoverageKey, isMetricTokenValue],
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

  const shouldFetchChildren = useCallback(
    ({
      axis,
      node,
    }: {
      axis: PivotAxis;
      key: string;
      node: PivotTreeNode;
      requiredDepth: number;
    }) =>
      getNextAxisLevelForPath({
        program: pivotProgram,
        axis,
        path: node.path.filter(value => !isSubtotalToken(value)),
      })?.kind === 'dimension',
    [pivotProgram],
  );

  const visibilityConfig = useMemo<ExpansionVisibilityConfig>(
    () => ({
      groupbyRowsLength,
      groupbyColumnsLength,
      rowTotals: fetchFormData.rowTotals ?? false,
      colTotals: fetchFormData.colTotals ?? false,
      metricsLayout: fetchFormData.metricsLayout,
      metricLabelSet,
      hasMultipleMeasures:
        metricLabelSet.size > 1 ||
        Object.values(fetchFormData.measureLeavesByMetric ?? {}).some(
          leaves => leaves.length > 1,
        ),
      metricIndexForRows,
      metricIndexForCols,
      isMetricTokenValue,
      countDimDepth,
      shouldFetchChildren,
    }),
    [
      countDimDepth,
      fetchFormData.colTotals,
      fetchFormData.metricsLayout,
      fetchFormData.measureLeavesByMetric,
      fetchFormData.rowTotals,
      groupbyColumnsLength,
      groupbyRowsLength,
      isMetricTokenValue,
      metricIndexForCols,
      metricIndexForRows,
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
        fallbackMetricIndex:
          axis === 'row' ? metricIndexForRows : metricIndexForCols,
        isMetricTokenValue,
      }),
    [isMetricTokenValue, metricIndexForCols, metricIndexForRows],
  );

  const buildDesiredExpanded = useCallback(
    (axis: PivotAxis, nextTree: PivotTreeData) =>
      buildDesiredExpandedKeys({
        axis,
        tree: nextTree,
        autoExpandLevel:
          axis === 'row'
            ? autoExpandRowsLevelRef.current
            : autoExpandColsLevelRef.current,
        metricLabelSet,
        includeMetricDepthZero:
          axis === 'row' ? shouldExpandMetricRows : shouldExpandMetricCols,
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
        inFlightKeys: inFlightExpansion.collect(axis),
      }),
    [
      inFlightExpansion,
      metricLabelSet,
      shouldExpandMetricCols,
      shouldExpandMetricRows,
    ],
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
      const inFlight = inFlightExpansion.track(
        axis,
        resolvedExpanded,
        expanded,
      );

      const fetchRuntime: ExpansionFetchRuntime = {
        requestScope,
        fetchFormData: fetchFormDataRef.current,
        factStore: factStoreRef.current,
        trackRequestInScope: expansionRequestHelpers.trackRequestInScope,
        addWarnings,
        updateLoadingKey,
      };

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
          fetchedCoverage: fetchedCoverageRef.current,
          getCoverageKey,
          shouldFetchChildren,
          fetchRuntime,
          transactionId: requestId,
          buildRequestGroupId: expansionRequestHelpers.buildRequestGroupId,
          seedFetchedCoverage: seedFetchedCoverageFromFactBatches,
          seedLoadedMetricNodeCoverage:
            seedFetchedCoverageFromLoadedMetricNodes,
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
          axis === 'col' &&
          metricIndexForCols !== undefined &&
          metricIndexForCols >= groupbyColumnsLength;
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
      addWarnings,
      computeVisibleDepths,
      commitExpansionState,
      expansionRequestHelpers,
      expansionRequestLifecycle,
      getCoverageKey,
      groupbyColumnsLength,
      inFlightExpansion,
      isMetricTokenValue,
      metricIndexForCols,
      persistExpansionState,
      pruneMergedTree,
      resolveExpandedForMetrics,
      seedFetchedCoverageFromFactBatches,
      seedFetchedCoverageFromLoadedMetricNodes,
      shouldFetchChildren,
      updateLoadingKey,
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

      pruneFetchedCoverageForCollapsedNode({
        fetchedCoverage: fetchedCoverageRef.current,
        axis,
        parentPath: node.path,
        nodes,
        parentKey: node.key,
      });

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

  const hydrateAtomic = useExpansionHydrationRuntime({
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
  });

  const handleToggle = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const pending =
        axis === 'row' ? pendingRowsRef.current : pendingColsRef.current;
      const otherPending =
        axis === 'row' ? pendingColsRef.current : pendingRowsRef.current;
      const otherInFlight = inFlightExpansion.hasOtherAxisInFlight(axis);
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
      hydrateAtomic,
      inFlightExpansion,
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
      layoutChanged,
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
    const nextFetchedCoverage = createFetchedFactCoverageState();

    dataEpochRef.current += 1;
    expansionRequestLifecycle.invalidate();
    const nextFactStore = createPivotFactStore();
    nextFactStore.upsertBatches(factBatches);
    factStoreRef.current = nextFactStore;
    setHydratingState(false);
    warningsRef.current = new Map();
    setWarnings([]);
    setErrorMessage(undefined);
    fetchedCoverageRef.current = nextFetchedCoverage;
    clearLoadingState();
    inFlightExpansion.clearAll();

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
      shouldExpandMetricRows,
      shouldExpandMetricCols,
      shouldResetExpandedRows,
      shouldResetExpandedCols,
      rowsChanged,
      colsChanged,
      hasNewData,
      metricIndexForRows,
      metricIndexForCols,
      groupbyRowsLength,
      groupbyColumnsLength,
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

    if (factBatches.length > 0 && (hasNewData || !layoutChanged)) {
      seedFetchedCoverageFromFactBatches(factBatches);
    }
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
      fetchedCoverage: fetchedCoverageRef.current,
      config: visibilityConfig,
      getCoverageKey,
    });
    if (prefetchAction.kind !== 'idle') {
      if (prefetchAction.kind === 'skip-root') {
        setHydratingState(false);
        return;
      }
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
    groupbyColumnsLength,
    groupbyRowKeys,
    groupbyRowsLength,
    isMetricTokenValue,
    metricLabelSet,
    metricIndexForCols,
    metricIndexForRows,
    shouldPersistExpansionState,
    resolvedExpandColumnsLevel,
    resolvedExpandRowsLevel,
    shouldExpandMetricCols,
    shouldExpandMetricRows,
    hydrateAtomic,
    inFlightExpansion,
    expansionRequestLifecycle,
    resolveExpandedForMetrics,
    reportAsyncError,
    getCoverageKey,
    seedFetchedCoverageFromFactBatches,
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
