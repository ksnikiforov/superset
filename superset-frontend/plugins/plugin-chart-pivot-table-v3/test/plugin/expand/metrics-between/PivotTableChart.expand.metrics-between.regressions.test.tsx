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
import { MetricsLayoutEnum, type PivotTreeData } from '../../../../src/types';
import { decodeMetricKey, METRICS_PLACEHOLDER } from '../../../../src/utils';
import {
  fetchPivotBranch,
  type FetchPivotBranchParams,
} from '../../../../src/fetchPivotBranch';
import { buildFormData } from '../../fixtures/pivotFormData';
import {
  buildMockBranchFetchResult,
  resolveMockBranchFetchResult,
} from '../../fixtures/factBatches';
import { buildTreeFromRecords } from '../../fixtures/buildTreeFromRecords';
import {
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  applyMetricAxis,
} from '../../../../src/pivot/runtime/materializePivotTree';

jest.mock('../../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
  };
});

describe('PivotTableChart expansion with metrics between dimensions (regressions)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const getMetricKey = (value: unknown) =>
    decodeMetricKey(value) ?? String(value ?? '');
  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockImplementation(resolveMockBranchFetchResult());
  });

  const waitForPivotReady = async () => {
    await waitFor(() =>
      expect(
        document.querySelector('[role="status"][aria-label="Loading"]'),
      ).not.toBeInTheDocument(),
    );
  };

  const metrics = ['averageOrderValue', 'weightedDiscount'];

  it('keeps metric toggle state and values consistent after collapsing orderPriority', async () => {
    const rowGroupby = [
      'orderPriority',
      'shipMode',
      'returnFlag',
      'shipInstruction',
    ];
    const colGroupby = ['lineStatus'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'A',
        shipInstruction: 'COLLECT COD',
        lineStatus: 'F',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
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
    const buildCollapsedBranch = (data: typeof records, rowDepth: number) => {
      const collapsedGroupby = [
        'orderPriority',
        'returnFlag',
        'shipInstruction',
      ];
      return applyMetricAxis(
        buildTreeFromRecords(
          data,
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

    const baseTree = buildTreeAtDepth(records, 1);
    const metricBranch = buildCollapsedBranch(records, 2);
    const returnFlagBranch = buildCollapsedBranch(records, 3);
    const shipModeBranch = buildTreeAtDepth(records, 2);
    const shipModeReturnFlagBranch = buildTreeAtDepth(records, 3);
    const shipInstructionBranch = buildTreeAtDepth(records, 4);

    fetchPivotBranchMock
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: metricBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: returnFlagBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipModeBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipModeReturnFlagBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipInstructionBranch }),
      );

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: [
            'orderPriority',
            'shipMode',
            METRICS_PLACEHOLDER,
            'returnFlag',
            'shipInstruction',
          ],
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.ROWS,
          aggregateFunction: 'Sum',
          colTotals: false,
          rowTotals: false,
          rowSubTotals: false,
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
    await waitForPivotReady();

    const tbody = container.querySelector('tbody') as HTMLElement;
    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLTableRowElement;
    const initialRows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const metricRow = initialRows
      .slice(initialRows.indexOf(orderPriorityRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(metricRow).toBeTruthy();
    fireEvent.click(
      within(metricRow as HTMLElement).getByLabelText('plus-square'),
    );

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

    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(5);
    });

    fireEvent.click(within(orderPriorityRow).getByLabelText('minus-square'));

    const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const collapsedMetricRow = rows
      .slice(rows.indexOf(orderPriorityRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(collapsedMetricRow).toBeTruthy();
    expect(
      within(collapsedMetricRow as HTMLElement).queryByLabelText(
        'minus-square',
      ),
    ).not.toBeInTheDocument();
    expect(
      within(collapsedMetricRow as HTMLElement).getByLabelText('plus-square'),
    ).toBeInTheDocument();
    const metricValueCell = Array.from(
      (collapsedMetricRow as HTMLElement).querySelectorAll('td'),
    ).find(cell => cell.textContent && cell.textContent.trim() !== '');
    expect(metricValueCell).toBeTruthy();

    const collapsedDiscountRow = rows
      .slice(rows.indexOf(collapsedMetricRow as HTMLElement) + 1)
      .find(row => within(row).queryByText('weightedDiscount')) as
      | HTMLElement
      | undefined;
    expect(collapsedDiscountRow).toBeTruthy();
    const discountValueCell = Array.from(
      (collapsedDiscountRow as HTMLElement).querySelectorAll('td'),
    ).find(cell => cell.textContent && cell.textContent.trim() !== '');
    expect(discountValueCell).toBeTruthy();
    expect(within(tbody).queryByText(/^A$/)).not.toBeInTheDocument();
    expect(within(tbody).queryByText('COLLECT COD')).not.toBeInTheDocument();
  });

  it('renders returnFlag values and suppresses top-positioned subtotals after re-expanding a metric', async () => {
    const rowGroupby = [
      'orderPriority',
      'shipMode',
      'returnFlag',
      'shipInstruction',
    ];
    const colGroupby = ['lineStatus'];
    const rowSubtotalLevels = [1, 2, 3];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'A',
        shipInstruction: 'COLLECT COD',
        lineStatus: 'F',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'A',
        shipInstruction: 'DELIVER IN PERSON',
        lineStatus: 'O',
        averageOrderValue: 120,
        weightedDiscount: 0.07,
      },
    ];
    const applyRowSubtotals = (
      tree: PivotTreeData,
      rowDepth: number,
      fullDepth: number,
    ) =>
      rowSubtotalLevels
        .filter(level => level > 0 && level <= rowDepth)
        .reduce(
          (acc, depth) => injectRowSubtotalLeaves(acc, depth, fullDepth),
          tree,
        );
    const buildTreeAtDepth = (data: typeof records, rowDepth: number) => {
      const tree = buildTreeFromRecords(
        data,
        metrics,
        rowGroupby,
        colGroupby,
        rowDepth,
        1,
      );
      const withSubtotals = applyRowSubtotals(
        tree,
        rowDepth,
        rowGroupby.length,
      );
      return labelRowSubtotalLeaves(
        applyMetricAxis(
          withSubtotals,
          metrics,
          MetricsLayoutEnum.ROWS,
          rowGroupby,
          colGroupby,
          2,
        ),
        metrics,
      );
    };
    const buildCollapsedBranch = (data: typeof records, rowDepth: number) => {
      const collapsedGroupby = [
        'orderPriority',
        'returnFlag',
        'shipInstruction',
      ];
      const tree = buildTreeFromRecords(
        data,
        metrics,
        collapsedGroupby,
        colGroupby,
        rowDepth,
        1,
      );
      const withSubtotals = applyRowSubtotals(
        tree,
        rowDepth,
        collapsedGroupby.length,
      );
      return labelRowSubtotalLeaves(
        applyMetricAxis(
          withSubtotals,
          metrics,
          MetricsLayoutEnum.ROWS,
          collapsedGroupby,
          colGroupby,
          1,
        ),
        metrics,
      );
    };

    const baseTree = buildTreeAtDepth(records, 1);
    const metricBranch = buildCollapsedBranch(records, 2);
    const returnFlagBranch = buildCollapsedBranch(records, 3);
    const shipModeBranch = buildTreeAtDepth(records, 2);
    const shipModeReturnFlagBranch = buildTreeAtDepth(records, 3);
    const shipInstructionBranch = buildTreeAtDepth(records, 4);

    fetchPivotBranchMock
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: metricBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: returnFlagBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipModeBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipModeReturnFlagBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipInstructionBranch }),
      );

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: [
            'orderPriority',
            'shipMode',
            METRICS_PLACEHOLDER,
            'returnFlag',
            'shipInstruction',
          ],
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
    await waitForPivotReady();

    const tbody = container.querySelector('tbody') as HTMLElement;
    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLTableRowElement;
    const initialRows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const metricRow = initialRows
      .slice(initialRows.indexOf(orderPriorityRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(metricRow).toBeTruthy();
    fireEvent.click(
      within(metricRow as HTMLElement).getByLabelText('plus-square'),
    );

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

    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(5);
    });

    fireEvent.click(within(orderPriorityRow).getByLabelText('minus-square'));

    const collapsedRows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const collapsedMetricRow = collapsedRows
      .slice(collapsedRows.indexOf(orderPriorityRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(collapsedMetricRow).toBeTruthy();
    fireEvent.click(
      within(collapsedMetricRow as HTMLElement).getByLabelText('plus-square'),
    );

    const reopenedReturnFlagRow = (await waitFor(() =>
      within(tbody).getByText(/^A$/).closest('tr'),
    )) as HTMLElement;
    fireEvent.click(
      within(reopenedReturnFlagRow).getByLabelText('plus-square'),
    );

    await waitFor(() => {
      expect(within(tbody).getByText('COLLECT COD')).toBeInTheDocument();
    });

    const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const returnFlagRowIndex = rows.indexOf(reopenedReturnFlagRow);
    const subtotalRow = rows
      .slice(returnFlagRowIndex + 1)
      .find(row => within(row).queryByText('A Total')) as
      | HTMLElement
      | undefined;
    expect(subtotalRow).toBeUndefined();
    const instructionRow = rows
      .slice(returnFlagRowIndex + 1)
      .find(row => within(row).queryByText('COLLECT COD')) as
      | HTMLElement
      | undefined;
    expect(instructionRow).toBeTruthy();

    const hasValue = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('td')).some(
        cell => cell.textContent && cell.textContent.trim() !== '',
      );
    expect(hasValue(reopenedReturnFlagRow as HTMLElement)).toBeTruthy();
  });

  it('keeps metric values after collapsing and re-expanding returnFlag when metrics are last', async () => {
    const rowGroupby = [
      'orderPriority',
      'shipMode',
      'returnFlag',
      'shipInstruction',
    ];
    const colGroupby = ['lineStatus'];
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'A',
        shipInstruction: 'COLLECT COD',
        lineStatus: 'F',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'A',
        shipInstruction: 'DELIVER IN PERSON',
        lineStatus: 'O',
        averageOrderValue: 120,
        weightedDiscount: 0.07,
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
        rowGroupby.length,
      );

    const baseTree = buildTreeAtDepth(records, 1);
    const shipModeBranch = buildTreeAtDepth(records, 2);
    const returnFlagBranch = buildTreeAtDepth(records, 3);
    const shipInstructionBranch = buildTreeAtDepth(records, 4);

    fetchPivotBranchMock
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipModeBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: returnFlagBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipInstructionBranch }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: shipInstructionBranch }),
      );

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: [
            'orderPriority',
            'shipMode',
            'returnFlag',
            'shipInstruction',
            METRICS_PLACEHOLDER,
          ],
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.ROWS,
          aggregateFunction: 'Sum',
          colTotals: false,
          rowTotals: false,
          rowSubTotals: false,
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
    await waitForPivotReady();

    const tbody = container.querySelector('tbody') as HTMLElement;
    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLTableRowElement;
    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const shipModeRow = within(tbody)
      .getByText('AIR')
      .closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(shipModeRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const returnFlagRow = within(tbody)
      .getByText(/^A$/)
      .closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(returnFlagRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const instructionRow = within(tbody)
      .getByText('COLLECT COD')
      .closest('tr') as HTMLTableRowElement;
    const instructionIndex = rows.indexOf(instructionRow);
    const metricRow = rows
      .slice(instructionIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(metricRow).toBeTruthy();
    const metricValueCell = Array.from(
      (metricRow as HTMLElement).querySelectorAll('td'),
    ).find(cell => cell.textContent && cell.textContent.trim() !== '');
    expect(metricValueCell).toBeTruthy();

    fireEvent.click(within(returnFlagRow).getByLabelText('minus-square'));
    fireEvent.click(within(returnFlagRow).getByLabelText('plus-square'));

    const reopenedInstructionRow = (await waitFor(() =>
      within(tbody).getByText('COLLECT COD').closest('tr'),
    )) as HTMLElement;
    const reopenedRows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const reopenedMetricRow = reopenedRows
      .slice(reopenedRows.indexOf(reopenedInstructionRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(reopenedMetricRow).toBeTruthy();
    const reopenedValueCell = Array.from(
      (reopenedMetricRow as HTMLElement).querySelectorAll('td'),
    ).find(cell => cell.textContent && cell.textContent.trim() !== '');
    expect(reopenedValueCell).toBeTruthy();
  });

  it('keeps column values out of row headers when expanding above Values', async () => {
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

    fetchPivotBranchMock.mockImplementation(
      (params: FetchPivotBranchParams) => {
        const { path } = params;
        const metricIndex = path.findIndex(val =>
          metrics.includes(getMetricKey(val)),
        );
        if (metricIndex >= 0) {
          return Promise.resolve(
            buildMockBranchFetchResult(params, { data: orderStatusBranch }),
          );
        }
        if (path.length === 1) {
          return Promise.resolve(
            buildMockBranchFetchResult(params, { data: shipModeBranch }),
          );
        }
        return Promise.resolve(buildMockBranchFetchResult(params));
      },
    );

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
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
          colTotals: false,
          rowTotals: false,
          rowSubTotals: false,
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
    await waitForPivotReady();

    const tbody = container.querySelector('tbody') as HTMLElement;
    const thead = container.querySelector('thead') as HTMLElement;
    const metricLabel = within(tbody).getAllByText('averageOrderValue')[0];
    const metricRow = metricLabel.closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(metricRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLTableRowElement;
    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    expect(within(thead).getByText('COLLECT COD')).toBeInTheDocument();
    expect(within(thead).getByText('DELIVER IN PERSON')).toBeInTheDocument();
    expect(within(tbody).queryByText('COLLECT COD')).not.toBeInTheDocument();
    expect(
      within(tbody).queryByText('DELIVER IN PERSON'),
    ).not.toBeInTheDocument();
    expect(within(tbody).getByText('AIR')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(tbody).getByText('FOB')).toBeInTheDocument();
    });
  });

  it('expands Values and orderStatus when another level follows', async () => {
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

    const buildCollapsedBranch = (
      rowDepth: number,
      collapsedGroupby: string[],
    ) =>
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

    fetchPivotBranchMock.mockImplementation(
      (params: FetchPivotBranchParams) => {
        const { path } = params;
        if (path.length === 2) {
          return Promise.resolve(
            buildMockBranchFetchResult(params, { data: orderStatusBranch }),
          );
        }
        if (path.length === 3) {
          return Promise.resolve(
            buildMockBranchFetchResult(params, { data: orderClassBranch }),
          );
        }
        return Promise.resolve(buildMockBranchFetchResult(params));
      },
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
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
          colTotals: false,
          rowTotals: false,
          rowSubTotals: false,
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
    await waitForPivotReady();

    const tbody = container.querySelector('tbody') as HTMLElement;
    const metricLabel = within(tbody).getAllByText('averageOrderValue')[0];
    const metricRow = metricLabel.closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(metricRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const statusRow = (await waitFor(() =>
      within(tbody).getByText(/^F$/).closest('tr'),
    )) as HTMLElement;
    fireEvent.click(within(statusRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    expect(within(tbody).getByText('A')).toBeInTheDocument();
  });
});
