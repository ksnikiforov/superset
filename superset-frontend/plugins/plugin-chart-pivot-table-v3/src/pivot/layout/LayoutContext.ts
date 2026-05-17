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
  QueryFormColumn,
  QueryFormMetric,
} from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  PivotTableQueryFormData,
  TotalPosition,
  MeasureHierarchy,
  MeasureLeavesByMetricKey,
} from '../../types';
import {
  buildResolvedMetricLabelMap,
  normalizeSubtotalLevels,
  resolveExpandLevel,
} from '../../utils';
import { decodeMetricKey, getMetricKeys } from '../core/tokens';
import {
  coerceMeasureLeavesByMetric,
  collectRequiredTimeOffsets,
} from '../measureLeaves';
import {
  compilePivotProgram,
  pivotProgramToPlacement,
} from '../runtime/compilePivotProgram';
import type { PivotProgram } from '../runtime/types';

export type PivotLayoutSpec = Pick<
  PivotTableQueryFormData,
  | 'groupbyRows'
  | 'groupbyColumns'
  | 'metrics'
  | 'measureLeavesByMetric'
  | 'metricLabelMap'
  | 'verboseMap'
  | 'metricsLayout'
  | 'rowTotals'
  | 'colTotals'
  | 'rowTotalPosition'
  | 'colTotalPosition'
  | 'rowSubTotals'
  | 'rowSubtotalLevels'
  | 'colSubtotalLevels'
  | 'rowSubtotalPosition'
  | 'colSubtotalPosition'
  | 'startCollapsed'
  | 'initialDepth'
  | 'expandRowsLevel'
  | 'expandColumnsLevel'
> & {
  lastMoved?: 'row' | 'col';
  pivotProgram?: PivotProgram;
};

export type LayoutContext = {
  groupbyRowsRaw: QueryFormColumn[];
  groupbyColumnsRaw: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricKeys: string[];
  metricLabelSet: Set<string>;
  metricLabelMap: Map<string, string>;
  measureHierarchy: MeasureHierarchy;
  requiredTimeOffsets: string[];
  pivotProgram: PivotProgram;
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  colSubtotalLevelsForQuery: number[];
  rowTotals: boolean;
  colTotals: boolean;
  rowSubTotals: boolean;
  rowTotalPosition: TotalPosition;
  colTotalPosition: TotalPosition;
  rowSubtotalPosition: TotalPosition;
  colSubtotalPosition: TotalPosition;
  startCollapsed: boolean;
  initialDepth: number;
  resolvedExpandRowsLevel: number;
  resolvedExpandColsLevel: number;
  isMetricTokenValue: (val: unknown) => boolean;
};

const normalizeTotalPosition = (value: unknown): TotalPosition => {
  if (value === 'end') {
    return 'end';
  }
  return 'start';
};

export const buildLayoutContext = (
  layoutSpec: PivotLayoutSpec,
): LayoutContext => {
  const inputGroupbyRowsRaw = ensureIsArray<QueryFormColumn>(
    layoutSpec.groupbyRows,
  );
  const inputGroupbyColumnsRaw = ensureIsArray<QueryFormColumn>(
    layoutSpec.groupbyColumns,
  );
  const metrics = ensureIsArray<QueryFormMetric>(layoutSpec.metrics);
  const metricKeys = getMetricKeys(metrics);
  const metricLabelSet = new Set(metricKeys);
  const labelOverrides =
    (layoutSpec.metricLabelMap as Record<string, string> | undefined) ?? {};
  const verboseMap =
    (layoutSpec.verboseMap as Record<string, string> | undefined) ?? {};
  const metricLabelMap = buildResolvedMetricLabelMap({
    metrics,
    metricLabelMap: labelOverrides,
    verboseMap,
  });
  const measureLeavesByMetric = coerceMeasureLeavesByMetric(
    metricKeys,
    layoutSpec.measureLeavesByMetric as MeasureLeavesByMetricKey | undefined,
  );
  const measureHierarchy: MeasureHierarchy = {
    kind: 'measureStackV1',
    groups: metricKeys.map(metricKey => ({
      metricKey,
      leaves: measureLeavesByMetric[metricKey] ?? [],
    })),
    leafTierVisibility: metricKeys.some(
      metricKey => (measureLeavesByMetric[metricKey] ?? []).length > 1,
    )
      ? 'visible'
      : 'hidden',
  };
  const requiredTimeOffsets = collectRequiredTimeOffsets(measureHierarchy);

  const pivotProgram =
    layoutSpec.pivotProgram ??
    compilePivotProgram({
      groupbyRows: inputGroupbyRowsRaw,
      groupbyColumns: inputGroupbyColumnsRaw,
      metrics,
      metricsLayout: layoutSpec.metricsLayout as MetricsLayoutEnum,
      lastMoved: layoutSpec.lastMoved,
    });
  const rawGroupbyPlacement = layoutSpec.pivotProgram
    ? pivotProgramToPlacement(pivotProgram)
    : undefined;
  const groupbyRowsRaw = rawGroupbyPlacement?.rows ?? inputGroupbyRowsRaw;
  const groupbyColumnsRaw = rawGroupbyPlacement?.cols ?? inputGroupbyColumnsRaw;

  const { rowDimensions, columnDimensions } = pivotProgram;

  const rowTotals = layoutSpec.rowTotals ?? false;
  const colTotals = layoutSpec.colTotals ?? false;

  const { metricsLayoutResolved } = pivotProgram;
  const { metricInsertIndex } = pivotProgram;

  const rowSubTotalsEnabled = layoutSpec.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(rowDimensions.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    layoutSpec.rowSubtotalLevels,
    maxRowSubtotalDepth,
    colTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(columnDimensions.length - 1, 0);
  const colSubtotalLevels = normalizeSubtotalLevels(
    ensureIsArray<number>(layoutSpec.colSubtotalLevels),
    maxColSubtotalDepth,
    false,
    false,
  );
  const colSubtotalLevelsForQuery = colSubtotalLevels.filter(
    level => level > 0,
  );

  const startCollapsed = layoutSpec.startCollapsed ?? true;
  const initialDepth = layoutSpec.initialDepth ?? 1;
  const resolvedExpandRowsLevel = resolveExpandLevel(
    layoutSpec.expandRowsLevel ?? undefined,
    rowDimensions.length,
    startCollapsed,
    initialDepth,
  );
  const resolvedExpandColsLevel = resolveExpandLevel(
    layoutSpec.expandColumnsLevel ?? undefined,
    columnDimensions.length,
    startCollapsed,
    initialDepth,
  );

  const isMetricTokenValue = (val: unknown) => {
    const decoded = decodeMetricKey(val);
    return !!decoded && metricLabelSet.has(decoded);
  };

  return {
    groupbyRowsRaw,
    groupbyColumnsRaw,
    metrics,
    metricKeys,
    metricLabelSet,
    metricLabelMap,
    measureHierarchy,
    requiredTimeOffsets,
    pivotProgram,
    metricsLayoutResolved,
    metricInsertIndex,
    rowSubtotalLevels,
    colSubtotalLevels,
    colSubtotalLevelsForQuery,
    rowTotals,
    colTotals,
    rowSubTotals: rowSubTotalsEnabled,
    rowTotalPosition: normalizeTotalPosition(layoutSpec.rowTotalPosition),
    colTotalPosition: normalizeTotalPosition(layoutSpec.colTotalPosition),
    rowSubtotalPosition: normalizeTotalPosition(layoutSpec.rowSubtotalPosition),
    colSubtotalPosition: normalizeTotalPosition(layoutSpec.colSubtotalPosition),
    startCollapsed,
    initialDepth,
    resolvedExpandRowsLevel,
    resolvedExpandColsLevel,
    isMetricTokenValue,
  };
};
