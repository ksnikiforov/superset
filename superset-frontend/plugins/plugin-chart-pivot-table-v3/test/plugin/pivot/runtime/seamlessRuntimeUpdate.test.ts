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
  type PivotTreeData,
} from '../../../../src/types';
import {
  buildSeamlessRuntimeSyncSnapshot,
  buildSeamlessRuntimeUpstreamSignature,
  prepareRuntimeLayoutPropSync,
  prepareRuntimeStatePersistence,
  prepareSeamlessRuntimeLayoutChange,
  prepareSeamlessRuntimeUpdateEffect,
  shouldFetchSeamlessRuntimeCoverage,
  shouldSyncPersistedSelectedFilters,
} from '../../../../src/pivot/runtime/seamlessRuntimeUpdate';
import { type PivotFactStoreBatch } from '../../../../src/pivot/runtime/factStore';

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

test('prepares seamless runtime effect updates in chart application order', () => {
  const currentData: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const persistedFilters = { country: ['France'] };
  const lastSync = buildSeamlessRuntimeSyncSnapshot({
    runtimeLayout,
    selection: persistedFilters,
    upstreamSignature: 'query-a',
  });

  expect(
    prepareSeamlessRuntimeUpdateEffect({
      upstreamDashboardQueryContextSignature: 'query-b',
      previousUpstreamState: {
        data: currentData,
        signature: 'query-a',
      },
      data: currentData,
      persistedInteractionFilters: persistedFilters,
      committedFilters: persistedFilters,
      uiSelectedFilters: persistedFilters,
      lastSync,
      uiRuntimeLayout: runtimeLayout,
      upstreamSeamlessSignature: 'query-b',
    }),
  ).toEqual({
    nextUpstreamState: {
      data: currentData,
      signature: 'query-b',
    },
    update: {
      runtimeLayout,
      selection: persistedFilters,
    },
  });
});

test('skips seamless runtime effect updates for unrelated upstream state', () => {
  const currentData: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const previousData: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  expect(
    prepareSeamlessRuntimeUpdateEffect({
      upstreamDashboardQueryContextSignature: 'query-b',
      previousUpstreamState: {
        data: previousData,
        signature: 'query-a',
      },
      data: currentData,
      persistedInteractionFilters: { country: ['France'] },
      committedFilters: {},
      uiSelectedFilters: { country: ['France'] },
      lastSync: null,
      uiRuntimeLayout: runtimeLayout,
      upstreamSeamlessSignature: 'query-b',
    }),
  ).toEqual({
    nextUpstreamState: {
      data: currentData,
      signature: 'query-b',
    },
    update: undefined,
  });

  expect(
    prepareSeamlessRuntimeUpdateEffect({
      upstreamDashboardQueryContextSignature: null,
      previousUpstreamState: {
        data: previousData,
        signature: 'query-a',
      },
      data: currentData,
      persistedInteractionFilters: {},
      committedFilters: {},
      uiSelectedFilters: {},
      lastSync: null,
      uiRuntimeLayout: runtimeLayout,
      upstreamSeamlessSignature: '',
    }),
  ).toEqual({
    nextUpstreamState: null,
    update: undefined,
  });
});

test('decides when persisted selected filters should sync into local state', () => {
  const persistedFilters = { country: ['France'] };
  expect(
    shouldSyncPersistedSelectedFilters({
      pendingPersistedSelectionSync: true,
      persistedSelectedFilters: persistedFilters,
      committedFilters: {},
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: false,
    }),
  ).toBe(false);

  expect(
    shouldSyncPersistedSelectedFilters({
      pendingPersistedSelectionSync: false,
      persistedSelectedFilters: persistedFilters,
      committedFilters: {},
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: true,
    }),
  ).toBe(false);

  expect(
    shouldSyncPersistedSelectedFilters({
      pendingPersistedSelectionSync: false,
      persistedSelectedFilters: persistedFilters,
      committedFilters: {},
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: false,
    }),
  ).toBe(true);

  expect(
    shouldSyncPersistedSelectedFilters({
      pendingPersistedSelectionSync: false,
      persistedSelectedFilters: persistedFilters,
      committedFilters: { country: ['Germany'] },
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: false,
    }),
  ).toBe(false);
});

test('prepares runtime layout prop sync decisions in one plan', () => {
  expect(
    prepareRuntimeLayoutPropSync({
      isDashboardRuntimeSync: true,
      pendingPersistedRuntimeLayoutSync: true,
      hasPendingRuntimeLayout: false,
      runtimeLayout,
      lastPersistedRuntimeLayout: runtimeLayout,
    }),
  ).toEqual({
    shouldSyncCommittedRuntimeLayout: false,
    shouldSyncUiRuntimeLayout: false,
    hasPersistedRuntimeLayoutSyncSettled: true,
  });

  expect(
    prepareRuntimeLayoutPropSync({
      isDashboardRuntimeSync: false,
      pendingPersistedRuntimeLayoutSync: true,
      hasPendingRuntimeLayout: false,
      runtimeLayout,
      lastPersistedRuntimeLayout: { ...runtimeLayout, rows: ['state'] },
    }),
  ).toEqual({
    shouldSyncCommittedRuntimeLayout: true,
    shouldSyncUiRuntimeLayout: true,
    hasPersistedRuntimeLayoutSyncSettled: false,
  });

  expect(
    prepareRuntimeLayoutPropSync({
      isDashboardRuntimeSync: false,
      pendingPersistedRuntimeLayoutSync: false,
      hasPendingRuntimeLayout: true,
      runtimeLayout,
      lastPersistedRuntimeLayout: runtimeLayout,
    }),
  ).toEqual({
    shouldSyncCommittedRuntimeLayout: false,
    shouldSyncUiRuntimeLayout: false,
    hasPersistedRuntimeLayoutSyncSettled: false,
  });
});

test('prepares runtime state persistence side-effect plan', () => {
  const filters = { country: ['France'] };

  expect(
    prepareRuntimeStatePersistence({
      layout: runtimeLayout,
      selection: filters,
      isDashboardRuntimeSync: true,
      lastPersistedRuntimeLayout: { ...runtimeLayout, rows: ['state'] },
      lastPersistedSelection: {},
      upstreamDashboardQueryContextSignature: 'query-a',
    }),
  ).toEqual({
    ownStatePatch: {
      pivotRuntimeLayout: runtimeLayout,
      pivotSelectedFilters: filters,
    },
    persistedRuntimeLayout: runtimeLayout,
    localSyncDashboardQueryContext: 'query-a',
    persistedSelection: filters,
  });

  expect(
    prepareRuntimeStatePersistence({
      layout: runtimeLayout,
      selection: filters,
      isDashboardRuntimeSync: false,
      lastPersistedRuntimeLayout: { ...runtimeLayout, rows: ['state'] },
      lastPersistedSelection: filters,
      upstreamDashboardQueryContextSignature: null,
    }),
  ).toEqual({
    ownStatePatch: {
      pivotRuntimeLayout: runtimeLayout,
      pivotSelectedFilters: filters,
    },
    persistedRuntimeLayout: undefined,
    localSyncDashboardQueryContext: undefined,
    persistedSelection: undefined,
  });
});

const baseFormData = {
  datasource: '1__table',
  viz_type: 'pivot_table_v3',
  dimensions: ['country', 'state', 'month'],
  groupbyRows: ['country'],
  groupbyColumns: ['month'],
  metrics: ['sales'],
  metricColorFormatters: [],
  rowFormatting: [],
  colFormatting: [],
  metricFormatting: [],
  metricDatabars: [],
} as PivotTableQueryFormData;

const rootBatch = (
  rowDepth: number,
  columnDepth: number,
): PivotFactStoreBatch => ({
  coverage: {
    rowDepth,
    columnDepth,
    rowDimensions: ['country', 'state'].slice(0, rowDepth),
    columnDimensions: ['month'].slice(0, columnDepth),
  },
  scope: { kind: 'root' },
  valueKeys: ['sales'],
  facts: [],
});

describe('runtime layout coverage fetch policy', () => {
  it('does not fetch when committed facts cover the next runtime layout', () => {
    expect(
      shouldFetchSeamlessRuntimeCoverage({
        baseFormData,
        sourceMetrics: ['sales'],
        sourceMeasureLeavesByMetric: undefined,
        runtimeLayout: {
          ...runtimeLayout,
          rows: ['country', 'state'],
        },
        selection: {},
        factBatches: [
          rootBatch(0, 0),
          rootBatch(1, 1),
          rootBatch(1, 0),
          rootBatch(0, 1),
        ],
      }),
    ).toBe(false);
  });

  it('fetches when committed facts do not cover the next runtime layout', () => {
    expect(
      shouldFetchSeamlessRuntimeCoverage({
        baseFormData,
        sourceMetrics: ['sales'],
        sourceMeasureLeavesByMetric: undefined,
        runtimeLayout: { ...runtimeLayout, rows: ['country', 'state'] },
        selection: {},
        factBatches: [rootBatch(1, 1), rootBatch(1, 0), rootBatch(0, 1)],
      }),
    ).toBe(true);
  });
});

test('prepares normalized runtime layout changes without fetch authority', () => {
  expect(
    prepareSeamlessRuntimeLayoutChange({
      nextLayout: runtimeLayout,
      dimensionKeys: ['country', 'month'],
      metricKeys: ['sales'],
      selection: {},
      upstreamSignature: 'query-a',
    }),
  ).toEqual({
    runtimeLayout,
    syncSnapshot: buildSeamlessRuntimeSyncSnapshot({
      runtimeLayout,
      selection: {},
      upstreamSignature: 'query-a',
    }),
  });
  expect(
    prepareSeamlessRuntimeLayoutChange({
      nextLayout: { ...runtimeLayout, rows: ['country', 'state'] },
      dimensionKeys: ['country', 'month'],
      metricKeys: ['sales'],
      selection: { country: ['France'] },
      upstreamSignature: 'query-a',
    }).runtimeLayout,
  ).toEqual(runtimeLayout);
});

test('prepares sync snapshot for runtime layout changes', () => {
  expect(
    prepareSeamlessRuntimeLayoutChange({
      nextLayout: { ...runtimeLayout, rows: ['country', 'state'] },
      dimensionKeys: ['country', 'state', 'month'],
      metricKeys: ['sales'],
      selection: { country: ['France'] },
      upstreamSignature: 'query-a',
    }).syncSnapshot,
  ).toEqual(
    buildSeamlessRuntimeSyncSnapshot({
      runtimeLayout: {
        ...runtimeLayout,
        rows: ['country', 'state'],
      },
      selection: { country: ['France'] },
      upstreamSignature: 'query-a',
    }),
  );
});
