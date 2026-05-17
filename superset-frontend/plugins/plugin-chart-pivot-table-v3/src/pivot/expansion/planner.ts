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

import { type PivotAxis, type PivotTreeNode } from '../../types';
import { parsePath, serializePath } from '../core/path';
import { isSubtotalToken } from '../core/tokens';
import { type FetchTarget } from '../query/fetchPlanOptimizer';
import {
  type PivotExpansionCoverageDiff,
  type PivotExpansionCoverageRequest,
} from '../runtime/coverage';
import { rootKey } from '../viewModel';

export type AxisFetchTarget = FetchTarget;

export type IntersectionFetchTarget = {
  kind: 'intersection';
  rowPathKeys: string[];
  columnPathKeys: string[];
};

export type ExpansionFetchTarget = AxisFetchTarget | IntersectionFetchTarget;

export const isIntersectionFetchTarget = (
  target: ExpansionFetchTarget,
): target is IntersectionFetchTarget => 'kind' in target;

export type PivotExpansionPlan = {
  fetchRequests: PivotExpansionCoverageRequest[];
  pendingKeys: Set<string>;
  hasMissingNodes: boolean;
};

export type PivotExpansionNodeFetchPredicate = (input: {
  axis: PivotAxis;
  key: string;
  path: PivotTreeNode['path'];
}) => boolean;

type PivotExpansionCoverageDepths = Pick<
  PivotExpansionCoverageRequest,
  'rowDepth' | 'columnDepth'
>;

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

const requestKey = ({
  axis,
  pathKey,
  rowDepth,
  columnDepth,
}: PivotExpansionCoverageRequest) =>
  `${axis}|${pathKey}|${rowDepth}|${columnDepth}`;

const isSubtotalPath = (path: PivotTreeNode['path']) =>
  path.some(isSubtotalToken);

export const planExpansionForAxis = ({
  axis,
  expandedKeys,
  nodes,
  coverage,
  getMissingExpansionCoverage,
  getCoverageKey,
  shouldFetchChildren,
}: {
  axis: PivotAxis;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  coverage: PivotExpansionCoverageDepths;
  getMissingExpansionCoverage: PivotExpansionCoverageDiff;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
  shouldFetchChildren: PivotExpansionNodeFetchPredicate;
}): PivotExpansionPlan => {
  const fetchRequests = new Map<string, PivotExpansionCoverageRequest>();
  const pendingKeys = new Set<string>();
  let hasMissingNodes = false;
  const hasNonRootExpanded =
    expandedKeys.size > 1 ||
    (expandedKeys.size === 1 && !expandedKeys.has(rootKey));

  const candidates = Array.from(expandedKeys)
    .filter(key => key !== rootKey || !hasNonRootExpanded)
    .map(key => ({ key, node: nodes[key] }))
    .filter(({ key, node }) => !isSubtotalPath(node?.path ?? parsePath(key)));
  const buildRequest = (key: string): PivotExpansionCoverageRequest => ({
    axis,
    pathKey: key,
    ...coverage,
  });
  const candidateRequests = new Map<string, PivotExpansionCoverageRequest>();
  const addRequest = (key: string) => {
    const request = buildRequest(key);
    candidateRequests.set(requestKey(request), request);
  };
  const addFetchRequest = (key: string) => {
    const request = buildRequest(key);
    fetchRequests.set(requestKey(request), request);
  };
  candidates.forEach(({ key, node }) => {
    if (node) {
      if (shouldFetchChildren({ axis, key, path: node.path })) {
        addRequest(key);
      }
      return;
    }
    addRequest(key);
    const ancestorKey = resolveNearestPresentAncestorKey(nodes, key);
    const ancestor = nodes[ancestorKey];
    if (
      ancestor &&
      getCoverageKey(axis, key) !== getCoverageKey(axis, ancestorKey) &&
      shouldFetchChildren({ axis, key: ancestorKey, path: ancestor.path })
    ) {
      addRequest(ancestorKey);
    }
  });
  const missingRequestKeys = new Set(
    getMissingExpansionCoverage(Array.from(candidateRequests.values())).map(
      requestKey,
    ),
  );

  candidates.forEach(({ key, node }) => {
    if (node) {
      if (!missingRequestKeys.has(requestKey(buildRequest(key)))) {
        return;
      }
      addFetchRequest(key);
      pendingKeys.add(key);
      return;
    }

    if (!missingRequestKeys.has(requestKey(buildRequest(key)))) {
      return;
    }
    hasMissingNodes = true;
    const ancestorKey = resolveNearestPresentAncestorKey(nodes, key);
    const ancestor = nodes[ancestorKey];
    if (!ancestor) {
      return;
    }
    const ancestorRequest = buildRequest(ancestorKey);
    if (
      !shouldFetchChildren({ axis, key: ancestorKey, path: ancestor.path }) ||
      !missingRequestKeys.has(requestKey(ancestorRequest))
    ) {
      if (getCoverageKey(axis, key) === getCoverageKey(axis, ancestorKey)) {
        return;
      }
      addFetchRequest(key);
      pendingKeys.add(key);
      return;
    }
    addFetchRequest(ancestorKey);
    pendingKeys.add(key);
  });

  const rootRequest = buildRequest(rootKey);
  if (fetchRequests.size > 1 && fetchRequests.has(requestKey(rootRequest))) {
    fetchRequests.delete(requestKey(rootRequest));
    pendingKeys.delete(rootKey);
  }

  return {
    fetchRequests: Array.from(fetchRequests.values()),
    pendingKeys,
    hasMissingNodes,
  };
};

export function buildGroupedFetchTargets({
  axis,
  requests,
  nodes,
  getCoverageKey,
}: {
  axis: PivotAxis;
  requests: PivotExpansionCoverageRequest[];
  nodes: Record<string, PivotTreeNode>;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
}): FetchTarget[] {
  const groups = new Map<string, string[]>();
  requests.forEach(({ pathKey }) => {
    const groupKey = getCoverageKey(axis, pathKey);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(pathKey);
    } else {
      groups.set(groupKey, [pathKey]);
    }
  });

  const targets: FetchTarget[] = [];

  for (const keys of groups.values()) {
    const representative =
      keys.find(key => getCoverageKey(axis, key) === key && nodes[key]) ??
      keys.find(key => nodes[key]) ??
      keys[0];

    targets.push({
      axis,
      pathKey: representative,
    });
  }

  return targets;
}
