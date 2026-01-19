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
import { buildFormData } from './fixtures/pivotFormData';

const baseFormData = buildFormData({
  groupbyRows: ['row1', 'row2'],
  groupbyColumns: ['col1', 'col2'],
  metrics: ['metric1'],
  colTotals: false,
  rowTotals: false,
  rowSubTotals: false,
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
  order_desc: true,
  verboseMap: {},
  columnFormats: {},
  currencyFormats: {},
  metricColorFormatters: [],
  dateFormatters: {},
});

describe('buildQuery (bootstrap)', () => {
  test('emits a single visible-depth query', () => {
    const queryContext = buildQuery(baseFormData);
    expect(queryContext.queries).toHaveLength(1);
    expect(queryContext.queries[0].query_name).toEqual(formatQueryName(2, 2));
    expect(queryContext.queries[0].columns).toEqual([
      'row1',
      'row2',
      'col1',
      'col2',
    ]);
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
    const queryMetrics = queryContext.queries[0].metrics || [];
    const metricKeys = queryMetrics.map(metric =>
      typeof metric === 'string' ? metric : metric.label,
    );
    expect(metricKeys).toEqual(expect.arrayContaining(['metric1', 'metric2']));
  });
});
