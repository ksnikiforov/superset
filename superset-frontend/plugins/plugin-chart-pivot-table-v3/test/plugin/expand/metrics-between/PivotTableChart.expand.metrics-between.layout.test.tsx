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
import { METRICS_PLACEHOLDER } from '../../../../src/pivot/core/tokens';
import { mergeTrees } from '../../../../src/pivot/core/tree';
import {
  fetchPivotExpansion as fetchPivotBranch,
  type FetchPivotExpansionRequest as FetchPivotBranchParams,
} from '../../../../src/pivot/expansion/fetchPivotExpansion';
import { buildFormData } from '../../fixtures/pivotFormData';
import { buildMockBranchFetchResult } from '../../fixtures/factBatches';
import { buildTreeFromRecords } from '../../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../../fixtures/metricAxis';

jest.mock('../../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

describe('PivotTableChart expansion with metrics between dimensions (layout)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const resolveBranchData =
    (data?: PivotTreeData) => (params: FetchPivotBranchParams) =>
      Promise.resolve(buildMockBranchFetchResult(params, { data }));

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockImplementation(resolveBranchData());
  });

  const waitForPivotReady = async () => {
    await waitFor(() => {
      expect(
        document.querySelector('[role="status"][aria-label="Loading"]'),
      ).not.toBeInTheDocument();
    });
  };

  const metrics = ['averageOrderValue', 'weightedDiscount'];
  const colGroupby = ['customerSegment'];
  const buildRowGroupby = (depth: number) =>
    Array.from({ length: depth }, (_, index) => `dim${index + 1}`);
  const buildLevelValues = (depth: number) =>
    Array.from({ length: depth }, (_, index) => `L${index + 1}`);
  const buildRecord = (
    rowGroupby: string[],
    levelValues: string[],
    metricSeed: number,
  ) => {
    const record: Record<string, string | number> = {
      customerSegment: 'AUTO',
      averageOrderValue: 5000 + metricSeed,
      weightedDiscount: 0.04 + metricSeed / 1000,
    };
    rowGroupby.forEach((groupby, index) => {
      record[groupby] = levelValues[index];
    });
    return record;
  };

  test.each([2, 3, 4])(
    'shows metric toggle when metrics sit between the first row dimension and the rest (depth %i)',
    async depth => {
      const rowGroupby = buildRowGroupby(depth);
      const levelValues = buildLevelValues(depth);
      const records = [
        buildRecord(rowGroupby, levelValues, 1),
        buildRecord(
          rowGroupby,
          [`${levelValues[0]}-alt`, ...levelValues.slice(1)],
          2,
        ),
      ];
      const treeRaw = buildTreeFromRecords(
        records,
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
          formData={buildFormData({
            groupbyRows: [
              rowGroupby[0],
              METRICS_PLACEHOLDER,
              ...rowGroupby.slice(1),
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

      await waitForPivotReady();
      const firstRow = getByText(levelValues[0]).closest(
        'tr',
      ) as HTMLTableRowElement;
      expect(
        within(firstRow).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      const [metricRowLabel] = getAllByText(metrics[0]);
      const metricRow = metricRowLabel.closest('tr') as HTMLTableRowElement;
      expect(
        within(metricRow).getByLabelText('plus-square'),
      ).toBeInTheDocument();
    },
  );

  test.each([3, 4, 5])(
    'hides the parent dimension toggle when metrics sit after the second row dimension (depth %i)',
    async depth => {
      const rowGroupby = buildRowGroupby(depth);
      const levelValues = buildLevelValues(depth);
      const treeRaw = buildTreeFromRecords(
        [buildRecord(rowGroupby, levelValues, 1)],
        metrics,
        rowGroupby,
        colGroupby,
        rowGroupby.length,
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
          formData={buildFormData({
            groupbyRows: [
              rowGroupby[0],
              rowGroupby[1],
              METRICS_PLACEHOLDER,
              ...rowGroupby.slice(2),
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

      await waitForPivotReady();
      const topRow = getByText(levelValues[0]).closest(
        'tr',
      ) as HTMLTableRowElement;
      const topToggle = within(topRow).getByLabelText('plus-square');
      fireEvent.click(topToggle);

      await waitFor(() => {
        const tbody = topRow.closest('tbody') as HTMLElement;
        const parentLabel = within(tbody).getByText(levelValues[1]);
        const parentRow = parentLabel.closest('tr') as HTMLTableRowElement;
        expect(
          within(parentRow).queryByLabelText('plus-square'),
        ).not.toBeInTheDocument();
        const metricRow = within(tbody)
          .getByText(metrics[0])
          .closest('tr') as HTMLTableRowElement;
        expect(
          within(metricRow).getByLabelText('plus-square'),
        ).toBeInTheDocument();
      });
    },
  );

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
        formData={buildFormData({
          groupbyRows: ['group', METRICS_PLACEHOLDER, 'product'],
          groupbyColumns: [],
          metrics: ['m1', 'm2'],
          aggregateFunction: 'Sum',
          colTotals: false,
          rowTotals: false,
          rowSubTotals: false,
          startCollapsed: false,
          initialDepth: 2,
          rowOrder: 'key_a_to_z',
          colOrder: 'key_a_to_z',
          metricsLayout: MetricsLayoutEnum.ROWS,
          viz_type: 'pivot_table_v3',
          datasource: '1__table',
          metricColorFormatters: [],
          dateFormatters: {},
          verboseMap: {},
        })}
        metrics={['m1', 'm2']}
        groupbyRows={['group', 'product']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed={false}
        initialDepth={2}
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
    expect(queryAllByText('Bike1')).toHaveLength(2);

    const metricRows = queryAllByText('m2');
    const metricRow = metricRows[0]?.closest('tr') as HTMLTableRowElement;
    const minusToggle = within(metricRow).getByLabelText('minus-square');
    fireEvent.click(minusToggle);

    await waitFor(() => {
      expect(queryAllByText('Bike1')).toHaveLength(1);
    });

    const metricRowAfter = queryAllByText('m2')[0]?.closest(
      'tr',
    ) as HTMLElement;
    const plusToggle = within(metricRowAfter).getByLabelText('plus-square');
    fireEvent.click(plusToggle);

    await waitFor(() => {
      expect(queryAllByText('Bike1')).toHaveLength(2);
    });
  });

  it('expands ship mode before metrics when metrics sit after return flag', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = [
      'shipMode',
      'returnFlag',
      'quantityBand',
      'revenueBand',
    ];
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
      .mockImplementationOnce(resolveBranchData(returnFlagBranch))
      .mockImplementationOnce(resolveBranchData(quantityBranch))
      .mockImplementationOnce(resolveBranchData(revenueBranch));

    const { container, getByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
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
    const airRow = getByText('AIR').closest('tr') as HTMLTableRowElement;
    expect(within(airRow).getByLabelText('plus-square')).toBeInTheDocument();
    const metricLabels = within(tbody).getAllByText('averageOrderValue');
    expect(metricLabels.length).toBeGreaterThan(0);

    fireEvent.click(within(airRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const returnRow = getByText(/^N$/).closest('tr') as HTMLTableRowElement;
    expect(
      within(returnRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();

    const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const returnIndex = rows.indexOf(returnRow);
    const metricRow = rows
      .slice(returnIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    if (!metricRow) {
      throw new Error('Expected metric row to be present');
    }
    expect(within(metricRow).getByLabelText('plus-square')).toBeInTheDocument();

    fireEvent.click(within(metricRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const quantityRow = getByText('1-5').closest('tr') as HTMLTableRowElement;
    expect(
      within(quantityRow).getByLabelText('plus-square'),
    ).toBeInTheDocument();

    fireEvent.click(within(quantityRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    const revenueRow = getByText('10k-50k').closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(
      within(revenueRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
  });

  it('keeps metric values when expanding another ship mode after deep expansion', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = [
      'shipMode',
      'returnFlag',
      'quantityBand',
      'revenueBand',
    ];
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
      .mockImplementationOnce(resolveBranchData(airReturnFlagBranch))
      .mockImplementationOnce(resolveBranchData(airQuantityBranch))
      .mockImplementationOnce(resolveBranchData(airRevenueBranch))
      .mockImplementationOnce(resolveBranchData(seaReturnFlagBranch));

    const { container, getByText, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
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
    const airRow = getByText('AIR').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(airRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const airReturnRow = getByText(/^N$/).closest('tr') as HTMLTableRowElement;
    const airRows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const airReturnIndex = airRows.indexOf(airReturnRow);
    const airMetricRow = airRows
      .slice(airReturnIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(airMetricRow).toBeTruthy();
    fireEvent.click(
      within(airMetricRow as HTMLElement).getByLabelText('plus-square'),
    );
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const quantityRow = getByText('1-5').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(quantityRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3);
    });

    const seaRow = getByText('SEA').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(seaRow).getByLabelText('plus-square'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(4);
    });

    const seaReturnRow = (await findByText(/^R$/)).closest(
      'tr',
    ) as HTMLTableRowElement;
    const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'));
    const seaReturnIndex = rows.indexOf(seaReturnRow);
    const seaMetricRow = rows
      .slice(seaReturnIndex + 1)
      .find(row => within(row).queryByText('averageOrderValue')) as
      | HTMLElement
      | undefined;
    expect(seaMetricRow).toBeTruthy();
    expect(
      within(seaMetricRow as HTMLElement).getByText('200'),
    ).toBeInTheDocument();
  });

  it('shows dimension rows before metrics when totals data includes metric-only rows', async () => {
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

    const { getByText, queryAllByText } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
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
    const urgentRow = getByText('1-URGENT').closest(
      'tr',
    ) as HTMLTableRowElement;
    expect(within(urgentRow).getByLabelText('plus-square')).toBeInTheDocument();

    const metricRows = queryAllByText('averageOrderValue');
    metricRows.forEach(metricLabel => {
      const metricRow = metricLabel.closest('tr') as HTMLTableRowElement;
      const labelCell = metricRow.querySelector('div') as HTMLElement;
      expect(labelCell).not.toHaveStyle({ paddingLeft: '16px' });
    });
  });
});
