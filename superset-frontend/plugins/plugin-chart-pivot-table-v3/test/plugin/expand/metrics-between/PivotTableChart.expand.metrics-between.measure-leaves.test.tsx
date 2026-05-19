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
import { METRICS_PLACEHOLDER } from '../../../../src/pivot/core/tokens';
import {
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';
import { fetchPivotExpansion as fetchPivotBranch } from '../../../../src/pivot/expansion/fetchPivotExpansion';
import { buildTreeFromRecords } from '../../fixtures/buildTreeFromRecords';
import { applyMeasureHierarchyAxis } from '../../fixtures/metricAxis';
import { resolveMockExpansionFetchResult } from '../../fixtures/factBatches';

jest.mock('../../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest.fn().mockResolvedValue({ data: undefined }),
  };
});

describe('PivotTableChart expansion with measure leaves between dimensions', () => {
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

  const buildTree = ({
    rowGroupby,
    colGroupby,
    rowDepth,
    colDepth,
    metricsLayout,
    metricPosition,
    record,
  }: {
    rowGroupby: string[];
    colGroupby: string[];
    rowDepth: number;
    colDepth: number;
    metricsLayout: MetricsLayoutEnum;
    metricPosition: number;
    record: Record<string, string | number>;
  }) =>
    applyMeasureHierarchyAxis(
      buildTreeFromRecords(
        [record],
        [metricKey],
        rowGroupby,
        colGroupby,
        rowDepth,
        colDepth,
      ),
      measureHierarchy,
      metricsLayout,
      rowGroupby,
      colGroupby,
      metricPosition,
    );

  it('expands measure leaf columns when the stack is between column dimensions', async () => {
    const rowGroupby: string[] = [];
    const colGroupby = ['col1', 'col2'];
    const record = {
      col1: 'C1',
      col2: 'C2',
      grossRevenue: 10,
      'grossRevenue__1 year ago': 5,
    };
    const baseTree = buildTree({
      rowGroupby,
      colGroupby,
      rowDepth: 0,
      colDepth: 1,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metricPosition: 1,
      record,
    });
    const branchTree = buildTree({
      rowGroupby,
      colGroupby,
      rowDepth: 0,
      colDepth: 2,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metricPosition: 1,
      record,
    });

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockExpansionFetchResult({
        data: branchTree,
      }),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [],
          groupbyColumns: ['col1', METRICS_PLACEHOLDER, 'col2'],
          metrics: [metricKey],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
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

    await waitForPivotReady();
    const thead = container.querySelector('thead') as HTMLElement;
    const valueCell = await waitFor(() => {
      const cell = within(thead).getAllByText('Value')[0].closest('th');
      if (!cell) {
        throw new Error('Value header cell not found');
      }
      return cell as HTMLElement;
    });
    fireEvent.click(within(valueCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });
    expect(within(thead).getByText('C2')).toBeInTheDocument();
  });

  it('keeps sibling measure leaves when expanding a leaf between column dimensions', async () => {
    const rowGroupby: string[] = [];
    const colGroupby = ['col1', 'col2'];
    const deltaLeaf = buildBuiltInLeaf('delta', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const extendedHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        {
          metricKey,
          leaves: [valueLeaf, ixLeaf, deltaLeaf],
        },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const record = {
      col1: 'C1',
      col2: 'C2',
      grossRevenue: 10,
      'grossRevenue__1 year ago': 5,
    };
    const baseTree = applyMeasureHierarchyAxis(
      buildTreeFromRecords([record], [metricKey], rowGroupby, colGroupby, 0, 1),
      extendedHierarchy,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      1,
    );
    const branchTree = applyMeasureHierarchyAxis(
      buildTreeFromRecords([record], [metricKey], rowGroupby, colGroupby, 0, 2),
      extendedHierarchy,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      1,
    );

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockExpansionFetchResult({
        data: branchTree,
      }),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: [],
          groupbyColumns: ['col1', METRICS_PLACEHOLDER, 'col2'],
          metrics: [metricKey],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf, deltaLeaf],
          },
        })}
        metrics={[metricKey]}
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

    await waitForPivotReady();
    const thead = container.querySelector('thead') as HTMLElement;
    const valueCell = await waitFor(() => {
      const cell = within(thead).getAllByText('Value')[0].closest('th');
      if (!cell) {
        throw new Error('Value header cell not found');
      }
      return cell as HTMLElement;
    });
    fireEvent.click(within(valueCell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });

    const headerLabels = within(thead)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0 && label !== 'Rows');
    expect(headerLabels).toEqual(
      expect.arrayContaining(['Value', 'IX 1YA', '∆ 1YA']),
    );
  });

  it('keeps sibling measure leaves when expanding a leaf between row dimensions', async () => {
    const rowGroupby = ['row1', 'row2'];
    const colGroupby: string[] = [];
    const deltaLeaf = buildBuiltInLeaf('delta', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const extendedHierarchy = {
      kind: 'measureStackV1' as const,
      groups: [
        {
          metricKey,
          leaves: [valueLeaf, ixLeaf, deltaLeaf],
        },
      ],
      leafTierVisibility: 'visible' as const,
    };
    const record = {
      row1: 'A',
      row2: 'B',
      grossRevenue: 10,
      'grossRevenue__1 year ago': 5,
    };
    const baseTree = applyMeasureHierarchyAxis(
      buildTreeFromRecords([record], [metricKey], rowGroupby, colGroupby, 1, 0),
      extendedHierarchy,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      1,
    );
    const branchTree = applyMeasureHierarchyAxis(
      buildTreeFromRecords([record], [metricKey], rowGroupby, colGroupby, 2, 0),
      extendedHierarchy,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      1,
    );

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockExpansionFetchResult({
        data: branchTree,
      }),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['row1', METRICS_PLACEHOLDER, 'row2'],
          groupbyColumns: [],
          metrics: [metricKey],
          metricsLayout: MetricsLayoutEnum.ROWS,
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf, deltaLeaf],
          },
        })}
        metrics={[metricKey]}
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

    await waitForPivotReady();
    const tbody = container.querySelector('tbody') as HTMLElement;
    const valueRow = await waitFor(() => {
      const cell = within(tbody).getAllByText('Value')[0].closest('tr');
      if (!cell) {
        throw new Error('Value row not found');
      }
      return cell as HTMLTableRowElement;
    });
    fireEvent.click(within(valueRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });

    const rowLabels = Array.from(tbody.querySelectorAll('th'))
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(label => label.length > 0);
    expect(rowLabels).toEqual(
      expect.arrayContaining(['Value', 'IX 1YA', '∆ 1YA']),
    );
  });

  it('expands measure leaf rows when the stack is between row dimensions', async () => {
    const rowGroupby = ['row1', 'row2'];
    const colGroupby: string[] = [];
    const record = {
      row1: 'A',
      row2: 'B',
      grossRevenue: 10,
      'grossRevenue__1 year ago': 5,
    };
    const baseTree = buildTree({
      rowGroupby,
      colGroupby,
      rowDepth: 1,
      colDepth: 0,
      metricsLayout: MetricsLayoutEnum.ROWS,
      metricPosition: 1,
      record,
    });
    const branchTree = buildTree({
      rowGroupby,
      colGroupby,
      rowDepth: 2,
      colDepth: 0,
      metricsLayout: MetricsLayoutEnum.ROWS,
      metricPosition: 1,
      record,
    });

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockExpansionFetchResult({
        data: branchTree,
      }),
    );

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: ['row1', METRICS_PLACEHOLDER, 'row2'],
          groupbyColumns: [],
          metrics: [metricKey],
          metricsLayout: MetricsLayoutEnum.ROWS,
          measureLeavesByMetric: {
            [metricKey]: [valueLeaf, ixLeaf],
          },
        })}
        metrics={[metricKey]}
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

    await waitForPivotReady();
    const tbody = container.querySelector('tbody') as HTMLElement;
    const valueRow = await waitFor(
      () =>
        within(tbody)
          .getAllByText('Value')[0]
          .closest('tr') as HTMLTableRowElement,
    );
    fireEvent.click(within(valueRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });
    expect(within(tbody).getAllByText('B')).toHaveLength(1);
  });
});
