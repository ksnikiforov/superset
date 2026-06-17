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
  type AdhocColumn,
  getColumnLabel,
  isPhysicalColumn,
  type QueryFormColumn,
  type TimeGranularity,
} from '@superset-ui/core';
import { type PivotTableQueryFormData } from '../../types';

export type PivotTimeComparisonSpec = {
  temporalColumn: string;
  temporalColumnLabel: string;
  timeGrain: TimeGranularity;
  requiredTimeOffsets: string[];
};

const OFFSET_GRAINS: Record<string, TimeGranularity> = {
  day: 'P1D',
  week: 'P1W',
  month: 'P1M',
  year: 'P1Y',
};

const isTemporalColumn = (
  column: string | undefined,
  temporalLookup?: Record<string, boolean>,
) => Boolean(column && temporalLookup?.[column]);

const resolveTimeGrain = (
  formData: PivotTableQueryFormData,
  requiredTimeOffsets: string[],
): TimeGranularity | undefined => {
  if (formData.extra_form_data?.time_grain_sqla) {
    return formData.extra_form_data.time_grain_sqla as TimeGranularity;
  }
  if (formData.time_grain_sqla) {
    return formData.time_grain_sqla;
  }
  const units = requiredTimeOffsets
    .map(offset => offset.match(/\d+\s+(\w+)\s+(?:ago|later)/)?.[1])
    .filter((unit): unit is string => Boolean(unit));
  if (units.includes('day')) {
    return OFFSET_GRAINS.day;
  }
  if (units.includes('week')) {
    return OFFSET_GRAINS.week;
  }
  if (units.includes('month')) {
    return OFFSET_GRAINS.month;
  }
  if (units.includes('year')) {
    return OFFSET_GRAINS.year;
  }
  return undefined;
};

const resolveTemporalColumn = (
  columns: QueryFormColumn[],
  formData: PivotTableQueryFormData,
): string | undefined => {
  const temporalLookup = formData.temporal_columns_lookup;
  return columns.find(
    column =>
      isPhysicalColumn(column) && isTemporalColumn(column, temporalLookup),
  ) as string | undefined;
};

export const resolvePivotTimeComparison = ({
  columns,
  formData,
  requiredTimeOffsets,
}: {
  columns: QueryFormColumn[];
  formData: PivotTableQueryFormData;
  requiredTimeOffsets: string[];
}): PivotTimeComparisonSpec | undefined => {
  if (requiredTimeOffsets.length === 0) {
    return undefined;
  }
  const temporalColumn = resolveTemporalColumn(columns, formData);
  const timeGrain = resolveTimeGrain(formData, requiredTimeOffsets);
  if (!temporalColumn || !timeGrain) {
    return undefined;
  }
  return {
    temporalColumn,
    temporalColumnLabel: getColumnLabel(temporalColumn),
    timeGrain,
    requiredTimeOffsets,
  };
};

export const buildTemporalBaseAxisColumn = ({
  temporalColumn,
  timeGrain,
}: Pick<
  PivotTimeComparisonSpec,
  'temporalColumn' | 'timeGrain'
>): AdhocColumn =>
  ({
    timeGrain,
    columnType: 'BASE_AXIS',
    sqlExpression: temporalColumn,
    label: temporalColumn,
    expressionType: 'SQL',
  }) as AdhocColumn;
