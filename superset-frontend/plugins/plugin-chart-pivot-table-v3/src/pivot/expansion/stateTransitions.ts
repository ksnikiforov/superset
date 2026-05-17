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
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { mergeTrees } from '../core/tree';
import { parsePath, serializePath } from '../core/path';
import {
  buildGroupedFetchTargets,
  type ExpansionFetchTarget,
  planExpansionForAxis,
  type PivotExpansionNodeFetchPredicate,
  type PivotExpansionPlan,
} from './planner';
import {
  buildDesiredExpandedKeys,
  collectVisibleExpansionKeys,
  coerceExpansionState,
  pruneExpandedToStablePrefix,
  stripAutoSeededExpansions,
  type PivotExpansionStateKeys,
} from './stateModel';
import {
  buildRenderModel,
  type RenderModelConfig,
} from '../render/renderModel';
import { rootKey } from '../viewModel';
import { type PivotExpansionCoverageDiff } from '../runtime/coverage';
import {
  getValuesLevelIndex,
  shouldAutoExpandValuesLevel,
} from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';

export type ExpansionVisibilityConfig = {
  metricLabelSet: Set<string>;
  isMetricTokenValue: (value: unknown) => boolean;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  shouldFetchChildren: PivotExpansionNodeFetchPredicate;
  buildRenderModelConfig: (params: {
    tree: PivotTreeData;
    expandedRows: Set<string>;
    expandedCols: Set<string>;
  }) => RenderModelConfig;
};

const createEmptyExpansionPlan = (): PivotExpansionPlan => ({
  fetchRequests: [],
  pendingKeys: new Set<string>(),
  hasMissingNodes: false,
});

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

export const getStablePrefixLength = (prev: string[], next: string[]) => {
  const max = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < max && prev[prefix] === next[prefix]) {
    prefix += 1;
  }
  return prefix;
};

export const isSameLayout = (left?: string[], right?: string[]) => {
  if (!left || !right) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, idx) => value === right[idx]);
};

export type PivotLayoutKeyState = {
  rows: string[];
  cols: string[];
};

type ResolveLayoutTransitionInput = {
  data: PivotTreeData;
  currentTree: PivotTreeData;
  previousLayout: PivotLayoutKeyState;
  currentLayout: PivotLayoutKeyState;
  sessionLayout?: Partial<PivotLayoutKeyState>;
  hasNewData: boolean;
  effectiveExpandRowsLevel: number;
  effectiveExpandColsLevel: number;
};

export const isPrefix = (prefix: string[], target: string[]) =>
  prefix.length <= target.length &&
  prefix.every((value, idx) => value === target[idx]);

export const resolveLayoutTransition = ({
  data,
  currentTree,
  previousLayout,
  currentLayout,
  sessionLayout,
  hasNewData,
  effectiveExpandRowsLevel,
  effectiveExpandColsLevel,
}: ResolveLayoutTransitionInput) => {
  const rowsChanged = !isSameLayout(previousLayout.rows, currentLayout.rows);
  const colsChanged = !isSameLayout(previousLayout.cols, currentLayout.cols);
  const shouldExpandRows =
    currentLayout.rows.length > previousLayout.rows.length &&
    isPrefix(previousLayout.rows, currentLayout.rows);
  const shouldExpandCols =
    currentLayout.cols.length > previousLayout.cols.length &&
    isPrefix(previousLayout.cols, currentLayout.cols);
  const layoutChanged = rowsChanged || colsChanged;
  const sourceTree = hasNewData || !layoutChanged ? data : currentTree;
  const layoutChangedWithoutNewData = layoutChanged && !hasNewData;
  const layoutRowsForPrune = rowsChanged
    ? previousLayout.rows
    : (sessionLayout?.rows ?? previousLayout.rows);
  const layoutColsForPrune = colsChanged
    ? previousLayout.cols
    : (sessionLayout?.cols ?? previousLayout.cols);
  const rowStablePrefix = getStablePrefixLength(
    layoutRowsForPrune,
    currentLayout.rows,
  );
  const colStablePrefix = getStablePrefixLength(
    layoutColsForPrune,
    currentLayout.cols,
  );
  const autoExpandRowsLevelForDesired =
    layoutChangedWithoutNewData && rowsChanged && rowStablePrefix > 0
      ? Math.min(effectiveExpandRowsLevel, Math.max(rowStablePrefix - 1, 0))
      : effectiveExpandRowsLevel;
  const autoExpandColsLevelForDesired =
    layoutChangedWithoutNewData && colsChanged && colStablePrefix > 0
      ? Math.min(effectiveExpandColsLevel, Math.max(colStablePrefix - 1, 0))
      : effectiveExpandColsLevel;
  return {
    rowsChanged,
    colsChanged,
    shouldExpandRows,
    shouldExpandCols,
    layoutChanged,
    normalizedTree: sourceTree,
    rowStablePrefix,
    colStablePrefix,
    autoExpandRowsLevelForDesired,
    autoExpandColsLevelForDesired,
  };
};

export const addAncestors = (
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

export const dropDescendants = (
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

export const resolveExpansionToggleDecision = ({
  axis,
  node,
  expanded,
  pending,
  otherPending,
  otherInFlight,
  visibleRowDepth,
  visibleColDepth,
  manualExpanded,
  manualCollapsed,
}: {
  axis: PivotAxis;
  node: PivotTreeNode;
  expanded: Set<string>;
  pending: Set<string>;
  otherPending: Set<string>;
  otherInFlight: boolean;
  visibleRowDepth: number;
  visibleColDepth: number;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
}) => {
  const isOpen = expanded.has(node.key) || pending.has(node.key);
  if (isOpen) {
    return { kind: 'collapse' };
  }

  const oppositeVisibleDepth =
    axis === 'row' ? visibleColDepth : visibleRowDepth;
  const isAtomic =
    oppositeVisibleDepth > 0 && (otherPending.size > 0 || otherInFlight);
  if (!isAtomic) {
    return { kind: 'same-axis' };
  }

  const nextPending = new Set(pending);
  addAncestors(node.path, nextPending, expanded);
  const nextManualExpanded = new Set(manualExpanded);
  addAncestors(node.path, nextManualExpanded, expanded);
  const nextManualCollapsed = new Set(manualCollapsed);
  nextManualCollapsed.delete(node.key);
  return {
    kind: 'cross-axis-hydration',
    nextPending,
    nextManualExpanded,
    nextManualCollapsed,
  };
};

export const resolveCollapsedExpansionState = ({
  node,
  expanded,
  pending,
  manualExpanded,
  manualCollapsed,
  nodes,
}: {
  node: PivotTreeNode;
  expanded: Set<string>;
  pending: Set<string>;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
  nodes: Record<string, PivotTreeNode>;
}) => {
  const nextManualExpanded = dropDescendants(node.path, manualExpanded, nodes);
  const nextManualCollapsed = dropDescendants(
    node.path,
    manualCollapsed,
    nodes,
  );
  nextManualCollapsed.add(node.key);

  const nextExpanded = dropDescendants(node.path, expanded, nodes);
  nextExpanded.delete(node.key);

  const nextPending = dropDescendants(node.path, pending, nodes);
  nextPending.delete(node.key);

  return {
    nextExpanded,
    nextPending,
    nextManualExpanded,
    nextManualCollapsed,
  };
};

export const pruneTreeByPrefixes = (
  tree: PivotTreeData,
  axis: PivotAxis,
  prefixes: PivotTreeNode['path'][],
  options?: {
    preserveMetricChildren?: boolean;
    isMetricTokenValue?: (val: unknown) => boolean;
  },
) => {
  if (prefixes.length === 0) {
    return tree;
  }
  const { preserveMetricChildren, isMetricTokenValue } = options || {};
  const isUnderPrefix = (path: PivotTreeNode['path']) =>
    prefixes.some(prefix => prefix.every((val, idx) => val === path[idx]));
  const shouldPreserveMetricChild = (path: PivotTreeNode['path']) => {
    if (!preserveMetricChildren || !isMetricTokenValue) {
      return false;
    }
    return prefixes.some(prefix => {
      if (!prefix.every((val, idx) => val === path[idx])) {
        return false;
      }
      if (path.length !== prefix.length + 1) {
        return false;
      }
      return isMetricTokenValue(path[prefix.length]);
    });
  };
  const removedRowKeys = new Set<string>();
  const removedColKeys = new Set<string>();
  if (axis === 'row') {
    Object.values(tree.rows).forEach(node => {
      if (isUnderPrefix(node.path) && !shouldPreserveMetricChild(node.path)) {
        removedRowKeys.add(node.key);
      }
    });
  } else {
    Object.values(tree.cols).forEach(node => {
      if (isUnderPrefix(node.path) && !shouldPreserveMetricChild(node.path)) {
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

export type PruneMergedTree = ({
  axis,
  tree,
  parent,
  branch,
}: {
  axis: PivotAxis;
  tree: PivotTreeData;
  parent?: PivotTreeNode;
  branch: PivotTreeData;
}) => PivotTreeData;

export const applyExpansionFetchDelta = ({
  tree,
  axis,
  keys,
  branch,
  pruneMergedTree,
}: {
  tree: PivotTreeData;
  axis: PivotAxis;
  keys: string[];
  branch?: PivotTreeData;
  pruneMergedTree: PruneMergedTree;
}) => {
  if (!branch) {
    return tree;
  }
  let nextTree = mergeTrees(tree, branch);
  keys.forEach(key => {
    const parent = axis === 'row' ? nextTree.rows[key] : nextTree.cols[key];
    nextTree = pruneMergedTree({
      axis,
      tree: nextTree,
      parent,
      branch,
    });
  });
  return nextTree;
};

export const mergeSameAxisExpansionTree = ({
  currentTree,
  previousTree,
  axis,
  touchedKeys,
  preserveMetricChildren,
  isMetricTokenValue,
}: {
  currentTree: PivotTreeData;
  previousTree: PivotTreeData;
  axis: PivotAxis;
  touchedKeys: string[];
  preserveMetricChildren?: boolean;
  isMetricTokenValue: (value: unknown) => boolean;
}) => {
  const touchedPrefixes = touchedKeys.map(key => parsePath(key));
  const preservedTree =
    touchedPrefixes.length > 0
      ? pruneTreeByPrefixes(previousTree, axis, touchedPrefixes, {
          preserveMetricChildren,
          isMetricTokenValue,
        })
      : previousTree;
  return mergeTrees(currentTree, preservedTree);
};

export type HydrationDeltaTarget = {
  axis: PivotAxis;
  pathKey: string;
};

export type HydrationDeltaEntry = HydrationDeltaTarget & {
  tree: PivotTreeData;
};

export type HydrationDeltaMap = Map<string, HydrationDeltaEntry>;

const getHydrationDeltaKey = ({ axis, pathKey }: HydrationDeltaTarget) =>
  JSON.stringify([axis, pathKey]);

const getOrderedHydrationDeltas = (deltas: HydrationDeltaMap) =>
  Array.from(deltas.entries())
    .sort(([, left], [, right]) => {
      const axisCompare = left.axis.localeCompare(right.axis);
      if (axisCompare !== 0) {
        return axisCompare;
      }
      const depthCompare =
        parsePath(left.pathKey).length - parsePath(right.pathKey).length;
      if (depthCompare !== 0) {
        return depthCompare;
      }
      return left.pathKey.localeCompare(right.pathKey);
    })
    .map(([, entry]) => entry);

export const stageHydrationFetchDeltas = ({
  deltas,
  results,
}: {
  deltas: HydrationDeltaMap;
  results: Array<{
    targets: HydrationDeltaTarget[];
    data: PivotTreeData;
  }>;
}) => {
  results.forEach(({ targets, data }) => {
    targets.forEach(target => {
      deltas.set(getHydrationDeltaKey(target), {
        ...target,
        tree: data,
      });
    });
  });
};

export const buildHydrationStagedTree = ({
  baseTree,
  deltas,
}: {
  baseTree: PivotTreeData;
  deltas: HydrationDeltaMap;
}) =>
  getOrderedHydrationDeltas(deltas).reduce(
    (merged, delta) => mergeTrees(merged, delta.tree),
    baseTree,
  );

export const finalizeHydrationTree = ({
  baseTree,
  deltas,
  pruneMergedTree,
}: {
  baseTree: PivotTreeData;
  deltas: HydrationDeltaMap;
  pruneMergedTree: PruneMergedTree;
}) => {
  let mergedTree = buildHydrationStagedTree({ baseTree, deltas });
  getOrderedHydrationDeltas(deltas).forEach(delta => {
    const parent =
      delta.axis === 'row'
        ? mergedTree.rows[delta.pathKey]
        : mergedTree.cols[delta.pathKey];
    mergedTree = pruneMergedTree({
      axis: delta.axis,
      tree: mergedTree,
      parent,
      branch: delta.tree,
    });
  });
  return mergedTree;
};

export const resolveExpansionReinitializationDecision = ({
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
}: {
  previousSignature: string | null;
  expandedStateSignature: string;
  previousSharedSignature: string | null;
  expandedStateSharedSignature: string;
  prevExpandRowsLevelRaw?: number;
  prevExpandColsLevelRaw?: number;
  expandRowsLevelRaw?: number;
  expandColumnsLevelRaw?: number;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  hasNewData: boolean;
}) => {
  const shouldResetExpandedState = previousSignature !== expandedStateSignature;
  const isInitialMount = previousSignature === null;
  const sharedSignatureChanged =
    previousSharedSignature !== expandedStateSharedSignature;
  const expandRowsLevelChanged = prevExpandRowsLevelRaw !== expandRowsLevelRaw;
  const expandColsLevelChanged =
    prevExpandColsLevelRaw !== expandColumnsLevelRaw;
  const isRowsLevelCleared =
    expandRowsLevelRaw === undefined && prevExpandRowsLevelRaw !== undefined;
  const isColsLevelCleared =
    expandColumnsLevelRaw === undefined && prevExpandColsLevelRaw !== undefined;
  return {
    shouldResetExpandedState,
    isInitialMount,
    sharedSignatureChanged,
    expandRowsLevelChanged,
    expandColsLevelChanged,
    effectiveExpandRowsLevel: isRowsLevelCleared ? 0 : resolvedExpandRowsLevel,
    effectiveExpandColsLevel: isColsLevelCleared
      ? 0
      : resolvedExpandColumnsLevel,
    shouldReinitialize:
      isInitialMount ||
      shouldResetExpandedState ||
      sharedSignatureChanged ||
      hasNewData ||
      expandRowsLevelChanged ||
      expandColsLevelChanged,
  };
};

export const hasNestedPendingKeys = (keys: Set<string>) => {
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

export const computeVisibleDepths = ({
  tree,
  expandedRows,
  expandedCols,
  config,
}: {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  config: ExpansionVisibilityConfig;
}): { visibleRowDepth: number; visibleColDepth: number } => {
  const renderModel = buildRenderModel({
    tree,
    expandedRows,
    expandedCols,
    config: config.buildRenderModelConfig({ tree, expandedRows, expandedCols }),
  });
  return {
    visibleRowDepth: Math.max(
      0,
      ...renderModel.visibleRows.map(row => config.countDimDepth(row.path)),
    ),
    visibleColDepth: Math.max(
      0,
      ...renderModel.visibleCols.map(col => config.countDimDepth(col.path)),
    ),
  };
};

export const resolveExpandedForMetrics = ({
  axis,
  expanded,
  tree,
  collapsed,
  program,
  isMetricTokenValue,
}: {
  axis: PivotAxis;
  expanded: Set<string>;
  tree: PivotTreeData;
  collapsed: Set<string>;
  program: PivotProgram;
  isMetricTokenValue: (value: unknown) => boolean;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const metricIndex = getValuesLevelIndex(program, axis);
  const resolved = expandMetricPatternExpansions({
    expanded,
    nodes,
    metricIndex,
    isMetricTokenValue,
  });
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
};

type ExpansionReinitAxis = {
  axis: PivotAxis;
  level: number;
  desiredLevel: number;
  prevLevel: number | null;
  keys: string[];
  collapsed: string[];
  nodes: Record<string, PivotTreeNode>;
  stablePrefix: number;
  expandMetric: boolean;
  reset: boolean;
  changed: boolean;
  includeMetricDepth: boolean;
  tree: PivotTreeData;
  metricLabelSet: Set<string>;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
  hasNewData: boolean;
};

const resolveExpansionCacheAxis = (config: ExpansionReinitAxis) => {
  const shouldClearCache =
    config.level > 0 &&
    (config.prevLevel === null || config.prevLevel === 0) &&
    config.keys.length + config.collapsed.length > 0;
  const manualKeys = shouldClearCache ? [] : config.keys;
  const collapsedKeys =
    shouldClearCache || config.level <= 0 ? [] : config.collapsed;
  const normalized =
    config.level === 0 && !shouldClearCache && (config.prevLevel ?? 0) > 0
      ? stripAutoSeededExpansions({
          keys: manualKeys,
          collapsedKeys,
          nodes: config.nodes,
          metricLabelSet: config.metricLabelSet,
          includeMetricDepthZero: config.expandMetric,
        })
      : { keys: manualKeys, collapsedKeys };
  const shouldPrune = config.reset || config.changed;
  const pruneExpanded = (expanded: Set<string>) =>
    pruneExpandedToStablePrefix({
      expanded,
      nodes: config.nodes,
      stablePrefix: config.stablePrefix,
      metricLabelSet: config.metricLabelSet,
      includeMetricDepth: config.includeMetricDepth,
    });
  const prunedManualKeys = shouldPrune
    ? Array.from(
        pruneExpanded(new Set<string>([rootKey, ...normalized.keys])),
      ).filter(key => key !== rootKey)
    : normalized.keys.filter(key => key !== rootKey);
  const prunedCollapsedKeys = normalized.collapsedKeys.filter(key => {
    if (key === rootKey) {
      return false;
    }
    if (!shouldPrune) {
      return true;
    }
    const path = config.nodes[key]?.path ?? parsePath(key);
    const depth =
      config.countDimDepth(path) +
      (config.includeMetricDepth && path.some(config.isMetricTokenValue)
        ? 1
        : 0);
    return depth <= config.stablePrefix;
  });
  const desiredExpanded = buildDesiredExpandedKeys({
    axis: config.axis,
    tree: config.tree,
    autoExpandLevel: config.desiredLevel,
    metricLabelSet: config.metricLabelSet,
    includeMetricDepthZero: config.expandMetric,
    manualExpanded: new Set(prunedManualKeys),
    manualCollapsed: new Set(prunedCollapsedKeys),
    pendingKeys: new Set(),
    inFlightKeys: new Set(),
  });
  const expandedKeys =
    config.reset || (config.changed && !config.hasNewData)
      ? pruneExpanded(desiredExpanded)
      : desiredExpanded;
  return {
    shouldClearCache,
    prunedManualKeys,
    prunedCollapsedKeys,
    expandedKeys,
  };
};

export const resolveReinitializedExpansionState = (params: {
  tree: PivotTreeData;
  currentLayout: { rows: string[]; cols: string[] };
  sessionState: PivotExpansionStateKeys;
  persistedExpansionState: unknown;
  shouldPersistExpansionState: boolean;
  effectiveExpandRowsLevel: number;
  effectiveExpandColsLevel: number;
  autoExpandRowsLevelForDesired: number;
  autoExpandColsLevelForDesired: number;
  prevAutoExpandRows: number | null;
  prevAutoExpandCols: number | null;
  rowStablePrefix: number;
  colStablePrefix: number;
  shouldResetExpandedRows: boolean;
  shouldResetExpandedCols: boolean;
  rowsChanged: boolean;
  colsChanged: boolean;
  hasNewData: boolean;
  program: PivotProgram;
  metricLabelSet: Set<string>;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
}) => {
  const { tree, currentLayout, sessionState } = params;
  const metricIndexForRows = getValuesLevelIndex(params.program, 'row');
  const metricIndexForCols = getValuesLevelIndex(params.program, 'col');
  const includeMetricRowDepth =
    metricIndexForRows !== undefined &&
    metricIndexForRows < params.program.rowDimensions.length;
  const includeMetricColDepth =
    metricIndexForCols !== undefined &&
    metricIndexForCols < params.program.columnDimensions.length;
  const common = {
    tree,
    metricLabelSet: new Set(params.metricLabelSet),
    countDimDepth: params.countDimDepth,
    isMetricTokenValue: params.isMetricTokenValue,
    hasNewData: params.hasNewData,
  };
  const rowKeys = sessionState.rows ?? [];
  const colKeys = sessionState.cols ?? [];
  const collapsedRowKeys = sessionState.collapsedRows ?? [];
  const collapsedColKeys = sessionState.collapsedCols ?? [];
  const rowState = resolveExpansionCacheAxis({
    ...common,
    axis: 'row',
    level: params.effectiveExpandRowsLevel,
    desiredLevel: params.autoExpandRowsLevelForDesired,
    prevLevel: params.prevAutoExpandRows,
    keys: rowKeys,
    collapsed: collapsedRowKeys,
    nodes: tree.rows,
    stablePrefix: params.rowStablePrefix,
    expandMetric: shouldAutoExpandValuesLevel(
      params.program,
      'row',
      params.effectiveExpandRowsLevel,
    ),
    reset: params.shouldResetExpandedRows,
    changed: params.rowsChanged,
    includeMetricDepth: includeMetricRowDepth,
  });
  const colState = resolveExpansionCacheAxis({
    ...common,
    axis: 'col',
    level: params.effectiveExpandColsLevel,
    desiredLevel: params.autoExpandColsLevelForDesired,
    prevLevel: params.prevAutoExpandCols,
    keys: colKeys,
    collapsed: collapsedColKeys,
    nodes: tree.cols,
    stablePrefix: params.colStablePrefix,
    expandMetric: shouldAutoExpandValuesLevel(
      params.program,
      'col',
      params.effectiveExpandColsLevel,
    ),
    reset: params.shouldResetExpandedCols,
    changed: params.colsChanged,
    includeMetricDepth: includeMetricColDepth,
  });
  const persistedSeed = coerceExpansionState(params.persistedExpansionState);
  const shouldResetPersistedLayout =
    params.shouldPersistExpansionState &&
    params.persistedExpansionState !== undefined &&
    params.persistedExpansionState !== null &&
    (!persistedSeed ||
      !isSameLayout(persistedSeed.rowKeys, currentLayout.rows) ||
      !isSameLayout(persistedSeed.colKeys, currentLayout.cols));
  const clearedState =
    rowState.shouldClearCache || colState.shouldClearCache
      ? {
          rowKeys: currentLayout.rows,
          colKeys: currentLayout.cols,
          rows: rowState.shouldClearCache ? [] : rowKeys,
          cols: colState.shouldClearCache ? [] : colKeys,
          collapsedRows: rowState.shouldClearCache ? [] : collapsedRowKeys,
          collapsedCols: colState.shouldClearCache ? [] : collapsedColKeys,
        }
      : undefined;
  return {
    clearedState,
    shouldResetPersistedLayout,
    persistedState: {
      rowKeys: currentLayout.rows,
      colKeys: currentLayout.cols,
      rows: rowState.prunedManualKeys,
      cols: colState.prunedManualKeys,
      collapsedRows: rowState.prunedCollapsedKeys,
      collapsedCols: colState.prunedCollapsedKeys,
    },
    expandedRows: rowState.expandedKeys,
    expandedCols: colState.expandedKeys,
  };
};

export const buildCrossAxisIntersectionTargets = ({
  rowPlan,
  colPlan,
  visibleRowDepth,
  visibleColDepth,
  getMissingExpansionCoverage,
}: {
  rowPlan: PivotExpansionPlan;
  colPlan: PivotExpansionPlan;
  visibleRowDepth: number;
  visibleColDepth: number;
  getMissingExpansionCoverage: PivotExpansionCoverageDiff;
}): ExpansionFetchTarget[] => {
  const hasCrossAxisFetch =
    rowPlan.fetchRequests.length > 0 && colPlan.fetchRequests.length > 0;
  const rowPathKeys = rowPlan.fetchRequests
    .map(request => request.pathKey)
    .filter(key => key !== rootKey);
  const columnPathKeys = colPlan.fetchRequests
    .map(request => request.pathKey)
    .filter(key => key !== rootKey);
  if (
    !hasCrossAxisFetch ||
    visibleRowDepth === 0 ||
    visibleColDepth === 0 ||
    rowPathKeys.length === 0 ||
    columnPathKeys.length === 0
  ) {
    return [];
  }
  const intersectionRequest = {
    axis: 'row' as const,
    pathKey: rootKey,
    rowDepth: visibleRowDepth,
    columnDepth: visibleColDepth,
    rowPathKeys,
    columnPathKeys,
  };
  return getMissingExpansionCoverage([intersectionRequest]).length > 0
    ? [{ kind: 'intersection', rowPathKeys, columnPathKeys }]
    : [];
};

export const planHydrationIteration = ({
  tree,
  desiredRows,
  desiredCols,
  getMissingExpansionCoverage,
  config,
  getCoverageKey,
  activeAxis,
  pendingRows,
  pendingCols,
  planRows = true,
  planCols = true,
}: {
  tree: PivotTreeData;
  desiredRows: Set<string>;
  desiredCols: Set<string>;
  getMissingExpansionCoverage: PivotExpansionCoverageDiff;
  config: ExpansionVisibilityConfig;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
  activeAxis?: PivotAxis;
  pendingRows: Set<string>;
  pendingCols: Set<string>;
  planRows?: boolean;
  planCols?: boolean;
}) => {
  const { visibleRowDepth, visibleColDepth } = computeVisibleDepths({
    tree,
    expandedRows: desiredRows,
    expandedCols: desiredCols,
    config,
  });
  const rowPlan = planRows
    ? planExpansionForAxis({
        axis: 'row',
        expandedKeys: desiredRows,
        nodes: tree.rows,
        coverage: { rowDepth: visibleRowDepth, columnDepth: visibleColDepth },
        getMissingExpansionCoverage,
        getCoverageKey,
        shouldFetchChildren: config.shouldFetchChildren,
      })
    : createEmptyExpansionPlan();
  const colPlan = planCols
    ? planExpansionForAxis({
        axis: 'col',
        expandedKeys: desiredCols,
        nodes: tree.cols,
        coverage: { rowDepth: visibleRowDepth, columnDepth: visibleColDepth },
        getMissingExpansionCoverage,
        getCoverageKey,
        shouldFetchChildren: config.shouldFetchChildren,
      })
    : createEmptyExpansionPlan();

  let effectiveRowPlan: PivotExpansionPlan = rowPlan;
  let effectiveColPlan: PivotExpansionPlan = colPlan;

  if (
    activeAxis === 'col' &&
    colPlan.fetchRequests.length > 0 &&
    !rowPlan.hasMissingNodes &&
    pendingRows.size === 0
  ) {
    effectiveRowPlan = createEmptyExpansionPlan();
  }
  if (
    activeAxis === 'row' &&
    rowPlan.fetchRequests.length > 0 &&
    !colPlan.hasMissingNodes &&
    pendingCols.size === 0
  ) {
    effectiveColPlan = createEmptyExpansionPlan();
  }

  const intersectionTargets = buildCrossAxisIntersectionTargets({
    rowPlan: effectiveRowPlan,
    colPlan: effectiveColPlan,
    visibleRowDepth,
    visibleColDepth,
    getMissingExpansionCoverage,
  });

  if (
    effectiveRowPlan.pendingKeys.size === 0 &&
    effectiveColPlan.pendingKeys.size === 0 &&
    intersectionTargets.length === 0
  ) {
    return {
      kind: 'complete',
      desiredRows,
      desiredCols,
      visibleRowDepth,
      visibleColDepth,
      rowPlan: effectiveRowPlan,
      colPlan: effectiveColPlan,
    };
  }

  const rowGroups = buildGroupedFetchTargets({
    axis: 'row',
    requests: effectiveRowPlan.fetchRequests,
    nodes: tree.rows,
    getCoverageKey,
  });
  const colGroups = buildGroupedFetchTargets({
    axis: 'col',
    requests: effectiveColPlan.fetchRequests,
    nodes: tree.cols,
    getCoverageKey,
  });
  return {
    kind: 'fetch',
    desiredRows,
    desiredCols,
    visibleRowDepth,
    visibleColDepth,
    rowPlan: effectiveRowPlan,
    colPlan: effectiveColPlan,
    targets: [...rowGroups, ...colGroups, ...intersectionTargets],
  };
};

export const runHydrationLoop = async ({
  baseTree,
  maxIterations,
  isCurrent,
  buildDesiredExpanded,
  getMissingExpansionCoverage,
  config,
  getCoverageKey,
  activeAxis,
  pendingRows,
  pendingCols,
  planRows = true,
  planCols = true,
  pruneMergedTree,
  fetchDeltas,
}: {
  baseTree: PivotTreeData;
  maxIterations: number;
  isCurrent: () => boolean;
  buildDesiredExpanded: (axis: PivotAxis, tree: PivotTreeData) => Set<string>;
  getMissingExpansionCoverage: () => PivotExpansionCoverageDiff;
  config: ExpansionVisibilityConfig;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
  activeAxis?: PivotAxis;
  pendingRows: Set<string>;
  pendingCols: Set<string>;
  planRows?: boolean;
  planCols?: boolean;
  pruneMergedTree: PruneMergedTree;
  fetchDeltas: ({
    targets,
    context,
  }: {
    targets: ExpansionFetchTarget[];
    context: {
      visibleRowDepth: number;
      visibleColDepth: number;
    };
  }) => Promise<
    Array<{ targets: HydrationDeltaTarget[]; data: PivotTreeData }>
  >;
}) => {
  const deltas: HydrationDeltaMap = new Map();
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (!isCurrent()) {
      return { status: 'stale' };
    }
    const stagedTree = buildHydrationStagedTree({
      baseTree,
      deltas,
    });
    const desiredRows = buildDesiredExpanded('row', stagedTree);
    const desiredCols = buildDesiredExpanded('col', stagedTree);
    const hydrationPlan = planHydrationIteration({
      tree: stagedTree,
      desiredRows,
      desiredCols,
      getMissingExpansionCoverage: getMissingExpansionCoverage(),
      config,
      getCoverageKey,
      activeAxis,
      pendingRows,
      pendingCols,
      planRows,
      planCols,
    });
    const { visibleRowDepth, visibleColDepth } = hydrationPlan;

    if (hydrationPlan.kind === 'complete') {
      return {
        status: 'complete',
        tree: finalizeHydrationTree({
          baseTree,
          deltas,
          pruneMergedTree,
        }),
        desiredRows,
        desiredCols,
      };
    }

    // eslint-disable-next-line no-await-in-loop
    const results = await fetchDeltas({
      targets: hydrationPlan.targets,
      context: { visibleRowDepth, visibleColDepth },
    });
    if (!isCurrent()) {
      return { status: 'stale' };
    }
    stageHydrationFetchDeltas({
      deltas,
      results,
    });
  }
  return { status: 'exhausted' };
};

export type HydrationPrefetchAction =
  | {
      kind: 'idle';
    }
  | {
      kind: 'hydrate';
      showLoader: boolean;
    };

export const buildHydrationPrefetchAction = ({
  resolvedRows,
  resolvedCols,
  persistedState,
  autoExpandRowsLevelForDesired,
  autoExpandColsLevelForDesired,
  tree,
  rowPlan,
  colPlan,
}: {
  resolvedRows: Set<string>;
  resolvedCols: Set<string>;
  persistedState: PivotExpansionStateKeys;
  autoExpandRowsLevelForDesired: number;
  autoExpandColsLevelForDesired: number;
  tree: PivotTreeData;
  rowPlan: PivotExpansionPlan;
  colPlan: PivotExpansionPlan;
}): HydrationPrefetchAction => {
  if (rowPlan.pendingKeys.size + colPlan.pendingKeys.size === 0) {
    return { kind: 'idle' };
  }
  const shouldSkipRootPrefetch =
    resolvedRows.size === 1 &&
    resolvedRows.has(rootKey) &&
    resolvedCols.size === 1 &&
    resolvedCols.has(rootKey) &&
    persistedState.rows.length === 0 &&
    persistedState.cols.length === 0 &&
    persistedState.collapsedRows.length === 0 &&
    persistedState.collapsedCols.length === 0 &&
    autoExpandRowsLevelForDesired <= 0 &&
    autoExpandColsLevelForDesired <= 0 &&
    !Object.keys(tree.rows).some(key => key !== rootKey) &&
    !Object.keys(tree.cols).some(key => key !== rootKey);
  if (shouldSkipRootPrefetch) {
    return { kind: 'idle' };
  }
  return {
    kind: 'hydrate',
    showLoader:
      hasNestedPendingKeys(rowPlan.pendingKeys) ||
      hasNestedPendingKeys(colPlan.pendingKeys),
  };
};

export const planInitialHydrationPrefetch = ({
  tree,
  resolvedRows,
  resolvedCols,
  persistedState,
  effectiveExpandRowsLevel,
  effectiveExpandColsLevel,
  autoExpandRowsLevelForDesired,
  autoExpandColsLevelForDesired,
  getMissingExpansionCoverage,
  config,
  getCoverageKey,
}: {
  tree: PivotTreeData;
  resolvedRows: Set<string>;
  resolvedCols: Set<string>;
  persistedState: PivotExpansionStateKeys;
  effectiveExpandRowsLevel: number;
  effectiveExpandColsLevel: number;
  autoExpandRowsLevelForDesired: number;
  autoExpandColsLevelForDesired: number;
  getMissingExpansionCoverage: PivotExpansionCoverageDiff;
  config: ExpansionVisibilityConfig;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
}) => {
  const shouldPlanRows =
    effectiveExpandRowsLevel > 0 ||
    persistedState.rows.length > 0 ||
    persistedState.collapsedRows.length > 0;
  const shouldPlanCols =
    effectiveExpandColsLevel > 0 ||
    persistedState.cols.length > 0 ||
    persistedState.collapsedCols.length > 0;
  const { rowPlan, colPlan } = planHydrationIteration({
    tree,
    desiredRows: resolvedRows,
    desiredCols: resolvedCols,
    getMissingExpansionCoverage,
    config,
    getCoverageKey,
    pendingRows: new Set(),
    pendingCols: new Set(),
    planRows: shouldPlanRows,
    planCols: shouldPlanCols,
  });
  return {
    shouldPlanRows,
    shouldPlanCols,
    rowPlan,
    colPlan,
    action: buildHydrationPrefetchAction({
      resolvedRows,
      resolvedCols,
      persistedState,
      autoExpandRowsLevelForDesired,
      autoExpandColsLevelForDesired,
      tree,
      rowPlan,
      colPlan,
    }),
  };
};

const filterVisibleExpansionKeys = (keys: Set<string>, visible: Set<string>) =>
  Array.from(keys).filter(key => key !== rootKey && visible.has(key));

export const buildVisiblePersistedExpansionState = ({
  tree,
  expandedRows,
  expandedCols,
  config,
  explicitExpandedRows,
  explicitExpandedCols,
  explicitCollapsedRows,
  explicitCollapsedCols,
  resolvedExpandRowsLevel,
  resolvedExpandColumnsLevel,
  groupbyRowKeys,
  groupbyColumnKeys,
}: {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  config: ExpansionVisibilityConfig;
  explicitExpandedRows: Set<string>;
  explicitExpandedCols: Set<string>;
  explicitCollapsedRows: Set<string>;
  explicitCollapsedCols: Set<string>;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  groupbyRowKeys: string[];
  groupbyColumnKeys: string[];
}): {
  persistedState: PivotExpansionStateKeys;
  visibleExpandedRows: Set<string>;
  visibleExpandedCols: Set<string>;
  visibleCollapsedRows: Set<string>;
  visibleCollapsedCols: Set<string>;
} => {
  const visibleKeys = collectVisibleExpansionKeys(
    buildRenderModel({
      tree,
      expandedRows,
      expandedCols,
      config: config.buildRenderModelConfig({
        tree,
        expandedRows,
        expandedCols,
      }),
    }),
  );
  const visibleRows = filterVisibleExpansionKeys(
    explicitExpandedRows,
    visibleKeys.rows,
  );
  const visibleCols = filterVisibleExpansionKeys(
    explicitExpandedCols,
    visibleKeys.cols,
  );
  const visibleCollapsedRows = filterVisibleExpansionKeys(
    resolvedExpandRowsLevel > 0 ? explicitCollapsedRows : new Set<string>(),
    visibleKeys.rows,
  );
  const visibleCollapsedCols = filterVisibleExpansionKeys(
    resolvedExpandColumnsLevel > 0 ? explicitCollapsedCols : new Set<string>(),
    visibleKeys.cols,
  );
  return {
    visibleExpandedRows: new Set(visibleRows),
    visibleExpandedCols: new Set(visibleCols),
    visibleCollapsedRows: new Set(visibleCollapsedRows),
    visibleCollapsedCols: new Set(visibleCollapsedCols),
    persistedState: {
      rowKeys: groupbyRowKeys,
      colKeys: groupbyColumnKeys,
      rows: visibleRows,
      cols: visibleCols,
      collapsedRows: visibleCollapsedRows,
      collapsedCols: visibleCollapsedCols,
    },
  };
};
