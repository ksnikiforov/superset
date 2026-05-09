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
import { parsePath } from '../../utils';
import {
  planExpansionForAxis,
  type PivotExpansionNodeFetchPredicate,
  type PivotExpansionPlan,
} from '../engine/expansionPlanner';
import { type FetchTarget } from '../query/fetchPlanOptimizer';
import {
  createFetchedFactCoverageLookup,
  type FetchedFactCoverageState,
} from './fetchedRequests';

export type PlannedFetchTarget = FetchTarget & {
  id: string;
};

export function buildGroupedFetchTargets({
  axis,
  fetchKeys,
  nodes,
  requiredOppositeDepth,
  getCoverageKey,
}: {
  axis: PivotAxis;
  fetchKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  requiredOppositeDepth: number;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
}): {
  targets: PlannedFetchTarget[];
} {
  const groups = new Map<string, string[]>();
  fetchKeys.forEach(key => {
    const groupKey = getCoverageKey(axis, key);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(key);
    } else {
      groups.set(groupKey, [key]);
    }
  });

  const targets: PlannedFetchTarget[] = [];

  for (const keys of groups.values()) {
    const representative =
      keys.find(key => getCoverageKey(axis, key) === key && nodes[key]) ??
      keys.find(key => nodes[key]) ??
      keys[0];

    const childDepth = parsePath(representative).length + 1;
    targets.push({
      id: JSON.stringify([
        axis,
        representative,
        childDepth,
        requiredOppositeDepth,
      ]),
      axis,
      pathKey: representative,
      childDepth,
      requiredOppositeDepth,
    });
  }

  return { targets };
}

export const planGroupedExpansionTargets = ({
  axis,
  expandedKeys,
  nodes,
  requiredOppositeDepth,
  fetchedCoverage,
  getCoverageKey,
  shouldFetchChildren,
}: {
  axis: PivotAxis;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  requiredOppositeDepth: number;
  fetchedCoverage: FetchedFactCoverageState;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
  shouldFetchChildren: PivotExpansionNodeFetchPredicate;
}): {
  plan: PivotExpansionPlan;
  targets: PlannedFetchTarget[];
} => {
  const fetchedCoverageLookup = createFetchedFactCoverageLookup({
    fetchedCoverage,
    getCoverageKey,
  });
  const plan = planExpansionForAxis({
    axis,
    expandedKeys,
    nodes,
    requiredDepth: requiredOppositeDepth,
    fetchedCoverageLookup,
    shouldFetchChildren,
  });

  const grouped = buildGroupedFetchTargets({
    axis,
    fetchKeys: plan.fetchKeys,
    nodes,
    requiredOppositeDepth,
    getCoverageKey,
  });

  return { plan, targets: grouped.targets };
};
