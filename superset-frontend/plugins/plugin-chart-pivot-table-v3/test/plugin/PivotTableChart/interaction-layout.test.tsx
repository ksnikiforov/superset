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
import { fireEvent, render, screen, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { buildFormData } from '../fixtures/pivotFormData';
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
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';

describe('PivotTableChart interaction layout', () => {
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
      .filter((node): node is HTMLElement => node !== null);
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

    const headerRow = container.querySelector('thead tr');
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

    const headerRow = container.querySelector('thead tr');
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
    const headerCells = within(headerRow).getAllByRole('columnheader');
    const totalHeaderFor = (label: string) =>
      headerCells.filter(cell => cell.textContent?.trim() === label);
    expect(totalHeaderFor('Total m1')).toHaveLength(1);
    expect(totalHeaderFor('Total m1')[0].colSpan).toBe(2);
    expect(totalHeaderFor('Total m2')).toHaveLength(1);
    expect(totalHeaderFor('Total m2')[0].colSpan).toBe(2);
    expect(totalHeaderFor('Total m3')).toHaveLength(1);
    expect(totalHeaderFor('Total m3')[0].colSpan).toBe(1);
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
});
