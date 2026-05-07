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

import { fireEvent, render, screen, waitFor } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  mergeTrees,
  parsePath,
} from '../../../src/utils';
import {
  fetchPivotBranch,
  peekPivotBranchCache,
} from '../../../src/fetchPivotBranch';
import {
  fetchPivotBranchesBatch,
  type FetchPivotBranchesBatchParams,
  type FetchPivotBranchesBatchResult,
} from '../../../src/pivot/query/fetchPivotBranchesBatch';
import { buildFormData } from '../fixtures/pivotFormData';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn(),
    peekPivotBranchCache: jest.fn(),
  };
});

jest.mock('../../../src/pivot/query/fetchPivotBranchesBatch', () => ({
  fetchPivotBranchesBatch: jest.fn(),
}));

const rowGroupby = ['r1', 'r2'];
const colGroupby: string[] = [];
const metrics = ['m1'];

const buildTree = (
  records: Array<Record<string, string | number>>,
  rowDepth: number,
): PivotTreeData => {
  const raw = buildTreeFromRecords(
    records,
    metrics,
    rowGroupby,
    colGroupby,
    rowDepth,
    0,
  );
  return applyMetricAxis(
    raw,
    metrics,
    MetricsLayoutEnum.COLUMNS,
    rowGroupby,
    colGroupby,
    0,
  );
};

describe('PivotTableChart error UX (Phase 4.5)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.MockedFunction<
    typeof fetchPivotBranch
  >;
  const peekPivotBranchCacheMock = peekPivotBranchCache as jest.MockedFunction<
    typeof peekPivotBranchCache
  >;
  const fetchPivotBranchesBatchMock =
    fetchPivotBranchesBatch as jest.MockedFunction<
      typeof fetchPivotBranchesBatch
    >;

  const resolveBatchWithSingles = async ({
    batch,
    formData,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  }: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
    const results = await Promise.all(
      batch.targets.map(target => {
        const path = parsePath(target.pathKey);
        return Promise.resolve(
          fetchPivotBranchMock({
            formData,
            axis: batch.axis,
            path,
            currentTree,
            visibleRowDepth,
            visibleColDepth,
          }),
        );
      }),
    );
    const firstError = results.find(result => result.error)?.error;
    if (firstError) {
      return { error: firstError };
    }
    const merged = results.reduce<PivotTreeData | undefined>(
      (acc, result) => mergeTrees(acc, result.data),
      undefined,
    );
    return { data: merged };
  };

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    peekPivotBranchCacheMock.mockReset();
    fetchPivotBranchesBatchMock.mockReset();

    peekPivotBranchCacheMock.mockReturnValue(undefined);
    fetchPivotBranchesBatchMock.mockImplementation(resolveBatchWithSingles);
  });

  it('AS-22: renders a full-chart error and supports Retry', async () => {
    const records = [
      { r1: 'A', r2: 'X', m1: 10 },
      { r1: 'B', r2: 'Y', m1: 15 },
    ];
    const baseTree = buildTree(records, 1);
    const branchA = buildTree(
      records.filter(row => row.r1 === 'A'),
      2,
    );
    const error = new Error('kaboom');
    fetchPivotBranchMock
      .mockResolvedValueOnce({ error })
      .mockResolvedValue({ data: branchA });

    const formData = buildFormData({
      groupbyRows: rowGroupby,
      groupbyColumns: colGroupby,
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      startCollapsed: true,
      initialDepth: 1,
      expandRowsLevel: 0,
      expandColumnsLevel: 0,
      colTotals: false,
      rowTotals: false,
      rowSubTotals: false,
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={formData.startCollapsed}
        initialDepth={formData.initialDepth}
        colTotals={formData.colTotals}
        rowTotals={formData.rowTotals}
        rowSubTotals={formData.rowSubTotals}
        rowSubtotalLevels={formData.rowSubtotalLevels}
        colSubtotalLevels={formData.colSubtotalLevels}
        metricsLayout={formData.metricsLayout}
      />,
    );

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    const rowCell = screen.getByText('A').closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() =>
      expect(screen.getByText('Error loading Pivot Table')).toBeInTheDocument(),
    );
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    expect(container.querySelector('table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(container.querySelector('table')).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    expect(
      screen.queryByText('Error loading Pivot Table'),
    ).not.toBeInTheDocument();
  });

  it('AS-23: layout changes while failed auto-retry using standard rules', async () => {
    const records = [
      { r1: 'A', r2: 'X', m1: 10 },
      { r1: 'B', r2: 'Y', m1: 15 },
    ];
    const baseTree = buildTree(records, 0);
    const branchA = buildTree(
      records.filter(row => row.r1 === 'A'),
      2,
    );
    const error = new Error('network down');
    fetchPivotBranchMock
      .mockResolvedValueOnce({ error })
      .mockResolvedValue({ data: branchA });

    const formDataV1 = buildFormData({
      groupbyRows: rowGroupby,
      groupbyColumns: colGroupby,
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      startCollapsed: true,
      initialDepth: 1,
      expandRowsLevel: 0,
      expandColumnsLevel: 0,
      colTotals: false,
      rowTotals: false,
      rowSubTotals: false,
      pivotExpansionState: {
        rowKeys: rowGroupby,
        colKeys: colGroupby,
        rows: [['A']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
    });

    const formDataV2 = buildFormData({
      ...formDataV1,
      rowTotals: true,
    });

    const { container, rerender } = render(
      <PivotTableChart
        data={baseTree}
        formData={formDataV1}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={formDataV1.startCollapsed}
        initialDepth={formDataV1.initialDepth}
        colTotals={formDataV1.colTotals}
        rowTotals={formDataV1.rowTotals}
        rowSubTotals={formDataV1.rowSubTotals}
        rowSubtotalLevels={formDataV1.rowSubtotalLevels}
        colSubtotalLevels={formDataV1.colSubtotalLevels}
        metricsLayout={formDataV1.metricsLayout}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('Error loading Pivot Table')).toBeInTheDocument(),
    );
    expect(screen.getByText('network down')).toBeInTheDocument();
    expect(container.querySelector('table')).not.toBeInTheDocument();

    rerender(
      <PivotTableChart
        data={baseTree}
        formData={formDataV2}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={formDataV2.startCollapsed}
        initialDepth={formDataV2.initialDepth}
        colTotals={formDataV2.colTotals}
        rowTotals={formDataV2.rowTotals}
        rowSubTotals={formDataV2.rowSubTotals}
        rowSubtotalLevels={formDataV2.rowSubtotalLevels}
        colSubtotalLevels={formDataV2.colSubtotalLevels}
        metricsLayout={formDataV2.metricsLayout}
      />,
    );

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    expect(
      screen.queryByText('Error loading Pivot Table'),
    ).not.toBeInTheDocument();
  });
});
