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
import {
  applyMetricAxis,
  buildTreeFromRecords,
  serializePath,
} from '../../../src/utils';
import {
  fetchPivotBranch,
  peekPivotBranchCache,
} from '../../../src/fetchPivotBranch';
import type { FetchPivotBranchResult } from '../../../src/fetchPivotBranch';
import { buildFormData } from '../fixtures/pivotFormData';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn(),
    peekPivotBranchCache: jest.fn(),
  };
});

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
  records: Array<{ r1: string; r2: string; m1: number }>,
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
  const peekPivotBranchCacheMock = peekPivotBranchCache as jest.MockedFunction<
    typeof peekPivotBranchCache
  >;

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    peekPivotBranchCacheMock.mockReset();
    peekPivotBranchCacheMock.mockReturnValue(undefined);
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

    const baseTreeV1 = buildTree(recordsV1, 1);
    const baseTreeV2 = buildTree(recordsV2, 1);
    const branchAV1 = buildTree(
      recordsV1.filter(row => row.r1 === 'A'),
      2,
    );

    const deferred = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock.mockReturnValueOnce(deferred.promise);

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
          maxDepthPerFetch: 1,
          rowTotals: false,
          colTotals: false,
          rowSubTotals: false,
          colSubTotals: false,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
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
        ownState={{
          expansionState: {
            rows: [serializePath(['A'])],
            cols: [],
          },
        }}
      />
    );

    const { container, rerender } = render(makeChart(baseTreeV1));

    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1),
    );

    rerender(makeChart(baseTreeV2));

    await waitFor(() => {
      const table = getPivotTable(container);
      if (!table) {
        throw new Error('Pivot table not found');
      }
      expect(within(table).getByText('100')).toBeInTheDocument();
    });

    deferred.resolve({ data: branchAV1 });
    await fetchPivotBranchMock.mock.results[0].value;
    await Promise.resolve();

    const table = getPivotTable(container);
    expect(table).not.toBeNull();
    expect(
      within(table as HTMLTableElement).getByText('100'),
    ).toBeInTheDocument();
    expect(
      within(table as HTMLTableElement).queryByText('10'),
    ).not.toBeInTheDocument();
    expect(
      within(table as HTMLTableElement).queryByText('X'),
    ).not.toBeInTheDocument();
  });
});
