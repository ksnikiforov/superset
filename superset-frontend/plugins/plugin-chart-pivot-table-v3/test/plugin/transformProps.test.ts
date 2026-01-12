/*
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

import { ChartProps, supersetTheme } from '@superset-ui/core';
import transformProps from '../../src/transformProps';
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../src/types';
import { formatQueryName } from '../../src/buildQuery';
import { encodeMetricKey, serializeCellKey, serializePath } from '../../src/utils';

describe('Pivot Table v3 transformProps', () => {
  const formData: Partial<PivotTableQueryFormData> = {
    groupbyRows: ['row1'],
    groupbyColumns: ['col1'],
    metrics: ['metric1'],
    aggregateFunction: 'Sum',
    rowTotals: true,
    colTotals: true,
    rowSubTotals: false,
    colSubTotals: false,
    startCollapsed: true,
    initialDepth: 1,
    maxDepthPerFetch: 1,
    rowOrder: 'key_a_to_z',
    colOrder: 'key_a_to_z',
    metricsLayout: MetricsLayoutEnum.COLUMNS,
    viz_type: 'pivot_table_v3',
    datasource: '1__table',
  };

  const chartProps = new ChartProps({
    formData,
    width: 400,
    height: 300,
    queriesData: [
      {
        data: [{ row1: 'A', col1: 'B', metric1: 10 }],
        colnames: ['row1', 'col1', 'metric1'],
        coltypes: [1, 1, 0],
        query_name: formatQueryName(1, 1),
      },
    ],
    hooks: { setDataMask: jest.fn() },
    filterState: { selectedFilters: {} },
    datasource: { verboseMap: {}, columnFormats: {}, currencyFormats: {} },
    theme: supersetTheme,
  });
  const rowKey = serializePath(['A']);
  const colKey = serializePath(['B', encodeMetricKey('metric1')]);
  const cellKey = serializeCellKey(rowKey, colKey);

  it('builds a tree from query results', () => {
    const result = transformProps(chartProps as any);
    expect(result.data.rows).toBeDefined();
    expect(result.data.cols).toBeDefined();
    expect(result.data.cells[cellKey]).toBeDefined();
    expect(result.metrics).toEqual(['metric1']);
  });

  it('keeps conditional formatting metric values in the tree', () => {
    const props = new ChartProps({
      ...chartProps,
      formData: {
        ...formData,
        metricFormatting: {
          metric1: {
            backgroundColor: {
              expressionType: 'SQL',
              sqlExpression: 'CASE WHEN SUM(sales) > 0 THEN "#111111" END',
              label: 'metric1_bg',
            },
          },
        },
      },
      queriesData: [
        {
          data: [{ row1: 'A', col1: 'B', metric1: 10, metric1_bg: '#111111' }],
          colnames: ['row1', 'col1', 'metric1', 'metric1_bg'],
          coltypes: [1, 1, 0, 1],
          query_name: formatQueryName(1, 1),
        },
      ],
    });
    const result = transformProps(
      props as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.data.cells[cellKey].values.metric1_bg).toBe('#111111');
  });

  it('keeps databar color metric values in the tree', () => {
    const props = new ChartProps({
      ...chartProps,
      formData: {
        ...formData,
        metricDatabars: {
          metric1: {
            type: 'bar',
            colorMode: 'byMetric',
            colorMetric: {
              expressionType: 'SQL',
              sqlExpression: 'CASE WHEN SUM(sales) > 0 THEN "#111111" END',
              label: 'metric1_color',
            },
          },
        },
      },
      queriesData: [
        {
          data: [
            {
              row1: 'A',
              col1: 'B',
              metric1: 10,
              metric1_color: '#111111',
            },
          ],
          colnames: ['row1', 'col1', 'metric1', 'metric1_color'],
          coltypes: [1, 1, 0, 1],
          query_name: formatQueryName(1, 1),
        },
      ],
    });
    const result = transformProps(
      props as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.data.cells[cellKey].values.metric1_color).toBe(
      '#111111',
    );
  });

  it('keeps row and column formatting metric values in the tree', () => {
    const props = new ChartProps({
      ...chartProps,
      formData: {
        ...formData,
        rowFormatting: {
          row1: {
            backgroundColor: {
              expressionType: 'SQL',
              sqlExpression: 'SUM(sales)',
              label: 'row_bg',
            },
          },
        },
        colFormatting: {
          col1: {
            textColor: {
              expressionType: 'SQL',
              sqlExpression: 'SUM(profit)',
              label: 'col_text',
            },
          },
        },
      },
      queriesData: [
        {
          data: [{ row1: 'A', metric1: 10, row_bg: '#111111' }],
          colnames: ['row1', 'metric1', 'row_bg'],
          coltypes: [1, 0, 1],
          query_name: formatQueryName(1, 0),
        },
        {
          data: [{ col1: 'B', metric1: 10, col_text: '#00ff00' }],
          colnames: ['col1', 'metric1', 'col_text'],
          coltypes: [1, 0, 1],
          query_name: formatQueryName(0, 1),
        },
      ],
    });
    const result = transformProps(
      props as ChartProps<PivotTableQueryFormData>,
    );
    const rowKey = serializePath(['A']);
    const colKey = serializePath(['B']);
    const rootKey = serializePath([]);
    expect(
      result.data.cells[serializeCellKey(rowKey, rootKey)].values.row_bg,
    ).toBe(
      '#111111',
    );
    expect(
      result.data.cells[serializeCellKey(rootKey, colKey)].values.col_text,
    ).toBe(
      '#00ff00',
    );
  });

  it('normalizes row and column subtotal selections', () => {
    const customProps = new ChartProps({
      ...chartProps,
      formData: {
        ...formData,
        rowTotals: true,
        colTotals: false,
        colSubtotalLevels: [0, 1, 5],
      },
      queriesData: [
        {
          data: [{ metric1: 5 }],
          colnames: ['metric1'],
          coltypes: [0],
          query_name: formatQueryName(0, 0),
        },
      ],
    });
    const result = transformProps(customProps as any);
    expect(result.rowSubtotalLevels).toEqual([0]);
    expect(result.colSubtotalLevels).toEqual([]);
  });

  it('merges row and column totals including the grand-total intersection for single-metric sums', () => {
    const queriesData = [
      {
        data: [{ metric1: 15 }],
        colnames: ['metric1'],
        coltypes: [0],
        query_name: formatQueryName(0, 0),
      },
      {
        data: [
          { row1: 'A', metric1: 6 },
          { row1: 'B', metric1: 9 },
        ],
        colnames: ['row1', 'metric1'],
        coltypes: [1, 0],
        query_name: formatQueryName(1, 0),
      },
      {
        data: [
          { col1: 'X', metric1: 10 },
          { col1: 'Y', metric1: 5 },
        ],
        colnames: ['col1', 'metric1'],
        coltypes: [1, 0],
        query_name: formatQueryName(0, 1),
      },
      {
        data: [
          { row1: 'A', col1: 'X', metric1: 4 },
          { row1: 'A', col1: 'Y', metric1: 2 },
          { row1: 'B', col1: 'X', metric1: 6 },
          { row1: 'B', col1: 'Y', metric1: 3 },
        ],
        colnames: ['row1', 'col1', 'metric1'],
        coltypes: [1, 1, 0],
        query_name: formatQueryName(1, 1),
      },
    ];

    const props = new ChartProps({
      formData: {
        ...formData,
        rowTotals: true,
        colTotals: true,
        startCollapsed: true,
        groupbyRows: ['row1'],
        groupbyColumns: ['col1', '__MEASURES__'],
        metrics: ['metric1'],
      },
      width: 400,
      height: 300,
      queriesData,
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: { verboseMap: {}, columnFormats: {}, currencyFormats: {} },
      theme: supersetTheme,
    });

    const { data: tree } = transformProps(props as any);
    const rootKey = serializePath([]);

    expect(
      tree.cells[serializeCellKey(serializePath(['A']), rootKey)]?.values
        .metric1,
    ).toBe(6);
    expect(
      tree.cells[serializeCellKey(serializePath(['B']), rootKey)]?.values
        .metric1,
    ).toBe(9);
    expect(
      tree.cells[serializeCellKey(rootKey, serializePath(['X']))]?.values
        .metric1,
    ).toBe(10);
    expect(
      tree.cells[serializeCellKey(rootKey, serializePath(['Y']))]?.values
        .metric1,
    ).toBe(5);
    expect(
      tree.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1,
    ).toBe(15);
  });

  it('uses metric-only queries as grand totals even when query depth metadata is wrong', () => {
    const queriesData = [
      {
        data: [{ r1: 'A', r2: 'B', c1: 'X', metric1: 10 }],
        colnames: ['r1', 'r2', 'c1', 'metric1'],
        coltypes: [1, 1, 1, 0],
        query_name: formatQueryName(2, 1),
      },
      {
        data: [
          { c1: 'X', metric1: 100 },
          { c1: 'Y', metric1: 200 },
        ],
        colnames: ['c1', 'metric1'],
        coltypes: [1, 0],
        query_name: formatQueryName(0, 1),
      },
      {
        data: [{ r1: 'A', r2: 'B', metric1: 300 }],
        colnames: ['r1', 'r2', 'metric1'],
        coltypes: [1, 1, 0],
        query_name: formatQueryName(2, 0),
      },
      {
        data: [{ metric1: 999 }],
        colnames: ['metric1'],
        coltypes: [0],
        query_name: formatQueryName(2, 1),
      },
    ];

    const props = new ChartProps({
      formData: {
        ...formData,
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: ['c1', '__MEASURES__'],
        metrics: ['metric1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        rowTotals: true,
        colTotals: true,
      },
      width: 400,
      height: 300,
      queriesData,
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: { verboseMap: {}, columnFormats: {}, currencyFormats: {} },
      theme: supersetTheme,
    });

    const { data: tree } = transformProps(props as any);
    const rootKey = serializePath([]);
    expect(
      tree.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1,
    ).toBe(999);
  });

  it('infers column depth when query metadata is shallow but column groupbys are present', () => {
    const props = new ChartProps({
      formData: {
        ...formData,
        groupbyRows: ['row1'],
        groupbyColumns: ['col1', 'col2', '__MEASURES__'],
        metrics: ['metric1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
      },
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ row1: 'A', col1: 'X', col2: 'Y', metric1: 10 }],
          colnames: ['row1', 'col1', 'col2', 'metric1'],
          coltypes: [1, 1, 1, 0],
          query_name: formatQueryName(1, 0),
        },
      ],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: { verboseMap: {}, columnFormats: {}, currencyFormats: {} },
      theme: supersetTheme,
    });

    const { data: tree } = transformProps(props as any);
    expect(tree.cols[serializePath(['X'])]).toBeDefined();
  });

  it('avoids inferring full depth when query metadata is missing', () => {
    const props = new ChartProps({
      ...chartProps,
      queriesData: [
        {
          data: [{ metric1: 10 }],
        },
      ],
    });
    const result = transformProps(
      props as ChartProps<PivotTableQueryFormData>,
    );
    const root = serializePath([]);
    expect(Object.keys(result.data.rows)).toEqual([root]);
    expect(Object.keys(result.data.cols)).toEqual(
      expect.arrayContaining([root, serializePath([encodeMetricKey('metric1')])]),
    );
    expect(Object.keys(result.data.rows)).toHaveLength(1);
  });

  it('propagates rowSubTotals when enabled', () => {
    const props = new ChartProps({
      formData: {
        ...formData,
        rowSubTotals: true,
        rowTotals: true,
      },
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ row1: 'A', metric1: 10 }],
          colnames: ['row1', 'metric1'],
          coltypes: [1, 0],
          query_name: formatQueryName(1, 0),
        },
      ],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: { verboseMap: {}, columnFormats: {}, currencyFormats: {} },
      theme: supersetTheme,
    });

    const result = transformProps(props as any);
    expect(result.rowSubTotals).toBe(true);
  });
});
