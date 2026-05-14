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

import { render, fireEvent, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { mergeTrees } from '../../../src/pivot/core/tree';
import { serializePath } from '../../../src/pivot/core/path';
import { METRICS_PLACEHOLDER } from '../../../src/pivot/core/tokens';
import { fetchPivotBranch } from '../../../src/pivot/query/fetchPivotBranch';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

jest.mock('../../../src/pivot/query/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/pivot/query/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

describe('PivotTableChart expansion with metrics at the column end', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const waitForPivotReady = async () => {
    await waitFor(() => {
      expect(
        document.querySelector('[role="status"][aria-label="Loading"]'),
      ).not.toBeInTheDocument();
    });
  };

  it('expands a column dimension without blanking metric values when metrics are at the end', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand'];
    const colGroupby = ['orderStatus', 'lineStatus'];
    const record = {
      quantityBand: '1-5',
      orderStatus: 'O',
      lineStatus: 'F',
      averageOrderValue: 5196,
      weightedDiscount: 0.05,
    };

    const detail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const rowTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      mergeTrees(detail, rowTotals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      colGroupby.length,
    );

    const branchDetail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      2,
    );
    const branchTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const branchTree = applyMetricAxis(
      mergeTrees(branchDetail, branchTotals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      colGroupby.length,
    );

    fetchPivotBranchMock.mockResolvedValueOnce({
      data: branchTree,
      factBatches: [],
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: [...colGroupby, METRICS_PLACEHOLDER],
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          interactionMode: 'user_controlled',
          dimensions: [...rowGroupby, ...colGroupby],
          pivotRuntimeLayout: {
            version: 1,
            rows: rowGroupby,
            cols: colGroupby,
            metrics,
            leafSelection: {},
            valuePlacement: { axis: 'col', index: colGroupby.length },
          },
          rowTotals: true,
          colTotals: true,
          startCollapsed: true,
          initialDepth: 1,
          rowOrder: 'key_a_to_z',
          colOrder: 'key_a_to_z',
          aggregateFunction: 'Sum',
          viz_type: 'pivot_table_v3',
          datasource: '1__table',
          metricColorFormatters: [],
          dateFormatters: {},
          verboseMap: {},
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
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
      />,
    );

    await waitForPivotReady();
    const thead = container.querySelector('thead') as HTMLElement;
    const statusCell = within(thead)
      .getByText('O')
      .closest('th') as HTMLElement;
    fireEvent.click(within(statusCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });

    expect(within(thead).getByText('F')).toBeInTheDocument();
  });

  it('keeps metric values visible when no branch data is returned', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand'];
    const colGroupby = ['orderStatus', 'lineStatus'];
    const record = {
      quantityBand: '1-5',
      orderStatus: 'O',
      lineStatus: 'F',
      averageOrderValue: 5196,
      weightedDiscount: 0.05,
    };

    const detail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const rowTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      mergeTrees(detail, rowTotals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      colGroupby.length,
    );

    fetchPivotBranchMock.mockResolvedValueOnce({
      data: undefined,
      factBatches: [],
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: [...colGroupby, METRICS_PLACEHOLDER],
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          interactionMode: 'user_controlled',
          dimensions: [...rowGroupby, ...colGroupby],
          pivotRuntimeLayout: {
            version: 1,
            rows: rowGroupby,
            cols: colGroupby,
            metrics,
            leafSelection: {},
            valuePlacement: { axis: 'col', index: colGroupby.length },
          },
          rowTotals: true,
          colTotals: false,
          startCollapsed: true,
          initialDepth: 1,
          rowOrder: 'key_a_to_z',
          colOrder: 'key_a_to_z',
          aggregateFunction: 'Sum',
          viz_type: 'pivot_table_v3',
          datasource: '1__table',
          metricColorFormatters: [],
          dateFormatters: {},
          verboseMap: {},
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
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
      />,
    );

    await waitForPivotReady();
    const tbody = container.querySelector('tbody') as HTMLElement;
    const getRow = () =>
      within(tbody).getByText('1-5').closest('tr') as HTMLTableRowElement;
    expect(within(getRow()).getAllByText('5.2k').length).toBeGreaterThan(0);
    expect(within(getRow()).getAllByText('0.05').length).toBeGreaterThan(0);

    const thead = container.querySelector('thead') as HTMLElement;
    const statusCell = within(thead)
      .getByText('O')
      .closest('th') as HTMLElement;
    fireEvent.click(within(statusCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });

    expect(within(getRow()).getAllByText('5.2k').length).toBeGreaterThan(0);
    expect(within(getRow()).getAllByText('0.05').length).toBeGreaterThan(0);
  });

  it('keeps collapsed values after expanding and collapsing a column', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand'];
    const colGroupby = ['orderStatus', 'lineStatus'];
    const record = {
      quantityBand: '1-5',
      orderStatus: 'O',
      lineStatus: 'F',
      averageOrderValue: 5196,
      weightedDiscount: 0.05,
    };

    const detail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const rowTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      mergeTrees(detail, rowTotals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      colGroupby.length,
    );

    const branchDetail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      2,
    );
    const branchTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const branchTree = applyMetricAxis(
      mergeTrees(branchDetail, branchTotals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      colGroupby.length,
    );

    fetchPivotBranchMock.mockResolvedValueOnce({
      data: branchTree,
      factBatches: [],
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: [...colGroupby, METRICS_PLACEHOLDER],
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          interactionMode: 'user_controlled',
          dimensions: [...rowGroupby, ...colGroupby],
          pivotRuntimeLayout: {
            version: 1,
            rows: rowGroupby,
            cols: colGroupby,
            metrics,
            leafSelection: {},
            valuePlacement: { axis: 'col', index: colGroupby.length },
          },
          rowTotals: true,
          colTotals: true,
          startCollapsed: true,
          initialDepth: 1,
          rowOrder: 'key_a_to_z',
          colOrder: 'key_a_to_z',
          aggregateFunction: 'Sum',
          viz_type: 'pivot_table_v3',
          datasource: '1__table',
          metricColorFormatters: [],
          dateFormatters: {},
          verboseMap: {},
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
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
      />,
    );

    await waitForPivotReady();

    const tbody = container.querySelector('tbody') as HTMLElement;
    const getRow = () =>
      within(tbody).getByText('1-5').closest('tr') as HTMLTableRowElement;
    const countBlankCells = (row: HTMLTableRowElement) =>
      Array.from(row.querySelectorAll('td.value-cell')).filter(
        cell => !(cell.textContent ?? '').trim(),
      ).length;

    expect(countBlankCells(getRow())).toBe(0);

    const thead = container.querySelector('thead') as HTMLElement;
    const expandedCell = within(thead)
      .getByText('O')
      .closest('th') as HTMLElement;
    fireEvent.click(within(expandedCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
      expect(within(thead).getByText('F')).toBeInTheDocument();
    });

    const collapsedCell = within(thead)
      .getByText('O')
      .closest('th') as HTMLElement;
    fireEvent.click(within(collapsedCell).getByLabelText('minus-square'));

    await waitFor(() => {
      expect(within(thead).getByLabelText('plus-square')).toBeInTheDocument();
    });

    expect(countBlankCells(getRow())).toBe(0);
  });

  it('materializes intermediate column hierarchy nodes when metrics are at the end', () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['quantityBand'];
    const colGroupby = ['orderStatus', 'lineStatus'];
    const record = {
      quantityBand: '1-5',
      orderStatus: 'O',
      lineStatus: 'F',
      averageOrderValue: 5196,
      weightedDiscount: 0.05,
    };

    const fullDetail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      2,
    );
    const fullTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const fullTree = applyMetricAxis(
      mergeTrees(fullDetail, fullTotals),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      colGroupby.length,
    );

    const intermediateKey = serializePath(['O', 'F']);
    expect(fullTree.cols[intermediateKey]).toMatchObject({
      path: ['O', 'F'],
      hasChildren: true,
    });
  });
});
