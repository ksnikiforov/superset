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

import { buildRenderModel } from '../../../src/pivot/render/renderModel';
import { rootKey, findChildren } from '../../../src/pivot/viewModel';
import {
  MetricsLayoutEnum,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../src/types';
import { serializePath } from '../../../src/pivot/core/path';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';

const makeNode = ({
  axis,
  key,
  path,
  label,
  hasChildren = false,
  isCollapsedMetric,
}: {
  axis: 'row' | 'col';
  key: string;
  path: PivotTreeNode['path'];
  label: string;
  hasChildren?: boolean;
  isCollapsedMetric?: boolean;
}): PivotTreeNode => ({
  axis,
  key,
  path,
  label,
  formattedLabel: label,
  level: path.length,
  hasChildren,
  isCollapsedMetric,
});

describe('findChildren', () => {
  test('returns direct children without exposing cached lookup arrays', () => {
    const rowAKey = serializePath(['A']);
    const rowBKey = serializePath(['B']);
    const rowA1Key = serializePath(['A', 'A1']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
      }),
      [rowAKey]: makeNode({
        axis: 'row',
        key: rowAKey,
        path: ['A'],
        label: 'A',
      }),
      [rowA1Key]: makeNode({
        axis: 'row',
        key: rowA1Key,
        path: ['A', 'A1'],
        label: 'A1',
      }),
      [rowBKey]: makeNode({
        axis: 'row',
        key: rowBKey,
        path: ['B'],
        label: 'B',
      }),
    };

    const rootChildren = findChildren(nodes, nodes[rootKey]);
    rootChildren.reverse();

    expect(findChildren(nodes, nodes[rootKey]).map(node => node.key)).toEqual([
      rowAKey,
      rowBKey,
    ]);
    expect(findChildren(nodes, nodes[rowAKey]).map(node => node.key)).toEqual([
      rowA1Key,
    ]);
  });
});

describe('buildRenderModel', () => {
  test('computes visible rows/cols and totals flags', () => {
    const rowKey = 'A';
    const colKey = 'C';
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode({
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Total',
          hasChildren: true,
        }),
        [rowKey]: makeNode({
          axis: 'row',
          key: rowKey,
          path: ['A'],
          label: 'A',
          hasChildren: false,
        }),
      },
      cols: {
        [rootKey]: makeNode({
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Total',
          hasChildren: true,
        }),
        [colKey]: makeNode({
          axis: 'col',
          key: colKey,
          path: ['C'],
          label: 'C',
          hasChildren: false,
        }),
      },
      cells: {},
    };

    const renderModel = buildRenderModel({
      tree,
      expandedRows: new Set([rootKey, rowKey]),
      expandedCols: new Set([rootKey, colKey]),
      config: {
        normalizedRowSubtotalLevels: [0],
        normalizedColSubtotalLevels: [0],
        rowTotals: true,
        colTotals: true,
        rowTotalPosition: 'start',
        colTotalPosition: 'start',
        resolvedColSubtotalPosition: 'start',
        pivotProgram: compilePivotProgram({
          groupbyRows: ['row'],
          groupbyColumns: ['col'],
        }),
        hasMultipleMeasures: false,
        isLeafTierVisible: false,
        rowSubTotals: false,
        getRowSubtotalPosition: () => 'start',
        rowSorter: (a, b) => a.label.localeCompare(b.label),
        colSorter: (a, b) => a.label.localeCompare(b.label),
      },
    });

    expect(renderModel.showRowRoot).toBe(true);
    expect(renderModel.visibleRows.map(node => node.key)).toEqual([
      rootKey,
      rowKey,
    ]);
    expect(renderModel.visibleCols.map(node => node.key)).toEqual([
      rootKey,
      colKey,
    ]);
  });

  test('keeps root row visible when there are no row dimensions and multiple measures', () => {
    const metricColKey = 'm1';
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode({
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Grand total',
          hasChildren: false,
        }),
      },
      cols: {
        [rootKey]: makeNode({
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Grand total',
          hasChildren: true,
        }),
        [metricColKey]: makeNode({
          axis: 'col',
          key: metricColKey,
          path: ['m1'],
          label: 'm1',
          hasChildren: false,
        }),
      },
      cells: {},
    };

    const renderModel = buildRenderModel({
      tree,
      expandedRows: new Set([rootKey]),
      expandedCols: new Set([rootKey, metricColKey]),
      config: {
        normalizedRowSubtotalLevels: [],
        normalizedColSubtotalLevels: [],
        rowTotals: false,
        colTotals: true,
        rowTotalPosition: 'start',
        colTotalPosition: 'start',
        resolvedColSubtotalPosition: 'start',
        pivotProgram: compilePivotProgram({
          metrics: ['m1', 'm2'],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
        }),
        hasMultipleMeasures: true,
        isLeafTierVisible: false,
        rowSubTotals: false,
        getRowSubtotalPosition: () => 'start',
        rowSorter: (a, b) => a.label.localeCompare(b.label),
        colSorter: (a, b) => a.label.localeCompare(b.label),
      },
    });

    expect(renderModel.visibleRows.map(node => node.key)).toEqual([rootKey]);
  });

  test('renders post-Values dimension children under expanded collapsed metric rows', () => {
    const urgentKey = serializePath(['1-URGENT']);
    const shipModeKey = serializePath(['1-URGENT', 'AIR']);
    const metricKey = serializePath([
      '1-URGENT',
      'AIR',
      encodeMetricKey('averageOrderValue'),
    ]);
    const statusKey = serializePath([
      '1-URGENT',
      'AIR',
      encodeMetricKey('averageOrderValue'),
      'F',
    ]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode({
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Grand total',
          hasChildren: true,
        }),
        [urgentKey]: makeNode({
          axis: 'row',
          key: urgentKey,
          path: ['1-URGENT'],
          label: '1-URGENT',
          hasChildren: true,
        }),
        [shipModeKey]: makeNode({
          axis: 'row',
          key: shipModeKey,
          path: ['1-URGENT', 'AIR'],
          label: 'AIR',
          hasChildren: true,
        }),
        [metricKey]: makeNode({
          axis: 'row',
          key: metricKey,
          path: ['1-URGENT', 'AIR', encodeMetricKey('averageOrderValue')],
          label: 'averageOrderValue',
          hasChildren: true,
          isCollapsedMetric: true,
        }),
        [statusKey]: makeNode({
          axis: 'row',
          key: statusKey,
          path: ['1-URGENT', 'AIR', encodeMetricKey('averageOrderValue'), 'F'],
          label: 'F',
          hasChildren: false,
        }),
      },
      cols: {
        [rootKey]: makeNode({
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Grand total',
          hasChildren: false,
        }),
      },
      cells: {},
    };

    const renderModel = buildRenderModel({
      tree,
      expandedRows: new Set([rootKey, urgentKey, metricKey]),
      expandedCols: new Set([rootKey]),
      config: {
        normalizedRowSubtotalLevels: [],
        normalizedColSubtotalLevels: [],
        rowTotals: false,
        colTotals: false,
        rowTotalPosition: 'start',
        colTotalPosition: 'start',
        resolvedColSubtotalPosition: 'start',
        pivotProgram: compilePivotProgram({
          groupbyRows: [
            'orderPriority',
            'shipMode',
            METRICS_PLACEHOLDER,
            'orderStatus',
          ],
          metrics: ['averageOrderValue', 'weightedDiscount'],
          metricsLayout: MetricsLayoutEnum.ROWS,
        }),
        hasMultipleMeasures: false,
        isLeafTierVisible: false,
        rowSubTotals: false,
        getRowSubtotalPosition: () => 'start',
        rowSorter: (a, b) => a.label.localeCompare(b.label),
        colSorter: (a, b) => a.label.localeCompare(b.label),
      },
    });

    expect(renderModel.visibleRows.map(node => node.key)).toEqual([
      urgentKey,
      shipModeKey,
      metricKey,
      statusKey,
    ]);
  });

  test('does not repair a missing non-root column subtotal leaf', () => {
    const categoryKey = serializePath(['Furniture']);
    const subcategoryKey = serializePath(['Furniture', 'Chairs']);
    const omittedSubtotalKey = serializePath(['Furniture', SUBTOTAL_TOKEN]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode({
          axis: 'row',
          key: rootKey,
          path: [],
          label: 'Grand total',
          hasChildren: false,
        }),
      },
      cols: {
        [rootKey]: makeNode({
          axis: 'col',
          key: rootKey,
          path: [],
          label: 'Grand total',
          hasChildren: true,
        }),
        [categoryKey]: makeNode({
          axis: 'col',
          key: categoryKey,
          path: ['Furniture'],
          label: 'Furniture',
          hasChildren: true,
        }),
        [subcategoryKey]: makeNode({
          axis: 'col',
          key: subcategoryKey,
          path: ['Furniture', 'Chairs'],
          label: 'Chairs',
          hasChildren: false,
        }),
      },
      cells: {},
    };

    const renderModel = buildRenderModel({
      tree,
      expandedRows: new Set([rootKey]),
      expandedCols: new Set([rootKey, categoryKey]),
      config: {
        normalizedRowSubtotalLevels: [],
        normalizedColSubtotalLevels: [1],
        rowTotals: false,
        colTotals: false,
        rowTotalPosition: 'start',
        colTotalPosition: 'start',
        resolvedColSubtotalPosition: 'end',
        pivotProgram: compilePivotProgram({
          groupbyColumns: ['category', 'subcategory'],
        }),
        hasMultipleMeasures: false,
        isLeafTierVisible: false,
        rowSubTotals: false,
        getRowSubtotalPosition: () => 'start',
        rowSorter: (a, b) => a.label.localeCompare(b.label),
        colSorter: (a, b) => a.label.localeCompare(b.label),
      },
    });

    expect(tree.cols[omittedSubtotalKey]).toBeUndefined();
    expect(renderModel.visibleCols.map(node => node.key)).toEqual([
      subcategoryKey,
    ]);
  });
});
