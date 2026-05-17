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
  type PivotTreeData,
} from '../../../../src/types';
import { buildFactCoverage } from '../../../../src/pivot/runtime/coverage';
import { type PivotFactStoreBatch } from '../../../../src/pivot/runtime/factStore';
import {
  buildSeamlessRuntimeSyncSnapshot,
  buildSeamlessRuntimeUpstreamSignature,
  prepareRuntimeLayoutPropSync,
  prepareRuntimeStatePersistence,
  prepareSeamlessRuntimeLayoutChange,
  prepareSeamlessRuntimeUpdateEffect,
  shouldFetchRuntimeLayout,
  shouldSyncPersistedSelectedFilters,
} from '../../../../src/pivot/runtime/seamlessRuntimeUpdate';

const runtimeLayout: PivotRuntimeLayout = {
  version: 1,
  rows: ['country'],
  cols: ['month'],
  metrics: ['sales'],
  leafSelection: {},
  valuePlacement: { axis: 'col', index: 1 },
};

const factBatch = (
  rowDepth: number,
  columnDepth: number,
  scope: PivotFactStoreBatch['scope'] = { kind: 'bootstrap' },
): PivotFactStoreBatch => ({
  coverage: buildFactCoverage({
    reason: 'initial',
    rowDimensions: ['country', 'state'].slice(0, Math.max(rowDepth, 1)),
    columnDimensions: ['month', 'quarter'].slice(0, Math.max(columnDepth, 1)),
    rowDepth,
    columnDepth,
  }),
  scope,
  valueKeys: ['sales'],
  facts: [],
});

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
      isUserControlled: true,
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
    updates: [
      {
        runtimeLayout,
        selection: persistedFilters,
      },
      {
        runtimeLayout,
        selection: persistedFilters,
      },
    ],
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
      isUserControlled: true,
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
    updates: [],
  });

  expect(
    prepareSeamlessRuntimeUpdateEffect({
      upstreamDashboardQueryContextSignature: null,
      previousUpstreamState: {
        data: previousData,
        signature: 'query-a',
      },
      data: currentData,
      isUserControlled: false,
      persistedInteractionFilters: {},
      committedFilters: {},
      uiSelectedFilters: {},
      lastSync: null,
      uiRuntimeLayout: runtimeLayout,
      upstreamSeamlessSignature: '',
    }),
  ).toEqual({
    nextUpstreamState: null,
    updates: [],
  });
});

test('decides when persisted selected filters should sync into local state', () => {
  const persistedFilters = { country: ['France'] };
  expect(
    shouldSyncPersistedSelectedFilters({
      isUserControlled: false,
      pendingPersistedSelectionSync: false,
      persistedSelectedFilters: persistedFilters,
      committedFilters: {},
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: true,
    }),
  ).toBe(true);

  expect(
    shouldSyncPersistedSelectedFilters({
      isUserControlled: true,
      pendingPersistedSelectionSync: true,
      persistedSelectedFilters: persistedFilters,
      committedFilters: {},
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: false,
    }),
  ).toBe(false);

  expect(
    shouldSyncPersistedSelectedFilters({
      isUserControlled: true,
      pendingPersistedSelectionSync: false,
      persistedSelectedFilters: persistedFilters,
      committedFilters: {},
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: true,
    }),
  ).toBe(false);

  expect(
    shouldSyncPersistedSelectedFilters({
      isUserControlled: true,
      pendingPersistedSelectionSync: false,
      persistedSelectedFilters: persistedFilters,
      committedFilters: {},
      uiSelectedFilters: {},
      suppressStalePersistedFilterRestore: false,
    }),
  ).toBe(true);

  expect(
    shouldSyncPersistedSelectedFilters({
      isUserControlled: true,
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
      isUserControlled: true,
      isDashboardContext: true,
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
      isUserControlled: true,
      isDashboardContext: false,
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
      isUserControlled: false,
      isDashboardContext: false,
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

describe('runtime layout reuse fetch policy', () => {
  it('does not fetch for same-root-depth layout changes with stale committed coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 0)],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          rows: ['country', 'state'],
        },
      }),
    ).toBe(false);
  });

  it('fetches when a root-depth change requires missing committed coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 0)],
        previousLayout: {
          ...runtimeLayout,
          cols: [],
        },
        nextLayout: {
          ...runtimeLayout,
          rows: [],
          cols: [],
        },
      }),
    ).toBe(true);
  });

  it('does not fetch when removing a metric from already loaded root coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [
          {
            ...factBatch(1, 1),
            valueKeys: ['sales', 'profit'],
          },
        ],
        previousLayout: {
          ...runtimeLayout,
          metrics: ['sales', 'profit'],
        },
        nextLayout: runtimeLayout,
      }),
    ).toBe(false);
  });

  it('does not fetch when adding a metric already present as support coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [
          {
            ...factBatch(1, 1),
            valueKeys: ['sales', 'profit'],
            facts: [
              {
                rowPath: ['A'],
                columnPath: ['X'],
                valueKey: 'sales',
                value: 1,
                role: 'visible',
              },
              {
                rowPath: ['A'],
                columnPath: ['X'],
                valueKey: 'profit',
                value: 2,
                role: 'support',
              },
            ],
          },
        ],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          metrics: ['sales', 'profit'],
        },
      }),
    ).toBe(false);
  });

  it('fetches when adding a metric missing from loaded root coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 1)],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          metrics: ['sales', 'profit'],
        },
      }),
    ).toBe(true);
  });

  it('fetches when the root coverage dimensions change and coverage is missing', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 1)],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          rows: ['state', 'country'],
        },
      }),
    ).toBe(true);
  });

  it('does not fetch when changed root coverage is already loaded', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [
          {
            coverage: buildFactCoverage({
              reason: 'initial',
              rowDimensions: ['state'],
              columnDimensions: ['month'],
              rowDepth: 1,
              columnDepth: 1,
            }),
            scope: { kind: 'bootstrap' },
            valueKeys: ['sales'],
            facts: [],
          },
        ],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          rows: ['state', 'country'],
        },
      }),
    ).toBe(false);
  });

  it('does not fetch when trimming hidden dimensions leaves visible coverage unchanged', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 2)],
        previousLayout: {
          ...runtimeLayout,
          cols: ['month', 'quarter'],
        },
        nextLayout: runtimeLayout,
      }),
    ).toBe(false);
  });

  it('does not fetch when adding a hidden dimension only shifts Values after the same prefix', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(0, 1)],
        previousLayout: {
          ...runtimeLayout,
          rows: [],
          cols: ['month'],
          valuePlacement: { axis: 'col', index: 1 },
        },
        nextLayout: {
          ...runtimeLayout,
          rows: [],
          cols: ['month', 'quarter'],
          valuePlacement: { axis: 'col', index: 2 },
        },
      }),
    ).toBe(false);
  });

  it('fetches when Values moves across an already shared dimension', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(0, 1)],
        previousLayout: {
          ...runtimeLayout,
          rows: [],
          cols: ['month', 'quarter'],
          valuePlacement: { axis: 'col', index: 2 },
        },
        nextLayout: {
          ...runtimeLayout,
          rows: [],
          cols: ['month', 'quarter'],
          valuePlacement: { axis: 'col', index: 1 },
        },
      }),
    ).toBe(true);
  });
});

test('prepares fetch actions for runtime layout changes with missing coverage', () => {
  expect(
    prepareSeamlessRuntimeLayoutChange({
      nextLayout: runtimeLayout,
      dimensionKeys: ['country', 'month'],
      metricKeys: ['sales'],
      factBatches: [factBatch(1, 0)],
      previousRuntimeLayout: { ...runtimeLayout, cols: [] },
      selection: {},
      upstreamSignature: 'query-a',
    }),
  ).toEqual({
    kind: 'fetch',
    runtimeLayout,
  });
});

test('prepares local commit actions for covered runtime layout changes', () => {
  const nextLayout: PivotRuntimeLayout = {
    ...runtimeLayout,
    rows: ['country', 'state'],
    metrics: ['sales', 'missing'],
  };

  expect(
    prepareSeamlessRuntimeLayoutChange({
      nextLayout,
      dimensionKeys: ['country', 'state', 'month'],
      metricKeys: ['sales'],
      factBatches: [],
      previousRuntimeLayout: runtimeLayout,
      selection: { country: ['France'] },
      upstreamSignature: 'query-a',
    }),
  ).toEqual({
    kind: 'commit-local',
    runtimeLayout: {
      ...runtimeLayout,
      rows: ['country', 'state'],
    },
    syncSnapshot: buildSeamlessRuntimeSyncSnapshot({
      runtimeLayout: {
        ...runtimeLayout,
        rows: ['country', 'state'],
      },
      selection: { country: ['France'] },
      upstreamSignature: 'query-a',
    }),
  });
});
