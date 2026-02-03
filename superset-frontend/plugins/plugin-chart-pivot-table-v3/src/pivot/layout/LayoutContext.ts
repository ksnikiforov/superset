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
  getMetricLabel,
  QueryFormColumn,
  QueryFormMetric,
} from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  PivotPath,
  PivotTableQueryFormData,
  TotalPosition,
  MeasureHierarchy,
  MeasureLeavesByMetricKey,
} from '../../types';
import {
  decodeMetricKey,
  getMetricKey,
  getMetricKeys,
  normalizeSubtotalLevels,
  resolveExpandLevel,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
  isMeasureLeafToken,
} from '../../utils';
import {
  coerceMeasureLeavesByMetric,
  collectRequiredTimeOffsets,
} from '../measureLeaves';

export type PivotLayoutSpec = Pick<
  PivotTableQueryFormData,
  | 'groupbyRows'
  | 'groupbyColumns'
  | 'metrics'
  | 'measureLeavesByMetric'
  | 'metricLabelMap'
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
};

export type LayoutContext = {
  groupbyRowsRaw: QueryFormColumn[];
  groupbyColumnsRaw: QueryFormColumn[];
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricKeys: string[];
  metricLabelSet: Set<string>;
  metricLabelMap: Map<string, string>;
  measureHierarchy: MeasureHierarchy;
  requiredTimeOffsets: string[];
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
  getFetchPath: (path: PivotPath) => PivotPath;
};

const normalizeTotalPosition = (value: unknown): TotalPosition =>
  value === 'end' ? 'end' : 'start';

export const buildLayoutContext = (
  layoutSpec: PivotLayoutSpec,
): LayoutContext => {
  const groupbyRowsRaw = ensureIsArray<QueryFormColumn>(layoutSpec.groupbyRows);
  const groupbyColumnsRaw = ensureIsArray<QueryFormColumn>(
    layoutSpec.groupbyColumns,
  );
  const metrics = ensureIsArray<QueryFormMetric>(layoutSpec.metrics);
  const metricKeys = getMetricKeys(metrics);
  const metricLabelSet = new Set(metricKeys);
  const labelOverrides =
    (layoutSpec.metricLabelMap as Record<string, string> | undefined) ?? {};
  const metricLabelMap = metrics.reduce<Map<string, string>>((acc, metric) => {
    const key = getMetricKey(metric);
    if (!key) {
      return acc;
    }
    const override =
      (typeof metric === 'string' && labelOverrides[metric]) ||
      labelOverrides[key];
    const label = override || getMetricLabel(metric) || key;
    acc.set(key, label);
    return acc;
  }, new Map());
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

  const placement = resolveMetricPlacement(groupbyRowsRaw, groupbyColumnsRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: layoutSpec.metricsLayout as MetricsLayoutEnum,
    lastMoved: layoutSpec.lastMoved,
  });

  const groupbyRows = stripMetricsPlaceholder(placement.rows);
  const groupbyColumns = stripMetricsPlaceholder(placement.cols);

  const rowTotals = layoutSpec.rowTotals ?? false;
  const colTotals = layoutSpec.colTotals ?? false;

  const metricsLayoutResolved = placement.layout;
  const metricInsertIndex =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS
      ? placement.metricPosition >= 0
        ? Math.min(placement.metricPosition, groupbyRows.length)
        : groupbyRows.length
      : placement.metricPosition >= 0
        ? Math.min(placement.metricPosition, groupbyColumns.length)
        : groupbyColumns.length;

  const rowSubTotalsEnabled = layoutSpec.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(groupbyRows.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    layoutSpec.rowSubtotalLevels,
    maxRowSubtotalDepth,
    colTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(groupbyColumns.length - 1, 0);
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
    groupbyRows.length,
    startCollapsed,
    initialDepth,
  );
  const resolvedExpandColsLevel = resolveExpandLevel(
    layoutSpec.expandColumnsLevel ?? undefined,
    groupbyColumns.length,
    startCollapsed,
    initialDepth,
  );

  const isMetricTokenValue = (val: unknown) => {
    const decoded = decodeMetricKey(val);
    return !!decoded && metricLabelSet.has(decoded);
  };
  const getFetchPath = (path: PivotPath): PivotPath => {
    const next: PivotPath = [];
    path.forEach(val => {
      if (isMeasureLeafToken(val)) {
        return;
      }
      const decoded = decodeMetricKey(val);
      if (decoded && metricLabelSet.has(decoded)) {
        next.push(decoded);
        return;
      }
      next.push(val);
    });
    return next;
  };

  return {
    groupbyRowsRaw,
    groupbyColumnsRaw,
    groupbyRows,
    groupbyColumns,
    metrics,
    metricKeys,
    metricLabelSet,
    metricLabelMap,
    measureHierarchy,
    requiredTimeOffsets,
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
    getFetchPath,
  };
};
