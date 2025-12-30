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
import PivotTableChart from '../../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum } from '../../../../src/types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  METRICS_PLACEHOLDER,
} from '../../../../src/utils';
import { fetchPivotBranch } from '../../../../src/fetchPivotBranch';
import { buildFormData } from '../../fixtures/pivotFormData';

jest.mock('../../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
  };
});

describe('PivotTableChart expansion with metrics between dimensions (metrics-tier)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const metrics = ['averageOrderValue', 'weightedDiscount'];
  const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
  const colGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
  const baseOrderRecord = {
    orderPriority: '1-URGENT',
    shipMode: 'AIR',
    orderStatus: 'F',
    shipInstruction: 'COLLECT COD',
    customerSegment: 'AUTO',
    returnFlag: 'N',
    averageOrderValue: 100,
    weightedDiscount: 0.05,
  };
  const secondaryOrderRecord = {
    ...baseOrderRecord,
    shipMode: 'FOB',
    orderStatus: 'O',
    averageOrderValue: 110,
    weightedDiscount: 0.06,
  };
  const orderRecords = [baseOrderRecord, secondaryOrderRecord];

  it('shows metrics as the second layer without toggles for orderPriority → Values layout', async () => {
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
        formData={buildFormData(
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
          })
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
    const baseRaw = buildTreeFromRecords(
      [baseOrderRecord],
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
      [baseOrderRecord],
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
        formData={buildFormData(
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
          })
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
    const rowSubtotalLevels = [1, 2];
    const records = orderRecords;
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
        formData={buildFormData(
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
          })
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
    const rowSubtotalLevels = [1, 2];
    const records = orderRecords;
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
        formData={buildFormData(
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
          })
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
    const records = [baseOrderRecord];
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
        formData={buildFormData(
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
          })
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

});