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
import { render, screen, within } from '../../../testUtils';
import TestPivotTableChart, {
  buildPreloadedTreeFactBatches,
} from '../../fixtures/TestPivotTableChart';
import {
  MetricsLayoutEnum,
  PivotResultCell,
  PivotExpansionState,
  PivotTableQueryFormData,
  PivotTreeData,
  PivotTreeNode,
} from '../../../../src/types';
import { buildFormData } from '../../fixtures/pivotFormData';
import {
  applyMetricAxis,
  applyMeasureHierarchyAxis,
  buildTreeFromRecords,
  encodeMetricKey,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  mergeTrees,
  METRICS_PLACEHOLDER,
  serializeCellKey,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../../../src/utils';
import {
  applyMeasureLeafValuesToTree,
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';

type TestPivotTableChartProps = ComponentProps<typeof TestPivotTableChart>;

function PivotTableChart(props: TestPivotTableChartProps) {
  return (
    <TestPivotTableChart
      {...props}
      factBatches={
        props.factBatches ??
        buildPreloadedTreeFactBatches(props.data, {
          groupbyRows: props.groupbyRows ?? [],
          groupbyColumns: props.groupbyColumns ?? [],
        })
      }
    />
  );
}

describe('PivotTableChart totals & subtotals - rows', () => {
  const baseProps = {
    aggregateFunction: 'Sum',
    width: 400,
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

  it('renders row subtotals inline by default when enabled', () => {
    const rootKey = serializePath([]);
    const groupKey = serializePath(['Bikes']);
    const subtotalKey = serializePath(['Bikes', SUBTOTAL_TOKEN]);
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
      [groupKey]: {
        axis: 'row',
        key: groupKey,
        path: ['Bikes'],
        label: 'Bikes',
        formattedLabel: 'Bikes',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [serializePath(['Bikes', 'Alpha'])]: {
        axis: 'row',
        key: serializePath(['Bikes', 'Alpha']),
        path: ['Bikes', 'Alpha'],
        label: 'Alpha',
        formattedLabel: 'Alpha',
        level: 2,
        hasChildren: false,
        isSubtotal: false,
      },
      [serializePath(['Bikes', 'Zebra'])]: {
        axis: 'row',
        key: serializePath(['Bikes', 'Zebra']),
        path: ['Bikes', 'Zebra'],
        label: 'Zebra',
        formattedLabel: 'Zebra',
        level: 2,
        hasChildren: false,
        isSubtotal: false,
      },
      [subtotalKey]: {
        axis: 'row',
        key: subtotalKey,
        path: ['Bikes', SUBTOTAL_TOKEN],
        label: 'Bikes Total',
        formattedLabel: 'Bikes Total',
        level: 2,
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
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(groupKey, rootKey)]: {
        rowKey: groupKey,
        colKey: rootKey,
        values: { metric1: 30 },
      },
      [serializeCellKey(serializePath(['Bikes', 'Alpha']), rootKey)]: {
        rowKey: serializePath(['Bikes', 'Alpha']),
        colKey: rootKey,
        values: { metric1: 10 },
      },
      [serializeCellKey(serializePath(['Bikes', 'Zebra']), rootKey)]: {
        rowKey: serializePath(['Bikes', 'Zebra']),
        colKey: rootKey,
        values: { metric1: 20 },
      },
      [serializeCellKey(subtotalKey, rootKey)]: {
        rowKey: subtotalKey,
        colKey: rootKey,
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [serializeCellKey(rootKey, rootKey)]: {
        rowKey: rootKey,
        colKey: rootKey,
        values: { metric1: 30 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const props: Partial<PivotTableQueryFormData> = {
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: ['group', 'product'],
      groupbyColumns: [],
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['metric1'],
      rowSubTotals: true,
      colTotals: true,
      rowSubtotalPosition: 'start',
    };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData(props)}
        metrics={['metric1']}
        groupbyRows={['group', 'product']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals
        rowTotals={false}
        rowSubTotals
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(
      expect.arrayContaining(['Bikes', 'Alpha', 'Zebra']),
    );
    expect(rowHeaders).not.toContain('Bikes Total');

    const bikesRow = screen
      .getByText('Bikes')
      .closest('tr') as HTMLTableRowElement;
    const valueCell = within(bikesRow).getAllByRole('cell')[0];
    expect(valueCell.textContent?.trim()).toBe('30');
  });

  it('labels single-metric subtotal rows as "<Group> Total"', () => {
    const rootKey = serializePath([]);
    const groupKey = serializePath(['Bikes']);
    const subtotalKey = serializePath([
      'Bikes',
      SUBTOTAL_TOKEN,
      encodeMetricKey('metric1'),
    ]);
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
      [groupKey]: {
        axis: 'row',
        key: groupKey,
        path: ['Bikes'],
        label: 'Bikes',
        formattedLabel: 'Bikes',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [subtotalKey]: {
        axis: 'row',
        key: subtotalKey,
        path: ['Bikes', SUBTOTAL_TOKEN, encodeMetricKey('metric1')],
        label: 'Subtotal',
        formattedLabel: 'Subtotal',
        level: 3,
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
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(subtotalKey, rootKey)]: {
        rowKey: subtotalKey,
        colKey: rootKey,
        values: { metric1: 30 },
        isSubtotal: true,
      },
    };
    const tree = labelRowSubtotalLeaves({ rows, cols, cells }, ['metric1']);

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['group'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: ['metric1'],
          rowSubTotals: true,
          rowSubtotalLevels: [1],
          rowSubtotalPosition: 'end',
        })}
        metrics={['metric1']}
        groupbyRows={['group']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    expect(screen.getByText('Bikes Total')).toBeInTheDocument();
    expect(screen.queryByText('Bikes metric1')).not.toBeInTheDocument();
  });

  it('keeps row subtotal values inline and suppresses subtotal rows when expanded at top position (multi-metric columns)', () => {
    const rootKey = serializePath([]);
    const urgentKey = serializePath(['1-URGENT']);
    const subtotalKey = serializePath(['1-URGENT', SUBTOTAL_TOKEN]);
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
      [urgentKey]: {
        axis: 'row',
        key: urgentKey,
        path: ['1-URGENT'],
        label: '1-URGENT',
        formattedLabel: '1-URGENT',
        level: 1,
        hasChildren: true,
        isSubtotal: true,
      },
      [serializePath(['1-URGENT', 'AIR'])]: {
        axis: 'row',
        key: serializePath(['1-URGENT', 'AIR']),
        path: ['1-URGENT', 'AIR'],
        label: 'AIR',
        formattedLabel: 'AIR',
        level: 2,
        hasChildren: false,
        isSubtotal: false,
      },
      [subtotalKey]: {
        axis: 'row',
        key: subtotalKey,
        path: ['1-URGENT', SUBTOTAL_TOKEN],
        label: '1-URGENT Total',
        formattedLabel: '1-URGENT Total',
        level: 2,
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
        hasChildren: true,
        isSubtotal: true,
      },
      averageOrderValue: {
        axis: 'col',
        key: serializePath([encodeMetricKey('averageOrderValue')]),
        path: [encodeMetricKey('averageOrderValue')],
        label: 'averageOrderValue',
        formattedLabel: 'averageOrderValue',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
      weightedDiscount: {
        axis: 'col',
        key: serializePath([encodeMetricKey('weightedDiscount')]),
        path: [encodeMetricKey('weightedDiscount')],
        label: 'weightedDiscount',
        formattedLabel: 'weightedDiscount',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(
        urgentKey,
        serializePath([encodeMetricKey('averageOrderValue')]),
      )]: {
        rowKey: urgentKey,
        colKey: serializePath([encodeMetricKey('averageOrderValue')]),
        values: { averageOrderValue: 10 },
      },
      [serializeCellKey(
        urgentKey,
        serializePath([encodeMetricKey('weightedDiscount')]),
      )]: {
        rowKey: urgentKey,
        colKey: serializePath([encodeMetricKey('weightedDiscount')]),
        values: { weightedDiscount: 0.05 },
      },
      [serializeCellKey(
        serializePath(['1-URGENT', 'AIR']),
        serializePath([encodeMetricKey('averageOrderValue')]),
      )]: {
        rowKey: serializePath(['1-URGENT', 'AIR']),
        colKey: serializePath([encodeMetricKey('averageOrderValue')]),
        values: { averageOrderValue: 5 },
      },
      [serializeCellKey(
        serializePath(['1-URGENT', 'AIR']),
        serializePath([encodeMetricKey('weightedDiscount')]),
      )]: {
        rowKey: serializePath(['1-URGENT', 'AIR']),
        colKey: serializePath([encodeMetricKey('weightedDiscount')]),
        values: { weightedDiscount: 0.02 },
      },
      [serializeCellKey(
        subtotalKey,
        serializePath([encodeMetricKey('averageOrderValue')]),
      )]: {
        rowKey: subtotalKey,
        colKey: serializePath([encodeMetricKey('averageOrderValue')]),
        values: { averageOrderValue: 10 },
        isSubtotal: true,
      },
      [serializeCellKey(
        subtotalKey,
        serializePath([encodeMetricKey('weightedDiscount')]),
      )]: {
        rowKey: subtotalKey,
        colKey: serializePath([encodeMetricKey('weightedDiscount')]),
        values: { weightedDiscount: 0.05 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority', 'shipMode'],
          groupbyColumns: [METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['averageOrderValue', 'weightedDiscount'],
          rowSubTotals: true,
          rowSubtotalLevels: [1],
          rowSubtotalPosition: 'start',
        })}
        metrics={['averageOrderValue', 'weightedDiscount']}
        groupbyRows={['orderPriority', 'shipMode']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(expect.arrayContaining(['1-URGENT', 'AIR']));
    expect(rowHeaders).not.toContain('1-URGENT Total');

    const urgentRow = screen
      .getByText('1-URGENT')
      .closest('tr') as HTMLTableRowElement;
    const values = within(urgentRow)
      .getAllByRole('cell')
      .map(cell => cell.textContent?.trim());
    expect(values).toEqual(expect.arrayContaining(['10', '0.05']));
  });

  it('places row subtotals after children when rowSubtotalPosition is end', () => {
    const rootKey = serializePath([]);
    const groupKey = serializePath(['Bikes']);
    const subtotalKey = serializePath(['Bikes', SUBTOTAL_TOKEN]);
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
      [groupKey]: {
        axis: 'row',
        key: groupKey,
        path: ['Bikes'],
        label: 'Bikes',
        formattedLabel: 'Bikes',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [serializePath(['Bikes', 'Alpha'])]: {
        axis: 'row',
        key: serializePath(['Bikes', 'Alpha']),
        path: ['Bikes', 'Alpha'],
        label: 'Alpha',
        formattedLabel: 'Alpha',
        level: 2,
        hasChildren: false,
        isSubtotal: false,
      },
      [serializePath(['Bikes', 'Zebra'])]: {
        axis: 'row',
        key: serializePath(['Bikes', 'Zebra']),
        path: ['Bikes', 'Zebra'],
        label: 'Zebra',
        formattedLabel: 'Zebra',
        level: 2,
        hasChildren: false,
        isSubtotal: false,
      },
      [subtotalKey]: {
        axis: 'row',
        key: subtotalKey,
        path: ['Bikes', SUBTOTAL_TOKEN],
        label: 'Bikes Total',
        formattedLabel: 'Bikes Total',
        level: 2,
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
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(groupKey, rootKey)]: {
        rowKey: groupKey,
        colKey: rootKey,
        values: { metric1: null },
      },
      [serializeCellKey(serializePath(['Bikes', 'Alpha']), rootKey)]: {
        rowKey: serializePath(['Bikes', 'Alpha']),
        colKey: rootKey,
        values: { metric1: 10 },
      },
      [serializeCellKey(serializePath(['Bikes', 'Zebra']), rootKey)]: {
        rowKey: serializePath(['Bikes', 'Zebra']),
        colKey: rootKey,
        values: { metric1: 20 },
      },
      [serializeCellKey(subtotalKey, rootKey)]: {
        rowKey: subtotalKey,
        colKey: rootKey,
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [serializeCellKey(rootKey, rootKey)]: {
        rowKey: rootKey,
        colKey: rootKey,
        values: { metric1: 30 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const props: Partial<PivotTableQueryFormData> = {
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: ['group', 'product'],
      groupbyColumns: [],
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['metric1'],
      rowSubTotals: true,
      colTotals: true,
      rowSubtotalPosition: 'end',
    };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData(props)}
        metrics={['metric1']}
        groupbyRows={['group', 'product']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals
        rowTotals={false}
        rowSubTotals
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders.indexOf('Bikes Total')).toBeGreaterThan(
      rowHeaders.indexOf('Zebra'),
    );

    const bikesRow = screen
      .getByText('Bikes')
      .closest('tr') as HTMLTableRowElement;
    const bikesValue = within(bikesRow).getAllByRole('cell')[0];
    expect(bikesValue.textContent?.trim()).toBe('');

    const subtotalRow = screen
      .getByText('Bikes Total')
      .closest('tr') as HTMLTableRowElement;
    const subtotalHeader = subtotalRow.querySelector('th') as HTMLElement;
    expect(subtotalHeader.className).toContain('subtotal-cell');
    expect(
      within(subtotalHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
  });

  it('keeps row subtotal values inline while collapsed when rowSubtotalPosition is end (multi-metric columns)', () => {
    const rootKey = serializePath([]);
    const urgentKey = serializePath(['1-URGENT']);
    const subtotalKey = serializePath(['1-URGENT', SUBTOTAL_TOKEN]);
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
      [urgentKey]: {
        axis: 'row',
        key: urgentKey,
        path: ['1-URGENT'],
        label: '1-URGENT',
        formattedLabel: '1-URGENT',
        level: 1,
        hasChildren: true,
        isSubtotal: true,
      },
      [serializePath(['1-URGENT', 'AIR'])]: {
        axis: 'row',
        key: serializePath(['1-URGENT', 'AIR']),
        path: ['1-URGENT', 'AIR'],
        label: 'AIR',
        formattedLabel: 'AIR',
        level: 2,
        hasChildren: false,
        isSubtotal: false,
      },
      [subtotalKey]: {
        axis: 'row',
        key: subtotalKey,
        path: ['1-URGENT', SUBTOTAL_TOKEN],
        label: '1-URGENT Total',
        formattedLabel: '1-URGENT Total',
        level: 2,
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
        hasChildren: true,
        isSubtotal: true,
      },
      averageOrderValue: {
        axis: 'col',
        key: serializePath([encodeMetricKey('averageOrderValue')]),
        path: [encodeMetricKey('averageOrderValue')],
        label: 'averageOrderValue',
        formattedLabel: 'averageOrderValue',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
      weightedDiscount: {
        axis: 'col',
        key: serializePath([encodeMetricKey('weightedDiscount')]),
        path: [encodeMetricKey('weightedDiscount')],
        label: 'weightedDiscount',
        formattedLabel: 'weightedDiscount',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(
        urgentKey,
        serializePath([encodeMetricKey('averageOrderValue')]),
      )]: {
        rowKey: urgentKey,
        colKey: serializePath([encodeMetricKey('averageOrderValue')]),
        values: { averageOrderValue: 10 },
      },
      [serializeCellKey(
        urgentKey,
        serializePath([encodeMetricKey('weightedDiscount')]),
      )]: {
        rowKey: urgentKey,
        colKey: serializePath([encodeMetricKey('weightedDiscount')]),
        values: { weightedDiscount: 0.05 },
      },
      [serializeCellKey(
        subtotalKey,
        serializePath([encodeMetricKey('averageOrderValue')]),
      )]: {
        rowKey: subtotalKey,
        colKey: serializePath([encodeMetricKey('averageOrderValue')]),
        values: { averageOrderValue: 10 },
        isSubtotal: true,
      },
      [serializeCellKey(
        subtotalKey,
        serializePath([encodeMetricKey('weightedDiscount')]),
      )]: {
        rowKey: subtotalKey,
        colKey: serializePath([encodeMetricKey('weightedDiscount')]),
        values: { weightedDiscount: 0.05 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority', 'shipMode'],
          groupbyColumns: [METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['averageOrderValue', 'weightedDiscount'],
          rowSubTotals: true,
          rowSubtotalLevels: [1],
          rowSubtotalPosition: 'end',
        })}
        metrics={['averageOrderValue', 'weightedDiscount']}
        groupbyRows={['orderPriority', 'shipMode']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(expect.arrayContaining(['1-URGENT']));
    expect(rowHeaders).not.toContain('AIR');
    expect(rowHeaders).not.toContain('1-URGENT Total');

    const urgentRow = screen
      .getByText('1-URGENT')
      .closest('tr') as HTMLTableRowElement;
    const values = within(urgentRow)
      .getAllByRole('cell')
      .map(cell => cell.textContent?.trim());
    expect(values).toEqual(expect.arrayContaining(['10', '0.05']));
  });

  it('shows orderPriority subtotals at the bottom when metrics are first on rows', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment'];
    const detail = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          averageOrderValue: 10,
          weightedDiscount: 0.05,
        },
        {
          orderPriority: '1-URGENT',
          shipMode: 'FOB',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          averageOrderValue: 20,
          weightedDiscount: 0.06,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      3,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          averageOrderValue: 100,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      2,
    );
    const withSubtotals = injectRowSubtotalLeaves(
      mergeTrees(detail, subtotal),
      1,
      rowGroupby.length,
    );
    const withMetrics = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      0,
    );
    const labeledTree = labelRowSubtotalLeaves(withMetrics, metrics);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [METRICS_PLACEHOLDER, ...rowGroupby],
          groupbyColumns: colGroupby,
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(expect.arrayContaining(['1-URGENT Total']));
    expect(rowHeaders.lastIndexOf('1-URGENT Total')).toBeGreaterThan(
      rowHeaders.lastIndexOf('FOB'),
    );
  });

  it('shows orderPriority subtotals at the bottom when metrics are between the first row dimension and the rest', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['row1', 'orderPriority', 'shipMode', 'orderStatus'];
    const colGroupby = ['shipInstruction', 'customerSegment'];
    const detail = buildTreeFromRecords(
      [
        {
          row1: 'R1',
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          averageOrderValue: 10,
          weightedDiscount: 0.05,
        },
        {
          row1: 'R1',
          orderPriority: '1-URGENT',
          shipMode: 'FOB',
          orderStatus: 'F',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          averageOrderValue: 20,
          weightedDiscount: 0.06,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      4,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [
        {
          row1: 'R1',
          orderPriority: '1-URGENT',
          shipInstruction: 'COLLECT COD',
          customerSegment: 'AUTO',
          averageOrderValue: 100,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      2,
      2,
    );
    const withSubtotals = injectRowSubtotalLeaves(
      mergeTrees(detail, subtotal),
      2,
      rowGroupby.length,
    );
    const withMetrics = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      1,
    );
    const labeledTree = labelRowSubtotalLeaves(withMetrics, metrics);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [
            'row1',
            METRICS_PLACEHOLDER,
            'orderPriority',
            'shipMode',
            'orderStatus',
          ],
          groupbyColumns: colGroupby,
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [2],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={4}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[2]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(expect.arrayContaining(['1-URGENT Total']));
    expect(rowHeaders.lastIndexOf('1-URGENT Total')).toBeGreaterThan(
      rowHeaders.lastIndexOf('FOB'),
    );
  });

  it('respects top subtotal positioning after the metric tier', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = [
      'shipMode',
      'orderStatus',
      'customerSegment',
      'shipInstruction',
      'orderPriority',
    ];
    const colGroupby: string[] = [];
    const detail = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          orderStatus: 'F',
          customerSegment: 'AUTO',
          shipInstruction: 'COLLECT COD',
          orderPriority: '1-URGENT',
          averageOrderValue: 10,
          weightedDiscount: 0.05,
        },
        {
          shipMode: 'AIR',
          orderStatus: 'F',
          customerSegment: 'AUTO',
          shipInstruction: 'COLLECT COD',
          orderPriority: '2-HIGH',
          averageOrderValue: 20,
          weightedDiscount: 0.06,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      5,
      0,
    );
    const subtotalDepth2 = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          orderStatus: 'F',
          averageOrderValue: 30,
          weightedDiscount: 0.055,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      2,
      0,
    );
    const subtotalDepth4 = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          orderStatus: 'F',
          customerSegment: 'AUTO',
          shipInstruction: 'COLLECT COD',
          averageOrderValue: 30,
          weightedDiscount: 0.055,
        },
      ],
      metrics,
      rowGroupby,
      colGroupby,
      4,
      0,
    );
    const merged = mergeTrees(
      mergeTrees(detail, subtotalDepth2),
      subtotalDepth4,
    );
    const withSubtotals = injectRowSubtotalLeaves(
      injectRowSubtotalLeaves(merged, 2, rowGroupby.length),
      4,
      rowGroupby.length,
    );
    const withMetrics = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      3,
    );
    const labeledTree = labelRowSubtotalLeaves(withMetrics, metrics);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [
            'shipMode',
            'orderStatus',
            'customerSegment',
            METRICS_PLACEHOLDER,
            'shipInstruction',
            'orderPriority',
          ],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [2, 4],
          rowSubtotalPosition: 'start',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={5}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[2, 4]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(expect.arrayContaining(['F averageOrderValue']));
    expect(rowHeaders).not.toContain('COLLECT COD Total');
  });

  it('forces row subtotals to the bottom when multiple metrics are selected', () => {
    const rootKey = serializePath([]);
    const colKey = rootKey;
    const group = 'Bikes';
    const products = ['Bike1', 'Bike2'];
    const metrics = ['m1', 'm2', 'm3'];

    const rows: Record<string, PivotTreeNode> = {};
    const cols: Record<string, PivotTreeNode> = {
      [colKey]: {
        axis: 'col',
        key: colKey,
        path: [],
        label: 'Grand total',
        formattedLabel: 'Grand total',
        level: 0,
        hasChildren: false,
        isSubtotal: true,
      },
    };
    const cells: Record<string, PivotResultCell> = {};

    const addRow = (
      path: string[],
      label: string,
      hasChildren: boolean,
      isSubtotal = false,
    ) => {
      const key = serializePath(path);
      rows[key] = {
        axis: 'row',
        key,
        path,
        label,
        formattedLabel: label,
        level: path.length,
        hasChildren,
        isSubtotal,
      };
      return key;
    };

    addRow([], 'Grand total', true, true);
    addRow([group], group, true);

    products.forEach(product => {
      addRow([group, product], product, true);
      metrics.forEach(metric => {
        const metricToken = encodeMetricKey(metric);
        const metricKey = addRow([group, product, metricToken], metric, false);
        cells[serializeCellKey(metricKey, colKey)] = {
          rowKey: metricKey,
          colKey,
          values: { [metric]: 1 },
        };
        const productSubtotalKey = addRow(
          [group, product, SUBTOTAL_TOKEN, metricToken],
          `${product} ${metric}`,
          false,
          true,
        );
        cells[serializeCellKey(productSubtotalKey, colKey)] = {
          rowKey: productSubtotalKey,
          colKey,
          values: { [metric]: 2 },
          isSubtotal: true,
        };
      });
    });

    metrics.forEach(metric => {
      const metricToken = encodeMetricKey(metric);
      const groupSubtotalKey = addRow(
        [group, SUBTOTAL_TOKEN, metricToken],
        `${group} ${metric}`,
        false,
        true,
      );
      cells[serializeCellKey(groupSubtotalKey, colKey)] = {
        rowKey: groupSubtotalKey,
        colKey,
        values: { [metric]: 3 },
        isSubtotal: true,
      };
    });

    const tree: PivotTreeData = { rows, cols, cells };
    const props: Partial<PivotTableQueryFormData> = {
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: ['group', 'product'],
      groupbyColumns: [],
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics,
      rowSubTotals: true,
      colTotals: true,
      rowSubtotalPosition: 'start',
    };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData(props)}
        metrics={metrics}
        groupbyRows={['group', 'product']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={400}
        startCollapsed={false}
        initialDepth={3}
        colTotals
        rowTotals={false}
        rowSubTotals
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Grand total');

    const tail = rowHeaders.slice(-metrics.length);
    expect(tail).toEqual(metrics.map(metric => `${group} ${metric}`));

    metrics.forEach(metric => {
      const totalRow = screen
        .getByText(`${group} ${metric}`)
        .closest('tr') as HTMLTableRowElement;
      expect(totalRow.querySelector('th')?.className).toContain(
        'subtotal-cell',
      );
    });
  });

  it('suppresses metric grand total rows when a single metric is on rows', () => {
    const rootKey = serializePath([]);
    const totalKey = serializePath([SUBTOTAL_TOKEN]);
    const metricTotalKey = serializePath([
      SUBTOTAL_TOKEN,
      encodeMetricKey('averageOrderValue'),
    ]);
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
      [totalKey]: {
        axis: 'row',
        key: totalKey,
        path: [SUBTOTAL_TOKEN],
        label: 'Total',
        formattedLabel: 'Total',
        level: 1,
        hasChildren: true,
        isSubtotal: true,
      },
      [metricTotalKey]: {
        axis: 'row',
        key: metricTotalKey,
        path: [SUBTOTAL_TOKEN, encodeMetricKey('averageOrderValue')],
        label: 'averageOrderValue',
        formattedLabel: 'averageOrderValue',
        level: 2,
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
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(metricTotalKey, rootKey)]: {
        rowKey: metricTotalKey,
        colKey: rootKey,
        values: { averageOrderValue: 100 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['qualityBand', METRICS_PLACEHOLDER],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: ['averageOrderValue'],
          colTotals: true,
          rowSubTotals: true,
          rowSubtotalPosition: 'end',
        })}
        metrics={['averageOrderValue']}
        groupbyRows={['qualityBand']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={500}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals
        rowTotals={false}
        rowSubTotals
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Total averageOrderValue');
  });

  it('renders metric-specific row grand totals when metrics are on rows', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount', 'countOrders'];
    const detail = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          averageOrderValue: 10,
          weightedDiscount: 20,
          countOrders: 30,
        },
      ],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      1,
      1,
    );
    const totals = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          averageOrderValue: 100,
          weightedDiscount: 200,
          countOrders: 300,
        },
      ],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      0,
      1,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.ROWS,
      ['orderPriority'],
      ['shipMode'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority'],
          groupbyColumns: ['shipMode'],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          colTotals: true,
          colTotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={['orderPriority']}
        groupbyColumns={['shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        colTotals
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
        colTotalPosition="end"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toEqual(
      expect.arrayContaining([
        'Total averageOrderValue',
        'Total weightedDiscount',
        'Total countOrders',
      ]),
    );

    const totalRow = screen
      .getByText('Total averageOrderValue')
      .closest('tr') as HTMLTableRowElement;
    const totalValue = within(totalRow).getAllByRole('cell')[0];
    expect(totalValue.textContent?.trim()).toBe('100');
  });

  it('uses the metric display label for row grand totals and never renders "Total count"', () => {
    const metrics = ['sum__num', 'count'];
    const detail = buildTreeFromRecords(
      [
        {
          name: 'A',
          sum__num: 10,
          count: 2,
        },
      ],
      metrics,
      ['name'],
      [],
      1,
      0,
    );
    const totals = buildTreeFromRecords(
      [
        {
          sum__num: 10,
          count: 2,
        },
      ],
      metrics,
      ['name'],
      [],
      0,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.ROWS,
      ['name'],
      [],
      1,
      {
        sum__num: 'sum__num',
        count: 'count',
      },
    );

    const formData = buildFormData({
      ...(baseProps as Partial<PivotTableQueryFormData>),
      groupbyRows: ['name', METRICS_PLACEHOLDER],
      groupbyColumns: [],
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics,
      colTotals: true,
      colTotalPosition: 'end',
      metricLabelMap: {
        sum__num: 'sum__num',
        count: 'count',
      },
    });

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={formData}
        metrics={metrics}
        groupbyRows={['name']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        colTotals
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
        colTotalPosition="end"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        verboseMap={{
          count: 'COUNT(*)',
        }}
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());

    expect(rowHeaders).toEqual(
      expect.arrayContaining(['Total COUNT(*)', 'Total sum__num']),
    );
    expect(rowHeaders).not.toContain('Total count');
  });

  describe('metric grand totals with metrics between row dimensions', () => {
    const buildMetrics = (count: number) =>
      Array.from({ length: count }, (_, idx) => `A_METRIC_${idx + 1}`);

    const buildMetricTotalsTree = (metrics: string[]) => {
      const rowGroupby = [
        'shipMode',
        'orderPriority',
        'returnFlag',
        'shipInstruction',
      ];
      const colGroupby = ['lineStatus'];
      const buildMetricValues = (base: number) =>
        metrics.reduce(
          (acc, metric, idx) => ({ ...acc, [metric]: base + idx }),
          {} as Record<string, number>,
        );
      const detail = buildTreeFromRecords(
        [
          {
            shipMode: 'AIR',
            orderPriority: '1-URGENT',
            returnFlag: 'N',
            shipInstruction: 'DELIVER IN PERSON',
            lineStatus: 'F',
            ...buildMetricValues(10),
          },
          {
            shipMode: 'FOB',
            orderPriority: '2-HIGH',
            returnFlag: 'N',
            shipInstruction: 'DELIVER IN PERSON',
            lineStatus: 'O',
            ...buildMetricValues(20),
          },
        ],
        metrics,
        rowGroupby,
        colGroupby,
        2,
        1,
      );
      const totals = buildTreeFromRecords(
        [
          { lineStatus: 'F', ...buildMetricValues(100) },
          { lineStatus: 'O', ...buildMetricValues(200) },
        ],
        metrics,
        rowGroupby,
        colGroupby,
        0,
        1,
      );
      return applyMetricAxis(
        mergeTrees(detail, totals),
        metrics,
        MetricsLayoutEnum.ROWS,
        rowGroupby,
        colGroupby,
        2,
      );
    };

    it.each([2, 3, 4, 5])(
      'places metric grand totals after ship modes with %i metrics',
      metricCount => {
        const metrics = buildMetrics(metricCount);
        const tree = buildMetricTotalsTree(metrics);
        const { container } = render(
          <PivotTableChart
            data={tree}
            formData={buildFormData({
              ...(baseProps as Partial<PivotTableQueryFormData>),
              groupbyRows: [
                'shipMode',
                'orderPriority',
                METRICS_PLACEHOLDER,
                'returnFlag',
                'shipInstruction',
              ],
              groupbyColumns: ['lineStatus'],
              metricsLayout: MetricsLayoutEnum.ROWS,
              metrics,
              colTotals: true,
              colTotalPosition: 'end',
            })}
            metrics={metrics}
            groupbyRows={[
              'shipMode',
              'orderPriority',
              'returnFlag',
              'shipInstruction',
            ]}
            groupbyColumns={['lineStatus']}
            aggregateFunction="Sum"
            width={600}
            height={300}
            startCollapsed={false}
            initialDepth={2}
            colTotals
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
            colTotalPosition="end"
            colSubtotalPosition="start"
            rowTotalPosition="start"
          />,
        );

        const rowHeaders = Array.from(
          container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
        ).map(cell => cell.textContent?.trim());
        const shipModes = ['AIR', 'FOB'];
        shipModes.forEach(label => {
          expect(rowHeaders).toContain(label);
        });
        const lastShipModeIndex = Math.max(
          ...shipModes.map(label => rowHeaders.lastIndexOf(label)),
        );
        metrics.forEach(metric => {
          const totalLabel = `Total ${metric}`;
          const totalIndex = rowHeaders.lastIndexOf(totalLabel);
          expect(totalIndex).toBeGreaterThan(-1);
          expect(totalIndex).toBeGreaterThan(lastShipModeIndex);
        });
      },
    );
  });

  it('orders metric grand totals by selection when metrics are on rows', () => {
    const metrics = ['metricB', 'metricA', 'metricC'];
    const detail = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          metricB: 10,
          metricA: 20,
          metricC: 30,
        },
      ],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      1,
      1,
    );
    const totals = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          metricB: 100,
          metricA: 200,
          metricC: 300,
        },
      ],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      0,
      1,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.ROWS,
      ['orderPriority'],
      ['shipMode'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority'],
          groupbyColumns: ['shipMode'],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          colTotals: true,
          colTotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={['orderPriority']}
        groupbyColumns={['shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        colTotals
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
        colTotalPosition="end"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    const totalLabels = metrics.map(metric => `Total ${metric}`);
    const totalIndexes = totalLabels.map(label => rowHeaders.indexOf(label));
    totalIndexes.forEach(index => {
      expect(index).toBeGreaterThan(-1);
    });
    expect([...totalIndexes].sort((a, b) => a - b)).toEqual(totalIndexes);
  });

  it('orders metric subtotal rows by selection when metrics are on rows', () => {
    const metrics = ['metricB', 'metricA', 'metricC'];
    const rowGroupby = ['shipMode', 'orderPriority'];
    const detail = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          orderPriority: '1-URGENT',
          metricB: 10,
          metricA: 20,
          metricC: 30,
        },
        {
          shipMode: 'AIR',
          orderPriority: '2-HIGH',
          metricB: 11,
          metricA: 21,
          metricC: 31,
        },
      ],
      metrics,
      rowGroupby,
      [],
      2,
      0,
    );
    const subtotalLevel1 = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          metricB: 21,
          metricA: 41,
          metricC: 61,
        },
      ],
      metrics,
      rowGroupby,
      [],
      1,
      0,
    );
    const withSubtotals = injectRowSubtotalLeaves(
      mergeTrees(detail, subtotalLevel1),
      1,
      rowGroupby.length,
    );
    const withMetrics = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      [],
      2,
    );
    const tree = labelRowSubtotalLeaves(withMetrics, metrics);

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    const subtotalLabels = metrics.map(metric => `AIR ${metric}`);
    const subtotalIndexes = subtotalLabels.map(label =>
      rowHeaders.indexOf(label),
    );
    subtotalIndexes.forEach(index => {
      expect(index).toBeGreaterThan(-1);
    });
    expect([...subtotalIndexes].sort((a, b) => a - b)).toEqual(subtotalIndexes);
  });

  it('omits the grand total row when multiple metrics are on rows and keeps grand total column values', () => {
    const metrics = ['averageOrderValue', 'countOrders'];
    const detail = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          averageOrderValue: 10,
          countOrders: 20,
        },
      ],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      1,
      1,
    );
    const totals = buildTreeFromRecords(
      [{ averageOrderValue: 100, countOrders: 200 }],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      0,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.ROWS,
      ['orderPriority'],
      ['shipMode'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority'],
          groupbyColumns: ['shipMode'],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          colTotals: true,
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={['orderPriority']}
        groupbyColumns={['shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        colTotals
        rowTotals
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Grand total');
    expect(rowHeaders).toEqual(
      expect.arrayContaining(['Total averageOrderValue', 'Total countOrders']),
    );
    const firstDimIndex = rowHeaders.findIndex(label => label === '1-URGENT');
    expect(firstDimIndex).toBeGreaterThan(-1);
    ['Total averageOrderValue', 'Total countOrders'].forEach(label => {
      const totalIndex = rowHeaders.indexOf(label);
      expect(totalIndex).toBeGreaterThan(-1);
      expect(totalIndex).toBeLessThan(firstDimIndex);
    });

    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const headerLabels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    const grandIndex = headerLabels.indexOf('Grand total');
    expect(grandIndex).toBeGreaterThan(-1);

    const totalRow = screen
      .getByText('Total averageOrderValue')
      .closest('tr') as HTMLTableRowElement;
    const totalCells = within(totalRow).getAllByRole('cell');
    expect(totalCells[grandIndex].textContent?.trim()).toBe('100');
  });

  it('omits the grand total row when only metrics are on rows with multiple measures', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const detail = buildTreeFromRecords(
      [{ shipMode: 'AIR', averageOrderValue: 10, weightedDiscount: 20 }],
      metrics,
      [],
      ['shipMode'],
      0,
      1,
    );
    const totals = buildTreeFromRecords(
      [{ averageOrderValue: 100, weightedDiscount: 200 }],
      metrics,
      [],
      ['shipMode'],
      0,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.ROWS,
      [],
      ['shipMode'],
      0,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [],
          groupbyColumns: ['shipMode'],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          colTotals: true,
          rowTotals: true,
        })}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={['shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        colTotals
        rowTotals
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toContain('Grand total');
    expect(rowHeaders).toEqual(
      expect.arrayContaining(['averageOrderValue', 'weightedDiscount']),
    );
  });

  it('bolds expanded metric headers when metrics are first on rows', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['discountBand'];
    const detail = buildTreeFromRecords(
      [
        { discountBand: '0-2%', averageOrderValue: 10, weightedDiscount: 20 },
        { discountBand: '10-15%', averageOrderValue: 30, weightedDiscount: 40 },
      ],
      metrics,
      rowGroupby,
      [],
      1,
      0,
    );
    const tree = applyMetricAxis(
      detail,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      [],
      0,
    );

    const pivotExpansionState: PivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [[encodeMetricKey('averageOrderValue')]],
      cols: [],
    };

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [METRICS_PLACEHOLDER, 'discountBand'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          startCollapsed: true,
          initialDepth: 1,
          rowTotals: false,
          colTotals: false,
          pivotExpansionState,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const metricHeader = screen
      .getByText('averageOrderValue')
      .closest('th') as HTMLElement;
    const siblingMetricHeader = screen
      .getByText('weightedDiscount')
      .closest('th') as HTMLElement;
    const childHeader = screen.getByText('0-2%').closest('th') as HTMLElement;
    expect(metricHeader).toHaveClass('subtotal-cell');
    expect(siblingMetricHeader).toHaveClass('subtotal-cell');
    expect(childHeader).not.toHaveClass('subtotal-cell');
  });

  it('bolds expanded row dimensions when metrics are on columns', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['discountBand', 'shipMode'];
    const detail = buildTreeFromRecords(
      [
        {
          discountBand: '0-2%',
          shipMode: 'AIR',
          averageOrderValue: 10,
          weightedDiscount: 20,
        },
        {
          discountBand: '10-15%',
          shipMode: 'AIR',
          averageOrderValue: 50,
          weightedDiscount: 60,
        },
        {
          discountBand: '0-2%',
          shipMode: 'FOB',
          averageOrderValue: 30,
          weightedDiscount: 40,
        },
      ],
      metrics,
      rowGroupby,
      [],
      2,
      0,
    );
    const tree = applyMetricAxis(
      detail,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
      0,
    );
    const pivotExpansionState: PivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['0-2%']],
      cols: [],
    };

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: rowGroupby,
          groupbyColumns: [METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          startCollapsed: true,
          initialDepth: 1,
          rowTotals: false,
          colTotals: false,
          pivotExpansionState,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const bandHeader = screen.getByText('0-2%').closest('th') as HTMLElement;
    const siblingBandHeader = screen
      .getByText('10-15%')
      .closest('th') as HTMLElement;
    const childHeader = screen.getByText('AIR').closest('th') as HTMLElement;
    expect(bandHeader).toHaveClass('subtotal-cell');
    expect(siblingBandHeader).toHaveClass('subtotal-cell');
    expect(childHeader).not.toHaveClass('subtotal-cell');
  });

  it('keeps expanded dimension rows bold under metrics-first layouts', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['discountBand', 'shipMode'];
    const detail = buildTreeFromRecords(
      [
        {
          discountBand: '0-2%',
          shipMode: 'AIR',
          averageOrderValue: 10,
          weightedDiscount: 20,
        },
        {
          discountBand: '0-2%',
          shipMode: 'FOB',
          averageOrderValue: 30,
          weightedDiscount: 40,
        },
        {
          discountBand: '10-15%',
          shipMode: 'AIR',
          averageOrderValue: 15,
          weightedDiscount: 25,
        },
      ],
      metrics,
      rowGroupby,
      [],
      2,
      0,
    );
    const tree = applyMetricAxis(
      detail,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      [],
      0,
    );
    const metricToken = encodeMetricKey('averageOrderValue');
    const pivotExpansionState: PivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [[metricToken], [metricToken, '0-2%']],
      cols: [],
    };

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [METRICS_PLACEHOLDER, 'discountBand', 'shipMode'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          startCollapsed: true,
          initialDepth: 1,
          rowTotals: false,
          colTotals: false,
          pivotExpansionState,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const metricHeader = screen
      .getByText('averageOrderValue')
      .closest('th') as HTMLElement;
    const bandHeader = screen.getByText('0-2%').closest('th') as HTMLElement;
    const siblingBandHeader = screen
      .getByText('10-15%')
      .closest('th') as HTMLElement;
    const childHeader = screen.getByText('AIR').closest('th') as HTMLElement;
    expect(metricHeader).toHaveClass('subtotal-cell');
    expect(bandHeader).toHaveClass('subtotal-cell');
    expect(siblingBandHeader).toHaveClass('subtotal-cell');
    expect(childHeader).not.toHaveClass('subtotal-cell');
  });

  it('avoids duplicate metric rows from subtotal queries when metrics are last on rows', () => {
    const metrics = ['averageOrderValue', 'countOrders'];
    const detail = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          qualityBand: '1-5',
          averageOrderValue: 10,
          countOrders: 20,
        },
      ],
      metrics,
      ['orderPriority', 'qualityBand'],
      [],
      2,
      0,
    );
    const subtotal = buildTreeFromRecords(
      [{ orderPriority: '1-URGENT', averageOrderValue: 100, countOrders: 200 }],
      metrics,
      ['orderPriority', 'qualityBand'],
      [],
      1,
      0,
    );
    const withSubtotals = injectRowSubtotalLeaves(
      mergeTrees(detail, subtotal),
      1,
      2,
    );
    const tree = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      ['orderPriority', 'qualityBand'],
      [],
      2,
    );
    const labeledTree = labelRowSubtotalLeaves(tree, metrics);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority', 'qualityBand'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1],
        })}
        metrics={metrics}
        groupbyRows={['orderPriority', 'qualityBand']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(
      rowHeaders.filter(label => label === 'averageOrderValue'),
    ).toHaveLength(1);
    expect(rowHeaders.filter(label => label === 'countOrders')).toHaveLength(1);
    expect(rowHeaders).toEqual(
      expect.arrayContaining([
        '1-URGENT averageOrderValue',
        '1-URGENT countOrders',
      ]),
    );
  });

  const buildMetricSubtotalTree = () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand', 'returnFlag', 'revenueBand'];
    const detail = buildTreeFromRecords(
      [
        {
          quantityBand: '1-5',
          returnFlag: 'A',
          revenueBand: '10k-50k',
          averageOrderValue: 10,
          weightedDiscount: 0.1,
        },
        {
          quantityBand: '1-5',
          returnFlag: 'A',
          revenueBand: '1k-5k',
          averageOrderValue: 20,
          weightedDiscount: 0.2,
        },
        {
          quantityBand: '1-5',
          returnFlag: 'N',
          revenueBand: 'Under 1k',
          averageOrderValue: 5,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      [],
      3,
      0,
    );
    const subtotalLevel2 = buildTreeFromRecords(
      [
        {
          quantityBand: '1-5',
          returnFlag: 'A',
          averageOrderValue: 30,
          weightedDiscount: 0.3,
        },
        {
          quantityBand: '1-5',
          returnFlag: 'N',
          averageOrderValue: 5,
          weightedDiscount: 0.05,
        },
      ],
      metrics,
      rowGroupby,
      [],
      2,
      0,
    );
    const subtotalLevel1 = buildTreeFromRecords(
      [
        {
          quantityBand: '1-5',
          averageOrderValue: 35,
          weightedDiscount: 0.35,
        },
      ],
      metrics,
      rowGroupby,
      [],
      1,
      0,
    );
    const merged = mergeTrees(
      mergeTrees(detail, subtotalLevel2),
      subtotalLevel1,
    );
    const withSubtotals = injectRowSubtotalLeaves(
      injectRowSubtotalLeaves(merged, 2, rowGroupby.length),
      1,
      rowGroupby.length,
    );
    const withMetrics = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      [],
      1,
    );
    const labeledTree = labelRowSubtotalLeaves(withMetrics, metrics);
    return { labeledTree, metrics, rowGroupby };
  };

  const buildDeepMetricSubtotalTree = (subtotalLevels: number[]) => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['A', 'B', 'C', 'D', 'E', 'F'];
    const detailRecords = [
      {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F1',
        averageOrderValue: 10,
        weightedDiscount: 0.1,
      },
      {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F2',
        averageOrderValue: 20,
        weightedDiscount: 0.2,
      },
      {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F3',
        averageOrderValue: 30,
        weightedDiscount: 0.3,
      },
      {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F4',
        averageOrderValue: 40,
        weightedDiscount: 0.4,
      },
    ];
    const detail = buildTreeFromRecords(
      detailRecords,
      metrics,
      rowGroupby,
      [],
      rowGroupby.length,
      0,
    );
    const aggregateSeed = {
      A: 'A',
      B: 'B',
      C: 'C',
      D: 'D',
      E: 'E',
      F: 'F1',
      averageOrderValue: 100,
      weightedDiscount: 0.5,
    };
    const aggregated = subtotalLevels.reduce((acc, depth, idx) => {
      const record = {
        ...aggregateSeed,
        averageOrderValue: 100 + depth + idx,
        weightedDiscount: 0.5 + (depth + idx) / 100,
      };
      const branch = buildTreeFromRecords(
        [record],
        metrics,
        rowGroupby,
        [],
        depth,
        0,
      );
      return mergeTrees(acc, branch);
    }, detail);
    const withSubtotals = subtotalLevels.reduce(
      (acc, depth) => injectRowSubtotalLeaves(acc, depth, rowGroupby.length),
      aggregated,
    );
    const withMetrics = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      [],
      3,
    );
    const labeledTree = labelRowSubtotalLeaves(withMetrics, metrics);
    return { labeledTree, metrics, rowGroupby };
  };

  const buildVeryDeepMetricSubtotalTree = (subtotalLevels: number[]) => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const detailRecords = [
      {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F',
        G: 'G',
        H: 'H',
        I: 'I',
        J: 'J1',
        averageOrderValue: 10,
        weightedDiscount: 0.1,
      },
      {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F',
        G: 'G',
        H: 'H',
        I: 'I',
        J: 'J2',
        averageOrderValue: 20,
        weightedDiscount: 0.2,
      },
      {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F',
        G: 'G',
        H: 'H',
        I: 'I',
        J: 'J3',
        averageOrderValue: 30,
        weightedDiscount: 0.3,
      },
    ];
    const detail = buildTreeFromRecords(
      detailRecords,
      metrics,
      rowGroupby,
      [],
      rowGroupby.length,
      0,
    );
    const aggregateSeed = {
      A: 'A',
      B: 'B',
      C: 'C',
      D: 'D',
      E: 'E',
      F: 'F',
      G: 'G',
      H: 'H',
      I: 'I',
      J: 'J1',
      averageOrderValue: 100,
      weightedDiscount: 0.5,
    };
    const aggregated = subtotalLevels.reduce((acc, depth, idx) => {
      const record = {
        ...aggregateSeed,
        averageOrderValue: 120 + depth + idx,
        weightedDiscount: 0.7 + (depth + idx) / 100,
      };
      const branch = buildTreeFromRecords(
        [record],
        metrics,
        rowGroupby,
        [],
        depth,
        0,
      );
      return mergeTrees(acc, branch);
    }, detail);
    const withSubtotals = subtotalLevels.reduce(
      (acc, depth) => injectRowSubtotalLeaves(acc, depth, rowGroupby.length),
      aggregated,
    );
    const withMetrics = applyMetricAxis(
      withSubtotals,
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      [],
      5,
    );
    const labeledTree = labelRowSubtotalLeaves(withMetrics, metrics);
    return { labeledTree, metrics, rowGroupby };
  };

  it('renders top-level metric subtotals and suppresses returnFlag totals when top position is selected with multiple metrics', () => {
    const { labeledTree, metrics, rowGroupby } = buildMetricSubtotalTree();

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: rowGroupby,
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1, 2],
          rowSubtotalPosition: 'start',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1, 2]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);
    const lastLeafIndex = rowHeaders.lastIndexOf('Under 1k');
    const avgTotalIndex = rowHeaders.indexOf('1-5 averageOrderValue');
    const discountTotalIndex = rowHeaders.indexOf('1-5 weightedDiscount');
    const avgTotalCount = rowHeaders.filter(
      label => label === '1-5 averageOrderValue',
    ).length;
    const discountTotalCount = rowHeaders.filter(
      label => label === '1-5 weightedDiscount',
    ).length;

    expect(rowHeaders).toEqual(
      expect.arrayContaining(['1-5 averageOrderValue', '1-5 weightedDiscount']),
    );
    expect(avgTotalCount).toBe(1);
    expect(discountTotalCount).toBe(1);
    expect(lastLeafIndex).toBeGreaterThan(-1);
    expect(avgTotalIndex).toBeGreaterThan(lastLeafIndex);
    expect(discountTotalIndex).toBeGreaterThan(lastLeafIndex);
    expect(rowHeaders).not.toContain('A averageOrderValue');
    expect(rowHeaders).not.toContain('A weightedDiscount');
    expect(rowHeaders).not.toContain('N averageOrderValue');
    expect(rowHeaders).not.toContain('N weightedDiscount');
    expect(rowHeaders).not.toContain('A Total');
    expect(rowHeaders).not.toContain('N Total');
    expect(rowHeaders).not.toContain('1-5 Total');

    const getRowIndent = (label: string) => {
      const headerCell = screen
        .getAllByText(label)[0]
        .closest('div') as HTMLElement;
      return Number.parseInt(headerCell.style.paddingLeft || '0', 10);
    };
    const metricIndent = getRowIndent('averageOrderValue');
    const returnFlagIndent = getRowIndent('A');
    const subtotalIndent = getRowIndent('1-5 averageOrderValue');
    const subtotalDiscountIndent = getRowIndent('1-5 weightedDiscount');

    expect(subtotalIndent).toBe(returnFlagIndent);
    expect(subtotalDiscountIndent).toBe(returnFlagIndent);
    expect(returnFlagIndent).toBeGreaterThan(metricIndent);
  });

  it('renders top-level metric subtotals and returnFlag totals when bottom position is selected with multiple metrics', () => {
    const { labeledTree, metrics, rowGroupby } = buildMetricSubtotalTree();

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: rowGroupby,
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1, 2],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1, 2]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);
    const lastLeafIndex = rowHeaders.lastIndexOf('Under 1k');
    const avgTotalIndex = rowHeaders.indexOf('1-5 averageOrderValue');
    const discountTotalIndex = rowHeaders.indexOf('1-5 weightedDiscount');
    const avgTotalCount = rowHeaders.filter(
      label => label === '1-5 averageOrderValue',
    ).length;
    const discountTotalCount = rowHeaders.filter(
      label => label === '1-5 weightedDiscount',
    ).length;

    expect(rowHeaders).toEqual(
      expect.arrayContaining(['1-5 averageOrderValue', '1-5 weightedDiscount']),
    );
    expect(avgTotalCount).toBe(1);
    expect(discountTotalCount).toBe(1);
    expect(lastLeafIndex).toBeGreaterThan(-1);
    expect(avgTotalIndex).toBeGreaterThan(lastLeafIndex);
    expect(discountTotalIndex).toBeGreaterThan(lastLeafIndex);
    expect(rowHeaders).not.toContain('A averageOrderValue');
    expect(rowHeaders).not.toContain('A weightedDiscount');
    expect(rowHeaders).not.toContain('N averageOrderValue');
    expect(rowHeaders).not.toContain('N weightedDiscount');
    expect(rowHeaders).toEqual(expect.arrayContaining(['A Total', 'N Total']));
    expect(rowHeaders).not.toContain('1-5 Total');

    const getRowIndent = (label: string) => {
      const headerCell = screen
        .getAllByText(label)[0]
        .closest('div') as HTMLElement;
      return Number.parseInt(headerCell.style.paddingLeft || '0', 10);
    };
    const metricIndent = getRowIndent('averageOrderValue');
    const returnFlagIndent = getRowIndent('A');
    const subtotalIndent = getRowIndent('1-5 averageOrderValue');
    const subtotalDiscountIndent = getRowIndent('1-5 weightedDiscount');

    expect(subtotalIndent).toBe(returnFlagIndent);
    expect(subtotalDiscountIndent).toBe(returnFlagIndent);
    expect(returnFlagIndent).toBeGreaterThan(metricIndent);
  });

  it('suppresses metric-labeled subtotals when row subtotals are disabled', () => {
    const { labeledTree, metrics, rowGroupby } = buildMetricSubtotalTree();

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: rowGroupby,
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: false,
          rowSubtotalLevels: [1, 2],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[1, 2]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);

    expect(rowHeaders).not.toContain('1-5 averageOrderValue');
    expect(rowHeaders).not.toContain('1-5 weightedDiscount');
    expect(rowHeaders).not.toContain('A averageOrderValue');
    expect(rowHeaders).not.toContain('A weightedDiscount');
    expect(rowHeaders).not.toContain('N averageOrderValue');
    expect(rowHeaders).not.toContain('N weightedDiscount');
  });

  it('pushes metric subtotals for A/B/C to the bottom and matches indentation when metrics are between C and D (top position)', () => {
    const { labeledTree, metrics, rowGroupby } = buildDeepMetricSubtotalTree([
      1, 2, 3,
    ]);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['A', 'B', 'C', METRICS_PLACEHOLDER, 'D', 'E', 'F'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1, 2, 3],
          rowSubtotalPosition: 'start',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={5}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1, 2, 3]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);
    const lastLeafIndex = rowHeaders.lastIndexOf('F4');
    const totals = [
      'C averageOrderValue',
      'C weightedDiscount',
      'B averageOrderValue',
      'B weightedDiscount',
      'A averageOrderValue',
      'A weightedDiscount',
    ];

    expect(rowHeaders).toEqual(expect.arrayContaining(totals));
    totals.forEach(label => {
      expect(rowHeaders.filter(item => item === label)).toHaveLength(1);
      expect(rowHeaders.indexOf(label)).toBeGreaterThan(lastLeafIndex);
    });
    expect(rowHeaders).not.toContain('A Total');
    expect(rowHeaders).not.toContain('B Total');
    expect(rowHeaders).not.toContain('C Total');
    expect(rowHeaders).not.toContain('D averageOrderValue');
    expect(rowHeaders).not.toContain('D weightedDiscount');
    expect(rowHeaders).not.toContain('E averageOrderValue');
    expect(rowHeaders).not.toContain('E weightedDiscount');
    expect(rowHeaders).not.toContain('E Total');

    const getRowIndent = (label: string) => {
      const headerCell = screen.getByText(label).closest('div') as HTMLElement;
      return Number.parseInt(headerCell.style.paddingLeft || '0', 10);
    };
    const indentA = getRowIndent('A');
    const indentB = getRowIndent('B');
    const indentC = getRowIndent('C');
    expect(getRowIndent('A averageOrderValue')).toBe(indentA);
    expect(getRowIndent('A weightedDiscount')).toBe(indentA);
    expect(getRowIndent('B averageOrderValue')).toBe(indentB);
    expect(getRowIndent('B weightedDiscount')).toBe(indentB);
    expect(getRowIndent('C averageOrderValue')).toBe(indentC);
    expect(getRowIndent('C weightedDiscount')).toBe(indentC);
  });

  it('adds single-metric E totals and keeps A/B/C subtotals aligned when metrics are between C and D (bottom position)', () => {
    const { labeledTree, metrics, rowGroupby } = buildDeepMetricSubtotalTree([
      1, 2, 3, 5,
    ]);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['A', 'B', 'C', METRICS_PLACEHOLDER, 'D', 'E', 'F'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1, 2, 3, 5],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={5}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1, 2, 3, 5]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);
    const firstLeafIndex = rowHeaders.indexOf('F4');
    const lastLeafIndex = rowHeaders.lastIndexOf('F4');
    const totals = [
      'C averageOrderValue',
      'C weightedDiscount',
      'B averageOrderValue',
      'B weightedDiscount',
      'A averageOrderValue',
      'A weightedDiscount',
    ];
    const eTotalCount = rowHeaders.filter(label => label === 'E Total').length;

    expect(rowHeaders).toEqual(expect.arrayContaining(totals));
    totals.forEach(label => {
      expect(rowHeaders.filter(item => item === label)).toHaveLength(1);
      expect(rowHeaders.indexOf(label)).toBeGreaterThan(lastLeafIndex);
    });
    expect(firstLeafIndex).toBeGreaterThan(-1);
    expect(rowHeaders.indexOf('E Total')).toBeGreaterThan(firstLeafIndex);
    expect(rowHeaders.lastIndexOf('E Total')).toBeGreaterThan(lastLeafIndex);
    expect(eTotalCount).toBe(2);
    expect(rowHeaders).not.toContain('A Total');
    expect(rowHeaders).not.toContain('B Total');
    expect(rowHeaders).not.toContain('C Total');
    expect(rowHeaders).not.toContain('D averageOrderValue');
    expect(rowHeaders).not.toContain('D weightedDiscount');
    expect(rowHeaders).not.toContain('E averageOrderValue');
    expect(rowHeaders).not.toContain('E weightedDiscount');

    const getRowIndent = (label: string) => {
      const headerCell = screen
        .getAllByText(label)[0]
        .closest('div') as HTMLElement;
      return Number.parseInt(headerCell.style.paddingLeft || '0', 10);
    };
    const indentA = getRowIndent('A');
    const indentB = getRowIndent('B');
    const indentC = getRowIndent('C');
    const indentE = getRowIndent('E');
    expect(getRowIndent('A averageOrderValue')).toBe(indentA);
    expect(getRowIndent('A weightedDiscount')).toBe(indentA);
    expect(getRowIndent('B averageOrderValue')).toBe(indentB);
    expect(getRowIndent('B weightedDiscount')).toBe(indentB);
    expect(getRowIndent('C averageOrderValue')).toBe(indentC);
    expect(getRowIndent('C weightedDiscount')).toBe(indentC);
    expect(getRowIndent('E Total')).toBe(indentE);

    const eRow = screen
      .getAllByText(/^E$/)[0]
      .closest('tr') as HTMLTableRowElement;
    const eCells = Array.from(eRow.querySelectorAll('td'));
    expect(eCells.some(cell => cell.textContent?.trim())).toBe(false);
  });

  it('pushes A-E metric subtotals to the bottom when values are between E and F (layout 1)', () => {
    const { labeledTree, metrics, rowGroupby } =
      buildVeryDeepMetricSubtotalTree([1, 2, 3, 4, 5]);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [
            'A',
            'B',
            'C',
            'D',
            'E',
            METRICS_PLACEHOLDER,
            'F',
            'G',
            'H',
            'I',
            'J',
          ],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1, 2, 3, 4, 5],
          rowSubtotalPosition: 'start',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={7}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1, 2, 3, 4, 5]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);
    const lastLeafIndex = rowHeaders.lastIndexOf('J3');
    const totals = [
      'A averageOrderValue',
      'A weightedDiscount',
      'B averageOrderValue',
      'B weightedDiscount',
      'C averageOrderValue',
      'C weightedDiscount',
      'D averageOrderValue',
      'D weightedDiscount',
      'E averageOrderValue',
      'E weightedDiscount',
    ];

    expect(rowHeaders).toEqual(expect.arrayContaining(totals));
    totals.forEach(label => {
      expect(rowHeaders.filter(item => item === label)).toHaveLength(1);
      const index = rowHeaders.indexOf(label);
      if (index <= lastLeafIndex) {
        throw new Error(
          `layout1 order ${label} index=${index} lastLeafIndex=${lastLeafIndex} rows=${rowHeaders.join(
            ' | ',
          )}`,
        );
      }
      expect(index).toBeGreaterThan(lastLeafIndex);
    });
    expect(rowHeaders).not.toContain('G Total');
    expect(rowHeaders).not.toContain('H Total');
    expect(rowHeaders).not.toContain('I Total');
    expect(rowHeaders).not.toContain('A Total');
    expect(rowHeaders).not.toContain('B Total');
    expect(rowHeaders).not.toContain('C Total');
    expect(rowHeaders).not.toContain('D Total');
    expect(rowHeaders).not.toContain('E Total');

    const getRowIndent = (label: string) => {
      const headerCell = screen.getByText(label).closest('div') as HTMLElement;
      return Number.parseInt(headerCell.style.paddingLeft || '0', 10);
    };
    const indentA = getRowIndent('A');
    const indentB = getRowIndent('B');
    const indentC = getRowIndent('C');
    const indentD = getRowIndent('D');
    const indentE = getRowIndent('E');
    expect(getRowIndent('A averageOrderValue')).toBe(indentA);
    expect(getRowIndent('A weightedDiscount')).toBe(indentA);
    expect(getRowIndent('B averageOrderValue')).toBe(indentB);
    expect(getRowIndent('B weightedDiscount')).toBe(indentB);
    expect(getRowIndent('C averageOrderValue')).toBe(indentC);
    expect(getRowIndent('C weightedDiscount')).toBe(indentC);
    expect(getRowIndent('D averageOrderValue')).toBe(indentD);
    expect(getRowIndent('D weightedDiscount')).toBe(indentD);
    expect(getRowIndent('E averageOrderValue')).toBe(indentE);
    expect(getRowIndent('E weightedDiscount')).toBe(indentE);
  });

  it('renders G/H/I totals under each metric branch and keeps A-E subtotals aligned (layout 2)', () => {
    const { labeledTree, metrics, rowGroupby } =
      buildVeryDeepMetricSubtotalTree([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [
            'A',
            'B',
            'C',
            'D',
            'E',
            METRICS_PLACEHOLDER,
            'F',
            'G',
            'H',
            'I',
            'J',
          ],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={7}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);
    const totals = [
      'A averageOrderValue',
      'A weightedDiscount',
      'B averageOrderValue',
      'B weightedDiscount',
      'C averageOrderValue',
      'C weightedDiscount',
      'D averageOrderValue',
      'D weightedDiscount',
      'E averageOrderValue',
      'E weightedDiscount',
    ];
    const fTotals = rowHeaders.filter(label => label === 'F Total');
    const gTotals = rowHeaders.filter(label => label === 'G Total');
    const hTotals = rowHeaders.filter(label => label === 'H Total');
    const iTotals = rowHeaders.filter(label => label === 'I Total');

    expect(rowHeaders).toEqual(expect.arrayContaining(totals));
    totals.forEach(label => {
      expect(rowHeaders.filter(item => item === label)).toHaveLength(1);
    });
    expect(fTotals).toHaveLength(2);
    expect(gTotals).toHaveLength(2);
    expect(hTotals).toHaveLength(2);
    expect(iTotals).toHaveLength(2);
    expect(rowHeaders).not.toContain('F averageOrderValue');
    expect(rowHeaders).not.toContain('F weightedDiscount');
    expect(rowHeaders).not.toContain('G averageOrderValue');
    expect(rowHeaders).not.toContain('G weightedDiscount');
    expect(rowHeaders).not.toContain('H averageOrderValue');
    expect(rowHeaders).not.toContain('H weightedDiscount');
    expect(rowHeaders).not.toContain('I averageOrderValue');
    expect(rowHeaders).not.toContain('I weightedDiscount');

    const getRowIndent = (label: string) => {
      const headerCell = screen
        .getAllByText(label)[0]
        .closest('div') as HTMLElement;
      return Number.parseInt(headerCell.style.paddingLeft || '0', 10);
    };
    const indentA = getRowIndent('A');
    const indentB = getRowIndent('B');
    const indentC = getRowIndent('C');
    const indentD = getRowIndent('D');
    const indentE = getRowIndent('E');
    const indentF = getRowIndent('F');
    const indentG = getRowIndent('G');
    const indentH = getRowIndent('H');
    const indentI = getRowIndent('I');
    expect(getRowIndent('A averageOrderValue')).toBe(indentA);
    expect(getRowIndent('A weightedDiscount')).toBe(indentA);
    expect(getRowIndent('B averageOrderValue')).toBe(indentB);
    expect(getRowIndent('B weightedDiscount')).toBe(indentB);
    expect(getRowIndent('C averageOrderValue')).toBe(indentC);
    expect(getRowIndent('C weightedDiscount')).toBe(indentC);
    expect(getRowIndent('D averageOrderValue')).toBe(indentD);
    expect(getRowIndent('D weightedDiscount')).toBe(indentD);
    expect(getRowIndent('E averageOrderValue')).toBe(indentE);
    expect(getRowIndent('E weightedDiscount')).toBe(indentE);
    screen.getAllByText('F Total').forEach(node => {
      const indent = Number.parseInt(
        (node.closest('div') as HTMLElement).style.paddingLeft || '0',
        10,
      );
      expect(indent).toBe(indentF);
    });
    screen.getAllByText('G Total').forEach(node => {
      const indent = Number.parseInt(
        (node.closest('div') as HTMLElement).style.paddingLeft || '0',
        10,
      );
      expect(indent).toBe(indentG);
    });
    screen.getAllByText('H Total').forEach(node => {
      const indent = Number.parseInt(
        (node.closest('div') as HTMLElement).style.paddingLeft || '0',
        10,
      );
      expect(indent).toBe(indentH);
    });
    screen.getAllByText('I Total').forEach(node => {
      const indent = Number.parseInt(
        (node.closest('div') as HTMLElement).style.paddingLeft || '0',
        10,
      );
      expect(indent).toBe(indentI);
    });

    const assertRowHasNoValues = (label: RegExp) => {
      const rows = screen.getAllByText(label);
      rows.forEach(node => {
        const row = node.closest('tr') as HTMLTableRowElement;
        const cells = Array.from(row.querySelectorAll('td'));
        expect(cells.some(cell => cell.textContent?.trim())).toBe(false);
      });
    };
    assertRowHasNoValues(/^F$/);
    assertRowHasNoValues(/^G$/);
    assertRowHasNoValues(/^H$/);
    assertRowHasNoValues(/^I$/);
  });

  it('does not duplicate metric subtotals for the same group when multiple levels are enabled', () => {
    const { labeledTree, metrics, rowGroupby } = buildMetricSubtotalTree();

    const { container } = render(
      <PivotTableChart
        data={labeledTree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: rowGroupby,
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          rowSubTotals: true,
          rowSubtotalLevels: [1, 2],
          rowSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[1, 2]}
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
        colTotalPosition="start"
        colSubtotalPosition="start"
        rowTotalPosition="start"
        rowSubtotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim())
      .filter((label): label is string => !!label);

    expect(rowHeaders.filter(label => label === '1-5 Total')).toHaveLength(0);
    expect(
      rowHeaders.filter(label => label === '1-5 averageOrderValue'),
    ).toHaveLength(1);
    expect(
      rowHeaders.filter(label => label === '1-5 weightedDiscount'),
    ).toHaveLength(1);
  });

  it('does not render metric total rows when metrics are the first row level', () => {
    const metrics = ['measure1', 'measure2'];
    const measure1Token = encodeMetricKey('measure1');
    const measure2Token = encodeMetricKey('measure2');
    const rootKey = serializePath([]);
    const colKey = serializePath(['C1']);
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
      [serializePath([measure1Token])]: {
        axis: 'row',
        key: serializePath([measure1Token]),
        path: [measure1Token],
        label: 'measure1',
        formattedLabel: 'measure1',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [serializePath([measure2Token])]: {
        axis: 'row',
        key: serializePath([measure2Token]),
        path: [measure2Token],
        label: 'measure2',
        formattedLabel: 'measure2',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [serializePath([measure1Token, SUBTOTAL_TOKEN])]: {
        axis: 'row',
        key: serializePath([measure1Token, SUBTOTAL_TOKEN]),
        path: [measure1Token, SUBTOTAL_TOKEN],
        label: 'Total measure1',
        formattedLabel: 'Total measure1',
        level: 2,
        hasChildren: false,
        isSubtotal: true,
      },
      [serializePath([measure2Token, SUBTOTAL_TOKEN])]: {
        axis: 'row',
        key: serializePath([measure2Token, SUBTOTAL_TOKEN]),
        path: [measure2Token, SUBTOTAL_TOKEN],
        label: 'Total measure2',
        formattedLabel: 'Total measure2',
        level: 2,
        hasChildren: false,
        isSubtotal: true,
      },
      [serializePath([measure1Token, 'R1'])]: {
        axis: 'row',
        key: serializePath([measure1Token, 'R1']),
        path: [measure1Token, 'R1'],
        label: 'R1',
        formattedLabel: 'R1',
        level: 2,
        hasChildren: true,
        isSubtotal: false,
      },
      [serializePath([measure1Token, 'R1', 'R2'])]: {
        axis: 'row',
        key: serializePath([measure1Token, 'R1', 'R2']),
        path: [measure1Token, 'R1', 'R2'],
        label: 'R2',
        formattedLabel: 'R2',
        level: 3,
        hasChildren: false,
        isSubtotal: false,
      },
      [serializePath([measure2Token, 'R1'])]: {
        axis: 'row',
        key: serializePath([measure2Token, 'R1']),
        path: [measure2Token, 'R1'],
        label: 'R1',
        formattedLabel: 'R1',
        level: 2,
        hasChildren: true,
        isSubtotal: false,
      },
      [serializePath([measure2Token, 'R1', 'R2'])]: {
        axis: 'row',
        key: serializePath([measure2Token, 'R1', 'R2']),
        path: [measure2Token, 'R1', 'R2'],
        label: 'R2',
        formattedLabel: 'R2',
        level: 3,
        hasChildren: false,
        isSubtotal: false,
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
        hasChildren: true,
        isSubtotal: true,
      },
      [colKey]: {
        axis: 'col',
        key: colKey,
        path: ['C1'],
        label: 'C1',
        formattedLabel: 'C1',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(
        serializePath([measure1Token, SUBTOTAL_TOKEN]),
        colKey,
      )]: {
        rowKey: serializePath([measure1Token, SUBTOTAL_TOKEN]),
        colKey,
        values: { measure1: 100 },
        isSubtotal: true,
      },
      [serializeCellKey(
        serializePath([measure2Token, SUBTOTAL_TOKEN]),
        colKey,
      )]: {
        rowKey: serializePath([measure2Token, SUBTOTAL_TOKEN]),
        colKey,
        values: { measure2: 200 },
        isSubtotal: true,
      },
      [serializeCellKey(serializePath([measure1Token, 'R1', 'R2']), colKey)]: {
        rowKey: serializePath([measure1Token, 'R1', 'R2']),
        colKey,
        values: { measure1: 10 },
      },
      [serializeCellKey(serializePath([measure2Token, 'R1', 'R2']), colKey)]: {
        rowKey: serializePath([measure2Token, 'R1', 'R2']),
        colKey,
        values: { measure2: 20 },
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: [METRICS_PLACEHOLDER, 'r1', 'r2'],
          groupbyColumns: ['c1'],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics,
          colTotals: true,
          colTotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={['r1', 'r2']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals
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
        colTotalPosition="end"
        colSubtotalPosition="start"
        rowTotalPosition="start"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).not.toEqual(
      expect.arrayContaining(['Total measure1', 'Total measure2']),
    );
  });

  it('omits the grand total row when multiple measure leaves are visible', () => {
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
              region: 'EMEA',
              category: 'OFFICE',
              grossRevenue: 10,
              'grossRevenue__1 year ago': 8,
            },
          ],
          [metricKey],
          ['region', 'category'],
          [],
          2,
          0,
        ),
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.ROWS,
      ['region', 'category'],
      [],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region', METRICS_PLACEHOLDER, 'category'],
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.ROWS,
          metrics: [metricKey],
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
          colTotals: true,
          colTotalPosition: 'end',
        })}
        metrics={[metricKey]}
        groupbyRows={['region', 'category']}
        groupbyColumns={[]}
        {...baseProps}
        colTotals
        colTotalPosition="end"
      />,
    );

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    )
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0);
    expect(rowHeaders).not.toContain('Grand total');
  });
});
