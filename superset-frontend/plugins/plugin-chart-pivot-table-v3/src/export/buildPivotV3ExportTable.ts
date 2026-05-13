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

import { type PivotTreeNode } from '../types';

const ROW_DEPTH_COUNT_ATTR = 'data-pivot-row-depth-count';
const ROW_EXPORT_VALUES_ATTR = 'data-pivot-row-export-values';
const ROW_AXIS_LABELS_ATTR = 'data-pivot-row-axis-labels';
const EXPORT_CELL_TYPE_ATTR = 'data-pivot-export-type';
const EXPORT_CELL_VALUE_ATTR = 'data-pivot-export-value';
const EXPORT_SUBTOTAL_ROW_ATTR = 'data-pivot-export-subtotal-row';

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

const parseRowAxisLabels = (table: HTMLTableElement): string[] => {
  const raw = table.getAttribute(ROW_AXIS_LABELS_ATTR);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(value => getText(typeof value === 'string' ? value : String(value)))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const resolveDepthCount = (
  table: HTMLTableElement,
  axisLabels: string[],
): number => {
  if (axisLabels.length === 0) {
    return 0;
  }
  const parsed = Number.parseInt(
    table.getAttribute(ROW_DEPTH_COUNT_ATTR) ?? '',
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return axisLabels.length;
  }
  return Math.min(axisLabels.length, parsed);
};

const toHeaderLabels = (depthCount: number, axisLabels: string[]): string[] =>
  axisLabels.slice(0, depthCount);

const parseRowExportValues = (
  row: HTMLTableRowElement,
  depthCount: number,
): string[] | null => {
  const raw = row.getAttribute(ROW_EXPORT_VALUES_ATTR);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return Array.from({ length: depthCount }, (_, index) =>
      getText(
        typeof parsed[index] === 'string'
          ? parsed[index]
          : String(parsed[index] ?? ''),
      ),
    );
  } catch {
    return null;
  }
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

const appendExpandedTextCell = (
  target: PivotV3ExportSheetCell[],
  cell: HTMLTableCellElement,
  isHeader: boolean,
) => {
  const span = Math.max(cell.colSpan || 1, 1);
  target.push(textCell(getText(cell.textContent), isHeader));
  for (let index = 1; index < span; index += 1) {
    target.push(textCell('', isHeader));
  }
};

const buildHeaderRows = (
  table: HTMLTableElement,
  headerLabels: string[],
): PivotV3ExportSheetCell[][] => {
  const depthCount = headerLabels.length;
  return (table.tHead ? Array.from(table.tHead.rows) : []).map(
    (row, rowIndex) => {
      const cells: PivotV3ExportSheetCell[] = [];
      if (depthCount > 0) {
        if (rowIndex === 0) {
          headerLabels.forEach(label => cells.push(textCell(label, true)));
        } else {
          headerLabels.forEach(() => cells.push(textCell('', true)));
        }
      }
      Array.from(row.cells).forEach((cell, cellIndex) => {
        if (depthCount > 0 && rowIndex === 0 && cellIndex === 0) {
          return;
        }
        appendExpandedTextCell(cells, cell, true);
      });
      return cells;
    },
  );
};

const parseValueCell = (
  cell: HTMLTableCellElement,
  isHeader: boolean,
): PivotV3ExportSheetCell => {
  const rawValue = cell.getAttribute(EXPORT_CELL_VALUE_ATTR)?.trim();
  if (
    cell.getAttribute(EXPORT_CELL_TYPE_ATTR) === 'number' &&
    rawValue !== undefined &&
    rawValue.length > 0
  ) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return numericCell(parsed, isHeader);
    }
  }
  return textCell(getText(cell.textContent), isHeader);
};

const buildBodyRows = (
  table: HTMLTableElement,
  depthCount: number,
): PivotV3ExportSheetCell[][] =>
  Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr')).map(
    row => {
      const rowValues = parseRowExportValues(row, depthCount);
      const isGrandTotalRow = row.classList.contains('pivot-grand-total-row');
      const isSubtotalRow =
        row.getAttribute(EXPORT_SUBTOTAL_ROW_ATTR) === 'true';
      const cells: PivotV3ExportSheetCell[] = [];

      if (rowValues) {
        rowValues.forEach(value => cells.push(textCell(value, true)));
      }

      Array.from(row.cells).forEach((cell, cellIndex) => {
        if (rowValues && cellIndex === 0 && cell.tagName === 'TH') {
          return;
        }
        const span = Math.max(cell.colSpan || 1, 1);
        const isHeader =
          cell.tagName === 'TH' || isGrandTotalRow || isSubtotalRow;
        cells.push(parseValueCell(cell, isHeader));
        for (let index = 1; index < span; index += 1) {
          cells.push(textCell('', isHeader));
        }
      });

      return cells;
    },
  );

export const buildPivotV3ExportSheetData = (
  table: HTMLTableElement,
): PivotV3ExportSheetCell[][] => {
  const axisLabels = parseRowAxisLabels(table);
  const depthCount = resolveDepthCount(table, axisLabels);
  const headerRows = buildHeaderRows(
    table,
    toHeaderLabels(depthCount, axisLabels),
  );
  return [...headerRows, ...buildBodyRows(table, depthCount)];
};

export const buildPivotV3ExportTable = (
  table: HTMLTableElement,
): HTMLTableElement => {
  const exportRows = buildPivotV3ExportSheetData(table);
  const exported = table.ownerDocument.createElement('table');
  const headerRowCount = table.tHead?.rows.length ?? 0;
  const head = table.ownerDocument.createElement('thead');
  const body = table.ownerDocument.createElement('tbody');

  exportRows.forEach((row, rowIndex) => {
    const targetSection = rowIndex < headerRowCount ? head : body;
    const outputRow = table.ownerDocument.createElement('tr');
    row.forEach(cell => {
      const outputCell = table.ownerDocument.createElement(
        cell.isHeader ? 'th' : 'td',
      );
      outputCell.textContent = String(cell.value);
      if (cell.type === 'number') {
        outputCell.setAttribute('data-t', 'n');
        outputCell.setAttribute('data-v', String(cell.value));
      }
      outputRow.appendChild(outputCell);
    });
    targetSection.appendChild(outputRow);
  });

  if (head.rows.length > 0) {
    exported.appendChild(head);
  }
  if (body.rows.length > 0) {
    exported.appendChild(body);
  }

  return exported;
};
