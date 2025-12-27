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
import { fetchPivotBranch } from '../../src/fetchPivotBranch';

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
});
