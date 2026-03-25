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

type ShouldSyncCommittedTreeFromPropsConfig = {
  isUserControlled: boolean;
  isDashboardContext: boolean;
  hasLocalSyncForCurrentDashboardQueryContext: boolean;
  hasPersistedInteractionFilters: boolean;
  runtimeLayoutMatchesCommitted: boolean;
  selectedFiltersMatchCommitted: boolean;
  propsTreeHasRequiredLeafSources: boolean;
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
  propsTreeHasRequiredLeafSources,
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
  if (!propsTreeHasRequiredLeafSources) {
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
