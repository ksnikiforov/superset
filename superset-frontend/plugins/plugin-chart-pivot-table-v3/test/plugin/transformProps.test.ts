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

  it('builds a tree from query results', () => {
    const result = transformProps(chartProps as any);
    expect(result.data.rows).toBeDefined();
    expect(result.data.cols).toBeDefined();
    expect(result.data.cells['A|B']).toBeDefined();
    expect(result.metrics).toEqual(['metric1']);
  });
});
