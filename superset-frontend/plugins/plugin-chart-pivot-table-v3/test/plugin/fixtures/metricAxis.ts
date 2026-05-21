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
  type DateFormatter,
  type MeasureHierarchy,
  MetricsLayoutEnum,
  type PivotTreeData,
} from '../../../src/types';
import { METRICS_PLACEHOLDER } from '../../../src/pivot/core/tokens';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';
import { type PivotProgram } from '../../../src/pivot/runtime/types';
import { applyMeasureHierarchyAxis as applyMeasureHierarchyAxisRuntime } from '../../../src/pivot/runtime/materializePivotTree';
import { buildValueLeaf } from '../../../src/pivot/measureLeaves';

export {
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  materializeLoadedPivotTreeFromFactStore,
  materializeLoadedPivotTreeFromFactStoreAsync,
} from '../../../src/pivot/runtime/materializePivotTree';

const compileMetricAxisProgram = ({
  metrics,
  metricsLayout,
  rowGroupby,
  colGroupby,
  metricPosition,
}: {
  metrics: QueryFormMetric[];
  metricsLayout: MetricsLayoutEnum;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metricPosition?: number;
}): PivotProgram => {
  const valueAxis = metricsLayout === MetricsLayoutEnum.ROWS ? 'row' : 'col';
  const axisDepth = valueAxis === 'row' ? rowGroupby.length : colGroupby.length;
  const metricInsertIndex = Math.min(metricPosition ?? axisDepth, axisDepth);
  const withValuesPlaceholder = (columns: QueryFormColumn[]) => [
    ...columns.slice(0, metricInsertIndex),
    METRICS_PLACEHOLDER,
    ...columns.slice(metricInsertIndex),
  ];
  return compilePivotProgram({
    groupbyRows:
      valueAxis === 'row' ? withValuesPlaceholder(rowGroupby) : rowGroupby,
    groupbyColumns:
      valueAxis === 'col' ? withValuesPlaceholder(colGroupby) : colGroupby,
    metrics,
    metricsLayout,
  });
};

export const buildValueMeasureHierarchy = (
  metricKeys: string[],
): MeasureHierarchy => ({
  kind: 'measureStackV1',
  groups: metricKeys.map(metricKey => ({
    metricKey,
    leaves: [buildValueLeaf()],
  })),
  leafTierVisibility: 'hidden',
});

export const applyMetricAxis = (
  tree: PivotTreeData,
  metrics: QueryFormMetric[],
  metricsLayout: MetricsLayoutEnum,
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  metricPosition?: number,
  metricLabelMap?: Record<string, string>,
  dateFormatters?: Record<string, DateFormatter | undefined>,
  colSubtotalLevels: number[] = [],
): PivotTreeData => {
  const program = compileMetricAxisProgram({
    metrics,
    metricsLayout,
    rowGroupby,
    colGroupby,
    metricPosition,
  });
  return applyMeasureHierarchyAxisRuntime(
    tree,
    buildValueMeasureHierarchy(program.metricKeys),
    program,
    metricLabelMap,
    dateFormatters,
    colSubtotalLevels,
  );
};

export function applyMeasureHierarchyAxis(
  tree: PivotTreeData,
  measureHierarchy: MeasureHierarchy,
  program: PivotProgram,
  metricLabelMap?: Record<string, string>,
  dateFormatters?: Record<string, DateFormatter | undefined>,
): PivotTreeData;
export function applyMeasureHierarchyAxis(
  tree: PivotTreeData,
  measureHierarchy: MeasureHierarchy,
  metricsLayout: MetricsLayoutEnum,
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  metricPosition?: number,
  metricLabelMap?: Record<string, string>,
  dateFormatters?: Record<string, DateFormatter | undefined>,
): PivotTreeData;
export function applyMeasureHierarchyAxis(
  tree: PivotTreeData,
  measureHierarchy: MeasureHierarchy,
  programOrMetricsLayout: PivotProgram | MetricsLayoutEnum,
  metricLabelMapOrRowGroupby?: Record<string, string> | QueryFormColumn[],
  colGroupby?: QueryFormColumn[] | Record<string, DateFormatter | undefined>,
  metricPosition?: number,
  legacyMetricLabelMap?: Record<string, string>,
  dateFormatters?: Record<string, DateFormatter | undefined>,
): PivotTreeData {
  if (typeof programOrMetricsLayout === 'object') {
    return applyMeasureHierarchyAxisRuntime(
      tree,
      measureHierarchy,
      programOrMetricsLayout,
      metricLabelMapOrRowGroupby as Record<string, string> | undefined,
      colGroupby as Record<string, DateFormatter | undefined> | undefined,
    );
  }
  const metrics = measureHierarchy.groups.map(group => group.metricKey);
  return applyMeasureHierarchyAxisRuntime(
    tree,
    measureHierarchy,
    compileMetricAxisProgram({
      metrics,
      metricsLayout: programOrMetricsLayout,
      rowGroupby: Array.isArray(metricLabelMapOrRowGroupby)
        ? metricLabelMapOrRowGroupby
        : [],
      colGroupby: Array.isArray(colGroupby) ? colGroupby : [],
      metricPosition,
    }),
    legacyMetricLabelMap,
    dateFormatters,
  );
}
