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
  type BinaryQueryObjectFilterClause,
  type DataRecordValue,
  GenericDataType,
  getColumnLabel,
  type QueryFormColumn,
  type QueryObjectFilterClause,
  type UnaryQueryObjectFilterClause,
} from '@superset-ui/core';
import { type PivotPath } from '../../types';

const isNullish = (value: PivotPath[number]) =>
  value === null || value === undefined;

const normalizeNumericValue = (value: string): DataRecordValue => {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
};

const normalizeBooleanValue = (value: string): DataRecordValue => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return value;
};

export const normalizeTemporalValue = (
  value: string | number,
): DataRecordValue => {
  if (typeof value === 'string' && /[a-zA-Z]/.test(value)) {
    return value;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  if (Math.abs(parsed) >= 1e11) {
    return new Date(parsed).toISOString();
  }
  return value;
};

export const coerceValueForColumn = (
  value: PivotPath[number],
  column?: QueryFormColumn,
  colTypeMap?: Record<string, GenericDataType>,
): PivotPath[number] => {
  if (value === null || value === undefined || !column || !colTypeMap) {
    return value;
  }
  const label = getColumnLabel(column);
  const type = colTypeMap[label];
  if (!type) {
    return value;
  }
  if (type === GenericDataType.Numeric) {
    return typeof value === 'string' ? normalizeNumericValue(value) : value;
  }
  if (type === GenericDataType.Temporal) {
    return normalizeTemporalValue(value as string | number);
  }
  if (type === GenericDataType.Boolean) {
    return typeof value === 'string' ? normalizeBooleanValue(value) : value;
  }
  return value;
};

export const buildPathFilters = (
  groupby: QueryFormColumn[],
  path: PivotPath,
  colTypeMap?: Record<string, GenericDataType>,
): QueryObjectFilterClause[] =>
  path.map((value, index) => {
    const column = groupby[index];
    const resolvedValue = coerceValueForColumn(value, column, colTypeMap);
    if (isNullish(value)) {
      return {
        col: getColumnLabel(groupby[index]),
        op: 'IS NULL',
      } as UnaryQueryObjectFilterClause;
    }
    return {
      col: getColumnLabel(groupby[index]),
      op: '==',
      val: resolvedValue,
    } as BinaryQueryObjectFilterClause;
  });
