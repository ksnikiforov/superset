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
  buildBranchTreeFromSpecResults,
  createPivotFactStore,
  ingestQueryResults,
  upsertQueryResultsIntoFactStore,
} from '../../../../src/pivot/runtime/ingestQueryResults';
import {
  MetricsLayoutEnum,
  type MeasureHierarchy,
} from '../../../../src/types';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  serializeCellKey,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../../../src/utils';
import { buildFormData } from '../../fixtures/pivotFormData';

const buildSpec = ({
  queryName,
  rowDepth,
  colDepth,
  metrics = ['sales'],
  materializedMetrics = ['sales'],
  rowGroupby = ['country'],
  colGroupby = ['month'],
  rowSubtotalLevels = [],
  colSubtotalLevels = [],
  metricsLayoutResolved = MetricsLayoutEnum.ROWS,
  metricInsertIndex = 1,
  materializedMeasureHierarchy = {
    kind: 'flatMetrics',
    metricKeys: materializedMetrics,
  },
}: {
  queryName: string;
  rowDepth: number;
  colDepth: number;
  metrics?: string[];
  materializedMetrics?: string[];
  rowGroupby?: string[];
  colGroupby?: string[];
  rowSubtotalLevels?: number[];
  colSubtotalLevels?: number[];
  metricsLayoutResolved?: MetricsLayoutEnum;
  metricInsertIndex?: number;
  materializedMeasureHierarchy?: MeasureHierarchy;
}): PlannedQuerySpec => {
  const withValuesPlaceholder = (columns: string[]) => [
    ...columns.slice(0, metricInsertIndex),
    METRICS_PLACEHOLDER,
    ...columns.slice(metricInsertIndex),
  ];
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
      rowSubtotalLevels,
      colSubtotalLevels,
      materializedMetrics,
      materializedMeasureHierarchy,
      requiredTimeOffsets: [],
      pivotProgram: compilePivotProgram({
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
      }),
      coverage: {
        reason: 'initial',
        rowDepth,
        columnDepth: colDepth,
        rowDimensions: rowGroupby.slice(0, rowDepth),
        columnDimensions: colGroupby.slice(0, colDepth),
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
      role: 'visible',
    },
    {
      rowPath: ['France'],
      columnPath: ['2026-01'],
      valueKey: 'sales',
      value: 12,
      role: 'visible',
    },
  ]);
});

test('can avoid index fallback for partially named branch results', () => {
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
    fallback: 'empty',
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
    materializedMetrics: ['sales'],
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
    fallback: 'empty',
  });

  expect(ingested.facts.map(fact => fact.valueKey)).toEqual([
    'sales',
    'sortMetric',
    'sales__1 year ago',
  ]);

  const tree = buildBranchTreeFromSpecResults({
    specs: [spec],
    results: [result],
    formData: buildFormData({
      metrics: ['sales'],
      metricLabelMap: { sales: 'Sales', sortMetric: 'Sort metric' },
    }),
    measureHierarchy: spec.meta.materializedMeasureHierarchy,
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
    colSubtotalLevels: [1],
  });
  const tree = buildBranchTreeFromSpecResults({
    specs: [spec],
    results: [
      {
        query_name: spec.queryName,
        data: [{ country: 'France', category: 'Furniture', sales: 12 }],
      },
    ],
    formData: buildFormData({
      metrics: ['sales'],
    }),
    measureHierarchy: spec.meta.materializedMeasureHierarchy,
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
