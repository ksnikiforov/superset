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
  type FetchPivotBranchParams,
  type FetchPivotBranchResult,
} from '../../../src/fetchPivotBranch';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import {
  appendLoadedBranchCoverageMarkers,
  buildLoadedBranchCoverageMarkers,
} from '../../../src/pivot/runtime/loadedBranchCoverage';
import {
  type FetchPivotBranchesBatchParams,
  type FetchPivotBranchesBatchResult,
} from '../../../src/pivot/query/fetchPivotBranchesBatch';
import { buildFactCoverage } from '../../../src/pivot/runtime/coverage';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import { parsePath } from '../../../src/pivot/core/path';
import { type PivotTreeData } from '../../../src/types';

export const buildMockBranchFactBatches = ({
  formData,
  axis,
  path,
  visibleRowDepth = 0,
  visibleColDepth = 0,
  data,
}: Pick<
  FetchPivotBranchParams,
  'axis' | 'formData' | 'path' | 'visibleColDepth' | 'visibleRowDepth'
> & {
  data?: PivotTreeData;
}): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  return buildLoadedBranchCoverageMarkers({
    axis,
    tree: data,
    basePaths: [path],
    seedPaths: [path],
    pivotProgram: layout.pivotProgram,
    visibleRowDepth,
    visibleColDepth,
  });
};

export const buildMockBranchFetchResult = (
  params: FetchPivotBranchParams,
  result: Partial<FetchPivotBranchResult> = {},
): FetchPivotBranchResult => ({
  ...result,
  factBatches:
    result.factBatches ??
    buildMockBranchFactBatches({ ...params, data: result.data }),
});

export const resolveMockBranchFetchResult =
  (result: Partial<FetchPivotBranchResult> = {}) =>
  (params: FetchPivotBranchParams) =>
    Promise.resolve(buildMockBranchFetchResult(params, result));

export const buildMockBatchFactBatches = ({
  formData,
  batch,
  visibleRowDepth,
  visibleColDepth,
  data,
}: Pick<
  FetchPivotBranchesBatchParams,
  'batch' | 'formData' | 'visibleColDepth' | 'visibleRowDepth'
> & {
  data?: PivotTreeData;
}): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  const parentPath = parsePath(batch.parentPathKey);
  const batchMarker: PivotFactStoreBatch = {
    coverage: buildFactCoverage({
      reason: 'expand',
      rowDimensions: layout.pivotProgram.rowDimensions,
      columnDimensions: layout.pivotProgram.columnDimensions,
      rowDepth: visibleRowDepth,
      columnDepth: visibleColDepth,
    }),
    facts: [],
    scope: {
      kind: 'batch',
      axis: batch.axis,
      parentPath,
      siblingValues: batch.siblingValues,
    },
  };
  return appendLoadedBranchCoverageMarkers({
    existingBatches: [batchMarker],
    axis: batch.axis,
    tree: data,
    basePaths:
      batch.siblingValues.length > 0
        ? batch.siblingValues.map(value => [...parentPath, value])
        : [parentPath],
    pivotProgram: layout.pivotProgram,
    visibleRowDepth,
    visibleColDepth,
  });
};

export const buildMockBatchFetchResult = (
  params: FetchPivotBranchesBatchParams,
  result: Partial<FetchPivotBranchesBatchResult> = {},
): FetchPivotBranchesBatchResult => ({
  ...result,
  factBatches:
    result.factBatches ??
    buildMockBatchFactBatches({ ...params, data: result.data }),
});

export const resolveMockBatchFetchResult =
  (result: Partial<FetchPivotBranchesBatchResult> = {}) =>
  (params: FetchPivotBranchesBatchParams) =>
    Promise.resolve(buildMockBatchFetchResult(params, result));
