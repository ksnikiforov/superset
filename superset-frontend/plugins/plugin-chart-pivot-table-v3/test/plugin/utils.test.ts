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

import { MetricsLayoutEnum, PivotTreeData } from '../../src/types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  mergeTrees,
  METRICS_PLACEHOLDER,
  normalizeSubtotalLevels,
  labelRowSubtotalLeaves,
  resolveMetricPlacement,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../src/utils';

const baseTree: PivotTreeData = {
  rows: {
    '': {
      axis: 'row',
      key: '',
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
      hasChildren: true,
    },
  },
  cols: {
    '': {
      axis: 'col',
      key: '',
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: true,
    },
  },
  cells: {
    [`${serializePath(['A'])}|`]: {
      rowKey: serializePath(['A']),
      colKey: '',
      values: { m1: 10 },
    },
  },
};

describe('applyMetricAxis', () => {
  it('preserves dimension nodes when metrics are inserted at the front of rows', () => {
    const result = applyMetricAxis(
      baseTree,
      ['m1'],
      MetricsLayoutEnum.ROWS,
      ['r1'],
      [],
      0,
    );

    expect(result.rows[serializePath(['A'])]).toBeDefined();
    expect(result.rows[serializePath(['m1'])]).toBeDefined();
  });

  it('preserves dimension nodes when metrics are inserted at the front of columns', () => {
    const result = applyMetricAxis(
      baseTree,
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
      0,
    );

    expect(result.cols[serializePath([])]).toBeDefined();
    expect(result.cols[serializePath(['m1'])]).toBeDefined();
  });

  it('surfaces single metric values on the base column when the metric is first', () => {
    const tree = {
      rows: {
        '': {
          axis: 'row',
          key: '',
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
        '': {
          axis: 'col',
          key: '',
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
        [`${serializePath(['A'])}|${serializePath(['AUTO'])}`]: {
          rowKey: serializePath(['A']),
          colKey: serializePath(['AUTO']),
          values: { m1: 10 },
        },
      },
    } as PivotTreeData;

    const withMetrics = applyMetricAxis(
      tree,
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
      0,
    );

    expect(withMetrics.cells['A|AUTO']?.values.m1).toBe(10);
    expect(withMetrics.cells['A|']?.values.m1).toBe(10);
  });

  it('surfaces single metric values at the base row when the metric is not first', () => {
    const tree = {
      rows: {
        '': {
          axis: 'row',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        USA: {
          axis: 'row',
          key: serializePath(['USA']),
          path: ['USA'],
          label: 'USA',
          formattedLabel: 'USA',
          level: 1,
          hasChildren: true,
        },
      },
      cols: {
        '': {
          axis: 'col',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        BUILDING: {
          axis: 'col',
          key: serializePath(['BUILDING']),
          path: ['BUILDING'],
          label: 'BUILDING',
          formattedLabel: 'BUILDING',
          level: 1,
          hasChildren: false,
        },
      },
      cells: {
        [`${serializePath(['USA'])}|${serializePath(['BUILDING'])}`]: {
          rowKey: serializePath(['USA']),
          colKey: serializePath(['BUILDING']),
          values: { countCustomers: 10 },
        },
      },
    } as PivotTreeData;

    const withMetrics = applyMetricAxis(
      tree,
      ['countCustomers'],
      MetricsLayoutEnum.ROWS,
      ['nation', 'orderPriority'],
      ['segment'],
      1,
    );

    expect(withMetrics.cells['USA|BUILDING']?.values.countCustomers).toBe(10);
    expect(
      withMetrics.cells['USA__countCustomers|BUILDING']?.values.countCustomers,
    ).toBe(10);
  });
});

describe('applyMetricAxis + buildTreeFromRecords integration', () => {
  it('populates metric cells when metrics are on columns with no column groupby', () => {
    const tree = buildTreeFromRecords(
      [{ priority: '1-URGENT', weightedDiscount: 0.05 }],
      ['weightedDiscount'],
      ['priority'],
      [],
      1,
      0,
    );
    const withMetrics = applyMetricAxis(
      tree,
      ['weightedDiscount'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      [],
      0,
    );
    expect(
      withMetrics.cells['1-URGENT|weightedDiscount']?.values.weightedDiscount,
    ).toBe(0.05);
  });

  it('merges branch data for metrics on columns when expanding column dimension', () => {
    const baseTreeRaw = buildTreeFromRecords(
      [{ priority: '1-URGENT', weightedDiscount: 0.05 }],
      ['weightedDiscount'],
      ['priority'],
      [],
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['weightedDiscount'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      [],
      0,
    );

    const branchRaw = buildTreeFromRecords(
      [
        {
          priority: '1-URGENT',
          segment: 'Consumer',
          weightedDiscount: 0.05,
        },
      ],
      ['weightedDiscount'],
      ['priority'],
      ['segment'],
      1,
      1,
    );
    const branchWithMetrics = applyMetricAxis(
      branchRaw,
      ['weightedDiscount'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      ['segment'],
      0,
    );

    const merged = mergeTrees(baseTree, branchWithMetrics);
    expect(
      merged.cells['1-URGENT|weightedDiscount__Consumer']?.values
        .weightedDiscount,
    ).toBe(0.05);
  });

  it('populates collapsed column cells when there is a single metric', () => {
    const tree = buildTreeFromRecords(
      [{ priority: '1-URGENT', category: 'AUTO', metric1: 10 }],
      ['metric1'],
      ['priority'],
      ['category'],
      1,
      1,
    );
    const withMetrics = applyMetricAxis(
      tree,
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      ['category'],
      1,
    );
    expect(withMetrics.cells['1-URGENT|AUTO']?.values.metric1).toBe(10);
  });

  it('populates collapsed row cells when there is a single metric', () => {
    const tree = buildTreeFromRecords(
      [{ priority: '1-URGENT', sub: 'SUB1', metric1: 20 }],
      ['metric1'],
      ['priority', 'sub'],
      [],
      2,
      0,
    );
    const withMetrics = applyMetricAxis(
      tree,
      ['metric1'],
      MetricsLayoutEnum.ROWS,
      ['priority', 'sub'],
      [],
      2,
    );
    expect(withMetrics.cells['1-URGENT__SUB1|']?.values.metric1).toBe(20);
  });

  it('sets grand total labels and intersection from grand-total queries', () => {
    const rootKey = serializePath([]);
    const tree = buildTreeFromRecords(
      [{ metric1: 99 }],
      ['metric1'],
      [],
      [],
      0,
      0,
    );
    expect(tree.rows[rootKey].label).toEqual('Grand total');
    expect(tree.cols[rootKey].label).toEqual('Grand total');
    expect(tree.cells[`${rootKey}|${rootKey}`]?.values.metric1).toBe(99);
  });

  it('preserves grand total cell when merging deeper branches', () => {
    const rootKey = serializePath([]);
    const totals = buildTreeFromRecords(
      [{ metric1: 1500000 }],
      ['metric1'],
      ['letter'],
      [],
      0,
      0,
    );
    const branch = buildTreeFromRecords(
      [
        { letter: 'F', metric1: 100 },
        { letter: 'O', metric1: 200 },
      ],
      ['metric1'],
      ['letter'],
      [],
      1,
      0,
    );
    const merged = mergeTrees(totals, branch);
    expect(merged.cells[`${rootKey}|${rootKey}`]?.values.metric1).toBe(1500000);
  });
});

describe('resolveMetricPlacement', () => {
  it('dedupes placeholder across axes favoring last moved', () => {
    const resolved = resolveMetricPlacement(
      ['region', METRICS_PLACEHOLDER],
      [METRICS_PLACEHOLDER],
      {
        hasMetrics: true,
        preferredAxis: MetricsLayoutEnum.COLUMNS,
        lastMoved: 'row',
      },
    );
    expect(resolved.axis).toEqual('row');
    expect(resolved.rows).toEqual(['region', METRICS_PLACEHOLDER]);
    expect(resolved.cols).toEqual([]);
    expect(resolved.layout).toEqual(MetricsLayoutEnum.ROWS);
  });

  it('removes placeholder when metrics are empty', () => {
    const resolved = resolveMetricPlacement(
      ['country', METRICS_PLACEHOLDER],
      [],
      { hasMetrics: false, preferredAxis: MetricsLayoutEnum.COLUMNS },
    );
    expect(resolved.rows).toEqual(['country']);
    expect(resolved.cols).toEqual([]);
    expect(resolved.metricPosition).toBe(-1);
  });

  it('auto-inserts placeholder on preferred axis when missing', () => {
    const resolved = resolveMetricPlacement(
      ['country'],
      ['segment'],
      { hasMetrics: true, preferredAxis: MetricsLayoutEnum.COLUMNS },
    );
    expect(resolved.axis).toEqual('col');
    expect(resolved.cols).toEqual(['segment', METRICS_PLACEHOLDER]);
    expect(resolved.layout).toEqual(MetricsLayoutEnum.COLUMNS);
    expect(resolved.metricPosition).toBe(1);
  });
});

describe('normalizeSubtotalLevels', () => {
  it('applies legacy totals/subtotals flags', () => {
    expect(normalizeSubtotalLevels(undefined, 3, true, true)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('filters out-of-range levels and dedupes', () => {
    expect(normalizeSubtotalLevels([0, 1, 5, 1], 2, false, false)).toEqual([
      0, 1,
    ]);
  });
});

describe('labelRowSubtotalLeaves', () => {
  it('uses "<Group> Total" when there is a single metric', () => {
    const rootKey = serializePath([]);
    const subtotalKey = serializePath(['Bikes', SUBTOTAL_TOKEN, 'metric1']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: {
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Grand total',
          formattedLabel: 'Grand total',
          level: 0,
          hasChildren: true,
          isSubtotal: true,
        },
        [subtotalKey]: {
          axis: 'row',
          key: subtotalKey,
          path: ['Bikes', SUBTOTAL_TOKEN, 'metric1'],
          label: 'Subtotal',
          formattedLabel: 'Subtotal',
          level: 3,
          hasChildren: false,
          isSubtotal: true,
        },
      },
      cols: {
        [rootKey]: {
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Grand total',
          formattedLabel: 'Grand total',
          level: 0,
          hasChildren: false,
          isSubtotal: true,
        },
      },
      cells: {},
    };

    const labeled = labelRowSubtotalLeaves(tree, ['metric1']);
    expect(labeled.rows[subtotalKey]?.label).toBe('Bikes Total');
    expect(labeled.rows[subtotalKey]?.formattedLabel).toBe('Bikes Total');
  });

  it('uses "<Group> <Metric>" when the subtotal token follows a metric', () => {
    const rootKey = serializePath([]);
    const subtotalKey = serializePath(['Bikes', 'metric1', SUBTOTAL_TOKEN]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: {
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Grand total',
          formattedLabel: 'Grand total',
          level: 0,
          hasChildren: true,
          isSubtotal: true,
        },
        [subtotalKey]: {
          axis: 'row',
          key: subtotalKey,
          path: ['Bikes', 'metric1', SUBTOTAL_TOKEN],
          label: 'Subtotal',
          formattedLabel: 'Subtotal',
          level: 3,
          hasChildren: false,
          isSubtotal: true,
        },
      },
      cols: {
        [rootKey]: {
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Grand total',
          formattedLabel: 'Grand total',
          level: 0,
          hasChildren: false,
          isSubtotal: true,
        },
      },
      cells: {},
    };

    const labeled = labelRowSubtotalLeaves(tree, ['metric1', 'metric2']);
    expect(labeled.rows[subtotalKey]?.label).toBe('Bikes metric1');
    expect(labeled.rows[subtotalKey]?.formattedLabel).toBe('Bikes metric1');
  });
});