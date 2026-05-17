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
  buildGroupedFetchTargets,
  planExpansionForAxis,
} from '../../../src/pivot/expansion/planner';
import {
  createExpansionCoverageDiff,
  type PivotExpansionCoverageDiff,
} from '../../../src/pivot/runtime/coverage';
import { rootKey } from '../../../src/pivot/viewModel';
import {
  encodeMetricKey,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { serializePath } from '../../../src/pivot/core/path';
import { type PivotTreeNode } from '../../../src/types';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';

const testProgram = compilePivotProgram({
  groupbyRows: ['category', 'subcategory', 'city'],
  groupbyColumns: ['month', 'quarter', 'day'],
  metrics: ['sales', 'profit'],
});

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

const shouldFetchDimensionChildren = ({
  path,
}: {
  path: PivotTreeNode['path'];
}) => path.length < testProgram.rowDimensions.length;

const getMissingCoverageFromBatches = (
  factBatches: PivotFactStoreBatch[] = [],
): PivotExpansionCoverageDiff =>
  createExpansionCoverageDiff({
    factBatches,
    program: testProgram,
    valueKeys: ['sales', 'profit'],
  });

const fetchPathKeys = (plan: ReturnType<typeof planExpansionForAxis>) =>
  plan.fetchRequests.map(request => request.pathKey);

const planGroupedExpansionTargets = (
  input: Parameters<typeof planExpansionForAxis>[0],
) => {
  const plan = planExpansionForAxis(input);
  return {
    plan,
    targets: buildGroupedFetchTargets({
      axis: input.axis,
      requests: plan.fetchRequests,
      nodes: input.nodes,
      getCoverageKey: input.getCoverageKey,
    }),
  };
};

describe('pivot/expansion/planner', () => {
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
      coverage: { rowDepth: 1, columnDepth: 1 },
      getMissingExpansionCoverage: getMissingCoverageFromBatches(),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(fetchPathKeys(plan)).toEqual([aKey]);
    expect(targets).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
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
      coverage: { rowDepth: 1, columnDepth: 0 },
      getMissingExpansionCoverage: getMissingCoverageFromBatches(),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: ({ key }) => key === aKey,
    });

    expect(fetchPathKeys(plan)).toEqual([aKey]);
    expect(targets).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
      },
    ]);
  });

  it('uses typed branch coverage to skip only the covered expanded path', () => {
    const aKey = serializePath(['A']);
    const bKey = serializePath(['B']);
    const getMissingExpansionCoverage = getMissingCoverageFromBatches([
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
        valueKeys: ['sales', 'profit'],
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
      coverage: { rowDepth: 1, columnDepth: 1 },
      getMissingExpansionCoverage,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(fetchPathKeys(plan)).toEqual([bKey]);
    expect(targets.map(target => target.pathKey)).toEqual([bKey]);
  });

  it('diffs expansion coverage requests as one set', () => {
    const aKey = serializePath(['A']);
    const bKey = serializePath(['B']);
    const getMissingExpansionCoverage = jest.fn(
      (requests: Parameters<PivotExpansionCoverageDiff>[0]) => requests,
    );

    planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey, bKey]),
      nodes: {
        [rootKey]: makeNode({ axis: 'row', path: [] }),
        [aKey]: makeNode({ axis: 'row', path: ['A'] }),
        [bKey]: makeNode({ axis: 'row', path: ['B'] }),
      },
      coverage: { rowDepth: 1, columnDepth: 1 },
      getMissingExpansionCoverage,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(getMissingExpansionCoverage).toHaveBeenCalledTimes(1);
    expect(
      getMissingExpansionCoverage.mock.calls[0][0].map(
        request => request.pathKey,
      ),
    ).toEqual([aKey, bKey]);
  });

  it('does not turn subtotal display paths into fetch coverage requests', () => {
    const metricKey = serializePath(['A', encodeMetricKey('sales')]);
    const subtotalMetricKey = serializePath([
      'A',
      SUBTOTAL_TOKEN,
      encodeMetricKey('sales'),
    ]);
    const getMissingExpansionCoverage = jest.fn(
      (requests: Parameters<PivotExpansionCoverageDiff>[0]) => requests,
    );

    const { plan, targets } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([metricKey, subtotalMetricKey]),
      nodes: {
        [metricKey]: makeNode({
          axis: 'row',
          path: ['A', encodeMetricKey('sales')],
        }),
        [subtotalMetricKey]: makeNode({
          axis: 'row',
          path: ['A', SUBTOTAL_TOKEN, encodeMetricKey('sales')],
        }),
      },
      coverage: { rowDepth: 1, columnDepth: 1 },
      getMissingExpansionCoverage,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: ({ path }) => !path.includes(SUBTOTAL_TOKEN),
    });

    expect(
      getMissingExpansionCoverage.mock.calls[0][0].map(
        request => request.pathKey,
      ),
    ).toEqual([metricKey]);
    expect(fetchPathKeys(plan)).toEqual([metricKey]);
    expect(targets.map(target => target.pathKey)).toEqual([metricKey]);
  });

  it('uses typed batch coverage to skip only covered sibling paths', () => {
    const caKey = serializePath(['US', 'CA']);
    const nyKey = serializePath(['US', 'NY']);
    const txKey = serializePath(['US', 'TX']);
    const getMissingExpansionCoverage = getMissingCoverageFromBatches([
      {
        coverage: {
          reason: 'expand',
          rowDepth: 3,
          columnDepth: 0,
          rowDimensions: ['category', 'subcategory', 'city'],
          columnDimensions: [],
        },
        scope: {
          kind: 'batch',
          axis: 'row',
          parentPath: ['US'],
          siblingValues: ['CA', 'NY'],
        },
        facts: [],
        valueKeys: ['sales', 'profit'],
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
      coverage: { rowDepth: 1, columnDepth: 0 },
      getMissingExpansionCoverage,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(fetchPathKeys(plan)).toEqual([txKey]);
    expect(targets.map(target => target.pathKey)).toEqual([txKey]);
  });

  it('does not let typed metric branch coverage satisfy sibling metrics', () => {
    const salesKey = serializePath(['A', encodeMetricKey('sales')]);
    const profitKey = serializePath(['A', encodeMetricKey('profit')]);
    const getMissingExpansionCoverage = getMissingCoverageFromBatches([
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
      coverage: { rowDepth: 1, columnDepth: 1 },
      getMissingExpansionCoverage,
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(fetchPathKeys(plan)).toEqual([profitKey]);
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
      coverage: { rowDepth: 1, columnDepth: 1 },
      getMissingExpansionCoverage: getMissingCoverageFromBatches(),
      getCoverageKey: (_axis, key) => key,
      shouldFetchChildren: shouldFetchDimensionChildren,
    });

    expect(targets).toHaveLength(2);
    expect(new Set(targets.map(target => target.pathKey))).toEqual(
      new Set([metricAKey, metricBKey]),
    );
  });
});
