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
import { type QueryFormColumn, type QueryFormMetric } from '@superset-ui/core';
import {
  type MetricFormattingScope,
  type PivotDimensionFormattingMap,
  type PivotDimensionSortingMap,
  type PivotMetricDatabarMap,
  type PivotMetricFormattingMap,
} from '../../types';
import {
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  collectMetricDatabarMetricsForQuery,
  collectMetricFormattingMetricsForQuery,
  mergeMetrics,
} from '../../utils';
import {
  type QueryIntent,
  shouldIncludeDatabars,
  shouldIncludeMetricFormatting,
} from './queryIntent';

export type QueryShape = {
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
};

export type QueryShapeInput = {
  intent: QueryIntent;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricFormattingScope?: MetricFormattingScope;
  metricFormatting?: PivotMetricFormattingMap;
  metricDatabars?: PivotMetricDatabarMap;
  rowFormatting?: PivotDimensionFormattingMap;
  colFormatting?: PivotDimensionFormattingMap;
  rowSorting?: PivotDimensionSortingMap;
  colSorting?: PivotDimensionSortingMap;
};

export const buildQueryShape = ({
  intent,
  rowGroupby,
  colGroupby,
  metrics,
  metricFormattingScope,
  metricFormatting,
  metricDatabars,
  rowFormatting,
  colFormatting,
  rowSorting,
  colSorting,
}: QueryShapeInput): QueryShape => {
  const rowGroupbyForQuery = rowGroupby.slice(0, intent.targetRowDepth);
  const colGroupbyForQuery = colGroupby.slice(0, intent.targetColDepth);

  const extraMetrics: QueryFormMetric[] = [];
  if (shouldIncludeMetricFormatting(metricFormattingScope, intent)) {
    extraMetrics.push(
      ...collectMetricFormattingMetricsForQuery(metricFormatting, metrics),
    );
  }
  if (shouldIncludeDatabars(intent)) {
    extraMetrics.push(
      ...collectMetricDatabarMetricsForQuery(metricDatabars, metrics),
    );
  }
  if (intent.needsRowDimensionFormatting) {
    extraMetrics.push(
      ...collectDimensionFormattingMetricsForQuery(
        rowFormatting,
        rowGroupbyForQuery,
        metrics,
      ),
    );
  }
  if (intent.needsColDimensionFormatting) {
    extraMetrics.push(
      ...collectDimensionFormattingMetricsForQuery(
        colFormatting,
        colGroupbyForQuery,
        metrics,
      ),
    );
  }
  if (intent.needsRowOrdering) {
    extraMetrics.push(
      ...collectDimensionSortingMetricsForQuery(
        rowSorting,
        rowGroupbyForQuery,
        metrics,
      ),
    );
  }
  if (intent.needsColOrdering) {
    extraMetrics.push(
      ...collectDimensionSortingMetricsForQuery(
        colSorting,
        colGroupbyForQuery,
        metrics,
      ),
    );
  }

  return {
    rowGroupby: rowGroupbyForQuery,
    colGroupby: colGroupbyForQuery,
    metrics: mergeMetrics(metrics, extraMetrics),
  };
};
