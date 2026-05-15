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

import { PivotAxis, PivotTreeNode } from '../../../src/types';
import { planExpansionForAxis } from '../../../src/pivot/expansion/planner';
import { type PivotExpansionCoveragePredicate } from '../../../src/pivot/runtime/coverage';
import { serializePath } from '../../../src/pivot/core/path';
import { rootKey } from '../../../src/pivot/viewModel';

const makeNode = ({
  axis,
  path,
  hasChildren = false,
  label,
}: {
  axis: PivotAxis;
  path: PivotTreeNode['path'];
  hasChildren?: boolean;
  label?: string;
}): PivotTreeNode => ({
  axis,
  key: serializePath(path),
  path,
  label: label ?? String(path[path.length - 1] ?? 'Grand total'),
  formattedLabel: label ?? String(path[path.length - 1] ?? 'Grand total'),
  level: path.length,
  hasChildren,
  isSubtotal: false,
});

const sortKeys = (keys: Set<string>) => Array.from(keys).sort();

const expansionCoverageLoadedFromDepths =
  (depthByPathKey: Map<string, number>): PivotExpansionCoveragePredicate =>
  ({ axis, pathKey, rowDepth, columnDepth }) => {
    const fetchedDepth = depthByPathKey.get(pathKey);
    const requiredDepth = axis === 'row' ? columnDepth : rowDepth;
    return fetchedDepth !== undefined && fetchedDepth >= requiredDepth;
  };

const shouldFetchDimensionChildren = ({
  path,
}: {
  path: PivotTreeNode['path'];
}) => path.length < 2;

describe('expansionPlanner', () => {
  it('treats nodes as satisfied when fetched depth meets the requirement', () => {
    const keyA = serializePath(['A']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      [keyA]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(
        new Map([[keyA, 1]]),
      ),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(sortKeys(plan.fetchKeys)).toEqual([]);
    expect(sortKeys(plan.pendingKeys)).toEqual([]);
    expect(plan.hasMissingNodes).toBe(false);
  });

  it('trusts fetched coverage for semantically expandable nodes', () => {
    const keyA = serializePath(['A']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      [keyA]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(
        new Map([[keyA, 2]]),
      ),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(sortKeys(plan.fetchKeys)).toEqual([]);
    expect(sortKeys(plan.pendingKeys)).toEqual([]);
  });

  it('requires a fetch when the required depth increases', () => {
    const keyA = serializePath(['A']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      [keyA]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 2 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(
        new Map([[keyA, 1]]),
      ),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(sortKeys(plan.fetchKeys)).toEqual([keyA]);
    expect(sortKeys(plan.pendingKeys)).toEqual([keyA]);
  });

  it('treats nodes as pending when children are not loaded at depth zero', () => {
    const keyA = serializePath(['A']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      [keyA]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 0 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(new Map()),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(sortKeys(plan.fetchKeys)).toEqual([keyA]);
    expect(sortKeys(plan.pendingKeys)).toEqual([keyA]);
  });

  it('fetches missing keys when the nearest ancestor is satisfied', () => {
    const keyA = serializePath(['A']);
    const keyAB = serializePath(['A', 'B']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      [keyA]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(
        new Map([[keyA, 1]]),
      ),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(sortKeys(plan.fetchKeys)).toEqual([keyAB]);
    expect(sortKeys(plan.pendingKeys)).toEqual([keyAB]);
    expect(plan.hasMissingNodes).toBe(true);
  });

  it('fetches the ancestor when a missing key needs deeper data', () => {
    const keyA = serializePath(['A']);
    const keyAB = serializePath(['A', 'B']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      [keyA]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 2 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(
        new Map([[keyA, 1]]),
      ),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(sortKeys(plan.fetchKeys)).toEqual([keyA]);
    expect(sortKeys(plan.pendingKeys)).toEqual([keyA, keyAB]);
    expect(plan.hasMissingNodes).toBe(true);
  });

  it('updates planned fetches as expansion and depth evolve', () => {
    const keyA = serializePath(['A']);
    const keyAB = serializePath(['A', 'B']);
    const baseNodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      [keyA]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };
    const plan1 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA]),
      nodes: baseNodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(new Map()),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });
    expect(sortKeys(plan1.fetchKeys)).toEqual([keyA]);

    const fetchedDepth = new Map([[keyA, 1]]);
    const plan2 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA]),
      nodes: baseNodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      isExpansionCoverageLoaded:
        expansionCoverageLoadedFromDepths(fetchedDepth),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });
    expect(sortKeys(plan2.fetchKeys)).toEqual([]);

    const plan3 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes: baseNodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      isExpansionCoverageLoaded:
        expansionCoverageLoadedFromDepths(fetchedDepth),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });
    expect(sortKeys(plan3.fetchKeys)).toEqual([keyAB]);

    const plan4 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes: baseNodes,
      coverage: { rowDepth: 1, columnDepth: 2 },
      isExpansionCoverageLoaded:
        expansionCoverageLoadedFromDepths(fetchedDepth),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });
    expect(sortKeys(plan4.fetchKeys)).toEqual([keyA]);
    expect(sortKeys(plan4.pendingKeys)).toEqual([keyA, keyAB]);

    const nodesWithChild: Record<string, PivotTreeNode> = {
      ...baseNodes,
      [keyAB]: makeNode({ axis: 'row', path: ['A', 'B'] }),
    };
    const plan5 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes: nodesWithChild,
      coverage: { rowDepth: 1, columnDepth: 2 },
      isExpansionCoverageLoaded: expansionCoverageLoadedFromDepths(
        new Map([[keyA, 2]]),
      ),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });
    expect(sortKeys(plan5.fetchKeys)).toEqual([]);
  });
});
