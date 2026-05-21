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

import FormulaParser, { type FormulaPosition } from 'fast-formula-parser';
import { DataRecordValue } from '@superset-ui/core';
import {
  makeCellRef,
  transformExcelFormulaToCellRefs,
} from './excelFormulaReferences';

export type CompiledExcelFormula = {
  rawFormula: string;
  normalizedFormula: string;
  transformedFormula: string;
  metricReferences: string[];
  evaluate: (
    values: Record<string, DataRecordValue | undefined>,
    currentValue: DataRecordValue | undefined,
  ) => unknown;
};

const DEFAULT_POSITION: FormulaPosition = { row: 1, col: 1, sheet: 'Sheet1' };
const VALUE_REF = 'A1';

type FormulaCellValue = number | string | boolean | Date | null;

const coerceDataRecordValue = (
  value: DataRecordValue | undefined,
): FormulaCellValue => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return 0;
    }
    const numeric = Number(trimmed);
    if (
      Number.isFinite(numeric) &&
      /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)
    ) {
      return numeric;
    }
    return trimmed.replace(/^['"]|['"]$/g, '');
  }
  return 0;
};

const formulaCache = new Map<string, CompiledExcelFormula>();

export const compileExcelFormula = (
  rawFormula: string,
): CompiledExcelFormula => {
  const cached = formulaCache.get(rawFormula);
  if (cached) {
    return cached;
  }

  const {
    normalizedFormula,
    transformedFormula,
    metricReferences,
    metricReferenceToColumn,
  } = transformExcelFormulaToCellRefs(rawFormula, {
    valueCellRef: VALUE_REF,
    firstMetricColumn: 2,
    row: 1,
  });

  const maxColumn = Math.max(
    1,
    1 + (metricReferences.length > 0 ? metricReferences.length : 0),
  );
  const rowData: FormulaCellValue[] = Array.from({ length: maxColumn }).fill(
    0,
  ) as FormulaCellValue[];

  const parser = new FormulaParser({
    onCell: ({ row, col }) => {
      if (row !== 1 || col < 1 || col > rowData.length) {
        return 0;
      }
      return rowData[col - 1];
    },
    onRange: ref => {
      const safeFromRow = Math.max(1, Math.floor(ref.from.row));
      const safeToRow = Math.max(safeFromRow, Math.floor(ref.to.row));
      const safeFromCol = Math.max(1, Math.floor(ref.from.col));
      const safeToCol = Math.max(safeFromCol, Math.floor(ref.to.col));
      const result: FormulaCellValue[][] = [];
      for (let r = safeFromRow; r <= safeToRow; r += 1) {
        const rowValues: FormulaCellValue[] = [];
        for (let c = safeFromCol; c <= safeToCol; c += 1) {
          if (r === 1 && c >= 1 && c <= rowData.length) {
            rowValues.push(rowData[c - 1]);
          } else {
            rowValues.push(0);
          }
        }
        result.push(rowValues);
      }
      return result;
    },
  });

  const compiled: CompiledExcelFormula = {
    rawFormula,
    normalizedFormula,
    transformedFormula,
    metricReferences,
    evaluate: (values, currentValue) => {
      rowData[0] = coerceDataRecordValue(currentValue);
      metricReferences.forEach(metricKey => {
        const col = metricReferenceToColumn.get(metricKey);
        if (!col) {
          return;
        }
        const idx = col - 1;
        if (idx < 1 || idx >= rowData.length) {
          return;
        }
        rowData[idx] = coerceDataRecordValue(values[metricKey]);
      });

      try {
        const result = parser.parse(transformedFormula, DEFAULT_POSITION);
        const FormulaErrorCtor = (
          FormulaParser as unknown as {
            FormulaError?: new (...args: unknown[]) => Error;
          }
        ).FormulaError;
        if (
          typeof FormulaErrorCtor === 'function' &&
          result instanceof FormulaErrorCtor
        ) {
          return undefined;
        }
        return result;
      } catch {
        return undefined;
      }
    },
  };

  formulaCache.set(rawFormula, compiled);
  return compiled;
};

export const validateExcelFormula = (
  formula: string,
): { valid: true } | { valid: false; message: string } => {
  const normalized = formula.trim();
  if (normalized.length === 0) {
    return { valid: false, message: 'Formula is empty.' };
  }
  const compiled = compileExcelFormula(formula);
  const sampleValues: Record<string, DataRecordValue> = Object.fromEntries(
    compiled.metricReferences.map(ref => [ref, 0]),
  );
  const result = compiled.evaluate(sampleValues, 0);
  if (result === undefined) {
    const cellRefExamples = compiled.metricReferences.map((ref, idx) =>
      makeCellRef(2 + idx, 1),
    );
    const detail =
      cellRefExamples.length > 0
        ? `Expected references like ${VALUE_REF}, ${cellRefExamples.join(', ')}.`
        : `Expected references like ${VALUE_REF}.`;
    return { valid: false, message: `Could not parse formula. ${detail}` };
  }
  return { valid: true };
};
