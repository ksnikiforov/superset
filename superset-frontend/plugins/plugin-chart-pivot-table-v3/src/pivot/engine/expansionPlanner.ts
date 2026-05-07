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

import { PivotAxis, PivotTreeNode } from '../../types';
import { parsePath, serializePath } from '../../utils';
import { rootKey } from '../viewModel';

export type PivotExpansionPlan = {
  fetchKeys: Set<string>;
  pendingKeys: Set<string>;
  hasMissingNodes: boolean;
};

const isSatisfiedNode = ({
  axis,
  key,
  node,
  requiredDepth,
  fetchedDepthByKey,
  hasLoadedChildren,
  getCoverageKey,
}: {
  axis: PivotAxis;
  key: string;
  node: PivotTreeNode;
  requiredDepth: number;
  fetchedDepthByKey: Map<string, number>;
  hasLoadedChildren: (axis: PivotAxis, node: PivotTreeNode) => boolean;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
}) => {
  if (!node.hasChildren) {
    return true;
  }
  if (key === rootKey && hasLoadedChildren(axis, node)) {
    return true;
  }
  if (requiredDepth === 0 && hasLoadedChildren(axis, node)) {
    return true;
  }
  const fetchedDepth = fetchedDepthByKey.get(getCoverageKey(axis, key));
  if (fetchedDepth === requiredDepth) {
    return true;
  }
  if (
    fetchedDepth !== undefined &&
    fetchedDepth >= requiredDepth &&
    hasLoadedChildren(axis, node)
  ) {
    return true;
  }
  return false;
};

const resolveNearestPresentAncestorKey = (
  nodes: Record<string, PivotTreeNode>,
  key: string,
) => {
  const path = parsePath(key);
  for (let prefixLength = path.length; prefixLength >= 0; prefixLength -= 1) {
    const candidate = serializePath(path.slice(0, prefixLength));
    if (candidate === key) {
      continue;
    }
    if (nodes[candidate]) {
      return candidate;
    }
  }
  return rootKey;
};

export const planExpansionForAxis = ({
  axis,
  expandedKeys,
  nodes,
  requiredDepth,
  fetchedDepthByKey,
  hasLoadedChildren,
  getCoverageKey = (_axis, key) => key,
}: {
  axis: PivotAxis;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  requiredDepth: number;
  fetchedDepthByKey: Map<string, number>;
  hasLoadedChildren: (axis: PivotAxis, node: PivotTreeNode) => boolean;
  getCoverageKey?: (axis: PivotAxis, key: string) => string;
}): PivotExpansionPlan => {
  const fetchKeys = new Set<string>();
  const pendingKeys = new Set<string>();
  let hasMissingNodes = false;
  const hasNonRootExpanded =
    expandedKeys.size > 1 ||
    (expandedKeys.size === 1 && !expandedKeys.has(rootKey));

  Array.from(expandedKeys).forEach(key => {
    if (key === rootKey && hasNonRootExpanded) {
      return;
    }
    const node = nodes[key];
    if (node) {
      if (
        isSatisfiedNode({
          axis,
          key,
          node,
          requiredDepth,
          fetchedDepthByKey,
          hasLoadedChildren,
          getCoverageKey,
        })
      ) {
        return;
      }
      fetchKeys.add(key);
      pendingKeys.add(key);
      return;
    }

    const missingCoverageKey = getCoverageKey(axis, key);
    const fetchedDepth = fetchedDepthByKey.get(missingCoverageKey);
    if (fetchedDepth !== undefined && fetchedDepth >= requiredDepth) {
      return;
    }
    hasMissingNodes = true;
    const ancestorKey = resolveNearestPresentAncestorKey(nodes, key);
    const ancestor = nodes[ancestorKey];
    if (!ancestor) {
      return;
    }
    if (
      isSatisfiedNode({
        axis,
        key: ancestorKey,
        node: ancestor,
        requiredDepth,
        fetchedDepthByKey,
        hasLoadedChildren,
        getCoverageKey,
      })
    ) {
      if (missingCoverageKey === getCoverageKey(axis, ancestorKey)) {
        return;
      }
      fetchKeys.add(key);
      pendingKeys.add(key);
      return;
    }
    fetchKeys.add(ancestorKey);
    pendingKeys.add(key);
  });

  if (fetchKeys.size > 1 && fetchKeys.has(rootKey)) {
    fetchKeys.delete(rootKey);
    pendingKeys.delete(rootKey);
  }

  return { fetchKeys, pendingKeys, hasMissingNodes };
};
