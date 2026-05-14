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

import { JsonResponse, SupersetClient } from '@superset-ui/core';
import { render, fireEvent, waitFor, within } from '../../../testUtils';
import PivotTableChart from '../../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../../src/types';
import { baseFormData, buildFormData } from '../../fixtures/pivotFormData';
import {
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../../src/pivot/core/tokens';
import {
  parseCellKey,
  parsePath,
  serializeCellKey,
  serializePath,
} from '../../../../src/pivot/core/path';
import { mergeTrees } from '../../../../src/pivot/core/tree';
import {
  fetchPivotBranch,
  peekPivotBranchCache,
} from '../../../../src/fetchPivotBranch';
import {
  fetchPivotBranchesBatch,
  type FetchPivotBranchesBatchParams,
  type FetchPivotBranchesBatchResult,
} from '../../../../src/pivot/query/fetchPivotBranchesBatch';
import { formatQueryName } from '../../../../src/pivot/query/queryName';
import { buildTreeFromRecords } from '../../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../../fixtures/metricAxis';

jest.mock('../../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

jest.mock('../../../../src/pivot/query/fetchPivotBranchesBatch', () => ({
  fetchPivotBranchesBatch: jest.fn(),
}));

describe('PivotTableChart expansion with metrics before dimensions (ancestor-subtotals)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const peekPivotBranchCacheMock = peekPivotBranchCache as jest.Mock;
  const fetchPivotBranchesBatchMock =
    fetchPivotBranchesBatch as jest.MockedFunction<
      typeof fetchPivotBranchesBatch
    >;

  const resolveBatchWithSingles = async ({
    batch,
    formData,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  }: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
    const results = await Promise.all(
      batch.targets.map(target => {
        const path = parsePath(target.pathKey);
        return Promise.resolve(
          fetchPivotBranchMock({
            formData,
            axis: batch.axis,
            path,
            currentTree,
            visibleRowDepth,
            visibleColDepth,
          }),
        );
      }),
    );
    const merged = results.reduce<PivotTreeData | undefined>(
      (acc, result) => mergeTrees(acc, result.data),
      undefined,
    );
    return { data: merged };
  };
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
    fetchPivotBranchesBatchMock.mockReset();
    fetchPivotBranchesBatchMock.mockImplementation(resolveBatchWithSingles);
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
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
          groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['countCustomers'],
        })}
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority', 'orderStatus']}
        groupbyColumns={['segment', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={400}
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

    // Expand the first row (USA -> orderPriority)
    const rowToggle = within(
      container.querySelector('tbody') as HTMLElement,
    ).getAllByLabelText('plus-square')[0];
    fireEvent.click(rowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // Expand the first column header (AUTO -> shipMode)
    const colToggle = getAllByLabelText('plus-square')[0];
    fireEvent.click(colToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Parent row (nation) should still render values for the expanded column leaf.
    const usaRow = await findByText('USA');
    const usaRowEl = usaRow.closest('tr') as HTMLTableRowElement;
    expect(within(usaRowEl).getByText('10')).toBeInTheDocument();
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
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
          groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['countCustomers'],
        })}
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority', 'orderStatus']}
        groupbyColumns={['segment', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={400}
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
    const getTbody = () => container.querySelector('tbody') as HTMLElement;
    const [firstColToggle] =
      within(getThead()).getAllByLabelText('plus-square');
    fireEvent.click(firstColToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    const [firstRowToggle] =
      within(getTbody()).getAllByLabelText('plus-square');
    fireEvent.click(firstRowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const highCell = await findByText('HIGH');
    const highRow = highCell.closest('tr') as HTMLTableRowElement;
    expect(within(highRow).getAllByText('5')).toHaveLength(2);
    expect(within(highRow).getByText('7')).toBeInTheDocument();
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
        {
          nation: 'USA',
          orderPriority: '1-URGENT',
          segment: 'AUTO',
          countCustomers: 40,
        },
        {
          nation: 'USA',
          orderPriority: '1-URGENT',
          segment: 'BUILDING',
          countCustomers: 50,
        },
        {
          nation: 'CAN',
          orderPriority: '1-URGENT',
          segment: 'AUTO',
          countCustomers: 30,
        },
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
        {
          nation: 'USA',
          segment: 'BUILDING',
          shipMode: 'AIR',
          countCustomers: 50,
        },
        {
          nation: 'CAN',
          segment: 'BUILDING',
          shipMode: 'AIR',
          countCustomers: 35,
        },
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

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
          groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['countCustomers'],
        })}
        metrics={['countCustomers']}
        groupbyRows={['nation', 'orderPriority', 'orderStatus']}
        groupbyColumns={['segment', 'shipMode']}
        aggregateFunction="Sum"
        width={800}
        height={500}
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
    const getTbody = () => container.querySelector('tbody') as HTMLElement;

    // 1) Expand first column (AUTO)
    fireEvent.click(within(getThead()).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // 2) Expand first row (USA)
    const firstRowToggle =
      within(getTbody()).getAllByLabelText('plus-square')[0];
    fireEvent.click(firstRowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // 3) Expand first child row (1-URGENT)
    const secondRowToggle =
      within(getTbody()).getAllByLabelText('plus-square')[0];
    fireEvent.click(secondRowToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    // 4) Expand second column header (BUILDING)
    const buildingHeaderCell = within(getThead())
      .getByText('BUILDING')
      .closest('th') as HTMLElement;
    const buildingToggle =
      within(buildingHeaderCell).getByLabelText('plus-square');
    fireEvent.click(buildingToggle);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    const orderPriorityRow = await findByText('1-URGENT');
    const orderPriorityEl = orderPriorityRow.closest(
      'tr',
    ) as HTMLTableRowElement;
    // Order-priority row should now have values under the newly expanded BUILDING column.
    await waitFor(() => {
      const valueCell = Array.from(orderPriorityEl.querySelectorAll('td')).find(
        cell => cell.textContent && cell.textContent.trim() !== '',
      );
      expect(valueCell).toBeTruthy();
    });
    // Sibling top-level row should also have building values populated.
    const canRow = await findByText('CAN');
    const canRowEl = canRow.closest('tr') as HTMLTableRowElement;
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
    const subtotalKey = serializePath(['10k-50k', SUBTOTAL_TOKEN]);
    colBranch.cols[subtotalKey] = {
      axis: 'col',
      key: subtotalKey,
      path: ['10k-50k', SUBTOTAL_TOKEN],
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: false,
      isSubtotal: true,
    };
    [serializePath(['F']), serializePath(['O'])].forEach(rowKey => {
      colBranch.cells[serializeCellKey(rowKey, subtotalKey)] = {
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
    rowBranch.cols[subtotalKey] =
      rowBranch.cols[subtotalKey] || colBranch.cols[subtotalKey];
    rowBranch.cells[serializeCellKey(serializePath(['F', 'A']), subtotalKey)] =
      {
        rowKey: serializePath(['F', 'A']),
        colKey: subtotalKey,
        values: { quantitySold: 30 },
        isSubtotal: true,
      };
    const subtotalRowKey = serializePath(['F', SUBTOTAL_TOKEN]);
    rowBranch.rows[subtotalRowKey] = {
      axis: 'row',
      key: subtotalRowKey,
      path: ['F', SUBTOTAL_TOKEN],
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: false,
      isSubtotal: true,
    };
    rowBranch.cells[
      serializeCellKey(subtotalRowKey, serializePath(['10k-50k']))
    ] = {
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
        formData={buildFormData({
          ...baseFormData,
          groupbyRows,
          groupbyColumns: [...groupbyColumns, METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          colSubtotalLevels: [1],
          colTotals: true,
          rowSubTotals: false,
          rowSubtotalLevels: [],
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        aggregateFunction="Sum"
        width={500}
        height={400}
        startCollapsed
        initialDepth={1}
        colTotals
        rowTotals
        rowSubTotals={false}
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

    const getThead = () => container.querySelector('thead') as HTMLElement;
    const getTbody = () => container.querySelector('tbody') as HTMLElement;
    fireEvent.click(within(getThead()).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(within(getTbody()).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
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
    const subtotalKey = serializePath(['10k-50k', SUBTOTAL_TOKEN]);
    colBranch.cols[subtotalKey] = {
      axis: 'col',
      key: subtotalKey,
      path: ['10k-50k', SUBTOTAL_TOKEN],
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: false,
      isSubtotal: true,
    };
    colBranch.cells[serializeCellKey(serializePath(['F']), subtotalKey)] = {
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
    rowBranch.cols[subtotalKey] =
      rowBranch.cols[subtotalKey] || colBranch.cols[subtotalKey];
    rowBranch.cells[serializeCellKey(serializePath(['F', 'A']), subtotalKey)] =
      {
        rowKey: serializePath(['F', 'A']),
        colKey: subtotalKey,
        values: { quantitySold: 30 },
        isSubtotal: true,
      };

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: colBranch })
      .mockResolvedValueOnce({ data: rowBranch });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows,
          groupbyColumns: [...groupbyColumns, METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          colSubtotalLevels: [1],
          colTotals: true,
          rowSubTotals: false,
          rowSubtotalLevels: [],
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        aggregateFunction="Sum"
        width={500}
        height={400}
        startCollapsed
        initialDepth={1}
        colTotals
        rowTotals
        rowSubTotals={false}
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

    const getThead = () => container.querySelector('thead') as HTMLElement;
    const getTbody = () => container.querySelector('tbody') as HTMLElement;
    fireEvent.click(within(getThead()).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(within(getTbody()).getAllByLabelText('plus-square')[0]);
    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const headers = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim());
    expect(headers).toContain('Subtotal');

    const childRow = await within(getTbody()).findByText('A');
    const childRowEl = childRow.closest('tr') as HTMLTableRowElement;
    expect(within(childRowEl).getByText('30')).toBeInTheDocument();
  });

  it('fills ancestor column values for all visible rows when expanding another column after deep row expansion', async () => {
    const actualFetchModule = jest.requireActual(
      '../../../../src/fetchPivotBranch',
    );
    fetchPivotBranchMock.mockImplementation(args =>
      actualFetchModule.fetchPivotBranch(args),
    );
    peekPivotBranchCacheMock.mockImplementation(
      actualFetchModule.peekPivotBranchCache,
    );
    const postSpy = jest.spyOn(SupersetClient, 'post');
    postSpy.mockImplementation(({ jsonPayload }) => {
      const payload =
        typeof jsonPayload === 'string' || jsonPayload == null
          ? {}
          : jsonPayload;
      const queries =
        (payload as { queries?: Array<{ query_name?: string }> }).queries ?? [];
      const result = queries.map((query: { query_name?: string }) => {
        const name = query.query_name as string;
        if (name.includes(`branch:col:${serializePath(['AUTO'])}`)) {
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
        if (name.includes(`branch:row:${serializePath(['USA', '1-URGENT'])}`)) {
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
        if (name.includes(`branch:row:${serializePath(['USA'])}`)) {
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
        if (name.includes(`branch:col:${serializePath(['CONSUMER'])}`)) {
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
      return Promise.resolve({
        json: { result },
        response: new Response(),
      } as unknown as JsonResponse);
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
          formData={buildFormData({
            ...baseFormData,
            groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
            groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['countCustomers'],
          })}
          metrics={['countCustomers']}
          groupbyRows={['nation', 'orderPriority', 'orderStatus']}
          groupbyColumns={['segment', 'shipMode']}
          aggregateFunction="Sum"
          width={800}
          height={500}
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
      const autoHeader = within(getThead())
        .getByText('AUTO')
        .closest('th') as HTMLElement;
      fireEvent.click(within(autoHeader).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(
          1,
        );
      });

      const usaRow = await findByText('USA');
      const usaRowEl = usaRow.closest('tr') as HTMLTableRowElement;
      fireEvent.click(within(usaRowEl).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(
          2,
        );
      });

      const urgentRow = await findByText('1-URGENT');
      const urgentRowEl = urgentRow.closest('tr') as HTMLTableRowElement;
      fireEvent.click(within(urgentRowEl).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(
          3,
        );
      });

      const consumerHeader = within(getThead())
        .getByText('CONSUMER')
        .closest('th') as HTMLElement;
      fireEvent.click(within(consumerHeader).getByLabelText('plus-square'));
      await waitFor(() => {
        expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(
          4,
        );
      });

      const canRow = await findByText('CAN');
      const canRowEl = canRow.closest('tr') as HTMLTableRowElement;
      await waitFor(() => {
        expect(within(canRowEl).getAllByText('35').length).toBeGreaterThan(0);
      });
      const orderStatusRow = await findByText('F');
      const orderStatusRowEl = orderStatusRow.closest(
        'tr',
      ) as HTMLTableRowElement;
      expect(
        within(orderStatusRowEl).getAllByText('15').length,
      ).toBeGreaterThan(0);
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
    const subtotalKey = serializePath(['F', SUBTOTAL_TOKEN]);
    const { colKey: firstColKey } = parseCellKey(Object.keys(tree.cells)[0]);
    tree.rows[subtotalKey] = {
      axis: 'row',
      key: subtotalKey,
      path: ['F', SUBTOTAL_TOKEN],
      label: SUBTOTAL_TOKEN,
      formattedLabel: 'Subtotal',
      level: 2,
      hasChildren: true,
      isSubtotal: true,
    };
    tree.cells[serializeCellKey(subtotalKey, firstColKey)] = {
      rowKey: subtotalKey,
      colKey: firstColKey,
      values: { quantitySold: 99 },
      isSubtotal: true,
    };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows,
          groupbyColumns: [...groupbyColumns, METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colTotals: true,
          rowSubTotals: false,
          rowSubtotalLevels: [],
          rowTotals: true,
          colSubtotalLevels: [1],
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals
        rowTotals
        rowSubTotals={false}
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
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Subtotal');
  });
});
