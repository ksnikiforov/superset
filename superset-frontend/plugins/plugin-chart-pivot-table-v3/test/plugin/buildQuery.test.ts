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
import { PivotTableQueryFormData } from '../../src/types';

const baseFormData = {
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
  verboseMap: {},
  columnFormats: {},
  currencyFormats: {},
  metricColorFormatters: [],
  dateFormatters: {},
  setDataMask: () => {},
  legacy_order_by: [],
  order_desc: true,
} as unknown as PivotTableQueryFormData;

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
  expect(names).toContain(formatQueryName(0, 0));
  expect(names).toContain(formatQueryName(1, 1));
});
