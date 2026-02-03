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
  PivotTreeData,
  PivotTreeNode,
  MetricsLayoutEnum,
} from '../../../src/types';
import { getNonMetricPathParts } from '../../../src/pivot/metricsTotals';
import {
  buildFormattingValueMaps,
  buildVisibleCellEntries,
  deriveMetricKey,
} from '../../../src/pivot/cellUtils';
import {
  encodeMeasureLeafKey,
  encodeMetricKey,
  serializeCellKey,
  serializePath,
} from '../../../src/utils';
import {
  buildBuiltInLeaf,
  buildMeasureLeafOutputKey,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';

const rootKey = serializePath([]);

const buildNode = (
  axis: 'row' | 'col',
  path: PivotTreeNode['path'],
): PivotTreeNode => ({
  axis,
  key: serializePath(path),
  path,
  label: String(path[path.length - 1] ?? 'Total'),
  formattedLabel: String(path[path.length - 1] ?? 'Total'),
  level: path.length,
  hasChildren: false,
});

describe('cellUtils helpers', () => {
  const rowAKey = serializePath(['A']);
  const rowBKey = serializePath(['B']);
  const colC1Key = serializePath(['C1']);
  const colC2Key = serializePath(['C2']);
  const missingRowKey = serializePath(['MissingRow']);
  const missingColKey = serializePath(['MissingCol']);

  const tree: PivotTreeData = {
    rows: {
      [rootKey]: buildNode('row', []),
      [rowAKey]: buildNode('row', ['A']),
      [rowBKey]: buildNode('row', ['B']),
    },
    cols: {
      [rootKey]: buildNode('col', []),
      [colC1Key]: buildNode('col', ['C1']),
      [colC2Key]: buildNode('col', ['C2']),
    },
    cells: {
      [serializeCellKey(rowAKey, rootKey)]: {
        rowKey: rowAKey,
        colKey: rootKey,
        values: { rowVal: 10 },
      },
      [serializeCellKey(rowBKey, rootKey)]: {
        rowKey: rowBKey,
        colKey: rootKey,
        values: { rowVal: 20 },
      },
      [serializeCellKey(rootKey, colC1Key)]: {
        rowKey: rootKey,
        colKey: colC1Key,
        values: { colVal: 30 },
      },
      [serializeCellKey(rootKey, colC2Key)]: {
        rowKey: rootKey,
        colKey: colC2Key,
        values: { colVal: 40 },
      },
      [serializeCellKey(rowAKey, colC1Key)]: {
        rowKey: rowAKey,
        colKey: colC1Key,
        values: { metric: 50 },
      },
      [serializeCellKey(missingRowKey, rootKey)]: {
        rowKey: missingRowKey,
        colKey: rootKey,
        values: { rowVal: 999 },
      },
      [serializeCellKey(rootKey, missingColKey)]: {
        rowKey: rootKey,
        colKey: missingColKey,
        values: { colVal: 999 },
      },
    },
  };

  it('buildFormattingValueMaps collects root axis values for rows and columns', () => {
    const { rowValuesMap, colValuesMap } = buildFormattingValueMaps({
      cells: tree.cells,
      rows: tree.rows,
      cols: tree.cols,
      getNonMetricPathParts: path => getNonMetricPathParts(path, new Set()),
      rootKey,
    });

    expect(rowValuesMap.get(rowAKey)?.rowVal).toBe(10);
    expect(rowValuesMap.get(rowBKey)?.rowVal).toBe(20);
    expect(colValuesMap.get(colC1Key)?.colVal).toBe(30);
    expect(colValuesMap.get(colC2Key)?.colVal).toBe(40);
    expect(rowValuesMap.has(missingRowKey)).toBe(false);
    expect(colValuesMap.has(missingColKey)).toBe(false);
  });

  it('buildVisibleCellEntries filters by visibility and existing nodes', () => {
    const entries = buildVisibleCellEntries({
      cells: tree.cells,
      rows: tree.rows,
      cols: tree.cols,
      visibleRowKeys: new Set([rootKey, rowAKey, missingRowKey]),
      visibleColKeys: new Set([rootKey, colC1Key, missingColKey]),
    });

    const entryKeys = entries.map(entry => entry.cellKey);
    expect(entryKeys).toHaveLength(3);
    expect(entryKeys).toEqual(
      expect.arrayContaining([
        serializeCellKey(rowAKey, rootKey),
        serializeCellKey(rootKey, colC1Key),
        serializeCellKey(rowAKey, colC1Key),
      ]),
    );
  });

  it('derives leaf output keys when leaf tokens live on the other axis', () => {
    const metricKey = 'sales';
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const rowNode = buildNode('row', [
      'Region',
      encodeMeasureLeafKey(ixLeaf.id),
    ]);
    const colNode = buildNode('col', [encodeMetricKey(metricKey)]);
    const cells = {
      [serializeCellKey(rowNode.key, colNode.key)]: {
        rowKey: rowNode.key,
        colKey: colNode.key,
        values: {
          [metricKey]: 10,
          [buildMeasureLeafOutputKey(metricKey, ixLeaf)]: 25,
        },
      },
    };

    const result = deriveMetricKey({
      rowNode,
      colNode,
      metrics: [metricKey],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      cells,
      measureHierarchy: {
        kind: 'measureStackV1',
        groups: [{ metricKey, leaves: [buildValueLeaf(), ixLeaf] }],
        leafTierVisibility: 'visible',
      },
    });

    expect(result).toBe(buildMeasureLeafOutputKey(metricKey, ixLeaf));
  });
});
