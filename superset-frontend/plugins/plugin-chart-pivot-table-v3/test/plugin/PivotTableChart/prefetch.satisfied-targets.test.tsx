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

import { render, screen, waitFor } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';
import { mergeTrees } from '../../../src/pivot/core/tree';
import { parsePath } from '../../../src/pivot/core/path';
import {
  fetchPivotExpansion as fetchPivotBranch,
  fetchPivotExpansion as fetchPivotBranchesBatch,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import type {
  FetchPivotBranchResult,
  FetchPivotBranchesBatchParams,
  FetchPivotBranchesBatchResult,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';
import { buildMockBranchFetchResult } from '../fixtures/factBatches';

jest.mock('../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest.fn(),
    fetchPivotBranchesBatch: jest.fn(),
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

const getRequestPath = (params: Parameters<typeof fetchPivotBranch>[0]) =>
  params.kind === 'branch' ? parsePath(params.target.pathKey) : [];

const rowGroupby = ['r1', 'r2', 'r3'];
const colGroupby: string[] = [];
const metrics = ['m1'];

const buildTree = (
  records: Array<{ r1: string; r2: string; r3: string; m1: number }>,
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

describe('PivotTableChart persisted prefetch hydrates until targets satisfied', () => {
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
    factStore,
    layout,
  }: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
    const results = await Promise.all(
      batch.map(target =>
        Promise.resolve(
          fetchPivotBranchMock({
            kind: 'branch',
            formData,
            layout,
            target,
            factStore,
          }),
        ),
      ),
    );
    const merged = results.reduce<PivotTreeData | undefined>(
      (acc, result) => mergeTrees(acc, result.data),
      undefined,
    );
    return { data: merged };
  };

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchesBatchMock.mockReset();
    fetchPivotBranchesBatchMock.mockImplementation(resolveBatchWithSingles);
  });

  it('keeps the table interactive while parent+child expansions are hydrated', async () => {
    const records = [
      { r1: 'A', r2: 'X', r3: 'P', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'Q', m1: 11 },
      { r1: 'A', r2: 'Y', r3: 'R', m1: 12 },
      { r1: 'B', r2: 'Z', r3: 'S', m1: 13 },
    ];

    const baseTree = buildTree(records, 1);
    const branchA = buildTree(
      records.filter(row => row.r1 === 'A'),
      2,
    );
    const branchAX = buildTree(
      records.filter(row => row.r1 === 'A' && row.r2 === 'X'),
      3,
    );

    const deferredA = createDeferred<FetchPivotBranchResult>();
    const deferredAX = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock.mockImplementation(params => {
      if (JSON.stringify(getRequestPath(params)) === JSON.stringify(['A'])) {
        return deferredA.promise;
      }
      if (
        JSON.stringify(getRequestPath(params)) === JSON.stringify(['A', 'X'])
      ) {
        return deferredAX.promise;
      }
      return Promise.resolve(buildMockBranchFetchResult(params));
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
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
            rows: [['A'], ['A', 'X']],
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
      />,
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByLabelText('loading')).toBeInTheDocument();

    await waitFor(() =>
      expect(
        fetchPivotBranchMock.mock.calls.some(
          ([params]) =>
            JSON.stringify(getRequestPath(params)) === JSON.stringify(['A']),
        ),
      ).toBe(true),
    );
    const branchAParams = fetchPivotBranchMock.mock.calls.find(
      ([params]) =>
        JSON.stringify(getRequestPath(params)) === JSON.stringify(['A']),
    )?.[0];
    expect(branchAParams).toBeDefined();
    deferredA.resolve(
      buildMockBranchFetchResult(branchAParams!, {
        data: branchA,
      }),
    );
    await deferredA.promise;

    await waitFor(() =>
      expect(
        fetchPivotBranchMock.mock.calls.some(
          ([params]) =>
            JSON.stringify(getRequestPath(params)) ===
            JSON.stringify(['A', 'X']),
        ),
      ).toBe(true),
    );
    const branchAXParams = fetchPivotBranchMock.mock.calls.find(
      ([params]) =>
        JSON.stringify(getRequestPath(params)) === JSON.stringify(['A', 'X']),
    )?.[0];
    expect(branchAXParams).toBeDefined();
    deferredAX.resolve(
      buildMockBranchFetchResult(branchAXParams!, {
        data: branchAX,
      }),
    );
    await deferredAX.promise;
    await waitFor(() => {
      expect(container.querySelector('table')).not.toBeNull();
      expect(screen.getByText('P')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });
  });
});
