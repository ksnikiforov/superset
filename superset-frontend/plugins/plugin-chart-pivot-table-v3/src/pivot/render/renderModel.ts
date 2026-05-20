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
  type TotalPosition,
} from '../../types';
import {
  buildColumnHeaderRows,
  buildVisibleList,
  findChildren,
  rootKey,
  type HeaderCellInfo,
} from '../viewModel';
import { buildVisibleCellEntries, type VisibleCellEntry } from '../cellUtils';
import type { PivotProgram } from '../runtime/types';
import { serializePath } from '../core/path';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  isMetricTokenForKeys,
  isSubtotalToken,
} from '../core/tokens';
import {
  createMetricNodePolicy,
  getMetricDepthForParent,
  getMetricTierNodes,
  isExplicitSubtotalNode,
  shouldHideMetricHeaderOnAxis,
} from '../metricsTotals';
import {
  getAxisDimensionCount,
  getValuesLevelIndex,
  isValuesAtAxisEnd,
  isValuesFirstOnAxis,
  resolveAxisChildProjection,
  resolveAxisProjection,
  resolveCollapsedValuesProjection,
} from '../runtime/projection';

export type RenderModel = {
  visibleRows: PivotTreeNode[];
  visibleCols: PivotTreeNode[];
  columnHeaderRows: HeaderCellInfo[][];
  visibleCellEntries: VisibleCellEntry[];
  showRowRoot: boolean;
};

export type RenderModelAxes = Pick<
  RenderModel,
  'visibleRows' | 'visibleCols' | 'showRowRoot'
>;

export type RenderModelConfig = {
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  rowTotals: boolean;
  colTotals: boolean;
  rowTotalPosition: TotalPosition;
  colTotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
  pivotProgram: PivotProgram;
  hasMultipleMeasures: boolean;
  isLeafTierVisible: boolean;
  rowSubTotals: boolean;
  getRowSubtotalPosition: (node: PivotTreeNode) => TotalPosition;
  rowSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  colSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getColumnDisplayPath?: (
    col: PivotTreeNode,
    maxDepth: number,
  ) => PivotTreeNode['path'];
  getColumnHeaderLabel?: (value: unknown) => string;
};

export type RenderModelInput = {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  config: RenderModelConfig;
};

const createColLeavesBuilder = ({
  config,
  expandedCols,
  showColRoot,
  getColChildren,
  getCollapsedColLeaves,
  countDimDepth,
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
}: {
  config: RenderModelConfig;
  expandedCols: Set<string>;
  showColRoot: boolean;
  getColChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getCollapsedColLeaves: (parent: PivotTreeNode) => PivotTreeNode[];
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node?: PivotTreeNode) => boolean;
}) => {
  const buildColLeavesWithSubtotals = (
    node: PivotTreeNode,
  ): PivotTreeNode[] => {
    const children = getColChildren(node).sort(config.colSorter);
    const dimDepth = countDimDepth(node.path);
    const hasChildren = children.length > 0;
    const hasMetricGrandTotals = children.some(isMetricGrandTotalNode);
    const isMetricGroup = Boolean(
      decodeMetricKey(node.path[node.path.length - 1]),
    );
    const includeSubtotal =
      hasChildren &&
      ((config.rowTotals && dimDepth === 0) ||
        config.normalizedColSubtotalLevels.includes(dimDepth) ||
        (dimDepth === 0 && hasMetricGrandTotals)) &&
      !(dimDepth === 0 && !showColRoot);
    const isNodeDescendant = (leaf: PivotTreeNode) =>
      node.path.every((val, idx) => val === leaf.path[idx]);
    const isBranchLeaf = (leaf: PivotTreeNode) =>
      leaf.path.length === node.path.length + 1 && isNodeDescendant(leaf);
    const isMetricSubtotalAtDepth = (leaf: PivotTreeNode) =>
      (isMetricGrandTotalNode(leaf) || isMetricSubtotalNode(leaf)) &&
      countDimDepth(leaf.path) === dimDepth;
    const isSubtotalLeaf = (leaf: PivotTreeNode) =>
      isNodeDescendant(leaf) &&
      (isSubtotalToken(leaf.path[node.path.length]) ||
        isMetricGrandTotalNode(leaf) ||
        (isBranchLeaf(leaf) && isMetricSubtotalAtDepth(leaf)));
    const hasDeeperLeaves = (leaves: PivotTreeNode[]) =>
      leaves.some(leaf => countDimDepth(leaf.path) > dimDepth);
    const shouldHideSubtotalLeaf = (leaf: PivotTreeNode) =>
      isNodeDescendant(leaf) &&
      !leaf.path.some(val => decodeMeasureLeafId(val)) &&
      (isSubtotalToken(leaf.path[node.path.length]) ||
        isMetricSubtotalAtDepth(leaf));
    if (!expandedCols.has(node.key) || children.length === 0) {
      const collapsedMetricLeaves = getCollapsedColLeaves(node);
      if (collapsedMetricLeaves.length === 0) {
        return [node];
      }
      return collapsedMetricLeaves.flatMap(leaf =>
        expandedCols.has(leaf.key) ? buildColLeavesWithSubtotals(leaf) : [leaf],
      );
    }
    const placeAtFront =
      (dimDepth === 0
        ? config.colTotalPosition
        : config.resolvedColSubtotalPosition) === 'start';
    const childLeaves = children.flatMap(buildColLeavesWithSubtotals);
    const hasMeasureLeafDescendants = childLeaves.some(leaf =>
      leaf.path.some(val => decodeMeasureLeafId(val)),
    );
    const suppressMetricGroupLeaf = isMetricGroup && hasMeasureLeafDescendants;
    if (!includeSubtotal) {
      return hasDeeperLeaves(childLeaves)
        ? childLeaves.filter(leaf => !shouldHideSubtotalLeaf(leaf))
        : childLeaves;
    }
    const explicitSubtotalKeys = new Set<string>();
    const resolvedSubtotalLeaves = childLeaves.filter(leaf => {
      if (!isSubtotalLeaf(leaf) || explicitSubtotalKeys.has(leaf.key)) {
        return false;
      }
      explicitSubtotalKeys.add(leaf.key);
      return true;
    });
    if (resolvedSubtotalLeaves.length > 0) {
      const remainingLeaves = childLeaves.filter(
        leaf => !explicitSubtotalKeys.has(leaf.key),
      );
      return placeAtFront
        ? [...resolvedSubtotalLeaves, ...remainingLeaves]
        : [...remainingLeaves, ...resolvedSubtotalLeaves];
    }
    if (suppressMetricGroupLeaf) {
      return childLeaves;
    }
    return placeAtFront ? [node, ...childLeaves] : [...childLeaves, node];
  };

  return buildColLeavesWithSubtotals;
};

const resolveAxisChildrenBeforeSubtotalPolicy = ({
  program,
  axis,
  parent,
  nodes,
  isLeafTierVisible,
  colTotals = false,
  normalizedColSubtotalLevelCount = 0,
}: {
  program: PivotProgram;
  axis: PivotAxis;
  parent: PivotTreeNode;
  nodes: Record<string, PivotTreeNode>;
  isLeafTierVisible: boolean;
  colTotals?: boolean;
  normalizedColSubtotalLevelCount?: number;
}): PivotTreeNode[] => {
  const children = findChildren(nodes, parent);
  const { metricLabelSet, isMetricGrandTotalNode, isMetricSubtotalNode } =
    createMetricNodePolicy(program);
  const metricIndex = getValuesLevelIndex(program, axis);
  const hideMetricHeader = shouldHideMetricHeaderOnAxis({
    program,
    axis,
    isLeafTierVisible,
  });
  const groupbyLength = getAxisDimensionCount(program, axis);
  const getChildProjection = (child: PivotTreeNode) =>
    resolveAxisChildProjection({
      program,
      axis,
      parentPath: parent.path,
      childPath: child.path,
    });
  const { valuesLevelSeen } = resolveAxisProjection({
    program,
    axis,
    path: parent.path.filter(val => !isSubtotalToken(val)),
  });
  let filtered =
    valuesLevelSeen || metricIndex === undefined
      ? children
      : children.filter(
          child =>
            child.path.length <= metricIndex ||
            getChildProjection(child).rawValuesTokenIndex === metricIndex,
        );
  const isValueAxis = program.valueAxis === axis && parent.axis === axis;
  if (
    isValueAxis &&
    parent.level < groupbyLength &&
    (metricIndex === undefined || metricIndex > parent.level)
  ) {
    const projected = children.map(child => ({
      child,
      introducesValues: getChildProjection(child).introducesValues,
    }));
    const hasNonValuesChildren = projected.some(
      child => !child.introducesValues,
    );
    const keepValuesChild = (
      child: PivotTreeNode,
      hasNonMetricChildren: boolean,
    ) => {
      if (axis === 'col') {
        return (
          isMetricGrandTotalNode(child) ||
          (normalizedColSubtotalLevelCount > 0 && isMetricSubtotalNode(child))
        );
      }
      if (!hasNonMetricChildren) {
        return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
      }
      return (
        isMetricGrandTotalNode(child) &&
        (colTotals ||
          metricIndex === undefined ||
          parent.level >= metricIndex ||
          metricIndex !== 0)
      );
    };
    const withoutMetrics = projected
      .filter(
        ({ child, introducesValues }) =>
          !introducesValues || keepValuesChild(child, hasNonValuesChildren),
      )
      .map(({ child }) => child);
    filtered = withoutMetrics.length > 0 ? withoutMetrics : children;
  }
  if (
    hideMetricHeader &&
    parent.axis === axis &&
    parent.level >= groupbyLength
  ) {
    filtered = filtered.filter(
      child => !isMetricTokenForKeys(child.path[parent.level], metricLabelSet),
    );
  }
  if (isValuesFirstOnAxis(program, axis)) {
    filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
  }
  return filtered;
};

const resolveCollapsedValuesNodesForAxis = ({
  program,
  axis,
  parent,
  expandedSet,
  nodes,
  isLeafTierVisible,
}: {
  program: PivotProgram;
  axis: PivotAxis;
  parent: PivotTreeNode;
  expandedSet: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  isLeafTierVisible: boolean;
}): PivotTreeNode[] => {
  const { metricLabelSet, isMetricSubtotalNode } =
    createMetricNodePolicy(program);
  const metricIndex = getValuesLevelIndex(program, axis);
  const axisDimensionCount = getAxisDimensionCount(program, axis);
  const isSingleMetricBetween =
    program.metricKeys.length === 1 &&
    metricIndex !== undefined &&
    metricIndex > 0 &&
    metricIndex < axisDimensionCount;
  const metricsAtEnd = isValuesAtAxisEnd(program, axis);
  const exposeCollapsedMetricTier =
    program.metricKeys.length > 1 ||
    isSingleMetricBetween ||
    (isLeafTierVisible && metricsAtEnd);
  if (
    !exposeCollapsedMetricTier ||
    program.valueAxis !== axis ||
    expandedSet.has(parent.key)
  ) {
    return [];
  }
  if (
    (axis === 'row' &&
      (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent))) ||
    parent.path.some(val => isMetricTokenForKeys(val, metricLabelSet))
  ) {
    return [];
  }
  const metricDepth = getMetricDepthForParent(nodes, parent, metricLabelSet);
  if (metricDepth === undefined || parent.path.length > metricDepth) {
    return [];
  }
  const metricNodes = getMetricTierNodes(
    nodes,
    parent,
    metricDepth,
    metricLabelSet,
  );
  if (metricNodes.length === 0) {
    return [];
  }
  const collapsedMetrics = resolveCollapsedValuesProjection({
    program,
    axis,
    parentPath: parent.path,
    sourceMetricPaths: metricNodes.map(node => node.path),
  });
  return collapsedMetrics.map(metric => {
    const collapsedKey = serializePath(metric.metricPath);
    const existing = nodes[collapsedKey];
    const sourceNode = nodes[serializePath(metric.sourceMetricPath)];
    const hasChildren = metricsAtEnd
      ? false
      : findChildren(nodes, existing || { ...parent, path: metric.metricPath })
          .length > 0 || metric.hasProjectedChildren;
    if (existing) {
      if (axis === 'col' && isMetricSubtotalNode(existing)) {
        return {
          ...existing,
          label: metric.metricKey,
          formattedLabel: metric.metricKey,
          isSubtotal: false,
          hasChildren,
        };
      }
      return { ...existing, hasChildren };
    }
    return {
      ...(sourceNode || metricNodes[0]),
      key: collapsedKey,
      path: metric.metricPath,
      label: metric.metricKey,
      formattedLabel: metric.metricKey,
      level: metric.metricPath.length,
      hasChildren,
    };
  });
};

const resolveRowSubtotalChildrenPolicy = ({
  program,
  children,
  parent,
  nodes,
  rowSubTotals,
  rowSubtotalPositionForParent,
  isLeafTierVisible,
}: {
  program: PivotProgram;
  children: PivotTreeNode[];
  parent: PivotTreeNode;
  nodes: Record<string, PivotTreeNode>;
  rowSubTotals: boolean;
  rowSubtotalPositionForParent: TotalPosition;
  isLeafTierVisible: boolean;
}): PivotTreeNode[] => {
  const isMultiMetric = program.metricKeys.length > 1;
  const { metricLabelSet, countDimDepth, isMetricGrandTotalNode } =
    createMetricNodePolicy(program);
  const metricIndexOnRows = getValuesLevelIndex(program, 'row');
  const isRowMetricAxis = program.valueAxis === 'row';
  const hideMetricHeaderOnRows = shouldHideMetricHeaderOnAxis({
    program,
    axis: 'row',
    isLeafTierVisible,
  });
  let filtered = children;
  if (isRowMetricAxis && !isMultiMetric) {
    filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
  }
  if (!rowSubTotals || rowSubtotalPositionForParent === 'start') {
    filtered = filtered.filter(
      child =>
        child.path.length === 0 ||
        !isExplicitSubtotalNode(child) ||
        isMetricGrandTotalNode(child),
    );
  }
  if (rowSubTotals && rowSubtotalPositionForParent === 'end') {
    const requireMetricLabel =
      isRowMetricAxis &&
      isMultiMetric &&
      metricIndexOnRows !== undefined &&
      countDimDepth(parent.path) > metricIndexOnRows;
    const subtotalDescendants = Object.values(nodes).filter(node => {
      if (
        node.path.length <= parent.path.length ||
        !parent.path.every((val, idx) => val === node.path[idx])
      ) {
        return false;
      }
      if (
        (isRowMetricAxis && !isMultiMetric && isMetricGrandTotalNode(node)) ||
        !isSubtotalToken(node.path[parent.path.length])
      ) {
        return false;
      }
      const hasMetricToken = node.path.some(val =>
        isMetricTokenForKeys(val, metricLabelSet),
      );
      return hideMetricHeaderOnRows
        ? true
        : !requireMetricLabel || hasMetricToken;
    });
    const seen = new Set(filtered.map(child => child.key));
    subtotalDescendants.forEach(node => {
      const subtotalIndex = node.path.findIndex(val => isSubtotalToken(val));
      if (
        !(
          isRowMetricAxis &&
          isMultiMetric &&
          subtotalIndex > 0 &&
          isMetricTokenForKeys(node.path[subtotalIndex - 1], metricLabelSet)
        ) &&
        !seen.has(node.key)
      ) {
        filtered.push(node);
      }
    });
  }
  if (rowSubTotals && isRowMetricAxis && isMultiMetric) {
    filtered = filtered.filter(
      child =>
        !isExplicitSubtotalNode(child) ||
        isMetricGrandTotalNode(child) ||
        child.path.some(val => isMetricTokenForKeys(val, metricLabelSet)),
    );
  }
  return filtered;
};

export const buildRenderModelAxes = ({
  tree,
  expandedRows,
  expandedCols,
  config,
}: RenderModelInput): RenderModelAxes => {
  const groupbyRowsLength = config.pivotProgram.rowDimensions.length;
  const groupbyColumnsLength = config.pivotProgram.columnDimensions.length;
  const showRowRootBase =
    groupbyRowsLength > 0 &&
    (config.normalizedRowSubtotalLevels.includes(0) || config.colTotals);
  const suppressRowRootForMultiMeasure =
    config.hasMultipleMeasures &&
    (config.pivotProgram.valueAxis === 'row' || config.rowTotals);
  const showRowRoot = showRowRootBase && !suppressRowRootForMultiMeasure;
  const showColRoot =
    groupbyColumnsLength > 0 &&
    (config.normalizedColSubtotalLevels.includes(0) || config.rowTotals);

  const skipRowRoot =
    (groupbyRowsLength > 0 && !showRowRoot) ||
    (groupbyRowsLength === 0 && config.hasMultipleMeasures);
  const skipColRoot = groupbyColumnsLength === 0 || !showColRoot;

  const shouldHideMetricGrandTotalsOnRows = !showRowRootBase;
  const totalRowPosition = config.colTotals
    ? config.colTotalPosition
    : config.rowTotalPosition;
  const shouldHideMetricGrandTotalsOnCols = !showColRoot;
  const shouldSuppressColRoot =
    config.pivotProgram.valueAxis === 'col' &&
    config.pivotProgram.metricKeys.length > 0 &&
    config.pivotProgram.metricInsertIndex === 0;
  const getCollapsedChildrenForAxis = (
    axis: PivotAxis,
    parent: PivotTreeNode,
    expandedSet: Set<string>,
    nodes: Record<string, PivotTreeNode>,
  ) =>
    resolveCollapsedValuesNodesForAxis({
      program: config.pivotProgram,
      axis,
      parent,
      expandedSet,
      nodes,
      isLeafTierVisible: config.isLeafTierVisible,
    });
  const getAxisChildrenForNodes = (
    axis: PivotAxis,
    parent: PivotTreeNode,
    nodes: Record<string, PivotTreeNode>,
  ) => {
    const filtered = resolveAxisChildrenBeforeSubtotalPolicy({
      program: config.pivotProgram,
      axis,
      parent,
      nodes,
      isLeafTierVisible: config.isLeafTierVisible,
      colTotals: axis === 'row' ? config.colTotals : undefined,
      normalizedColSubtotalLevelCount:
        axis === 'col' ? config.normalizedColSubtotalLevels.length : undefined,
    });
    if (axis === 'col') {
      return filtered;
    }
    return resolveRowSubtotalChildrenPolicy({
      program: config.pivotProgram,
      children: filtered,
      parent,
      nodes,
      rowSubTotals: config.rowSubTotals,
      rowSubtotalPositionForParent: config.getRowSubtotalPosition(parent),
      isLeafTierVisible: config.isLeafTierVisible,
    });
  };

  const metricPolicy = createMetricNodePolicy(config.pivotProgram);
  const orderedRows = buildVisibleList(
    tree.rows,
    expandedRows,
    config.rowSorter,
    skipRowRoot,
    parent => getAxisChildrenForNodes('row', parent, tree.rows),
    parent =>
      getCollapsedChildrenForAxis('row', parent, expandedRows, tree.rows),
  );
  let visibleRowsBase =
    orderedRows.length === 0 && tree.rows[rootKey]
      ? [tree.rows[rootKey]]
      : orderedRows;
  if (totalRowPosition === 'end' && showRowRoot) {
    const rootIdx = visibleRowsBase.findIndex(row => row.key === rootKey);
    if (rootIdx >= 0) {
      const [rootRow] = visibleRowsBase.splice(rootIdx, 1);
      visibleRowsBase = [...visibleRowsBase, rootRow];
    }
  }
  const visibleRows = shouldHideMetricGrandTotalsOnRows
    ? visibleRowsBase.filter(row => !metricPolicy.isMetricGrandTotalNode(row))
    : visibleRowsBase;

  const buildColLeavesWithSubtotals = createColLeavesBuilder({
    config,
    expandedCols,
    showColRoot,
    getColChildren: parent => getAxisChildrenForNodes('col', parent, tree.cols),
    getCollapsedColLeaves: parent =>
      getCollapsedChildrenForAxis('col', parent, expandedCols, tree.cols),
    countDimDepth: metricPolicy.countDimDepth,
    isMetricGrandTotalNode: metricPolicy.isMetricGrandTotalNode,
    isMetricSubtotalNode: metricPolicy.isMetricSubtotalNode,
  });
  const root = tree.cols[rootKey];
  const startCols = !root
    ? []
    : skipColRoot
      ? getAxisChildrenForNodes('col', root, tree.cols).sort(config.colSorter)
      : [root];
  const colLeaves = startCols.flatMap(buildColLeavesWithSubtotals);
  const visibleColsBase = colLeaves.length === 0 && root ? [root] : colLeaves;
  let visibleCols = shouldHideMetricGrandTotalsOnCols
    ? visibleColsBase.filter(col => !metricPolicy.isMetricGrandTotalNode(col))
    : visibleColsBase;
  if (shouldSuppressColRoot) {
    const metricKeySet = new Set(config.pivotProgram.metricKeys);
    const hasMetricLeaves = visibleCols.some(col =>
      col.path.some(value => isMetricTokenForKeys(value, metricKeySet)),
    );
    if (hasMetricLeaves) {
      const withoutRoot = visibleCols.filter(col => col.key !== rootKey);
      visibleCols = withoutRoot.length > 0 ? withoutRoot : visibleCols;
    }
  }

  return { visibleRows, visibleCols, showRowRoot };
};

export const buildRenderModel = ({
  tree,
  expandedRows,
  expandedCols,
  config,
}: RenderModelInput): RenderModel => {
  const { visibleRows, visibleCols, showRowRoot } = buildRenderModelAxes({
    tree,
    expandedRows,
    expandedCols,
    config,
  });

  const columnHeaderRows = buildColumnHeaderRows(
    visibleCols,
    tree.cols,
    config.getColumnDisplayPath,
    config.getColumnHeaderLabel,
  );

  const visibleRowKeySet = new Set(visibleRows.map(row => row.key));
  const visibleColKeySet = new Set(visibleCols.map(col => col.key));
  const visibleCellEntries = buildVisibleCellEntries({
    cells: tree.cells,
    rows: tree.rows,
    cols: tree.cols,
    visibleRowKeys: visibleRowKeySet,
    visibleColKeys: visibleColKeySet,
  });

  return {
    visibleRows,
    visibleCols,
    columnHeaderRows,
    visibleCellEntries,
    showRowRoot,
  };
};
