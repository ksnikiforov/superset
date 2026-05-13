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

import { type PivotRuntimeLayout } from '../../../../src/types';
import {
  buildSeamlessRuntimeSyncSnapshot,
  buildSeamlessRuntimeUpstreamSignature,
  matchesSeamlessRuntimeSyncSnapshot,
} from '../../../../src/pivot/runtime/seamlessRuntimeUpdate';

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

test('matches seamless runtime sync snapshots by filters, layout, and upstream query', () => {
  const current = buildSeamlessRuntimeSyncSnapshot({
    runtimeLayout,
    selection: { country: ['France'] },
    upstreamSignature: 'query-a',
  });

  expect(
    matchesSeamlessRuntimeSyncSnapshot(
      current,
      buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout,
        selection: { country: ['France'] },
        upstreamSignature: 'query-a',
      }),
    ),
  ).toBe(true);
  expect(
    matchesSeamlessRuntimeSyncSnapshot(
      current,
      buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout,
        selection: { country: ['Germany'] },
        upstreamSignature: 'query-a',
      }),
    ),
  ).toBe(false);
  expect(
    matchesSeamlessRuntimeSyncSnapshot(
      current,
      buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout: { ...runtimeLayout, cols: [] },
        selection: { country: ['France'] },
        upstreamSignature: 'query-a',
      }),
    ),
  ).toBe(false);
  expect(
    matchesSeamlessRuntimeSyncSnapshot(
      current,
      buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout,
        selection: { country: ['France'] },
        upstreamSignature: 'query-b',
      }),
    ),
  ).toBe(false);
});

test('builds stable upstream dashboard query-context signatures', () => {
  expect(buildSeamlessRuntimeUpstreamSignature()).toBeNull();
  expect(
    buildSeamlessRuntimeUpstreamSignature({
      adhoc_filters: [{ col: 'country', op: '==', val: 'France' }],
      extra_form_data: {
        filters: [{ col: 'region', op: 'IN', val: ['EU'] }],
      },
      extras: { time_grain_sqla: 'P1D' },
      granularity_sqla: 'ds',
      metrics: ['sales'],
      time_offsets: ['1 year ago'],
      time_range: 'No filter',
      viz_type: 'pivot_table_v3',
    }),
  ).toBe(
    '{"adhoc_filters":[{"col":"country","op":"==","val":"France"}],"extra_form_data":{"filters":[{"col":"region","op":"IN","val":["EU"]}]},"extras":{"time_grain_sqla":"P1D"},"granularity_sqla":"ds","time_grain_sqla":null,"time_offsets":["1 year ago"],"time_range":"No filter"}',
  );
});
