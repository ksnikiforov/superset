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
import { isSubtotalToken, parseCellKey } from '../utils';
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
  rowTotals: boolean;
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
  rowTotals,
  resolvedColTotalPosition,
  resolvedColSubtotalPosition,
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
}: ColLeavesParams) => {
  const buildColLeavesWithSubtotals = (
    node: PivotTreeNode,
  ): PivotTreeNode[] => {
    const children = getColChildren(node).sort(colSorter);
    const dimDepth = countDimDepth(node.path);
    const hasChildren = children.length > 0;
    const hasMetricGrandTotals = children.some(isMetricGrandTotalNode);
    const includeSubtotal =
      hasChildren &&
      ((rowTotals && dimDepth === 0) ||
        normalizedColSubtotalLevels.includes(dimDepth) ||
        (dimDepth === 0 && hasMetricGrandTotals)) &&
      !(dimDepth === 0 && !showColRoot);
    const isSubtotalTokenForNode = (leaf: PivotTreeNode) => {
      if (!node.path.every((val, idx) => val === leaf.path[idx])) {
        return false;
      }
      const token = leaf.path[node.path.length];
      return isSubtotalToken(token);
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
        leaf => !isSubtotalTokenForNode(leaf) && !isMetricSubtotalForNode(leaf),
      );
    };
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
        ? resolvedColTotalPosition
        : resolvedColSubtotalPosition) === 'start';
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
      return isSubtotalToken(token);
    };
    const isMetricSubtotalLeaf = (leaf: PivotTreeNode) =>
      isBranchLeaf(leaf) &&
      (isMetricGrandTotalNode(leaf) || isMetricSubtotalNode(leaf)) &&
      countDimDepth(leaf.path) === dimDepth;
    const baseDimDepth = countDimDepth(
      node.path.filter(val => !isSubtotalToken(val)),
    );
    const subtotalTokenDescendants = childLeaves.filter(leaf => {
      if (!leaf.path.slice(node.path.length).some(isSubtotalToken)) {
        return false;
      }
      const leafBaseDepth = countDimDepth(
        leaf.path.filter(val => !isSubtotalToken(val)),
      );
      return leafBaseDepth === baseDimDepth;
    });
    const hasSubtotalTokenDescendants = subtotalTokenDescendants.length > 0;
    const explicitSubtotalLeaves = childLeaves.filter(
      leaf =>
        isSubtotalTokenLeaf(leaf) ||
        isMetricGrandTotalNode(leaf) ||
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
      if (resolvedSubtotalLeaves.length === 0) {
        return leaf.label === node.label || node.path.includes(token);
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
        leaf => leaf.key !== subtotalLeaf.key && !isDuplicateSubtotalLeaf(leaf),
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
  visibleRowDepth: Math.max(
    0,
    ...visibleRows.map(row => countDimDepth(row.path)),
  ),
  visibleColDepth: Math.max(
    0,
    ...visibleCols.map(col => countDimDepth(col.path)),
  ),
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
  const groupbyLength = axis === 'row' ? groupbyRowsLength : groupbyColsLength;
  const parentDimDepth = countBaseDimDepth(node.path);
  const metricIndex = axis === 'row' ? metricIndexForRows : metricIndexForCols;
  const parentHasMetric = node.path.some(val => isMetricTokenValue(val));
  const metricsExpectedAtParent =
    node.path.some(isSubtotalToken) ||
    (metricIndex !== undefined &&
      metricIndex >= 0 &&
      parentDimDepth === metricIndex &&
      !parentHasMetric);
  const isAboveMetricTier =
    metricIndex !== undefined && parentDimDepth < metricIndex;
  const axisNodes = axis === 'row' ? rows : cols;
  const nodeMetricIndex = node.path.findIndex(val => isMetricTokenValue(val));
  const basePath = node.path.filter(
    val => !isMetricTokenValue(val) && !isSubtotalToken(val),
  );
  const allowMetricVariant =
    metricIndex !== undefined &&
    parentDimDepth >= metricIndex &&
    !node.path.some(isSubtotalToken);
  const hasMetricVariant =
    allowMetricVariant &&
    !parentHasMetric &&
    Object.values(axisNodes).some(candidate => {
      if (!candidate.path.some(val => isMetricTokenValue(val))) {
        return false;
      }
      const candidatePath = candidate.path.filter(
        val => !isMetricTokenValue(val),
      );
      if (candidatePath.length !== node.path.length) {
        return false;
      }
      return candidatePath.every((val, idx) => val === node.path[idx]);
    });
  if (hasMetricVariant) {
    return true;
  }
  if (
    metricIndex !== undefined &&
    nodeMetricIndex >= 0 &&
    nodeMetricIndex < metricIndex
  ) {
    const hasDeeperBaseDescendant = Object.values(axisNodes).some(candidate => {
      const candidateBase = candidate.path.filter(
        val => !isMetricTokenValue(val) && !isSubtotalToken(val),
      );
      if (candidateBase.length <= basePath.length) {
        return false;
      }
      return basePath.every((val, idx) => val === candidateBase[idx]);
    });
    if (hasDeeperBaseDescendant) {
      return true;
    }
  }
  if (
    metricIndex !== undefined &&
    parentDimDepth < metricIndex &&
    !parentHasMetric &&
    !node.path.some(isSubtotalToken)
  ) {
    const hasMetricChildren = children.some(child =>
      child.path.some(val => isMetricTokenValue(val)),
    );
    if (hasMetricChildren) {
      const hasDescendantAtMetricIndex = Object.values(axisNodes).some(
        candidate => {
          const candidateMetricIndex = candidate.path.findIndex(val =>
            isMetricTokenValue(val),
          );
          if (candidateMetricIndex < metricIndex) {
            return false;
          }
          const candidateBase = candidate.path.filter(
            val => !isMetricTokenValue(val) && !isSubtotalToken(val),
          );
          if (candidateBase.length <= basePath.length) {
            return false;
          }
          return basePath.every((val, idx) => val === candidateBase[idx]);
        },
      );
      if (!hasDescendantAtMetricIndex) {
        // Metrics are showing before their configured position; fetch the missing dimension.
        return false;
      }
    }
  }
  const childDimDepths = children.map(child => countBaseDimDepth(child.path));
  const maxChildDimDepth = Math.max(...childDimDepths, 0);
  const childCellRowDepths: number[] = [];
  const childCellColDepths: number[] = [];
  const hasChildCells = children.some(child =>
    Object.keys(cells).some(key => {
      const { rowKey, colKey } = parseCellKey(key);
      const matches =
        axis === 'row' ? rowKey === child.key : colKey === child.key;
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
  const descendantRowDepths: number[] = [];
  const descendantColDepths: number[] = [];
  const shouldScanDescendants =
    !hasChildCells &&
    !(metricIndex === 0 && parentHasMetric && nodeMetricIndex === 0);
  if (shouldScanDescendants) {
    Object.keys(cells).forEach(key => {
      const { rowKey, colKey } = parseCellKey(key);
      const axisKey = axis === 'row' ? rowKey : colKey;
      if (axisKey === node.key) {
        return;
      }
      const axisNode = axisNodes[axisKey];
      if (!axisNode) {
        return;
      }
      const axisPath = axisNode.path;
      if (parentHasMetric) {
        if (axisPath.length < node.path.length) {
          return;
        }
        if (!node.path.every((val, idx) => val === axisPath[idx])) {
          return;
        }
      } else {
        const metriclessPath = axisPath.filter(val => !isMetricTokenValue(val));
        if (metriclessPath.length < node.path.length) {
          return;
        }
        if (!node.path.every((val, idx) => val === metriclessPath[idx])) {
          return;
        }
      }
      const rowNode = rows[rowKey];
      const colNode = cols[colKey];
      if (rowNode) {
        descendantRowDepths.push(countDimDepth(rowNode.path));
      }
      if (colNode) {
        descendantColDepths.push(countDimDepth(colNode.path));
      }
    });
  }
  const effectiveChildRowDepths =
    childCellRowDepths.length > 0 ? childCellRowDepths : descendantRowDepths;
  const effectiveChildColDepths =
    childCellColDepths.length > 0 ? childCellColDepths : descendantColDepths;
  const effectiveHasChildCells =
    hasChildCells ||
    descendantRowDepths.length > 0 ||
    descendantColDepths.length > 0;
  const maxChildRowDepth = Math.max(...effectiveChildRowDepths, 0);
  const maxChildColDepth = Math.max(...effectiveChildColDepths, 0);
  const maxChildAxisDepth =
    axis === 'row' ? maxChildRowDepth : maxChildColDepth;
  if (children.length === 0) {
    if (effectiveHasChildCells && maxChildAxisDepth > parentDimDepth) {
      return true;
    }
    if (node.path.some(isSubtotalToken)) {
      return true;
    }
    return false;
  }
  const hasVisibleRowDepth = effectiveChildRowDepths.some(
    depth => depth === visibleRowDepth,
  );
  const hasVisibleColDepth = effectiveChildColDepths.some(
    depth => depth === visibleColDepth,
  );
  if (
    parentDimDepth < groupbyLength &&
    (maxChildDimDepth <= parentDimDepth || !effectiveHasChildCells)
  ) {
    // Only metric-tier children or placeholder nodes are present; treat as not loaded.
    if (
      !metricsExpectedAtParent &&
      !(isAboveMetricTier && effectiveHasChildCells)
    ) {
      return false;
    }
  }
  if (axis === 'col' && !hasVisibleRowDepth && childCellRowDepths.length > 0) {
    return false;
  }
  if (axis === 'row' && !hasVisibleColDepth && childCellColDepths.length > 0) {
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
