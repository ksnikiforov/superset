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

const makeNode = ({
  axis,
  key,
  path,
  label,
  hasChildren = false,
}: {
  axis: 'row' | 'col';
  key: string;
  path: PivotTreeNode['path'];
  label: string;
  hasChildren?: boolean;
}): PivotTreeNode => ({
  axis,
  key,
  path,
  label,
  formattedLabel: label,
  level: path.length,
  hasChildren,
});

describe('buildRenderModel', () => {
  it('computes visible rows/cols and totals flags', () => {
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
        groupbyRowsLength: 1,
        groupbyColumnsLength: 1,
        normalizedRowSubtotalLevels: [0],
        normalizedColSubtotalLevels: [0],
        rowTotals: true,
        colTotals: true,
        rowTotalPosition: 'start',
        colTotalPosition: 'start',
        resolvedColSubtotalPosition: 'start',
        resolvedMetricsLayout: MetricsLayoutEnum.COLUMNS,
        isMultiMetric: false,
        metricsFirstOnCols: false,
        hideMetricHeaderOnRows: false,
        hideMetricHeaderOnCols: false,
        rowSorter: (a, b) => a.label.localeCompare(b.label),
        colSorter: (a, b) => a.label.localeCompare(b.label),
        getRowChildren: parent => findChildren(tree.rows, parent),
        getCollapsedRowChildren: () => [],
        getColChildren: parent => findChildren(tree.cols, parent),
        getCollapsedColLeaves: () => [],
        countDimDepth: path => path.length,
        isMetricGrandTotalNode: () => false,
        isMetricSubtotalNode: () => false,
        isMetricTokenValue: () => false,
      },
    });

    expect(renderModel.showRowRoot).toBe(true);
    expect(renderModel.showColRoot).toBe(true);
    expect(renderModel.visibleRows.map(node => node.key)).toEqual([
      rootKey,
      rowKey,
    ]);
    expect(renderModel.visibleCols.map(node => node.key)).toEqual([
      rootKey,
      colKey,
    ]);
  });
});
