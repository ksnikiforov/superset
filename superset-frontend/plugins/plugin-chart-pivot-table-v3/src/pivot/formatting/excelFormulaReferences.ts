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

import { PivotExcelFormula } from '../../types';

export const normalizeExcelFormulaInput = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('=')) {
    return trimmed.slice(1).trimStart();
  }
  return trimmed;
};

export const toExcelColumnLabel = (col: number): string => {
  if (!Number.isFinite(col) || col <= 0) {
    return '';
  }
  let value = Math.floor(col);
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

export const makeCellRef = (col: number, row: number): string => {
  const colLabel = toExcelColumnLabel(col);
  if (!colLabel || !Number.isFinite(row) || row <= 0) {
    return '';
  }
  return `${colLabel}${Math.floor(row)}`;
};

const isIdentifierStart = (char: string): boolean => /[A-Za-z_]/.test(char);
const isIdentifierPart = (char: string): boolean => /[A-Za-z0-9_.]/.test(char);

export type ExcelFormulaTransformResult = {
  normalizedFormula: string;
  transformedFormula: string;
  metricReferences: string[];
  metricReferenceToColumn: Map<string, number>;
};

export const transformExcelFormulaToCellRefs = (
  rawFormula: string,
  {
    valueCellRef = 'A1',
    firstMetricColumn = 2,
    row = 1,
  }: {
    valueCellRef?: string;
    firstMetricColumn?: number;
    row?: number;
  } = {},
): ExcelFormulaTransformResult => {
  const normalizedFormula = normalizeExcelFormulaInput(rawFormula);
  const metricReferences: string[] = [];
  const metricReferenceToColumn = new Map<string, number>();
  let inSingle = false;
  let inDouble = false;

  let nextColumn = Math.max(1, Math.floor(firstMetricColumn));
  let transformedFormula = '';

  for (let idx = 0; idx < normalizedFormula.length; idx += 1) {
    const char = normalizedFormula[idx];
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    }
    if (inSingle || inDouble) {
      transformedFormula += char;
      continue;
    }

    if (char === '[') {
      const end = normalizedFormula.indexOf(']', idx + 1);
      if (end > idx) {
        const rawRef = normalizedFormula.slice(idx + 1, end).trim();
        if (rawRef.length > 0) {
          const existingColumn = metricReferenceToColumn.get(rawRef);
          let resolvedColumn = existingColumn;
          if (!resolvedColumn) {
            resolvedColumn = nextColumn;
            metricReferenceToColumn.set(rawRef, resolvedColumn);
            metricReferences.push(rawRef);
            nextColumn += 1;
          }
          transformedFormula += makeCellRef(resolvedColumn, row);
          idx = end;
          continue;
        }
        idx = end;
        transformedFormula += char;
        continue;
      }
    }

    if (isIdentifierStart(char)) {
      let end = idx + 1;
      while (end < normalizedFormula.length) {
        const next = normalizedFormula[end];
        if (!isIdentifierPart(next)) {
          break;
        }
        end += 1;
      }
      const identifier = normalizedFormula.slice(idx, end);
      transformedFormula += identifier === 'value' ? valueCellRef : identifier;
      idx = end - 1;
      continue;
    }

    transformedFormula += char;
  }

  return {
    normalizedFormula,
    transformedFormula,
    metricReferences,
    metricReferenceToColumn,
  };
};

export const extractMetricReferencesFromExcelFormula = (formula: string) =>
  transformExcelFormulaToCellRefs(formula).metricReferences;

export const isPivotExcelFormula = (
  value: unknown,
): value is PivotExcelFormula => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === 'excel' && typeof record.formula === 'string';
};

export const normalizePivotExcelFormula = (
  value: unknown,
): PivotExcelFormula | undefined => {
  if (!isPivotExcelFormula(value)) {
    return undefined;
  }
  const formula = value.formula.trim();
  if (formula.length === 0) {
    return undefined;
  }
  return { kind: 'excel', formula };
};
