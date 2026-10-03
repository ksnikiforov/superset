/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership. The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { act, renderHook } from '@testing-library/react-hooks';
import { usePivotRuntime } from '../src/pivot/chart/usePivotRuntime';
import { buildRuntimeLayoutFromFormData } from '../src/pivot/layout/resolveInteractionLayout';
import {
  buildInitialPivotUpdatePlan,
  buildExpansionQuerySpecPhases,
  toChartDataQueries,
  type QuerySpec,
} from '../src/pivot/query/specs';
import {
  buildInitialRuntimeFromSpecResults,
  fetchPlannedQuerySpecs,
} from '../src/pivot/runtime/ingestQueryResults';
import { buildFormData } from './plugin/fixtures/pivotFormData';
import { supersetChartDataClient } from '../src/pivot/data/SupersetChartDataClient';
import { buildIntersectionCoverageTarget } from '../src/pivot/expansion/planner';
import {
  createPivotFactStore,
  buildPivotFactQueryContextKey,
} from '../src/pivot/runtime/factStore';
import { type ChartDataQueryResult } from '../src/pivot/data/ChartDataClient';
import { MetricsLayoutEnum } from '../src/types';

jest.mock('../src/pivot/data/SupersetChartDataClient', () => ({
  supersetChartDataClient: { fetch: jest.fn(), cancel: jest.fn() },
}));
const fetchMock = jest.mocked(supersetChartDataClient.fetch);
const plan = () =>
  buildInitialPivotUpdatePlan({
    formData: buildFormData({
      groupbyRows: ['r1', 'r2'],
      dimensions: ['r1', 'r2', 'c1', 'c2'],
      groupbyColumns: ['c1', 'c2'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      startCollapsed: true,
      rowTotals: false,
      colTotals: false,
    }),
  });
const resultsFor = (specs: QuerySpec[]): ChartDataQueryResult[] =>
  specs.map(spec => ({
    query_name: spec.queryName,
    data: [
      { r1: 'A', r2: 'X', c1: 'C', c2: 'U', m1: 10 },
      { r1: 'B', r2: 'Y', c1: 'C', c2: 'U', m1: 20 },
    ],
  }));
const configFor = (
  p: ReturnType<typeof plan>,
  initial: ReturnType<typeof buildInitialRuntimeFromSpecResults>,
): Parameters<typeof usePivotRuntime>[0] => ({
  data: initial.tree,
  factBatches: initial.factBatches,
  dimensionKeys: [
    ...p.layout.pivotProgram.rowDimensions,
    ...p.layout.pivotProgram.columnDimensions,
  ].map(String),
  metricKeys: p.layout.pivotProgram.metricKeys,
  runtimeLayout: buildRuntimeLayoutFromFormData(p.formData),
  initialCommittedLayout: buildRuntimeLayoutFromFormData(p.formData),
  dimensions: [
    ...p.layout.pivotProgram.rowDimensions,
    ...p.layout.pivotProgram.columnDimensions,
  ],
  baseFormData: p.formData,
  sourceMetrics: p.formData.metrics,
  sourceMeasureLeavesByMetric: p.formData.measureLeavesByMetric,
  upstreamDashboardQueryContextSignature: null,
  selectedFiltersFromFormData: {},
  selectedFiltersFromOwnState: {},
  selectedFiltersFromProps: {},
  isDashboardContext: false,
  mergeOwnState: partial => partial,
  setDataMask: jest.fn(),
  shouldPersistExpansionState: false,
});
const initialFor = (p: ReturnType<typeof plan>) =>
  buildInitialRuntimeFromSpecResults({ ...p, results: resultsFor(p.specs) });
const setup = () => {
  const p = plan();
  const initial = buildInitialRuntimeFromSpecResults({
    specs: p.specs,
    results: resultsFor(p.specs),
    layout: p.layout,
    formData: p.formData,
  });
  return renderHook(usePivotRuntime, { initialProps: configFor(p, initial) });
};

beforeEach(() => fetchMock.mockReset());

test('cross-axis expansion reveals only after all requested coverage arrives', async () => {
  let resolveRow!: () => void;
  let resolveColumn!: () => void;
  fetchMock
    .mockImplementationOnce(
      ({ specs }) =>
        new Promise(resolve => {
          resolveRow = () => resolve(resultsFor(specs));
        }),
    )
    .mockImplementationOnce(
      ({ specs }) =>
        new Promise(resolve => {
          resolveColumn = () => resolve(resultsFor(specs));
        }),
    );
  const { result, unmount } = setup();
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  act(() => result.current.handleToggle('col', result.current.tree.cols.C));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => resolveRow());
  expect(result.current.expandedRows.has('A')).toBe(false);
  expect(result.current.expandedCols.has('C')).toBe(false);
  expect(result.current.loadingKeys.has('C')).toBe(true);
  await act(async () => resolveColumn());
  expect(result.current.expandedRows.has('A')).toBe(true);
  expect(result.current.expandedCols.has('C')).toBe(true);
  unmount();
});

test('canceling an expansion transaction discards pending intent on both axes', () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const { result, unmount } = setup();
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  act(() => result.current.handleToggle('col', result.current.tree.cols.C));
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  expect(result.current.loadingKeys.size).toBe(0);
  act(() => result.current.handleToggle('row', result.current.tree.rows.B));
  const { specs } = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0];
  expect(specs.some(spec => spec.columns.includes('c2'))).toBe(false);
  unmount();
});

test('expansion times out, clears loading, and permits retry', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const { result, unmount } = setup();
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  await act(async () => {
    jest.advanceTimersByTime(30001);
  });
  expect(result.current.loadingKeys.size).toBe(0);
  expect(result.current.errorMessage).toMatch(/timed out/i);
  jest.useRealTimers();
  fetchMock.mockImplementation(async ({ specs }) => resultsFor(specs));
  await act(async () => result.current.handleRetry());
  expect(result.current.expandedRows.has('A')).toBe(true);
  expect(result.current.errorMessage).toBeUndefined();
  unmount();
});

test('mixed NULL intersection scopes query NULL and non-NULL paths separately', () => {
  const p = plan();
  const target = buildIntersectionCoverageTarget({
    program: p.layout.pivotProgram,
    rowPathKeys: ['__NULL__', 'A'],
    columnPathKeys: ['C'],
    rowDepth: 2,
    columnDepth: 2,
  });
  const specs = buildExpansionQuerySpecPhases({
    formData: p.formData,
    layout: p.layout,
    targets: [target],
  }).flat();
  expect(
    specs.some(spec =>
      spec.filters.some(
        filter => filter.col === 'r1' && filter.op === 'IS NULL',
      ),
    ),
  ).toBe(true);
  expect(
    specs.some(spec =>
      spec.filters.some(
        filter =>
          filter.col === 'r1' &&
          filter.op === '==' &&
          'val' in filter &&
          filter.val === 'A',
      ),
    ),
  ).toBe(true);
});

test('truncated query results cannot satisfy cached coverage', async () => {
  const p = plan();
  const store = createPivotFactStore();
  const specs = [p.specs[0]];
  fetchMock.mockResolvedValue([
    {
      query_name: specs[0].queryName,
      rowcount: 1,
      data: [{ r1: 'A', c1: 'C', m1: 10 }],
      warnings: [{ type: 'truncation', rowLimit: 1, rowcount: 1 }],
    },
  ]);
  await expect(
    fetchPlannedQuerySpecs({ formData: p.formData, specs, factStore: store }),
  ).rejects.toThrow(/limit/i);
  expect(store.getCoverageSelectors()).toHaveLength(0);
  await expect(
    fetchPlannedQuerySpecs({ formData: p.formData, specs, factStore: store }),
  ).rejects.toThrow(/limit/i);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('fact identity changes when metric SQL, datasource, or row limit changes', () => {
  const metric = {
    expressionType: 'SQL' as const,
    sqlExpression: 'SUM(x)',
    label: 'My metric',
    optionName: 'metric_1',
  };
  const base = buildFormData({ metrics: [metric] });
  const key = buildPivotFactQueryContextKey(base);
  expect(
    buildPivotFactQueryContextKey({
      ...base,
      metrics: [{ ...metric, sqlExpression: 'SUM(y)' }],
    }),
  ).not.toBe(key);
  expect(
    buildPivotFactQueryContextKey({ ...base, datasource: '42__table' }),
  ).not.toBe(key);
  expect(buildPivotFactQueryContextKey({ ...base, row_limit: 321 })).not.toBe(
    key,
  );
});

test('empty warnings do not hide initial truncation or grant complete coverage', () => {
  const p = buildInitialPivotUpdatePlan({
    formData: { ...plan().formData, row_limit: 1 },
  });
  const initial = buildInitialRuntimeFromSpecResults({
    ...p,
    results: resultsFor(p.specs).map(result => ({
      ...result,
      rowcount: 1,
      warnings: [],
    })),
  });
  expect(initial.factBatches.every(batch => batch.complete === false)).toBe(
    true,
  );
  const { result, unmount } = renderHook(usePivotRuntime, {
    initialProps: configFor(p, initial),
  });
  expect(
    Object.values(result.current.tree.cells).some(
      cell => cell.partialValueKeys?.length,
    ),
  ).toBe(true);
  unmount();
});

test('expansion request groups and cancellation are isolated between charts', () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const cancel = jest.mocked(supersetChartDataClient.cancel);
  cancel.mockClear();
  const first = setup();
  const second = setup();
  act(() =>
    first.result.current.handleToggle('row', first.result.current.tree.rows.A),
  );
  act(() =>
    second.result.current.handleToggle(
      'row',
      second.result.current.tree.rows.A,
    ),
  );
  const firstGroup = fetchMock.mock.calls[0][0].requestGroupId;
  const secondGroup = fetchMock.mock.calls[1][0].requestGroupId;
  expect(firstGroup).not.toBe(secondGroup);
  first.unmount();
  expect(cancel).toHaveBeenCalledWith(firstGroup);
  expect(cancel).not.toHaveBeenCalledWith(secondGroup);
  expect(second.result.current.loadingKeys.has('A')).toBe(true);
  second.unmount();
});

test('temporal expansion filters use the same bucket grain as grouped values', () => {
  const queries = toChartDataQueries({
    baseQueryObject: {
      columns: [],
      metrics: [],
      filters: [{ col: 'date', op: '>=', val: '2024-01-01' }],
    },
    specs: [
      {
        queryName: 'bucket-expansion',
        columns: ['date', 'region'],
        metrics: ['sales'],
        filters: [{ col: 'date', op: '==', val: '2024-01-01' }],
        meta: {
          ...plan().specs[0].meta,
          timeComparison: {
            temporalColumn: 'date',
            temporalColumnLabel: 'date',
            timeGrain: 'P1M',
            requiredTimeOffsets: ['1 month ago'],
          },
          requiredTimeOffsets: ['1 month ago'],
        },
      },
    ],
  });
  expect(queries[0].filters).toEqual([
    { col: 'date', op: '>=', val: '2024-01-01' },
    { col: 'date', op: '==', val: '2024-01-01', grain: 'P1M' },
  ]);
});

test('upstream refresh hydration retry retains the refreshed query context', async () => {
  const p = plan();
  fetchMock.mockImplementation(({ specs }) =>
    Promise.resolve(resultsFor(specs)),
  );
  const { result, rerender, waitFor, unmount } = renderHook(usePivotRuntime, {
    initialProps: configFor(p, initialFor(p)),
  });
  await act(async () =>
    result.current.handleToggle('row', result.current.tree.rows.A),
  );
  await waitFor(() => expect(result.current.expandedRows.has('A')).toBe(true));
  const visible = result.current.tree;
  const updated = buildInitialPivotUpdatePlan({
    formData: { ...p.formData, time_range: '2025-01-01 : 2025-02-01' },
  });
  fetchMock.mockRejectedValueOnce(new Error('Refresh children failed'));
  await act(async () => rerender(configFor(updated, initialFor(updated))));
  await waitFor(() =>
    expect(result.current.errorMessage).toContain('Refresh children failed'),
  );
  expect(result.current.tree).toBe(visible);
  await act(async () => result.current.handleRetry());
  await waitFor(() => expect(result.current.tree).not.toBe(visible));
  expect(fetchMock.mock.calls.at(-1)?.[0].formData.time_range).toBe(
    updated.formData.time_range,
  );
  expect(result.current.expandedRows.has('A')).toBe(true);
  unmount();
});

test('collapse preserves the pending filter edit and rejects canceled child hydration', async () => {
  const p = plan();
  fetchMock.mockImplementation(({ specs }) =>
    Promise.resolve(resultsFor(specs)),
  );
  const setControlValue = jest.fn();
  const { result, waitFor, unmount } = renderHook(usePivotRuntime, {
    initialProps: { ...configFor(p, initialFor(p)), setControlValue },
  });
  await act(async () =>
    result.current.handleToggle('row', result.current.tree.rows.A),
  );
  await waitFor(() => expect(result.current.expandedRows.has('A')).toBe(true));
  const visible = result.current.tree;
  let finish!: () => void;
  const filteredResults = (specs: QuerySpec[]) =>
    resultsFor(specs).map(response => ({
      ...response,
      data: response.data?.filter(row => row.r1 === 'A'),
    }));
  fetchMock
    .mockImplementationOnce(({ specs }) =>
      Promise.resolve(filteredResults(specs)),
    )
    .mockImplementationOnce(
      ({ specs }) =>
        new Promise(resolve => {
          finish = () => resolve(resultsFor(specs));
        }),
    );
  fetchMock.mockImplementation(({ specs }) =>
    Promise.resolve(filteredResults(specs)),
  );
  await act(async () => result.current.applyDimensionFilterChange('r1', ['A']));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  expect(result.current.uiSelectedFilters).toEqual({ r1: ['A'] });
  await waitFor(() => expect(result.current.tree).not.toBe(visible));
  expect(result.current.tree.rows.B).toBeUndefined();
  const refreshed = result.current.tree;
  await act(async () => finish());
  expect(result.current.tree).toBe(refreshed);
  expect(result.current.expandedRows.has('A')).toBe(false);
  expect(result.current.loadingKeys.size).toBe(0);
  expect(result.current.uiSelectedFilters).toEqual({ r1: ['A'] });
  expect(setControlValue).toHaveBeenLastCalledWith('pivotSelectedFilters', {
    r1: ['A'],
  });
  unmount();
});

test('collapse preserves a pending layout edit until its refreshed table is ready', async () => {
  const p = buildInitialPivotUpdatePlan({
    formData: { ...plan().formData, interactionMode: 'user_controlled' },
  });
  fetchMock.mockImplementation(({ specs }) =>
    Promise.resolve(resultsFor(specs)),
  );
  const initialProps = {
    ...configFor(p, initialFor(p)),
    setControlValue: jest.fn(),
  };
  const { result, waitFor, unmount } = renderHook(usePivotRuntime, {
    initialProps,
  });
  await act(async () =>
    result.current.handleToggle('row', result.current.tree.rows.A),
  );
  await waitFor(() => expect(result.current.expandedRows.has('A')).toBe(true));
  const visible = result.current.tree;
  let finish!: () => void;
  fetchMock.mockImplementationOnce(
    ({ specs }) =>
      new Promise(resolve => {
        finish = () => resolve(resultsFor(specs));
      }),
  );
  const desiredLayout = {
    ...initialProps.runtimeLayout,
    rows: ['c1', 'r1'],
    cols: ['r2', 'c2'],
  };
  act(() => result.current.applyRuntimeLayoutChange(desiredLayout));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  expect(result.current.uiRuntimeLayout).toEqual(desiredLayout);
  await waitFor(() => expect(result.current.tree).not.toBe(visible));
  const refreshed = result.current.tree;
  await act(async () => finish());
  expect(result.current.tree).toBe(refreshed);
  expect(result.current.uiRuntimeLayout).toEqual(desiredLayout);
  expect(result.current.appliedLayoutFormData.groupbyRows).toContain('c1');
  expect(initialProps.setControlValue).toHaveBeenLastCalledWith(
    'pivotSelectedFilters',
    {},
  );
  expect(initialProps.setControlValue).toHaveBeenCalledWith(
    'pivotRuntimeLayout',
    desiredLayout,
  );
  expect(result.current.cornerLoading).toBe(false);
  unmount();
});

test('collapse retains a failed filter edit and its retry', async () => {
  fetchMock.mockImplementation(async ({ specs }) => resultsFor(specs));
  const { result, waitFor, unmount } = setup();
  await act(async () =>
    result.current.handleToggle('row', result.current.tree.rows.A),
  );
  await waitFor(() => expect(result.current.expandedRows.has('A')).toBe(true));
  fetchMock.mockRejectedValueOnce(new Error('Filter request failed'));
  await act(async () => result.current.applyDimensionFilterChange('r1', ['A']));
  await waitFor(() =>
    expect(result.current.errorMessage).toContain('Filter request failed'),
  );
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  expect(result.current.uiSelectedFilters).toEqual({ r1: ['A'] });
  expect(result.current.errorMessage).toContain('Filter request failed');
  expect(result.current.expandedRows.has('A')).toBe(false);
  await act(async () => result.current.handleRetry());
  await waitFor(() => expect(result.current.errorMessage).toBeUndefined());
  expect(result.current.uiSelectedFilters).toEqual({ r1: ['A'] });
  expect(result.current.appliedLayoutFormData.extra_form_data?.filters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ col: 'r1', val: ['A'] }),
    ]),
  );
  unmount();
});

test('collapse adopts a pending upstream refresh and rejects its canceled hydration', async () => {
  fetchMock.mockImplementation(async ({ specs }) => resultsFor(specs));
  const { result, rerender, waitFor, unmount } = setup();
  await act(async () =>
    result.current.handleToggle('row', result.current.tree.rows.A),
  );
  await waitFor(() => expect(result.current.expandedRows.has('A')).toBe(true));
  const updated = buildInitialPivotUpdatePlan({
    formData: { ...plan().formData, time_range: '2025-01-01 : 2026-01-01' },
  });
  let finish!: () => void;
  fetchMock.mockImplementationOnce(
    ({ specs }) =>
      new Promise(resolve => {
        finish = () => resolve(resultsFor(specs));
      }),
  );
  await act(async () => rerender(configFor(updated, initialFor(updated))));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  await waitFor(() =>
    expect(result.current.appliedLayoutFormData.time_range).toBe(
      updated.formData.time_range,
    ),
  );
  const refreshed = result.current.tree;
  await act(async () => finish());
  expect(result.current.tree).toBe(refreshed);
  expect(result.current.expandedRows.has('A')).toBe(false);
  unmount();
});

test('collapse preserves a failed upstream refresh for explicit retry', async () => {
  fetchMock.mockImplementation(async ({ specs }) => resultsFor(specs));
  const { result, rerender, waitFor, unmount } = setup();
  await act(async () =>
    result.current.handleToggle('row', result.current.tree.rows.A),
  );
  await waitFor(() => expect(result.current.expandedRows.has('A')).toBe(true));
  const updated = buildInitialPivotUpdatePlan({
    formData: { ...plan().formData, time_range: '2025-01-01 : 2026-01-01' },
  });
  fetchMock.mockRejectedValueOnce(new Error('Source refresh failed'));
  await act(async () => rerender(configFor(updated, initialFor(updated))));
  await waitFor(() =>
    expect(result.current.errorMessage).toContain('Source refresh failed'),
  );
  const requests = fetchMock.mock.calls.length;
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  expect(result.current.errorMessage).toContain('Source refresh failed');
  expect(fetchMock).toHaveBeenCalledTimes(requests);
  expect(result.current.expandedRows.has('A')).toBe(false);
  await act(async () => result.current.handleRetry());
  await waitFor(() =>
    expect(result.current.appliedLayoutFormData.time_range).toBe(
      updated.formData.time_range,
    ),
  );
  expect(result.current.errorMessage).toBeUndefined();
  unmount();
});

test('retry after failed source-layout collapse discards expansion paths from the previous dimensions', async () => {
  fetchMock.mockImplementation(async ({ specs }) => resultsFor(specs));
  const { result, rerender, waitFor, unmount } = setup();
  for (const key of ['A', 'B']) {
    await act(async () =>
      result.current.handleToggle('row', result.current.tree.rows[key]),
    );
    await waitFor(() =>
      expect(result.current.expandedRows.has(key)).toBe(true),
    );
  }
  await act(async () =>
    result.current.handleToggle('col', result.current.tree.cols.C),
  );
  await waitFor(() => expect(result.current.expandedCols.has('C')).toBe(true));
  const updated = buildInitialPivotUpdatePlan({
    formData: { ...plan().formData, groupbyRows: ['r2', 'r1'] },
  });
  fetchMock.mockRejectedValueOnce(new Error('New layout hydration failed'));
  await act(async () => rerender(configFor(updated, initialFor(updated))));
  await waitFor(() =>
    expect(result.current.errorMessage).toContain(
      'New layout hydration failed',
    ),
  );
  const requests = fetchMock.mock.calls.length;
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  expect(fetchMock).toHaveBeenCalledTimes(requests);
  await act(async () => result.current.handleRetry());
  await waitFor(() =>
    expect(result.current.appliedLayoutFormData.groupbyRows).toEqual(
      updated.formData.groupbyRows,
    ),
  );
  const retrySpecs = fetchMock.mock.calls
    .slice(requests)
    .flatMap(([request]) => request.specs);
  expect(
    retrySpecs.some(spec =>
      spec.filters.some(
        filter => filter.col === 'r2' && 'val' in filter && filter.val === 'B',
      ),
    ),
  ).toBe(false);
  expect(result.current.expandedRows.has('B')).toBe(false);
  expect(result.current.expandedCols.has('C')).toBe(true);
  unmount();
});
