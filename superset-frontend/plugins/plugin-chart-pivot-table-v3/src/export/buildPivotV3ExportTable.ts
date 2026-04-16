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
const EXPORT_CELL_TYPE_ATTR = 'data-pivot-export-type';
const EXPORT_CELL_VALUE_ATTR = 'data-pivot-export-value';

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

const resolveDepthCount = (
  rows: HTMLTableRowElement[],
  axisLabels: string[],
): number => {
  if (axisLabels.length > 0) {
    return axisLabels.length;
  }

  let maxDepth = -1;
  rows.forEach(row => {
    const depth = parseDepth(row);
    if (typeof depth === 'number' && depth > maxDepth) {
      maxDepth = depth;
    }
  });
  return maxDepth + 1;
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
) => {
  const bodyRows = Array.from(
    table.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  );
  const activePath: string[] = [];
  const parsedDepths = bodyRows
    .map(parseDepth)
    .filter((depth): depth is number => typeof depth === 'number');
  const positiveDepths = parsedDepths.filter(depth => depth > 0);
  const shouldNormalizeOneBasedDepth =
    positiveDepths.length > 0 &&
    positiveDepths.every(depth => depth <= depthCount) &&
    positiveDepths.some(depth => depth === depthCount);

  bodyRows.forEach(row => {
    const firstCell = row.cells[0];
    const sourceHeader =
      firstCell?.tagName === 'TH' ? (firstCell as HTMLTableCellElement) : null;
    const parsedDepth = parseDepth(row);
    const depth =
      typeof parsedDepth === 'number'
        ? shouldNormalizeOneBasedDepth && parsedDepth > 0
          ? parsedDepth - 1
          : parsedDepth
        : sourceHeader
          ? 0
          : null;

    const rowLabelNode = row.querySelector<HTMLElement>(`[${ROW_LABEL_ATTR}]`);
    const rowLabel = getText(
      rowLabelNode?.textContent ?? sourceHeader?.textContent,
    );
    const clampedDepth =
      typeof depth === 'number'
        ? Math.max(0, Math.min(depth, depthCount - 1))
        : null;

    if (typeof clampedDepth === 'number') {
      activePath.length = clampedDepth;
      activePath[clampedDepth] = rowLabel;
    }

    const rowValues = Array.from({ length: depthCount }, (_, index) =>
      typeof clampedDepth === 'number' && index <= clampedDepth
        ? (activePath[index] ?? '')
        : '',
    );

    sourceHeader?.remove();

    rowValues.forEach((value, index) => {
      const replacement = table.ownerDocument.createElement('th');
      replacement.textContent = value;
      row.insertBefore(replacement, row.cells[index] ?? null);
    });
  });
};

const coerceNumericCellsForExcel = (table: HTMLTableElement) => {
  const numericCells = Array.from(
    table.querySelectorAll<HTMLTableCellElement>(
      `td[${EXPORT_CELL_TYPE_ATTR}="number"][${EXPORT_CELL_VALUE_ATTR}]`,
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
  const depthCount = resolveDepthCount(bodyRows, axisLabels);
  if (depthCount <= 0) {
    return cloned;
  }

  replaceCornerWithAxisLabels(cloned, toHeaderLabels(depthCount, axisLabels));
  splitRowHeadersIntoColumns(cloned, depthCount);
  coerceNumericCellsForExcel(cloned);

  return cloned;
};
