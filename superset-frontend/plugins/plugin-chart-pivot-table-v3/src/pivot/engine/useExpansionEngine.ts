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
import { useCallback, useEffect, useRef, useState } from 'react';
import { type HandlerFunction } from '@superset-ui/core';
import {
  type PivotExpansionState,
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  isSubtotalToken,
  parsePath,
  serializePath,
  mergeTrees,
} from '../../utils';
import {
  planExpansionForAxis,
  type PivotExpansionPlan,
} from './expansionPlanner';
import {
  coerceExpansionState,
  pruneExpandedToStablePrefix,
  seedExpandedByLevel,
  stripAutoSeededExpansions,
  type PivotExpansionStateKeys,
} from './expansionStateModel';
import { type FetchTarget } from './fetchCoordinator';
import {
  buildStagedTree,
  createStagingTree,
  stageDelta,
  type StagingTreeState,
} from './stagingTree';
import { fetchPivotBranch, peekPivotBranchCache } from '../../fetchPivotBranch';
import { buildBatchSignature } from './query/batchSignature';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
} from './query/fetchPlanOptimizer';
import { fetchPivotBranchesBatch } from './query/fetchPivotBranchesBatch';
import {
  buildRenderModel,
  type RenderModelConfig,
} from '../render/renderModel';
import { findChildren, rootKey } from '../viewModel';
import {
  getVisibleDepths,
  hasLoadedChildren as hasLoadedChildrenBase,
} from '../visibility';

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

const getStablePrefixLength = (prev: string[], next: string[]) => {
  const max = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < max && prev[prefix] === next[prefix]) {
    prefix += 1;
  }
  return prefix;
};

const isSameLayout = (left?: string[], right?: string[]) => {
  if (!left || !right) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, idx) => value === right[idx]);
};

const addAncestors = (
  path: PivotTreeNode['path'],
  target: Set<string>,
  expanded?: Set<string>,
) => {
  for (let idx = 1; idx <= path.length; idx += 1) {
    const key = serializePath(path.slice(0, idx));
    if (expanded && !expanded.has(key) && idx < path.length) {
      continue;
    }
    target.add(key);
  }
};

const dropDescendants = (
  parentPath: PivotTreeNode['path'],
  keys: Set<string>,
  nodes: Record<string, PivotTreeNode>,
) => {
  const next = new Set<string>();
  keys.forEach(key => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    const isDescendant = parentPath.every((val, idx) => val === path[idx]);
    if (!isDescendant) {
      next.add(key);
    }
  });
  return next;
};

const findMetricIndex = (
  path: PivotTreeNode['path'],
  isMetricTokenValue: (value: unknown) => boolean,
) => path.findIndex(value => isMetricTokenValue(value));

const expandMetricPatternExpansions = ({
  expanded,
  nodes,
  metricIndex,
  isMetricTokenValue,
}: {
  expanded: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  metricIndex: number | undefined;
  isMetricTokenValue: (value: unknown) => boolean;
}) => {
  if (metricIndex === undefined || metricIndex < 0) {
    return expanded;
  }
  const resolved = new Set(expanded);
  const candidates = Object.values(nodes);
  expanded.forEach(key => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    const patternMetricIndex = findMetricIndex(path, isMetricTokenValue);
    if (patternMetricIndex < 0 || patternMetricIndex > metricIndex) {
      return;
    }
    const prefix = path.slice(0, patternMetricIndex);
    const metricToken = path[patternMetricIndex];
    const suffix = path.slice(patternMetricIndex + 1);
    candidates.forEach(candidate => {
      const candidateMetricIndex = findMetricIndex(
        candidate.path,
        isMetricTokenValue,
      );
      if (
        candidateMetricIndex < patternMetricIndex ||
        candidateMetricIndex > metricIndex
      ) {
        return;
      }
      if (candidate.path[candidateMetricIndex] !== metricToken) {
        return;
      }
      if (prefix.length > 0) {
        for (let idx = 0; idx < prefix.length; idx += 1) {
          if (candidate.path[idx] !== prefix[idx]) {
            return;
          }
        }
      }
      const suffixStart = candidateMetricIndex + 1;
      if (suffixStart + suffix.length > candidate.path.length) {
        return;
      }
      const expectedLength = suffixStart + suffix.length;
      if (candidate.path.length !== expectedLength) {
        return;
      }
      for (let idx = 0; idx < suffix.length; idx += 1) {
        if (candidate.path[suffixStart + idx] !== suffix[idx]) {
          return;
        }
      }
      resolved.add(candidate.key);
    });
  });
  return resolved;
};

const pruneFetchedDepths = ({
  parentPath,
  nodes,
  fetchedDepths,
  parentKey,
}: {
  parentPath: PivotTreeNode['path'];
  nodes: Record<string, PivotTreeNode>;
  fetchedDepths: Map<string, number>;
  parentKey: string;
}) => {
  if (fetchedDepths.size === 0) {
    return;
  }
  const remaining = dropDescendants(
    parentPath,
    new Set(fetchedDepths.keys()),
    nodes,
  );
  remaining.delete(parentKey);
  const next = new Map<string, number>();
  remaining.forEach(key => {
    const depth = fetchedDepths.get(key);
    if (depth !== undefined) {
      next.set(key, depth);
    }
  });
  fetchedDepths.clear();
  next.forEach((value, key) => {
    fetchedDepths.set(key, value);
  });
};

const pruneTreeByPrefixes = (
  tree: PivotTreeData,
  axis: PivotAxis,
  prefixes: PivotTreeNode['path'][],
) => {
  if (prefixes.length === 0) {
    return tree;
  }
  const isUnderPrefix = (path: PivotTreeNode['path']) =>
    prefixes.some(prefix => prefix.every((val, idx) => val === path[idx]));
  const removedRowKeys = new Set<string>();
  const removedColKeys = new Set<string>();
  if (axis === 'row') {
    Object.values(tree.rows).forEach(node => {
      if (isUnderPrefix(node.path)) {
        removedRowKeys.add(node.key);
      }
    });
  } else {
    Object.values(tree.cols).forEach(node => {
      if (isUnderPrefix(node.path)) {
        removedColKeys.add(node.key);
      }
    });
  }
  if (removedRowKeys.size === 0 && removedColKeys.size === 0) {
    return tree;
  }
  const nextRows = axis === 'row' ? { ...tree.rows } : tree.rows;
  removedRowKeys.forEach(key => {
    delete nextRows[key];
  });
  const nextCols = axis === 'col' ? { ...tree.cols } : tree.cols;
  removedColKeys.forEach(key => {
    delete nextCols[key];
  });
  const nextCells: PivotTreeData['cells'] = {};
  Object.entries(tree.cells).forEach(([key, cell]) => {
    if (removedRowKeys.has(cell.rowKey) || removedColKeys.has(cell.colKey)) {
      return;
    }
    nextCells[key] = cell;
  });
  return { ...tree, rows: nextRows, cols: nextCols, cells: nextCells };
};

const hasNestedPendingKeys = (keys: Set<string>) => {
  if (keys.size < 2) {
    return false;
  }
  const paths = Array.from(keys).map(key => parsePath(key));
  return paths.some((candidate, idx) =>
    paths.some((prefix, otherIdx) => {
      if (idx === otherIdx) {
        return false;
      }
      if (prefix.length === 0 || prefix.length >= candidate.length) {
        return false;
      }
      return prefix.every((val, index) => val === candidate[index]);
    }),
  );
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
  pivotExpansionState?: PivotExpansionState;
  shouldPersistExpansionState: boolean;
  getVisibleExpansionKeys: (
    rows: Set<string>,
    cols: Set<string>,
    tree: PivotTreeData,
  ) => { rows: Set<string>; cols: Set<string> };
  buildRenderModelConfig: (
    expandedRows: Set<string>,
    expandedCols: Set<string>,
    tree: PivotTreeData,
  ) => RenderModelConfig;
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
  pivotExpansionState,
  shouldPersistExpansionState,
  getVisibleExpansionKeys: getVisibleExpansionKeysBase,
  buildRenderModelConfig,
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
  const pivotExpansionStateRef = useRef<PivotExpansionState | undefined>(
    pivotExpansionState,
  );
  const dataEpochRef = useRef(0);
  const previousLayoutRef = useRef({
    rows: groupbyRowKeys,
    cols: groupbyColumnKeys,
  });

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

  useEffect(() => {
    pivotExpansionStateRef.current = pivotExpansionState;
  }, [pivotExpansionState]);

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
      const metricIndex = findMetricIndex(path, isMetricTokenValue);
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

  const getMetricIndexFromNodes = useCallback(
    (nodes: Record<string, PivotTreeNode>) => {
      let found: number | undefined;
      let foundFromSubtotal: number | undefined;
      Object.values(nodes).forEach(node => {
        const idx = node.path.findIndex(val => isMetricTokenValue(val));
        if (idx < 0) {
          return;
        }
        if (node.path.some(val => isSubtotalToken(val))) {
          foundFromSubtotal =
            foundFromSubtotal === undefined
              ? idx
              : Math.max(foundFromSubtotal, idx);
          return;
        }
        found = found === undefined ? idx : Math.max(found, idx);
      });
      return found ?? foundFromSubtotal;
    },
    [isMetricTokenValue],
  );

  const reportAsyncError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    },
    [setErrorMessage],
  );
  const persistExpansionStateToStore = useCallback(
    (nextState: PivotExpansionStateKeys) => {
      if (!shouldPersistExpansionState || !setControlValue) {
        return;
      }
      const toPathArray = (keys: string[]) => keys.map(key => parsePath(key));
      const payload = {
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: toPathArray(nextState.rows),
        cols: toPathArray(nextState.cols),
        collapsedRows: toPathArray(nextState.collapsedRows ?? []),
        collapsedCols: toPathArray(nextState.collapsedCols ?? []),
      };
      setControlValue('pivotExpansionState', payload);
    },
    [
      groupbyColumnKeys,
      groupbyRowKeys,
      setControlValue,
      shouldPersistExpansionState,
    ],
  );

  const persistExpansionState = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>) => {
      const visibleKeys = getVisibleExpansionKeysBase(
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
      getVisibleExpansionKeysBase,
      groupbyColumnKeys,
      groupbyRowKeys,
      persistExpansionStateToStore,
      resolvedExpandColumnsLevel,
      resolvedExpandRowsLevel,
    ],
  );

  const resolveExpandedForMetrics = useCallback(
    (axis: PivotAxis, nextExpanded: Set<string>, nextTree: PivotTreeData) => {
      const nodes = axis === 'row' ? nextTree.rows : nextTree.cols;
      const metricIndex =
        getMetricIndexFromNodes(nodes) ??
        (axis === 'row' ? metricIndexForRows : metricIndexForCols);
      const collapsed =
        axis === 'row'
          ? explicitCollapsedRowsRef.current
          : explicitCollapsedColsRef.current;
      const resolved = expandMetricPatternExpansions({
        expanded: nextExpanded,
        nodes,
        metricIndex,
        isMetricTokenValue,
      });
      if (collapsed.size === 0) {
        if (metricIndex === undefined) {
          return resolved;
        }
        const next = new Set(resolved);
        resolved.forEach(key => {
          if (key === rootKey || nodes[key]) {
            return;
          }
          const path = parsePath(key);
          const keyMetricIndex = findMetricIndex(path, isMetricTokenValue);
          if (keyMetricIndex >= 0 && keyMetricIndex < metricIndex) {
            next.delete(key);
          }
        });
        return next;
      }
      const next = new Set(resolved);
      collapsed.forEach(key => next.delete(key));
      if (metricIndex === undefined) {
        return next;
      }
      next.forEach(key => {
        if (key === rootKey || nodes[key]) {
          return;
        }
        const path = parsePath(key);
        const keyMetricIndex = findMetricIndex(path, isMetricTokenValue);
        if (keyMetricIndex >= 0 && keyMetricIndex < metricIndex) {
          next.delete(key);
        }
      });
      return next;
    },
    [
      getMetricIndexFromNodes,
      isMetricTokenValue,
      metricIndexForCols,
      metricIndexForRows,
    ],
  );

  const buildDesiredExpanded = useCallback(
    (axis: PivotAxis, nextTree: PivotTreeData) => {
      const nodes = axis === 'row' ? nextTree.rows : nextTree.cols;
      const autoLevel =
        axis === 'row'
          ? autoExpandRowsLevelRef.current
          : autoExpandColsLevelRef.current;
      const autoSeeded = seedExpandedByLevel(
        nodes,
        autoLevel,
        new Set(Array.from(metricLabelSet)),
        {
          includeMetricDepthZero:
            axis === 'row' ? shouldExpandMetricRows : shouldExpandMetricCols,
        },
      );
      const manualExpanded =
        axis === 'row'
          ? explicitExpandedRowsRef.current
          : explicitExpandedColsRef.current;
      const manualCollapsed =
        axis === 'row'
          ? explicitCollapsedRowsRef.current
          : explicitCollapsedColsRef.current;
      const pending =
        axis === 'row' ? pendingRowsRef.current : pendingColsRef.current;
      const inFlight = collectInFlightExpanded(axis);
      const next = new Set<string>([
        ...autoSeeded,
        ...manualExpanded,
        ...pending,
        ...inFlight,
      ]);
      manualCollapsed.forEach(key => next.delete(key));
      return next;
    },
    [
      collectInFlightExpanded,
      metricLabelSet,
      shouldExpandMetricCols,
      shouldExpandMetricRows,
    ],
  );

  const computeVisibleDepths = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>, nextTree: PivotTreeData) => {
      const renderModel = buildRenderModel({
        tree: nextTree,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: buildRenderModelConfig(nextRows, nextCols, nextTree),
      });
      const { visibleRowDepth, visibleColDepth } = getVisibleDepths(
        renderModel.visibleRows,
        renderModel.visibleCols,
        countDimDepth,
      );
      return {
        visibleRowDepth,
        visibleColDepth,
      };
    },
    [buildRenderModelConfig, countDimDepth],
  );

  const applyCrossAxisRootFetch = useCallback(
    ({
      tree: nextTree,
      rowPlan,
      colPlan,
      visibleRowDepth,
      visibleColDepth,
    }: {
      tree: PivotTreeData;
      rowPlan: PivotExpansionPlan;
      colPlan: PivotExpansionPlan;
      visibleRowDepth: number;
      visibleColDepth: number;
    }) => {
      const nextRowPlan = {
        ...rowPlan,
        fetchKeys: new Set(rowPlan.fetchKeys),
        pendingKeys: new Set(rowPlan.pendingKeys),
      };
      const nextColPlan = {
        ...colPlan,
        fetchKeys: new Set(colPlan.fetchKeys),
        pendingKeys: new Set(colPlan.pendingKeys),
      };
      const hasRowNodes = Object.keys(nextTree.rows).some(
        key => key !== rootKey,
      );
      const hasColNodes = Object.keys(nextTree.cols).some(
        key => key !== rootKey,
      );
      const hasIntersectionCells = Object.values(nextTree.cells).some(cell => {
        const rowNode = nextTree.rows[cell.rowKey];
        const colNode = nextTree.cols[cell.colKey];
        if (!rowNode || !colNode) {
          return false;
        }
        return (
          countDimDepth(rowNode.path) > 0 && countDimDepth(colNode.path) > 0
        );
      });
      const shouldForceRootFetch =
        hasRowNodes &&
        hasColNodes &&
        visibleRowDepth > 0 &&
        visibleColDepth > 0 &&
        !hasIntersectionCells;
      if (
        shouldForceRootFetch &&
        !nextRowPlan.fetchKeys.has(rootKey) &&
        !nextColPlan.fetchKeys.has(rootKey)
      ) {
        if (groupbyRowsLength > 0) {
          nextRowPlan.fetchKeys.add(rootKey);
          nextRowPlan.pendingKeys.add(rootKey);
        } else if (groupbyColumnsLength > 0) {
          nextColPlan.fetchKeys.add(rootKey);
          nextColPlan.pendingKeys.add(rootKey);
        }
      }
      return { rowPlan: nextRowPlan, colPlan: nextColPlan };
    },
    [countDimDepth, groupbyColumnsLength, groupbyRowsLength],
  );

  const hasLoadedChildrenForTree = useCallback(
    (
      tree: PivotTreeData,
      axis: PivotAxis,
      node: PivotTreeNode,
      visibleRowDepth: number,
      visibleColDepth: number,
    ) =>
      hasLoadedChildrenBase({
        axis,
        node,
        getRawChildren: (targetAxis, parent) =>
          targetAxis === 'row'
            ? findChildren(tree.rows, parent)
            : findChildren(tree.cols, parent),
        groupbyRowsLength,
        groupbyColsLength: groupbyColumnsLength,
        isMetricTokenValue,
        metricIndexForRows,
        metricIndexForCols,
        cells: tree.cells,
        rows: tree.rows,
        cols: tree.cols,
        visibleRowDepth,
        visibleColDepth,
        countDimDepth,
      }),
    [
      countDimDepth,
      groupbyColumnsLength,
      groupbyRowsLength,
      isMetricTokenValue,
      metricIndexForCols,
      metricIndexForRows,
    ],
  );
  const buildHasLoadedChildrenForIteration = useCallback(
    (
      nextTree: PivotTreeData,
      visibleRowDepth: number,
      visibleColDepth: number,
    ) =>
      (axis: PivotAxis, node: PivotTreeNode) =>
        hasLoadedChildrenForTree(
          nextTree,
          axis,
          node,
          visibleRowDepth,
          visibleColDepth,
        ),
    [hasLoadedChildrenForTree],
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
        updateLoadingKey(key, 1);
        try {
          const result = await fetchPivotBranch({
            axis,
            path: getFetchPath(path),
            metricPath: path,
            formData: fetchFormData,
            currentTree: treeSnapshot,
            visibleRowDepth,
            visibleColDepth,
          });
          if (!result) {
            return { key, data: undefined, requiredDepth };
          }
          if (result.error) {
            setErrorMessage(result.error.message);
          }
          return { key, data: result.data, requiredDepth };
        } finally {
          updateLoadingKey(key, -1);
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
        batch.targets.forEach(target => updateLoadingKey(target.pathKey, 1));
        try {
          const result = await fetchPivotBranchesBatch({
            formData: fetchFormData,
            batch,
            currentTree: treeSnapshot,
            visibleRowDepth,
            visibleColDepth,
            getFetchPath,
          });
          if (result.error) {
            setErrorMessage(result.error.message);
          }
          return { batch, data: result.data };
        } finally {
          batch.targets.forEach(target => updateLoadingKey(target.pathKey, -1));
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
          const plan = planExpansionForAxis({
            axis,
            expandedKeys: resolvedExpanded,
            nodes,
            requiredDepth,
            fetchedDepthByKey: fetchedKeysRef.current,
            hasLoadedChildren: hasLoadedChildrenForIteration,
          });
          if (plan.fetchKeys.size === 0) {
            break;
          }
          const fetchGroups = new Map<string, string[]>();
          for (const key of plan.fetchKeys) {
            const groupKey = getGroupedFetchKey(axis, key);
            const keys = fetchGroups.get(groupKey);
            if (keys) {
              keys.push(key);
            } else {
              fetchGroups.set(groupKey, [key]);
            }
          }
          const targets: FetchTarget[] = [];
          const groupKeyMap = new Map<string, string[]>();
          for (const keys of fetchGroups.values()) {
            const representative =
              keys.find(
                key => getGroupedFetchKey(axis, key) === key && nodes[key],
              ) ??
              keys.find(key => nodes[key]) ??
              keys[0];
            const target: FetchTarget = {
              axis,
              pathKey: representative,
              childDepth: parsePath(representative).length + 1,
              requiredOppositeDepth: requiredDepth,
            };
            targets.push(target);
            groupKeyMap.set(representative, keys);
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
              const keys = groupKeyMap.get(target.pathKey) ?? [target.pathKey];
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
              const keys = groupKeyMap.get(target.pathKey) ?? [target.pathKey];
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
      applyBatchDelta,
      applyBranchDelta,
      buildHasLoadedChildrenForIteration,
      computeVisibleDepths,
      fetchFormData,
      getFetchPath,
      hasLoadedChildrenForTree,
      persistExpansionState,
      getGroupedFetchKey,
      resolveExpandedForMetrics,
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
        updateLoadingKey(target.pathKey, 1);
        try {
          const result = await fetchPivotBranch({
            axis: target.axis,
            path: getFetchPath(path),
            metricPath: path,
            formData: fetchFormData,
            currentTree: context.stagedTree,
            visibleRowDepth: context.visibleRowDepth,
            visibleColDepth: context.visibleColDepth,
          });
          if (!result) {
            return { target, data: undefined };
          }
          if (result.error) {
            setErrorMessage(result.error.message);
          }
          return { target, data: result.data };
        } finally {
          updateLoadingKey(target.pathKey, -1);
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
        batch.targets.forEach(target => updateLoadingKey(target.pathKey, 1));
        try {
          const result = await fetchPivotBranchesBatch({
            formData: fetchFormData,
            batch,
            currentTree: context.stagedTree,
            visibleRowDepth: context.visibleRowDepth,
            visibleColDepth: context.visibleColDepth,
            getFetchPath,
          });
          if (result.error) {
            setErrorMessage(result.error.message);
          }
          return { batch, data: result.data };
        } finally {
          batch.targets.forEach(target => updateLoadingKey(target.pathKey, -1));
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
        const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
          desiredRows,
          desiredCols,
          stagedTree,
        );
        const hasLoadedChildrenForIteration =
          buildHasLoadedChildrenForIteration(
            stagedTree,
            visibleRowDepth,
            visibleColDepth,
          );
        const rowPlan = planExpansionForAxis({
          axis: 'row',
          expandedKeys: desiredRows,
          nodes: stagedTree.rows,
          requiredDepth: visibleColDepth,
          fetchedDepthByKey: fetchedRowKeysRef.current,
          hasLoadedChildren: hasLoadedChildrenForIteration,
        });
        const colPlan = planExpansionForAxis({
          axis: 'col',
          expandedKeys: desiredCols,
          nodes: stagedTree.cols,
          requiredDepth: visibleRowDepth,
          fetchedDepthByKey: fetchedColKeysRef.current,
          hasLoadedChildren: hasLoadedChildrenForIteration,
        });
        const activeAxis = options?.activeAxis;
        let effectiveRowPlan = rowPlan;
        let effectiveColPlan = colPlan;
        if (
          activeAxis === 'col' &&
          colPlan.fetchKeys.size > 0 &&
          !rowPlan.hasMissingNodes &&
          pendingRowsRef.current.size === 0
        ) {
          effectiveRowPlan = {
            ...rowPlan,
            fetchKeys: new Set(),
            pendingKeys: new Set(),
          };
        }
        if (
          activeAxis === 'row' &&
          rowPlan.fetchKeys.size > 0 &&
          !colPlan.hasMissingNodes &&
          pendingColsRef.current.size === 0
        ) {
          effectiveColPlan = {
            ...colPlan,
            fetchKeys: new Set(),
            pendingKeys: new Set(),
          };
        }
        ({ rowPlan: effectiveRowPlan, colPlan: effectiveColPlan } =
          applyCrossAxisRootFetch({
            tree: stagedTree,
            rowPlan: effectiveRowPlan,
            colPlan: effectiveColPlan,
            visibleRowDepth,
            visibleColDepth,
          }));

        if (
          effectiveRowPlan.pendingKeys.size === 0 &&
          effectiveColPlan.pendingKeys.size === 0
        ) {
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

        const buildGroupedTargets = (
          axis: PivotAxis,
          fetchKeys: Set<string>,
          nodes: Record<string, PivotTreeNode>,
          requiredOppositeDepth: number,
        ) => {
          const groups = new Map<string, string[]>();
          fetchKeys.forEach(key => {
            const groupKey = getGroupedFetchKey(axis, key);
            const existing = groups.get(groupKey);
            if (existing) {
              existing.push(key);
            } else {
              groups.set(groupKey, [key]);
            }
          });
          const groupedTargets: FetchTarget[] = [];
          const groupKeyMap = new Map<string, string[]>();
          for (const keys of groups.values()) {
            const representative =
              keys.find(
                key => getGroupedFetchKey(axis, key) === key && nodes[key],
              ) ??
              keys.find(key => nodes[key]) ??
              keys[0];
            const target: FetchTarget = {
              axis,
              pathKey: representative,
              childDepth: parsePath(representative).length + 1,
              requiredOppositeDepth,
            };
            groupedTargets.push(target);
            groupKeyMap.set(JSON.stringify([axis, representative]), keys);
          }
          return { groupedTargets, groupKeyMap };
        };

        const rowGroups = buildGroupedTargets(
          'row',
          effectiveRowPlan.fetchKeys,
          stagedTree.rows,
          visibleColDepth,
        );
        const colGroups = buildGroupedTargets(
          'col',
          effectiveColPlan.fetchKeys,
          stagedTree.cols,
          visibleRowDepth,
        );
        const targets = [
          ...rowGroups.groupedTargets,
          ...colGroups.groupedTargets,
        ];
        const groupKeyMap = new Map<string, string[]>();
        rowGroups.groupKeyMap.forEach((value, key) => {
          groupKeyMap.set(key, value);
        });
        colGroups.groupKeyMap.forEach((value, key) => {
          groupKeyMap.set(key, value);
        });

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
      applyCrossAxisRootFetch,
      buildHasLoadedChildrenForIteration,
      computeVisibleDepths,
      collectInFlightExpanded,
      fetchFormData,
      getFetchPath,
      hasLoadedChildrenForTree,
      getGroupedFetchKey,
      persistExpansionState,
      updateLoadingKey,
      resolveExpandedForMetrics,
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
      collapseNode,
      computeVisibleDepths,
      expandSameAxis,
      hydrateAtomic,
      reportAsyncError,
    ],
  );

  useEffect(() => {
    const shouldResetExpanded =
      expandedStateSignatureRef.current !== expandedStateSignature;
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
    const formExpansionState = coerceExpansionState(
      pivotExpansionStateRef.current,
    );
    const sessionExpansionState: PivotExpansionStateKeys | undefined =
      formExpansionState ?? undefined;
    const metricLabelSetForDepth = new Set(Array.from(metricLabelSet));

    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
    previousLayoutRef.current = currentLayout;
    const layoutRowsForPrune =
      sessionExpansionState?.rowKeys ?? previousLayout.rows;
    const layoutColsForPrune =
      sessionExpansionState?.colKeys ?? previousLayout.cols;
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

    const sessionRows = sessionExpansionState?.rows ?? [];
    const sessionCols = sessionExpansionState?.cols ?? [];
    const sessionCollapsedRows = sessionExpansionState?.collapsedRows ?? [];
    const sessionCollapsedCols = sessionExpansionState?.collapsedCols ?? [];

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

    const layoutMismatch =
      !isSameLayout(sessionExpansionState?.rowKeys, currentLayout.rows) ||
      !isSameLayout(sessionExpansionState?.colKeys, currentLayout.cols);
    const hasPersistedExpansionState =
      pivotExpansionStateRef.current !== undefined &&
      pivotExpansionStateRef.current !== null;
    const shouldResetPersistedLayout =
      shouldPersistExpansionState &&
      hasPersistedExpansionState &&
      (!sessionExpansionState || layoutMismatch);

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

    if (shouldResetPersistedLayout) {
      persistExpansionStateToStore({
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: prunedManualRows,
        cols: prunedManualCols,
        collapsedRows: prunedCollapsedRows,
        collapsedCols: prunedCollapsedCols,
      });
    }

    const seededRows = seedExpandedByLevel(
      data.rows,
      effectiveExpandRowsLevel,
      metricLabelSetForDepth,
      { includeMetricDepthZero: shouldExpandMetricRows },
    );
    const seededCols = seedExpandedByLevel(
      data.cols,
      effectiveExpandColsLevel,
      metricLabelSetForDepth,
      { includeMetricDepthZero: shouldExpandMetricCols },
    );

    const nextExpandedRows = new Set(seededRows);
    explicitExpandedRowsRef.current.forEach(key => nextExpandedRows.add(key));
    explicitCollapsedRowsRef.current.forEach(key =>
      nextExpandedRows.delete(key),
    );

    const nextExpandedCols = new Set(seededCols);
    explicitExpandedColsRef.current.forEach(key => nextExpandedCols.add(key));
    explicitCollapsedColsRef.current.forEach(key =>
      nextExpandedCols.delete(key),
    );

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
    const rowPlan = shouldPlanRows
      ? planExpansionForAxis({
          axis: 'row',
          expandedKeys: resolvedRows,
          nodes: data.rows,
          requiredDepth: visibleColDepth,
          fetchedDepthByKey: fetchedRowKeysRef.current,
          hasLoadedChildren: (axis, node) =>
            hasLoadedChildrenForTree(
              data,
              axis,
              node,
              visibleRowDepth,
              visibleColDepth,
            ),
        })
      : {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        };
    const colPlan = shouldPlanCols
      ? planExpansionForAxis({
          axis: 'col',
          expandedKeys: resolvedCols,
          nodes: data.cols,
          requiredDepth: visibleRowDepth,
          fetchedDepthByKey: fetchedColKeysRef.current,
          hasLoadedChildren: (axis, node) =>
            hasLoadedChildrenForTree(
              data,
              axis,
              node,
              visibleRowDepth,
              visibleColDepth,
            ),
        })
      : {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        };
    const { rowPlan: nextRowPlan, colPlan: nextColPlan } =
      applyCrossAxisRootFetch({
        tree: data,
        rowPlan,
        colPlan,
        visibleRowDepth,
        visibleColDepth,
      });
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
    applyCrossAxisRootFetch,
    hydrateAtomic,
    resolveExpandedForMetrics,
    reportAsyncError,
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
    handleToggle,
  };
};
