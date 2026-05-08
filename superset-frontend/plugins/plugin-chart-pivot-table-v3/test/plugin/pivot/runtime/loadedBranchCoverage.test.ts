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
  SUBTOTAL_TOKEN,
} from '../../../../src/pivot/core/tokens';
import { serializePath } from '../../../../src/pivot/core/path';
import {
  buildLoadedBranchCoverageMarkers,
  collectLoadedBranchPaths,
} from '../../../../src/pivot/runtime/loadedBranchCoverage';
import { compilePivotProgram } from '../../../../src/pivot/runtime/compilePivotProgram';
import {
  MetricsLayoutEnum,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../../src/types';

const makeNode = ({
  axis = 'row',
  path,
  hasChildren = false,
}: Pick<PivotTreeNode, 'path'> &
  Partial<Pick<PivotTreeNode, 'axis' | 'hasChildren'>>): PivotTreeNode => ({
  axis,
  key: serializePath(path),
  path,
  label: String(path[path.length - 1] ?? 'Total'),
  formattedLabel: String(path[path.length - 1] ?? 'Total'),
  level: path.length,
  hasChildren,
});

const makeMetricBetweenTree = (): PivotTreeData => {
  const salesMetric = encodeMetricKey('sales');
  const profitMetric = encodeMetricKey('profit');
  return {
    rows: {
      '': makeNode({ path: [], hasChildren: true }),
      [serializePath(['US'])]: makeNode({
        path: ['US'],
        hasChildren: true,
      }),
      [serializePath(['US', salesMetric])]: makeNode({
        path: ['US', salesMetric],
        hasChildren: true,
      }),
      [serializePath(['US', salesMetric, 'CA'])]: makeNode({
        path: ['US', salesMetric, 'CA'],
      }),
      [serializePath(['US', profitMetric])]: makeNode({
        path: ['US', profitMetric],
        hasChildren: true,
      }),
      [serializePath(['US', profitMetric, SUBTOTAL_TOKEN])]: makeNode({
        path: ['US', profitMetric, SUBTOTAL_TOKEN],
      }),
      [serializePath(['MX'])]: makeNode({
        path: ['MX'],
        hasChildren: true,
      }),
      [serializePath(['MX', salesMetric])]: makeNode({
        path: ['MX', salesMetric],
        hasChildren: true,
      }),
      [serializePath(['MX', salesMetric, 'CDMX'])]: makeNode({
        path: ['MX', salesMetric, 'CDMX'],
      }),
    },
    cols: {},
    cells: {},
  };
};

describe('loaded branch coverage markers', () => {
  it('collects only loaded dimensional descendants inside requested paths', () => {
    expect(
      collectLoadedBranchPaths({
        axis: 'row',
        tree: makeMetricBetweenTree(),
        basePaths: [['US']],
      }),
    ).toEqual([['US', encodeMetricKey('sales')]]);
  });

  it('dedupes markers against existing branch coverage', () => {
    const pivotProgram = compilePivotProgram({
      groupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      metrics: ['sales', 'profit'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });
    const markers = buildLoadedBranchCoverageMarkers({
      axis: 'row',
      tree: makeMetricBetweenTree(),
      basePaths: [['US']],
      pivotProgram,
      visibleRowDepth: 2,
      visibleColDepth: 0,
    });

    expect(
      buildLoadedBranchCoverageMarkers({
        axis: 'row',
        tree: makeMetricBetweenTree(),
        basePaths: [['US']],
        pivotProgram,
        visibleRowDepth: 2,
        visibleColDepth: 0,
        existingBatches: markers,
      }),
    ).toEqual([]);
  });
});
