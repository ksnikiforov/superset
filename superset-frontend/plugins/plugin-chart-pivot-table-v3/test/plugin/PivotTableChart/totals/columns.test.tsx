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

import { render, screen, waitFor, within } from '../../../testUtils';
import PivotTableChart from '../../fixtures/TestPivotTableChart';
import {
  MetricsLayoutEnum,
  PivotResultCell,
  PivotTableQueryFormData,
  PivotTreeData,
  PivotTreeNode,
} from '../../../../src/types';
import { buildFormData } from '../../fixtures/pivotFormData';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  encodeMetricKey,
  mergeTrees,
  METRICS_PLACEHOLDER,
  serializeCellKey,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../../../src/utils';

describe('PivotTableChart totals & subtotals - columns', () => {
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

  const waitForPivotReady = async () => {
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: /loading/i }),
      ).not.toBeInTheDocument(),
    );
  };

  it('renders selected column subtotals at the configured position using aggregated values', async () => {
    const detail = buildTreeFromRecords(
      [
        { region: 'US', category: 'Tech', subcategory: 'Laptop', metric1: 2 },
        { region: 'US', category: 'Tech', subcategory: 'Phone', metric1: 3 },
      ],
      ['metric1'],
      ['region'],
      ['category', 'subcategory'],
      1,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [{ region: 'US', category: 'Tech', metric1: 999 }],
      ['metric1'],
      ['region'],
      ['category', 'subcategory'],
      1,
      1,
    );
    const tree = applyMetricAxis(
      mergeTrees(subtotal, detail),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['category', 'subcategory'],
      2,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['category', 'subcategory', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          colSubtotalLevels: [1],
          colSubtotalPosition: 'start',
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['category', 'subcategory']}
        aggregateFunction="Sum"
        width={600}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const regionRow = screen
      .getByText('US')
      .closest('tr') as HTMLTableRowElement;
    const valueCells = within(regionRow).getAllByRole('cell');
    const values = valueCells.map(cell => cell.textContent?.trim());
    expect(values[0]).toBe('999');
    expect(values.slice(1)).toEqual(expect.arrayContaining(['2', '3']));
  });

  it('hides column subtotals for unselected levels', async () => {
    const detail = buildTreeFromRecords(
      [{ row1: 'A', col1: 'F', col2: 'X', col3: 'Z', metric1: 1 }],
      ['metric1'],
      ['row1'],
      ['col1', 'col2', 'col3'],
      1,
      3,
    );
    const subtotalLevel1 = buildTreeFromRecords(
      [{ row1: 'A', col1: 'F', metric1: 999 }],
      ['metric1'],
      ['row1'],
      ['col1', 'col2', 'col3'],
      1,
      1,
    );
    const subtotalLevel2 = buildTreeFromRecords(
      [{ row1: 'A', col1: 'F', col2: 'X', metric1: 555 }],
      ['metric1'],
      ['row1'],
      ['col1', 'col2', 'col3'],
      1,
      2,
    );
    const tree = applyMetricAxis(
      mergeTrees(mergeTrees(detail, subtotalLevel1), subtotalLevel2),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1', 'col2', 'col3'],
      3,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['row1'],
          groupbyColumns: ['col1', 'col2', 'col3', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          colSubtotalLevels: [2],
          colSubtotalPosition: 'end',
        })}
        metrics={['metric1']}
        groupbyRows={['row1']}
        groupbyColumns={['col1', 'col2', 'col3']}
        aggregateFunction="Sum"
        width={600}
        height={400}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[2]}
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
        colSubtotalPosition="end"
        rowTotalPosition="start"
      />,
    );

    await waitForPivotReady();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    expect(screen.queryByText('555')).toBeInTheDocument();
  });

  it('renders multi-metric column subtotals at the end even when configured at the start', async () => {
    const metrics = ['m1', 'm2'];
    const detail = buildTreeFromRecords(
      [
        { region: 'US', year: '1992', shipMode: 'AIR', m1: 1, m2: 10 },
        { region: 'US', year: '1992', shipMode: 'SEA', m1: 2, m2: 20 },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [{ region: 'US', year: '1992', m1: 100, m2: 200 }],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      1,
    );
    const tree = applyMetricAxis(
      mergeTrees(subtotal, detail),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['year', 'shipMode'],
      2,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['year', 'shipMode', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colSubtotalLevels: [1],
          colSubtotalPosition: 'start',
        })}
        metrics={metrics}
        groupbyRows={['region']}
        groupbyColumns={['year', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const regionRow = screen
      .getByText('US')
      .closest('tr') as HTMLTableRowElement;
    const values = within(regionRow)
      .getAllByRole('cell')
      .map(cell => cell.textContent?.trim());
    expect(values).toEqual(['1', '10', '2', '20', '100', '200']);
  });

  it('avoids duplicating metric subtotal columns when subtotal tokens are present', async () => {
    const metrics = ['grossRevenue', 'countCustomers'];
    const detail = buildTreeFromRecords(
      [
        {
          region: 'US',
          year: '1992',
          shipMode: 'AIR',
          grossRevenue: 1,
          countCustomers: 10,
        },
        {
          region: 'US',
          year: '1992',
          shipMode: 'NONE',
          grossRevenue: 2,
          countCustomers: 20,
        },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [
        {
          region: 'US',
          year: '1992',
          grossRevenue: 100,
          countCustomers: 200,
        },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      1,
    );
    const merged = mergeTrees(detail, subtotal);
    const subtotalPath = ['1992', SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    const baseSubtotalKey = serializePath(['1992']);
    merged.cols[subtotalKey] = {
      ...(merged.cols[baseSubtotalKey] as PivotTreeNode),
      key: subtotalKey,
      path: subtotalPath,
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: subtotalPath.length,
      hasChildren: false,
      isSubtotal: true,
    };
    const baseCellKey = serializeCellKey(
      serializePath(['US']),
      baseSubtotalKey,
    );
    const baseCell = merged.cells[baseCellKey];
    merged.cells[serializeCellKey(serializePath(['US']), subtotalKey)] = {
      ...(baseCell as PivotResultCell),
      colKey: subtotalKey,
      isSubtotal: true,
    };

    const tree = applyMetricAxis(
      merged,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['year', 'shipMode'],
      2,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['year', 'shipMode', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colSubtotalLevels: [1],
          colSubtotalPosition: 'start',
        })}
        metrics={metrics}
        groupbyRows={['region']}
        groupbyColumns={['year', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const headerRow = container.querySelector('thead tr') as HTMLElement;
    const headerLabels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    const grossRevenueCount = headerLabels.filter(
      label => label === '1992 grossRevenue',
    ).length;
    const countCustomersCount = headerLabels.filter(
      label => label === '1992 countCustomers',
    ).length;
    expect(grossRevenueCount).toBe(1);
    expect(countCustomersCount).toBe(1);
  });

  it('keeps column grand totals when column subtotals exist with multiple metrics', async () => {
    const metrics = ['grossRevenue', 'countCustomers'];
    const detail = buildTreeFromRecords(
      [
        {
          region: 'US',
          year: '1992',
          shipMode: 'AIR',
          grossRevenue: 1,
          countCustomers: 10,
        },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [
        {
          region: 'US',
          year: '1992',
          grossRevenue: 100,
          countCustomers: 200,
        },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      1,
    );
    const totals = buildTreeFromRecords(
      [
        {
          region: 'US',
          grossRevenue: 1000,
          countCustomers: 2000,
        },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      0,
    );
    const merged = mergeTrees(mergeTrees(detail, subtotal), totals);
    const subtotalPath = ['1992', SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    const baseSubtotalKey = serializePath(['1992']);
    merged.cols[subtotalKey] = {
      ...(merged.cols[baseSubtotalKey] as PivotTreeNode),
      key: subtotalKey,
      path: subtotalPath,
      label: 'Subtotal',
      formattedLabel: 'Subtotal',
      level: subtotalPath.length,
      hasChildren: false,
      isSubtotal: true,
    };
    const baseCellKey = serializeCellKey(
      serializePath(['US']),
      baseSubtotalKey,
    );
    const baseCell = merged.cells[baseCellKey];
    merged.cells[serializeCellKey(serializePath(['US']), subtotalKey)] = {
      ...(baseCell as PivotResultCell),
      colKey: subtotalKey,
      isSubtotal: true,
    };

    const tree = applyMetricAxis(
      merged,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['year', 'shipMode'],
      2,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['year', 'shipMode', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          colSubtotalLevels: [1],
          colSubtotalPosition: 'start',
        })}
        metrics={metrics}
        groupbyRows={['region']}
        groupbyColumns={['year', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toEqual(
      expect.arrayContaining(['Total grossRevenue', 'Total countCustomers']),
    );
  });

  it('keeps column group headers when collapsed after deeper expansion data exists', async () => {
    const metrics = ['grossRevenue', 'countCustomers'];
    const detail = buildTreeFromRecords(
      [
        {
          region: 'US',
          year: '1992',
          shipMode: 'AIR',
          grossRevenue: 1,
          countCustomers: 10,
        },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      2,
    );
    const subtotal = buildTreeFromRecords(
      [
        {
          region: 'US',
          year: '1992',
          grossRevenue: 100,
          countCustomers: 200,
        },
      ],
      metrics,
      ['region'],
      ['year', 'shipMode'],
      1,
      1,
    );
    const merged = mergeTrees(detail, subtotal);
    const tree = applyMetricAxis(
      merged,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['year', 'shipMode'],
      2,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['year', 'shipMode', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colSubtotalLevels: [1],
          startCollapsed: true,
          initialDepth: 1,
        })}
        metrics={metrics}
        groupbyRows={['region']}
        groupbyColumns={['year', 'shipMode']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    const topLabels = within(headerRows[0])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    const secondLabels = within(headerRows[1])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    const allLabels = [...topLabels, ...secondLabels];
    expect(topLabels).toEqual(expect.arrayContaining(['1992']));
    expect(secondLabels).toEqual(
      expect.arrayContaining(['grossRevenue', 'countCustomers']),
    );
    expect(allLabels).not.toContain('1992 grossRevenue');
    expect(allLabels).not.toContain('1992 countCustomers');
  });

  test.each(['start', 'end'] as const)(
    'positions grand totals at the %s for rows and columns when configured',
    async position => {
      const totalsOnly = buildTreeFromRecords(
        [{ metric1: 12 }],
        ['metric1'],
        ['region'],
        ['category'],
        0,
        0,
      );
      const detail = buildTreeFromRecords(
        [{ region: 'US', category: 'Tech', metric1: 5 }],
        ['metric1'],
        ['region'],
        ['category'],
        1,
        1,
      );
      const tree = applyMetricAxis(
        mergeTrees(totalsOnly, detail),
        ['metric1'],
        MetricsLayoutEnum.COLUMNS,
        ['region'],
        ['category'],
        1,
      );

      const { container } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['region'],
            groupbyColumns: ['category', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics: ['metric1'],
            rowSubtotalLevels: [0],
            colSubtotalLevels: [0],
            colTotalPosition: position,
            rowTotalPosition: position,
          })}
          metrics={['metric1']}
          groupbyRows={['region']}
          groupbyColumns={['category']}
          aggregateFunction="Sum"
          width={400}
          height={300}
          startCollapsed={false}
          initialDepth={1}
          colTotals={false}
          rowTotals={false}
          rowSubTotals={false}
          rowSubtotalLevels={[0]}
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
          colTotalPosition={position}
          colSubtotalPosition="start"
          rowTotalPosition={position}
        />,
      );

      await waitForPivotReady();
      const headerRow = container.querySelector(
        'thead tr:first-child',
      ) as HTMLElement;
      const headers = within(headerRow).getAllByRole('columnheader');
      const headerLabels = headers
        .slice(1)
        .map(cell => cell.textContent?.trim());
      const headerIndex = position === 'end' ? headerLabels.length - 1 : 0;
      expect(headerLabels[headerIndex]).toBe('Grand total');

      const bodyRows = within(
        container.querySelector('tbody') as HTMLElement,
      ).getAllByRole('row');
      const getRowLabel = (row: HTMLElement) =>
        (row.querySelector('th')?.textContent || '').trim();
      const firstRowLabel = getRowLabel(bodyRows[0]);
      const lastRowLabel = getRowLabel(bodyRows[bodyRows.length - 1]);
      const isEnd = position === 'end';
      expect(firstRowLabel === 'Grand total').toBe(!isEnd);
      expect(lastRowLabel === 'Grand total').toBe(isEnd);
    },
  );

  it('shows column grand total when enabled without selecting level 0', async () => {
    const detail = buildTreeFromRecords(
      [{ region: 'US', category: 'Tech', metric1: 5 }],
      ['metric1'],
      ['region'],
      ['category'],
      1,
      1,
    );
    const total = buildTreeFromRecords(
      [{ region: 'US', metric1: 8 }],
      ['metric1'],
      ['region'],
      ['category'],
      1,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, total),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['region'],
      ['category'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['category', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          rowTotals: true,
          colSubtotalLevels: [],
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['category']}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed={false}
        initialDepth={1}
        colTotals={false}
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
        rowTotalPosition="start"
      />,
    );

    await waitForPivotReady();
    const header = container.querySelector('thead') as HTMLElement;
    expect(within(header).getByText('Grand total')).toBeInTheDocument();
    const bodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(within(bodyRow).getByText('8')).toBeInTheDocument();
  });

  it('renders metric-specific column grand totals when metrics are on columns', async () => {
    const metricsVariants = [
      ['averageOrderValue', 'weightedDiscount'],
      ['averageOrderValue', 'weightedDiscount', 'countOrders'],
    ];
    const buildMetricValues = (metrics: string[], baseValue: number) =>
      metrics.reduce<Record<string, number>>((acc, metric, index) => {
        acc[metric] = baseValue * (index + 1);
        return acc;
      }, {});

    for (const metrics of metricsVariants) {
      const detail = buildTreeFromRecords(
        [
          {
            orderPriority: '1-URGENT',
            shipMode: 'AIR',
            ...buildMetricValues(metrics, 10),
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
            orderPriority: '1-URGENT',
            ...buildMetricValues(metrics, 100),
          },
        ],
        metrics,
        ['orderPriority'],
        ['shipMode'],
        1,
        0,
      );
      const tree = applyMetricAxis(
        mergeTrees(detail, totals),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        ['orderPriority'],
        ['shipMode'],
        1,
      );

      const { container, unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...(baseProps as Partial<PivotTableQueryFormData>),
            groupbyRows: ['orderPriority'],
            groupbyColumns: ['shipMode', '__MEASURES__'],
            metricsLayout: MetricsLayoutEnum.COLUMNS,
            metrics,
            rowTotals: true,
            rowTotalPosition: 'end',
          })}
          metrics={metrics}
          groupbyRows={['orderPriority']}
          groupbyColumns={['shipMode']}
          aggregateFunction="Sum"
          width={600}
          height={300}
          startCollapsed={false}
          initialDepth={1}
          colTotals={false}
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

      await waitForPivotReady();
      const header = container.querySelector('thead') as HTMLElement;
      const headers = within(header)
        .getAllByRole('columnheader')
        .map(cell => cell.textContent?.trim())
        .filter(label => label && label !== 'Rows');
      metrics.forEach(metric => {
        expect(headers).toEqual(
          expect.arrayContaining([metric, `Total ${metric}`]),
        );
      });

      const urgentRow = screen
        .getByText('1-URGENT')
        .closest('tr') as HTMLTableRowElement;
      const values = within(urgentRow)
        .getAllByRole('cell')
        .map(cell => cell.textContent?.trim());
      const expectedTotals = metrics.map((_, index) =>
        String(100 * (index + 1)),
      );
      expect(values).toEqual(expect.arrayContaining(expectedTotals));
      unmount();
    }
  });

  it('orders metric columns by selection when metrics are on columns', async () => {
    const metrics = ['metricB', 'metricA', 'metricC'];
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [
          {
            orderPriority: '1-URGENT',
            metricB: 10,
            metricA: 20,
            metricC: 30,
          },
        ],
        metrics,
        ['orderPriority'],
        [],
        1,
        0,
      ),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['orderPriority'],
      [],
      0,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['orderPriority'],
          groupbyColumns: [METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
        })}
        metrics={metrics}
        groupbyRows={['orderPriority']}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
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

    await waitForPivotReady();
    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const headerLabels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toEqual(metrics);
  });

  it('omits the grand total column when multiple metrics are on columns and keeps the grand total row', async () => {
    const metrics = ['m1', 'm2'];
    const detail = buildTreeFromRecords(
      [{ orderPriority: '1-URGENT', shipMode: 'AIR', m1: 10, m2: 20 }],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      1,
      1,
    );
    const totals = buildTreeFromRecords(
      [{ orderPriority: '1-URGENT', m1: 100, m2: 200 }],
      metrics,
      ['orderPriority'],
      ['shipMode'],
      1,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
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
          groupbyColumns: ['shipMode', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
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

    await waitForPivotReady();
    const header = container.querySelector('thead') as HTMLElement;
    const headerLabels = within(header)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).not.toContain('Grand total');

    const rowHeaders = Array.from(
      container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
    ).map(cell => cell.textContent?.trim());
    expect(rowHeaders).toContain('Grand total');
  });

  it('does not render metric total headers when metrics are the first column level', async () => {
    const metrics = ['measure1', 'measure2'];
    const measure1Token = encodeMetricKey('measure1');
    const measure2Token = encodeMetricKey('measure2');
    const rootKey = serializePath([]);
    const rowKey = serializePath(['R1']);
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
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['R1'],
        label: 'R1',
        formattedLabel: 'R1',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const measure1Key = serializePath([measure1Token]);
    const measure2Key = serializePath([measure2Token]);
    const measure1TotalKey = serializePath([measure1Token, SUBTOTAL_TOKEN]);
    const measure2TotalKey = serializePath([measure2Token, SUBTOTAL_TOKEN]);
    const measure1LeafKey = serializePath([measure1Token, 'C1', 'C2']);
    const measure2LeafKey = serializePath([measure2Token, 'C1', 'C2']);
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
      [measure1Key]: {
        axis: 'col',
        key: measure1Key,
        path: [measure1Token],
        label: 'measure1',
        formattedLabel: 'measure1',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [measure2Key]: {
        axis: 'col',
        key: measure2Key,
        path: [measure2Token],
        label: 'measure2',
        formattedLabel: 'measure2',
        level: 1,
        hasChildren: true,
        isSubtotal: false,
      },
      [measure1TotalKey]: {
        axis: 'col',
        key: measure1TotalKey,
        path: [measure1Token, SUBTOTAL_TOKEN],
        label: 'Total measure1',
        formattedLabel: 'Total measure1',
        level: 2,
        hasChildren: false,
        isSubtotal: true,
      },
      [measure2TotalKey]: {
        axis: 'col',
        key: measure2TotalKey,
        path: [measure2Token, SUBTOTAL_TOKEN],
        label: 'Total measure2',
        formattedLabel: 'Total measure2',
        level: 2,
        hasChildren: false,
        isSubtotal: true,
      },
      [serializePath([measure1Token, 'C1'])]: {
        axis: 'col',
        key: serializePath([measure1Token, 'C1']),
        path: [measure1Token, 'C1'],
        label: 'C1',
        formattedLabel: 'C1',
        level: 2,
        hasChildren: true,
        isSubtotal: false,
      },
      [serializePath([measure2Token, 'C1'])]: {
        axis: 'col',
        key: serializePath([measure2Token, 'C1']),
        path: [measure2Token, 'C1'],
        label: 'C1',
        formattedLabel: 'C1',
        level: 2,
        hasChildren: true,
        isSubtotal: false,
      },
      [measure1LeafKey]: {
        axis: 'col',
        key: measure1LeafKey,
        path: [measure1Token, 'C1', 'C2'],
        label: 'C2',
        formattedLabel: 'C2',
        level: 3,
        hasChildren: false,
        isSubtotal: false,
      },
      [measure2LeafKey]: {
        axis: 'col',
        key: measure2LeafKey,
        path: [measure2Token, 'C1', 'C2'],
        label: 'C2',
        formattedLabel: 'C2',
        level: 3,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(rowKey, measure1TotalKey)]: {
        rowKey,
        colKey: measure1TotalKey,
        values: { measure1: 100 },
        isSubtotal: true,
      },
      [serializeCellKey(rowKey, measure2TotalKey)]: {
        rowKey,
        colKey: measure2TotalKey,
        values: { measure2: 200 },
        isSubtotal: true,
      },
      [serializeCellKey(rowKey, measure1LeafKey)]: {
        rowKey,
        colKey: measure1LeafKey,
        values: { measure1: 10 },
      },
      [serializeCellKey(rowKey, measure2LeafKey)]: {
        rowKey,
        colKey: measure2LeafKey,
        values: { measure2: 20 },
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['r1'],
          groupbyColumns: [METRICS_PLACEHOLDER, 'c1', 'c2'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          rowTotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={['r1']}
        groupbyColumns={['c1', 'c2']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
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

    await waitForPivotReady();
    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).not.toEqual(
      expect.arrayContaining(['Total measure1', 'Total measure2']),
    );
  });

  it('renders metric-specific column grand totals when metrics are nested at depth 2', async () => {
    const metrics = ['measure1', 'measure2'];
    const detail = buildTreeFromRecords(
      [
        {
          r1: 'R1',
          c1: 'A',
          c2: 'B',
          measure1: 1,
          measure2: 2,
        },
      ],
      metrics,
      ['r1'],
      ['c1', 'c2'],
      1,
      2,
    );
    const totals = buildTreeFromRecords(
      [
        {
          r1: 'R1',
          measure1: 10,
          measure2: 20,
        },
      ],
      metrics,
      ['r1'],
      ['c1', 'c2'],
      1,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1', 'c2'],
      2,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['r1'],
          groupbyColumns: ['c1', 'c2', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          rowTotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={['r1']}
        groupbyColumns={['c1', 'c2']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
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

    await waitForPivotReady();
    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toEqual(
      expect.arrayContaining(['Total measure1', 'Total measure2']),
    );
  });

  it('renders metric-specific column grand totals when metrics are nested at depth 3', async () => {
    const metrics = ['measure1', 'measure2'];
    const detail = buildTreeFromRecords(
      [
        {
          r1: 'R1',
          c1: 'A',
          c2: 'B',
          c3: 'C',
          measure1: 1,
          measure2: 2,
        },
      ],
      metrics,
      ['r1'],
      ['c1', 'c2', 'c3'],
      1,
      3,
    );
    const totals = buildTreeFromRecords(
      [
        {
          r1: 'R1',
          measure1: 10,
          measure2: 20,
        },
      ],
      metrics,
      ['r1'],
      ['c1', 'c2', 'c3'],
      1,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(detail, totals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1', 'c2', 'c3'],
      3,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['r1'],
          groupbyColumns: ['c1', 'c2', 'c3', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          rowTotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={['r1']}
        groupbyColumns={['c1', 'c2', 'c3']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
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

    await waitForPivotReady();
    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toEqual(
      expect.arrayContaining(['Total measure1', 'Total measure2']),
    );
  });

  it('renders metric-specific column subtotals even when they match grand totals', async () => {
    const metrics = ['measure1', 'measure2'];
    const detail = buildTreeFromRecords(
      [
        {
          r1: 'R1',
          c1: 'Group1',
          c2: 'Leaf1',
          measure1: 1,
          measure2: 2,
        },
      ],
      metrics,
      ['r1'],
      ['c1', 'c2'],
      1,
      2,
    );
    const subtotals = buildTreeFromRecords(
      [
        {
          r1: 'R1',
          c1: 'Group1',
          measure1: 10,
          measure2: 20,
        },
      ],
      metrics,
      ['r1'],
      ['c1', 'c2'],
      1,
      1,
    );
    const totals = buildTreeFromRecords(
      [
        {
          r1: 'R1',
          measure1: 10,
          measure2: 20,
        },
      ],
      metrics,
      ['r1'],
      ['c1', 'c2'],
      1,
      0,
    );
    const tree = applyMetricAxis(
      mergeTrees(mergeTrees(detail, subtotals), totals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1', 'c2'],
      2,
    );

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['r1'],
          groupbyColumns: ['c1', 'c2', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          rowTotals: true,
          colSubtotalLevels: [1],
          rowTotalPosition: 'end',
          colSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={['r1']}
        groupbyColumns={['c1', 'c2']}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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
        colSubtotalPosition="end"
        rowTotalPosition="end"
      />,
    );

    await waitForPivotReady();
    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toEqual(
      expect.arrayContaining([
        'Group1 measure1',
        'Group1 measure2',
        'Total measure1',
        'Total measure2',
      ]),
    );
  });

  it('does not render parent column totals as leaves when branch subtotals exist under multiple column roots', async () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => {
      const rawLabel = path[path.length - 1] || 'Grand total';
      const label = rawLabel === SUBTOTAL_TOKEN ? 'Subtotal' : rawLabel;
      return {
        axis: 'col',
        key: serializePath(path),
        path,
        label,
        formattedLabel: label,
        level: path.length,
        hasChildren,
        isSubtotal,
      };
    };

    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', SUBTOTAL_TOKEN])]: makeColNode(
        ['A', SUBTOTAL_TOKEN],
        true,
      ),
      [serializePath(['A', '1-URGENT'])]: makeColNode(['A', '1-URGENT']),
      [serializePath(['A', '2-HIGH'])]: makeColNode(['A', '2-HIGH']),
      [serializePath(['N'])]: makeColNode(['N'], true, true),
      [serializePath(['N', SUBTOTAL_TOKEN])]: makeColNode(
        ['N', SUBTOTAL_TOKEN],
        true,
      ),
      [serializePath(['N', '1-URGENT'])]: makeColNode(['N', '1-URGENT']),
      [serializePath(['N', '2-HIGH'])]: makeColNode(['N', '2-HIGH']),
    };
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
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(rowKey, serializePath(['A', '1-URGENT']))]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT']),
        values: { metric1: 10 },
      },
      [serializeCellKey(rowKey, serializePath(['A', '2-HIGH']))]: {
        rowKey,
        colKey: serializePath(['A', '2-HIGH']),
        values: { metric1: 20 },
      },
      [serializeCellKey(rowKey, serializePath(['A', SUBTOTAL_TOKEN]))]: {
        rowKey,
        colKey: serializePath(['A', SUBTOTAL_TOKEN]),
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [serializeCellKey(rowKey, serializePath(['N', '1-URGENT']))]: {
        rowKey,
        colKey: serializePath(['N', '1-URGENT']),
        values: { metric1: 30 },
      },
      [serializeCellKey(rowKey, serializePath(['N', '2-HIGH']))]: {
        rowKey,
        colKey: serializePath(['N', '2-HIGH']),
        values: { metric1: 40 },
      },
      [serializeCellKey(rowKey, serializePath(['N', SUBTOTAL_TOKEN]))]: {
        rowKey,
        colKey: serializePath(['N', SUBTOTAL_TOKEN]),
        values: { metric1: 70 },
        isSubtotal: true,
      },
      [serializeCellKey(rowKey, rootKey)]: {
        rowKey,
        colKey: rootKey,
        values: { metric1: 100 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['flag', 'priority', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          rowTotals: true,
          colSubtotalLevels: [1],
          colSubtotalPosition: 'start',
          rowTotalPosition: 'end',
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .slice(1);
    expect(labels).not.toContain('A');
    expect(labels).not.toContain('N');
  });

  it('currently renders both parent total and subtotal leaves when column subtotals are enabled (duplication)', async () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => {
      const rawLabel = path[path.length - 1] || 'Grand total';
      const label = rawLabel === SUBTOTAL_TOKEN ? 'Subtotal' : rawLabel;
      return {
        axis: 'col',
        key: serializePath(path),
        path,
        label,
        formattedLabel: label,
        level: path.length,
        hasChildren,
        isSubtotal,
      };
    };

    // Build a tree where the parent column node is marked as a subtotal and
    // also has a child subtotal leaf, matching the UI duplication scenario.
    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', '1-URGENT'])]: makeColNode(['A', '1-URGENT']),
      [serializePath(['A', '2-HIGH'])]: makeColNode(['A', '2-HIGH']),
      // Parent total encoded as a leaf at the same depth as children.
      [serializePath(['A', 'A'])]: makeColNode(['A', 'A'], true),
      [serializePath(['A', SUBTOTAL_TOKEN])]: makeColNode(
        ['A', SUBTOTAL_TOKEN],
        true,
      ),
    };
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
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(rowKey, serializePath(['A']))]: {
        rowKey,
        colKey: serializePath(['A']),
        values: { metric1: 100 },
        isSubtotal: true,
      },
      [serializeCellKey(rowKey, serializePath(['A', '1-URGENT']))]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT']),
        values: { metric1: 10 },
      },
      [serializeCellKey(rowKey, serializePath(['A', '2-HIGH']))]: {
        rowKey,
        colKey: serializePath(['A', '2-HIGH']),
        values: { metric1: 20 },
      },
      [serializeCellKey(rowKey, serializePath(['A', 'A']))]: {
        rowKey,
        colKey: serializePath(['A', 'A']),
        values: { metric1: 25 },
        isSubtotal: true,
      },
      [serializeCellKey(rowKey, serializePath(['A', SUBTOTAL_TOKEN]))]: {
        rowKey,
        colKey: serializePath(['A', SUBTOTAL_TOKEN]),
        values: { metric1: 30 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['flag', 'priority', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          rowTotals: true,
          colSubtotalLevels: [1],
          colSubtotalPosition: 'start',
          rowTotalPosition: 'end',
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    // Desired behavior: parent total leaf should not render alongside branch subtotal leaves.
    expect(labels).not.toContain('A');
    expect(labels).toEqual(
      expect.arrayContaining(['1-URGENT', '2-HIGH', 'Subtotal']),
    );
  });

  it('suppresses duplicated ancestor subtotal leaves on deeper column levels', async () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => {
      const rawLabel = path[path.length - 1] || 'Grand total';
      const label = rawLabel === SUBTOTAL_TOKEN ? 'Subtotal' : rawLabel;
      return {
        axis: 'col',
        key: serializePath(path),
        path,
        label,
        formattedLabel: label,
        level: path.length,
        hasChildren,
        isSubtotal,
      };
    };

    // Shape: flag -> priority -> bucket, with a redundant ancestor total leaf at depth 3.
    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', '1-URGENT'])]: makeColNode(
        ['A', '1-URGENT'],
        true,
        true,
      ),
      [serializePath(['A', '1-URGENT', '10k-50k'])]: makeColNode([
        'A',
        '1-URGENT',
        '10k-50k',
      ]),
      [serializePath(['A', '1-URGENT', '1k-5k'])]: makeColNode([
        'A',
        '1-URGENT',
        '1k-5k',
      ]),
      [serializePath(['A', '1-URGENT', SUBTOTAL_TOKEN])]: makeColNode(
        ['A', '1-URGENT', SUBTOTAL_TOKEN],
        true,
      ),
      // Redundant ancestor total leaf that should be suppressed.
      [serializePath(['A', '1-URGENT', 'A'])]: makeColNode(
        ['A', '1-URGENT', 'A'],
        true,
      ),
    };
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
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(rowKey, serializePath(['A', '1-URGENT', '10k-50k']))]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', '10k-50k']),
        values: { metric1: 10 },
      },
      [serializeCellKey(rowKey, serializePath(['A', '1-URGENT', '1k-5k']))]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', '1k-5k']),
        values: { metric1: 20 },
      },
      [serializeCellKey(rowKey, serializePath(['A', '1-URGENT', 'A']))]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', 'A']),
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [serializeCellKey(
        rowKey,
        serializePath(['A', '1-URGENT', SUBTOTAL_TOKEN]),
      )]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT', SUBTOTAL_TOKEN]),
        values: { metric1: 30 },
        isSubtotal: true,
      },
      [serializeCellKey(rowKey, rootKey)]: {
        rowKey,
        colKey: rootKey,
        values: { metric1: 60 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['flag', 'priority', 'bucket', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          rowTotals: true,
          colSubtotalLevels: [2],
          colSubtotalPosition: 'start',
          rowTotalPosition: 'end',
          startCollapsed: false,
          initialDepth: 3,
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority', 'bucket']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={3}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[2]}
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

    await waitForPivotReady();
    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const labels = within(headerRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(labels).not.toContain('A');
    expect(labels).toEqual(
      expect.arrayContaining(['10k-50k', '1k-5k', 'Subtotal']),
    );

    // Subtotal header should not show expand/collapse toggles.
    const subtotalHeader = within(headerRow)
      .getByText('Subtotal')
      .closest('th') as HTMLElement;
    expect(
      within(subtotalHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(subtotalHeader).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
  });

  it('orders deep column totals and subtotals according to positions across five levels (end)', async () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const cols: Record<string, PivotTreeNode> = {};
    const labels = ['L1', 'L2', 'L3', 'L4', 'L5'];
    cols[rootKey] = {
      axis: 'col',
      key: rootKey,
      path: [],
      label: 'Grand total',
      formattedLabel: 'Grand total',
      level: 0,
      hasChildren: true,
      isSubtotal: true,
    };
    labels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      cols[serializePath(nextPath)] = {
        axis: 'col',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < labels.length - 1,
        isSubtotal: idx < labels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
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
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells = labels.reduce(
      (acc, label, idx) => {
        acc[serializeCellKey(rowKey, serializePath(labels.slice(0, idx + 1)))] =
          {
            rowKey,
            colKey: serializePath(labels.slice(0, idx + 1)),
            values: { metric1: (idx + 1) * 5 },
            isSubtotal: idx < labels.length - 1,
          };
        return acc;
      },
      {} as Record<string, PivotResultCell>,
    );
    cells[serializeCellKey(rowKey, rootKey)] = {
      rowKey,
      colKey: rootKey,
      values: { metric1: 500 },
      isSubtotal: true,
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['l1', 'l2', 'l3', 'l4', 'l5', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          rowTotals: true,
          colSubtotalLevels: [1, 3],
          colSubtotalPosition: 'end',
          rowTotalPosition: 'end',
          startCollapsed: false,
          initialDepth: 5,
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['l1', 'l2', 'l3', 'l4', 'l5']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={5}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1, 3]}
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
        colSubtotalPosition="end"
        rowTotalPosition="end"
      />,
    );

    await waitForPivotReady();
    const allHeaders = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(allHeaders).toEqual(
      expect.arrayContaining(['L5', 'L3', 'L1', 'Grand total']),
    );
    const bodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(within(bodyRow).getAllByRole('cell').length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('orders deep column totals and subtotals at the start when configured across five levels', async () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const cols: Record<string, PivotTreeNode> = {};
    const labels = ['L1', 'L2', 'L3', 'L4', 'L5'];
    cols[rootKey] = {
      axis: 'col',
      key: rootKey,
      path: [],
      label: 'Grand total',
      formattedLabel: 'Grand total',
      level: 0,
      hasChildren: true,
      isSubtotal: true,
    };
    labels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      cols[serializePath(nextPath)] = {
        axis: 'col',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < labels.length - 1,
        isSubtotal: idx < labels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
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
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells = labels.reduce(
      (acc, label, idx) => {
        acc[serializeCellKey(rowKey, serializePath(labels.slice(0, idx + 1)))] =
          {
            rowKey,
            colKey: serializePath(labels.slice(0, idx + 1)),
            values: { metric1: (idx + 1) * 5 },
            isSubtotal: idx < labels.length - 1,
          };
        return acc;
      },
      {} as Record<string, PivotResultCell>,
    );
    cells[serializeCellKey(rowKey, rootKey)] = {
      rowKey,
      colKey: rootKey,
      values: { metric1: 500 },
      isSubtotal: true,
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['l1', 'l2', 'l3', 'l4', 'l5', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          rowTotals: true,
          colSubtotalLevels: [1, 3],
          colSubtotalPosition: 'start',
          rowTotalPosition: 'start',
          startCollapsed: false,
          initialDepth: 5,
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['l1', 'l2', 'l3', 'l4', 'l5']}
        aggregateFunction="Sum"
        width={800}
        height={400}
        startCollapsed={false}
        initialDepth={5}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1, 3]}
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

    await waitForPivotReady();
    const allHeaders = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(allHeaders).toEqual(
      expect.arrayContaining(['Grand total', 'L1', 'L3', 'L5']),
    );
    const bodyRow = container.querySelector('tbody tr') as HTMLElement;
    expect(within(bodyRow).getAllByRole('cell').length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('does not render expansion toggles for subtotal headers', async () => {
    const rootKey = serializePath([]);
    const rowKey = serializePath(['US']);
    const makeColNode = (
      path: string[],
      isSubtotal = false,
      hasChildren = false,
    ): PivotTreeNode => {
      const rawLabel = path[path.length - 1] || 'Grand total';
      const label = rawLabel === SUBTOTAL_TOKEN ? 'Subtotal' : rawLabel;
      return {
        axis: 'col',
        key: serializePath(path),
        path,
        label,
        formattedLabel: label,
        level: path.length,
        hasChildren,
        isSubtotal,
      };
    };

    const cols: Record<string, PivotTreeNode> = {
      [rootKey]: makeColNode([], true, true),
      [serializePath(['A'])]: makeColNode(['A'], true, true),
      [serializePath(['A', SUBTOTAL_TOKEN])]: makeColNode(
        ['A', SUBTOTAL_TOKEN],
        true,
      ),
      [serializePath(['A', '1-URGENT'])]: makeColNode(['A', '1-URGENT']),
    };
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
      [rowKey]: {
        axis: 'row',
        key: rowKey,
        path: ['US'],
        label: 'US',
        formattedLabel: 'US',
        level: 1,
        hasChildren: false,
        isSubtotal: false,
      },
    };
    const cells: Record<string, PivotResultCell> = {
      [serializeCellKey(rowKey, serializePath(['A', '1-URGENT']))]: {
        rowKey,
        colKey: serializePath(['A', '1-URGENT']),
        values: { metric1: 10 },
      },
      [serializeCellKey(rowKey, serializePath(['A', SUBTOTAL_TOKEN]))]: {
        rowKey,
        colKey: serializePath(['A', SUBTOTAL_TOKEN]),
        values: { metric1: 20 },
        isSubtotal: true,
      },
    };
    const tree: PivotTreeData = { rows, cols, cells };

    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...(baseProps as Partial<PivotTableQueryFormData>),
          groupbyRows: ['region'],
          groupbyColumns: ['flag', 'priority', '__MEASURES__'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: ['metric1'],
          rowTotals: true,
          colSubtotalLevels: [1],
          colSubtotalPosition: 'start',
          rowTotalPosition: 'end',
          startCollapsed: false,
          initialDepth: 2,
        })}
        metrics={['metric1']}
        groupbyRows={['region']}
        groupbyColumns={['flag', 'priority']}
        aggregateFunction="Sum"
        width={600}
        height={400}
        startCollapsed={false}
        initialDepth={2}
        colTotals={false}
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1]}
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

    await waitForPivotReady();
    const headerRow = container.querySelector(
      'thead tr:last-child',
    ) as HTMLElement;
    const subtotalHeader = within(headerRow)
      .getByText('Subtotal')
      .closest('th') as HTMLElement;
    expect(
      within(subtotalHeader).queryByLabelText('plus-square'),
    ).not.toBeInTheDocument();
    expect(
      within(subtotalHeader).queryByLabelText('minus-square'),
    ).not.toBeInTheDocument();
  });
});
