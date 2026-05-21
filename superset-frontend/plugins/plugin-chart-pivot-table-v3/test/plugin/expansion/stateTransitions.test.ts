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
  resolveCollapsedExpansionState,
  resolveExpandedForMetrics,
  resolveExpansionToggleDecision,
} from '../../../src/pivot/expansion/stateTransitions';
import { planHydrationIteration } from '../../../src/pivot/expansion/planner';
import { rootKey } from '../../../src/pivot/viewModel';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import {
  parsePath,
  serializeCellKey,
  serializePath,
} from '../../../src/pivot/core/path';
import {
  MetricsLayoutEnum,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../src/types';
import { type PivotFactSelector } from '../../../src/pivot/runtime/factStore';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';

describe('pivot/expansion/stateTransitions', () => {
  const testProgram = compilePivotProgram({
    groupbyRows: ['country', 'city'],
    groupbyColumns: ['month', 'day'],
    metrics: ['sales'],
  });
  const fetchPathKeys = (targets: Array<{ pathKey: string }>) =>
    targets.map(target => target.pathKey);
  const makeNode = (
    axis: 'row' | 'col',
    path: string[],
    hasChildren: boolean,
  ): PivotTreeNode => {
    const key = serializePath(path);
    return {
      axis,
      key,
      path,
      label: path.length === 0 ? 'Total' : String(path[path.length - 1]),
      formattedLabel:
        path.length === 0 ? 'Total' : String(path[path.length - 1]),
      level: path.length,
      hasChildren,
    };
  };

  const buildTree = ({
    includeIntersectionCell,
  }: {
    includeIntersectionCell: boolean;
  }): { tree: PivotTreeData; aKey: string; xKey: string } => {
    const aKey = serializePath(['A']);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
        [xKey]: makeNode('col', ['X'], true),
      },
      cells: includeIntersectionCell
        ? {
            [serializeCellKey(aKey, xKey)]: {
              rowKey: aKey,
              colKey: xKey,
              values: {},
            },
          }
        : {},
    };
    return { tree, aKey, xKey };
  };

  test('resolves open expansion toggles as collapse decisions', () => {
    const node = makeNode('row', ['A'], true);
    const decision = resolveExpansionToggleDecision({
      node,
      expanded: new Set([node.key]),
      manualExpanded: new Set(),
      manualCollapsed: new Set(),
    });

    expect(decision).toEqual({ kind: 'collapse' });
  });

  test('resolves ordinary expansion toggles as manifest expansion decisions', () => {
    const node = makeNode('row', ['A'], true);
    const decision = resolveExpansionToggleDecision({
      node,
      expanded: new Set(),
      manualExpanded: new Set(),
      manualCollapsed: new Set([node.key]),
    });

    expect(decision).toEqual({
      kind: 'expand',
      nextManualExpanded: new Set([node.key]),
      nextManualCollapsed: new Set(),
    });
  });

  test('resolves expansion toggles with ancestor and manual state', () => {
    const parentKey = serializePath(['A']);
    const node = makeNode('row', ['A', 'B'], true);
    const manualExpanded = new Set(['manual']);
    const manualCollapsed = new Set([node.key, 'other']);
    const decision = resolveExpansionToggleDecision({
      node,
      expanded: new Set([parentKey]),
      manualExpanded,
      manualCollapsed,
    });

    expect(decision.kind).toBe('expand');
    if (decision.kind !== 'expand') {
      return;
    }
    expect([...decision.nextManualExpanded].sort()).toEqual(
      ['manual', parentKey, node.key].sort(),
    );
    expect([...decision.nextManualCollapsed]).toEqual(['other']);
    expect([...manualExpanded]).toEqual(['manual']);
    expect([...manualCollapsed].sort()).toEqual([node.key, 'other'].sort());
  });

  test('resolves collapsed expansion state by pruning descendants', () => {
    const parent = makeNode('row', ['A'], true);
    const child = makeNode('row', ['A', 'B'], true);
    const grandchild = makeNode('row', ['A', 'B', 'C'], false);
    const sibling = makeNode('row', ['D'], false);
    const result = resolveCollapsedExpansionState({
      node: child,
      expanded: new Set([parent.key, child.key, grandchild.key, sibling.key]),
      manualExpanded: new Set([child.key, grandchild.key, sibling.key]),
      manualCollapsed: new Set([grandchild.key, sibling.key]),
      nodes: {
        [parent.key]: parent,
        [child.key]: child,
        [grandchild.key]: grandchild,
        [sibling.key]: sibling,
      },
    });

    expect([...result.nextExpanded].sort()).toEqual(
      [parent.key, sibling.key].sort(),
    );
    expect([...result.nextManualExpanded]).toEqual([sibling.key]);
    expect([...result.nextManualCollapsed].sort()).toEqual(
      [child.key, sibling.key].sort(),
    );
  });

  test('drops stale metric-pattern expansion keys after metric depth changes', () => {
    const metricToken = encodeMetricKey('m1');
    const staleMetricFirstKey = serializePath([metricToken, 'A']);
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', metricToken]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', metricToken], false),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, aKey, staleMetricFirstKey]),
      tree,
      collapsed: new Set(),
      program: compilePivotProgram({
        groupbyRows: ['r0', METRICS_PLACEHOLDER],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
    });

    expect(result).toEqual(new Set([rootKey, aKey]));
  });

  test('applies collapsed metric keys and stale metric-pattern cleanup together', () => {
    const metricToken = encodeMetricKey('m1');
    const staleMetricFirstKey = serializePath([metricToken, 'A']);
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', metricToken]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', metricToken], false),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, aKey, aMetricKey, staleMetricFirstKey]),
      tree,
      collapsed: new Set([aMetricKey]),
      program: compilePivotProgram({
        groupbyRows: ['r0', METRICS_PLACEHOLDER],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
    });

    expect(result).toEqual(new Set([rootKey, aKey]));
  });

  test('duplicates skipped-dimension metric expansion under newly loaded prefixes', () => {
    const metricToken = encodeMetricKey('m1');
    const parentKey = serializePath(['A']);
    const collapsedMetricKey = serializePath(['A', metricToken]);
    const loadedMetricKey = serializePath(['A', 'B', metricToken]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [parentKey]: makeNode('row', ['A'], true),
        [collapsedMetricKey]: makeNode('row', ['A', metricToken], true),
        [serializePath(['A', 'B'])]: makeNode('row', ['A', 'B'], true),
        [loadedMetricKey]: makeNode('row', ['A', 'B', metricToken], true),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, parentKey, collapsedMetricKey]),
      tree,
      collapsed: new Set(),
      program: compilePivotProgram({
        groupbyRows: ['r0', 'r1', METRICS_PLACEHOLDER, 'r2'],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
    });

    expect(result).toEqual(
      new Set([rootKey, parentKey, collapsedMetricKey, loadedMetricKey]),
    );
  });

  test('resolves visible measure-leaf metric nodes before render', () => {
    const metricToken = encodeMetricKey('m1');
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', metricToken]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', metricToken], true),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, aKey]),
      tree,
      collapsed: new Set(),
      program: compilePivotProgram({
        groupbyRows: ['r0', METRICS_PLACEHOLDER],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
      isLeafTierVisible: true,
    });

    expect(result).toEqual(new Set([rootKey, aKey, aMetricKey]));
  });

  test('plans fetch targets for expanded nodes', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const loadedRootCoverage: PivotFactSelector = {
      coverage: {
        rowDepth: 1,
        columnDepth: 1,
        rowDimensions: ['country'],
        columnDimensions: ['month'],
      },
      scope: {
        kind: 'axisPaths',
        axis: 'row',
        paths: [[]],
      },
      valueKeys: ['sales'],
    };
    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey, aKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [loadedRootCoverage],
      program: testProgram,
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(
      plan.targets.map(target => ({
        axis: target.axis,
        pathKey: target.pathKey,
      })),
    ).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
      },
      {
        axis: 'col',
        pathKey: xKey,
      },
    ]);
  });

  test('plans both visible axes through manifest coverage', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey, aKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [
        {
          coverage: {
            rowDepth: 2,
            columnDepth: 1,
            rowDimensions: ['country', 'city'],
            columnDimensions: ['month'],
          },
          scope: {
            kind: 'axisPaths',
            axis: 'col',
            paths: [[]],
          },
          valueKeys: ['sales'],
        },
      ],
      program: testProgram,
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(fetchPathKeys(plan.targets)).toEqual([aKey, xKey]);
    expect(
      plan.targets.map(target => ({
        axis: target.axis,
        pathKey: target.pathKey,
      })),
    ).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
      },
      {
        axis: 'col',
        pathKey: xKey,
      },
    ]);
  });

  test('suppresses redundant singleton intersection fetches', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: false });
    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey, aKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [],
      program: testProgram,
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(fetchPathKeys(plan.targets)).not.toContain(rootKey);
    expect(plan.targets).toEqual([
      expect.objectContaining({ axis: 'row', pathKey: aKey }),
      expect.objectContaining({ axis: 'col', pathKey: xKey }),
    ]);
  });

  test('does not fetch the opposite root branch for one-axis expansion', () => {
    const { tree, xKey } = buildTree({ includeIntersectionCell: true });
    const loadedBootstrapCoverage: PivotFactSelector = {
      coverage: {
        rowDepth: 1,
        columnDepth: 1,
        rowDimensions: ['country'],
        columnDimensions: ['month'],
      },
      scope: { kind: 'root' },
      valueKeys: ['sales'],
    };
    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [loadedBootstrapCoverage],
      program: testProgram,
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(
      plan.targets.map(target => ({
        axis: target.axis,
        pathKey: target.pathKey,
      })),
    ).toEqual([
      {
        axis: 'col',
        pathKey: xKey,
      },
    ]);
  });

  test('does not fetch the opposite root branch for row-only expansion', () => {
    const { tree, aKey } = buildTree({ includeIntersectionCell: true });
    const loadedBootstrapCoverage: PivotFactSelector = {
      coverage: {
        rowDepth: 1,
        columnDepth: 1,
        rowDimensions: ['country'],
        columnDimensions: ['month'],
      },
      scope: { kind: 'root' },
      valueKeys: ['sales'],
    };
    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey, aKey]),
        col: new Set([rootKey]),
      },
      factSelectors: [loadedBootstrapCoverage],
      program: testProgram,
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(
      plan.targets.map(target => ({
        axis: target.axis,
        pathKey: target.pathKey,
      })),
    ).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
      },
    ]);
  });

  test('does not fetch the opposite root branch after the expanded branch is loaded', () => {
    const { tree, xKey } = buildTree({ includeIntersectionCell: true });
    const loadedBootstrapCoverage: PivotFactSelector = {
      coverage: {
        rowDepth: 1,
        columnDepth: 1,
        rowDimensions: ['country'],
        columnDimensions: ['month'],
      },
      scope: { kind: 'root' },
      valueKeys: ['sales'],
    };
    const loadedColumnBranch: PivotFactSelector = {
      coverage: {
        rowDepth: 1,
        columnDepth: 2,
        rowDimensions: ['country'],
        columnDimensions: ['month', 'day'],
      },
      scope: {
        kind: 'scopedFull',
        axis: 'col',
        ancestorPaths: [parsePath(xKey)],
      },
      valueKeys: ['sales'],
    };
    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [loadedBootstrapCoverage, loadedColumnBranch],
      program: testProgram,
    });

    expect(plan.kind).toBe('complete');
  });

  test('does not plan intersection fetches before both axis nodes are loaded', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: false });
    delete tree.rows[aKey];

    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey, aKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [],
      program: testProgram,
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(fetchPathKeys(plan.targets)).toContain(aKey);
    expect(plan.targets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'intersection' }),
      ]),
    );
  });

  test('fetches expanded row branches when only stale metric variants exist', () => {
    const metricToken = encodeMetricKey('m1');
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', metricToken]);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', metricToken], false),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
        [xKey]: makeNode('col', ['X'], false),
      },
      cells: {
        [serializeCellKey(aKey, xKey)]: {
          rowKey: aKey,
          colKey: xKey,
          values: {},
        },
      },
    };
    const metricProgram = compilePivotProgram({
      groupbyRows: ['country', 'city'],
      groupbyColumns: ['month', 'day', METRICS_PLACEHOLDER],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey, aKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [],
      program: metricProgram,
    });

    expect(fetchPathKeys(plan.targets)).toContain(aKey);
    expect(plan.kind).toBe('fetch');
  });

  test('fetches expanded row branches when only subtotal+metric descendants exist at same base depth', () => {
    const metricToken = encodeMetricKey('m1');
    const aKey = serializePath(['A']);
    const subtotalKey = serializePath(['A', SUBTOTAL_TOKEN]);
    const subtotalMetricKey = serializePath(['A', SUBTOTAL_TOKEN, metricToken]);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [subtotalKey]: makeNode('row', ['A', SUBTOTAL_TOKEN], true),
        [subtotalMetricKey]: makeNode(
          'row',
          ['A', SUBTOTAL_TOKEN, metricToken],
          false,
        ),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
        [xKey]: makeNode('col', ['X'], false),
      },
      cells: {
        [serializeCellKey(subtotalMetricKey, xKey)]: {
          rowKey: subtotalMetricKey,
          colKey: xKey,
          values: {},
        },
      },
    };
    const metricProgram = compilePivotProgram({
      groupbyRows: ['country', 'city', METRICS_PLACEHOLDER],
      groupbyColumns: ['month', 'day'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const plan = planHydrationIteration({
      tree,
      desired: {
        row: new Set([rootKey, aKey]),
        col: new Set([rootKey, xKey]),
      },
      factSelectors: [],
      program: metricProgram,
    });

    expect(fetchPathKeys(plan.targets)).toContain(aKey);
    expect(plan.kind).toBe('fetch');
  });
});
