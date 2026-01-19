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
import {
  MetricsLayoutEnum,
  PivotExpansionState,
  PivotTreeData,
} from '../../../src/types';
import { applyMetricAxis, buildTreeFromRecords } from '../../../src/utils';
import {
  fetchPivotBranch,
  peekPivotBranchCache,
} from '../../../src/fetchPivotBranch';
import { fetchPivotBranchesBatch } from '../../../src/pivot/engine/query/fetchPivotBranchesBatch';
import { buildFormData } from '../fixtures/pivotFormData';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn(),
    peekPivotBranchCache: jest.fn(),
  };
});

jest.mock('../../../src/pivot/engine/query/fetchPivotBranchesBatch', () => ({
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

const buildTree = ({
  records,
  rowGroupby,
  colGroupby,
  metrics,
  rowDepth,
  colDepth,
}: {
  records: Array<Record<string, string | number>>;
  rowGroupby: string[];
  colGroupby: string[];
  metrics: string[];
  rowDepth: number;
  colDepth: number;
}): PivotTreeData => {
  const raw = buildTreeFromRecords(
    records,
    metrics,
    rowGroupby,
    colGroupby,
    rowDepth,
    colDepth,
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

describe('PivotTableChart batching on persisted restore', () => {
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

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    peekPivotBranchCacheMock.mockReset();
    fetchPivotBranchesBatchMock.mockReset();
    peekPivotBranchCacheMock.mockReturnValue(undefined);
  });

  it('batches sibling expansions into one request', async () => {
    const records = [
      { r1: 'A', r2: 'X', m1: 10 },
      { r1: 'A', r2: 'Y', m1: 12 },
      { r1: 'B', r2: 'Z', m1: 15 },
    ];
    const rowGroupby = ['r1', 'r2'];
    const colGroupby: string[] = [];
    const metrics = ['m1'];

    const baseTree = buildTree({
      records,
      rowGroupby,
      colGroupby,
      metrics,
      rowDepth: 1,
      colDepth: 0,
    });
    const branchTree = buildTree({
      records,
      rowGroupby,
      colGroupby,
      metrics,
      rowDepth: 2,
      colDepth: 0,
    });

    fetchPivotBranchesBatchMock.mockResolvedValue({ data: branchTree });
    fetchPivotBranchMock.mockResolvedValue({ data: branchTree });

    const pivotExpansionState: PivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: colGroupby,
      rows: [['A'], ['B']],
      cols: [],
    };

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
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
          rowTotals: false,
          colTotals: false,
          rowSubTotals: false,
          pivotExpansionState,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(fetchPivotBranchesBatchMock).toHaveBeenCalledTimes(1),
    );
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
  });

  it('applies out-of-order batch results correctly', async () => {
    const records = [
      { r1: 'A', r2: 'X', c1: 'CA', c2: 'P', m1: 10 },
      { r1: 'A', r2: 'Y', c1: 'CA', c2: 'Q', m1: 12 },
      { r1: 'B', r2: 'Z', c1: 'NY', c2: 'R', m1: 15 },
      { r1: 'B', r2: 'W', c1: 'NY', c2: 'S', m1: 18 },
    ];
    const rowGroupby = ['r1', 'r2'];
    const colGroupby = ['c1', 'c2'];
    const metrics = ['m1'];

    const baseTree = buildTree({
      records,
      rowGroupby,
      colGroupby,
      metrics,
      rowDepth: 1,
      colDepth: 1,
    });
    const rowBranch = buildTree({
      records,
      rowGroupby,
      colGroupby,
      metrics,
      rowDepth: 2,
      colDepth: 1,
    });
    const colBranch = buildTree({
      records,
      rowGroupby,
      colGroupby,
      metrics,
      rowDepth: 1,
      colDepth: 2,
    });

    const deferredRow = createDeferred<{ data?: PivotTreeData }>();
    const deferredCol = createDeferred<{ data?: PivotTreeData }>();

    fetchPivotBranchesBatchMock.mockImplementation(({ batch }) =>
      batch.axis === 'row' ? deferredRow.promise : deferredCol.promise,
    );

    const pivotExpansionState: PivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: colGroupby,
      rows: [['A'], ['B']],
      cols: [['CA'], ['NY']],
    };

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
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
          rowTotals: false,
          colTotals: false,
          rowSubTotals: false,
          pivotExpansionState,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
      />,
    );

    await waitFor(() =>
      expect(fetchPivotBranchesBatchMock).toHaveBeenCalledTimes(2),
    );

    deferredCol.resolve({ data: colBranch });
    deferredRow.resolve({ data: rowBranch });

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
      expect(screen.getByText('P')).toBeInTheDocument();
    });
  });
});
