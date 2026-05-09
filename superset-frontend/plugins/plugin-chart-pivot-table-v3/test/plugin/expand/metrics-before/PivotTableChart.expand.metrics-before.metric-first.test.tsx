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

import { render, fireEvent, waitFor, within } from '../../../testUtils';
import PivotTableChart, {
  buildPreloadedBootstrapFactBatches,
} from '../../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, type PivotTreeData } from '../../../../src/types';
import { baseFormData, buildFormData } from '../../fixtures/pivotFormData';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  serializeCellKey,
  serializePath,
} from '../../../../src/utils';
import {
  fetchPivotBranch,
  type FetchPivotBranchParams,
} from '../../../../src/fetchPivotBranch';
import { buildMockBranchFetchResult } from '../../fixtures/factBatches';
import { buildTreeFromRecords } from '../../fixtures/buildTreeFromRecords';
import {
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  applyMetricAxis,
} from '../../fixtures/metricAxis';

jest.mock('../../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart expansion with metrics before dimensions (metric-first)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const resolveBranchData =
    (data?: PivotTreeData) => (params: FetchPivotBranchParams) =>
      Promise.resolve(buildMockBranchFetchResult(params, { data }));

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockImplementation(resolveBranchData());
  });

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
      [serializePath(['A', encodeMetricKey('countCustomers')])]: {
        axis: 'row',
        key: serializePath(['A', encodeMetricKey('countCustomers')]),
        path: ['A', encodeMetricKey('countCustomers')],
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
      [serializeCellKey(serializePath(['A']), serializePath([]))]: {
        rowKey: serializePath(['A']),
        colKey: serializePath([]),
        values: { countCustomers: 1 },
      },
      [serializeCellKey(
        serializePath(['A', encodeMetricKey('countCustomers')]),
        serializePath([]),
      )]: {
        rowKey: serializePath(['A', encodeMetricKey('countCustomers')]),
        colKey: serializePath([]),
        values: { countCustomers: 1 },
      },
    },
  };

  it('still fetches branch when only metric-tier children are present', async () => {
    const { getAllByLabelText, queryAllByText } = render(
      <PivotTableChart
        data={treeWithMetricChildOnly}
        formData={buildFormData(baseFormData)}
        metrics={['countCustomers']}
        groupbyRows={['r1', 'r2']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
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
        [serializePath([encodeMetricKey('m1')])]: {
          axis: 'row',
          key: serializePath([encodeMetricKey('m1')]),
          path: [encodeMetricKey('m1')],
          label: 'm1',
          formattedLabel: 'm1',
          level: 1,
          hasChildren: true,
        },
        [serializePath([encodeMetricKey('m1'), 'A'])]: {
          axis: 'row',
          key: serializePath([encodeMetricKey('m1'), 'A']),
          path: [encodeMetricKey('m1'), 'A'],
          label: 'A',
          formattedLabel: 'A',
          level: 2,
          hasChildren: true,
        },
        [serializePath([encodeMetricKey('m1'), 'A', 'B'])]: {
          axis: 'row',
          key: serializePath([encodeMetricKey('m1'), 'A', 'B']),
          path: [encodeMetricKey('m1'), 'A', 'B'],
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
        [serializeCellKey(
          serializePath([encodeMetricKey('m1'), 'A', 'B']),
          serializePath([]),
        )]: {
          rowKey: serializePath([encodeMetricKey('m1'), 'A', 'B']),
          colKey: serializePath([]),
          values: { m1: 5 },
        },
      },
    };

    const { queryAllByText, container } = render(
      <PivotTableChart
        data={metricFirstTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [METRICS_PLACEHOLDER, 'r1', 'r2'],
          metrics: ['m1'],
        })}
        metrics={['m1']}
        groupbyRows={['r1', 'r2']}
        groupbyColumns={[]}
        factBatches={buildPreloadedBootstrapFactBatches(metricFirstTree, {
          groupbyRows: ['r1', 'r2'],
          groupbyColumns: [],
        })}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
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
      .mockImplementationOnce(resolveBranchData(returnFlagTree))
      .mockImplementationOnce(resolveBranchData(orderPriorityTree));

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: [METRICS_PLACEHOLDER, ...rowGroupby],
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.ROWS,
          aggregateFunction: 'Sum',
          colTotals: false,
          rowTotals: false,
          rowSubTotals: true,
          rowSubtotalLevels,
          rowSubtotalPosition: 'start',
          startCollapsed: true,
          initialDepth: 1,
          rowOrder: 'key_a_to_z',
          colOrder: 'key_a_to_z',
          viz_type: 'pivot_table_v3',
          datasource: '1__table',
          metricColorFormatters: [],
          dateFormatters: {},
          verboseMap: {},
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
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
      .closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(avgRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const returnFlagRow = within(tbody)
      .getByText(/^A$/)
      .closest('tr') as HTMLTableRowElement;
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
      .mockImplementationOnce(resolveBranchData(returnFlagTree))
      .mockImplementationOnce(resolveBranchData(orderPriorityTree))
      .mockImplementationOnce(resolveBranchData(orderStatusTree));

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: [METRICS_PLACEHOLDER, ...rowGroupby],
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.ROWS,
          aggregateFunction: 'Sum',
          colTotals: false,
          rowTotals: false,
          rowSubTotals: true,
          rowSubtotalLevels,
          rowSubtotalPosition: 'start',
          startCollapsed: true,
          initialDepth: 1,
          rowOrder: 'key_a_to_z',
          colOrder: 'key_a_to_z',
          viz_type: 'pivot_table_v3',
          datasource: '1__table',
          metricColorFormatters: [],
          dateFormatters: {},
          verboseMap: {},
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
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
      .closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(avgRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const returnFlagRow = within(tbody)
      .getByText(/^A$/)
      .closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(returnFlagRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const orderPriorityRow = within(tbody)
      .getByText('1-URGENT')
      .closest('tr') as HTMLTableRowElement;
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
});
