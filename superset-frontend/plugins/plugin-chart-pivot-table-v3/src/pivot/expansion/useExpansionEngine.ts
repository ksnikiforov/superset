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
  type DataRecordValue,
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
  parsePath,
  serializePath,
  serializeCellKey,
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
import { fetchPivotBranchesBatch } from '../query/fetchPivotBranchesBatch';
import { rootKey } from '../viewModel';
import { planGroupedExpansionTargets } from './planner';
import { createExpansionStateStore, type ExpansionStateStore } from './store';
import { shouldFetchForDimensionAxisChange } from '../layout/shouldFetchForLayoutChange';
import { buildAxisCoverageKeyFromPathKey } from '../runtime/paths';
import type { PivotProgram } from '../runtime/types';
import { METRICS_PLACEHOLDER } from '../core/tokens';
import {
  addAncestors,
  buildDesiredExpandedKeys,
  buildHasLoadedChildren,
  computeVisibleDepths as computeVisibleDepthsBase,
  dropDescendants,
  getVisibleExpansionKeys as getVisibleExpansionKeysBase,
  isSameLayout,
  getStablePrefixLength,
  hasNestedPendingKeys,
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

const isPrefix = (prefix: string[], target: string[]) =>
  prefix.length <= target.length &&
  prefix.every((value, idx) => value === target[idx]);

const trimAxisByDepth = ({
  tree,
  axis,
  maxDepth,
  countDimDepth,
}: {
  tree: PivotTreeData;
  axis: PivotAxis;
  maxDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const nextNodes: Record<string, PivotTreeNode> = {};
  const removedKeys = new Set<string>();
  let hasChanges = false;
  Object.entries(nodes).forEach(([key, node]) => {
    const depth = countDimDepth(node.path);
    if (depth > maxDepth) {
      removedKeys.add(key);
      hasChanges = true;
      return;
    }
    let nextNode = node;
    if (depth >= maxDepth && node.hasChildren) {
      nextNode = { ...node, hasChildren: false };
      hasChanges = true;
    }
    nextNodes[key] = nextNode;
  });
  if (!hasChanges) {
    return { tree, removedKeys };
  }
  const nextTree =
    axis === 'row'
      ? { ...tree, rows: nextNodes }
      : { ...tree, cols: nextNodes };
  return { tree: nextTree, removedKeys };
};

const promoteAxisForDepth = ({
  tree,
  axis,
  maxDepth,
  countDimDepth,
  isMetricTokenValue,
  allowMetricPromotion = false,
}: {
  tree: PivotTreeData;
  axis: PivotAxis;
  maxDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
  allowMetricPromotion?: boolean;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  let hasChanges = false;
  const nextNodes: Record<string, PivotTreeNode> = { ...nodes };
  Object.entries(nodes).forEach(([key, node]) => {
    if (!allowMetricPromotion && node.path.some(isMetricTokenValue)) {
      return;
    }
    const depth = countDimDepth(node.path);
    if (depth < maxDepth && !node.hasChildren) {
      nextNodes[key] = { ...node, hasChildren: true };
      hasChanges = true;
    }
  });
  if (!hasChanges) {
    return tree;
  }
  return axis === 'row'
    ? { ...tree, rows: nextNodes }
    : { ...tree, cols: nextNodes };
};

const trimTreeForLayout = ({
  tree,
  trimRowDepth,
  trimColDepth,
  countDimDepth,
}: {
  tree: PivotTreeData;
  trimRowDepth?: number;
  trimColDepth?: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
}) => {
  let nextTree = tree;
  const removedRows = new Set<string>();
  const removedCols = new Set<string>();
  if (trimRowDepth !== undefined) {
    const result = trimAxisByDepth({
      tree: nextTree,
      axis: 'row',
      maxDepth: trimRowDepth,
      countDimDepth,
    });
    nextTree = result.tree;
    result.removedKeys.forEach(key => removedRows.add(key));
  }
  if (trimColDepth !== undefined) {
    const result = trimAxisByDepth({
      tree: nextTree,
      axis: 'col',
      maxDepth: trimColDepth,
      countDimDepth,
    });
    nextTree = result.tree;
    result.removedKeys.forEach(key => removedCols.add(key));
  }
  if (removedRows.size === 0 && removedCols.size === 0) {
    return nextTree;
  }
  const resolveNearestSurvivingKey = (
    nodes: Record<string, PivotTreeNode>,
    key: string,
  ) => {
    if (nodes[key]) {
      return key;
    }
    const path = parsePath(key);
    for (let size = path.length - 1; size >= 0; size -= 1) {
      const candidate = serializePath(path.slice(0, size));
      if (nodes[candidate]) {
        return candidate;
      }
    }
    return nodes[rootKey] ? rootKey : undefined;
  };
  const mergeCellValues = (
    left?: Record<string, DataRecordValue>,
    right?: Record<string, DataRecordValue>,
  ) => {
    if (!left && !right) {
      return undefined;
    }
    const merged: Record<string, DataRecordValue> = { ...(left ?? {}) };
    Object.entries(right ?? {}).forEach(([metric, value]) => {
      const current = merged[metric];
      const leftNum = Number(current);
      const rightNum = Number(value);
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
        merged[metric] = leftNum + rightNum;
        return;
      }
      if (current === undefined || current === null) {
        merged[metric] = value;
        return;
      }
      if (value !== undefined && value !== null) {
        merged[metric] = value;
      }
    });
    return merged;
  };
  const nextCells: PivotTreeData['cells'] = {};
  Object.entries(nextTree.cells).forEach(([, cell]) => {
    const rowKey =
      removedRows.has(cell.rowKey) || !nextTree.rows[cell.rowKey]
        ? resolveNearestSurvivingKey(nextTree.rows, cell.rowKey)
        : cell.rowKey;
    const colKey =
      removedCols.has(cell.colKey) || !nextTree.cols[cell.colKey]
        ? resolveNearestSurvivingKey(nextTree.cols, cell.colKey)
        : cell.colKey;
    const collapsedToRowRoot =
      trimRowDepth === 0 && cell.rowKey !== rootKey && rowKey === rootKey;
    const collapsedToColRoot =
      trimColDepth === 0 && cell.colKey !== rootKey && colKey === rootKey;
    if (collapsedToRowRoot || collapsedToColRoot) {
      return;
    }
    if (rowKey === undefined || colKey === undefined) {
      return;
    }
    const nextKey = serializeCellKey(rowKey, colKey);
    const existing = nextCells[nextKey];
    const mergedValues = mergeCellValues(existing?.values, cell.values);
    nextCells[nextKey] = {
      ...(existing ?? cell),
      ...cell,
      rowKey,
      colKey,
      ...(mergedValues ? { values: mergedValues } : {}),
      isSubtotal:
        cell.isSubtotal ||
        existing?.isSubtotal ||
        rowKey !== cell.rowKey ||
        colKey !== cell.colKey,
    };
  });
  return { ...nextTree, cells: nextCells };
};

const remapFetchedDepthsForStableTrim = ({
  fetchedDepthByKey,
  stablePrefix,
  countDimDepth,
}: {
  fetchedDepthByKey: Map<string, number>;
  stablePrefix: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
}) => {
  if (fetchedDepthByKey.size === 0 || stablePrefix <= 0) {
    return new Map<string, number>();
  }
  const countCoverageDimDepth = (path: PivotTreeNode['path']) =>
    countDimDepth(path.filter(value => value !== METRICS_PLACEHOLDER));
  const next = new Map<string, number>();
  fetchedDepthByKey.forEach((requiredDepth, key) => {
    let candidatePath = parsePath(key);
    while (
      candidatePath.length > 0 &&
      countCoverageDimDepth(candidatePath) > stablePrefix
    ) {
      candidatePath = candidatePath.slice(0, candidatePath.length - 1);
    }
    const candidateKey = serializePath(candidatePath);
    if (candidateKey === rootKey && key !== rootKey) {
      return;
    }
    const existingDepth = next.get(candidateKey);
    next.set(
      candidateKey,
      existingDepth === undefined
        ? requiredDepth
        : Math.max(existingDepth, requiredDepth),
    );
  });
  return next;
};

const mapExpandedCoverageForStableTrim = ({
  axis,
  expandedKeys,
  previousNodes,
  nextNodes,
  stablePrefix,
  requiredOppositeDepth,
  countDimDepth,
  getCoverageKey,
}: {
  axis: PivotAxis;
  expandedKeys: Set<string>;
  previousNodes: Record<string, PivotTreeNode>;
  nextNodes: Record<string, PivotTreeNode>;
  stablePrefix: number;
  requiredOppositeDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
}) => {
  if (expandedKeys.size === 0 || stablePrefix <= 0) {
    return new Map<string, number>();
  }
  const resolveNearestSurvivingKey = (key: string) => {
    if (nextNodes[key]) {
      return key;
    }
    const path = parsePath(key);
    for (let size = path.length - 1; size >= 0; size -= 1) {
      const candidate = serializePath(path.slice(0, size));
      if (nextNodes[candidate]) {
        return candidate;
      }
    }
    return nextNodes[rootKey] ? rootKey : undefined;
  };
  const next = new Map<string, number>();
  expandedKeys.forEach(key => {
    if (key === rootKey) {
      return;
    }
    const node = previousNodes[key];
    if (!node) {
      return;
    }
    const hasPreviousDescendants = Object.values(previousNodes).some(
      candidate => {
        if (candidate.key === node.key) {
          return false;
        }
        if (candidate.path.length <= node.path.length) {
          return false;
        }
        return node.path.every(
          (value, index) => value === candidate.path[index],
        );
      },
    );
    if (!node.hasChildren && !hasPreviousDescendants) {
      return;
    }
    let candidatePath = node.path;
    while (
      candidatePath.length > 0 &&
      countDimDepth(candidatePath) > stablePrefix
    ) {
      candidatePath = candidatePath.slice(0, candidatePath.length - 1);
    }
    const candidateKey = serializePath(candidatePath);
    const resolvedKey = resolveNearestSurvivingKey(candidateKey);
    if (resolvedKey === undefined || resolvedKey === rootKey) {
      return;
    }
    const resolvedNode = nextNodes[resolvedKey];
    if (!resolvedNode || countDimDepth(resolvedNode.path) > stablePrefix) {
      return;
    }
    const coverageKey = getCoverageKey(axis, resolvedKey);
    const existingDepth = next.get(coverageKey);
    next.set(
      coverageKey,
      existingDepth === undefined
        ? requiredOppositeDepth
        : Math.max(existingDepth, requiredOppositeDepth),
    );
  });
  return next;
};

const promoteTreeForLayout = ({
  tree,
  promoteRowDepth,
  promoteColDepth,
  countDimDepth,
  isMetricTokenValue,
  allowMetricRowPromotion,
  allowMetricColPromotion,
}: {
  tree: PivotTreeData;
  promoteRowDepth?: number;
  promoteColDepth?: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
  allowMetricRowPromotion?: boolean;
  allowMetricColPromotion?: boolean;
}) => {
  let nextTree = tree;
  if (promoteRowDepth !== undefined) {
    nextTree = promoteAxisForDepth({
      tree: nextTree,
      axis: 'row',
      maxDepth: promoteRowDepth,
      countDimDepth,
      isMetricTokenValue,
      allowMetricPromotion: allowMetricRowPromotion,
    });
  }
  if (promoteColDepth !== undefined) {
    nextTree = promoteAxisForDepth({
      tree: nextTree,
      axis: 'col',
      maxDepth: promoteColDepth,
      countDimDepth,
      isMetricTokenValue,
      allowMetricPromotion: allowMetricColPromotion,
    });
  }
  return nextTree;
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
    expandedRows: Set<string>;
    expandedCols: Set<string>;
  }) => PivotTreeData;
};

export const useExpansionEngine = ({
  data,
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
  const expandedStateSharedSignatureRef = useRef<string | null>(null);
  const fetchedRowKeysRef = useRef<Map<string, number>>(new Map());
  const fetchedColKeysRef = useRef<Map<string, number>>(new Map());
  const transactionIdRef = useRef(0);
  const requestGroupPrefixRef = useRef(nanoid());
  const activeRequestGroupIdsRef = useRef(new Set<string>());
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

  const getCoverageKey = useCallback(
    (axis: PivotAxis, key: string) =>
      buildAxisCoverageKeyFromPathKey({
        program: pivotProgram,
        axis,
        key,
      }),
    [pivotProgram],
  );

  const markFetchedCoverage = useCallback(
    (axis: PivotAxis, key: string, requiredOppositeDepth: number) => {
      const fetchedKeysRef =
        axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
      const coverageKey = getCoverageKey(axis, key);
      const existingDepth = fetchedKeysRef.current.get(coverageKey);
      fetchedKeysRef.current.set(
        coverageKey,
        existingDepth === undefined
          ? requiredOppositeDepth
          : Math.max(existingDepth, requiredOppositeDepth),
      );
    },
    [getCoverageKey],
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

  const reportAsyncError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    transactionIdRef.current += 1;
    activeRequestGroupIdsRef.current.forEach(requestGroupId => {
      supersetChartDataClient.cancel(requestGroupId);
    });
    activeRequestGroupIdsRef.current.clear();
    loadingCountsRef.current = new Map();
    setLoadingKeys(new Set());
    setIsHydrating(false);
    setErrorMessage(message);
  }, []);

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
    async <T>(
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
      hasMultipleMeasures:
        metricLabelSet.size > 1 ||
        Object.values(fetchFormData.measureLeavesByMetric ?? {}).some(
          leaves => leaves.length > 1,
        ),
      metricIndexForRows,
      metricIndexForCols,
      isMetricTokenValue,
      countDimDepth,
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
          path,
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
              path,
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
              throw result.error;
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
              requestGroupId,
            }),
          );
          if (transactionIdRef.current === requestId) {
            addWarnings(result.warnings);
            if (result.error) {
              throw result.error;
            }
          }
          return { batch, data: result.data };
        } finally {
          if (transactionIdRef.current === requestId) {
            batch.targets.forEach(target =>
              updateLoadingKey(target.pathKey, -1),
            );
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
            getCoverageKey,
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
              path,
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
              path,
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
                markFetchedCoverage(
                  target.axis,
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
                markFetchedCoverage(
                  target.axis,
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
            markFetchedCoverage(axis, key, requiredDepth);
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
        const preserveMetricChildren =
          axis === 'col' &&
          metricIndexForCols !== undefined &&
          metricIndexForCols >= groupbyColumnsLength;
        const preservedTree =
          touchedPrefixes.length > 0
            ? pruneTreeByPrefixes(treeRef.current, axis, touchedPrefixes, {
                preserveMetricChildren,
                isMetricTokenValue,
              })
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
      hasLoadedChildrenForTree,
      persistExpansionState,
      getCoverageKey,
      resolveExpandedForMetrics,
      setExpandedColsState,
      setExpandedRowsState,
      trackRequestGroup,
      updateLoadingKey,
      markFetchedCoverage,
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
    [
      persistExpansionState,
      resolveExpandedForMetrics,
      setExpandedColsState,
      setExpandedRowsState,
      setPendingColsState,
      setPendingRowsState,
    ],
  );

  const hydrateAtomic = useCallback(
    async (
      reason: 'prefetch' | 'cross-axis',
      options?: {
        showLoader?: boolean;
        activeAxis?: PivotAxis;
        planRows?: boolean;
        planCols?: boolean;
      },
    ) => {
      const shouldShowLoader = options?.showLoader ?? false;
      const shouldPlanRows = options?.planRows ?? true;
      const shouldPlanCols = options?.planCols ?? true;
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
              path,
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
              throw result.error;
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
              requestGroupId,
            }),
          );
          if (transactionIdRef.current === transactionId) {
            addWarnings(result.warnings);
            if (result.error) {
              throw result.error;
            }
          }
          return { batch, data: result.data };
        } finally {
          if (transactionIdRef.current === transactionId) {
            batch.targets.forEach(target =>
              updateLoadingKey(target.pathKey, -1),
            );
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
          getCoverageKey,
          activeAxis: options?.activeAxis,
          pendingRows: pendingRowsRef.current,
          pendingCols: pendingColsRef.current,
          planRows: shouldPlanRows,
          planCols: shouldPlanCols,
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
            path,
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
            path,
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
            const groupKey = JSON.stringify([target.axis, target.pathKey]);
            const keys = groupKeyMap.get(groupKey) ?? [target.pathKey];
            keys.forEach(key => {
              markFetchedCoverage(
                target.axis,
                key,
                target.requiredOppositeDepth,
              );
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
            const groupKey = JSON.stringify([target.axis, target.pathKey]);
            const keys = groupKeyMap.get(groupKey) ?? [target.pathKey];
            keys.forEach(key => {
              markFetchedCoverage(
                target.axis,
                key,
                target.requiredOppositeDepth,
              );
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
            markFetchedCoverage(axis, key, requiredOppositeDepth);
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
      hasLoadedChildrenForTree,
      getCoverageKey,
      markFetchedCoverage,
      persistExpansionState,
      pruneMergedTree,
      setExpandedColsState,
      setExpandedRowsState,
      setPendingColsState,
      setPendingRowsState,
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
      setPendingColsState,
      setPendingRowsState,
    ],
  );

  useEffect(() => {
    const previousSignature = expandedStateSignatureRef.current;
    const shouldResetExpandedState =
      previousSignature !== expandedStateSignature;
    const isInitialMount = previousSignature === null;
    expandedStateSignatureRef.current = expandedStateSignature;
    const previousSharedSignature = expandedStateSharedSignatureRef.current;
    const sharedSignatureChanged =
      previousSharedSignature !== expandedStateSharedSignature;
    expandedStateSharedSignatureRef.current = expandedStateSharedSignature;
    const prevExpandRowsLevelRaw = prevExpandRowsLevelRawRef.current;
    const prevExpandColsLevelRaw = prevExpandColsLevelRawRef.current;
    const expandRowsLevelChanged =
      prevExpandRowsLevelRaw !== expandRowsLevelRaw;
    const expandColsLevelChanged =
      prevExpandColsLevelRaw !== expandColumnsLevelRaw;
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
    const persistedSeed = coerceExpansionState(
      persistedExpansionStateRef.current,
    );
    const metricLabelSetForDepth = new Set(Array.from(metricLabelSet));

    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
    const hasNewData = previousDataRef.current !== data;
    const shouldReinitialize =
      isInitialMount ||
      shouldResetExpandedState ||
      sharedSignatureChanged ||
      hasNewData ||
      expandRowsLevelChanged ||
      expandColsLevelChanged;
    if (!shouldReinitialize) {
      return;
    }
    previousLayoutRef.current = currentLayout;
    previousDataRef.current = data;
    const rowsChanged = !isSameLayout(previousLayout.rows, currentLayout.rows);
    const colsChanged = !isSameLayout(previousLayout.cols, currentLayout.cols);
    const shouldExpandRows =
      currentLayout.rows.length > previousLayout.rows.length &&
      isPrefix(previousLayout.rows, currentLayout.rows);
    const shouldExpandCols =
      currentLayout.cols.length > previousLayout.cols.length &&
      isPrefix(previousLayout.cols, currentLayout.cols);
    const shouldResetExpandedRows =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (rowsChanged && !shouldExpandRows));
    const shouldResetExpandedCols =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (colsChanged && !shouldExpandCols));
    const shouldResetExpanded =
      shouldResetExpandedRows || shouldResetExpandedCols;
    const layoutChanged = rowsChanged || colsChanged;
    const shouldUseCurrentTreeForLayoutProjection =
      layoutChanged &&
      !hasNewData &&
      !shouldFetchForDimensionAxisChange({
        prevRows: previousLayout.rows,
        prevCols: previousLayout.cols,
        nextRows: currentLayout.rows,
        nextCols: currentLayout.cols,
      });
    const projectionTree = mergeTrees(data, treeRef.current);
    const sourceTree = shouldUseCurrentTreeForLayoutProjection
      ? projectionTree
      : hasNewData || !layoutChanged
        ? data
        : treeRef.current;
    const hasAxisDepthCoverage = (
      nodes: Record<string, PivotTreeNode>,
      targetDepth: number,
    ) => {
      if (targetDepth <= 0) {
        return true;
      }
      return Object.values(nodes).some(
        node => countDimDepth(node.path) >= targetDepth,
      );
    };
    const canReuseExpandedRowData =
      shouldExpandRows &&
      hasAxisDepthCoverage(sourceTree.rows, currentLayout.rows.length);
    const canReuseExpandedColData =
      shouldExpandCols &&
      hasAxisDepthCoverage(sourceTree.cols, currentLayout.cols.length);
    const shouldPruneRowsForLayoutChange =
      rowsChanged && !hasNewData && !canReuseExpandedRowData;
    const shouldPruneColsForLayoutChange =
      colsChanged && !hasNewData && !canReuseExpandedColData;
    const layoutRowsForPrune = rowsChanged
      ? previousLayout.rows
      : (sessionExpansionState.rowKeys ?? previousLayout.rows);
    const layoutColsForPrune = colsChanged
      ? previousLayout.cols
      : (sessionExpansionState.colKeys ?? previousLayout.cols);
    const rowStablePrefix = getStablePrefixLength(
      layoutRowsForPrune,
      currentLayout.rows,
    );
    const colStablePrefix = getStablePrefixLength(
      layoutColsForPrune,
      currentLayout.cols,
    );
    const autoExpandRowsLevelForDesired =
      shouldPruneRowsForLayoutChange && shouldExpandRows && rowStablePrefix > 0
        ? Math.min(effectiveExpandRowsLevel, Math.max(rowStablePrefix - 1, 0))
        : effectiveExpandRowsLevel;
    const autoExpandColsLevelForDesired =
      shouldPruneColsForLayoutChange && shouldExpandCols && colStablePrefix > 0
        ? Math.min(effectiveExpandColsLevel, Math.max(colStablePrefix - 1, 0))
        : effectiveExpandColsLevel;
    autoExpandRowsLevelRef.current = autoExpandRowsLevelForDesired;
    autoExpandColsLevelRef.current = autoExpandColsLevelForDesired;
    const allowMetricRowPromotion =
      metricIndexForRows !== undefined &&
      metricIndexForRows < groupbyRowsLength;
    const allowMetricColPromotion =
      metricIndexForCols !== undefined &&
      metricIndexForCols < groupbyColumnsLength;
    const baseTree =
      shouldPruneRowsForLayoutChange || shouldPruneColsForLayoutChange
        ? trimTreeForLayout({
            tree: sourceTree,
            trimRowDepth: shouldPruneRowsForLayoutChange
              ? rowStablePrefix
              : undefined,
            trimColDepth: shouldPruneColsForLayoutChange
              ? colStablePrefix
              : undefined,
            countDimDepth,
          })
        : sourceTree;
    const normalizedTree =
      shouldPruneRowsForLayoutChange || shouldPruneColsForLayoutChange
        ? promoteTreeForLayout({
            tree: baseTree,
            promoteRowDepth: shouldPruneRowsForLayoutChange
              ? currentLayout.rows.length
              : undefined,
            promoteColDepth: shouldPruneColsForLayoutChange
              ? currentLayout.cols.length
              : undefined,
            countDimDepth,
            isMetricTokenValue,
            allowMetricRowPromotion,
            allowMetricColPromotion,
          })
        : baseTree;

    const shouldCarryFetchedRowsForTrim =
      !hasNewData &&
      currentLayout.rows.length < previousLayout.rows.length &&
      isPrefix(currentLayout.rows, previousLayout.rows) &&
      rowStablePrefix > 0;
    const shouldCarryFetchedColsForTrim =
      !hasNewData &&
      currentLayout.cols.length < previousLayout.cols.length &&
      isPrefix(currentLayout.cols, previousLayout.cols) &&
      colStablePrefix > 0;
    const remappedFetchedRows = shouldCarryFetchedRowsForTrim
      ? remapFetchedDepthsForStableTrim({
          fetchedDepthByKey: fetchedRowKeysRef.current,
          stablePrefix: rowStablePrefix,
          countDimDepth,
        })
      : new Map<string, number>();
    const remappedFetchedCols = shouldCarryFetchedColsForTrim
      ? remapFetchedDepthsForStableTrim({
          fetchedDepthByKey: fetchedColKeysRef.current,
          stablePrefix: colStablePrefix,
          countDimDepth,
        })
      : new Map<string, number>();
    const {
      visibleRowDepth: previousVisibleRowDepth,
      visibleColDepth: previousVisibleColDepth,
    } = computeVisibleDepthsBase({
      tree: sourceTree,
      expandedRows: expandedRowsRef.current,
      expandedCols: expandedColsRef.current,
      config: visibilityConfig,
    });
    const expandedRowCoverage = shouldCarryFetchedRowsForTrim
      ? mapExpandedCoverageForStableTrim({
          axis: 'row',
          expandedKeys: expandedRowsRef.current,
          previousNodes: sourceTree.rows,
          nextNodes: normalizedTree.rows,
          stablePrefix: rowStablePrefix,
          requiredOppositeDepth: previousVisibleColDepth,
          countDimDepth,
          getCoverageKey,
        })
      : new Map<string, number>();
    const expandedColCoverage = shouldCarryFetchedColsForTrim
      ? mapExpandedCoverageForStableTrim({
          axis: 'col',
          expandedKeys: expandedColsRef.current,
          previousNodes: sourceTree.cols,
          nextNodes: normalizedTree.cols,
          stablePrefix: colStablePrefix,
          requiredOppositeDepth: previousVisibleRowDepth,
          countDimDepth,
          getCoverageKey,
        })
      : new Map<string, number>();
    expandedRowCoverage.forEach((depth, key) => {
      const existing = remappedFetchedRows.get(key);
      remappedFetchedRows.set(
        key,
        existing === undefined ? depth : Math.max(existing, depth),
      );
    });
    expandedColCoverage.forEach((depth, key) => {
      const existing = remappedFetchedCols.get(key);
      remappedFetchedCols.set(
        key,
        existing === undefined ? depth : Math.max(existing, depth),
      );
    });

    dataEpochRef.current += 1;
    transactionIdRef.current += 1;
    cancelInFlightRequestGroups();
    setIsHydrating(false);
    warningsRef.current = new Map();
    setWarnings([]);
    treeRef.current = normalizedTree;
    setTree(normalizedTree);
    setErrorMessage(undefined);
    fetchedRowKeysRef.current = remappedFetchedRows;
    fetchedColKeysRef.current = remappedFetchedCols;
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
            nodes: normalizedTree.rows,
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
            nodes: normalizedTree.cols,
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

    const resolveStableDepth = (
      path: PivotTreeNode['path'],
      includeMetricDepth: boolean,
    ) => {
      const baseDepth = countDimDepth(path);
      if (!includeMetricDepth) {
        return baseDepth;
      }
      return path.some(isMetricTokenValue) ? baseDepth + 1 : baseDepth;
    };

    const pruneManualKeys = (
      keys: string[],
      stablePrefix: number,
      nodes: Record<string, PivotTreeNode>,
      shouldPrune: boolean,
      includeMetricDepth: boolean,
    ) => {
      if (!shouldPrune) {
        return keys.filter(key => key !== rootKey);
      }
      const expanded = new Set<string>([rootKey, ...keys]);
      const pruned = pruneExpandedToStablePrefix({
        expanded,
        nodes,
        stablePrefix,
        metricLabelSet: metricLabelSetForDepth,
        includeMetricDepth,
      });
      pruned.delete(rootKey);
      return Array.from(pruned);
    };

    const pruneCollapsedKeys = (
      keys: string[],
      stablePrefix: number,
      nodes: Record<string, PivotTreeNode>,
      shouldPrune: boolean,
      includeMetricDepth: boolean,
    ) => {
      if (!shouldPrune) {
        return keys.filter(key => key !== rootKey);
      }
      return keys.filter(key => {
        if (key === rootKey) {
          return false;
        }
        const node = nodes[key];
        const path = node ? node.path : parsePath(key);
        const depth = resolveStableDepth(path, includeMetricDepth);
        return depth <= stablePrefix;
      });
    };

    const prunedManualRows = pruneManualKeys(
      normalizedRowCache.keys,
      rowStablePrefix,
      normalizedTree.rows,
      shouldResetExpandedRows || rowsChanged,
      allowMetricRowPromotion,
    );
    const prunedManualCols = pruneManualKeys(
      normalizedColCache.keys,
      colStablePrefix,
      normalizedTree.cols,
      shouldResetExpandedCols || colsChanged,
      allowMetricColPromotion,
    );
    const prunedManualRowsResolved = prunedManualRows;
    const prunedManualColsResolved = prunedManualCols;
    const prunedCollapsedRows = pruneCollapsedKeys(
      normalizedRowCache.collapsedKeys,
      rowStablePrefix,
      normalizedTree.rows,
      shouldResetExpandedRows || rowsChanged,
      allowMetricRowPromotion,
    );
    const prunedCollapsedCols = pruneCollapsedKeys(
      normalizedColCache.collapsedKeys,
      colStablePrefix,
      normalizedTree.cols,
      shouldResetExpandedCols || colsChanged,
      allowMetricColPromotion,
    );
    explicitExpandedRowsRef.current = new Set(prunedManualRowsResolved);
    explicitExpandedColsRef.current = new Set(prunedManualColsResolved);
    explicitCollapsedRowsRef.current = new Set(prunedCollapsedRows);
    explicitCollapsedColsRef.current = new Set(prunedCollapsedCols);

    persistExpansionStateToStore(
      {
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: prunedManualRowsResolved,
        cols: prunedManualColsResolved,
        collapsedRows: prunedCollapsedRows,
        collapsedCols: prunedCollapsedCols,
      },
      {
        persist:
          shouldResetPersistedLayout ||
          (!isInitialMount && shouldResetExpanded),
      },
    );

    const nextExpandedRows = buildDesiredExpandedKeys({
      axis: 'row',
      tree: normalizedTree,
      autoExpandLevel: autoExpandRowsLevelForDesired,
      metricLabelSet: metricLabelSetForDepth,
      includeMetricDepthZero: shouldExpandMetricRows,
      manualExpanded: explicitExpandedRowsRef.current,
      manualCollapsed: explicitCollapsedRowsRef.current,
      pendingKeys: new Set(),
      inFlightKeys: new Set(),
    });
    const nextExpandedCols = buildDesiredExpandedKeys({
      axis: 'col',
      tree: normalizedTree,
      autoExpandLevel: autoExpandColsLevelForDesired,
      metricLabelSet: metricLabelSetForDepth,
      includeMetricDepthZero: shouldExpandMetricCols,
      manualExpanded: explicitExpandedColsRef.current,
      manualCollapsed: explicitCollapsedColsRef.current,
      pendingKeys: new Set(),
      inFlightKeys: new Set(),
    });

    const shouldPruneRowsByStablePrefix =
      shouldResetExpandedRows || (rowsChanged && !hasNewData);
    const shouldPruneColsByStablePrefix =
      shouldResetExpandedCols || (colsChanged && !hasNewData);
    const prunedRows = shouldPruneRowsByStablePrefix
      ? pruneExpandedToStablePrefix({
          expanded: nextExpandedRows,
          nodes: normalizedTree.rows,
          stablePrefix: rowStablePrefix,
          metricLabelSet: metricLabelSetForDepth,
          includeMetricDepth: allowMetricRowPromotion,
        })
      : nextExpandedRows;
    const prunedCols = shouldPruneColsByStablePrefix
      ? pruneExpandedToStablePrefix({
          expanded: nextExpandedCols,
          nodes: normalizedTree.cols,
          stablePrefix: colStablePrefix,
          metricLabelSet: metricLabelSetForDepth,
          includeMetricDepth: allowMetricColPromotion,
        })
      : nextExpandedCols;

    const resolvedRows = resolveExpandedForMetrics(
      'row',
      prunedRows,
      normalizedTree,
    );
    const resolvedCols = resolveExpandedForMetrics(
      'col',
      prunedCols,
      normalizedTree,
    );

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
      normalizedTree,
    );
    const hasRowExpansionRequests =
      effectiveExpandRowsLevel > 0 ||
      prunedManualRowsResolved.length > 0 ||
      prunedCollapsedRows.length > 0;
    const hasColExpansionRequests =
      effectiveExpandColsLevel > 0 ||
      prunedManualColsResolved.length > 0 ||
      prunedCollapsedCols.length > 0;
    const shouldPlanRows = hasRowExpansionRequests;
    const shouldPlanCols = hasColExpansionRequests;
    const seedFetchedDepths = (
      axis: PivotAxis,
      expandedKeys: Set<string>,
      requiredOppositeDepth: number,
    ) => {
      const nodes = axis === 'row' ? normalizedTree.rows : normalizedTree.cols;
      expandedKeys.forEach(key => {
        const node = nodes[key];
        if (!node) {
          return;
        }
        if (
          !hasLoadedChildrenForTree(
            normalizedTree,
            axis,
            node,
            visibleRowDepth,
            visibleColDepth,
          )
        ) {
          return;
        }
        markFetchedCoverage(axis, key, requiredOppositeDepth);
      });
    };
    seedFetchedDepths('row', resolvedRows, visibleColDepth);
    seedFetchedDepths('col', resolvedCols, visibleRowDepth);
    const { rowPlan: nextRowPlan, colPlan: nextColPlan } =
      planHydrationIteration({
        tree: normalizedTree,
        desiredRows: resolvedRows,
        desiredCols: resolvedCols,
        fetchedRowDepthByKey: fetchedRowKeysRef.current,
        fetchedColDepthByKey: fetchedColKeysRef.current,
        config: visibilityConfig,
        getCoverageKey,
        pendingRows: new Set(),
        pendingCols: new Set(),
        planRows: shouldPlanRows,
        planCols: shouldPlanCols,
      });
    const isRootOnly =
      resolvedRows.size === 1 &&
      resolvedRows.has(rootKey) &&
      resolvedCols.size === 1 &&
      resolvedCols.has(rootKey);
    const hasManualExpansions =
      prunedManualRowsResolved.length > 0 ||
      prunedManualColsResolved.length > 0 ||
      prunedCollapsedRows.length > 0 ||
      prunedCollapsedCols.length > 0;
    const hasAutoExpansions =
      autoExpandRowsLevelForDesired > 0 || autoExpandColsLevelForDesired > 0;
    const hasRowNodes = Object.keys(normalizedTree.rows).some(
      key => key !== rootKey,
    );
    const hasColNodes = Object.keys(normalizedTree.cols).some(
      key => key !== rootKey,
    );
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
        planRows: shouldPlanRows,
        planCols: shouldPlanCols,
      }).catch(error => {
        reportAsyncError(error);
        setIsHydrating(false);
      });
      return;
    }
    setIsHydrating(false);
  }, [
    cancelInFlightRequestGroups,
    countDimDepth,
    data,
    expandedStateSignature,
    expandedStateSharedSignature,
    computeVisibleDepths,
    expandColumnsLevelRaw,
    expandRowsLevelRaw,
    groupbyColumnKeys,
    groupbyRowKeys,
    hasLoadedChildrenForTree,
    isMetricTokenValue,
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
    getCoverageKey,
    markFetchedCoverage,
    setExpandedColsState,
    setExpandedRowsState,
    setPendingColsState,
    setPendingRowsState,
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
