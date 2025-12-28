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
          maxDepthPerFetch={2}
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
        expect(within(canRowEl).getByText('35')).toBeTruthy();
      });
      const orderStatusRow = await findByText('F');
      const orderStatusRowEl = orderStatusRow.closest('tr') as HTMLElement;
      expect(within(orderStatusRowEl).getByText('15')).toBeTruthy();
    } finally {
      postSpy.mockRestore();
      fetchPivotBranchMock.mockReset();
      fetchPivotBranchMock.mockResolvedValue({ data: undefined });
      peekPivotBranchCacheMock.mockReset();
    }
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
