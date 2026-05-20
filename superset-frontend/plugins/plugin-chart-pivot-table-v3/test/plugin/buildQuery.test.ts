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

import buildQuery from '../../src/buildQuery';
import { formatQueryName } from '../../src/pivot/query/specs';
import { buildFormData } from './fixtures/pivotFormData';

const baseFormData = buildFormData({
  groupbyRows: ['row1', 'row2'],
  groupbyColumns: ['col1', 'col2'],
  metrics: ['metric1'],
  colTotals: false,
  rowTotals: false,
  rowSubTotals: false,
  startCollapsed: true,
  initialDepth: 1,
  datasource: '5__table',
  viz_type: 'pivot_table_v3',
  width: 400,
  height: 400,
  margin: 0,
  aggregateFunction: 'Sum',
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  metricsLayout: undefined,
  order_desc: true,
  verboseMap: {},
  columnFormats: {},
  currencyFormats: {},
  metricColorFormatters: [],
  dateFormatters: {},
});

describe('buildQuery (bootstrap)', () => {
  test('emits bootstrap queries for visible grid and axis roots', () => {
    const queryContext = buildQuery(baseFormData);
    expect(queryContext.queries).toHaveLength(3);
    expect(queryContext.queries[0].query_name).toEqual(formatQueryName(1, 1));
    expect(queryContext.queries[0].columns).toEqual(['row1', 'col1']);
    expect(queryContext.queries[1].query_name).toEqual(formatQueryName(1, 0));
    expect(queryContext.queries[1].columns).toEqual(['row1']);
    expect(queryContext.queries[2].query_name).toEqual(formatQueryName(0, 1));
    expect(queryContext.queries[2].columns).toEqual(['col1']);
  });

  test('includes row/column totals queries when totals are enabled', () => {
    const queryContext = buildQuery({
      ...baseFormData,
      rowTotals: true,
      colTotals: true,
    });
    expect(queryContext.queries).toHaveLength(4);
    expect(queryContext.queries[0].query_name).toEqual(formatQueryName(0, 0));
    expect(queryContext.queries[1].query_name).toEqual(formatQueryName(1, 1));
    expect(queryContext.queries[2].query_name).toEqual(formatQueryName(1, 0));
    expect(queryContext.queries[3].query_name).toEqual(formatQueryName(0, 1));
  });

  test('uses the base metric list for the bootstrap query', () => {
    const queryContext = buildQuery({
      ...baseFormData,
      metrics: ['metric1', 'metric2'],
      metricFormatting: {
        metric1: {
          backgroundColor: {
            expressionType: 'SQL',
            sqlExpression: 'CASE WHEN SUM(sales) > 0 THEN "#111111" END',
            label: 'metric1_bg',
          },
        },
      },
    });
    queryContext.queries.forEach(query => {
      const queryMetrics = query.metrics || [];
      const metricKeys = queryMetrics.map(metric =>
        typeof metric === 'string' ? metric : metric.label,
      );
      expect(metricKeys).toEqual(
        expect.arrayContaining(['metric1', 'metric2']),
      );
      expect(metricKeys[0]).toEqual('metric1');
      expect(metricKeys[1]).toEqual('metric2');
    });
  });

  test('does not prefetch persisted expansions in the initial query plan', () => {
    const queryContext = buildQuery({
      ...baseFormData,
      pivotExpansionState: {
        rowKeys: ['row1', 'row2'],
        colKeys: ['col1', 'col2'],
        rows: [['A']],
        cols: [['B']],
        collapsedRows: [],
        collapsedCols: [],
      },
    });
    const names = queryContext.queries.map(query =>
      typeof query.query_name === 'string' ? query.query_name : '',
    );
    expect(names.some(name => name.includes('|scope:'))).toBe(false);
  });

  test('does not use persisted column expansions to increase initial query depth', () => {
    const queryContext = buildQuery({
      ...baseFormData,
      expandColumnsLevel: 0,
      expandRowsLevel: 0,
      pivotExpansionState: {
        rowKeys: ['row1', 'row2'],
        colKeys: ['col1', 'col2'],
        rows: [['A']],
        cols: [['B']],
        collapsedRows: [],
        collapsedCols: [],
      },
    });
    const rowBranchQueries = queryContext.queries.filter(
      query =>
        typeof query.query_name === 'string' &&
        query.query_name.includes('|scope:'),
    );
    expect(
      queryContext.queries.every(
        query => !(query.columns || []).includes('col2'),
      ),
    ).toBe(true);
    expect(rowBranchQueries).toHaveLength(0);
  });

  test('ignores time grain from stale form data', () => {
    const queryContext = buildQuery({
      ...baseFormData,
      time_grain_sqla: 'P1D',
      extra_form_data: {
        time_grain_sqla: 'P1W',
      },
    });
    queryContext.queries.forEach(query => {
      expect(query.time_grain_sqla).toBeUndefined();
    });
  });

  test('does not add root prefetch queries when auto-expand goes beyond depth 1', () => {
    const queryContext = buildQuery({
      ...baseFormData,
      startCollapsed: false,
    });
    const names = queryContext.queries.map(query =>
      typeof query.query_name === 'string' ? query.query_name : '',
    );
    expect(names.some(name => name.includes('|root'))).toBe(false);
  });

  test('does not prefetch root or branches when only persisted expansions are deep (BR-4.2)', () => {
    const queryContext = buildQuery({
      ...baseFormData,
      expandRowsLevel: 0,
      expandColumnsLevel: 0,
      pivotExpansionState: {
        rowKeys: ['row1', 'row2'],
        colKeys: ['col1', 'col2'],
        rows: [['A']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
    });
    const names = queryContext.queries.map(query =>
      typeof query.query_name === 'string' ? query.query_name : '',
    );
    expect(names.some(name => name.includes('|root'))).toBe(false);
    expect(names.some(name => name.includes('|scope:'))).toBe(false);
  });

  test('does not batch sibling persisted expansions during initial query planning', () => {
    const queryContext = buildQuery(
      buildFormData({
        groupbyRows: ['country', 'state', 'city'],
        groupbyColumns: [],
        metrics: ['m1'],
        startCollapsed: true,
        initialDepth: 1,
        expandRowsLevel: 0,
        expandColumnsLevel: 0,
        pivotExpansionState: {
          rowKeys: ['country', 'state', 'city'],
          colKeys: [],
          rows: [
            ['US', 'CA'],
            ['US', 'NY'],
          ],
          cols: [],
          collapsedRows: [],
          collapsedCols: [],
        },
      }),
    );
    const names = queryContext.queries.map(query =>
      typeof query.query_name === 'string' ? query.query_name : '',
    );
    expect(names.some(name => name.includes('|scope:'))).toBe(false);
  });
});
