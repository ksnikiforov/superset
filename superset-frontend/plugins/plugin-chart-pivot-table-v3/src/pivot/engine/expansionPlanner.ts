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

export type PivotExpansionCoverageProjection = {
  axis: PivotAxis;
  pathKey: string;
  requiredOppositeDepth: number;
};

export type PivotExpansionFetchedCoverageLookup = {
  getFetchedDepth: (
    projection: PivotExpansionCoverageProjection,
  ) => number | undefined;
  isSameFetchedCoverage: (
    left: PivotExpansionCoverageProjection,
    right: PivotExpansionCoverageProjection,
  ) => boolean;
};

export type PivotExpansionNodeFetchPredicate = (input: {
  axis: PivotAxis;
  key: string;
  node: PivotTreeNode;
  requiredDepth: number;
}) => boolean;

const buildCoverageProjection = (
  axis: PivotAxis,
  pathKey: string,
  requiredOppositeDepth: number,
): PivotExpansionCoverageProjection => ({
  axis,
  pathKey,
  requiredOppositeDepth,
});

const isSatisfiedNode = ({
  axis,
  key,
  node,
  requiredDepth,
  fetchedCoverageLookup,
  shouldFetchChildren,
}: {
  axis: PivotAxis;
  key: string;
  node: PivotTreeNode;
  requiredDepth: number;
  fetchedCoverageLookup: PivotExpansionFetchedCoverageLookup;
  shouldFetchChildren: PivotExpansionNodeFetchPredicate;
}) => {
  if (!shouldFetchChildren({ axis, key, node, requiredDepth })) {
    return true;
  }
  const fetchedDepth = fetchedCoverageLookup.getFetchedDepth(
    buildCoverageProjection(axis, key, requiredDepth),
  );
  if (fetchedDepth !== undefined && fetchedDepth >= requiredDepth) {
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
  fetchedCoverageLookup,
  shouldFetchChildren,
}: {
  axis: PivotAxis;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  requiredDepth: number;
  fetchedCoverageLookup: PivotExpansionFetchedCoverageLookup;
  shouldFetchChildren: PivotExpansionNodeFetchPredicate;
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
          fetchedCoverageLookup,
          shouldFetchChildren,
        })
      ) {
        return;
      }
      fetchKeys.add(key);
      pendingKeys.add(key);
      return;
    }

    const missingCoverage = buildCoverageProjection(axis, key, requiredDepth);
    const fetchedDepth = fetchedCoverageLookup.getFetchedDepth(missingCoverage);
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
        fetchedCoverageLookup,
        shouldFetchChildren,
      })
    ) {
      if (
        fetchedCoverageLookup.isSameFetchedCoverage(
          missingCoverage,
          buildCoverageProjection(axis, ancestorKey, requiredDepth),
        )
      ) {
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
