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

import { supersetTheme } from '@superset-ui/core';
import { fireEvent, render, screen, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import {
  MetricsLayoutEnum,
  PivotTableProps,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  applyMeasureHierarchyAxis,
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  mergeTrees,
  serializeCellKey,
  serializePath,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from '../../../src/utils';
import {
  applyMeasureLeafValuesToTree,
  buildBuiltInLeaf,
  buildCustomLeaf,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';
import { fetchPivotBranch } from '../../../src/fetchPivotBranch';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

const waitForPivotReady = async () => {
  await waitFor(() =>
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument(),
  );
};

const baseFormData: Partial<PivotTableQueryFormData> = {
  groupbyRows: ['r1'],
  groupbyColumns: ['c1'],
  metrics: ['metric1'],
  aggregateFunction: 'Sum',
  colTotals: false,
  rowTotals: false,
  rowSubTotals: false,
  rowSubtotalLevels: [],
  colSubtotalLevels: [],
  startCollapsed: false,
  initialDepth: 1,
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  metricsLayout: MetricsLayoutEnum.COLUMNS,
  viz_type: 'pivot_table_v3',
  datasource: '1__table',
  metricColorFormatters: [],
  dateFormatters: {},
};

it('renders the metric header without a grand total when columns only contain Values', () => {
  const metrics = ['metric1'];
  const rowGroupby = ['row1'];
  const colGroupby: string[] = [];
  const baseTreeRaw = buildTreeFromRecords(
    [{ row1: 'A', metric1: 10 }],
    metrics,
    rowGroupby,
    colGroupby,
    1,
    0,
  );
  const tree = applyMetricAxis(
    baseTreeRaw,
    metrics,
    MetricsLayoutEnum.COLUMNS,
    rowGroupby,
    colGroupby,
    0,
  );

  const { container } = render(
    <PivotTableChart
      data={tree}
      formData={buildFormData({
        ...(baseFormData as Partial<PivotTableQueryFormData>),
        groupbyRows: rowGroupby,
        groupbyColumns: [METRICS_PLACEHOLDER],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        metrics,
        rowTotals: false,
        colTotals: false,
      })}
      metrics={metrics}
      groupbyRows={rowGroupby}
      groupbyColumns={colGroupby}
    />,
  );

  const headerLabels = Array.from(container.querySelectorAll('thead th'))
    .map(th => th.textContent?.trim())
    .filter(label => label && label !== 'Rows');
  expect(headerLabels).toContain('metric1');
  expect(headerLabels).not.toContain('Grand total');
});

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
    [serializePath(['C1', encodeMetricKey('metric1')])]: {
      axis: 'col',
      key: serializePath(['C1', encodeMetricKey('metric1')]),
      path: ['C1', encodeMetricKey('metric1')],
      label: 'metric1',
      formattedLabel: 'metric1',
      level: 2,
      hasChildren: false,
    },
  },
  cells: {
    [serializeCellKey(serializePath(['A']), serializePath(['C1']))]: {
      rowKey: serializePath(['A']),
      colKey: serializePath(['C1']),
      values: { metric1: 10 },
    },
    [serializeCellKey(
      serializePath(['A']),
      serializePath(['C1', encodeMetricKey('metric1')]),
    )]: {
      rowKey: serializePath(['A']),
      colKey: serializePath(['C1', encodeMetricKey('metric1')]),
      values: { metric1: 10 },
    },
  },
};

const injectColumnSubtotalLeaves = (
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) => {
  if (depth <= 0 || depth >= fullDepth) {
    return tree;
  }
  const next: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };
  const subtotalNodes = Object.values(tree.cols).filter(
    node => node.path.length === depth && node.path.length > 0,
  );
  subtotalNodes.forEach(node => {
    const subtotalPath = [...node.path, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    if (!next.cols[subtotalKey]) {
      next.cols[subtotalKey] = {
        ...node,
        key: subtotalKey,
        path: subtotalPath,
        label: SUBTOTAL_LABEL,
        formattedLabel: SUBTOTAL_LABEL,
        level: subtotalPath.length,
        hasChildren: subtotalPath.length < fullDepth,
        isSubtotal: true,
      };
    }
  });
  Object.values(tree.cells).forEach(cell => {
    const baseColPath = tree.cols[cell.colKey]?.path;
    if (
      !baseColPath ||
      baseColPath.length !== depth ||
      baseColPath.length === 0
    ) {
      return;
    }
    const subtotalColKey = serializePath([...baseColPath, SUBTOTAL_TOKEN]);
    const cellKey = serializeCellKey(cell.rowKey, subtotalColKey);
    next.cells[cellKey] = {
      ...cell,
      colKey: subtotalColKey,
      isSubtotal: true,
    };
  });
  return next;
};

describe('PivotTableChart metric tier suppression', () => {
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  it('hides the metric column header when there is a single metric at the last column level', async () => {
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

    render(<PivotTableChart {...props} />);
    await waitForPivotReady();

    expect(screen.queryByText('metric1')).not.toBeInTheDocument();
    expect(screen.getByText('C1')).toBeInTheDocument();
  });

  it('applies background and text colors from formatting metrics', async () => {
    const formattedTree: PivotTreeData = {
      ...baseTree,
      cells: {
        ...baseTree.cells,
        [serializeCellKey(serializePath(['A']), serializePath(['C1']))]: {
          rowKey: serializePath(['A']),
          colKey: serializePath(['C1']),
          values: {
            metric1: 10,
            metric1_bg: '#111111',
            metric1_text: '#00ff00',
          },
        },
        [serializeCellKey(
          serializePath(['A']),
          serializePath(['C1', encodeMetricKey('metric1')]),
        )]: {
          rowKey: serializePath(['A']),
          colKey: serializePath(['C1', encodeMetricKey('metric1')]),
          values: {
            metric1: 11,
            metric1_bg: '#222222',
            metric1_text: '#ff0000',
          },
        },
      },
    };

    render(
      <PivotTableChart
        data={formattedTree}
        formData={buildFormData({
          ...baseFormData,
          metricFormatting: {
            metric1: {
              backgroundColor: 'metric1_bg',
              textColor: 'metric1_text',
            },
          },
        })}
        metrics={['metric1']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const cell = screen.getByText('10').closest('td');
    expect(cell).toHaveStyle({
      backgroundColor: '#111111',
      color: '#00ff00',
    });
  });

  it('renders databars for configured metrics', async () => {
    render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          metricDatabars: {
            metric1: {
              type: 'bar',
              positiveColor: '#666666',
              negativeColor: '#666666',
            },
          },
        })}
        metrics={['metric1']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const databars = screen.getAllByTestId('pivot-databar');
    expect(databars.length).toBeGreaterThan(0);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('scales databars using union of scale-like group values', async () => {
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [
          {
            r1: 'A',
            c1: 'C1',
            metric1: 10,
            metric2: 100,
          },
        ],
        ['metric1', 'metric2'],
        ['r1'],
        ['c1'],
        1,
        1,
      ),
      ['metric1', 'metric2'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...baseFormData,
          metrics: ['metric1', 'metric2'],
          metricDatabars: {
            metric1: {
              type: 'bar',
              scaleLike: 'metric2',
            },
            metric2: {
              type: 'bar',
            },
          },
        })}
        metrics={['metric1', 'metric2']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const cell = screen.getByText('10').closest('td');
    expect(cell).toBeTruthy();
    if (!cell) {
      return;
    }
    const bar = within(cell).getByTestId('pivot-databar-bar');
    const widthPct = Number.parseFloat(bar.style.width);
    expect(widthPct).toBeCloseTo(10, 1);
  });

  it('caps databar scale width for visual comparability', async () => {
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [
          {
            r1: 'A',
            c1: 'C1',
            metric1: 10,
            metric_with_long_label: 20,
          },
        ],
        ['metric1', 'metric_with_long_label'],
        ['r1'],
        ['c1'],
        1,
        1,
      ),
      ['metric1', 'metric_with_long_label'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...baseFormData,
          metrics: ['metric1', 'metric_with_long_label'],
          metricDatabars: {
            metric1: {
              type: 'bar',
            },
            metric_with_long_label: {
              type: 'bar',
            },
          },
        })}
        metrics={['metric1', 'metric_with_long_label']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const scales = screen.getAllByTestId('pivot-databar-scale');
    expect(scales).toHaveLength(2);
    const expectedMaxWidth = `${supersetTheme.sizeUnit * 12}px`;
    scales.forEach(scale => {
      expect(scale).toHaveStyle(`max-width: ${expectedMaxWidth}`);
    });
  });

  it('renders databars on row grand totals', async () => {
    const treeWithTotal: PivotTreeData = {
      ...baseTree,
      cells: {
        ...baseTree.cells,
        [serializeCellKey(serializePath([]), serializePath(['C1']))]: {
          rowKey: serializePath([]),
          colKey: serializePath(['C1']),
          values: { metric1: 50 },
        },
      },
    };

    render(
      <PivotTableChart
        data={treeWithTotal}
        formData={buildFormData({
          ...baseFormData,
          colTotals: true,
          metricDatabars: {
            metric1: {
              type: 'bar',
            },
          },
        })}
        metrics={['metric1']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const totalCell = screen.getByText('50').closest('td');
    expect(totalCell).toBeTruthy();
    if (!totalCell) {
      return;
    }
    expect(within(totalCell).getByTestId('pivot-databar')).toBeInTheDocument();
  });

  it('reverses waterfall flow when row totals are on top', async () => {
    const rootKey = serializePath([]);
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [
          { r1: 'A', c1: 'C1', metric1: 10 },
          { r1: 'B', c1: 'C1', metric1: 20 },
        ],
        ['metric1'],
        ['r1'],
        ['c1'],
        1,
        1,
      ),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
    );
    tree.cells[serializeCellKey(rootKey, serializePath(['C1']))] = {
      rowKey: rootKey,
      colKey: serializePath(['C1']),
      values: { metric1: 30 },
    };

    const renderWithTotalsPosition = async (
      colTotalPosition: 'start' | 'end',
    ) => {
      const { unmount } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...baseFormData,
            colTotals: true,
            colTotalPosition,
            metricDatabars: {
              metric1: { type: 'waterfall' },
            },
          })}
          metrics={['metric1']}
          groupbyRows={['r1']}
          groupbyColumns={['c1']}
          aggregateFunction="Sum"
          width={400}
          height={300}
          startCollapsed={false}
          initialDepth={1}
          colTotals
          colTotalPosition={colTotalPosition}
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

      // eslint-disable-next-line no-await-in-loop
      // eslint-disable-next-line no-await-in-loop
      // eslint-disable-next-line no-await-in-loop
      await waitForPivotReady();
      const cell = screen.getByText('10').closest('td');
      expect(cell).toBeTruthy();
      if (!cell) {
        unmount();
        throw new Error('Expected cell for row A metric not found.');
      }
      const bar = within(cell).getByTestId('pivot-databar-bar');
      const left = Number.parseFloat(bar.style.left);
      unmount();
      return left;
    };

    const topTotalLeft = await renderWithTotalsPosition('start');
    const bottomTotalLeft = await renderWithTotalsPosition('end');
    expect(topTotalLeft).toBeGreaterThan(bottomTotalLeft);
  });

  it('allocates left padding for negative waterfall labels above zero', async () => {
    const tree = applyMetricAxis(
      buildTreeFromRecords(
        [
          { r1: 'A', c1: 'C1', metric1: 100 },
          { r1: 'B', c1: 'C1', metric1: -10 },
        ],
        ['metric1'],
        ['r1'],
        ['c1'],
        1,
        1,
      ),
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          ...baseFormData,
          metricDatabars: {
            metric1: { type: 'waterfall' },
          },
        })}
        metrics={['metric1']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const labelNodes = screen.getAllByText('-10');
    const databarCell = labelNodes
      .map(node => node.closest('td'))
      .find(cell => cell && within(cell).queryByTestId('pivot-databar'));
    expect(databarCell).toBeTruthy();
    if (!databarCell) {
      return;
    }
    const databar = within(databarCell).getByTestId('pivot-databar');
    const paddingLeft = Number.parseFloat(databar.style.paddingLeft);
    expect(paddingLeft).toBeGreaterThan(supersetTheme.sizeUnit * 2);
  });

  it('applies row and column formatting with metric priority', async () => {
    const formattedTree: PivotTreeData = {
      ...baseTree,
      cells: {
        ...baseTree.cells,
        [serializeCellKey(serializePath(['A']), serializePath([]))]: {
          rowKey: serializePath(['A']),
          colKey: serializePath([]),
          values: {
            row_bg: '#111111',
            row_text: '#00ff00',
          },
        },
        [serializeCellKey(serializePath([]), serializePath(['C1']))]: {
          rowKey: serializePath([]),
          colKey: serializePath(['C1']),
          values: {
            col_bg: '#222222',
            col_text: '#0000ff',
          },
        },
        [serializeCellKey(serializePath(['A']), serializePath(['C1']))]: {
          rowKey: serializePath(['A']),
          colKey: serializePath(['C1']),
          values: {
            metric1: 10,
            metric1_bg: '#333333',
            metric1_text: '#123123',
          },
        },
      },
    };

    render(
      <PivotTableChart
        data={formattedTree}
        formData={buildFormData({
          ...baseFormData,
          metricFormatting: {
            metric1: {
              backgroundColor: 'metric1_bg',
              textColor: 'metric1_text',
            },
          },
          rowFormatting: {
            r1: {
              backgroundColor: 'row_bg',
              textColor: 'row_text',
            },
          },
          colFormatting: {
            c1: {
              backgroundColor: 'col_bg',
              textColor: 'col_text',
            },
          },
        })}
        metrics={['metric1']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const cell = screen.getByText('10').closest('td');
    expect(cell).toHaveStyle({
      backgroundColor: '#333333',
      color: '#123123',
    });

    const rowHeader = screen.getByText('A').closest('th');
    expect(rowHeader).toHaveStyle({
      backgroundColor: '#111111',
      color: '#00ff00',
    });

    const colHeader = screen.getByText('C1').closest('th');
    expect(colHeader).toHaveStyle({
      backgroundColor: '#222222',
      color: '#0000ff',
    });
  });

  it('uses dimension value in excel formatting', async () => {
    render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          rowFormatting: {
            r1: {
              backgroundColor: {
                kind: 'excel',
                formula: '=IF(value="A","#111111","#222222")',
              },
            },
          },
        })}
        metrics={['metric1']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const rowHeader = screen.getByText('A').closest('th');
    expect(rowHeader).toHaveStyle({ backgroundColor: '#111111' });
  });

  it('applies label-only formatting scope to headers', async () => {
    const formattedTree: PivotTreeData = {
      ...baseTree,
      cells: {
        ...baseTree.cells,
        [serializeCellKey(serializePath(['A']), serializePath([]))]: {
          rowKey: serializePath(['A']),
          colKey: serializePath([]),
          values: {
            row_bg: '#111111',
          },
        },
        [serializeCellKey(serializePath([]), serializePath(['C1']))]: {
          rowKey: serializePath([]),
          colKey: serializePath(['C1']),
          values: {
            col_bg: '#222222',
          },
        },
      },
    };

    render(
      <PivotTableChart
        data={formattedTree}
        formData={buildFormData({
          ...baseFormData,
          rowFormatting: {
            r1: {
              backgroundColor: 'row_bg',
              applyTo: 'label',
            },
          },
          colFormatting: {
            c1: {
              backgroundColor: 'col_bg',
              applyTo: 'label',
            },
          },
        })}
        metrics={['metric1']}
        groupbyRows={['r1']}
        groupbyColumns={['c1']}
        aggregateFunction="Sum"
        width={400}
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
      />,
    );

    await waitForPivotReady();
    const cell = screen.getByText('10').closest('td');
    expect(cell).not.toHaveStyle({ backgroundColor: '#111111' });

    const rowHeader = screen.getByText('A').closest('th');
    expect(rowHeader).toHaveStyle({ backgroundColor: '#111111' });

    const colHeader = screen.getByText('C1').closest('th');
    expect(colHeader).toHaveStyle({ backgroundColor: '#222222' });
  });

  it('renders metric headers without dimension prefixes when metrics are last on columns', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const treeRaw = buildTreeFromRecords(
      [
        {
          orderPriority: '1-URGENT',
          shipMode: 'AIR',
          category: 'FURNITURE',
          averageOrderValue: 10,
          weightedDiscount: 0.1,
        },
      ],
      metrics,
      ['orderPriority'],
      ['shipMode', 'category'],
      1,
      1,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['orderPriority'],
      ['shipMode', 'category'],
      2,
    );

    const props: Partial<PivotTableProps> = {
      data: tree,
      formData: buildFormData({
        ...baseFormData,
        groupbyRows: ['orderPriority'],
        groupbyColumns: ['shipMode', 'category', METRICS_PLACEHOLDER],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        metrics,
      }),
      metrics,
      groupbyRows: ['orderPriority'],
      groupbyColumns: ['shipMode', 'category'],
      aggregateFunction: 'Sum',
      width: 400,
      height: 300,
      startCollapsed: false,
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

    const { container } = render(<PivotTableChart {...props} />);
    await waitForPivotReady();
    const header = container.querySelector('thead') as HTMLElement;
    const headerLabels = within(header)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label !== '' && label !== 'Rows');

    metrics.forEach(metric => {
      expect(headerLabels).toContain(metric);
      expect(headerLabels).not.toContain(`AIR ${metric}`);
    });
  });

  it('shows year headers once with metric labels on the next row when metrics are last on columns', async () => {
    const metrics = ['grossRevenue', 'countCustomers'];
    const treeRaw = buildTreeFromRecords(
      [
        {
          shipMode: 'AIR',
          orderYear: '1992',
          shipInstruction: 'EXPRESS',
          grossRevenue: 10,
          countCustomers: 2,
        },
        {
          shipMode: 'AIR',
          orderYear: '1993',
          shipInstruction: 'STANDARD',
          grossRevenue: 12,
          countCustomers: 3,
        },
      ],
      metrics,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      1,
      1,
    );
    const tree = applyMetricAxis(
      treeRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      2,
    );

    const props: Partial<PivotTableProps> = {
      data: tree,
      formData: buildFormData({
        ...baseFormData,
        groupbyRows: ['shipMode'],
        groupbyColumns: ['orderYear', 'shipInstruction', METRICS_PLACEHOLDER],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        metrics,
        startCollapsed: true,
        initialDepth: 1,
        colSubtotalLevels: [1],
      }),
      metrics,
      groupbyRows: ['shipMode'],
      groupbyColumns: ['orderYear', 'shipInstruction'],
      aggregateFunction: 'Sum',
      width: 400,
      height: 300,
      startCollapsed: true,
      initialDepth: 1,
      colTotals: false,
      rowTotals: false,
      rowSubTotals: false,
      rowSubtotalLevels: [],
      colSubtotalLevels: [1],
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

    const { container } = render(<PivotTableChart {...props} />);
    await waitForPivotReady();
    const headerRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    const topLabels = within(headerRows[0])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label !== '' && label !== 'Rows');
    const yearLabels = topLabels.filter(label => /^\d{4}$/.test(label));
    expect(yearLabels).toEqual(['1992', '1993']);
    expect(topLabels).not.toEqual(
      expect.arrayContaining(['1992 grossRevenue', '1993 grossRevenue']),
    );

    const metricLabels = within(headerRows[1])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label !== '' && label !== 'Rows');
    expect(metricLabels).toEqual([
      'grossRevenue',
      'countCustomers',
      'grossRevenue',
      'countCustomers',
    ]);

    const yearHeader = within(headerRows[0])
      .getByText('1992')
      .closest('th') as HTMLElement;
    expect(
      within(yearHeader).getByLabelText('plus-square'),
    ).toBeInTheDocument();
  });

  it('orders measure leaf headers with value first and UI order next', async () => {
    const metricKey = 'grossRevenue';
    const secondaryMetric = 'countCustomers';
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const offsetLeaf = buildBuiltInLeaf('offset_value', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        {
          metricKey,
          leaves: [valueLeaf, ixLeaf, offsetLeaf],
        },
        {
          metricKey: secondaryMetric,
          leaves: [valueLeaf],
        },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const baseTree = buildTreeFromRecords(
      [
        {
          c1: 'C1',
          grossRevenue: 100,
          'grossRevenue__1 year ago': 80,
          countCustomers: 10,
        },
      ],
      [metricKey, secondaryMetric],
      [],
      ['c1'],
      0,
      1,
    );
    const treeWithLeaves = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({ tree: baseTree, measureHierarchy }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['c1'],
      1,
    );

    const { container } = render(
      <PivotTableChart
        data={treeWithLeaves}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [],
          groupbyColumns: ['c1'],
          metrics: [metricKey, secondaryMetric],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf, offsetLeaf],
            [secondaryMetric]: [valueLeaf],
          },
          startCollapsed: false,
          datasource: baseFormData.datasource ?? '1__table',
          viz_type: baseFormData.viz_type ?? 'pivot_table_v3',
          height: 300,
          width: 400,
          margin: 0,
        })}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={[]}
        groupbyColumns={['c1']}
        width={400}
        height={300}
        columnFormats={{}}
        currencyFormats={{}}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        rowTotals={false}
        colTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
      />,
    );

    await waitForPivotReady();
    const header = container.querySelector('thead') as HTMLElement;
    const headerRows = within(header).getAllByRole('row');
    const leafLabels = within(headerRows[headerRows.length - 1])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0);

    expect(leafLabels.slice(0, 3)).toEqual(['Value', 'IX 1YA', '1YA']);
  });

  it('formats custom measure leaves with the custom metric format', async () => {
    const metricKey = 'grossRevenue';
    const secondaryMetric = 'countCustomers';
    const customMetricKey = 'conversionRate';
    const valueLeaf = buildValueLeaf();
    const customLeaf = buildCustomLeaf({
      label: 'Conversion',
      metric: customMetricKey,
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        {
          metricKey,
          leaves: [valueLeaf, customLeaf],
        },
        {
          metricKey: secondaryMetric,
          leaves: [valueLeaf],
        },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const baseTree = buildTreeFromRecords(
      [{ c1: 'C1', grossRevenue: 100, countCustomers: 10 }],
      [metricKey, secondaryMetric],
      [],
      ['c1'],
      0,
      1,
    );
    const treeWithCustomMetric: PivotTreeData = {
      ...baseTree,
      cells: Object.fromEntries(
        Object.entries(baseTree.cells).map(([cellKey, cell]) => [
          cellKey,
          {
            ...cell,
            values: {
              ...cell.values,
              [customMetricKey]: 0.25,
            },
          },
        ]),
      ),
    };
    const treeWithLeaves = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: treeWithCustomMetric,
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['c1'],
      1,
    );

    render(
      <PivotTableChart
        data={treeWithLeaves}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [],
          groupbyColumns: ['c1'],
          metrics: [metricKey, secondaryMetric],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, customLeaf],
            [secondaryMetric]: [valueLeaf],
          },
          startCollapsed: false,
          datasource: baseFormData.datasource ?? '1__table',
          viz_type: baseFormData.viz_type ?? 'pivot_table_v3',
          height: 300,
          width: 400,
          margin: 0,
        })}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={[]}
        groupbyColumns={['c1']}
        width={400}
        height={300}
        columnFormats={{
          [metricKey]: '.2f',
          [secondaryMetric]: ',d',
          [customMetricKey]: '.0%',
        }}
        currencyFormats={{}}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        rowTotals={false}
        colTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
      />,
    );

    await waitForPivotReady();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('does not inherit parent d3 format for custom measure leaves', async () => {
    const metricKey = 'grossRevenue';
    const secondaryMetric = 'countCustomers';
    const customMetricKey = 'conversionRate';
    const valueLeaf = buildValueLeaf();
    const customLeaf = buildCustomLeaf({
      label: 'Conversion',
      metric: customMetricKey,
    });
    const measureHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        {
          metricKey,
          leaves: [valueLeaf, customLeaf],
        },
        {
          metricKey: secondaryMetric,
          leaves: [valueLeaf],
        },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const baseTree = buildTreeFromRecords(
      [{ c1: 'C1', grossRevenue: 100, countCustomers: 10 }],
      [metricKey, secondaryMetric],
      [],
      ['c1'],
      0,
      1,
    );
    const treeWithCustomMetric: PivotTreeData = {
      ...baseTree,
      cells: Object.fromEntries(
        Object.entries(baseTree.cells).map(([cellKey, cell]) => [
          cellKey,
          {
            ...cell,
            values: {
              ...cell.values,
              [customMetricKey]: 0.25,
            },
          },
        ]),
      ),
    };
    const treeWithLeaves = applyMeasureHierarchyAxis(
      applyMeasureLeafValuesToTree({
        tree: treeWithCustomMetric,
        measureHierarchy,
      }),
      measureHierarchy,
      MetricsLayoutEnum.COLUMNS,
      [],
      ['c1'],
      1,
    );

    render(
      <PivotTableChart
        data={treeWithLeaves}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [],
          groupbyColumns: ['c1'],
          metrics: [metricKey, secondaryMetric],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, customLeaf],
            [secondaryMetric]: [valueLeaf],
          },
          startCollapsed: false,
          datasource: baseFormData.datasource ?? '1__table',
          viz_type: baseFormData.viz_type ?? 'pivot_table_v3',
          height: 300,
          width: 400,
          margin: 0,
        })}
        metrics={[metricKey, secondaryMetric]}
        groupbyRows={[]}
        groupbyColumns={['c1']}
        width={400}
        height={300}
        columnFormats={{
          [metricKey]: '.0%',
          [secondaryMetric]: ',d',
        }}
        currencyFormats={{}}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        rowTotals={false}
        colTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
      />,
    );

    await waitForPivotReady();
    expect(screen.getByText('0.25')).toBeInTheDocument();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
  });

  it('expands to the next column dimension on first toggle when metrics are last on columns', async () => {
    const metrics = ['grossRevenue', 'countCustomers'];
    const records = [
      {
        shipMode: 'AIR',
        orderYear: '1992',
        shipInstruction: 'EXPRESS',
        grossRevenue: 10,
        countCustomers: 2,
      },
      {
        shipMode: 'AIR',
        orderYear: '1992',
        shipInstruction: 'STANDARD',
        grossRevenue: 8,
        countCustomers: 1,
      },
      {
        shipMode: 'AIR',
        orderYear: '1993',
        shipInstruction: 'EXPRESS',
        grossRevenue: 12,
        countCustomers: 3,
      },
    ];
    const baseRaw = buildTreeFromRecords(
      records,
      metrics,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      1,
      1,
    );
    const baseTreeWithMetrics = applyMetricAxis(
      baseRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      2,
    );

    const branchRaw = buildTreeFromRecords(
      records,
      metrics,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      1,
      2,
    );
    const branchTreeWithMetrics = applyMetricAxis(
      branchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      2,
    );
    const mergedTree = mergeTrees(baseTreeWithMetrics, branchTreeWithMetrics);

    fetchPivotBranchMock.mockResolvedValueOnce({ data: mergedTree });

    const props: Partial<PivotTableProps> = {
      data: baseTreeWithMetrics,
      formData: buildFormData({
        ...baseFormData,
        groupbyRows: ['shipMode'],
        groupbyColumns: ['orderYear', 'shipInstruction', METRICS_PLACEHOLDER],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        metrics,
        startCollapsed: true,
        initialDepth: 1,
      }),
      metrics,
      groupbyRows: ['shipMode'],
      groupbyColumns: ['orderYear', 'shipInstruction'],
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

    const { container } = render(<PivotTableChart {...props} />);
    await waitForPivotReady();
    const initialHeaderRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    const yearHeader = within(initialHeaderRows[0])
      .getByText('1992')
      .closest('th') as HTMLElement;
    fireEvent.click(within(yearHeader).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const headerRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    expect(headerRows.length).toBeGreaterThan(2);
    const dimensionLabels = within(headerRows[1])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label !== '' && label !== 'Rows');
    expect(dimensionLabels).toEqual(
      expect.arrayContaining(['EXPRESS', 'STANDARD']),
    );
  });

  it('expands to the next column dimension when the metrics placeholder is absent', async () => {
    const metrics = ['grossRevenue', 'countCustomers'];
    const records = [
      {
        shipMode: 'AIR',
        orderYear: '1992',
        shipInstruction: 'EXPRESS',
        grossRevenue: 10,
        countCustomers: 2,
      },
      {
        shipMode: 'AIR',
        orderYear: '1992',
        shipInstruction: 'STANDARD',
        grossRevenue: 8,
        countCustomers: 1,
      },
      {
        shipMode: 'AIR',
        orderYear: '1993',
        shipInstruction: 'EXPRESS',
        grossRevenue: 12,
        countCustomers: 3,
      },
    ];
    const baseRaw = buildTreeFromRecords(
      records,
      metrics,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      1,
      1,
    );
    const baseTreeWithMetrics = applyMetricAxis(
      baseRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      2,
    );

    const branchRaw = buildTreeFromRecords(
      records,
      metrics,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      1,
      2,
    );
    const branchTreeWithMetrics = applyMetricAxis(
      branchRaw,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      2,
    );
    const mergedTree = mergeTrees(baseTreeWithMetrics, branchTreeWithMetrics);

    fetchPivotBranchMock.mockResolvedValueOnce({ data: mergedTree });

    const props: Partial<PivotTableProps> = {
      data: baseTreeWithMetrics,
      formData: buildFormData({
        ...baseFormData,
        groupbyRows: ['shipMode'],
        groupbyColumns: ['orderYear', 'shipInstruction'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        metrics,
        startCollapsed: true,
        initialDepth: 1,
      }),
      metrics,
      groupbyRows: ['shipMode'],
      groupbyColumns: ['orderYear', 'shipInstruction'],
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

    const { container } = render(<PivotTableChart {...props} />);
    await waitForPivotReady();
    const initialHeaderRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    const yearHeader = within(initialHeaderRows[0])
      .getByText('1992')
      .closest('th') as HTMLElement;
    fireEvent.click(within(yearHeader).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    const headerRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    expect(headerRows.length).toBeGreaterThan(2);
    const dimensionLabels = within(headerRows[1])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label !== '' && label !== 'Rows');
    expect(dimensionLabels).toEqual(
      expect.arrayContaining(['EXPRESS', 'STANDARD']),
    );
  });

  it('fetches deeper column dimensions when subtotals exist and metrics are last on columns', async () => {
    const metrics = ['grossRevenue', 'countCustomers'];
    const records = [
      {
        shipMode: 'AIR',
        orderYear: '1992',
        shipInstruction: 'EXPRESS',
        grossRevenue: 10,
        countCustomers: 2,
      },
      {
        shipMode: 'AIR',
        orderYear: '1992',
        shipInstruction: 'STANDARD',
        grossRevenue: 8,
        countCustomers: 1,
      },
      {
        shipMode: 'AIR',
        orderYear: '1993',
        shipInstruction: 'EXPRESS',
        grossRevenue: 12,
        countCustomers: 3,
      },
    ];
    const baseRaw = buildTreeFromRecords(
      records,
      metrics,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      1,
      1,
    );
    const baseWithSubtotals = injectColumnSubtotalLeaves(baseRaw, 1, 2);
    const baseTreeWithMetrics = applyMetricAxis(
      baseWithSubtotals,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      2,
    );

    const branchRaw = buildTreeFromRecords(
      records,
      metrics,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      1,
      2,
    );
    const branchWithSubtotals = injectColumnSubtotalLeaves(branchRaw, 1, 2);
    const branchTreeWithMetrics = applyMetricAxis(
      branchWithSubtotals,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['shipMode'],
      ['orderYear', 'shipInstruction'],
      2,
    );
    const mergedTree = mergeTrees(baseTreeWithMetrics, branchTreeWithMetrics);

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: baseTreeWithMetrics })
      .mockResolvedValueOnce({ data: mergedTree });

    const props: Partial<PivotTableProps> = {
      data: baseTreeWithMetrics,
      formData: buildFormData({
        ...baseFormData,
        groupbyRows: ['shipMode'],
        groupbyColumns: ['orderYear', 'shipInstruction', METRICS_PLACEHOLDER],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        metrics,
        startCollapsed: true,
        initialDepth: 1,
        colSubtotalLevels: [1],
      }),
      metrics,
      groupbyRows: ['shipMode'],
      groupbyColumns: ['orderYear', 'shipInstruction'],
      aggregateFunction: 'Sum',
      width: 400,
      height: 300,
      startCollapsed: true,
      initialDepth: 1,
      colTotals: false,
      rowTotals: false,
      rowSubTotals: false,
      rowSubtotalLevels: [],
      colSubtotalLevels: [1],
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

    const { container } = render(<PivotTableChart {...props} />);
    await waitForPivotReady();
    const initialHeaderRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    const yearHeader = within(initialHeaderRows[0])
      .getByText('1992')
      .closest('th') as HTMLElement;
    fireEvent.click(within(yearHeader).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(within(yearHeader).getByLabelText('minus-square'));
    fireEvent.click(within(yearHeader).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    const headerRows =
      container.querySelectorAll<HTMLTableRowElement>('thead tr');
    expect(headerRows.length).toBeGreaterThan(2);
    const dimensionLabels = within(headerRows[1])
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label !== '' && label !== 'Rows');
    expect(dimensionLabels).toEqual(
      expect.arrayContaining(['EXPRESS', 'STANDARD']),
    );
  });

  it('keeps metric tier hidden on rows when the metric is at the bottom of the hierarchy', async () => {
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
        [serializePath(['USA', '1-URGENT'])]: {
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
        [serializePath([])]: {
          axis: 'col',
          key: serializePath([]),
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: false,
        },
      },
      cells: {
        [serializeCellKey(
          serializePath(['USA', '1-URGENT']),
          serializePath([]),
        )]: {
          rowKey: serializePath(['USA', '1-URGENT']),
          colKey: serializePath([]),
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

    render(<PivotTableChart {...props} />);

    await waitForPivotReady();
    // Metric label should not show as a row header; the second level should be orderPriority.
    expect(screen.queryAllByText('countCustomers')).toHaveLength(0);
    expect(screen.getByText('1-URGENT')).toBeInTheDocument();
  });
});

describe('PivotTableChart multi-metric visibility', () => {
  const metricsVariants = [
    ['measure1', 'measure2'],
    ['measure1', 'measure2', 'measure3'],
  ];

  it('shows metrics under a collapsed row group when multiple metrics are selected', async () => {
    for (const metrics of metricsVariants) {
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

      // eslint-disable-next-line no-await-in-loop
      await waitForPivotReady();
      const rowHeaders = Array.from(
        container.querySelectorAll('tbody th') as NodeListOf<HTMLElement>,
      ).map(cell => cell.textContent?.trim());

      expect(rowHeaders).toEqual(expect.arrayContaining(['Bikes', ...metrics]));
      expect(rowHeaders).not.toEqual(
        expect.arrayContaining(['Road', 'Mountain']),
      );

      const groupRow = screen
        .getByText('Bikes')
        .closest('tr') as HTMLTableRowElement;
      expect(
        within(groupRow).getByLabelText('plus-square'),
      ).toBeInTheDocument();

      const metricRow = screen
        .getAllByText(metrics[0])[0]
        .closest('tr') as HTMLTableRowElement;
      expect(
        within(metricRow).queryByLabelText('plus-square'),
      ).not.toBeInTheDocument();
      expect(
        within(metricRow).queryByLabelText('minus-square'),
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows metrics under collapsed columns when multiple metrics are selected', async () => {
    for (const metrics of metricsVariants) {
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

      // eslint-disable-next-line no-await-in-loop
      await waitForPivotReady();
      const headerLabels = Array.from(
        container.querySelectorAll('thead th') as NodeListOf<HTMLElement>,
      ).map(cell => cell.textContent?.trim());

      expect(headerLabels).toEqual(expect.arrayContaining(metrics));
      expect(headerLabels).not.toEqual(
        expect.arrayContaining(['Road', 'Mountain']),
      );
      unmount();
    }
  });

  it('keeps metrics on columns when both row and column hierarchies are present', async () => {
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

    await waitForPivotReady();
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
