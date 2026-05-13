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
  buildHydrationPrefetchAction,
  planHydrationIteration,
  shouldPlanHydrationPrefetchAxis,
  type ExpansionVisibilityConfig,
} from '../../../src/pivot/expansion/engine';
import { createFetchedFactCoverageState } from '../../../src/pivot/expansion/fetchedRequests';
import { rootKey } from '../../../src/pivot/viewModel';
import {
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
  serializeCellKey,
  serializePath,
} from '../../../src/utils';
import {
  MetricsLayoutEnum,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../src/types';

describe('pivot/expansion/engine', () => {
  const config: ExpansionVisibilityConfig = {
    groupbyRowsLength: 2,
    groupbyColumnsLength: 2,
    rowTotals: false,
    colTotals: false,
    metricsLayout: undefined,
    metricLabelSet: new Set<string>(),
    metricIndexForRows: undefined,
    metricIndexForCols: undefined,
    isMetricTokenValue: () => false,
    countDimDepth: path => path.length,
    shouldFetchChildren: ({ node }) => node.hasChildren,
  };

  const getCoverageKey = (_axis: 'row' | 'col', key: string) => key;
  const emptyFetchedCoverage = () => createFetchedFactCoverageState();

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

  it('plans fetch targets for expanded nodes', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverage: emptyFetchedCoverage(),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.targets).toEqual([
      {
        id: JSON.stringify(['row', aKey, 2, 1]),
        axis: 'row',
        pathKey: aKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
      {
        id: JSON.stringify(['col', xKey, 2, 1]),
        axis: 'col',
        pathKey: xKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
    ]);
  });

  it('prioritizes the active axis when possible', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverage: emptyFetchedCoverage(),
      config,
      getCoverageKey,
      activeAxis: 'col',
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(Array.from(plan.rowPlan.fetchKeys)).toEqual([]);
    expect(Array.from(plan.colPlan.fetchKeys)).toEqual([xKey]);
    expect(plan.targets).toEqual([
      {
        id: JSON.stringify(['col', xKey, 2, 1]),
        axis: 'col',
        pathKey: xKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
    ]);
  });

  it('forces a root fetch when expanded axes have no intersection cells', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: false });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverage: emptyFetchedCoverage(),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    expect(plan.rowPlan.fetchKeys.has(rootKey)).toBe(true);
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'row', pathKey: rootKey }),
        expect.objectContaining({ axis: 'row', pathKey: aKey }),
        expect.objectContaining({ axis: 'col', pathKey: xKey }),
      ]),
    );
  });

  it('can skip planning for one axis', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverage: emptyFetchedCoverage(),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
      planRows: false,
      planCols: true,
    });

    expect(plan.kind).toBe('fetch');
    expect(plan.rowPlan.fetchKeys.size).toBe(0);
    expect(plan.colPlan.fetchKeys.size).toBe(1);
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.targets.map(target => target.axis)).toEqual(['col']);
  });

  it('fetches expanded row branches when only stale metric variants exist', () => {
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', METRICS_PLACEHOLDER]);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', METRICS_PLACEHOLDER], false),
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
    const metricConfig: ExpansionVisibilityConfig = {
      ...config,
      metricsLayout: MetricsLayoutEnum.ROWS,
      metricIndexForRows: 1,
      isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
      countDimDepth: path =>
        path.filter(value => value !== METRICS_PLACEHOLDER).length,
    };

    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverage: emptyFetchedCoverage(),
      config: metricConfig,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.rowPlan.fetchKeys.has(aKey)).toBe(true);
    expect(plan.kind).toBe('fetch');
  });

  it('fetches expanded row branches when only subtotal+metric descendants exist at same base depth', () => {
    const metricToken = '__metric__m1';
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
    const metricConfig: ExpansionVisibilityConfig = {
      ...config,
      groupbyRowsLength: 3,
      metricsLayout: MetricsLayoutEnum.ROWS,
      metricIndexForRows: 2,
      isMetricTokenValue: value => value === metricToken,
      countDimDepth: path =>
        path.filter(value => value !== metricToken && value !== SUBTOTAL_TOKEN)
          .length,
    };

    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverage: emptyFetchedCoverage(),
      config: metricConfig,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.rowPlan.fetchKeys.has(aKey)).toBe(true);
    expect(plan.kind).toBe('fetch');
  });

  it('decides which axes should participate in hydration prefetch', () => {
    expect(
      shouldPlanHydrationPrefetchAxis({
        effectiveExpandLevel: 0,
        expandedCount: 0,
        collapsedCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldPlanHydrationPrefetchAxis({
        effectiveExpandLevel: 1,
        expandedCount: 0,
        collapsedCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldPlanHydrationPrefetchAxis({
        effectiveExpandLevel: 0,
        expandedCount: 1,
        collapsedCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldPlanHydrationPrefetchAxis({
        effectiveExpandLevel: 0,
        expandedCount: 0,
        collapsedCount: 1,
      }),
    ).toBe(true);
  });

  it('builds hydration prefetch actions from pending plans', () => {
    const emptyState = {
      rowKeys: ['country'],
      colKeys: ['month'],
      rows: [],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };
    const rootOnlyTree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
      },
      cells: {},
    };

    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: emptyState,
        autoExpandRowsLevelForDesired: 0,
        autoExpandColsLevelForDesired: 0,
        tree: rootOnlyTree,
        rowPlan: {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'idle' });

    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: emptyState,
        autoExpandRowsLevelForDesired: 0,
        autoExpandColsLevelForDesired: 0,
        tree: rootOnlyTree,
        rowPlan: {
          fetchKeys: new Set([rootKey]),
          pendingKeys: new Set([rootKey]),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'skip-root' });

    const { tree, aKey } = buildTree({ includeIntersectionCell: true });
    const childKey = serializePath(['A', 'B']);
    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey, aKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: { ...emptyState, rows: [aKey] },
        autoExpandRowsLevelForDesired: 0,
        autoExpandColsLevelForDesired: 0,
        tree,
        rowPlan: {
          fetchKeys: new Set([aKey, childKey]),
          pendingKeys: new Set([aKey, childKey]),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'hydrate', showLoader: true });
  });
});
