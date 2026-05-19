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
  type PivotAxis,
  type PivotPathValue,
  type PivotTreeNode,
} from '../../types';
import { parsePath } from '../core/path';
import {
  type PivotExpansionCoverageDiff,
  type PivotExpansionCoverageRequest,
} from '../runtime/coverage';
import {
  buildAxisCoverageKeyFromPathKey,
  canRequestAxisExpansion,
} from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';
import { rootKey } from '../viewModel';

export type FetchTarget = {
  axis: PivotAxis;
  pathKey: string;
};

export type BatchCandidate = FetchTarget & {
  batchSignature: string;
};

export type BatchGroup = {
  axis: PivotAxis;
  signature: string;
  parentPathKey: string;
  siblingValues: PivotPathValue[];
  targets: BatchCandidate[];
};

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
  targets: FetchTarget[];
  hasMissingNodes: boolean;
};

type PivotExpansionCoverageDepths = Pick<
  PivotExpansionCoverageRequest,
  'rowDepth' | 'columnDepth'
>;

const requestKey = ({
  axis,
  pathKey,
  rowDepth,
  columnDepth,
}: PivotExpansionCoverageRequest) =>
  `${axis}|${pathKey}|${rowDepth}|${columnDepth}`;

const coverageKeyForPathKey = (
  program: PivotProgram,
  axis: PivotAxis,
  key: string,
) => buildAxisCoverageKeyFromPathKey({ program, axis, key });

const pathStartsWith = (
  path: PivotTreeNode['path'],
  prefix: PivotTreeNode['path'],
) =>
  prefix.length <= path.length &&
  prefix.every((value, index) => path[index] === value);

const buildGroupedFetchTargets = ({
  axis,
  program,
  requests,
  nodes,
}: {
  axis: PivotAxis;
  program: PivotProgram;
  requests: PivotExpansionCoverageRequest[];
  nodes: Record<string, PivotTreeNode>;
}): FetchTarget[] => {
  const groups = new Map<string, string[]>();
  requests.forEach(({ pathKey }) => {
    const groupKey = coverageKeyForPathKey(program, axis, pathKey);
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
      keys.find(
        key => coverageKeyForPathKey(program, axis, key) === key && nodes[key],
      ) ??
      keys.find(key => nodes[key]) ??
      keys[0];

    targets.push({
      axis,
      pathKey: representative,
    });
  }

  return targets;
};

export const planExpansionForAxis = ({
  axis,
  program,
  expandedKeys,
  nodes,
  coverage,
  getMissingExpansionCoverage,
}: {
  axis: PivotAxis;
  program: PivotProgram;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  coverage: PivotExpansionCoverageDepths;
  getMissingExpansionCoverage: PivotExpansionCoverageDiff;
}): PivotExpansionPlan => {
  const fetchRequests = new Map<string, PivotExpansionCoverageRequest>();
  let hasMissingNodes = false;
  const hasNonRootExpanded =
    expandedKeys.size > 1 ||
    (expandedKeys.size === 1 && !expandedKeys.has(rootKey));

  const candidates = Array.from(expandedKeys)
    .filter(key => key !== rootKey || !hasNonRootExpanded)
    .map(key => {
      const node = nodes[key];
      const path = node?.path ?? parsePath(key);
      return { key, node, path };
    })
    .filter(({ path }) => canRequestAxisExpansion({ program, axis, path }));
  const buildRequest = (key: string): PivotExpansionCoverageRequest => ({
    axis,
    pathKey: key,
    ...coverage,
  });
  const candidateRequests = candidates.map(({ key }) => buildRequest(key));
  const missingRequestKeys = new Set(
    getMissingExpansionCoverage(candidateRequests).map(requestKey),
  );

  candidates.forEach(({ key, node }) => {
    const request = buildRequest(key);
    const keyForRequest = requestKey(request);
    if (!missingRequestKeys.has(keyForRequest)) {
      return;
    }
    hasMissingNodes ||= !node;
    fetchRequests.set(keyForRequest, request);
  });

  const rootRequest = buildRequest(rootKey);
  if (fetchRequests.size > 1 && fetchRequests.has(requestKey(rootRequest))) {
    fetchRequests.delete(requestKey(rootRequest));
  }
  const pendingRequests = Array.from(fetchRequests.values()).map(request => ({
    request,
    path: parsePath(request.pathKey),
  }));
  pendingRequests.forEach(({ request, path }) => {
    const axisDepth =
      request.axis === 'row' ? request.rowDepth : request.columnDepth;
    const hasAncestorRequest = pendingRequests.some(
      ({ request: ancestorRequest, path: ancestorPath }) =>
        ancestorRequest.pathKey !== request.pathKey &&
        ancestorPath.length > 0 &&
        ancestorPath.length < path.length &&
        pathStartsWith(path, ancestorPath),
    );
    if (hasAncestorRequest && path.length > axisDepth) {
      fetchRequests.delete(requestKey(request));
    }
  });

  return {
    targets: buildGroupedFetchTargets({
      axis,
      program,
      requests: Array.from(fetchRequests.values()),
      nodes,
    }),
    hasMissingNodes,
  };
};
