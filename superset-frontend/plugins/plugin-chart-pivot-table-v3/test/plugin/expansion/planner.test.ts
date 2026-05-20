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

import { planExpansionForAxis } from '../../../src/pivot/expansion/planner';
import { rootKey } from '../../../src/pivot/viewModel';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { serializePath } from '../../../src/pivot/core/path';
import { type PivotTreeNode } from '../../../src/types';
import { type PivotFactSelector } from '../../../src/pivot/runtime/factStore';
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

const fetchPathKeys = (plan: ReturnType<typeof planExpansionForAxis>) =>
  plan.map(target => target.pathKey);

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

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      factSelectors: [],
      program: testProgram,
    });

    expect(fetchPathKeys(plan)).toEqual([aKey]);
    expect(plan[0]).toMatchObject({
      axis: 'row',
      pathKey: aKey,
    });
  });

  it('plans fetches from semantic expandability instead of tree child shape', () => {
    const aKey = serializePath(['A']);
    const plan = planExpansionForAxis({
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
      factSelectors: [],
      program: testProgram,
    });

    expect(fetchPathKeys(plan)).toEqual([aKey]);
    expect(plan[0]).toMatchObject({
      axis: 'row',
      pathKey: aKey,
    });
  });

  it('builds branch coverage targets before manifest diffing', () => {
    const aKey = serializePath(['A']);
    const bKey = serializePath(['B']);
    const factSelectors: PivotFactSelector[] = [
      {
        coverage: {
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['category', 'subcategory'],
          columnDimensions: ['month'],
        },
        scope: {
          kind: 'scopedFull',
          axis: 'row',
          ancestorPaths: [['A']],
        },
        valueKeys: ['sales', 'profit'],
      },
    ];

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey, bKey]),
      nodes: {
        [rootKey]: makeNode({ axis: 'row', path: [] }),
        [aKey]: makeNode({ axis: 'row', path: ['A'] }),
        [bKey]: makeNode({ axis: 'row', path: ['B'] }),
      },
      coverage: { rowDepth: 1, columnDepth: 1 },
      factSelectors,
      program: testProgram,
    });

    expect(fetchPathKeys(plan)).toEqual([aKey, bKey]);
    expect(plan.map(target => target.pathKey)).toEqual([aKey, bKey]);
  });

  it('keeps coverage satisfaction outside axis target construction', () => {
    const aKey = serializePath(['A']);
    const bKey = serializePath(['B']);
    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey, bKey]),
      nodes: {
        [rootKey]: makeNode({ axis: 'row', path: [] }),
        [aKey]: makeNode({ axis: 'row', path: ['A'] }),
        [bKey]: makeNode({ axis: 'row', path: ['B'] }),
      },
      coverage: { rowDepth: 1, columnDepth: 1 },
      factSelectors: [
        {
          coverage: {
            rowDepth: 2,
            columnDepth: 1,
            rowDimensions: ['category', 'subcategory'],
            columnDimensions: ['month'],
          },
          scope: {
            kind: 'scopedFull',
            axis: 'row',
            ancestorPaths: [['A']],
          },
          valueKeys: ['sales', 'profit'],
        },
      ],
      program: testProgram,
    });

    expect(fetchPathKeys(plan)).toEqual([aKey, bKey]);
  });

  it('does not turn subtotal display paths into fetch coverage requests', () => {
    const metricKey = serializePath(['A', encodeMetricKey('sales')]);
    const subtotalMetricKey = serializePath([
      'A',
      SUBTOTAL_TOKEN,
      encodeMetricKey('sales'),
    ]);
    const plan = planExpansionForAxis({
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
      factSelectors: [],
      program: testProgram,
    });

    expect(fetchPathKeys(plan)).toEqual([metricKey]);
    expect(plan.map(target => target.pathKey)).toEqual([metricKey]);
  });

  it('uses typed batch coverage to skip only covered sibling paths', () => {
    const caKey = serializePath(['US', 'CA']);
    const nyKey = serializePath(['US', 'NY']);
    const txKey = serializePath(['US', 'TX']);
    const factSelectors: PivotFactSelector[] = [
      {
        coverage: {
          rowDepth: 3,
          columnDepth: 0,
          rowDimensions: ['category', 'subcategory', 'city'],
          columnDimensions: [],
        },
        scope: {
          kind: 'scopedFull',
          axis: 'row',
          ancestorPaths: [
            ['US', 'CA'],
            ['US', 'NY'],
          ],
        },
        valueKeys: ['sales', 'profit'],
      },
    ];

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([caKey, nyKey, txKey]),
      nodes: {
        [caKey]: makeNode({ axis: 'row', path: ['US', 'CA'] }),
        [nyKey]: makeNode({ axis: 'row', path: ['US', 'NY'] }),
        [txKey]: makeNode({ axis: 'row', path: ['US', 'TX'] }),
      },
      coverage: { rowDepth: 1, columnDepth: 0 },
      factSelectors,
      program: testProgram,
    });

    expect(fetchPathKeys(plan)).toEqual([caKey, nyKey, txKey]);
    expect(plan.map(target => target.pathKey)).toEqual([
      caKey,
      nyKey,
      txKey,
    ]);
  });

  it('does not let typed metric branch coverage satisfy sibling metrics', () => {
    const salesKey = serializePath(['A', encodeMetricKey('sales')]);
    const profitKey = serializePath(['A', encodeMetricKey('profit')]);
    const factSelectors: PivotFactSelector[] = [
      {
        coverage: {
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['category', 'subcategory'],
          columnDimensions: ['month'],
        },
        scope: {
          kind: 'scopedFull',
          axis: 'row',
          ancestorPaths: [['A']],
        },
        valueKeys: ['sales'],
      },
    ];

    const plan = planExpansionForAxis({
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
      factSelectors,
      program: testProgram,
    });

    expect(fetchPathKeys(plan)).toEqual([salesKey, profitKey]);
    expect(plan.map(target => target.pathKey)).toEqual([salesKey, profitKey]);
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

    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([metricAKey, metricBKey]),
      nodes,
      coverage: { rowDepth: 1, columnDepth: 1 },
      factSelectors: [],
      program: testProgram,
    });

    expect(plan).toHaveLength(2);
    expect(new Set(plan.map(target => target.pathKey))).toEqual(
      new Set([metricAKey, metricBKey]),
    );
  });

  it('plans canonical coverage when expanding a skipped pre-Values ancestor with an open metric', () => {
    const program = compilePivotProgram({
      groupbyRows: [
        'orderPriority',
        'shipMode',
        METRICS_PLACEHOLDER,
        'orderStatus',
      ],
      metrics: ['averageOrderValue', 'weightedDiscount'],
    });
    const orderPriorityKey = serializePath(['1-URGENT']);
    const metricKey = serializePath([
      '1-URGENT',
      encodeMetricKey('averageOrderValue'),
    ]);
    const plan = planExpansionForAxis({
      axis: 'row',
      expandedKeys: new Set([rootKey, orderPriorityKey, metricKey]),
      nodes: {
        [rootKey]: makeNode({ axis: 'row', path: [] }),
        [orderPriorityKey]: makeNode({
          axis: 'row',
          path: ['1-URGENT'],
        }),
        [metricKey]: makeNode({
          axis: 'row',
          path: ['1-URGENT', encodeMetricKey('averageOrderValue')],
        }),
      },
      coverage: { rowDepth: 2, columnDepth: 0 },
      factSelectors: [
        {
          coverage: {
            rowDepth: 2,
            columnDepth: 0,
            rowDimensions: ['orderPriority', 'orderStatus'],
            columnDimensions: [],
          },
          materialization: {
            valueAxis: 'row',
            valueInsertIndex: 1,
          },
          scope: {
            kind: 'scopedFull',
            axis: 'row',
            ancestorPaths: [['1-URGENT']],
          },
          valueKeys: ['averageOrderValue'],
        },
      ],
      program,
    });

    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pathKey: orderPriorityKey,
          need: expect.objectContaining({
            rowDepth: 2,
            rowDimensions: ['orderPriority', 'shipMode'],
            valueKeys: ['averageOrderValue', 'weightedDiscount'],
          }),
        }),
        expect.objectContaining({
          pathKey: metricKey,
          need: expect.objectContaining({
            rowDepth: 3,
            rowDimensions: ['orderPriority', 'shipMode', 'orderStatus'],
            valueKeys: ['averageOrderValue'],
          }),
        }),
      ]),
    );
  });
});
