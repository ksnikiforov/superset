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
  type PivotRuntimeLayout,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  isSubtotalToken,
  serializeCellKey,
  serializePath,
} from '../../utils';

const countRuntimeDimensionDepth = (path: PivotTreeNode['path']) =>
  path.filter(
    part =>
      !isSubtotalToken(part) &&
      !decodeMetricKey(part) &&
      !decodeMeasureLeafId(part),
  ).length;

const hasAxisCoverage = (
  nodes: Record<string, PivotTreeNode>,
  requiredDepth: number,
) => {
  if (requiredDepth <= 0) {
    return true;
  }
  return Object.values(nodes).some(
    node => countRuntimeDimensionDepth(node.path) >= requiredDepth,
  );
};

const hasNonRootNodes = (nodes: Record<string, PivotTreeNode>) =>
  Object.values(nodes).some(node => node.path.length > 0);

const valueAxisKeys = (layout: PivotRuntimeLayout) =>
  layout.valuePlacement.axis === 'row' ? layout.rows : layout.cols;

const treeHasCellAtRuntimeDepth = (
  tree: PivotTreeData,
  runtimeLayout: PivotRuntimeLayout,
) =>
  Object.values(tree.cells).some(cell => {
    const rowNode = tree.rows[cell.rowKey];
    const colNode = tree.cols[cell.colKey];
    if (!rowNode || !colNode) {
      return false;
    }
    return (
      countRuntimeDimensionDepth(rowNode.path) === runtimeLayout.rows.length &&
      countRuntimeDimensionDepth(colNode.path) === runtimeLayout.cols.length
    );
  });

const projectPathToRuntimeDepth = (
  path: PivotTreeNode['path'],
  targetDepth: number,
) => {
  const projected: PivotTreeNode['path'] = [];
  let seenRuntimeDepth = 0;
  let removedRuntimePart = false;

  path.forEach(part => {
    const metricKey = decodeMetricKey(part);
    const measureLeafId = decodeMeasureLeafId(part);
    if (metricKey || measureLeafId) {
      projected.push(part);
      return;
    }
    if (isSubtotalToken(part)) {
      if (!removedRuntimePart) {
        projected.push(part);
      }
      return;
    }
    seenRuntimeDepth += 1;
    if (seenRuntimeDepth <= targetDepth) {
      projected.push(part);
    } else {
      removedRuntimePart = true;
    }
  });

  return projected;
};

const collectProjectedCellKeysFromRuntimeDepth = ({
  tree,
  prev,
  next,
}: {
  tree: PivotTreeData;
  prev: PivotRuntimeLayout;
  next: PivotRuntimeLayout;
}) => {
  const projectedKeys = new Set<string>();
  Object.values(tree.cells).forEach(cell => {
    const rowNode = tree.rows[cell.rowKey];
    const colNode = tree.cols[cell.colKey];
    if (!rowNode || !colNode) {
      return;
    }
    if (
      countRuntimeDimensionDepth(rowNode.path) !== prev.rows.length ||
      countRuntimeDimensionDepth(colNode.path) !== prev.cols.length
    ) {
      return;
    }
    projectedKeys.add(
      serializeCellKey(
        serializePath(
          projectPathToRuntimeDepth(rowNode.path, next.rows.length),
        ),
        serializePath(
          projectPathToRuntimeDepth(colNode.path, next.cols.length),
        ),
      ),
    );
  });
  return projectedKeys;
};

export const treeHasRuntimeLayoutCoverage = (
  tree: PivotTreeData,
  runtimeLayout: PivotRuntimeLayout,
) => {
  const requiredRowDepth = runtimeLayout.rows.length > 0 ? 1 : 0;
  const requiredColDepth = runtimeLayout.cols.length > 0 ? 1 : 0;
  return (
    hasAxisCoverage(tree.rows, requiredRowDepth) &&
    hasAxisCoverage(tree.cols, requiredColDepth)
  );
};

export const treeHasStaleCoverageRegression = (
  tree: PivotTreeData,
  runtimeLayout: PivotRuntimeLayout,
) => {
  const requiresRows = runtimeLayout.rows.length > 0;
  const requiresCols = runtimeLayout.cols.length > 0;
  const hasRowCoverage = hasAxisCoverage(tree.rows, requiresRows ? 1 : 0);
  const hasColCoverage = hasAxisCoverage(tree.cols, requiresCols ? 1 : 0);
  if (hasRowCoverage && hasColCoverage) {
    return false;
  }
  const hasRowNodes = hasNonRootNodes(tree.rows);
  const hasColNodes = hasNonRootNodes(tree.cols);
  if (!hasRowNodes && !hasColNodes) {
    return false;
  }
  return (
    (requiresRows && !hasRowCoverage && hasColNodes) ||
    (requiresCols && !hasColCoverage && hasRowNodes)
  );
};

export const canProjectValueAxisShrinkWithoutFetch = ({
  tree,
  prev,
  next,
}: {
  tree: PivotTreeData;
  prev: PivotRuntimeLayout;
  next: PivotRuntimeLayout;
}) => {
  if (Object.keys(tree.cells).length === 0) {
    return true;
  }
  if (prev.valuePlacement.axis !== next.valuePlacement.axis) {
    return true;
  }
  const prevValueAxis = valueAxisKeys(prev);
  const nextValueAxis = valueAxisKeys(next);
  if (nextValueAxis.length >= prevValueAxis.length) {
    return true;
  }
  if (next.metrics.length > 1 && nextValueAxis.length === 0) {
    return false;
  }
  const projectedCellKeys = collectProjectedCellKeysFromRuntimeDepth({
    tree,
    prev,
    next,
  });
  if (projectedCellKeys.size === 0) {
    return treeHasCellAtRuntimeDepth(tree, next);
  }
  return Array.from(projectedCellKeys).every(cellKey => !!tree.cells[cellKey]);
};

type ShouldSyncCommittedTreeFromPropsConfig = {
  isUserControlled: boolean;
  isDashboardContext: boolean;
  hasLocalSyncForCurrentDashboardQueryContext: boolean;
  hasPersistedInteractionFilters: boolean;
  runtimeLayoutMatchesCommitted: boolean;
  selectedFiltersMatchCommitted: boolean;
  committedTreeHasRuntimeLayoutCoverage: boolean;
  propsTreeHasStaleCoverageRegression: boolean;
};

export const shouldSyncCommittedTreeFromProps = ({
  isUserControlled,
  isDashboardContext,
  hasLocalSyncForCurrentDashboardQueryContext,
  hasPersistedInteractionFilters,
  runtimeLayoutMatchesCommitted,
  selectedFiltersMatchCommitted,
  committedTreeHasRuntimeLayoutCoverage,
  propsTreeHasStaleCoverageRegression,
}: ShouldSyncCommittedTreeFromPropsConfig) => {
  if (!isUserControlled) {
    return true;
  }
  if (isDashboardContext && hasLocalSyncForCurrentDashboardQueryContext) {
    return false;
  }
  if (hasPersistedInteractionFilters) {
    return false;
  }
  if (!runtimeLayoutMatchesCommitted) {
    return false;
  }
  if (!selectedFiltersMatchCommitted) {
    return false;
  }
  if (
    isDashboardContext &&
    committedTreeHasRuntimeLayoutCoverage &&
    propsTreeHasStaleCoverageRegression
  ) {
    return false;
  }
  return true;
};
