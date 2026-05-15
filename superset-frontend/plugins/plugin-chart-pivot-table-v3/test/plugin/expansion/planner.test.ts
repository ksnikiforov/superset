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

import { planGroupedExpansionTargets } from '../../../src/pivot/expansion/planner';
import {
  createFetchedFactCoverageLookup,
  projectFactRequestToFetchedCoverage,
} from '../../../src/pivot/expansion/fetchedRequests';
import { rootKey } from '../../../src/pivot/viewModel';
import { encodeMetricKey } from '../../../src/pivot/core/tokens';
import { serializePath } from '../../../src/pivot/core/path';
import { type PivotTreeNode } from '../../../src/types';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';

const makeNode = ({
  axis,
  path,
  hasChildren = true,
}: {
  axis: PivotTreeNode['axis'];
  path: PivotTreeNode['path'];
  hasChildren?: boolean;
}): PivotTreeNode => {
  const key = path.length === 0 ? rootKey : serializePath(path);
  return {
    axis,
    key,
    path,
    label: path.length === 0 ? 'Total' : String(path[path.length - 1]),
    formattedLabel: path.length === 0 ? 'Total' : String(path[path.length - 1]),
    level: path.length,
    hasChildren,
  };
};

const shouldFetchTreeChildren = ({ node }: { node: PivotTreeNode }) =>
  node.hasChildren;

const lookupFromBatches = (
  factBatches: PivotFactStoreBatch[] = [],
  getCoverageKey: (axis: 'row' | 'col', key: string) => string = (_axis, key) =>
    key,
) =>
  createFetchedFactCoverageLookup({
    factBatches,
    getCoverageKey,
  });

describe('pivot/expansion/planner', () => {
  it('projects a typed branch request scope to fetched coverage', () => {
    expect(
      projectFactRequestToFetchedCoverage({
        coverage: {
          reason: 'expand',
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['country', 'city'],
          columnDimensions: ['month'],
        },
        scope: {
          kind: 'branch',
          axis: 'row',
          path: ['France'],
        },
        valueKeys: ['sales'],
      }),
    ).toEqual([
      {
        axis: 'row',
        pathKey: serializePath(['France']),
        requiredOppositeDepth: 1,
      },
    ]);
  });

  it('projects a typed batch request scope to fetched sibling coverage', () => {
    expect(
      projectFactRequestToFetchedCoverage({
        coverage: {
          reason: 'expand',
          rowDepth: 3,
          columnDepth: 0,
          rowDimensions: ['country', 'state', 'city'],
          columnDimensions: [],
        },
        scope: {
          kind: 'batch',
          axis: 'row',
          parentPath: ['US'],
          siblingValues: ['CA', 'NY'],
        },
        valueKeys: ['sales'],
      }),
    ).toEqual([
      {
        axis: 'row',
        pathKey: serializePath(['US', 'CA']),
        requiredOppositeDepth: 0,
      },
      {
        axis: 'row',
        pathKey: serializePath(['US', 'NY']),
        requiredOppositeDepth: 0,
      },
    ]);
  });

  it('projects root coverage to fetched root expansion coverage on covered axes', () => {
    expect(
      projectFactRequestToFetchedCoverage({
        coverage: {
          reason: 'initial',
          rowDepth: 1,
          columnDepth: 2,
          rowDimensions: ['country'],
          columnDimensions: ['year', 'quarter'],
        },
        scope: {
          kind: 'root',
        },
        valueKeys: ['sales'],
      }),
    ).toEqual([
      {
        axis: 'row',
        pathKey: rootKey,
        requiredOppositeDepth: 2,
      },
      {
        axis: 'col',
        pathKey: rootKey,
        requiredOppositeDepth: 1,
      },
    ]);
  });

  it('seeds fetched coverage lookup from typed fact batches', () => {
    const getCoverageKey = (axis: 'row' | 'col', pathKey: string) =>
      `${axis}:${pathKey}`;
    const lookup = createFetchedFactCoverageLookup({
      getCoverageKey,
      factBatches: [
        {
          coverage: {
            reason: 'expand',
            rowDepth: 2,
            columnDepth: 1,
            rowDimensions: ['country', 'city'],
            columnDimensions: ['month'],
          },
          scope: {
            kind: 'branch',
            axis: 'row',
            path: ['France'],
          },
          facts: [],
          valueKeys: ['sales'],
        },
      ],
    });

    expect(
      lookup.getFetchedDepth({
        axis: 'row',
        pathKey: serializePath(['France']),
        requiredOppositeDepth: 1,
      }),
    ).toBe(1);
    expect(
      lookup.getFetchedDepth({
        axis: 'col',
        pathKey: serializePath(['France']),
        requiredOppositeDepth: 1,
      }),
    ).toBeUndefined();
  });

  it('plans grouped fetch targets for an expanded node', () => {
    const aKey = serializePath(['A']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: true,
      },
      [aKey]: {
        axis: 'row',
        key: aKey,
        path: ['A'],
        label: 'A',
        formattedLabel: 'A',
        level: 1,
        hasChildren: true,
      },
    };

    const { plan, targets } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey]),
      nodes,
      requiredOppositeDepth: 1,
      fetchedCoverageLookup: lookupFromBatches(),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchTreeChildren,
    });

    expect(Array.from(plan.fetchKeys)).toEqual([aKey]);
    expect(targets).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
    ]);
  });

  it('plans fetches from semantic expandability instead of tree child shape', () => {
    const aKey = serializePath(['A']);
    const { plan, targets } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey]),
      nodes: {
        [rootKey]: makeNode({ axis: 'row', path: [] }),
        [aKey]: makeNode({
          axis: 'row',
          path: ['A'],
          hasChildren: false,
        }),
      },
      requiredOppositeDepth: 0,
      fetchedCoverageLookup: lookupFromBatches(),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: ({ key }) => key === aKey,
    });

    expect(Array.from(plan.fetchKeys)).toEqual([aKey]);
    expect(targets).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
        childDepth: 2,
        requiredOppositeDepth: 0,
      },
    ]);
  });

  it('uses typed branch coverage to skip only the covered expanded path', () => {
    const aKey = serializePath(['A']);
    const bKey = serializePath(['B']);
    const fetchedCoverageLookup = lookupFromBatches([
      {
        coverage: {
          reason: 'expand',
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['category', 'subcategory'],
          columnDimensions: ['month'],
        },
        scope: {
          kind: 'branch',
          axis: 'row',
          path: ['A'],
        },
        facts: [],
        valueKeys: ['sales'],
      },
    ]);

    const { plan, targets } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey, bKey]),
      nodes: {
        [rootKey]: makeNode({ axis: 'row', path: [] }),
        [aKey]: makeNode({ axis: 'row', path: ['A'] }),
        [bKey]: makeNode({ axis: 'row', path: ['B'] }),
      },
      requiredOppositeDepth: 1,
      fetchedCoverageLookup,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchTreeChildren,
    });

    expect(Array.from(plan.fetchKeys)).toEqual([bKey]);
    expect(targets.map(target => target.pathKey)).toEqual([bKey]);
  });

  it('uses typed batch coverage to skip only covered sibling paths', () => {
    const caKey = serializePath(['US', 'CA']);
    const nyKey = serializePath(['US', 'NY']);
    const txKey = serializePath(['US', 'TX']);
    const fetchedCoverageLookup = lookupFromBatches([
      {
        coverage: {
          reason: 'expand',
          rowDepth: 3,
          columnDepth: 0,
          rowDimensions: ['country', 'state', 'city'],
          columnDimensions: [],
        },
        scope: {
          kind: 'batch',
          axis: 'row',
          parentPath: ['US'],
          siblingValues: ['CA', 'NY'],
        },
        facts: [],
        valueKeys: ['sales'],
      },
    ]);

    const { plan, targets } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([caKey, nyKey, txKey]),
      nodes: {
        [caKey]: makeNode({ axis: 'row', path: ['US', 'CA'] }),
        [nyKey]: makeNode({ axis: 'row', path: ['US', 'NY'] }),
        [txKey]: makeNode({ axis: 'row', path: ['US', 'TX'] }),
      },
      requiredOppositeDepth: 0,
      fetchedCoverageLookup,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchTreeChildren,
    });

    expect(Array.from(plan.fetchKeys)).toEqual([txKey]);
    expect(targets.map(target => target.pathKey)).toEqual([txKey]);
  });

  it('does not let typed metric branch coverage satisfy sibling metrics', () => {
    const salesKey = serializePath(['A', encodeMetricKey('sales')]);
    const profitKey = serializePath(['A', encodeMetricKey('profit')]);
    const fetchedCoverageLookup = lookupFromBatches([
      {
        coverage: {
          reason: 'expand',
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['category'],
          columnDimensions: ['month'],
        },
        scope: {
          kind: 'branch',
          axis: 'row',
          path: ['A', encodeMetricKey('sales')],
        },
        facts: [],
        valueKeys: ['sales'],
      },
    ]);

    const { plan, targets } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([salesKey, profitKey]),
      nodes: {
        [salesKey]: makeNode({
          axis: 'row',
          path: ['A', encodeMetricKey('sales')],
        }),
        [profitKey]: makeNode({
          axis: 'row',
          path: ['A', encodeMetricKey('profit')],
        }),
      },
      requiredOppositeDepth: 1,
      fetchedCoverageLookup,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchTreeChildren,
    });

    expect(Array.from(plan.fetchKeys)).toEqual([profitKey]);
    expect(targets.map(target => target.pathKey)).toEqual([profitKey]);
  });

  it('keeps rendered metric siblings as separate fetch targets when coverage keys differ', () => {
    const metricAKey = serializePath(['A', '__metric__sales']);
    const metricBKey = serializePath(['A', '__metric__profit']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: true,
      },
      [metricAKey]: {
        axis: 'row',
        key: metricAKey,
        path: ['A', '__metric__sales'],
        label: 'sales',
        formattedLabel: 'sales',
        level: 2,
        hasChildren: true,
      },
      [metricBKey]: {
        axis: 'row',
        key: metricBKey,
        path: ['A', '__metric__profit'],
        label: 'profit',
        formattedLabel: 'profit',
        level: 2,
        hasChildren: true,
      },
    };

    const { targets } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([metricAKey, metricBKey]),
      nodes,
      requiredOppositeDepth: 1,
      fetchedCoverageLookup: lookupFromBatches(),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchTreeChildren,
    });

    expect(targets).toHaveLength(2);
    expect(new Set(targets.map(target => target.pathKey))).toEqual(
      new Set([metricAKey, metricBKey]),
    );
  });
});
