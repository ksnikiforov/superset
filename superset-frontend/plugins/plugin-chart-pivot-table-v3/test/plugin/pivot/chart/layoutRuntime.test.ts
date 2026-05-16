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
import { MetricsLayoutEnum, type PivotTreeNode } from '../../../../src/types';
import {
  buildMetricOrderComparator,
  resolveAxisChildrenBeforeSubtotalPolicy,
  resolveCollapsedValuesNodesForAxis,
  resolveMetricAxisLayoutPolicy,
  resolveRowSubtotalChildrenPolicy,
} from '../../../../src/pivot/chart/layoutRuntime';
import type {
  PivotAxisProgram,
  PivotColumnRef,
  PivotMetricRef,
  PivotProgram,
} from '../../../../src/pivot/runtime/types';
import {
  encodeMeasureLeafKey,
  encodeMetricKey,
  SUBTOTAL_TOKEN,
} from '../../../../src/pivot/core/tokens';
import { serializePath } from '../../../../src/pivot/core/path';

const node = (axis: 'row' | 'col', path: PivotTreeNode['path']) => ({
  axis,
  key: path.length === 0 ? '__root__' : serializePath(path),
  path,
  label: String(path[path.length - 1] ?? 'Total'),
  formattedLabel: String(path[path.length - 1] ?? 'Total'),
  level: path.length,
  hasChildren: false,
});

const baseParams = {
  resolvedExpandRowsLevel: 0,
  resolvedExpandColumnsLevel: 0,
  metricLabelSet: new Set(['sales']),
  isMetricTokenValue: (value: unknown) =>
    typeof value === 'string' && value.startsWith('__metric__'),
  isLeafTierVisible: false,
  rowSubTotals: false,
  resolvedRowSubtotalPosition: 'start' as const,
  resolvedColSubtotalPosition: 'start' as const,
};

const baseProgram: PivotProgram = {
  rows: [
    {
      kind: 'values',
      metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
    },
  ],
  columns: [],
  rowDimensions: [],
  columnDimensions: [],
  metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
  metricKeys: ['sales'],
  metricsLayoutResolved: MetricsLayoutEnum.ROWS,
  valueAxis: 'row',
  metricInsertIndex: 0,
};

const toMetricRefs = (keys: string[]): PivotMetricRef[] =>
  keys.map((key, index) => ({ key, metric: key, index }));

const toDimensionLevels = (dimensions: PivotColumnRef[]): PivotAxisProgram =>
  dimensions.map(column => ({
    kind: 'dimension',
    column,
  }));

const withValuesLevel = (
  dimensions: PivotColumnRef[],
  metrics: PivotMetricRef[],
  insertIndex: number,
): PivotAxisProgram => [
  ...toDimensionLevels(dimensions.slice(0, insertIndex)),
  { kind: 'values', metrics },
  ...toDimensionLevels(dimensions.slice(insertIndex)),
];

const policyProgram = (overrides: Partial<PivotProgram>): PivotProgram => {
  const program = { ...baseProgram, ...overrides };
  const metrics = toMetricRefs(program.metricKeys);
  return {
    ...program,
    metrics,
    rows:
      program.valueAxis === 'row'
        ? withValuesLevel(
            program.rowDimensions,
            metrics,
            program.metricInsertIndex,
          )
        : toDimensionLevels(program.rowDimensions),
    columns:
      program.valueAxis === 'col'
        ? withValuesLevel(
            program.columnDimensions,
            metrics,
            program.metricInsertIndex,
          )
        : toDimensionLevels(program.columnDimensions),
  };
};

const valuesProgram: PivotProgram = {
  rows: [
    { kind: 'dimension', column: 'country' },
    {
      kind: 'values',
      metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
    },
    { kind: 'dimension', column: 'quarter' },
  ],
  columns: [],
  rowDimensions: ['country', 'quarter'],
  columnDimensions: [],
  metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
  metricKeys: ['sales'],
  metricsLayoutResolved: MetricsLayoutEnum.ROWS,
  valueAxis: 'row',
  metricInsertIndex: 1,
};

describe('pivot/chart/layoutRuntime', () => {
  it('orders metric nodes by compiled metric order', () => {
    const comparator = buildMetricOrderComparator({
      metricKeys: ['sales', 'profit'],
      measureHierarchy: {
        kind: 'flatMetrics',
        metricKeys: ['sales', 'profit'],
      },
      getMetricLabelFromPath: path =>
        path.includes(encodeMetricKey('sales'))
          ? 'sales'
          : path.includes(encodeMetricKey('profit'))
            ? 'profit'
            : undefined,
    });

    expect(
      comparator(
        node('row', [encodeMetricKey('profit')]),
        node('row', [encodeMetricKey('sales')]),
      ),
    ).toBeGreaterThan(0);
  });

  it('orders measure leaves within the same metric', () => {
    const comparator = buildMetricOrderComparator({
      metricKeys: ['sales'],
      measureHierarchy: {
        kind: 'measureStackV1',
        leafTierVisibility: 'visible',
        groups: [
          {
            metricKey: 'sales',
            leaves: [
              { kind: 'builtIn', id: 'current', operator: 'value', label: '' },
              { kind: 'builtIn', id: 'delta', operator: 'delta', label: '' },
            ],
          },
        ],
      },
      getMetricLabelFromPath: () => 'sales',
    });

    expect(
      comparator(
        node('row', [encodeMetricKey('sales'), encodeMeasureLeafKey('delta')]),
        node('row', [
          encodeMetricKey('sales'),
          encodeMeasureLeafKey('current'),
        ]),
      ),
    ).toBeGreaterThan(0);
  });

  it('uses the compiled row metric position before rendered nodes exist', () => {
    const policy = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      program: policyProgram({
        rowDimensions: ['r1', 'r2', 'r3'],
        metricInsertIndex: 1,
      }),
    });

    expect(policy.metricIndexOnRows).toBe(1);
    expect(policy.singleMetricBetweenRows).toBe(true);
    expect(policy.shouldExpandMetricRows).toBe(false);
  });

  it('uses the compiled column metric position without inspecting shallow rendered data', () => {
    const policy = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      program: policyProgram({
        columnDimensions: ['c1', 'c2'],
        metricInsertIndex: 2,
        metricsLayoutResolved: MetricsLayoutEnum.COLUMNS,
        valueAxis: 'col',
      }),
    });

    expect(policy.metricIndexOnCols).toBe(2);
    expect(policy.metricsAtColEnd).toBe(true);
  });

  it('forces row subtotals to the end for multi-metric row layouts after dimensions', () => {
    const policy = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      program: policyProgram({
        rowDimensions: ['r1'],
        metricKeys: ['sales', 'profit'],
        metricInsertIndex: 1,
      }),
      rowSubTotals: true,
      resolvedRowSubtotalPosition: 'start',
    });

    expect(policy.metricsFirstOnRows).toBe(false);
    expect(policy.forceRowSubtotalEnd).toBe(true);
    expect(policy.effectiveRowSubtotalPosition).toBe('end');
  });

  it('hides a redundant single row metric header only when the leaf tier is absent', () => {
    const program = policyProgram({
      rowDimensions: ['r1'],
      metricInsertIndex: 1,
    });
    const withoutLeafTier = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      program,
    });
    const withLeafTier = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      program,
      isLeafTierVisible: true,
    });

    expect(withoutLeafTier.hideMetricHeaderOnRows).toBe(true);
    expect(withLeafTier.hideMetricHeaderOnRows).toBe(false);
  });

  it('filters hidden metric-header children before subtotal placement', () => {
    const parent = node('row', ['West']);
    const metricChild = node('row', ['West', encodeMetricKey('sales')]);
    const nodes = {
      [parent.key]: parent,
      [metricChild.key]: metricChild,
    };

    expect(
      resolveAxisChildrenBeforeSubtotalPolicy({
        program: policyProgram({
          rowDimensions: ['country'],
          metricInsertIndex: 1,
        }),
        axis: 'row',
        parent,
        nodes,
        hideMetricHeader: true,
        isMetricTokenValue: baseParams.isMetricTokenValue,
        isMetricGrandTotalNode: () => false,
        keepValuesChild: () => true,
      }),
    ).toEqual([]);
  });

  it('removes metric grand totals from metric-first child lists', () => {
    const parent = node('row', [encodeMetricKey('sales')]);
    const dimensionChild = node('row', [encodeMetricKey('sales'), 'West']);
    const metricTotal = {
      ...node('row', [encodeMetricKey('sales'), SUBTOTAL_TOKEN]),
      isSubtotal: true,
    };
    const nodes = {
      [parent.key]: parent,
      [dimensionChild.key]: dimensionChild,
      [metricTotal.key]: metricTotal,
    };

    expect(
      resolveAxisChildrenBeforeSubtotalPolicy({
        program: policyProgram({
          rowDimensions: ['region'],
          metricInsertIndex: 0,
        }),
        axis: 'row',
        parent,
        nodes,
        hideMetricHeader: false,
        isMetricTokenValue: baseParams.isMetricTokenValue,
        isMetricGrandTotalNode: child => child?.isSubtotal === true,
        keepValuesChild: () => true,
      }),
    ).toEqual([dimensionChild]);
  });

  it('projects collapsed Values metric nodes from deeper source metric paths', () => {
    const parent = node('row', ['West']);
    const metricNode = node('row', ['West', 'Q1', encodeMetricKey('sales')]);
    const nodes = {
      [parent.key]: parent,
      [metricNode.key]: metricNode,
    };

    const collapsed = resolveCollapsedValuesNodesForAxis({
      program: valuesProgram,
      metricLabelSet: baseParams.metricLabelSet,
      axis: 'row',
      parent,
      expandedSet: new Set<string>(),
      nodes,
      exposeCollapsedMetricTier: true,
      metricsAtEnd: false,
      suppressSubtotalParent: true,
      normalizeSubtotalExisting: false,
      isMetricTokenValue: baseParams.isMetricTokenValue,
      isExplicitSubtotalNode: () => false,
      isMetricSubtotalNode: () => false,
    });

    expect(collapsed).toEqual([
      expect.objectContaining({
        key: serializePath(['West', encodeMetricKey('sales')]),
        path: ['West', encodeMetricKey('sales')],
        label: 'sales',
        formattedLabel: 'sales',
        hasChildren: true,
      }),
    ]);
  });

  it('normalizes existing subtotal metric nodes for collapsed column leaves', () => {
    const parent = node('col', ['West']);
    const metricNode = {
      ...node('col', ['West', encodeMetricKey('sales')]),
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      isSubtotal: true,
    };
    const nodes = {
      [parent.key]: parent,
      [metricNode.key]: metricNode,
    };

    const collapsed = resolveCollapsedValuesNodesForAxis({
      program: {
        ...valuesProgram,
        rows: [],
        columns: valuesProgram.rows,
        rowDimensions: [],
        columnDimensions: valuesProgram.rowDimensions,
        metricsLayoutResolved: MetricsLayoutEnum.COLUMNS,
        valueAxis: 'col',
      },
      metricLabelSet: baseParams.metricLabelSet,
      axis: 'col',
      parent,
      expandedSet: new Set<string>(),
      nodes,
      exposeCollapsedMetricTier: true,
      metricsAtEnd: true,
      suppressSubtotalParent: false,
      normalizeSubtotalExisting: true,
      isMetricTokenValue: baseParams.isMetricTokenValue,
      isExplicitSubtotalNode: () => false,
      isMetricSubtotalNode: child => child?.isSubtotal === true,
    });

    expect(collapsed).toEqual([
      expect.objectContaining({
        key: metricNode.key,
        label: 'sales',
        formattedLabel: 'sales',
        isSubtotal: false,
        hasChildren: false,
      }),
    ]);
  });

  it('filters explicit row subtotals when row subtotal position is start', () => {
    const parent = node('row', ['West']);
    const dimensionChild = node('row', ['West', 'CA']);
    const subtotalChild = {
      ...node('row', ['West', SUBTOTAL_TOKEN]),
      isSubtotal: true,
    };
    const grandTotalChild = {
      ...node('row', [encodeMetricKey('sales')]),
      isSubtotal: true,
    };

    expect(
      resolveRowSubtotalChildrenPolicy({
        program: policyProgram({
          metricsLayoutResolved: MetricsLayoutEnum.COLUMNS,
          valueAxis: 'col',
        }),
        children: [dimensionChild, subtotalChild, grandTotalChild],
        parent,
        nodes: {},
        rowSubTotals: true,
        rowSubtotalPositionForParent: 'start',
        hideMetricHeaderOnRows: false,
        countDimDepth: path => path.length,
        isMetricTokenValue: baseParams.isMetricTokenValue,
        isMetricGrandTotalNode: child => child === grandTotalChild,
        isExplicitSubtotalNode: child =>
          child?.path.some(value => value === SUBTOTAL_TOKEN) === true,
      }),
    ).toEqual([dimensionChild, grandTotalChild]);
  });

  it('appends eligible end-position row subtotal descendants once', () => {
    const parent = node('row', ['West', 'CA']);
    const dimensionChild = node('row', ['West', 'CA', 'Los Angeles']);
    const subtotalDescendant = {
      ...node('row', ['West', 'CA', SUBTOTAL_TOKEN, encodeMetricKey('sales')]),
      isSubtotal: true,
    };
    const metricSubtotalDescendant = {
      ...node('row', ['West', 'CA', encodeMetricKey('sales'), SUBTOTAL_TOKEN]),
      isSubtotal: true,
    };
    const nodes = {
      [parent.key]: parent,
      [dimensionChild.key]: dimensionChild,
      [subtotalDescendant.key]: subtotalDescendant,
      [metricSubtotalDescendant.key]: metricSubtotalDescendant,
    };

    expect(
      resolveRowSubtotalChildrenPolicy({
        program: policyProgram({
          rowDimensions: ['r1', 'r2'],
          metricKeys: ['sales', 'profit'],
          metricInsertIndex: 1,
        }),
        children: [dimensionChild],
        parent,
        nodes,
        rowSubTotals: true,
        rowSubtotalPositionForParent: 'end',
        hideMetricHeaderOnRows: false,
        countDimDepth: path => path.length,
        isMetricTokenValue: baseParams.isMetricTokenValue,
        isMetricGrandTotalNode: () => false,
        isExplicitSubtotalNode: child =>
          child?.path.some(value => value === SUBTOTAL_TOKEN) === true,
      }),
    ).toEqual([dimensionChild, subtotalDescendant]);
  });
});
