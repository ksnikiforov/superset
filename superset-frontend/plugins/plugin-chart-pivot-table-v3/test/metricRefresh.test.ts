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
import { buildInitialPivotUpdatePlan } from '../src/pivot/query/specs';
import { buildInitialRuntimeFromSpecResults } from '../src/pivot/runtime/ingestQueryResults';
import { buildRuntimeLayoutFromFormData } from '../src/pivot/layout/resolveInteractionLayout';
import { buildFormData } from './plugin/fixtures/pivotFormData';
import { supersetChartDataClient } from '../src/pivot/data/SupersetChartDataClient';
import { type PivotTableQueryFormData } from '../src/types';

jest.mock('../src/pivot/data/SupersetChartDataClient', () => ({
  supersetChartDataClient: { fetch: jest.fn(), cancel: jest.fn() },
}));

test('Explore refresh adopts edited metric SQL while retaining persisted filters', async () => {
  const metric = {
    expressionType: 'SQL' as const,
    sqlExpression: 'SUM(x)',
    label: 'My metric',
    optionName: 'metric_1',
  };
  const base = buildFormData({
    groupbyRows: ['r1'],
    groupbyColumns: [],
    dimensions: ['r1'],
    metrics: [metric],
    interactionMode: 'user_controlled',
  });
  const selection = { r1: ['A'] };
  const layout = buildRuntimeLayoutFromFormData(base);
  const loaded = (formData: PivotTableQueryFormData, value: number) => {
    const plan = buildInitialPivotUpdatePlan({
      formData,
      selection,
      runtimeLayout: layout,
    });
    return buildInitialRuntimeFromSpecResults({
      ...plan,
      results: plan.specs.map(spec => ({
        query_name: spec.queryName,
        data: [{ r1: 'A', metric_1: value }],
      })),
    });
  };
  const fetch = jest.mocked(supersetChartDataClient.fetch);
  fetch.mockReset().mockResolvedValue([{ data: [{ r1: 'A', metric_1: 99 }] }]);
  const setDataMask = jest.fn();
  const dimensions = ['r1'];
  const metricKeys = ['metric_1'];
  const { result, rerender } = renderHook(
    ({ formData, data }) =>
      usePivotRuntime({
        dimensionKeys: dimensions,
        metricKeys,
        data: data.tree,
        factBatches: data.factBatches,
        upstreamDashboardQueryContextSignature: null,
        runtimeLayout: layout,
        initialCommittedLayout: layout,
        dimensions,
        selectedFiltersFromFormData: selection,
        selectedFiltersFromOwnState: {},
        selectedFiltersFromProps: selection,
        baseFormData: formData,
        sourceMetrics: formData.metrics,
        sourceMeasureLeavesByMetric: undefined,
        isDashboardContext: false,
        mergeOwnState: partial => partial,
        setDataMask,
      }),
    { initialProps: { formData: base, data: loaded(base, 10) } },
  );
  await act(async () => {});
  expect(
    Object.values(result.current.tree.cells).some(
      cell => cell.values.metric_1 === 10,
    ),
  ).toBe(true);
  const updated = {
    ...base,
    metrics: [{ ...metric, sqlExpression: 'SUM(y)' }],
  };
  rerender({ formData: updated, data: loaded(updated, 99) });
  await act(async () => {});
  expect(
    Object.values(result.current.tree.cells).some(
      cell => cell.values.metric_1 === 99,
    ),
  ).toBe(true);
  expect(
    Object.values(result.current.tree.cells).some(
      cell => cell.values.metric_1 === 10,
    ),
  ).toBe(false);
  expect(result.current.uiSelectedFilters).toEqual(selection);
});
