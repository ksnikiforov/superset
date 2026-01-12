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

import buildQuery, { formatQueryName } from '../../src/buildQuery';
import { MetricsLayoutEnum } from '../../src/types';
import { METRICS_PLACEHOLDER } from '../../src/utils';
import { buildFormData } from './fixtures/pivotFormData';

const baseFormData = buildFormData({
  groupbyRows: ['row1', 'row2'],
  groupbyColumns: ['col1', 'col2'],
  metrics: ['metric1'],
  rowTotals: false,
  colTotals: false,
  rowSubTotals: false,
  colSubTotals: false,
  startCollapsed: false,
  initialDepth: 2,
  datasource: '5__table',
  viz_type: 'pivot_table_v3',
  width: 400,
  height: 400,
  margin: 0,
  aggregateFunction: 'Sum',
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  metricsLayout: undefined,
  legacy_order_by: [],
  order_desc: true,
  width: 400,
  height: 400,
  margin: 0,
  verboseMap: {},
  columnFormats: {},
  currencyFormats: {},
  metricColorFormatters: [],
  dateFormatters: {},
});

test('emits a single grouped query when totals are disabled and expanded', () => {
  const queryContext = buildQuery(baseFormData);
  expect(queryContext.queries).toHaveLength(1);
  expect(queryContext.queries[0].query_name).toEqual(formatQueryName(2, 2));
});

test('emits multi queries when startCollapsed is true', () => {
  const queryContext = buildQuery({
    ...baseFormData,
    startCollapsed: true,
    rowTotals: true,
  });
  expect(queryContext.queries.length).toBeGreaterThan(1);
  const names = queryContext.queries.map(q => q.query_name);
  // With totals enabled and two column groupbys, the initial collapse issues
  // the visible depth plus a row-total slice.
  expect(names).toContain(formatQueryName(0, 2));
  expect(names).toContain(formatQueryName(2, 2));
});

test('emits column subtotal depth without including grand total level', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      startCollapsed: true,
      colSubtotalLevels: [1],
      colTotals: false,
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(names).toContain(formatQueryName(2, 1));
  expect(names).not.toContain(formatQueryName(2, 0));
});

test('requests the first column level on initial collapsed render with multiple column groupbys', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      groupbyRows: ['orderStatus'],
      groupbyColumns: ['orderPriority', 'revenueBand', 'returnFlag'],
      startCollapsed: true,
      initialDepth: 1,
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(names).toContain(formatQueryName(1, 1));
  expect(names).not.toContain(formatQueryName(1, 0));
});

test('includes row subtotal depths when row subtotals are enabled', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      startCollapsed: true,
      rowTotals: false,
      rowSubTotals: true,
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(names).toContain(formatQueryName(1, 2));
});

test('limits row subtotal depths to initial visible depth when collapsed', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      groupbyRows: [
        'quantityBand',
        'returnFlag',
        'shipMode',
        'revenueBand',
        METRICS_PLACEHOLDER,
      ],
      groupbyColumns: ['customerSegment', 'shipMode'],
      metrics: ['averageOrderValue', 'weightedDiscount'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      startCollapsed: true,
      initialDepth: 1,
      rowTotals: true,
      colTotals: true,
      rowSubTotals: true,
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(queryContext.queries).toHaveLength(4);
  expect(names).toContain(formatQueryName(0, 0));
  expect(names).toContain(formatQueryName(0, 1));
  expect(names).toContain(formatQueryName(1, 0));
  expect(names).toContain(formatQueryName(1, 1));
  expect(names).not.toContain(formatQueryName(2, 1));
  expect(names).not.toContain(formatQueryName(3, 1));
});

test('includes zero-depth totals when metrics lead rows and column totals are enabled', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      groupbyRows: [METRICS_PLACEHOLDER, 'quantityBand', 'orderPriority'],
      groupbyColumns: ['returnFlag', 'shipMode'],
      metrics: ['averageOrderValue', 'weightedDiscount'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      startCollapsed: true,
      initialDepth: 2,
      colTotals: true,
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(names).toContain(formatQueryName(0, 0));
});

test('includes conditional formatting metrics in query payloads', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      metrics: ['metric1'],
      metricFormatting: {
        metric1: {
          backgroundColor: {
            expressionType: 'SQL',
            sqlExpression: 'CASE WHEN SUM(sales) > 0 THEN "#111111" END',
            label: 'metric1_bg',
          },
        },
      },
    }),
  );

  const queryMetrics = queryContext.queries[0].metrics || [];
  const metricKeys = queryMetrics.map(metric =>
    typeof metric === 'string' ? metric : metric.label,
  );
  expect(metricKeys).toEqual(['metric1', 'metric1_bg']);
});

test('resolves formatting metric references to active metrics', () => {
  const activeMetric = {
    expressionType: 'SQL',
    sqlExpression: 'MEASURE(grossRevenue)',
    label: 'grossRevenue',
    optionName: 'metric_gross_rev',
  };
  const staleMetric = {
    expressionType: 'SQL',
    sqlExpression: 'MEASURE(grossRevenue) / 100',
    label: 'grossRevenue_old',
    optionName: 'metric_gross_rev',
  };
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      metrics: [activeMetric],
      metricFormatting: {
        grossRevenue: {
          backgroundColor: staleMetric,
        },
      },
    }),
  );

  const queryMetrics = queryContext.queries[0].metrics || [];
  const metricKeys = queryMetrics.map(metric =>
    typeof metric === 'string' ? metric : metric.label,
  );
  expect(metricKeys).toEqual(['grossRevenue']);
});

test('includes databar color metrics in query payloads', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      metrics: ['metric1'],
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
    }),
  );

  const queryMetrics = queryContext.queries[0].metrics || [];
  const metricKeys = queryMetrics.map(metric =>
    typeof metric === 'string' ? metric : metric.label,
  );
  expect(metricKeys).toEqual(['metric1', 'metric1_color']);
});

test('includes row and column formatting metrics in query payloads', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      metrics: ['metric1'],
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
    }),
  );

  const queryMetrics = queryContext.queries[0].metrics || [];
  const metricKeys = queryMetrics.map(metric =>
    typeof metric === 'string' ? metric : metric.label,
  );
  expect(metricKeys).toEqual(
    expect.arrayContaining(['metric1', 'row_bg', 'col_text']),
  );
});

test('adds row totals queries when row formatting is enabled without totals', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      startCollapsed: false,
      rowTotals: false,
      colTotals: false,
      rowFormatting: {
        row1: {
          backgroundColor: 'row_bg',
        },
      },
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(names).toContain(formatQueryName(2, 2));
  expect(names).toContain(formatQueryName(2, 0));
});

test('adds column totals queries when column formatting is enabled without totals', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      startCollapsed: false,
      rowTotals: false,
      colTotals: false,
      colFormatting: {
        col1: {
          backgroundColor: 'col_bg',
        },
      },
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(names).toContain(formatQueryName(2, 2));
  expect(names).toContain(formatQueryName(0, 2));
});

test('avoids grand total queries when only formatting requires totals', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      startCollapsed: false,
      rowTotals: false,
      colTotals: false,
      rowFormatting: {
        row1: {
          backgroundColor: 'row_bg',
        },
      },
      colFormatting: {
        col1: {
          textColor: 'col_text',
        },
      },
    }),
  );
  const names = queryContext.queries.map(q => q.query_name);
  expect(names).not.toContain(formatQueryName(0, 0));
});

test('keeps distinct formatting metrics with identical labels in queries', () => {
  const queryContext = buildQuery(
    buildFormData({
      ...baseFormData,
      metrics: ['metric1'],
      metricFormatting: {
        metric1: {
          backgroundColor: {
            expressionType: 'SQL',
            sqlExpression: 'SUM(a)',
            label: 'formatting',
            optionName: 'metric_formatting_1',
            hasCustomLabel: true,
          },
          textColor: {
            expressionType: 'SQL',
            sqlExpression: 'SUM(b)',
            label: 'formatting',
            optionName: 'metric_formatting_2',
            hasCustomLabel: true,
          },
        },
      },
    }),
  );

  const queryMetrics = queryContext.queries[0].metrics || [];
  const metricKeys = queryMetrics.map(metric =>
    typeof metric === 'string' ? metric : metric.label,
  );
  expect(metricKeys).toEqual([
    'metric1',
    'metric_formatting_1',
    'metric_formatting_2',
  ]);
});
