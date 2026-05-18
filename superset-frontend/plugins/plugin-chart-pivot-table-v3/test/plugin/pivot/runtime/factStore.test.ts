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
  createPivotFactStore,
  type PivotFact,
  type PivotFactStoreBatchScope,
} from '../../../../src/pivot/runtime/factStore';
import { type PivotFactCoverage } from '../../../../src/pivot/runtime/types';
import { encodeMetricKey } from '../../../../src/pivot/core/tokens';

const coverage: PivotFactCoverage = {
  rowDepth: 1,
  columnDepth: 1,
  rowDimensions: ['country'],
  columnDimensions: ['month'],
};

const selector = {
  coverage,
  scope: { kind: 'root' } as PivotFactStoreBatchScope,
  valueKeys: ['sales'],
};

const buildFact = (overrides: Partial<PivotFact> = {}): PivotFact => ({
  rowPath: ['France'],
  columnPath: ['2026-01'],
  valueKey: 'sales',
  value: 10,
  ...overrides,
});

test('upserts duplicate exact facts by request/path/value key', () => {
  const store = createPivotFactStore();

  store.upsertBatch({
    ...selector,
    facts: [buildFact({ value: 10 }), buildFact({ value: 12 })],
  });

  expect(store.getFactBatches()[0].facts.map(fact => fact.value)).toEqual([12]);
});

test('keeps different request scopes as separate exact fact batches', () => {
  const store = createPivotFactStore();
  const firstScope: PivotFactStoreBatchScope = { kind: 'root' };
  const secondScope: PivotFactStoreBatchScope = {
    kind: 'branch',
    axis: 'row',
    path: ['USA'],
  };

  [
    {
      coverage,
      scope: firstScope,
      valueKeys: ['sales'],
      facts: [buildFact({ value: 1 })],
    },
    {
      coverage,
      scope: secondScope,
      valueKeys: ['sales'],
      facts: [buildFact({ rowPath: ['USA'], value: 2 })],
    },
  ].forEach(store.upsertBatch);

  expect(store.getFactBatches().map(batch => batch.facts[0]?.value)).toEqual([
    1, 2,
  ]);
});

test('exposes loaded coverage selectors without fact payloads', () => {
  const store = createPivotFactStore();

  store.upsertBatch({
    ...selector,
    facts: [buildFact({ value: 10 })],
  });

  expect(store.getCoverageSelectors()).toEqual([
    {
      ...selector,
    },
  ]);
});

test('does not mark sibling branch scopes with identical coverage as loaded', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 0,
    rowDimensions: ['country', 'city'],
    columnDimensions: [],
  };
  const franceScope: PivotFactStoreBatchScope = {
    kind: 'branch',
    axis: 'row',
    path: ['France'],
  };
  const usaScope: PivotFactStoreBatchScope = {
    kind: 'branch',
    axis: 'row',
    path: ['USA'],
  };

  store.upsertBatch({
    coverage: branchCoverage,
    scope: franceScope,
    valueKeys: ['sales'],
    facts: [buildFact({ rowPath: ['France', 'Paris'], columnPath: [] })],
  });

  expect(
    store.hasCompatibleCoverage({
      coverage: branchCoverage,
      scope: usaScope,
      valueKeys: ['sales'],
    }),
  ).toBe(false);
});

test('uses exact-depth root coverage for narrower branch coverage', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 1,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['month'],
  };
  const rootCoverage: PivotFactCoverage = {
    ...branchCoverage,
  };
  const franceFact = buildFact({
    rowPath: ['France', 'Paris'],
    columnPath: ['2026-01'],
    value: 1,
  });
  const usaFact = buildFact({
    rowPath: ['USA', 'Seattle'],
    columnPath: ['2026-01'],
    value: 2,
  });
  const franceBranchSelector = {
    coverage: branchCoverage,
    scope: {
      kind: 'branch',
      axis: 'row',
      path: ['France'],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: rootCoverage,
    scope: { kind: 'root' },
    valueKeys: ['sales'],
    facts: [franceFact, usaFact],
  });

  expect(store.hasCompatibleCoverage(franceBranchSelector)).toBe(true);
});

test('uses intersection scope for bounded cross-axis coverage', () => {
  const store = createPivotFactStore();
  const intersectionCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 2,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['quarter', 'month'],
  };
  const intersectionSelector = {
    coverage: intersectionCoverage,
    scope: {
      kind: 'intersection',
      rowPaths: [['USA'], ['France']],
      columnPaths: [['Q1']],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };
  const inScopeFact = buildFact({
    rowPath: ['USA', 'Seattle'],
    columnPath: ['Q1', 'Jan'],
    value: 1,
  });
  const offRowScopeFact = buildFact({
    rowPath: ['Canada', 'Toronto'],
    columnPath: ['Q1', 'Jan'],
    value: 2,
  });
  const offColumnScopeFact = buildFact({
    rowPath: ['USA', 'Seattle'],
    columnPath: ['Q2', 'Apr'],
    value: 3,
  });

  store.upsertBatch({
    ...intersectionSelector,
    facts: [inScopeFact, offRowScopeFact, offColumnScopeFact],
  });

  expect(store.hasCompatibleCoverage(intersectionSelector)).toBe(true);
  expect(store.getFactBatches()[0].facts).toEqual([inScopeFact]);
  expect(
    store.hasCompatibleCoverage({
      ...intersectionSelector,
      scope: {
        kind: 'intersection',
        rowPaths: [['Canada']],
        columnPaths: [['Q1']],
      },
    }),
  ).toBe(false);
});

test('does not reuse root coverage for values-token branch scopes', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    rowDepth: 1,
    columnDepth: 1,
    rowDimensions: ['country'],
    columnDimensions: ['band'],
  };
  const selectorWithMetricPath = {
    coverage: branchCoverage,
    scope: {
      kind: 'branch',
      axis: 'col',
      path: [encodeMetricKey('sales')],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: branchCoverage,
    scope: { kind: 'root' },
    valueKeys: ['sales'],
    facts: [buildFact({ columnPath: ['REV-A'] })],
  });

  expect(store.hasCompatibleCoverage(selectorWithMetricPath)).toBe(false);
});

test('does not reuse values-token branch coverage for root materialization', () => {
  const store = createPivotFactStore();
  const rootSelector = {
    coverage,
    scope: { kind: 'root' } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage,
    scope: {
      kind: 'branch',
      axis: 'col',
      path: [encodeMetricKey('sales')],
    },
    valueKeys: ['sales'],
    facts: [buildFact({ columnPath: [encodeMetricKey('sales'), 'REV-A'] })],
  });

  expect(store.hasCompatibleCoverage(rootSelector)).toBe(false);
});

test('keeps exact branch facts alongside broader compatible root coverage', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 1,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['month'],
  };
  const selector = {
    coverage: branchCoverage,
    scope: {
      kind: 'branch',
      axis: 'row',
      path: ['France'],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };
  const rootFact = buildFact({
    rowPath: ['France', 'Paris'],
    columnPath: ['2026-01'],
    value: 1,
  });
  const branchFact = buildFact({
    rowPath: ['France', 'Paris'],
    columnPath: ['2026-01'],
    value: 2,
  });

  store.upsertBatch({
    coverage: branchCoverage,
    scope: { kind: 'root' },
    valueKeys: ['sales'],
    facts: [rootFact],
  });
  store.upsertBatch({
    ...selector,
    facts: [branchFact],
  });

  expect(store.hasCompatibleCoverage(selector)).toBe(true);
  expect(store.getFactBatches().map(batch => batch.facts[0]?.value)).toEqual([
    1, 2,
  ]);
});

test('batch coverage can satisfy branch coverage checks', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 1,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['month'],
  };
  const franceSelector = {
    coverage: branchCoverage,
    scope: {
      kind: 'branch',
      axis: 'row',
      path: ['France'],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };
  const canadaSelector = {
    ...franceSelector,
    scope: {
      kind: 'branch',
      axis: 'row',
      path: ['Canada'],
    } as PivotFactStoreBatchScope,
  };

  store.upsertBatch({
    coverage: branchCoverage,
    scope: {
      kind: 'batch',
      axis: 'row',
      parentPath: [],
      siblingValues: ['France', 'USA'],
    },
    valueKeys: ['sales'],
    facts: [
      buildFact({
        rowPath: ['France', 'Paris'],
        columnPath: ['2026-01'],
        value: 1,
      }),
      buildFact({
        rowPath: ['USA', 'Seattle'],
        columnPath: ['2026-01'],
        value: 2,
      }),
    ],
  });

  expect(store.hasCompatibleCoverage(franceSelector)).toBe(true);
  expect(store.hasCompatibleCoverage(canadaSelector)).toBe(false);
});

test('registers compatible coverage aliases without upserting duplicate facts', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 1,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['month'],
  };
  const franceSelector = {
    coverage: branchCoverage,
    scope: {
      kind: 'branch',
      axis: 'row',
      path: ['France'],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: branchCoverage,
    scope: {
      kind: 'batch',
      axis: 'row',
      parentPath: [],
      siblingValues: ['France', 'USA'],
    },
    valueKeys: ['sales'],
    facts: [
      buildFact({
        rowPath: ['France', 'Paris'],
        columnPath: ['2026-01'],
        value: 1,
      }),
      buildFact({
        rowPath: ['USA', 'Seattle'],
        columnPath: ['2026-01'],
        value: 2,
      }),
    ],
  });
  expect(store.hasCompatibleCoverage(franceSelector)).toBe(true);
  expect(
    store
      .getCoverageSelectors()
      .some(batch => batch.scope === franceSelector.scope),
  ).toBe(false);
});

test('separate exact branches can satisfy a batched coverage request', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 1,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['month'],
  };
  const batchSelector = {
    coverage: branchCoverage,
    scope: {
      kind: 'batch',
      axis: 'row',
      parentPath: [],
      siblingValues: ['France', 'Canada'],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };

  [
    {
      coverage: branchCoverage,
      scope: {
        kind: 'branch',
        axis: 'row',
        path: ['France'],
      },
      valueKeys: ['sales'],
      facts: [
        buildFact({
          rowPath: ['France', 'Paris'],
          columnPath: ['2026-01'],
          value: 1,
        }),
      ],
    },
    {
      coverage: branchCoverage,
      scope: {
        kind: 'branch',
        axis: 'row',
        path: ['Canada'],
      },
      valueKeys: ['sales'],
      facts: [
        buildFact({
          rowPath: ['Canada', 'Toronto'],
          columnPath: ['2026-01'],
          value: 2,
        }),
      ],
    },
  ].forEach(store.upsertBatch);

  expect(store.hasCompatibleCoverage(batchSelector)).toBe(true);
});

test('does not reuse deeper aggregate facts for a shallower branch request', () => {
  const store = createPivotFactStore();
  const shallowCoverage: PivotFactCoverage = {
    rowDepth: 2,
    columnDepth: 1,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['month'],
  };
  const deepCoverage: PivotFactCoverage = {
    rowDepth: 3,
    columnDepth: 1,
    rowDimensions: ['country', 'city', 'store'],
    columnDimensions: ['month'],
  };
  const shallowSelector = {
    coverage: shallowCoverage,
    scope: {
      kind: 'branch',
      axis: 'row',
      path: ['France'],
    } as PivotFactStoreBatchScope,
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: deepCoverage,
    scope: {
      kind: 'branch',
      axis: 'row',
      path: ['France'],
    },
    valueKeys: ['sales'],
    facts: [
      buildFact({
        rowPath: ['France', 'Paris', 'Store A'],
        columnPath: ['2026-01'],
        value: 1,
      }),
    ],
  });

  expect(store.hasCompatibleCoverage(shallowSelector)).toBe(false);
});

test('reuses broader metric coverage for narrower compatible requests', () => {
  const store = createPivotFactStore();
  const rootSelector = {
    coverage,
    scope: { kind: 'root' } as PivotFactStoreBatchScope,
    valueKeys: ['profit', 'sales'],
  };

  store.upsertBatch({
    ...rootSelector,
    facts: [
      buildFact({ valueKey: 'sales', value: 1 }),
      buildFact({ valueKey: 'profit', value: 2 }),
    ],
  });

  expect(
    store.hasCompatibleCoverage({
      coverage,
      scope: { kind: 'root' },
      valueKeys: ['sales'],
    }),
  ).toBe(true);
  expect(
    store.hasCompatibleCoverage({
      coverage,
      scope: { kind: 'root' },
      valueKeys: ['quantity'],
    }),
  ).toBe(false);
});

test('tracks zero-row metric coverage through explicit value keys', () => {
  const store = createPivotFactStore();

  store.upsertBatch({
    ...selector,
    facts: [],
  });

  expect(
    store.hasCompatibleCoverage({
      coverage,
      scope: selector.scope,
      valueKeys: ['profit'],
    }),
  ).toBe(false);
});

test('tracks loaded coverage even when the query returns no facts', () => {
  const store = createPivotFactStore();

  expect(store.hasCompatibleCoverage(selector)).toBe(false);

  store.upsertBatch({
    coverage,
    scope: selector.scope,
    valueKeys: ['sales'],
    facts: [],
  });

  expect(store.hasCompatibleCoverage(selector)).toBe(true);
});
