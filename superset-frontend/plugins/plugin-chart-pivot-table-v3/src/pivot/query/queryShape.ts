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
  type PivotAxis,
  type PivotDimensionFormattingMap,
  type PivotDimensionSortingMap,
  type PivotMetricDatabarMap,
  type PivotMetricFormattingMap,
  type MeasureHierarchy,
} from '../../types';
import {
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  collectMeasureLeafMetricsForQuery,
  collectMetricDatabarMetricsForQuery,
  collectMetricFormattingMetricsForQuery,
  mergeMetrics,
} from '../../utils';
import { getMetricKey } from '../core/tokens';

export type QueryIntent = {
  kind: 'branch' | 'wholeLevel' | 'totalsOnly';
  axis?: PivotAxis;
  targetRowDepth: number;
  targetColDepth: number;
  needsValueCells: boolean;
  needsTotals: boolean;
  needsMetricFormatting: boolean;
  needsDatabars: boolean;
  needsRowOrdering: boolean;
  needsColOrdering: boolean;
  needsRowDimensionFormatting: boolean;
  needsColDimensionFormatting: boolean;
};

const shouldIncludeMetricFormatting = (
  scope: MetricFormattingScope | undefined,
  intent: QueryIntent,
): boolean =>
  intent.needsMetricFormatting &&
  (scope === 'values'
    ? intent.needsValueCells
    : intent.needsValueCells || intent.needsTotals);

const shouldIncludeDatabars = (intent: QueryIntent): boolean =>
  intent.needsDatabars && intent.needsValueCells;

type QueryShape = {
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
};

type QueryShapeInput = {
  intent: QueryIntent;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
  availableMetrics?: QueryFormMetric[];
  metricFormattingScope?: MetricFormattingScope;
  metricFormatting?: PivotMetricFormattingMap;
  metricDatabars?: PivotMetricDatabarMap;
  rowFormatting?: PivotDimensionFormattingMap;
  colFormatting?: PivotDimensionFormattingMap;
  rowSorting?: PivotDimensionSortingMap;
  colSorting?: PivotDimensionSortingMap;
  measureHierarchy?: MeasureHierarchy;
};

export const buildQueryShape = ({
  intent,
  rowGroupby,
  colGroupby,
  metrics,
  availableMetrics = metrics,
  metricFormattingScope,
  metricFormatting,
  metricDatabars,
  rowFormatting,
  colFormatting,
  rowSorting,
  colSorting,
  measureHierarchy,
}: QueryShapeInput): QueryShape => {
  const rowGroupbyForQuery = rowGroupby.slice(0, intent.targetRowDepth);
  const colGroupbyForQuery = colGroupby.slice(0, intent.targetColDepth);
  const metricKeys = new Set(
    metrics.map(getMetricKey).filter((key): key is string => Boolean(key)),
  );
  const filterMetricKeyedMap = <T>(
    map: Record<string, T> | undefined,
  ): Record<string, T> | undefined => {
    if (!map) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(map).filter(([metricKey]) => metricKeys.has(metricKey)),
    );
  };

  const extraMetrics: QueryFormMetric[] = [];
  if (shouldIncludeMetricFormatting(metricFormattingScope, intent)) {
    extraMetrics.push(
      ...collectMetricFormattingMetricsForQuery(
        filterMetricKeyedMap(metricFormatting),
        availableMetrics,
      ),
    );
  }
  if (shouldIncludeDatabars(intent)) {
    extraMetrics.push(
      ...collectMetricDatabarMetricsForQuery(
        filterMetricKeyedMap(metricDatabars),
        availableMetrics,
      ),
    );
  }
  if (intent.needsRowDimensionFormatting) {
    extraMetrics.push(
      ...collectDimensionFormattingMetricsForQuery(
        rowFormatting,
        rowGroupbyForQuery,
        availableMetrics,
      ),
    );
  }
  if (intent.needsColDimensionFormatting) {
    extraMetrics.push(
      ...collectDimensionFormattingMetricsForQuery(
        colFormatting,
        colGroupbyForQuery,
        availableMetrics,
      ),
    );
  }
  if (intent.needsRowOrdering) {
    extraMetrics.push(
      ...collectDimensionSortingMetricsForQuery(
        rowSorting,
        rowGroupbyForQuery,
        availableMetrics,
      ),
    );
  }
  if (intent.needsColOrdering) {
    extraMetrics.push(
      ...collectDimensionSortingMetricsForQuery(
        colSorting,
        colGroupbyForQuery,
        availableMetrics,
      ),
    );
  }
  extraMetrics.push(
    ...collectMeasureLeafMetricsForQuery(
      measureHierarchy,
      metrics,
      availableMetrics,
    ),
  );

  return {
    rowGroupby: rowGroupbyForQuery,
    colGroupby: colGroupbyForQuery,
    metrics: mergeMetrics(metrics, extraMetrics),
  };
};
