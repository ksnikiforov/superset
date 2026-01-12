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
import { PivotResultCell, PivotTreeNode, TotalPosition } from '../types';
import { isSubtotalToken, parseCellKey, SUBTOTAL_LABEL } from '../utils';
import { buildVisibleList, rootKey } from './viewModel';

type VisibleRowsParams = {
  rows: Record<string, PivotTreeNode>;
  expandedRows: Set<string>;
  rowSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  skipRowRoot: boolean;
  showRowRoot: boolean;
  rowTotalPosition: TotalPosition;
  getRowChildren: (node: PivotTreeNode) => PivotTreeNode[];
  getCollapsedRowChildren?: (node: PivotTreeNode) => PivotTreeNode[];
};

export const buildVisibleRows = ({
  rows,
  expandedRows,
  rowSorter,
  skipRowRoot,
  showRowRoot,
  rowTotalPosition,
  getRowChildren,
  getCollapsedRowChildren,
}: VisibleRowsParams) => {
  const ordered = buildVisibleList(
    rows,
    expandedRows,
    rowSorter,
    skipRowRoot,
    getRowChildren,
    getCollapsedRowChildren,
  );
  if (rowTotalPosition === 'end' && showRowRoot) {
    const rootIdx = ordered.findIndex(row => row.key === rootKey);
    if (rootIdx >= 0) {
      const [rootRow] = ordered.splice(rootIdx, 1);
      return [...ordered, rootRow];
    }
  }
  return ordered;
};

type ColLeavesParams = {
  getColChildren: (node: PivotTreeNode) => PivotTreeNode[];
  getCollapsedColLeaves: (node: PivotTreeNode) => PivotTreeNode[];
  colSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  expandedCols: Set<string>;
  normalizedColSubtotalLevels: number[];
  showColRoot: boolean;
  colTotals: boolean;
  resolvedColTotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node?: PivotTreeNode) => boolean;
};

export const createColLeavesBuilder = ({
  getColChildren,
  getCollapsedColLeaves,
  colSorter,
  countDimDepth,
  expandedCols,
  normalizedColSubtotalLevels,
  showColRoot,
  colTotals,
  resolvedColTotalPosition,
  resolvedColSubtotalPosition,
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
}: ColLeavesParams) => {
  const buildColLeavesWithSubtotals = (node: PivotTreeNode): PivotTreeNode[] => {
    const children = getColChildren(node).sort(colSorter);
    const dimDepth = countDimDepth(node.path);
    const hasChildren = children.length > 0;
    const includeSubtotal =
      hasChildren &&
      ((colTotals && dimDepth === 0) ||
        normalizedColSubtotalLevels.includes(dimDepth)) &&
      !(dimDepth === 0 && !showColRoot);
    const isSubtotalTokenForNode = (leaf: PivotTreeNode) => {
      if (!node.path.every((val, idx) => val === leaf.path[idx])) {
        return false;
      }
      const token = leaf.path[node.path.length];
      if (isSubtotalToken(token)) {
        return true;
      }
      if (leaf.path.length !== node.path.length + 1) {
        return false;
      }
      return (
        leaf.formattedLabel === SUBTOTAL_LABEL || leaf.label === SUBTOTAL_LABEL
      );
    };
    const isMetricSubtotalForNode = (leaf: PivotTreeNode) => {
      if (!node.path.every((val, idx) => val === leaf.path[idx])) {
        return false;
      }
      if (!isMetricGrandTotalNode(leaf) && !isMetricSubtotalNode(leaf)) {
        return false;
      }
      return countDimDepth(leaf.path) === dimDepth;
    };
    const filterHiddenSubtotals = (leaves: PivotTreeNode[]) => {
      const hasDeeperLeaves = leaves.some(
        leaf => countDimDepth(leaf.path) > dimDepth,
      );
      if (!hasDeeperLeaves) {
        return leaves;
      }
      return leaves.filter(
        leaf =>
          !isSubtotalTokenForNode(leaf) && !isMetricSubtotalForNode(leaf),
      );
    };
    if (!expandedCols.has(node.key) || children.length === 0) {
      const collapsedMetricLeaves = getCollapsedColLeaves(node);
      return collapsedMetricLeaves.length > 0 ? collapsedMetricLeaves : [node];
    }
    const placeAtFront =
      (dimDepth === 0 ? resolvedColTotalPosition : resolvedColSubtotalPosition) ===
      'start';
    const childLeaves = children.flatMap(buildColLeavesWithSubtotals);
    if (!includeSubtotal) {
      return filterHiddenSubtotals(childLeaves);
    }
    const isBranchLeaf = (leaf: PivotTreeNode) =>
      leaf.path.length === node.path.length + 1 &&
      node.path.every((val, idx) => val === leaf.path[idx]);
    const isSubtotalTokenLeaf = (leaf: PivotTreeNode) => {
      if (!isBranchLeaf(leaf)) {
        return false;
      }
      const token = leaf.path[node.path.length];
      return (
        isSubtotalToken(token) ||
        leaf.formattedLabel === SUBTOTAL_LABEL ||
        leaf.label === SUBTOTAL_LABEL
      );
    };
    const isMetricSubtotalLeaf = (leaf: PivotTreeNode) =>
      isBranchLeaf(leaf) &&
      (isMetricGrandTotalNode(leaf) || isMetricSubtotalNode(leaf));
    const subtotalTokenDescendants =
      node.path.length === 0
        ? []
        : childLeaves.filter(leaf =>
            leaf.path.slice(node.path.length).some(isSubtotalToken),
          );
    const hasSubtotalTokenDescendants = subtotalTokenDescendants.length > 0;
    const explicitSubtotalLeaves = childLeaves.filter(leaf =>
      isSubtotalTokenLeaf(leaf) ||
      (!hasSubtotalTokenDescendants && isMetricSubtotalLeaf(leaf)),
    );
    if (hasSubtotalTokenDescendants) {
      explicitSubtotalLeaves.push(...subtotalTokenDescendants);
    }
    const explicitSubtotalLeavesUnique: PivotTreeNode[] = [];
    const explicitSubtotalKeys = new Set<string>();
    explicitSubtotalLeaves.forEach(leaf => {
      if (explicitSubtotalKeys.has(leaf.key)) {
        return;
      }
      explicitSubtotalKeys.add(leaf.key);
      explicitSubtotalLeavesUnique.push(leaf);
    });
    const resolvedSubtotalLeaves = explicitSubtotalLeavesUnique;
    const isDuplicateSubtotalLeaf = (leaf: PivotTreeNode) => {
      if (!isBranchLeaf(leaf)) {
        return false;
      }
      if (explicitSubtotalKeys.has(leaf.key)) {
        return false;
      }
      if (hasSubtotalTokenDescendants && isMetricSubtotalLeaf(leaf)) {
        return true;
      }
      const token = leaf.path[node.path.length];
      if (
        isSubtotalToken(token) ||
        leaf.formattedLabel === SUBTOTAL_LABEL ||
        leaf.label === SUBTOTAL_LABEL
      ) {
        return true;
      }
      if (resolvedSubtotalLeaves.length === 0) {
        return leaf.label === node.label;
      }
      return leaf.label === node.label || node.path.includes(token);
    };
    if (resolvedSubtotalLeaves.length > 0) {
      const remainingLeaves = childLeaves.filter(
        leaf =>
          !explicitSubtotalKeys.has(leaf.key) && !isDuplicateSubtotalLeaf(leaf),
      );
      return placeAtFront
        ? [...resolvedSubtotalLeaves, ...remainingLeaves]
        : [...remainingLeaves, ...resolvedSubtotalLeaves];
    }
    const subtotalLeaf = childLeaves.find(isDuplicateSubtotalLeaf);
    if (subtotalLeaf) {
      const remainingLeaves = childLeaves.filter(
        leaf =>
          leaf.key !== subtotalLeaf.key && !isDuplicateSubtotalLeaf(leaf),
      );
      return placeAtFront
        ? [subtotalLeaf, ...remainingLeaves]
        : [...remainingLeaves, subtotalLeaf];
    }
    return placeAtFront ? [node, ...childLeaves] : [...childLeaves, node];
  };

  return buildColLeavesWithSubtotals;
};

type VisibleColsParams = {
  cols: Record<string, PivotTreeNode>;
  skipColRoot: boolean;
  colSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getColChildren: (node: PivotTreeNode) => PivotTreeNode[];
  buildColLeavesWithSubtotals: (node: PivotTreeNode) => PivotTreeNode[];
};

export const buildVisibleCols = ({
  cols,
  skipColRoot,
  colSorter,
  getColChildren,
  buildColLeavesWithSubtotals,
}: VisibleColsParams) => {
  const root = cols[rootKey];
  if (!root) {
    return [] as PivotTreeNode[];
  }
  const startNodes = skipColRoot
    ? getColChildren(root).sort(colSorter)
    : [root];
  const leaves = startNodes.flatMap(buildColLeavesWithSubtotals);
  if (leaves.length === 0 && cols[rootKey]) {
    return [cols[rootKey]];
  }
  return leaves;
};

export const getVisibleDepths = (
  visibleRows: PivotTreeNode[],
  visibleCols: PivotTreeNode[],
  countDimDepth: (path: PivotTreeNode['path']) => number,
) => ({
  visibleRowDepth: Math.max(0, ...visibleRows.map(row => countDimDepth(row.path))),
  visibleColDepth: Math.max(0, ...visibleCols.map(col => countDimDepth(col.path))),
});

export const getExpandedDepths = (
  expandedKeys: Set<string>,
  nodes: Record<string, PivotTreeNode>,
  groupbyLength: number,
  countDimDepth: (path: PivotTreeNode['path']) => number,
) => {
  const depths = new Set<number>();
  expandedKeys.forEach(key => {
    const node = nodes[key];
    if (!node || !node.hasChildren) {
      return;
    }
    if (node.path.length === 0) {
      return;
    }
    const dimDepth = countDimDepth(node.path);
    if (dimDepth < groupbyLength) {
      depths.add(dimDepth);
    }
  });
  return depths;
};

type HasLoadedChildrenParams = {
  axis: 'row' | 'col';
  node: PivotTreeNode;
  getRawChildren: (axis: 'row' | 'col', node: PivotTreeNode) => PivotTreeNode[];
  groupbyRowsLength: number;
  groupbyColsLength: number;
  isMetricTokenValue: (val: unknown) => boolean;
  metricIndexForRows?: number;
  metricIndexForCols?: number;
  cells: Record<string, PivotResultCell>;
  rows: Record<string, PivotTreeNode>;
  cols: Record<string, PivotTreeNode>;
  visibleRowDepth: number;
  visibleColDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
};

export const hasLoadedChildren = ({
  axis,
  node,
  getRawChildren,
  groupbyRowsLength,
  groupbyColsLength,
  isMetricTokenValue,
  metricIndexForRows,
  metricIndexForCols,
  cells,
  rows,
  cols,
  visibleRowDepth,
  visibleColDepth,
  countDimDepth,
}: HasLoadedChildrenParams) => {
  const countBaseDimDepth = (path: PivotTreeNode['path']) =>
    path.filter(val => {
      const value = String(val ?? '');
      if (isMetricTokenValue(value)) {
        return false;
      }
      if (isSubtotalToken(val)) {
        return false;
      }
      return true;
    }).length;
  const children = getRawChildren(axis, node);
  if (children.length === 0) {
    return false;
  }
  const groupbyLength = axis === 'row' ? groupbyRowsLength : groupbyColsLength;
  const parentDimDepth = countBaseDimDepth(node.path);
  const metricIndex = axis === 'row' ? metricIndexForRows : metricIndexForCols;
  if (
    metricIndex !== undefined &&
    node.path.length > metricIndex &&
    isMetricTokenValue(node.path[metricIndex]) &&
    parentDimDepth < groupbyLength
  ) {
    // Sitting on the metric tier and deeper dimensions remain; force fetch.
    return false;
  }
  const childDimDepths = children.map(child =>
    countBaseDimDepth(child.path),
  );
  const maxChildDimDepth = Math.max(...childDimDepths, 0);
  const childCellRowDepths: number[] = [];
  const childCellColDepths: number[] = [];
  const hasChildCells = children.some(child =>
    Object.keys(cells).some(key => {
      const { rowKey, colKey } = parseCellKey(key);
      const matches = axis === 'row' ? rowKey === child.key : colKey === child.key;
      if (matches) {
        const rowNode = rows[rowKey];
        const colNode = cols[colKey];
        if (rowNode) {
          childCellRowDepths.push(countDimDepth(rowNode.path));
        }
        if (colNode) {
          childCellColDepths.push(countDimDepth(colNode.path));
        }
      }
      return matches;
    }),
  );
  const maxChildRowDepth = Math.max(...childCellRowDepths, 0);
  const maxChildColDepth = Math.max(...childCellColDepths, 0);
  if (
    parentDimDepth < groupbyLength &&
    (maxChildDimDepth <= parentDimDepth || !hasChildCells)
  ) {
    // Only metric-tier children or placeholder nodes are present; treat as not loaded.
    return false;
  }
  if (axis === 'col' && visibleRowDepth > maxChildRowDepth) {
    return false;
  }
  if (axis === 'row' && visibleColDepth > maxChildColDepth) {
    return false;
  }
  return true;
};
