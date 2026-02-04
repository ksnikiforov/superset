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
  type DataRecordValue,
  type ExtraFormData,
  GenericDataType,
} from '@superset-ui/core';
import { type PivotTableQueryFormData } from '../../types';
import { normalizeTemporalValue } from './pathFilters';

type ExtraFormDataFilter = {
  col?: string;
  op?: string;
  val?: DataRecordValue | DataRecordValue[];
};

const looksLikeEpoch = (value: DataRecordValue): boolean => {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) && Math.abs(numeric) >= 1e11;
};

const shouldCoerceTemporalValue = ({
  value,
  column,
  colTypeMap,
  temporalLookup,
}: {
  value: DataRecordValue;
  column?: string;
  colTypeMap?: Record<string, GenericDataType>;
  temporalLookup?: Record<string, boolean>;
}): boolean => {
  if (column) {
    const type = colTypeMap?.[column];
    if (type === GenericDataType.Temporal) {
      return true;
    }
    if (temporalLookup?.[column]) {
      return true;
    }
  }
  return looksLikeEpoch(value);
};

const coerceTemporalValue = (value: DataRecordValue): DataRecordValue => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return value;
  }
  return normalizeTemporalValue(value);
};

const normalizeFilterValue = ({
  value,
  column,
  colTypeMap,
  temporalLookup,
}: {
  value: DataRecordValue;
  column?: string;
  colTypeMap?: Record<string, GenericDataType>;
  temporalLookup?: Record<string, boolean>;
}): DataRecordValue =>
  shouldCoerceTemporalValue({ value, column, colTypeMap, temporalLookup })
    ? coerceTemporalValue(value)
    : value;

const normalizeExtraFormDataFilters = (
  extraFormData: ExtraFormData,
  colTypeMap?: Record<string, GenericDataType>,
  temporalLookup?: Record<string, boolean>,
): ExtraFormData => {
  if (!Array.isArray(extraFormData.filters) || extraFormData.filters.length === 0) {
    return extraFormData;
  }
  let hasChanges = false;
  const nextFilters = extraFormData.filters.map(filter => {
    if (!filter || typeof filter !== 'object') {
      return filter;
    }
    const { col, val } = filter as ExtraFormDataFilter;
    if (val === undefined) {
      return filter;
    }
    if (Array.isArray(val)) {
      let arrayChanged = false;
      const nextValues = val.map(item => {
        const normalized = normalizeFilterValue({
          value: item,
          column: col,
          colTypeMap,
          temporalLookup,
        });
        if (normalized !== item) {
          arrayChanged = true;
        }
        return normalized;
      });
      if (!arrayChanged) {
        return filter;
      }
      hasChanges = true;
      return { ...filter, val: nextValues };
    }
    const nextValue = normalizeFilterValue({
      value: val,
      column: col,
      colTypeMap,
      temporalLookup,
    });
    if (nextValue === val) {
      return filter;
    }
    hasChanges = true;
    return { ...filter, val: nextValue };
  });
  if (!hasChanges) {
    return extraFormData;
  }
  return {
    ...extraFormData,
    filters: nextFilters,
  };
};

export const normalizeFormDataExtraFilters = (
  formData: PivotTableQueryFormData,
): PivotTableQueryFormData => {
  const extraFormData = formData.extra_form_data;
  if (!extraFormData) {
    return formData;
  }
  const normalizedExtra = normalizeExtraFormDataFilters(
    extraFormData,
    formData.colTypeMap,
    formData.temporal_columns_lookup,
  );
  if (normalizedExtra === extraFormData) {
    return formData;
  }
  return {
    ...formData,
    extra_form_data: normalizedExtra,
  };
};
