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
import { getColumnLabel, QueryFormColumn } from '@superset-ui/core';
import { fireEvent, render, screen, waitFor, within } from '../../testUtils';
import PivotTableChart, {
  buildPreloadedBranchFactBatches,
  buildPreloadedTreeFactBatches,
} from '../fixtures/TestPivotTableChart';
import { buildFormData } from '../fixtures/pivotFormData';
import {
  MetricsLayoutEnum,
  PivotRuntimeLayout,
  PivotTreeData,
} from '../../../src/types';
import { getStableColumnKey } from '../../../src/utils';
import { METRICS_PLACEHOLDER } from '../../../src/pivot/core/tokens';
import { serializePath } from '../../../src/pivot/core/path';
import { mergeTrees } from '../fixtures/tree';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { supersetChartDataClient } from '../../../src/pivot/data/SupersetChartDataClient';
import {
  fetchPivotExpansion,
  type FetchPivotExpansionRequest,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import { type PlannedQuerySpec } from '../../../src/pivot/query/specs';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import {
  buildMockExpansionFetchResult as buildMockCoverageFetchResult,
  getMockExpansionRequestAxis,
} from '../fixtures/factBatches';
import { applyMetricAxis } from '../fixtures/metricAxis';

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

jest.mock('../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

describe('PivotTableChart seamless expansion uses committed layout', () => {
  const fetchMock = supersetChartDataClient.fetch as jest.Mock;
  const fetchPivotBranchMock = fetchPivotExpansion as jest.Mock;
  const buildMockExpansionFetchResult = (
    params: FetchPivotExpansionRequest,
    data?: PivotTreeData,
  ) => buildMockCoverageFetchResult(params, { data });
  const resolveExpansionData =
    (data?: PivotTreeData) => (params: FetchPivotExpansionRequest) =>
      Promise.resolve(buildMockExpansionFetchResult(params, data));

  beforeEach(() => {
    fetchMock.mockReset();
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockImplementation(resolveExpansionData());
  });

  const hasColumnKey = (
    columns: Array<string | QueryFormColumn> | undefined,
    key: string,
  ) =>
    (columns ?? []).some(column => {
      if (typeof column === 'string') {
        return column === key;
      }
      return getColumnLabel(column) === key;
    });

  const getHeaderCell = (
    thead: HTMLElement,
    label: string,
    toggleLabel?: string,
  ) => {
    const cells = within(thead)
      .getAllByText(label)
      .map(node => node.closest('th') as HTMLElement | null)
      .filter((cell): cell is HTMLElement => Boolean(cell));
    if (toggleLabel) {
      const cellWithToggle = cells.find(cell =>
        within(cell).queryByLabelText(toggleLabel),
      );
      if (cellWithToggle) {
        return cellWithToggle;
      }
    }
    return (
      cells.find(
        cell =>
          within(cell).queryByLabelText('plus-square') ||
          within(cell).queryByLabelText('minus-square'),
      ) ?? cells[0]
    );
  };

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
    Object.values(baseTree.rows).forEach(node => {
      if (node.path.length === 1) {
        baseTree.rows[node.key] = { ...node, hasChildren: false };
      }
    });
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
      specs.map(spec => {
        const { columns } = spec as {
          columns?: Array<string | QueryFormColumn>;
        };
        if (hasColumnKey(columns, 'revenueBand')) {
          return { data: updatedRecords };
        }
        const metricKey = metrics[0];
        return {
          data: [
            {
              [metricKey]: updatedRecords.reduce(
                (sum, row) =>
                  sum +
                  (Number((row as Record<string, unknown>)[metricKey]) || 0),
                0,
              ),
            },
          ],
        };
      }),
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

  it('does not fetch when removing a covered trailing row dimension after expanding a top-level row', async () => {
    const metrics = ['m1'];
    const initialRows = ['r1', 'r2', 'r3'];
    const records = [
      { r1: 'A', r2: 'A1', r3: 'X', m1: 10 },
      { r1: 'A', r2: 'A2', r3: 'Y', m1: 12 },
      { r1: 'B', r2: 'B1', r3: 'Z', m1: 7 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, initialRows, [], 2, 0),
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
      pivotExpansionState: {
        rowKeys: initialRows,
        colKeys: [],
        rows: [['A']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
      startCollapsed: true,
      initialDepth: 2,
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
        factBatches={buildPreloadedTreeFactBatches(baseTree, {
          groupbyRows: initialRows,
          groupbyColumns: [],
        })}
        width={600}
        height={300}
      />,
    );
    await waitFor(() =>
      expect(screen.queryAllByLabelText('minus-square').length).toBeGreaterThan(
        0,
      ),
    );

    fetchMock.mockClear();
    fetchPivotBranchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise(() => undefined));

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

    const lineStatusRow = findDimensionRow('r3');
    fireEvent.click(
      within(lineStatusRow).getByLabelText('Toggle row dimension'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
  });

  it('keeps expanded row hierarchy visible while trimming a covered trailing row', async () => {
    const metrics = ['m1', 'm2'];
    const initialRows = ['r1', 'r2', 'r3'];
    const records = [
      { r1: 'A', r2: 'A1', r3: 'X', m1: 10, m2: 20 },
      { r1: 'A', r2: 'A2', r3: 'Y', m1: 12, m2: 24 },
      { r1: 'B', r2: 'B1', r3: 'Z', m1: 7, m2: 14 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, initialRows, [], 3, 0),
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
      pivotExpansionState: {
        rowKeys: initialRows,
        colKeys: [],
        rows: [['A']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
      startCollapsed: true,
      initialDepth: 2,
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
        factBatches={buildPreloadedTreeFactBatches(baseTree, {
          groupbyRows: initialRows,
          groupbyColumns: [],
        })}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('A2')).toBeInTheDocument());

    fetchMock.mockClear();
    fetchPivotBranchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise(() => undefined));

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

    const r3Row = findDimensionRow('r3');
    fireEvent.click(within(r3Row).getByLabelText('Toggle row dimension'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A2')).toBeInTheDocument();
    expect(screen.queryByText('A1')).toBeInTheDocument();
    expect(screen.queryByText('A2')).toBeInTheDocument();
  });

  it('keeps expanded rows stable when trailing trim coincides with stale parent data refresh', async () => {
    const metrics = ['m1', 'm2'];
    const initialRows = ['r1', 'r2', 'r3'];
    const records = [
      { r1: 'A', r2: 'A1', r3: 'X', m1: 10, m2: 20 },
      { r1: 'A', r2: 'A2', r3: 'Y', m1: 12, m2: 24 },
      { r1: 'B', r2: 'B1', r3: 'Z', m1: 7, m2: 14 },
    ];
    const hydratedTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, initialRows, [], 3, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      initialRows,
      [],
      0,
    );
    const staleTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, initialRows, [], 1, 0),
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
      pivotExpansionState: {
        rowKeys: initialRows,
        colKeys: [],
        rows: [['A']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
      startCollapsed: true,
      initialDepth: 2,
    });

    fetchPivotBranchMock.mockImplementation(() => new Promise(() => undefined));

    const { rerender } = render(
      <PivotTableChart
        data={hydratedTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={initialRows}
        groupbyColumns={[]}
        factBatches={buildPreloadedTreeFactBatches(hydratedTree, {
          groupbyRows: initialRows,
          groupbyColumns: [],
        })}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('A2')).toBeInTheDocument());

    fetchMock.mockClear();
    fetchPivotBranchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise(() => undefined));

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

    const r3Row = findDimensionRow('r3');
    fireEvent.click(within(r3Row).getByLabelText('Toggle row dimension'));

    rerender(
      <PivotTableChart
        data={staleTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={initialRows}
        groupbyColumns={[]}
        factBatches={buildPreloadedTreeFactBatches(hydratedTree, {
          groupbyRows: initialRows,
          groupbyColumns: [],
        })}
        width={600}
        height={300}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A2')).toBeInTheDocument();
  });

  it('reuses loaded coverage when removing trailing row dimension after deep expansion is loaded', async () => {
    const metrics = ['m1', 'm2'];
    const initialRows = ['r1', 'r2', 'r3'];
    const records = [
      { r1: 'A', r2: 'A1', r3: 'X', m1: 10, m2: 20 },
      { r1: 'A', r2: 'A1', r3: 'Y', m1: 12, m2: 24 },
      { r1: 'A', r2: 'A2', r3: 'Z', m1: 7, m2: 14 },
      { r1: 'B', r2: 'B1', r3: 'Q', m1: 5, m2: 10 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, initialRows, [], 3, 0),
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
      pivotExpansionState: {
        rowKeys: initialRows,
        colKeys: [],
        rows: [['A'], ['A', 'A1']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
      startCollapsed: true,
      initialDepth: 2,
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
        factBatches={buildPreloadedTreeFactBatches(baseTree, {
          groupbyRows: initialRows,
          groupbyColumns: [],
        })}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Y')).toBeInTheDocument());

    fetchMock.mockClear();
    fetchPivotBranchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise(() => undefined));

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

    const r3Row = findDimensionRow('r3');
    fireEvent.click(within(r3Row).getByLabelText('Toggle row dimension'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
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

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(spec => {
        const { columns } = spec as {
          columns?: Array<string | QueryFormColumn>;
        };
        if (hasColumnKey(columns, 'r1')) {
          return {
            data: [
              { r1: 'A', m1: 10, m2: 20 },
              { r1: 'B', m1: 12, m2: 24 },
            ],
          };
        }
        return { data: [{ m1: 22, m2: 44 }] };
      }),
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

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('B')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reloads data when replacing the leading row dimension in user-controlled mode', async () => {
    const metrics = ['m1'];
    const initialRows = ['row1'];
    const initialRecords = [
      { row1: 'A', m1: 10 },
      { row1: 'B', m1: 20 },
    ];
    const updatedRecords = [
      { row2: 'X', m1: 30 },
      { row2: 'Y', m1: 40 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(initialRecords, metrics, initialRows, [], 1, 0),
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
      dimensions: ['row1', 'row2'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
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
        groupbyRows={initialRows}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    const findRowDimensionControl = (label: string) => {
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
      throw new Error(`Missing row dimension control for ${label}`);
    };

    const row2Control = findRowDimensionControl('row2');
    const row2Toggle = within(row2Control).getByLabelText(
      'Toggle row dimension',
    ) as HTMLButtonElement;
    const callsBeforeRow2Enable = fetchMock.mock.calls.length;
    fireEvent.click(row2Toggle);
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(
        callsBeforeRow2Enable,
      ),
    );

    const callsBeforeLeadingSwap = fetchMock.mock.calls.length;

    const row1Control = findRowDimensionControl('row1');
    const row1Toggle = within(row1Control).getByLabelText(
      'Toggle row dimension',
    ) as HTMLButtonElement;
    fireEvent.click(row1Toggle);

    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(
        callsBeforeLeadingSwap,
      ),
    );
    const matchingCalls = fetchMock.mock.calls
      .slice(callsBeforeLeadingSwap)
      .filter(call => {
        const payload = call[0] as
          | {
              formData?: { groupbyRows?: string[] };
              specs?: Array<{ columns?: string[] }>;
            }
          | undefined;
        return (
          Array.isArray(payload?.formData?.groupbyRows) &&
          payload?.formData?.groupbyRows.length === 1 &&
          payload.formData.groupbyRows[0] === 'row2'
        );
      });
    expect(matchingCalls.length).toBeGreaterThan(0);

    const hasRow2DetailSpec = matchingCalls.some(call => {
      const payload = call[0] as {
        specs?: Array<{ columns?: Array<string | QueryFormColumn> }>;
      };
      return (payload.specs ?? []).some(spec =>
        hasColumnKey(spec.columns, 'row2'),
      );
    });
    expect(hasRow2DetailSpec).toBe(true);
    const hasStaleRow1Spec = matchingCalls.some(call => {
      const payload = call[0] as {
        specs?: Array<{ columns?: Array<string | QueryFormColumn> }>;
      };
      return (payload.specs ?? []).some(spec =>
        hasColumnKey(spec.columns, 'row1'),
      );
    });
    expect(hasStaleRow1Spec).toBe(false);

    await waitFor(() => {
      const tbody = container.querySelector('tbody') as HTMLElement;
      expect(within(tbody).getAllByText('X').length).toBeGreaterThan(0);
      expect(within(tbody).getAllByText('Y').length).toBeGreaterThan(0);
    });
  });

  it('reloads when adding the first row dimension after clearing rows in user-controlled mode', async () => {
    const metrics = ['m1'];
    const initialRows = ['name'];
    const initialRecords = [
      { name: 'A', m1: 10 },
      { name: 'B', m1: 20 },
    ];
    const updatedRecords = [
      { city: 'NY', m1: 30 },
      { city: 'SF', m1: 40 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(initialRecords, metrics, initialRows, [], 1, 0),
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
      dimensions: ['name', 'city'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
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
        groupbyRows={initialRows}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    const findRowDimensionControl = (label: string) => {
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
      throw new Error(`Missing row dimension control for ${label}`);
    };

    const nameControl = findRowDimensionControl('name');
    const nameToggle = within(nameControl).getByLabelText(
      'Toggle row dimension',
    ) as HTMLButtonElement;
    const callsBeforeRemove = fetchMock.mock.calls.length;
    fireEvent.click(nameToggle);
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBe(callsBeforeRemove + 1),
    );
    const removeFetch = fetchMock.mock.calls[callsBeforeRemove]?.[0];
    expect(removeFetch?.formData?.groupbyRows ?? []).toEqual([]);
    await waitFor(() =>
      expect(screen.getByText('Grand total')).toBeInTheDocument(),
    );

    const cityControl = findRowDimensionControl('city');
    const cityToggle = within(cityControl).getByLabelText(
      'Toggle row dimension',
    ) as HTMLButtonElement;
    const callsBeforeAdd = fetchMock.mock.calls.length;
    fireEvent.click(cityToggle);
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeAdd),
    );
    const cityFetchCalls = fetchMock.mock.calls.slice(callsBeforeAdd);
    const hasCityQuery = cityFetchCalls.some(call =>
      (
        (call[0]?.formData?.groupbyRows ?? []) as Array<
          string | QueryFormColumn
        >
      )
        .map(getStableColumnKey)
        .includes('city'),
    );
    expect(hasCityQuery).toBe(true);

    await waitFor(() => {
      const tbody = container.querySelector('tbody') as HTMLElement;
      expect(within(tbody).getByText('NY')).toBeInTheDocument();
      expect(within(tbody).getByText('SF')).toBeInTheDocument();
    });
  });

  it('fetches only when the first row key changes in a multistep row-toggle sequence', async () => {
    const metrics = ['m1'];
    const initialRows = ['name'];
    const initialRecords = [
      { name: 'A', m1: 10 },
      { name: 'B', m1: 20 },
    ];
    const stateRecords = [
      { state: 'CA', m1: 30 },
      { state: 'NY', m1: 40 },
    ];
    const cityRecords = [
      { city: 'SF', m1: 50 },
      { city: 'SEA', m1: 60 },
    ];
    const stateCityRecords = [
      { state: 'CA', city: 'SF', m1: 50 },
      { state: 'NY', city: 'SEA', m1: 60 },
    ];

    const baseTree = applyMetricAxis(
      buildTreeFromRecords(initialRecords, metrics, initialRows, [], 1, 0),
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
      dimensions: ['name', 'state', 'city'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 1,
    });

    fetchMock.mockImplementation(
      async ({
        formData: nextFormData,
        specs,
      }: {
        formData?: { groupbyRows?: Array<string | QueryFormColumn> };
        specs: Array<unknown>;
      }) => {
        const rowKeys = (nextFormData?.groupbyRows ?? []).map(
          getStableColumnKey,
        );
        const rows =
          rowKeys.length === 1 && rowKeys[0] === 'state'
            ? stateRecords
            : rowKeys.length === 1 && rowKeys[0] === 'city'
              ? cityRecords
              : rowKeys.includes('state') && rowKeys.includes('city')
                ? stateCityRecords
                : initialRecords;
        return specs.map(() => ({ data: rows }));
      },
    );

    const { container } = render(
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

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    const findRowDimensionControl = (label: string) => {
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
      throw new Error(`Missing row dimension control for ${label}`);
    };

    const nameControl = findRowDimensionControl('name');
    fireEvent.click(within(nameControl).getByLabelText('Toggle row dimension'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const rootFetch = fetchMock.mock.calls[0]?.[0];
    expect(rootFetch?.formData?.groupbyRows ?? []).toEqual([]);
    await waitFor(() =>
      expect(screen.getByText('Grand total')).toBeInTheDocument(),
    );

    const stateControl = findRowDimensionControl('state');
    fireEvent.click(
      within(stateControl).getByLabelText('Toggle row dimension'),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstFetch = fetchMock.mock.calls[1]?.[0];
    expect(
      (firstFetch?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual(['state']);
    await waitFor(() => expect(screen.getByText('CA')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('NY')).toBeInTheDocument());

    const cityControl = findRowDimensionControl('city');
    fireEvent.click(within(cityControl).getByLabelText('Toggle row dimension'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const stateControlAfterAdd = findRowDimensionControl('state');
    fireEvent.click(
      within(stateControlAfterAdd).getByLabelText('Toggle row dimension'),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const secondFetch = fetchMock.mock.calls[3]?.[0];
    expect(
      (secondFetch?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual(['city']);

    await waitFor(() => {
      const tbody = container.querySelector('tbody') as HTMLElement;
      expect(within(tbody).getAllByText('SF').length).toBeGreaterThan(0);
      expect(within(tbody).getAllByText('SEA').length).toBeGreaterThan(0);
      expect(within(tbody).queryByText('CA')).not.toBeInTheDocument();
      expect(within(tbody).queryByText('NY')).not.toBeInTheDocument();
    });
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

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(spec => {
        const { columns } = spec as {
          columns?: Array<string | QueryFormColumn>;
        };
        if (hasColumnKey(columns, 'c1')) {
          return {
            data: [
              { c1: 'A', m1: 10, m2: 20 },
              { c1: 'B', m1: 12, m2: 24 },
            ],
          };
        }
        return { data: [{ m1: 22, m2: 44 }] };
      }),
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

    await waitFor(() => {
      const thead = container.querySelector('thead') as HTMLElement;
      expect(within(thead).getByText('A')).toBeInTheDocument();
      expect(within(thead).getByText('B')).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
      initialDepth: 2,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );
    fetchPivotBranchMock.mockImplementation(resolveExpansionData(baseTree));

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={initialCols}
        factBatches={buildPreloadedBranchFactBatches(baseTree, {
          groupbyRows: [],
          groupbyColumns: initialCols,
        })}
        width={600}
        height={300}
      />,
    );

    const currentThead = () => container.querySelector('thead') as HTMLElement;
    const thead = currentThead();
    await waitFor(() => expect(getHeaderCell(thead, 'm1')).toBeInTheDocument());

    const metricCell = getHeaderCell(thead, 'm1', 'plus-square');
    const metricExpand = within(metricCell).queryByLabelText('plus-square');
    if (metricExpand) {
      fireEvent.click(metricExpand);
    }

    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );
    const genderCell = getHeaderCell(thead, 'F', 'plus-square');
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
      const refreshedGenderCell = getHeaderCell(refreshedThead, 'F');
      expect(
        within(refreshedGenderCell).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(refreshedGenderCell).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('seamless-reloads when trimming a trailing column value-axis dimension without cached parent cells', async () => {
    const metrics = ['m1', 'm2'];
    const initialCols = ['col1', 'col2'];
    const records = [
      { row1: 'A', col1: 'X', col2: 'I', m1: 10, m2: 20 },
      { row1: 'A', col1: 'X', col2: 'II', m1: 12, m2: 24 },
      { row1: 'B', col1: 'Y', col2: 'I', m1: 14, m2: 28 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, ['row1'], initialCols, 1, 2),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      initialCols,
      2,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: initialCols,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 2 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['row1', ...initialCols],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: true,
      initialDepth: 2,
    });
    const factBatches: PivotFactStoreBatch[] = [
      {
        coverage: {
          rowDepth: 1,
          columnDepth: 2,
          rowDimensions: ['row1'],
          columnDimensions: initialCols,
        },
        facts: [],
        valueKeys: ['m1', 'm2'],
        scope: {
          kind: 'axisPaths',
          axis: 'col',
          paths: [['X'], ['Y']],
        },
      },
    ];

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );
    fetchPivotBranchMock.mockImplementation(resolveExpansionData(baseTree));

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={['row1']}
        groupbyColumns={initialCols}
        factBatches={[
          ...factBatches,
          ...buildPreloadedBranchFactBatches(baseTree, {
            groupbyRows: ['row1'],
            groupbyColumns: initialCols,
          }),
        ]}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => {
      const thead = container.querySelector('thead') as HTMLElement;
      expect(within(thead).getByText('X')).toBeInTheDocument();
      expect(within(thead).getAllByText('I').length).toBeGreaterThan(0);
    });

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

    const col2Row = findDimensionRow('col2');
    const col2Toggle = within(col2Row).getByLabelText(
      'Toggle column dimension',
    ) as HTMLButtonElement;
    fireEvent.click(col2Toggle);

    await waitFor(() => {
      const refreshedThead = container.querySelector('thead') as HTMLElement;
      expect(within(refreshedThead).getByText('X')).toBeInTheDocument();
      expect(within(refreshedThead).getByText('Y')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0]?.[0];
    expect(
      new Set(
        (fetchCall?.specs as PlannedQuerySpec[]).map(
          spec =>
            `${spec.meta.factSelector.coverage.rowDepth}|${spec.meta.factSelector.coverage.columnDepth}`,
        ),
      ),
    ).toEqual(new Set(['1|0', '0|1']));
    expect(
      fetchCall?.specs.some((spec: { columns?: string[] }) =>
        spec.columns?.includes('col2'),
      ),
    ).toBe(false);
  });

  it('keeps Values-first metric branches expandable after re-adding a trimmed column dimension', async () => {
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
      initialDepth: 2,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );
    fetchPivotBranchMock.mockImplementation(resolveExpansionData(baseTree));

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={initialCols}
        factBatches={buildPreloadedBranchFactBatches(baseTree, {
          groupbyRows: [],
          groupbyColumns: initialCols,
        })}
        width={600}
        height={300}
      />,
    );

    const currentThead = () => container.querySelector('thead') as HTMLElement;
    const thead = currentThead();
    const getMetricCell = () => getHeaderCell(currentThead(), 'm1');

    const metricExpand = within(
      getHeaderCell(thead, 'm1', 'plus-square'),
    ).queryByLabelText('plus-square');
    if (metricExpand) {
      fireEvent.click(metricExpand);
    }
    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );
    const genderCell = getHeaderCell(thead, 'F', 'plus-square');
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
    await waitFor(() =>
      expect(within(thead).queryAllByText('CA')).toHaveLength(0),
    );
    await waitFor(() =>
      expect(
        within(getMetricCell()).queryByLabelText('minus-square'),
      ).toBeInTheDocument(),
    );

    const columnButtonsAfterTrim = screen.getAllByLabelText(
      'Toggle column dimension',
    );
    fireEvent.click(columnButtonsAfterTrim[1]);
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(
        within(getMetricCell()).queryByLabelText('minus-square'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
      initialDepth: 2,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );
    fetchPivotBranchMock.mockImplementation(resolveExpansionData(baseTree));

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={initialCols}
        factBatches={buildPreloadedBranchFactBatches(baseTree, {
          groupbyRows: [],
          groupbyColumns: initialCols,
        })}
        width={600}
        height={300}
      />,
    );

    const currentThead = () => container.querySelector('thead') as HTMLElement;
    const thead = currentThead();
    const getMetricCell = () => getHeaderCell(currentThead(), 'm1');
    const metricExpand = within(
      getHeaderCell(thead, 'm1', 'plus-square'),
    ).queryByLabelText('plus-square');
    if (metricExpand) {
      fireEvent.click(metricExpand);
    }
    await waitFor(() =>
      expect(within(thead).getAllByText('F').length).toBeGreaterThan(0),
    );

    const genderCell = getHeaderCell(thead, 'F', 'plus-square');
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
    await waitFor(() =>
      expect(within(currentThead()).queryAllByText('CA')).toHaveLength(0),
    );
    await waitFor(() =>
      expect(within(currentThead()).queryAllByText('WA')).toHaveLength(0),
    );
    await waitFor(() =>
      expect(within(currentThead()).queryAllByText('TX')).toHaveLength(0),
    );
    await waitFor(() => {
      const refreshedStateRow = findDimensionRow('state');
      const refreshedStateToggle = within(refreshedStateRow).getByLabelText(
        'Toggle column dimension',
      ) as HTMLButtonElement;
      expect(refreshedStateToggle).toHaveAttribute('aria-pressed', 'false');
    });
    const expansionCallsAfterStateTrim = fetchPivotBranchMock.mock.calls.length;

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
      expect(refreshedCityToggle).toHaveAttribute('aria-pressed', 'true');
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchPivotBranchMock.mock.calls).toHaveLength(
      expansionCallsAfterStateTrim,
    );

    await waitFor(() =>
      expect(within(currentThead()).queryAllByText('CA')).toHaveLength(0),
    );
    await waitFor(() =>
      expect(within(currentThead()).queryAllByText('WA')).toHaveLength(0),
    );
    await waitFor(() =>
      expect(within(currentThead()).queryAllByText('TX')).toHaveLength(0),
    );

    await waitFor(() =>
      expect(
        within(getMetricCell()).queryByLabelText('minus-square'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(currentThead()).getAllByText('F').length).toBeGreaterThan(
        0,
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows column expand toggles after inserting before trailing values through seamless reload', async () => {
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
    const updatedRecords = [
      { shipMode: 'AIR', revenueBand: 'REV-A', grossRevenue: 22 },
      { shipMode: 'FOB', revenueBand: 'REV-B', grossRevenue: 5 },
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
    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(spec => {
        const { columns } = spec as {
          columns?: Array<string | QueryFormColumn>;
        };
        if (hasColumnKey(columns, 'revenueBand')) {
          return { data: updatedRecords };
        }
        return {
          data: updatedRecords.map(({ shipMode, grossRevenue }) => ({
            shipMode,
            grossRevenue,
          })),
        };
      }),
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

    const airNode = screen.queryAllByText('AIR')[0];
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

  it('seamless-reloads when row chip reorder changes the leading row key', async () => {
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const reorderFetch = fetchMock.mock.calls.at(-1)?.[0];
    expect(
      (reorderFetch?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual(['row2', 'row1']);
  });

  it('locally reorders covered non-leading dimensions on the value axis stack', async () => {
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
      startCollapsed: false,
      initialDepth: 2,
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

  it('keeps layout editing live while a Values placement fetch is pending', async () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['r1'];
    const records = [{ r1: 'A', c1: 'X', m1: 10, m2: 20 }];
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
      dimensions: ['r1', 'c1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 1,
    });

    fetchMock.mockImplementation(() => new Promise(() => undefined));

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
    const rowStrip = screen.getByTestId('pivot-v3-row-chip-strip');
    expect(within(rowStrip).queryByText('Value')).not.toBeInTheDocument();

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

    fireEvent.dragStart(valueChip, { dataTransfer, clientX: 10, clientY: 10 });
    fireEvent.dragEnter(rowStrip, {
      dataTransfer,
      clientX: 180,
      clientY: 9999,
    });
    fireEvent.dragOver(rowStrip, { dataTransfer, clientX: 180, clientY: 9999 });
    fireEvent.drop(rowStrip, { dataTransfer, clientX: 180, clientY: 9999 });
    fireEvent.dragEnd(valueChip, { dataTransfer, clientX: 180, clientY: 9999 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(rowStrip).getByText('Value')).toBeInTheDocument();

    const c1Row = screen
      .getAllByText('c1')
      .map(node => {
        let current: HTMLElement | null = node as HTMLElement;
        while (current) {
          if (within(current).queryByLabelText('Toggle column dimension')) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      })
      .find((node): node is HTMLElement => node !== null);
    if (!c1Row) {
      throw new Error('Missing dimension row for c1');
    }

    fireEvent.click(within(c1Row).getByLabelText('Toggle column dimension'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const nextFetch = fetchMock.mock.calls.at(-1)?.[0];
    expect(nextFetch?.formData?.metricsLayout).toBe(MetricsLayoutEnum.ROWS);
    expect(
      (nextFetch?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual(['r1', METRICS_PLACEHOLDER]);
    expect(
      (nextFetch?.formData?.groupbyColumns ?? []).map(getStableColumnKey),
    ).toEqual(['c1']);
  });

  it('keeps rows populated when moving the last row dimension to columns with Values on rows', async () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['r1'];
    const records = [
      { r1: 'A', c1: 'X', m1: 10, m2: 20 },
      { r1: 'B', c1: 'X', m1: 12, m2: 24 },
      { r1: 'A', c1: 'Y', m1: 14, m2: 28 },
    ];
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
      dimensions: ['r1', 'c1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
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
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

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
    const rowStrip = screen.getByTestId('pivot-v3-row-chip-strip');

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

    fireEvent.dragStart(valueChip, { dataTransfer, clientX: 10, clientY: 10 });
    fireEvent.dragEnter(rowStrip, {
      dataTransfer,
      clientX: 180,
      clientY: 9999,
    });
    fireEvent.dragOver(rowStrip, { dataTransfer, clientX: 180, clientY: 9999 });
    fireEvent.drop(rowStrip, { dataTransfer, clientX: 180, clientY: 9999 });
    fireEvent.dragEnd(valueChip, { dataTransfer, clientX: 180, clientY: 9999 });

    expect(fetchMock).not.toHaveBeenCalled();

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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const afterC1Add = fetchMock.mock.calls.at(-1)?.[0];
    expect(afterC1Add?.formData?.metricsLayout).toBe(MetricsLayoutEnum.ROWS);
    expect(
      (afterC1Add?.formData?.groupbyColumns ?? []).map(getStableColumnKey),
    ).toEqual(['c1']);
    expect(
      (afterC1Add?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual(['r1', METRICS_PLACEHOLDER]);

    const rowChip = screen
      .getAllByLabelText('Remove dimension')
      .map(button => button.parentElement)
      .filter((node): node is HTMLElement => Boolean(node))
      .find(node => node.textContent?.includes('r1'));
    if (!rowChip) {
      throw new Error('Missing row chip for r1');
    }
    const colStrip = screen.getByTestId('pivot-v3-col-chip-strip');

    fireEvent.dragStart(rowChip, { dataTransfer, clientX: 10, clientY: 10 });
    fireEvent.dragEnter(colStrip, {
      dataTransfer,
      clientX: 9999,
      clientY: 10,
    });
    fireEvent.dragOver(colStrip, { dataTransfer, clientX: 9999, clientY: 10 });
    fireEvent.drop(colStrip, { dataTransfer, clientX: 9999, clientY: 10 });
    fireEvent.dragEnd(rowChip, { dataTransfer, clientX: 9999, clientY: 10 });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const afterRowMoveToCols = fetchMock.mock.calls.at(-1)?.[0];
    expect(afterRowMoveToCols?.formData?.metricsLayout).toBe(
      MetricsLayoutEnum.ROWS,
    );
    expect(
      (afterRowMoveToCols?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual([METRICS_PLACEHOLDER]);
    expect(
      (afterRowMoveToCols?.formData?.groupbyColumns ?? []).map(
        getStableColumnKey,
      ),
    ).toEqual(['c1', 'r1']);

    await waitFor(() => {
      const tbody = container.querySelector('tbody') as HTMLElement;
      expect(within(tbody).getByText('m1')).toBeInTheDocument();
      expect(within(tbody).getByText('m2')).toBeInTheDocument();
      expect(within(tbody).queryByText('A')).not.toBeInTheDocument();
      expect(within(tbody).queryByText('B')).not.toBeInTheDocument();
    });
  });

  it('keeps local Value chip placement after a parent rerender while seamless fetch is pending', async () => {
    const metrics = ['measure1', 'measure2'];
    const rowGroupby = ['row1'];
    const colGroupby = ['col1'];
    const records = [{ row1: 'R1', col1: 'C1', measure1: 10, measure2: 20 }];
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
      startCollapsed: false,
      initialDepth: 2,
    });

    let resolveSeamlessFetch: (() => void) | undefined;
    const seamlessFetchPromise = new Promise<void>(resolve => {
      resolveSeamlessFetch = resolve;
    });
    fetchMock.mockImplementation(
      async ({
        specs,
        requestGroupId,
      }: {
        specs: Array<unknown>;
        requestGroupId?: string;
      }) => {
        if (requestGroupId === 'pivot-v3-seamless') {
          await seamlessFetchPromise;
        }
        return specs.map(() => ({ data: records }));
      },
    );

    const { rerender } = render(
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
    const row1Chip = screen
      .getAllByLabelText('Remove dimension')
      .map(button => button.parentElement)
      .filter((node): node is HTMLElement => Boolean(node))
      .find(node => node.textContent?.includes('row1'));
    if (!row1Chip) {
      throw new Error('Missing row chip for row1');
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

    const parentSyncedLayout: PivotRuntimeLayout = {
      ...runtimeLayout,
      valuePlacement: { axis: 'row', index: 0 },
    };
    const parentSyncedFormData = {
      ...formData,
      pivotRuntimeLayout: parentSyncedLayout,
    };
    rerender(
      <PivotTableChart
        data={baseTree}
        formData={parentSyncedFormData}
        rawFormData={parentSyncedFormData}
        queryFormData={parentSyncedFormData}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        width={600}
        height={300}
      />,
    );

    const colStrip = screen.getByTestId('pivot-v3-col-chip-strip');
    const rowStrip = screen.getByTestId('pivot-v3-row-chip-strip');
    expect(within(rowStrip).queryByText('Value')).toBeInTheDocument();
    expect(within(colStrip).queryByText('Value')).not.toBeInTheDocument();

    if (!resolveSeamlessFetch) {
      throw new Error('Missing seamless fetch resolver');
    }
    resolveSeamlessFetch();

    await waitFor(() =>
      expect(within(rowStrip).queryByText('Value')).toBeInTheDocument(),
    );
    expect(within(colStrip).queryByText('Value')).not.toBeInTheDocument();
  });

  it('keeps the committed table visible during seamless hydration', async () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['r1', 'r2'];
    const colGroupby = ['c1'];
    const records = [
      { r1: 'A', r2: 'a1', c1: 'X', m1: 10, m2: 20 },
      { r1: 'A', r2: 'a2', c1: 'Y', m1: 12, m2: 24 },
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
      startCollapsed: false,
      initialDepth: 2,
    });

    let resolveFetch: (() => void) | undefined;
    const fetchPromise = new Promise<void>(resolve => {
      resolveFetch = resolve;
    });
    fetchMock.mockImplementation(
      async ({ specs }: { specs: Array<unknown> }) => {
        await fetchPromise;
        return specs.map(spec => {
          const { columns } = spec as {
            columns?: Array<string | QueryFormColumn>;
          };
          if (hasColumnKey(columns, 'r2')) {
            return { data: [] };
          }
          return { data: [{ r1: 'A', c1: 'X', m1: 10, m2: 20 }] };
        });
      },
    );

    let resolveBranch:
      | ((
          value: {
            data: PivotTreeData | undefined;
            factBatches?: PivotFactStoreBatch[];
          },
        ) => void)
      | undefined;
    const branchPromise = new Promise<{
      data: PivotTreeData | undefined;
      factBatches?: PivotFactStoreBatch[];
    }>(resolve => {
        resolveBranch = resolve;
      });
    fetchPivotBranchMock.mockImplementation(
      async (params: FetchPivotExpansionRequest) => {
        if (
          params.targets.some(target => target.axis === 'row') &&
          getMockExpansionRequestAxis(params) === 'row'
        ) {
          await branchPromise;
          return buildMockExpansionFetchResult(params);
        }
        return buildMockExpansionFetchResult(params);
      },
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

    await waitFor(() => expect(screen.getByText('a1')).toBeInTheDocument());

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
    const rowChip = screen
      .getAllByLabelText('Remove dimension')
      .map(button => button.parentElement)
      .filter((node): node is HTMLElement => Boolean(node))
      .find(node => node.textContent?.includes('r1'));
    if (!rowChip) {
      throw new Error('Missing row chip for r1');
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
    fireEvent.dragEnter(rowChip, { dataTransfer });
    fireEvent.dragOver(rowChip, { dataTransfer });
    fireEvent.drop(rowChip, { dataTransfer });
    fireEvent.dragEnd(valueChip, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const tbody = container.querySelector('tbody') as HTMLElement;
    expect(within(tbody).getByText('a1')).toBeInTheDocument();
    expect(within(tbody).getByText('a2')).toBeInTheDocument();

    resolveFetch?.();
    if (resolveBranch) {
      resolveBranch({ data: undefined, factBatches: [] });
    }
  });

  it('keeps expanded row descendants visible after moving Values to rows at axis end', async () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['r1', 'r2'];
    const colGroupby = ['c1'];
    const records = [
      { r1: 'A', r2: 'a1', c1: 'X', m1: 10, m2: 20 },
      { r1: 'A', r2: 'a2', c1: 'X', m1: 12, m2: 24 },
      { r1: 'B', r2: 'b1', c1: 'X', m1: 14, m2: 28 },
      { r1: 'B', r2: 'b2', c1: 'X', m1: 16, m2: 32 },
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
      initialDepth: 2,
    });

    fetchMock.mockImplementation(async ({ specs }: { specs: Array<unknown> }) =>
      specs.map(() => ({ data: records })),
    );

    const rowsValueTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rowGroupby, colGroupby, 3, 1),
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      2,
    );
    fetchPivotBranchMock.mockImplementation(
      resolveExpansionData(rowsValueTree),
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

    await waitFor(() => expect(screen.getByText('a1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('a2')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('b1')).toBeInTheDocument());
    const rowB = screen.getByText('B').closest('tr') as HTMLElement | null;
    if (!rowB) {
      throw new Error('Missing row for B');
    }
    const collapseB = within(rowB).queryByLabelText('minus-square');
    if (collapseB) {
      fireEvent.click(collapseB);
    }
    await waitFor(() =>
      expect(screen.queryByText('b1')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByText('b2')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText('a1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('a2')).toBeInTheDocument());
    const rowA = screen.getByText('A').closest('tr') as HTMLElement | null;
    if (!rowA) {
      throw new Error('Missing row for A');
    }
    const collapseA = within(rowA).queryByLabelText('minus-square');
    if (collapseA) {
      fireEvent.click(collapseA);
    }
    await waitFor(() =>
      expect(screen.queryByText('a1')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByText('a2')).not.toBeInTheDocument(),
    );
    const rowAAfterCollapse = screen
      .getByText('A')
      .closest('tr') as HTMLElement;
    const expandA = within(rowAAfterCollapse).getByLabelText('plus-square');
    fireEvent.click(expandA);
    await waitFor(() => expect(screen.getByText('a1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('a2')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByText('b1')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByText('b2')).not.toBeInTheDocument(),
    );
    const branchCallsBeforeMove = fetchPivotBranchMock.mock.calls.length;

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
    const row2Chip = screen
      .getAllByLabelText('Remove dimension')
      .map(button => button.parentElement)
      .filter((node): node is HTMLElement => Boolean(node))
      .find(node => node.textContent?.includes('r2'));
    if (!row2Chip) {
      throw new Error('Missing row chip for r2');
    }
    const rowStrip = row2Chip.parentElement as HTMLElement | null;
    if (!rowStrip) {
      throw new Error('Missing row strip element');
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

    fireEvent.dragStart(valueChip, { dataTransfer, clientX: 10, clientY: 10 });
    fireEvent.dragEnter(rowStrip, {
      dataTransfer,
      clientX: 220,
      clientY: 9999,
    });
    fireEvent.dragOver(rowStrip, { dataTransfer, clientX: 220, clientY: 9999 });
    fireEvent.drop(rowStrip, { dataTransfer, clientX: 220, clientY: 9999 });
    fireEvent.dragEnd(valueChip, { dataTransfer, clientX: 220, clientY: 9999 });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const lastFetch = fetchMock.mock.calls.at(-1)?.[0];
    expect(lastFetch?.formData?.metricsLayout).toBe(MetricsLayoutEnum.ROWS);
    expect(
      (lastFetch?.formData?.groupbyRows ?? []).map(getStableColumnKey),
    ).toEqual(['r1', 'r2', METRICS_PLACEHOLDER]);
    expect(lastFetch?.formData?.pivotExpansionState).toBeUndefined();
    const plannedSpecs = lastFetch?.specs ?? [];
    const plannedSummary = plannedSpecs.map(
      (spec: PlannedQuerySpec) => {
        const scope = spec.meta?.factSelector?.scope;
        const path = scope?.kind === 'axisPaths' ? (scope.paths[0] ?? []) : [];
        const axis = scope && 'axis' in scope ? scope.axis : 'none';
        return `${scope?.kind ?? 'unknown'}:${axis}:${serializePath(
          path,
        )}:${spec.meta?.factSelector?.coverage?.rowDepth ?? 0}:${
          spec.meta?.factSelector?.coverage?.columnDepth ?? 0
        }`;
      },
    );
    expect(plannedSummary).not.toContain('branch:row:A:2:1');
    expect(plannedSummary).toEqual(
      expect.arrayContaining(['root:none::1:0', 'root:none::0:1']),
    );

    const tbody = container.querySelector('tbody') as HTMLElement;
    await waitFor(() =>
      expect(within(tbody).getByText('a1')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(tbody).getByText('a2')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(tbody).queryByText('b1')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(tbody).queryByText('b2')).not.toBeInTheDocument(),
    );

    expect(fetchPivotBranchMock).toHaveBeenCalledTimes(branchCallsBeforeMove);
  });

  it('locally moves Values to the front on a populated column axis', async () => {
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

    const colStrip = screen.getByTestId('pivot-v3-col-chip-strip');
    await waitFor(() => {
      expect(within(colStrip).getByText('c1')).toBeInTheDocument();
      expect(within(colStrip).getByText('Value')).toBeInTheDocument();
      expect((colStrip.textContent ?? '').indexOf('c1')).toBeLessThan(
        (colStrip.textContent ?? '').indexOf('Value'),
      );
    });

    const getColChips = () =>
      within(colStrip)
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

    const valueLabel = within(colStrip).getByText('Value');
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

    await waitFor(() => {
      expect((colStrip.textContent ?? '').indexOf('Value')).toBeLessThan(
        (colStrip.textContent ?? '').indexOf('c1'),
      );
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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
        (spec: {
          meta?: { factSelector?: { coverage?: { columnDepth?: number } } };
        }) => (spec.meta?.factSelector?.coverage?.columnDepth ?? 0) >= 1,
      ),
    ).toBe(true);
    expect(
      plannedSpecs.some(
        (spec: {
          meta?: {
            factSelector?: { coverage?: { columnDimensions?: string[] } };
          };
        }) =>
          (spec.meta?.factSelector?.coverage?.columnDimensions ?? []).includes(
            'c1',
          ),
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
      (params: FetchPivotExpansionRequest) =>
        Promise.resolve(
          buildMockExpansionFetchResult(
            params,
            params.formData.groupbyRows?.includes('row2')
              ? updatedExpandedTree
              : expandedTree,
          ),
        ),
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
      const headers = within(thead)
        .getAllByText('measure1')
        .map(node => node.closest('th') as HTMLElement)
        .filter(Boolean);
      return (
        headers.find(
          header =>
            within(header).queryByLabelText('minus-square') ||
            within(header).queryByLabelText('plus-square'),
        ) ?? headers[0]
      );
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
    const expansionCallsBeforeRowAppend =
      fetchPivotBranchMock.mock.calls.length;
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
    expect(fetchPivotBranchMock.mock.calls).toHaveLength(
      expansionCallsBeforeRowAppend,
    );
    expect(
      fetchPivotBranchMock.mock.calls.some(call =>
        call[0]?.formData?.groupbyRows?.includes('row2'),
      ),
    ).toBe(false);
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
    await waitFor(() => {
      const headerLabels = Array.from(
        container.querySelectorAll('thead th'),
      ).map(th => th.textContent ?? '');
      expect(headerLabels).toEqual(expect.arrayContaining(['m2']));
    });
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
        rows: [['A']],
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
    expect(lastFetch?.formData?.pivotExpansionState).toBeDefined();
    await waitFor(() =>
      expect(screen.getAllByText('m2').length).toBeGreaterThan(0),
    );
  });
});
