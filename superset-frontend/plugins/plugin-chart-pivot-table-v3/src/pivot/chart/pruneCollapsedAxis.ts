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
import { findChildren } from '../viewModel';

const expectedMetricsLayoutForAxis = (axis: PivotAxis) =>
  axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;

const getAxisNodes = (tree: PivotTreeData, axis: PivotAxis) =>
  axis === 'row' ? tree.rows : tree.cols;

const isDescendantPath = (
  prefix: PivotTreeNode['path'],
  path: PivotTreeNode['path'],
) => prefix.every((val, idx) => val === path[idx]);

const removeAxisKeys = ({
  tree,
  axis,
  removedKeys,
}: {
  tree: PivotTreeData;
  axis: PivotAxis;
  removedKeys: Set<string>;
}) => {
  if (removedKeys.size === 0) {
    return tree;
  }
  const nextNodes = { ...getAxisNodes(tree, axis) };
  removedKeys.forEach(key => {
    delete nextNodes[key];
  });
  const nextCells: PivotTreeData['cells'] = {};
  Object.entries(tree.cells).forEach(([key, cell]) => {
    const cellAxisKey = axis === 'row' ? cell.rowKey : cell.colKey;
    if (removedKeys.has(cellAxisKey)) {
      return;
    }
    nextCells[key] = cell;
  });
  return axis === 'row'
    ? { ...tree, rows: nextNodes, cells: nextCells }
    : { ...tree, cols: nextNodes, cells: nextCells };
};

export const pruneStaleCollapsedAxis = ({
  currentTree,
  axis,
  parent,
  branch,
  resolvedMetricsLayout,
  metricIndex,
  preserveMetricAtParentLevel = false,
  isMetricTokenValue,
  isExplicitSubtotalNode,
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
}: {
  currentTree: PivotTreeData;
  axis: PivotAxis;
  parent: PivotTreeNode;
  branch?: PivotTreeData;
  resolvedMetricsLayout: MetricsLayoutEnum;
  metricIndex?: number;
  preserveMetricAtParentLevel?: boolean;
  isMetricTokenValue: (value: unknown) => boolean;
  isExplicitSubtotalNode: (node: PivotTreeNode) => boolean;
  isMetricGrandTotalNode: (node: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node: PivotTreeNode) => boolean;
}) => {
  if (!branch) {
    return currentTree;
  }
  if (resolvedMetricsLayout !== expectedMetricsLayoutForAxis(axis)) {
    return currentTree;
  }
  if (metricIndex === undefined) {
    return currentTree;
  }
  if (metricIndex <= parent.level) {
    return currentTree;
  }
  if (parent.path.some(val => isMetricTokenValue(val))) {
    return currentTree;
  }
  const branchParent = getAxisNodes(branch, axis)[parent.key];
  if (!branchParent) {
    return currentTree;
  }
  const branchChildren = findChildren(getAxisNodes(branch, axis), branchParent);
  if (branchChildren.length === 0) {
    return currentTree;
  }
  const validChildKeys = new Set(branchChildren.map(child => child.key));
  const removedPrefixes: PivotTreeNode['path'][] = [];
  Object.values(getAxisNodes(currentTree, axis)).forEach(node => {
    if (node.path.length !== parent.path.length + 1) {
      return;
    }
    if (!isDescendantPath(parent.path, node.path)) {
      return;
    }
    if (validChildKeys.has(node.key)) {
      return;
    }
    if (
      preserveMetricAtParentLevel &&
      isMetricTokenValue(node.path[parent.level])
    ) {
      return;
    }
    if (
      isExplicitSubtotalNode(node) ||
      isMetricGrandTotalNode(node) ||
      isMetricSubtotalNode(node)
    ) {
      return;
    }
    removedPrefixes.push(node.path);
  });
  if (removedPrefixes.length === 0) {
    return currentTree;
  }
  const removedKeys = new Set<string>();
  Object.values(getAxisNodes(currentTree, axis)).forEach(node => {
    if (removedPrefixes.some(prefix => isDescendantPath(prefix, node.path))) {
      removedKeys.add(node.key);
    }
  });
  return removeAxisKeys({ tree: currentTree, axis, removedKeys });
};
