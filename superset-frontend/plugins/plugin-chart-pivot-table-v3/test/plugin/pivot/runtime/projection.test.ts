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
  encodeMeasureLeafKey,
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import {
  canRequestAxisExpansion,
  resolveAxisProjection,
  resolveAxisChildProjection,
} from '../../../../src/pivot/runtime/projection';
import { MetricsLayoutEnum } from '../../../../src/types';

const skippedColumns = (projection: ReturnType<typeof resolveAxisProjection>) =>
  projection.skippedPreValuesDimensions;

describe('resolveAxisProjection', () => {
  test.each([
    ['row', MetricsLayoutEnum.ROWS],
    ['col', MetricsLayoutEnum.COLUMNS],
  ] as const)(
    'represents skipped pre-Values dimensions on %s as an explicit projection',
    (axis, metricsLayout) => {
      const program = compilePivotProgram({
        [axis === 'row' ? 'groupbyRows' : 'groupbyColumns']: [
          'orderPriority',
          'shipMode',
          METRICS_PLACEHOLDER,
          'returnFlag',
        ],
        metrics: ['revenue'],
        metricsLayout,
      });

      const projection = resolveAxisProjection({
        program,
        axis,
        path: ['1-URGENT', encodeMetricKey('revenue'), 'Returned'],
      });

      expect(projection.filterDimensionPath).toEqual(['1-URGENT']);
      expect(projection.projectedDimensionPath).toEqual([
        '1-URGENT',
        'Returned',
      ]);
      expect(projection.postValuesDimensionPath).toEqual(['Returned']);
      expect(skippedColumns(projection)).toEqual(['shipMode']);
      expect(projection.metricKeys).toEqual(['revenue']);
      expect(projection.valuesLevelSeen).toBe(true);
    },
  );

  test('does not mark pre-Values dimensions as skipped when they are visible', () => {
    const program = compilePivotProgram({
      groupbyRows: [
        'orderPriority',
        'shipMode',
        METRICS_PLACEHOLDER,
        'returnFlag',
      ],
      metrics: ['revenue'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const projection = resolveAxisProjection({
      program,
      axis: 'row',
      path: ['1-URGENT', 'AIR', encodeMetricKey('revenue'), 'Returned'],
    });

    expect(projection.filterDimensionPath).toEqual(['1-URGENT', 'AIR']);
    expect(projection.projectedDimensionPath).toEqual([
      '1-URGENT',
      'AIR',
      'Returned',
    ]);
    expect(skippedColumns(projection)).toEqual([]);
  });

  test('extracts metric scope from the projected axis path', () => {
    const program = compilePivotProgram({
      groupbyColumns: ['segment', METRICS_PLACEHOLDER, 'month'],
      metrics: ['revenue', 'orders'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    const projection = resolveAxisProjection({
      program,
      axis: 'col',
      path: [
        'Consumer',
        encodeMetricKey('revenue'),
        encodeMeasureLeafKey('1 year ago'),
        '2024-01',
      ],
    });

    expect(projection.filterDimensionPath).toEqual(['Consumer']);
    expect(projection.projectedDimensionPath).toEqual(['Consumer', '2024-01']);
    expect(projection.metricKeys).toEqual(['revenue']);
  });

  test.each([
    ['row', MetricsLayoutEnum.ROWS],
    ['col', MetricsLayoutEnum.COLUMNS],
  ] as const)(
    'classifies child projection semantics on %s without presentation rules',
    (axis, metricsLayout) => {
      const program = compilePivotProgram({
        [axis === 'row' ? 'groupbyRows' : 'groupbyColumns']: [
          'orderPriority',
          'shipMode',
          METRICS_PLACEHOLDER,
          'returnFlag',
        ],
        metrics: ['revenue'],
        metricsLayout,
      });

      expect(
        resolveAxisChildProjection({
          program,
          axis,
          parentPath: ['1-URGENT'],
          childPath: ['1-URGENT', 'AIR'],
        }),
      ).toMatchObject({
        introducesValues: false,
      });

      expect(
        resolveAxisChildProjection({
          program,
          axis,
          parentPath: ['1-URGENT'],
          childPath: ['1-URGENT', encodeMetricKey('revenue')],
        }),
      ).toMatchObject({
        rawValuesTokenIndex: 1,
        introducesValues: true,
      });

      expect(
        resolveAxisChildProjection({
          program,
          axis,
          parentPath: ['1-URGENT', encodeMetricKey('revenue')],
          childPath: ['1-URGENT', encodeMetricKey('revenue'), 'Returned'],
        }),
      ).toMatchObject({
        rawValuesTokenIndex: 1,
        introducesValues: false,
      });
    },
  );

  test('keeps the Values token index distinct from projected dimension order', () => {
    const program = compilePivotProgram({
      groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
      metrics: ['revenue'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(
      resolveAxisChildProjection({
        program,
        axis: 'col',
        parentPath: [],
        childPath: [encodeMetricKey('revenue'), 'Consumer'],
      }),
    ).toMatchObject({
      rawValuesTokenIndex: 0,
      introducesValues: true,
    });
  });

  test('keeps raw Values index for subtotal header placement', () => {
    const program = compilePivotProgram({
      groupbyColumns: ['year', 'shipMode', METRICS_PLACEHOLDER],
      metrics: ['revenue'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(
      resolveAxisChildProjection({
        program,
        axis: 'col',
        parentPath: ['1992', SUBTOTAL_TOKEN],
        childPath: ['1992', SUBTOTAL_TOKEN, encodeMetricKey('revenue')],
      }),
    ).toMatchObject({
      rawValuesTokenIndex: 2,
      introducesValues: true,
    });
  });

  test('keeps expansion requestability program-owned and rejects synthetic subtotal paths', () => {
    const program = compilePivotProgram({
      groupbyRows: [
        'orderPriority',
        METRICS_PLACEHOLDER,
        'returnFlag',
        'shipMode',
      ],
      metrics: ['revenue'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    expect(
      canRequestAxisExpansion({
        program,
        axis: 'row',
        path: ['1-URGENT', encodeMetricKey('revenue')],
      }),
    ).toBe(true);

    expect(
      canRequestAxisExpansion({
        program,
        axis: 'row',
        path: ['1-URGENT', SUBTOTAL_TOKEN, encodeMetricKey('revenue')],
      }),
    ).toBe(false);

    expect(
      canRequestAxisExpansion({
        program,
        axis: 'row',
        path: ['1-URGENT', encodeMetricKey('revenue'), 'Returned', 'AIR'],
      }),
    ).toBe(false);
  });
});
