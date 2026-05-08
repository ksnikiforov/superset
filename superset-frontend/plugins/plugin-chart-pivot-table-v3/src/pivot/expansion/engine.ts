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
  MetricsLayoutEnum,
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { isSubtotalToken, parsePath, serializePath } from '../../utils';
import {
  planExpansionForAxis,
  type PivotExpansionPlan,
} from '../engine/expansionPlanner';
import {
  getVisibleExpansionKeys as getVisibleExpansionKeysBase,
  seedExpandedByLevel,
} from '../engine/expansionStateModel';
import {
  buildRenderModel,
  type RenderModelConfig,
} from '../render/renderModel';
import { type PivotProgram } from '../runtime/types';
import {
  getVisibleDepths,
  hasLoadedChildren as hasLoadedChildrenBase,
} from '../visibility';
import { findChildren, rootKey } from '../viewModel';
import {
  isMetricGrandTotalNode as isMetricGrandTotalNodeBase,
  isMetricSubtotalNode as isMetricSubtotalNodeBase,
} from '../metricsTotals';
import { buildGroupedFetchTargets } from './planner';
import {
  getFetchedAxisDepthMap,
  type FetchedFactCoverageState,
} from './fetchedRequests';

export type ExpansionVisibilityConfig = {
  pivotProgram: PivotProgram;
  groupbyRowsLength: number;
  groupbyColumnsLength: number;
  rowTotals: boolean;
  colTotals: boolean;
  metricsLayout?: MetricsLayoutEnum;
  metricLabelSet: Set<string>;
  hasMultipleMeasures?: boolean;
  metricIndexForRows?: number;
  metricIndexForCols?: number;
  isMetricTokenValue: (value: unknown) => boolean;
  countDimDepth: (path: PivotTreeNode['path']) => number;
};

export type HydrationIterationPlan =
  | {
      kind: 'complete';
      desiredRows: Set<string>;
      desiredCols: Set<string>;
      visibleRowDepth: number;
      visibleColDepth: number;
      rowPlan: PivotExpansionPlan;
      colPlan: PivotExpansionPlan;
    }
  | {
      kind: 'fetch';
      desiredRows: Set<string>;
      desiredCols: Set<string>;
      visibleRowDepth: number;
      visibleColDepth: number;
      rowPlan: PivotExpansionPlan;
      colPlan: PivotExpansionPlan;
      targets: Array<{
        axis: PivotAxis;
        pathKey: string;
        childDepth: number;
        requiredOppositeDepth: number;
      }>;
    };

const depthSorter = () => 0;

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

export const pruneFetchedDepths = ({
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

export const buildExpansionRenderModelConfig = (
  tree: PivotTreeData,
  config: ExpansionVisibilityConfig,
): RenderModelConfig => {
  const resolvedMetricsLayout =
    config.metricsLayout === MetricsLayoutEnum.ROWS
      ? MetricsLayoutEnum.ROWS
      : MetricsLayoutEnum.COLUMNS;
  const metricsFirstOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    config.metricIndexForRows === 0;
  const metricsFirstOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    config.metricIndexForCols === 0;
  const isMultiMetric = config.metricLabelSet.size > 1;
  const hasMultipleMeasures = config.hasMultipleMeasures ?? isMultiMetric;
  return {
    groupbyRowsLength: config.groupbyRowsLength,
    groupbyColumnsLength: config.groupbyColumnsLength,
    normalizedRowSubtotalLevels: [],
    normalizedColSubtotalLevels: [],
    rowTotals: config.rowTotals,
    colTotals: config.colTotals,
    rowTotalPosition: 'start',
    colTotalPosition: 'start',
    resolvedColSubtotalPosition: 'start',
    resolvedMetricsLayout,
    isMultiMetric,
    hasMultipleMeasures,
    metricsFirstOnCols,
    hideMetricHeaderOnRows: false,
    hideMetricHeaderOnCols: false,
    rowSorter: depthSorter,
    colSorter: depthSorter,
    getRowChildren: parent => findChildren(tree.rows, parent),
    getCollapsedRowChildren: () => [] as PivotTreeNode[],
    getColChildren: parent => findChildren(tree.cols, parent),
    getCollapsedColLeaves: () => [] as PivotTreeNode[],
    countDimDepth: config.countDimDepth,
    isMetricGrandTotalNode: node =>
      isMetricGrandTotalNodeBase(node, {
        metricLabelSet: config.metricLabelSet,
        metricsFirstOnRows,
        metricsFirstOnCols,
      }),
    isMetricSubtotalNode: node =>
      isMetricSubtotalNodeBase(node, config.metricLabelSet),
    isMetricTokenValue: config.isMetricTokenValue,
  };
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
    config: buildExpansionRenderModelConfig(tree, config),
  });
  const { visibleRowDepth, visibleColDepth } = getVisibleDepths(
    renderModel.visibleRows,
    renderModel.visibleCols,
    config.countDimDepth,
  );
  return { visibleRowDepth, visibleColDepth };
};

export const buildHasLoadedChildren =
  ({
    tree,
    visibleRowDepth,
    visibleColDepth,
    config,
  }: {
    tree: PivotTreeData;
    visibleRowDepth: number;
    visibleColDepth: number;
    config: ExpansionVisibilityConfig;
  }) =>
  (axis: PivotAxis, node: PivotTreeNode) =>
    hasLoadedChildrenBase({
      axis,
      node,
      getRawChildren: (targetAxis, parent) =>
        targetAxis === 'row'
          ? findChildren(tree.rows, parent)
          : findChildren(tree.cols, parent),
      program: config.pivotProgram,
      groupbyRowsLength: config.groupbyRowsLength,
      groupbyColsLength: config.groupbyColumnsLength,
      isMetricTokenValue: config.isMetricTokenValue,
      metricIndexForRows: config.metricIndexForRows,
      metricIndexForCols: config.metricIndexForCols,
      cells: tree.cells,
      rows: tree.rows,
      cols: tree.cols,
      visibleRowDepth,
      visibleColDepth,
      countDimDepth: config.countDimDepth,
    });

export const getMetricIndexFromNodes = ({
  nodes,
  isMetricTokenValue,
}: {
  nodes: Record<string, PivotTreeNode>;
  isMetricTokenValue: (value: unknown) => boolean;
}): number | undefined => {
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
};

export const resolveExpandedForMetrics = ({
  axis,
  expanded,
  tree,
  collapsed,
  fallbackMetricIndex,
  isMetricTokenValue,
}: {
  axis: PivotAxis;
  expanded: Set<string>;
  tree: PivotTreeData;
  collapsed: Set<string>;
  fallbackMetricIndex: number | undefined;
  isMetricTokenValue: (value: unknown) => boolean;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const metricIndex =
    getMetricIndexFromNodes({ nodes, isMetricTokenValue }) ??
    fallbackMetricIndex;
  const resolved = expandMetricPatternExpansions({
    expanded,
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
};

export const buildDesiredExpandedKeys = ({
  axis,
  tree,
  autoExpandLevel,
  metricLabelSet,
  includeMetricDepthZero,
  manualExpanded,
  manualCollapsed,
  pendingKeys,
  inFlightKeys,
}: {
  axis: PivotAxis;
  tree: PivotTreeData;
  autoExpandLevel: number;
  metricLabelSet: Set<string>;
  includeMetricDepthZero: boolean;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
  pendingKeys: Set<string>;
  inFlightKeys: Set<string>;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const autoSeeded = seedExpandedByLevel(
    nodes,
    autoExpandLevel,
    metricLabelSet,
    {
      includeMetricDepthZero,
    },
  );
  const next = new Set<string>([
    ...autoSeeded,
    ...manualExpanded,
    ...pendingKeys,
    ...inFlightKeys,
  ]);
  manualCollapsed.forEach(key => next.delete(key));
  return next;
};

export const applyCrossAxisRootFetch = ({
  tree,
  rowPlan,
  colPlan,
  visibleRowDepth,
  visibleColDepth,
  groupbyRowsLength,
  groupbyColumnsLength,
  countDimDepth,
}: {
  tree: PivotTreeData;
  rowPlan: PivotExpansionPlan;
  colPlan: PivotExpansionPlan;
  visibleRowDepth: number;
  visibleColDepth: number;
  groupbyRowsLength: number;
  groupbyColumnsLength: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
}): { rowPlan: PivotExpansionPlan; colPlan: PivotExpansionPlan } => {
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
  const hasRowNodes = Object.keys(tree.rows).some(key => key !== rootKey);
  const hasColNodes = Object.keys(tree.cols).some(key => key !== rootKey);
  const hasIntersectionCells = Object.values(tree.cells).some(cell => {
    const rowNode = tree.rows[cell.rowKey];
    const colNode = tree.cols[cell.colKey];
    if (!rowNode || !colNode) {
      return false;
    }
    return countDimDepth(rowNode.path) > 0 && countDimDepth(colNode.path) > 0;
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
};

export const planHydrationIteration = ({
  tree,
  desiredRows,
  desiredCols,
  fetchedCoverage,
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
  fetchedCoverage: FetchedFactCoverageState;
  config: ExpansionVisibilityConfig;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
  activeAxis?: PivotAxis;
  pendingRows: Set<string>;
  pendingCols: Set<string>;
  planRows?: boolean;
  planCols?: boolean;
}): HydrationIterationPlan => {
  const { visibleRowDepth, visibleColDepth } = computeVisibleDepths({
    tree,
    expandedRows: desiredRows,
    expandedCols: desiredCols,
    config,
  });
  const hasLoadedChildren = buildHasLoadedChildren({
    tree,
    visibleRowDepth,
    visibleColDepth,
    config,
  });

  const rowPlan = planRows
    ? planExpansionForAxis({
        axis: 'row',
        expandedKeys: desiredRows,
        nodes: tree.rows,
        requiredDepth: visibleColDepth,
        fetchedDepthByKey: getFetchedAxisDepthMap(fetchedCoverage, 'row'),
        hasLoadedChildren,
        getCoverageKey,
      })
    : {
        fetchKeys: new Set<string>(),
        pendingKeys: new Set<string>(),
        hasMissingNodes: false,
      };
  const colPlan = planCols
    ? planExpansionForAxis({
        axis: 'col',
        expandedKeys: desiredCols,
        nodes: tree.cols,
        requiredDepth: visibleRowDepth,
        fetchedDepthByKey: getFetchedAxisDepthMap(fetchedCoverage, 'col'),
        hasLoadedChildren,
        getCoverageKey,
      })
    : {
        fetchKeys: new Set<string>(),
        pendingKeys: new Set<string>(),
        hasMissingNodes: false,
      };

  let effectiveRowPlan: PivotExpansionPlan = rowPlan;
  let effectiveColPlan: PivotExpansionPlan = colPlan;

  if (
    activeAxis === 'col' &&
    colPlan.fetchKeys.size > 0 &&
    !rowPlan.hasMissingNodes &&
    pendingRows.size === 0
  ) {
    effectiveRowPlan = {
      ...rowPlan,
      fetchKeys: new Set<string>(),
      pendingKeys: new Set<string>(),
    };
  }
  if (
    activeAxis === 'row' &&
    rowPlan.fetchKeys.size > 0 &&
    !colPlan.hasMissingNodes &&
    pendingCols.size === 0
  ) {
    effectiveColPlan = {
      ...colPlan,
      fetchKeys: new Set<string>(),
      pendingKeys: new Set<string>(),
    };
  }

  ({ rowPlan: effectiveRowPlan, colPlan: effectiveColPlan } =
    applyCrossAxisRootFetch({
      tree,
      rowPlan: effectiveRowPlan,
      colPlan: effectiveColPlan,
      visibleRowDepth,
      visibleColDepth,
      groupbyRowsLength: config.groupbyRowsLength,
      groupbyColumnsLength: config.groupbyColumnsLength,
      countDimDepth: config.countDimDepth,
    }));

  if (
    effectiveRowPlan.pendingKeys.size === 0 &&
    effectiveColPlan.pendingKeys.size === 0
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
    fetchKeys: effectiveRowPlan.fetchKeys,
    nodes: tree.rows,
    requiredOppositeDepth: visibleColDepth,
    getCoverageKey,
  });
  const colGroups = buildGroupedFetchTargets({
    axis: 'col',
    fetchKeys: effectiveColPlan.fetchKeys,
    nodes: tree.cols,
    requiredOppositeDepth: visibleRowDepth,
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
    targets: [...rowGroups.targets, ...colGroups.targets],
  };
};

export const getVisibleExpansionKeys = ({
  tree,
  expandedRows,
  expandedCols,
  config,
}: {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  config: ExpansionVisibilityConfig;
}) => {
  const resolvedConfig = buildExpansionRenderModelConfig(tree, config);
  const renderModel = buildRenderModel({
    tree,
    expandedRows,
    expandedCols,
    config: resolvedConfig,
  });
  return getVisibleExpansionKeysBase({
    rowsNodes: tree.rows,
    colsNodes: tree.cols,
    expandedRows,
    expandedCols,
    rowSorter: resolvedConfig.rowSorter,
    colSorter: resolvedConfig.colSorter,
    skipRowRoot: renderModel.skipRowRoot,
    showRowRoot: renderModel.showRowRoot,
    rowTotalPosition: resolvedConfig.rowTotalPosition,
    getRowChildren: resolvedConfig.getRowChildren,
    getCollapsedRowChildren: resolvedConfig.getCollapsedRowChildren,
    skipColRoot: renderModel.skipColRoot,
    countDimDepth: resolvedConfig.countDimDepth,
    normalizedColSubtotalLevels: resolvedConfig.normalizedColSubtotalLevels,
    showColRoot: renderModel.showColRoot,
    rowTotals: resolvedConfig.rowTotals,
    colTotalPosition: resolvedConfig.colTotalPosition,
    resolvedColSubtotalPosition: resolvedConfig.resolvedColSubtotalPosition,
    getColChildren: resolvedConfig.getColChildren,
    getCollapsedColLeaves: resolvedConfig.getCollapsedColLeaves,
    isMetricGrandTotalNode: resolvedConfig.isMetricGrandTotalNode,
    isMetricSubtotalNode: resolvedConfig.isMetricSubtotalNode,
    isMetricTokenValue: resolvedConfig.isMetricTokenValue,
    shouldHideMetricGrandTotalsOnRows:
      renderModel.shouldHideMetricGrandTotalsOnRows,
    shouldHideMetricGrandTotalsOnCols:
      renderModel.shouldHideMetricGrandTotalsOnCols,
    shouldSuppressColRoot: renderModel.shouldSuppressColRoot,
  });
};
