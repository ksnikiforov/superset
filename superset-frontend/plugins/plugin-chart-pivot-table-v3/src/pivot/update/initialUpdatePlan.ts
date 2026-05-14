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
  type QueryFormColumn,
  type QueryObjectFilterClause,
} from '@superset-ui/core';
import {
  type PivotRuntimeLayout,
  type PivotTableQueryFormData,
} from '../../types';
import { getStableColumnKey } from '../../utils';
import { buildLayoutContext } from '../layout/LayoutContext';
import { resolveInteractionFormData } from '../layout/resolveInteractionLayout';
import { normalizeFormDataExtraFilters } from '../query/normalizeExtraFormData';
import { buildInitialQuerySpecs, type PlannedQuerySpec } from '../query/specs';

export type SelectionFilterMap = Record<string, DataRecordValue[]>;

type BuildSelectionFilterClausesParams = {
  formData: PivotTableQueryFormData;
  selection?: SelectionFilterMap;
};

const buildSelectionDimensionMap = (
  formData: PivotTableQueryFormData,
): Map<string, QueryFormColumn> => {
  const dimensionMap = new Map<string, QueryFormColumn>();
  formData.dimensions.forEach(dimension => {
    dimensionMap.set(getStableColumnKey(dimension), dimension);
  });
  return dimensionMap;
};

export const buildSelectionFilterClauses = ({
  formData,
  selection,
}: BuildSelectionFilterClausesParams): QueryObjectFilterClause[] => {
  if (!selection || Object.keys(selection).length === 0) {
    return [];
  }
  const dimensionMap = buildSelectionDimensionMap(formData);
  return Object.entries(selection).flatMap(([key, values]) => {
    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }
    const col = dimensionMap.get(key) ?? (key as unknown as QueryFormColumn);
    return [
      {
        col,
        op: 'IN' as const,
        val: values,
      },
    ];
  });
};

export const mergeExtraFilters = (
  baseExtra: PivotTableQueryFormData['extra_form_data'] | undefined,
  extraFilters: QueryObjectFilterClause[],
): PivotTableQueryFormData['extra_form_data'] | undefined => {
  if (extraFilters.length === 0) {
    return baseExtra;
  }
  const existing = baseExtra?.filters ?? [];
  return {
    ...(baseExtra ?? {}),
    filters: [...existing, ...extraFilters],
  };
};

export const buildSelectionFilteredFormData = ({
  formData,
  selection,
}: BuildSelectionFilterClausesParams): PivotTableQueryFormData => {
  const selectionFilters = buildSelectionFilterClauses({
    formData,
    selection,
  });
  return normalizeFormDataExtraFilters(
    selectionFilters.length > 0
      ? {
          ...formData,
          extra_form_data: mergeExtraFilters(
            formData.extra_form_data,
            selectionFilters,
          ),
        }
      : formData,
  );
};

const withMetricOverrides = ({
  formData,
  metricsOverride,
  measureLeavesByMetricOverride,
}: {
  formData: PivotTableQueryFormData;
  metricsOverride?: PivotTableQueryFormData['metrics'];
  measureLeavesByMetricOverride?: PivotTableQueryFormData['measureLeavesByMetric'];
}) => {
  if (
    metricsOverride === undefined &&
    measureLeavesByMetricOverride === undefined
  ) {
    return formData;
  }
  return {
    ...formData,
    ...(metricsOverride !== undefined ? { metrics: metricsOverride } : {}),
    ...(measureLeavesByMetricOverride !== undefined
      ? { measureLeavesByMetric: measureLeavesByMetricOverride }
      : {}),
  };
};

export type BuildInitialPivotUpdatePlanParams = {
  formData: PivotTableQueryFormData;
  runtimeLayout?: PivotRuntimeLayout;
  selection?: SelectionFilterMap;
  metricsOverride?: PivotTableQueryFormData['metrics'];
  measureLeavesByMetricOverride?: PivotTableQueryFormData['measureLeavesByMetric'];
};

export type InitialPivotUpdatePlan = {
  formData: PivotTableQueryFormData;
  layout: ReturnType<typeof buildLayoutContext>;
  specs: PlannedQuerySpec[];
  selectionFilters: QueryObjectFilterClause[];
};

export const buildInitialPivotUpdatePlan = ({
  formData,
  runtimeLayout,
  selection,
  metricsOverride,
  measureLeavesByMetricOverride,
}: BuildInitialPivotUpdatePlanParams): InitialPivotUpdatePlan => {
  const resolvedSelection =
    selection === undefined && formData.interactionMode === 'user_controlled'
      ? formData.pivotSelectedFilters
      : selection;
  const selectionFilters = buildSelectionFilterClauses({
    formData,
    selection: resolvedSelection,
  });

  const normalizedFormData = buildSelectionFilteredFormData({
    formData,
    selection: resolvedSelection,
  });

  const formDataWithOverrides = withMetricOverrides({
    formData: normalizedFormData,
    metricsOverride,
    measureLeavesByMetricOverride,
  });
  const resolvedFormData = resolveInteractionFormData({
    formData: formDataWithOverrides,
    runtimeLayout: runtimeLayout ?? normalizedFormData.pivotRuntimeLayout,
  });
  const layout = buildLayoutContext(resolvedFormData);
  const timeOffsets = Array.from(
    new Set([
      ...(resolvedFormData.time_offsets ?? []),
      ...layout.requiredTimeOffsets,
    ]),
  );
  const resolvedFormDataWithOffsets =
    timeOffsets.length > 0
      ? { ...resolvedFormData, time_offsets: timeOffsets }
      : resolvedFormData;
  const specs = buildInitialQuerySpecs(resolvedFormDataWithOffsets, layout);

  return {
    formData: resolvedFormDataWithOffsets,
    layout,
    specs,
    selectionFilters,
  };
};
