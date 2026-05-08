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
import { type DataRecordValue } from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  mergeTrees,
  parsePath,
  serializeCellKey,
  serializePath,
} from '../../utils';
import { shouldFetchForDimensionAxisChange } from '../layout/shouldFetchForLayoutChange';
import { rootKey } from '../viewModel';
import { getStablePrefixLength, isSameLayout } from './engine';

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
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
  metricIndexForRows?: number;
  metricIndexForCols?: number;
  groupbyRowsLength: number;
  groupbyColumnsLength: number;
};

export const isPrefix = (prefix: string[], target: string[]) =>
  prefix.length <= target.length &&
  prefix.every((value, idx) => value === target[idx]);

const trimAxisByDepth = ({
  tree,
  axis,
  maxDepth,
  countDimDepth,
}: {
  tree: PivotTreeData;
  axis: PivotAxis;
  maxDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const nextNodes: Record<string, PivotTreeNode> = {};
  const removedKeys = new Set<string>();
  let hasChanges = false;
  Object.entries(nodes).forEach(([key, node]) => {
    const depth = countDimDepth(node.path);
    if (depth > maxDepth) {
      removedKeys.add(key);
      hasChanges = true;
      return;
    }
    let nextNode = node;
    if (depth >= maxDepth && node.hasChildren) {
      nextNode = { ...node, hasChildren: false };
      hasChanges = true;
    }
    nextNodes[key] = nextNode;
  });
  if (!hasChanges) {
    return { tree, removedKeys };
  }
  const nextTree =
    axis === 'row'
      ? { ...tree, rows: nextNodes }
      : { ...tree, cols: nextNodes };
  return { tree: nextTree, removedKeys };
};

const promoteAxisForDepth = ({
  tree,
  axis,
  maxDepth,
  countDimDepth,
  isMetricTokenValue,
  allowMetricPromotion = false,
}: {
  tree: PivotTreeData;
  axis: PivotAxis;
  maxDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
  allowMetricPromotion?: boolean;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  let hasChanges = false;
  const nextNodes: Record<string, PivotTreeNode> = { ...nodes };
  Object.entries(nodes).forEach(([key, node]) => {
    if (!allowMetricPromotion && node.path.some(isMetricTokenValue)) {
      return;
    }
    const depth = countDimDepth(node.path);
    if (depth < maxDepth && !node.hasChildren) {
      nextNodes[key] = { ...node, hasChildren: true };
      hasChanges = true;
    }
  });
  if (!hasChanges) {
    return tree;
  }
  return axis === 'row'
    ? { ...tree, rows: nextNodes }
    : { ...tree, cols: nextNodes };
};

export const trimTreeForLayout = ({
  tree,
  trimRowDepth,
  trimColDepth,
  countDimDepth,
}: {
  tree: PivotTreeData;
  trimRowDepth?: number;
  trimColDepth?: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
}) => {
  let nextTree = tree;
  const removedRows = new Set<string>();
  const removedCols = new Set<string>();
  if (trimRowDepth !== undefined) {
    const result = trimAxisByDepth({
      tree: nextTree,
      axis: 'row',
      maxDepth: trimRowDepth,
      countDimDepth,
    });
    nextTree = result.tree;
    result.removedKeys.forEach(key => removedRows.add(key));
  }
  if (trimColDepth !== undefined) {
    const result = trimAxisByDepth({
      tree: nextTree,
      axis: 'col',
      maxDepth: trimColDepth,
      countDimDepth,
    });
    nextTree = result.tree;
    result.removedKeys.forEach(key => removedCols.add(key));
  }
  if (removedRows.size === 0 && removedCols.size === 0) {
    return nextTree;
  }
  const resolveNearestSurvivingKey = (
    nodes: Record<string, PivotTreeNode>,
    key: string,
  ) => {
    if (nodes[key]) {
      return key;
    }
    const path = parsePath(key);
    for (let size = path.length - 1; size >= 0; size -= 1) {
      const candidate = serializePath(path.slice(0, size));
      if (nodes[candidate]) {
        return candidate;
      }
    }
    return nodes[rootKey] ? rootKey : undefined;
  };
  const mergeCellValues = (
    left?: Record<string, DataRecordValue>,
    right?: Record<string, DataRecordValue>,
  ) => {
    if (!left && !right) {
      return undefined;
    }
    const merged: Record<string, DataRecordValue> = { ...(left ?? {}) };
    Object.entries(right ?? {}).forEach(([metric, value]) => {
      const current = merged[metric];
      const leftNum = Number(current);
      const rightNum = Number(value);
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
        merged[metric] = leftNum + rightNum;
        return;
      }
      if (current === undefined || current === null) {
        merged[metric] = value;
        return;
      }
      if (value !== undefined && value !== null) {
        merged[metric] = value;
      }
    });
    return merged;
  };
  const nextCells: PivotTreeData['cells'] = {};
  Object.entries(nextTree.cells).forEach(([, cell]) => {
    const rowKey =
      removedRows.has(cell.rowKey) || !nextTree.rows[cell.rowKey]
        ? resolveNearestSurvivingKey(nextTree.rows, cell.rowKey)
        : cell.rowKey;
    const colKey =
      removedCols.has(cell.colKey) || !nextTree.cols[cell.colKey]
        ? resolveNearestSurvivingKey(nextTree.cols, cell.colKey)
        : cell.colKey;
    const collapsedToRowRoot =
      trimRowDepth === 0 && cell.rowKey !== rootKey && rowKey === rootKey;
    const collapsedToColRoot =
      trimColDepth === 0 && cell.colKey !== rootKey && colKey === rootKey;
    if (collapsedToRowRoot || collapsedToColRoot) {
      return;
    }
    if (rowKey === undefined || colKey === undefined) {
      return;
    }
    const nextKey = serializeCellKey(rowKey, colKey);
    const existing = nextCells[nextKey];
    const mergedValues = mergeCellValues(existing?.values, cell.values);
    nextCells[nextKey] = {
      ...(existing ?? cell),
      ...cell,
      rowKey,
      colKey,
      ...(mergedValues ? { values: mergedValues } : {}),
      isSubtotal:
        cell.isSubtotal ||
        existing?.isSubtotal ||
        rowKey !== cell.rowKey ||
        colKey !== cell.colKey,
    };
  });
  return { ...nextTree, cells: nextCells };
};

export const promoteTreeForLayout = ({
  tree,
  promoteRowDepth,
  promoteColDepth,
  countDimDepth,
  isMetricTokenValue,
  allowMetricRowPromotion,
  allowMetricColPromotion,
}: {
  tree: PivotTreeData;
  promoteRowDepth?: number;
  promoteColDepth?: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
  allowMetricRowPromotion?: boolean;
  allowMetricColPromotion?: boolean;
}) => {
  let nextTree = tree;
  if (promoteRowDepth !== undefined) {
    nextTree = promoteAxisForDepth({
      tree: nextTree,
      axis: 'row',
      maxDepth: promoteRowDepth,
      countDimDepth,
      isMetricTokenValue,
      allowMetricPromotion: allowMetricRowPromotion,
    });
  }
  if (promoteColDepth !== undefined) {
    nextTree = promoteAxisForDepth({
      tree: nextTree,
      axis: 'col',
      maxDepth: promoteColDepth,
      countDimDepth,
      isMetricTokenValue,
      allowMetricPromotion: allowMetricColPromotion,
    });
  }
  return nextTree;
};

export const hasAxisDepthCoverage = (
  nodes: Record<string, PivotTreeNode>,
  targetDepth: number,
  countDimDepth: (path: PivotTreeNode['path']) => number,
) => {
  if (targetDepth <= 0) {
    return true;
  }
  return Object.values(nodes).some(
    node => countDimDepth(node.path) >= targetDepth,
  );
};

export const resolveLayoutTransition = ({
  data,
  currentTree,
  previousLayout,
  currentLayout,
  sessionLayout,
  hasNewData,
  effectiveExpandRowsLevel,
  effectiveExpandColsLevel,
  countDimDepth,
  isMetricTokenValue,
  metricIndexForRows,
  metricIndexForCols,
  groupbyRowsLength,
  groupbyColumnsLength,
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
  const shouldUseCurrentTreeForLayoutProjection =
    layoutChanged &&
    !hasNewData &&
    !shouldFetchForDimensionAxisChange({
      prevRows: previousLayout.rows,
      prevCols: previousLayout.cols,
      nextRows: currentLayout.rows,
      nextCols: currentLayout.cols,
    });
  const projectionTree = mergeTrees(data, currentTree);
  const sourceTree = shouldUseCurrentTreeForLayoutProjection
    ? projectionTree
    : hasNewData || !layoutChanged
      ? data
      : currentTree;
  const canReuseExpandedRowData =
    shouldExpandRows &&
    hasAxisDepthCoverage(
      sourceTree.rows,
      currentLayout.rows.length,
      countDimDepth,
    );
  const canReuseExpandedColData =
    shouldExpandCols &&
    hasAxisDepthCoverage(
      sourceTree.cols,
      currentLayout.cols.length,
      countDimDepth,
    );
  const shouldPruneRowsForLayoutChange =
    rowsChanged && !hasNewData && !canReuseExpandedRowData;
  const shouldPruneColsForLayoutChange =
    colsChanged && !hasNewData && !canReuseExpandedColData;
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
    shouldPruneRowsForLayoutChange && shouldExpandRows && rowStablePrefix > 0
      ? Math.min(effectiveExpandRowsLevel, Math.max(rowStablePrefix - 1, 0))
      : effectiveExpandRowsLevel;
  const autoExpandColsLevelForDesired =
    shouldPruneColsForLayoutChange && shouldExpandCols && colStablePrefix > 0
      ? Math.min(effectiveExpandColsLevel, Math.max(colStablePrefix - 1, 0))
      : effectiveExpandColsLevel;
  const allowMetricRowPromotion =
    metricIndexForRows !== undefined && metricIndexForRows < groupbyRowsLength;
  const allowMetricColPromotion =
    metricIndexForCols !== undefined &&
    metricIndexForCols < groupbyColumnsLength;
  const baseTree =
    shouldPruneRowsForLayoutChange || shouldPruneColsForLayoutChange
      ? trimTreeForLayout({
          tree: sourceTree,
          trimRowDepth: shouldPruneRowsForLayoutChange
            ? rowStablePrefix
            : undefined,
          trimColDepth: shouldPruneColsForLayoutChange
            ? colStablePrefix
            : undefined,
          countDimDepth,
        })
      : sourceTree;
  const normalizedTree =
    shouldPruneRowsForLayoutChange || shouldPruneColsForLayoutChange
      ? promoteTreeForLayout({
          tree: baseTree,
          promoteRowDepth: shouldPruneRowsForLayoutChange
            ? currentLayout.rows.length
            : undefined,
          promoteColDepth: shouldPruneColsForLayoutChange
            ? currentLayout.cols.length
            : undefined,
          countDimDepth,
          isMetricTokenValue,
          allowMetricRowPromotion,
          allowMetricColPromotion,
        })
      : baseTree;
  const shouldCarryFetchedRowsForTrim =
    !hasNewData &&
    currentLayout.rows.length < previousLayout.rows.length &&
    isPrefix(currentLayout.rows, previousLayout.rows) &&
    rowStablePrefix > 0;
  const shouldCarryFetchedColsForTrim =
    !hasNewData &&
    currentLayout.cols.length < previousLayout.cols.length &&
    isPrefix(currentLayout.cols, previousLayout.cols) &&
    colStablePrefix > 0;

  return {
    rowsChanged,
    colsChanged,
    shouldExpandRows,
    shouldExpandCols,
    layoutChanged,
    shouldUseCurrentTreeForLayoutProjection,
    sourceTree,
    normalizedTree,
    shouldPruneRowsForLayoutChange,
    shouldPruneColsForLayoutChange,
    rowStablePrefix,
    colStablePrefix,
    autoExpandRowsLevelForDesired,
    autoExpandColsLevelForDesired,
    allowMetricRowPromotion,
    allowMetricColPromotion,
    shouldCarryFetchedRowsForTrim,
    shouldCarryFetchedColsForTrim,
  };
};
