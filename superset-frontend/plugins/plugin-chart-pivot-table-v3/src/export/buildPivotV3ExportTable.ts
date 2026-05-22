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
    const rowCells = (rowExport?.values ?? []).map(value =>
      textCell(value, true),
    );
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
