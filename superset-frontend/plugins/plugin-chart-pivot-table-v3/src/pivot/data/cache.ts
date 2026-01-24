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
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import { serializePath } from '../core/path';
import { getMetricKeys } from '../core/tokens';
import { stableStringify } from '../shared/stableStringify';

export type FilterSignature = string;
export type CacheKey = string;

const CACHE_MAX_ENTRIES = 200;
const branchCache = new Map<CacheKey, PivotTreeData>();

const touchBranchCache = (key: CacheKey, value: PivotTreeData) => {
  if (branchCache.has(key)) {
    branchCache.delete(key);
  }
  branchCache.set(key, value);
  if (branchCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = branchCache.keys().next().value;
    if (oldestKey !== undefined) {
      branchCache.delete(oldestKey);
    }
  }
};

export const readPivotBranchCache = (key: CacheKey) => {
  const cached = branchCache.get(key);
  if (!cached) {
    return undefined;
  }
  touchBranchCache(key, cached);
  return cached;
};

export const writePivotBranchCache = (key: CacheKey, value: PivotTreeData) => {
  touchBranchCache(key, value);
};

export const clearPivotBranchCache = () => branchCache.clear();

const getExtraFormData = (formData: PivotTableQueryFormData) =>
  formData.extra_form_data;

export const buildFilterSignature = (
  formData: PivotTableQueryFormData,
): FilterSignature =>
  stableStringify({
    time_range: formData.time_range,
    since: formData.since,
    until: formData.until,
    filters: formData.filters,
    adhoc_filters: formData.adhoc_filters,
    extra_filters: formData.extra_filters,
    extra_form_data: getExtraFormData(formData),
    time_grain_sqla: getExtraFormData(formData)?.time_grain_sqla,
    granularity: formData.granularity,
    granularity_sqla: formData.granularity_sqla,
    row_limit: formData.row_limit,
    row_offset: formData.row_offset,
    series_limit: formData.series_limit,
    series_limit_metric: formData.series_limit_metric,
    order_desc: formData.order_desc,
    row_order: formData.rowOrder,
    col_order: formData.colOrder,
    post_processing: formData.post_processing,
  });

export const buildPivotBranchCacheKey = ({
  axis,
  path,
  rowDepth,
  colDepth,
  rowGroupby,
  colGroupby,
  metrics,
  aggregateFunction,
  filterSignature,
  cacheMeta,
}: {
  axis: PivotAxis;
  path: PivotPath;
  rowDepth: number;
  colDepth: number;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
  aggregateFunction?: string;
  filterSignature?: FilterSignature;
  cacheMeta?: Record<string, unknown>;
}): CacheKey =>
  stableStringify({
    axis,
    path: serializePath(path),
    rowDepth,
    colDepth,
    rowGroupby: rowGroupby.map(getColumnLabel),
    colGroupby: colGroupby.map(getColumnLabel),
    metrics: getMetricKeys(metrics),
    aggregateFunction: aggregateFunction || '',
    filterSignature: filterSignature || '',
    ...(cacheMeta || {}),
  });
