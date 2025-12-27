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
  METRICS_PLACEHOLDER,
  normalizeSubtotalLevels,
  resolveMetricPlacement,
  buildTreeFromRecords,
  applyMetricAxis,
} from './utils';
import { MetricsLayoutEnum } from './types';
import { MetricsLayoutEnum } from './types';

describe('applyMetricAxis + buildTreeFromRecords integration', () => {
  it('populates metric cells when metrics are on columns with no column groupby', () => {
    const tree = buildTreeFromRecords(
      [{ priority: '1-URGENT', weightedDiscount: 0.05 }],
      ['weightedDiscount'],
      ['priority'],
      [],
      1,
      0,
    );
    const withMetrics = applyMetricAxis(
      tree,
      ['weightedDiscount'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      [],
      0,
    );
    expect(
      withMetrics.cells['1-URGENT|weightedDiscount']?.values.weightedDiscount,
    ).toBe(0.05);
  });

  it('merges branch data for metrics on columns when expanding column dimension', () => {
    const baseTreeRaw = buildTreeFromRecords(
      [{ priority: '1-URGENT', weightedDiscount: 0.05 }],
      ['weightedDiscount'],
      ['priority'],
      [],
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      baseTreeRaw,
      ['weightedDiscount'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      [],
      0,
    );

    const branchRaw = buildTreeFromRecords(
      [
        {
          priority: '1-URGENT',
          segment: 'Consumer',
          weightedDiscount: 0.05,
        },
      ],
      ['weightedDiscount'],
      ['priority'],
      ['segment'],
      1,
      1,
    );
    const branchWithMetrics = applyMetricAxis(
      branchRaw,
      ['weightedDiscount'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      ['segment'],
      0,
    );

    const merged = mergeTrees(baseTree, branchWithMetrics);
    expect(
      merged.cells['1-URGENT|weightedDiscount__Consumer']?.values
        .weightedDiscount,
    ).toBe(0.05);
  });

  it('populates collapsed column cells when there is a single metric', () => {
    const tree = buildTreeFromRecords(
      [{ priority: '1-URGENT', category: 'AUTO', metric1: 10 }],
      ['metric1'],
      ['priority'],
      ['category'],
      1,
      1,
    );
    const withMetrics = applyMetricAxis(
      tree,
      ['metric1'],
      MetricsLayoutEnum.COLUMNS,
      ['priority'],
      ['category'],
      1,
    );
    expect(
      withMetrics.cells['1-URGENT|AUTO']?.values.metric1,
    ).toBe(10);
  });

  it('populates collapsed row cells when there is a single metric', () => {
    const tree = buildTreeFromRecords(
      [{ priority: '1-URGENT', sub: 'SUB1', metric1: 20 }],
      ['metric1'],
      ['priority', 'sub'],
      [],
      2,
      0,
    );
    const withMetrics = applyMetricAxis(
      tree,
      ['metric1'],
      MetricsLayoutEnum.ROWS,
      ['priority', 'sub'],
      [],
      2,
    );
    expect(withMetrics.cells['1-URGENT__SUB1|']?.values.metric1).toBe(20);
  });
});

describe('resolveMetricPlacement', () => {
  it('dedupes placeholder across axes favoring last moved', () => {
    const resolved = resolveMetricPlacement(
      ['region', METRICS_PLACEHOLDER],
      [METRICS_PLACEHOLDER],
      { hasMetrics: true, preferredAxis: MetricsLayoutEnum.COLUMNS, lastMoved: 'row' },
    );
    expect(resolved.axis).toEqual('row');
    expect(resolved.rows).toEqual(['region', METRICS_PLACEHOLDER]);
    expect(resolved.cols).toEqual([]);
    expect(resolved.layout).toEqual(MetricsLayoutEnum.ROWS);
  });

  it('removes placeholder when metrics are empty', () => {
    const resolved = resolveMetricPlacement(
      ['country', METRICS_PLACEHOLDER],
      [],
      { hasMetrics: false, preferredAxis: MetricsLayoutEnum.COLUMNS },
    );
    expect(resolved.rows).toEqual(['country']);
    expect(resolved.cols).toEqual([]);
    expect(resolved.metricPosition).toBe(-1);
  });

  it('auto-inserts placeholder on preferred axis when missing', () => {
    const resolved = resolveMetricPlacement(
      ['country'],
      ['segment'],
      { hasMetrics: true, preferredAxis: MetricsLayoutEnum.COLUMNS },
    );
    expect(resolved.axis).toEqual('col');
    expect(resolved.cols).toEqual(['segment', METRICS_PLACEHOLDER]);
    expect(resolved.layout).toEqual(MetricsLayoutEnum.COLUMNS);
    expect(resolved.metricPosition).toBe(1);
  });
});

describe('normalizeSubtotalLevels', () => {
  it('applies legacy totals/subtotals flags', () => {
    expect(normalizeSubtotalLevels(undefined, 3, true, true)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('filters out-of-range levels and dedupes', () => {
    expect(normalizeSubtotalLevels([0, 1, 5, 1], 2, false, false)).toEqual([
      0, 1, 2,
    ]);
  });
});
