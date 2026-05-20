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
  createPivotFactStoreFromBatches,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { type PivotAxisCoverageNeed } from '../runtime/coverage';
import {
  buildVisiblePersistedExpansionState,
  resolveCollapsedExpansionState,
  resolveExpansionToggleDecision,
  resolveReinitializedExpansionState,
  resolveExpandedForMetrics as resolveExpandedForMetricsBase,
  resolveLayoutTransition,
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
type ExpansionStateCommit = {
  tree?: PivotTreeData;
  expanded?: Partial<AxisSetMap>;
};

type HydrateExpansionOptions = {
  persistOnComplete?: boolean;
};

const createEmptyExpansionState = (): PivotExpansionStateKeys => ({
  rows: [],
  cols: [],
  collapsedRows: [],
  collapsedCols: [],
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
  const fetchFormDataRef = useRef(fetchFormData);
  const initialExpansionState =
    coerceExpansionState(persistedExpansionState) ??
    createEmptyExpansionState();
  const explicitExpandedRef = useRef<AxisSetMap>({
    row: new Set(initialExpansionState.rows),
    col: new Set(initialExpansionState.cols),
  });
  const explicitCollapsedRef = useRef<AxisSetMap>({
    row: new Set(initialExpansionState.collapsedRows),
    col: new Set(initialExpansionState.collapsedCols),
  });
  const [errorMessage, setErrorMessage] = useState<string>();
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const warningsRef = useRef<Map<string, ChartDataWarning>>(new Map());
  const expansionSemanticSignatureRef = useRef<string | null>(null);
  const requestGroupPrefixRef = useRef(nanoid());
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
  useSyncRef(fetchFormDataRef, fetchFormData);

  const clearLoadingState = useCallback(() => {
    setLoadingKeys(new Set());
  }, []);

  const commitExpansionState = useCallback(
    ({ tree: nextTree, expanded: nextExpanded }: ExpansionStateCommit) => {
      if (nextTree) {
        treeRef.current = nextTree;
      }
      (['row', 'col'] as const).forEach(axis => {
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
      const message = error instanceof Error ? error.message : String(error);
      expansionRequestLifecycle.invalidate();
      clearLoadingState();
      setErrorMessage(message);
    },
    [clearLoadingState, expansionRequestLifecycle],
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

  const persistExpansionState = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>) => {
      const visible = buildVisiblePersistedExpansionState({
        tree: treeRef.current,
        expanded: { row: nextRows, col: nextCols },
        explicitExpanded: explicitExpandedRef.current,
        explicitCollapsed: explicitCollapsedRef.current,
        program: pivotProgram,
      });
      explicitExpandedRef.current = visible.visibleExpanded;
      explicitCollapsedRef.current = visible.visibleCollapsed;
      persistExpansionStateKeys(
        visible.persistedState,
        expansionPersistenceDepsRef.current,
      );
    },
    [pivotProgram],
  );

  const resolveExpandedForMetrics = useCallback(
    (axis: PivotAxis, nextExpanded: Set<string>, nextTree: PivotTreeData) =>
      resolveExpandedForMetricsBase({
        axis,
        expanded: nextExpanded,
        tree: nextTree,
        collapsed: explicitCollapsedRef.current[axis],
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
        manualExpanded: explicitExpandedRef.current[axis],
        manualCollapsed: explicitCollapsedRef.current[axis],
      }),
    [axisCoverageNeeds, pivotProgram],
  );

  const buildFetchRuntime = useCallback(
    (requestScope: LatestRequestScope): ExpansionFetchRuntime => {
      const factStore = factStoreRef.current as PivotFactStore;
      return {
        requestScope,
        instanceId: requestGroupPrefixRef.current,
        fetchFormData: fetchFormDataRef.current,
        layout: fetchLayout,
        factStore,
        materializeLoadedTree: () =>
          materializeLoadedPivotTreeFromFactStore({
            store: factStore,
            layout: fetchLayout,
            formData: fetchFormDataRef.current,
          }),
        addWarnings,
        setLoadingKeys,
      };
    },
    [addWarnings, fetchLayout],
  );

  const collapseNode = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded = expandedRef.current[axis];
      const nodes =
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols;
      const collapsedState = resolveCollapsedExpansionState({
        node,
        expanded,
        manualExpanded: explicitExpandedRef.current[axis],
        manualCollapsed: explicitCollapsedRef.current[axis],
        nodes,
      });
      explicitExpandedRef.current[axis] = collapsedState.nextManualExpanded;
      explicitCollapsedRef.current[axis] = collapsedState.nextManualCollapsed;

      const resolvedExpanded = resolveExpandedForMetrics(
        axis,
        collapsedState.nextExpanded,
        treeRef.current,
      );
      commitExpansionState({
        expanded: { [axis]: resolvedExpanded },
      });
      persistExpansionState(
        axis === 'row' ? resolvedExpanded : expandedRef.current.row,
        axis === 'col' ? resolvedExpanded : expandedRef.current.col,
      );
    },
    [commitExpansionState, persistExpansionState, resolveExpandedForMetrics],
  );

  const hydrateAtomic = useCallback(
    async (options?: HydrateExpansionOptions) => {
      const shouldPersist = options?.persistOnComplete ?? false;
      const requestScope = expansionRequestLifecycle.beginScope();
      clearLoadingState();

      try {
        const result = await runHydrationExpansionFetchLoop({
          baseTree: treeRef.current,
          maxIterations: MAX_HYDRATION_ITERATIONS,
          isCurrent: requestScope.isCurrent,
          buildDesiredExpanded,
          program: pivotProgram,
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
          });
          if (shouldPersist) {
            persistExpansionState(resolvedRows, resolvedCols);
          }
        }
      } finally {
        clearLoadingState();
      }
    },
    [
      buildDesiredExpanded,
      buildFetchRuntime,
      clearLoadingState,
      commitExpansionState,
      expansionRequestLifecycle,
      persistExpansionState,
      pivotProgram,
      resolveExpandedForMetrics,
    ],
  );

  const handleToggle = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded = expandedRef.current[axis];
      const toggleDecision = resolveExpansionToggleDecision({
        node,
        expanded,
        manualExpanded: explicitExpandedRef.current[axis],
        manualCollapsed: explicitCollapsedRef.current[axis],
      });
      if (toggleDecision.kind === 'collapse') {
        expansionRequestLifecycle.invalidate();
        clearLoadingState();
        collapseNode(axis, node);
        return;
      }

      if (toggleDecision.kind === 'expand') {
        explicitExpandedRef.current[axis] = toggleDecision.nextManualExpanded;
        explicitCollapsedRef.current[axis] = toggleDecision.nextManualCollapsed;
        hydrateAtomic({
          persistOnComplete: true,
        }).catch(reportAsyncError);
      }
    },
    [
      collapseNode,
      expansionRequestLifecycle,
      hydrateAtomic,
      reportAsyncError,
      clearLoadingState,
    ],
  );

  useEffect(() => {
    const previousSemanticSignature = expansionSemanticSignatureRef.current;
    expansionSemanticSignatureRef.current = expansionSemanticSignature;
    const hasNewData = previousDataRef.current !== data;
    const sessionExpansionState: PivotExpansionStateKeys = {
      rows: Array.from(explicitExpandedRef.current.row),
      cols: Array.from(explicitExpandedRef.current.col),
      collapsedRows: Array.from(explicitCollapsedRef.current.row),
      collapsedCols: Array.from(explicitCollapsedRef.current.col),
    };
    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
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
      program: pivotProgram,
    });
    const isInitialMount = previousSemanticSignature === null;
    const semanticSignatureChanged =
      previousSemanticSignature !== expansionSemanticSignature;
    const shouldReinitialize =
      isInitialMount ||
      semanticSignatureChanged ||
      rowsChanged ||
      colsChanged ||
      hasNewData;
    if (!shouldReinitialize) {
      return;
    }
    previousLayoutRef.current = currentLayout;
    previousDataRef.current = data;
    const shouldResetExpandedRows =
      semanticSignatureChanged || (rowsChanged && !shouldExpandRows);
    const shouldResetExpandedCols =
      semanticSignatureChanged || (colsChanged && !shouldExpandCols);
    const shouldResetExpanded =
      shouldResetExpandedRows || shouldResetExpandedCols;

    expansionRequestLifecycle.invalidate();
    factStoreRef.current = createPivotFactStoreFromBatches(factBatches);
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
    explicitExpandedRef.current = {
      row: new Set(persistedState.rows),
      col: new Set(persistedState.cols),
    };
    explicitCollapsedRef.current = {
      row: new Set(persistedState.collapsedRows),
      col: new Set(persistedState.collapsedCols),
    };
    if (!isInitialMount && shouldResetExpanded) {
      persistExpansionStateKeys(
        persistedState,
        expansionPersistenceDepsRef.current,
      );
    }

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
    });

    const layoutChangedOnlyByHiddenAppend =
      !hasNewData &&
      (rowsChanged || colsChanged) &&
      (!rowsChanged || shouldExpandRows) &&
      (!colsChanged || shouldExpandCols);
    const shouldHydrateExpansionIntent =
      !layoutChangedOnlyByHiddenAppend &&
      (axisCoverageNeeds.length > 0 ||
        persistedState.rows.length > 0 ||
        persistedState.cols.length > 0 ||
        persistedState.collapsedRows.length > 0 ||
        persistedState.collapsedCols.length > 0);
    if (shouldHydrateExpansionIntent) {
      hydrateAtomic().catch(reportAsyncError);
    }
  }, [
    clearLoadingState,
    commitExpansionState,
    data,
    expansionSemanticSignature,
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
  ]);

  const handleRetry = useCallback(() => {
    setErrorMessage(undefined);
    warningsRef.current = new Map();
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
