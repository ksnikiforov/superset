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
  type FetchPivotBranchesBatchParams,
  type FetchPivotBranchesBatchResult,
  type FetchPivotBranchParams,
  type FetchPivotBranchResult,
  type FetchPivotIntersectionParams,
  type FetchPivotIntersectionResult,
} from '../../../src/pivot/query/fetchPivotBranch';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import { resolveFetchContext } from '../../../src/pivot/query/resolveFetchContext';
import { buildFactCoverage } from '../../../src/pivot/runtime/coverage';
import {
  buildFactValueKeys,
  type PivotFactStoreBatch,
} from '../../../src/pivot/runtime/factStore';
import { parsePath } from '../../../src/pivot/core/path';

export const buildMockBranchFactBatches = ({
  formData,
  axis,
  path,
  visibleRowDepth = 0,
  visibleColDepth = 0,
}: Pick<
  FetchPivotBranchParams,
  'axis' | 'formData' | 'path' | 'visibleColDepth' | 'visibleRowDepth'
>): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  const context = resolveFetchContext({
    formData,
    layout,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });
  return context.coverages.map(coverage => ({
    coverage,
    facts: [],
    valueKeys: buildFactValueKeys({
      metricKeys: layout.pivotProgram.metricKeys,
    }),
    scope: {
      kind: 'branch',
      axis,
      path,
    },
  }));
};

export const buildMockBranchFetchResult = (
  params: FetchPivotBranchParams,
  result: Partial<FetchPivotBranchResult> = {},
): FetchPivotBranchResult => {
  const factBatches = result.factBatches ?? buildMockBranchFactBatches(params);
  params.factStore?.registerCompatibleCoverageBatches(factBatches);
  return {
    ...result,
    factBatches,
  };
};

export const resolveMockBranchFetchResult =
  (result: Partial<FetchPivotBranchResult> = {}) =>
  (params: FetchPivotBranchParams) =>
    Promise.resolve(buildMockBranchFetchResult(params, result));

export const buildMockBatchFactBatches = ({
  formData,
  batch,
  visibleRowDepth,
  visibleColDepth,
}: Pick<
  FetchPivotBranchesBatchParams,
  'batch' | 'formData' | 'visibleColDepth' | 'visibleRowDepth'
>): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  const parentPath = parsePath(batch.parentPathKey);
  const representative = [...parentPath, batch.siblingValues[0]].filter(
    value => value !== undefined,
  );
  const context = resolveFetchContext({
    formData,
    layout,
    axis: batch.axis,
    path: representative,
    visibleRowDepth,
    visibleColDepth,
  });
  return context.coverages.map(coverage => ({
    coverage,
    facts: [],
    valueKeys: buildFactValueKeys({
      metricKeys: layout.pivotProgram.metricKeys,
    }),
    scope: {
      kind: 'batch',
      axis: batch.axis,
      parentPath,
      siblingValues: batch.siblingValues,
    },
  }));
};

export const buildMockBatchFetchResult = (
  params: FetchPivotBranchesBatchParams,
  result: Partial<FetchPivotBranchesBatchResult> = {},
): FetchPivotBranchesBatchResult => {
  const factBatches = result.factBatches ?? buildMockBatchFactBatches(params);
  params.factStore?.registerCompatibleCoverageBatches(factBatches);
  return {
    ...result,
    factBatches,
  };
};

export const resolveMockBatchFetchResult =
  (result: Partial<FetchPivotBranchesBatchResult> = {}) =>
  (params: FetchPivotBranchesBatchParams) =>
    Promise.resolve(buildMockBatchFetchResult(params, result));

export const buildMockIntersectionFactBatches = ({
  formData,
  rowPathKeys,
  columnPathKeys,
  visibleRowDepth,
  visibleColDepth,
}: Pick<
  FetchPivotIntersectionParams,
  | 'columnPathKeys'
  | 'formData'
  | 'rowPathKeys'
  | 'visibleColDepth'
  | 'visibleRowDepth'
>): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  return [
    {
      coverage: buildFactCoverage({
        reason: 'expand',
        rowDimensions: layout.pivotProgram.rowDimensions,
        columnDimensions: layout.pivotProgram.columnDimensions,
        rowDepth: visibleRowDepth,
        columnDepth: visibleColDepth,
      }),
      facts: [],
      valueKeys: buildFactValueKeys({
        metricKeys: layout.pivotProgram.metricKeys,
      }),
      scope: {
        kind: 'intersection',
        rowPaths: rowPathKeys.map(parsePath),
        columnPaths: columnPathKeys.map(parsePath),
      },
    },
  ];
};

export const buildMockIntersectionFetchResult = (
  params: FetchPivotIntersectionParams,
  result: Partial<FetchPivotIntersectionResult> = {},
): FetchPivotIntersectionResult => {
  const factBatches =
    result.factBatches ?? buildMockIntersectionFactBatches(params);
  params.factStore?.registerCompatibleCoverageBatches(factBatches);
  return {
    ...result,
    factBatches,
  };
};
