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
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import {
  buildColumnHeaderRows,
  buildVisibleList,
  rootKey,
  type HeaderCellInfo,
} from '../viewModel';
import { buildVisibleCellEntries, type VisibleCellEntry } from '../cellUtils';
import type { PivotProgram } from '../runtime/types';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  isMetricTokenForKeys,
  isSubtotalToken,
} from '../core/tokens';
import { createMetricNodePolicy } from '../metricsTotals';

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
  rowSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  colSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getRowChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getCollapsedRowChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getColChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getCollapsedColLeaves: (parent: PivotTreeNode) => PivotTreeNode[];
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
  countDimDepth,
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
}: {
  config: RenderModelConfig;
  expandedCols: Set<string>;
  showColRoot: boolean;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node?: PivotTreeNode) => boolean;
}) => {
  const buildColLeavesWithSubtotals = (
    node: PivotTreeNode,
  ): PivotTreeNode[] => {
    const children = config.getColChildren(node).sort(config.colSorter);
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
      const collapsedMetricLeaves = config.getCollapsedColLeaves(node);
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

  const metricPolicy = createMetricNodePolicy(config.pivotProgram);
  const orderedRows = buildVisibleList(
    tree.rows,
    expandedRows,
    config.rowSorter,
    skipRowRoot,
    config.getRowChildren,
    config.getCollapsedRowChildren,
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
    countDimDepth: metricPolicy.countDimDepth,
    isMetricGrandTotalNode: metricPolicy.isMetricGrandTotalNode,
    isMetricSubtotalNode: metricPolicy.isMetricSubtotalNode,
  });
  const root = tree.cols[rootKey];
  const startCols = !root
    ? []
    : skipColRoot
      ? config.getColChildren(root).sort(config.colSorter)
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
