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
import { getStableColumnKey } from '../../../src/utils';
import { METRICS_PLACEHOLDER } from '../../../src/pivot/core/tokens';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { supersetChartDataClient } from '../../../src/pivot/data/SupersetChartDataClient';
import { fetchPivotBranch } from '../../../src/pivot/query/fetchPivotBranch';
import { applyMetricAxis } from '../fixtures/metricAxis';
import { getPivotV3ExportSheetDataForChart } from '../../../src/export/buildPivotV3ExportTable';

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

jest.mock('../../../src/pivot/query/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/pivot/query/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

describe('PivotTableChart basic regression smoke guardrails', () => {
  const fetchMock = supersetChartDataClient.fetch as jest.Mock;
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockResolvedValue({
      data: undefined,
      factBatches: [],
    });
  });

  it('renders totals when rowTotals and colTotals are enabled', async () => {
    const metrics = ['m1'];
    const rows = ['r1'];
    const cols = ['c1'];
    const records = [
      { r1: 'A', c1: 'X', m1: 10 },
      { r1: 'B', c1: 'Y', m1: 20 },
    ];
    const tree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rows, cols, 1, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      cols,
    );
    const formData = buildFormData({
      groupbyRows: rows,
      groupbyColumns: cols,
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: true,
      colTotals: true,
      rowSubTotals: false,
      startCollapsed: false,
      initialDepth: 2,
    });

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={rows}
        groupbyColumns={cols}
        rowTotals
        colTotals
        rowSubTotals={false}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => {
      const bodyRows = within(
        container.querySelector('tbody') as HTMLElement,
      ).getAllByRole('row');
      const rowLabels = bodyRows.map(row =>
        (row.querySelector('th')?.textContent || '').trim(),
      );
      expect(rowLabels).toContain('Grand total');
    });

    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(Boolean);
    expect(headerLabels).toContain('Grand total');
    expect(
      document.querySelectorAll('th.subtotal-cell').length,
    ).toBeGreaterThan(0);
  });

  it('expands a collapsed row and shows the next hierarchy level', async () => {
    const metrics = ['m1'];
    const rows = ['r1', 'r2'];
    const records = [
      { r1: 'A', r2: 'X', m1: 10 },
      { r1: 'A', r2: 'Y', m1: 12 },
    ];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
    );
    const expandedTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rows, [], 2, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
    );
    fetchPivotBranchMock.mockResolvedValue({
      data: expandedTree,
      factBatches: [],
    });

    const formData = buildFormData({
      groupbyRows: rows,
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      startCollapsed: true,
      initialDepth: 1,
      slice_id: 318,
    });

    render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={rows}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    const rowA = screen.getByText('A').closest('tr') as HTMLElement;
    await waitFor(() =>
      expect(within(rowA).queryByLabelText('loading')).not.toBeInTheDocument(),
    );

    const plusToggle = within(rowA).queryByLabelText('plus-square');
    let expandToggle = plusToggle;
    if (!expandToggle) {
      const minusToggle = within(rowA).getByLabelText('minus-square');
      fireEvent.click(minusToggle);
      expandToggle = await waitFor(() =>
        within(rowA).getByLabelText('plus-square'),
      );
    }
    fireEvent.click(expandToggle);

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    expect(screen.getByRole('table')).toBeInTheDocument();
    const chartExportRows = getPivotV3ExportSheetDataForChart(318)?.map(row =>
      row.map(cell => cell.value),
    );
    expect(chartExportRows?.some(row => row[0] === 'A' && row[1] === '')).toBe(
      true,
    );
    expect(chartExportRows?.some(row => row[0] === 'A' && row[1] === 'X')).toBe(
      true,
    );
  });

  it('keeps visible column headers after adding first column dimension in Values-only layout', async () => {
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

    fireEvent.click(
      within(findDimensionRow('c1')).getByLabelText('Toggle column dimension'),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const fetchCall = fetchMock.mock.calls.at(-1)?.[0];
    expect(
      (fetchCall?.formData?.groupbyColumns ?? []).map(getStableColumnKey),
    ).toEqual(['c1', METRICS_PLACEHOLDER]);
    expect(
      (fetchCall?.specs ?? []).some(
        (spec: { meta?: { coverage?: { columnDepth?: number } } }) =>
          (spec.meta?.coverage?.columnDepth ?? 0) >= 1,
      ),
    ).toBe(true);

    await waitFor(() => {
      const thead = container.querySelector('thead') as HTMLElement;
      expect(within(thead).getByText('A')).toBeInTheDocument();
      expect(within(thead).getByText('B')).toBeInTheDocument();
    });
  });

  it('renders column grand total row in interaction mode when colTotals is enabled', async () => {
    const metrics = ['m1'];
    const rows = ['r1'];
    const records = [
      { r1: 'A', m1: 10 },
      { r1: 'B', m1: 20 },
    ];
    const tree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );
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
      dimensions: [...rows],
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

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        colTotals
        rowTotals={false}
        width={600}
        height={300}
      />,
    );

    await waitFor(() => {
      const bodyRows = within(
        container.querySelector('tbody') as HTMLElement,
      ).getAllByRole('row');
      const rowLabels = bodyRows.map(row =>
        (row.querySelector('th')?.textContent || '').trim(),
      );
      expect(rowLabels).toContain('Grand total');
    });
  });
});
