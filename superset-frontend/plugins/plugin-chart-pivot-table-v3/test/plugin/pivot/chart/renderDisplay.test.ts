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
  MetricsLayoutEnum,
  type MeasureHierarchy,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../../src/types';
import {
  buildColumnDisplayPath,
  buildRenderNodeDisplayState,
  expandMetricNodesForRender,
  formatRenderTreeDateLabels,
  resolveColumnHeaderLabel,
} from '../../../../src/pivot/chart/renderDisplay';
import { type PivotProgram } from '../../../../src/pivot/runtime/types';
import {
  encodeMeasureLeafKey,
  encodeMetricKey,
  SUBTOTAL_TOKEN,
} from '../../../../src/pivot/core/tokens';
import { serializePath } from '../../../../src/pivot/core/path';

const node = (path: PivotTreeNode['path'], overrides = {}): PivotTreeNode => ({
  axis: 'col',
  key: path.length === 0 ? '__root__' : serializePath(path),
  path,
  label: String(path[path.length - 1] ?? 'Total'),
  formattedLabel: String(path[path.length - 1] ?? 'Total'),
  level: path.length,
  hasChildren: false,
  ...overrides,
});

const treeFromNodes = ({
  rows = [],
  cols = [],
}: {
  rows?: PivotTreeNode[];
  cols?: PivotTreeNode[];
}): PivotTreeData => ({
  rows: Object.fromEntries(rows.map(row => [row.key, row])),
  cols: Object.fromEntries(cols.map(col => [col.key, col])),
  cells: {},
});

const baseDisplayConfig = {
  allowMetricSubtotalLabels: true,
  getMetricKeyFromPath: (path: PivotTreeNode['path']) =>
    path
      .map(value =>
        typeof value === 'string' && value.startsWith('__metric__')
          ? value.slice('__metric__'.length)
          : undefined,
      )
      .find((value): value is string => Boolean(value)),
  getMetricDisplayLabelForKey: (metricKey: string) =>
    metricKey === 'sales' ? 'Sales' : 'Profit',
  getNonMetricPathParts: (path: PivotTreeNode['path']) =>
    path.filter(
      value =>
        !(typeof value === 'string' && value.startsWith('__metric__')) &&
        value !== SUBTOTAL_TOKEN,
    ),
};

const pivotProgram: PivotProgram = {
  rows: [
    { kind: 'dimension', column: 'country' },
    { kind: 'dimension', column: 'state' },
  ],
  columns: [
    { kind: 'dimension', column: 'month' },
    {
      kind: 'values',
      metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
    },
  ],
  rowDimensions: ['country', 'state'],
  columnDimensions: ['month'],
  metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
  metricKeys: ['sales'],
  metricsLayoutResolved: MetricsLayoutEnum.COLUMNS,
  valueAxis: 'col',
  metricInsertIndex: 1,
};

const dateProgram: PivotProgram = {
  ...pivotProgram,
  rows: [{ kind: 'dimension', column: 'order_date' }],
  columns: [{ kind: 'dimension', column: 'order_date' }],
  rowDimensions: ['order_date'],
  columnDimensions: ['order_date'],
  metrics: [],
  metricKeys: [],
  valueAxis: undefined,
  metricInsertIndex: -1,
};

const columnMetricFirstProgram: PivotProgram = {
  ...pivotProgram,
  columns: [
    {
      kind: 'values',
      metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
    },
    { kind: 'dimension', column: 'month' },
  ],
  valueAxis: 'col',
  metricsLayoutResolved: MetricsLayoutEnum.COLUMNS,
  metricInsertIndex: 0,
};

const rowMetricFirstProgram: PivotProgram = {
  ...pivotProgram,
  rows: [
    {
      kind: 'values',
      metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
    },
    { kind: 'dimension', column: 'country' },
  ],
  columns: [{ kind: 'dimension', column: 'month' }],
  valueAxis: 'row',
  metricsLayoutResolved: MetricsLayoutEnum.ROWS,
  metricInsertIndex: 0,
};

test('pads expanded metric-first column headers to the render depth', () => {
  const col = node([encodeMetricKey('sales')]);

  expect(
    buildColumnDisplayPath(col, 3, {
      ...baseDisplayConfig,
      program: columnMetricFirstProgram,
      isExpanded: () => true,
    }),
  ).toEqual([encodeMetricKey('sales'), SUBTOTAL_TOKEN]);
});

test('labels metric subtotal headers at the end of column dimensions', () => {
  const col = node(['West', encodeMetricKey('sales')], {
    isSubtotal: true,
    hasChildren: true,
  });

  expect(
    buildColumnDisplayPath(col, 2, {
      ...baseDisplayConfig,
      program: pivotProgram,
    }),
  ).toEqual(['West Sales']);
});

test('resolves metric and measure-leaf column header labels', () => {
  const measureHierarchy: MeasureHierarchy = {
    kind: 'measureStackV1',
    leafTierVisibility: 'visible',
    groups: [
      {
        metricKey: 'sales',
        leaves: [
          { kind: 'builtIn', id: 'value', operator: 'value', label: 'Value' },
        ],
      },
    ],
  };

  expect(
    resolveColumnHeaderLabel({
      rawValue: encodeMetricKey('sales'),
      measureHierarchy,
      getMetricDisplayLabelForKey: () => 'Sales',
    }),
  ).toBe('Sales');
  expect(
    resolveColumnHeaderLabel({
      rawValue: encodeMeasureLeafKey('value'),
      measureHierarchy,
      getMetricDisplayLabelForKey: () => 'Sales',
    }),
  ).toBe('Value');
});

test('adds metric nodes to expanded render state only when the leaf tier is visible', () => {
  const metricNode = node(['West', encodeMetricKey('sales')]);
  const expanded = new Set<string>();
  const nodes = { [metricNode.key]: metricNode };

  expect(
    expandMetricNodesForRender({
      expanded,
      nodes,
      isLeafTierVisible: false,
      program: pivotProgram,
    }),
  ).toBe(expanded);
  expect(
    expandMetricNodesForRender({
      expanded,
      nodes,
      isLeafTierVisible: true,
      program: pivotProgram,
    }).has(metricNode.key),
  ).toBe(true);
});

test('formats render tree date labels for row and column dimensions', () => {
  const rowDate = node(['1704067200000'], { axis: 'row' });
  const colDate = node(['2024-02-01']);
  const tree = treeFromNodes({ rows: [rowDate], cols: [colDate] });

  const formattedTree = formatRenderTreeDateLabels({
    tree,
    dateFormatters: {
      order_date: value => `date:${new Date(Number(value)).getUTCMonth() + 1}`,
    },
    program: dateProgram,
  });

  expect(formattedTree).not.toBe(tree);
  expect(formattedTree.rows[rowDate.key]).toEqual({
    ...rowDate,
    formattedLabel: 'date:1',
  });
  expect(formattedTree.cols[colDate.key]).toEqual({
    ...colDate,
    formattedLabel: 'date:2',
  });
  expect(formattedTree.cells).toBe(tree.cells);
});

test('preserves render tree references when date formatting makes no changes', () => {
  const rowDate = node(['2024-01-01'], {
    axis: 'row',
    formattedLabel: 'same',
  });
  const tree = treeFromNodes({ rows: [rowDate] });

  expect(
    formatRenderTreeDateLabels({
      tree,
      dateFormatters: {
        order_date: () => 'same',
      },
      program: dateProgram,
    }),
  ).toBe(tree);
});

test('skips root, subtotal, metric, measure leaf, and non-date render labels', () => {
  const root = node([], { axis: 'row' });
  const subtotal = node(['2024-01-01', SUBTOTAL_TOKEN], { axis: 'row' });
  const metric = node(['2024-01-01', encodeMetricKey('sales')], {
    axis: 'row',
  });
  const measureLeaf = node(['2024-01-01', encodeMeasureLeafKey('value')], {
    axis: 'row',
  });
  const nonDate = node(['not-a-date'], { axis: 'row' });
  const tree = treeFromNodes({
    rows: [root, subtotal, metric, measureLeaf, nonDate],
  });

  expect(
    formatRenderTreeDateLabels({
      tree,
      dateFormatters: {
        order_date: () => 'formatted',
      },
      program: dateProgram,
    }),
  ).toBe(tree);
});

test('builds render node display state for toggles and aggregate emphasis', () => {
  const country = node(['US'], {
    axis: 'row',
    hasChildren: true,
  });
  const subtotal = node(['US', SUBTOTAL_TOKEN], {
    axis: 'row',
    isSubtotal: true,
    hasChildren: true,
  });
  const metricSubtotal = node(['US', encodeMetricKey('sales')], {
    isSubtotal: true,
  });
  const rows = { [country.key]: country, [subtotal.key]: subtotal };
  const state = buildRenderNodeDisplayState({
    rowNodes: rows,
    expandedRows: new Set([country.key]),
    layout: {
      hideMetricHeaderOnRows: false,
      layout: { pivotProgram },
    },
    isLeafTierVisible: false,
  });

  expect(state.shouldShowToggle('row', country)).toBe(true);
  expect(state.shouldShowToggle('row', node([], { axis: 'row' }))).toBe(false);
  expect(state.shouldShowToggle('row', subtotal)).toBe(false);
  expect(state.isRowAggregateBold(country)).toBe(true);
  expect(state.isColAggregateBold(metricSubtotal)).toBe(true);
  expect(state.getNodeDimDepth(country)).toBe(1);
});

test('hides metric toggles when measure leaves are visible', () => {
  const metricNode = node([encodeMetricKey('sales')], {
    axis: 'row',
    hasChildren: true,
  });
  const state = buildRenderNodeDisplayState({
    rowNodes: { [metricNode.key]: metricNode },
    expandedRows: new Set<string>(),
    layout: {
      hideMetricHeaderOnRows: false,
      layout: { pivotProgram: rowMetricFirstProgram },
    },
    isLeafTierVisible: true,
  });

  expect(state.shouldShowToggle('row', metricNode)).toBe(false);
});
