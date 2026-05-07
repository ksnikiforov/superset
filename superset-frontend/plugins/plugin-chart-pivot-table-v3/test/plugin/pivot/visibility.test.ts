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

import { type PivotTreeData, type PivotTreeNode } from '../../../src/types';
import { hasLoadedChildren } from '../../../src/pivot/visibility';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
  serializeCellKey,
  serializePath,
} from '../../../src/utils';

const makeNode = (
  axis: 'row' | 'col',
  path: Array<string>,
  hasChildren: boolean,
): PivotTreeNode => {
  const key = serializePath(path);
  return {
    axis,
    key,
    path,
    label: path.length === 0 ? 'Grand total' : String(path[path.length - 1]),
    formattedLabel:
      path.length === 0 ? 'Grand total' : String(path[path.length - 1]),
    level: path.length,
    hasChildren,
  };
};

describe('pivot/visibility.hasLoadedChildren', () => {
  const getRawChildren =
    (rows: PivotTreeData['rows'], cols: PivotTreeData['cols']) =>
    (axis: 'row' | 'col', parent: PivotTreeNode) =>
      Object.values(axis === 'row' ? rows : cols).filter(candidate => {
        if (candidate.path.length !== parent.path.length + 1) {
          return false;
        }
        return parent.path.every(
          (value, index) => value === candidate.path[index],
        );
      });

  it('treats metric-only children above the metric tier as not loaded', () => {
    const metricToken = '__metric__m1';
    const rowRootKey = serializePath([]);
    const rowParentKey = serializePath(['A']);
    const rowMetricChildKey = serializePath(['A', metricToken]);
    const colRootKey = serializePath([]);
    const colKey = serializePath(['X']);

    const rows: PivotTreeData['rows'] = {
      [rowRootKey]: makeNode('row', [], true),
      [rowParentKey]: makeNode('row', ['A'], true),
      [rowMetricChildKey]: makeNode('row', ['A', metricToken], false),
    };
    const cols: PivotTreeData['cols'] = {
      [colRootKey]: makeNode('col', [], true),
      [colKey]: makeNode('col', ['X'], false),
    };
    const cells: PivotTreeData['cells'] = {
      [serializeCellKey(rowMetricChildKey, colKey)]: {
        rowKey: rowMetricChildKey,
        colKey,
        values: {},
      },
    };

    const loaded = hasLoadedChildren({
      axis: 'row',
      node: rows[rowParentKey],
      getRawChildren: (axis, parent) =>
        Object.values(axis === 'row' ? rows : cols).filter(candidate => {
          if (candidate.path.length !== parent.path.length + 1) {
            return false;
          }
          return parent.path.every(
            (value, index) => value === candidate.path[index],
          );
        }),
      groupbyRowsLength: 3,
      groupbyColsLength: 1,
      isMetricTokenValue: value => value === metricToken,
      metricIndexForRows: 2,
      metricIndexForCols: undefined,
      cells,
      rows,
      cols,
      visibleRowDepth: 1,
      visibleColDepth: 1,
      countDimDepth: path => path.filter(value => value !== metricToken).length,
    });

    expect(loaded).toBe(false);
  });

  it('treats subtotal+metric descendants without deeper dimensions as not loaded', () => {
    const metricToken = '__metric__m1';
    const rowRootKey = serializePath([]);
    const rowParentKey = serializePath(['A']);
    const rowSubtotalKey = serializePath(['A', SUBTOTAL_TOKEN]);
    const rowSubtotalMetricKey = serializePath([
      'A',
      SUBTOTAL_TOKEN,
      metricToken,
    ]);
    const colRootKey = serializePath([]);
    const colKey = serializePath(['X']);

    const rows: PivotTreeData['rows'] = {
      [rowRootKey]: makeNode('row', [], true),
      [rowParentKey]: makeNode('row', ['A'], true),
      [rowSubtotalKey]: makeNode('row', ['A', SUBTOTAL_TOKEN], true),
      [rowSubtotalMetricKey]: makeNode(
        'row',
        ['A', SUBTOTAL_TOKEN, metricToken],
        false,
      ),
    };
    const cols: PivotTreeData['cols'] = {
      [colRootKey]: makeNode('col', [], true),
      [colKey]: makeNode('col', ['X'], false),
    };
    const cells: PivotTreeData['cells'] = {
      [serializeCellKey(rowSubtotalMetricKey, colKey)]: {
        rowKey: rowSubtotalMetricKey,
        colKey,
        values: {},
      },
    };

    const loaded = hasLoadedChildren({
      axis: 'row',
      node: rows[rowParentKey],
      getRawChildren: (axis, parent) =>
        Object.values(axis === 'row' ? rows : cols).filter(candidate => {
          if (candidate.path.length !== parent.path.length + 1) {
            return false;
          }
          return parent.path.every(
            (value, index) => value === candidate.path[index],
          );
        }),
      groupbyRowsLength: 3,
      groupbyColsLength: 1,
      isMetricTokenValue: value => value === metricToken,
      metricIndexForRows: 2,
      metricIndexForCols: undefined,
      cells,
      rows,
      cols,
      visibleRowDepth: 1,
      visibleColDepth: 1,
      countDimDepth: path =>
        path.filter(value => value !== metricToken && value !== SUBTOTAL_TOKEN)
          .length,
    });

    expect(loaded).toBe(false);
  });

  it('treats metric-only stale variants as not loaded when they have no child cells', () => {
    const rowRootKey = serializePath([]);
    const rowParentKey = serializePath(['A']);
    const rowMetricVariantKey = serializePath(['A', METRICS_PLACEHOLDER]);
    const colRootKey = serializePath([]);
    const colKey = serializePath(['X']);

    const rows: PivotTreeData['rows'] = {
      [rowRootKey]: makeNode('row', [], true),
      [rowParentKey]: makeNode('row', ['A'], true),
      [rowMetricVariantKey]: makeNode('row', ['A', METRICS_PLACEHOLDER], false),
    };
    const cols: PivotTreeData['cols'] = {
      [colRootKey]: makeNode('col', [], true),
      [colKey]: makeNode('col', ['X'], false),
    };
    const cells: PivotTreeData['cells'] = {
      [serializeCellKey(rowParentKey, colKey)]: {
        rowKey: rowParentKey,
        colKey,
        values: {},
      },
    };

    const loaded = hasLoadedChildren({
      axis: 'row',
      node: rows[rowParentKey],
      getRawChildren: (axis, parent) =>
        Object.values(axis === 'row' ? rows : cols).filter(candidate => {
          if (candidate.path.length !== parent.path.length + 1) {
            return false;
          }
          return parent.path.every(
            (value, index) => value === candidate.path[index],
          );
        }),
      groupbyRowsLength: 2,
      groupbyColsLength: 1,
      isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
      metricIndexForRows: 1,
      metricIndexForCols: undefined,
      cells,
      rows,
      cols,
      visibleRowDepth: 1,
      visibleColDepth: 1,
      countDimDepth: path =>
        path.filter(value => value !== METRICS_PLACEHOLDER).length,
    });

    expect(loaded).toBe(false);
  });

  it('treats metric variants as loaded once metric child cells are present', () => {
    const rowRootKey = serializePath([]);
    const rowParentKey = serializePath(['A']);
    const rowMetricVariantKey = serializePath(['A', METRICS_PLACEHOLDER]);
    const colRootKey = serializePath([]);
    const colKey = serializePath(['X']);

    const rows: PivotTreeData['rows'] = {
      [rowRootKey]: makeNode('row', [], true),
      [rowParentKey]: makeNode('row', ['A'], true),
      [rowMetricVariantKey]: makeNode('row', ['A', METRICS_PLACEHOLDER], false),
    };
    const cols: PivotTreeData['cols'] = {
      [colRootKey]: makeNode('col', [], true),
      [colKey]: makeNode('col', ['X'], false),
    };
    const cells: PivotTreeData['cells'] = {
      [serializeCellKey(rowMetricVariantKey, colKey)]: {
        rowKey: rowMetricVariantKey,
        colKey,
        values: {},
      },
    };

    const loaded = hasLoadedChildren({
      axis: 'row',
      node: rows[rowParentKey],
      getRawChildren: (axis, parent) =>
        Object.values(axis === 'row' ? rows : cols).filter(candidate => {
          if (candidate.path.length !== parent.path.length + 1) {
            return false;
          }
          return parent.path.every(
            (value, index) => value === candidate.path[index],
          );
        }),
      groupbyRowsLength: 2,
      groupbyColsLength: 1,
      isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
      metricIndexForRows: 1,
      metricIndexForCols: undefined,
      cells,
      rows,
      cols,
      visibleRowDepth: 1,
      visibleColDepth: 1,
      countDimDepth: path =>
        path.filter(value => value !== METRICS_PLACEHOLDER).length,
    });

    expect(loaded).toBe(true);
  });

  it.each(['row', 'col'] as const)(
    'treats a skipped pre-Values %s parent as not loaded',
    axis => {
      const metricToken = encodeMetricKey('sales');
      const rootKey = serializePath([]);
      const parentKey = serializePath(['US']);
      const metricKey = serializePath(['US', metricToken]);
      const cityKey = serializePath(['US', metricToken, 'Boston']);
      const oppositeKey = serializePath(['Current']);
      const rows: PivotTreeData['rows'] =
        axis === 'row'
          ? {
              [rootKey]: makeNode('row', [], true),
              [parentKey]: makeNode('row', ['US'], true),
              [metricKey]: makeNode('row', ['US', metricToken], true),
              [cityKey]: makeNode('row', ['US', metricToken, 'Boston'], false),
            }
          : {
              [rootKey]: makeNode('row', [], true),
              [oppositeKey]: makeNode('row', ['Current'], false),
            };
      const cols: PivotTreeData['cols'] =
        axis === 'col'
          ? {
              [rootKey]: makeNode('col', [], true),
              [parentKey]: makeNode('col', ['US'], true),
              [metricKey]: makeNode('col', ['US', metricToken], true),
              [cityKey]: makeNode('col', ['US', metricToken, 'Boston'], false),
            }
          : {
              [rootKey]: makeNode('col', [], true),
              [oppositeKey]: makeNode('col', ['Current'], false),
            };
      const cells: PivotTreeData['cells'] = {
        [serializeCellKey(
          axis === 'row' ? cityKey : oppositeKey,
          axis === 'col' ? cityKey : oppositeKey,
        )]: {
          rowKey: axis === 'row' ? cityKey : oppositeKey,
          colKey: axis === 'col' ? cityKey : oppositeKey,
          values: { sales: 10 },
        },
      };

      const loaded = hasLoadedChildren({
        axis,
        node: axis === 'row' ? rows[parentKey] : cols[parentKey],
        getRawChildren: getRawChildren(rows, cols),
        groupbyRowsLength: axis === 'row' ? 3 : 1,
        groupbyColsLength: axis === 'col' ? 3 : 1,
        isMetricTokenValue: value => value === metricToken,
        metricIndexForRows: axis === 'row' ? 2 : undefined,
        metricIndexForCols: axis === 'col' ? 2 : undefined,
        cells,
        rows,
        cols,
        visibleRowDepth: axis === 'row' ? 2 : 1,
        visibleColDepth: axis === 'col' ? 2 : 1,
        countDimDepth: path =>
          path.filter(value => value !== metricToken).length,
      });

      expect(loaded).toBe(false);
    },
  );

  it.each(['row', 'col'] as const)(
    'treats a skipped pre-Values %s metric branch as loaded from post-Values cells',
    axis => {
      const metricToken = encodeMetricKey('sales');
      const rootKey = serializePath([]);
      const parentKey = serializePath(['US']);
      const metricKey = serializePath(['US', metricToken]);
      const cityKey = serializePath(['US', metricToken, 'Boston']);
      const oppositeKey = serializePath(['Current']);
      const rows: PivotTreeData['rows'] =
        axis === 'row'
          ? {
              [rootKey]: makeNode('row', [], true),
              [parentKey]: makeNode('row', ['US'], true),
              [metricKey]: makeNode('row', ['US', metricToken], true),
              [cityKey]: makeNode('row', ['US', metricToken, 'Boston'], false),
            }
          : {
              [rootKey]: makeNode('row', [], true),
              [oppositeKey]: makeNode('row', ['Current'], false),
            };
      const cols: PivotTreeData['cols'] =
        axis === 'col'
          ? {
              [rootKey]: makeNode('col', [], true),
              [parentKey]: makeNode('col', ['US'], true),
              [metricKey]: makeNode('col', ['US', metricToken], true),
              [cityKey]: makeNode('col', ['US', metricToken, 'Boston'], false),
            }
          : {
              [rootKey]: makeNode('col', [], true),
              [oppositeKey]: makeNode('col', ['Current'], false),
            };
      const cells: PivotTreeData['cells'] = {
        [serializeCellKey(
          axis === 'row' ? cityKey : oppositeKey,
          axis === 'col' ? cityKey : oppositeKey,
        )]: {
          rowKey: axis === 'row' ? cityKey : oppositeKey,
          colKey: axis === 'col' ? cityKey : oppositeKey,
          values: { sales: 10 },
        },
      };

      const loaded = hasLoadedChildren({
        axis,
        node: axis === 'row' ? rows[metricKey] : cols[metricKey],
        getRawChildren: getRawChildren(rows, cols),
        groupbyRowsLength: axis === 'row' ? 3 : 1,
        groupbyColsLength: axis === 'col' ? 3 : 1,
        isMetricTokenValue: value => value === metricToken,
        metricIndexForRows: axis === 'row' ? 2 : undefined,
        metricIndexForCols: axis === 'col' ? 2 : undefined,
        cells,
        rows,
        cols,
        visibleRowDepth: axis === 'row' ? 2 : 1,
        visibleColDepth: axis === 'col' ? 2 : 1,
        countDimDepth: path =>
          path.filter(value => value !== metricToken).length,
      });

      expect(loaded).toBe(true);
    },
  );
});
