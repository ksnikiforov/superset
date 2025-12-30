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
import {
  MetricsLayoutEnum,
  PivotTableProps,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { applyMetricAxis, buildTreeFromRecords, serializePath } from '../../../src/utils';

const baseFormData: Partial<PivotTableQueryFormData> = {
  groupbyRows: ['r1'],
  groupbyColumns: ['c1'],
  metrics: ['metric1'],
  aggregateFunction: 'Sum',
  rowTotals: false,
  colTotals: false,
  rowSubTotals: false,
  colSubTotals: false,
  rowSubtotalLevels: [],
  colSubtotalLevels: [],
  startCollapsed: false,
  initialDepth: 1,
  maxDepthPerFetch: 1,
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  metricsLayout: MetricsLayoutEnum.COLUMNS,
  viz_type: 'pivot_table_v3',
  datasource: '1__table',
  metricColorFormatters: [],
  dateFormatters: {},
};

const baseTree: PivotTreeData = {
  rows: {
    '': {
      axis: 'row',
      key: '',
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: true,
    },
    A: {
      axis: 'row',
      key: serializePath(['A']),
      path: ['A'],
      label: 'A',
      formattedLabel: 'A',
      level: 1,
      hasChildren: false,
    },
  },
  cols: {
    '': {
      axis: 'col',
      key: '',
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: true,
    },
    C1: {
      axis: 'col',
      key: serializePath(['C1']),
      path: ['C1'],
      label: 'C1',
      formattedLabel: 'C1',
      level: 1,
      hasChildren: true,
    },
    'C1__metric1': {
      axis: 'col',
      key: serializePath(['C1', 'metric1']),
      path: ['C1', 'metric1'],
      label: 'metric1',
      formattedLabel: 'metric1',
      level: 2,
      hasChildren: false,
    },
  },
  cells: {
    [`${serializePath(['A'])}|${serializePath(['C1'])}`]: {
      rowKey: serializePath(['A']),
      colKey: serializePath(['C1']),
      values: { metric1: 10 },
    },
    [`${serializePath(['A'])}|${serializePath(['C1', 'metric1'])}`]: {
      rowKey: serializePath(['A']),
      colKey: serializePath(['C1', 'metric1']),
      values: { metric1: 10 },
    },
  },
};

describe('PivotTableChart metric tier suppression', () => {
  it('hides the metric column header when there is a single metric at the last column level', () => {
    const props: Partial<PivotTableProps> = {
      data: baseTree,
      formData: buildFormData(baseFormData),
      metrics: ['metric1'],
      groupbyRows: ['r1'],
      groupbyColumns: ['c1'],
      aggregateFunction: 'Sum',
      width: 400,
      height: 300,
      startCollapsed: false,
      initialDepth: 1,
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

    render(<PivotTableChart {...props} />);

    expect(screen.queryByText('metric1')).toBeNull();
    expect(screen.getByText('C1')).toBeTruthy();
  });

  it('keeps metric tier hidden on rows when the metric is at the bottom of the hierarchy', () => {
    const treeWithMetricBottom: PivotTreeData = {
      rows: {
        '': {
          axis: 'row',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        USA: {
          axis: 'row',
          key: serializePath(['USA']),
          path: ['USA'],
          label: 'USA',
          formattedLabel: 'USA',
          level: 1,
          hasChildren: true,
        },
        'USA__1-URGENT': {
          axis: 'row',
          key: serializePath(['USA', '1-URGENT']),
          path: ['USA', '1-URGENT'],
          label: '1-URGENT',
          formattedLabel: '1-URGENT',
          level: 2,
          hasChildren: true,
        },
      },
      cols: {
        '': {
          axis: 'col',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: false,
        },
      },
      cells: {
        [`${serializePath(['USA', '1-URGENT'])}|`]: {
          rowKey: serializePath(['USA', '1-URGENT']),
          colKey: '',
          values: { countCustomers: 5 },
        },
      },
    };

    const props: Partial<PivotTableProps> = {
      data: treeWithMetricBottom,
      formData: buildFormData({
        ...baseFormData,
        groupbyRows: ['nation', 'orderPriority'],
        groupbyColumns: ['segment'],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
      metrics: ['countCustomers'],
      groupbyRows: ['nation', 'orderPriority'],
      groupbyColumns: ['segment'],
      aggregateFunction: 'Sum',
      width: 400,
      height: 300,
      startCollapsed: false,
      initialDepth: 3,
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

    render(<PivotTableChart {...props} />);

    // Metric label should not show as a row header; the second level should be orderPriority.
    expect(screen.queryAllByText('countCustomers')).toHaveLength(0);
    expect(screen.getByText('1-URGENT')).toBeTruthy();
  });
});

describe('PivotTableChart multi-metric visibility', () => {
  const metricsVariants = [
    ['measure1', 'measure2'],
    ['measure1', 'measure2', 'measure3'],
  ];

  it('shows metrics under a collapsed row group when multiple metrics are selected', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            group: 'Bikes',
            product: 'Road',
            measure1: 10,
            measure2: 20,
            measure3: 30,
          },
          {
            group: 'Bikes',
            product: 'Mountain',
            measure1: 5,
            measure2: 15,
            measure3: 25,
          },
        ],
        metrics,
        ['group', 'product'],
        [],
        2,
        0,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.ROWS,
        ['group', 'product'],
        [],
        2,
      );

      const { container, unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseFormData as Partial<PivotTableQueryFormData>),
            groupbyRows: ['group', 'product'],
            groupbyColumns: [],
            metricsLayout: MetricsLayoutEnum.ROWS,
            metrics,
          })}
          metrics={metrics}
          groupbyRows={['group', 'product']}
          groupbyColumns={[]}
          aggregateFunction="Sum"
          width={400}
          height={300}
          startCollapsed
          initialDepth={1}
          maxDepthPerFetch={1}
          rowTotals={false}
          colTotals={false}
          rowSubTotals={false}
          colSubTotals={false}
          rowSubtotalLevels={[]}
          colSubtotalLevels={[]}
          rowOrder="key_a_to_z"
          colOrder="key_a_to_z"
          valueFormat=""
          columnFormats={{}}
          currencyFormats={{}}
          allowRenderHtml={false}
          emitCrossFilters={false}
          setDataMask={jest.fn()}
          metricColorFormatters={[]}
          dateFormatters={{}}
        />,
      );

      const rowHeaders = Array.from(
        container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
      ).map(cell => cell.textContent?.trim());

      expect(rowHeaders).toEqual(
        expect.arrayContaining(['Bikes', ...metrics]),
      );
      expect(rowHeaders).not.toEqual(
        expect.arrayContaining(['Road', 'Mountain']),
      );

      const groupRow = screen.getByText('Bikes').closest('tr') as HTMLElement;
      expect(within(groupRow).getByLabelText('plus-square')).toBeTruthy();

      const metricRow = screen.getAllByText(metrics[0])[0].closest(
        'tr',
      ) as HTMLElement;
      expect(within(metricRow).queryByLabelText('plus-square')).toBeNull();
      expect(within(metricRow).queryByLabelText('minus-square')).toBeNull();
      unmount();
    });
  });

  it('shows metrics under collapsed columns when multiple metrics are selected', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            group: 'Bikes',
            product: 'Road',
            measure1: 10,
            measure2: 20,
            measure3: 30,
          },
          {
            group: 'Bikes',
            product: 'Mountain',
            measure1: 5,
            measure2: 15,
            measure3: 25,
          },
        ],
        metrics,
        [],
        ['group', 'product'],
        0,
        2,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.COLUMNS,
        [],
        ['group', 'product'],
        2,
      );

      const { container, unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseFormData as Partial<PivotTableQueryFormData>),
            groupbyRows: [],
            groupbyColumns: ['group', 'product', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
          })}
          metrics={metrics}
          groupbyRows={[]}
          groupbyColumns={['group', 'product']}
          aggregateFunction="Sum"
          width={400}
          height={300}
          startCollapsed
          initialDepth={1}
          maxDepthPerFetch={1}
          rowTotals={false}
          colTotals={false}
          rowSubTotals={false}
          colSubTotals={false}
          rowSubtotalLevels={[]}
          colSubtotalLevels={[]}
          rowOrder="key_a_to_z"
          colOrder="key_a_to_z"
          valueFormat=""
          columnFormats={{}}
          currencyFormats={{}}
          allowRenderHtml={false}
          emitCrossFilters={false}
          setDataMask={jest.fn()}
          metricColorFormatters={[]}
          dateFormatters={{}}
        />,
      );

      const headerLabels = Array.from(
        container.querySelectorAll('thead th') as NodeListOf<HTMLElement>,
      ).map(cell => cell.textContent?.trim());

      expect(headerLabels).toEqual(expect.arrayContaining(metrics));
      expect(headerLabels).not.toEqual(
        expect.arrayContaining(['Road', 'Mountain']),
      );
      unmount();
    });
  });

  it('keeps metrics on columns when both row and column hierarchies are present', () => {
    const treeRaw = buildTreeFromRecords(
      [
        {
          group: 'Bikes',
          product: 'Bike1',
          col_lvl1: 'L1',
          col_lvl2: 'X',
          m1: 4,
          m2: 8,
        },
        {
          group: 'Bikes',
          product: 'Bike2',
          col_lvl1: 'L1',
          col_lvl2: 'Y',
          m1: 2,
          m2: 6,
        },
      ],
      ['m1', 'm2'],
      ['group', 'product'],
      ['col_lvl1', 'col_lvl2'],
      2,
      2,
    );
    const tree = applyMetricAxis(
      treeRaw,
      ['m1', 'm2'],
      MetricsLayoutEnum.COLUMNS,
      ['group', 'product'],
      ['col_lvl1', 'col_lvl2'],
      2,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseFormData as Partial<PivotTableQueryFormData>),
          groupbyRows: ['group', 'product'],
          groupbyColumns: ['col_lvl1', 'col_lvl2', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['m1', 'm2'],
        })}
        metrics={['m1', 'm2']}
        groupbyRows={['group', 'product']}
        groupbyColumns={['col_lvl1', 'col_lvl2']}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        maxDepthPerFetch={1}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toEqual(expect.arrayContaining(['m1', 'm2']));

    const headerLabels = Array.from(
      container.querySelectorAll('thead th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(headerLabels).toEqual(expect.arrayContaining(['m1', 'm2']));
  });
});
