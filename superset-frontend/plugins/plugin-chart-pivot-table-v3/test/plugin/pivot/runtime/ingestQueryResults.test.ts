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
import {
  createPivotFactStore,
  ingestQueryResults,
  upsertQueryResultsIntoFactStoreAsync,
} from '../../../../src/pivot/runtime/ingestQueryResults';
import {
  materializeLoadedPivotTreeFromFactStore,
  materializeLoadedPivotTreeFromFactStoreAsync,
} from '../../fixtures/metricAxis';
import { buildLayoutContext } from '../../../../src/pivot/layout/LayoutContext';
import { type DataRecordValue } from '@superset-ui/core';
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
import { buildPivotFactQueryContextKey } from '../../../../src/pivot/runtime/factStore';

const queryContextKey = buildPivotFactQueryContextKey(buildFormData({}));

const buildSpec = ({
  queryName,
  rowDepth,
  colDepth,
  metrics = ['sales'],
  rowGroupby = ['country'],
  colGroupby = ['month'],
  materialization,
  scope = { kind: 'root' } as PlannedQuerySpec['meta']['factSelector']['scope'],
}: {
  queryName: string;
  rowDepth: number;
  colDepth: number;
  metrics?: string[];
  rowGroupby?: string[];
  colGroupby?: string[];
  materialization?: PlannedQuerySpec['meta']['factSelector']['materialization'];
  scope?: PlannedQuerySpec['meta']['factSelector']['scope'];
}): PlannedQuerySpec => {
  const coverage = {
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
      requiredTimeOffsets: [],
      factSelector: {
        coverage,
        queryContextKey,
        scope,
        valueKeys: metrics,
        materialization,
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
    queryName: 'pivot_v3|2|1|scope:France',
    rowDepth: 2,
    colDepth: 1,
    rowGroupby: ['country', 'city'],
  });
  const branchSpec: PlannedQuerySpec = {
    ...spec,
    meta: {
      ...spec.meta,
      factSelector: {
        ...spec.meta.factSelector,
        scope: {
          kind: 'axisPaths',
          axis: 'row',
          paths: [['France']],
        },
      },
    },
  };

  const [ingested] = ingestQueryResults({
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
  const batch = {
    ...ingested.spec.meta.factSelector,
    facts: ingested.facts,
  };
  store.upsertBatch(batch);

  expect(batch.scope).toEqual({
    kind: 'axisPaths',
    axis: 'row',
    paths: [['France']],
  });
  expect(batch.coverage).toMatchObject({
    rowDepth: 2,
    columnDepth: 1,
  });
});

test('keeps support and offset facts without materializing support metric branches', () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|0|scope:France',
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
  ingestQueryResults({
    specs: [spec],
    results: [result],
  }).forEach(ingested =>
    store.upsertBatch({
      ...ingested.spec.meta.factSelector,
      facts: ingested.facts,
    }),
  );
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

test('materializes projected date labels when values are before dimensions', () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|0',
    rowDepth: 1,
    colDepth: 0,
    rowGroupby: ['order_date'],
  });
  const store = createPivotFactStore();
  ingestQueryResults({
    specs: [spec],
    results: [
      {
        query_name: spec.queryName,
        data: [{ order_date: '1704067200000', sales: 10 }],
      },
    ],
  }).forEach(ingested =>
    store.upsertBatch({
      ...ingested.spec.meta.factSelector,
      facts: ingested.facts,
    }),
  );
  const formData = buildFormData({
    groupbyRows: [METRICS_PLACEHOLDER, 'order_date'],
    groupbyColumns: [],
    metrics: ['sales'],
    metricsLayout: MetricsLayoutEnum.ROWS,
    dateFormatters: {
      order_date: (value: DataRecordValue) =>
        `date:${new Date(Number(value)).getUTCMonth() + 1}`,
    },
  });
  const tree = materializeLoadedPivotTreeFromFactStore({
    store,
    layout: buildLayoutContext(formData),
    formData,
  });
  const projectedDateKey = serializePath([
    encodeMetricKey('sales'),
    '1704067200000',
  ]);

  expect(tree.rows[projectedDateKey]?.formattedLabel).toBe('date:1');
});

test('materializes column subtotal leaves from planned coverage specs', () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|1|scope:France',
    rowDepth: 1,
    colDepth: 1,
    rowGroupby: ['country'],
    colGroupby: ['category', 'subcategory'],
  });
  const store = createPivotFactStore();
  ingestQueryResults({
    specs: [spec],
    results: [
      {
        query_name: spec.queryName,
        data: [{ country: 'France', category: 'Furniture', sales: 12 }],
      },
    ],
  }).forEach(ingested =>
    store.upsertBatch({
      ...ingested.spec.meta.factSelector,
      facts: ingested.facts,
    }),
  );
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

test('materializes full branches after skipped pre-Values metric branches', () => {
  const store = createPivotFactStore();
  const skippedSpec = buildSpec({
    queryName: 'pivot_v3|2|0|scope:urgent-status',
    rowDepth: 2,
    colDepth: 0,
    metrics: ['averageOrderValue', 'weightedDiscount'],
    rowGroupby: ['orderPriority', 'orderStatus'],
    colGroupby: [],
    materialization: {
      valueAxis: 'row',
      valueInsertIndex: 1,
    },
    scope: {
      kind: 'axisPaths',
      axis: 'row',
      paths: [['1-URGENT']],
    },
  });
  const fullSpec = buildSpec({
    queryName: 'pivot_v3|3|0|scope:urgent-full',
    rowDepth: 3,
    colDepth: 0,
    metrics: ['averageOrderValue', 'weightedDiscount'],
    rowGroupby: ['orderPriority', 'shipMode', 'orderStatus'],
    colGroupby: [],
    scope: {
      kind: 'axisPaths',
      axis: 'row',
      paths: [['1-URGENT']],
    },
  });

  ingestQueryResults({
    specs: [skippedSpec, fullSpec],
    results: [
      {
        query_name: skippedSpec.queryName,
        data: [
          {
            orderPriority: '1-URGENT',
            orderStatus: 'F',
            averageOrderValue: 100,
            weightedDiscount: 0.05,
          },
        ],
      },
      {
        query_name: fullSpec.queryName,
        data: [
          {
            orderPriority: '1-URGENT',
            shipMode: 'AIR',
            orderStatus: 'F',
            averageOrderValue: 100,
            weightedDiscount: 0.05,
          },
        ],
      },
    ],
  }).forEach(ingested =>
    store.upsertBatch({
      ...ingested.spec.meta.factSelector,
      facts: ingested.facts,
    }),
  );

  const formData = buildFormData({
    groupbyRows: [
      'orderPriority',
      'shipMode',
      METRICS_PLACEHOLDER,
      'orderStatus',
    ],
    groupbyColumns: [],
    metrics: ['averageOrderValue', 'weightedDiscount'],
    metricsLayout: MetricsLayoutEnum.ROWS,
  });
  const tree = materializeLoadedPivotTreeFromFactStore({
    store,
    layout: buildLayoutContext(formData),
    formData,
  });
  const skippedMetricStatusKey = serializePath([
    '1-URGENT',
    encodeMetricKey('averageOrderValue'),
    'F',
  ]);
  const fullMetricStatusKey = serializePath([
    '1-URGENT',
    'AIR',
    encodeMetricKey('averageOrderValue'),
    'F',
  ]);

  expect(tree.rows[skippedMetricStatusKey]).toBeDefined();
  expect(tree.rows[fullMetricStatusKey]).toBeDefined();
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

  const store = createPivotFactStore();
  const factBatches = await upsertQueryResultsIntoFactStoreAsync({
    store,
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
    chunkSize: 1,
    yieldToMain,
  });
  const tree = await materializeLoadedPivotTreeFromFactStoreAsync({
    store,
    layout: buildLayoutContext(formData),
    formData,
    chunkSize: 1,
    yieldToMain,
  });

  const rowKey = serializePath(['France', encodeMetricKey('sales')]);
  const colKey = serializePath(['2026-01']);
  expect(factBatches).toHaveLength(1);
  expect(factBatches[0].facts).toHaveLength(2);
  expect(tree.cells[serializeCellKey(rowKey, colKey)]?.values).toEqual(
    expect.objectContaining({ sales: 12 }),
  );
  expect(yieldToMain.mock.calls.length).toBeGreaterThan(3);
});

test('chunked fact-store ingestion aborts stale work before commit', async () => {
  const spec = buildSpec({
    queryName: 'pivot_v3|1|1',
    rowDepth: 1,
    colDepth: 1,
    rowGroupby: ['country'],
    colGroupby: ['month'],
  });
  let current = true;
  const yieldToMain = jest.fn(async () => {
    current = false;
  });
  const store = createPivotFactStore();

  await expect(
    upsertQueryResultsIntoFactStoreAsync({
      store,
      specs: [spec],
      results: [
        {
          query_name: spec.queryName,
          data: [{ country: 'France', month: '2026-01', sales: 12 }],
        },
      ],
      chunkSize: 1,
      shouldContinue: () => current,
      yieldToMain,
    }),
  ).rejects.toMatchObject({ name: 'StaleChunkedWorkError' });
  expect(yieldToMain).toHaveBeenCalled();
});
