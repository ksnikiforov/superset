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
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../types';
import {
  normalizeSubtotalLevels,
  resolveMetricPlacement,
  hasTotalSorting,
  stripMetricsPlaceholder,
} from '../../utils';
import { type QueryIntent } from './query/queryIntent';

export type BootstrapTargetKind = 'totals' | 'grid' | 'rows' | 'cols';

export type BootstrapTarget = {
  kind: BootstrapTargetKind;
  intent: QueryIntent;
};

export type BootstrapPlan = {
  targets: BootstrapTarget[];
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
};

const buildIntent = ({
  kind,
  targetRowDepth,
  targetColDepth,
  needsTotals,
  needsMetricFormatting,
  needsDatabars,
  needsRowOrdering,
  needsColOrdering,
  needsRowDimensionFormatting,
  needsColDimensionFormatting,
}: {
  kind: BootstrapTargetKind;
  targetRowDepth: number;
  targetColDepth: number;
  needsTotals: boolean;
  needsMetricFormatting: boolean;
  needsDatabars: boolean;
  needsRowOrdering: boolean;
  needsColOrdering: boolean;
  needsRowDimensionFormatting: boolean;
  needsColDimensionFormatting: boolean;
}): QueryIntent => ({
  kind: kind === 'totals' ? 'totalsOnly' : 'wholeLevel',
  targetRowDepth,
  targetColDepth,
  needsValueCells: kind !== 'totals',
  needsTotals,
  needsMetricFormatting,
  needsDatabars: kind === 'totals' ? false : needsDatabars,
  needsRowOrdering,
  needsColOrdering,
  needsRowDimensionFormatting,
  needsColDimensionFormatting,
});

export const buildBootstrapPlan = (
  formData: PivotTableQueryFormData,
): BootstrapPlan => {
  const rowGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyRows);
  const colGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyColumns);
  const metrics = ensureIsArray<QueryFormMetric>(formData.metrics);
  const placement = resolveMetricPlacement(rowGroupbyRaw, colGroupbyRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  const rowGroupby = stripMetricsPlaceholder(placement.rows);
  const colGroupby = stripMetricsPlaceholder(placement.cols);
  const rowSubTotalsEnabled = formData.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(rowGroupby.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    formData.rowSubtotalLevels,
    maxRowSubtotalDepth,
    formData.colTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(colGroupby.length - 1, 0);
  const colSubtotalLevels = normalizeSubtotalLevels(
    ensureIsArray<number>(formData.colSubtotalLevels),
    maxColSubtotalDepth,
    false,
    false,
  ).filter(level => level > 0);
  const needsTotals =
    !!formData.rowTotals ||
    !!formData.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const needsMetricFormatting =
    Object.keys(formData.metricFormatting || {}).length > 0;
  const needsDatabars = Object.keys(formData.metricDatabars || {}).length > 0;
  const needsRowOrdering = Object.keys(formData.rowSorting || {}).length > 0;
  const needsColOrdering = Object.keys(formData.colSorting || {}).length > 0;
  const needsRowDimensionFormatting =
    Object.keys(formData.rowFormatting || {}).length > 0;
  const needsColDimensionFormatting =
    Object.keys(formData.colFormatting || {}).length > 0;
  const needsRowTotals =
    rowGroupby.length > 0 &&
    (!!formData.rowTotals ||
      rowSubtotalLevels.length > 0 ||
      hasTotalSorting(formData.rowSorting, rowGroupby));
  const needsColTotals =
    colGroupby.length > 0 &&
    (!!formData.colTotals ||
      colSubtotalLevels.length > 0 ||
      hasTotalSorting(formData.colSorting, colGroupby));
  const needsGrid = rowGroupby.length > 0 && colGroupby.length > 0;

  const targets: BootstrapTarget[] = [
    {
      kind: 'totals',
      intent: buildIntent({
        kind: 'totals',
        targetRowDepth: 0,
        targetColDepth: 0,
        needsTotals,
        needsMetricFormatting,
        needsDatabars,
        needsRowOrdering: false,
        needsColOrdering: false,
        needsRowDimensionFormatting: false,
        needsColDimensionFormatting: false,
      }),
    },
  ];

  if (needsGrid) {
    targets.push({
      kind: 'grid',
      intent: buildIntent({
        kind: 'grid',
        targetRowDepth: 1,
        targetColDepth: 1,
        needsTotals: false,
        needsMetricFormatting,
        needsDatabars,
        needsRowOrdering,
        needsColOrdering,
        needsRowDimensionFormatting,
        needsColDimensionFormatting,
      }),
    });
  }

  if (rowGroupby.length > 0 && (!needsGrid || needsRowTotals)) {
    targets.push({
      kind: 'rows',
      intent: buildIntent({
        kind: 'rows',
        targetRowDepth: 1,
        targetColDepth: 0,
        needsTotals,
        needsMetricFormatting,
        needsDatabars,
        needsRowOrdering,
        needsColOrdering: false,
        needsRowDimensionFormatting,
        needsColDimensionFormatting: false,
      }),
    });
  }

  if (colGroupby.length > 0 && (!needsGrid || needsColTotals)) {
    targets.push({
      kind: 'cols',
      intent: buildIntent({
        kind: 'cols',
        targetRowDepth: 0,
        targetColDepth: 1,
        needsTotals,
        needsMetricFormatting,
        needsDatabars,
        needsRowOrdering: false,
        needsColOrdering,
        needsRowDimensionFormatting: false,
        needsColDimensionFormatting,
      }),
    });
  }

  return {
    targets,
    rowGroupby,
    colGroupby,
    metrics,
  };
};
