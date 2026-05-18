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

import { fireEvent, render, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';

import {
  fetchPivotExpansion as fetchPivotBranch,
  type FetchPivotExpansionResult as FetchPivotBranchResult,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

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
  let resolve: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve: resolve! };
};

const records = [
  { r1: 'A', r2: 'X', m1: 10 },
  { r1: 'A', r2: 'Y', m1: 11 },
  { r1: 'B', r2: 'Z', m1: 12 },
];

const rowGroupby = ['r1', 'r2'];
const colGroupby: string[] = [];
const metrics = ['m1'];

const buildTree = (data: typeof records, rowDepth: number): PivotTreeData => {
  const raw = buildTreeFromRecords(
    data,
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

describe('PivotTableChart concurrent expands', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockResolvedValue({
      data: undefined,
      factBatches: [],
    });
  });

  it('merges branches from overlapping row expansions', async () => {
    const baseTree = buildTree(records, 1);
    const branchA = buildTree(
      records.filter(row => row.r1 === 'A'),
      2,
    );
    const branchB = buildTree(
      records.filter(row => row.r1 === 'B'),
      2,
    );

    const deferredA = createDeferred<FetchPivotBranchResult>();
    const deferredB = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock
      .mockImplementationOnce(() => deferredA.promise)
      .mockImplementationOnce(() => deferredB.promise);

    const { container } = renderChart(baseTree);

    await waitFor(() => {
      const next = getPivotTable(container);
      if (!next) {
        throw new Error('Pivot table not found');
      }
      return next;
    });
    const getToggleForRow = (label: string) => {
      const latest = getPivotTable(container);
      if (!latest) {
        throw new Error('Pivot table not found');
      }
      const body = latest.querySelector('tbody');
      if (!body) {
        throw new Error('Pivot table body not found');
      }
      const row = within(body).getByText(label).closest('tr');
      if (!row) {
        throw new Error(`Row "${label}" not found`);
      }
      const toggle = row.querySelector('button');
      if (!toggle) {
        throw new Error(`Toggle for "${label}" not found`);
      }
      return toggle;
    };
    fireEvent.click(getToggleForRow('A'));
    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(getToggleForRow('B'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });

    deferredB.resolve({ data: branchB, factBatches: [] });
    deferredA.resolve({ data: branchA, factBatches: [] });

    await waitFor(() => {
      const latest = getPivotTable(container);
      if (!latest) {
        throw new Error('Pivot table not found');
      }
      const scoped = within(latest);
      expect(scoped.getByText('X')).toBeInTheDocument();
      expect(scoped.getByText('Z')).toBeInTheDocument();
    });
  });

  it('renders same-axis expansions as soon as each branch arrives (does not wait for all in-flight expands)', async () => {
    const baseTree = buildTree(records, 1);
    const branchA = buildTree(
      records.filter(row => row.r1 === 'A'),
      2,
    );
    const branchB = buildTree(
      records.filter(row => row.r1 === 'B'),
      2,
    );

    const deferredA = createDeferred<FetchPivotBranchResult>();
    const deferredB = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock
      .mockImplementationOnce(() => deferredA.promise)
      .mockImplementationOnce(() => deferredB.promise);

    const { container } = renderChart(baseTree);

    await waitFor(() => {
      const next = getPivotTable(container);
      if (!next) {
        throw new Error('Pivot table not found');
      }
      return next;
    });

    const getToggleForRow = (label: string) => {
      const latest = getPivotTable(container);
      if (!latest) {
        throw new Error('Pivot table not found');
      }
      const body = latest.querySelector('tbody');
      if (!body) {
        throw new Error('Pivot table body not found');
      }
      const row = within(body).getByText(label).closest('tr');
      if (!row) {
        throw new Error(`Row "${label}" not found`);
      }
      const toggle = row.querySelector('button');
      if (!toggle) {
        throw new Error(`Toggle for "${label}" not found`);
      }
      return toggle;
    };

    fireEvent.click(getToggleForRow('A'));
    fireEvent.click(getToggleForRow('B'));

    await waitFor(() => {
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    deferredA.resolve({ data: branchA, factBatches: [] });

    await waitFor(() => {
      const latest = getPivotTable(container);
      if (!latest) {
        throw new Error('Pivot table not found');
      }
      const scoped = within(latest);
      expect(scoped.getByText('X')).toBeInTheDocument();
      expect(scoped.queryByText('Z')).not.toBeInTheDocument();
    });

    deferredB.resolve({ data: branchB, factBatches: [] });

    await waitFor(() => {
      const latest = getPivotTable(container);
      if (!latest) {
        throw new Error('Pivot table not found');
      }
      expect(within(latest).getByText('Z')).toBeInTheDocument();
    });
  });
});
