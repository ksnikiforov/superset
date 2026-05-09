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

import { type ComponentProps } from 'react';
import { render, screen, within } from '../../testUtils';
import TestPivotTableChart, {
  buildPreloadedRenderedTreeFactBatches,
} from '../fixtures/TestPivotTableChart';
import {
  MetricsLayoutEnum,
  type PivotTableQueryFormData,
} from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { METRICS_PLACEHOLDER } from '../../../src/utils';
import {
  applyMeasureLeafValuesToTree,
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMeasureHierarchyAxis } from '../../../src/pivot/runtime/materializePivotTree';

type TestPivotTableChartProps = ComponentProps<typeof TestPivotTableChart>;

function PivotTableChart(props: TestPivotTableChartProps) {
  return (
    <TestPivotTableChart
      {...props}
      factBatches={
        props.factBatches ??
        buildPreloadedRenderedTreeFactBatches(props.data, {
          groupbyRows: props.groupbyRows ?? [],
          groupbyColumns: props.groupbyColumns ?? [],
        })
      }
    />
  );
}

describe('PivotTableChart measure leaf tier indentation', () => {
  const baseProps = {
    aggregateFunction: 'Sum',
    width: 500,
    height: 300,
    startCollapsed: false,
    initialDepth: 2,
    colTotals: false,
    rowTotals: false,
    rowSubTotals: false,
    rowSubtotalLevels: [],
    colSubtotalLevels: [],
    rowOrder: 'key_a_to_z',
    colOrder: 'key_a_to_z',
    valueFormat: '',
    columnFormats: {},
    currencyFormats: {},
    allowRenderHtml: false,
    emitCrossFilters: false,
    setDataMask: jest.fn(),
    metricColorFormatters: [],
    dateFormatters: {},
    verboseMap: {},
  };

  it('indents measure leaf rows deeper than metric groups', () => {
    const metricKey = 'grossRevenue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };

    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              orderPriority: '1-URGENT',
              shipMode: 'AIR',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 5,
            },
          ],
          [metricKey],
          ['orderPriority', 'shipMode'],
          [],
          2,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.ROWS,
      ['orderPriority', 'shipMode'],
      [],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority', METRICS_PLACEHOLDER, 'shipMode'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: [metricKey],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
        groupbyRows={['orderPriority', 'shipMode']}
        groupbyColumns={[]}
        {...baseProps}
      />,
    );

    const metricRow = screen
      .getByText(metricKey)
      .closest('tr') as HTMLTableRowElement;
    const valueRow = screen
      .getAllByText('Value')[0]
      .closest('tr') as HTMLTableRowElement;
    const ixRow = screen
      .getByText('IX 1YA')
      .closest('tr') as HTMLTableRowElement;
    const metricIndent = Number.parseInt(
      (metricRow.querySelector('th div') as HTMLElement).style.paddingLeft ||
        '0',
      10,
    );
    const valueIndent = Number.parseInt(
      (valueRow.querySelector('th div') as HTMLElement).style.paddingLeft ||
        '0',
      10,
    );
    const ixIndent = Number.parseInt(
      (ixRow.querySelector('th div') as HTMLElement).style.paddingLeft || '0',
      10,
    );

    expect(valueIndent).toBeGreaterThan(metricIndent);
    expect(ixIndent).toBeGreaterThan(metricIndent);
  });

  it('does not show toggles on leaf columns when metrics are last', () => {
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
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              col1: 'C1',
              col2: 'C2',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
              netRevenue: 12,
              'netRevenue__1 year ago': 9,
            },
          ],
          [metricKey, secondaryMetric],
          [],
          ['col1', 'col2'],
          0,
          2,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1', 'col2'],
      2,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [],
          groupbyColumns: ['col1', 'col2', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: [metricKey, secondaryMetric],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
            [secondaryMetric]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={[]}
        groupbyColumns={['col1', 'col2']}
        {...baseProps}
      />,
    );

    const valueHeader = screen.getAllByText('Value')[0].closest('th');
    if (!valueHeader) {
      throw new Error('Value header not found');
    }
    const ixHeader = screen.getAllByText('IX 1YA')[0].closest('th');
    if (!ixHeader) {
      throw new Error('IX header not found');
    }
    expect(
      within(valueHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(valueHeader).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixHeader).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
  });

  it('does not show toggles on leaf rows when metrics are last', () => {
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
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              row1: 'R1',
              row2: 'R2',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
              netRevenue: 12,
              'netRevenue__1 year ago': 9,
            },
          ],
          [metricKey, secondaryMetric],
          ['row1', 'row2'],
          [],
          2,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.ROWS,
      ['row1', 'row2'],
      [],
      2,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['row1', 'row2', METRICS_PLACEHOLDER],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: [metricKey, secondaryMetric],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
            [secondaryMetric]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={['row1', 'row2']}
        groupbyColumns={[]}
        {...baseProps}
      />,
    );

    const valueRow = screen.getAllByText('Value')[0].closest('tr');
    if (!valueRow) {
      throw new Error('Value row not found');
    }
    const ixRow = screen.getAllByText('IX 1YA')[0].closest('tr');
    if (!ixRow) {
      throw new Error('IX row not found');
    }
    expect(
      within(valueRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(valueRow).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixRow).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
  });

  it('does not show toggles on leaf columns when metrics are last and rows exist', () => {
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
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              row1: 'R1',
              col1: 'C1',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
              netRevenue: 12,
              'netRevenue__1 year ago': 9,
            },
          ],
          [metricKey, secondaryMetric],
          ['row1'],
          ['col1'],
          1,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1'],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['row1'],
          groupbyColumns: ['col1', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: [metricKey, secondaryMetric],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
            [secondaryMetric]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={['row1']}
        groupbyColumns={['col1']}
        {...baseProps}
      />,
    );

    const thead = document.querySelector('thead');
    if (!thead) {
      throw new Error('Table header not found');
    }
    const valueHeader = within(thead).getAllByText('Value')[0].closest('th');
    if (!valueHeader) {
      throw new Error('Value header not found');
    }
    const ixHeader = within(thead).getAllByText('IX 1YA')[0].closest('th');
    if (!ixHeader) {
      throw new Error('IX header not found');
    }
    expect(
      within(valueHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(valueHeader).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixHeader).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
  });

  it('does not show toggles on leaf rows when metrics are last and columns exist', () => {
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
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              row1: 'R1',
              col1: 'C1',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
              netRevenue: 12,
              'netRevenue__1 year ago': 9,
            },
          ],
          [metricKey, secondaryMetric],
          ['row1'],
          ['col1'],
          1,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.ROWS,
      ['row1'],
      ['col1'],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['row1', METRICS_PLACEHOLDER],
          groupbyColumns: ['col1'],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: [metricKey, secondaryMetric],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
            [secondaryMetric]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={['row1']}
        groupbyColumns={['col1']}
        {...baseProps}
      />,
    );

    const tbody = document.querySelector('tbody');
    if (!tbody) {
      throw new Error('Table body not found');
    }
    const valueRow = within(tbody).getAllByText('Value')[0].closest('tr');
    if (!valueRow) {
      throw new Error('Value row not found');
    }
    const ixRow = within(tbody).getAllByText('IX 1YA')[0].closest('tr');
    if (!ixRow) {
      throw new Error('IX row not found');
    }
    expect(
      within(valueRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(valueRow).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixRow).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(ixRow).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
  });

  it('shows toggles on leaf columns when metrics sit between column dimensions', () => {
    const metricKey = 'grossRevenue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const expandedProps = {
      ...baseProps,
      startCollapsed: true,
      initialDepth: 2,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              col1: 'C1',
              col2: 'C2',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
            },
          ],
          [metricKey],
          [],
          ['col1', 'col2'],
          0,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1', 'col2'],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(expandedProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [],
          groupbyColumns: ['col1', METRICS_PLACEHOLDER, 'col2'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: [metricKey],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
        groupbyRows={[]}
        groupbyColumns={['col1', 'col2']}
        {...expandedProps}
      />,
    );

    const thead = document.querySelector('thead');
    if (!thead) {
      throw new Error('Table header not found');
    }
    const valueHeader = within(thead).getAllByText('Value')[0].closest('th');
    if (!valueHeader) {
      throw new Error('Value header not found');
    }
    const ixHeader = within(thead).getAllByText('IX 1YA')[0].closest('th');
    if (!ixHeader) {
      throw new Error('IX header not found');
    }
    const valueToggle = within(valueHeader).queryByRole('button');
    const ixToggle = within(ixHeader).queryByRole('button');
    expect(valueToggle).toBeInTheDocument();
    expect(ixToggle).toBeInTheDocument();
  });

  it('shows leaf headers when a single metric sits at the last column level', () => {
    const metricKey = 'grossRevenue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const expandedProps = {
      ...baseProps,
      startCollapsed: true,
      initialDepth: 1,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              col1: 'C1',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
            },
          ],
          [metricKey],
          [],
          ['col1'],
          0,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['col1'],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(expandedProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [],
          groupbyColumns: ['col1', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: [metricKey],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
        groupbyRows={[]}
        groupbyColumns={['col1']}
        {...expandedProps}
      />,
    );

    const thead = document.querySelector('thead');
    if (!thead) {
      throw new Error('Table header not found');
    }
    expect(within(thead).getByText('Value')).toBeInTheDocument();
    expect(within(thead).getByText('IX 1YA')).toBeInTheDocument();
  });

  it('shows leaf headers with row dimensions when a single metric is last on columns', () => {
    const metricKey = 'grossRevenue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const expandedProps = {
      ...baseProps,
      startCollapsed: true,
      initialDepth: 1,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              row1: 'R1',
              col1: 'C1',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
            },
          ],
          [metricKey],
          ['row1'],
          ['col1'],
          1,
          1,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1'],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(expandedProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['row1'],
          groupbyColumns: ['col1', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: [metricKey],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
        groupbyRows={['row1']}
        groupbyColumns={['col1']}
        {...expandedProps}
      />,
    );

    const thead = document.querySelector('thead');
    if (!thead) {
      throw new Error('Table header not found');
    }
    expect(within(thead).getByText('Value')).toBeInTheDocument();
    expect(within(thead).getByText('IX 1YA')).toBeInTheDocument();
  });

  it('shows toggles on leaf rows when metrics sit between row dimensions', () => {
    const metricKey = 'grossRevenue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const expandedProps = {
      ...baseProps,
      startCollapsed: true,
      initialDepth: 2,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              row1: 'R1',
              row2: 'R2',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
            },
          ],
          [metricKey],
          ['row1', 'row2'],
          [],
          1,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.ROWS,
      ['row1', 'row2'],
      [],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(expandedProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['row1', METRICS_PLACEHOLDER, 'row2'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: [metricKey],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
        groupbyRows={['row1', 'row2']}
        groupbyColumns={[]}
        {...expandedProps}
      />,
    );

    const tbody = document.querySelector('tbody');
    if (!tbody) {
      throw new Error('Table body not found');
    }
    const valueRow = within(tbody).getAllByText('Value')[0].closest('tr');
    if (!valueRow) {
      throw new Error('Value row not found');
    }
    const ixRow = within(tbody).getAllByText('IX 1YA')[0].closest('tr');
    if (!ixRow) {
      throw new Error('IX row not found');
    }
    const valueToggle = within(valueRow).queryByRole('button');
    const ixToggle = within(ixRow).queryByRole('button');
    expect(valueToggle).toBeInTheDocument();
    expect(ixToggle).toBeInTheDocument();
  });

  it('does not show toggles on total-only column branches', () => {
    const grossMetric = 'grossRevenue';
    const avgMetric = 'averageOrderValue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const deltaLeaf = buildBuiltInLeaf('delta', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        { metricKey: grossMetric, leaves: [valueLeaf, deltaLeaf, ixLeaf] },
        { metricKey: avgMetric, leaves: [valueLeaf] },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              shipMode: 'AIR',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
              averageOrderValue: 2,
            },
          ],
          [grossMetric, avgMetric],
          ['shipMode'],
          ['revenueBand', 'quantityBand'],
          1,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['revenueBand', 'quantityBand'],
      2,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['shipMode'],
          groupbyColumns: ['revenueBand', 'quantityBand', METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: [grossMetric, avgMetric],
          measureLeavesByMetric: {
            [grossMetric]: [valueLeaf, deltaLeaf, ixLeaf],
            [avgMetric]: [valueLeaf],
          },
          rowTotals: false,
          colTotals: false,
        })}
        metrics={[grossMetric, avgMetric]}
        groupbyRows={['shipMode']}
        groupbyColumns={['revenueBand', 'quantityBand']}
        {...baseProps}
      />,
    );

    const thead = container.querySelector('thead');
    if (!thead) {
      throw new Error('Table header not found');
    }
    const valueHeaders = Array.from(thead.querySelectorAll('th')).filter(
      th => th.textContent?.trim() === 'Value',
    );
    if (valueHeaders.length === 0) {
      throw new Error('Expected Value header not found');
    }
    valueHeaders.forEach(header => {
      expect(
        within(header).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(header).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();
    });
  });

  it('does not treat leaf-tier visibility as subtotal expansion', () => {
    const metricKey = 'grossRevenue';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [{ metricKey, leaves: [valueLeaf, ixLeaf] }],
      leafTierVisibility: 'visible' as const,
    };
    const tree = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: buildTreeFromRecords(
          [
            {
              orderPriority: '1-URGENT',
              shipMode: 'AIR',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
            },
          ],
          [metricKey],
          ['orderPriority', 'shipMode'],
          [],
          2,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.ROWS,
      ['orderPriority', 'shipMode'],
      [],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority', METRICS_PLACEHOLDER, 'shipMode'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: [metricKey],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
        groupbyRows={['orderPriority', 'shipMode']}
        groupbyColumns={[]}
        {...baseProps}
      />,
    );

    const orderRow = screen.getByText('1-URGENT').closest('tr');
    if (!orderRow) {
      throw new Error('Order row not found');
    }
    const orderHeaderCell = orderRow.querySelector('th') as HTMLElement;
    expect(orderHeaderCell.className).not.toContain('subtotal-cell');
    const valueRow = screen.getAllByText('Value')[0].closest('tr');
    if (!valueRow) {
      throw new Error('Value row not found');
    }
    const valueHeaderCell = valueRow.querySelector('th') as HTMLElement;
    expect(valueHeaderCell.className).not.toContain('subtotal-cell');

    const valueCell = container.querySelector('td.value-cell') as HTMLElement;
    expect(valueCell.className).not.toContain('subtotal-cell');
  });
});
