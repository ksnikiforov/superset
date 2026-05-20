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
  resolveCollapsedValuesProjection,
} from '../../../../src/pivot/runtime/projection';
import { MetricsLayoutEnum } from '../../../../src/types';

const skippedColumns = (projection: ReturnType<typeof resolveAxisProjection>) =>
  projection.skippedPreValuesDimensions;

describe('resolveAxisProjection', () => {
  it.each([
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

  it('does not mark pre-Values dimensions as skipped when they are visible', () => {
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

  it('extracts metric and measure-leaf scope from the projected axis path', () => {
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
    expect(projection.measureLeafIds).toEqual(['1 year ago']);
  });

  it.each([
    ['row', MetricsLayoutEnum.ROWS],
    ['col', MetricsLayoutEnum.COLUMNS],
  ] as const)(
    'projects collapsed Values metric leaves on %s without deciding presentation',
    (axis, metricsLayout) => {
      const program = compilePivotProgram({
        [axis === 'row' ? 'groupbyRows' : 'groupbyColumns']: [
          'orderPriority',
          'shipMode',
          METRICS_PLACEHOLDER,
          'returnFlag',
        ],
        metrics: ['revenue', 'orders'],
        metricsLayout,
      });

      const collapsedMetrics = resolveCollapsedValuesProjection({
        program,
        axis,
        parentPath: ['1-URGENT'],
        sourceMetricPaths: [
          ['1-URGENT', encodeMetricKey('revenue')],
          ['1-URGENT', encodeMetricKey('orders')],
          ['1-URGENT', encodeMetricKey('revenue'), 'Returned'],
        ],
      });

      expect(collapsedMetrics).toEqual([
        {
          metricKey: 'revenue',
          metricToken: encodeMetricKey('revenue'),
          metricPath: ['1-URGENT', encodeMetricKey('revenue')],
          sourceMetricPath: ['1-URGENT', encodeMetricKey('revenue')],
          hasProjectedChildren: true,
        },
        {
          metricKey: 'orders',
          metricToken: encodeMetricKey('orders'),
          metricPath: ['1-URGENT', encodeMetricKey('orders')],
          sourceMetricPath: ['1-URGENT', encodeMetricKey('orders')],
          hasProjectedChildren: true,
        },
      ]);
    },
  );

  it('marks collapsed metric paths at Values end as leaf projections', () => {
    const program = compilePivotProgram({
      groupbyRows: ['orderPriority', METRICS_PLACEHOLDER],
      metrics: ['revenue'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });

    const [metric] = resolveCollapsedValuesProjection({
      program,
      axis: 'row',
      parentPath: ['1-URGENT'],
      sourceMetricPaths: [['1-URGENT', encodeMetricKey('revenue')]],
    });

    expect(metric).toEqual({
      metricKey: 'revenue',
      metricToken: encodeMetricKey('revenue'),
      metricPath: ['1-URGENT', encodeMetricKey('revenue')],
      sourceMetricPath: ['1-URGENT', encodeMetricKey('revenue')],
      hasProjectedChildren: false,
    });
  });

  it('does not project another collapsed Values tier below a metric path', () => {
    const program = compilePivotProgram({
      groupbyColumns: ['segment', METRICS_PLACEHOLDER, 'month'],
      metrics: ['revenue'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });

    expect(
      resolveCollapsedValuesProjection({
        program,
        axis: 'col',
        parentPath: ['Consumer', encodeMetricKey('revenue')],
        sourceMetricPaths: [
          ['Consumer', encodeMetricKey('revenue'), '2024-01'],
        ],
      }),
    ).toEqual([]);
  });

  it.each([
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
        addsProjectedDimension: true,
      });

      expect(
        resolveAxisChildProjection({
          program,
          axis,
          parentPath: ['1-URGENT'],
          childPath: ['1-URGENT', encodeMetricKey('revenue')],
        }),
      ).toMatchObject({
        valuesTokenIndex: 1,
        rawValuesTokenIndex: 1,
        introducesValues: true,
        addsProjectedDimension: false,
      });

      expect(
        resolveAxisChildProjection({
          program,
          axis,
          parentPath: ['1-URGENT', encodeMetricKey('revenue')],
          childPath: ['1-URGENT', encodeMetricKey('revenue'), 'Returned'],
        }),
      ).toMatchObject({
        valuesTokenIndex: 1,
        rawValuesTokenIndex: 1,
        introducesValues: false,
        addsProjectedDimension: true,
      });
    },
  );

  it('keeps the Values token index distinct from projected dimension order', () => {
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
      valuesTokenIndex: 0,
      rawValuesTokenIndex: 0,
      introducesValues: true,
      addsProjectedDimension: true,
    });
  });

  it('keeps raw Values index for subtotal header placement', () => {
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
      valuesTokenIndex: 1,
      rawValuesTokenIndex: 2,
      introducesValues: true,
    });
  });

  it('keeps expansion requestability program-owned and rejects synthetic subtotal paths', () => {
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
