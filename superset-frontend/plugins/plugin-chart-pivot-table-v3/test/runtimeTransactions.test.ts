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
    result.current.warnings.some(warning => warning.type === 'truncation'),
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

test('collapse cannot publish a canceled filter refresh hydration', async () => {
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
  fetchMock
    .mockImplementationOnce(({ specs }) => Promise.resolve(resultsFor(specs)))
    .mockImplementationOnce(
      ({ specs }) =>
        new Promise(resolve => {
          finish = () => resolve(resultsFor(specs));
        }),
    );
  await act(async () => result.current.applyDimensionFilterChange('r1', ['A']));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  await act(async () => finish());
  expect(result.current.tree).toBe(visible);
  expect(result.current.expandedRows.has('A')).toBe(false);
  expect(result.current.loadingKeys.size).toBe(0);
  expect(result.current.uiSelectedFilters).toEqual({});
  expect(setControlValue).toHaveBeenCalledWith('pivotSelectedFilters', {});
  unmount();
});

test('collapse restores controls after canceling a pending layout refresh', async () => {
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
  act(() =>
    result.current.applyRuntimeLayoutChange({
      ...initialProps.runtimeLayout,
      rows: ['c1', 'r1'],
      cols: ['r2', 'c2'],
    }),
  );
  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.handleToggle('row', result.current.tree.rows.A));
  await act(async () => finish());
  expect(result.current.tree).toBe(visible);
  expect(result.current.uiRuntimeLayout).toEqual(initialProps.runtimeLayout);
  expect(initialProps.setControlValue).toHaveBeenLastCalledWith(
    'pivotSelectedFilters',
    {},
  );
  expect(initialProps.setControlValue).toHaveBeenCalledWith(
    'pivotRuntimeLayout',
    initialProps.runtimeLayout,
  );
  expect(result.current.cornerLoading).toBe(false);
  unmount();
});
