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
import { MetricsLayoutEnum } from '../../../src/types';
import {
  applyMeasureHierarchyAxis,
  buildTreeFromRecords,
} from '../../../src/utils';
import {
  applyMeasureLeafValuesToTree,
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';

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
});
