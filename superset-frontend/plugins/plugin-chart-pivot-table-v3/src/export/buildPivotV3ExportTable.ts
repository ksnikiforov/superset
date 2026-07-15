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
import { type VisibleCellEntry } from '../pivot/cellUtils';
import { getNodeParentKey } from '../pivot/viewModel';
import { type RenderModel } from '../pivot/render/renderModel';

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

  const rowsByKey = new Map(rows.map(entry => [entry.row.key, entry]));
  const isVisibleDescendant = (
    ancestor: PivotTreeNode,
    candidate: PivotTreeNode,
  ) => {
    let parentKey =
      candidate.path.length > 0 ? getNodeParentKey(candidate) : undefined;
    while (parentKey) {
      if (parentKey === ancestor.key) {
        return true;
      }
      const parent = rowsByKey.get(parentKey)?.row;
      parentKey =
        parent && parent.path.length > 0 ? getNodeParentKey(parent) : undefined;
    }
    return false;
  };

  const rowHasVisibleChildren = (current: (typeof rows)[number]) => {
    if (!current.isSubtotal) {
      return false;
    }
    return rows.some(
      next =>
        !next.isGrandTotal &&
        next.depth > current.depth &&
        isVisibleDescendant(current.row, next.row),
    );
  };

  const getRowHeaderValues = (entry: (typeof rows)[number]) => {
    if (entry.isGrandTotal) {
      return Array.from({ length: rowExportDepthCount }, (_, idx) =>
        idx === 0 ? entry.label : '',
      );
    }
    const values = Array.from({ length: rowExportDepthCount }, () => '');
    const ancestors: typeof rows = [];
    let parentKey =
      entry.row.path.length > 0 ? getNodeParentKey(entry.row) : undefined;
    while (parentKey) {
      const parent = rowsByKey.get(parentKey);
      if (!parent || parent.isGrandTotal) {
        break;
      }
      ancestors.unshift(parent);
      parentKey =
        parent.row.path.length > 0 ? getNodeParentKey(parent.row) : undefined;
    }
    [...ancestors, entry].forEach(item => {
      if (item.depth < rowExportDepthCount) {
        values[item.depth] = item.label;
      }
    });
    return values;
  };

  return {
    rowExportDepthCount,
    rowExportRows: new Map(
      rows.map(entry => {
        const values = getRowHeaderValues(entry);
        const isSubtotal =
          entry.isSubtotal &&
          rowHasVisibleChildren(entry) &&
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
      colSpan?: number;
      rowSpan?: number;
    }
  | {
      value: number;
      type: 'number';
      isHeader: boolean;
      colSpan?: number;
      rowSpan?: number;
    };

const textCell = (
  value: string,
  isHeader: boolean,
  spans: Pick<PivotV3ExportSheetCell, 'colSpan' | 'rowSpan'> = {},
): PivotV3ExportSheetCell => ({
  value,
  type: 'string',
  isHeader,
  ...spans,
});

const toExportSheetCell = (
  value: string | number | null | undefined,
  isHeader: boolean,
): PivotV3ExportSheetCell => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { value, type: 'number', isHeader };
  }
  return textCell(
    getText(value === undefined || value === null ? '' : String(value)),
    isHeader,
  );
};

type BuildPivotV3ExportSheetModelParams = {
  rowAxisLabels: readonly string[];
  rowCornerLabel: string;
  rowExportDepthCount: number;
  rowExportRows: Map<string, PivotV3RowExportEntry>;
  renderModel: Pick<
    RenderModel,
    'columnHeaderRows' | 'visibleRows' | 'visibleCols' | 'visibleCellEntries'
  >;
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
  'rowAxisLabels' | 'rowCornerLabel' | 'rowExportDepthCount' | 'formatLabel'
> & {
  columnHeaderRows: RenderModel['columnHeaderRows'];
}): PivotV3ExportSheetCell[][] => {
  if (columnHeaderRows.length === 0) {
    return [
      rowExportDepthCount > 0
        ? rowAxisLabels
            .slice(0, rowExportDepthCount)
            .map(label => textCell(label, true))
        : [textCell(rowCornerLabel, true)],
    ];
  }

  const headerRowCount = columnHeaderRows.length;
  const rowHeaderCount = rowExportDepthCount > 0 ? rowExportDepthCount : 1;
  const rows = Array.from({ length: headerRowCount }, () =>
    Array.from({ length: rowHeaderCount }, () => textCell('', true)),
  );
  if (rowExportDepthCount > 0) {
    rowAxisLabels.slice(0, rowExportDepthCount).forEach((label, index) => {
      rows[0][index] = textCell(label, true, {
        rowSpan: headerRowCount > 1 ? headerRowCount : undefined,
      });
    });
  } else {
    rows[0][0] = textCell(rowCornerLabel, true, {
      rowSpan: headerRowCount > 1 ? headerRowCount : undefined,
    });
  }

  const occupied = Array.from({ length: headerRowCount }, () =>
    Array<boolean>(rowHeaderCount).fill(true),
  );
  columnHeaderRows.forEach((headerCells, rowIndex) => {
    let columnIndex = rowHeaderCount;
    headerCells.forEach(headerCell => {
      while (occupied[rowIndex][columnIndex]) {
        columnIndex += 1;
      }
      const colSpan = Math.max(headerCell.colSpan, 1);
      const rowSpan = Math.max(headerCell.rowSpan, 1);
      while (rows[rowIndex].length < columnIndex) {
        rows[rowIndex].push(textCell('', true));
      }
      rows[rowIndex][columnIndex] = textCell(
        formatLabel(headerCell.node, 'col'),
        true,
        {
          colSpan: colSpan > 1 ? colSpan : undefined,
          rowSpan: rowSpan > 1 ? rowSpan : undefined,
        },
      );
      for (
        let occupiedRow = rowIndex;
        occupiedRow < Math.min(rowIndex + rowSpan, headerRowCount);
        occupiedRow += 1
      ) {
        for (
          let occupiedColumn = columnIndex;
          occupiedColumn < columnIndex + colSpan;
          occupiedColumn += 1
        ) {
          occupied[occupiedRow][occupiedColumn] = true;
          if (occupiedRow === rowIndex && occupiedColumn > columnIndex) {
            rows[occupiedRow][occupiedColumn] = textCell('', true);
          }
        }
      }
      columnIndex += colSpan;
    });
  });

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  rows.forEach(row => {
    while (row.length < columnCount) {
      row.push(textCell('', true));
    }
  });
  return rows;
};

const buildVisibleCellLookup = (visibleCellEntries: VisibleCellEntry[]) => {
  const cellLookup = new Map<string, Map<string, PivotResultCell>>();
  visibleCellEntries.forEach(({ rowNode, colNode, cell }) => {
    const rowCells = cellLookup.get(rowNode.key);
    if (rowCells) {
      rowCells.set(colNode.key, cell);
      return;
    }
    cellLookup.set(rowNode.key, new Map([[colNode.key, cell]]));
  });
  return cellLookup;
};

export const buildPivotV3ExportSheetModel = ({
  rowAxisLabels,
  rowCornerLabel,
  rowExportDepthCount,
  rowExportRows,
  renderModel,
  formatLabel,
  deriveMetricKey,
  formatBodyCell,
  isGrandTotalLikeRow,
}: BuildPivotV3ExportSheetModelParams): PivotV3ExportSheetCell[][] => {
  const { columnHeaderRows, visibleRows, visibleCols, visibleCellEntries } =
    renderModel;
  const visibleCellLookup = buildVisibleCellLookup(visibleCellEntries);
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
    const rowHeaderValues =
      rowExport?.values ??
      (rowExportDepthCount > 0
        ? Array.from({ length: rowExportDepthCount }, () => '')
        : [formatLabel(row, 'row')]);
    const rowCells = rowHeaderValues.map(value => textCell(value, true));
    visibleCols.forEach(col => {
      const cell = visibleCellLookup.get(row.key)?.get(col.key);
      const metricKey = deriveMetricKey(row, col);
      rowCells.push(
        toExportSheetCell(formatBodyCell(row, col, cell, metricKey), isHeader),
      );
    });
    return rowCells;
  });
  return [...headerRows, ...bodyRows];
};

const pivotV3ExportRegistryHost = globalThis as typeof globalThis & {
  __supersetPivotV3ExportSheetDataByChartId?: Map<
    string,
    PivotV3ExportSheetCell[][]
  >;
};
const pivotV3ExportSheetDataByChartId =
  pivotV3ExportRegistryHost.__supersetPivotV3ExportSheetDataByChartId ??
  new Map<string, PivotV3ExportSheetCell[][]>();
pivotV3ExportRegistryHost.__supersetPivotV3ExportSheetDataByChartId =
  pivotV3ExportSheetDataByChartId;

const normalizeExportChartId = (chartId: string | number) => String(chartId);

export const registerPivotV3ExportSheetDataForChart = (
  chartId: string | number,
  sheetData: PivotV3ExportSheetCell[][],
) => {
  pivotV3ExportSheetDataByChartId.set(
    normalizeExportChartId(chartId),
    sheetData,
  );
};

export const unregisterPivotV3ExportSheetDataForChart = (
  chartId: string | number,
  sheetData?: PivotV3ExportSheetCell[][],
) => {
  const normalizedChartId = normalizeExportChartId(chartId);
  if (
    sheetData !== undefined &&
    pivotV3ExportSheetDataByChartId.get(normalizedChartId) !== sheetData
  ) {
    return;
  }
  pivotV3ExportSheetDataByChartId.delete(normalizedChartId);
};

export const getPivotV3ExportSheetDataForChart = (
  chartId: string | number,
): PivotV3ExportSheetCell[][] | undefined =>
  pivotV3ExportSheetDataByChartId.get(normalizeExportChartId(chartId));
