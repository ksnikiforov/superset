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

import { ChartProps, GenericDataType, supersetTheme } from '@superset-ui/core';
import transformProps from '../../src/transformProps';
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../src/types';
import { formatQueryName } from '../../src/buildQuery';
import { serializeCellKey, serializePath } from '../../src/utils';

const baseFormData: Partial<PivotTableQueryFormData> = {
  groupbyRows: ['row1'],
  groupbyColumns: ['col1'],
  metrics: ['metric1'],
  aggregateFunction: 'Sum',
  colTotals: true,
  rowTotals: true,
  rowSubTotals: false,
  startCollapsed: true,
  initialDepth: 1,
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  metricsLayout: MetricsLayoutEnum.COLUMNS,
  viz_type: 'pivot_table_v3',
  datasource: '1__table',
};

describe('Pivot Table v3 transformProps (bootstrap)', () => {
  const rootKey = serializePath([]);

  it('builds a minimal tree and uses the bootstrap query for grand totals', () => {
    const chartProps = new ChartProps({
      formData: baseFormData,
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 10 }],
          colnames: ['metric1'],
          coltypes: [0],
          query_name: formatQueryName(0, 0),
        },
        {
          data: [{ row1: 'A', col1: 'B', metric1: 10 }],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
          query_name: formatQueryName(1, 1),
        },
      ],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: {
        verboseMap: {},
        columnFormats: {},
        currencyFormats: {},
        columns: [
          { column_name: 'row1', type_generic: GenericDataType.String },
          { column_name: 'col1', type_generic: GenericDataType.String },
        ],
      },
      theme: supersetTheme,
    });

    const result = transformProps(chartProps as ChartProps<PivotTableQueryFormData>);
    expect(Object.keys(result.data.rows)).toEqual([rootKey]);
    expect(Object.keys(result.data.cols)).toEqual([rootKey]);
    expect(result.data.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1).toBe(10);
  });

  it('uses datasource column types when present', () => {
    const chartProps = new ChartProps({
      formData: baseFormData,
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 5 }],
          colnames: ['metric1'],
          coltypes: [0],
          query_name: formatQueryName(0, 0),
        },
      ],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: {
        verboseMap: {},
        columnFormats: {},
        currencyFormats: {},
        columns: [
          { column_name: 'row1', type_generic: GenericDataType.Temporal },
          { column_name: 'col1', type_generic: GenericDataType.Numeric },
        ],
      },
      theme: supersetTheme,
    });

    const result = transformProps(chartProps as ChartProps<PivotTableQueryFormData>);
    expect(result.colTypeMap?.row1).toBe(GenericDataType.Temporal);
    expect(result.colTypeMap?.col1).toBe(GenericDataType.Numeric);
  });

  it('normalizes row and column subtotal selections', () => {
    const chartProps = new ChartProps({
      formData: {
        ...baseFormData,
        colTotals: true,
        rowTotals: false,
        colSubtotalLevels: [0, 1, 5],
      },
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 5 }],
          colnames: ['metric1'],
          coltypes: [0],
          query_name: formatQueryName(0, 0),
        },
      ],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: {
        verboseMap: {},
        columnFormats: {},
        currencyFormats: {},
        columns: [],
      },
      theme: supersetTheme,
    });

    const result = transformProps(chartProps as ChartProps<PivotTableQueryFormData>);
    expect(result.rowSubtotalLevels).toEqual([0]);
    expect(result.colSubtotalLevels).toEqual([]);
  });
});
