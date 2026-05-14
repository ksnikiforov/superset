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

import { type PivotResultCell, type PivotTreeNode } from '../types';
import { serializeCellKey } from '../pivot/core/path';
import { type HeaderCellInfo } from '../pivot/viewModel';

const getText = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, ' ').trim();

export type PivotV3RowExportEntry = {
  values: string[];
  isSubtotal: boolean;
};

export type PivotV3RowExportModel = {
  rowExportDepthCount: number;
  rowExportRows: Map<string, PivotV3RowExportEntry>;
};

type BuildPivotV3RowExportModelParams = {
  visibleRows: PivotTreeNode[];
  rowAxisLabels: readonly string[];
  rowTotalLabel: string;
  getNodeDimDepth: (node: PivotTreeNode) => number;
  formatLabel: (node: PivotTreeNode, axis: 'row') => string;
  isGrandTotalLikeRow: (node: PivotTreeNode) => boolean;
  isRowAggregateBold: (node?: PivotTreeNode) => boolean;
};

export const buildPivotV3RowExportModel = ({
  visibleRows,
  rowAxisLabels,
  rowTotalLabel,
  getNodeDimDepth,
  formatLabel,
  isGrandTotalLikeRow,
  isRowAggregateBold,
}: BuildPivotV3RowExportModelParams): PivotV3RowExportModel => {
  if (rowAxisLabels.length === 0) {
    return {
      rowExportDepthCount: 0,
      rowExportRows: new Map(),
    };
  }

  const depths = visibleRows
    .filter(row => !isGrandTotalLikeRow(row))
    .map(row => Math.max(getNodeDimDepth(row) - 1, 0));
  const effectiveDepths =
    depths.length > 0
      ? depths
      : visibleRows.map(row => Math.max(getNodeDimDepth(row) - 1, 0));
  const maxDepth = effectiveDepths.reduce(
    (max, depth) => (depth > max ? depth : max),
    -1,
  );
  const rowExportDepthCount = Math.min(rowAxisLabels.length, maxDepth + 1);

  if (rowExportDepthCount <= 0) {
    return {
      rowExportDepthCount,
      rowExportRows: new Map(),
    };
  }

  const rows = visibleRows.map(row => {
    const isGrandTotal = isGrandTotalLikeRow(row);
    const depth = Math.max(
      0,
      Math.min(
        (isGrandTotal ? 1 : getNodeDimDepth(row)) - 1,
        rowExportDepthCount - 1,
      ),
    );
    return {
      row,
      depth,
      label: formatLabel(row, 'row'),
      isGrandTotal,
      isSubtotal: !isGrandTotal && isRowAggregateBold(row),
    };
  });

  const rowHasVisibleChildren = (rowIndex: number) => {
    const current = rows[rowIndex];
    if (!current?.isSubtotal) {
      return false;
    }
    for (let index = rowIndex + 1; index < rows.length; index += 1) {
      const next = rows[index];
      if (next.isGrandTotal) {
        continue;
      }
      if (next.depth <= current.depth) {
        return false;
      }
      return true;
    }
    return false;
  };

  const activePath: string[] = [];
  return {
    rowExportDepthCount,
    rowExportRows: new Map(
      rows.map((entry, index) => {
        if (entry.isGrandTotal) {
          activePath.length = 0;
        } else {
          activePath.length = entry.depth;
          activePath[entry.depth] = entry.label;
        }
        const values = Array.from({ length: rowExportDepthCount }, (_, idx) => {
          if (entry.isGrandTotal) {
            return idx === 0 ? entry.label : '';
          }
          return idx <= entry.depth ? (activePath[idx] ?? '') : '';
        });
        const isSubtotal =
          entry.isSubtotal &&
          rowHasVisibleChildren(index) &&
          entry.depth + 1 < rowExportDepthCount;
        if (isSubtotal) {
          values[entry.depth + 1] = rowTotalLabel;
        }
        return [entry.row.key, { values, isSubtotal }];
      }),
    ),
  };
};

export type PivotV3ExportSheetCell =
  | {
      value: string;
      type: 'string';
      isHeader: boolean;
    }
  | {
      value: number;
      type: 'number';
      isHeader: boolean;
    };

const textCell = (
  value: string,
  isHeader: boolean,
): PivotV3ExportSheetCell => ({
  value,
  type: 'string',
  isHeader,
});

const numericCell = (
  value: number,
  isHeader: boolean,
): PivotV3ExportSheetCell => ({
  value,
  type: 'number',
  isHeader,
});

const toExportSheetCell = (
  value: string | number | null | undefined,
  isHeader: boolean,
): PivotV3ExportSheetCell => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return numericCell(value, isHeader);
  }
  return textCell(
    getText(value === undefined || value === null ? '' : String(value)),
    isHeader,
  );
};

const appendExpandedLabelCell = (
  target: PivotV3ExportSheetCell[],
  label: string,
  span: number,
  isHeader: boolean,
) => {
  target.push(textCell(label, isHeader));
  for (let index = 1; index < Math.max(span, 1); index += 1) {
    target.push(textCell('', isHeader));
  }
};

type BuildPivotV3ExportSheetModelParams = {
  rowAxisLabels: readonly string[];
  rowCornerLabel: string;
  rowExportDepthCount: number;
  rowExportRows: Map<string, PivotV3RowExportEntry>;
  columnHeaderRows: HeaderCellInfo[][];
  visibleRows: PivotTreeNode[];
  visibleCols: PivotTreeNode[];
  cells: Record<string, PivotResultCell>;
  formatLabel: (node: PivotTreeNode, axis: 'row' | 'col') => string;
  deriveMetricKey: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => string;
  formatBodyCell: (
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
    cell: PivotResultCell | undefined,
    metricKey: string,
  ) => string | number | null | undefined;
  isGrandTotalLikeRow: (node: PivotTreeNode) => boolean;
};

const buildModelHeaderRows = ({
  rowAxisLabels,
  rowCornerLabel,
  rowExportDepthCount,
  columnHeaderRows,
  formatLabel,
}: Pick<
  BuildPivotV3ExportSheetModelParams,
  | 'rowAxisLabels'
  | 'rowCornerLabel'
  | 'rowExportDepthCount'
  | 'columnHeaderRows'
  | 'formatLabel'
>): PivotV3ExportSheetCell[][] => {
  if (columnHeaderRows.length === 0) {
    return [
      rowExportDepthCount > 0
        ? rowAxisLabels
            .slice(0, rowExportDepthCount)
            .map(label => textCell(label, true))
        : [textCell(rowCornerLabel, true)],
    ];
  }

  return columnHeaderRows.map((rowCells, rowIndex) => {
    const cells: PivotV3ExportSheetCell[] =
      rowExportDepthCount > 0
        ? Array.from({ length: rowExportDepthCount }, (_, index) =>
            textCell(rowIndex === 0 ? (rowAxisLabels[index] ?? '') : '', true),
          )
        : rowIndex === 0
          ? [textCell(rowCornerLabel, true)]
          : [];
    rowCells.forEach(cell => {
      appendExpandedLabelCell(
        cells,
        formatLabel(cell.node, 'col'),
        cell.colSpan,
        true,
      );
    });
    return cells;
  });
};

export const buildPivotV3ExportSheetModel = ({
  rowAxisLabels,
  rowCornerLabel,
  rowExportDepthCount,
  rowExportRows,
  columnHeaderRows,
  visibleRows,
  visibleCols,
  cells,
  formatLabel,
  deriveMetricKey,
  formatBodyCell,
  isGrandTotalLikeRow,
}: BuildPivotV3ExportSheetModelParams): PivotV3ExportSheetCell[][] => {
  const headerRows = buildModelHeaderRows({
    rowAxisLabels,
    rowCornerLabel,
    rowExportDepthCount,
    columnHeaderRows,
    formatLabel,
  });
  const bodyRows = visibleRows.map(row => {
    const rowExport = rowExportRows.get(row.key);
    const isHeader = isGrandTotalLikeRow(row) || rowExport?.isSubtotal === true;
    const rowCells = (rowExport?.values ?? []).map(value =>
      textCell(value, true),
    );
    visibleCols.forEach(col => {
      const cell = cells[serializeCellKey(row.key, col.key)];
      const metricKey = deriveMetricKey(row, col);
      rowCells.push(
        toExportSheetCell(formatBodyCell(row, col, cell, metricKey), isHeader),
      );
    });
    return rowCells;
  });
  return [...headerRows, ...bodyRows];
};

const pivotV3ExportSheetDataByChartId = new Map<
  string | number,
  PivotV3ExportSheetCell[][]
>();

export const registerPivotV3ExportSheetDataForChart = (
  chartId: string | number,
  sheetData: PivotV3ExportSheetCell[][],
) => {
  pivotV3ExportSheetDataByChartId.set(chartId, sheetData);
};

export const unregisterPivotV3ExportSheetDataForChart = (
  chartId: string | number,
) => {
  pivotV3ExportSheetDataByChartId.delete(chartId);
};

export const getPivotV3ExportSheetDataForChart = (
  chartId: string | number,
): PivotV3ExportSheetCell[][] | undefined =>
  pivotV3ExportSheetDataByChartId.get(chartId);
