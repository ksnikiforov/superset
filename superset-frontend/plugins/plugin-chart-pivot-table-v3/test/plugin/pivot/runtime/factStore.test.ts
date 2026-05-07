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
    { coverage, scope: firstScope, facts: [buildFact({ value: 1 })] },
    { coverage, scope: secondScope, facts: [buildFact({ value: 2 })] },
  ]);

  expect(
    store.getFacts({ coverage, scope: firstScope }).map(fact => fact.value),
  ).toEqual([1]);
  expect(
    store.getFacts({ coverage, scope: secondScope }).map(fact => fact.value),
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
    facts: [buildFact({ rowPath: ['France', 'Paris'], columnPath: [] })],
  });

  expect(
    store.hasCoverage({ coverage: branchCoverage, scope: franceScope }),
  ).toBe(true);
  expect(store.hasCoverage({ coverage: branchCoverage, scope: usaScope })).toBe(
    false,
  );
  expect(store.getFacts({ coverage: branchCoverage, scope: usaScope })).toEqual(
    [],
  );
});

test('tracks loaded coverage even when the query returns no facts', () => {
  const store = createPivotFactStore();

  expect(store.hasCoverage(selector)).toBe(false);

  store.upsertBatch({
    coverage,
    scope: selector.scope,
    facts: [],
  });

  expect(store.hasCoverage(selector)).toBe(true);
  expect(store.getFacts(selector)).toEqual([]);
});
