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
import { ingestQueryResults } from '../../../../src/pivot/runtime/ingestQueryResults';
import { MetricsLayoutEnum } from '../../../../src/types';

const buildSpec = ({
  queryName,
  rowDepth,
  colDepth,
}: {
  queryName: string;
  rowDepth: number;
  colDepth: number;
}): PlannedQuerySpec => ({
  queryName,
  columns: ['country', 'month'],
  metrics: ['sales'],
  filters: [],
  meta: {
    kind: 'root',
    rowDepth,
    colDepth,
    rowGroupbyForQueryFull: ['country'],
    colGroupbyForQueryFull: ['month'],
    rowSubtotalLevels: [],
    colSubtotalLevels: [],
    materializedMetrics: ['sales'],
    materializedMeasureHierarchy: {
      kind: 'flatMetrics',
      metricKeys: ['sales'],
    },
    requiredTimeOffsets: [],
    metricsLayoutResolved: MetricsLayoutEnum.ROWS,
    metricInsertIndex: 1,
    coverage: {
      reason: 'initial',
      rowDepth,
      columnDepth: colDepth,
      rowDimensions: rowDepth > 0 ? ['country'] : [],
      columnDimensions: colDepth > 0 ? ['month'] : [],
    },
  },
});

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
      coverage: specs[0].meta.coverage,
      queryName: 'pivot_v3|1|0',
    },
    {
      rowPath: ['France'],
      columnPath: ['2026-01'],
      valueKey: 'sales',
      value: 12,
      coverage: specs[1].meta.coverage,
      queryName: 'pivot_v3|1|1',
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
