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

// eslint-disable-next-line import/no-extraneous-dependencies
import { renderHook } from '@testing-library/react-hooks';
import { render, screen, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { METRICS_PLACEHOLDER } from '../../../src/pivot/core/tokens';
import { serializePath } from '../../../src/pivot/core/path';
import {
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';
import { usePivotLayout } from '../../../src/pivot/chart/usePivotLayout';
import { usePivotRenderModel } from '../../../src/pivot/chart/usePivotRenderModel';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import {
  applyMeasureHierarchyAxis,
  applyMetricAxis,
} from '../fixtures/metricAxis';

describe('PivotTableChart metric tier indentation and toggles', () => {
  const metricsVariants = [
    ['averageOrderValue', 'weightedDiscount'],
    ['averageOrderValue', 'weightedDiscount', 'profitMargin'],
  ];
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

  it('indents metric rows deeper than shipMode when metrics are last on rows', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            orderPriority: '1-URGENT',
            shipMode: 'AIR',
            averageOrderValue: 10,
            weightedDiscount: 0.05,
            profitMargin: 0.2,
          },
        ],
        metrics,
        ['orderPriority', 'shipMode'],
        [],
        2,
        0,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.ROWS,
        ['orderPriority', 'shipMode'],
        [],
        2,
      );
      const metricLabel = metrics[0];

      const { unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderPriority', 'shipMode', METRICS_PLACEHOLDER],
            groupbyColumns: [],
            metricsLayout: MetricsLayoutEnum.ROWS,
            metrics,
          })}
          metrics={metrics}
          groupbyRows={['orderPriority', 'shipMode']}
          groupbyColumns={[]}
          {...baseProps}
        />,
      );

      const shipModeRow = screen
        .getByText('AIR')
        .closest('tr') as HTMLTableRowElement;
      const metricRow = screen
        .getAllByText(metricLabel)[0]
        .closest('tr') as HTMLTableRowElement;
      const shipIndent = (shipModeRow.querySelector('th div') as HTMLElement)
        .style.paddingLeft;
      const metricIndent = (metricRow.querySelector('th div') as HTMLElement)
        .style.paddingLeft;

      expect(parseInt(metricIndent, 10)).toBeGreaterThan(
        parseInt(shipIndent, 10),
      );
      unmount();
    });
  });

  it('does not show toggles on leaf rows when metrics are on columns', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand'];
    const colGroupby = ['discountBand', 'shipMode'];
    const metricPosition = 1;
    const treeRaw = buildTreeFromRecords(
      [
        {
          quantityBand: '1-5',
          discountBand: '10k-50k',
          shipMode: 'AIR',
          averageOrderValue: 10,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      2,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      metricPosition,
    );
    const rowKey = serializePath(['1-5']);
    tree.rows[rowKey] = { ...tree.rows[rowKey], hasChildren: true };

    const formData = buildFormData({
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: rowGroupby,
      groupbyColumns: ['discountBand', METRICS_PLACEHOLDER, 'shipMode'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics,
    });

    const { result } = renderHook(() => {
      const layout = usePivotLayout({
        formData,
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        startCollapsed: false,
        initialDepth: 1,
        rowTotals: false,
        colTotals: false,
        rowSubTotals: false,
        rowSubtotalLevels: [],
        colSubtotalLevels: [],
        rowTotalPosition: 'start',
        rowSubtotalPosition: 'start',
        colTotalPosition: 'start',
        colSubtotalPosition: 'start',
      });
      return usePivotRenderModel({
        tree,
        expandedRows: new Set(),
        expandedCols: new Set(),
        loadingKeys: new Set(),
        isHydrating: false,
        formData,
        rowOrder: baseProps.rowOrder,
        colOrder: baseProps.colOrder,
        groupbyRows: rowGroupby,
        groupbyColumns: colGroupby,
        colTypeMap: {},
        rowTotals: false,
        colTotals: false,
        rowSubTotals: false,
        layout,
      });
    });

    expect(result.current.shouldShowToggle('row', tree.rows[rowKey])).toBe(
      false,
    );
  });

  it('hides column toggles when Values are pre-expanded at the column end', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['discountBand'];
    const colGroupby = ['quantityBand'];
    const treeRaw = buildTreeFromRecords(
      [
        {
          discountBand: '0-2%',
          quantityBand: '1-5',
          averageOrderValue: 10,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
    );

    const formData = buildFormData({
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: rowGroupby,
      groupbyColumns: ['quantityBand', METRICS_PLACEHOLDER],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics,
    });

    const { result } = renderHook(() => {
      const layout = usePivotLayout({
        formData,
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        startCollapsed: false,
        initialDepth: 1,
        rowTotals: false,
        colTotals: false,
        rowSubTotals: false,
        rowSubtotalLevels: [],
        colSubtotalLevels: [],
        rowTotalPosition: 'start',
        rowSubtotalPosition: 'start',
        colTotalPosition: 'start',
        colSubtotalPosition: 'start',
      });
      return usePivotRenderModel({
        tree,
        expandedRows: new Set(),
        expandedCols: new Set(),
        loadingKeys: new Set(),
        isHydrating: false,
        formData,
        rowOrder: baseProps.rowOrder,
        colOrder: baseProps.colOrder,
        groupbyRows: rowGroupby,
        groupbyColumns: colGroupby,
        colTypeMap: {},
        rowTotals: false,
        colTotals: false,
        rowSubTotals: false,
        layout,
      });
    });

    const colKey = serializePath(['1-5']);
    const colNode = result.current.renderTree.cols[colKey];
    expect(colNode).toBeDefined();
    expect(result.current.shouldShowToggle('col', colNode)).toBe(false);
  });

  it('hides row toggles when Values are pre-expanded under a single metric', () => {
    const metricKey = 'averageOrderValue';
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
    const rowGroupby = ['quantityBand'];
    const colGroupby: string[] = [];
    const baseTree = buildTreeFromRecords(
      [
        {
          quantityBand: '1-5',
          averageOrderValue: 10,
          'averageOrderValue__1 year ago': 8,
        },
      ],
      [metricKey],
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const tree = applyMeasureHierarchyAxis(
      baseTree,
      measureHierarchy,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );
    const rowKey = serializePath(['1-5']);

    const formData = buildFormData({
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
      groupbyColumns: [],
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: [metricKey],
      measureLeavesByMetric: {
        [metricKey]: [valueLeaf, ixLeaf],
      },
    });

    const { result } = renderHook(() => {
      const layout = usePivotLayout({
        formData,
        metricsLayout: MetricsLayoutEnum.ROWS,
        startCollapsed: false,
        initialDepth: 1,
        rowTotals: false,
        colTotals: false,
        rowSubTotals: false,
        rowSubtotalLevels: [],
        colSubtotalLevels: [],
        rowTotalPosition: 'start',
        rowSubtotalPosition: 'start',
        colTotalPosition: 'start',
        colSubtotalPosition: 'start',
      });
      return usePivotRenderModel({
        tree,
        expandedRows: new Set(),
        expandedCols: new Set(),
        loadingKeys: new Set(),
        isHydrating: false,
        formData,
        rowOrder: baseProps.rowOrder,
        colOrder: baseProps.colOrder,
        groupbyRows: rowGroupby,
        groupbyColumns: colGroupby,
        colTypeMap: {},
        rowTotals: false,
        colTotals: false,
        rowSubTotals: false,
        layout,
      });
    });

    expect(result.current.shouldShowToggle('row', tree.rows[rowKey])).toBe(
      false,
    );
  });

  it('does not render expand toggles on metric rows when metrics are last on rows', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            orderPriority: '1-URGENT',
            shipMode: 'AIR',
            averageOrderValue: 10,
            weightedDiscount: 0.05,
            profitMargin: 0.2,
          },
        ],
        metrics,
        ['orderPriority', 'shipMode'],
        [],
        2,
        0,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.ROWS,
        ['orderPriority', 'shipMode'],
        [],
        2,
      );
      const metricLabel = metrics[0];

      const { unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderPriority', 'shipMode', METRICS_PLACEHOLDER],
            groupbyColumns: [],
            metricsLayout: MetricsLayoutEnum.ROWS,
            metrics,
          })}
          metrics={metrics}
          groupbyRows={['orderPriority', 'shipMode']}
          groupbyColumns={[]}
          {...baseProps}
        />,
      );

      const metricRow = screen
        .getAllByText(metricLabel)[0]
        .closest('tr') as HTMLTableRowElement;
      expect(
        within(metricRow).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(metricRow).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();
      unmount();
    });
  });

  it('suppresses orderPriority toggle when metrics are between dimensions', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            orderPriority: '1-URGENT',
            shipMode: 'AIR',
            averageOrderValue: 10,
            weightedDiscount: 0.05,
            profitMargin: 0.2,
          },
        ],
        metrics,
        ['orderPriority', 'shipMode'],
        [],
        2,
        0,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.ROWS,
        ['orderPriority', 'shipMode'],
        [],
        1,
      );
      const metricLabel = metrics[0];

      const { unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderPriority', METRICS_PLACEHOLDER, 'shipMode'],
            groupbyColumns: [],
            metricsLayout: MetricsLayoutEnum.ROWS,
            metrics,
            startCollapsed: true,
            initialDepth: 1,
          })}
          metrics={metrics}
          groupbyRows={['orderPriority', 'shipMode']}
          groupbyColumns={[]}
          {...baseProps}
          startCollapsed
          initialDepth={1}
        />,
      );

      const priorityRow = screen
        .getByText('1-URGENT')
        .closest('tr') as HTMLTableRowElement;
      expect(
        within(priorityRow).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(priorityRow).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();

      const metricRow = screen
        .getAllByText(metricLabel)[0]
        .closest('tr') as HTMLTableRowElement;
      expect(
        within(metricRow).getByLabelText('plus-square'),
      ).toBeInTheDocument();
      unmount();
    });
  });

  it('suppresses column toggles on parent dimensions when metrics are between dimensions', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            orderPriority: '1-URGENT',
            shipMode: 'AIR',
            averageOrderValue: 10,
            weightedDiscount: 0.05,
            profitMargin: 0.2,
          },
        ],
        metrics,
        [],
        ['orderPriority', 'shipMode'],
        0,
        2,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.COLUMNS,
        [],
        ['orderPriority', 'shipMode'],
        1,
      );
      const metricLabel = metrics[0];

      const { unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: [],
            groupbyColumns: ['orderPriority', METRICS_PLACEHOLDER, 'shipMode'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
            startCollapsed: true,
            initialDepth: 1,
          })}
          metrics={metrics}
          groupbyRows={[]}
          groupbyColumns={['orderPriority', 'shipMode']}
          {...baseProps}
          startCollapsed
          initialDepth={1}
        />,
      );

      const priorityHeader = screen
        .getByText('1-URGENT')
        .closest('th') as HTMLElement;
      expect(
        within(priorityHeader).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(priorityHeader).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();

      const metricHeader = screen
        .getAllByText(new RegExp(metricLabel))[0]
        .closest('th') as HTMLElement;
      expect(
        within(metricHeader).getByLabelText('plus-square'),
      ).toBeInTheDocument();
      unmount();
    });
  });

  it('pre-expands the metric tier and hides parent toggles when a single metric sits between column dimensions', () => {
    const metrics = ['averageOrderValue'];
    const treeRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          averageOrderValue: 10,
        },
      ],
      metrics,
      [],
      ['orderPriority', 'shipMode'],
      0,
      1,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['orderPriority', 'shipMode'],
      1,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [],
          groupbyColumns: ['orderPriority', METRICS_PLACEHOLDER, 'shipMode'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          startCollapsed: true,
          initialDepth: 1,
        })}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={['orderPriority', 'shipMode']}
        {...baseProps}
        startCollapsed
        initialDepth={1}
      />,
    );

    const priorityHeader = screen
      .getByText('1-URGENT')
      .closest('th') as HTMLElement;
    expect(
      within(priorityHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(priorityHeader).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('averageOrderValue')).toBeInTheDocument();
  });
});
