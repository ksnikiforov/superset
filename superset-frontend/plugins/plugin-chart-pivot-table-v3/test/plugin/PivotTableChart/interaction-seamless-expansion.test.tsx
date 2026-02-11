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
import { fireEvent, render, screen, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { buildFormData } from '../fixtures/pivotFormData';
import { MetricsLayoutEnum, PivotRuntimeLayout } from '../../../src/types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  serializePath,
} from '../../../src/utils';
import { supersetChartDataClient } from '../../../src/pivot/data/SupersetChartDataClient';
import { fetchPivotBranch } from '../../../src/fetchPivotBranch';

jest.mock('../../../src/pivot/data/SupersetChartDataClient', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/data/SupersetChartDataClient',
  );
  return {
    ...actual,
    supersetChartDataClient: {
      fetch: jest.fn(),
      cancel: jest.fn(),
    },
  };
});

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart seamless expansion uses committed layout', () => {
  const fetchMock = supersetChartDataClient.fetch as jest.Mock;
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchPivotBranchMock.mockClear();
  });

  it('expands with updated groupby rows after instant layout changes', async () => {
    const metrics = ['grossRevenue'];
    const initialRows = ['shipMode', 'orderPriority'];
    const updatedRows = ['shipMode', 'revenueBand'];
    const initialRecords = [
      { shipMode: 'MAIL', orderPriority: '1-URGENT', grossRevenue: 10 },
    ];
    const updatedRecords = [
      { shipMode: 'MAIL', revenueBand: 'REV-A', grossRevenue: 10 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(initialRecords, metrics, initialRows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      initialRows,
      [],
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: initialRows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['shipMode', 'orderPriority', 'revenueBand'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 2,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: updatedRecords })),
    );

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={initialRows}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    const rowToggles = screen.getAllByLabelText('Toggle row dimension');
    fireEvent.click(rowToggles[1]);
    const rowTogglesAfter = screen.getAllByLabelText('Toggle row dimension');
    fireEvent.click(rowTogglesAfter[2]);

    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => {
      const plusButtons = screen.queryAllByLabelText('plus-square');
      const minusButtons = screen.queryAllByLabelText('minus-square');
      expect(plusButtons.length + minusButtons.length).toBeGreaterThan(0);
    });

    const collapseButton = screen.queryAllByLabelText('minus-square')[0];
    if (
      screen.queryAllByLabelText('plus-square').length === 0 &&
      collapseButton
    ) {
      fireEvent.click(collapseButton);
    }

    const expandButton = screen.getAllByLabelText('plus-square')[0];
    fireEvent.click(expandButton);

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const lastCall = fetchPivotBranchMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.formData.groupbyRows).toEqual(updatedRows);
  });

  it('prunes stale toggles when trimming row dimensions', async () => {
    const metrics = ['grossRevenue'];
    const initialRows = ['shipMode', 'orderPriority', 'lineStatus'];
    const initialRecords = [
      {
        shipMode: 'AIR',
        orderPriority: '1-URGENT',
        lineStatus: 'OPEN',
        grossRevenue: 10,
      },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(initialRecords, metrics, initialRows, [], 3, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      initialRows,
      [],
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: initialRows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: initialRows,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={initialRows}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('1-URGENT').length).toBeGreaterThan(0),
    );

    const rowToggles = screen.getAllByLabelText('Toggle row dimension');
    fireEvent.click(rowToggles[2]);

    const urgentRow = screen
      .getAllByText('1-URGENT')[0]
      .closest('tr') as HTMLElement;
    expect(
      within(urgentRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();

    const rowTogglesAfter = screen.getAllByLabelText('Toggle row dimension');
    fireEvent.click(rowTogglesAfter[1]);

    const airRow = screen.getByText('AIR').closest('tr') as HTMLElement;
    expect(
      within(airRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
  });

  it('shows column expand toggles after inserting before trailing values without a seamless reload', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const initialCols = ['discountBand'];
    const initialRecords = [
      {
        discountBand: '0-2%',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
    ];
    const updatedRecords = [
      {
        discountBand: '0-2%',
        orderStatus: 'OS-F',
        averageOrderValue: 100,
        weightedDiscount: 0.05,
      },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(initialRecords, metrics, [], initialCols, 0, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      initialCols,
      1,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: initialCols,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [...initialCols, 'orderStatus'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: updatedRecords })),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={initialCols}
        startCollapsed
        initialDepth={1}
        width={600}
        height={300}
      />,
    );

    const thead = container.querySelector('thead') as HTMLElement;
    await waitFor(() =>
      expect(within(thead).getByText('0-2%')).toBeInTheDocument(),
    );

    const discountCell = within(thead)
      .getByText('0-2%')
      .closest('th') as HTMLElement;
    const discountToggle = within(discountCell).queryByLabelText('plus-square');
    if (discountToggle) {
      fireEvent.click(discountToggle);
    }

    await waitFor(() =>
      expect(within(thead).getByText('averageOrderValue')).toBeInTheDocument(),
    );

    const colButtons = screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(colButtons[1]);

    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => {
      const refreshedThead = container.querySelector('thead') as HTMLElement;
      expect(
        within(refreshedThead).getByText('averageOrderValue'),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      const refreshedThead = container.querySelector('thead') as HTMLElement;
      const headerToggles =
        within(refreshedThead).queryAllByLabelText('plus-square');
      const headerMinus =
        within(refreshedThead).queryAllByLabelText('minus-square');
      expect(headerToggles.length + headerMinus.length).toBeGreaterThan(0);
      const discountCell = within(refreshedThead)
        .getByText('0-2%')
        .closest('th') as HTMLElement;
      const metricCell = within(refreshedThead)
        .getByText('averageOrderValue')
        .closest('th') as HTMLElement;
      const discountToggle =
        within(discountCell).queryByLabelText('plus-square') ??
        within(discountCell).queryByLabelText('minus-square');
      expect(discountToggle).not.toBeNull();
      expect(
        within(metricCell).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(metricCell).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();
    });
  });

  it('clears stale order priority rows after trimming and reordering rows', async () => {
    const metrics = ['grossRevenue'];
    const initialRows = [
      'shipMode',
      'lineStatus',
      'shipInstruction',
      'orderPriority',
    ];
    const records = [
      {
        shipMode: 'AIR',
        lineStatus: 'OPEN',
        shipInstruction: 'NONE',
        orderPriority: '1-URGENT',
        grossRevenue: 10,
      },
      {
        shipMode: 'AIR',
        lineStatus: 'OPEN',
        shipInstruction: 'NONE',
        orderPriority: '2-HIGH',
        grossRevenue: 12,
      },
      {
        shipMode: 'FOB',
        lineStatus: 'OPEN',
        shipInstruction: 'NONE',
        orderPriority: '1-URGENT',
        grossRevenue: 5,
      },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, initialRows, [], 4, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      initialRows,
      [],
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: initialRows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [
        'shipMode',
        'lineStatus',
        'shipInstruction',
        'orderPriority',
        'revenueBand',
      ],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 4,
    });

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={initialRows}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('1-URGENT').length).toBeGreaterThan(0),
    );

    const findDimensionRow = (label: string) => {
      const nodes = screen.getAllByText(label);
      for (const node of nodes) {
        let current: HTMLElement | null = node as HTMLElement;
        while (current) {
          if (within(current).queryByLabelText('Toggle row dimension')) {
            return current;
          }
          current = current.parentElement;
        }
      }
      throw new Error(`Missing dimension row for ${label}`);
    };

    const toggleRowDimension = (label: string) => {
      const row = findDimensionRow(label);
      fireEvent.click(within(row).getByLabelText('Toggle row dimension'));
    };

    toggleRowDimension('lineStatus');
    toggleRowDimension('shipInstruction');
    toggleRowDimension('orderPriority');

    await waitFor(() =>
      expect(screen.queryAllByText('1-URGENT')).toHaveLength(0),
    );

    toggleRowDimension('revenueBand');

    const getRowChips = () =>
      screen
        .getAllByLabelText('Remove dimension')
        .map(button => button.parentElement)
        .filter((node): node is HTMLElement => Boolean(node));

    const getRowChip = (label: string) => {
      const chips = getRowChips();
      const chip = chips.find(node => node.textContent?.includes(label));
      if (!chip) {
        throw new Error(`Missing row chip for ${label}`);
      }
      return chip;
    };

    const createDataTransfer = () => ({
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
      dropEffect: 'move',
      effectAllowed: 'all',
    });

    const revenueChip = getRowChip('revenueBand');
    const shipModeChip = getRowChip('shipMode');
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(revenueChip, { dataTransfer });
    fireEvent.dragEnter(shipModeChip, { dataTransfer });
    fireEvent.dragOver(shipModeChip, { dataTransfer });
    fireEvent.drop(shipModeChip, { dataTransfer });
    fireEvent.dragEnd(revenueChip, { dataTransfer });

    await waitFor(() => {
      const labels = getRowChips().map(node =>
        node.textContent?.replace('Remove dimension', '').trim(),
      );
      expect(labels).toEqual(['revenueBand', 'shipMode']);
    });

    const airNode = screen.queryByText('AIR');
    if (airNode) {
      const airRow = airNode.closest('tr') as HTMLElement;
      const airExpand = within(airRow).queryByLabelText('plus-square');
      if (airExpand) {
        fireEvent.click(airExpand);
      }
    } else {
      const firstExpander = screen.queryAllByLabelText('plus-square')[0];
      if (firstExpander) {
        fireEvent.click(firstExpander);
      }
    }

    await waitFor(() =>
      expect(screen.queryAllByText('1-URGENT')).toHaveLength(0),
    );
  });

  it('reorders row chips instantly without triggering seamless reload', async () => {
    const metrics = ['measure1', 'measure2'];
    const rowGroupby = ['row1', 'row2'];
    const colGroupby = ['col1'];
    const records = [
      { row1: 'A', row2: 'B', col1: 'C', measure1: 10, measure2: 20 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rowGroupby, colGroupby, 2, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      1,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: rowGroupby,
      cols: colGroupby,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [...rowGroupby, ...colGroupby],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        width={600}
        height={300}
      />,
    );

    const getRowChips = () =>
      screen
        .getAllByLabelText('Remove dimension')
        .map(button => button.parentElement)
        .filter((node): node is HTMLElement => Boolean(node));

    const getRowChip = (label: string) => {
      const chips = getRowChips();
      const chip = chips.find(node => node.textContent?.includes(label));
      if (!chip) {
        throw new Error(`Missing row chip for ${label}`);
      }
      return chip;
    };

    const createDataTransfer = () => ({
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
      dropEffect: 'move',
      effectAllowed: 'all',
    });

    const row2Chip = getRowChip('row2');
    const row1Chip = getRowChip('row1');
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(row2Chip, { dataTransfer });
    fireEvent.dragEnter(row1Chip, { dataTransfer });
    fireEvent.dragOver(row1Chip, { dataTransfer });
    fireEvent.drop(row1Chip, { dataTransfer });
    fireEvent.dragEnd(row2Chip, { dataTransfer });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument();
  });

  it('keeps expanded columns after adding a row dimension without seamless reload', async () => {
    const metrics = ['measure1'];
    const rowGroupby = ['row1'];
    const colGroupby = ['col1'];
    const initialRecords = [{ row1: 'R1-old', col1: 'C1', measure1: 10 }];
    const expandedRecords = [{ row1: 'R1-old', col1: 'C1', measure1: 10 }];
    const updatedRecords = [
      { row1: 'R1-new', row2: 'R2', col1: 'C1', measure1: 12 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(
        initialRecords,
        metrics,
        rowGroupby,
        colGroupby,
        1,
        0,
      ),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );
    const expandedTree = applyMetricAxis(
      buildTreeFromRecords(
        expandedRecords,
        metrics,
        rowGroupby,
        colGroupby,
        1,
        1,
      ),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      0,
    );
    const updatedExpandedTree = applyMetricAxis(
      buildTreeFromRecords(
        updatedRecords,
        metrics,
        ['row1', 'row2'],
        colGroupby,
        1,
        1,
      ),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['row1', 'row2'],
      colGroupby,
      0,
    );
    fetchPivotBranchMock.mockImplementation(
      async ({ formData }: { formData: { groupbyRows?: string[] } }) => ({
        data: formData.groupbyRows?.includes('row2')
          ? updatedExpandedTree
          : expandedTree,
      }),
    );

    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: rowGroupby,
      cols: colGroupby,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['row1', 'row2', 'col1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        width={600}
        height={300}
      />,
    );

    const getMetricHeader = () => {
      const thead = container.querySelector('thead') as HTMLElement;
      return within(thead).getByText('measure1').closest('th') as HTMLElement;
    };
    await waitFor(() => {
      const header = getMetricHeader();
      const toggle =
        within(header).queryByLabelText('plus-square') ||
        within(header).queryByLabelText('minus-square');
      expect(toggle).toBeInTheDocument();
    });

    const metricHeader = getMetricHeader();
    const expandButton = within(metricHeader).queryByLabelText('plus-square');
    if (expandButton) {
      fireEvent.click(expandButton);
    }

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByText('C1').length).toBeGreaterThan(0),
    );

    const findDimensionRow = (label: string) => {
      const nodes = screen.getAllByText(label);
      for (const node of nodes) {
        let current: HTMLElement | null = node as HTMLElement;
        while (current) {
          if (within(current).queryByLabelText('Toggle row dimension')) {
            return current;
          }
          current = current.parentElement;
        }
      }
      throw new Error(`Missing dimension row for ${label}`);
    };

    const row2Row = findDimensionRow('row2');
    fireEvent.click(within(row2Row).getByLabelText('Toggle row dimension'));

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('R1-old')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getAllByText('C1').length).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(
        within(getMetricHeader()).getByLabelText('minus-square'),
      ).toBeInTheDocument(),
    );
    await waitFor(() => {
      const match = fetchPivotBranchMock.mock.calls.find(call =>
        call[0]?.formData?.groupbyRows?.includes('row2'),
      );
      expect(match).toBeTruthy();
    });
  });

  it('keeps newly added metrics in the layout after a seamless fetch', async () => {
    const metrics = ['m1', 'm2'];
    const columns = ['c1', 'c2'];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: columns,
      metrics: ['m1'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: columns,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 2,
    });
    const queryFormData = buildFormData({
      ...formData,
      metrics: ['m1'],
    });

    const baseTree = applyMetricAxis(
      buildTreeFromRecords(
        [{ c1: 'A', c2: 'B', m1: 10 }],
        ['m1'],
        [],
        columns,
        0,
        2,
      ),
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      [],
      columns,
      1,
    );

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({
        data: [{ c1: 'A', c2: 'B', m1: 10, m2: 20 }],
      })),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={queryFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={columns}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getByText('Select measures'));
    fireEvent.click(screen.getByLabelText('Toggle measure m2'));
    fireEvent.click(screen.getByText('Select measures'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByText('m2').length).toBeGreaterThan(0),
    );

    const headerLabels = Array.from(container.querySelectorAll('thead th')).map(
      th => th.textContent ?? '',
    );
    expect(headerLabels).toEqual(expect.arrayContaining(['m2']));
  });

  it('reuses current expansion state during seamless metric updates to avoid rubber-banding', async () => {
    const metrics = ['m1', 'm2'];
    const rows = ['r1', 'r2'];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics: ['m1'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: rows,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      pivotExpansionState: {
        rowKeys: rows,
        colKeys: [],
        rows: [serializePath(['A'])],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
      startCollapsed: true,
      initialDepth: 1,
    });
    const queryFormData = buildFormData({
      ...formData,
      metrics: ['m1'],
    });
    const records = [
      { r1: 'A', r2: 'B', m1: 10, m2: 20 },
      { r1: 'A', r2: 'C', m1: 12, m2: 24 },
    ];
    const baseRecords = records.map(({ r1, r2, m1 }) => ({ r1, r2, m1 }));
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(baseRecords, ['m1'], rows, [], 2, 0),
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
    );
    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({
        data: records,
      })),
    );

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={queryFormData}
        metrics={metrics}
        groupbyRows={rows}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getByText('Select measures'));
    fireEvent.click(screen.getByLabelText('Toggle measure m2'));
    fireEvent.click(screen.getByText('Select measures'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const lastFetch = fetchMock.mock.calls.at(-1)?.[0];
    expect(
      lastFetch?.formData?.pivotExpansionState?.rows?.length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getAllByText('m2').length).toBeGreaterThan(0),
    );
  });
});
