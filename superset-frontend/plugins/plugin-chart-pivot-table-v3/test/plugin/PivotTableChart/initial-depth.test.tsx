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

import { ChartProps, supersetTheme } from '@superset-ui/core';
import { render, screen, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import transformProps from '../../../src/transformProps';
import {
  MetricsLayoutEnum,
  PivotResultCell,
  PivotTableQueryFormData,
  PivotTreeData,
  PivotTreeNode,
} from '../../../src/types';
import { formatQueryName } from '../../../src/buildQuery';
import { buildFormData } from '../fixtures/pivotFormData';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  METRICS_PLACEHOLDER,
  serializeCellKey,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../../src/utils';

describe('PivotTableChart initial depth on collapsed render', () => {
  const metricsVariants = [
    ['quantitySold'],
    ['quantitySold', 'profit'],
    ['quantitySold', 'profit', 'discount'],
  ];
  const baseProps = {
    aggregateFunction: 'Sum',
    width: 400,
    height: 300,
    startCollapsed: true,
    initialDepth: 1,
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

  it('shows first column level when collapsed with initialDepth=1', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            orderStatus: 'F',
            orderPriority: 'A',
            revenueBand: '10k-50k',
            returnFlag: 'Y',
            quantitySold: 10,
            profit: 3,
            discount: 1,
          },
        ],
        metrics,
        ['orderStatus'],
        ['orderPriority', 'revenueBand', 'returnFlag'],
        1,
        3,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.COLUMNS,
        ['orderStatus'],
        ['orderPriority', 'revenueBand', 'returnFlag'],
        3,
      );

      const { unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderStatus'],
            groupbyColumns: [
              'orderPriority',
              'revenueBand',
              'returnFlag',
              '__MEASURES__',
            ],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
          })}
          metrics={metrics}
          groupbyRows={['orderStatus']}
          groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
          aggregateFunction="Sum"
          width={400}
          height={300}
          startCollapsed
          initialDepth={1}
          colTotals={false}
          rowTotals={false}
          rowSubTotals={false}
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

      // First column level (orderPriority) should render even when collapsed.
      expect(screen.getByText('A')).toBeInTheDocument();
      // Only one visible column level; deeper levels should not render until expanded.
      expect(screen.queryByText('10k-50k')).not.toBeInTheDocument();
      unmount();
    });
  });

  it('renders top-level column headers for multi-column layout when data is present', () => {
    const metrics = ['quantitySold'];
    const treeRaw = buildTreeFromRecords(
      [
        {
          orderStatus: 'F',
          orderPriority: 'A',
          revenueBand: '10k-50k',
          returnFlag: 'Y',
          quantitySold: 10,
          profit: 3,
          discount: 1,
        },
        {
          orderStatus: 'O',
          orderPriority: 'N',
          revenueBand: '1k-5k',
          returnFlag: 'N',
          quantitySold: 5,
          profit: 2,
          discount: 0,
        },
      ],
      metrics,
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      1,
      3,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['orderStatus'],
      ['orderPriority', 'revenueBand', 'returnFlag'],
      3,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderStatus'],
          groupbyColumns: [
            'orderPriority',
            'revenueBand',
            'returnFlag',
            '__MEASURES__',
          ],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
        })}
        metrics={metrics}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
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

    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const headers = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headers).toEqual(expect.arrayContaining(['A', 'N']));
    expect(headers).not.toEqual(['Grand total']);
  });

  it('fails when only grand total column renders for multi-column selection (regression guard)', () => {
    // Simulate a broken response that labels colDepth=0 but still returns column groupbys.
    const metrics = ['quantitySold', 'profit', 'discount'];
    const formData = buildFormData({
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: ['orderStatus'],
      groupbyColumns: [
        'orderPriority',
        'revenueBand',
        'returnFlag',
        METRICS_PLACEHOLDER,
      ],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics,
      viz_type: 'pivot_table_v3',
      datasource: '1__table',
    });
    const chartProps = new ChartProps({
      formData,
      width: 600,
      height: 300,
      queriesData: [
        {
          data: [
            {
              orderStatus: 'F',
              orderPriority: 'A',
              revenueBand: '10k-50k',
              returnFlag: 'Y',
              quantitySold: 10,
              profit: 3,
              discount: 1,
            },
            {
              orderStatus: 'O',
              orderPriority: 'N',
              revenueBand: '1k-5k',
              returnFlag: 'N',
              quantitySold: 5,
              profit: 2,
              discount: 0,
            },
          ],
          colnames: [
            'orderStatus',
            'orderPriority',
            'revenueBand',
            'returnFlag',
            'quantitySold',
            'profit',
            'discount',
          ],
          coltypes: [1, 1, 1, 1, 0, 0, 0],
          query_name: formatQueryName(1, 0),
        },
      ],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: { verboseMap: {}, columnFormats: {}, currencyFormats: {} },
      theme: supersetTheme,
    });
    const { data: tree } = transformProps(chartProps);

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData(formData)}
        metrics={metrics}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
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

    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const headers = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headers.length).toBeGreaterThan(1);
    expect(headers).not.toEqual(['Grand total']);
  });

  it('does not render row grand total when row totals/subtotals are disabled', () => {
    metricsVariants.forEach(metrics => {
      const treeRaw = buildTreeFromRecords(
        [
          {
            orderStatus: 'F',
            orderPriority: 'A',
            revenueBand: '10k-50k',
            returnFlag: 'Y',
            quantitySold: 10,
            profit: 3,
            discount: 1,
          },
        ],
        metrics,
        ['orderStatus'],
        ['orderPriority', 'revenueBand', 'returnFlag'],
        1,
        3,
      );
      const tree = applyMetricAxis(
        treeRaw,
        metrics,
        MetricsLayoutEnum.COLUMNS,
        ['orderStatus'],
        ['orderPriority', 'revenueBand', 'returnFlag'],
        3,
      );

      const { container, unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderStatus'],
            groupbyColumns: [
              'orderPriority',
              'revenueBand',
              'returnFlag',
              '__MEASURES__',
            ],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
            colTotals: false,
            rowSubTotals: false,
            rowSubtotalLevels: [],
          })}
          metrics={metrics}
          groupbyRows={['orderStatus']}
          groupbyColumns={['orderPriority', 'revenueBand', 'returnFlag']}
          aggregateFunction="Sum"
          width={600}
          height={300}
          startCollapsed
          initialDepth={1}
          colTotals={false}
          rowTotals={false}
          rowSubTotals={false}
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
      expect(rowHeaders).toEqual(expect.arrayContaining(['F']));
      expect(rowHeaders).not.toContain('Grand total');
      unmount();
    });
  });

  it('hides row subtotals when rowSubTotals is disabled', () => {
    const rootKey = serializePath([]);
    const subtotalRowKey = serializePath([SUBTOTAL_TOKEN]);
    const metrics = ['metric1', 'metric2', 'metric3'];
    const rows: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: true,
        isSubtotal: true,
      },
      [serializePath(['F'])]: {
        axis: 'row',
        key: serializePath(['F']),
        path: ['F'],
        label: 'F',
        formattedLabel: 'F',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [subtotalRowKey]: {
        axis: 'row',
        key: subtotalRowKey,
        path: [SUBTOTAL_TOKEN],
        label: 'Subtotal',
        formattedLabel: 'Subtotal',
        level: 1,
        hasChildren: false,
        isSubtotal: true,
      },
    };
    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'col',
        key: rootKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: false,
        isSubtotal: true,
      },
      [serializePath(['A'])]: {
        axis: 'col',
        key: serializePath(['A']),
        path: ['A'],
        label: 'A',
        formattedLabel: 'A',
        level: 1,
        hasChildren: false,
        isSubtotal: true,
      },
    };
    const colKey = serializePath(['A']);
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(serializePath(['F']), colKey)]: {
        rowKey: serializePath(['F']),
        colKey,
        values: { metric1: 10, metric2: 20, metric3: 30 },
      },
      [serializeCellKey(subtotalRowKey, colKey)]: {
        rowKey: subtotalRowKey,
        colKey,
        values: { metric1: 5, metric2: 15, metric3: 25 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderStatus'],
          groupbyColumns: ['orderPriority', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colSubtotalLevels: [0],
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={['orderStatus']}
        groupbyColumns={['orderPriority']}
        aggregateFunction="Sum"
        width={400}
        height={200}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[0]}
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
    expect(rowHeaders).not.toContain('Subtotal');
  });
});
