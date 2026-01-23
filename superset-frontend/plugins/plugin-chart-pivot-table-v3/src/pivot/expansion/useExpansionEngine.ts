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
import { nanoid } from 'nanoid';
import {
  type HandlerFunction,
  type JsonObject,
  type SetDataMaskHook,
} from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  parsePath,
  serializePath,
  mergeTrees,
} from '../../utils';
import {
  coerceExpansionState,
  pruneExpandedToStablePrefix,
  stripAutoSeededExpansions,
  type PivotExpansionStateKeys,
} from '../engine/expansionStateModel';
import { type FetchTarget } from '../engine/fetchCoordinator';
import {
  buildStagedTree,
  createStagingTree,
  stageDelta,
  type StagingTreeState,
} from '../engine/stagingTree';
import { fetchPivotBranch, peekPivotBranchCache } from '../../fetchPivotBranch';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { buildBatchSignature } from '../query/batchSignature';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
} from '../query/fetchPlanOptimizer';
import { stableStringify } from '../shared/stableStringify';
import { fetchPivotBranchesBatch } from '../engine/query/fetchPivotBranchesBatch';
import { rootKey } from '../viewModel';
import { planGroupedExpansionTargets } from './planner';
import { createExpansionStateStore, type ExpansionStateStore } from './store';
import {
  addAncestors,
  buildDesiredExpandedKeys,
  buildHasLoadedChildren,
  computeVisibleDepths as computeVisibleDepthsBase,
  dropDescendants,
  getVisibleExpansionKeys as getVisibleExpansionKeysBase,
  getStablePrefixLength,
  hasNestedPendingKeys,
  isSameLayout,
  planHydrationIteration,
  pruneFetchedDepths,
  pruneTreeByPrefixes,
  resolveExpandedForMetrics as resolveExpandedForMetricsBase,
  type ExpansionVisibilityConfig,
} from './engine';

const MAX_HYDRATION_ITERATIONS = 12;

type SingleFetchResult = {
  kind: 'single';
  target: FetchTarget;
  data?: PivotTreeData;
};

type BatchFetchResult = {
  kind: 'batch';
  batch: BatchGroup;
  data?: PivotTreeData;
};

type CombinedFetchResult = SingleFetchResult | BatchFetchResult;

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
};

export type ExpansionEngineConfig = {
  data: PivotTreeData;
  expandedStateSignature: string;
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
  countDimDepth: (path: PivotTreeNode['path']) => number;
  expandRowsLevelRaw?: number;
  expandColumnsLevelRaw?: number;
  setControlValue?: HandlerFunction;
  setDataMask?: SetDataMaskHook;
  mergeOwnState?: (partial: JsonObject) => JsonObject;
  persistedExpansionState?: unknown;
  shouldPersistExpansionState: boolean;
  getFetchPath: (path: PivotPath) => PivotPath;
  pruneMergedTree: (params: {
    axis: PivotAxis;
    tree: PivotTreeData;
    parent?: PivotTreeNode;
    branch?: PivotTreeData;
    expandedRows: Set<string>;
    expandedCols: Set<string>;
  }) => PivotTreeData;
};

export const useExpansionEngine = ({
  data,
  expandedStateSignature,
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
  countDimDepth,
  expandRowsLevelRaw,
  expandColumnsLevelRaw,
  setControlValue,
  setDataMask,
  mergeOwnState,
  persistedExpansionState,
  shouldPersistExpansionState,
  getFetchPath,
  pruneMergedTree,
}: ExpansionEngineConfig): ExpansionEngineResult => {
  const [tree, setTree] = useState<PivotTreeData>(data);
  const treeRef = useRef(tree);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const expandedRowsRef = useRef(expandedRows);
  const expandedColsRef = useRef(expandedCols);
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());
  const [pendingCols, setPendingCols] = useState<Set<string>>(new Set());
  const pendingRowsRef = useRef(pendingRows);
  const pendingColsRef = useRef(pendingCols);
  const explicitExpandedRowsRef = useRef<Set<string>>(new Set());
  const explicitExpandedColsRef = useRef<Set<string>>(new Set());
  const explicitCollapsedRowsRef = useRef<Set<string>>(new Set());
  const explicitCollapsedColsRef = useRef<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const loadingCountsRef = useRef<Map<string, number>>(new Map());
  const inFlightRowsRef = useRef(0);
  const inFlightColsRef = useRef(0);
  const inFlightExpandedRowsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpandedColsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpansionIdRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const warningsRef = useRef<Map<string, ChartDataWarning>>(new Map());
  const [isHydrating, setIsHydrating] = useState(false);
  const prevAutoExpandRowsRef = useRef<number | null>(null);
  const prevAutoExpandColsRef = useRef<number | null>(null);
  const prevExpandRowsLevelRawRef = useRef<number | undefined>(undefined);
  const prevExpandColsLevelRawRef = useRef<number | undefined>(undefined);
  const autoExpandRowsLevelRef = useRef<number>(resolvedExpandRowsLevel);
  const autoExpandColsLevelRef = useRef<number>(resolvedExpandColumnsLevel);
  const expandedStateSignatureRef = useRef<string | null>(null);
  const fetchedRowKeysRef = useRef<Map<string, number>>(new Map());
  const fetchedColKeysRef = useRef<Map<string, number>>(new Map());
  const transactionIdRef = useRef(0);
  const requestGroupPrefixRef = useRef(nanoid());
  const activeRequestGroupIdsRef = useRef(new Set<string>());
  const expansionStateStoreRef = useRef<ExpansionStateStore>();
  const persistedExpansionStateRef = useRef<unknown>(persistedExpansionState);
  const dataEpochRef = useRef(0);
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
  }, [mergeOwnState, setControlValue, setDataMask, shouldPersistExpansionState]);

  useEffect(() => {
    persistedExpansionStateRef.current = persistedExpansionState;
  }, [persistedExpansionState]);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    expandedRowsRef.current = expandedRows;
  }, [expandedRows]);

  useEffect(() => {
    expandedColsRef.current = expandedCols;
  }, [expandedCols]);

  useEffect(() => {
    pendingRowsRef.current = pendingRows;
  }, [pendingRows]);

  useEffect(() => {
    pendingColsRef.current = pendingCols;
  }, [pendingCols]);

  const updateLoadingKey = useCallback((key: string, delta: number) => {
    const counts = new Map(loadingCountsRef.current);
    const nextCount = (counts.get(key) ?? 0) + delta;
    if (nextCount <= 0) {
      counts.delete(key);
    } else {
      counts.set(key, nextCount);
    }
    loadingCountsRef.current = counts;
    setLoadingKeys(new Set(counts.keys()));
  }, []);

  const getGroupedFetchKey = useCallback(
    (axis: PivotAxis, key: string) => {
      const intendedIndex =
        axis === 'row' ? metricIndexForRows : metricIndexForCols;
      const path = parsePath(key);
      const metricIndex = path.findIndex(value => isMetricTokenValue(value));
      if (metricIndex >= 0) {
        if (intendedIndex === undefined || metricIndex < intendedIndex) {
          return key;
        }
      }
      return serializePath(path.filter(value => !isMetricTokenValue(value)));
    },
    [isMetricTokenValue, metricIndexForCols, metricIndexForRows],
  );

  const collectInFlightExpanded = useCallback((axis: PivotAxis) => {
    const source =
      axis === 'row'
        ? inFlightExpandedRowsRef.current
        : inFlightExpandedColsRef.current;
    const merged = new Set<string>();
    source.forEach(keys => {
      keys.forEach(key => merged.add(key));
    });
    return merged;
  }, []);

  const setExpandedRowsState = useCallback((next: Set<string>) => {
    expandedRowsRef.current = next;
    setExpandedRows(next);
  }, []);

  const setExpandedColsState = useCallback((next: Set<string>) => {
    expandedColsRef.current = next;
    setExpandedCols(next);
  }, []);

  const setPendingRowsState = useCallback((next: Set<string>) => {
    pendingRowsRef.current = next;
    setPendingRows(next);
  }, []);

  const setPendingColsState = useCallback((next: Set<string>) => {
    pendingColsRef.current = next;
    setPendingCols(next);
  }, []);

  const reportAsyncError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    },
    [setErrorMessage],
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

  const cancelInFlightRequestGroups = useCallback(() => {
    activeRequestGroupIdsRef.current.forEach(requestGroupId => {
      supersetChartDataClient.cancel(requestGroupId);
    });
    activeRequestGroupIdsRef.current.clear();
  }, []);

  const buildRequestGroupId = useCallback(
    (
      payload: Record<string, unknown>,
      transactionId: number = transactionIdRef.current,
    ) =>
      stableStringify({
        instanceId: requestGroupPrefixRef.current,
        transactionId,
        ...payload,
      }),
    [],
  );

  const trackRequestGroup = useCallback(
    async <T,>(
      requestGroupId: string,
      fetcher: () => Promise<T>,
    ): Promise<T> => {
      activeRequestGroupIdsRef.current.add(requestGroupId);
      try {
        return await fetcher();
      } finally {
        activeRequestGroupIdsRef.current.delete(requestGroupId);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      cancelInFlightRequestGroups();
    },
    [cancelInFlightRequestGroups],
  );

  const visibilityConfig = useMemo<ExpansionVisibilityConfig>(
    () => ({
      groupbyRowsLength,
      groupbyColumnsLength,
      rowTotals: fetchFormData.rowTotals ?? false,
      colTotals: fetchFormData.colTotals ?? false,
      metricsLayout: fetchFormData.metricsLayout,
      metricLabelSet,
      metricIndexForRows,
      metricIndexForCols,
      isMetricTokenValue,
      countDimDepth,
    }),
    [
      countDimDepth,
      fetchFormData.colTotals,
      fetchFormData.metricsLayout,
      fetchFormData.rowTotals,
      groupbyColumnsLength,
      groupbyRowsLength,
      isMetricTokenValue,
      metricIndexForCols,
      metricIndexForRows,
      metricLabelSet,
    ],
  );

  const getVisibleExpansionKeys = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>, nextTree: PivotTreeData) =>
      getVisibleExpansionKeysBase({
        tree: nextTree,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: visibilityConfig,
      }),
    [visibilityConfig],
  );

  const persistExpansionStateToStore = useCallback(
    (nextState: PivotExpansionStateKeys, options?: { persist?: boolean }) => {
      expansionStateStoreRef.current?.write(nextState, options);
    },
    [],
  );

  const persistExpansionState = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>) => {
      const visibleKeys = getVisibleExpansionKeys(
        nextRows,
        nextCols,
        treeRef.current,
      );
      const filterVisible = (
        keys: Set<string>,
        visible: Set<string>,
      ): string[] =>
        Array.from(keys).filter(key => key !== rootKey && visible.has(key));
      const visibleRows = filterVisible(
        explicitExpandedRowsRef.current,
        visibleKeys.rows,
      );
      const visibleCols = filterVisible(
        explicitExpandedColsRef.current,
        visibleKeys.cols,
      );
      const visibleCollapsedRows = filterVisible(
        resolvedExpandRowsLevel > 0
          ? explicitCollapsedRowsRef.current
          : new Set<string>(),
        visibleKeys.rows,
      );
      const visibleCollapsedCols = filterVisible(
        resolvedExpandColumnsLevel > 0
          ? explicitCollapsedColsRef.current
          : new Set<string>(),
        visibleKeys.cols,
      );
      explicitExpandedRowsRef.current = new Set(visibleRows);
      explicitExpandedColsRef.current = new Set(visibleCols);
      explicitCollapsedRowsRef.current = new Set(visibleCollapsedRows);
      explicitCollapsedColsRef.current = new Set(visibleCollapsedCols);
      persistExpansionStateToStore({
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: visibleRows,
        cols: visibleCols,
        collapsedRows: visibleCollapsedRows,
        collapsedCols: visibleCollapsedCols,
      });
    },
    [
      groupbyColumnKeys,
      groupbyRowKeys,
      getVisibleExpansionKeys,
      persistExpansionStateToStore,
      resolvedExpandColumnsLevel,
      resolvedExpandRowsLevel,
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
        inFlightKeys: collectInFlightExpanded(axis),
      }),
    [
      collectInFlightExpanded,
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

  const hasLoadedChildrenForTree = useCallback(
    (
      tree: PivotTreeData,
      axis: PivotAxis,
      node: PivotTreeNode,
      visibleRowDepth: number,
      visibleColDepth: number,
    ) =>
      buildHasLoadedChildren({
        tree,
        visibleRowDepth,
        visibleColDepth,
        config: visibilityConfig,
      })(axis, node),
    [visibilityConfig],
  );
  const buildHasLoadedChildrenForIteration = useCallback(
    (
      nextTree: PivotTreeData,
      visibleRowDepth: number,
      visibleColDepth: number,
    ) =>
      buildHasLoadedChildren({
        tree: nextTree,
        visibleRowDepth,
        visibleColDepth,
        config: visibilityConfig,
      }),
    [visibilityConfig],
  );

  const applyBranchDelta = useCallback(
    (
      currentTree: PivotTreeData,
      axis: PivotAxis,
      key: string,
      branch?: PivotTreeData,
      expandedRows?: Set<string>,
      expandedCols?: Set<string>,
    ) => {
      if (!branch) {
        return currentTree;
      }
      const nextTree = mergeTrees(currentTree, branch);
      const parent = axis === 'row' ? nextTree.rows[key] : nextTree.cols[key];
      return pruneMergedTree({
        axis,
        tree: nextTree,
        parent,
        branch,
        expandedRows: expandedRows ?? expandedRowsRef.current,
        expandedCols: expandedCols ?? expandedColsRef.current,
      });
    },
    [pruneMergedTree],
  );

  const applyBatchDelta = useCallback(
    (
      currentTree: PivotTreeData,
      axis: PivotAxis,
      keys: string[],
      branch?: PivotTreeData,
      expandedRows?: Set<string>,
      expandedCols?: Set<string>,
    ) => {
      if (!branch) {
        return currentTree;
      }
      let nextTree = mergeTrees(currentTree, branch);
      keys.forEach(key => {
        const parent = axis === 'row' ? nextTree.rows[key] : nextTree.cols[key];
        nextTree = pruneMergedTree({
          axis,
          tree: nextTree,
          parent,
          branch,
          expandedRows: expandedRows ?? expandedRowsRef.current,
          expandedCols: expandedCols ?? expandedColsRef.current,
        });
      });
      return nextTree;
    },
    [pruneMergedTree],
  );

  const expandSameAxis = useCallback(
    async (axis: PivotAxis, node: PivotTreeNode) => {
      const inFlightRef = axis === 'row' ? inFlightRowsRef : inFlightColsRef;
      inFlightRef.current += 1;
      const requestId = transactionIdRef.current;
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
      let currentTree = treeRef.current;
      let resolvedExpanded = resolveExpandedForMetrics(
        axis,
        baseExpanded,
        currentTree,
      );
      const inFlightId = inFlightExpansionIdRef.current + 1;
      inFlightExpansionIdRef.current = inFlightId;
      const inFlightMap =
        axis === 'row'
          ? inFlightExpandedRowsRef.current
          : inFlightExpandedColsRef.current;
      const inFlightKeys = new Set(resolvedExpanded);
      expanded.forEach(key => inFlightKeys.delete(key));
      if (inFlightKeys.size > 0) {
        inFlightMap.set(inFlightId, inFlightKeys);
      }

      const fetchBranchForKey = async ({
        key,
        treeSnapshot,
        visibleRowDepth,
        visibleColDepth,
        requiredDepth,
      }: {
        key: string;
        treeSnapshot: PivotTreeData;
        visibleRowDepth: number;
        visibleColDepth: number;
        requiredDepth: number;
      }) => {
        const path = parsePath(key);
        const cached = peekPivotBranchCache({
          axis,
          path: getFetchPath(path),
          metricPath: path,
          formData: fetchFormData,
          currentTree: treeSnapshot,
          visibleRowDepth,
          visibleColDepth,
        });
        if (cached) {
          return { key, data: cached, requiredDepth };
        }
        if (transactionIdRef.current === requestId) {
          updateLoadingKey(key, 1);
        }
        const requestGroupId = buildRequestGroupId(
          {
            kind: 'branch',
            axis,
            pathKey: key,
            visibleRowDepth,
            visibleColDepth,
            requiredDepth,
          },
          requestId,
        );
        try {
          const result = await trackRequestGroup(requestGroupId, () =>
            fetchPivotBranch({
              axis,
              path: getFetchPath(path),
              metricPath: path,
              formData: fetchFormData,
              currentTree: treeSnapshot,
              visibleRowDepth,
              visibleColDepth,
              requestGroupId,
            }),
          );
          if (!result) {
            return { key, data: undefined, requiredDepth };
          }
          if (transactionIdRef.current === requestId) {
            addWarnings(result.warnings);
            if (result.error) {
              setErrorMessage(result.error.message);
            }
          }
          return { key, data: result.data, requiredDepth };
        } finally {
          if (transactionIdRef.current === requestId) {
            updateLoadingKey(key, -1);
          }
        }
      };

      const fetchBatchForGroup = async ({
        batch,
        treeSnapshot,
        visibleRowDepth,
        visibleColDepth,
      }: {
        batch: BatchGroup;
        treeSnapshot: PivotTreeData;
        visibleRowDepth: number;
        visibleColDepth: number;
      }) => {
        if (transactionIdRef.current === requestId) {
          batch.targets.forEach(target => updateLoadingKey(target.pathKey, 1));
        }
        const requestGroupId = buildRequestGroupId(
          {
            kind: 'batch',
            axis: batch.axis,
            parentPathKey: batch.parentPathKey,
            childDepth: batch.childDepth,
            requiredOppositeDepth: batch.requiredOppositeDepth,
            signature: batch.signature,
            targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
          },
          requestId,
        );
        try {
          const result = await trackRequestGroup(requestGroupId, () =>
            fetchPivotBranchesBatch({
              formData: fetchFormData,
              batch,
              currentTree: treeSnapshot,
              visibleRowDepth,
              visibleColDepth,
              getFetchPath,
              requestGroupId,
            }),
          );
          if (transactionIdRef.current === requestId) {
            addWarnings(result.warnings);
            if (result.error) {
              setErrorMessage(result.error.message);
            }
          }
          return { batch, data: result.data };
        } finally {
          if (transactionIdRef.current === requestId) {
            batch.targets.forEach(target => updateLoadingKey(target.pathKey, -1));
          }
        }
      };

      const touchedKeys = new Set<string>();
      try {
        for (
          let iteration = 0;
          iteration < MAX_HYDRATION_ITERATIONS;
          iteration += 1
        ) {
          if (
            dataEpochRef.current !== requestEpoch ||
            transactionIdRef.current !== requestId
          ) {
            return;
          }
          const expandedRowsForDepth =
            axis === 'row' ? resolvedExpanded : expandedRowsRef.current;
          const expandedColsForDepth =
            axis === 'col' ? resolvedExpanded : expandedColsRef.current;
          const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
            expandedRowsForDepth,
            expandedColsForDepth,
            currentTree,
          );
          const requiredDepth =
            axis === 'row' ? visibleColDepth : visibleRowDepth;
          const nodes = axis === 'row' ? currentTree.rows : currentTree.cols;
          const fetchedKeysRef =
            axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
          const hasLoadedChildrenForIteration =
            buildHasLoadedChildrenForIteration(
              currentTree,
              visibleRowDepth,
              visibleColDepth,
            );
          const { plan, targets, groupKeyMap } = planGroupedExpansionTargets({
            axis,
            expandedKeys: resolvedExpanded,
            nodes,
            requiredOppositeDepth: requiredDepth,
            fetchedDepthByKey: fetchedKeysRef.current,
            hasLoadedChildren: hasLoadedChildrenForIteration,
            getGroupedFetchKey,
          });
          if (plan.fetchKeys.size === 0) {
            break;
          }
          const cachedResults: SingleFetchResult[] = [];
          const batchCandidates: BatchCandidate[] = [];
          for (const target of targets) {
            const path = parsePath(target.pathKey);
            const cached = peekPivotBranchCache({
              axis: target.axis,
              path: getFetchPath(path),
              metricPath: path,
              formData: fetchFormData,
              currentTree,
              visibleRowDepth,
              visibleColDepth,
            });
            if (cached) {
              cachedResults.push({
                kind: 'single',
                target,
                data: cached,
              });
              continue;
            }
            const batchSignature = buildBatchSignature({
              formData: fetchFormData,
              axis: target.axis,
              path: getFetchPath(path),
              metricPath: path,
              currentTree,
              visibleRowDepth,
              visibleColDepth,
            });
            batchCandidates.push({ ...target, batchSignature });
          }
          const { batches, singles } = optimizeFetchPlan({
            targets: batchCandidates,
          });
          const fetchPromises: Array<Promise<CombinedFetchResult>> = [];
          for (const target of singles) {
            fetchPromises.push(
              fetchBranchForKey({
                key: target.pathKey,
                treeSnapshot: currentTree,
                visibleRowDepth,
                visibleColDepth,
                requiredDepth,
              }).then(result => ({
                kind: 'single',
                target,
                data: result.data,
              })),
            );
          }
          for (const batch of batches) {
            fetchPromises.push(
              fetchBatchForGroup({
                batch,
                treeSnapshot: currentTree,
                visibleRowDepth,
                visibleColDepth,
              }).then(result => ({
                kind: 'batch',
                batch,
                data: result.data,
              })),
            );
          }
          // eslint-disable-next-line no-await-in-loop
          const fetchedResults = await Promise.all(fetchPromises);
          const results: CombinedFetchResult[] = [
            ...cachedResults,
            ...fetchedResults,
          ];
          if (
            dataEpochRef.current !== requestEpoch ||
            transactionIdRef.current !== requestId
          ) {
            return;
          }
          let didMerge = false;
          for (const result of results) {
            if (result.kind === 'single') {
              const { target, data } = result;
              const groupKey = JSON.stringify([target.axis, target.pathKey]);
              const keys = groupKeyMap.get(groupKey) ?? [target.pathKey];
              keys.forEach(groupKey => {
                fetchedKeysRef.current.set(
                  groupKey,
                  target.requiredOppositeDepth,
                );
              });
              if (!data) {
                continue;
              }
              didMerge = true;
              touchedKeys.add(target.pathKey);
              currentTree = applyBranchDelta(
                currentTree,
                axis,
                target.pathKey,
                data,
                expandedRowsForDepth,
                expandedColsForDepth,
              );
              continue;
            }
            const { batch, data } = result;
            batch.targets.forEach(target => {
              const groupKey = JSON.stringify([target.axis, target.pathKey]);
              const keys = groupKeyMap.get(groupKey) ?? [target.pathKey];
              keys.forEach(groupKey => {
                fetchedKeysRef.current.set(
                  groupKey,
                  target.requiredOppositeDepth,
                );
              });
            });
            if (!data) {
              continue;
            }
            didMerge = true;
            batch.targets.forEach(target => {
              touchedKeys.add(target.pathKey);
            });
            currentTree = applyBatchDelta(
              currentTree,
              axis,
              batch.targets.map(target => target.pathKey),
              data,
              expandedRowsForDepth,
              expandedColsForDepth,
            );
          }
          if (!didMerge) {
            break;
          }
          const nextResolvedExpanded = resolveExpandedForMetrics(
            axis,
            baseExpanded,
            currentTree,
          );
          const nodesAfterMerge =
            axis === 'row' ? currentTree.rows : currentTree.cols;
          for (const key of nextResolvedExpanded) {
            const node = nodesAfterMerge[key];
            if (!node) {
              continue;
            }
            if (
              !hasLoadedChildrenForTree(
                currentTree,
                axis,
                node,
                visibleRowDepth,
                visibleColDepth,
              )
            ) {
              continue;
            }
            const existingDepth = fetchedKeysRef.current.get(key);
            if (existingDepth === undefined || existingDepth < requiredDepth) {
              fetchedKeysRef.current.set(key, requiredDepth);
            }
          }
          resolvedExpanded = nextResolvedExpanded;
        }

        if (transactionIdRef.current !== requestId) {
          return;
        }
        const committedExpanded =
          axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
        const combinedExpanded = new Set(committedExpanded);
        manualExpandedRef.current.forEach(key => combinedExpanded.add(key));
        const touchedPrefixes = Array.from(touchedKeys).map(key =>
          parsePath(key),
        );
        const preservedTree =
          touchedPrefixes.length > 0
            ? pruneTreeByPrefixes(treeRef.current, axis, touchedPrefixes)
            : treeRef.current;
        const mergedTree = mergeTrees(currentTree, preservedTree);
        const finalExpanded = resolveExpandedForMetrics(
          axis,
          combinedExpanded,
          mergedTree,
        );
        treeRef.current = mergedTree;
        setTree(mergedTree);
        if (axis === 'row') {
          setExpandedRowsState(finalExpanded);
        } else {
          setExpandedColsState(finalExpanded);
        }
        persistExpansionState(
          axis === 'row' ? finalExpanded : expandedRowsRef.current,
          axis === 'col' ? finalExpanded : expandedColsRef.current,
        );
      } finally {
        inFlightMap.delete(inFlightId);
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      }
    },
    [
      addWarnings,
      applyBatchDelta,
      applyBranchDelta,
      buildHasLoadedChildrenForIteration,
      buildRequestGroupId,
      computeVisibleDepths,
      fetchFormData,
      getFetchPath,
      hasLoadedChildrenForTree,
      persistExpansionState,
      getGroupedFetchKey,
      resolveExpandedForMetrics,
      trackRequestGroup,
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

      manualExpandedRef.current = dropDescendants(
        node.path,
        manualExpandedRef.current,
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols,
      );
      manualCollapsedRef.current = dropDescendants(
        node.path,
        manualCollapsedRef.current,
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols,
      );
      manualCollapsedRef.current.add(node.key);

      const nextExpanded = dropDescendants(
        node.path,
        expanded,
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols,
      );
      nextExpanded.delete(node.key);

      const nextPending = dropDescendants(
        node.path,
        pending,
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols,
      );
      nextPending.delete(node.key);

      const fetchedKeysRef =
        axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
      pruneFetchedDepths({
        parentPath: node.path,
        nodes: axis === 'row' ? treeRef.current.rows : treeRef.current.cols,
        fetchedDepths: fetchedKeysRef.current,
        parentKey: node.key,
      });

      const resolvedExpanded = resolveExpandedForMetrics(
        axis,
        nextExpanded,
        treeRef.current,
      );
      if (axis === 'row') {
        setExpandedRowsState(resolvedExpanded);
        setPendingRowsState(nextPending);
      } else {
        setExpandedColsState(resolvedExpanded);
        setPendingColsState(nextPending);
      }
      persistExpansionState(
        axis === 'row' ? resolvedExpanded : expandedRowsRef.current,
        axis === 'col' ? resolvedExpanded : expandedColsRef.current,
      );
    },
    [persistExpansionState, resolveExpandedForMetrics],
  );

  const hydrateAtomic = useCallback(
    async (
      reason: 'prefetch' | 'cross-axis',
      options?: { showLoader?: boolean; activeAxis?: PivotAxis },
    ) => {
      const shouldShowLoader = options?.showLoader ?? false;
      const transactionId = transactionIdRef.current + 1;
      transactionIdRef.current = transactionId;
      cancelInFlightRequestGroups();
      loadingCountsRef.current = new Map();
      setLoadingKeys(new Set());
      if (shouldShowLoader) {
        setIsHydrating(true);
      }

      const finalizeHydration = () => {
        if (shouldShowLoader) {
          setIsHydrating(false);
        }
      };

      let stagingState: StagingTreeState = createStagingTree(treeRef.current);
      let desiredRows = new Set<string>();
      let desiredCols = new Set<string>();

      const fetchSingleTarget = async (
        target: FetchTarget,
        context: {
          stagedTree: PivotTreeData;
          visibleRowDepth: number;
          visibleColDepth: number;
        },
      ) => {
        const path = parsePath(target.pathKey);
        if (transactionIdRef.current === transactionId) {
          updateLoadingKey(target.pathKey, 1);
        }
        const requestGroupId = buildRequestGroupId(
          {
            kind: `hydrate:${reason}`,
            axis: target.axis,
            pathKey: target.pathKey,
            childDepth: target.childDepth,
            requiredOppositeDepth: target.requiredOppositeDepth,
            visibleRowDepth: context.visibleRowDepth,
            visibleColDepth: context.visibleColDepth,
          },
          transactionId,
        );
        try {
          const result = await trackRequestGroup(requestGroupId, () =>
            fetchPivotBranch({
              axis: target.axis,
              path: getFetchPath(path),
              metricPath: path,
              formData: fetchFormData,
              currentTree: context.stagedTree,
              visibleRowDepth: context.visibleRowDepth,
              visibleColDepth: context.visibleColDepth,
              requestGroupId,
            }),
          );
          if (!result) {
            return { target, data: undefined };
          }
          if (transactionIdRef.current === transactionId) {
            addWarnings(result.warnings);
            if (result.error) {
              setErrorMessage(result.error.message);
            }
          }
          return { target, data: result.data };
        } finally {
          if (transactionIdRef.current === transactionId) {
            updateLoadingKey(target.pathKey, -1);
          }
        }
      };

      const fetchBatchTarget = async (
        batch: BatchGroup,
        context: {
          stagedTree: PivotTreeData;
          visibleRowDepth: number;
          visibleColDepth: number;
        },
      ) => {
        if (transactionIdRef.current === transactionId) {
          batch.targets.forEach(target => updateLoadingKey(target.pathKey, 1));
        }
        const requestGroupId = buildRequestGroupId(
          {
            kind: `hydrate:${reason}`,
            axis: batch.axis,
            parentPathKey: batch.parentPathKey,
            childDepth: batch.childDepth,
            requiredOppositeDepth: batch.requiredOppositeDepth,
            signature: batch.signature,
            targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
            visibleRowDepth: context.visibleRowDepth,
            visibleColDepth: context.visibleColDepth,
          },
          transactionId,
        );
        try {
          const result = await trackRequestGroup(requestGroupId, () =>
            fetchPivotBranchesBatch({
              formData: fetchFormData,
              batch,
              currentTree: context.stagedTree,
              visibleRowDepth: context.visibleRowDepth,
              visibleColDepth: context.visibleColDepth,
              getFetchPath,
              requestGroupId,
            }),
          );
          if (transactionIdRef.current === transactionId) {
            addWarnings(result.warnings);
            if (result.error) {
              setErrorMessage(result.error.message);
            }
          }
          return { batch, data: result.data };
        } finally {
          if (transactionIdRef.current === transactionId) {
            batch.targets.forEach(target => updateLoadingKey(target.pathKey, -1));
          }
        }
      };

      for (
        let iteration = 0;
        iteration < MAX_HYDRATION_ITERATIONS;
        iteration += 1
      ) {
        if (transactionIdRef.current !== transactionId) {
          finalizeHydration();
          return;
        }
        const stagedTree = buildStagedTree(stagingState);
        desiredRows = buildDesiredExpanded('row', stagedTree);
        desiredCols = buildDesiredExpanded('col', stagedTree);
        const hydrationPlan = planHydrationIteration({
          tree: stagedTree,
          desiredRows,
          desiredCols,
          fetchedRowDepthByKey: fetchedRowKeysRef.current,
          fetchedColDepthByKey: fetchedColKeysRef.current,
          config: visibilityConfig,
          getGroupedFetchKey,
          activeAxis: options?.activeAxis,
          pendingRows: pendingRowsRef.current,
          pendingCols: pendingColsRef.current,
        });
        const { visibleRowDepth, visibleColDepth } = hydrationPlan;

        if (hydrationPlan.kind === 'complete') {
          let mergedTree = buildStagedTree(stagingState);
          const orderedDeltas = Array.from(stagingState.deltas.entries()).sort(
            ([a], [b]) => a.localeCompare(b),
          );
          for (const [key, delta] of orderedDeltas) {
            const parsed = JSON.parse(key) as [PivotAxis, string];
            const axis = parsed[0];
            const targetKey = parsed[1];
            const parent =
              axis === 'row'
                ? mergedTree.rows[targetKey]
                : mergedTree.cols[targetKey];
            mergedTree = pruneMergedTree({
              axis,
              tree: mergedTree,
              parent,
              branch: delta,
              expandedRows: desiredRows,
              expandedCols: desiredCols,
            });
          }
          const resolvedRows = resolveExpandedForMetrics(
            'row',
            desiredRows,
            mergedTree,
          );
          const resolvedCols = resolveExpandedForMetrics(
            'col',
            desiredCols,
            mergedTree,
          );
          treeRef.current = mergedTree;
          setTree(mergedTree);
          setExpandedRowsState(resolvedRows);
          setExpandedColsState(resolvedCols);
          setPendingRowsState(new Set());
          setPendingColsState(new Set());
          if (reason === 'cross-axis') {
            persistExpansionState(resolvedRows, resolvedCols);
          }
          finalizeHydration();
          return;
        }
        const { targets, groupKeyMap } = hydrationPlan;

        const fetchContext = { stagedTree, visibleRowDepth, visibleColDepth };
        const cachedResults: SingleFetchResult[] = [];
        const batchCandidates: BatchCandidate[] = [];
        for (const target of targets) {
          const path = parsePath(target.pathKey);
          const cached = peekPivotBranchCache({
            axis: target.axis,
            path: getFetchPath(path),
            metricPath: path,
            formData: fetchFormData,
            currentTree: fetchContext.stagedTree,
            visibleRowDepth,
            visibleColDepth,
          });
          if (cached) {
            cachedResults.push({ kind: 'single', target, data: cached });
            continue;
          }
          const batchSignature = buildBatchSignature({
            formData: fetchFormData,
            axis: target.axis,
            path: getFetchPath(path),
            metricPath: path,
            currentTree: fetchContext.stagedTree,
            visibleRowDepth,
            visibleColDepth,
          });
          batchCandidates.push({ ...target, batchSignature });
        }
        const { batches, singles } = optimizeFetchPlan({
          targets: batchCandidates,
        });
        const fetchPromises: Array<Promise<CombinedFetchResult>> = [];
        for (const target of singles) {
          fetchPromises.push(
            fetchSingleTarget(target, fetchContext).then(result => ({
              kind: 'single',
              target,
              data: result.data,
            })),
          );
        }
        for (const batch of batches) {
          fetchPromises.push(
            fetchBatchTarget(batch, fetchContext).then(result => ({
              kind: 'batch',
              batch,
              data: result.data,
            })),
          );
        }
        // eslint-disable-next-line no-await-in-loop
        const fetchedResults = await Promise.all(fetchPromises);
        const results: CombinedFetchResult[] = [
          ...cachedResults,
          ...fetchedResults,
        ];

        if (transactionIdRef.current !== transactionId) {
          finalizeHydration();
          return;
        }

        for (const result of results) {
          if (result.kind === 'single') {
            const { target, data } = result;
            const fetchedKeysRef =
              target.axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
            const groupKey = JSON.stringify([target.axis, target.pathKey]);
            const keys = groupKeyMap.get(groupKey) ?? [target.pathKey];
            keys.forEach(key => {
              fetchedKeysRef.current.set(key, target.requiredOppositeDepth);
            });
            if (!data) {
              continue;
            }
            const deltaKey = JSON.stringify([target.axis, target.pathKey]);
            stagingState = stageDelta(stagingState, deltaKey, data);
            continue;
          }
          const { batch, data } = result;
          for (const target of batch.targets) {
            const fetchedKeysRef =
              target.axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
            const groupKey = JSON.stringify([target.axis, target.pathKey]);
            const keys = groupKeyMap.get(groupKey) ?? [target.pathKey];
            keys.forEach(key => {
              fetchedKeysRef.current.set(key, target.requiredOppositeDepth);
            });
            if (!data) {
              continue;
            }
            const deltaKey = JSON.stringify([target.axis, target.pathKey]);
            stagingState = stageDelta(stagingState, deltaKey, data);
          }
        }

        const updatedTree = buildStagedTree(stagingState);
        const markExpandedAsFetched = (
          axis: PivotAxis,
          expandedKeys: Set<string>,
          requiredOppositeDepth: number,
        ) => {
          const nodes = axis === 'row' ? updatedTree.rows : updatedTree.cols;
          const fetchedKeysRef =
            axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
          expandedKeys.forEach(key => {
            const node = nodes[key];
            if (!node) {
              return;
            }
            const hasChildrenLoaded = hasLoadedChildrenForTree(
              updatedTree,
              axis,
              node,
              visibleRowDepth,
              visibleColDepth,
            );
            if (!hasChildrenLoaded) {
              return;
            }
            const existingDepth = fetchedKeysRef.current.get(key);
            if (
              existingDepth === undefined ||
              existingDepth < requiredOppositeDepth
            ) {
              fetchedKeysRef.current.set(key, requiredOppositeDepth);
            }
          });
        };
        markExpandedAsFetched('row', desiredRows, visibleColDepth);
        markExpandedAsFetched('col', desiredCols, visibleRowDepth);
      }

      finalizeHydration();
    },
    [
      addWarnings,
      buildDesiredExpanded,
      buildRequestGroupId,
      cancelInFlightRequestGroups,
      fetchFormData,
      getFetchPath,
      hasLoadedChildrenForTree,
      getGroupedFetchKey,
      planHydrationIteration,
      persistExpansionState,
      pruneMergedTree,
      trackRequestGroup,
      updateLoadingKey,
      resolveExpandedForMetrics,
      visibilityConfig,
    ],
  );

  const handleToggle = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const pending =
        axis === 'row' ? pendingRowsRef.current : pendingColsRef.current;
      const isOpen = expanded.has(node.key) || pending.has(node.key);
      if (isOpen) {
        transactionIdRef.current += 1;
        cancelInFlightRequestGroups();
        loadingCountsRef.current = new Map();
        setLoadingKeys(new Set());
        setIsHydrating(false);
        collapseNode(axis, node);
        return;
      }

      const otherExpanded =
        axis === 'row' ? expandedColsRef.current : expandedRowsRef.current;
      const otherPending =
        axis === 'row' ? pendingColsRef.current : pendingRowsRef.current;
      const otherInFlight =
        axis === 'row'
          ? inFlightColsRef.current > 0
          : inFlightRowsRef.current > 0;
      const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
        expandedRowsRef.current,
        expandedColsRef.current,
        treeRef.current,
      );
      const oppositeVisibleDepth =
        axis === 'row' ? visibleColDepth : visibleRowDepth;
      const isAtomic =
        oppositeVisibleDepth > 0 && (otherPending.size > 0 || otherInFlight);

      if (isAtomic) {
        const nextPending = new Set(pending);
        addAncestors(node.path, nextPending, expanded);
        if (axis === 'row') {
          setPendingRowsState(nextPending);
        } else {
          setPendingColsState(nextPending);
        }
        const manualExpandedRef =
          axis === 'row' ? explicitExpandedRowsRef : explicitExpandedColsRef;
        addAncestors(node.path, manualExpandedRef.current, expanded);
        const manualCollapsedRef =
          axis === 'row' ? explicitCollapsedRowsRef : explicitCollapsedColsRef;
        manualCollapsedRef.current.delete(node.key);
        hydrateAtomic('cross-axis', {
          activeAxis: axis,
          showLoader: false,
        }).catch(error => {
          reportAsyncError(error);
          setIsHydrating(false);
        });
        return;
      }
      expandSameAxis(axis, node).catch(reportAsyncError);
    },
    [
      cancelInFlightRequestGroups,
      collapseNode,
      computeVisibleDepths,
      expandSameAxis,
      hydrateAtomic,
      reportAsyncError,
    ],
  );

  useEffect(() => {
    const previousSignature = expandedStateSignatureRef.current;
    const shouldResetExpanded = previousSignature !== expandedStateSignature;
    const isInitialMount = previousSignature === null;
    expandedStateSignatureRef.current = expandedStateSignature;
    const prevExpandRowsLevelRaw = prevExpandRowsLevelRawRef.current;
    const prevExpandColsLevelRaw = prevExpandColsLevelRawRef.current;
    const isRowsLevelCleared =
      expandRowsLevelRaw === undefined && prevExpandRowsLevelRaw !== undefined;
    const isColsLevelCleared =
      expandColumnsLevelRaw === undefined &&
      prevExpandColsLevelRaw !== undefined;
    const effectiveExpandRowsLevel = isRowsLevelCleared
      ? 0
      : resolvedExpandRowsLevel;
    const effectiveExpandColsLevel = isColsLevelCleared
      ? 0
      : resolvedExpandColumnsLevel;
    autoExpandRowsLevelRef.current = effectiveExpandRowsLevel;
    autoExpandColsLevelRef.current = effectiveExpandColsLevel;
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
    const persistedSeed = coerceExpansionState(persistedExpansionStateRef.current);
    const metricLabelSetForDepth = new Set(Array.from(metricLabelSet));

    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
    previousLayoutRef.current = currentLayout;
    const layoutRowsForPrune = sessionExpansionState.rowKeys ?? previousLayout.rows;
    const layoutColsForPrune = sessionExpansionState.colKeys ?? previousLayout.cols;
    const rowStablePrefix = getStablePrefixLength(
      layoutRowsForPrune,
      currentLayout.rows,
    );
    const colStablePrefix = getStablePrefixLength(
      layoutColsForPrune,
      currentLayout.cols,
    );

    dataEpochRef.current += 1;
    transactionIdRef.current += 1;
    cancelInFlightRequestGroups();
    setIsHydrating(false);
    warningsRef.current = new Map();
    setWarnings([]);
    treeRef.current = data;
    setTree(data);
    setErrorMessage(undefined);
    fetchedRowKeysRef.current = new Map();
    fetchedColKeysRef.current = new Map();
    loadingCountsRef.current = new Map();
    setLoadingKeys(new Set());
    inFlightExpandedRowsRef.current.clear();
    inFlightExpandedColsRef.current.clear();
    inFlightExpansionIdRef.current = 0;

    const sessionRows = sessionExpansionState.rows ?? [];
    const sessionCols = sessionExpansionState.cols ?? [];
    const sessionCollapsedRows = sessionExpansionState.collapsedRows ?? [];
    const sessionCollapsedCols = sessionExpansionState.collapsedCols ?? [];

    const prevAutoExpandRows = prevAutoExpandRowsRef.current;
    const prevAutoExpandCols = prevAutoExpandColsRef.current;

    const shouldClearRowCache =
      effectiveExpandRowsLevel > 0 &&
      (prevAutoExpandRows === null || prevAutoExpandRows === 0) &&
      sessionRows.length + sessionCollapsedRows.length > 0;
    const shouldClearColCache =
      effectiveExpandColsLevel > 0 &&
      (prevAutoExpandCols === null || prevAutoExpandCols === 0) &&
      sessionCols.length + sessionCollapsedCols.length > 0;

    const allowRowCollapsed = effectiveExpandRowsLevel > 0;
    const allowColCollapsed = effectiveExpandColsLevel > 0;
    const manualRows = shouldClearRowCache ? [] : sessionRows;
    const manualCols = shouldClearColCache ? [] : sessionCols;
    const manualCollapsedRows =
      shouldClearRowCache || !allowRowCollapsed ? [] : sessionCollapsedRows;
    const manualCollapsedCols =
      shouldClearColCache || !allowColCollapsed ? [] : sessionCollapsedCols;

    const persistedLayoutMismatch =
      !persistedSeed ||
      !isSameLayout(persistedSeed.rowKeys, currentLayout.rows) ||
      !isSameLayout(persistedSeed.colKeys, currentLayout.cols);
    const hasPersistedExpansionState =
      persistedExpansionStateRef.current !== undefined &&
      persistedExpansionStateRef.current !== null;
    const shouldResetPersistedLayout =
      shouldPersistExpansionState &&
      hasPersistedExpansionState &&
      persistedLayoutMismatch;

    const normalizedRowCache =
      effectiveExpandRowsLevel === 0 &&
      !shouldClearRowCache &&
      (prevAutoExpandRows ?? 0) > 0
        ? stripAutoSeededExpansions({
            keys: manualRows,
            collapsedKeys: manualCollapsedRows,
            nodes: data.rows,
            metricLabelSet: metricLabelSetForDepth,
            includeMetricDepthZero: shouldExpandMetricRows,
          })
        : { keys: manualRows, collapsedKeys: manualCollapsedRows };
    const normalizedColCache =
      effectiveExpandColsLevel === 0 &&
      !shouldClearColCache &&
      (prevAutoExpandCols ?? 0) > 0
        ? stripAutoSeededExpansions({
            keys: manualCols,
            collapsedKeys: manualCollapsedCols,
            nodes: data.cols,
            metricLabelSet: metricLabelSetForDepth,
            includeMetricDepthZero: shouldExpandMetricCols,
          })
        : { keys: manualCols, collapsedKeys: manualCollapsedCols };

    if (shouldClearRowCache || shouldClearColCache) {
      persistExpansionStateToStore({
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: shouldClearRowCache ? [] : sessionRows,
        cols: shouldClearColCache ? [] : sessionCols,
        collapsedRows: shouldClearRowCache ? [] : sessionCollapsedRows,
        collapsedCols: shouldClearColCache ? [] : sessionCollapsedCols,
      });
    }

    const pruneManualKeys = (
      keys: string[],
      stablePrefix: number,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      if (!shouldResetExpanded) {
        return keys.filter(key => key !== rootKey);
      }
      const expanded = new Set<string>([rootKey, ...keys]);
      const pruned = pruneExpandedToStablePrefix({
        expanded,
        nodes,
        stablePrefix,
        metricLabelSet: metricLabelSetForDepth,
      });
      pruned.delete(rootKey);
      return Array.from(pruned);
    };

    const pruneCollapsedKeys = (
      keys: string[],
      stablePrefix: number,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      if (!shouldResetExpanded) {
        return keys.filter(key => key !== rootKey);
      }
      return keys.filter(key => {
        if (key === rootKey) {
          return false;
        }
        const node = nodes[key];
        const path = node ? node.path : parsePath(key);
        const depth = countDimDepth(path, metricLabelSetForDepth);
        return depth <= stablePrefix;
      });
    };

    const prunedManualRows = pruneManualKeys(
      normalizedRowCache.keys,
      rowStablePrefix,
      data.rows,
    );
    const prunedManualCols = pruneManualKeys(
      normalizedColCache.keys,
      colStablePrefix,
      data.cols,
    );
    const prunedCollapsedRows = pruneCollapsedKeys(
      normalizedRowCache.collapsedKeys,
      rowStablePrefix,
      data.rows,
    );
    const prunedCollapsedCols = pruneCollapsedKeys(
      normalizedColCache.collapsedKeys,
      colStablePrefix,
      data.cols,
    );

    explicitExpandedRowsRef.current = new Set(prunedManualRows);
    explicitExpandedColsRef.current = new Set(prunedManualCols);
    explicitCollapsedRowsRef.current = new Set(prunedCollapsedRows);
    explicitCollapsedColsRef.current = new Set(prunedCollapsedCols);

    persistExpansionStateToStore(
      {
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: prunedManualRows,
        cols: prunedManualCols,
        collapsedRows: prunedCollapsedRows,
        collapsedCols: prunedCollapsedCols,
      },
      {
        persist: shouldResetPersistedLayout || (!isInitialMount && shouldResetExpanded),
      },
    );

    const nextExpandedRows = buildDesiredExpandedKeys({
      axis: 'row',
      tree: data,
      autoExpandLevel: effectiveExpandRowsLevel,
      metricLabelSet: metricLabelSetForDepth,
      includeMetricDepthZero: shouldExpandMetricRows,
      manualExpanded: explicitExpandedRowsRef.current,
      manualCollapsed: explicitCollapsedRowsRef.current,
      pendingKeys: new Set(),
      inFlightKeys: new Set(),
    });
    const nextExpandedCols = buildDesiredExpandedKeys({
      axis: 'col',
      tree: data,
      autoExpandLevel: effectiveExpandColsLevel,
      metricLabelSet: metricLabelSetForDepth,
      includeMetricDepthZero: shouldExpandMetricCols,
      manualExpanded: explicitExpandedColsRef.current,
      manualCollapsed: explicitCollapsedColsRef.current,
      pendingKeys: new Set(),
      inFlightKeys: new Set(),
    });

    const prunedRows = shouldResetExpanded
      ? pruneExpandedToStablePrefix({
          expanded: nextExpandedRows,
          nodes: data.rows,
          stablePrefix: rowStablePrefix,
          metricLabelSet: metricLabelSetForDepth,
        })
      : nextExpandedRows;
    const prunedCols = shouldResetExpanded
      ? pruneExpandedToStablePrefix({
          expanded: nextExpandedCols,
          nodes: data.cols,
          stablePrefix: colStablePrefix,
          metricLabelSet: metricLabelSetForDepth,
        })
      : nextExpandedCols;

    const resolvedRows = resolveExpandedForMetrics('row', prunedRows, data);
    const resolvedCols = resolveExpandedForMetrics('col', prunedCols, data);

    setExpandedRowsState(resolvedRows);
    setExpandedColsState(resolvedCols);
    setPendingRowsState(new Set());
    setPendingColsState(new Set());

    prevAutoExpandRowsRef.current = effectiveExpandRowsLevel;
    prevAutoExpandColsRef.current = effectiveExpandColsLevel;
    prevExpandRowsLevelRawRef.current = expandRowsLevelRaw;
    prevExpandColsLevelRawRef.current = expandColumnsLevelRaw;

    const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
      resolvedRows,
      resolvedCols,
      data,
    );
    const hasRowExpansionRequests =
      effectiveExpandRowsLevel > 0 ||
      prunedManualRows.length > 0 ||
      prunedCollapsedRows.length > 0;
    const hasColExpansionRequests =
      effectiveExpandColsLevel > 0 ||
      prunedManualCols.length > 0 ||
      prunedCollapsedCols.length > 0;
    const shouldPlanRows = hasRowExpansionRequests;
    const shouldPlanCols = hasColExpansionRequests;
    const seedFetchedDepths = (
      axis: PivotAxis,
      expandedKeys: Set<string>,
      requiredOppositeDepth: number,
    ) => {
      const nodes = axis === 'row' ? data.rows : data.cols;
      const fetchedKeysRef =
        axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
      expandedKeys.forEach(key => {
        const node = nodes[key];
        if (!node) {
          return;
        }
        if (
          !hasLoadedChildrenForTree(
            data,
            axis,
            node,
            visibleRowDepth,
            visibleColDepth,
          )
        ) {
          return;
        }
        fetchedKeysRef.current.set(key, requiredOppositeDepth);
      });
    };
    seedFetchedDepths('row', resolvedRows, visibleColDepth);
    seedFetchedDepths('col', resolvedCols, visibleRowDepth);
    const { rowPlan: nextRowPlan, colPlan: nextColPlan } = planHydrationIteration(
      {
        tree: data,
        desiredRows: resolvedRows,
        desiredCols: resolvedCols,
        fetchedRowDepthByKey: fetchedRowKeysRef.current,
        fetchedColDepthByKey: fetchedColKeysRef.current,
        config: visibilityConfig,
        getGroupedFetchKey,
        pendingRows: new Set(),
        pendingCols: new Set(),
        planRows: shouldPlanRows,
        planCols: shouldPlanCols,
      },
    );
    const isRootOnly =
      resolvedRows.size === 1 &&
      resolvedRows.has(rootKey) &&
      resolvedCols.size === 1 &&
      resolvedCols.has(rootKey);
    const hasManualExpansions =
      prunedManualRows.length > 0 ||
      prunedManualCols.length > 0 ||
      prunedCollapsedRows.length > 0 ||
      prunedCollapsedCols.length > 0;
    const hasAutoExpansions =
      effectiveExpandRowsLevel > 0 || effectiveExpandColsLevel > 0;
    const hasRowNodes = Object.keys(data.rows).some(key => key !== rootKey);
    const hasColNodes = Object.keys(data.cols).some(key => key !== rootKey);
    const shouldSkipRootPrefetch =
      isRootOnly &&
      !hasManualExpansions &&
      !hasAutoExpansions &&
      !hasRowNodes &&
      !hasColNodes;
    const shouldShowPrefetchLoader =
      hasNestedPendingKeys(nextRowPlan.pendingKeys) ||
      hasNestedPendingKeys(nextColPlan.pendingKeys);
    if (nextRowPlan.pendingKeys.size + nextColPlan.pendingKeys.size > 0) {
      if (shouldSkipRootPrefetch) {
        setIsHydrating(false);
        return;
      }
      if (!shouldShowPrefetchLoader) {
        setIsHydrating(false);
      }
      hydrateAtomic('prefetch', {
        showLoader: shouldShowPrefetchLoader,
      }).catch(error => {
        reportAsyncError(error);
        setIsHydrating(false);
      });
      return;
    }
    setIsHydrating(false);
  }, [
    cancelInFlightRequestGroups,
    data,
    expandedStateSignature,
    computeVisibleDepths,
    expandColumnsLevelRaw,
    expandRowsLevelRaw,
    groupbyColumnKeys,
    groupbyRowKeys,
    hasLoadedChildrenForTree,
    metricLabelSet,
    persistExpansionStateToStore,
    shouldPersistExpansionState,
    resolvedExpandColumnsLevel,
    resolvedExpandRowsLevel,
    shouldExpandMetricCols,
    shouldExpandMetricRows,
    hydrateAtomic,
    resolveExpandedForMetrics,
    reportAsyncError,
    getGroupedFetchKey,
  ]);

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
  };
};
