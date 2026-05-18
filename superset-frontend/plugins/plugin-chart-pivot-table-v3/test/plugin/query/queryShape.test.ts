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
  buildQueryShape,
  type QueryIntent,
} from '../../../src/pivot/query/queryShape';

describe('queryShape', () => {
  const baseIntent: QueryIntent = {
    targetRowDepth: 1,
    targetColDepth: 1,
    needsValueCells: true,
    needsTotals: false,
    needsMetricFormatting: false,
    needsDatabars: false,
    needsRowOrdering: false,
    needsColOrdering: false,
    needsRowDimensionFormatting: false,
    needsColDimensionFormatting: false,
  };

  it('slices groupby columns based on the intent depths', () => {
    const shape = buildQueryShape({
      intent: { ...baseIntent, targetRowDepth: 1, targetColDepth: 2 },
      rowGroupby: ['r1', 'r2'],
      colGroupby: ['c1', 'c2', 'c3'],
      metrics: ['m1'],
    });

    expect(shape.rowGroupby).toEqual(['r1']);
    expect(shape.colGroupby).toEqual(['c1', 'c2']);
  });

  it('excludes formatting metrics when intent does not need value cells', () => {
    const shape = buildQueryShape({
      intent: {
        ...baseIntent,
        needsValueCells: false,
        needsTotals: true,
        needsMetricFormatting: true,
        needsDatabars: true,
      },
      metrics: ['m1'],
      rowGroupby: ['r1'],
      colGroupby: [],
      metricFormattingScope: 'values',
      metricFormatting: {
        m1: { backgroundColor: 'm2' },
      },
      metricDatabars: {
        m1: { type: 'bar', colorMode: 'byMetric', colorMetric: 'm3' },
      },
    });

    expect(shape.metrics).toEqual(['m1']);
  });

  it('includes formatting metrics when intent needs value cells', () => {
    const shape = buildQueryShape({
      intent: {
        ...baseIntent,
        needsMetricFormatting: true,
        needsDatabars: true,
      },
      metrics: ['m1'],
      rowGroupby: ['r1'],
      colGroupby: [],
      metricFormattingScope: 'values',
      metricFormatting: {
        m1: { backgroundColor: 'm2' },
      },
      metricDatabars: {
        m1: { type: 'bar', colorMode: 'byMetric', colorMetric: 'm3' },
      },
    });

    expect(shape.metrics).toEqual(['m1', 'm2', 'm3']);
  });

  it('includes sorting metrics only when ordering is required', () => {
    const shape = buildQueryShape({
      intent: {
        ...baseIntent,
        needsRowOrdering: true,
      },
      metrics: ['m1'],
      rowGroupby: ['r1'],
      colGroupby: [],
      rowSorting: {
        r1: { metric: 'm4', mode: 'axis_value' },
      },
    });

    expect(shape.metrics).toEqual(['m1', 'm4']);
  });

  it('keeps metric unions deterministic and de-duplicated', () => {
    const shape = buildQueryShape({
      intent: {
        ...baseIntent,
        needsMetricFormatting: true,
        needsRowOrdering: true,
      },
      metrics: ['m1'],
      rowGroupby: ['r1'],
      colGroupby: [],
      metricFormattingScope: 'values_totals',
      metricFormatting: {
        m1: { backgroundColor: 'm2' },
      },
      rowSorting: {
        r1: { metric: 'm1', mode: 'axis_value' },
      },
    });

    expect(shape.metrics).toEqual(['m1', 'm2']);
  });

  it('resolves support metrics against the full metric set without materializing hidden metric siblings', () => {
    const shape = buildQueryShape({
      intent: {
        ...baseIntent,
        needsMetricFormatting: true,
        needsColOrdering: true,
      },
      metrics: ['m1'],
      availableMetrics: ['m1', 'm2', 'm3', 'm4'],
      rowGroupby: ['r1'],
      colGroupby: ['c1'],
      metricFormattingScope: 'values',
      metricFormatting: {
        m1: { backgroundColor: 'm3' },
        m2: { backgroundColor: 'm4' },
      },
      colSorting: {
        c1: { metric: 'm4', mode: 'axis_value' },
      },
    });

    expect(shape.metrics).toEqual(['m1', 'm3', 'm4']);
  });

  it('resolves support metrics by canonical metric key', () => {
    const supportMetric = {
      expressionType: 'SQL' as const,
      sqlExpression: 'SUM(color_metric)',
      label: 'Color Metric',
      optionName: 'metric_color',
    };
    const shape = buildQueryShape({
      intent: {
        ...baseIntent,
        needsMetricFormatting: true,
      },
      metrics: ['m1'],
      availableMetrics: ['m1', supportMetric],
      rowGroupby: ['r1'],
      colGroupby: [],
      metricFormattingScope: 'values',
      metricFormatting: {
        m1: { backgroundColor: 'metric_color' },
      },
    });

    expect(shape.metrics).toEqual(['m1', supportMetric]);
  });
});
