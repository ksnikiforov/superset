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

describe('PivotTableChart expansion with metrics between dimensions (expansion)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const metrics = ['averageOrderValue', 'weightedDiscount'];
  const baseRowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
  const orderColGroupby = ['shipInstruction', 'customerSegment', 'returnFlag'];
  const lineStatusColGroupby = ['lineStatus'];

  test.each([1, 2, 3])(
    'expands Values to load the next dimension when metrics sit between shipMode and deeper levels (tail depth %i)',
    async tailDepth => {
      const tailLevels = Array.from(
        { length: tailDepth },
        (_, index) => `level${index + 1}`,
      );
      const tailValues = tailLevels.map(
        (_, index) => `L${index + 1}`,
      );
      const record: Record<string, string | number> = {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        shipInstruction: 'COLLECT COD',
        customerSegment: 'AUTO',
        returnFlag: 'N',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      };
      tailLevels.forEach((level, index) => {
        record[level] = tailValues[index];
      });
      const rowGroupby = ['orderPriority', 'shipMode', ...tailLevels];
      const records = [record];
      const buildTreeAtDepth = (rowDepth: number) =>
        applyMetricAxis(
          buildTreeFromRecords(
            records,
            metrics,
            rowGroupby,
            orderColGroupby,
            rowDepth,
            1,
          ),
          metrics,
          MetricsLayoutEnum.ROWS,
          rowGroupby,
          orderColGroupby,
          2,
        );
      const buildCollapsedBranch = (rowDepth: number) => {
        const collapsedGroupby = ['orderPriority', tailLevels[0]];
        return applyMetricAxis(
          buildTreeFromRecords(
            records,
            metrics,
            collapsedGroupby,
            orderColGroupby,
            rowDepth,
            1,
          ),
          metrics,
          MetricsLayoutEnum.ROWS,
          collapsedGroupby,
          orderColGroupby,
          1,
        );
      };

      const baseTree = buildTreeAtDepth(1);
      const orderStatusBranch = buildCollapsedBranch(2);

      fetchPivotBranchMock.mockResolvedValueOnce({ data: orderStatusBranch });

      const { container } = render(
        <PivotTableChart
          data={baseTree}
          formData={buildFormData(
            {
              groupbyRows: [
                'orderPriority',
                'shipMode',
                METRICS_PLACEHOLDER,
                ...tailLevels,
              ],
              groupbyColumns: orderColGroupby,
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
          groupbyColumns={orderColGroupby}
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

      expect(within(tbody).getByText(tailValues[0])).toBeTruthy();
    },
  );

  it('recalculates lower levels after expanding orderPriority above Values', async () => {
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
          baseRowGroupby,
          orderColGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        baseRowGroupby,
        orderColGroupby,
        2,
      );

    const buildCollapsedBranch = (rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'orderStatus'];
      return applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          collapsedGroupby,
          orderColGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        collapsedGroupby,
        orderColGroupby,
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
        formData={buildFormData(
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
            ],
            groupbyColumns: orderColGroupby,
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
        groupbyRows={baseRowGroupby}
        groupbyColumns={orderColGroupby}
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
          baseRowGroupby,
          orderColGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        baseRowGroupby,
        orderColGroupby,
        2,
      );

    const buildCollapsedBranch = (rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'orderStatus'];
      return applyMetricAxis(
        buildTreeFromRecords(
          records,
          metrics,
          collapsedGroupby,
          orderColGroupby,
          rowDepth,
          1,
        ),
        metrics,
        MetricsLayoutEnum.ROWS,
        collapsedGroupby,
        orderColGroupby,
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
        formData={buildFormData(
          {
            groupbyRows: [
              'orderPriority',
              'shipMode',
              METRICS_PLACEHOLDER,
              'orderStatus',
            ],
            groupbyColumns: orderColGroupby,
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
        groupbyRows={baseRowGroupby}
        groupbyColumns={orderColGroupby}
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

  it('keeps returnFlag rows nested under metrics after expanding orderPriority', async () => {
    const rowGroupby = [
      'orderPriority',
      'shipMode',
      'returnFlag',
      'shipInstruction',
    ];
    const colGroupby = lineStatusColGroupby;
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'N',
        shipInstruction: 'COLLECT COD',
        lineStatus: 'F',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'R',
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
        2,
      );
    const buildCollapsedBranch = (data: typeof records, rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'returnFlag', 'shipInstruction'];
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
    const shipModeBranch = buildTreeAtDepth(records, 3);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: metricBranch })
      .mockResolvedValueOnce({ data: shipModeBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData(
          {
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
    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLElement;
    const initialRows = Array.from(tbody.querySelectorAll('tr'));
    const metricRow = initialRows
      .slice(initialRows.indexOf(orderPriorityRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(metricRow).toBeTruthy();
    fireEvent.click(within(metricRow as HTMLElement).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const shipModeRow = within(tbody).getByText('AIR').closest(
      'tr',
    ) as HTMLElement;
    const shipModeIndex = rows.indexOf(shipModeRow);
    const shipModeMetricRow = rows
      .slice(shipModeIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(shipModeMetricRow).toBeTruthy();
    const returnFlagRow = rows
      .slice(rows.indexOf(shipModeMetricRow as HTMLElement) + 1)
      .find(row => within(row).queryByText(/^N$/)) as
      | HTMLElement
      | undefined;
    expect(returnFlagRow).toBeTruthy();

    const shipModeIndent = Number.parseInt(
      (within(shipModeRow).getByText('AIR').closest('div') as HTMLElement)
        .style.paddingLeft || '0',
      10,
    );
    const returnFlagIndent = Number.parseInt(
      (within(returnFlagRow as HTMLElement).getByText(/^N$/).closest(
        'div',
      ) as HTMLElement).style.paddingLeft || '0',
      10,
    );
    expect(returnFlagIndent).toBeGreaterThan(shipModeIndent);
    ['N', 'R'].forEach(flag => {
      within(tbody)
        .getAllByText(new RegExp(`^${flag}$`))
        .forEach(label => {
          const indent = Number.parseInt(
            (label.closest('div') as HTMLElement).style.paddingLeft || '0',
            10,
          );
          expect(indent).toBeGreaterThan(shipModeIndent);
        });
    });
  });

  it('keeps returnFlag rows nested after collapsing and expanding another orderPriority', async () => {
    const rowGroupby = [
      'orderPriority',
      'shipMode',
      'returnFlag',
      'shipInstruction',
    ];
    const colGroupby = lineStatusColGroupby;
    const records = [
      {
        orderPriority: '1-URGENT',
        shipMode: 'AIR',
        returnFlag: 'N',
        shipInstruction: 'COLLECT COD',
        lineStatus: 'F',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
      {
        orderPriority: '2-HIGH',
        shipMode: 'FOB',
        returnFlag: 'R',
        shipInstruction: 'DELIVER IN PERSON',
        lineStatus: 'O',
        averageOrderValue: 90,
        weightedDiscount: 0.04,
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
      const collapsedGroupby = ['orderPriority', 'returnFlag', 'shipInstruction'];
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
    const urgentRecords = records.filter(
      record => record.orderPriority === '1-URGENT',
    );
    const highRecords = records.filter(
      record => record.orderPriority === '2-HIGH',
    );
    const urgentMetricBranch = buildCollapsedBranch(urgentRecords, 2);
    const urgentShipModeBranch = buildTreeAtDepth(urgentRecords, 3);
    const highMetricBranch = buildCollapsedBranch(highRecords, 2);
    const highShipModeBranch = buildTreeAtDepth(highRecords, 3);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: urgentMetricBranch })
      .mockResolvedValueOnce({ data: urgentShipModeBranch })
      .mockResolvedValueOnce({ data: highMetricBranch })
      .mockResolvedValueOnce({ data: highShipModeBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData(
          {
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
    const urgentRow = getByText('1-URGENT').closest('tr') as HTMLElement;
    const firstRows = Array.from(tbody.querySelectorAll('tr'));
    const urgentMetricRow = firstRows
      .slice(firstRows.indexOf(urgentRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(urgentMetricRow).toBeTruthy();
    fireEvent.click(
      within(urgentMetricRow as HTMLElement).getByLabelText('plus-square'),
    );

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(within(urgentRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(within(urgentRow).getByLabelText('minus-square'));

    const highRow = getByText('2-HIGH').closest('tr') as HTMLElement;
    const secondRows = Array.from(tbody.querySelectorAll('tr'));
    const highMetricRow = secondRows
      .slice(secondRows.indexOf(highRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(highMetricRow).toBeTruthy();
    fireEvent.click(
      within(highMetricRow as HTMLElement).getByLabelText('plus-square'),
    );

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    fireEvent.click(within(highRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(4);
    });

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const shipModeRow = within(tbody).getByText('FOB').closest(
      'tr',
    ) as HTMLElement;
    const shipModeIndex = rows.indexOf(shipModeRow);
    const shipModeMetricRow = rows
      .slice(shipModeIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(shipModeMetricRow).toBeTruthy();
    const returnFlagRow = rows
      .slice(rows.indexOf(shipModeMetricRow as HTMLElement) + 1)
      .find(row => within(row).queryByText(/^R$/)) as
      | HTMLElement
      | undefined;
    expect(returnFlagRow).toBeTruthy();

    const shipModeIndent = Number.parseInt(
      (within(shipModeRow).getByText('FOB').closest('div') as HTMLElement)
        .style.paddingLeft || '0',
      10,
    );
    const returnFlagIndent = Number.parseInt(
      (within(returnFlagRow as HTMLElement).getByText(/^R$/).closest(
        'div',
      ) as HTMLElement).style.paddingLeft || '0',
      10,
    );
    expect(returnFlagIndent).toBeGreaterThan(shipModeIndent);
    within(tbody)
      .getAllByText(/^R$/)
      .forEach(label => {
        const indent = Number.parseInt(
          (label.closest('div') as HTMLElement).style.paddingLeft || '0',
          10,
        );
        expect(indent).toBeGreaterThan(shipModeIndent);
      });
  });

  it('preserves returnFlag expansion when expanding orderPriority after a metric expand', async () => {
    const rowGroupby = [
      'orderPriority',
      'shipMode',
      'returnFlag',
      'shipInstruction',
    ];
    const colGroupby = lineStatusColGroupby;
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
        2,
      );
    const buildCollapsedBranch = (data: typeof records, rowDepth: number) => {
      const collapsedGroupby = ['orderPriority', 'returnFlag', 'shipInstruction'];
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
      .mockResolvedValueOnce({ data: metricBranch })
      .mockResolvedValueOnce({ data: returnFlagBranch })
      .mockResolvedValueOnce({ data: shipModeBranch })
      .mockResolvedValueOnce({ data: shipModeReturnFlagBranch })
      .mockResolvedValueOnce({ data: shipInstructionBranch });

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData(
          {
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
    const orderPriorityRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLElement;
    const initialRows = Array.from(tbody.querySelectorAll('tr'));
    const metricRow = initialRows
      .slice(initialRows.indexOf(orderPriorityRow) + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(metricRow).toBeTruthy();
    fireEvent.click(within(metricRow as HTMLElement).getByLabelText('plus-square'));

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

    expect(within(tbody).getByText('COLLECT COD')).toBeTruthy();

    fireEvent.click(within(orderPriorityRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(5);
    });

    const shipModeRow = (await waitFor(() =>
      within(tbody).getByText('AIR').closest('tr'),
    )) as HTMLElement;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const shipModeIndex = rows.indexOf(shipModeRow);
    const shipModeMetricRow = rows
      .slice(shipModeIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(shipModeMetricRow).toBeTruthy();
    const returnFlagRowAfter = (await waitFor(() =>
      within(tbody).getByText(/^A$/).closest('tr'),
    )) as HTMLElement;
    expect(
      within(returnFlagRowAfter).getByLabelText('minus-square'),
    ).toBeTruthy();
    const instructionRow = (await waitFor(() =>
      within(tbody).getByText('COLLECT COD').closest('tr'),
    )) as HTMLElement;
    expect(instructionRow).toBeTruthy();
  });

});