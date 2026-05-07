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
import { METRICS_PLACEHOLDER } from '../../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import type { PivotAxisProgram } from '../../../../src/pivot/runtime/types';
import { MetricsLayoutEnum } from '../../../../src/types';

const describeAxis = (axis: PivotAxisProgram) =>
  axis.map(level =>
    level.kind === 'values' ? 'values' : `dimension:${level.column}`,
  );

describe('compilePivotProgram', () => {
  it('represents Values first on rows as an axis level', () => {
    const program = compilePivotProgram({
      groupbyRows: [METRICS_PLACEHOLDER, 'r1'],
      groupbyColumns: ['c1'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    expect(describeAxis(program.rows)).toEqual(['values', 'dimension:r1']);
    expect(describeAxis(program.columns)).toEqual(['dimension:c1']);
    expect(program.metricsLayoutResolved).toBe(MetricsLayoutEnum.ROWS);
    expect(program.metricInsertIndex).toBe(0);
  });

  it('represents Values in the middle on rows as an axis level', () => {
    const program = compilePivotProgram({
      groupbyRows: ['r1', METRICS_PLACEHOLDER, 'r2'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    expect(describeAxis(program.rows)).toEqual([
      'dimension:r1',
      'values',
      'dimension:r2',
    ]);
    expect(program.rowDimensions).toEqual(['r1', 'r2']);
    expect(program.metricInsertIndex).toBe(1);
  });

  it('represents Values last on rows as an axis level', () => {
    const program = compilePivotProgram({
      groupbyRows: ['r1', 'r2', METRICS_PLACEHOLDER],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    expect(describeAxis(program.rows)).toEqual([
      'dimension:r1',
      'dimension:r2',
      'values',
    ]);
    expect(program.metricInsertIndex).toBe(2);
  });

  it('represents Values first on columns as an axis level', () => {
    const program = compilePivotProgram({
      groupbyRows: ['r1'],
      groupbyColumns: [METRICS_PLACEHOLDER, 'c1'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(describeAxis(program.rows)).toEqual(['dimension:r1']);
    expect(describeAxis(program.columns)).toEqual(['values', 'dimension:c1']);
    expect(program.metricsLayoutResolved).toBe(MetricsLayoutEnum.COLUMNS);
    expect(program.metricInsertIndex).toBe(0);
  });

  it('represents Values in the middle on columns as an axis level', () => {
    const program = compilePivotProgram({
      groupbyColumns: ['c1', METRICS_PLACEHOLDER, 'c2'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(describeAxis(program.columns)).toEqual([
      'dimension:c1',
      'values',
      'dimension:c2',
    ]);
    expect(program.columnDimensions).toEqual(['c1', 'c2']);
    expect(program.metricInsertIndex).toBe(1);
  });

  it('represents Values last on columns as an axis level', () => {
    const program = compilePivotProgram({
      groupbyColumns: ['c1', 'c2', METRICS_PLACEHOLDER],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(describeAxis(program.columns)).toEqual([
      'dimension:c1',
      'dimension:c2',
      'values',
    ]);
    expect(program.metricInsertIndex).toBe(2);
  });
});
