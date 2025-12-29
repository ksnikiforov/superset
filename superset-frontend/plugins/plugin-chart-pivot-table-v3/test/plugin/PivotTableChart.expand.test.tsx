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
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import PivotTableChart from '../../src/PivotTableChart';
import {
  MetricsLayoutEnum,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../src/types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  METRICS_PLACEHOLDER,
  mergeTrees,
  serializePath,
} from '../../src/utils';
import { fetchPivotBranch, peekPivotBranchCache } from '../../src/fetchPivotBranch';
import { SupersetClient } from '@superset-ui/core';
import { formatQueryName } from '../../src/buildQuery';

jest.mock('../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart expansion with metrics before dimensions', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const peekPivotBranchCacheMock = peekPivotBranchCache as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const baseFormData: Partial<PivotTableQueryFormData> = {
    groupbyRows: ['r1', 'r2'],
    groupbyColumns: [],
    metrics: ['countCustomers'],
    aggregateFunction: 'Sum',
    rowTotals: false,
    colTotals: false,
    rowSubTotals: false,
    colSubTotals: false,
    startCollapsed: true,
    initialDepth: 1,
    maxDepthPerFetch: 1,
    rowOrder: 'key_a_to_z',
    colOrder: 'key_a_to_z',
    metricsLayout: MetricsLayoutEnum.ROWS,
    viz_type: 'pivot_table_v3',
    datasource: '1__table',
    metricColorFormatters: [],
    dateFormatters: {},
    verboseMap: {},
  };

  const treeWithMetricChildOnly: PivotTreeData = {
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
        hasChildren: true,
      },
      'A__countCustomers': {
        axis: 'row',
        key: serializePath(['A', 'countCustomers']),
        path: ['A', 'countCustomers'],
        label: 'countCustomers',
        formattedLabel: 'countCustomers',
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
      [`${serializePath(['A'])}|`]: {
        rowKey: serializePath(['A']),
        colKey: '',
        values: { countCustomers: 1 },
      },
      [`${serializePath(['A', 'countCustomers'])}|`]: {
        rowKey: serializePath(['A', 'countCustomers']),
        colKey: '',
        values: { countCustomers: 1 },
      },
    },
  };

  it('still fetches branch when only metric-tier children are present', async () => {
    const { getAllByLabelText, queryAllByText } = render(
      <PivotTableChart
        data={treeWithMetricChildOnly}
        formData={baseFormData as PivotTableQueryFormData}
        metrics={['countCustomers']}
        groupbyRows={['r1', 'r2']}
        groupbyColumns={[]}
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

    // Base-only node should be hidden when metric tier is visible.
    expect(queryAllByText('A')).toHaveLength(1);

    // First toggle corresponds to the A node (level 1).
    const toggles = getAllByLabelText('plus-square');
    fireEvent.click(toggles[0]);

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });
  });

  it('renders metric-first rows without duplicating base nodes and fetches from metric tier', async () => {
    const metricFirstTree: PivotTreeData = {
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
          hasChildren: true,
        },
        m1: {
          axis: 'row',
          key: serializePath(['m1']),
          path: ['m1'],
          label: 'm1',
          formattedLabel: 'm1',
          level: 1,
          hasChildren: true,
        },
        'm1__A': {
          axis: 'row',
          key: serializePath(['m1', 'A']),
          path: ['m1', 'A'],
          label: 'A',
          formattedLabel: 'A',
          level: 2,
          hasChildren: true,
        },
        'm1__A__B': {
          axis: 'row',
          key: serializePath(['m1', 'A', 'B']),
          path: ['m1', 'A', 'B'],
          label: 'B',
          formattedLabel: 'B',
          level: 3,
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
          hasChildren: false,
        },
      },
      cells: {
        [`${serializePath(['m1', 'A', 'B'])}|`]: {
          rowKey: serializePath(['m1', 'A', 'B']),
          colKey: '',
          values: { m1: 5 },
        },
      },
    };

    const { queryAllByText, getAllByLabelText, container } = render(
      <PivotTableChart
        data={metricFirstTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: [METRICS_PLACEHOLDER, 'r1', 'r2'],
            metrics: ['m1'],
          } as PivotTableQueryFormData
        }
        metrics={['m1']}
        groupbyRows={['r1', 'r2']}
        groupbyColumns={[]}
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

    // Only the metric tier should be visible at the top level (no duplicate base row).
    expect(queryAllByText('A', { exact: true })).toHaveLength(0);
    expect(queryAllByText('m1', { exact: true })).toHaveLength(1);

    const rowToggle = within(
      container.querySelector('tbody') as HTMLElement,
    ).getAllByLabelText('plus-square')[0];
    // Expand the metric node to fetch the next level.
    fireEvent.click(rowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });
  });

  it('keeps metric-first return flag values after expanding a child level', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['returnFlag', 'orderPriority'];
    const colGroupby = ['shipMode'];
    const rowSubtotalLevels = [1];
    const records = [
      {
        returnFlag: 'A',
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        averageOrderValue: 100,
        weightedDiscount: 0.1,
      },
      {
        returnFlag: 'A',
        orderPriority: '2-HIGH',
        shipMode: 'FOB',
        averageOrderValue: 200,
        weightedDiscount: 0.2,
      },
      {
        returnFlag: 'N',
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        averageOrderValue: 300,
        weightedDiscount: 0.3,
      },
      {
        returnFlag: 'N',
        orderPriority: '2-HIGH',
        shipMode: 'FOB',
        averageOrderValue: 400,
        weightedDiscount: 0.4,
      },
    ];

    const buildTreeAtDepth = (rowDepth: number) => {
      let tree = buildTreeFromRecords(
        records,
        metrics,
        rowGroupby,
        colGroupby,
        rowDepth,
        1,
      );
      rowSubtotalLevels
        .filter(level => level > 0 && level <= rowDepth)
        .forEach(depth => {
          tree = injectRowSubtotalLeaves(tree, depth, rowGroupby.length);
        });
      const withMetrics = applyMetricAxis(
        tree,
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        0,
      );
      return labelRowSubtotalLeaves(withMetrics, metrics);
    };

    const baseTree = buildTreeAtDepth(0);
    const returnFlagTree = buildTreeAtDepth(1);
    const orderPriorityTree = buildTreeAtDepth(2);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: returnFlagTree })
      .mockResolvedValueOnce({ data: orderPriorityTree });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [METRICS_PLACEHOLDER, ...rowGroupby],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: true,
            colSubTotals: false,
            rowSubtotalLevels,
            rowSubtotalPosition: 'start',
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={true}
        colSubTotals={false}
        rowSubtotalLevels={rowSubtotalLevels}
        rowSubtotalPosition="start"
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const avgRow = within(tbody)
      .getByText('averageOrderValue')
      .closest('tr') as HTMLElement;
    fireEvent.click(within(avgRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const returnFlagRow = within(tbody).getByText(/^A$/).closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(returnFlagRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      const valueCell = Array.from(returnFlagRow.querySelectorAll('td')).find(
        cell => cell.textContent && cell.textContent.trim() !== '',
      );
      expect(valueCell).toBeTruthy();
    });
  });

  it('keeps metric-first return flag values after deeper expansion', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['returnFlag', 'orderPriority', 'orderStatus'];
    const colGroupby = ['shipMode'];
    const rowSubtotalLevels = [1];
    const records = [
      {
        returnFlag: 'A',
        orderPriority: '1-URGENT',
        orderStatus: 'F',
        shipMode: 'AIR',
        averageOrderValue: 100,
        weightedDiscount: 0.1,
      },
      {
        returnFlag: 'A',
        orderPriority: '2-HIGH',
        orderStatus: 'O',
        shipMode: 'FOB',
        averageOrderValue: 200,
        weightedDiscount: 0.2,
      },
      {
        returnFlag: 'N',
        orderPriority: '1-URGENT',
        orderStatus: 'F',
        shipMode: 'AIR',
        averageOrderValue: 300,
        weightedDiscount: 0.3,
      },
      {
        returnFlag: 'N',
        orderPriority: '2-HIGH',
        orderStatus: 'O',
        shipMode: 'FOB',
        averageOrderValue: 400,
        weightedDiscount: 0.4,
      },
    ];

    const buildTreeAtDepth = (rowDepth: number) => {
      let tree = buildTreeFromRecords(
        records,
        metrics,
        rowGroupby,
        colGroupby,
        rowDepth,
        1,
      );
      rowSubtotalLevels
        .filter(level => level > 0 && level <= rowDepth)
        .forEach(depth => {
          tree = injectRowSubtotalLeaves(tree, depth, rowGroupby.length);
        });
      const withMetrics = applyMetricAxis(
        tree,
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        0,
      );
      return labelRowSubtotalLeaves(withMetrics, metrics);
    };

    const baseTree = buildTreeAtDepth(0);
    const returnFlagTree = buildTreeAtDepth(1);
    const orderPriorityTree = buildTreeAtDepth(2);
    const orderStatusTree = buildTreeAtDepth(3);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: returnFlagTree })
      .mockResolvedValueOnce({ data: orderPriorityTree })
      .mockResolvedValueOnce({ data: orderStatusTree });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [METRICS_PLACEHOLDER, ...rowGroupby],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: true,
            colSubTotals: false,
            rowSubtotalLevels,
            rowSubtotalPosition: 'start',
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={true}
        colSubTotals={false}
        rowSubtotalLevels={rowSubtotalLevels}
        rowSubtotalPosition="start"
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const avgRow = within(tbody)
      .getByText('averageOrderValue')
      .closest('tr') as HTMLElement;
    fireEvent.click(within(avgRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const returnFlagRow = within(tbody).getByText(/^A$/).closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(returnFlagRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const orderPriorityRow = within(tbody).getByText('1-URGENT').closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      const valueCell = Array.from(returnFlagRow.querySelectorAll('td')).find(
        cell => cell.textContent && cell.textContent.trim() !== '',
      );
      expect(valueCell).toBeTruthy();
    });
  });

  it('expands row to the next dimension when metrics are on columns', async () => {
    const baseTreeRaw = buildTreeFromRecords(
      [{ r1: 'A', m1: 5 }],
      ['m1'],
      ['r1', 'r2'],
      ['c1'],
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1', 'r2'],
      ['c1'],
      0,
    );

    const branchRaw = buildTreeFromRecords(
      [{ r1: 'A', r2: 'B', m1: 10 }],
      ['m1'],
      ['r1', 'r2'],
      ['c1'],
      2,
      0,
    );
    const branchWithMetrics = applyMetricAxis(
      branchRaw,
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1', 'r2'],
      ['c1'],
      0,
    );
    const mergedTree = mergeTrees(baseTree, branchWithMetrics);

    fetchPivotBranchMock.mockResolvedValueOnce({ data: mergedTree });

    const { getAllByLabelText, findByText, container } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['r1', 'r2'],
            groupbyColumns: [METRICS_PLACEHOLDER, 'c1'],
            metrics: ['m1'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
          } as PivotTableQueryFormData
        }
        metrics={['m1']}
        groupbyRows={['r1', 'r2']}
        groupbyColumns={['c1']}
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

    const rowToggle = within(
      container.querySelector('tbody') as HTMLElement,
    ).getAllByLabelText('plus-square')[0];
    fireEvent.click(rowToggle);

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    expect(await findByText('B')).toBeTruthy();
  });

  it('fetches row branch after expanding/collapsing metric-first columns', async () => {
    fetchPivotBranchMock.mockResolvedValue({ data: undefined });

    const baseTreeRaw = buildTreeFromRecords(
      [{ nation: 'USA', segment: 'AUTO', countCustomers: 10 }],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const { getAllByLabelText, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['nation', 'orderPriority'],
            groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['countCustomers'],
          } as PivotTableQueryFormData
        }
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority']}
        groupbyColumns={['segment']}
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

    const colToggle = getAllByLabelText('plus-square')[0];
    fireEvent.click(colToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(getAllByLabelText('minus-square')[0]);

    const usaRow = getByText('USA').closest('tr') as HTMLElement;
    const rowToggle = within(usaRow).getByLabelText('plus-square');
    fireEvent.click(rowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });
    expect(getByText('USA')).toBeTruthy();
  });

  it('shows fetched metric values after collapsing metric-first columns and expanding a row', async () => {
    const baseTreeRaw = buildTreeFromRecords(
      [{ nation: 'USA', segment: 'AUTO', countCustomers: 10 }],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const columnBranchRaw = buildTreeFromRecords(
      [{ nation: 'USA', segment: 'AUTO', countCustomers: 10 }],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      1,
      1,
    );
    const columnBranchWithMetrics = applyMetricAxis(
      columnBranchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const rowBranchRaw = buildTreeFromRecords(
      [{ nation: 'USA', orderPriority: 'HIGH', countCustomers: 7 }],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      2,
      0,
    );
    const rowBranchWithMetrics = applyMetricAxis(
      rowBranchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const finalColBranchRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: 'HIGH',
          segment: 'AUTO',
          countCustomers: 7,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      2,
      1,
    );
    const finalColBranchWithMetrics = applyMetricAxis(
      finalColBranchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: columnBranchWithMetrics })
      .mockResolvedValueOnce({ data: rowBranchWithMetrics })
      .mockResolvedValueOnce({ data: finalColBranchWithMetrics });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['nation', 'orderPriority'],
            groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['countCustomers'],
          } as PivotTableQueryFormData
        }
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority']}
        groupbyColumns={['segment']}
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

    const thead = container.querySelector('thead') as HTMLElement;
    fireEvent.click(within(thead).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(within(thead).getByLabelText('minus-square'));

    const usaRow = getByText('USA').closest('tr') as HTMLElement;
    fireEvent.click(within(usaRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(within(thead).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    const priorityCell = await within(tbody).findByText('HIGH');
    const priorityRow = priorityCell.closest('tr') as HTMLElement;
    expect(priorityRow).toBeTruthy();
    expect(within(priorityRow).getByText('7')).toBeTruthy();
  });

  it('keeps values when expanding multiple rows after collapsing columns twice', async () => {
    const baseTreeRaw = buildTreeFromRecords(
      [
        { nation: 'USA', orderPriority: 'LOW', segment: 'AUTO', countCustomers: 10 },
        { nation: 'CAN', orderPriority: 'HIGH', segment: 'AUTO', countCustomers: 20 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const columnBranchRaw = buildTreeFromRecords(
      [
        { nation: 'USA', orderPriority: 'LOW', segment: 'AUTO', countCustomers: 10 },
        { nation: 'CAN', orderPriority: 'HIGH', segment: 'AUTO', countCustomers: 20 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      1,
      1,
    );
    const columnBranchWithMetrics = applyMetricAxis(
      columnBranchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const columnRefetchRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: 'LOW',
          segment: 'AUTO',
          countCustomers: 10,
        },
        {
          nation: 'CAN',
          orderPriority: 'HIGH',
          segment: 'AUTO',
          countCustomers: 20,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      2,
      1,
    );
    const columnRefetchWithMetrics = applyMetricAxis(
      columnRefetchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const usaRowBranchRaw = buildTreeFromRecords(
      [{ nation: 'USA', orderPriority: 'LOW', countCustomers: 10 }],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      2,
      0,
    );
    const usaRowBranchWithMetrics = applyMetricAxis(
      usaRowBranchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    const canRowBranchRaw = buildTreeFromRecords(
      [{ nation: 'CAN', orderPriority: 'HIGH', countCustomers: 20 }],
      ['countCustomers'],
      ['nation', 'orderPriority'],
      ['segment'],
      2,
      0,
    );
    const canRowBranchWithMetrics = applyMetricAxis(
      canRowBranchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority'],
      ['segment'],
      0,
    );

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: columnBranchWithMetrics })
      .mockResolvedValueOnce({ data: usaRowBranchWithMetrics })
      .mockResolvedValueOnce({ data: columnRefetchWithMetrics })
      .mockResolvedValueOnce({ data: canRowBranchWithMetrics });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['nation', 'orderPriority'],
            groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['countCustomers'],
          } as PivotTableQueryFormData
        }
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority']}
        groupbyColumns={['segment']}
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

    const thead = container.querySelector('thead') as HTMLElement;
    fireEvent.click(within(thead).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(within(thead).getByLabelText('minus-square'));

    const usaRow = getByText('USA').closest('tr') as HTMLElement;
    fireEvent.click(within(usaRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    // Re-expand columns with deeper row depth, then collapse again.
    fireEvent.click(within(thead).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });
    fireEvent.click(within(thead).getByLabelText('minus-square'));

    const canRow = getByText('CAN').closest('tr') as HTMLElement;
    fireEvent.click(within(canRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(4);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    const canChildCell = await within(tbody).findByText('HIGH');
    const canChildRow = canChildCell.closest('tr') as HTMLElement;
    expect(within(canChildRow).getByText('20')).toBeTruthy();
  });

  it('keeps ancestor row values when expanding columns under a deeper row', async () => {
    const baseTreeRaw = buildTreeFromRecords(
      [{ nation: 'USA', segment: 'AUTO', countCustomers: 10 }],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const rowBranchRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: 'HIGH',
          segment: 'AUTO',
          countCustomers: 6,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
      1,
    );
    const rowBranchWithMetrics = applyMetricAxis(
      rowBranchRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const colBranchRowDepth1Raw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          segment: 'AUTO',
          shipMode: 'AIR',
          countCustomers: 10,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      2,
    );
    const colBranchRowDepth1 = applyMetricAxis(
      colBranchRowDepth1Raw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const colBranchRowDepth2Raw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: 'HIGH',
          segment: 'AUTO',
          shipMode: 'AIR',
          countCustomers: 6,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
      2,
    );
    const colBranchRowDepth2 = applyMetricAxis(
      colBranchRowDepth2Raw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: rowBranchWithMetrics })
      .mockResolvedValueOnce({
        data: mergeTrees(colBranchRowDepth1, colBranchRowDepth2),
      });

    const { container, getAllByLabelText, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
            groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['countCustomers'],
          } as PivotTableQueryFormData
        }
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority', 'orderStatus']}
        groupbyColumns={['segment', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={400}
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

    // Expand the first row (USA -> orderPriority)
    const rowToggle = within(
      container.querySelector('tbody') as HTMLElement,
    ).getAllByLabelText('plus-square')[0];
    fireEvent.click(rowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    // Expand the first column header (AUTO -> shipMode)
    const colToggle = getAllByLabelText('plus-square')[0];
    fireEvent.click(colToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    // Parent row (nation) should still render values for the expanded column leaf.
    const usaRow = await findByText('USA');
    const usaRowEl = usaRow.closest('tr') as HTMLElement;
    expect(within(usaRowEl).getByText('10')).toBeTruthy();
  });

  it('fills ancestor column cells when expanding rows after a column branch expand', async () => {
    const baseTreeRaw = buildTreeFromRecords(
      [
        { nation: 'USA', segment: 'AUTO', countCustomers: 10 },
        { nation: 'USA', segment: 'CONSUMER', countCustomers: 7 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const colBranchRowDepth1Raw = buildTreeFromRecords(
      [
        { nation: 'USA', segment: 'AUTO', shipMode: 'AIR', countCustomers: 6 },
        { nation: 'USA', segment: 'AUTO', shipMode: 'SEA', countCustomers: 4 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      2,
    );
    const colBranchRowDepth1 = applyMetricAxis(
      colBranchRowDepth1Raw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const rowBranchLeafRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: 'HIGH',
          segment: 'AUTO',
          shipMode: 'AIR',
          countCustomers: 5,
        },
        {
          nation: 'USA',
          orderPriority: 'HIGH',
          segment: 'AUTO',
          shipMode: 'SEA',
          countCustomers: 5,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
      2,
    );
    const rowBranchLeaf = applyMetricAxis(
      rowBranchLeafRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const rowBranchColParentRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: 'HIGH',
          segment: 'AUTO',
          countCustomers: 10,
        },
        {
          nation: 'USA',
          orderPriority: 'HIGH',
          segment: 'CONSUMER',
          countCustomers: 7,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
      1,
    );
    const rowBranchColParent = applyMetricAxis(
      rowBranchColParentRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: colBranchRowDepth1 })
      .mockResolvedValueOnce({
        data: mergeTrees(rowBranchLeaf, rowBranchColParent),
      });

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
            groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['countCustomers'],
          } as PivotTableQueryFormData
        }
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority', 'orderStatus']}
        groupbyColumns={['segment', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={400}
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

    const thead = container.querySelector('thead') as HTMLElement;
    const [firstColToggle] = within(thead).getAllByLabelText('plus-square');
    fireEvent.click(firstColToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    const [firstRowToggle] = within(tbody).getAllByLabelText('plus-square');
    fireEvent.click(firstRowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const highCell = await findByText('HIGH');
    const highRow = highCell.closest('tr') as HTMLElement;
    expect(within(highRow).getAllByText('5')).toHaveLength(2);
    expect(within(highRow).getByText('7')).toBeTruthy();
  });

  it('keeps row-level ancestor column values when expanding a different column after deeper rows', async () => {
    const baseTreeRaw = buildTreeFromRecords(
      [
        { nation: 'USA', segment: 'AUTO', countCustomers: 100 },
        { nation: 'USA', segment: 'BUILDING', countCustomers: 150 },
        { nation: 'CAN', segment: 'AUTO', countCustomers: 90 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const colBranchAutoRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          segment: 'AUTO',
          shipMode: 'AIR',
          countCustomers: 60,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      2,
    );
    const colBranchAuto = applyMetricAxis(
      colBranchAutoRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const rowBranchNationRaw = buildTreeFromRecords(
      [
        { nation: 'USA', orderPriority: '1-URGENT', segment: 'AUTO', countCustomers: 40 },
        { nation: 'USA', orderPriority: '1-URGENT', segment: 'BUILDING', countCustomers: 50 },
        { nation: 'CAN', orderPriority: '1-URGENT', segment: 'AUTO', countCustomers: 30 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
      1,
    );
    const rowBranchNation = applyMetricAxis(
      rowBranchNationRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const rowBranchOrderPriorityRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: '1-URGENT',
          orderStatus: 'F',
          segment: 'AUTO',
          countCustomers: 20,
        },
        {
          nation: 'CAN',
          orderPriority: '1-URGENT',
          orderStatus: 'F',
          segment: 'AUTO',
          countCustomers: 15,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      3,
      1,
    );
    const rowBranchOrderPriority = applyMetricAxis(
      rowBranchOrderPriorityRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const colBranchBuildingRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: '1-URGENT',
          segment: 'BUILDING',
          shipMode: 'AIR',
          countCustomers: 25,
        },
        {
          nation: 'CAN',
          orderPriority: '1-URGENT',
          segment: 'BUILDING',
          shipMode: 'AIR',
          countCustomers: 35,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
      2,
    );
    const colBranchBuildingLeaf = applyMetricAxis(
      colBranchBuildingRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const colBranchBuildingRow1Raw = buildTreeFromRecords(
      [
        { nation: 'USA', segment: 'BUILDING', shipMode: 'AIR', countCustomers: 50 },
        { nation: 'CAN', segment: 'BUILDING', shipMode: 'AIR', countCustomers: 35 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      2,
    );
    const colBranchBuildingRow1 = applyMetricAxis(
      colBranchBuildingRow1Raw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    const colBranchBuildingAncestorRaw = buildTreeFromRecords(
      [
        {
          nation: 'USA',
          orderPriority: '1-URGENT',
          segment: 'BUILDING',
          shipMode: 'AIR',
          countCustomers: 50,
        },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
      2,
    );
    const colBranchBuildingAncestor = applyMetricAxis(
      colBranchBuildingAncestorRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: colBranchAuto })
      .mockResolvedValueOnce({ data: rowBranchNation })
      .mockResolvedValueOnce({ data: rowBranchOrderPriority })
      .mockResolvedValueOnce({
        data: mergeTrees(
          colBranchBuildingRow1,
          mergeTrees(colBranchBuildingLeaf, colBranchBuildingAncestor),
        ),
      });

    const { container, findByText, getAllByLabelText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
            groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['countCustomers'],
          } as PivotTableQueryFormData
        }
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority', 'orderStatus']}
        groupbyColumns={['segment', 'shipMode']}
        aggregateFunction="Sum"
        width={800}
        height={500}
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

    // 1) Expand first column (AUTO)
    const thead = container.querySelector('thead') as HTMLElement;
    fireEvent.click(within(thead).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    // 2) Expand first row (USA)
    const tbody = container.querySelector('tbody') as HTMLElement;
    const firstRowToggle = within(tbody).getAllByLabelText('plus-square')[0];
    fireEvent.click(firstRowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    // 3) Expand first child row (1-URGENT)
    const secondRowToggle = within(tbody).getAllByLabelText('plus-square')[0];
    fireEvent.click(secondRowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    // 4) Expand second column header (BUILDING)
    const buildingHeaderCell = within(thead).getByText('BUILDING').closest('th') as HTMLElement;
    const buildingToggle = within(buildingHeaderCell).getByLabelText('plus-square');
    fireEvent.click(buildingToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(4);
    });

    const orderPriorityRow = await findByText('1-URGENT');
    const orderPriorityEl = orderPriorityRow.closest('tr') as HTMLElement;
    // Order-priority row should now have values under the newly expanded BUILDING column.
    await waitFor(() => {
      const valueCell = Array.from(orderPriorityEl.querySelectorAll('td')).find(
        cell => cell.textContent && cell.textContent.trim() !== '',
      );
      expect(valueCell).toBeTruthy();
    });
    // Sibling top-level row should also have building values populated.
    const canRow = await findByText('CAN');
    const canRowEl = canRow.closest('tr') as HTMLElement;
    await waitFor(() => {
      const valueCell = Array.from(canRowEl.querySelectorAll('td')).find(
        cell => cell.textContent && cell.textContent.trim() !== '',
      );
      expect(valueCell).toBeTruthy();
    });
  });

  it('does not render a row subtotal after expanding a column then a row with row subtotals disabled', async () => {
    const metrics = ['quantitySold'];
    const groupbyRows = ['orderStatus', 'returnFlag'];
    const groupbyColumns = ['revenueBand', 'orderPriority'];
    const baseRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 10,
        },
        {
          orderStatus: 'O',
          returnFlag: 'A',
          revenueBand: '1k-5k',
          orderPriority: '2-HIGH',
          quantitySold: 5,
        },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      groupbyColumns.length,
    );

    const colBranchRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 10,
        },
        {
          orderStatus: 'F',
          returnFlag: 'F',
          revenueBand: '10k-50k',
          orderPriority: '2-HIGH',
          quantitySold: 20,
        },
        {
          orderStatus: 'O',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 5,
        },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      2,
    );
    const colBranch = applyMetricAxis(
      colBranchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      groupbyColumns.length,
    );
    const subtotalKey = serializePath(['10k-50k', 'Subtotal']);
    colBranch.cols[subtotalKey] = {
      axis: 'col',
      key: subtotalKey,
      path: ['10k-50k', 'Subtotal'],
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: false,
      isSubtotal: true,
    };
    [serializePath(['F']), serializePath(['O'])].forEach(rowKey => {
      colBranch.cells[`${rowKey}|${subtotalKey}`] = {
        rowKey,
        colKey: subtotalKey,
        values: { quantitySold: rowKey === serializePath(['F']) ? 30 : 5 },
        isSubtotal: true,
      };
    });

    const rowBranchRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 10,
        },
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '2-HIGH',
          quantitySold: 20,
        },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      2,
      2,
    );
    const rowBranch = applyMetricAxis(
      rowBranchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      groupbyColumns.length,
    );
    rowBranch.cols[subtotalKey] = rowBranch.cols[subtotalKey] || colBranch.cols[subtotalKey];
    rowBranch.cells[`${serializePath(['F', 'A'])}|${subtotalKey}`] = {
      rowKey: serializePath(['F', 'A']),
      colKey: subtotalKey,
      values: { quantitySold: 30 },
      isSubtotal: true,
    };
    const subtotalRowKey = serializePath(['F', '__subtotal__']);
    rowBranch.rows[subtotalRowKey] = {
      axis: 'row',
      key: subtotalRowKey,
      path: ['F', '__subtotal__'],
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: false,
      isSubtotal: true,
    };
    rowBranch.cells[`${subtotalRowKey}|${serializePath(['10k-50k'])}`] = {
      rowKey: subtotalRowKey,
      colKey: serializePath(['10k-50k']),
      values: { quantitySold: 30 },
      isSubtotal: true,
    };

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: colBranch })
      .mockResolvedValueOnce({ data: rowBranch });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows,
            groupbyColumns: [...groupbyColumns, METRICS_PLACEHOLDER],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
            colTotals: true,
            colSubtotalLevels: [1],
            rowTotals: true,
            rowSubTotals: false,
            rowSubtotalLevels: [],
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        aggregateFunction="Sum"
        width={500}
        height={400}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals
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
      />,
    );

    const thead = container.querySelector('thead') as HTMLElement;
    fireEvent.click(within(thead).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    fireEvent.click(within(tbody).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const rowHeaders = Array.from(
      (container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>),
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Subtotal');
  });

  it('fills column subtotal cells for expanded rows after expanding columns first', async () => {
    const metrics = ['quantitySold'];
    const groupbyRows = ['orderStatus', 'returnFlag'];
    const groupbyColumns = ['revenueBand', 'orderPriority'];
    const baseRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 10,
        },
        {
          orderStatus: 'O',
          returnFlag: 'A',
          revenueBand: '1k-5k',
          orderPriority: '2-HIGH',
          quantitySold: 5,
        },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      groupbyColumns.length,
    );

    const colBranchRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 10,
        },
        {
          orderStatus: 'F',
          returnFlag: 'F',
          revenueBand: '10k-50k',
          orderPriority: '2-HIGH',
          quantitySold: 20,
        },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      2,
    );
    const colBranch = applyMetricAxis(
      colBranchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      groupbyColumns.length,
    );
    const subtotalKey = serializePath(['10k-50k', 'Subtotal']);
    colBranch.cols[subtotalKey] = {
      axis: 'col',
      key: subtotalKey,
      path: ['10k-50k', 'Subtotal'],
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: false,
      isSubtotal: true,
    };
    colBranch.cells[`${serializePath(['F'])}|${subtotalKey}`] = {
      rowKey: serializePath(['F']),
      colKey: subtotalKey,
      values: { quantitySold: 30 },
      isSubtotal: true,
    };

    const rowBranchRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 10,
        },
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '2-HIGH',
          quantitySold: 20,
        },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      2,
      2,
    );
    const rowBranch = applyMetricAxis(
      rowBranchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      groupbyColumns.length,
    );
    rowBranch.cols[subtotalKey] = rowBranch.cols[subtotalKey] || colBranch.cols[subtotalKey];
    rowBranch.cells[`${serializePath(['F', 'A'])}|${subtotalKey}`] = {
      rowKey: serializePath(['F', 'A']),
      colKey: subtotalKey,
      values: { quantitySold: 30 },
      isSubtotal: true,
    };

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: colBranch })
      .mockResolvedValueOnce({ data: rowBranch });

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            ...baseFormData,
            groupbyRows,
            groupbyColumns: [...groupbyColumns, METRICS_PLACEHOLDER],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
            colTotals: true,
            colSubtotalLevels: [1],
            rowTotals: true,
            rowSubTotals: false,
            rowSubtotalLevels: [],
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        aggregateFunction="Sum"
        width={500}
        height={400}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals
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
      />,
    );

    const thead = container.querySelector('thead') as HTMLElement;
    fireEvent.click(within(thead).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    fireEvent.click(within(tbody).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const headerRow = container.querySelector('thead tr:last-child') as HTMLElement;
    const headers = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim());
    expect(headers).toContain('Subtotal');

    const childRow = await within(
      container.querySelector('tbody') as HTMLElement,
    ).findByText('A');
    const childRowEl = childRow.closest('tr') as HTMLElement;
    expect(within(childRowEl).getByText('30')).toBeTruthy();
  });

  it('fills ancestor column values for all visible rows when expanding another column after deep row expansion', async () => {
    const actualFetchModule = jest.requireActual('../../src/fetchPivotBranch');
    fetchPivotBranchMock.mockImplementation(args =>
      actualFetchModule.fetchPivotBranch(args),
    );
    peekPivotBranchCacheMock.mockImplementation(
      actualFetchModule.peekPivotBranchCache,
    );
    const postSpy = jest.spyOn(SupersetClient, 'post');
    postSpy.mockImplementation(({ jsonPayload }) => {
      const queries = jsonPayload.queries || [];
      const result = queries.map((query: any) => {
        const name = query.query_name as string;
        if (name.includes('branch:col:AUTO')) {
          if (name.includes(formatQueryName(1, 2))) {
            return {
              data: [
                {
                  nation: 'USA',
                  segment: 'AUTO',
                  shipMode: 'AIR',
                  countCustomers: 100,
                },
                {
                  nation: 'CAN',
                  segment: 'AUTO',
                  shipMode: 'AIR',
                  countCustomers: 80,
                },
              ],
            };
          }
          return { data: [] };
        }
        if (name.includes('branch:row:USA__1-URGENT')) {
          if (name.includes(formatQueryName(3, 2))) {
            return {
              data: [
                {
                  nation: 'USA',
                  orderPriority: '1-URGENT',
                  orderStatus: 'F',
                  segment: 'AUTO',
                  shipMode: 'AIR',
                  countCustomers: 25,
                },
              ],
            };
          }
          return { data: [] };
        }
        if (name.includes('branch:row:USA')) {
          if (name.includes(formatQueryName(2, 2))) {
            return {
              data: [
                {
                  nation: 'USA',
                  orderPriority: '1-URGENT',
                  segment: 'AUTO',
                  shipMode: 'AIR',
                  countCustomers: 50,
                },
              ],
            };
          }
          return { data: [] };
        }
        if (name.includes('branch:col:CONSUMER')) {
          if (name.includes(formatQueryName(3, 2))) {
            return {
              data: [
                {
                  nation: 'USA',
                  orderPriority: '1-URGENT',
                  orderStatus: 'F',
                  segment: 'CONSUMER',
                  shipMode: 'AIR',
                  countCustomers: 15,
                },
              ],
            };
          }
          if (name.includes(formatQueryName(1, 2))) {
            return {
              data: [
                {
                  nation: 'USA',
                  segment: 'CONSUMER',
                  shipMode: 'AIR',
                  countCustomers: 45,
                },
                {
                  nation: 'CAN',
                  segment: 'CONSUMER',
                  shipMode: 'AIR',
                  countCustomers: 35,
                },
              ],
            };
          }
          return { data: [] };
        }
        return { data: [] };
      });
      return Promise.resolve({ json: { result } });
    });

    const baseTreeRaw = buildTreeFromRecords(
      [
        { nation: 'USA', segment: 'AUTO', countCustomers: 100 },
        { nation: 'CAN', segment: 'AUTO', countCustomers: 80 },
        { nation: 'CAN', segment: 'CONSUMER', countCustomers: 60 },
      ],
      ['countCustomers'],
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['countCustomers'],
      MetricsLayoutEnum.COLUMNS,
      ['nation', 'orderPriority', 'orderStatus'],
      ['segment', 'shipMode'],
      2,
    );

    try {
      const { container, findByText } = render(
        <PivotTableChart
          data={baseTree}
          formData={
            {
              ...baseFormData,
              groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
              groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
              metricsLayout: MetricsLayoutEnum.COLUMNS,
              metrics: ['countCustomers'],
            } as PivotTableQueryFormData
          }
          metrics={['countCustomers']}
          groupbyRows={['nation', 'orderPriority', 'orderStatus']}
          groupbyColumns={['segment', 'shipMode']}
          aggregateFunction="Sum"
          width={800}
          height={500}
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

      const thead = container.querySelector('thead') as HTMLElement;
      const autoHeader = within(thead).getByText('AUTO').closest('th') as HTMLElement;
      fireEvent.click(within(autoHeader).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
      });

      const usaRow = await findByText('USA');
      const usaRowEl = usaRow.closest('tr') as HTMLElement;
      fireEvent.click(within(usaRowEl).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
      });

      const urgentRow = await findByText('1-URGENT');
      const urgentRowEl = urgentRow.closest('tr') as HTMLElement;
      fireEvent.click(within(urgentRowEl).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
      });

      const consumerHeader = within(thead).getByText('CONSUMER').closest('th') as HTMLElement;
      fireEvent.click(within(consumerHeader).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock).toHaveBeenCalledTimes(4);
      });

      const canRow = await findByText('CAN');
      const canRowEl = canRow.closest('tr') as HTMLElement;
      await waitFor(() => {
        expect(within(canRowEl).getAllByText('35').length).toBeGreaterThan(0);
      });
      const orderStatusRow = await findByText('F');
      const orderStatusRowEl = orderStatusRow.closest('tr') as HTMLElement;
      expect(within(orderStatusRowEl).getAllByText('15').length).toBeGreaterThan(0);
    } finally {
      postSpy.mockRestore();
      fetchPivotBranchMock.mockReset();
      fetchPivotBranchMock.mockResolvedValue({ data: undefined });
      peekPivotBranchCacheMock.mockReset();
    }
  });

  it('hides synthesized row subtotal nodes when row subtotals are disabled across multi-level expand', () => {
    const metrics = ['quantitySold'];
    const groupbyRows = ['orderStatus', 'returnFlag'];
    const groupbyColumns = ['revenueBand', 'orderPriority'];

    const baseTreeRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          orderPriority: '1-URGENT',
          quantitySold: 10,
        },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      2,
      2,
    );
    const tree = applyMetricAxis(
      baseTreeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      groupbyColumns.length,
    );
    const subtotalKey = serializePath(['F', '__subtotal__']);
    const firstColKey = Object.keys(tree.cells)[0].split('|')[1];
    tree.rows[subtotalKey] = {
      axis: 'row',
      key: subtotalKey,
      path: ['F', '__subtotal__'],
      label: '__subtotal__',
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: true,
      isSubtotal: true,
    };
    tree.cells[`${subtotalKey}|${firstColKey}`] = {
      rowKey: subtotalKey,
      colKey: firstColKey,
      values: { quantitySold: 99 },
      isSubtotal: true,
    };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...baseFormData,
            groupbyRows,
            groupbyColumns: [...groupbyColumns, METRICS_PLACEHOLDER],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
            rowTotals: true,
            rowSubTotals: false,
            rowSubtotalLevels: [],
            colTotals: true,
            colSubtotalLevels: [1],
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        maxDepthPerFetch={1}
        rowTotals
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
      />,
    );

    const rowHeaders = Array.from(
      (container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>),
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Subtotal');
  });

  it('expands a five-level row hierarchy sequentially', async () => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockResolvedValue({ data: undefined });
    const rootKey = serializePath([]);
    const rowLabels = ['L1', 'L2', 'L3', 'L4', 'L5'];
    const rows = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: true,
      },
    } as PivotTreeData['rows'];
    rowLabels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      rows[serializePath(nextPath)] = {
        axis: 'row',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < rowLabels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
    const cols: PivotTreeData['cols'] = {
      [rootKey]: {
        axis: 'col',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: false,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells: {} };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...baseFormData,
            groupbyRows: ['r1', 'r2', 'r3', 'r4', 'r5'],
            groupbyColumns: [],
            metrics: ['m1'],
          } as PivotTableQueryFormData
        }
        metrics={['m1']}
        groupbyRows={['r1', 'r2', 'r3', 'r4', 'r5']}
        groupbyColumns={[]}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const clickNextRowToggle = async (callCount: number) => {
      const plusToggles = within(tbody).getAllByLabelText('plus-square');
      fireEvent.click(plusToggles[0]);
      await waitFor(() =>
        expect(fetchPivotBranchMock).toHaveBeenCalledTimes(callCount),
      );
    };

    await clickNextRowToggle(1);
    await clickNextRowToggle(2);
    await clickNextRowToggle(3);
  });

  it('expands a five-level column hierarchy sequentially', async () => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockResolvedValue({ data: undefined });
    const rootKey = serializePath([]);
    const colLabels = ['C1', 'C2', 'C3', 'C4', 'C5'];
    const cols = {
      [rootKey]: {
        axis: 'col',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: true,
      },
    } as PivotTreeData['cols'];
    colLabels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      cols[serializePath(nextPath)] = {
        axis: 'col',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < colLabels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
    const rows: PivotTreeData['rows'] = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: false,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells: {} };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            ...baseFormData,
            groupbyRows: [],
            groupbyColumns: ['c1', 'c2', 'c3', 'c4', 'c5'],
            metrics: ['m1'],
            colTotals: false,
          } as PivotTableQueryFormData
        }
        metrics={['m1']}
        groupbyRows={[]}
        groupbyColumns={['c1', 'c2', 'c3', 'c4', 'c5']}
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

    const thead = container.querySelector('thead') as HTMLElement;
    const clickNextColToggle = async (callCount: number) => {
      const plusToggles = within(thead).getAllByLabelText('plus-square');
      fireEvent.click(plusToggles[0]);
      await waitFor(() =>
        expect(fetchPivotBranchMock).toHaveBeenCalledTimes(callCount),
      );
    };

    await clickNextColToggle(1);
    await clickNextColToggle(2);
    await clickNextColToggle(3);
  });
});

describe('PivotTableChart expand/collapse count stability', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const peekPivotBranchCacheMock = peekPivotBranchCache as jest.Mock;

  const records = [
    {
      r1: 'A',
      r2: 'X',
      r3: 'I',
      c1: 'G1',
      c2: 'H1',
      c3: 'K1',
      m1: 10,
      m2: 20,
      m3: 5,
    },
    {
      r1: 'A',
      r2: 'X',
      r3: 'J',
      c1: 'G1',
      c2: 'H2',
      c3: 'K1',
      m1: 11,
      m2: 21,
      m3: 6,
    },
    {
      r1: 'A',
      r2: 'Y',
      r3: 'I',
      c1: 'G2',
      c2: 'H1',
      c3: 'K2',
      m1: 12,
      m2: 22,
      m3: 7,
    },
    {
      r1: 'B',
      r2: 'X',
      r3: 'I',
      c1: 'G1',
      c2: 'H1',
      c3: 'K2',
      m1: 13,
      m2: 23,
      m3: 8,
    },
  ];

  const rowGroupby = ['r1', 'r2', 'r3'];
  const colGroupby = ['c1', 'c2', 'c3'];

  const buildTreeAtDepth = ({
    metrics,
    metricsLayout,
    rowDepth,
    colDepth,
    metricPosition,
  }: {
    metrics: string[];
    metricsLayout: MetricsLayoutEnum;
    rowDepth: number;
    colDepth: number;
    metricPosition?: number;
  }) => {
    const raw = buildTreeFromRecords(
      records,
      metrics,
      rowGroupby,
      colGroupby,
      rowDepth,
      colDepth,
    );
    return applyMetricAxis(
      raw,
      metrics,
      metricsLayout,
      rowGroupby,
      colGroupby,
      metricPosition,
    );
  };

  const renderChart = ({
    data,
    metrics,
    metricsLayout,
  }: {
    data: PivotTreeData;
    metrics: string[];
    metricsLayout: MetricsLayoutEnum;
  }) =>
    render(
      <PivotTableChart
        data={data}
        formData={
          {
            groupbyRows: rowGroupby,
            groupbyColumns: colGroupby,
            metricsLayout,
            metrics,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
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

  const getPivotTable = (container: HTMLElement) =>
    (container.querySelector('.pivot_table_v_3 table') ||
      container.querySelector('table')) as HTMLTableElement | null;

  const getCounts = (container: HTMLElement) => {
    const table = getPivotTable(container);
    const rows = table ? table.querySelectorAll('tbody tr').length : 0;
    const firstRow = table?.querySelector('tbody tr');
    const cols = firstRow ? firstRow.querySelectorAll('td').length : 0;
    return { rows, cols };
  };

  const clickToggle = async (
    container: HTMLElement,
    axis: 'row' | 'col',
    action: 'expand' | 'collapse',
  ) => {
    const label = action === 'expand' ? 'plus-square' : 'minus-square';
    let toggle: HTMLElement | undefined;
    await waitFor(() => {
      const table = getPivotTable(container);
      if (!table) {
        throw new Error('Pivot table not found');
      }
      const scope =
        axis === 'row' ? table.querySelector('tbody') : table.querySelector('thead');
      if (!scope) {
        throw new Error('Pivot table section not found');
      }
      const toggles = within(scope).getAllByLabelText(label);
      expect(toggles.length).toBeGreaterThan(0);
      toggle =
        action === 'collapse'
          ? toggles[toggles.length - 1]
          : toggles[0];
    });
    if (!toggle) {
      throw new Error(`Toggle "${label}" not found`);
    }
    const button = toggle.closest('button') ?? toggle;
    fireEvent.click(button);
  };

  const scenarios = [
    {
      name: 'rows two-level toggle with two metrics',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1', 'm2'],
      actions: ['row+', 'row+', 'row-', 'row-'],
    },
    {
      name: 'rows repeat toggle with one metric',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1'],
      actions: ['row+', 'row-', 'row+', 'row-'],
    },
    {
      name: 'rows deep toggle with three metrics',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1', 'm2', 'm3'],
      actions: ['row+', 'row+', 'row+', 'row-', 'row-', 'row-'],
    },
    {
      name: 'columns two-level toggle with two metrics',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2'],
      actions: ['col+', 'col+', 'col-', 'col-'],
    },
    {
      name: 'columns repeat toggle with one metric',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1'],
      actions: ['col+', 'col-', 'col+', 'col-'],
    },
    {
      name: 'columns deep toggle with three metrics',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2', 'm3'],
      actions: ['col+', 'col+', 'col+', 'col-', 'col-', 'col-'],
    },
    {
      name: 'mixed row then column with two metrics on rows',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1', 'm2'],
      actions: ['row+', 'col+', 'col-', 'row-'],
    },
    {
      name: 'mixed column then row with two metrics on columns',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2'],
      actions: ['col+', 'row+', 'row-', 'col-'],
    },
    {
      name: 'mixed deep rows then columns with one metric on rows',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1'],
      actions: ['row+', 'row+', 'col+', 'col-', 'row-', 'row-'],
    },
    {
      name: 'mixed deep columns then rows with three metrics on columns',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2', 'm3'],
      actions: ['col+', 'col+', 'row+', 'row-', 'col-', 'col-'],
    },
  ];

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    peekPivotBranchCacheMock.mockReset();
    peekPivotBranchCacheMock.mockReturnValue(undefined);
  });

  test.each(scenarios)(
    'keeps row/col counts stable after toggles: $name',
    async ({ metricsLayout, metrics, actions }) => {
      const baseRowDepth =
        metricsLayout === MetricsLayoutEnum.ROWS ? rowGroupby.length : 1;
      const baseColDepth =
        metricsLayout === MetricsLayoutEnum.COLUMNS ? colGroupby.length : 1;
      const fullRowDepth = rowGroupby.length;
      const fullColDepth = colGroupby.length;
      const metricPosition =
        metricsLayout === MetricsLayoutEnum.ROWS
          ? rowGroupby.length
          : colGroupby.length;
      const baseTree = buildTreeAtDepth({
        metrics,
        metricsLayout,
        rowDepth: baseRowDepth,
        colDepth: baseColDepth,
        metricPosition,
      });
      const fullTree = buildTreeAtDepth({
        metrics,
        metricsLayout,
        rowDepth: fullRowDepth,
        colDepth: fullColDepth,
        metricPosition,
      });

      fetchPivotBranchMock.mockResolvedValue({ data: fullTree });

      const { container } = renderChart({
        data: baseTree,
        metrics,
        metricsLayout,
      });

      const baseline = getCounts(container);

      for (const action of actions) {
        const axis = action.startsWith('row') ? 'row' : 'col';
        const toggle = action.endsWith('+') ? 'expand' : 'collapse';
        await clickToggle(container, axis, toggle);
        const expectedLabel = toggle === 'expand' ? 'minus-square' : 'plus-square';
        await waitFor(() => {
          const table = getPivotTable(container);
          if (!table) {
            throw new Error('Pivot table not found');
          }
          const scope =
            axis === 'row' ? table.querySelector('tbody') : table.querySelector('thead');
          if (!scope) {
            throw new Error('Pivot table section not found');
          }
          const toggles = within(scope).queryAllByLabelText(expectedLabel);
          expect(toggles.length).toBeGreaterThan(0);
        });
        await waitFor(() => {
          const counts = getCounts(container);
          expect(counts.rows).toBeGreaterThan(0);
          expect(counts.cols).toBeGreaterThan(0);
        });
      }

      const finalCounts = getCounts(container);
      expect(finalCounts).toEqual(baseline);
    },
  );
});

describe('PivotTableChart expansion with metrics between dimensions', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  it('shows metric toggle when metrics sit between the first row dimension and the rest', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand', 'returnFlag', 'revenueBand'];
    const colGroupby = ['customerSegment'];
    const treeRaw = buildTreeFromRecords(
      [
        {
          quantityBand: '1-5',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          customerSegment: 'AUTO',
          averageOrderValue: 5175,
          weightedDiscount: 0.0499,
        },
        {
          quantityBand: '6-10',
          returnFlag: 'N',
          revenueBand: 'Under 1k',
          customerSegment: 'AUTO',
          averageOrderValue: 13861,
          weightedDiscount: 0.0502,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      1,
    );

    const { getByText, getAllByText } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            groupbyRows: [
              'quantityBand',
              METRICS_PLACEHOLDER,
              'returnFlag',
              'revenueBand',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
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

    const firstRow = getByText('1-5').closest('tr') as HTMLElement;
    expect(within(firstRow).queryByLabelText('plus-square')).toBeNull();
    const [metricRowLabel] = getAllByText('averageOrderValue');
    const metricRow = metricRowLabel.closest('tr') as HTMLElement;
    expect(within(metricRow).getByLabelText('plus-square')).toBeTruthy();
  });

  it('hides the parent dimension toggle when metrics sit after the second row dimension', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand', 'returnFlag', 'revenueBand'];
    const colGroupby = ['customerSegment'];
    const treeRaw = buildTreeFromRecords(
      [
        {
          quantityBand: '1-5',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          customerSegment: 'AUTO',
          averageOrderValue: 5175,
          weightedDiscount: 0.0499,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      3,
      1,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      2,
    );

    const { getByText } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            groupbyRows: [
              'quantityBand',
              'returnFlag',
              METRICS_PLACEHOLDER,
              'revenueBand',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
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

    const topRow = getByText('1-5').closest('tr') as HTMLElement;
    const topToggle = within(topRow).getByLabelText('plus-square');
    fireEvent.click(topToggle);

    await waitFor(() => {
      const tbody = topRow.closest('tbody') as HTMLElement;
      const [parentLabel] = within(tbody).getAllByText(/^A$/);
      const parentRow = parentLabel.closest('tr') as HTMLElement;
      expect(within(parentRow).queryByLabelText('plus-square')).toBeNull();
      const metricRow = within(tbody).getByText('averageOrderValue').closest(
        'tr',
      ) as HTMLElement;
      expect(within(metricRow).getByLabelText('plus-square')).toBeTruthy();
    });
  });

  it('expands product rows from a metric node when metrics sit in the middle', async () => {
    const treeRaw = buildTreeFromRecords(
      [{ group: 'Bikes', product: 'Bike1', m1: 10, m2: 20 }],
      ['m1', 'm2'],
      ['group', 'product'],
      [],
      2,
      0,
    );
    const tree = applyMetricAxis(
      treeRaw,
      ['m1', 'm2'],
      MetricsLayoutEnum.ROWS,
      ['group', 'product'],
      [],
      1,
    );

    const { queryAllByText } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            groupbyRows: ['group', METRICS_PLACEHOLDER, 'product'],
            groupbyColumns: [],
            metrics: ['m1', 'm2'],
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: false,
            initialDepth: 2,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            metricsLayout: MetricsLayoutEnum.ROWS,
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={['m1', 'm2']}
        groupbyRows={['group', 'product']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed={false}
        initialDepth={2}
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

    expect(queryAllByText('Bike1')).toHaveLength(2);

    const metricRows = queryAllByText('m2');
    const metricRow = metricRows[0]?.closest('tr') as HTMLElement;
    const minusToggle = within(metricRow).getByLabelText('minus-square');
    fireEvent.click(minusToggle);

    await waitFor(() => {
      expect(queryAllByText('Bike1')).toHaveLength(1);
    });

    const metricRowAfter = queryAllByText('m2')[0]?.closest('tr') as HTMLElement;
    const plusToggle = within(metricRowAfter).getByLabelText('plus-square');
    fireEvent.click(plusToggle);

    await waitFor(() => {
      expect(queryAllByText('Bike1')).toHaveLength(2);
    });
  });

  it('expands ship mode before metrics when metrics sit after return flag', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['shipMode', 'returnFlag', 'quantityBand', 'revenueBand'];
    const colGroupby = ['customerSegment'];
    const records = [
      {
        shipMode: 'AIR',
        returnFlag: 'N',
        quantityBand: '1-5',
        revenueBand: '10k-50k',
        customerSegment: 'AUTO',
        averageOrderValue: 100,
        weightedDiscount: 10,
      },
      {
        shipMode: 'SEA',
        returnFlag: 'R',
        quantityBand: '6-10',
        revenueBand: 'Under 1k',
        customerSegment: 'AUTO',
        averageOrderValue: 200,
        weightedDiscount: 20,
      },
    ];
    const buildTreeAtDepth = (data: typeof records, rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          data,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );

    const baseTree = buildTreeAtDepth(records, 1);
    const airRecords = records.filter(record => record.shipMode === 'AIR');
    const returnFlagBranch = buildTreeAtDepth(airRecords, 2);
    const quantityBranch = buildTreeAtDepth(airRecords, 3);
    const revenueBranch = buildTreeAtDepth(airRecords, 4);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: returnFlagBranch })
      .mockResolvedValueOnce({ data: quantityBranch })
      .mockResolvedValueOnce({ data: revenueBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'shipMode',
              'returnFlag',
              METRICS_PLACEHOLDER,
              'quantityBand',
              'revenueBand',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const airRow = getByText('AIR').closest('tr') as HTMLElement;
    expect(within(airRow).getByLabelText('plus-square')).toBeTruthy();
    const metricLabels = within(tbody).getAllByText('averageOrderValue');
    expect(metricLabels.length).toBeGreaterThan(0);

    fireEvent.click(within(airRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const returnRow = getByText(/^N$/).closest('tr') as HTMLElement;
    expect(within(returnRow).queryByLabelText('plus-square')).toBeNull();

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const returnIndex = rows.indexOf(returnRow);
    const metricRow = rows
      .slice(returnIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(metricRow).toBeTruthy();
    expect(
      within(metricRow as HTMLElement).getByLabelText('plus-square'),
    ).toBeTruthy();

    fireEvent.click(within(metricRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const quantityRow = getByText('1-5').closest('tr') as HTMLElement;
    expect(within(quantityRow).getByLabelText('plus-square')).toBeTruthy();

    fireEvent.click(within(quantityRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    const revenueRow = getByText('10k-50k').closest('tr') as HTMLElement;
    expect(within(revenueRow).queryByLabelText('plus-square')).toBeNull();
  });

  it('keeps metric values when expanding another ship mode after deep expansion', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['shipMode', 'returnFlag', 'quantityBand', 'revenueBand'];
    const colGroupby = ['customerSegment'];
    const records = [
      {
        shipMode: 'AIR',
        returnFlag: 'N',
        quantityBand: '1-5',
        revenueBand: '10k-50k',
        customerSegment: 'AUTO',
        averageOrderValue: 100,
        weightedDiscount: 10,
      },
      {
        shipMode: 'SEA',
        returnFlag: 'R',
        quantityBand: '6-10',
        revenueBand: 'Under 1k',
        customerSegment: 'AUTO',
        averageOrderValue: 200,
        weightedDiscount: 20,
      },
    ];
    const buildTreeAtDepth = (data: typeof records, rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          data,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );

    const baseTree = buildTreeAtDepth(records, 1);
    const airRecords = records.filter(record => record.shipMode === 'AIR');
    const seaRecords = records.filter(record => record.shipMode === 'SEA');
    const airReturnFlagBranch = buildTreeAtDepth(airRecords, 2);
    const airQuantityBranch = buildTreeAtDepth(airRecords, 3);
    const airRevenueBranch = buildTreeAtDepth(airRecords, 4);
    const seaReturnFlagBranch = buildTreeAtDepth(seaRecords, 2);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: airReturnFlagBranch })
      .mockResolvedValueOnce({ data: airQuantityBranch })
      .mockResolvedValueOnce({ data: airRevenueBranch })
      .mockResolvedValueOnce({ data: seaReturnFlagBranch });

    const { container, getByText, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'shipMode',
              'returnFlag',
              METRICS_PLACEHOLDER,
              'quantityBand',
              'revenueBand',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const airRow = getByText('AIR').closest('tr') as HTMLElement;
    fireEvent.click(within(airRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const airReturnRow = getByText(/^N$/).closest('tr') as HTMLElement;
    const airRows = Array.from(tbody.querySelectorAll('tr'));
    const airReturnIndex = airRows.indexOf(airReturnRow);
    const airMetricRow = airRows
      .slice(airReturnIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(airMetricRow).toBeTruthy();
    fireEvent.click(within(airMetricRow as HTMLElement).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const quantityRow = getByText('1-5').closest('tr') as HTMLElement;
    fireEvent.click(within(quantityRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    const seaRow = getByText('SEA').closest('tr') as HTMLElement;
    fireEvent.click(within(seaRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(4);
    });

    const seaReturnRow = (await findByText(/^R$/)).closest(
      'tr',
    ) as HTMLElement;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const seaReturnIndex = rows.indexOf(seaReturnRow);
    const seaMetricRow = rows
      .slice(seaReturnIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(seaMetricRow).toBeTruthy();
    expect(within(seaMetricRow as HTMLElement).getByText('200')).toBeTruthy();
  });

  it('shows dimension rows before metrics when totals data includes metric-only rows', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const detail = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          returnFlag: 'N',
          averageOrderValue: 100,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const totals = buildTreeFromRecords(
      [
        {
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          returnFlag: 'N',
          averageOrderValue: 200,
          weightedDiscount: 0.06,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      0,
      1,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );

    const { container, getByText, queryAllByText } = render(
      <PivotTableChart
        data={tree}
        formData={
          {
            groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const urgentRow = getByText('1-URGENT').closest('tr') as HTMLElement;
    expect(within(urgentRow).getByLabelText('plus-square')).toBeTruthy();

    const metricRows = queryAllByText('averageOrderValue');
    metricRows.forEach(metricLabel => {
      const metricRow = metricLabel.closest('tr') as HTMLElement;
      const labelCell = metricRow.querySelector('div') as HTMLElement;
      expect(labelCell.style.paddingLeft).not.toBe('16px');
    });
  });

  it('shows metrics as the second layer without toggles for orderPriority → Values layout', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const baseRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          returnFlag: 'N',
          averageOrderValue: 100,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseRaw,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );

    const branchRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          returnFlag: 'N',
          averageOrderValue: 100,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      2,
      1,
    );
    const branch = applyMetricAxis(
      branchRaw,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );

    fetchPivotBranchMock.mockResolvedValueOnce({ data: branch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const orderPriorityRow = getByText('1-URGENT').closest('tr') as HTMLElement;
    const avgRowCollapsed = within(tbody).getByText('averageOrderValue').closest(
      'tr',
    ) as HTMLElement;
    const discountRowCollapsed = within(tbody).getByText(
      'weightedDiscount',
    ).closest('tr') as HTMLElement;
    expect(within(orderPriorityRow).getByLabelText('plus-square')).toBeTruthy();
    expect(within(avgRowCollapsed).queryByLabelText('plus-square')).toBeNull();
    expect(
      within(discountRowCollapsed).queryByLabelText('plus-square'),
    ).toBeNull();
    expect(within(tbody).queryByText('AIR')).toBeNull();

    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const shipModeRow = within(tbody).getByText('AIR').closest(
      'tr',
    ) as HTMLElement;
    const avgRow = within(tbody).getByText('averageOrderValue').closest(
      'tr',
    ) as HTMLElement;
    const discountRow = within(tbody).getByText('weightedDiscount').closest(
      'tr',
    ) as HTMLElement;
    expect(within(shipModeRow).getByLabelText('plus-square')).toBeTruthy();
    expect(within(avgRow).queryByLabelText('plus-square')).toBeNull();
    expect(within(discountRow).queryByLabelText('plus-square')).toBeNull();

    const rows = Array.from(tbody.querySelectorAll('tr'));
    expect(rows.indexOf(orderPriorityRow)).toBeLessThan(
      rows.indexOf(shipModeRow),
    );
    expect(rows.indexOf(shipModeRow)).toBeLessThan(rows.indexOf(avgRow));
  });

  it('does not show metric toggles after expanding orderPriority', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const baseRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          returnFlag: 'N',
          averageOrderValue: 100,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const baseTree = applyMetricAxis(
      baseRaw,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );

    const shipModeBranchRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          returnFlag: 'N',
          averageOrderValue: 100,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      2,
      1,
    );
    const shipModeBranch = applyMetricAxis(
      shipModeBranchRaw,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );

    fetchPivotBranchMock.mockResolvedValueOnce({ data: shipModeBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const orderPriorityRow = getByText('1-URGENT').closest('tr') as HTMLElement;
    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    const avgMetricLabels = within(tbody).getAllByText('averageOrderValue');
    avgMetricLabels.forEach(label => {
      const avgRow = label.closest('tr') as HTMLElement;
      expect(within(avgRow).queryByLabelText('plus-square')).toBeNull();
    });
    expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a single metric subtotal per orderPriority and removes it on collapse', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const rowSubtotalLevels = [1, 2];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'FOB',
        orderStatus: 'O',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 110,
        weightedDiscount: 0.06,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) => {
      const raw = buildTreeFromRecords(
        records,
        metrics,
        rowGroupby,
        colGroupby,
        rowDepth,
        1,
      );
      const withSubtotals = rowSubtotalLevels.reduce(
        (acc, depth) => injectRowSubtotalLeaves(acc, depth, rowGroupby.length),
        raw,
      );
      const withMetrics = applyMetricAxis(
        withSubtotals,
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        rowGroupby.length,
      );
      return labelRowSubtotalLeaves(withMetrics, metrics);
    };

    const baseTree = buildTreeAtDepth(1);
    const branchTree = buildTreeAtDepth(2);

    fetchPivotBranchMock.mockResolvedValueOnce({ data: branchTree });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: true,
            colSubTotals: false,
            rowSubtotalLevels,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={true}
        colSubTotals={false}
        rowSubtotalLevels={rowSubtotalLevels}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const urgentRow = getByText('1-URGENT').closest('tr') as HTMLElement;
    fireEvent.click(within(urgentRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    expect(
      within(tbody).getAllByText('1-URGENT averageOrderValue'),
    ).toHaveLength(1);
    expect(
      within(tbody).getAllByText('1-URGENT weightedDiscount'),
    ).toHaveLength(1);
    expect(within(tbody).queryByText('1-URGENT Total')).toBeNull();

    const expandedUrgentRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(expandedUrgentRow).getByLabelText('minus-square'));

    await waitFor(() => {
      expect(
        within(tbody).queryByText('1-URGENT averageOrderValue'),
      ).toBeNull();
      expect(
        within(tbody).queryByText('1-URGENT weightedDiscount'),
      ).toBeNull();
    });
  });

  it('hides non-metric totals when metrics sit between row dimensions', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const rowSubtotalLevels = [1, 2];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'FOB',
        orderStatus: 'O',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 110,
        weightedDiscount: 0.06,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) => {
      const raw = buildTreeFromRecords(
        records,
        metrics,
        rowGroupby,
        colGroupby,
        rowDepth,
        1,
      );
      const withSubtotals = rowSubtotalLevels.reduce(
        (acc, depth) => injectRowSubtotalLeaves(acc, depth, rowGroupby.length),
        raw,
      );
      const withMetrics = applyMetricAxis(
        withSubtotals,
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );
      return labelRowSubtotalLeaves(withMetrics, metrics);
    };

    const baseTree = buildTreeAtDepth(1);
    const branchTree = buildTreeAtDepth(2);

    fetchPivotBranchMock.mockResolvedValueOnce({ data: branchTree });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: true,
            colSubTotals: false,
            rowSubtotalLevels,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={true}
        colSubTotals={false}
        rowSubtotalLevels={rowSubtotalLevels}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const urgentRow = getByText('1-URGENT').closest('tr') as HTMLElement;
    fireEvent.click(within(urgentRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    expect(within(tbody).queryByText('1-URGENT Total')).toBeNull();
  });

  it('shows metric subtotals only when row subtotals are enabled', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        rowGroupby.length,
      );

    const baseTree = buildTreeAtDepth(1);
    const branchTree = buildTreeAtDepth(2);

    fetchPivotBranchMock.mockResolvedValueOnce({ data: branchTree });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            rowSubtotalLevels: [],
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const urgentRow = getByText('1-URGENT').closest('tr') as HTMLElement;
    fireEvent.click(within(urgentRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    expect(within(tbody).queryByText('1-URGENT averageOrderValue')).toBeNull();
    expect(within(tbody).queryByText('1-URGENT weightedDiscount')).toBeNull();
    expect(within(tbody).queryByText('1-URGENT Total')).toBeNull();
  });

  it('expands Values to load orderStatus when metrics sit between shipMode and orderStatus', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );
    const buildCollapsedBranch = (rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'orderStatus'];
      return applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          collapsedGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        collapsedGroupby,
        colGroupby,
        1,
      );
    };

    const baseTree = buildTreeAtDepth(1);
    const orderStatusBranch = buildCollapsedBranch(2);

    fetchPivotBranchMock.mockResolvedValueOnce({ data: orderStatusBranch });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const metricLabel = within(tbody).getAllByText('averageOrderValue')[0];
    const metricRow = metricLabel.closest('tr') as HTMLElement;
    fireEvent.click(within(metricRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    expect(within(tbody).getByText(/^F$/)).toBeTruthy();
  });

  it('recalculates lower levels after expanding orderPriority above Values', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'MAIL',
        orderStatus: 'O',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 110,
        weightedDiscount: 0.06,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );

    const buildCollapsedBranch = (rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'orderStatus'];
      return applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          collapsedGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        collapsedGroupby,
        colGroupby,
        1,
      );
    };

    const baseTree = buildTreeAtDepth(1);
    const orderStatusBranch = buildCollapsedBranch(2);
    const shipModeBranch = buildTreeAtDepth(3);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: orderStatusBranch })
      .mockResolvedValueOnce({ data: shipModeBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const metricLabel = within(tbody).getAllByText('averageOrderValue')[0];
    const metricRow = metricLabel.closest('tr') as HTMLElement;
    fireEvent.click(within(metricRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const shipModeRow = getByText('AIR').closest('tr') as HTMLElement;
    const shipModeIndex = rows.indexOf(shipModeRow);
    const shipModeMetricRow = rows
      .slice(shipModeIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(shipModeMetricRow).toBeTruthy();
    expect(
      within(shipModeMetricRow as HTMLElement).getByLabelText('minus-square'),
    ).toBeTruthy();
    expect(
      within(shipModeMetricRow as HTMLElement).queryByLabelText('plus-square'),
    ).toBeNull();
    const statusRow = rows
      .slice(rows.indexOf(shipModeMetricRow as HTMLElement) + 1)
      .find(row => within(row).queryByText(/^F$/)) as
      | HTMLElement
      | undefined;
    expect(statusRow).toBeTruthy();
  });

  it('keeps orderStatus rows under Values after expanding orderPriority', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'MAIL',
        orderStatus: 'O',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 110,
        weightedDiscount: 0.06,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );

    const buildCollapsedBranch = (rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'orderStatus'];
      return applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          collapsedGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        collapsedGroupby,
        colGroupby,
        1,
      );
    };

    const baseTree = buildTreeAtDepth(1);
    const orderStatusBranch = buildCollapsedBranch(2);
    const shipModeBranch = buildTreeAtDepth(3);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: orderStatusBranch })
      .mockResolvedValueOnce({ data: shipModeBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const metricLabel = within(tbody).getAllByText('averageOrderValue')[0];
    const metricRow = metricLabel.closest('tr') as HTMLElement;
    fireEvent.click(within(metricRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    expect(within(tbody).getAllByText(/^F$/)).toHaveLength(1);
    expect(within(tbody).getAllByText(/^O$/)).toHaveLength(1);
  });

  it('keeps column values out of row headers when expanding above Values', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'FOB',
        orderStatus: 'O',
        shipInstruction: 'DELIVER IN PERSON',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 110,
        weightedDiscount: 0.06,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );

    const buildCollapsedBranch = (rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'orderStatus'];
      return applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          collapsedGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        collapsedGroupby,
        colGroupby,
        1,
      );
    };

    const baseTree = buildTreeAtDepth(1);
    const orderStatusBranch = buildCollapsedBranch(2);
    const shipModeBranch = buildTreeAtDepth(3);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: orderStatusBranch })
      .mockResolvedValueOnce({ data: shipModeBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const thead = container.querySelector('thead') as HTMLElement;
    const metricLabel = within(tbody).getAllByText('averageOrderValue')[0];
    const metricRow = metricLabel.closest('tr') as HTMLElement;
    fireEvent.click(within(metricRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    expect(within(thead).getByText('COLLECT COD')).toBeTruthy();
    expect(within(thead).getByText('DELIVER IN PERSON')).toBeTruthy();
    expect(within(tbody).queryByText('COLLECT COD')).toBeNull();
    expect(within(tbody).queryByText('DELIVER IN PERSON')).toBeNull();
    expect(within(tbody).getByText('AIR')).toBeTruthy();
    expect(within(tbody).getByText('FOB')).toBeTruthy();
  });

  it('expands Values and orderStatus when another level follows', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = [
      'orderPriority',
      'shipMode',
      'orderStatus',
      'orderClass',
    ];
    const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        orderStatus: 'F',
        orderClass: 'A',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
    ];
    const buildTreeAtDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );

    const buildCollapsedBranch = (rowDepth: number, collapsedGroupby: string[]) =>
      applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          collapsedGroupby,
          colGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        collapsedGroupby,
        colGroupby,
        1,
      );

    const baseTree = buildTreeAtDepth(1);
    const orderStatusBranch = buildCollapsedBranch(2, [
      'orderPriority',
      'orderStatus',
      'orderClass',
    ]);
    const orderClassBranch = buildCollapsedBranch(3, [
      'orderPriority',
      'orderStatus',
      'orderClass',
    ]);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: orderStatusBranch })
      .mockResolvedValueOnce({ data: orderClassBranch });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
              'orderClass',
            ],
            groupbyColumns: colGroupby,
            metrics,
            metricsLayout: MetricsLayoutEnum.ROWS,
            aggregateFunction: 'Sum',
            rowTotals: false,
            colTotals: false,
            rowSubTotals: false,
            colSubTotals: false,
            startCollapsed: true,
            initialDepth: 1,
            maxDepthPerFetch: 1,
            rowOrder: 'key_a_to_z',
            colOrder: 'key_a_to_z',
            viz_type: 'pivot_table_v3',
            datasource: '1__table',
            metricColorFormatters: [],
            dateFormatters: {},
            verboseMap: {},
          } as PivotTableQueryFormData
        }
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const metricLabel = within(tbody).getAllByText('averageOrderValue')[0];
    const metricRow = metricLabel.closest('tr') as HTMLElement;
    fireEvent.click(within(metricRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const statusRow = within(tbody).getByText(/^F$/).closest(
      'tr',
    ) as HTMLElement;
    fireEvent.click(within(statusRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    expect(within(tbody).getByText('A')).toBeTruthy();
  });
});
