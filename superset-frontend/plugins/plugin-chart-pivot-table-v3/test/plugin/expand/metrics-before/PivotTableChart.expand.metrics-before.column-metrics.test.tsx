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
import PivotTableChart from '../../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum } from '../../../../src/types';
import { baseFormData, buildFormData } from '../../fixtures/pivotFormData';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  METRICS_PLACEHOLDER,
  mergeTrees,
} from '../../../../src/utils';
import { fetchPivotBranch } from '../../../../src/fetchPivotBranch';

jest.mock('../../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart expansion with metrics before dimensions (column-metrics)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const buildRowGroupby = (depth: number) =>
    Array.from({ length: depth }, (_, index) => `r${index + 1}`);
  const buildRowValues = (depth: number) =>
    Array.from({ length: depth }, (_, index) =>
      String.fromCharCode(65 + index),
    );

  test.each([2, 3, 5])(
    'expands row to the next dimension when metrics are on columns (depth %i)',
    async depth => {
      const rowGroupby = buildRowGroupby(depth);
      const rowValues = buildRowValues(depth);
      const baseRecord = Object.fromEntries(
        rowGroupby.map((field, index) => [field, rowValues[index]]),
      ) as Record<string, string | number>;
      baseRecord.m1 = 5;
      const branchRecord = { ...baseRecord, m1: 10 };
      const baseTreeRaw = buildTreeFromRecords(
        [baseRecord],
        ['m1'],
        rowGroupby,
        ['c1'],
        1,
        0,
      );
      const baseTree = applyMetricAxis(
        baseTreeRaw,
        ['m1'],
        MetricsLayoutEnum.COLUMNS,
        rowGroupby,
        ['c1'],
        0,
      );

      const branchRaw = buildTreeFromRecords(
        [branchRecord],
        ['m1'],
        rowGroupby,
        ['c1'],
        2,
        0,
      );
      const branchWithMetrics = applyMetricAxis(
        branchRaw,
        ['m1'],
        MetricsLayoutEnum.COLUMNS,
        rowGroupby,
        ['c1'],
        0,
      );
      const mergedTree = mergeTrees(baseTree, branchWithMetrics);

      fetchPivotBranchMock.mockResolvedValueOnce({ data: mergedTree });

      const { findByText, container } = render(
        <PivotTableChart
          data={baseTree}
          formData={buildFormData({
            ...baseFormData,
            groupbyRows: rowGroupby,
            groupbyColumns: [METRICS_PLACEHOLDER, 'c1'],
            metrics: ['m1'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
          })}
          metrics={['m1']}
          groupbyRows={rowGroupby}
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

      expect(await findByText(rowValues[1])).toBeInTheDocument();
    },
  );

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
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['nation', 'orderPriority'],
          groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['countCustomers'],
        })}
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
    expect(getByText('USA')).toBeInTheDocument();
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
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['nation', 'orderPriority'],
          groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['countCustomers'],
        })}
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
    expect(within(priorityRow).getByText('7')).toBeInTheDocument();
  });

  it('keeps values when expanding multiple rows after collapsing columns twice', async () => {
    const baseTreeRaw = buildTreeFromRecords(
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
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['nation', 'orderPriority'],
          groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['countCustomers'],
        })}
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
    expect(within(canChildRow).getByText('20')).toBeInTheDocument();
  });

  it('shows metric headers without a grand total when metrics are first on columns', () => {
    const metrics = ['measure1', 'measure2'];
    const rowGroupby = ['orderPriority', 'discountBand', 'customerSegment'];
    const colGroupby = ['revenueBand'];
    const baseTreeRaw = buildTreeFromRecords(
      [{ orderPriority: '1-URGENT', measure1: 10, measure2: 20 }],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER, 'revenueBand'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colTotals: true,
        })}
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
        colTotals
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

    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toEqual(expect.arrayContaining(metrics));
    expect(headerLabels).not.toContain('Grand total');

    const metricCell = within(container.querySelector('thead') as HTMLElement)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    expect(
      within(metricCell).getByLabelText('plus-square'),
    ).toBeInTheDocument();
  });

  it('expands a metric column to the next level when metrics are first', async () => {
    const metrics = ['measure1', 'measure2'];
    const rowGroupby = ['orderPriority', 'discountBand', 'customerSegment'];
    const colGroupby = ['revenueBand'];
    const baseTreeRaw = buildTreeFromRecords(
      [{ orderPriority: '1-URGENT', measure1: 10, measure2: 20 }],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );

    const colBranchRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          revenueBand: 'REV-A',
          measure1: 10,
          measure2: 20,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const colBranchWithMetrics = applyMetricAxis(
      colBranchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );

    fetchPivotBranchMock.mockResolvedValueOnce({ data: colBranchWithMetrics });

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER, 'revenueBand'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colTotals: true,
        })}
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
        colTotals
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
    const metricCell = within(thead)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(metricCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    expect(await findByText('REV-A')).toBeInTheDocument();
  });

  it('keeps column layout stable when collapsing one expanded metric', async () => {
    const metrics = ['measure1', 'measure2', 'measure3', 'measure4'];
    const rowGroupby = ['orderPriority', 'discountBand', 'customerSegment'];
    const colGroupby = ['col2'];
    const baseTreeRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          discountBand: 'LOW',
          customerSegment: 'CONSUMER',
          measure1: 10,
          measure2: 20,
          measure3: 30,
          measure4: 40,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );

    const colBranchRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          discountBand: 'LOW',
          customerSegment: 'CONSUMER',
          col2: 'C2-A',
          measure1: 10,
          measure2: 20,
          measure3: 30,
          measure4: 40,
        },
        {
          orderPriority: '1-URGENT',
          discountBand: 'LOW',
          customerSegment: 'CONSUMER',
          col2: 'C2-B',
          measure1: 11,
          measure2: 21,
          measure3: 31,
          measure4: 41,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const colBranchWithMetrics = applyMetricAxis(
      colBranchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );

    fetchPivotBranchMock.mockResolvedValue({ data: colBranchWithMetrics });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER, 'col2'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
        })}
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

    const thead = container.querySelector('thead') as HTMLElement;
    const measure1Header = within(thead)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(measure1Header).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const measure2Header = within(thead)
      .getByText('measure2')
      .closest('th') as HTMLElement;
    fireEvent.click(within(measure2Header).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(within(measure1Header).getByLabelText('minus-square'));

    await waitFor(() => {
      const refreshed = container.querySelector('thead') as HTMLElement;
      const headerLabels = within(refreshed)
        .getAllByText('measure1')
        .filter(node =>
          (node.closest('th') as HTMLElement | null)?.querySelector(
            '[aria-label="plus-square"]',
          ),
        );
      expect(headerLabels.length).toBeGreaterThan(0);
    });

    const lastHeaderRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const lastRowLabels = within(lastHeaderRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(lastRowLabels).toEqual(['C2-A', 'C2-B']);

    const firstBodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(firstBodyRow.querySelectorAll('td').length).toBe(5);
  });

  it('keeps metric-first headers consistent after collapsing one expanded metric with totals', async () => {
    const metrics = ['measure1', 'measure2', 'measure3', 'measure4'];
    const rowGroupby = ['orderPriority', 'discountBand', 'customerSegment'];
    const colGroupby = ['col2'];
    const baseTreeRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          discountBand: 'LOW',
          customerSegment: 'CONSUMER',
          measure1: 10,
          measure2: 20,
          measure3: 30,
          measure4: 40,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );

    const colBranchRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          discountBand: 'LOW',
          customerSegment: 'CONSUMER',
          col2: 'C2-A',
          measure1: 10,
          measure2: 20,
          measure3: 30,
          measure4: 40,
        },
        {
          orderPriority: '1-URGENT',
          discountBand: 'LOW',
          customerSegment: 'CONSUMER',
          col2: 'C2-B',
          measure1: 11,
          measure2: 21,
          measure3: 31,
          measure4: 41,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const colBranchWithMetrics = applyMetricAxis(
      colBranchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );

    fetchPivotBranchMock.mockResolvedValue({ data: colBranchWithMetrics });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER, 'col2'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colTotals: true,
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        maxDepthPerFetch={1}
        rowTotals
        colTotals
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
    const measure1Header = within(thead)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(measure1Header).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const measure2Header = within(thead)
      .getByText('measure2')
      .closest('th') as HTMLElement;
    fireEvent.click(within(measure2Header).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(within(measure1Header).getByLabelText('minus-square'));

    await waitFor(() => {
      const refreshed = container.querySelector('thead') as HTMLElement;
      const measure1Cells = within(refreshed)
        .getAllByText('measure1')
        .map(node => node.closest('th') as HTMLElement)
        .filter(cell => cell);
      expect(measure1Cells).toHaveLength(1);
      expect(
        within(measure1Cells[0]).getByLabelText('plus-square'),
      ).toBeInTheDocument();
    });

    const refreshedHead = container.querySelector('thead') as HTMLElement;
    const measure2Cells = within(refreshedHead)
      .getAllByText('measure2')
      .map(node => node.closest('th') as HTMLElement)
      .filter(cell => cell);
    expect(measure2Cells.length).toBeGreaterThan(0);
    expect(
      within(measure2Cells[0]).getByLabelText('minus-square'),
    ).toBeInTheDocument();

    const lastHeaderRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const lastRowLabels = within(lastHeaderRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(lastRowLabels).toEqual(['measure2', 'C2-A', 'C2-B']);

    const firstBodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(firstBodyRow.querySelectorAll('td').length).toBe(6);
  });
});
