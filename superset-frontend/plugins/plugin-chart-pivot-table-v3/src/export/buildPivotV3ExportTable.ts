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

const ROW_DEPTH_ATTR = 'data-pivot-row-depth';
const ROW_LABEL_ATTR = 'data-pivot-row-label';
const ROW_AXIS_LABELS_ATTR = 'data-pivot-row-axis-labels';
const ROW_TOTAL_LABEL_ATTR = 'data-pivot-row-total-label';
const EXPORT_CELL_TYPE_ATTR = 'data-pivot-export-type';
const EXPORT_CELL_VALUE_ATTR = 'data-pivot-export-value';
const EXPORT_SUBTOTAL_ROW_ATTR = 'data-pivot-export-subtotal-row';

type RowDepthInfo = {
  row: HTMLTableRowElement;
  depth: number;
  isGrandTotal: boolean;
  isSubtotal: boolean;
};

const getText = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const parseDepth = (row: HTMLTableRowElement) => {
  const depthNode = row.querySelector<HTMLElement>(`[${ROW_DEPTH_ATTR}]`);
  if (!depthNode) {
    return undefined;
  }
  const parsed = Number.parseInt(
    depthNode.getAttribute(ROW_DEPTH_ATTR) ?? '',
    10,
  );
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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

const parseRowTotalLabel = (table: HTMLTableElement): string => {
  const raw = table.getAttribute(ROW_TOTAL_LABEL_ATTR);
  const parsed = getText(raw);
  return parsed || 'Total';
};

const collectRowDepthInfo = (rows: HTMLTableRowElement[]): RowDepthInfo[] =>
  rows
    .map(row => ({
      row,
      depth: parseDepth(row),
      isGrandTotal: row.classList.contains('pivot-grand-total-row'),
      isSubtotal:
        row.cells[0]?.tagName === 'TH' &&
        row.cells[0].classList.contains('subtotal-cell'),
    }))
    .filter(
      (
        entry,
      ): entry is {
        row: HTMLTableRowElement;
        depth: number;
        isGrandTotal: boolean;
        isSubtotal: boolean;
      } => typeof entry.depth === 'number',
    );

const resolveOneBasedDepthNormalization = (depthInfo: RowDepthInfo[]) => {
  const nonGrandDepths = depthInfo
    .filter(entry => !entry.isGrandTotal)
    .map(entry => entry.depth);
  const nonGrandNonSubtotalDepths = depthInfo
    .filter(entry => !entry.isGrandTotal && !entry.isSubtotal)
    .map(entry => entry.depth);
  const depthsForNormalization =
    nonGrandNonSubtotalDepths.length > 0
      ? nonGrandNonSubtotalDepths
      : nonGrandDepths;
  return (
    depthsForNormalization.length > 0 &&
    !depthsForNormalization.some(depth => depth === 0)
  );
};

const normalizeDepth = (
  depth: number,
  shouldNormalizeOneBasedDepth: boolean,
) => (shouldNormalizeOneBasedDepth && depth > 0 ? depth - 1 : depth);

const resolveDepthCount = (
  rows: HTMLTableRowElement[],
  axisLabels: string[],
): number => {
  const depthInfo = collectRowDepthInfo(rows);
  if (depthInfo.length === 0) {
    return axisLabels.length;
  }

  const shouldNormalizeOneBasedDepth =
    resolveOneBasedDepthNormalization(depthInfo);
  const nonGrandDepths = depthInfo
    .filter(entry => !entry.isGrandTotal)
    .map(entry => normalizeDepth(entry.depth, shouldNormalizeOneBasedDepth));
  const normalizedDepths =
    nonGrandDepths.length > 0
      ? nonGrandDepths
      : depthInfo.map(entry =>
          normalizeDepth(entry.depth, shouldNormalizeOneBasedDepth),
        );
  const maxDepth = normalizedDepths.reduce(
    (max, depth) => (depth > max ? depth : max),
    -1,
  );
  const observedDepthCount = maxDepth + 1;

  if (axisLabels.length > 0) {
    if (observedDepthCount <= 0) {
      return axisLabels.length;
    }
    return Math.min(axisLabels.length, observedDepthCount);
  }

  return observedDepthCount;
};

const toHeaderLabels = (depthCount: number, axisLabels: string[]): string[] =>
  Array.from({ length: depthCount }, (_, index) => {
    const explicit = axisLabels[index];
    return explicit && explicit.length > 0 ? explicit : `Row ${index + 1}`;
  });

const replaceCornerWithAxisLabels = (
  table: HTMLTableElement,
  headerLabels: string[],
) => {
  const headerRows = table.tHead ? Array.from(table.tHead.rows) : [];
  if (headerRows.length === 0) {
    return;
  }

  const firstRow = headerRows[0];
  const cornerCell = firstRow.cells[0];
  if (!cornerCell) {
    return;
  }

  const insertBefore = firstRow.cells[1] ?? null;
  cornerCell.remove();

  const fragment = table.ownerDocument.createDocumentFragment();
  headerLabels.forEach(label => {
    const cell = table.ownerDocument.createElement('th');
    cell.rowSpan = headerRows.length;
    cell.textContent = label;
    fragment.appendChild(cell);
  });

  firstRow.insertBefore(fragment, insertBefore);
};

const splitRowHeadersIntoColumns = (
  table: HTMLTableElement,
  depthCount: number,
  rowTotalLabel: string,
) => {
  const bodyRows = Array.from(
    table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  );
  const activePath: string[] = [];
  const depthInfo = collectRowDepthInfo(bodyRows);
  const depthInfoByRow = new WeakMap<HTMLTableRowElement, RowDepthInfo>();
  depthInfo.forEach(entry => {
    depthInfoByRow.set(entry.row, entry);
  });
  const shouldNormalizeOneBasedDepth =
    resolveOneBasedDepthNormalization(depthInfo);

  const rowsForExport = bodyRows.map(row => {
    const firstCell = row.cells[0];
    const sourceHeader =
      firstCell?.tagName === 'TH' ? (firstCell as HTMLTableCellElement) : null;
    const isGrandTotalRow = row.classList.contains('pivot-grand-total-row');
    const isSubtotalRow =
      !isGrandTotalRow && sourceHeader?.classList.contains('subtotal-cell');
    const parsedDepth = depthInfoByRow.get(row)?.depth;
    const depth =
      typeof parsedDepth === 'number'
        ? normalizeDepth(parsedDepth, shouldNormalizeOneBasedDepth)
        : sourceHeader
          ? 0
          : null;
    const clampedDepth =
      typeof depth === 'number'
        ? Math.max(0, Math.min(depth, depthCount - 1))
        : null;
    const rowLabelNode = row.querySelector<HTMLElement>(`[${ROW_LABEL_ATTR}]`);
    const rowLabel = getText(
      rowLabelNode?.textContent ?? sourceHeader?.textContent,
    );
    return {
      row,
      sourceHeader,
      isGrandTotalRow,
      isSubtotalRow,
      clampedDepth,
      rowLabel,
    };
  });

  const rowHasVisibleChildren = (rowIndex: number) => {
    const current = rowsForExport[rowIndex];
    if (
      !current ||
      !current.isSubtotalRow ||
      typeof current.clampedDepth !== 'number'
    ) {
      return false;
    }
    for (let index = rowIndex + 1; index < rowsForExport.length; index += 1) {
      const next = rowsForExport[index];
      if (next.isGrandTotalRow || typeof next.clampedDepth !== 'number') {
        continue;
      }
      if (next.clampedDepth <= current.clampedDepth) {
        return false;
      }
      return true;
    }
    return false;
  };

  rowsForExport.forEach((exportRow, rowIndex) => {
    const {
      row,
      sourceHeader,
      isGrandTotalRow,
      isSubtotalRow,
      clampedDepth,
      rowLabel,
    } = exportRow;

    if (isGrandTotalRow) {
      activePath.length = 0;
    } else if (typeof clampedDepth === 'number') {
      activePath.length = clampedDepth;
      activePath[clampedDepth] = rowLabel;
    }

    const rowValues = Array.from({ length: depthCount }, (_, index) => {
      if (typeof clampedDepth !== 'number') {
        return '';
      }
      if (isGrandTotalRow) {
        return index === 0 ? rowLabel : '';
      }
      return index <= clampedDepth ? (activePath[index] ?? '') : '';
    });
    if (
      isSubtotalRow &&
      rowHasVisibleChildren(rowIndex) &&
      typeof clampedDepth === 'number' &&
      clampedDepth + 1 < depthCount
    ) {
      rowValues[clampedDepth + 1] = rowTotalLabel;
      row.setAttribute(EXPORT_SUBTOTAL_ROW_ATTR, 'true');
    }

    sourceHeader?.remove();

    rowValues.forEach((value, index) => {
      const replacement = table.ownerDocument.createElement('th');
      replacement.textContent = value;
      row.insertBefore(replacement, row.cells[index] ?? null);
    });
  });
};

const promoteTotalRowsForExcel = (
  table: HTMLTableElement,
  rowTotalLabel: string,
) => {
  const bodyRows = Array.from(
    table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  );

  const findFirstNonEmptyCellIndex = (row: HTMLTableRowElement) =>
    Array.from(row.cells).findIndex(
      cell => getText(cell.textContent).length > 0,
    );

  bodyRows.forEach(row => {
    const isGrandTotalRow = row.classList.contains('pivot-grand-total-row');
    const isSubtotalRow = row.getAttribute(EXPORT_SUBTOTAL_ROW_ATTR) === 'true';
    if (!isGrandTotalRow && !isSubtotalRow) {
      return;
    }

    let startIndex = findFirstNonEmptyCellIndex(row);
    if (isSubtotalRow) {
      const totalCellIndex = Array.from(row.cells).findIndex(
        cell => getText(cell.textContent) === rowTotalLabel,
      );
      if (totalCellIndex >= 0) {
        startIndex = totalCellIndex;
      }
    }
    if (startIndex < 0) {
      return;
    }

    for (let index = startIndex; index < row.cells.length; index += 1) {
      const cell = row.cells[index];
      if (cell.tagName === 'TH') {
        cell.classList.add('subtotal-cell');
        continue;
      }
      const replacement = table.ownerDocument.createElement('th');
      Array.from(cell.attributes).forEach(attribute => {
        replacement.setAttribute(attribute.name, attribute.value);
      });
      replacement.className = cell.className;
      replacement.classList.add('subtotal-cell');
      replacement.innerHTML = cell.innerHTML;
      row.replaceChild(replacement, cell);
    }
  });
};

const coerceNumericCellsForExcel = (table: HTMLTableElement) => {
  const numericCells = Array.from(
    table.querySelectorAll<HTMLTableCellElement>(
      `[${EXPORT_CELL_TYPE_ATTR}="number"][${EXPORT_CELL_VALUE_ATTR}]`,
    ),
  );

  numericCells.forEach(numericCell => {
    const cell = numericCell;
    const rawValue = cell.getAttribute(EXPORT_CELL_VALUE_ATTR)?.trim();
    if (!rawValue) {
      return;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return;
    }
    cell.textContent = rawValue;
    cell.setAttribute('data-t', 'n');
    cell.setAttribute('data-v', rawValue);
  });
};

export const buildPivotV3ExportTable = (
  table: HTMLTableElement,
): HTMLTableElement => {
  const cloned = table.cloneNode(true) as HTMLTableElement;
  const bodyRows = Array.from(
    cloned.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  );

  const axisLabels = parseRowAxisLabels(cloned);
  const rowTotalLabel = parseRowTotalLabel(cloned);
  const depthCount = resolveDepthCount(bodyRows, axisLabels);
  if (depthCount <= 0) {
    return cloned;
  }

  replaceCornerWithAxisLabels(cloned, toHeaderLabels(depthCount, axisLabels));
  splitRowHeadersIntoColumns(cloned, depthCount, rowTotalLabel);
  promoteTotalRowsForExcel(cloned, rowTotalLabel);
  coerceNumericCellsForExcel(cloned);

  return cloned;
};
