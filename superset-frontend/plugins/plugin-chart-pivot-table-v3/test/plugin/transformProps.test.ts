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
import {
  encodeMetricKey,
  serializeCellKey,
  serializePath,
} from '../../src/utils';
import { buildInitialQuerySpecs } from '../../src/pivot/query/specs';

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

  it('builds a bootstrap tree from totals + top-level grid/row/col queries', () => {
    const rowKey = serializePath(['A']);
    const colKey = serializePath(['B']);
    const chartProps = new ChartProps({
      formData: baseFormData,
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 30 }],
          colnames: ['metric1'],
          coltypes: [0],
        },
        {
          data: [{ row1: 'A', col1: 'B', metric1: 15 }],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
        },
        {
          data: [{ row1: 'A', metric1: 10 }],
          colnames: ['row1', 'metric1'],
          coltypes: [1, 0],
        },
        {
          data: [{ col1: 'B', metric1: 20 }],
          colnames: ['col1', 'metric1'],
          coltypes: [1, 0],
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

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.data.rows).toHaveProperty(rowKey);
    expect(result.data.cols).toHaveProperty(colKey);
    expect(
      result.data.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1,
    ).toBe(30);
    expect(
      result.data.cells[serializeCellKey(rowKey, colKey)]?.values.metric1,
    ).toBe(15);
    expect(
      result.data.cells[serializeCellKey(rowKey, rootKey)]?.values.metric1,
    ).toBe(10);
    expect(
      result.data.cells[serializeCellKey(rootKey, colKey)]?.values.metric1,
    ).toBe(20);
  });

  it('uses metric display labels when building metric header nodes', () => {
    const metricKey = 'metric1';
    const metricLabel = 'Revenue';
    const rowKey = serializePath(['A']);
    const colKey = serializePath(['B']);
    const metricNodeKey = serializePath(['B', encodeMetricKey(metricKey)]);
    const chartProps = new ChartProps({
      formData: {
        ...baseFormData,
        metrics: [metricKey],
      },
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 30 }],
          colnames: ['metric1'],
          coltypes: [0],
        },
        {
          data: [{ row1: 'A', col1: 'B', metric1: 15 }],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
        },
        {
          data: [{ row1: 'A', metric1: 10 }],
          colnames: ['row1', 'metric1'],
          coltypes: [1, 0],
        },
        {
          data: [{ col1: 'B', metric1: 20 }],
          colnames: ['col1', 'metric1'],
          coltypes: [1, 0],
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
        metrics: [{ metric_name: metricKey, verbose_name: metricLabel }],
      },
      theme: supersetTheme,
    });

    const result = transformProps(chartProps);
    expect(result.data.rows).toHaveProperty(rowKey);
    expect(result.data.cols).toHaveProperty(colKey);
    const metricNode = result.data.cols[metricNodeKey];
    if (!metricNode) {
      throw new Error('Metric header node missing from column tree');
    }
    expect(metricNode.label).toBe(metricLabel);
  });

  it('keeps metric labels for base metrics in user-controlled mode', () => {
    const chartProps = new ChartProps({
      formData: {
        ...baseFormData,
        interactionMode: 'user_controlled',
        dimensions: ['row1', 'col1'],
        metrics: ['metric1', 'metric2'],
        pivotRuntimeLayout: {
          version: 1,
          rows: ['row1'],
          cols: ['col1'],
          metrics: ['metric1'],
          leafSelection: {},
          valuePlacement: { axis: 'col', index: 0 },
        },
      },
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 30 }],
          colnames: ['metric1'],
          coltypes: [0],
        },
        {
          data: [{ row1: 'A', col1: 'B', metric1: 15 }],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
        },
        {
          data: [{ row1: 'A', metric1: 10 }],
          colnames: ['row1', 'metric1'],
          coltypes: [1, 0],
        },
        {
          data: [{ col1: 'B', metric1: 20 }],
          colnames: ['col1', 'metric1'],
          coltypes: [1, 0],
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
        metrics: [
          { metric_name: 'metric1', verbose_name: 'Metric One' },
          { metric_name: 'metric2', verbose_name: 'Metric Two' },
        ],
      },
      theme: supersetTheme,
    });

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.formData.metricLabelMap).toMatchObject({
      metric1: 'Metric One',
      metric2: 'Metric Two',
    });
  });

  it('maps query results by query_name rather than array order (Contract 2)', () => {
    const formData = baseFormData as PivotTableQueryFormData;
    const specs = buildInitialQuerySpecs(formData);
    const queryResults = specs.map(spec => {
      if (
        spec.meta.coverage.rowDepth === 0 &&
        spec.meta.coverage.columnDepth === 0
      ) {
        return {
          query: { query_name: spec.queryName },
          data: [{ metric1: 30 }],
          colnames: ['metric1'],
          coltypes: [0],
        };
      }
      if (
        spec.meta.coverage.rowDepth === 1 &&
        spec.meta.coverage.columnDepth === 1
      ) {
        return {
          query: { query_name: spec.queryName },
          data: [{ row1: 'A', col1: 'B', metric1: 15 }],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
        };
      }
      if (
        spec.meta.coverage.rowDepth === 1 &&
        spec.meta.coverage.columnDepth === 0
      ) {
        return {
          query: { query_name: spec.queryName },
          data: [{ row1: 'A', metric1: 10 }],
          colnames: ['row1', 'metric1'],
          coltypes: [1, 0],
        };
      }
      if (
        spec.meta.coverage.rowDepth === 0 &&
        spec.meta.coverage.columnDepth === 1
      ) {
        return {
          query: { query_name: spec.queryName },
          data: [{ col1: 'B', metric1: 20 }],
          colnames: ['col1', 'metric1'],
          coltypes: [1, 0],
        };
      }
      return { query: { query_name: spec.queryName }, data: [] };
    });
    const shuffled = [...queryResults].reverse();

    const rowKey = serializePath(['A']);
    const colKey = serializePath(['B']);
    const chartProps = new ChartProps({
      formData,
      width: 400,
      height: 300,
      queriesData: shuffled,
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

    const result = transformProps(chartProps);
    expect(
      result.data.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1,
    ).toBe(30);
    expect(
      result.data.cells[serializeCellKey(rowKey, colKey)]?.values.metric1,
    ).toBe(15);
    expect(
      result.data.cells[serializeCellKey(rowKey, rootKey)]?.values.metric1,
    ).toBe(10);
    expect(
      result.data.cells[serializeCellKey(rootKey, colKey)]?.values.metric1,
    ).toBe(20);
  });

  it('adds metric headers when metrics are placed first in columns', () => {
    const metricKey = serializePath([encodeMetricKey('metric1')]);
    const chartProps = new ChartProps({
      formData: {
        ...baseFormData,
        groupbyColumns: ['__MEASURES__', 'col1'],
      },
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 30 }],
          colnames: ['metric1'],
          coltypes: [0],
        },
        {
          data: [{ row1: 'A', col1: 'B', metric1: 15 }],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
        },
        {
          data: [{ row1: 'A', metric1: 10 }],
          colnames: ['row1', 'metric1'],
          coltypes: [1, 0],
        },
        {
          data: [{ col1: 'B', metric1: 20 }],
          colnames: ['col1', 'metric1'],
          coltypes: [1, 0],
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

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.data.cols).toHaveProperty(metricKey);
  });

  it('retains root-only columns when the column payload is empty', () => {
    const rowKey = serializePath(['A']);
    const chartProps = new ChartProps({
      formData: baseFormData,
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 10 }],
          colnames: ['metric1'],
          coltypes: [0],
        },
        {
          data: [],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
        },
        {
          data: [{ row1: 'A', metric1: 12 }],
          colnames: ['row1', 'metric1'],
          coltypes: [1, 0],
        },
        {
          data: [],
          colnames: ['col1', 'metric1'],
          coltypes: [1, 0],
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

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.data.rows).toHaveProperty(rootKey);
    expect(result.data.rows).toHaveProperty(rowKey);
    expect(Object.keys(result.data.cols)).toEqual(
      expect.arrayContaining([
        rootKey,
        serializePath([encodeMetricKey('metric1')]),
      ]),
    );
    expect(
      result.data.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1,
    ).toBe(10);
    expect(
      result.data.cells[serializeCellKey(rowKey, rootKey)]?.values.metric1,
    ).toBe(12);
  });

  it('uses the first query payload for the grand total cell', () => {
    const chartProps = new ChartProps({
      formData: {
        ...baseFormData,
        colTotals: true,
        rowTotals: false,
      },
      width: 400,
      height: 300,
      queriesData: [
        {
          data: [{ metric1: 5 }],
          colnames: ['metric1'],
          coltypes: [0],
        },
        {
          data: [{ row1: 'A', col1: 'B', metric1: 9 }],
          colnames: ['row1', 'col1', 'metric1'],
          coltypes: [1, 1, 0],
        },
        {
          data: [{ col1: 'B', metric1: 12 }],
          colnames: ['col1', 'metric1'],
          coltypes: [1, 0],
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

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    expect(
      result.data.cells[serializeCellKey(rootKey, rootKey)]?.values.metric1,
    ).toBe(5);
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

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
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

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.rowSubtotalLevels).toEqual([0]);
    expect(result.colSubtotalLevels).toEqual([]);
  });

  it('merges persisted expansion branches into the initial tree', () => {
    const expandedRowKey = serializePath(['A', 'B']);
    const formData: Partial<PivotTableQueryFormData> = {
      ...baseFormData,
      groupbyRows: ['row1', 'row2'],
      groupbyColumns: ['col1'],
      pivotExpansionState: {
        rowKeys: ['row1', 'row2'],
        colKeys: ['col1'],
        rows: [['A']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
    };
    const specs = buildInitialQuerySpecs(formData as PivotTableQueryFormData);
    const queriesData = specs.map(spec => {
      if (spec.meta.kind === 'bootstrap') {
        if (
          spec.meta.coverage.rowDepth === 0 &&
          spec.meta.coverage.columnDepth === 0
        ) {
          return {
            query: { query_name: spec.queryName },
            data: [{ metric1: 30 }],
            colnames: ['metric1'],
            coltypes: [0],
          };
        }
        if (
          spec.meta.coverage.rowDepth === 1 &&
          spec.meta.coverage.columnDepth === 1
        ) {
          return {
            query: { query_name: spec.queryName },
            data: [{ row1: 'A', col1: 'C', metric1: 10 }],
            colnames: ['row1', 'col1', 'metric1'],
            coltypes: [1, 1, 0],
          };
        }
        if (
          spec.meta.coverage.rowDepth === 1 &&
          spec.meta.coverage.columnDepth === 0
        ) {
          return {
            query: { query_name: spec.queryName },
            data: [{ row1: 'A', metric1: 10 }],
            colnames: ['row1', 'metric1'],
            coltypes: [1, 0],
          };
        }
        if (
          spec.meta.coverage.rowDepth === 0 &&
          spec.meta.coverage.columnDepth === 1
        ) {
          return {
            query: { query_name: spec.queryName },
            data: [{ col1: 'C', metric1: 10 }],
            colnames: ['col1', 'metric1'],
            coltypes: [1, 0],
          };
        }
      }
      if (spec.meta.kind === 'branch' || spec.meta.kind === 'batch') {
        return {
          query: { query_name: spec.queryName },
          data: [{ row1: 'A', row2: 'B', col1: 'C', metric1: 11 }],
          colnames: ['row1', 'row2', 'col1', 'metric1'],
          coltypes: [1, 1, 1, 0],
        };
      }
      return { query: { query_name: spec.queryName }, data: [] };
    });

    const chartProps = new ChartProps({
      formData,
      width: 400,
      height: 300,
      queriesData,
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: {
        verboseMap: {},
        columnFormats: {},
        currencyFormats: {},
        columns: [
          { column_name: 'row1', type_generic: GenericDataType.String },
          { column_name: 'row2', type_generic: GenericDataType.String },
          { column_name: 'col1', type_generic: GenericDataType.String },
        ],
      },
      theme: supersetTheme,
    });

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    expect(result.data.rows).toHaveProperty(expandedRowKey);
  });
});
