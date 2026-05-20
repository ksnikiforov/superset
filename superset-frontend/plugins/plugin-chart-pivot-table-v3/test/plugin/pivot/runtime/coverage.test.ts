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
  buildInitialAxisCoverageNeeds,
  buildFactCoverage,
  diffCoverageManifest,
  resolveInitialVisibleAxisDepth,
  type PivotCoverageNeed,
} from '../../../../src/pivot/runtime/coverage';
import {
  buildAxisExpansionCoverageTarget,
  filterMissingExpansionCoverageTargets,
} from '../../../../src/pivot/expansion/planner';
import { type PivotFactSelector } from '../../../../src/pivot/runtime/factStore';
import { resolveAxisProjection } from '../../../../src/pivot/runtime/projection';
import { buildLayoutContext } from '../../../../src/pivot/layout/LayoutContext';
import {
  MetricsLayoutEnum,
  type PivotPath,
  type PivotTableQueryFormData,
} from '../../../../src/types';
import { buildExpansionQuerySpecs } from '../../fixtures/querySpecs';

const axisScope = (
  axis: 'row' | 'col',
  path: PivotPath,
): PivotFactSelector['scope'] => ({
  kind: 'axisPaths',
  axis,
  paths: [path],
});

const scopedFullScope = (
  axis: 'row' | 'col',
  path: PivotPath,
): PivotFactSelector['scope'] => ({
  kind: 'scopedFull',
  axis,
  ancestorPaths: [path],
});

describe('expansion fact coverage', () => {
  it('derives loaded expansion coverage from typed fact selectors', () => {
    const program = compilePivotProgram({
      groupbyRows: ['country', 'city'],
      groupbyColumns: ['year', 'quarter', 'month', 'day'],
      metrics: ['sales'],
    });
    const factSelectors: PivotFactSelector[] = [
      {
        coverage: {
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['country', 'city'],
          columnDimensions: ['year'],
        },
        scope: scopedFullScope('row', ['France']),
        valueKeys: ['sales'],
      },
      {
        coverage: {
          rowDepth: 2,
          columnDepth: 3,
          rowDimensions: ['country', 'city'],
          columnDimensions: ['year', 'quarter', 'month'],
        },
        scope: scopedFullScope('row', ['France']),
        valueKeys: ['sales'],
      },
    ];
    const target = ({
      axis,
      path,
      rowDepth,
      columnDepth,
    }: {
      axis: 'row' | 'col';
      path: string[];
      rowDepth: number;
      columnDepth: number;
    }) =>
      buildAxisExpansionCoverageTarget({
        program,
        axis,
        pathKey: serializePath(path),
        rowDepth,
        columnDepth,
      });

    expect(
      filterMissingExpansionCoverageTargets({
        targets: [
          target({
            axis: 'row',
            path: ['France'],
            rowDepth: 2,
            columnDepth: 1,
          }),
        ],
        factSelectors,
      }),
    ).toEqual([]);
    const missingDeepColumn = filterMissingExpansionCoverageTargets({
      targets: [
        target({
          axis: 'row',
          path: ['France'],
          rowDepth: 2,
          columnDepth: 4,
        }),
      ],
      factSelectors,
    });
    expect(
      missingDeepColumn.map(({ axis, pathKey, need }) => ({
        axis,
        pathKey,
        rowDepth: need.rowDepth,
        columnDepth: need.columnDepth,
      })),
    ).toEqual([
      {
        axis: 'row',
        pathKey: serializePath(['France']),
        rowDepth: 2,
        columnDepth: 4,
      },
    ]);
    const missingColumnBranch = filterMissingExpansionCoverageTargets({
      targets: [
        target({
          axis: 'col',
          path: ['France'],
          rowDepth: 1,
          columnDepth: 1,
        }),
      ],
      factSelectors,
    });
    expect(
      missingColumnBranch.map(({ axis, pathKey, need }) => ({
        axis,
        pathKey,
        rowDepth: need.rowDepth,
        columnDepth: need.columnDepth,
      })),
    ).toEqual([
      {
        axis: 'col',
        pathKey: serializePath(['France']),
        rowDepth: 1,
        columnDepth: 2,
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
            kind: 'axisPaths',
            axis: 'row',
            paths: [['Germany'], ['France']],
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
        factSelectors: [batch(axisScope('row', ['Germany']))],
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
        factSelectors: [batch(scopedFullScope('row', ['USA']))],
      }),
    ).toEqual([]);
    expect(
      diffCoverageManifest({
        required,
        factSelectors: [batch(scopedFullScope('row', ['Canada']))],
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
        factSelectors: [batch(scopedFullScope('row', ['USA', 'California']))],
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
        factSelectors: [batch(scopedFullScope('row', ['USA']))],
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
            kind: 'scopedFull',
            axis: 'row',
            ancestorPaths: [['USA'], ['Canada']],
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
          batch(axisScope('row', ['USA'])),
          batch(axisScope('row', ['Canada'])),
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
            scope: scopedFullScope('row', ['USA']),
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
            scope: scopedFullScope('row', ['USA']),
            valueKeys: ['sales'],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('initial coverage manifest', () => {
  it('normalizes configured visible depths into scoped-full needs', () => {
    expect(
      resolveInitialVisibleAxisDepth({
        configuredDepth: 2.7,
        dimensionCount: 3,
        startCollapsed: true,
        initialDepth: 1,
      }),
    ).toBe(2);
    expect(
      resolveInitialVisibleAxisDepth({
        configuredDepth: -5,
        dimensionCount: 3,
        startCollapsed: true,
        initialDepth: 1,
      }),
    ).toBe(0);
    expect(
      resolveInitialVisibleAxisDepth({
        configuredDepth: 10,
        dimensionCount: 3,
        startCollapsed: true,
        initialDepth: 1,
      }),
    ).toBe(3);
    expect(
      resolveInitialVisibleAxisDepth({
        configuredDepth: undefined,
        dimensionCount: 4,
        startCollapsed: false,
        initialDepth: 1,
      }),
    ).toBe(4);
    expect(
      resolveInitialVisibleAxisDepth({
        configuredDepth: undefined,
        dimensionCount: 4,
        startCollapsed: true,
        initialDepth: 3,
      }),
    ).toBe(2);
    expect(
      buildInitialAxisCoverageNeeds({ rowDepth: 2, columnDepth: 1 }),
    ).toEqual([
      {
        axis: 'row',
        depth: 2,
        scope: { kind: 'scopedFull', ancestorPaths: [[]] },
      },
      {
        axis: 'col',
        depth: 1,
        scope: { kind: 'scopedFull', ancestorPaths: [[]] },
      },
    ]);
  });
});

describe('branch fact coverage', () => {
  it('matches rendered metric-first expansion paths to semantic fact coverage', () => {
    const program = compilePivotProgram({
      groupbyRows: [METRICS_PLACEHOLDER, 'returnFlag', 'orderPriority'],
      groupbyColumns: ['shipMode'],
      metrics: ['averageOrderValue', 'weightedDiscount'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });
    const factSelectors: PivotFactSelector[] = [
      {
        coverage: {
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['returnFlag', 'orderPriority'],
          columnDimensions: ['shipMode'],
        },
        scope: scopedFullScope('row', ['A']),
        valueKeys: ['averageOrderValue'],
      },
    ];

    expect(
      filterMissingExpansionCoverageTargets({
        targets: [
          buildAxisExpansionCoverageTarget({
            program,
            axis: 'row',
            pathKey: serializePath([encodeMetricKey('averageOrderValue'), 'A']),
            rowDepth: 2,
            columnDepth: 1,
          }),
        ],
        factSelectors,
      }),
    ).toEqual([]);
  });

  it.each([
    ['row', MetricsLayoutEnum.ROWS],
    ['col', MetricsLayoutEnum.COLUMNS],
  ] as const)(
    'uses the %s projection filter depth instead of the raw Values path length',
    (axis, metricsLayout) => {
      const formData = {
        [axis === 'row' ? 'groupbyRows' : 'groupbyColumns']: [
          'country',
          'state',
          METRICS_PLACEHOLDER,
          'city',
        ],
        metrics: ['sales'],
        metricsLayout,
      } as PivotTableQueryFormData;
      const layout = buildLayoutContext(formData);
      const { pivotProgram: program } = layout;
      const projection = resolveAxisProjection({
        program,
        axis,
        path: ['US', encodeMetricKey('sales'), 'Boston'],
      });

      const coverage = buildExpansionQuerySpecs({
        formData,
        layout,
        targets: [
          buildAxisExpansionCoverageTarget({
            program,
            axis,
            pathKey: serializePath(['US', encodeMetricKey('sales'), 'Boston']),
            rowDepth: axis === 'row' ? 2 : 0,
            columnDepth: axis === 'col' ? 2 : 0,
          }),
        ],
      }).map(spec => spec.meta.factSelector.coverage);

      expect(projection.filterDimensionPath).toEqual(['US']);
      expect(projection.projectedDimensionPath).toEqual(['US', 'Boston']);
      expect(projection.skippedPreValuesDimensions).toEqual(['state']);
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
            rowDimensions: axis === 'row' ? ['country', 'city'] : [],
            columnDimensions: axis === 'col' ? ['country', 'city'] : [],
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
