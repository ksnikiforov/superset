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
  buildPivotV3ExportSheetModel,
  buildPivotV3RowExportModel,
} from '../../../src/export/buildPivotV3ExportTable';
import { type PivotResultCell, type PivotTreeNode } from '../../../src/types';
import { type VisibleCellEntry } from '../../../src/pivot/cellUtils';
import { serializeCellKey, serializePath } from '../../../src/pivot/core/path';

const rowNode = (
  path: string[],
  overrides: Partial<PivotTreeNode> = {},
): PivotTreeNode => ({
  axis: 'row',
  key: serializePath(path),
  path,
  label: path[path.length - 1] ?? 'Grand total',
  formattedLabel: path[path.length - 1] ?? 'Grand total',
  level: path.length,
  hasChildren: false,
  ...overrides,
});

const colNode = (
  path: string[],
  overrides: Partial<PivotTreeNode> = {},
): PivotTreeNode => ({
  axis: 'col',
  key: serializePath(path),
  path,
  label: path[path.length - 1] ?? 'Metric',
  formattedLabel: path[path.length - 1] ?? 'Metric',
  level: path.length,
  hasChildren: false,
  ...overrides,
});

const cell = (
  row: PivotTreeNode,
  col: PivotTreeNode,
  metricKey: string,
  value: number | string,
): [string, PivotResultCell] => [
  serializeCellKey(row.key, col.key),
  {
    rowKey: row.key,
    colKey: col.key,
    values: { [metricKey]: value },
  },
];

const visibleCellEntries = (
  cells: Record<string, PivotResultCell>,
  visibleRows: PivotTreeNode[],
  visibleCols: PivotTreeNode[],
): VisibleCellEntry[] => {
  const rowsByKey = new Map(visibleRows.map(row => [row.key, row]));
  const colsByKey = new Map(visibleCols.map(col => [col.key, col]));
  return Object.entries(cells).flatMap(([cellKey, resultCell]) => {
    const rowNode = rowsByKey.get(resultCell.rowKey);
    const colNode = colsByKey.get(resultCell.colKey);
    return rowNode && colNode
      ? [{ cellKey, cell: resultCell, rowNode, colNode }]
      : [];
  });
};

describe('pivot v3 export worksheet model', () => {
  test('projects visible row hierarchy values without DOM metadata', () => {
    const grandTotal = rowNode([], { key: 'grand-total' });
    const west = rowNode(['West'], { hasChildren: true });
    const sf = rowNode(['West', 'San Francisco']);

    const { rowExportDepthCount, rowExportRows } = buildPivotV3RowExportModel({
      visibleRows: [grandTotal, west, sf],
      rowAxisLabels: ['Region', 'City', 'Store'],
      rowTotalLabel: 'Total',
      getNodeDimDepth: node => node.path.length,
      formatLabel: node => node.formattedLabel,
      isGrandTotalLikeRow: node => node === grandTotal,
      isRowAggregateBold: () => false,
    });

    expect(rowExportDepthCount).toBe(2);
    expect(rowExportRows.get(grandTotal.key)?.values).toEqual([
      'Grand total',
      '',
    ]);
    expect(rowExportRows.get(west.key)?.values).toEqual(['West', '']);
    expect(rowExportRows.get(sf.key)?.values).toEqual([
      'West',
      'San Francisco',
    ]);
  });

  test('projects row hierarchy from materialized parents instead of visible order', () => {
    const west = rowNode(['West'], { hasChildren: true });
    const east = rowNode(['East'], { hasChildren: true });
    const sf = rowNode(['West', 'San Francisco']);

    const { rowExportRows } = buildPivotV3RowExportModel({
      visibleRows: [west, east, sf],
      rowAxisLabels: ['Region', 'City'],
      rowTotalLabel: 'Total',
      getNodeDimDepth: node => node.path.length,
      formatLabel: node => node.formattedLabel,
      isGrandTotalLikeRow: () => false,
      isRowAggregateBold: () => false,
    });

    expect(rowExportRows.get(sf.key)?.values).toEqual([
      'West',
      'San Francisco',
    ]);
  });

  test('builds worksheet cells from render rows, headers, and visible cells', () => {
    const west = rowNode(['West']);
    const sf = rowNode(['West', 'San Francisco']);
    const sales = colNode(['2025', 'Sales']);
    const profit = colNode(['2025', 'Profit']);
    const totalSales = colNode(['Grand Total', 'Sales']);
    const totalProfit = colNode(['Grand Total', 'Profit']);
    const { rowExportDepthCount, rowExportRows } = buildPivotV3RowExportModel({
      visibleRows: [west, sf],
      rowAxisLabels: ['Region', 'City'],
      rowTotalLabel: 'Total',
      getNodeDimDepth: node => node.path.length,
      formatLabel: node => node.formattedLabel,
      isGrandTotalLikeRow: () => false,
      isRowAggregateBold: () => false,
    });
    const visibleRows = [west, sf];
    const visibleCols = [sales, profit, totalSales, totalProfit];
    const cells = Object.fromEntries([
      cell(west, sales, 'Sales', 10),
      cell(west, profit, 'Profit', 1),
      cell(west, totalSales, 'Sales', 20),
      cell(west, totalProfit, 'Profit', 2),
      cell(sf, sales, 'Sales', 5),
      cell(sf, profit, 'Profit', 0.5),
      cell(sf, totalSales, 'Sales', 8),
      cell(sf, totalProfit, 'Profit', 0.8),
    ]);

    const sheet = buildPivotV3ExportSheetModel({
      rowAxisLabels: ['Region', 'City'],
      rowCornerLabel: 'Rows',
      rowExportDepthCount,
      rowExportRows,
      renderModel: {
        columnHeaderRows: [
          [
            { node: colNode(['2025']), colSpan: 2, rowSpan: 1 },
            { node: colNode(['Grand Total']), colSpan: 2, rowSpan: 1 },
          ],
          [
            { node: sales, colSpan: 1, rowSpan: 1 },
            { node: profit, colSpan: 1, rowSpan: 1 },
            { node: totalSales, colSpan: 1, rowSpan: 1 },
            { node: totalProfit, colSpan: 1, rowSpan: 1 },
          ],
        ],
        visibleRows,
        visibleCols,
        visibleCellEntries: visibleCellEntries(cells, visibleRows, visibleCols),
      },
      formatLabel: node => node.formattedLabel,
      deriveMetricKey: (_row, col) => String(col.label),
      formatBodyCell: (_row, _col, resultCell, metricKey) =>
        resultCell?.values[metricKey] as string | number | null | undefined,
      isGrandTotalLikeRow: () => false,
    });

    expect(sheet.map(row => row.map(entry => entry.value))).toEqual([
      ['Region', 'City', '2025', '', 'Grand Total', ''],
      ['', '', 'Sales', 'Profit', 'Sales', 'Profit'],
      ['West', '', 10, 1, 20, 2],
      ['West', 'San Francisco', 5, 0.5, 8, 0.8],
    ]);
    expect(sheet[2][2]).toMatchObject({ type: 'number', value: 10 });
  });

  test('marks subtotal worksheet rows as headers', () => {
    const parent = rowNode(['A'], { isSubtotal: true, hasChildren: true });
    const child = rowNode(['A', 'Road-150']);
    const sales = colNode(['Sales']);
    const { rowExportDepthCount, rowExportRows } = buildPivotV3RowExportModel({
      visibleRows: [parent, child],
      rowAxisLabels: ['Store', 'Product'],
      rowTotalLabel: 'Total',
      getNodeDimDepth: node => node.path.length,
      formatLabel: node => node.formattedLabel,
      isGrandTotalLikeRow: () => false,
      isRowAggregateBold: node => node === parent,
    });

    const visibleRows = [parent, child];
    const visibleCols = [sales];
    const cells = Object.fromEntries([
      cell(parent, sales, 'Sales', 100),
      cell(child, sales, 'Sales', 60),
    ]);

    const sheet = buildPivotV3ExportSheetModel({
      rowAxisLabels: ['Store', 'Product'],
      rowCornerLabel: 'Rows',
      rowExportDepthCount,
      rowExportRows,
      renderModel: {
        columnHeaderRows: [[{ node: sales, colSpan: 1, rowSpan: 1 }]],
        visibleRows,
        visibleCols,
        visibleCellEntries: visibleCellEntries(cells, visibleRows, visibleCols),
      },
      formatLabel: node => node.formattedLabel,
      deriveMetricKey: () => 'Sales',
      formatBodyCell: (_row, _col, resultCell, metricKey) =>
        resultCell?.values[metricKey] as string | number | null | undefined,
      isGrandTotalLikeRow: () => false,
    });

    expect(sheet.map(row => row.map(entry => entry.value))).toEqual([
      ['Store', 'Product', 'Sales'],
      ['A', 'Total', 100],
      ['A', 'Road-150', 60],
    ]);
    expect(sheet[1][2]).toMatchObject({ isHeader: true, type: 'number' });
    expect(sheet[2][2]).toMatchObject({ isHeader: false, type: 'number' });
  });
});
