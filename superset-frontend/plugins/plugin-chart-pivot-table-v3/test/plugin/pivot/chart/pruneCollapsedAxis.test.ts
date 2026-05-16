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
  MetricsLayoutEnum,
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../../src/types';
import { pruneStaleCollapsedAxis } from '../../../../src/pivot/chart/pruneCollapsedAxis';
import { rootKey } from '../../../../src/pivot/viewModel';
import {
  serializeCellKey,
  serializePath,
} from '../../../../src/pivot/core/path';
import type { PivotProgram } from '../../../../src/pivot/runtime/types';

const makeNode = ({
  axis,
  path,
  hasChildren = false,
}: {
  axis: PivotAxis;
  path: PivotTreeNode['path'];
  hasChildren?: boolean;
}): PivotTreeNode => ({
  axis,
  key: path.length === 0 ? rootKey : serializePath(path),
  path,
  label: path.length === 0 ? 'Total' : String(path[path.length - 1]),
  formattedLabel: path.length === 0 ? 'Total' : String(path[path.length - 1]),
  level: path.length,
  hasChildren,
});

const makeTree = ({
  rows = [makeNode({ axis: 'row', path: [] })],
  cols = [makeNode({ axis: 'col', path: [] })],
  cells = {},
}: {
  rows?: PivotTreeNode[];
  cols?: PivotTreeNode[];
  cells?: PivotTreeData['cells'];
}): PivotTreeData => ({
  rows: Object.fromEntries(rows.map(node => [node.key, node])),
  cols: Object.fromEntries(cols.map(node => [node.key, node])),
  cells,
});

const baseConfig = {
  isMetricTokenValue: (value: unknown) =>
    typeof value === 'string' && value.startsWith('metric:'),
  isExplicitSubtotalNode: () => false,
  isMetricGrandTotalNode: () => false,
  isMetricSubtotalNode: () => false,
};

const programWithValuesAtEnd = (
  axis: PivotAxis,
  dimensions: string[],
): PivotProgram => {
  const metric = { key: 'sales', metric: 'sales', index: 0 };
  const dimensionLevels = dimensions.map(column => ({
    kind: 'dimension' as const,
    column,
  }));
  const valuesLevel = { kind: 'values' as const, metrics: [metric] };
  return {
    rows: axis === 'row' ? [...dimensionLevels, valuesLevel] : [],
    columns: axis === 'col' ? [...dimensionLevels, valuesLevel] : [],
    rowDimensions: axis === 'row' ? dimensions : [],
    columnDimensions: axis === 'col' ? dimensions : [],
    metrics: [metric],
    metricKeys: ['sales'],
    metricsLayoutResolved:
      axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS,
    valueAxis: axis,
    metricInsertIndex: dimensions.length,
  };
};

describe('pivot/chart/pruneCollapsedAxis', () => {
  it('prunes stale row collapsed children and their descendants from cells', () => {
    const parent = makeNode({ axis: 'row', path: ['US'], hasChildren: true });
    const valid = makeNode({ axis: 'row', path: ['US', 'CA'] });
    const stale = makeNode({ axis: 'row', path: ['US', 'NY'] });
    const staleDescendant = makeNode({
      axis: 'row',
      path: ['US', 'NY', 'Albany'],
    });
    const currentTree = makeTree({
      rows: [
        makeNode({ axis: 'row', path: [] }),
        parent,
        valid,
        stale,
        staleDescendant,
      ],
      cells: {
        [serializeCellKey(valid.key, rootKey)]: {
          rowKey: valid.key,
          colKey: rootKey,
          values: { sales: 1 },
        },
        [serializeCellKey(staleDescendant.key, rootKey)]: {
          rowKey: staleDescendant.key,
          colKey: rootKey,
          values: { sales: 2 },
        },
      },
    });
    const branch = makeTree({
      rows: [makeNode({ axis: 'row', path: [] }), parent, valid],
    });

    const nextTree = pruneStaleCollapsedAxis({
      ...baseConfig,
      currentTree,
      axis: 'row',
      parent,
      branch,
      program: programWithValuesAtEnd('row', ['country', 'state']),
    });

    expect(nextTree.rows[valid.key]).toBeDefined();
    expect(nextTree.rows[stale.key]).toBeUndefined();
    expect(nextTree.rows[staleDescendant.key]).toBeUndefined();
    expect(nextTree.cells[serializeCellKey(valid.key, rootKey)]).toBeDefined();
    expect(
      nextTree.cells[serializeCellKey(staleDescendant.key, rootKey)],
    ).toBeUndefined();
  });

  it('keeps column metric children at the parent level when metrics are at the end', () => {
    const parent = makeNode({ axis: 'col', path: ['West'], hasChildren: true });
    const metricChild = makeNode({
      axis: 'col',
      path: ['West', 'metric:Sales'],
    });
    const stale = makeNode({ axis: 'col', path: ['West', 'Old'] });
    const valid = makeNode({ axis: 'col', path: ['West', 'Q1'] });
    const currentTree = makeTree({
      cols: [makeNode({ axis: 'col', path: [] }), parent, metricChild, stale],
      cells: {
        [serializeCellKey(rootKey, metricChild.key)]: {
          rowKey: rootKey,
          colKey: metricChild.key,
          values: { sales: 3 },
        },
        [serializeCellKey(rootKey, stale.key)]: {
          rowKey: rootKey,
          colKey: stale.key,
          values: { sales: 4 },
        },
      },
    });
    const branch = makeTree({
      cols: [makeNode({ axis: 'col', path: [] }), parent, valid],
    });

    const nextTree = pruneStaleCollapsedAxis({
      ...baseConfig,
      currentTree,
      axis: 'col',
      parent,
      branch,
      program: programWithValuesAtEnd('col', ['region', 'quarter']),
    });

    expect(nextTree.cols[metricChild.key]).toBeDefined();
    expect(nextTree.cols[stale.key]).toBeUndefined();
    expect(
      nextTree.cells[serializeCellKey(rootKey, metricChild.key)],
    ).toBeDefined();
    expect(
      nextTree.cells[serializeCellKey(rootKey, stale.key)],
    ).toBeUndefined();
  });
});
