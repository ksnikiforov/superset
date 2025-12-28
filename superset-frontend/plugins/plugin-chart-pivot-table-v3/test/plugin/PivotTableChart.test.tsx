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
import { ChartProps, supersetTheme } from '@superset-ui/core';
import { render, screen, within } from '@testing-library/react';
import PivotTableChart from '../../src/PivotTableChart';
import transformProps from '../../src/transformProps';
import {
  MetricsLayoutEnum,
  PivotTableQueryFormData,
  PivotTreeData,
  PivotTreeNode,
} from '../../src/types';
import { formatQueryName } from '../../src/buildQuery';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  mergeTrees,
  METRICS_PLACEHOLDER,
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

describe('PivotTableChart initial depth on collapsed render', () => {
  const baseProps = {
    aggregateFunction: 'Sum',
    width: 400,
    height: 300,
    startCollapsed: true,
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
  };

  it('shows first column level when collapsed with initialDepth=1', () => {
    const treeRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          orderPriority: 'A',
          revenueBand: '10k-50k',
          returnFlag: 'Y',
          quantitySold: 10,
        },
      ],
      ['quantitySold'],
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      1,
      3,
    );
    const tree = applyMetricAxis(
      treeRaw,
      ['quantitySold'],
      MetricsLayoutEnum.COLUMNS,
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      3,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderStatus'],
            groupbyColumns: ['orderPriority', 'revenueBand', 'returnFlag', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['quantitySold'],
          } as PivotTableQueryFormData
        }
        metrics={['quantitySold']}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
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
      />,
    );

    // First column level (orderPriority) should render even when collapsed.
    expect(screen.getByText('A')).toBeTruthy();
    // Only one visible column level; deeper levels should not render until expanded.
    expect(screen.queryByText('10k-50k')).toBeNull();
  });

  it('renders top-level column headers for multi-column layout when data is present', () => {
    const treeRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          orderPriority: 'A',
          revenueBand: '10k-50k',
          returnFlag: 'Y',
          quantitySold: 10,
        },
        {
          orderStatus: 'O',
          orderPriority: 'N',
          revenueBand: '1k-5k',
          returnFlag: 'N',
          quantitySold: 5,
        },
      ],
      ['quantitySold'],
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      1,
      3,
    );
    const tree = applyMetricAxis(
      treeRaw,
      ['quantitySold'],
      MetricsLayoutEnum.COLUMNS,
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      3,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderStatus'],
            groupbyColumns: ['orderPriority', 'revenueBand', 'returnFlag', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['quantitySold'],
          } as PivotTableQueryFormData
        }
        metrics={['quantitySold']}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
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
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const headers = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headers).toEqual(expect.arrayContaining(['A', 'N']));
    expect(headers).not.toEqual(['Grand total']);
  });

  it('fails when only grand total column renders for multi-column selection (regression guard)', () => {
    // Simulate a broken response that labels colDepth=0 but still returns column groupbys.
    const formData = {
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: ['orderStatus'],
      groupbyColumns: ['orderPriority', 'revenueBand', 'returnFlag', METRICS_PLACEHOLDER],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['quantitySold'],
      viz_type: 'pivot_table_v3',
      datasource: '1__table',
    } as PivotTableQueryFormData;
    const chartProps = new ChartProps({
      formData,
      width: 600,
      height: 300,
      queriesData: [
        {
          data: [
            {
              orderStatus: 'F',
              orderPriority: 'A',
              revenueBand: '10k-50k',
              returnFlag: 'Y',
              quantitySold: 10,
            },
            {
              orderStatus: 'O',
              orderPriority: 'N',
              revenueBand: '1k-5k',
              returnFlag: 'N',
              quantitySold: 5,
            },
          ],
          colnames: [
            'orderStatus',
            'orderPriority',
            'revenueBand',
            'returnFlag',
            'quantitySold',
          ],
          coltypes: [1, 1, 1, 1, 0],
          query_name: formatQueryName(1, 0),
        },
      ],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: { verboseMap: {}, columnFormats: {}, currencyFormats: {} },
      theme: supersetTheme,
    });
    const { data: tree } = transformProps(chartProps as any);

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        metrics={['quantitySold']}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
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
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const headers = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headers.length).toBeGreaterThan(1);
    expect(headers).not.toEqual(['Grand total']);
  });

  it('does not render row grand total when row totals/subtotals are disabled', () => {
    const treeRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          orderPriority: 'A',
          revenueBand: '10k-50k',
          returnFlag: 'Y',
          quantitySold: 10,
        },
      ],
      ['quantitySold'],
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      1,
      3,
    );
    const tree = applyMetricAxis(
      treeRaw,
      ['quantitySold'],
      MetricsLayoutEnum.COLUMNS,
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      3,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderStatus'],
            groupbyColumns: ['orderPriority', 'revenueBand', 'returnFlag', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['quantitySold'],
            rowTotals: false,
            rowSubTotals: false,
            rowSubtotalLevels: [],
          } as PivotTableQueryFormData
        }
        metrics={['quantitySold']}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
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
      />,
    );

    const rowHeaders = Array.from(
      (container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>),
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(expect.arrayContaining(['F']));
    expect(rowHeaders).not.toContain('Grand total');
  });

  it('does not render row subtotals (only column subtotals are supported)', () => {
    const rootKey = serializePath([]);
    const subtotalRowKey = serializePath(['Subtotal']);
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [serializePath(['F'])]: {
        axis: 'row',
        key: serializePath(['F']),
        path: ['F'],
        label: 'F',
        formattedLabel: 'F',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [subtotalRowKey]: {
        axis: 'row',
        key: subtotalRowKey,
        path: ['Subtotal'],
        label: 'Subtotal',
        formattedLabel: 'Subtotal',
        level: 1,
        hasChildren: false,
        isSubtotal: true,
      },
    };
    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'col',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: false,
        isSubtotal: true,
      },
      [serializePath(['A'])]: {
        axis: 'col',
        key: serializePath(['A']),
        path: ['A'],
        label: 'A',
        formattedLabel: 'A',
        level: 1,
        hasChildren: false,
        isSubtotal: true,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [`${serializePath(['F'])}|${serializePath(['A'])}`]: {
        rowKey: serializePath(['F']),
        colKey: serializePath(['A']),
        values: { metric1: 10 },
      },
      [`${subtotalRowKey}|${serializePath(['A'])}`]: {
        rowKey: subtotalRowKey,
        colKey: serializePath(['A']),
        values: { metric1: 5 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderStatus'],
            groupbyColumns: ['orderPriority', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colSubtotalLevels: [0],
            colTotals: true,
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority']}
        aggregateFunction="Sum"
        width={400}
        height={200}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
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
      />,
    );

    const rowHeaders = Array.from(
      (container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>),
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Subtotal');
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

    const { container } = render(
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

  it('does not render parent column totals as leaves when branch subtotals exist under multiple column roots', () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => ({
      axis: 'col',
      key: serializePath(path),
      path,
      label: path[path.length - 1] || 'Grand total',
      formattedLabel: path[path.length - 1] || 'Grand total',
      level: path.length,
      hasChildren,
      isSubtotal,
    });

    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', 'Subtotal'])]: makeColNode(['A', 'Subtotal'], true),
      [serializePath(['A', '1-URGENT'])]: makeColNode(['A', '1-URGENT']),
      [serializePath(['A', '2-HIGH'])]: makeColNode(['A', '2-HIGH']),
      [serializePath(['N'])]: makeColNode(['N'], true, true),
      [serializePath(['N', 'Subtotal'])]: makeColNode(['N', 'Subtotal'], true),
      [serializePath(['N', '1-URGENT'])]: makeColNode(['N', '1-URGENT']),
      [serializePath(['N', '2-HIGH'])]: makeColNode(['N', '2-HIGH']),
    };
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [`${rowKey}|${serializePath(['A', '1-URGENT'])}`]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT']),
        values: { metric1: 10 },
      },
      [`${rowKey}|${serializePath(['A', '2-HIGH'])}`]: {
        rowKey,
        colKey: serializePath(['A', '2-HIGH']),
        values: { metric1: 20 },
      },
      [`${rowKey}|${serializePath(['A', 'Subtotal'])}`]: {
        rowKey,
        colKey: serializePath(['A', 'Subtotal']),
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [`${rowKey}|${serializePath(['N', '1-URGENT'])}`]: {
        rowKey,
        colKey: serializePath(['N', '1-URGENT']),
        values: { metric1: 30 },
      },
      [`${rowKey}|${serializePath(['N', '2-HIGH'])}`]: {
        rowKey,
        colKey: serializePath(['N', '2-HIGH']),
        values: { metric1: 40 },
      },
      [`${rowKey}|${serializePath(['N', 'Subtotal'])}`]: {
        rowKey,
        colKey: serializePath(['N', 'Subtotal']),
        values: { metric1: 70 },
        isSubtotal: true,
      },
      [`${rowKey}|${rootKey}`]: {
        rowKey,
        colKey: rootKey,
        values: { metric1: 100 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['flag', 'priority', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colTotals: true,
            colSubtotalLevels: [1],
            colSubtotalPosition: 'start',
            colTotalPosition: 'end',
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals
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
        colTotalPosition="end"
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .slice(1);
    expect(labels).not.toContain('A');
    expect(labels).not.toContain('N');
  });

  it('currently renders both parent total and subtotal leaves when column subtotals are enabled (duplication)', () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => ({
      axis: 'col',
      key: serializePath(path),
      path,
      label: path[path.length - 1] || 'Grand total',
      formattedLabel: path[path.length - 1] || 'Grand total',
      level: path.length,
      hasChildren,
      isSubtotal,
    });

    // Build a tree where the parent column node is marked as a subtotal and
    // also has a child subtotal leaf, matching the UI duplication scenario.
    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', '1-URGENT'])]: makeColNode(['A', '1-URGENT']),
      [serializePath(['A', '2-HIGH'])]: makeColNode(['A', '2-HIGH']),
      // Parent total encoded as a leaf at the same depth as children.
      [serializePath(['A', 'A'])]: makeColNode(['A', 'A'], true),
      [serializePath(['A', 'Subtotal'])]: makeColNode(['A', 'Subtotal'], true),
    };
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [`${rowKey}|${serializePath(['A'])}`]: {
        rowKey,
        colKey: serializePath(['A']),
        values: { metric1: 100 },
        isSubtotal: true,
      },
      [`${rowKey}|${serializePath(['A', '1-URGENT'])}`]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT']),
        values: { metric1: 10 },
      },
      [`${rowKey}|${serializePath(['A', '2-HIGH'])}`]: {
        rowKey,
        colKey: serializePath(['A', '2-HIGH']),
        values: { metric1: 20 },
      },
      [`${rowKey}|${serializePath(['A', 'A'])}`]: {
        rowKey,
        colKey: serializePath(['A', 'A']),
        values: { metric1: 25 },
        isSubtotal: true,
      },
      [`${rowKey}|${serializePath(['A', 'Subtotal'])}`]: {
        rowKey,
        colKey: serializePath(['A', 'Subtotal']),
        values: { metric1: 30 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['flag', 'priority', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colTotals: true,
            colSubtotalLevels: [1],
            colSubtotalPosition: 'start',
            colTotalPosition: 'end',
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals
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
        colTotalPosition="end"
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    // Desired behavior: parent total leaf should not render alongside branch subtotal leaves.
    expect(labels).not.toContain('A');
    expect(labels).toEqual(expect.arrayContaining(['1-URGENT', '2-HIGH', 'Subtotal']));
  });

  it('suppresses duplicated ancestor subtotal leaves on deeper column levels', () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => ({
      axis: 'col',
      key: serializePath(path),
      path,
      label: path[path.length - 1] || 'Grand total',
      formattedLabel: path[path.length - 1] || 'Grand total',
      level: path.length,
      hasChildren,
      isSubtotal,
    });

    // Shape: flag -> priority -> bucket, with a redundant ancestor total leaf at depth 3.
    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', '1-URGENT'])]: makeColNode(['A', '1-URGENT'], true, true),
      [serializePath(['A', '1-URGENT', '10k-50k'])]: makeColNode(['A', '1-URGENT', '10k-50k']),
      [serializePath(['A', '1-URGENT', '1k-5k'])]: makeColNode(['A', '1-URGENT', '1k-5k']),
      [serializePath(['A', '1-URGENT', 'Subtotal'])]: makeColNode(['A', '1-URGENT', 'Subtotal'], true),
      // Redundant ancestor total leaf that should be suppressed.
      [serializePath(['A', '1-URGENT', 'A'])]: makeColNode(['A', '1-URGENT', 'A'], true),
    };
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [`${rowKey}|${serializePath(['A', '1-URGENT', '10k-50k'])}`]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', '10k-50k']),
        values: { metric1: 10 },
      },
      [`${rowKey}|${serializePath(['A', '1-URGENT', '1k-5k'])}`]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', '1k-5k']),
        values: { metric1: 20 },
      },
      [`${rowKey}|${serializePath(['A', '1-URGENT', 'A'])}`]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', 'A']),
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [`${rowKey}|${serializePath(['A', '1-URGENT', 'Subtotal'])}`]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', 'Subtotal']),
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [`${rowKey}|${rootKey}`]: {
        rowKey,
        colKey: rootKey,
        values: { metric1: 60 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['flag', 'priority', 'bucket', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colTotals: true,
            colSubtotalLevels: [2],
            colSubtotalPosition: 'start',
            colTotalPosition: 'end',
            startCollapsed: false,
            initialDepth: 3,
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority', 'bucket']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={3}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[2]}
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
        colTotalPosition="end"
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(labels).not.toContain('A');
    expect(labels).toEqual(
      expect.arrayContaining(['10k-50k', '1k-5k', 'Subtotal']),
    );

    // Subtotal header should not show expand/collapse toggles.
    const subtotalHeader = within(headerRow).getByText('Subtotal').closest('th') as HTMLElement;
    expect(within(subtotalHeader).queryByLabelText('plus-square')).toBeNull();
    expect(within(subtotalHeader).queryByLabelText('minus-square')).toBeNull();
  });

  it('orders deep column totals and subtotals according to positions across five levels (end)', () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const cols: Record<string, PivotTreeNode> = {};
    const labels = ['L1', 'L2', 'L3', 'L4', 'L5'];
    cols[rootKey] = {
      axis: 'col',
      key: rootKey,
      path: [],
      label: 'Grand total',
      formattedLabel: 'Grand total',
      level: 0,
      hasChildren: true,
      isSubtotal: true,
    };
    labels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      cols[serializePath(nextPath)] = {
        axis: 'col',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < labels.length - 1,
        isSubtotal: idx < labels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells = labels.reduce((acc, label, idx) => {
      acc[`${rowKey}|${serializePath(labels.slice(0, idx + 1))}`] = {
        rowKey,
        colKey: serializePath(labels.slice(0, idx + 1)),
        values: { metric1: (idx + 1) * 5 },
        isSubtotal: idx < labels.length - 1,
      };
      return acc;
    }, {} as Record<string, any>);
    cells[`${rowKey}|${rootKey}`] = {
      rowKey,
      colKey: rootKey,
      values: { metric1: 500 },
      isSubtotal: true,
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['l1', 'l2', 'l3', 'l4', 'l5', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colTotals: true,
            colSubtotalLevels: [1, 3],
            colSubtotalPosition: 'end',
            colTotalPosition: 'end',
            startCollapsed: false,
            initialDepth: 5,
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['l1', 'l2', 'l3', 'l4', 'l5']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={5}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1, 3]}
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
        colSubtotalPosition="end"
        colTotalPosition="end"
      />,
    );

    const allHeaders = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(allHeaders).toEqual(
      expect.arrayContaining(['L5', 'L3', 'L1', 'Grand total']),
    );
    const bodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(within(bodyRow).getAllByRole('cell').length).toBeGreaterThanOrEqual(3);
  });

  it('orders deep column totals and subtotals at the start when configured across five levels', () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const cols: Record<string, PivotTreeNode> = {};
    const labels = ['L1', 'L2', 'L3', 'L4', 'L5'];
    cols[rootKey] = {
      axis: 'col',
      key: rootKey,
      path: [],
      label: 'Grand total',
      formattedLabel: 'Grand total',
      level: 0,
      hasChildren: true,
      isSubtotal: true,
    };
    labels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      cols[serializePath(nextPath)] = {
        axis: 'col',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < labels.length - 1,
        isSubtotal: idx < labels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells = labels.reduce((acc, label, idx) => {
      acc[`${rowKey}|${serializePath(labels.slice(0, idx + 1))}`] = {
        rowKey,
        colKey: serializePath(labels.slice(0, idx + 1)),
        values: { metric1: (idx + 1) * 5 },
        isSubtotal: idx < labels.length - 1,
      };
      return acc;
    }, {} as Record<string, any>);
    cells[`${rowKey}|${rootKey}`] = {
      rowKey,
      colKey: rootKey,
      values: { metric1: 500 },
      isSubtotal: true,
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['l1', 'l2', 'l3', 'l4', 'l5', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colTotals: true,
            colSubtotalLevels: [1, 3],
            colSubtotalPosition: 'start',
            colTotalPosition: 'start',
            startCollapsed: false,
            initialDepth: 5,
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['l1', 'l2', 'l3', 'l4', 'l5']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={5}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1, 3]}
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

    const allHeaders = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(allHeaders).toEqual(
      expect.arrayContaining(['Grand total', 'L1', 'L3', 'L5']),
    );
    const bodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(within(bodyRow).getAllByRole('cell').length).toBeGreaterThanOrEqual(3);
  });

  it('does not render expansion toggles for subtotal headers', () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => ({
      axis: 'col',
      key: serializePath(path),
      path,
      label: path[path.length - 1] || 'Grand total',
      formattedLabel: path[path.length - 1] || 'Grand total',
      level: path.length,
      hasChildren,
      isSubtotal,
    });

    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', 'Subtotal'])]: makeColNode(['A', 'Subtotal'], true),
      [serializePath(['A', '1-URGENT'])]: makeColNode(['A', '1-URGENT']),
    };
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells = {
      [`${rowKey}|${serializePath(['A', '1-URGENT'])}`]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT']),
        values: { metric1: 10 },
      },
      [`${rowKey}|${serializePath(['A', 'Subtotal'])}`]: {
        rowKey,
        colKey: serializePath(['A', 'Subtotal']),
        values: { metric1: 20 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['flag', 'priority', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            colTotals: true,
            colSubtotalLevels: [1],
            colSubtotalPosition: 'start',
            colTotalPosition: 'end',
            startCollapsed: false,
            initialDepth: 2,
          } as PivotTableQueryFormData
        }
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority']}
        aggregateFunction="Sum"
        width={600}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals
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
        colTotalPosition="end"
      />,
    );

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const subtotalHeader = within(headerRow).getByText('Subtotal').closest('th') as HTMLElement;
    expect(within(subtotalHeader).queryByLabelText('plus-square')).toBeNull();
    expect(within(subtotalHeader).queryByLabelText('minus-square')).toBeNull();
  });
});
