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
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import { buildExpansionQuerySpecs } from '../fixtures/querySpecs';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { MetricsLayoutEnum } from '../../../src/types';
import { serializePath } from '../../../src/pivot/core/path';
import { buildAxisExpansionCoverageTarget } from '../../../src/pivot/expansion/planner';
import { buildFormData } from '../fixtures/pivotFormData';

const fetchTarget = ({
  layout,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
}: {
  layout: ReturnType<typeof buildLayoutContext>;
  axis: 'row' | 'col';
  path: unknown[];
  visibleRowDepth: number;
  visibleColDepth: number;
}) => {
  const pathKey = serializePath(path);
  return buildAxisExpansionCoverageTarget({
    program: layout.pivotProgram,
    axis,
    pathKey,
    rowDepth: visibleRowDepth,
    columnDepth: visibleColDepth,
  });
};

describe('runtime coverage query specs contract', () => {
  it('records branch fact coverage and uses it for query columns', () => {
    const formData = buildFormData({
      groupbyRows: ['country', 'state'],
      groupbyColumns: ['category', 'subcategory'],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
    });
    const layout = buildLayoutContext(formData);

    const specs = buildExpansionQuerySpecs({
      formData,
      layout,
      targets: [
        fetchTarget({
          layout,
          axis: 'row',
          path: ['US'],
          visibleRowDepth: 1,
          visibleColDepth: 1,
        }),
      ],
    });

    expect(specs.length).toBeGreaterThan(0);
    specs.forEach(spec => {
      expect(spec.meta.factSelector.coverage).toMatchObject({
        rowDepth: spec.meta.factSelector.coverage.rowDepth,
        columnDepth: spec.meta.factSelector.coverage.columnDepth,
      });
      expect(spec.columns).toEqual([
        ...(spec.meta.factSelector.coverage?.rowDimensions ?? []),
        ...(spec.meta.factSelector.coverage?.columnDimensions ?? []),
      ]);
    });
  });

  it('does not build branch specs when expansion only reveals Values', () => {
    const formData = buildFormData({
      groupbyRows: [],
      groupbyColumns: ['category', METRICS_PLACEHOLDER, 'subcategory'],
      metrics: ['sales', 'profit'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
    });
    const layout = buildLayoutContext(formData);

    const specs = buildExpansionQuerySpecs({
      formData,
      layout,
      targets: [
        fetchTarget({
          layout,
          axis: 'col',
          path: ['Furniture'],
          visibleRowDepth: 0,
          visibleColDepth: 1,
        }),
      ],
    });

    expect(specs).toEqual([]);
  });

  it('builds branch specs for the dimension after Values', () => {
    const formData = buildFormData({
      groupbyRows: [],
      groupbyColumns: ['category', METRICS_PLACEHOLDER, 'subcategory'],
      metrics: ['sales', 'profit'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
    });
    const layout = buildLayoutContext(formData);

    const path = ['Furniture', encodeMetricKey('sales')];
    const specs = buildExpansionQuerySpecs({
      formData,
      layout,
      targets: [
        fetchTarget({
          layout,
          axis: 'col',
          path,
          visibleRowDepth: 0,
          visibleColDepth: 1,
        }),
      ],
    });

    expect(specs.length).toBeGreaterThan(0);
    expect(
      specs.some(spec =>
        spec.meta.factSelector.coverage?.columnDimensions.includes(
          'subcategory',
        ),
      ),
    ).toBe(true);
    expect(specs[0].meta.factSelector.scope).toMatchObject({
      kind: 'scopedFull',
      axis: 'col',
      ancestorPaths: [['Furniture']],
    });
  });

  it('materializes canonical skipped pre-Values coverage at the visible prefix', () => {
    const formData = buildFormData({
      groupbyRows: [
        'orderPriority',
        'shipMode',
        METRICS_PLACEHOLDER,
        'orderStatus',
      ],
      groupbyColumns: [],
      metrics: ['averageOrderValue', 'weightedDiscount'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      rowTotals: false,
      colTotals: false,
    });
    const layout = buildLayoutContext(formData);
    const metricTarget = fetchTarget({
      layout,
      axis: 'row',
      path: ['1-URGENT', encodeMetricKey('averageOrderValue')],
      visibleRowDepth: 2,
      visibleColDepth: 0,
    });
    const specs = buildExpansionQuerySpecs({
      formData,
      layout,
      targets: [
        {
          ...metricTarget,
          need: {
            ...metricTarget.need,
            rowDepth: 3,
            rowDimensions: ['orderPriority', 'shipMode', 'orderStatus'],
          },
        },
      ],
    });

    expect(specs).toHaveLength(1);
    expect(specs[0].columns).toEqual([
      'orderPriority',
      'shipMode',
      'orderStatus',
    ]);
    expect(specs[0].metrics).toEqual(['averageOrderValue']);
    expect(specs[0].meta.factSelector.materialization).toEqual({
      valueAxis: 'row',
      valueInsertIndex: 2,
    });
  });

  it('does not build branch specs for synthetic subtotal display paths', () => {
    const formData = buildFormData({
      groupbyRows: ['country', 'state', 'city'],
      groupbyColumns: [],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
    });
    const layout = buildLayoutContext(formData);

    const specs = buildExpansionQuerySpecs({
      formData,
      layout,
      targets: [
        fetchTarget({
          layout,
          axis: 'row',
          path: ['US', SUBTOTAL_TOKEN],
          visibleRowDepth: 2,
          visibleColDepth: 0,
        }),
      ],
    });

    expect(specs).toEqual([]);
  });

  it('does not build batch specs when grouped expansion only reveals Values', () => {
    const formData = buildFormData({
      groupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      groupbyColumns: [],
      metrics: ['sales', 'profit'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      rowTotals: false,
      colTotals: false,
    });
    const layout = buildLayoutContext(formData);
    const batch = [
      {
        ...fetchTarget({
          layout,
          axis: 'row',
          path: ['US'],
          visibleRowDepth: 1,
          visibleColDepth: 0,
        }),
      },
      {
        ...fetchTarget({
          layout,
          axis: 'row',
          path: ['CA'],
          visibleRowDepth: 1,
          visibleColDepth: 0,
        }),
      },
    ];

    const specs = buildExpansionQuerySpecs({
      formData,
      layout,
      targets: batch,
    });

    expect(specs).toEqual([]);
  });

  it('does not build batch specs for synthetic subtotal display paths', () => {
    const formData = buildFormData({
      groupbyRows: ['country', 'state', 'city'],
      groupbyColumns: [],
      metrics: ['sales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
    });
    const layout = buildLayoutContext(formData);
    const batch = [
      {
        ...fetchTarget({
          layout,
          axis: 'row',
          path: ['US', SUBTOTAL_TOKEN],
          visibleRowDepth: 2,
          visibleColDepth: 0,
        }),
      },
    ];

    const specs = buildExpansionQuerySpecs({
      formData,
      layout,
      targets: batch,
    });

    expect(specs).toEqual([]);
  });
});
