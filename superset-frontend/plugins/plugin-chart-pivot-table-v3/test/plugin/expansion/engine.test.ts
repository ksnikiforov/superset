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
  planHydrationIteration,
  type ExpansionVisibilityConfig,
} from '../../../src/pivot/expansion/engine';
import { rootKey } from '../../../src/pivot/viewModel';
import { serializeCellKey, serializePath } from '../../../src/utils';
import { type PivotTreeData, type PivotTreeNode } from '../../../src/types';

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
  };

  const getGroupedFetchKey = (_axis: 'row' | 'col', key: string) => key;

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
      fetchedRowDepthByKey: new Map(),
      fetchedColDepthByKey: new Map(),
      config,
      getGroupedFetchKey,
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
      fetchedRowDepthByKey: new Map(),
      fetchedColDepthByKey: new Map(),
      config,
      getGroupedFetchKey,
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
      fetchedRowDepthByKey: new Map(),
      fetchedColDepthByKey: new Map(),
      config,
      getGroupedFetchKey,
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
      fetchedRowDepthByKey: new Map(),
      fetchedColDepthByKey: new Map(),
      config,
      getGroupedFetchKey,
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
});
