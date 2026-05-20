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
import { parsePath, serializePath } from '../core/path';
import {
  buildIntersectionCoverageTarget,
  type ExpansionFetchTarget,
  planExpansionForAxis,
  type PivotExpansionPlan,
  type PivotExpansionCoverageDiff,
} from './planner';
import {
  buildDesiredExpandedKeys,
  pruneExpandedToStablePrefix,
  type PivotExpansionStateKeys,
} from './stateModel';
import { rootKey } from '../viewModel';
import { type PivotAxisCoverageNeed } from '../runtime/coverage';
import { getValuesLevelIndex } from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';
import { isMetricTokenForKeys, isSubtotalToken } from '../core/tokens';
import { createMetricNodePolicy } from '../metricsTotals';

const PIVOT_AXES: PivotAxis[] = ['row', 'col'];

const createEmptyExpansionPlan = (): PivotExpansionPlan => ({
  targets: [],
  requiresPathDiscovery: false,
});

const createExpansionMetricPolicy = (program: PivotProgram) => {
  const metricNodePolicy = createMetricNodePolicy(program);
  return {
    metricLabelSet: metricNodePolicy.metricLabelSet,
    countDimDepth: (path: PivotTreeNode['path']) =>
      metricNodePolicy.countDimDepth(path.filter(val => !isSubtotalToken(val))),
  };
};

const findMetricIndex = (
  path: PivotTreeNode['path'],
  metricLabelSet: ReadonlySet<string>,
) => path.findIndex(value => isMetricTokenForKeys(value, metricLabelSet));

const expandMetricPatternExpansions = ({
  expanded,
  nodes,
  metricIndex,
  metricLabelSet,
}: {
  expanded: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  metricIndex: number | undefined;
  metricLabelSet: ReadonlySet<string>;
}) => {
  if (metricIndex === undefined || metricIndex < 0) {
    return expanded;
  }
  const resolved = new Set(expanded);
  const candidates = Object.values(nodes);
  expanded.forEach(key => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    const patternMetricIndex = findMetricIndex(path, metricLabelSet);
    if (patternMetricIndex < 0 || patternMetricIndex > metricIndex) {
      return;
    }
    const prefix = path.slice(0, patternMetricIndex);
    const metricToken = path[patternMetricIndex];
    const suffix = path.slice(patternMetricIndex + 1);
    candidates.forEach(candidate => {
      const candidateMetricIndex = findMetricIndex(
        candidate.path,
        metricLabelSet,
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

export const isSameLayout = (left?: string[], right?: string[]) =>
  Boolean(
    left &&
      right &&
      left.length === right.length &&
      left.every((value, idx) => value === right[idx]),
  );

export type PivotLayoutKeyState = {
  rows: string[];
  cols: string[];
};

type ResolveLayoutTransitionInput = {
  data: PivotTreeData;
  currentTree: PivotTreeData;
  previousLayout: PivotLayoutKeyState;
  currentLayout: PivotLayoutKeyState;
  hasNewData: boolean;
  program: PivotProgram;
};

export const isPrefix = (prefix: string[], target: string[]) =>
  prefix.length <= target.length &&
  prefix.every((value, idx) => value === target[idx]);

function pruneTreeToStableLayout({
  tree,
  rowsChanged,
  colsChanged,
  rowStablePrefix,
  colStablePrefix,
  program,
}: {
  tree: PivotTreeData;
  rowsChanged: boolean;
  colsChanged: boolean;
  rowStablePrefix: number;
  colStablePrefix: number;
  program: PivotProgram;
}) {
  const { countDimDepth } = createExpansionMetricPolicy(program);
  const pruneNodes = (
    nodes: Record<string, PivotTreeNode>,
    stablePrefix: number,
  ) =>
    Object.fromEntries(
      Object.entries(nodes).filter(
        ([key, node]) =>
          key === rootKey || countDimDepth(node.path) <= stablePrefix,
      ),
    );
  const rows = rowsChanged ? pruneNodes(tree.rows, rowStablePrefix) : tree.rows;
  const cols = colsChanged ? pruneNodes(tree.cols, colStablePrefix) : tree.cols;
  const cells = Object.fromEntries(
    Object.entries(tree.cells).filter(
      ([, cell]) => rows[cell.rowKey] && cols[cell.colKey],
    ),
  );
  return {
    ...tree,
    rows,
    cols,
    cells,
  };
}

export const resolveLayoutTransition = ({
  data,
  currentTree,
  previousLayout,
  currentLayout,
  hasNewData,
  program,
}: ResolveLayoutTransitionInput) => {
  const rowsChanged = !isSameLayout(previousLayout.rows, currentLayout.rows);
  const colsChanged = !isSameLayout(previousLayout.cols, currentLayout.cols);
  const shouldExpandRows =
    currentLayout.rows.length > previousLayout.rows.length &&
    isPrefix(previousLayout.rows, currentLayout.rows);
  const shouldExpandCols =
    currentLayout.cols.length > previousLayout.cols.length &&
    isPrefix(previousLayout.cols, currentLayout.cols);
  const rowStablePrefix = getStablePrefixLength(
    previousLayout.rows,
    currentLayout.rows,
  );
  const colStablePrefix = getStablePrefixLength(
    previousLayout.cols,
    currentLayout.cols,
  );
  const sourceTree =
    hasNewData || (!rowsChanged && !colsChanged)
      ? data
      : pruneTreeToStableLayout({
          tree: currentTree,
          rowsChanged,
          colsChanged,
          rowStablePrefix,
          colStablePrefix,
          program,
        });
  return {
    rowsChanged,
    colsChanged,
    shouldExpandRows,
    shouldExpandCols,
    normalizedTree: sourceTree,
    rowStablePrefix,
    colStablePrefix,
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
  node,
  expanded,
  manualExpanded,
  manualCollapsed,
}: {
  node: PivotTreeNode;
  expanded: Set<string>;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
}) => {
  const isOpen = expanded.has(node.key) || manualExpanded.has(node.key);
  if (isOpen) {
    return { kind: 'collapse' };
  }

  const nextManualExpanded = new Set(manualExpanded);
  addAncestors(node.path, nextManualExpanded, expanded);
  const nextManualCollapsed = new Set(manualCollapsed);
  nextManualCollapsed.delete(node.key);
  return {
    kind: 'expand',
    nextManualExpanded,
    nextManualCollapsed,
  };
};

export const resolveCollapsedExpansionState = ({
  node,
  expanded,
  manualExpanded,
  manualCollapsed,
  nodes,
}: {
  node: PivotTreeNode;
  expanded: Set<string>;
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

  return {
    nextExpanded,
    nextManualExpanded,
    nextManualCollapsed,
  };
};

const buildChildrenByParent = (nodes: Record<string, PivotTreeNode>) => {
  const childrenByParent = new Map<string, PivotTreeNode[]>();
  Object.values(nodes).forEach(node => {
    if (node.key === rootKey || node.path.length === 0) {
      return;
    }
    const parentKey = serializePath(node.path.slice(0, -1));
    childrenByParent.set(parentKey, [
      ...(childrenByParent.get(parentKey) ?? []),
      node,
    ]);
  });
  return childrenByParent;
};

const collectAxisVisibility = ({
  axis,
  nodes,
  expanded,
  program,
}: {
  axis: PivotAxis;
  nodes: Record<string, PivotTreeNode>;
  expanded: Set<string>;
  program: PivotProgram;
}) => {
  const { countDimDepth } = createExpansionMetricPolicy(program);
  const axisDimensionCount =
    axis === 'row'
      ? program.rowDimensions.length
      : program.columnDimensions.length;
  const visibleKeys = new Set<string>([rootKey]);
  let visibleDepth = 0;
  const root = nodes[rootKey];
  if (!root) {
    return { visibleKeys, visibleDepth };
  }
  const childrenByParent = buildChildrenByParent(nodes);
  const visit = (node: PivotTreeNode) => {
    visibleKeys.add(node.key);
    visibleDepth = Math.max(visibleDepth, countDimDepth(node.path));
    if (node.key !== rootKey && !expanded.has(node.key)) {
      return;
    }
    (childrenByParent.get(node.key) ?? []).forEach(visit);
  };
  visit(root);
  expanded.forEach(key => {
    const path = nodes[key]?.path ?? parsePath(key);
    visibleDepth = Math.max(
      visibleDepth,
      Math.min(axisDimensionCount, countDimDepth(path) + 1),
    );
  });
  return { visibleKeys, visibleDepth };
};

export const resolveExpandedForMetrics = ({
  axis,
  expanded,
  tree,
  collapsed,
  program,
  isLeafTierVisible = false,
}: {
  axis: PivotAxis;
  expanded: Set<string>;
  tree: PivotTreeData;
  collapsed: Set<string>;
  program: PivotProgram;
  isLeafTierVisible?: boolean;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const metricIndex = getValuesLevelIndex(program, axis);
  const { metricLabelSet } = createExpansionMetricPolicy(program);
  const resolved = expandMetricPatternExpansions({
    expanded,
    nodes,
    metricIndex,
    metricLabelSet,
  });
  const next = new Set(resolved);
  collapsed.forEach(key => next.delete(key));
  if (isLeafTierVisible) {
    Object.values(nodes).forEach(node => {
      const metricValue = node.path[node.path.length - 1];
      if (isMetricTokenForKeys(metricValue, metricLabelSet)) {
        next.add(node.key);
      }
    });
  }
  if (metricIndex === undefined) {
    return next;
  }
  next.forEach(key => {
    if (key === rootKey || nodes[key]) {
      return;
    }
    const path = parsePath(key);
    const keyMetricIndex = findMetricIndex(path, metricLabelSet);
    if (keyMetricIndex >= 0 && keyMetricIndex < metricIndex) {
      next.delete(key);
    }
  });
  return next;
};

type ExpansionReinitAxis = {
  axis: PivotAxis;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  keys: string[];
  collapsed: string[];
  nodes: Record<string, PivotTreeNode>;
  stablePrefix: number;
  reset: boolean;
  changed: boolean;
  includeMetricDepth: boolean;
  tree: PivotTreeData;
  program: PivotProgram;
  hasNewData: boolean;
};

const resolveExpansionCacheAxis = (config: ExpansionReinitAxis) => {
  const { metricLabelSet, countDimDepth } = createExpansionMetricPolicy(
    config.program,
  );
  const shouldPrune = config.reset || config.changed;
  const pruneExpanded = (expanded: Set<string>) =>
    pruneExpandedToStablePrefix({
      expanded,
      nodes: config.nodes,
      stablePrefix: config.stablePrefix,
      metricLabelSet,
      includeMetricDepth: config.includeMetricDepth,
    });
  const prunedManualKeys = shouldPrune
    ? Array.from(
        pruneExpanded(new Set<string>([rootKey, ...config.keys])),
      ).filter(key => key !== rootKey)
    : config.keys.filter(key => key !== rootKey);
  const prunedCollapsedKeys = config.collapsed.filter(key => {
    if (key === rootKey) {
      return false;
    }
    if (!shouldPrune) {
      return true;
    }
    const path = config.nodes[key]?.path ?? parsePath(key);
    const depth =
      countDimDepth(path) +
      (config.includeMetricDepth &&
      path.some(value => isMetricTokenForKeys(value, metricLabelSet))
        ? 1
        : 0);
    return depth <= config.stablePrefix;
  });
  const desiredExpanded = buildDesiredExpandedKeys({
    axis: config.axis,
    tree: config.tree,
    axisCoverageNeeds: config.axisCoverageNeeds,
    program: config.program,
    manualExpanded: new Set(prunedManualKeys),
    manualCollapsed: new Set(prunedCollapsedKeys),
  });
  const expandedKeys =
    config.reset || (config.changed && !config.hasNewData)
      ? pruneExpanded(desiredExpanded)
      : desiredExpanded;
  return {
    prunedManualKeys,
    prunedCollapsedKeys,
    expandedKeys,
  };
};

export const resolveReinitializedExpansionState = (params: {
  tree: PivotTreeData;
  sessionState: PivotExpansionStateKeys;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  rowStablePrefix: number;
  colStablePrefix: number;
  shouldResetExpandedRows: boolean;
  shouldResetExpandedCols: boolean;
  rowsChanged: boolean;
  colsChanged: boolean;
  hasNewData: boolean;
  program: PivotProgram;
}) => {
  const { tree, sessionState } = params;
  const includeMetricDepth = (axis: PivotAxis) => {
    const metricIndex = getValuesLevelIndex(params.program, axis);
    const dimensionCount =
      axis === 'row'
        ? params.program.rowDimensions.length
        : params.program.columnDimensions.length;
    return metricIndex !== undefined && metricIndex < dimensionCount;
  };
  const common = {
    tree,
    program: params.program,
    hasNewData: params.hasNewData,
  };
  const axisState = Object.fromEntries(
    PIVOT_AXES.map(axis => [
      axis,
      resolveExpansionCacheAxis({
        ...common,
        axis,
        axisCoverageNeeds: params.axisCoverageNeeds,
        keys:
          axis === 'row'
            ? (sessionState.rows ?? [])
            : (sessionState.cols ?? []),
        collapsed:
          axis === 'row'
            ? (sessionState.collapsedRows ?? [])
            : (sessionState.collapsedCols ?? []),
        nodes: axis === 'row' ? tree.rows : tree.cols,
        stablePrefix:
          axis === 'row' ? params.rowStablePrefix : params.colStablePrefix,
        reset:
          axis === 'row'
            ? params.shouldResetExpandedRows
            : params.shouldResetExpandedCols,
        changed: axis === 'row' ? params.rowsChanged : params.colsChanged,
        includeMetricDepth: includeMetricDepth(axis),
      }),
    ]),
  ) as Record<PivotAxis, ReturnType<typeof resolveExpansionCacheAxis>>;
  return {
    persistedState: {
      rows: axisState.row.prunedManualKeys,
      cols: axisState.col.prunedManualKeys,
      collapsedRows: axisState.row.prunedCollapsedKeys,
      collapsedCols: axisState.col.prunedCollapsedKeys,
    },
    expanded: {
      row: axisState.row.expandedKeys,
      col: axisState.col.expandedKeys,
    },
  };
};

export const planHydrationIteration = ({
  tree,
  desiredRows,
  desiredCols,
  getMissingExpansionCoverage,
  program,
}: {
  tree: PivotTreeData;
  desiredRows: Set<string>;
  desiredCols: Set<string>;
  getMissingExpansionCoverage: PivotExpansionCoverageDiff;
  program: PivotProgram;
}) => {
  const rowVisibility = collectAxisVisibility({
    axis: 'row',
    nodes: tree.rows,
    expanded: desiredRows,
    program,
  });
  const colVisibility = collectAxisVisibility({
    axis: 'col',
    nodes: tree.cols,
    expanded: desiredCols,
    program,
  });
  const visibleRowDepth = rowVisibility.visibleDepth;
  const visibleColDepth = colVisibility.visibleDepth;
  const rowPathKeys = Array.from(desiredRows).filter(
    key => key !== rootKey && tree.rows[key],
  );
  const columnPathKeys = Array.from(desiredCols).filter(
    key => key !== rootKey && tree.cols[key],
  );
  const hasNonRootRows = Array.from(desiredRows).some(key => key !== rootKey);
  const hasNonRootCols = Array.from(desiredCols).some(key => key !== rootKey);
  const rowExpansionKeys =
    hasNonRootCols && !hasNonRootRows ? new Set<string>() : desiredRows;
  const colExpansionKeys =
    hasNonRootRows && !hasNonRootCols ? new Set<string>() : desiredCols;
  const rowPlan = planExpansionForAxis({
    axis: 'row',
    program,
    expandedKeys: rowExpansionKeys,
    nodes: tree.rows,
    coverage: { rowDepth: visibleRowDepth, columnDepth: visibleColDepth },
    getMissingExpansionCoverage,
  });
  const colPlan = planExpansionForAxis({
    axis: 'col',
    program,
    expandedKeys: colExpansionKeys,
    nodes: tree.cols,
    coverage: { rowDepth: visibleRowDepth, columnDepth: visibleColDepth },
    getMissingExpansionCoverage,
  });

  const shouldCheckIntersection =
    visibleRowDepth > 0 &&
    visibleColDepth > 0 &&
    rowPathKeys.length > 0 &&
    columnPathKeys.length > 0 &&
    rowPathKeys.length * columnPathKeys.length > 1;
  const intersectionCoverageTarget = shouldCheckIntersection
    ? buildIntersectionCoverageTarget({
        program,
        rowDepth: visibleRowDepth,
        columnDepth: visibleColDepth,
        rowPathKeys,
        columnPathKeys,
      })
    : undefined;
  const intersectionTargets: ExpansionFetchTarget[] =
    intersectionCoverageTarget &&
    getMissingExpansionCoverage([intersectionCoverageTarget]).length > 0
      ? [
          {
            kind: 'intersection',
            rowPathKeys,
            columnPathKeys,
            coverageTarget: intersectionCoverageTarget,
          },
        ]
      : [];
  const shouldFetchIntersectionOnly =
    intersectionTargets.length > 0 &&
    !rowPlan.requiresPathDiscovery &&
    !colPlan.requiresPathDiscovery;
  const { rowPlan: rowPlanForTransport, colPlan: colPlanForTransport } =
    shouldFetchIntersectionOnly
      ? {
          rowPlan: createEmptyExpansionPlan(),
          colPlan: createEmptyExpansionPlan(),
        }
      : { rowPlan, colPlan };

  if (
    rowPlanForTransport.targets.length === 0 &&
    colPlanForTransport.targets.length === 0 &&
    intersectionTargets.length === 0
  ) {
    return {
      kind: 'complete',
      desiredRows,
      desiredCols,
    };
  }

  return {
    kind: 'fetch',
    desiredRows,
    desiredCols,
    targets: [
      ...rowPlanForTransport.targets,
      ...colPlanForTransport.targets,
      ...intersectionTargets,
    ],
  };
};

const filterVisibleExpansionKeys = (keys: Set<string>, visible: Set<string>) =>
  Array.from(keys).filter(key => key !== rootKey && visible.has(key));

export const buildVisiblePersistedExpansionState = ({
  tree,
  expanded,
  explicitExpanded,
  explicitCollapsed,
  program,
}: {
  tree: PivotTreeData;
  expanded: Record<PivotAxis, Set<string>>;
  explicitExpanded: Record<PivotAxis, Set<string>>;
  explicitCollapsed: Record<PivotAxis, Set<string>>;
  program: PivotProgram;
}): {
  persistedState: PivotExpansionStateKeys;
  visibleExpanded: Record<PivotAxis, Set<string>>;
  visibleCollapsed: Record<PivotAxis, Set<string>>;
} => {
  const visibleKeys = {
    row: collectAxisVisibility({
      axis: 'row',
      nodes: tree.rows,
      expanded: expanded.row,
      program,
    }).visibleKeys,
    col: collectAxisVisibility({
      axis: 'col',
      nodes: tree.cols,
      expanded: expanded.col,
      program,
    }).visibleKeys,
  };
  const visibleExpandedKeys = {
    row: filterVisibleExpansionKeys(explicitExpanded.row, visibleKeys.row),
    col: filterVisibleExpansionKeys(explicitExpanded.col, visibleKeys.col),
  };
  const visibleCollapsedKeys = {
    row: filterVisibleExpansionKeys(explicitCollapsed.row, visibleKeys.row),
    col: filterVisibleExpansionKeys(explicitCollapsed.col, visibleKeys.col),
  };
  return {
    visibleExpanded: {
      row: new Set(visibleExpandedKeys.row),
      col: new Set(visibleExpandedKeys.col),
    },
    visibleCollapsed: {
      row: new Set(visibleCollapsedKeys.row),
      col: new Set(visibleCollapsedKeys.col),
    },
    persistedState: {
      rows: visibleExpandedKeys.row,
      cols: visibleExpandedKeys.col,
      collapsedRows: visibleCollapsedKeys.row,
      collapsedCols: visibleCollapsedKeys.col,
    },
  };
};
