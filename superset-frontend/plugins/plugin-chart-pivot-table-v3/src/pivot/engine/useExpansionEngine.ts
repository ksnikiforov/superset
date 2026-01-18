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
import { type JsonObject } from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { parsePath, serializePath, mergeTrees } from '../../utils';
import { planExpansionForAxis } from './expansionPlanner';
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

const getStablePrefixLength = (prev: string[], next: string[]) => {
  const max = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < max && prev[prefix] === next[prefix]) {
    prefix += 1;
  }
  return prefix;
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
  ownState?: JsonObject;
  setDataMask: (mask: { ownState: JsonObject }) => void;
  getVisibleExpansionKeys: (
    rows: Set<string>,
    cols: Set<string>,
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
  ownState,
  setDataMask,
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
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isHydrating, setIsHydrating] = useState(false);
  const prevAutoExpandRowsRef = useRef<number | null>(null);
  const prevAutoExpandColsRef = useRef<number | null>(null);
  const expandedStateSignatureRef = useRef<string | null>(null);
  const fetchedRowKeysRef = useRef<Map<string, number>>(new Map());
  const fetchedColKeysRef = useRef<Map<string, number>>(new Map());
  const transactionIdRef = useRef(0);
  const ownStateRef = useRef<JsonObject>(ownState ?? {});
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
    ownStateRef.current = ownState ?? {};
  }, [ownState]);

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

  const mergeOwnStateSafe = useCallback((partial: JsonObject) => {
    const next = { ...ownStateRef.current, ...partial };
    ownStateRef.current = next;
    return next;
  }, []);
  const reportAsyncError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    },
    [setErrorMessage],
  );

  const persistExpansionState = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>) => {
      const visibleKeys = getVisibleExpansionKeysBase(nextRows, nextCols);
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
        explicitCollapsedRowsRef.current,
        visibleKeys.rows,
      );
      const visibleCollapsedCols = filterVisible(
        explicitCollapsedColsRef.current,
        visibleKeys.cols,
      );
      explicitExpandedRowsRef.current = new Set(visibleRows);
      explicitExpandedColsRef.current = new Set(visibleCols);
      explicitCollapsedRowsRef.current = new Set(visibleCollapsedRows);
      explicitCollapsedColsRef.current = new Set(visibleCollapsedCols);
      setDataMask({
        ownState: {
          ...mergeOwnStateSafe({
            expansionState: {
              rows: visibleRows,
              cols: visibleCols,
              collapsedRows: visibleCollapsedRows,
              collapsedCols: visibleCollapsedCols,
            },
          }),
        },
      });
    },
    [getVisibleExpansionKeysBase, mergeOwnStateSafe, setDataMask],
  );

  const resolveExpandedForMetrics = useCallback(
    (axis: PivotAxis, nextExpanded: Set<string>, nextTree: PivotTreeData) => {
      const metricIndex =
        axis === 'row' ? metricIndexForRows : metricIndexForCols;
      const nodes = axis === 'row' ? nextTree.rows : nextTree.cols;
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
        return resolved;
      }
      const next = new Set(resolved);
      collapsed.forEach(key => next.delete(key));
      return next;
    },
    [isMetricTokenValue, metricIndexForCols, metricIndexForRows],
  );

  const computeVisibleDepths = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>, nextTree: PivotTreeData) => {
      const renderModel = buildRenderModel({
        tree: nextTree,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: buildRenderModelConfig(nextRows, nextCols, nextTree),
      });
      return getVisibleDepths(
        renderModel.visibleRows,
        renderModel.visibleCols,
        countDimDepth,
      );
    },
    [buildRenderModelConfig, countDimDepth],
  );

  const hasLoadedChildren = useCallback(
    (
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
            ? findChildren(treeRef.current.rows, parent)
            : findChildren(treeRef.current.cols, parent),
        groupbyRowsLength,
        groupbyColsLength: groupbyColumnsLength,
        isMetricTokenValue,
        metricIndexForRows,
        metricIndexForCols,
        cells: treeRef.current.cells,
        rows: treeRef.current.rows,
        cols: treeRef.current.cols,
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

      const getMetriclessKey = (key: string) =>
        serializePath(
          parsePath(key).filter(value => !isMetricTokenValue(value)),
        );

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
          const plan = planExpansionForAxis({
            axis,
            expandedKeys: resolvedExpanded,
            nodes,
            requiredDepth,
            fetchedDepthByKey: fetchedKeysRef.current,
            hasLoadedChildren: (targetAxis, targetNode) =>
              hasLoadedChildren(
                targetAxis,
                targetNode,
                visibleRowDepth,
                visibleColDepth,
              ),
          });
          if (plan.fetchKeys.size === 0) {
            break;
          }
          const fetchGroups = new Map<string, string[]>();
          for (const key of plan.fetchKeys) {
            const groupKey = getMetriclessKey(key);
            const keys = fetchGroups.get(groupKey);
            if (keys) {
              keys.push(key);
            } else {
              fetchGroups.set(groupKey, [key]);
            }
          }
          const fetchPromises: Array<ReturnType<typeof fetchBranchForKey>> = [];
          const groupKeyMap = new Map<string, string[]>();
          for (const keys of fetchGroups.values()) {
            const representative =
              keys.find(key => getMetriclessKey(key) === key && nodes[key]) ??
              keys.find(key => nodes[key]) ??
              keys[0];
            groupKeyMap.set(representative, keys);
            fetchPromises.push(
              fetchBranchForKey({
                key: representative,
                treeSnapshot: currentTree,
                visibleRowDepth,
                visibleColDepth,
                requiredDepth,
              }),
            );
          }
          // eslint-disable-next-line no-await-in-loop
          const results = await Promise.all(fetchPromises);
          if (
            dataEpochRef.current !== requestEpoch ||
            transactionIdRef.current !== requestId
          ) {
            return;
          }
          let didMerge = false;
          for (const { key, data, requiredDepth: depth } of results) {
            const keys = groupKeyMap.get(key) ?? [key];
            keys.forEach(groupKey => {
              fetchedKeysRef.current.set(groupKey, depth);
            });
            if (!data) {
              continue;
            }
            didMerge = true;
            currentTree = applyBranchDelta(
              currentTree,
              axis,
              key,
              data,
              expandedRowsForDepth,
              expandedColsForDepth,
            );
          }
          if (!didMerge) {
            break;
          }
          resolvedExpanded = resolveExpandedForMetrics(
            axis,
            baseExpanded,
            currentTree,
          );
        }

        if (transactionIdRef.current !== requestId) {
          return;
        }
        const finalExpanded = resolveExpandedForMetrics(
          axis,
          baseExpanded,
          currentTree,
        );
        setTree(currentTree);
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
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      }
    },
    [
      applyBranchDelta,
      computeVisibleDepths,
      fetchFormData,
      getFetchPath,
      hasLoadedChildren,
      isMetricTokenValue,
      persistExpansionState,
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
    async (_reason: 'prefetch' | 'cross-axis') => {
      const transactionId = transactionIdRef.current + 1;
      transactionIdRef.current = transactionId;
      setIsHydrating(true);

      const desiredRows = new Set([
        ...expandedRowsRef.current,
        ...pendingRowsRef.current,
      ]);
      const desiredCols = new Set([
        ...expandedColsRef.current,
        ...pendingColsRef.current,
      ]);

      let stagingState: StagingTreeState = createStagingTree(treeRef.current);

      const fetchTarget = async (
        target: FetchTarget,
        context: {
          stagedTree: PivotTreeData;
          visibleRowDepth: number;
          visibleColDepth: number;
        },
      ) => {
        const path = parsePath(target.pathKey);
        const cached = peekPivotBranchCache({
          axis: target.axis,
          path: getFetchPath(path),
          metricPath: path,
          formData: fetchFormData,
          currentTree: context.stagedTree,
          visibleRowDepth: context.visibleRowDepth,
          visibleColDepth: context.visibleColDepth,
        });
        if (cached) {
          return { target, data: cached, cached: true };
        }
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
            return { target, data: undefined, cached: false };
          }
          if (result.error) {
            setErrorMessage(result.error.message);
          }
          return { target, data: result.data, cached: false };
        } finally {
          updateLoadingKey(target.pathKey, -1);
        }
      };

      for (
        let iteration = 0;
        iteration < MAX_HYDRATION_ITERATIONS;
        iteration += 1
      ) {
        if (transactionIdRef.current !== transactionId) {
          return;
        }
        const stagedTree = buildStagedTree(stagingState);
        const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
          desiredRows,
          desiredCols,
          stagedTree,
        );
        const rowPlan = planExpansionForAxis({
          axis: 'row',
          expandedKeys: desiredRows,
          nodes: stagedTree.rows,
          requiredDepth: visibleColDepth,
          fetchedDepthByKey: fetchedRowKeysRef.current,
          hasLoadedChildren: (axis, node) =>
            hasLoadedChildren(axis, node, visibleRowDepth, visibleColDepth),
        });
        const colPlan = planExpansionForAxis({
          axis: 'col',
          expandedKeys: desiredCols,
          nodes: stagedTree.cols,
          requiredDepth: visibleRowDepth,
          fetchedDepthByKey: fetchedColKeysRef.current,
          hasLoadedChildren: (axis, node) =>
            hasLoadedChildren(axis, node, visibleRowDepth, visibleColDepth),
        });

        if (rowPlan.pendingKeys.size === 0 && colPlan.pendingKeys.size === 0) {
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
          setTree(mergedTree);
          setExpandedRowsState(resolvedRows);
          setExpandedColsState(resolvedCols);
          setPendingRowsState(new Set());
          setPendingColsState(new Set());
          setIsHydrating(false);
          return;
        }

        const targets: FetchTarget[] = [];
        for (const key of rowPlan.fetchKeys) {
          targets.push({
            axis: 'row',
            pathKey: key,
            childDepth: parsePath(key).length + 1,
            requiredOppositeDepth: visibleColDepth,
          });
        }
        for (const key of colPlan.fetchKeys) {
          targets.push({
            axis: 'col',
            pathKey: key,
            childDepth: parsePath(key).length + 1,
            requiredOppositeDepth: visibleRowDepth,
          });
        }

        const fetchContext = { stagedTree, visibleRowDepth, visibleColDepth };
        const fetchPromises: Array<ReturnType<typeof fetchTarget>> = [];
        for (const target of targets) {
          fetchPromises.push(fetchTarget(target, fetchContext));
        }
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(fetchPromises);

        if (transactionIdRef.current !== transactionId) {
          return;
        }

        for (const { target, data } of results) {
          const fetchedKeysRef =
            target.axis === 'row' ? fetchedRowKeysRef : fetchedColKeysRef;
          fetchedKeysRef.current.set(
            target.pathKey,
            target.requiredOppositeDepth,
          );
          if (!data) {
            continue;
          }
          const deltaKey = JSON.stringify([target.axis, target.pathKey]);
          stagingState = stageDelta(stagingState, deltaKey, data);
        }
      }

      setIsHydrating(false);
    },
    [
      computeVisibleDepths,
      fetchFormData,
      getFetchPath,
      hasLoadedChildren,
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
      const isAtomic =
        otherExpanded.size > 1 || otherPending.size > 0 || otherInFlight;

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
        hydrateAtomic('cross-axis').catch(error => {
          reportAsyncError(error);
          setIsHydrating(false);
        });
        return;
      }

      expandSameAxis(axis, node).catch(reportAsyncError);
    },
    [collapseNode, expandSameAxis, hydrateAtomic, reportAsyncError],
  );

  useEffect(() => {
    const shouldResetExpanded =
      expandedStateSignatureRef.current !== expandedStateSignature;
    expandedStateSignatureRef.current = expandedStateSignature;
    const sessionExpansionState: PivotExpansionStateKeys | undefined =
      coerceExpansionState(ownStateRef.current?.expansionState);

    const metricLabelSetForDepth = new Set(Array.from(metricLabelSet));

    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
    previousLayoutRef.current = currentLayout;

    const rowStablePrefix = getStablePrefixLength(
      previousLayout.rows,
      currentLayout.rows,
    );
    const colStablePrefix = getStablePrefixLength(
      previousLayout.cols,
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

    const sessionRows = sessionExpansionState?.rows ?? [];
    const sessionCols = sessionExpansionState?.cols ?? [];
    const sessionCollapsedRows = sessionExpansionState?.collapsedRows ?? [];
    const sessionCollapsedCols = sessionExpansionState?.collapsedCols ?? [];

    const prevAutoExpandRows = prevAutoExpandRowsRef.current;
    const prevAutoExpandCols = prevAutoExpandColsRef.current;

    const shouldClearRowCache =
      resolvedExpandRowsLevel > 0 &&
      (prevAutoExpandRows === null || prevAutoExpandRows === 0) &&
      sessionRows.length + sessionCollapsedRows.length > 0;
    const shouldClearColCache =
      resolvedExpandColumnsLevel > 0 &&
      (prevAutoExpandCols === null || prevAutoExpandCols === 0) &&
      sessionCols.length + sessionCollapsedCols.length > 0;

    const manualRows = shouldClearRowCache ? [] : sessionRows;
    const manualCols = shouldClearColCache ? [] : sessionCols;
    const manualCollapsedRows = shouldClearRowCache ? [] : sessionCollapsedRows;
    const manualCollapsedCols = shouldClearColCache ? [] : sessionCollapsedCols;

    const normalizedRowCache =
      resolvedExpandRowsLevel === 0 &&
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
      resolvedExpandColumnsLevel === 0 &&
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
      setDataMask({
        ownState: {
          ...mergeOwnStateSafe({
            expansionState: {
              rows: shouldClearRowCache ? [] : sessionRows,
              cols: shouldClearColCache ? [] : sessionCols,
              collapsedRows: shouldClearRowCache ? [] : sessionCollapsedRows,
              collapsedCols: shouldClearColCache ? [] : sessionCollapsedCols,
            },
          }),
        },
      });
    }

    explicitExpandedRowsRef.current = new Set(
      normalizedRowCache.keys.filter(key => key !== rootKey),
    );
    explicitExpandedColsRef.current = new Set(
      normalizedColCache.keys.filter(key => key !== rootKey),
    );
    explicitCollapsedRowsRef.current = new Set(
      normalizedRowCache.collapsedKeys.filter(key => key !== rootKey),
    );
    explicitCollapsedColsRef.current = new Set(
      normalizedColCache.collapsedKeys.filter(key => key !== rootKey),
    );

    const seededRows = seedExpandedByLevel(
      data.rows,
      resolvedExpandRowsLevel,
      metricLabelSetForDepth,
      { includeMetricDepthZero: shouldExpandMetricRows },
    );
    const seededCols = seedExpandedByLevel(
      data.cols,
      resolvedExpandColumnsLevel,
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

    prevAutoExpandRowsRef.current = resolvedExpandRowsLevel;
    prevAutoExpandColsRef.current = resolvedExpandColumnsLevel;

    const hasPersistedExpansion =
      explicitExpandedRowsRef.current.size +
        explicitExpandedColsRef.current.size >
      0;
    if (!hasPersistedExpansion) {
      setIsHydrating(false);
      return;
    }
    const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
      resolvedRows,
      resolvedCols,
      data,
    );
    const rowPlan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: resolvedRows,
      nodes: data.rows,
      requiredDepth: visibleColDepth,
      fetchedDepthByKey: fetchedRowKeysRef.current,
      hasLoadedChildren: (axis, node) =>
        hasLoadedChildren(axis, node, visibleRowDepth, visibleColDepth),
    });
    const colPlan = planExpansionForAxis({
      axis: 'col',
      expandedKeys: resolvedCols,
      nodes: data.cols,
      requiredDepth: visibleRowDepth,
      fetchedDepthByKey: fetchedColKeysRef.current,
      hasLoadedChildren: (axis, node) =>
        hasLoadedChildren(axis, node, visibleRowDepth, visibleColDepth),
    });
    if (rowPlan.pendingKeys.size + colPlan.pendingKeys.size > 0) {
      hydrateAtomic('prefetch').catch(error => {
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
    groupbyColumnKeys,
    groupbyRowKeys,
    hasLoadedChildren,
    mergeOwnStateSafe,
    metricLabelSet,
    ownState,
    resolvedExpandColumnsLevel,
    resolvedExpandRowsLevel,
    setDataMask,
    shouldExpandMetricCols,
    shouldExpandMetricRows,
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
