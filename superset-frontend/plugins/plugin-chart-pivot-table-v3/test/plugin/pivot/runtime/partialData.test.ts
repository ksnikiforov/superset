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
import { buildFormData } from '../../fixtures/pivotFormData';
import { buildLayoutContext } from '../../../../src/pivot/layout/LayoutContext';
import {
  createPivotFactStore,
  buildPivotFactQueryContextKey,
  type PivotFactStoreBatchScope,
} from '../../../../src/pivot/runtime/factStore';
import { materializeLoadedPivotTreeFromFactStore } from '../../../../src/pivot/runtime/materializePivotTree';
import {
  buildBuiltInLeaf,
  buildMeasureLeafOutputKey,
  buildCustomLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';
import { buildOffsetMetricKey } from '../../../../src/pivot/measureLeaves';
import { type PivotTableQueryFormData } from '../../../../src/types';

const setupPartialStore = (
  overrides: Partial<PivotTableQueryFormData> = {},
) => {
  const formData = buildFormData({
    groupbyRows: ['country'],
    groupbyColumns: ['month'],
    metrics: ['sales', 'cost'],
    ...overrides,
  });
  const store = createPivotFactStore();
  const queryContextKey = buildPivotFactQueryContextKey(formData);
  const add = (
    valueKey: string,
    value: number,
    complete: boolean,
    scope: PivotFactStoreBatchScope = { kind: 'root' },
    context = queryContextKey,
  ) =>
    store.upsertBatch({
      coverage: {
        rowDepth: 1,
        columnDepth: 1,
        rowDimensions: ['country'],
        columnDimensions: ['month'],
      },
      scope,
      valueKeys: [valueKey],
      complete,
      queryContextKey: context,
      facts: [{ rowPath: ['France'], columnPath: ['Jan'], valueKey, value }],
    });
  const materialize = () =>
    materializeLoadedPivotTreeFromFactStore({
      store,
      layout: buildLayoutContext(formData),
      formData,
    });
  return { add, materialize, store, queryContextKey };
};

test('mixed complete and partial metrics retain separate provenance through metric projection', () => {
  const { add, materialize } = setupPartialStore();
  add('sales', 10, true);
  add('cost', 20, false);
  const tree = materialize();
  expect(
    Object.values(tree.cells).some(cell =>
      cell.partialValueKeys?.includes('cost'),
    ),
  ).toBe(true);
  expect(
    Object.values(tree.cells).some(cell =>
      cell.partialValueKeys?.includes('sales'),
    ),
  ).toBe(false);
  expect(tree.rows.France.isPartial).toBeUndefined();
});

test.each([true, false])(
  'complete values supersede overlapping partial queries in either batch order: %s',
  completeFirst => {
    const { add, materialize } = setupPartialStore();
    const complete = () => add('sales', 100, true);
    const partial = () =>
      add('sales', 10, false, {
        kind: 'axisPaths',
        axis: 'row',
        paths: [['France']],
      });
    if (completeFirst) {
      complete();
      partial();
    } else {
      partial();
      complete();
    }
    const cells = Object.values(materialize().cells).filter(
      cell => cell.values.sales !== undefined,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(
      cells.every(
        cell =>
          cell.values.sales === 100 &&
          !cell.partialValueKeys?.includes('sales'),
      ),
    ).toBe(true);
  },
);

test('replacing a truncated batch clears its partial values and group labels', () => {
  const { add, materialize } = setupPartialStore();
  add('sales', 10, false);
  expect(materialize().rows.France.isPartial).toBe(true);
  add('sales', 100, true);
  const tree = materialize();
  expect(tree.rows.France.isPartial).toBeUndefined();
  expect(
    Object.values(tree.cells).some(cell => cell.partialValueKeys?.length),
  ).toBe(false);
});

test('partial batches from a different query context do not affect the displayed table', () => {
  const { add, materialize } = setupPartialStore();
  add('sales', 10, false, { kind: 'root' }, 'obsolete context');
  add('cost', 20, true);
  const tree = materialize();
  expect(
    Object.values(tree.cells).some(cell => cell.partialValueKeys?.length),
  ).toBe(false);
  expect(Object.values(tree.rows).some(node => node.isPartial)).toBe(false);
});

test('computed comparison and custom leaves inherit only their partial input keys', () => {
  const offset = { n: 1, unit: 'year' as const, direction: 'past' as const };
  const delta = buildBuiltInLeaf('delta', offset);
  const custom = buildCustomLeaf({ label: 'Cost', metric: 'cost' });
  const { add, materialize } = setupPartialStore({
    measureLeavesByMetric: { sales: [buildValueLeaf(), delta, custom] },
  });
  add('sales', 30, true);
  add(buildOffsetMetricKey('sales', offset), 10, false);
  add('cost', 5, false);
  const cells = Object.values(materialize().cells);
  const deltaKey = buildMeasureLeafOutputKey('sales', delta);
  expect(
    cells.some(
      cell =>
        cell.values[deltaKey] === 20 &&
        cell.partialValueKeys?.includes(deltaKey),
    ),
  ).toBe(true);
  expect(cells.some(cell => cell.partialValueKeys?.includes('sales'))).toBe(
    false,
  );
});

test('custom leaves preserve partial status when their metric is queried with the base metric', () => {
  const custom = buildCustomLeaf({ label: 'Cost', metric: 'cost' });
  const { store, materialize, queryContextKey } = setupPartialStore({
    measureLeavesByMetric: { sales: [buildValueLeaf(), custom] },
  });
  store.upsertBatch({
    coverage: {
      rowDepth: 1,
      columnDepth: 1,
      rowDimensions: ['country'],
      columnDimensions: ['month'],
    },
    scope: { kind: 'root' },
    valueKeys: ['sales', 'cost'],
    queryContextKey,
    complete: false,
    facts: ['sales', 'cost'].map(valueKey => ({
      rowPath: ['France'],
      columnPath: ['Jan'],
      valueKey,
      value: 5,
    })),
  });
  const customKey = buildMeasureLeafOutputKey('sales', custom);
  expect(
    Object.values(materialize().cells).some(
      cell =>
        cell.values[customKey] === 5 &&
        cell.partialValueKeys?.includes(customKey),
    ),
  ).toBe(true);
});
