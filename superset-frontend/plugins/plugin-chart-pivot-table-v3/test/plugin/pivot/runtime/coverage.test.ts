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
  encodeMetricKey,
  METRICS_PLACEHOLDER,
} from '../../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import {
  buildBranchFactCoverages,
  buildExpansionFactCoverage,
  buildFactCoverage,
  buildVisibleFactCoverage,
  factBatchesCoverRuntimeLayout,
} from '../../../../src/pivot/runtime/coverage';
import { type PivotFactStoreBatch } from '../../../../src/pivot/runtime/factStore';
import { resolveAxisProjection } from '../../../../src/pivot/runtime/projection';
import { MetricsLayoutEnum, PivotRuntimeLayout } from '../../../../src/types';

describe('visible fact coverage', () => {
  it('does not request coverage for a non-only hidden row layer', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', 'state'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildVisibleFactCoverage({
      program,
      rowDepth: 1,
      columnDepth: 0,
      reason: 'layout',
    });

    expect(coverage).toEqual([
      {
        reason: 'layout',
        rowDepth: 1,
        columnDepth: 0,
        rowDimensions: ['country'],
        columnDimensions: [],
      },
    ]);
  });

  it('does not request coverage for a non-only hidden column layer', () => {
    const program = compilePivotProgram({
      groupbyColumns: ['category', 'subcategory'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    const coverage = buildVisibleFactCoverage({
      program,
      rowDepth: 0,
      columnDepth: 1,
      reason: 'layout',
    });

    expect(coverage[0].columnDimensions).toEqual(['category']);
    expect(coverage[0].columnDepth).toBe(1);
  });

  it('may request coverage for the first and only visible row layer', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildVisibleFactCoverage({
      program,
      rowDepth: 1,
      columnDepth: 0,
    });

    expect(coverage[0].rowDimensions).toEqual(['country']);
  });

  it('does not request DB coverage when expansion only reveals Values', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildExpansionFactCoverage({
      program,
      axis: 'row',
      expandedAxisLevelIndex: 0,
      currentRowDepth: 1,
      currentColumnDepth: 0,
    });

    expect(coverage).toEqual([]);
  });

  it('requests only the newly visible dimension after Values expansion', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const coverage = buildExpansionFactCoverage({
      program,
      axis: 'row',
      expandedAxisLevelIndex: 1,
      currentRowDepth: 1,
      currentColumnDepth: 0,
    });

    expect(coverage).toEqual([
      {
        reason: 'expand',
        rowDepth: 2,
        columnDepth: 0,
        rowDimensions: ['country', 'state'],
        columnDimensions: [],
      },
    ]);
  });

  it('does not request DB coverage when root expansion reveals Values first', () => {
    const program = compilePivotProgram({
      groupbyColumns: [METRICS_PLACEHOLDER, 'month'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    const coverage = buildExpansionFactCoverage({
      program,
      axis: 'col',
      expandedAxisLevelIndex: -1,
      currentRowDepth: 0,
      currentColumnDepth: 0,
    });

    expect(coverage).toEqual([]);
  });
});

describe('runtime layout fact coverage', () => {
  const runtimeLayout: PivotRuntimeLayout = {
    version: 1,
    rows: ['row1'],
    cols: ['col1'],
    metrics: ['m1'],
    leafSelection: {},
    valuePlacement: { axis: 'col', index: 0 },
  };

  const factBatch = (
    rowDepth: number,
    columnDepth: number,
    scope: PivotFactStoreBatch['scope'] = { kind: 'bootstrap' },
  ): PivotFactStoreBatch => ({
    coverage: buildFactCoverage({
      reason: 'initial',
      rowDimensions: ['row1', 'row2'].slice(0, Math.max(rowDepth, 1)),
      columnDimensions: ['col1', 'col2'].slice(0, Math.max(columnDepth, 1)),
      rowDepth,
      columnDepth,
    }),
    scope,
    facts: [],
  });

  it('detects missing fact coverage when active runtime layout requires a column dimension', () => {
    expect(
      factBatchesCoverRuntimeLayout([factBatch(1, 0)], runtimeLayout),
    ).toBe(false);
  });

  it('accepts exact bootstrap fact coverage for the active runtime layout', () => {
    expect(
      factBatchesCoverRuntimeLayout([factBatch(1, 1)], runtimeLayout),
    ).toBe(true);
  });

  it('does not treat deeper fact coverage as root runtime-layout coverage', () => {
    expect(
      factBatchesCoverRuntimeLayout([factBatch(2, 1)], runtimeLayout),
    ).toBe(false);
  });

  it('ignores branch coverage when checking root runtime-layout coverage', () => {
    expect(
      factBatchesCoverRuntimeLayout(
        [factBatch(1, 1, { kind: 'branch', axis: 'row', path: ['A'] })],
        runtimeLayout,
      ),
    ).toBe(false);
  });
});

describe('branch fact coverage', () => {
  it.each([
    ['row', MetricsLayoutEnum.ROWS],
    ['col', MetricsLayoutEnum.COLUMNS],
  ] as const)(
    'uses the %s projection filter depth instead of the raw Values path length',
    (axis, metricsLayout) => {
      const program = compilePivotProgram({
        [axis === 'row' ? 'groupbyRows' : 'groupbyColumns']: [
          'country',
          'state',
          METRICS_PLACEHOLDER,
          'city',
        ],
        metrics: ['sales'],
        metricsLayout,
      });
      const projection = resolveAxisProjection({
        program,
        axis,
        path: ['US', encodeMetricKey('sales'), 'Boston'],
      });

      const coverage = buildBranchFactCoverages({
        program,
        axis,
        projection,
        rowDepth: axis === 'row' ? 2 : 0,
        columnDepth: axis === 'col' ? 2 : 0,
        rowSubtotalLevels: [],
        columnSubtotalLevels: [],
      });

      expect(projection.filterDimensionPath).toEqual(['US']);
      expect(projection.projectedDimensionPath).toEqual(['US', 'Boston']);
      expect(
        projection.skippedPreValuesLevels.map(level => level.column),
      ).toEqual(['state']);
      expect(
        coverage.every(item =>
          axis === 'row' ? item.rowDepth >= 1 : item.columnDepth >= 1,
        ),
      ).toBe(true);
      expect(coverage).toEqual(
        expect.arrayContaining([
          {
            reason: 'expand',
            rowDepth: axis === 'row' ? 2 : 0,
            columnDepth: axis === 'col' ? 2 : 0,
            rowDimensions: axis === 'row' ? ['country', 'state'] : [],
            columnDimensions: axis === 'col' ? ['country', 'state'] : [],
          },
        ]),
      );
      expect(coverage).not.toEqual(
        expect.arrayContaining([
          {
            reason: 'expand',
            rowDepth: 0,
            columnDepth: 0,
            rowDimensions: [],
            columnDimensions: [],
          },
        ]),
      );
    },
  );
});
