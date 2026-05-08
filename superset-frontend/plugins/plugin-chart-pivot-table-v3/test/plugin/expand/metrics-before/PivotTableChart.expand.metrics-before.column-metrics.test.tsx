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
  decodeMetricKey,
  METRICS_PLACEHOLDER,
  mergeTrees,
} from '../../../../src/utils';
import { fetchPivotBranch } from '../../../../src/fetchPivotBranch';
import {
  buildMockBranchFetchResult,
  resolveMockBranchFetchResult,
} from '../../fixtures/factBatches';

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
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockImplementation(resolveMockBranchFetchResult());
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

      fetchPivotBranchMock.mockImplementationOnce(
        resolveMockBranchFetchResult({ data: mergedTree }),
      );

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
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: undefined }),
    );

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

    const colToggle = getAllByLabelText('plus-square')[0];
    fireEvent.click(colToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(getAllByLabelText('minus-square')[0]);

    const usaRow = getByText('USA').closest('tr') as HTMLTableRowElement;
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
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: columnBranchWithMetrics }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: rowBranchWithMetrics }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: finalColBranchWithMetrics }),
      );

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

    const getThead = () => container.querySelector('thead') as HTMLElement;
    fireEvent.click(within(getThead()).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.click(within(getThead()).getByLabelText('minus-square'));

    const usaRow = getByText('USA').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(usaRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(within(getThead()).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    const priorityCell = await within(tbody).findByText('HIGH');
    const priorityRow = priorityCell.closest('tr') as HTMLTableRowElement;
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

    type FetchPivotBranchArgs = Parameters<typeof fetchPivotBranch>[0];
    fetchPivotBranchMock.mockImplementation((params: FetchPivotBranchArgs) => {
      const { axis, path, visibleRowDepth } = params;
      const resolvedVisibleRowDepth = visibleRowDepth ?? 0;
      if (axis === 'col') {
        return Promise.resolve(
          buildMockBranchFetchResult(params, {
            data:
              resolvedVisibleRowDepth >= 2
                ? columnRefetchWithMetrics
                : columnBranchWithMetrics,
          }),
        );
      }
      if (path[0] === 'USA') {
        return Promise.resolve(
          buildMockBranchFetchResult(params, {
            data: usaRowBranchWithMetrics,
          }),
        );
      }
      if (path[0] === 'CAN') {
        return Promise.resolve(
          buildMockBranchFetchResult(params, {
            data: canRowBranchWithMetrics,
          }),
        );
      }
      return Promise.resolve(buildMockBranchFetchResult(params));
    });

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

    const getThead = () => container.querySelector('thead') as HTMLElement;
    fireEvent.click(within(getThead()).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(within(getThead()).getByLabelText('minus-square'));

    const usaRow = getByText('USA').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(usaRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Re-expand columns with deeper row depth, then collapse again.
    fireEvent.click(within(getThead()).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    fireEvent.click(within(getThead()).getByLabelText('minus-square'));

    const canRow = getByText('CAN').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(canRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    const tbody = container.querySelector('tbody') as HTMLElement;
    const canChildCell = await within(tbody).findByText('HIGH');
    const canChildRow = canChildCell.closest('tr') as HTMLTableRowElement;
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
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals
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

  it('suppresses the grand total when a single metric is first on columns', () => {
    const metrics = ['measure1'];
    const rowGroupby = ['orderPriority', 'discountBand', 'customerSegment'];
    const colGroupby = ['revenueBand'];
    const baseTreeRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          discountBand: 'LOW',
          customerSegment: 'CONSUMER',
          measure1: 10,
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

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER, 'revenueBand'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals
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

    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toContain('measure1');
    expect(headerLabels).not.toContain('Grand total');
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

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: colBranchWithMetrics }),
    );

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER, 'revenueBand'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals
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

    const branchRecords = [
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
    ];
    const buildMetricBranch = (metric: string) =>
      applyMetricAxis(
        buildTreeFromRecords(
          branchRecords,
          [metric],
          rowGroupby,
          colGroupby,
          1,
          1,
        ),
        [metric],
        MetricsLayoutEnum.COLUMNS,
        rowGroupby,
        colGroupby,
        0,
      );

    fetchPivotBranchMock.mockImplementation(params =>
      Promise.resolve(
        buildMockBranchFetchResult(params, {
          data: buildMetricBranch(
            decodeMetricKey(params.path?.[0]) ?? 'measure1',
          ),
        }),
      ),
    );

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

    const branchRecords = [
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
    ];
    const buildMetricBranch = (metric: string) =>
      applyMetricAxis(
        buildTreeFromRecords(
          branchRecords,
          [metric],
          rowGroupby,
          colGroupby,
          1,
          1,
        ),
        [metric],
        MetricsLayoutEnum.COLUMNS,
        rowGroupby,
        colGroupby,
        0,
      );

    fetchPivotBranchMock.mockImplementation(params =>
      Promise.resolve(
        buildMockBranchFetchResult(params, {
          data: buildMetricBranch(
            decodeMetricKey(params.path?.[0]) ?? 'measure1',
          ),
        }),
      ),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER, 'col2'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          colTotals: true,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals
        rowTotals
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
    expect(lastRowLabels).toEqual(['Total', 'C2-A', 'C2-B']);

    const firstBodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(firstBodyRow.querySelectorAll('td').length).toBe(6);
  });

  it('labels metric-first column totals as "Total" and hides metric toggles after expansion', async () => {
    const metrics = ['metric1', 'metric2'];
    const records = [{ col1: 'A', metric1: 10, metric2: 20 }];

    const baseTreeRaw = buildTreeFromRecords(
      records,
      metrics,
      [],
      ['col1'],
      0,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1'],
      0,
    );

    const expandedRaw = buildTreeFromRecords(
      records,
      metrics,
      [],
      ['col1'],
      0,
      1,
    );
    const expandedTree = applyMetricAxis(
      expandedRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1'],
      0,
    );

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({
        data: mergeTrees(baseTree, expandedTree),
      }),
    );

    const { container, getAllByLabelText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [],
          groupbyColumns: [METRICS_PLACEHOLDER, 'col1'],
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={['col1']}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals
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

    fireEvent.click(getAllByLabelText('plus-square')[0]);

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const thead = container.querySelector('thead') as HTMLElement;
    const headerRows = within(thead).getAllByRole('row');
    expect(within(headerRows[1]).getAllByText('Total')).toHaveLength(1);

    const totalHeaderCell = within(headerRows[1])
      .getAllByText('Total')[0]
      .closest('th') as HTMLElement;
    expect(
      within(totalHeaderCell).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(totalHeaderCell).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
  });

  it('treats metric-first column totals as bold totals without duplicate headers', async () => {
    const metrics = ['metric1'];
    const records = [{ col1: 'A', col2: 'B', metric1: 10 }];

    const baseTreeRaw = buildTreeFromRecords(
      records,
      metrics,
      [],
      ['col1', 'col2'],
      0,
      1,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1', 'col2'],
      0,
    );

    const expandedRaw = buildTreeFromRecords(
      records,
      metrics,
      [],
      ['col1', 'col2'],
      0,
      2,
    );
    const expandedTree = applyMetricAxis(
      expandedRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1', 'col2'],
      0,
    );

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({
        data: mergeTrees(baseTree, expandedTree),
      }),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [],
          groupbyColumns: [METRICS_PLACEHOLDER, 'col1', 'col2'],
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={['col1', 'col2']}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals
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

    const thead = container.querySelector('thead') as HTMLElement;
    const metricHeaderCell = within(thead)
      .getByText('metric1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(metricHeaderCell).getByLabelText('plus-square'));

    await waitFor(() => {
      const refreshed = container.querySelector('thead') as HTMLElement;
      expect(within(refreshed).getByText('A')).toBeInTheDocument();
    });

    const updatedHead = container.querySelector('thead') as HTMLElement;
    const colHeaderCell = within(updatedHead)
      .getByText('A')
      .closest('th') as HTMLElement;
    fireEvent.click(within(colHeaderCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const refreshedHead = container.querySelector('thead') as HTMLElement;
    const totalCells = within(refreshedHead)
      .getAllByText('Total')
      .map(node => node.closest('th') as HTMLElement)
      .filter(cell => cell);
    expect(totalCells).toHaveLength(1);
    expect(totalCells[0]).toHaveClass('subtotal-cell');
  });
});
