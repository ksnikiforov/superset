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

import { DataRecordValue } from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  PivotTreeData,
  PivotTreeNode,
} from '../../src/types';
import { buildColumnHeaderRows } from '../../src/pivot/viewModel';
import {
  normalizeSubtotalLevels,
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  parseThemeColors,
  transferDimensionSettingsAcrossAxes,
} from '../../src/utils';
import {
  decodeMetricKey,
  encodeMetricKey,
  SUBTOTAL_TOKEN,
} from '../../src/pivot/core/tokens';
import { serializeCellKey, serializePath } from '../../src/pivot/core/path';
import { formatPivotLabelValue } from '../../src/pivot/viewModel';
import { buildTreeFromRecords } from './fixtures/buildTreeFromRecords';
import { labelRowSubtotalLeaves, applyMetricAxis } from './fixtures/metricAxis';
import { mergeTrees } from './fixtures/tree';

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
    [serializeCellKey(serializePath(['A']), rootKey)]: {
      rowKey: serializePath(['A']),
      colKey: rootKey,
      values: { m1: 10 },
    },
  },
};

describe('null label formatting', () => {
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

  it('renders null column headers as (NULL)', () => {
    const nullKey = serializePath([null]);
    const nullNode: PivotTreeNode = {
      axis: 'col',
      key: nullKey,
      path: [null],
      label: '',
      formattedLabel: '',
      level: 1,
      hasChildren: false,
      isSubtotal: false,
    };
    const rows = buildColumnHeaderRows([nullNode], {});
    expect(rows[0][0].node.label).toBe('(NULL)');
    expect(rows[0][0].node.formattedLabel).toBe('(NULL)');
  });

  it('uses the deepest column path length for header rows', () => {
    const colKey = serializePath(['A', 'B', 'C']);
    const colNode: PivotTreeNode = {
      axis: 'col',
      key: colKey,
      path: ['A', 'B', 'C'],
      label: 'C',
      formattedLabel: 'C',
      level: 3,
      hasChildren: false,
      isSubtotal: false,
    };
    const rows = buildColumnHeaderRows([colNode], {});
    expect(rows).toHaveLength(3);
  });
});

describe('metric label display', () => {
  it('uses metric display labels in column headers', () => {
    const metricKey = 'sum__revenue';
    const metricLabelMap: Record<string, string> = {
      [metricKey]: 'Revenue',
    };
    const colKey = serializePath([encodeMetricKey(metricKey)]);
    const colNode: PivotTreeNode = {
      axis: 'col',
      key: colKey,
      path: [encodeMetricKey(metricKey)],
      label: metricKey,
      formattedLabel: metricKey,
      level: 1,
      hasChildren: false,
      isSubtotal: false,
    };
    const resolveHeaderLabel = (rawValue: unknown) => {
      const decoded = decodeMetricKey(rawValue);
      if (decoded && metricLabelMap[decoded]) {
        return metricLabelMap[decoded];
      }
      return formatPivotLabelValue(rawValue as DataRecordValue, '');
    };
    const rows = buildColumnHeaderRows(
      [colNode],
      {},
      undefined,
      resolveHeaderLabel,
    );
    expect(rows[0][0].node.label).toBe('Revenue');
  });
});

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
    expect(result.rows[serializePath([encodeMetricKey('m1')])]).toBeDefined();
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

    expect(result.cols[rootKey]).toBeDefined();
    expect(result.cols[serializePath([encodeMetricKey('m1')])]).toBeDefined();
  });

  it('uses metric display labels when provided', () => {
    const metricKey = 'sum__revenue';
    const metricLabelMap: Record<string, string> = {
      [metricKey]: 'Revenue',
    };
    const result = applyMetricAxis(
      baseTree,
      [metricKey],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
      0,
      metricLabelMap,
    );
    const metricNode = result.cols[serializePath([encodeMetricKey(metricKey)])];
    expect(metricNode.label).toBe('Revenue');
    expect(metricNode.formattedLabel).toBe('Revenue');
  });

  it('surfaces single metric values on the base column when the metric is first', () => {
    const tree = {
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
    } as PivotTreeData;

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
        serializeCellKey(serializePath(['A']), serializePath(['AUTO']))
      ]?.values.m1,
    ).toBe(10);
    expect(
      withMetrics.cells[serializeCellKey(serializePath(['A']), rootKey)]?.values
        .m1,
    ).toBe(10);
  });

  it('surfaces single metric values at the base row when the metric is not first', () => {
    const tree = {
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
        [rootKey]: {
          axis: 'col',
          key: rootKey,
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
        [serializeCellKey(serializePath(['USA']), serializePath(['BUILDING']))]:
          {
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

    expect(
      withMetrics.cells[
        serializeCellKey(serializePath(['USA']), serializePath(['BUILDING']))
      ]?.values.countCustomers,
    ).toBe(10);
    expect(
      withMetrics.cells[
        serializeCellKey(
          serializePath(['USA', encodeMetricKey('countCustomers')]),
          serializePath(['BUILDING']),
        )
      ]?.values.countCustomers,
    ).toBe(10);
  });
});

describe('parseThemeColors', () => {
  it('accepts common CSS color formats', () => {
    expect(
      parseThemeColors(
        ' #abc, rgb(10,20,30), rgba(10, 20, 30, 0.5), hsl(120, 30%, 40%), blue, nope(1) ',
      ),
    ).toEqual([
      '#aabbcc',
      'rgb(10, 20, 30)',
      'rgba(10, 20, 30, 0.5)',
      'hsl(120, 30%, 40%)',
      'blue',
    ]);
  });
});

describe('transferDimensionSettingsAcrossAxes', () => {
  it('keeps only canonical dimension keys for formatting and sorting', () => {
    const columns = [
      {
        expressionType: 'SQL' as const,
        label: 'canonical_dimension',
        sqlExpression: 'UPPER(country)',
      },
    ];

    expect(
      normalizeDimensionFormattingMapWithKeys(
        {
          canonical_dimension: {
            backgroundColor: 'metric1',
            applyTo: 'all',
          },
          'UPPER(country)': {
            textColor: 'metric2',
            applyTo: 'label',
          },
          country: {
            backgroundColor: 'metric3',
            applyTo: 'all',
          },
        },
        columns,
      ),
    ).toEqual({
      canonical_dimension: {
        backgroundColor: 'metric1',
        applyTo: 'all',
      },
    });

    expect(
      normalizeDimensionSortingMapWithKeys(
        {
          canonical_dimension: { metric: 'metric1', order: 'desc' },
          'UPPER(country)': { metric: 'metric2', order: 'asc' },
        },
        columns,
      ),
    ).toEqual({
      canonical_dimension: {
        metric: 'metric1',
        order: 'desc',
        mode: 'total',
      },
    });
  });

  it('moves formatting and sorting settings when axes change', () => {
    const result = transferDimensionSettingsAcrossAxes(
      ['country'],
      ['state'],
      ['state'],
      ['country'],
      {
        rowFormatting: {
          country: { backgroundColor: 'metric1', applyTo: 'all' },
        },
        colFormatting: {
          state: { textColor: 'metric2', applyTo: 'label' },
        },
        rowSorting: {
          country: { order: 'desc', mode: 'total' },
        },
        colSorting: {
          state: { metric: 'metric1', order: 'asc', mode: 'total' },
        },
      },
    );

    expect(result.hasAxisChanges).toBe(true);
    expect(result.rowFormatting).toEqual({
      state: { textColor: 'metric2', applyTo: 'label' },
    });
    expect(result.colFormatting).toEqual({
      country: { backgroundColor: 'metric1', applyTo: 'all' },
    });
    expect(result.rowSorting).toEqual({
      state: { metric: 'metric1', order: 'asc', mode: 'total' },
    });
    expect(result.colSorting).toEqual({
      country: { order: 'desc', mode: 'total' },
    });
  });

  it('keeps settings when axes stay the same', () => {
    const result = transferDimensionSettingsAcrossAxes(
      ['country'],
      ['state'],
      ['country'],
      ['state'],
      {
        rowFormatting: {
          country: { backgroundColor: 'metric1', applyTo: 'all' },
        },
        colFormatting: {
          state: { textColor: 'metric2', applyTo: 'label' },
        },
        rowSorting: {
          country: { order: 'desc', mode: 'total' },
        },
        colSorting: {
          state: { metric: 'metric1', order: 'asc', mode: 'total' },
        },
      },
    );

    expect(result.hasAxisChanges).toBe(false);
    expect(result.rowFormatting).toEqual({
      country: { backgroundColor: 'metric1', applyTo: 'all' },
    });
    expect(result.colFormatting).toEqual({
      state: { textColor: 'metric2', applyTo: 'label' },
    });
    expect(result.rowSorting).toEqual({
      country: { order: 'desc', mode: 'total' },
    });
    expect(result.colSorting).toEqual({
      state: { metric: 'metric1', order: 'asc', mode: 'total' },
    });
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
      withMetrics.cells[
        serializeCellKey(
          serializePath(['1-URGENT']),
          serializePath([encodeMetricKey('weightedDiscount')]),
        )
      ]?.values.weightedDiscount,
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
      merged.cells[
        serializeCellKey(
          serializePath(['1-URGENT']),
          serializePath([encodeMetricKey('weightedDiscount'), 'Consumer']),
        )
      ]?.values.weightedDiscount,
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
    expect(
      withMetrics.cells[
        serializeCellKey(serializePath(['1-URGENT']), serializePath(['AUTO']))
      ]?.values.metric1,
    ).toBe(10);
  });

  it('populates collapsed column cells when a single metric sits between columns', () => {
    const tree = buildTreeFromRecords(
      [
        {
          priority: '1-URGENT',
          category: 'AUTO',
          subcategory: 'SUB1',
          metric1: 10,
        },
      ],
      ['metric1'],
      ['priority'],
      ['category', 'subcategory'],
      1,
      1,
    );
    const withMetrics = applyMetricAxis(
      tree,
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      ['category', 'subcategory'],
      1,
    );
    expect(
      withMetrics.cells[
        serializeCellKey(serializePath(['1-URGENT']), serializePath(['AUTO']))
      ]?.values.metric1,
    ).toBe(10);
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
    expect(
      withMetrics.cells[
        serializeCellKey(serializePath(['1-URGENT', 'SUB1']), serializePath([]))
      ]?.values.metric1,
    ).toBe(20);
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
    expect(tree.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1).toBe(
      99,
    );
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
    expect(
      merged.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1,
    ).toBe(1500000);
  });

  it('preserves row totals when merging detail rows with column groupbys', () => {
    const totals = buildTreeFromRecords(
      [
        { country: 'US', metric1: 30 },
        { country: 'CA', metric1: 70 },
      ],
      ['metric1'],
      ['country'],
      ['state'],
      1,
      0,
    );
    const detail = buildTreeFromRecords(
      [
        { country: 'US', state: 'CA', metric1: 10 },
        { country: 'US', state: 'NY', metric1: 20 },
        { country: 'CA', state: 'ON', metric1: 30 },
        { country: 'CA', state: 'QC', metric1: 40 },
      ],
      ['metric1'],
      ['country'],
      ['state'],
      1,
      1,
    );
    const merged = mergeTrees(totals, detail);
    expect(merged.rows[serializePath(['US'])]?.values?.metric1).toBe(30);
    expect(merged.rows[serializePath(['CA'])]?.values?.metric1).toBe(70);
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
    const subtotalKey = serializePath([
      'Bikes',
      SUBTOTAL_TOKEN,
      encodeMetricKey('metric1'),
    ]);
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
          path: ['Bikes', SUBTOTAL_TOKEN, encodeMetricKey('metric1')],
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
    const subtotalKey = serializePath([
      'Bikes',
      encodeMetricKey('metric1'),
      SUBTOTAL_TOKEN,
    ]);
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
          path: ['Bikes', encodeMetricKey('metric1'), SUBTOTAL_TOKEN],
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
