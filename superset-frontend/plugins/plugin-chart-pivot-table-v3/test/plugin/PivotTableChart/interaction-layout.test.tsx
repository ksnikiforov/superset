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
import { buildBranchTreeFromResults } from '../../../src/fetchPivotBranch';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import { resolveInteractionFormData } from '../../../src/pivot/layout/resolveInteractionLayout';
import { buildInitialQuerySpecs } from '../../../src/pivot/query/specs';
import {
  applyMeasureHierarchyAxis,
  applyMetricAxis,
  buildTreeFromRecords,
  mergeTrees,
} from '../../../src/utils';
import { MetricsLayoutEnum, PivotRuntimeLayout } from '../../../src/types';
import {
  applyMeasureLeafValuesToTree,
  buildBuiltInLeaf,
  buildCustomLeaf,
  buildMeasureLeafOutputKey,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';
import { supersetChartDataClient } from '../../../src/pivot/data/SupersetChartDataClient';

const buildInitialBootstrapTree = ({
  formData,
  runtimeLayout,
  resultsByDepth,
}: {
  formData: ReturnType<typeof buildFormData>;
  runtimeLayout: PivotRuntimeLayout;
  resultsByDepth: Record<string, Record<string, unknown>[]>;
}) => {
  const resolvedFormData = resolveInteractionFormData({
    formData,
    runtimeLayout,
  });
  const layout = buildLayoutContext(resolvedFormData);
  const specs = buildInitialQuerySpecs(resolvedFormData, layout);

  return specs.reduce(
    (tree, spec) =>
      mergeTrees(
        tree,
        buildBranchTreeFromResults({
          results: [
            {
              data:
                resultsByDepth[`${spec.meta.rowDepth}|${spec.meta.colDepth}`] ??
                [],
            },
          ],
          queryPairs: [
            { rowDepth: spec.meta.rowDepth, colDepth: spec.meta.colDepth },
          ],
          metricsForQuery: spec.metrics,
          formData: resolvedFormData,
          measureHierarchy: layout.measureHierarchy,
          materializedMetrics: spec.meta.materializedMetrics,
          materializedMeasureHierarchy: spec.meta.materializedMeasureHierarchy,
          rowGroupby: spec.meta.rowGroupbyForQueryFull,
          colGroupby: spec.meta.colGroupbyForQueryFull,
          rowSubtotalLevels: spec.meta.rowSubtotalLevels,
          colSubtotalLevels: spec.meta.colSubtotalLevels,
          metricsLayoutResolved: spec.meta.metricsLayoutResolved,
          metricInsertIndex: spec.meta.metricInsertIndex,
        }),
      ),
    { rows: {}, cols: {}, cells: {} },
  );
};

describe('PivotTableChart interaction layout', () => {
  it('persists runtime layout via setControlValue in user controlled mode', async () => {
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: [],
      metrics: ['m1', 'm2'],
      leafSelection: {},
      valuePlacement: { axis: 'row', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['row1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['m1', 'm2'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      pivotRuntimeLayout: runtimeLayout,
    });
    const baseTree = buildTreeFromRecords(
      [{ row1: 'A', m1: 10, m2: 20 }],
      ['m1', 'm2'],
      ['row1'],
      [],
      1,
      0,
    );
    const tree = applyMetricAxis(
      baseTree,
      ['m1', 'm2'],
      MetricsLayoutEnum.ROWS,
      ['row1'],
      [],
      1,
    );
    const setControlValue = jest.fn();
    const setDataMask = jest.fn();
    render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        metrics={['m1', 'm2']}
        groupbyRows={[]}
        groupbyColumns={[]}
        setControlValue={setControlValue}
        setDataMask={setDataMask}
      />,
    );

    const initialCalls = setControlValue.mock.calls.length;

    fireEvent.click(screen.getByText('Select measures'));
    fireEvent.click(screen.getByLabelText('Toggle measure m1'));
    fireEvent.click(screen.getByLabelText('Toggle measure m1'));
    fireEvent.click(screen.getByText('Select measures'));
    await waitFor(() =>
      expect(setControlValue.mock.calls.length).toBeGreaterThan(initialCalls),
    );
    const runtimeLayoutCalls = setControlValue.mock.calls.filter(
      call => call[0] === 'pivotRuntimeLayout',
    );
    const lastRuntimeLayoutCall = runtimeLayoutCalls.slice(-1)[0];
    expect(lastRuntimeLayoutCall).toBeDefined();
    expect((lastRuntimeLayoutCall[1] as PivotRuntimeLayout).metrics).toEqual([
      'm2',
      'm1',
    ]);
    expect(setDataMask).toHaveBeenCalled();
    const setDataMaskCalls = setDataMask.mock.calls.map(call => call[0]);
    const ownStatePayload = setDataMaskCalls.find(
      payload => payload?.ownState?.pivotRuntimeLayout,
    );
    expect(ownStatePayload).toBeDefined();
    expect(ownStatePayload.ownState.pivotRuntimeLayout.metrics).toEqual([
      'm2',
      'm1',
    ]);
  });

  it('persists runtime layout and panel filters via setControlValue in dashboard mode', async () => {
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: [],
      metrics: ['m1', 'm2'],
      leafSelection: {},
      valuePlacement: { axis: 'row', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['row1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['m1', 'm2'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      pivotRuntimeLayout: runtimeLayout,
      dashboardId: 1,
    });
    const baseTree = buildTreeFromRecords(
      [{ row1: 'A', m1: 10, m2: 20 }],
      ['m1', 'm2'],
      ['row1'],
      [],
      1,
      0,
    );
    const tree = applyMetricAxis(
      baseTree,
      ['m1', 'm2'],
      MetricsLayoutEnum.ROWS,
      ['row1'],
      [],
      1,
    );
    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    const { rerender } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        metrics={['m1', 'm2']}
        groupbyRows={[]}
        groupbyColumns={[]}
        selectedFilters={{ row1: ['A'] }}
        setControlValue={setControlValue}
        setDataMask={setDataMask}
      />,
    );

    fireEvent.click(screen.getByText('Select measures'));
    fireEvent.click(screen.getByLabelText('Toggle measure m1'));
    fireEvent.click(screen.getByLabelText('Toggle measure m1'));
    fireEvent.click(screen.getByText('Select measures'));

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    const runtimeLayoutCalls = setControlValue.mock.calls.filter(
      call => call[0] === 'pivotRuntimeLayout',
    );
    const selectedFiltersCalls = setControlValue.mock.calls.filter(
      call => call[0] === 'pivotSelectedFilters',
    );
    const persistedRuntimeLayout = runtimeLayoutCalls.slice(-1)[0]?.[1] as
      | PivotRuntimeLayout
      | undefined;
    const persistedSelectedFilters = selectedFiltersCalls.slice(-1)[0]?.[1] as
      | Record<string, string[]>
      | undefined;
    expect(persistedRuntimeLayout).toBeDefined();
    expect(persistedRuntimeLayout?.metrics).toEqual(['m2', 'm1']);
    expect(persistedSelectedFilters).toEqual({
      row1: ['A'],
    });
    expect(setDataMask).not.toHaveBeenCalled();

    const refreshedFormData = {
      ...formData,
      pivotRuntimeLayout: persistedRuntimeLayout,
      pivotSelectedFilters: persistedSelectedFilters,
    };

    rerender(
      <PivotTableChart
        data={tree}
        formData={refreshedFormData}
        rawFormData={refreshedFormData}
        queryFormData={{ ...refreshedFormData, time_range: 'Last week' }}
        metrics={['m1', 'm2']}
        groupbyRows={[]}
        groupbyColumns={[]}
        selectedFilters={{}}
        setControlValue={setControlValue}
        setDataMask={setDataMask}
      />,
    );

    expect(screen.getByLabelText('Clear filters')).toBeEnabled();
  });

  it('keeps the applied header order until query form data updates', () => {
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: ['col1'],
      metrics: ['m1', 'm2'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['col1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['m1', 'm2'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
    });
    const baseTree = buildTreeFromRecords(
      [{ col1: 'A', m1: 10, m2: 20 }],
      ['m1', 'm2'],
      [],
      ['col1'],
      0,
      1,
    );
    const tree = applyMetricAxis(
      baseTree,
      ['m1', 'm2'],
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1'],
      1,
    );
    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={['m1', 'm2']}
        groupbyRows={[]}
        groupbyColumns={[]}
      />,
    );

    const headerLabels = () =>
      Array.from(container.querySelectorAll('thead th'))
        .map(th => th.textContent ?? '')
        .filter(label => label.length > 0);

    const labelsBefore = headerLabels();
    expect(labelsBefore.indexOf('m1')).toBeLessThan(labelsBefore.indexOf('m2'));

    fireEvent.click(screen.getByText('Select measures'));
    fireEvent.click(screen.getByLabelText('Toggle measure m1'));
    fireEvent.click(screen.getByLabelText('Toggle measure m1'));
    fireEvent.click(screen.getByText('Select measures'));

    const labelsAfter = headerLabels();
    expect(labelsAfter.indexOf('m1')).toBeLessThan(labelsAfter.indexOf('m2'));
  });

  it('renders the applied layout when query form data is provided', () => {
    const appliedRuntimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: ['col1'],
      metrics: ['m1', 'm2'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const uiRuntimeLayout: PivotRuntimeLayout = {
      ...appliedRuntimeLayout,
      valuePlacement: { axis: 'col', index: 0 },
    };
    const appliedFormData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['col1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['m1', 'm2'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: appliedRuntimeLayout,
    });
    const uiFormData = {
      ...appliedFormData,
      pivotRuntimeLayout: uiRuntimeLayout,
    };
    const baseTree = buildTreeFromRecords(
      [{ col1: 'A', m1: 10, m2: 20 }],
      ['m1', 'm2'],
      [],
      ['col1'],
      0,
      1,
    );
    const tree = applyMetricAxis(
      baseTree,
      ['m1', 'm2'],
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={uiFormData}
        rawFormData={uiFormData}
        queryFormData={appliedFormData}
        metrics={['m1', 'm2']}
        groupbyRows={[]}
        groupbyColumns={[]}
      />,
    );

    const headerLabels = Array.from(container.querySelectorAll('thead th'))
      .map(th => th.textContent ?? '')
      .filter(label => label.length > 0);
    expect(headerLabels.indexOf('A')).toBeLessThan(headerLabels.indexOf('m1'));
  });

  it('suppresses the grand total column when columns only contain Values in user-controlled mode', () => {
    const metrics = ['m1'];
    const rowGroupby = ['row1'];
    const baseTree = buildTreeFromRecords(
      [{ row1: 'A', m1: 10 }],
      metrics,
      rowGroupby,
      [],
      1,
      0,
    );
    const tree = applyMetricAxis(
      baseTree,
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
      dimensions: rowGroupby,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      rowTotals: true,
      colTotals: false,
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
      />,
    );

    const headerLabels = Array.from(container.querySelectorAll('thead th'))
      .map(th => th.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toContain('m1');
    expect(headerLabels).not.toContain('Grand total');
  });

  it('does not render expand toggles for Value leaf when metrics are last on columns in user-controlled mode', () => {
    const metricKey = 'grossRevenue';
    const secondaryMetric = 'netRevenue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        { metricKey, leaves: [valueLeaf, ixLeaf] },
        { metricKey: secondaryMetric, leaves: [valueLeaf, ixLeaf] },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const baseTree = buildTreeFromRecords(
      [
        {
          col1: 'C1',
          grossRevenue: 10,
          'grossRevenue__1 year ago': 8,
          netRevenue: 5,
          'netRevenue__1 year ago': 4,
        },
      ],
      [metricKey, secondaryMetric],
      [],
      ['col1'],
      0,
      1,
    );
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: baseTree,
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1'],
      1,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: ['col1'],
      metrics: [metricKey, secondaryMetric],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['col1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: [metricKey, secondaryMetric],
      metricsLayout: MetricsLayoutEnum.ROWS,
      measureLeavesByMetric: {
        [metricKey]: [valueLeaf, ixLeaf],
        [secondaryMetric]: [valueLeaf, ixLeaf],
      },
      pivotRuntimeLayout: runtimeLayout,
    });

    render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={[]}
        groupbyColumns={[]}
      />,
    );

    const tableHeader = document.querySelector('thead');
    if (!tableHeader) {
      throw new Error('Table header not found');
    }
    const valueHeaders = within(tableHeader)
      .getAllByText('Value')
      .map(node => node.closest('th'))
      .filter((node): node is HTMLTableCellElement => node !== null);
    if (valueHeaders.length === 0) {
      const headerLabels = Array.from(tableHeader.querySelectorAll('th')).map(
        node => node.textContent || '',
      );
      throw new Error(
        `Value header not found. Header labels: ${headerLabels.join(' | ')}`,
      );
    }
    valueHeaders.forEach(valueHeader => {
      expect(
        within(valueHeader).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(valueHeader).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();
    });
  });

  it('keeps top-level column headers limited to column dimensions in user-controlled mode', () => {
    const metrics = ['m1', 'm2'];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: metrics.map(metricKey => ({
        metricKey,
        leaves: [valueLeaf, ixLeaf],
      })),
      leafTierVisibility: 'visible' as const,
    };
    const baseTree = buildTreeFromRecords(
      [
        {
          row1: 'R1',
          col1: 'A',
          col2: 'X',
          m1: 10,
          'm1__1 year ago': 8,
          m2: 5,
          'm2__1 year ago': 4,
        },
      ],
      metrics,
      ['row1'],
      ['col1', 'col2'],
      1,
      2,
    );
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: baseTree,
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1', 'col2'],
      2,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: ['col1', 'col2'],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 2 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['row1', 'col1', 'col2'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      measureLeavesByMetric: {
        m1: [valueLeaf, ixLeaf],
        m2: [valueLeaf, ixLeaf],
      },
      pivotRuntimeLayout: runtimeLayout,
      colTotals: true,
      colTotalPosition: 'end',
      rowTotals: true,
      startCollapsed: true,
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
        colTotalPosition="end"
        rowTotals
        startCollapsed
        initialDepth={1}
      />,
    );

    const headerRow = container.querySelector(
      'thead tr',
    ) as HTMLTableRowElement | null;
    if (!headerRow) {
      throw new Error('Table header row not found');
    }
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0 && label !== 'Rows');
    const metricLabels = new Set(metrics);
    const plainMetricLabels = labels.filter(label => metricLabels.has(label));
    expect(labels).toEqual(expect.arrayContaining(['A']));
    expect(plainMetricLabels).toEqual([]);
    const grandTotalIndex = labels.indexOf('Grand total');
    const dimensionIndex = labels.indexOf('A');
    expect(grandTotalIndex === -1 || dimensionIndex < grandTotalIndex).toBe(
      true,
    );
  });

  it('keeps metric labels when datetime columns are formatted with Values at column end', () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['row2'];
    const colGroupby = ['orderDate'];
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [
          {
            row2: 'R1',
            orderDate: '1992-01-01T00:00:00.000Z',
            m1: 10,
            m2: 20,
          },
          {
            row2: 'R1',
            orderDate: '1993-01-01T00:00:00.000Z',
            m1: 15,
            m2: 30,
          },
        ],
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
    const orderDateFormatter = (value: number | Date) =>
      `Year ${new Date(value).getUTCFullYear()}`;
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [...rowGroupby, ...colGroupby],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
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
        dateFormatters={{ orderDate: orderDateFormatter }}
      />,
    );

    const headerRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    const topLabels = within(headerRows[0])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0 && label !== 'Rows');
    expect(topLabels).toEqual(
      expect.arrayContaining(['Year 1992', 'Year 1993']),
    );

    const metricLabels = within(headerRows[1])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0 && label !== 'Rows');
    expect(metricLabels).toEqual(['m1', 'm2', 'm1', 'm2']);
  });

  it('prefers ownState runtime layout over formData runtime layout in user-controlled mode', () => {
    const metricKey = 'm1';
    const dimensionKey = 'row1';
    const metrics = [metricKey];
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [{ row1: 'A', m1: 10 }],
        metrics,
        [dimensionKey],
        [],
        1,
        0,
      ),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [dimensionKey],
      [],
      0,
    );
    const ownRuntimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [dimensionKey],
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formRuntimeLayout: PivotRuntimeLayout = {
      ...ownRuntimeLayout,
      rows: [],
      cols: [dimensionKey],
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [dimensionKey],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: formRuntimeLayout,
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
        ownState={{ pivotRuntimeLayout: ownRuntimeLayout }}
      />,
    );

    const rowLabel = container.querySelector(
      'tbody [data-pivot-row-label="true"]',
    );
    expect(rowLabel?.textContent).toBe('A');
  });

  it('does not duplicate metric headers when leaf tier is visible with row totals', () => {
    const metrics = ['m1', 'm2', 'm3'];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        { metricKey: 'm1', leaves: [valueLeaf, ixLeaf] },
        { metricKey: 'm2', leaves: [valueLeaf, ixLeaf] },
        { metricKey: 'm3', leaves: [valueLeaf] },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const records = [
      {
        row1: 'R1',
        m1: 10,
        'm1__1 year ago': 8,
        m2: 5,
        'm2__1 year ago': 4,
        m3: 7,
      },
    ];
    const baseTree = buildTreeFromRecords(records, metrics, ['row1'], [], 1, 0);
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({ tree: baseTree, measureHierarchy }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      [],
      0,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['row1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      measureLeavesByMetric: {
        m1: [valueLeaf, ixLeaf],
        m2: [valueLeaf, ixLeaf],
        m3: [valueLeaf],
      },
      pivotRuntimeLayout: runtimeLayout,
      rowTotals: true,
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
        rowTotals
      />,
    );

    const headerRow = container.querySelector(
      'thead tr',
    ) as HTMLTableRowElement | null;
    if (!headerRow) {
      throw new Error('Table header row not found');
    }
    const headerCells = within(headerRow).getAllByRole(
      'columnheader',
    ) as HTMLTableCellElement[];
    const metricHeaderCells = headerCells.filter(cell =>
      metrics.includes(cell.textContent?.trim() ?? ''),
    );
    expect(metricHeaderCells).toHaveLength(metrics.length);
    const metricHeader = (metric: string) => {
      const matches = metricHeaderCells.filter(
        cell => cell.textContent?.trim() === metric,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Expected 1 header for ${metric}, found ${matches.length}`,
        );
      }
      return matches[0];
    };
    expect(metricHeader('m1').colSpan).toBe(2);
    expect(metricHeader('m2').colSpan).toBe(2);
    expect(metricHeader('m3').colSpan).toBe(1);
    metricHeaderCells.forEach(cell => {
      expect(cell.rowSpan).toBe(1);
    });
  });

  it('keeps metric columns visible in interaction mode with value-first layout and row totals', () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['name'];
    const detail = buildTreeFromRecords(
      [
        { name: 'A', m1: 10, m2: 20 },
        { name: 'B', m1: 12, m2: 24 },
      ],
      metrics,
      rowGroupby,
      [],
      1,
      0,
    );
    const totals = buildTreeFromRecords(
      [{ m1: 22, m2: 44 }],
      metrics,
      rowGroupby,
      [],
      0,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
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
      dimensions: [...rowGroupby],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      rowTotals: true,
      colTotals: false,
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
        rowTotals
        colTotals={false}
      />,
    );

    const headerLabels = Array.from(container.querySelectorAll('thead th'))
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0 && label !== 'Rows');
    expect(headerLabels).toEqual(expect.arrayContaining(metrics));
    expect(headerLabels).not.toContain('Grand total');

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Grand total');
  });

  it('renders column grand total row in interaction mode with multiple metrics', () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['name'];
    const detail = buildTreeFromRecords(
      [
        { name: 'A', m1: 10, m2: 20 },
        { name: 'B', m1: 12, m2: 24 },
      ],
      metrics,
      rowGroupby,
      [],
      1,
      0,
    );
    const totals = buildTreeFromRecords(
      [{ m1: 22, m2: 44 }],
      metrics,
      rowGroupby,
      [],
      0,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
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
      dimensions: [...rowGroupby],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      rowTotals: false,
      colTotals: true,
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
        rowTotals={false}
        colTotals
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toContain('Grand total');

    const grandTotalRow = screen
      .getByText('Grand total')
      .closest('tr') as HTMLTableRowElement;
    const values = within(grandTotalRow)
      .getAllByRole('cell')
      .map(cell => cell.textContent?.trim());
    expect(values).toEqual(['22', '44']);
  });

  it('keeps value-first interaction stable when totals are disabled', () => {
    const metrics = ['m1', 'm2'];
    const rowGroupby = ['name'];
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [
          { name: 'A', m1: 10, m2: 20 },
          { name: 'B', m1: 12, m2: 24 },
        ],
        metrics,
        rowGroupby,
        [],
        1,
        0,
      ),
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
      dimensions: [...rowGroupby],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      rowTotals: false,
      colTotals: false,
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
        rowTotals={false}
        colTotals={false}
      />,
    );

    const headerLabels = Array.from(container.querySelectorAll('thead th'))
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0 && label !== 'Rows');
    expect(headerLabels).toEqual(expect.arrayContaining(metrics));
    expect(headerLabels).not.toContain('Grand total');
  });

  it('does not interleave metric totals with column dimensions when row totals are present', () => {
    const metrics = ['m1', 'm2', 'm3'];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        { metricKey: 'm1', leaves: [valueLeaf, ixLeaf] },
        { metricKey: 'm2', leaves: [valueLeaf, ixLeaf] },
        { metricKey: 'm3', leaves: [valueLeaf] },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const rowGroupby = ['row1'];
    const colGroupby = ['col1', 'col2'];
    const records = [
      {
        row1: 'R1',
        col1: 'A',
        col2: 'X',
        m1: 10,
        'm1__1 year ago': 8,
        m2: 5,
        'm2__1 year ago': 4,
        m3: 7,
      },
      {
        row1: 'R1',
        col1: 'B',
        col2: 'X',
        m1: 12,
        'm1__1 year ago': 9,
        m2: 6,
        'm2__1 year ago': 5,
        m3: 8,
      },
    ];
    const totalsRecords = [
      {
        row1: 'R1',
        m1: 22,
        'm1__1 year ago': 17,
        m2: 11,
        'm2__1 year ago': 9,
        m3: 15,
      },
    ];
    const baseTree = buildTreeFromRecords(
      records,
      metrics,
      rowGroupby,
      colGroupby,
      1,
      2,
    );
    const totalsTree = buildTreeFromRecords(
      totalsRecords,
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const mergedTree = mergeTrees(baseTree, totalsTree);
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({ tree: mergedTree, measureHierarchy }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      2,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: rowGroupby,
      cols: colGroupby,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 2 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: [...rowGroupby, ...colGroupby],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      measureLeavesByMetric: {
        m1: [valueLeaf, ixLeaf],
        m2: [valueLeaf, ixLeaf],
        m3: [valueLeaf],
      },
      pivotRuntimeLayout: runtimeLayout,
      rowTotals: true,
      rowTotalPosition: 'end',
      colTotals: true,
      colTotalPosition: 'end',
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
        rowTotals
        rowTotalPosition="end"
        colTotals
        colTotalPosition="end"
      />,
    );

    const headerRow = container.querySelector(
      'thead tr',
    ) as HTMLTableRowElement | null;
    if (!headerRow) {
      throw new Error('Table header row not found');
    }
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0 && label !== 'Rows');
    const metricLabels = new Set(metrics);
    const plainMetricLabels = labels.filter(label => metricLabels.has(label));
    expect(labels).toEqual(expect.arrayContaining(['A', 'B']));
    expect(plainMetricLabels).toEqual([]);
    const totalLabels = metrics.map(metric => `Total ${metric}`);
    totalLabels.forEach(totalLabel => {
      expect(labels).toContain(totalLabel);
    });
    const headerCells = within(headerRow).getAllByRole(
      'columnheader',
    ) as HTMLTableCellElement[];
    const totalHeaderFor = (label: string) =>
      headerCells.filter(cell => cell.textContent?.trim() === label);
    const getColSpan = (label: string) =>
      (totalHeaderFor(label)[0] as HTMLTableCellElement).colSpan;
    expect(totalHeaderFor('Total m1')).toHaveLength(1);
    expect(getColSpan('Total m1')).toBe(2);
    expect(totalHeaderFor('Total m2')).toHaveLength(1);
    expect(getColSpan('Total m2')).toBe(2);
    expect(totalHeaderFor('Total m3')).toHaveLength(1);
    expect(getColSpan('Total m3')).toBe(1);
    const allHeaderLabels = Array.from(container.querySelectorAll('thead th'))
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0);
    const hasRawLeafToken = allHeaderLabels.some(label =>
      label.includes('__mleaf__'),
    );
    expect(hasRawLeafToken).toBe(false);
    const headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLTableRowElement[];
    const buildHeaderGrid = (rows: HTMLTableRowElement[]) => {
      const grid: string[][] = Array.from({ length: rows.length }, () => []);
      rows.forEach((row, rowIndex) => {
        let colIndex = 0;
        Array.from(row.querySelectorAll('th')).forEach(cell => {
          while (grid[rowIndex][colIndex] !== undefined) {
            colIndex += 1;
          }
          const label = cell.textContent?.trim() ?? '';
          const colSpan = cell.colSpan || 1;
          const rowSpan = cell.rowSpan || 1;
          for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
            const targetRow = rowIndex + rowOffset;
            if (!grid[targetRow]) {
              continue;
            }
            for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
              grid[targetRow][colIndex + colOffset] = label;
            }
          }
          colIndex += colSpan;
        });
      });
      return grid;
    };
    const headerGrid = buildHeaderGrid(headerRows);
    const totalLeafLabels = new Set(['Value', 'IX 1YA']);
    const metricLabelSet = new Set(metrics);
    const totalLabelsSet = new Set(['Total m1', 'Total m2', 'Total m3']);
    const totalIndices = headerGrid[0]
      .slice(1)
      .map((label, index) => (totalLabelsSet.has(label) ? index + 1 : null))
      .filter((index): index is number => index !== null);
    totalIndices.forEach(index => {
      const stack = headerGrid
        .slice(1)
        .map(row => row[index])
        .filter(label => label !== undefined && label !== '');
      expect(stack.length).toBeGreaterThan(0);
      expect(totalLeafLabels.has(stack[0])).toBe(true);
      const hasMetricLabel = stack.some(label => metricLabelSet.has(label));
      expect(hasMetricLabel).toBe(false);
    });

    const totalHeader = within(container).getByText('Total m1').closest('th');
    expect(totalHeader).not.toBeNull();
    const totalHeaderEl = totalHeader as HTMLElement;
    expect(
      within(totalHeaderEl).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(totalHeaderEl).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
  });

  it('renders measure leaf labels instead of raw leaf tokens in headers', () => {
    const metrics = ['m1'];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey: 'm1', leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const baseTree = buildTreeFromRecords(
      [
        {
          col1: 'A',
          m1: 10,
          'm1__1 year ago': 8,
        },
      ],
      metrics,
      [],
      ['col1'],
      0,
      1,
    );
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: baseTree,
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1'],
      1,
    );
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [],
      cols: ['col1'],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['col1'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      measureLeavesByMetric: {
        m1: [valueLeaf, ixLeaf],
      },
      pivotRuntimeLayout: runtimeLayout,
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
      />,
    );

    const labels = Array.from(container.querySelectorAll('thead th'))
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0);
    const hasRawLeafToken = labels.some(label => label.includes('__mleaf__'));
    expect(hasRawLeafToken).toBe(false);
    expect(labels).toEqual(expect.arrayContaining(['Value', 'IX 1YA']));
  });

  it('re-applies derived measure leaf values when upstream data refreshes in user-controlled mode', async () => {
    const metricKey = 'm1';
    const rowGroupby = ['row1'];
    const valueLeaf = buildValueLeaf();
    const deltaLeaf = buildBuiltInLeaf('delta', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, deltaLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const deltaMetricKey = buildMeasureLeafOutputKey(metricKey, deltaLeaf);
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: rowGroupby,
      cols: [],
      metrics: [metricKey],
      leafSelection: {
        [valueLeaf.id]: true,
        [deltaLeaf.id]: true,
      },
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: rowGroupby,
      groupbyRows: [],
      groupbyColumns: [],
      metrics: [metricKey],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      measureLeavesByMetric: {
        [metricKey]: [valueLeaf, deltaLeaf],
      },
      metricDatabars: {
        [deltaMetricKey]: { type: 'bar' },
      },
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
    });

    const baseTree = buildTreeFromRecords(
      [{ row1: 'A', m1: 150, 'm1__1 year ago': 117 }],
      [metricKey],
      rowGroupby,
      [],
      1,
      0,
    );
    const treeWithLeafValues = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({ tree: baseTree, measureHierarchy }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
      0,
    );

    const refreshedBaseTree = buildTreeFromRecords(
      [{ row1: 'A', m1: 180, 'm1__1 year ago': 140 }],
      [metricKey],
      rowGroupby,
      [],
      1,
      0,
    );
    const refreshedTreeWithoutLeafValues = applyMeasureHierarchyAxis(
      refreshedBaseTree,
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
      0,
    );

    const { container, rerender } = render(
      <PivotTableChart
        data={treeWithLeafValues}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={[metricKey]}
        groupbyRows={[]}
        groupbyColumns={[]}
      />,
    );

    const rowMetricValues = () =>
      Array.from(container.querySelectorAll('tbody td.value-cell')).map(
        cell => {
          const text = (cell.textContent ?? '').replace(/,/g, '').trim();
          if (text.length === 0) {
            return null;
          }
          const value = Number(text);
          return Number.isFinite(value) ? value : null;
        },
      );

    expect(rowMetricValues()).toEqual(expect.arrayContaining([150, 33]));

    rerender(
      <PivotTableChart
        data={refreshedTreeWithoutLeafValues}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={[metricKey]}
        groupbyRows={[]}
        groupbyColumns={[]}
      />,
    );

    await waitFor(() =>
      expect(rowMetricValues()).toEqual(expect.arrayContaining([180, 40])),
    );
  });

  it('keeps committed data when upstream refresh omits required custom leaf source metrics', async () => {
    const metricKey = 'm1';
    const customMetricKey = 'm1_custom';
    const rowGroupby = ['row1'];
    const valueLeaf = buildValueLeaf();
    const customLeaf = buildCustomLeaf({
      label: 'Custom delta',
      metric: customMetricKey,
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, customLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: rowGroupby,
      cols: [],
      metrics: [metricKey],
      leafSelection: {
        [valueLeaf.id]: true,
        [customLeaf.id]: true,
      },
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: rowGroupby,
      groupbyRows: [],
      groupbyColumns: [],
      metrics: [metricKey],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      measureLeavesByMetric: {
        [metricKey]: [valueLeaf, customLeaf],
      },
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
    });

    const treeWithLeafSources = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [{ row1: 'A', m1: 150, [customMetricKey]: 33 }],
          [metricKey, customMetricKey],
          rowGroupby,
          [],
          1,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
      0,
    );
    const staleTreeWithoutLeafSources = applyMeasureHierarchyAxis(
      buildTreeFromRecords(
        [{ row1: 'A', m1: 180 }],
        [metricKey, customMetricKey],
        rowGroupby,
        [],
        1,
        0,
      ),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
      0,
    );

    const { container, rerender } = render(
      <PivotTableChart
        data={treeWithLeafSources}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={[metricKey]}
        groupbyRows={[]}
        groupbyColumns={[]}
      />,
    );

    const rowMetricValues = () =>
      Array.from(container.querySelectorAll('tbody td.value-cell')).map(
        cell => {
          const text = (cell.textContent ?? '').replace(/,/g, '').trim();
          if (text.length === 0) {
            return null;
          }
          const value = Number(text);
          return Number.isFinite(value) ? value : null;
        },
      );

    expect(rowMetricValues()).toEqual(expect.arrayContaining([150, 33]));

    rerender(
      <PivotTableChart
        data={staleTreeWithoutLeafSources}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={[metricKey]}
        groupbyRows={[]}
        groupbyColumns={[]}
      />,
    );

    await waitFor(() =>
      expect(rowMetricValues()).toEqual(expect.arrayContaining([150, 33])),
    );
  });

  it('keeps local column layout on stale dashboard rerender after seamless update', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const cols = ['col1'];
    const staleRecords = [{ row1: 'A', m1: 10 }];
    const recoveredRecords = [{ row1: 'A', col1: 'ColorA', m1: 10 }];
    const staleRuntimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const baseFormData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: [...rows, ...cols],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: staleRuntimeLayout,
      startCollapsed: false,
      initialDepth: 1,
    });
    const staleTree = applyMetricAxis(
      buildTreeFromRecords(staleRecords, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );
    const setControlValue = jest.fn();
    const fetchSpy = jest
      .spyOn(supersetChartDataClient, 'fetch')
      .mockImplementation(async ({ requestGroupId, specs }) =>
        requestGroupId === 'pivot-v3-seamless'
          ? specs.map(() => ({ data: recoveredRecords }))
          : specs.map(() => ({ data: staleRecords })),
      );
    const cancelSpy = jest
      .spyOn(supersetChartDataClient, 'cancel')
      .mockImplementation(() => undefined);

    const { rerender } = render(
      <PivotTableChart
        data={staleTree}
        formData={baseFormData}
        rawFormData={baseFormData}
        queryFormData={baseFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        setControlValue={setControlValue}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getAllByLabelText('Toggle column dimension')[1]);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestGroupId: 'pivot-v3-seamless',
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('ColorA')).toBeInTheDocument());

    const staleRerenderFormData = {
      ...baseFormData,
      pivotRuntimeLayout: { ...staleRuntimeLayout },
    };

    rerender(
      <PivotTableChart
        data={staleTree}
        formData={staleRerenderFormData}
        rawFormData={staleRerenderFormData}
        queryFormData={{ ...staleRerenderFormData }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        setControlValue={setControlValue}
        width={480}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('ColorA')).toBeInTheDocument());

    fetchSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('keeps seamless multi-metric values-only cells after stale dashboard rerender', async () => {
    const metrics = ['m1', 'm2'];
    const rows = ['row1'];
    const cols = ['col1'];
    const staleRecords = [{ row1: 'A', col1: 'ColorA', m1: 111, m2: 222 }];
    const recoveredRecords = [{ row1: 'A', m1: 999, m2: 777 }];
    const initialRuntimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols,
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const valuesOnlyRuntimeLayout: PivotRuntimeLayout = {
      ...initialRuntimeLayout,
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const baseFormData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: [...rows, ...cols],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: initialRuntimeLayout,
      startCollapsed: false,
      initialDepth: 1,
      treeDataSignature: 'stable-signature',
    });
    const staleTree = applyMetricAxis(
      buildTreeFromRecords(staleRecords, metrics, rows, cols, 1, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      cols,
      1,
    );
    const fetchSpy = jest
      .spyOn(supersetChartDataClient, 'fetch')
      .mockImplementation(async ({ requestGroupId, specs }) =>
        requestGroupId === 'pivot-v3-seamless'
          ? specs.map(() => ({ data: recoveredRecords }))
          : specs.map(() => ({ data: staleRecords })),
      );
    const cancelSpy = jest
      .spyOn(supersetChartDataClient, 'cancel')
      .mockImplementation(() => undefined);

    const { container, rerender } = render(
      <PivotTableChart
        data={staleTree}
        formData={baseFormData}
        rawFormData={baseFormData}
        queryFormData={baseFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    const rowMetricValues = () =>
      Array.from(container.querySelectorAll('tbody td.value-cell')).map(cell =>
        Number(cell.textContent?.trim()),
      );

    fireEvent.click(screen.getAllByLabelText('Toggle column dimension')[1]);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestGroupId: 'pivot-v3-seamless',
        }),
      ),
    );
    await waitFor(() =>
      expect(rowMetricValues()).toEqual(expect.arrayContaining([999, 777])),
    );

    const staleRerenderFormData = {
      ...baseFormData,
      pivotRuntimeLayout: valuesOnlyRuntimeLayout,
      treeDataSignature: 'stable-signature',
    };

    rerender(
      <PivotTableChart
        data={staleTree}
        formData={staleRerenderFormData}
        rawFormData={staleRerenderFormData}
        queryFormData={{ ...staleRerenderFormData }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={480}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(rowMetricValues()).toEqual(expect.arrayContaining([999, 777])),
    );

    fetchSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('keeps multi-metric Values cells visible after adding and removing a column dimension', async () => {
    const metrics = ['m1', 'm2'];
    const rows = ['row1'];
    const cols = ['col1'];
    const valuesOnlyRuntimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const baseFormData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: [...rows, ...cols],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: valuesOnlyRuntimeLayout,
      startCollapsed: false,
      initialDepth: 1,
    });
    const initialTree = buildInitialBootstrapTree({
      formData: baseFormData,
      runtimeLayout: valuesOnlyRuntimeLayout,
      resultsByDepth: {
        '0|0': [{ m1: 100, m2: 200 }],
        '1|0': [
          { row1: 'A', m1: 10, m2: 20 },
          { row1: 'B', m1: 30, m2: 40 },
        ],
      },
    });
    const fetchSpy = jest
      .spyOn(supersetChartDataClient, 'fetch')
      .mockImplementation(async ({ specs }) => {
        const includesColumnDepth = specs.some(
          spec =>
            (spec as { meta?: { colDepth?: number } }).meta?.colDepth === 1,
        );
        const resultsByDepth = includesColumnDepth
          ? {
              '0|0': [{ m1: 100, m2: 200 }],
              '1|1': [
                { row1: 'A', col1: 'X', m1: 10, m2: 20 },
                { row1: 'B', col1: 'Y', m1: 30, m2: 40 },
              ],
              '1|0': [
                { row1: 'A', m1: 10, m2: 20 },
                { row1: 'B', m1: 30, m2: 40 },
              ],
              '0|1': [
                { col1: 'X', m1: 10, m2: 20 },
                { col1: 'Y', m1: 30, m2: 40 },
              ],
            }
          : {
              '0|0': [{ m1: 100, m2: 200 }],
              '1|0': [
                { row1: 'A', m1: 10, m2: 20 },
                { row1: 'B', m1: 30, m2: 40 },
              ],
            };
        return specs.map(spec => ({
          data:
            resultsByDepth[
              `${(spec as { meta: { rowDepth: number; colDepth: number } }).meta.rowDepth}|${
                (spec as { meta: { rowDepth: number; colDepth: number } }).meta
                  .colDepth
              }`
            ] ?? [],
        }));
      });
    const cancelSpy = jest
      .spyOn(supersetChartDataClient, 'cancel')
      .mockImplementation(() => undefined);

    const { container } = render(
      <PivotTableChart
        data={initialTree}
        formData={baseFormData}
        rawFormData={baseFormData}
        queryFormData={baseFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    const rowMetricValues = () =>
      Array.from(container.querySelectorAll('tbody td.value-cell')).map(cell =>
        Number(cell.textContent?.trim()),
      );

    expect(rowMetricValues()).toEqual(expect.arrayContaining([10, 20, 30, 40]));

    fireEvent.click(screen.getAllByLabelText('Toggle column dimension')[1]);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(
      new Set(
        fetchSpy.mock.calls[0][0].specs.map(
          spec => `${spec.meta.rowDepth}|${spec.meta.colDepth}`,
        ),
      ),
    ).toEqual(new Set(['0|0', '1|1', '1|0']));
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText('Remove dimension')[0]);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(
      new Set(
        fetchSpy.mock.calls[1][0].specs.map(
          spec => `${spec.meta.rowDepth}|${spec.meta.colDepth}`,
        ),
      ),
    ).toEqual(new Set(['0|0', '1|0']));
    await waitFor(() =>
      expect(rowMetricValues()).toEqual(
        expect.arrayContaining([10, 20, 30, 40]),
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('keeps column dimension headers after stale dashboard rerender when startCollapsed is enabled', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const cols = ['col1'];
    const staleRecords = [{ row1: 'A', m1: 10 }];
    const recoveredRecords = [{ row1: 'A', col1: 'ColorA', m1: 10 }];
    const staleRuntimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const baseFormData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: [...rows, ...cols],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: staleRuntimeLayout,
      startCollapsed: true,
      initialDepth: 1,
    });
    const staleTree = applyMetricAxis(
      buildTreeFromRecords(staleRecords, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );
    const setControlValue = jest.fn();
    const fetchSpy = jest
      .spyOn(supersetChartDataClient, 'fetch')
      .mockImplementation(async ({ requestGroupId, specs }) =>
        requestGroupId === 'pivot-v3-seamless'
          ? specs.map(() => ({ data: recoveredRecords }))
          : specs.map(() => ({ data: staleRecords })),
      );
    const cancelSpy = jest
      .spyOn(supersetChartDataClient, 'cancel')
      .mockImplementation(() => undefined);

    const { rerender } = render(
      <PivotTableChart
        data={staleTree}
        formData={baseFormData}
        rawFormData={baseFormData}
        queryFormData={baseFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        setControlValue={setControlValue}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getAllByLabelText('Toggle column dimension')[1]);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestGroupId: 'pivot-v3-seamless',
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('ColorA')).toBeInTheDocument());

    const staleRerenderFormData = {
      ...baseFormData,
      pivotRuntimeLayout: { ...staleRuntimeLayout },
    };

    rerender(
      <PivotTableChart
        data={staleTree}
        formData={staleRerenderFormData}
        rawFormData={staleRerenderFormData}
        queryFormData={{ ...staleRerenderFormData }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        setControlValue={setControlValue}
        width={480}
        height={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('ColorA')).toBeInTheDocument());

    fetchSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('keeps seamless data after stale dashboard rerender with unchanged query context', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const cols = ['col1'];
    const staleRecords = [{ row1: 'A', col1: 'ColorA', m1: 111 }];
    const recoveredRecords = [{ row1: 'A', col1: 'ColorA', m1: 999 }];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const baseFormData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: [...rows, ...cols],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 1,
      treeDataSignature: 'stable-signature',
    });
    const staleTree = applyMetricAxis(
      buildTreeFromRecords(staleRecords, metrics, rows, cols, 1, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      cols,
      1,
    );
    const fetchSpy = jest
      .spyOn(supersetChartDataClient, 'fetch')
      .mockImplementation(async ({ requestGroupId, specs }) =>
        requestGroupId === 'pivot-v3-seamless'
          ? specs.map(() => ({ data: recoveredRecords }))
          : specs.map(() => ({ data: staleRecords })),
      );
    const cancelSpy = jest
      .spyOn(supersetChartDataClient, 'cancel')
      .mockImplementation(() => undefined);

    const { rerender } = render(
      <PivotTableChart
        data={staleTree}
        formData={baseFormData}
        rawFormData={baseFormData}
        queryFormData={baseFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getAllByLabelText('Toggle column dimension')[1]);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestGroupId: 'pivot-v3-seamless',
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('999')).toBeInTheDocument());

    const staleRerenderFormData = {
      ...baseFormData,
      pivotRuntimeLayout: {
        ...runtimeLayout,
        cols,
      },
      treeDataSignature: 'stable-signature',
    };

    rerender(
      <PivotTableChart
        data={staleTree}
        formData={staleRerenderFormData}
        rawFormData={staleRerenderFormData}
        queryFormData={{ ...staleRerenderFormData }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={480}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByText('111')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('999')).toBeInTheDocument();

    fetchSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('keeps seamless data after stale dashboard rerender when only treeDataSignature changes', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const cols = ['col1'];
    const staleRecords = [{ row1: 'A', col1: 'ColorA', m1: 111 }];
    const recoveredRecords = [{ row1: 'A', col1: 'ColorA', m1: 999 }];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const baseFormData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: [...rows, ...cols],
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 1,
      treeDataSignature: 'signature-a',
    });
    const staleTree = applyMetricAxis(
      buildTreeFromRecords(staleRecords, metrics, rows, cols, 1, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      cols,
      1,
    );
    const fetchSpy = jest
      .spyOn(supersetChartDataClient, 'fetch')
      .mockImplementation(async ({ requestGroupId, specs }) =>
        requestGroupId === 'pivot-v3-seamless'
          ? specs.map(() => ({ data: recoveredRecords }))
          : specs.map(() => ({ data: staleRecords })),
      );
    const cancelSpy = jest
      .spyOn(supersetChartDataClient, 'cancel')
      .mockImplementation(() => undefined);

    const { rerender } = render(
      <PivotTableChart
        data={staleTree}
        formData={baseFormData}
        rawFormData={baseFormData}
        queryFormData={baseFormData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getAllByLabelText('Toggle column dimension')[1]);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestGroupId: 'pivot-v3-seamless',
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('999')).toBeInTheDocument());

    const staleRerenderFormData = {
      ...baseFormData,
      pivotRuntimeLayout: {
        ...runtimeLayout,
        cols,
      },
      treeDataSignature: 'signature-b',
    };

    rerender(
      <PivotTableChart
        data={staleTree}
        formData={staleRerenderFormData}
        rawFormData={staleRerenderFormData}
        queryFormData={{ ...staleRerenderFormData }}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        width={480}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByText('111')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('999')).toBeInTheDocument();

    fetchSpy.mockRestore();
    cancelSpy.mockRestore();
  });
});
