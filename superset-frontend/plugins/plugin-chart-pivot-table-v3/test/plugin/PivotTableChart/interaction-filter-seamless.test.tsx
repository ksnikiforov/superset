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
import { applyMetricAxis, buildTreeFromRecords } from '../../../src/utils';
import { supersetChartDataClient } from '../../../src/pivot/data/SupersetChartDataClient';
import { fetchPivotBranch } from '../../../src/fetchPivotBranch';

jest.mock('../../../src/pivot/chart/PivotInteractionPanel', () => ({
  PivotInteractionPanel: ({
    onFilterChange,
    onClearFilters,
  }: {
    onFilterChange?: (dimension: string, values: string[]) => void;
    onClearFilters?: () => void;
  }) => (
    <>
      <button type="button" onClick={() => onFilterChange?.('row1', ['A'])}>
        Apply row1 filter
      </button>
      <button type="button" onClick={() => onClearFilters?.()}>
        Clear chart filters
      </button>
    </>
  ),
}));

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

describe('PivotTableChart interaction filter seamless updates', () => {
  const fetchMock = supersetChartDataClient.fetch as jest.Mock;
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockResolvedValue({ data: undefined });
  });

  it('does not restore stale persisted filter after clear-all acknowledgement', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const records = [
      { row1: 'A', m1: 10 },
      { row1: 'B', m1: 20 },
    ];
    const filteredRecords = [{ row1: 'A', m1: 10 }];
    const setControlValue = jest.fn();
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
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
      startCollapsed: false,
      initialDepth: 1,
    });
    const tree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );
    const filteredTree = applyMetricAxis(
      buildTreeFromRecords(filteredRecords, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );

    type FetchArgs = {
      requestGroupId?: string;
      specs: Array<unknown>;
      formData?: {
        extra_form_data?: {
          filters?: Array<{ col?: string; op?: string; val?: unknown }>;
        };
      };
    };

    fetchMock.mockImplementation(
      async ({
        requestGroupId,
        specs,
        formData: requestFormData,
      }: FetchArgs) => {
        if (requestGroupId !== 'pivot-v3-seamless') {
          return specs.map(() => ({ data: records }));
        }
        const selectionFilters =
          requestFormData?.extra_form_data?.filters ?? [];
        const hasRow1Filter = selectionFilters.some(
          filter => filter.col === 'row1' && filter.op === 'IN',
        );
        return specs.map(() => ({
          data: hasRow1Filter ? filteredRecords : records,
        }));
      },
    );

    const { container, rerender } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        setControlValue={setControlValue}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply row1 filter' }));

    await waitFor(() =>
      expect(setControlValue).toHaveBeenCalledWith('pivotSelectedFilters', {
        row1: ['A'],
      }),
    );

    const filteredFormData = {
      ...formData,
      pivotSelectedFilters: { row1: ['A'] },
    };
    rerender(
      <PivotTableChart
        data={filteredTree}
        formData={filteredFormData}
        rawFormData={filteredFormData}
        queryFormData={{ ...filteredFormData, time_range: 'Last week' }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        selectedFilters={{ row1: ['A'] }}
        setControlValue={setControlValue}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear chart filters' }),
    );

    await waitFor(() =>
      expect(setControlValue).toHaveBeenCalledWith('pivotSelectedFilters', {}),
    );

    const clearedFormData = { ...formData, pivotSelectedFilters: {} };
    rerender(
      <PivotTableChart
        data={tree}
        formData={clearedFormData}
        rawFormData={clearedFormData}
        queryFormData={{ ...clearedFormData, time_range: 'Last week' }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        selectedFilters={{}}
        setControlValue={setControlValue}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => {
      const rowLabels = within(container.querySelector('tbody') as HTMLElement)
        .getAllByRole('row')
        .map(row => (row.querySelector('th')?.textContent || '').trim());
      expect(rowLabels).toContain('A');
      expect(rowLabels).toContain('B');
    });

    // Stale dashboard rerender should not re-apply a cleared interaction filter.
    rerender(
      <PivotTableChart
        data={filteredTree}
        formData={filteredFormData}
        rawFormData={filteredFormData}
        queryFormData={{ ...filteredFormData, time_range: 'Last week' }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        selectedFilters={{ row1: ['A'] }}
        setControlValue={setControlValue}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => {
      const rowLabels = within(container.querySelector('tbody') as HTMLElement)
        .getAllByRole('row')
        .map(row => (row.querySelector('th')?.textContent || '').trim());
      expect(rowLabels).toContain('A');
      expect(rowLabels).toContain('B');
    });
  });

  it('refetches when dashboard extra_form_data changes in user controlled mode', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const allRecords = [
      { row1: 'A', m1: 10 },
      { row1: 'B', m1: 20 },
    ];
    const filteredRecords = [{ row1: 'A', m1: 10 }];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: rows,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 1,
    });
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(allRecords, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );

    type FetchArgs = {
      requestGroupId?: string;
      specs: Array<unknown>;
      formData?: {
        extra_form_data?: {
          filters?: Array<{ col?: string; op?: string; val?: unknown }>;
        };
      };
    };

    fetchMock.mockImplementation(
      async ({
        requestGroupId,
        specs,
        formData: requestFormData,
      }: FetchArgs) => {
        if (requestGroupId !== 'pivot-v3-seamless') {
          return specs.map(() => ({ data: allRecords }));
        }
        const dashboardFilters =
          requestFormData?.extra_form_data?.filters ?? [];
        const hasDashboardFilter = dashboardFilters.some(
          filter =>
            filter.col === 'row1' &&
            filter.op === 'IN' &&
            Array.isArray(filter.val) &&
            filter.val.includes('A'),
        );
        return specs.map(() => ({
          data: hasDashboardFilter ? filteredRecords : allRecords,
        }));
      },
    );

    const { container, rerender } = render(
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

    fetchMock.mockClear();

    const dashboardFilteredFormData = {
      ...formData,
      extra_form_data: {
        filters: [{ col: 'row1', op: 'IN', val: ['A'] }],
      },
    };

    rerender(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={dashboardFilteredFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestGroupId: 'pivot-v3-seamless',
        formData: expect.objectContaining({
          extra_form_data: expect.objectContaining({
            filters: expect.arrayContaining([
              expect.objectContaining({
                col: 'row1',
                op: 'IN',
                val: ['A'],
              }),
            ]),
          }),
        }),
      }),
    );

    await waitFor(() => {
      const rowLabels = within(container.querySelector('tbody') as HTMLElement)
        .getAllByRole('row')
        .map(row => (row.querySelector('th')?.textContent || '').trim());
      expect(rowLabels).toEqual(['A']);
    });
  });

  it('restores persisted interaction-filter data and keeps it across width rerenders', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const allRecords = [
      { row1: 'A', m1: 10 },
      { row1: 'B', m1: 20 },
    ];
    const filteredRecords = [{ row1: 'A', m1: 10 }];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: rows,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      pivotSelectedFilters: { row1: ['A'] },
      startCollapsed: false,
      initialDepth: 1,
    });
    const tree = applyMetricAxis(
      buildTreeFromRecords(allRecords, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );

    fetchMock.mockImplementation(
      async ({
        requestGroupId,
        specs,
      }: {
        requestGroupId?: string;
        specs: [];
      }) =>
        requestGroupId === 'pivot-v3-seamless'
          ? specs.map(() => ({ data: filteredRecords }))
          : specs.map(() => ({ data: allRecords })),
    );

    const { container, rerender } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        selectedFilters={{}}
        width={600}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestGroupId: 'pivot-v3-seamless',
        }),
      ),
    );

    await waitFor(() => {
      const rowLabels = within(container.querySelector('tbody') as HTMLElement)
        .getAllByRole('row')
        .map(row => (row.querySelector('th')?.textContent || '').trim());
      expect(rowLabels).toContain('A');
      expect(rowLabels).not.toContain('B');
    });

    rerender(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        selectedFilters={{}}
        width={480}
        height={300}
      />,
    );

    await waitFor(() => {
      const rowLabels = within(container.querySelector('tbody') as HTMLElement)
        .getAllByRole('row')
        .map(row => (row.querySelector('th')?.textContent || '').trim());
      expect(rowLabels).toContain('A');
      expect(rowLabels).not.toContain('B');
    });
  });
});
