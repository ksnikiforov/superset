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
import {
  buildAxisExpansionCoverageTarget,
  planExpansionForAxis,
} from '../../../src/pivot/expansion/planner';
import { serializePath } from '../../../src/pivot/core/path';
import { rootKey } from '../../../src/pivot/viewModel';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';
import { type PivotFactSelector } from '../../../src/pivot/runtime/factStore';

const testProgram = compilePivotProgram({
  groupbyRows: ['country', 'state', 'city'],
  groupbyColumns: ['month', 'day'],
  metrics: ['sales'],
});

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

const sortFetchPathKeys = (plan: ReturnType<typeof planExpansionForAxis>) =>
  plan.map(target => target.pathKey).sort();

const factSelectorsFromFetchedColumnDepths = (
  depthByPathKey: Map<string, number>,
): PivotFactSelector[] =>
  Array.from(depthByPathKey.entries()).flatMap(([pathKey, columnDepth]) =>
    Array.from({ length: columnDepth }, (_, index) => index + 1).map(depth => {
      const target = buildAxisExpansionCoverageTarget({
        axis: 'row',
        pathKey,
        program: testProgram,
        rowDepth: 1,
        columnDepth: depth,
      });
      return {
        coverage: {
          rowDepth: target.need.rowDepth,
          columnDepth: target.need.columnDepth,
          rowDimensions: target.need.rowDimensions,
          columnDimensions: target.need.columnDimensions,
        },
        scope: {
          kind: 'axisPaths',
          axis: 'row',
          paths:
            target.need.rowScope.kind === 'paths'
              ? target.need.rowScope.paths
              : [],
        },
        valueKeys: target.need.valueKeys,
      };
    }),
  );

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
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map([[keyA, 1]])),
      program: testProgram,
    });

    expect(sortFetchPathKeys(plan)).toEqual([]);
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
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map([[keyA, 2]])),
      program: testProgram,
    });

    expect(sortFetchPathKeys(plan)).toEqual([]);
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
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map([[keyA, 1]])),
      program: testProgram,
    });

    expect(sortFetchPathKeys(plan)).toEqual([keyA]);
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
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map()),
      program: testProgram,
    });

    expect(sortFetchPathKeys(plan)).toEqual([keyA]);
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
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map([[keyA, 1]])),
      program: testProgram,
    });

    expect(sortFetchPathKeys(plan)).toEqual([keyAB]);
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
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map([[keyA, 1]])),
      program: testProgram,
    });

    expect(sortFetchPathKeys(plan)).toEqual([keyA]);
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
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map()),
      program: testProgram,
    });
    expect(sortFetchPathKeys(plan1)).toEqual([keyA]);

    const fetchedDepth = new Map([[keyA, 1]]);
    const plan2 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA]),
      nodes: baseNodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      factSelectors: factSelectorsFromFetchedColumnDepths(fetchedDepth),
      program: testProgram,
    });
    expect(sortFetchPathKeys(plan2)).toEqual([]);

    const plan3 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes: baseNodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      factSelectors: factSelectorsFromFetchedColumnDepths(fetchedDepth),
      program: testProgram,
    });
    expect(sortFetchPathKeys(plan3)).toEqual([keyAB]);

    const plan4 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes: baseNodes,
      coverage: { rowDepth: 1, columnDepth: 2 },
      factSelectors: factSelectorsFromFetchedColumnDepths(fetchedDepth),
      program: testProgram,
    });
    expect(sortFetchPathKeys(plan4)).toEqual([keyA]);

    const nodesWithChild: Record<string, PivotTreeNode> = {
      ...baseNodes,
      [keyAB]: makeNode({ axis: 'row', path: ['A', 'B'] }),
    };
    const plan5 = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, keyA, keyAB]),
      nodes: nodesWithChild,
      coverage: { rowDepth: 1, columnDepth: 2 },
      factSelectors: factSelectorsFromFetchedColumnDepths(new Map([[keyA, 2]])),
      program: testProgram,
    });
    expect(sortFetchPathKeys(plan5)).toEqual([keyAB]);
  });
});
