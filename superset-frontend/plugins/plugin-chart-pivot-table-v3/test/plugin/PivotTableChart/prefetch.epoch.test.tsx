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

import { render, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';
import { mergeTrees } from '../../../src/pivot/core/tree';
import { parsePath } from '../../../src/pivot/core/path';
import { fetchPivotBranch } from '../../../src/pivot/query/fetchPivotBranch';
import type { FetchPivotBranchResult } from '../../../src/pivot/query/fetchPivotBranch';
import {
  fetchPivotBranchesBatch,
  type FetchPivotBranchesBatchParams,
  type FetchPivotBranchesBatchResult,
} from '../../../src/pivot/query/fetchPivotBranchesBatch';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';
import { buildMockBranchFetchResult } from '../fixtures/factBatches';

jest.mock('../../../src/pivot/query/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/pivot/query/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn(),
  };
});

jest.mock('../../../src/pivot/query/fetchPivotBranchesBatch', () => ({
  fetchPivotBranchesBatch: jest.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

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

const getPivotTable = (container: HTMLElement) =>
  (container.querySelector('.pivot_table_v_3 table') ||
    container.querySelector('table')) as HTMLTableElement | null;

describe('PivotTableChart persisted prefetch ignores stale results', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.MockedFunction<
    typeof fetchPivotBranch
  >;
  const fetchPivotBranchesBatchMock =
    fetchPivotBranchesBatch as jest.MockedFunction<
      typeof fetchPivotBranchesBatch
    >;

  const resolveBatchWithSingles = async ({
    batch,
    formData,
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
            visibleRowDepth,
            visibleColDepth,
          }),
        );
      }),
    );
    const merged = results.reduce<PivotTreeData | undefined>(
      (acc, result) => mergeTrees(acc, result.data),
      undefined,
    );
    return {
      data: merged,
      factBatches: results.flatMap(result => result.factBatches),
    };
  };

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchesBatchMock.mockReset();
    fetchPivotBranchesBatchMock.mockImplementation(resolveBatchWithSingles);
  });

  it('does not apply an in-flight prefetch result after base data changes', async () => {
    const recordsV1 = [
      { r1: 'A', r2: 'X', m1: 10 },
      { r1: 'B', r2: 'Z', m1: 12 },
    ];
    const recordsV2 = [
      { r1: 'A', r2: 'Q', m1: 100 },
      { r1: 'B', r2: 'W', m1: 120 },
    ];
    const baseTreeV1 = buildTree([], 0);
    const baseTreeV2 = buildTree([], 0);
    const branchAV1 = buildTree(
      recordsV1.filter(row => row.r1 === 'A'),
      2,
    );
    const branchAV2 = buildTree(
      recordsV2.filter(row => row.r1 === 'A'),
      2,
    );

    const deferredV1 = createDeferred<FetchPivotBranchResult>();
    const deferredV2 = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock
      .mockReturnValueOnce(deferredV1.promise)
      .mockReturnValueOnce(deferredV2.promise)
      .mockImplementation(params =>
        Promise.resolve(
          buildMockBranchFetchResult(params, {
            data: branchAV2,
          }),
        ),
      );

    const makeChart = (data: PivotTreeData) => (
      <PivotTableChart
        data={data}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          startCollapsed: true,
          initialDepth: 1,
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
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
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
      />
    );

    const { container, rerender } = render(makeChart(baseTreeV1));

    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1),
    );

    rerender(makeChart(baseTreeV2));

    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    deferredV1.resolve(
      buildMockBranchFetchResult(fetchPivotBranchMock.mock.calls[0][0], {
        data: branchAV1,
      }),
    );
    await fetchPivotBranchMock.mock.results[0].value;
    await Promise.resolve();

    deferredV2.resolve(
      buildMockBranchFetchResult(fetchPivotBranchMock.mock.calls[1][0], {
        data: branchAV2,
      }),
    );
    await fetchPivotBranchMock.mock.results[1].value;

    await waitFor(() => {
      const updatedTable = getPivotTable(container);
      if (!updatedTable) {
        throw new Error('Pivot table not found');
      }
      expect(within(updatedTable).getByText('Q')).toBeInTheDocument();
      expect(within(updatedTable).queryByText('X')).not.toBeInTheDocument();
    });
  });
});
