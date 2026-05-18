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
import { fetchPivotExpansion } from '../../../src/pivot/expansion/fetchPivotExpansion';
import type { FetchPivotExpansionResult } from '../../../src/pivot/expansion/fetchPivotExpansion';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';
import { buildMockExpansionFetchResult } from '../fixtures/factBatches';

jest.mock('../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest.fn(),
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

describe('PivotTableChart persisted prefetch merges concurrent results', () => {
  const fetchPivotExpansionMock = fetchPivotExpansion as jest.MockedFunction<
    typeof fetchPivotExpansion
  >;

  beforeEach(() => {
    fetchPivotExpansionMock.mockReset();
  });

  it('renders both branches when prefetch fetches resolve out of order', async () => {
    const records = [
      { r1: 'A', r2: 'X', m1: 10 },
      { r1: 'A', r2: 'Y', m1: 11 },
      { r1: 'B', r2: 'Z', m1: 12 },
    ];
    const baseTree = buildTree(records, 1);
    const branchA = buildTree(
      records.filter(row => row.r1 === 'A'),
      2,
    );
    const branchB = buildTree(
      records.filter(row => row.r1 === 'B'),
      2,
    );
    const mergedBranch = buildTree(records, 2);

    const deferredA = createDeferred<FetchPivotExpansionResult>();
    const deferredB = createDeferred<FetchPivotExpansionResult>();

    fetchPivotExpansionMock
      .mockReturnValueOnce(deferredA.promise)
      .mockReturnValueOnce(deferredB.promise);

    render(
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
            rows: [['A'], ['B']],
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

    await waitFor(() => expect(fetchPivotExpansionMock).toHaveBeenCalled());
    const callCount = fetchPivotExpansionMock.mock.calls.length;
    if (callCount <= 1) {
      deferredA.resolve(
        buildMockExpansionFetchResult(
          fetchPivotExpansionMock.mock.calls[0][0],
          {
            data: mergedBranch,
          },
        ),
      );
      await fetchPivotExpansionMock.mock.results[0].value;
    } else {
      deferredB.resolve(
        buildMockExpansionFetchResult(
          fetchPivotExpansionMock.mock.calls[1][0],
          {
            data: branchB,
          },
        ),
      );
      deferredA.resolve(
        buildMockExpansionFetchResult(
          fetchPivotExpansionMock.mock.calls[0][0],
          {
            data: branchA,
          },
        ),
      );
      await Promise.all([
        fetchPivotExpansionMock.mock.results[0].value,
        fetchPivotExpansionMock.mock.results[1].value,
      ]);
    }

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
      expect(screen.getByText('Z')).toBeInTheDocument();
    });
  });
});
