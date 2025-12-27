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
import { MetricsLayoutEnum } from './types';
import { METRICS_PLACEHOLDER, resolveMetricPlacement } from './utils';

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
