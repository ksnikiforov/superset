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
  type PivotFactSelector,
  type PivotFactStore,
  type PivotFactStoreBatchScope,
} from '../../../../src/pivot/runtime/factStore';
import { type PivotFactCoverage } from '../../../../src/pivot/runtime/types';
import { encodeMetricKey } from '../../../../src/pivot/core/tokens';
import { factSelectorsCoverSelector } from '../../../../src/pivot/runtime/coverage';

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

const hasCompatibleCoverage = (
  store: Pick<PivotFactStore, 'getCoverageSelectors'>,
  selector: PivotFactSelector,
) => factSelectorsCoverSelector(store.getCoverageSelectors(), selector);

const axisScope = (
  axis: 'row' | 'col',
  path: PivotFact['rowPath'],
): PivotFactStoreBatchScope => ({
  kind: 'axisPaths',
  axis,
  paths: [path],
});

const axisPathSetScope = (
  axis: 'row' | 'col',
  paths: PivotFact['rowPath'][],
): PivotFactStoreBatchScope => ({
  kind: 'axisPaths',
  axis,
  paths,
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
  const secondScope = axisScope('row', ['USA']);

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
  const franceScope = axisScope('row', ['France']);
  const usaScope = axisScope('row', ['USA']);

  store.upsertBatch({
    coverage: branchCoverage,
    scope: franceScope,
    valueKeys: ['sales'],
    facts: [buildFact({ rowPath: ['France', 'Paris'], columnPath: [] })],
  });

  expect(
    hasCompatibleCoverage(store, {
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
    scope: axisScope('row', ['France']),
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: rootCoverage,
    scope: { kind: 'root' },
    valueKeys: ['sales'],
    facts: [franceFact, usaFact],
  });

  expect(hasCompatibleCoverage(store, franceBranchSelector)).toBe(true);
});

test('rejects facts whose paths do not match batch coverage depth', () => {
  const store = createPivotFactStore();

  store.upsertBatch({
    ...selector,
    facts: [
      buildFact({ value: 1 }),
      buildFact({ rowPath: ['France', 'Paris'], value: 2 }),
      buildFact({ columnPath: [], value: 3 }),
    ],
  });

  expect(store.getFactBatches()[0].facts).toEqual([buildFact({ value: 1 })]);
});

test('keeps coverage selector for empty exact-depth batch', () => {
  const store = createPivotFactStore();

  store.upsertBatch({
    ...selector,
    facts: [buildFact({ rowPath: ['France', 'Paris'] })],
  });

  expect(store.getFactBatches()[0].facts).toEqual([]);
  expect(hasCompatibleCoverage(store, selector)).toBe(true);
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

  expect(hasCompatibleCoverage(store, intersectionSelector)).toBe(true);
  expect(store.getFactBatches()[0].facts).toEqual([inScopeFact]);
  expect(
    hasCompatibleCoverage(store, {
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
    scope: axisScope('col', [encodeMetricKey('sales')]),
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: branchCoverage,
    scope: { kind: 'root' },
    valueKeys: ['sales'],
    facts: [buildFact({ columnPath: ['REV-A'] })],
  });

  expect(hasCompatibleCoverage(store, selectorWithMetricPath)).toBe(false);
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
    scope: axisScope('col', [encodeMetricKey('sales')]),
    valueKeys: ['sales'],
    facts: [buildFact({ columnPath: [encodeMetricKey('sales'), 'REV-A'] })],
  });

  expect(hasCompatibleCoverage(store, rootSelector)).toBe(false);
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
    scope: axisScope('row', ['France']),
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

  expect(hasCompatibleCoverage(store, selector)).toBe(true);
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
    scope: axisScope('row', ['France']),
    valueKeys: ['sales'],
  };
  const canadaSelector = {
    ...franceSelector,
    scope: axisScope('row', ['Canada']),
  };

  store.upsertBatch({
    coverage: branchCoverage,
    scope: axisPathSetScope('row', [['France'], ['USA']]),
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

  expect(hasCompatibleCoverage(store, franceSelector)).toBe(true);
  expect(hasCompatibleCoverage(store, canadaSelector)).toBe(false);
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
    scope: axisScope('row', ['France']),
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: branchCoverage,
    scope: axisPathSetScope('row', [['France'], ['USA']]),
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
  expect(hasCompatibleCoverage(store, franceSelector)).toBe(true);
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
    scope: axisPathSetScope('row', [['France'], ['Canada']]),
    valueKeys: ['sales'],
  };

  [
    {
      coverage: branchCoverage,
      scope: axisScope('row', ['France']),
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
      scope: axisScope('row', ['Canada']),
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

  expect(hasCompatibleCoverage(store, batchSelector)).toBe(true);
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
    scope: axisScope('row', ['France']),
    valueKeys: ['sales'],
  };

  store.upsertBatch({
    coverage: deepCoverage,
    scope: axisScope('row', ['France']),
    valueKeys: ['sales'],
    facts: [
      buildFact({
        rowPath: ['France', 'Paris', 'Store A'],
        columnPath: ['2026-01'],
        value: 1,
      }),
    ],
  });

  expect(hasCompatibleCoverage(store, shallowSelector)).toBe(false);
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
    hasCompatibleCoverage(store, {
      coverage,
      scope: { kind: 'root' },
      valueKeys: ['sales'],
    }),
  ).toBe(true);
  expect(
    hasCompatibleCoverage(store, {
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
    hasCompatibleCoverage(store, {
      coverage,
      scope: selector.scope,
      valueKeys: ['profit'],
    }),
  ).toBe(false);
});

test('tracks loaded coverage even when the query returns no facts', () => {
  const store = createPivotFactStore();

  expect(hasCompatibleCoverage(store, selector)).toBe(false);

  store.upsertBatch({
    coverage,
    scope: selector.scope,
    valueKeys: ['sales'],
    facts: [],
  });

  expect(hasCompatibleCoverage(store, selector)).toBe(true);
});
