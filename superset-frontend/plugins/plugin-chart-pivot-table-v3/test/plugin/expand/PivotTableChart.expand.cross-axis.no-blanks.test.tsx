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

import { fireEvent, render, screen, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';

import { fetchPivotExpansion as fetchPivotBranch } from '../../../src/pivot/expansion/fetchPivotExpansion';
import type { FetchPivotExpansionResult as FetchPivotBranchResult } from '../../../src/pivot/expansion/fetchPivotExpansion';
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

const neverResolve = <T,>(): Promise<T> => new Promise<T>(() => {});

const records = [
  { r1: 'A', r2: 'X', c1: 'C', c2: 'U', m1: 10 },
  { r1: 'A', r2: 'X', c1: 'C', c2: 'V', m1: 11 },
  { r1: 'A', r2: 'Y', c1: 'C', c2: 'U', m1: 12 },
  { r1: 'B', r2: 'Z', c1: 'D', c2: 'W', m1: 13 },
];

const rowGroupby = ['r1', 'r2'];
const colGroupby = ['c1', 'c2'];
const metrics = ['m1'];

const buildTree = (
  data: typeof records,
  rowDepth: number,
  colDepth: number,
): PivotTreeData => {
  const raw = buildTreeFromRecords(
    data,
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
    colGroupby.length,
  );
};

const renderChart = (data: PivotTreeData) =>
  render(
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

const getPivotTable = (container: HTMLElement) =>
  (container.querySelector('.pivot_table_v_3 table') ||
    container.querySelector('table')) as HTMLTableElement | null;

describe('PivotTableChart cross-axis expands (no blanks)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.MockedFunction<
    typeof fetchPivotBranch
  >;

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
  });

  it('does not expose deep row+col intersections until required intersection values are available', async () => {
    const baseTree = buildTree(records, 1, 1);
    const fullRowBranch = buildTree(
      records.filter(row => row.r1 === 'A'),
      2,
      2,
    );
    const fullColBranch = buildTree(
      records.filter(row => row.c1 === 'C'),
      2,
      2,
    );

    const deferredRow = createDeferred<FetchPivotBranchResult>();
    const deferredCol = createDeferred<FetchPivotBranchResult>();
    let rowParams: Parameters<typeof fetchPivotBranch>[0] | undefined;
    let colParams: Parameters<typeof fetchPivotBranch>[0] | undefined;

    fetchPivotBranchMock
      .mockImplementationOnce(params => {
        rowParams = params;
        return deferredRow.promise;
      })
      .mockImplementationOnce(params => {
        colParams = params;
        return deferredCol.promise;
      })
      .mockImplementation(() => neverResolve<FetchPivotBranchResult>());

    const { container, unmount } = renderChart(baseTree);

    await waitFor(() => {
      const table = getPivotTable(container);
      if (!table) {
        throw new Error('Pivot table not found');
      }
      expect(within(table).getByText('A')).toBeInTheDocument();
      expect(within(table).getByText('C')).toBeInTheDocument();
    });

    const clickRowToggle = (label: string) => {
      const latest = getPivotTable(container);
      if (!latest) {
        throw new Error('Pivot table not found');
      }
      const body = latest.querySelector('tbody');
      if (!body) {
        throw new Error('Pivot table body not found');
      }
      const rowEl = within(body).getByText(label).closest('tr');
      if (!rowEl) {
        throw new Error(`Row "${label}" not found`);
      }
      const toggle = rowEl.querySelector('button');
      if (!toggle) {
        throw new Error(`Toggle for "${label}" not found`);
      }
      fireEvent.click(toggle);
    };

    const clickColToggle = (label: string) => {
      const latest = getPivotTable(container);
      if (!latest) {
        throw new Error('Pivot table not found');
      }
      const head = latest.querySelector('thead');
      if (!head) {
        throw new Error('Pivot table header not found');
      }
      const headerCell = within(head).getByText(label).closest('th');
      if (!headerCell) {
        throw new Error(`Column "${label}" not found`);
      }
      const toggle = headerCell.querySelector('button');
      if (!toggle) {
        throw new Error(`Toggle for column "${label}" not found`);
      }
      fireEvent.click(toggle);
    };

    clickRowToggle('A');
    clickColToggle('C');

    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    expect(rowParams).toBeDefined();
    expect(colParams).toBeDefined();
    deferredCol.resolve(
      buildMockBranchFetchResult(colParams!, { data: fullColBranch }),
    );
    deferredRow.resolve(
      buildMockBranchFetchResult(rowParams!, { data: fullRowBranch }),
    );

    await Promise.all(
      fetchPivotBranchMock.mock.results.slice(0, 2).map(result => result.value),
    );

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
      expect(screen.getByText('U')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });

    unmount();
  });
});
