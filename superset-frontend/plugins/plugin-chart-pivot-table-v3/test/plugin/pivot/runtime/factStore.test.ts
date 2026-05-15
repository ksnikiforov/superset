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
  buildPivotFactKey,
  createPivotFactStore,
  type PivotFact,
  type PivotFactStoreBatchScope,
} from '../../../../src/pivot/runtime/factStore';
import { type PivotFactCoverage } from '../../../../src/pivot/runtime/types';
import { encodeMetricKey } from '../../../../src/pivot/core/tokens';

const coverage: PivotFactCoverage = {
  reason: 'initial',
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
  role: 'visible',
  ...overrides,
});

test('keys facts by exact coverage path value and role', () => {
  const visibleFact = buildFact();
  const supportFact = buildFact({ role: 'support' });

  expect(buildPivotFactKey(selector, visibleFact)).not.toEqual(
    buildPivotFactKey(selector, supportFact),
  );
});

test('upserts duplicate exact facts while keeping support facts separate', () => {
  const store = createPivotFactStore();

  store.upsertBatch({
    ...selector,
    facts: [
      buildFact({ value: 10 }),
      buildFact({ value: 12 }),
      buildFact({ role: 'support', value: 99 }),
    ],
  });

  expect(store.size()).toBe(2);
  expect(
    store.getFacts(selector).map(fact => ({
      role: fact.role,
      value: fact.value,
    })),
  ).toEqual([
    { role: 'visible', value: 12 },
    { role: 'support', value: 99 },
  ]);
});

test('does not share facts across different request scopes with the same coverage', () => {
  const store = createPivotFactStore();
  const firstScope: PivotFactStoreBatchScope = { kind: 'root' };
  const secondScope: PivotFactStoreBatchScope = { kind: 'bootstrap' };

  store.upsertBatches([
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
      facts: [buildFact({ value: 2 })],
    },
  ]);

  expect(
    store
      .getFacts({ coverage, scope: firstScope, valueKeys: ['sales'] })
      .map(fact => fact.value),
  ).toEqual([1]);
  expect(
    store
      .getFacts({ coverage, scope: secondScope, valueKeys: ['sales'] })
      .map(fact => fact.value),
  ).toEqual([2]);
});

test('does not satisfy sibling branch scopes with identical coverage', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    reason: 'expand',
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
    store.hasCoverage({
      coverage: branchCoverage,
      scope: franceScope,
      valueKeys: ['sales'],
    }),
  ).toBe(true);
  expect(
    store.hasCoverage({
      coverage: branchCoverage,
      scope: usaScope,
      valueKeys: ['sales'],
    }),
  ).toBe(false);
  expect(
    store.getFacts({
      coverage: branchCoverage,
      scope: usaScope,
      valueKeys: ['sales'],
    }),
  ).toEqual([]);
});

test('materialization can reuse compatible root coverage for branch facts', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    reason: 'expand',
    rowDepth: 2,
    columnDepth: 1,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['month'],
  };
  const rootCoverage: PivotFactCoverage = {
    ...branchCoverage,
    reason: 'initial',
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

  expect(store.hasCoverage(franceBranchSelector)).toBe(false);
  expect(store.hasCompatibleCoverage(franceBranchSelector)).toBe(true);
  expect(store.getFacts(franceBranchSelector)).toEqual([]);
  expect(
    store.getCompatibleFacts(franceBranchSelector).map(fact => fact.rowPath),
  ).toEqual([['France', 'Paris']]);
});

test('does not reuse root coverage for values-token branch scopes', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    reason: 'expand',
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
    coverage: { ...branchCoverage, reason: 'initial' },
    scope: { kind: 'root' },
    valueKeys: ['sales'],
    facts: [buildFact({ columnPath: ['REV-A'] })],
  });

  expect(store.hasCompatibleCoverage(selectorWithMetricPath)).toBe(false);
  expect(store.getCompatibleFacts(selectorWithMetricPath)).toEqual([]);
});

test('prefers exact branch facts over broader compatible root coverage', () => {
  const store = createPivotFactStore();
  const branchCoverage: PivotFactCoverage = {
    reason: 'expand',
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
    coverage: { ...branchCoverage, reason: 'initial' },
    scope: { kind: 'root' },
    valueKeys: ['sales'],
    facts: [rootFact],
  });
  store.upsertBatch({
    ...selector,
    facts: [branchFact],
  });

  expect(store.hasCompatibleCoverage(selector)).toBe(true);
  expect(store.getCompatibleFacts(selector).map(fact => fact.value)).toEqual([
    2,
  ]);
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
    store
      .getCompatibleFacts({
        coverage,
        scope: { kind: 'root' },
        valueKeys: ['sales'],
      })
      .map(fact => fact.valueKey),
  ).toEqual(['sales']);
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

  expect(store.hasCoverage(selector)).toBe(true);
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

  expect(store.hasCoverage(selector)).toBe(false);

  store.upsertBatch({
    coverage,
    scope: selector.scope,
    valueKeys: ['sales'],
    facts: [],
  });

  expect(store.hasCoverage(selector)).toBe(true);
  expect(store.getFacts(selector)).toEqual([]);
});
