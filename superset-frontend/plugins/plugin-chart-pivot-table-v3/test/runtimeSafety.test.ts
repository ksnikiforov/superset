/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership. The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import {
  parsePath,
  serializePath,
  serializeCellKey,
} from '../src/pivot/core/path';
import {
  createPivotFactStoreFromBatches,
  buildPivotFactQueryContextKey,
} from '../src/pivot/runtime/factStore';
import { materializeLoadedPivotTreeFromFactStore } from '../src/pivot/runtime/materializePivotTree';
import { buildLayoutContext } from '../src/pivot/layout/LayoutContext';
import { compilePivotProgram } from '../src/pivot/runtime/compilePivotProgram';
import { getNodeDimDepth } from '../src/pivot/metricsTotals';
import { buildPivotV3RowExportModel } from '../src/export/buildPivotV3ExportTable';
import { validateExcelFormula } from '../src/pivot/formatting/excelFormula';
import { encodeMetricKey, METRICS_PLACEHOLDER } from '../src/pivot/core/tokens';
import {
  MetricsLayoutEnum,
  type PivotTreeNode,
  type PivotPath,
} from '../src/types';
import { buildFormData } from './plugin/fixtures/pivotFormData';
import { buildPathFilters } from '../src/pivot/query/pathFilters';
import { SupersetClient } from '@superset-ui/core';
import { SupersetChartDataClient } from '../src/pivot/data/SupersetChartDataClient';

const materializeRows = (paths: PivotPath[]) => {
  const formData = buildFormData({
    groupbyRows: ['region'],
    groupbyColumns: [],
    metrics: ['sales'],
    metricsLayout: MetricsLayoutEnum.COLUMNS,
  });
  const store = createPivotFactStoreFromBatches([
    {
      coverage: {
        rowDepth: 1,
        columnDepth: 0,
        rowDimensions: ['region'],
        columnDimensions: [],
      },
      scope: { kind: 'root' },
      valueKeys: ['sales'],
      queryContextKey: buildPivotFactQueryContextKey(formData),
      facts: paths.map((rowPath, i) => ({
        rowPath,
        columnPath: [],
        valueKey: 'sales',
        value: i + 10,
      })),
    },
  ]);
  return materializeLoadedPivotTreeFromFactStore({
    store,
    formData,
    layout: buildLayoutContext(formData),
  });
};

test('empty category must be distinct from root', () => {
  expect(serializePath([''])).not.toBe(serializePath([]));
});
test('literal null sentinel must be distinct from null', () => {
  expect(serializePath(['__NULL__'])).not.toBe(serializePath([null]));
});
test('embedded cell delimiter must preserve row/column identity', () => {
  expect(serializeCellKey('A\u0001B', 'C')).not.toBe(
    serializeCellKey('A', 'B\u0001C'),
  );
});
test('path boundaries must round-trip empty values', () => {
  expect(parsePath(serializePath(['A', '', 'B']))).toEqual(['A', '', 'B']);
});
test('separate null categories must survive actual materialization', () => {
  const tree = materializeRows([[null], ['__NULL__']]);
  expect(
    Object.values(tree.rows).filter(node => node.path.length > 0),
  ).toHaveLength(2);
});
test('ordinary category must not mutate Object.prototype', () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'values');
  let polluted = false;
  try {
    try {
      materializeRows([['__proto__']]);
    } catch {
      /* inspect pollution even if projection crashes */
    }
    polluted = Object.prototype.hasOwnProperty.call(Object.prototype, 'values');
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'values', previous);
    else Reflect.deleteProperty(Object.prototype, 'values');
  }
  expect(polluted).toBe(false);
});
test('metric row export must retain dimension label', () => {
  const program = compilePivotProgram({
    groupbyRows: ['region', METRICS_PLACEHOLDER],
    metrics: ['sales', 'profit'],
    metricsLayout: MetricsLayoutEnum.ROWS,
  });
  const node = (path: string[], label: string): PivotTreeNode => ({
    axis: 'row',
    key: serializePath(path),
    path,
    label,
    formattedLabel: label,
    level: path.length,
    hasChildren: false,
  });
  const west = node(['West'], 'West');
  const sales = node(['West', encodeMetricKey('sales')], 'sales');
  const model = buildPivotV3RowExportModel({
    visibleRows: [west, sales],
    rowAxisLabels: ['Region'],
    rowTotalLabel: 'Total',
    getNodeDimDepth: n =>
      getNodeDimDepth(n, {
        program,
        metricLabelSet: new Set(program.metricKeys),
        isLeafTierVisible: false,
      }),
    formatLabel: n => n.formattedLabel,
    isGrandTotalLikeRow: () => false,
    isRowAggregateBold: () => false,
  });
  expect(model.rowExportRows.get(sales.key)?.values).toEqual(['West', 'sales']);
});
test('syntactically valid reciprocal formula must be accepted', () => {
  expect(validateExcelFormula('=1/value').valid).toBe(true);
});
test('actual rejected HTTP 413 must split query bundles', async () => {
  const post = jest
    .spyOn(SupersetClient, 'post')
    .mockRejectedValueOnce({ status: 413 });
  try {
    await new SupersetChartDataClient()
      .fetch({
        formData: buildFormData({}),
        specs: ['one', 'two'].map(queryName => ({
          queryName,
          columns: ['r1'],
          metrics: ['sales'],
          filters: [],
        })),
      })
      .catch(() => undefined);
    expect(post.mock.calls.length).toBeGreaterThan(1);
  } finally {
    post.mockRestore();
  }
});
test('old request cleanup must not remove replacement controller', async () => {
  let rejectFirst!: (reason: unknown) => void;
  let rejectSecond!: (reason: unknown) => void;
  const signals: (AbortSignal | undefined)[] = [];
  const post = jest
    .spyOn(SupersetClient, 'post')
    .mockImplementationOnce(params => {
      signals.push(params.signal ?? undefined);
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    })
    .mockImplementationOnce(params => {
      signals.push(params.signal ?? undefined);
      return new Promise((_resolve, reject) => {
        rejectSecond = reject;
      });
    });
  const client = new SupersetChartDataClient();
  const params = {
    formData: buildFormData({}),
    requestGroupId: 'same-group',
    specs: [
      { queryName: 'one', columns: ['r1'], metrics: ['sales'], filters: [] },
    ],
  };
  try {
    const first = client.fetch(params).catch(() => undefined);
    const second = client.fetch(params).catch(() => undefined);
    expect(signals[0]?.aborted).toBe(true);
    rejectFirst({ name: 'AbortError' });
    await first;
    client.cancel('same-group');
    const secondAborted = signals[1]?.aborted;
    rejectSecond({ name: 'AbortError' });
    await second;
    expect(secondAborted).toBe(true);
  } finally {
    post.mockRestore();
  }
});

test('formula validation checks syntax without evaluating data-dependent arithmetic', () => {
  expect(validateExcelFormula('=1/[sales]').valid).toBe(true);
  expect(validateExcelFormula('=1/(value-1)').valid).toBe(true);
  expect(validateExcelFormula('=SUM(').valid).toBe(false);
  expect(validateExcelFormula('=SUM(A1:XFD1048576)').valid).toBe(false);
  expect(validateExcelFormula(`=${'1+'.repeat(4096)}1`).valid).toBe(false);
});

test('adhoc branch filters preserve the SQL expression rather than its display label', () => {
  const column = {
    expressionType: 'SQL' as const,
    sqlExpression: 'UPPER(region)',
    label: 'Region',
    columnType: 'BASE_AXIS' as const,
  };
  expect(buildPathFilters([column], ['WEST'])).toEqual([
    { col: column, op: '==', val: 'WEST' },
  ]);
  expect(buildPathFilters([column], [null])).toEqual([
    { col: column, op: 'IS NULL' },
  ]);
});

test('metric-only row export retains a metric tier without dimension labels', () => {
  const program = compilePivotProgram({
    groupbyRows: [METRICS_PLACEHOLDER],
    metrics: ['sales', 'profit'],
    metricsLayout: MetricsLayoutEnum.ROWS,
  });
  const row: PivotTreeNode = {
    axis: 'row',
    key: serializePath([encodeMetricKey('sales')]),
    path: [encodeMetricKey('sales')],
    label: 'Sales',
    formattedLabel: 'Sales',
    level: 1,
    hasChildren: false,
  };
  const model = buildPivotV3RowExportModel({
    visibleRows: [row],
    rowAxisLabels: [],
    rowTotalLabel: 'Total',
    getNodeDimDepth: n =>
      getNodeDimDepth(n, {
        program,
        metricLabelSet: new Set(program.metricKeys),
        isLeafTierVisible: false,
      }),
    formatLabel: n => n.formattedLabel,
    isGrandTotalLikeRow: () => false,
    isRowAggregateBold: () => false,
  });
  expect(model.rowExportDepthCount).toBe(1);
  expect(model.rowExportRows.get(row.key)?.values).toEqual(['Sales']);
});
