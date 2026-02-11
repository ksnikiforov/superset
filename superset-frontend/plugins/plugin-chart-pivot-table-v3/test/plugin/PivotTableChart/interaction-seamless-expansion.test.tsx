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
  METRICS_PLACEHOLDER,
  applyMetricAxis,
  buildTreeFromRecords,
  getStableColumnKey,
  mergeTrees,
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

  it('shows grand total and restores row members after removing then re-adding the last row dimension', async () => {
    const metrics = ['m1', 'm2'];
    const initialRows = ['r1'];
    const detailTree = buildTreeFromRecords(
      [
        { r1: 'A', m1: 10, m2: 20 },
        { r1: 'B', m1: 12, m2: 24 },
      ],
      metrics,
      initialRows,
      [],
      1,
      0,
    );
    const totalsTree = buildTreeFromRecords(
      [{ m1: 22, m2: 44 }],
      metrics,
      initialRows,
      [],
      0,
      0,
    );
    const baseTree = applyMetricAxis(
      mergeTrees(detailTree, totalsTree),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      initialRows,
      [],
      0,
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
      colTotals: true,
      rowTotals: false,
      startCollapsed: false,
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
        colTotals
        rowTotals={false}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    const rowToggle = screen.getByLabelText(
      'Toggle row dimension',
    ) as HTMLButtonElement;
    fireEvent.click(rowToggle);
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByText('Grand total')).toBeInTheDocument(),
    );
    const totalRow = screen.getByText('Grand total').closest('tr');
    if (!totalRow) {
      throw new Error('Grand total row not found');
    }
    const totalValues = within(totalRow)
      .getAllByRole('cell')
      .map(cell => cell.textContent?.trim() ?? '');
    expect(totalValues).toEqual(expect.arrayContaining(['22', '44']));

    const rowToggleAfterTrim = screen.getByLabelText(
      'Toggle row dimension',
    ) as HTMLButtonElement;
    fireEvent.click(rowToggleAfterTrim);
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('B')).toBeInTheDocument());
  });

  it('shows grand total column and restores column members after removing then re-adding the last column dimension', async () => {
    const metrics = ['m1', 'm2'];
    const initialCols = ['c1'];
    const detailTree = buildTreeFromRecords(
      [
        { c1: 'A', m1: 10, m2: 20 },
        { c1: 'B', m1: 12, m2: 24 },
      ],
      metrics,
      [],
      initialCols,
      0,
      1,
    );
    const totalsTree = buildTreeFromRecords(
      [{ m1: 22, m2: 44 }],
      metrics,
      [],
      initialCols,
      0,
      0,
    );
    const baseTree = applyMetricAxis(
      mergeTrees(detailTree, totalsTree),
      metrics,
      MetricsLayoutEnum.ROWS,
      [],
      initialCols,
      0,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: initialCols,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'row', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: initialCols,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.ROWS,
      pivotRuntimeLayout: runtimeLayout,
      rowTotals: true,
      colTotals: false,
      startCollapsed: false,
      initialDepth: 1,
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={initialCols}
        rowTotals
        colTotals={false}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => {
      const thead = container.querySelector('thead') as HTMLElement;
      expect(within(thead).getByText('A')).toBeInTheDocument();
    });

    const colToggle = screen.getByLabelText(
      'Toggle column dimension',
    ) as HTMLButtonElement;
    fireEvent.click(colToggle);
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => {
      const thead = container.querySelector('thead') as HTMLElement;
      expect(within(thead).getByText('Grand total')).toBeInTheDocument();
    });
    await waitFor(() => {
      const tbody = container.querySelector('tbody') as HTMLElement;
      expect(within(tbody).getByText('m1')).toBeInTheDocument();
      expect(within(tbody).getByText('m2')).toBeInTheDocument();
    });

    const colToggleAfterTrim = screen.getByLabelText(
      'Toggle column dimension',
    ) as HTMLButtonElement;
    fireEvent.click(colToggleAfterTrim);
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => {
      const thead = container.querySelector('thead') as HTMLElement;
      expect(within(thead).getByText('A')).toBeInTheDocument();
      expect(within(thead).getByText('B')).toBeInTheDocument();
    });
  });

  it('clears stale expanded state values after trimming a column dimension when Values is first', async () => {
    const metrics = ['m1', 'm2'];
    const initialCols = ['gender', 'state'];
    const records = [
      { gender: 'F', state: 'CA', m1: 10, m2: 20 },
      { gender: 'F', state: 'WA', m1: 12, m2: 22 },
      { gender: 'M', state: 'TX', m1: 14, m2: 24 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, [], initialCols, 0, 2),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      initialCols,
      0,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: initialCols,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: initialCols,
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
        groupbyRows={[]}
        groupbyColumns={initialCols}
        width={600}
        height={300}
      />,
    );

    const thead = container.querySelector('thead') as HTMLElement;
    await waitFor(() =>
      expect(within(thead).getByText('m1')).toBeInTheDocument(),
    );

    const metricCell = within(thead)
      .getByText('m1')
      .closest('th') as HTMLElement;
    const metricExpand = within(metricCell).queryByLabelText('plus-square');
    if (metricExpand) {
      fireEvent.click(metricExpand);
    }

    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );
    const genderCell = within(thead)
      .getAllByText('F')[0]
      .closest('th') as HTMLElement;
    const genderExpand = within(genderCell).queryByLabelText('plus-square');
    if (genderExpand) {
      fireEvent.click(genderExpand);
    }

    await waitFor(() =>
      expect(within(thead).getAllByText('CA').length).toBeGreaterThan(0),
    );

    const columnButtons = screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(columnButtons[1]);

    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => {
      const refreshedThead = container.querySelector('thead') as HTMLElement;
      expect(within(refreshedThead).queryAllByText('CA')).toHaveLength(0);
      expect(within(refreshedThead).queryAllByText('WA')).toHaveLength(0);
      const refreshedGenderCell = within(refreshedThead)
        .getAllByText('F')[0]
        .closest('th') as HTMLElement;
      expect(
        within(refreshedGenderCell).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(refreshedGenderCell).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();
    });
  });

  it('keeps the pivot expanded when re-adding a trimmed column dimension in Values-first layout', async () => {
    const metrics = ['m1', 'm2'];
    const initialCols = ['gender', 'state'];
    const records = [
      { gender: 'F', state: 'CA', m1: 10, m2: 20 },
      { gender: 'F', state: 'WA', m1: 12, m2: 22 },
      { gender: 'M', state: 'TX', m1: 14, m2: 24 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, [], initialCols, 0, 2),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      initialCols,
      0,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: initialCols,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: initialCols,
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
        groupbyRows={[]}
        groupbyColumns={initialCols}
        width={600}
        height={300}
      />,
    );

    const thead = container.querySelector('thead') as HTMLElement;
    const getMetricCell = () =>
      within(thead).getByText('m1').closest('th') as HTMLElement;

    const metricExpand = within(getMetricCell()).queryByLabelText('plus-square');
    if (metricExpand) {
      fireEvent.click(metricExpand);
    }
    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );
    const genderCell = within(thead)
      .getAllByText('F')[0]
      .closest('th') as HTMLElement;
    const genderExpand = within(genderCell).queryByLabelText('plus-square');
    if (genderExpand) {
      fireEvent.click(genderExpand);
    }
    await waitFor(() =>
      expect(within(thead).getAllByText('CA').length).toBeGreaterThan(0),
    );

    const columnButtons = screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(columnButtons[1]);
    await waitFor(() => expect(within(thead).queryAllByText('CA')).toHaveLength(0));
    await waitFor(() =>
      expect(
        within(getMetricCell()).queryByLabelText('minus-square'),
      ).not.toBeNull(),
    );

    const columnButtonsAfterTrim =
      screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(columnButtonsAfterTrim[1]);

    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(
        within(getMetricCell()).queryByLabelText('minus-square'),
      ).not.toBeNull(),
    );
    await waitFor(() => {
      const refreshedGenderCell = within(thead)
        .getAllByText('F')[0]
        .closest('th') as HTMLElement;
      const genderToggle =
        within(refreshedGenderCell).queryByLabelText('plus-square') ??
        within(refreshedGenderCell).queryByLabelText('minus-square');
      expect(genderToggle).not.toBeNull();
    });
  });

  it('clears stale cached column leaves when removing one dimension and later adding another', async () => {
    const metrics = ['m1', 'm2'];
    const initialCols = ['gender', 'state'];
    const records = [
      { gender: 'F', state: 'CA', city: 'SF', m1: 10, m2: 20 },
      { gender: 'F', state: 'WA', city: 'SEA', m1: 12, m2: 22 },
      { gender: 'M', state: 'TX', city: 'AUS', m1: 14, m2: 24 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, [], initialCols, 0, 2),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      initialCols,
      0,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: initialCols,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [...initialCols, 'city'],
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
        groupbyRows={[]}
        groupbyColumns={initialCols}
        width={600}
        height={300}
      />,
    );

    const thead = container.querySelector('thead') as HTMLElement;
    const metricCell = within(thead).getByText('m1').closest('th') as HTMLElement;
    const metricExpand = within(metricCell).queryByLabelText('plus-square');
    if (metricExpand) {
      fireEvent.click(metricExpand);
    }
    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );

    const genderCell = within(thead)
      .getAllByText('F')[0]
      .closest('th') as HTMLElement;
    const genderExpand = within(genderCell).queryByLabelText('plus-square');
    if (genderExpand) {
      fireEvent.click(genderExpand);
    }
    await waitFor(() =>
      expect(within(thead).getAllByText('CA').length).toBeGreaterThan(0),
    );

    const findDimensionRow = (label: string) => {
      const nodes = screen.getAllByText(label);
      for (const node of nodes) {
        let current: HTMLElement | null = node as HTMLElement;
        while (current) {
          if (within(current).queryByLabelText('Toggle column dimension')) {
            return current;
          }
          current = current.parentElement;
        }
      }
      throw new Error(`Missing dimension row for ${label}`);
    };

    const stateRow = findDimensionRow('state');
    const stateToggle = within(stateRow).getByLabelText(
      'Toggle column dimension',
    ) as HTMLButtonElement;
    fireEvent.click(stateToggle);

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(within(thead).queryAllByText('CA')).toHaveLength(0));
    await waitFor(() => expect(within(thead).queryAllByText('WA')).toHaveLength(0));
    await waitFor(() => expect(within(thead).queryAllByText('TX')).toHaveLength(0));
    await waitFor(() => {
      const refreshedStateRow = findDimensionRow('state');
      const refreshedStateToggle = within(refreshedStateRow).getByLabelText(
        'Toggle column dimension',
      ) as HTMLButtonElement;
      expect(refreshedStateToggle.getAttribute('aria-pressed')).toBe('false');
    });

    const cityRow = findDimensionRow('city');
    const cityToggle = within(cityRow).getByLabelText(
      'Toggle column dimension',
    ) as HTMLButtonElement;
    fireEvent.click(cityToggle);
    await waitFor(() => {
      const refreshedCityRow = findDimensionRow('city');
      const refreshedCityToggle = within(refreshedCityRow).getByLabelText(
        'Toggle column dimension',
      ) as HTMLButtonElement;
      expect(refreshedCityToggle.getAttribute('aria-pressed')).toBe('true');
    });

    await waitFor(() => expect(within(thead).queryAllByText('CA')).toHaveLength(0));
    await waitFor(() => expect(within(thead).queryAllByText('WA')).toHaveLength(0));
    await waitFor(() => expect(within(thead).queryAllByText('TX')).toHaveLength(0));

    await waitFor(() => {
      const refreshedGenderCell = within(thead)
        .getAllByText('F')[0]
        .closest('th') as HTMLElement;
      const toggle =
        within(refreshedGenderCell).queryByLabelText('plus-square') ??
        within(refreshedGenderCell).queryByLabelText('minus-square');
      expect(toggle).not.toBeNull();
    });
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

  it('does not seamless-reload for non-leading reorders on the value axis stack', async () => {
    const metrics = ['measure1', 'measure2'];
    const colGroupby = ['col1', 'col2', 'col3'];
    const records = [
      { col1: 'A', col2: 'B', col3: 'C', measure1: 10, measure2: 20 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, [], colGroupby, 0, 3),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      colGroupby,
      3,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: colGroupby,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 3 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: colGroupby,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={colGroupby}
        width={600}
        height={300}
      />,
    );

    const getColChips = () =>
      screen
        .getAllByLabelText('Remove dimension')
        .map(button => button.parentElement)
        .filter((node): node is HTMLElement => Boolean(node));

    const getColChip = (label: string) => {
      const chips = getColChips();
      const chip = chips.find(node => node.textContent?.includes(label));
      if (!chip) {
        throw new Error(`Missing column chip for ${label}`);
      }
      return chip;
    };

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
      dropEffect: 'move',
      effectAllowed: 'all',
    };

    const col3Chip = getColChip('col3');
    const col2Chip = getColChip('col2');
    fireEvent.dragStart(col3Chip, { dataTransfer });
    fireEvent.dragEnter(col2Chip, { dataTransfer });
    fireEvent.dragOver(col2Chip, { dataTransfer });
    fireEvent.drop(col2Chip, { dataTransfer });
    fireEvent.dragEnd(col3Chip, { dataTransfer });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('seamless-reloads when reordering changes the leading value-axis key', async () => {
    const metrics = ['measure1', 'measure2'];
    const colGroupby = ['col1', 'col2', 'col3'];
    const records = [
      { col1: 'A', col2: 'B', col3: 'C', measure1: 10, measure2: 20 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, [], colGroupby, 0, 3),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      colGroupby,
      3,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: colGroupby,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 3 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: colGroupby,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={colGroupby}
        width={600}
        height={300}
      />,
    );

    const getColChips = () =>
      screen
        .getAllByLabelText('Remove dimension')
        .map(button => button.parentElement)
        .filter((node): node is HTMLElement => Boolean(node));

    const getColChip = (label: string) => {
      const chips = getColChips();
      const chip = chips.find(node => node.textContent?.includes(label));
      if (!chip) {
        throw new Error(`Missing column chip for ${label}`);
      }
      return chip;
    };

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
      dropEffect: 'move',
      effectAllowed: 'all',
    };

    const col3Chip = getColChip('col3');
    const col1Chip = getColChip('col1');
    fireEvent.dragStart(col3Chip, { dataTransfer });
    fireEvent.dragEnter(col1Chip, { dataTransfer });
    fireEvent.dragOver(col1Chip, { dataTransfer });
    fireEvent.drop(col1Chip, { dataTransfer });
    fireEvent.dragEnd(col3Chip, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('moves Values to rows for multi-metric interaction without leaving stale column metrics', async () => {
    const metrics = ['measure1', 'measure2'];
    const rowGroupby = ['row1'];
    const colGroupby = ['col1'];
    const records = [{ row1: 'R1', col1: 'C1', measure1: 10, measure2: 20 }];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rowGroupby, colGroupby, 1, 1),
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

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );

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

    const thead = container.querySelector('thead') as HTMLElement;
    expect(within(thead).getByText('measure1')).toBeInTheDocument();
    expect(within(thead).getByText('measure2')).toBeInTheDocument();

    const getRowChips = () =>
      screen
        .getAllByLabelText('Remove dimension')
        .map(button => button.parentElement)
        .filter((node): node is HTMLElement => Boolean(node));

    const row1Chip = getRowChips().find(node =>
      node.textContent?.includes('row1'),
    ) as HTMLElement | undefined;
    if (!row1Chip) {
      throw new Error('Missing row chip for row1');
    }

    const valueLabel = screen
      .getAllByText('Value')
      .find(node => !node.closest('thead') && !node.closest('tbody'));
    if (!valueLabel) {
      throw new Error('Missing Value chip label');
    }
    const valueChip = valueLabel.parentElement as HTMLElement | null;
    if (!valueChip) {
      throw new Error('Missing Value chip element');
    }

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
      dropEffect: 'move',
      effectAllowed: 'all',
    };

    fireEvent.dragStart(valueChip, { dataTransfer });
    fireEvent.dragEnter(row1Chip, { dataTransfer });
    fireEvent.dragOver(row1Chip, { dataTransfer });
    fireEvent.drop(row1Chip, { dataTransfer });
    fireEvent.dragEnd(valueChip, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const lastFetch = fetchMock.mock.calls.at(-1)?.[0];
    expect(lastFetch?.formData?.metricsLayout).toBe(MetricsLayoutEnum.ROWS);
    expect(
      (lastFetch?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual(expect.arrayContaining(['row1', METRICS_PLACEHOLDER]));

    await waitFor(() => {
      const nextThead = container.querySelector('thead') as HTMLElement;
      expect(within(nextThead).queryByText('measure1')).not.toBeInTheDocument();
      expect(within(nextThead).queryByText('measure2')).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getAllByText('measure1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('measure2').length).toBeGreaterThan(0);
    });
  });

  it('seamless-reloads when moving Values to the front on a populated column axis', async () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['r1'];
    const records = [{ r1: 'R1', c1: 'C1', m1: 10, m2: 20 }];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rowGroupby, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
      0,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: rowGroupby,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [...rowGroupby, 'c1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    const findDimensionRow = (label: string) => {
      const nodes = screen.getAllByText(label);
      for (const node of nodes) {
        let current: HTMLElement | null = node as HTMLElement;
        while (current) {
          if (
            within(current).queryByLabelText('Toggle row dimension') ||
            within(current).queryByLabelText('Toggle column dimension')
          ) {
            return current;
          }
          current = current.parentElement;
        }
      }
      throw new Error(`Missing dimension row for ${label}`);
    };

    const c1Row = findDimensionRow('c1');
    fireEvent.click(within(c1Row).getByLabelText('Toggle column dimension'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const afterAddCall = fetchMock.mock.calls.at(-1)?.[0];
    expect(
      (afterAddCall?.formData?.groupbyColumns ?? []).map(getStableColumnKey),
    ).toEqual(['c1', METRICS_PLACEHOLDER]);

    const getColChips = () =>
      screen
        .getAllByLabelText('Remove dimension')
        .map(button => button.parentElement)
        .filter((node): node is HTMLElement => Boolean(node));
    const getColChip = (label: string) => {
      const chips = getColChips();
      const chip = chips.find(node => node.textContent?.includes(label));
      if (!chip) {
        throw new Error(`Missing column chip for ${label}`);
      }
      return chip;
    };

    const valueLabel = screen
      .getAllByText('Value')
      .find(node => !node.closest('thead') && !node.closest('tbody'));
    if (!valueLabel) {
      throw new Error('Missing Value chip label');
    }
    const valueChip = valueLabel.parentElement as HTMLElement | null;
    if (!valueChip) {
      throw new Error('Missing Value chip element');
    }
    const c1Chip = getColChip('c1');

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
      dropEffect: 'move',
      effectAllowed: 'all',
    };

    fireEvent.dragStart(valueChip, { dataTransfer });
    fireEvent.dragEnter(c1Chip, { dataTransfer });
    fireEvent.dragOver(c1Chip, { dataTransfer });
    fireEvent.drop(c1Chip, { dataTransfer });
    fireEvent.dragEnd(valueChip, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const afterMoveCall = fetchMock.mock.calls.at(-1)?.[0];
    expect(afterMoveCall?.formData?.metricsLayout).toBe(
      MetricsLayoutEnum.COLUMNS,
    );
    expect(
      (afterMoveCall?.formData?.groupbyColumns ?? []).map(getStableColumnKey),
    ).toEqual([METRICS_PLACEHOLDER, 'c1']);
  });

  it('keeps visible column headers after adding the first column dimension to a Values-only column axis', async () => {
    const metrics = ['m1', 'm2'];
    const records = [
      { c1: 'A', m1: 10, m2: 20 },
      { c1: 'B', m1: 12, m2: 24 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, [], [], 0, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      [],
      0,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['c1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    const findDimensionRow = (label: string) => {
      const nodes = screen.getAllByText(label);
      for (const node of nodes) {
        let current: HTMLElement | null = node as HTMLElement;
        while (current) {
          if (within(current).queryByLabelText('Toggle column dimension')) {
            return current;
          }
          current = current.parentElement;
        }
      }
      throw new Error(`Missing dimension row for ${label}`);
    };

    const c1Row = findDimensionRow('c1');
    fireEvent.click(within(c1Row).getByLabelText('Toggle column dimension'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const fetchCall = fetchMock.mock.calls.at(-1)?.[0];
    const plannedSpecs = fetchCall?.specs ?? [];
    expect(plannedSpecs.length).toBeGreaterThan(0);
    expect(
      plannedSpecs.some(
        (spec: { meta?: { colDepth?: number } }) => (spec.meta?.colDepth ?? 0) >= 1,
      ),
    ).toBe(true);
    expect(
      plannedSpecs.some(
        (spec: { meta?: { colGroupbyForQueryFull?: string[] } }) =>
          (spec.meta?.colGroupbyForQueryFull ?? []).includes('c1'),
      ),
    ).toBe(true);
    expect(
      (fetchCall?.formData?.groupbyColumns ?? []).map(getStableColumnKey),
    ).toEqual(['c1', METRICS_PLACEHOLDER]);

    await waitFor(() => {
      const thead = container.querySelector('thead') as HTMLElement;
      expect(within(thead).getByText('A')).toBeInTheDocument();
      expect(within(thead).getByText('B')).toBeInTheDocument();
    });
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
