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
  PivotRuntimeLayout,
  PivotTableQueryFormData,
} from '../../types';
import {
  METRICS_PLACEHOLDER,
  getMetricKey,
  getMetricKeys,
  getStableColumnKey,
} from '../../utils';
import { coerceMeasureLeavesByMetric } from '../measureLeaves';
import {
  compilePivotProgramFromPlacement,
  insertValuesPlaceholder,
} from '../runtime/compilePivotProgram';
import type { PivotProgram } from '../runtime/types';

type ResolvedLayoutParams = {
  formData: PivotTableQueryFormData;
  runtimeLayout?: PivotRuntimeLayout;
};

type AppliedInteractionLayoutParams = {
  isUserControlled: boolean;
  appliedFormData: PivotTableQueryFormData;
  formData: PivotTableQueryFormData;
  runtimeLayout: PivotRuntimeLayout;
  committedRuntimeLayout: PivotRuntimeLayout;
  appliedDimensionKeys: string[];
};

export type AppliedInteractionLayout = {
  appliedRuntimeLayout: PivotRuntimeLayout;
  appliedLayoutFormData: PivotTableQueryFormData;
  appliedPivotProgram?: PivotProgram;
};

const mapLayoutDimensions = (
  dimensionMap: Map<string, QueryFormColumn>,
  keys: string[],
): QueryFormColumn[] =>
  keys
    .map(key => dimensionMap.get(key))
    .filter((dimension): dimension is QueryFormColumn => Boolean(dimension));

const resolveDimensionMap = (dimensions: QueryFormColumn[]) => {
  const map = new Map<string, QueryFormColumn>();
  dimensions.forEach(dimension => {
    map.set(getStableColumnKey(dimension), dimension);
  });
  return map;
};

const resolveMetricMap = (metrics: QueryFormMetric[]) => {
  const map = new Map<string, QueryFormMetric>();
  metrics.forEach(metric => {
    const key = getMetricKey(metric);
    if (key) {
      map.set(key, metric);
    }
  });
  return map;
};

export const normalizeRuntimeLayout = (
  layout: PivotRuntimeLayout | undefined,
  dimensionKeys: string[] = [],
  metricKeys: string[] = [],
): PivotRuntimeLayout => {
  const base: PivotRuntimeLayout =
    layout && layout.version === 1
      ? layout
      : {
          version: 1,
          rows: [],
          cols: [],
          metrics: metricKeys,
          leafSelection: {},
          valuePlacement: { axis: 'col', index: 0 },
        };
  const rows =
    dimensionKeys.length > 0
      ? base.rows.filter(key => dimensionKeys.includes(key))
      : base.rows;
  const cols =
    dimensionKeys.length > 0
      ? base.cols.filter(key => dimensionKeys.includes(key))
      : base.cols;
  const metrics =
    metricKeys.length > 0
      ? base.metrics.filter(key => metricKeys.includes(key))
      : base.metrics;
  return {
    ...base,
    rows,
    cols,
    metrics: metrics.length > 0 ? metrics : metricKeys,
  };
};

export const resolveInteractionFormData = ({
  formData,
  runtimeLayout,
}: ResolvedLayoutParams): PivotTableQueryFormData => {
  if (formData.interactionMode !== 'user_controlled') {
    return formData;
  }

  const dimensions = ensureIsArray<QueryFormColumn>(formData.dimensions);
  const dimensionMap = resolveDimensionMap(dimensions);
  const resolvedLayout = normalizeRuntimeLayout(runtimeLayout);

  const rows = resolvedLayout.rows.filter(key => dimensionMap.has(key));
  const cols = resolvedLayout.cols.filter(key => dimensionMap.has(key));

  const metrics = ensureIsArray<QueryFormMetric>(formData.metrics);
  const metricMap = resolveMetricMap(metrics);
  const availableMetricKeys = Array.from(metricMap.keys());
  const runtimeMetricKeys = resolvedLayout.metrics.filter(key =>
    metricMap.has(key),
  );
  const resolvedMetricKeys =
    runtimeMetricKeys.length > 0 ? runtimeMetricKeys : availableMetricKeys;

  const placement = resolvedLayout.valuePlacement ?? {
    axis: 'col',
    index: cols.length,
  };
  const { axis } = placement;

  const rowGroupby = rows.map(key => dimensionMap.get(key));
  const colGroupby = cols.map(key => dimensionMap.get(key));

  const resolvedRowGroupby = rowGroupby.filter(
    (value): value is QueryFormColumn => Boolean(value),
  );
  const resolvedColGroupby = colGroupby.filter(
    (value): value is QueryFormColumn => Boolean(value),
  );

  const baseLeaves = coerceMeasureLeavesByMetric(
    resolvedMetricKeys,
    formData.measureLeavesByMetric,
  );
  const selection = resolvedLayout.leafSelection || {};
  const hasExplicitSelection = Object.keys(selection).length > 0;
  const baseLeafIds: string[] = [];
  resolvedMetricKeys.forEach(metricKey => {
    (baseLeaves[metricKey] ?? []).forEach(leaf => {
      if (!baseLeafIds.includes(leaf.id)) {
        baseLeafIds.push(leaf.id);
      }
    });
  });
  const providedOrder = resolvedLayout.leafOrder ?? [];
  const filteredOrder = providedOrder.filter(id => baseLeafIds.includes(id));
  const normalizedOrder = [
    ...filteredOrder,
    ...baseLeafIds.filter(id => !filteredOrder.includes(id)),
  ];
  const orderIndex = new Map(
    normalizedOrder.map((id, index) => [id, index] as const),
  );
  const resolvedLeaves = Object.fromEntries(
    Object.entries(baseLeaves).map(([metricKey, leaves]) => {
      const filtered = hasExplicitSelection
        ? leaves.filter(leaf => selection[leaf.id] === true)
        : leaves;
      const ordered = filtered
        .map((leaf, index) => ({
          leaf,
          rank: orderIndex.get(leaf.id) ?? normalizedOrder.length + index,
        }))
        .sort((a, b) => a.rank - b.rank)
        .map(({ leaf }) => leaf);
      return [metricKey, ordered];
    }),
  );
  const activeMetricKeys = resolvedMetricKeys.filter(
    key => (resolvedLeaves[key] ?? []).length > 0,
  );
  const resolvedMetrics = activeMetricKeys
    .map(key => metricMap.get(key))
    .filter((metric): metric is QueryFormMetric => Boolean(metric));
  const resolvedLeavesByMetric = Object.fromEntries(
    activeMetricKeys.map(metricKey => [
      metricKey,
      resolvedLeaves[metricKey] ?? [],
    ]),
  );
  const resolvedGroupby =
    resolvedMetrics.length > 0
      ? insertValuesPlaceholder(
          resolvedRowGroupby,
          resolvedColGroupby,
          placement,
          METRICS_PLACEHOLDER,
        )
      : { rows: resolvedRowGroupby, cols: resolvedColGroupby };

  return {
    ...formData,
    groupbyRows: resolvedGroupby.rows,
    groupbyColumns: resolvedGroupby.cols,
    metrics:
      resolvedMetricKeys.length === 0
        ? metrics
        : resolvedMetrics.length > 0
          ? resolvedMetrics
          : [],
    measureLeavesByMetric: resolvedLeavesByMetric,
    metricsLayout:
      axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS,
  };
};

export const resolveAppliedInteractionLayout = ({
  isUserControlled,
  appliedFormData,
  formData,
  runtimeLayout,
  committedRuntimeLayout,
  appliedDimensionKeys,
}: AppliedInteractionLayoutParams): AppliedInteractionLayout => {
  if (!isUserControlled) {
    return {
      appliedRuntimeLayout: runtimeLayout,
      appliedLayoutFormData: appliedFormData,
    };
  }

  const appliedMetricKeysBase = getMetricKeys(
    ensureIsArray(
      appliedFormData.metricsBase ??
        appliedFormData.metrics ??
        formData.metrics,
    ),
  );
  const committedMetrics = committedRuntimeLayout.metrics ?? [];
  const appliedMetricKeys =
    committedMetrics.length === 0
      ? appliedMetricKeysBase
      : [
          ...appliedMetricKeysBase,
          ...committedMetrics.filter(
            metricKey => !appliedMetricKeysBase.includes(metricKey),
          ),
        ];
  const appliedRuntimeLayout = normalizeRuntimeLayout(
    committedRuntimeLayout,
    appliedDimensionKeys,
    appliedMetricKeys,
  );
  const metricsForLayout =
    appliedFormData.metricsBase ??
    formData.metricsBase ??
    appliedFormData.metrics ??
    formData.metrics;
  const leavesForLayout =
    appliedFormData.measureLeavesByMetricBase ??
    formData.measureLeavesByMetricBase ??
    appliedFormData.measureLeavesByMetric ??
    formData.measureLeavesByMetric;
  const appliedLayoutFormData = resolveInteractionFormData({
    formData: {
      ...appliedFormData,
      metrics: metricsForLayout ?? appliedFormData.metrics,
      measureLeavesByMetric:
        leavesForLayout ?? appliedFormData.measureLeavesByMetric,
    },
    runtimeLayout: appliedRuntimeLayout,
  });
  const appliedDimensionMap = resolveDimensionMap(
    ensureIsArray(appliedFormData.dimensions ?? formData.dimensions),
  );
  const rowDimensions = mapLayoutDimensions(
    appliedDimensionMap,
    appliedRuntimeLayout.rows,
  );
  const columnDimensions = mapLayoutDimensions(
    appliedDimensionMap,
    appliedRuntimeLayout.cols,
  );
  const appliedPivotProgram = compilePivotProgramFromPlacement({
    rowDimensions,
    columnDimensions,
    metrics: appliedLayoutFormData.metrics,
    metricsLayout: appliedLayoutFormData.metricsLayout as MetricsLayoutEnum,
    valuePlacement: appliedRuntimeLayout.valuePlacement,
  });

  return {
    appliedRuntimeLayout,
    appliedLayoutFormData,
    appliedPivotProgram,
  };
};
