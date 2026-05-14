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
import { type QueryFormColumn } from '@superset-ui/core';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
} from '../../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import {
  buildBranchFactCoverages,
  buildFactCoverage,
  buildRuntimeLayoutCoverageManifest,
  buildVisibleFactCoverage,
  diffCoverageManifest,
  factBatchesCoverRuntimeLayout,
  type PivotCoverageNeed,
  shouldFetchRuntimeLayout,
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

  it('requires explicit root coverage for layouts without dimensions', () => {
    expect(
      factBatchesCoverRuntimeLayout([], {
        ...runtimeLayout,
        rows: [],
        cols: [],
      }),
    ).toBe(false);
    expect(
      factBatchesCoverRuntimeLayout([factBatch(0, 0)], {
        ...runtimeLayout,
        rows: [],
        cols: [],
      }),
    ).toBe(true);
  });

  it('rejects depth-matching coverage for a different leading dimension', () => {
    const batch: PivotFactStoreBatch = {
      coverage: buildFactCoverage({
        reason: 'initial',
        rowDimensions: ['otherRow'],
        columnDimensions: ['col1'],
        rowDepth: 1,
        columnDepth: 1,
      }),
      scope: { kind: 'bootstrap' },
      facts: [],
    };

    expect(factBatchesCoverRuntimeLayout([batch], runtimeLayout)).toBe(false);
  });

  it('matches object coverage dimensions by stable runtime key', () => {
    const rowDimension: QueryFormColumn = {
      sqlExpression: 'row1',
      label: 'Row',
      expressionType: 'SQL',
    };
    const batch: PivotFactStoreBatch = {
      coverage: buildFactCoverage({
        reason: 'initial',
        rowDimensions: [rowDimension],
        columnDimensions: ['col1'],
        rowDepth: 1,
        columnDepth: 1,
      }),
      scope: { kind: 'bootstrap' },
      facts: [],
    };

    expect(factBatchesCoverRuntimeLayout([batch], runtimeLayout)).toBe(true);
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

  it('accepts metric-root branch coverage for the active runtime layout', () => {
    expect(
      factBatchesCoverRuntimeLayout(
        [
          factBatch(1, 1, {
            kind: 'branch',
            axis: 'col',
            path: [encodeMetricKey('m1')],
          }),
        ],
        runtimeLayout,
      ),
    ).toBe(true);
  });

  it('does not fetch for same-root-depth layout changes with stale committed coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 0)],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          rows: ['row1', 'row2'],
        },
      }),
    ).toBe(false);
  });

  it('fetches when a root-depth change requires missing committed coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 0)],
        previousLayout: {
          ...runtimeLayout,
          cols: [],
        },
        nextLayout: {
          ...runtimeLayout,
          rows: [],
          cols: [],
        },
      }),
    ).toBe(true);
  });

  it('fetches when the root coverage dimensions change and coverage is missing', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 1)],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          rows: ['row2', 'row1'],
        },
      }),
    ).toBe(true);
  });

  it('does not fetch when changed root coverage is already loaded', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [
          {
            coverage: buildFactCoverage({
              reason: 'initial',
              rowDimensions: ['row2'],
              columnDimensions: ['col1'],
              rowDepth: 1,
              columnDepth: 1,
            }),
            scope: { kind: 'bootstrap' },
            facts: [],
          },
        ],
        previousLayout: runtimeLayout,
        nextLayout: {
          ...runtimeLayout,
          rows: ['row2', 'row1'],
        },
      }),
    ).toBe(false);
  });

  it('fetches when trimming dimensions requires missing exact coverage', () => {
    expect(
      shouldFetchRuntimeLayout({
        factBatches: [factBatch(1, 2)],
        previousLayout: {
          ...runtimeLayout,
          cols: ['col1', 'col2'],
        },
        nextLayout: runtimeLayout,
      }),
    ).toBe(true);
  });
});

describe('coverage manifest diff', () => {
  const need = (
    rowScope: PivotCoverageNeed['rowScope'],
    columnScope: PivotCoverageNeed['columnScope'],
  ): PivotCoverageNeed => ({
    reason: 'intersection',
    rowDepth: 2,
    columnDepth: 2,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['year', 'quarter'],
    rowScope,
    columnScope,
  });

  const batch = (
    scope: PivotFactStoreBatch['scope'],
    rowDepth = 2,
    columnDepth = 2,
  ): PivotFactStoreBatch => ({
    coverage: buildFactCoverage({
      reason: 'expand',
      rowDimensions: ['country', 'city'],
      columnDimensions: ['year', 'quarter'],
      rowDepth,
      columnDepth,
    }),
    scope,
    facts: [],
  });

  it('builds root runtime coverage without hidden deeper dimensions', () => {
    expect(
      buildRuntimeLayoutCoverageManifest({
        version: 1,
        rows: ['country', 'city'],
        cols: ['year', 'quarter'],
        metrics: ['sales'],
        leafSelection: {},
        valuePlacement: { axis: 'col', index: 2 },
      }),
    ).toEqual([
      {
        reason: 'root',
        rowDepth: 1,
        columnDepth: 1,
        rowDimensions: ['country'],
        columnDimensions: ['year'],
        rowScope: { kind: 'root' },
        columnScope: { kind: 'root' },
      },
    ]);
  });

  it('does not require coverage when no metrics are selected', () => {
    expect(
      buildRuntimeLayoutCoverageManifest({
        version: 1,
        rows: ['country'],
        cols: ['year'],
        metrics: [],
        leafSelection: {},
        valuePlacement: { axis: 'col', index: 1 },
      }),
    ).toEqual([]);
  });

  it('treats explicit path sets as bounded coverage needs', () => {
    const required = [
      need(
        { kind: 'paths', paths: [['Germany'], ['France']] },
        { kind: 'paths', paths: [[2024], [2025]] },
      ),
    ];

    expect(
      diffCoverageManifest({
        required,
        factBatches: [
          batch({
            kind: 'batch',
            axis: 'row',
            parentPath: [],
            siblingValues: ['Germany', 'France'],
          }),
        ],
      }),
    ).toEqual([]);
  });

  it('does not treat one explicit branch as covering a sibling path set', () => {
    const required = [
      need(
        { kind: 'paths', paths: [['Germany'], ['France']] },
        { kind: 'paths', paths: [[2024], [2025]] },
      ),
    ];

    expect(
      diffCoverageManifest({
        required,
        factBatches: [
          batch({ kind: 'branch', axis: 'row', path: ['Germany'] }),
        ],
      }),
    ).toEqual(required);
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
