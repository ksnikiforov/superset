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

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  METRICS_PLACEHOLDER,
} from '../../../src/utils';

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
    maxDepthPerFetch: 1,
    rowTotals: false,
    colTotals: false,
    rowSubTotals: false,
    colSubTotals: false,
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

      const shipModeRow = screen.getByText('AIR').closest('tr') as HTMLElement;
      const metricRow = screen.getAllByText(metricLabel)[0].closest(
        'tr',
      ) as HTMLElement;
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

      const metricRow = screen.getAllByText(metricLabel)[0].closest(
        'tr',
      ) as HTMLElement;
      expect(within(metricRow).queryByLabelText('plus-square')).toBeNull();
      expect(within(metricRow).queryByLabelText('minus-square')).toBeNull();
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

      const priorityRow = screen.getByText('1-URGENT').closest(
        'tr',
      ) as HTMLElement;
      expect(within(priorityRow).queryByLabelText('plus-square')).toBeNull();
      expect(within(priorityRow).queryByLabelText('minus-square')).toBeNull();

      const metricRow = screen.getAllByText(metricLabel)[0].closest(
        'tr',
      ) as HTMLElement;
      expect(within(metricRow).getByLabelText('plus-square')).toBeTruthy();
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

      const priorityHeader = screen.getByText('1-URGENT').closest(
        'th',
      ) as HTMLElement;
      expect(within(priorityHeader).queryByLabelText('plus-square')).toBeNull();
      expect(within(priorityHeader).queryByLabelText('minus-square')).toBeNull();

      const metricHeader = screen.getAllByText(
        new RegExp(metricLabel),
      )[0].closest(
        'th',
      ) as HTMLElement;
      expect(within(metricHeader).getByLabelText('plus-square')).toBeTruthy();
      unmount();
    });
  });
});
