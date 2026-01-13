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
import { buildCellFilters } from '../../../src/pivot/filters';
import { MetricsLayoutEnum, PivotTreeNode } from '../../../src/types';
import { encodeMetricKey, SUBTOTAL_TOKEN } from '../../../src/utils';

describe('buildCellFilters', () => {
  it('builds filters for all row/col levels excluding metric tokens on columns', () => {
    const rowNode = {
      path: ['US', 'CA'],
    } as PivotTreeNode;
    const colNode = {
      path: [encodeMetricKey('metric1'), '2020', 'Q1'],
    } as PivotTreeNode;

    const filters = buildCellFilters({
      rowNode,
      colNode,
      groupbyRows: ['country', 'state'],
      groupbyColumns: ['year', 'quarter'],
      metrics: ['metric1', 'metric2'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(filters).toEqual([
      { col: 'country', op: '==', val: 'US' },
      { col: 'state', op: '==', val: 'CA' },
      { col: 'year', op: '==', val: '2020' },
      { col: 'quarter', op: '==', val: 'Q1' },
    ]);
  });

  it('builds filters for all row/col levels excluding metric tokens on rows', () => {
    const rowNode = {
      path: [encodeMetricKey('metric2'), 'US', 'CA'],
    } as PivotTreeNode;
    const colNode = {
      path: ['2021'],
    } as PivotTreeNode;

    const filters = buildCellFilters({
      rowNode,
      colNode,
      groupbyRows: ['country', 'state'],
      groupbyColumns: ['year'],
      metrics: ['metric1', 'metric2'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    expect(filters).toEqual([
      { col: 'country', op: '==', val: 'US' },
      { col: 'state', op: '==', val: 'CA' },
      { col: 'year', op: '==', val: '2021' },
    ]);
  });

  it('ignores subtotal tokens when building filters', () => {
    const rowNode = {
      path: ['US', SUBTOTAL_TOKEN],
    } as PivotTreeNode;
    const colNode = {
      path: ['2022'],
    } as PivotTreeNode;

    const filters = buildCellFilters({
      rowNode,
      colNode,
      groupbyRows: ['country', 'state'],
      groupbyColumns: ['year'],
      metrics: ['metric1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(filters).toEqual([
      { col: 'country', op: '==', val: 'US' },
      { col: 'year', op: '==', val: '2022' },
    ]);
  });
});
