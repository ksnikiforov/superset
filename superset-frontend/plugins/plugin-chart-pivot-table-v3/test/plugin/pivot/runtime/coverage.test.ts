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
import { serializePath } from '../../../../src/pivot/core/path';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import {
  buildBranchFactCoverages,
  createExpansionCoverageDiff,
  buildFactCoverage,
  diffCoverageManifest,
  type PivotCoverageNeed,
} from '../../../../src/pivot/runtime/coverage';
import { type PivotFactSelector } from '../../../../src/pivot/runtime/factStore';
import { resolveAxisProjection } from '../../../../src/pivot/runtime/projection';
import { MetricsLayoutEnum } from '../../../../src/types';

describe('expansion fact coverage', () => {
  it('derives loaded expansion coverage from typed fact selectors', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', 'city'],
      groupbyColumns: ['year', 'quarter', 'month', 'day'],
      metrics: ['sales'],
    });
    const getMissingExpansionCoverage = createExpansionCoverageDiff({
      factSelectors: [
        {
          coverage: {
            rowDepth: 2,
            columnDepth: 1,
            rowDimensions: ['country', 'city'],
            columnDimensions: ['year'],
          },
          scope: {
            kind: 'branch',
            axis: 'row',
            path: ['France'],
          },
          valueKeys: ['sales'],
        },
        {
          coverage: {
            rowDepth: 2,
            columnDepth: 3,
            rowDimensions: ['country', 'city'],
            columnDimensions: ['year', 'quarter', 'month'],
          },
          scope: {
            kind: 'branch',
            axis: 'row',
            path: ['France'],
          },
          valueKeys: ['sales'],
        },
      ],
      program,
      valueKeys: ['sales'],
    });

    expect(
      getMissingExpansionCoverage([
        {
          axis: 'row',
          pathKey: serializePath(['France']),
          rowDepth: 2,
          columnDepth: 1,
        },
      ]),
    ).toEqual([]);
    expect(
      getMissingExpansionCoverage([
        {
          axis: 'row',
          pathKey: serializePath(['France']),
          rowDepth: 2,
          columnDepth: 4,
        },
      ]),
    ).toEqual([
      {
        axis: 'row',
        pathKey: serializePath(['France']),
        rowDepth: 2,
        columnDepth: 4,
      },
    ]);
    expect(
      getMissingExpansionCoverage([
        {
          axis: 'col',
          pathKey: serializePath(['France']),
          rowDepth: 1,
          columnDepth: 1,
        },
      ]),
    ).toEqual([
      {
        axis: 'col',
        pathKey: serializePath(['France']),
        rowDepth: 1,
        columnDepth: 1,
      },
    ]);
  });
});

describe('coverage manifest diff', () => {
  const need = (
    rowScope: PivotCoverageNeed['rowScope'],
    columnScope: PivotCoverageNeed['columnScope'],
  ): PivotCoverageNeed => ({
    rowDepth: 2,
    columnDepth: 2,
    rowDimensions: ['country', 'city'],
    columnDimensions: ['year', 'quarter'],
    valueKeys: ['sales'],
    rowScope,
    columnScope,
  });

  const batch = (
    scope: PivotFactSelector['scope'],
    rowDepth = 2,
    columnDepth = 2,
  ): PivotFactSelector => ({
    coverage: buildFactCoverage({
      rowDimensions: ['country', 'city'],
      columnDimensions: ['year', 'quarter'],
      rowDepth,
      columnDepth,
    }),
    scope,
    valueKeys: ['sales'],
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
        factSelectors: [
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
        factSelectors: [
          batch({ kind: 'branch', axis: 'row', path: ['Germany'] }),
        ],
      }),
    ).toEqual(required);
  });

  it('lets exact-depth root coverage satisfy narrower explicit path needs', () => {
    const required = [
      need(
        { kind: 'paths', paths: [['Germany']] },
        { kind: 'paths', paths: [[2024]] },
      ),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [batch({ kind: 'root' })],
      }),
    ).toEqual([]);
  });

  it('does not let shallower root coverage satisfy deeper explicit path needs', () => {
    const required = [
      need(
        { kind: 'paths', paths: [['Germany']] },
        { kind: 'paths', paths: [[2024]] },
      ),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [batch({ kind: 'root' }, 1, 1)],
      }),
    ).toEqual(required);
  });

  it('treats scoped full expansion as bounded to the concrete ancestor path', () => {
    const required = [
      need({ kind: 'scopedFull', ancestorPaths: [['USA']] }, { kind: 'root' }),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [batch({ kind: 'branch', axis: 'row', path: ['USA'] })],
      }),
    ).toEqual([]);
    expect(
      diffCoverageManifest({
        required,
        factSelectors: [
          batch({ kind: 'branch', axis: 'row', path: ['Canada'] }),
        ],
      }),
    ).toEqual(required);
  });

  it('does not let a narrower descendant branch satisfy scoped full ancestor coverage', () => {
    const required = [
      need({ kind: 'scopedFull', ancestorPaths: [['USA']] }, { kind: 'root' }),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [
          batch({ kind: 'branch', axis: 'row', path: ['USA', 'California'] }),
        ],
      }),
    ).toEqual(required);
  });

  it('lets broader scoped coverage satisfy a narrower scoped full descendant', () => {
    const required = [
      need(
        { kind: 'scopedFull', ancestorPaths: [['USA', 'California']] },
        { kind: 'root' },
      ),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [batch({ kind: 'branch', axis: 'row', path: ['USA'] })],
      }),
    ).toEqual([]);
  });

  it('lets a batched scoped parent satisfy narrower scoped full descendants', () => {
    const required = [
      need(
        {
          kind: 'scopedFull',
          ancestorPaths: [
            ['USA', 'California'],
            ['Canada', 'Ontario'],
          ],
        },
        { kind: 'root' },
      ),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [
          batch({
            kind: 'batch',
            axis: 'row',
            parentPath: [],
            siblingValues: ['USA', 'Canada'],
          }),
        ],
      }),
    ).toEqual([]);
  });

  it('lets separate exact branch batches satisfy a path-set request', () => {
    const required = [
      need({ kind: 'paths', paths: [['USA'], ['Canada']] }, { kind: 'root' }),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [
          batch({ kind: 'branch', axis: 'row', path: ['USA'] }),
          batch({ kind: 'branch', axis: 'row', path: ['Canada'] }),
        ],
      }),
    ).toEqual([]);
  });

  it('does not let deeper aggregate coverage satisfy a shallower scoped request', () => {
    const required = [
      need({ kind: 'paths', paths: [['USA']] }, { kind: 'root' }),
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [
          {
            coverage: {
              rowDepth: 3,
              columnDepth: 2,
              rowDimensions: ['country', 'city', 'store'],
              columnDimensions: ['year', 'quarter'],
            },
            scope: { kind: 'branch', axis: 'row', path: ['USA'] },
            valueKeys: ['sales'],
          },
        ],
      }),
    ).toEqual(required);
  });

  it('supports consecutive scoped full expansion through the same ancestor scope', () => {
    const required = [
      {
        ...need(
          { kind: 'scopedFull', ancestorPaths: [['USA']] },
          { kind: 'root' },
        ),
        rowDepth: 4,
        rowDimensions: ['country', 'state', 'city', 'store'],
      },
    ];

    expect(
      diffCoverageManifest({
        required,
        factSelectors: [
          {
            coverage: buildFactCoverage({
              rowDimensions: ['country', 'state', 'city', 'store'],
              columnDimensions: ['year', 'quarter'],
              rowDepth: 4,
              columnDepth: 2,
            }),
            scope: { kind: 'branch', axis: 'row', path: ['USA'] },
            valueKeys: ['sales'],
          },
        ],
      }),
    ).toEqual([]);
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
