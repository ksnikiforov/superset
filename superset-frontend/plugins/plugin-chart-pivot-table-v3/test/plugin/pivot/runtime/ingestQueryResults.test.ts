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
import { type PlannedQuerySpec } from '../../../../src/pivot/query/specs';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import {
  buildInitialRuntimeFromSpecResultsAsync,
  createPivotFactStore,
  ingestQueryResults,
  upsertQueryResultsIntoFactStore,
} from '../../../../src/pivot/runtime/ingestQueryResults';
import { materializeLoadedPivotTreeFromFactStore } from '../../fixtures/metricAxis';
import { buildLayoutContext } from '../../../../src/pivot/layout/LayoutContext';
import { MetricsLayoutEnum } from '../../../../src/types';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../../src/pivot/core/tokens';
import {
  serializeCellKey,
  serializePath,
} from '../../../../src/pivot/core/path';
import { buildFormData } from '../../fixtures/pivotFormData';

const buildSpec = ({
  queryName,
  rowDepth,
  colDepth,
  metrics = ['sales'],
  rowGroupby = ['country'],
  colGroupby = ['month'],
  metricsLayoutResolved = MetricsLayoutEnum.ROWS,
  metricInsertIndex = 1,
}: {
  queryName: string;
  rowDepth: number;
  colDepth: number;
  metrics?: string[];
  rowGroupby?: string[];
  colGroupby?: string[];
  metricsLayoutResolved?: MetricsLayoutEnum;
  metricInsertIndex?: number;
}): PlannedQuerySpec => {
  const withValuesPlaceholder = (columns: string[]) => [
    ...columns.slice(0, metricInsertIndex),
    METRICS_PLACEHOLDER,
    ...columns.slice(metricInsertIndex),
  ];
  const pivotProgram = compilePivotProgram({
    groupbyRows:
      metricsLayoutResolved === MetricsLayoutEnum.ROWS
        ? withValuesPlaceholder(rowGroupby)
        : rowGroupby,
    groupbyColumns:
      metricsLayoutResolved === MetricsLayoutEnum.COLUMNS
        ? withValuesPlaceholder(colGroupby)
        : colGroupby,
    metrics,
    metricsLayout: metricsLayoutResolved,
  });
  const coverage = {
    reason: 'initial' as const,
    rowDepth,
    columnDepth: colDepth,
    rowDimensions: rowGroupby.slice(0, rowDepth),
    columnDimensions: colGroupby.slice(0, colDepth),
  };
  return {
    queryName,
    columns: [
      ...rowGroupby.slice(0, rowDepth),
      ...colGroupby.slice(0, colDepth),
    ],
    metrics,
    filters: [],
    meta: {
      kind: 'root',
      requiredTimeOffsets: [],
      pivotProgram,
      coverage,
      factSelector: {
        coverage,
        scope: { kind: 'root' },
        valueKeys: metrics,
      },
    },
  };
};

test('ingests named query results into ordered fact batches', () => {
  const specs = [
    buildSpec({ queryName: 'pivot_v3|1|0', rowDepth: 1, colDepth: 0 }),
    buildSpec({ queryName: 'pivot_v3|1|1', rowDepth: 1, colDepth: 1 }),
  ];
  const ingested = ingestQueryResults({
    specs,
    results: [
      {
        query_name: 'pivot_v3|1|1',
        data: [{ country: 'France', month: '2026-01', sales: 12 }],
      },
      {
        query: { query_name: 'pivot_v3|1|0' },
        data: [{ country: 'France', sales: 30 }],
      },
    ],
  });

  expect(ingested.map(batch => batch.spec.queryName)).toEqual([
    'pivot_v3|1|0',
    'pivot_v3|1|1',
  ]);
  expect(ingested.map(batch => batch.result.data?.[0]?.sales)).toEqual([
    30, 12,
  ]);
  expect(ingested.flatMap(batch => batch.facts)).toEqual([
    {
      rowPath: ['France'],
      columnPath: [],
      valueKey: 'sales',
      value: 30,
    },
    {
      rowPath: ['France'],
      columnPath: ['2026-01'],
      valueKey: 'sales',
      value: 12,
    },
  ]);
});

test('does not positionally match partially named branch results', () => {
  const specs = [
    buildSpec({ queryName: 'pivot_v3|1|0', rowDepth: 1, colDepth: 0 }),
    buildSpec({ queryName: 'pivot_v3|1|1', rowDepth: 1, colDepth: 1 }),
  ];
  const ingested = ingestQueryResults({
    specs,
    results: [
      {
        query_name: 'pivot_v3|1|0',
        data: [{ country: 'France', sales: 30 }],
      },
      {
        data: [{ country: 'France', month: '2026-01', sales: 999 }],
      },
    ],
  });

  expect(ingested[0].facts).toHaveLength(1);
  expect(ingested[1].facts).toEqual([]);
});

test('records exact branch scope on fact-store batches', () => {
  const store = createPivotFactStore();
  const spec = buildSpec({
    queryName: 'pivot_v3|2|1|branch:row:France',
    rowDepth: 2,
    colDepth: 1,
    rowGroupby: ['country', 'city'],
  });
  const branchSpec: PlannedQuerySpec = {
    ...spec,
    meta: {
      ...spec.meta,
      kind: 'branch',
      axis: 'row',
      path: ['France'],
      factSelector: {
        ...spec.meta.factSelector,
        scope: {
          kind: 'branch',
          axis: 'row',
          path: ['France'],
        },
      },
    },
  };

  const [batch] = upsertQueryResultsIntoFactStore({
    store,
    specs: [branchSpec],
    results: [
      {
        query_name: branchSpec.queryName,
        data: [
          {
            country: 'France',
            city: 'Paris',
            month: '2026-01',
            sales: 12,
          },
        ],
      },
    ],
  });

  expect(batch.scope).toEqual({
    kind: 'branch',
    axis: 'row',
    path: ['France'],
  });
  expect(batch.coverage).toMatchObject({
    rowDepth: 2,
    columnDepth: 1,
  });
});

test('keeps support and offset facts without materializing support metric branches', () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|0|branch:row:France',
    rowDepth: 1,
    colDepth: 0,
    metrics: ['sales', 'sortMetric'],
  });
  const result = {
    query_name: spec.queryName,
    data: [
      {
        country: 'France',
        sales: 10,
        sortMetric: 99,
        'sales__1 year ago': 7,
      },
    ],
  };
  const [ingested] = ingestQueryResults({
    specs: [spec],
    results: [result],
  });

  expect(ingested.facts.map(fact => fact.valueKey)).toEqual([
    'sales',
    'sortMetric',
    'sales__1 year ago',
  ]);

  const store = createPivotFactStore();
  upsertQueryResultsIntoFactStore({
    store,
    specs: [spec],
    results: [result],
  });
  const formData = buildFormData({
    groupbyRows: ['country', METRICS_PLACEHOLDER],
    groupbyColumns: ['month'],
    metrics: ['sales'],
    metricsLayout: MetricsLayoutEnum.ROWS,
    metricLabelMap: { sales: 'Sales', sortMetric: 'Sort metric' },
  });
  const tree = materializeLoadedPivotTreeFromFactStore({
    store,
    layout: buildLayoutContext(formData),
    formData,
  });
  const visibleMetricRowKey = serializePath([
    'France',
    encodeMetricKey('sales'),
  ]);
  const supportMetricRowKey = serializePath([
    'France',
    encodeMetricKey('sortMetric'),
  ]);
  const cell = tree.cells[serializeCellKey(visibleMetricRowKey, '')];

  expect(tree.rows[visibleMetricRowKey]).toBeDefined();
  expect(tree.rows[supportMetricRowKey]).toBeUndefined();
  expect(cell.values).toMatchObject({
    sales: 10,
    sortMetric: 99,
    'sales__1 year ago': 7,
  });
});

test('materializes column subtotal leaves from planned coverage specs', () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|1|branch:row:France',
    rowDepth: 1,
    colDepth: 1,
    rowGroupby: ['country'],
    colGroupby: ['category', 'subcategory'],
  });
  const store = createPivotFactStore();
  upsertQueryResultsIntoFactStore({
    store,
    specs: [spec],
    results: [
      {
        query_name: spec.queryName,
        data: [{ country: 'France', category: 'Furniture', sales: 12 }],
      },
    ],
  });
  const formData = buildFormData({
    groupbyRows: ['country', METRICS_PLACEHOLDER],
    groupbyColumns: ['category', 'subcategory'],
    metrics: ['sales'],
    metricsLayout: MetricsLayoutEnum.ROWS,
    colSubtotalLevels: [1],
  });
  const tree = materializeLoadedPivotTreeFromFactStore({
    store,
    layout: buildLayoutContext(formData),
    formData,
  });
  const metricRowKey = serializePath(['France', encodeMetricKey('sales')]);
  const subtotalColKey = serializePath(['Furniture', SUBTOTAL_TOKEN]);
  const subtotalCell =
    tree.cells[serializeCellKey(metricRowKey, subtotalColKey)];

  expect(tree.cols[subtotalColKey]).toMatchObject({
    path: ['Furniture', SUBTOTAL_TOKEN],
    isSubtotal: true,
  });
  expect(subtotalCell).toMatchObject({
    rowKey: metricRowKey,
    colKey: subtotalColKey,
    values: expect.objectContaining({ sales: 12 }),
    isSubtotal: true,
  });
});

test('chunked initial runtime materialization yields while preserving facts and tree output', async () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|1',
    rowDepth: 1,
    colDepth: 1,
    rowGroupby: ['country'],
    colGroupby: ['month'],
  });
  const formData = buildFormData({
    groupbyRows: ['country', METRICS_PLACEHOLDER],
    groupbyColumns: ['month'],
    metrics: ['sales'],
    metricsLayout: MetricsLayoutEnum.ROWS,
  });
  const yieldToMain = jest.fn(async () => undefined);

  const runtime = await buildInitialRuntimeFromSpecResultsAsync({
    specs: [spec],
    results: [
      {
        query_name: spec.queryName,
        data: [
          { country: 'France', month: '2026-01', sales: 12 },
          { country: 'Spain', month: '2026-02', sales: 7 },
        ],
      },
    ],
    layout: buildLayoutContext(formData),
    formData,
    chunkSize: 1,
    yieldToMain,
  });

  const rowKey = serializePath(['France', encodeMetricKey('sales')]);
  const colKey = serializePath(['2026-01']);
  expect(runtime.factBatches).toHaveLength(1);
  expect(runtime.factBatches[0].facts).toHaveLength(2);
  expect(runtime.tree.cells[serializeCellKey(rowKey, colKey)]?.values).toEqual(
    expect.objectContaining({ sales: 12 }),
  );
  expect(yieldToMain.mock.calls.length).toBeGreaterThan(3);
});

test('chunked initial runtime materialization aborts stale work before commit', async () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|1',
    rowDepth: 1,
    colDepth: 1,
    rowGroupby: ['country'],
    colGroupby: ['month'],
  });
  const formData = buildFormData({
    groupbyRows: ['country', METRICS_PLACEHOLDER],
    groupbyColumns: ['month'],
    metrics: ['sales'],
    metricsLayout: MetricsLayoutEnum.ROWS,
  });
  let current = true;
  const yieldToMain = jest.fn(async () => {
    current = false;
  });

  await expect(
    buildInitialRuntimeFromSpecResultsAsync({
      specs: [spec],
      results: [
        {
          query_name: spec.queryName,
          data: [{ country: 'France', month: '2026-01', sales: 12 }],
        },
      ],
      layout: buildLayoutContext(formData),
      formData,
      chunkSize: 1,
      shouldContinue: () => current,
      yieldToMain,
    }),
  ).rejects.toMatchObject({ name: 'StaleChunkedWorkError' });
  expect(yieldToMain).toHaveBeenCalled();
});
