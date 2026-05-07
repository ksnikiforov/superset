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
import {
  buildBatchQuerySpecs,
  buildBranchQuerySpecs,
} from '../../../src/pivot/query/specs';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
} from '../../../src/pivot/core/tokens';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';
import { serializePath } from '../../../src/utils';
import { type BatchGroup } from '../../../src/pivot/query/fetchPlanOptimizer';
import { buildFormData } from '../fixtures/pivotFormData';

const emptyTree: PivotTreeData = {
  rows: {},
  cols: {},
  cells: {},
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

    const specs = buildBranchQuerySpecs({
      formData,
      layout,
      axis: 'row',
      path: ['US'],
      metricPath: ['US'],
      currentTree: emptyTree,
      visibleRowDepth: 1,
      visibleColDepth: 1,
    });

    expect(specs.length).toBeGreaterThan(0);
    specs.forEach(spec => {
      expect(spec.meta.coverage).toMatchObject({
        reason: 'expand',
        rowDepth: spec.meta.rowDepth,
        columnDepth: spec.meta.colDepth,
      });
      expect(spec.columns).toEqual([
        ...(spec.meta.coverage?.rowDimensions ?? []),
        ...(spec.meta.coverage?.columnDimensions ?? []),
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

    const specs = buildBranchQuerySpecs({
      formData,
      layout,
      axis: 'col',
      path: ['Furniture'],
      metricPath: ['Furniture'],
      currentTree: emptyTree,
      visibleRowDepth: 0,
      visibleColDepth: 1,
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

    const specs = buildBranchQuerySpecs({
      formData,
      layout,
      axis: 'col',
      path: ['Furniture', 'sales'],
      metricPath: ['Furniture', encodeMetricKey('sales')],
      currentTree: emptyTree,
      visibleRowDepth: 0,
      visibleColDepth: 1,
    });

    expect(specs.length).toBeGreaterThan(0);
    expect(
      specs.some(spec =>
        spec.meta.coverage?.columnDimensions.includes('subcategory'),
      ),
    ).toBe(true);
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
    const batch: BatchGroup = {
      axis: 'row',
      childDepth: 2,
      requiredOppositeDepth: 0,
      signature: 'values-only',
      parentPathKey: '',
      siblingValues: ['US', 'CA'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US']),
          childDepth: 2,
          requiredOppositeDepth: 0,
          batchSignature: 'values-only',
        },
        {
          axis: 'row',
          pathKey: serializePath(['CA']),
          childDepth: 2,
          requiredOppositeDepth: 0,
          batchSignature: 'values-only',
        },
      ],
    };

    const specs = buildBatchQuerySpecs({
      formData,
      layout,
      batch,
      currentTree: emptyTree,
      visibleRowDepth: 1,
      visibleColDepth: 0,
    });

    expect(specs).toEqual([]);
  });
});
