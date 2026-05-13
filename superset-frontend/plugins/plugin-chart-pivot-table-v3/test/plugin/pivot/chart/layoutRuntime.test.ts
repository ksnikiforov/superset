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
import { type QueryFormColumn } from '@superset-ui/core';
import { MetricsLayoutEnum, type PivotTreeNode } from '../../../../src/types';
import {
  resolveAxisChildrenBeforeSubtotalPolicy,
  resolveMetricAxisLayoutPolicy,
} from '../../../../src/pivot/chart/layoutRuntime';
import { type PivotProgram } from '../../../../src/pivot/runtime/types';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  serializePath,
} from '../../../../src/utils';

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
  rows: {},
  cols: {},
  formGroupbyRows: [] as QueryFormColumn[],
  formGroupbyColumns: [] as QueryFormColumn[],
  groupbyColumnsLength: 0,
  metricsCount: 1,
  metricLabelCount: 1,
  rowDimCount: 0,
  colDimCount: 0,
  metricInsertIndex: 0,
  resolvedMetricsLayout: MetricsLayoutEnum.ROWS,
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
  rows: [],
  columns: [],
  rowDimensions: [],
  columnDimensions: [],
  metrics: [],
  metricKeys: ['sales'],
  metricsLayoutResolved: MetricsLayoutEnum.ROWS,
  valueAxis: 'row',
  metricInsertIndex: 0,
};

describe('pivot/chart/layoutRuntime', () => {
  it('uses explicit row metric placeholder position before inferred nodes exist', () => {
    const policy = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      formGroupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      rowDimCount: 3,
      metricInsertIndex: 1,
    });

    expect(policy.metricLayoutIndexOnRows).toBe(1);
    expect(policy.metricIntentIndexOnRows).toBe(1);
    expect(policy.singleMetricBetweenRows).toBe(true);
    expect(policy.shouldExpandMetricRows).toBe(false);
  });

  it('keeps column layout at the configured dimension depth when fetched data is shallow', () => {
    const policy = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      cols: {
        westSales: node('col', ['West', encodeMetricKey('sales')]),
      },
      formGroupbyColumns: ['region', 'quarter'],
      groupbyColumnsLength: 2,
      colDimCount: 2,
      metricInsertIndex: 2,
      resolvedMetricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(policy.maxColDimDepth).toBe(1);
    expect(policy.metricIndexOnCols).toBe(1);
    expect(policy.metricLayoutIndexOnCols).toBe(2);
    expect(policy.metricsAtColEnd).toBe(true);
  });

  it('forces row subtotals to the end for multi-metric row layouts after dimensions', () => {
    const policy = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      rows: {
        westSales: node('row', ['West', encodeMetricKey('sales')]),
      },
      metricLabelCount: 2,
      rowDimCount: 1,
      metricInsertIndex: 1,
      rowSubTotals: true,
      resolvedRowSubtotalPosition: 'start',
    });

    expect(policy.metricsFirstOnRows).toBe(false);
    expect(policy.forceRowSubtotalEnd).toBe(true);
    expect(policy.effectiveRowSubtotalPosition).toBe('end');
  });

  it('hides a redundant single row metric header only when the leaf tier is absent', () => {
    const withoutLeafTier = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      rows: {
        westSales: node('row', ['West', encodeMetricKey('sales')]),
      },
      rowDimCount: 1,
      metricInsertIndex: 1,
    });
    const withLeafTier = resolveMetricAxisLayoutPolicy({
      ...baseParams,
      rows: {
        westSales: node('row', ['West', encodeMetricKey('sales')]),
      },
      rowDimCount: 1,
      metricInsertIndex: 1,
      isLeafTierVisible: true,
    });

    expect(withoutLeafTier.hideMetricHeaderOnRows).toBe(true);
    expect(withLeafTier.hideMetricHeaderOnRows).toBe(false);
  });

  it('filters hidden metric-header children before subtotal placement', () => {
    const parent = node('row', ['West']);
    const dimensionChild = node('row', ['West', 'CA']);
    const metricChild = node('row', ['West', encodeMetricKey('sales')]);
    const nodes = {
      [parent.key]: parent,
      [dimensionChild.key]: dimensionChild,
      [metricChild.key]: metricChild,
    };

    expect(
      resolveAxisChildrenBeforeSubtotalPolicy({
        program: baseProgram,
        resolvedMetricsLayout: MetricsLayoutEnum.ROWS,
        axis: 'row',
        parent,
        nodes,
        groupbyLength: 1,
        hideMetricHeader: true,
        metricsFirst: false,
        isMetricTokenValue: baseParams.isMetricTokenValue,
        isMetricGrandTotalNode: () => false,
        keepValuesChild: () => true,
      }),
    ).toEqual([dimensionChild]);
  });

  it('removes metric grand totals from metric-first child lists', () => {
    const parent = node('row', []);
    const dimensionChild = node('row', ['West']);
    const metricTotal = {
      ...node('row', [encodeMetricKey('sales')]),
      isSubtotal: true,
    };
    const nodes = {
      [parent.key]: parent,
      [dimensionChild.key]: dimensionChild,
      [metricTotal.key]: metricTotal,
    };

    expect(
      resolveAxisChildrenBeforeSubtotalPolicy({
        program: baseProgram,
        resolvedMetricsLayout: MetricsLayoutEnum.ROWS,
        axis: 'row',
        parent,
        nodes,
        groupbyLength: 0,
        hideMetricHeader: false,
        metricsFirst: true,
        isMetricTokenValue: baseParams.isMetricTokenValue,
        isMetricGrandTotalNode: child => child?.isSubtotal === true,
        keepValuesChild: () => true,
      }),
    ).toEqual([dimensionChild]);
  });
});
