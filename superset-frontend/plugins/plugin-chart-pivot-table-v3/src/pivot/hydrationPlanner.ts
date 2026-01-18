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

import { PivotAxis, PivotTreeNode } from '../types';
import { parsePath, serializePath } from '../utils';
import { rootKey } from './viewModel';

export type PivotHydrationPlan = {
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
}: {
  axis: PivotAxis;
  key: string;
  node: PivotTreeNode;
  requiredDepth: number;
  fetchedDepthByKey: Map<string, number>;
  hasLoadedChildren: (axis: PivotAxis, node: PivotTreeNode) => boolean;
}) => {
  if (!node.hasChildren) {
    return true;
  }
  if (requiredDepth === 0 && hasLoadedChildren(axis, node)) {
    return true;
  }
  const fetchedDepth = fetchedDepthByKey.get(key);
  if (fetchedDepth === requiredDepth) {
    return true;
  }
  // Children being present is not sufficient when `requiredDepth` represents the
  // visible opposite-axis depth (the branch might still be missing intersection
  // cells). Only consider it satisfied if we also have a recorded fetched depth
  // that meets/exceeds the current requirement.
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

export const planHydrationForAxis = ({
  axis,
  expandedKeys,
  nodes,
  requiredDepth,
  fetchedDepthByKey,
  hasLoadedChildren,
}: {
  axis: PivotAxis;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  requiredDepth: number;
  fetchedDepthByKey: Map<string, number>;
  hasLoadedChildren: (axis: PivotAxis, node: PivotTreeNode) => boolean;
}): PivotHydrationPlan => {
  const fetchKeys = new Set<string>();
  const pendingKeys = new Set<string>();
  let hasMissingNodes = false;

  Array.from(expandedKeys)
    .filter(key => key !== rootKey)
    .forEach(key => {
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
          })
        ) {
          return;
        }
        fetchKeys.add(key);
        pendingKeys.add(key);
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
        })
      ) {
        fetchKeys.add(key);
        pendingKeys.add(key);
        return;
      }
      fetchKeys.add(ancestorKey);
      pendingKeys.add(key);
    });

  return { fetchKeys, pendingKeys, hasMissingNodes };
};
