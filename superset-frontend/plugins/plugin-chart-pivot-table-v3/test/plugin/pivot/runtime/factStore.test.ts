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
} from '../../../../src/pivot/runtime/factStore';
import { type PivotFactCoverage } from '../../../../src/pivot/runtime/types';

const coverage: PivotFactCoverage = {
  reason: 'initial',
  rowDepth: 1,
  columnDepth: 1,
  rowDimensions: ['country'],
  columnDimensions: ['month'],
};

const buildFact = (overrides: Partial<PivotFact> = {}): PivotFact => ({
  rowPath: ['France'],
  columnPath: ['2026-01'],
  valueKey: 'sales',
  value: 10,
  role: 'visible',
  coverage,
  queryName: 'pivot_v3|1|1',
  ...overrides,
});

test('keys facts by exact coverage path value and role', () => {
  const visibleFact = buildFact();
  const supportFact = buildFact({ role: 'support' });

  expect(buildPivotFactKey(visibleFact)).not.toEqual(
    buildPivotFactKey(supportFact),
  );
});

test('upserts duplicate exact facts while keeping support facts separate', () => {
  const store = createPivotFactStore();

  store.upsertMany([
    buildFact({ value: 10 }),
    buildFact({ value: 12 }),
    buildFact({ role: 'support', value: 99 }),
  ]);

  expect(store.size()).toBe(2);
  expect(
    store.getFacts({ coverage, queryName: 'pivot_v3|1|1' }).map(fact => ({
      role: fact.role,
      value: fact.value,
    })),
  ).toEqual([
    { role: 'visible', value: 12 },
    { role: 'support', value: 99 },
  ]);
});

test('uses query name as the fallback identity when coverage is missing', () => {
  const store = createPivotFactStore();

  store.upsertMany([
    buildFact({ coverage: undefined, queryName: 'first', value: 1 }),
    buildFact({ coverage: undefined, queryName: 'second', value: 2 }),
  ]);

  expect(
    store.getFacts({ queryName: 'first' }).map(fact => fact.value),
  ).toEqual([1]);
  expect(
    store.getFacts({ queryName: 'second' }).map(fact => fact.value),
  ).toEqual([2]);
});

test('does not share facts across different query scopes with the same coverage', () => {
  const store = createPivotFactStore();

  store.upsertMany([
    buildFact({ queryName: 'first', value: 1 }),
    buildFact({ queryName: 'second', value: 2 }),
  ]);

  expect(
    store.getFacts({ coverage, queryName: 'first' }).map(fact => fact.value),
  ).toEqual([1]);
  expect(
    store.getFacts({ coverage, queryName: 'second' }).map(fact => fact.value),
  ).toEqual([2]);
});

test('tracks loaded coverage even when the query returns no facts', () => {
  const store = createPivotFactStore();

  expect(store.hasCoverage({ coverage, queryName: 'pivot_v3|1|1' })).toBe(
    false,
  );

  store.upsertBatch({
    coverage,
    queryName: 'pivot_v3|1|1',
    facts: [],
  });

  expect(store.hasCoverage({ coverage, queryName: 'pivot_v3|1|1' })).toBe(true);
  expect(store.getFacts({ coverage, queryName: 'pivot_v3|1|1' })).toEqual([]);
});
