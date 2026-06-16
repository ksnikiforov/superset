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

import {
  type PivotRuntimeLayout,
  type PivotTableQueryFormData,
} from '../../../../src/types';
import {
  buildSeamlessRuntimeSyncSnapshot,
  buildSeamlessRuntimeUpstreamSignature,
  fetchAndMaterializeSeamlessRuntimeUpdate,
} from '../../../../src/pivot/runtime/seamlessRuntimeUpdate';
import { buildPivotFactQueryContextKey } from '../../../../src/pivot/runtime/factStore';
import { createLatestRequestLifecycle } from '../../../../src/pivot/runtime/requestLifecycle';
import { supersetChartDataClient } from '../../../../src/pivot/data/SupersetChartDataClient';
import { buildFormData } from '../../fixtures/pivotFormData';

jest.mock('../../../../src/pivot/data/SupersetChartDataClient', () => {
  const actual = jest.requireActual(
    '../../../../src/pivot/data/SupersetChartDataClient',
  );
  return {
    ...actual,
    supersetChartDataClient: {
      fetch: jest.fn(),
      cancel: jest.fn(),
    },
  };
});

const runtimeLayout: PivotRuntimeLayout = {
  version: 1,
  rows: ['country'],
  cols: ['month'],
  metrics: ['sales'],
  leafSelection: {},
  valuePlacement: { axis: 'col', index: 1 },
};

test('builds stable seamless runtime sync snapshots', () => {
  expect(
    buildSeamlessRuntimeSyncSnapshot({
      runtimeLayout,
      selection: {},
      upstreamSignature: 'query-a',
    }),
  ).toEqual({
    filtersSignature: null,
    layoutSignature:
      '{"cols":["month"],"leafSelection":{},"metrics":["sales"],"rows":["country"],"valuePlacement":{"axis":"col","index":1},"version":1}',
    upstreamSignature: 'query-a',
  });
});

test('builds stable upstream query-context signatures', () => {
  expect(buildSeamlessRuntimeUpstreamSignature()).toBeNull();
  expect(
    buildSeamlessRuntimeUpstreamSignature({
      adhoc_filters: [
        {
          clause: 'WHERE',
          expressionType: 'SIMPLE',
          subject: 'country',
          operator: '==',
          comparator: 'France',
        } as const,
      ],
      extra_form_data: {
        filters: [{ col: 'region', op: 'IN', val: ['EU'] }],
      },
      extras: { time_grain_sqla: 'P1D' },
      granularity_sqla: 'ds',
      metrics: ['sales'],
      time_offsets: ['1 year ago'],
      time_range: 'No filter',
      viz_type: 'pivot_table_v3',
    } as unknown as PivotTableQueryFormData),
  ).toBe(
    '{"adhoc_filters":[{"clause":"WHERE","comparator":"France","expressionType":"SIMPLE","operator":"==","subject":"country"}],"extra_form_data":{"filters":[{"col":"region","op":"IN","val":["EU"]}]},"extras":{"time_grain_sqla":"P1D"},"granularity_sqla":"ds","time_grain_sqla":null,"time_offsets":["1 year ago"],"time_range":null}',
  );
});

test('returns only current query-context fact batches after seamless update', async () => {
  const fetchMock = supersetChartDataClient.fetch as jest.Mock;
  fetchMock.mockResolvedValue([{ data: [{ country: 'France', sales: 10 }] }]);

  const baseFormData = buildFormData({
    dimensions: ['country'],
    groupbyRows: ['country'],
    groupbyColumns: [],
    metrics: ['sales'],
  });
  const filteredFormData = {
    ...baseFormData,
    extra_form_data: {
      filters: [{ col: 'country', op: 'IN' as const, val: ['France'] }],
    },
  };
  const unfilteredQueryContextKey = buildPivotFactQueryContextKey(baseFormData);
  const filteredQueryContextKey =
    buildPivotFactQueryContextKey(filteredFormData);

  const result = await fetchAndMaterializeSeamlessRuntimeUpdate({
    requestLifecycle: createLatestRequestLifecycle({
      cancel: supersetChartDataClient.cancel,
    }),
    baseFormData,
    sourceMetrics: ['sales'],
    sourceMeasureLeavesByMetric: undefined,
    runtimeLayout: {
      version: 1,
      rows: ['country'],
      cols: [],
      metrics: ['sales'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    },
    selection: { country: ['France'] },
    factBatches: [
      {
        coverage: {
          rowDepth: 1,
          columnDepth: 0,
          rowDimensions: ['country'],
          columnDimensions: [],
        },
        scope: { kind: 'root' },
        valueKeys: ['sales'],
        queryContextKey: unfilteredQueryContextKey,
        facts: [
          {
            rowPath: ['USA'],
            columnPath: [],
            valueKey: 'sales',
            value: 99,
          },
        ],
      },
    ],
  });

  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }
  expect(result.factBatches).toHaveLength(1);
  expect(result.factBatches[0].queryContextKey).toBe(filteredQueryContextKey);
  expect(result.factBatches[0].facts.map(fact => fact.rowPath)).toEqual([
    ['France'],
  ]);
});
