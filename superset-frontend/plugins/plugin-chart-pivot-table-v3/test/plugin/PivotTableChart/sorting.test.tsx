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

import { fireEvent, render, screen } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { buildFormData } from '../fixtures/pivotFormData';
import { MetricsLayoutEnum, PivotRuntimeLayout } from '../../../src/types';

import {
  buildMeasureLeafOutputKey,
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';
import { applyMeasureLeafValuesToTree } from '../../../src/pivot/runtime/materializePivotTree';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMeasureHierarchyAxis } from '../fixtures/metricAxis';

describe('PivotTableChart sorting', () => {
  const withMetricsOnColumns = (
    tree: ReturnType<typeof buildTreeFromRecords>,
    metrics: string[],
    groupbyRows: string[],
    groupbyColumns: string[],
  ) =>
    applyMeasureHierarchyAxis(
      tree,
      { kind: 'flatMetrics', metricKeys: metrics },
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
    );

  const getBodyRowLabels = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('tbody tr'))
      .map(row => row.querySelector('th')?.textContent?.trim())
      .filter((label): label is string => Boolean(label));

  const getHeaderCell = (label: string) => {
    const headerText = screen
      .getAllByText(label)
      .find(node => node.closest('thead') !== null);
    return headerText?.closest('th') ?? null;
  };

  const getWaterfallBarLeftForRow = (container: HTMLElement, label: string) => {
    const row = Array.from(container.querySelectorAll('tbody tr')).find(
      candidate =>
        candidate
          .querySelector('[data-pivot-row-label]')
          ?.textContent?.trim() === label,
    );
    expect(row).toBeTruthy();
    const bar = row?.querySelector('[data-test="pivot-databar-bar"]');
    expect(bar).toBeTruthy();
    return Number.parseFloat((bar as HTMLElement).style.left);
  };

  it('sorts rows by metric totals when configured', () => {
    const metrics = ['metric1'];
    const groupbyRows = ['country'];
    const groupbyColumns: string[] = [];
    const tree = buildTreeFromRecords(
      [
        { country: 'Brazil', metric1: 10 },
        { country: 'Canada', metric1: 20 },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      0,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          rowSorting: {
            country: { metric: 'metric1', order: 'desc', mode: 'total' },
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    const dataRows = screen.getAllByRole('row').slice(1);
    const labels = dataRows.map(row =>
      row.querySelector('th')?.textContent?.trim(),
    );
    expect(labels).toEqual(['Canada', 'Brazil']);
  });

  it('sorts rows by dimension values when no metric is configured', () => {
    const metrics = ['metric1'];
    const groupbyRows = ['country'];
    const groupbyColumns: string[] = [];
    const tree = buildTreeFromRecords(
      [
        { country: 'Brazil', metric1: 10 },
        { country: 'Argentina', metric1: 20 },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      0,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          rowSorting: {
            country: { order: 'desc', mode: 'total' },
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    const dataRows = screen.getAllByRole('row').slice(1);
    const labels = dataRows.map(row =>
      row.querySelector('th')?.textContent?.trim(),
    );
    expect(labels).toEqual(['Brazil', 'Argentina']);
  });

  it('keeps null metric totals at bottom for dimension row sorting', () => {
    const metrics = ['metric1'];
    const groupbyRows = ['country'];
    const groupbyColumns: string[] = [];
    const tree = buildTreeFromRecords(
      [
        { country: 'A', metric1: 30 },
        { country: 'B', metric1: null },
        { country: 'C', metric1: 10 },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      0,
    );

    const { rerender, container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          rowSorting: {
            country: { metric: 'metric1', order: 'asc', mode: 'total' },
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['C', 'A', 'B']);

    rerender(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          rowSorting: {
            country: { metric: 'metric1', order: 'desc', mode: 'total' },
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['A', 'C', 'B']);
  });

  it('does not sort when clicking a non-metric column header under multi-metric layout', () => {
    const metrics = ['m1', 'm2'];
    const groupbyRows = ['country'];
    const groupbyColumns = ['year'];
    const tree = withMetricsOnColumns(
      buildTreeFromRecords(
        [
          { country: 'A', year: '2024', m1: 30, m2: 1 },
          { country: 'B', year: '2024', m1: 10, m2: 3 },
          { country: 'C', year: '2024', m1: 20, m2: 2 },
        ],
        metrics,
        groupbyRows,
        groupbyColumns,
        1,
        1,
      ),
      metrics,
      groupbyRows,
      groupbyColumns,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['A', 'B', 'C']);
    const nonMetricHeaderCell = getHeaderCell('2024');
    expect(nonMetricHeaderCell).not.toBeNull();
    fireEvent.click(nonMetricHeaderCell as HTMLTableCellElement);
    expect(getBodyRowLabels(container)).toEqual(['A', 'B', 'C']);
  });

  it('cycles metric header sorting asc desc none and keeps nulls at bottom', () => {
    const metrics = ['m1', 'm2'];
    const groupbyRows = ['country'];
    const groupbyColumns = ['year'];
    const tree = withMetricsOnColumns(
      buildTreeFromRecords(
        [
          { country: 'A', year: '2024', m1: 30, m2: 1 },
          { country: 'B', year: '2024', m1: null, m2: 2 },
          { country: 'C', year: '2024', m1: 20, m2: 3 },
          { country: 'D', year: '2024', m1: 10, m2: 4 },
        ],
        metrics,
        groupbyRows,
        groupbyColumns,
        1,
        1,
      ),
      metrics,
      groupbyRows,
      groupbyColumns,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    const metricHeaderCell = getHeaderCell('m1');
    expect(metricHeaderCell).not.toBeNull();
    expect(getBodyRowLabels(container)).toEqual(['A', 'B', 'C', 'D']);

    fireEvent.click(metricHeaderCell as HTMLTableCellElement);
    expect(getBodyRowLabels(container)).toEqual(['D', 'C', 'A', 'B']);
    const metricHeaderLabel = screen
      .getAllByText('m1')
      .find(node => node.closest('thead') !== null);
    const sortedAscendingIcon = screen.getByLabelText('Sorted ascending');
    expect(metricHeaderLabel).not.toBeNull();
    expect(
      metricHeaderLabel!.compareDocumentPosition(sortedAscendingIcon),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(metricHeaderCell as HTMLTableCellElement);
    expect(getBodyRowLabels(container)).toEqual(['A', 'C', 'D', 'B']);

    fireEvent.click(metricHeaderCell as HTMLTableCellElement);
    expect(getBodyRowLabels(container)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('recomputes waterfall offsets when interactive column sorting changes row order', () => {
    const metrics = ['metric1'];
    const groupbyRows = ['country'];
    const groupbyColumns = ['year'];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['country'],
      cols: ['year'],
      metrics: ['metric1'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const tree = withMetricsOnColumns(
      buildTreeFromRecords(
        [
          { country: 'A', year: '2024', metric1: 20 },
          { country: 'B', year: '2024', metric1: 10 },
        ],
        metrics,
        groupbyRows,
        groupbyColumns,
        1,
        1,
      ),
      metrics,
      groupbyRows,
      groupbyColumns,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          dimensions: ['country', 'year'],
          groupbyRows: [],
          groupbyColumns: [],
          interactionMode: 'user_controlled',
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          pivotRuntimeLayout: runtimeLayout,
          metricDatabars: {
            metric1: { type: 'waterfall' },
          },
        })}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['A', 'B']);
    const bLeftBeforeSort = getWaterfallBarLeftForRow(container, 'B');
    expect(bLeftBeforeSort).toBeGreaterThan(0);

    const metricHeaderCell = getHeaderCell('metric1');
    expect(metricHeaderCell).not.toBeNull();
    fireEvent.click(metricHeaderCell as HTMLTableCellElement);

    expect(getBodyRowLabels(container)).toEqual(['B', 'A']);
    const bLeftAfterSort = getWaterfallBarLeftForRow(container, 'B');
    expect(bLeftAfterSort).toBe(0);
  });

  it('recomputes waterfall offsets for selected non-value leaves in interactive sorting', () => {
    const metrics = ['m1'];
    const groupbyRows = ['country'];
    const groupbyColumns = ['year'];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['country'],
      cols: ['year'],
      metrics: ['m1'],
      leafSelection: {
        [valueLeaf.id]: true,
        [ixLeaf.id]: true,
      },
      leafOrder: [valueLeaf.id, ixLeaf.id],
      valuePlacement: { axis: 'col', index: 1 },
    };
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey: 'm1', leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            { country: 'A', year: '2024', m1: 20, 'm1__1 year ago': 10 },
            { country: 'B', year: '2024', m1: 10, 'm1__1 year ago': 10 },
          ],
          metrics,
          groupbyRows,
          groupbyColumns,
          1,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      1,
    );
    const ixMetricKey = buildMeasureLeafOutputKey('m1', ixLeaf);

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          dimensions: ['country', 'year'],
          groupbyRows: [],
          groupbyColumns: [],
          interactionMode: 'user_controlled',
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          pivotRuntimeLayout: runtimeLayout,
          measureLeavesByMetric: {
            m1: [valueLeaf, ixLeaf],
          },
          metricDatabars: {
            [ixMetricKey]: { type: 'waterfall' },
          },
        })}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['A', 'B']);
    const bLeftBeforeSort = getWaterfallBarLeftForRow(container, 'B');
    expect(bLeftBeforeSort).toBeGreaterThan(0);

    const ixHeaderCell = getHeaderCell('IX 1YA');
    expect(ixHeaderCell).not.toBeNull();
    fireEvent.click(ixHeaderCell as HTMLTableCellElement);

    expect(getBodyRowLabels(container)).toEqual(['B', 'A']);
    const bLeftAfterSort = getWaterfallBarLeftForRow(container, 'B');
    expect(bLeftAfterSort).toBe(0);
  });

  it('sorts by the clicked measure leaf metric when measure hierarchy is enabled', () => {
    const metrics = ['m1', 'm2'];
    const groupbyRows = ['country'];
    const groupbyColumns = ['year'];
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
        { metricKey: 'm2', leaves: [valueLeaf] },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              country: 'Zeta',
              year: '2024',
              m1: 100,
              'm1__1 year ago': 50,
              m2: 10,
            },
            {
              country: 'Alpha',
              year: '2024',
              m1: 50,
              'm1__1 year ago': 5,
              m2: 20,
            },
          ],
          metrics,
          groupbyRows,
          groupbyColumns,
          1,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            m1: [valueLeaf, ixLeaf],
            m2: [valueLeaf],
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['Alpha', 'Zeta']);
    const ixHeaderCell = getHeaderCell('IX 1YA');
    expect(ixHeaderCell).not.toBeNull();
    fireEvent.click(ixHeaderCell as HTMLTableCellElement);
    expect(getBodyRowLabels(container)).toEqual(['Zeta', 'Alpha']);
  });

  it('sorts metric group headers by the selected Value leaf in measure hierarchy', () => {
    const metrics = ['m1', 'm2'];
    const groupbyRows = ['country'];
    const groupbyColumns = ['year'];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        { metricKey: 'm1', leaves: [ixLeaf, valueLeaf] },
        { metricKey: 'm2', leaves: [valueLeaf] },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              country: 'Zeta',
              year: '2024',
              m1: 100,
              'm1__1 year ago': 50,
              m2: 1,
            },
            {
              country: 'Alpha',
              year: '2024',
              m1: 50,
              'm1__1 year ago': 5,
              m2: 2,
            },
          ],
          metrics,
          groupbyRows,
          groupbyColumns,
          1,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            m1: [ixLeaf, valueLeaf],
            m2: [valueLeaf],
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['Alpha', 'Zeta']);
    const metricGroupHeader = getHeaderCell('m1');
    expect(metricGroupHeader).not.toBeNull();
    fireEvent.click(metricGroupHeader as HTMLTableCellElement);
    fireEvent.click(metricGroupHeader as HTMLTableCellElement);
    expect(getBodyRowLabels(container)).toEqual(['Zeta', 'Alpha']);
  });

  it('keeps active metric sorting stable when moving from Value-only to multi-leaf', () => {
    const metrics = ['m1', 'm2'];
    const groupbyRows = ['country'];
    const groupbyColumns = ['year'];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });

    const singleLeafHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        { metricKey: 'm1', leaves: [valueLeaf] },
        { metricKey: 'm2', leaves: [valueLeaf] },
      ],
      leafTierVisibility: 'hidden' as const,
    };
    const multiLeafHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        { metricKey: 'm1', leaves: [valueLeaf, ixLeaf] },
        { metricKey: 'm2', leaves: [valueLeaf] },
      ],
      leafTierVisibility: 'visible' as const,
    };

    const singleLeafTree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              country: 'Zeta',
              year: '2024',
              m1: 100,
              'm1__1 year ago': 5,
              m2: 1,
            },
            {
              country: 'Alpha',
              year: '2024',
              m1: 50,
              'm1__1 year ago': 500,
              m2: 2,
            },
          ],
          metrics,
          groupbyRows,
          groupbyColumns,
          1,
          1,
        ),
        measureHierarchy: singleLeafHierarchy,
      }),
      singleLeafHierarchy,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      1,
    );

    const multiLeafTree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              country: 'Zeta',
              year: '2024',
              m1: 100,
              'm1__1 year ago': 5,
              m2: 1,
            },
            {
              country: 'Alpha',
              year: '2024',
              m1: 50,
              'm1__1 year ago': 500,
              m2: 2,
            },
          ],
          metrics,
          groupbyRows,
          groupbyColumns,
          1,
          1,
        ),
        measureHierarchy: multiLeafHierarchy,
      }),
      multiLeafHierarchy,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
      1,
    );

    const { container, rerender } = render(
      <PivotTableChart
        data={singleLeafTree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            m1: [valueLeaf],
            m2: [valueLeaf],
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    const metricGroupHeader = getHeaderCell('m1');
    expect(metricGroupHeader).not.toBeNull();
    fireEvent.click(metricGroupHeader as HTMLTableCellElement);
    fireEvent.click(metricGroupHeader as HTMLTableCellElement);
    expect(getBodyRowLabels(container)).toEqual(['Zeta', 'Alpha']);

    rerender(
      <PivotTableChart
        data={multiLeafTree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            m1: [valueLeaf, ixLeaf],
            m2: [valueLeaf],
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['Zeta', 'Alpha']);
  });

  it('prefers Value leaf for dimension sorting when Value is selected', () => {
    const metrics = ['m1'];
    const groupbyRows = ['country'];
    const groupbyColumns: string[] = [];
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey: 'm1', leaves: [ixLeaf, valueLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            { country: 'Zeta', m1: 100, 'm1__1 year ago': 50 },
            { country: 'Alpha', m1: 50, 'm1__1 year ago': 5 },
          ],
          metrics,
          groupbyRows,
          groupbyColumns,
          1,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            m1: [ixLeaf, valueLeaf],
          },
          rowSorting: {
            country: { metric: 'm1', order: 'desc', mode: 'total' },
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['Zeta', 'Alpha']);
  });

  it('resolves dimension sorting metrics to selected measure leaves', () => {
    const metrics = ['m1'];
    const groupbyRows = ['country'];
    const groupbyColumns: string[] = [];
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey: 'm1', leaves: [ixLeaf] }],
      leafTierVisibility: 'hidden' as const,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            { country: 'Zeta', m1: 100, 'm1__1 year ago': 50 },
            { country: 'Alpha', m1: 50, 'm1__1 year ago': 5 },
          ],
          metrics,
          groupbyRows,
          groupbyColumns,
          1,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      groupbyRows,
      groupbyColumns,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            m1: [ixLeaf],
          },
          rowSorting: {
            country: { metric: 'm1', order: 'desc', mode: 'total' },
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    expect(getBodyRowLabels(container)).toEqual(['Alpha', 'Zeta']);
  });
});
