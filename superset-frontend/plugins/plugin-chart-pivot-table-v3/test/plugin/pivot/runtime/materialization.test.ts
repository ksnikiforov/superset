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
import { METRICS_PLACEHOLDER } from '../../../../src/pivot/core/tokens';
import {
  buildOffsetMetricKey,
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';
import {
  buildPivotFactQueryContextKey,
  createPivotFactStore,
  type PivotFactStoreBatch,
} from '../../../../src/pivot/runtime/factStore';
import {
  materializeLoadedPivotTreeFromFactStore,
  materializeLoadedPivotTreeFromFactStoreAsync,
} from '../../../../src/pivot/runtime/materializePivotTree';

function fixture(
  axis: 'row' | 'col',
  position: number,
  leaves: boolean,
  batchCount = 4,
) {
  const rows = ['country', 'city', 'shop'];
  const cols = ['year', 'month', 'day'];
  (axis === 'row' ? rows : cols).splice(position, 0, METRICS_PLACEHOLDER);
  const formData = buildFormData({
    groupbyRows: rows,
    groupbyColumns: cols,
    metrics: ['sales', 'cost'],
    rowTotals: true,
    colTotals: true,
    rowSubTotals: true,
    colSubtotalLevels: [1, 2],
    ...(leaves
      ? {
          measureLeavesByMetric: {
            sales: [
              buildValueLeaf(),
              buildBuiltInLeaf('delta', {
                n: 1,
                unit: 'year',
                direction: 'past',
              }),
            ],
          },
        }
      : {}),
  });
  const layout = buildLayoutContext(formData);
  const queryContextKey = buildPivotFactQueryContextKey(formData);
  const store = createPivotFactStore();
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    const rowDepth = 1 + (batchIndex % 3);
    const columnDepth = 1 + ((batchIndex + 1) % 3);
    const rowPath = ['France', 'Paris', `Shop ${batchIndex}`].slice(
      0,
      rowDepth,
    );
    const batch: PivotFactStoreBatch = {
      coverage: {
        rowDepth,
        columnDepth,
        rowDimensions: layout.pivotProgram.rowDimensions.slice(0, rowDepth),
        columnDimensions: layout.pivotProgram.columnDimensions.slice(
          0,
          columnDepth,
        ),
      },
      queryContextKey,
      complete: batchIndex % 2 === 0,
      scope: { kind: 'axisPaths', axis: 'row', paths: [rowPath] },
      valueKeys: [
        'sales',
        'cost',
        buildOffsetMetricKey('sales', {
          n: 1,
          unit: 'year',
          direction: 'past',
        }),
      ],
      facts: [
        'sales',
        'cost',
        buildOffsetMetricKey('sales', {
          n: 1,
          unit: 'year',
          direction: 'past',
        }),
      ].map((valueKey, i) => ({
        rowPath,
        columnPath: ['2025', 'Jan', '01'].slice(0, columnDepth),
        valueKey,
        value: batchIndex * 10 + i,
      })),
    };
    store.upsertBatch(batch);
  }
  return { store, layout, formData };
}

const layouts = (['row', 'col'] as const).flatMap(axis =>
  [0, 1, 2, 3].flatMap(position =>
    [false, true].map(leaves => ({ axis, position, leaves })),
  ),
);

test.each(layouts)(
  'sync and scheduled materialization agree for $axis Values at $position, leaves=$leaves',
  async ({ axis, position, leaves }) => {
    const input = fixture(axis, position, leaves);
    const before = JSON.stringify(input.store.getFactBatches());
    const sync = materializeLoadedPivotTreeFromFactStore(input);
    const schedule = jest.fn(async () => undefined);
    const asyncTree = await materializeLoadedPivotTreeFromFactStoreAsync({
      ...input,
      chunkSize: 1,
      yieldToMain: schedule,
    });
    expect(asyncTree).toEqual(sync);
    expect(Object.keys(sync.cells).length).toBeGreaterThan(0);
    expect(schedule).toHaveBeenCalled();
    expect(JSON.stringify(input.store.getFactBatches())).toBe(before);
  },
);

test.each([1, 2, 3, 4, 5, 6])(
  'scheduled materialization rejects cancellation at checkpoint %s without changing stored facts',
  async checkpoint => {
    const input = fixture('row', 1, true);
    const before = JSON.stringify(input.store.getFactBatches());
    let calls = 0;
    await expect(
      materializeLoadedPivotTreeFromFactStoreAsync({
        ...input,
        chunkSize: 1,
        shouldContinue: () => calls < checkpoint,
        yieldToMain: async () => {
          calls += 1;
        },
      }),
    ).rejects.toMatchObject({ name: 'StaleChunkedWorkError' });
    expect(JSON.stringify(input.store.getFactBatches())).toBe(before);
  },
);

test('empty materialization rejects already cancelled work', async () => {
  const input = fixture('col', 0, false, 0);
  await expect(
    materializeLoadedPivotTreeFromFactStoreAsync({
      ...input,
      shouldContinue: () => false,
    }),
  ).rejects.toMatchObject({ name: 'StaleChunkedWorkError' });
});
