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
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  isSubtotalToken,
  parseCellKey,
} from '../utils';
import { resolveAxisProjection } from './runtime/projection';
import { type PivotProgram } from './runtime/types';
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
  if (ordered.length === 0 && rows[rootKey]) {
    return [rows[rootKey]];
  }
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
    const isMetricGroup = Boolean(
      decodeMetricKey(node.path[node.path.length - 1]),
    );
    const includeSubtotal =
      hasChildren &&
      ((rowTotals && dimDepth === 0) ||
        normalizedColSubtotalLevels.includes(dimDepth) ||
        (dimDepth === 0 && hasMetricGrandTotals)) &&
      !(dimDepth === 0 && !showColRoot);
    const isNodeDescendant = (leaf: PivotTreeNode) =>
      node.path.every((val, idx) => val === leaf.path[idx]);
    const isBranchLeaf = (leaf: PivotTreeNode) =>
      leaf.path.length === node.path.length + 1 && isNodeDescendant(leaf);
    const isMetricSubtotalAtDepth = (leaf: PivotTreeNode) =>
      (isMetricGrandTotalNode(leaf) || isMetricSubtotalNode(leaf)) &&
      countDimDepth(leaf.path) === dimDepth;
    const filterHiddenSubtotals = (leaves: PivotTreeNode[]) => {
      const hasDeeperLeaves = leaves.some(
        leaf => countDimDepth(leaf.path) > dimDepth,
      );
      if (!hasDeeperLeaves) {
        return leaves;
      }
      return leaves.filter(leaf => {
        if (leaf.path.some(val => decodeMeasureLeafId(val))) {
          return true;
        }
        return !(
          isNodeDescendant(leaf) &&
          (isSubtotalToken(leaf.path[node.path.length]) ||
            isMetricSubtotalAtDepth(leaf))
        );
      });
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
    const hasMeasureLeafDescendants = childLeaves.some(leaf =>
      leaf.path.some(val => decodeMeasureLeafId(val)),
    );
    const suppressMetricGroupLeaf = isMetricGroup && hasMeasureLeafDescendants;
    if (!includeSubtotal) {
      return filterHiddenSubtotals(childLeaves);
    }
    const isSubtotalTokenLeaf = (leaf: PivotTreeNode) =>
      isBranchLeaf(leaf) && isSubtotalToken(leaf.path[node.path.length]);
    const isMetricSubtotalLeaf = (leaf: PivotTreeNode) =>
      isBranchLeaf(leaf) && isMetricSubtotalAtDepth(leaf);
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
    const explicitSubtotalKeys = new Set<string>();
    const resolvedSubtotalLeaves = [
      ...childLeaves.filter(
        leaf =>
          isSubtotalTokenLeaf(leaf) ||
          isMetricGrandTotalNode(leaf) ||
          (!hasSubtotalTokenDescendants && isMetricSubtotalLeaf(leaf)),
      ),
      ...(hasSubtotalTokenDescendants ? subtotalTokenDescendants : []),
    ].filter(leaf => {
      if (explicitSubtotalKeys.has(leaf.key)) {
        return false;
      }
      explicitSubtotalKeys.add(leaf.key);
      return true;
    });
    const isDuplicateSubtotalLeaf = (leaf: PivotTreeNode) =>
      isBranchLeaf(leaf) &&
      !explicitSubtotalKeys.has(leaf.key) &&
      ((hasSubtotalTokenDescendants && isMetricSubtotalLeaf(leaf)) ||
        leaf.label === node.label ||
        node.path.includes(leaf.path[node.path.length]));
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
    if (suppressMetricGroupLeaf) {
      return childLeaves;
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

type VisiblePivotAxesParams = VisibleRowsParams &
  ColLeavesParams & {
    cols: Record<string, PivotTreeNode>;
    skipColRoot: boolean;
    isMetricTokenValue: (value: unknown) => boolean;
    shouldHideMetricGrandTotalsOnRows: boolean;
    shouldHideMetricGrandTotalsOnCols: boolean;
    shouldSuppressColRoot: boolean;
  };

export const buildVisiblePivotAxes = ({
  isMetricTokenValue,
  shouldHideMetricGrandTotalsOnRows,
  shouldHideMetricGrandTotalsOnCols,
  shouldSuppressColRoot,
  ...params
}: VisiblePivotAxesParams) => {
  const { cols, colSorter, getColChildren, isMetricGrandTotalNode } = params;
  const visibleRowsBase = buildVisibleRows(params);
  const visibleRows = shouldHideMetricGrandTotalsOnRows
    ? visibleRowsBase.filter(row => !isMetricGrandTotalNode(row))
    : visibleRowsBase;
  const buildColLeavesWithSubtotals = createColLeavesBuilder(params);
  const visibleColsBase = buildVisibleCols({
    cols,
    skipColRoot: params.skipColRoot,
    colSorter,
    getColChildren,
    buildColLeavesWithSubtotals,
  });
  let visibleCols = shouldHideMetricGrandTotalsOnCols
    ? visibleColsBase.filter(col => !isMetricGrandTotalNode(col))
    : visibleColsBase;

  if (shouldSuppressColRoot) {
    const hasMetricLeaves = visibleCols.some(col =>
      col.path.some(val => isMetricTokenValue(val)),
    );
    if (hasMetricLeaves) {
      const withoutRoot = visibleCols.filter(col => col.key !== rootKey);
      visibleCols = withoutRoot.length > 0 ? withoutRoot : visibleCols;
    }
  }

  return { visibleRows, visibleCols };
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

type HasLoadedChildrenParams = {
  axis: 'row' | 'col';
  node: PivotTreeNode;
  getRawChildren: (axis: 'row' | 'col', node: PivotTreeNode) => PivotTreeNode[];
  program?: PivotProgram;
  groupbyRowsLength: number;
  groupbyColsLength: number;
  isMetricTokenValue: (val: unknown) => boolean;
  metricIndexForRows?: number;
  metricIndexForCols?: number;
  cells: Record<string, PivotResultCell>;
  rows: Record<string, PivotTreeNode>;
  cols: Record<string, PivotTreeNode>;
};

export const hasLoadedChildren = ({
  axis,
  node,
  getRawChildren,
  program,
  groupbyRowsLength,
  groupbyColsLength,
  isMetricTokenValue,
  metricIndexForRows,
  metricIndexForCols,
  cells,
  rows,
  cols,
}: HasLoadedChildrenParams) => {
  const getPathInfo = (path: PivotTreeNode['path']) => {
    const projection = program
      ? resolveAxisProjection({
          program,
          axis,
          path: path.filter(val => !isSubtotalToken(val)),
        })
      : undefined;
    const basePath =
      projection?.projectedDimensionPath ??
      path.filter(
        val => !isSubtotalToken(val) && !isMetricTokenValue(String(val ?? '')),
      );
    return {
      basePath,
      dimDepth: basePath.length,
      hasMetric: projection
        ? projection.valuesLevelSeen
        : path.some(val => isMetricTokenValue(val)),
      hasSubtotal: path.some(isSubtotalToken),
      metricIndex: path.findIndex(val => isMetricTokenValue(val)),
      skippedPreValues: (projection?.skippedPreValuesLevels.length ?? 0) > 0,
    };
  };
  const children = getRawChildren(axis, node);
  const groupbyLength = axis === 'row' ? groupbyRowsLength : groupbyColsLength;
  const parentInfo = getPathInfo(node.path);
  const { basePath, dimDepth: parentDimDepth } = parentInfo;
  const metricIndex = axis === 'row' ? metricIndexForRows : metricIndexForCols;
  const metricsExpectedAtParent =
    parentInfo.hasSubtotal ||
    (metricIndex !== undefined &&
      metricIndex >= 0 &&
      parentDimDepth === metricIndex &&
      !parentInfo.hasMetric);
  const axisNodes = axis === 'row' ? rows : cols;
  const cellKeys = Object.keys(cells);
  const isSameBasePath = (candidatePath: PivotTreeNode['path']) =>
    candidatePath.length === basePath.length &&
    candidatePath.every((val, idx) => val === basePath[idx]);
  const isDeeperBasePath = (candidatePath: PivotTreeNode['path']) =>
    candidatePath.length > basePath.length &&
    basePath.every((val, idx) => val === candidatePath[idx]);
  const allowMetricVariant =
    metricIndex !== undefined &&
    parentDimDepth >= metricIndex &&
    !parentInfo.hasSubtotal;
  const hasMetricVariant =
    allowMetricVariant &&
    !parentInfo.hasMetric &&
    Object.values(axisNodes).some(candidate => {
      const candidateInfo = getPathInfo(candidate.path);
      return candidateInfo.hasMetric && isSameBasePath(candidateInfo.basePath);
    });
  const hasMetricVariantCells =
    hasMetricVariant &&
    cellKeys.some(key => {
      const { rowKey, colKey } = parseCellKey(key);
      const axisKey = axis === 'row' ? rowKey : colKey;
      const axisNode = axisNodes[axisKey];
      if (!axisNode) {
        return false;
      }
      const axisInfo = getPathInfo(axisNode.path);
      return axisInfo.hasMetric && isSameBasePath(axisInfo.basePath);
    });
  if (hasMetricVariant) {
    return hasMetricVariantCells;
  }
  if (
    (program && parentInfo.hasMetric && parentInfo.skippedPreValues) ||
    (metricIndex !== undefined &&
      parentInfo.metricIndex >= 0 &&
      parentInfo.metricIndex < metricIndex)
  ) {
    const hasDeeperBaseDescendant = Object.values(axisNodes).some(candidate => {
      const candidateInfo = getPathInfo(candidate.path);
      return isDeeperBasePath(candidateInfo.basePath);
    });
    if (hasDeeperBaseDescendant) {
      return true;
    }
  }
  if (
    metricIndex !== undefined &&
    parentDimDepth < metricIndex &&
    !parentInfo.hasMetric &&
    !parentInfo.hasSubtotal
  ) {
    const hasMetricChildren = children.some(
      child => getPathInfo(child.path).hasMetric,
    );
    if (hasMetricChildren) {
      const hasDescendantAtMetricIndex = Object.values(axisNodes).some(
        candidate => {
          const candidateInfo = getPathInfo(candidate.path);
          if (!candidateInfo.hasMetric) {
            return false;
          }
          if (!program && candidateInfo.metricIndex < metricIndex) {
            return false;
          }
          return isDeeperBasePath(candidateInfo.basePath);
        },
      );
      if (!hasDescendantAtMetricIndex) {
        // Metrics are showing before their configured position; fetch the missing dimension.
        return false;
      }
    }
  }
  const childDimDepths = children.map(
    child => getPathInfo(child.path).dimDepth,
  );
  const maxChildDimDepth = Math.max(...childDimDepths, 0);
  if (children.length === 0) {
    if (parentInfo.hasSubtotal) {
      return true;
    }
    return false;
  }
  const hasDirectChildCells = children.some(child =>
    cellKeys.some(key => {
      const { rowKey, colKey } = parseCellKey(key);
      return axis === 'row' ? rowKey === child.key : colKey === child.key;
    }),
  );
  if (parentInfo.hasMetric && !hasDirectChildCells) {
    return false;
  }
  if (parentDimDepth < groupbyLength && maxChildDimDepth <= parentDimDepth) {
    // Only metric-tier children or placeholder nodes are present; treat as not loaded.
    if (!metricsExpectedAtParent) {
      return false;
    }
  }
  return true;
};
