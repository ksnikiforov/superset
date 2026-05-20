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
import { MetricsLayoutEnum, PivotTreeData } from '../../../../src/types';
import {
  serializeCellKey,
  serializePath,
} from '../../../../src/pivot/core/path';
import {
  encodeMeasureLeafKey,
  encodeMetricKey,
} from '../../../../src/pivot/core/tokens';
import { mergeTrees } from '../../fixtures/tree';
import { buildTreeFromRecords } from '../../fixtures/buildTreeFromRecords';
import {
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';
import {
  applyMetricAxis,
  applyMeasureHierarchyAxis,
} from '../../fixtures/metricAxis';

describe('pivot/core/tree', () => {
  it('labels null row values as (NULL)', () => {
    const tree = buildTreeFromRecords(
      [{ state: null, m1: 10 }],
      ['m1'],
      ['state'],
      [],
      1,
      0,
    );
    const nullKey = serializePath([null]);
    expect(tree.rows[nullKey].label).toBe('(NULL)');
    expect(tree.rows[nullKey].formattedLabel).toBe('(NULL)');
  });

  it('keeps time offset metric values in cells', () => {
    const tree = buildTreeFromRecords(
      [{ region: 'A', m1: 10, 'm1__1 year ago': 5 }],
      ['m1'],
      ['region'],
      [],
      1,
      0,
    );
    const cellKey = serializeCellKey(serializePath(['A']), serializePath([]));
    expect(tree.cells[cellKey]?.values['m1__1 year ago']).toBe(5);
  });

  it('merges branch cell values into an existing tree', () => {
    const rootKey = serializePath([]);
    const baseTree: PivotTreeData = {
      rows: {
        [rootKey]: {
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
      },
      cols: {
        [rootKey]: {
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
      },
      cells: {
        [serializeCellKey(rootKey, rootKey)]: {
          rowKey: rootKey,
          colKey: rootKey,
          values: { m1: 1 },
        },
      },
    };

    const branchTree: PivotTreeData = {
      rows: baseTree.rows,
      cols: baseTree.cols,
      cells: {
        [serializeCellKey(rootKey, rootKey)]: {
          rowKey: rootKey,
          colKey: rootKey,
          values: { m1: 2 },
        },
      },
    };

    const merged = mergeTrees(baseTree, branchTree);
    expect(merged.cells[serializeCellKey(rootKey, rootKey)]?.values.m1).toBe(2);
  });

  it('surfaces single metric values on the base column when the metric is first', () => {
    const rootKey = serializePath([]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: {
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        A: {
          axis: 'row',
          key: serializePath(['A']),
          path: ['A'],
          label: 'A',
          formattedLabel: 'A',
          level: 1,
          hasChildren: false,
        },
      },
      cols: {
        [rootKey]: {
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        AUTO: {
          axis: 'col',
          key: serializePath(['AUTO']),
          path: ['AUTO'],
          label: 'AUTO',
          formattedLabel: 'AUTO',
          level: 1,
          hasChildren: false,
        },
      },
      cells: {
        [serializeCellKey(serializePath(['A']), serializePath(['AUTO']))]: {
          rowKey: serializePath(['A']),
          colKey: serializePath(['AUTO']),
          values: { m1: 10 },
        },
      },
    };

    const withMetrics = applyMetricAxis(
      tree,
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
      0,
    );

    expect(
      withMetrics.cells[
        serializeCellKey(
          serializePath(['A']),
          serializePath([encodeMetricKey('m1'), 'AUTO']),
        )
      ]?.values.m1,
    ).toBe(10);
    expect(
      withMetrics.cells[serializeCellKey(serializePath(['A']), rootKey)]?.values
        .m1,
    ).toBe(10);
  });

  it('inserts measure leaf tiers when configured', () => {
    const tree = buildTreeFromRecords(
      [{ region: 'A', m1: 10 }],
      ['m1'],
      ['region'],
      [],
      1,
      0,
    );
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const withLeaves = applyMeasureHierarchyAxis(
      tree,
      {
        kind: 'measureStackV1',
        groups: [{ metricKey: 'm1', leaves: [valueLeaf, ixLeaf] }],
        leafTierVisibility: 'visible',
      },
      MetricsLayoutEnum.ROWS,
      ['region'],
      [],
      1,
    );
    const leafKey = serializePath([
      'A',
      encodeMetricKey('m1'),
      encodeMeasureLeafKey(ixLeaf.id),
    ]);
    expect(withLeaves.rows[leafKey]?.label).toBe(ixLeaf.label);
    expect(
      withLeaves.cells[serializeCellKey(leafKey, serializePath([]))]?.values.m1,
    ).toBe(10);
  });

  it('keeps measure leaf tiers adjacent to metric groups between dimensions', () => {
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });

    const rowTree = applyMeasureHierarchyAxis(
      buildTreeFromRecords(
        [{ r1: 'A', r2: 'B', m1: 10 }],
        ['m1'],
        ['r1', 'r2'],
        [],
        2,
        0,
      ),
      {
        kind: 'measureStackV1',
        groups: [{ metricKey: 'm1', leaves: [valueLeaf, ixLeaf] }],
        leafTierVisibility: 'visible',
      },
      MetricsLayoutEnum.ROWS,
      ['r1', 'r2'],
      [],
      1,
    );
    const rowLeafPath = serializePath([
      'A',
      encodeMetricKey('m1'),
      encodeMeasureLeafKey(ixLeaf.id),
      'B',
    ]);
    const rowMisplacedPath = serializePath([
      'A',
      encodeMetricKey('m1'),
      'B',
      encodeMeasureLeafKey(ixLeaf.id),
    ]);
    expect(rowTree.rows[rowLeafPath]).toBeDefined();
    expect(rowTree.rows[rowMisplacedPath]).toBeUndefined();

    const colTree = applyMeasureHierarchyAxis(
      buildTreeFromRecords(
        [{ c1: 'C1', c2: 'C2', m1: 10 }],
        ['m1'],
        [],
        ['c1', 'c2'],
        0,
        2,
      ),
      {
        kind: 'measureStackV1',
        groups: [{ metricKey: 'm1', leaves: [valueLeaf, ixLeaf] }],
        leafTierVisibility: 'visible',
      },
      MetricsLayoutEnum.COLUMNS,
      [],
      ['c1', 'c2'],
      1,
    );
    const colLeafPath = serializePath([
      'C1',
      encodeMetricKey('m1'),
      encodeMeasureLeafKey(ixLeaf.id),
      'C2',
    ]);
    const colMisplacedPath = serializePath([
      'C1',
      encodeMetricKey('m1'),
      'C2',
      encodeMeasureLeafKey(ixLeaf.id),
    ]);
    expect(colTree.cols[colLeafPath]).toBeDefined();
    expect(colTree.cols[colMisplacedPath]).toBeUndefined();
  });

  it('keeps metrics flat when leaf tier is hidden', () => {
    const tree = buildTreeFromRecords(
      [{ region: 'A', m1: 10 }],
      ['m1'],
      ['region'],
      [],
      1,
      0,
    );
    const valueLeaf = buildValueLeaf();
    const flat = applyMeasureHierarchyAxis(
      tree,
      {
        kind: 'measureStackV1',
        groups: [{ metricKey: 'm1', leaves: [valueLeaf] }],
        leafTierVisibility: 'hidden',
      },
      MetricsLayoutEnum.ROWS,
      ['region'],
      [],
      1,
    );
    const metricKey = serializePath(['A', encodeMetricKey('m1')]);
    const leafKey = serializePath([
      'A',
      encodeMetricKey('m1'),
      encodeMeasureLeafKey(valueLeaf.id),
    ]);
    expect(flat.rows[metricKey]).toBeDefined();
    expect(flat.rows[leafKey]).toBeUndefined();
  });

  it('surfaces collapsed column values when a single metric sits between columns with hidden leaves', () => {
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const tree = buildTreeFromRecords(
      [{ c1: 'C1', c2: 'C2', m1: 10 }],
      ['m1'],
      [],
      ['c1', 'c2'],
      0,
      1,
    );
    const withMeasures = applyMeasureHierarchyAxis(
      tree,
      {
        kind: 'measureStackV1',
        groups: [{ metricKey: 'm1', leaves: [valueLeaf, ixLeaf] }],
        leafTierVisibility: 'hidden',
      },
      MetricsLayoutEnum.COLUMNS,
      [],
      ['c1', 'c2'],
      1,
    );
    expect(
      withMeasures.cells[
        serializeCellKey(serializePath([]), serializePath(['C1']))
      ]?.values.m1,
    ).toBe(10);
  });

  it('surfaces collapsed column values when a single metric has visible leaves', () => {
    const valueLeaf = buildValueLeaf();
    const deltaLeaf = buildBuiltInLeaf('delta', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const tree = buildTreeFromRecords(
      [{ c1: 'C1', m1: 10, 'm1__1 year ago': 5 }],
      ['m1'],
      [],
      ['c1'],
      0,
      1,
    );
    const withMeasures = applyMeasureHierarchyAxis(
      tree,
      {
        kind: 'measureStackV1',
        groups: [{ metricKey: 'm1', leaves: [valueLeaf, deltaLeaf] }],
        leafTierVisibility: 'visible',
      },
      MetricsLayoutEnum.COLUMNS,
      [],
      ['c1'],
      1,
    );

    expect(
      withMeasures.cells[
        serializeCellKey(serializePath([]), serializePath(['C1']))
      ]?.values.m1,
    ).toBe(10);
  });
});
