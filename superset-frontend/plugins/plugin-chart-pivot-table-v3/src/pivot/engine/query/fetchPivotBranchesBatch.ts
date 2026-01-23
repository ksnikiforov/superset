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
  PivotPath,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../../types';
import { type BatchGroup } from '../../query/fetchPlanOptimizer';
import { buildLayoutContext } from '../../layout/LayoutContext';
import { buildBatchQuerySpecs } from '../../query/specs';
import { buildBranchTreeFromResults } from '../../../fetchPivotBranch';
import { supersetChartDataClient } from '../../data/SupersetChartDataClient';
import { type ChartDataWarning } from '../../data/ChartDataClient';

export type FetchPivotBranchesBatchParams = {
  formData: PivotTableQueryFormData;
  batch: BatchGroup;
  currentTree: PivotTreeData;
  visibleRowDepth: number;
  visibleColDepth: number;
  getFetchPath: (path: PivotPath) => PivotPath;
  requestGroupId?: string;
};

export type FetchPivotBranchesBatchResult = {
  data?: PivotTreeData;
  warnings?: ChartDataWarning[];
  error?: Error;
};

const isAbortError = (error: unknown): boolean => {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
};

export const fetchPivotBranchesBatch = async ({
  formData,
  batch,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  getFetchPath,
  requestGroupId,
}: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
  const layout = buildLayoutContext(formData);
  const specs = buildBatchQuerySpecs({
    formData,
    layout,
    batch,
    getFetchPath,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
    chunkIndex: 0,
  });
  if (specs.length === 0) {
    return { data: undefined };
  }
  const queryPairs = specs.map(spec => ({
    rowDepth: spec.meta.rowDepth,
    colDepth: spec.meta.colDepth,
  }));
  const metricsForQuery = specs[0].metrics;
  const queryFormData =
    metricsForQuery.length > 0
      ? { ...formData, metrics: metricsForQuery }
      : formData;

  try {
    const results = await supersetChartDataClient.fetch({
      formData: queryFormData,
      specs,
      requestGroupId,
    });
    const warnings = results.flatMap(result => result.warnings ?? []);
    const resultsByQueryName = new Map<
      string,
      { data?: Record<string, unknown>[] }
    >();
    results.forEach(result => {
      const name =
        typeof result.query?.query_name === 'string'
          ? result.query.query_name
          : typeof result.query_name === 'string'
            ? result.query_name
            : undefined;
      if (name) {
        resultsByQueryName.set(name, result);
      }
    });
    const orderedResults =
      resultsByQueryName.size > 0
        ? specs.map(spec => resultsByQueryName.get(spec.queryName) ?? { data: [] })
        : results;
    const tree = buildBranchTreeFromResults({
      results: orderedResults,
      queryPairs,
      metricsForQuery,
      formData,
      rowGroupby: specs[0].meta.rowGroupbyForQueryFull,
      colGroupby: specs[0].meta.colGroupbyForQueryFull,
      rowSubtotalLevels: specs[0].meta.rowSubtotalLevels,
      colSubtotalLevels: specs[0].meta.colSubtotalLevels,
      metricsLayoutResolved: specs[0].meta.metricsLayoutResolved,
      metricInsertIndex: specs[0].meta.metricInsertIndex,
    });
    return {
      data: tree,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};
