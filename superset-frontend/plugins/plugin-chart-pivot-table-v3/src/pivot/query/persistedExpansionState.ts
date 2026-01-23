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
import { type PivotPath } from '../../types';
import { serializePath } from '../core/path';
import { isSubtotalToken } from '../core/tokens';

export type PivotExpansionStateKeys = {
  rowKeys: string[];
  colKeys: string[];
  rows: string[];
  cols: string[];
  collapsedRows: string[];
  collapsedCols: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const coerceAxisKeys = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const keys = value.filter((item): item is string => typeof item === 'string');
  return keys.length === value.length ? keys : undefined;
};

const coerceExpansionAxis = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const resolved: string[] = [];
  value.forEach(item => {
    if (Array.isArray(item)) {
      if ((item as unknown[]).some(isSubtotalToken)) {
        return;
      }
      resolved.push(serializePath(item as PivotPath));
    }
  });
  return resolved;
};

export const coerceExpansionState = (
  value: unknown,
): PivotExpansionStateKeys | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const rowKeys = coerceAxisKeys(value.rowKeys);
  const colKeys = coerceAxisKeys(value.colKeys);
  const rows = coerceExpansionAxis(value.rows);
  const cols = coerceExpansionAxis(value.cols);
  const collapsedRows = coerceExpansionAxis(value.collapsedRows);
  const collapsedCols = coerceExpansionAxis(value.collapsedCols);
  if (!rowKeys || !colKeys || !rows || !cols) {
    return undefined;
  }
  return {
    rowKeys,
    colKeys,
    rows,
    cols,
    collapsedRows: collapsedRows || [],
    collapsedCols: collapsedCols || [],
  };
};

