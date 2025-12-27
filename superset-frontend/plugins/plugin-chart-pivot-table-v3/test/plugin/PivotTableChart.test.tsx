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

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import PivotTableChart from '../../src/PivotTableChart';
import {
  MetricsLayoutEnum,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../src/types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  mergeTrees,
  serializePath,
} from '../../src/utils';

const baseFormData: Partial<PivotTableQueryFormData> = {
  groupbyRows: ['r1'],
  groupbyColumns: ['c1'],
  metrics: ['metric1'],
  aggregateFunction: 'Sum',
  rowTotals: false,
  colTotals: false,
  rowSubTotals: false,
  colSubTotals: false,
  rowSubtotalLevels: [],
  colSubtotalLevels: [],
  startCollapsed: false,
  initialDepth: 1,
  maxDepthPerFetch: 1,
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  metricsLayout: MetricsLayoutEnum.COLUMNS,
  viz_type: 'pivot_table_v3',
  datasource: '1__table',
  metricColorFormatters: [],
  dateFormatters: {},
};

const baseTree: PivotTreeData = {
  rows: {
    '': {
      axis: 'row',
      key: '',
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: true,
    },
    A: {
      axis: 'row',
      key: serializePath(['A']),
      path: ['A'],
      label: 'A',
      formattedLabel: 'A',
      level: 1,
      hasChildren: false,
    },
  },
  cols: {
    '': {
      axis: 'col',
      key: '',
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: true,
    },
    C1: {
      axis: 'col',
      key: serializePath(['C1']),
      path: ['C1'],
      label: 'C1',
      formattedLabel: 'C1',
      level: 1,
      hasChildren: true,
    },
    'C1__metric1': {
      axis: 'col',
      key: serializePath(['C1', 'metric1']),
      path: ['C1', 'metric1'],
      label: 'metric1',
      formattedLabel: 'metric1',
      level: 2,
      hasChildren: false,
    },
  },
  cells: {
    [`${serializePath(['A'])}|${serializePath(['C1'])}`]: {
      rowKey: serializePath(['A']),
      colKey: serializePath(['C1']),
      values: { metric1: 10 },
    },
    [`${serializePath(['A'])}|${serializePath(['C1', 'metric1'])}`]: {
      rowKey: serializePath(['A']),
      colKey: serializePath(['C1', 'metric1']),
      values: { metric1: 10 },
    },
  },
};

describe('PivotTableChart metric tier suppression', () => {
  it('hides the metric column header when there is a single metric at the last column level', () => {
    const props = {
      data: baseTree,
      formData: baseFormData as PivotTableQueryFormData,
      metrics: ['metric1'],
      groupbyRows: ['r1'],
      groupbyColumns: ['c1'],
      aggregateFunction: 'Sum',
      width: 400,
      height: 300,
      startCollapsed: false,
      initialDepth: 1,
      maxDepthPerFetch: 1,
      rowTotals: false,
      colTotals: false,
      rowSubTotals: false,
      colSubTotals: false,
      rowSubtotalLevels: [],
      colSubtotalLevels: [],
      rowOrder: 'key_a_to_z',
      colOrder: 'key_a_to_z',
      valueFormat: '',
      columnFormats: {},
      currencyFormats: {},
      allowRenderHtml: false,
      emitCrossFilters: false,
      setDataMask: jest.fn(),
      metricColorFormatters: [],
      dateFormatters: {},
      verboseMap: {},
    } as any;

    render(<PivotTableChart {...props} />);

    expect(screen.queryByText('metric1')).toBeNull();
    expect(screen.getByText('C1')).toBeTruthy();
  });

  it('keeps metric tier hidden on rows when the metric is at the bottom of the hierarchy', () => {
    const treeWithMetricBottom: PivotTreeData = {
      rows: {
        '': {
          axis: 'row',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        USA: {
          axis: 'row',
          key: serializePath(['USA']),
          path: ['USA'],
          label: 'USA',
          formattedLabel: 'USA',
          level: 1,
          hasChildren: true,
        },
        'USA__1-URGENT': {
          axis: 'row',
          key: serializePath(['USA', '1-URGENT']),
          path: ['USA', '1-URGENT'],
          label: '1-URGENT',
          formattedLabel: '1-URGENT',
          level: 2,
          hasChildren: true,
        },
      },
      cols: {
        '': {
          axis: 'col',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: false,
        },
      },
      cells: {
        [`${serializePath(['USA', '1-URGENT'])}|`]: {
          rowKey: serializePath(['USA', '1-URGENT']),
          colKey: '',
          values: { countCustomers: 5 },
        },
      },
    };

    const props = {
      data: treeWithMetricBottom,
      formData: {
        ...baseFormData,
        groupbyRows: ['nation', 'orderPriority'],
        groupbyColumns: ['segment'],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      } as PivotTableQueryFormData,
      metrics: ['countCustomers'],
      groupbyRows: ['nation', 'orderPriority'],
      groupbyColumns: ['segment'],
      aggregateFunction: 'Sum',
      width: 400,
      height: 300,
      startCollapsed: false,
      initialDepth: 3,
      maxDepthPerFetch: 1,
      rowTotals: false,
      colTotals: false,
      rowSubTotals: false,
      colSubTotals: false,
      rowSubtotalLevels: [],
      colSubtotalLevels: [],
      rowOrder: 'key_a_to_z',
      colOrder: 'key_a_to_z',
      valueFormat: '',
      columnFormats: {},
      currencyFormats: {},
      allowRenderHtml: false,
      emitCrossFilters: false,
      setDataMask: jest.fn(),
      metricColorFormatters: [],
      dateFormatters: {},
      verboseMap: {},
    } as any;

    render(<PivotTableChart {...props} />);

    // Metric label should not show as a row header; the second level should be orderPriority.
    expect(screen.queryAllByText('countCustomers')).toHaveLength(0);
    expect(screen.getByText('1-URGENT')).toBeTruthy();
  });
});

describe('PivotTableChart totals & subtotals', () => {
  const baseProps = {
    aggregateFunction: 'Sum',
    width: 400,
    height: 300,
    startCollapsed: false,
    initialDepth: 2,
    maxDepthPerFetch: 1,
    rowTotals: false,
    colTotals: false,
    rowSubTotals: false,
    colSubTotals: false,
    rowSubtotalLevels: [],
    colSubtotalLevels: [],
    rowOrder: 'key_a_to_z',
    colOrder: 'key_a_to_z',
    valueFormat: '',
    columnFormats: {},
    currencyFormats: {},
    allowRenderHtml: false,
    emitCrossFilters: false,
    setDataMask: jest.fn(),
    metricColorFormatters: [],
    dateFormatters: {},
    verboseMap: {},
  };

  it('renders selected column subtotals at the configured position using aggregated values', () => {
    const detail = buildTreeFromRecords(
      [
        { region: 'US', category: 'Tech', subcategory: 'Laptop', metric1: 2 },
        { region: 'US', category: 'Tech', subcategory: 'Phone', metric1: 3 },
      ],
      ['metric1'],
      ['region'],
      ['category', 'subcategory'],
      1,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [{ region: 'US', category: 'Tech', metric1: 999 }],
      ['metric1'],
      ['region'],
      ['category', 'subcategory'],
      1,
      1,
    );
    const tree = applyMetricAxis(
      mergeTrees(subtotal, detail),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['category', 'subcategory'],
      2,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['category', 'subcategory', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colSubtotalLevels: [1],
            colSubtotalPosition: 'start',
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['category', 'subcategory']}
        aggregateFunction="Sum"
        width={600}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        rowTotalPosition="start"
        colSubtotalPosition="start"
        colTotalPosition="start"
      />,
    );

    const regionRow = screen.getByText('US').closest('tr') as HTMLElement;
    const valueCells = within(regionRow).getAllByRole('cell');
    const values = valueCells.map(cell => cell.textContent?.trim());
    expect(values[0]).toBe('999');
    expect(values.slice(1)).toEqual(expect.arrayContaining(['2', '3']));
  });

  it('positions grand totals at the end for rows and columns when configured', () => {
    const totalsOnly = buildTreeFromRecords(
      [{ metric1: 12 }],
      ['metric1'],
      ['region'],
      ['category'],
      0,
      0,
    );
    const detail = buildTreeFromRecords(
      [{ region: 'US', category: 'Tech', metric1: 5 }],
      ['metric1'],
      ['region'],
      ['category'],
      1,
      1,
    );
    const tree = applyMetricAxis(
      mergeTrees(totalsOnly, detail),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['category'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['category', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            rowSubtotalLevels: [0],
            colSubtotalLevels: [0],
            rowTotalPosition: 'end',
            colTotalPosition: 'end',
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['category']}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[0]}
        colSubtotalLevels={[0]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        rowTotalPosition="end"
        colSubtotalPosition="start"
        colTotalPosition="end"
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const headers = within(headerRow).getAllByRole('columnheader');
    const headerLabels = headers.slice(1).map(cell => cell.textContent?.trim());
    expect(headerLabels[headerLabels.length - 1]).toBe('Grand total');

    const bodyRows = within(container.querySelector('tbody') as HTMLElement).getAllByRole('row');
    const getRowLabel = (row: HTMLElement) =>
      (row.querySelector('th')?.textContent || '').trim();
    const firstRowLabel = getRowLabel(bodyRows[0]);
    const lastRowLabel = getRowLabel(bodyRows[bodyRows.length - 1]);
    expect(firstRowLabel).not.toBe('Grand total');
    expect(lastRowLabel).toBe('Grand total');
  });

  it('shows column grand total when enabled without selecting level 0', () => {
    const detail = buildTreeFromRecords(
      [{ region: 'US', category: 'Tech', metric1: 5 }],
      ['metric1'],
      ['region'],
      ['category'],
      1,
      1,
    );
    const total = buildTreeFromRecords(
      [{ region: 'US', metric1: 8 }],
      ['metric1'],
      ['region'],
      ['category'],
      1,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, total),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['category'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['category', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colTotals: true,
            colSubtotalLevels: [],
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['category']}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={true}
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        rowTotalPosition="start"
        colSubtotalPosition="start"
        colTotalPosition="start"
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    expect(within(headerRow).getByText('Grand total')).toBeTruthy();
    const bodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(within(bodyRow).getByText('8')).toBeTruthy();
  });
});
