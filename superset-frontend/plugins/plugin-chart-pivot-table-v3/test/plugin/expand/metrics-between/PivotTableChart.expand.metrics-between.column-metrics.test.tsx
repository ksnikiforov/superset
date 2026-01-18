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

import { render, fireEvent, waitFor, within } from '../../../testUtils';
import PivotTableChart from '../../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum } from '../../../../src/types';
import { baseFormData, buildFormData } from '../../fixtures/pivotFormData';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  serializeCellKey,
  serializePath,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from '../../../../src/utils';
import { fetchPivotBranch } from '../../../../src/fetchPivotBranch';

jest.mock('../../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
  };
});

describe('PivotTableChart expansion with metrics between dimensions (column-metrics)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const metrics = ['measure1', 'measure2'];
  const rowGroupby = ['orderPriority', 'discountBand', 'customerSegment'];
  const colGroupby = ['revenueBand', 'col1', 'col2', 'col3'];
  const record: Record<string, string | number> = {
    orderPriority: '1-URGENT',
    discountBand: 'LOW',
    customerSegment: 'CONSUMER',
    revenueBand: 'REV-A',
    col1: 'C1-A',
    col2: 'C2-A',
    col3: 'C3-A',
    measure1: 10,
    measure2: 20,
  };

  const buildBaseTree = () =>
    applyMetricAxis(
      buildTreeFromRecords([record], metrics, rowGroupby, colGroupby, 1, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      2,
    );

  const buildCollapsedBranch = () => {
    const collapsedColGroupby = ['revenueBand', 'col2', 'col3'];
    return applyMetricAxis(
      buildTreeFromRecords(
        [record],
        metrics,
        rowGroupby,
        collapsedColGroupby,
        1,
        2,
      ),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      collapsedColGroupby,
      1,
    );
  };

  it('renders metric headers without prefixed group labels when metrics are between columns', () => {
    const baseTree = buildBaseTree();

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [
            'revenueBand',
            'col1',
            METRICS_PLACEHOLDER,
            'col2',
            'col3',
          ],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
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

    const headerLabels = within(container.querySelector('thead') as HTMLElement)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows');
    expect(headerLabels).toEqual(expect.arrayContaining(metrics));
    expect(headerLabels).not.toContain('REV-A measure1');
  });

  it('expands a metric column to load the next dimension when metrics are between columns', async () => {
    const baseTree = buildBaseTree();
    const branchTree = buildCollapsedBranch();

    fetchPivotBranchMock.mockResolvedValueOnce({ data: branchTree });

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [
            'revenueBand',
            'col1',
            METRICS_PLACEHOLDER,
            'col2',
            'col3',
          ],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
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

    const thead = container.querySelector('thead') as HTMLElement;
    const metricCell = within(thead)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(metricCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    expect(await findByText('C2-A')).toBeInTheDocument();
  });

  it('keeps the next column level visible when metric subtotals exist', async () => {
    const baseTree = buildBaseTree();
    const branchTree = buildCollapsedBranch();
    const metricToken = encodeMetricKey('measure1');
    const subtotalPath = ['REV-A', metricToken, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    branchTree.cols[subtotalKey] = {
      axis: 'col',
      key: subtotalKey,
      path: subtotalPath,
      label: SUBTOTAL_LABEL,
      formattedLabel: SUBTOTAL_LABEL,
      level: subtotalPath.length,
      hasChildren: false,
      isSubtotal: true,
    };
    const rowKey = serializePath(['1-URGENT']);
    branchTree.cells[serializeCellKey(rowKey, subtotalKey)] = {
      rowKey,
      colKey: subtotalKey,
      values: { measure1: 10 },
      isSubtotal: true,
    };

    fetchPivotBranchMock.mockResolvedValueOnce({ data: branchTree });

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [
            'revenueBand',
            'col1',
            METRICS_PLACEHOLDER,
            'col2',
            'col3',
          ],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colSubtotalLevels: [1, 2, 3],
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
        rowTotals={false}
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1, 2, 3]}
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

    const thead = container.querySelector('thead') as HTMLElement;
    const metricCell = within(thead)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(metricCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    expect(await findByText('C2-A')).toBeInTheDocument();
  });

  it('refetches the next column level after collapsing a metric expansion', async () => {
    const expandedMetrics = ['measure1', 'measure2', 'measure3', 'measure4'];
    const expandedRowGroupby = [
      'orderPriority',
      'discountBand',
      'customerSegment',
    ];
    const expandedColGroupby = ['col1', 'col2', 'col3', 'col4'];
    const expandedRecord: Record<string, string | number> = {
      orderPriority: '1-URGENT',
      discountBand: 'LOW',
      customerSegment: 'CONSUMER',
      col1: 'C1-A',
      col2: 'C2-A',
      col3: 'C3-A',
      col4: 'C4-A',
      measure1: 10,
      measure2: 20,
      measure3: 30,
      measure4: 40,
    };

    const baseTree = applyMetricAxis(
      buildTreeFromRecords(
        [expandedRecord],
        expandedMetrics,
        expandedRowGroupby,
        expandedColGroupby,
        1,
        1,
      ),
      expandedMetrics,
      MetricsLayoutEnum.COLUMNS,
      expandedRowGroupby,
      expandedColGroupby,
      2,
    );

    const collapsedColGroupby = ['col1', 'col3', 'col4'];
    const metricBranch = applyMetricAxis(
      buildTreeFromRecords(
        [expandedRecord],
        expandedMetrics,
        expandedRowGroupby,
        collapsedColGroupby,
        1,
        2,
      ),
      expandedMetrics,
      MetricsLayoutEnum.COLUMNS,
      expandedRowGroupby,
      collapsedColGroupby,
      1,
    );
    const col1Branch = applyMetricAxis(
      buildTreeFromRecords(
        [expandedRecord],
        expandedMetrics,
        expandedRowGroupby,
        expandedColGroupby,
        1,
        2,
      ),
      expandedMetrics,
      MetricsLayoutEnum.COLUMNS,
      expandedRowGroupby,
      expandedColGroupby,
      2,
    );

    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: metricBranch })
      .mockResolvedValueOnce({ data: col1Branch });

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: expandedRowGroupby,
          groupbyColumns: ['col1', 'col2', METRICS_PLACEHOLDER, 'col3', 'col4'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics: expandedMetrics,
        })}
        metrics={expandedMetrics}
        groupbyRows={expandedRowGroupby}
        groupbyColumns={expandedColGroupby}
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

    const thead = container.querySelector('thead') as HTMLElement;
    const metricCell = within(thead)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(metricCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    expect(await findByText('C3-A')).toBeInTheDocument();

    const collapseMetricCell = within(thead)
      .getByText('measure1')
      .closest('th') as HTMLElement;
    fireEvent.click(within(collapseMetricCell).getByLabelText('minus-square'));

    const col1Cell = within(thead)
      .getByText('C1-A')
      .closest('th') as HTMLElement;
    fireEvent.click(within(col1Cell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });
    expect(await findByText('C2-A')).toBeInTheDocument();
    expect(within(thead).queryByText('C3-A')).not.toBeInTheDocument();
  });
});
