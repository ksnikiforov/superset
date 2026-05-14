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
  ensureIsArray,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import { MetricsLayoutEnum, type PivotAxis } from '../../types';
import {
  getMetricKey,
  isMetricsPlaceholder,
  METRICS_PLACEHOLDER,
  normalizePlaceholder,
} from '../core/tokens';
import type {
  PivotAxisProgram,
  PivotColumnRef,
  PivotMetricRef,
  PivotProgram,
} from './types';

export type CompilePivotProgramInput = {
  groupbyRows?: QueryFormColumn[] | QueryFormColumn;
  groupbyColumns?: QueryFormColumn[] | QueryFormColumn;
  metrics?: QueryFormMetric[] | QueryFormMetric;
  metricsLayout?: MetricsLayoutEnum;
  lastMoved?: PivotAxis;
};

export type PivotProgramPlacement = {
  rows: QueryFormColumn[];
  cols: QueryFormColumn[];
  axis: PivotAxis;
  layout: MetricsLayoutEnum;
  metricPosition: number;
};

const toColumns = (
  values?: QueryFormColumn[] | QueryFormColumn,
): QueryFormColumn[] =>
  ensureIsArray<QueryFormColumn>(values).map(normalizePlaceholder);

const toMetrics = (
  values?: QueryFormMetric[] | QueryFormMetric,
): QueryFormMetric[] => ensureIsArray<QueryFormMetric>(values);

const toMetricRefs = (metrics: QueryFormMetric[]): PivotMetricRef[] => {
  const refs: PivotMetricRef[] = [];
  metrics.forEach((metric, index) => {
    const key = getMetricKey(metric);
    if (key) {
      refs.push({ key, metric, index });
    }
  });
  return refs;
};

const toDimensionLevels = (columns: PivotColumnRef[]): PivotAxisProgram =>
  columns.map(column => ({
    kind: 'dimension',
    column,
  }));

const withValuesLevel = (
  columns: PivotColumnRef[],
  metrics: PivotMetricRef[],
  insertIndex: number,
): PivotAxisProgram => [
  ...toDimensionLevels(columns.slice(0, insertIndex)),
  { kind: 'values' as const, metrics },
  ...toDimensionLevels(columns.slice(insertIndex)),
];

export const insertValuesPlaceholder = <T>(
  rows: T[],
  cols: T[],
  { axis, index }: { axis: PivotAxis; index: number },
  value: T,
) => {
  const next = { rows: [...rows], cols: [...cols] };
  const target = axis === 'row' ? next.rows : next.cols;
  target.splice(Math.max(0, Math.min(index, target.length)), 0, value);
  return next;
};

export const compilePivotProgram = ({
  groupbyRows,
  groupbyColumns,
  metrics: rawMetrics,
  metricsLayout,
  lastMoved,
}: CompilePivotProgramInput): PivotProgram => {
  const rowsNormalized = toColumns(groupbyRows);
  const columnsNormalized = toColumns(groupbyColumns);
  const rowDimensions = rowsNormalized.filter(
    col => !isMetricsPlaceholder(col),
  );
  const columnDimensions = columnsNormalized.filter(
    col => !isMetricsPlaceholder(col),
  );
  const metrics = toMetricRefs(toMetrics(rawMetrics));
  const preferredAxis: PivotAxis =
    metricsLayout === MetricsLayoutEnum.ROWS ? 'row' : 'col';
  const metricsLayoutResolvedWhenEmpty =
    preferredAxis === 'row'
      ? MetricsLayoutEnum.ROWS
      : MetricsLayoutEnum.COLUMNS;

  if (metrics.length === 0) {
    return {
      rows: toDimensionLevels(rowDimensions),
      columns: toDimensionLevels(columnDimensions),
      rowDimensions,
      columnDimensions,
      metrics,
      metricKeys: [],
      metricsLayoutResolved: metricsLayoutResolvedWhenEmpty,
      valueAxis: undefined,
      metricInsertIndex: -1,
    };
  }

  const rowsHasValues = rowsNormalized.some(isMetricsPlaceholder);
  const columnsHasValues = columnsNormalized.some(isMetricsPlaceholder);
  let valueAxis = preferredAxis;

  if (rowsHasValues && !columnsHasValues) {
    valueAxis = 'row';
  } else if (columnsHasValues && !rowsHasValues) {
    valueAxis = 'col';
  } else if (rowsHasValues && columnsHasValues) {
    valueAxis = lastMoved || preferredAxis;
  } else if (!rowsHasValues && !columnsHasValues) {
    valueAxis = lastMoved || preferredAxis;
  }

  const normalizedAxis =
    valueAxis === 'row' ? rowsNormalized : columnsNormalized;
  const dimensionAxis = valueAxis === 'row' ? rowDimensions : columnDimensions;
  const rawValuesIndex = normalizedAxis.indexOf(METRICS_PLACEHOLDER);
  const metricInsertIndex = Math.min(
    rawValuesIndex >= 0 ? rawValuesIndex : dimensionAxis.length,
    dimensionAxis.length,
  );

  return {
    rows:
      valueAxis === 'row'
        ? withValuesLevel(rowDimensions, metrics, metricInsertIndex)
        : toDimensionLevels(rowDimensions),
    columns:
      valueAxis === 'col'
        ? withValuesLevel(columnDimensions, metrics, metricInsertIndex)
        : toDimensionLevels(columnDimensions),
    rowDimensions,
    columnDimensions,
    metrics,
    metricKeys: metrics.map(metric => metric.key),
    metricsLayoutResolved:
      valueAxis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS,
    valueAxis,
    metricInsertIndex,
  };
};

export const pivotProgramToPlacement = (
  program: PivotProgram,
): PivotProgramPlacement => {
  const fallbackAxis =
    program.metricsLayoutResolved === MetricsLayoutEnum.ROWS ? 'row' : 'col';
  const { rows, cols } = program.valueAxis
    ? insertValuesPlaceholder(
        program.rowDimensions,
        program.columnDimensions,
        { axis: program.valueAxis, index: program.metricInsertIndex },
        METRICS_PLACEHOLDER,
      )
    : {
        rows: program.rowDimensions,
        cols: program.columnDimensions,
      };

  return {
    rows,
    cols,
    axis: program.valueAxis ?? fallbackAxis,
    layout: program.metricsLayoutResolved,
    metricPosition: program.metricInsertIndex,
  };
};

export const resolvePivotProgramPlacement = (
  input: CompilePivotProgramInput,
): PivotProgramPlacement => pivotProgramToPlacement(compilePivotProgram(input));
