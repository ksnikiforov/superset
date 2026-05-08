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
  type FetchPivotBranchesBatchParams,
  type FetchPivotBranchesBatchResult,
} from '../../../src/pivot/query/fetchPivotBranchesBatch';
import { buildFactCoverage } from '../../../src/pivot/runtime/coverage';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import { parsePath, serializePath } from '../../../src/pivot/core/path';
import { isMetricToken, isSubtotalToken } from '../../../src/pivot/core/tokens';
import {
  type PivotAxis,
  type PivotPath,
  type PivotTreeData,
} from '../../../src/types';

const collectLoadedBranchPaths = ({
  axis,
  data,
  path,
}: {
  axis: PivotAxis;
  data?: PivotTreeData;
  path: PivotPath;
}) => {
  const pathsByKey = new Map<string, PivotPath>([[serializePath(path), path]]);
  if (!data) {
    return Array.from(pathsByKey.values());
  }
  const nodes = axis === 'row' ? data.rows : data.cols;
  const hasLoadedChild = (path: PivotPath) =>
    Object.values(nodes).some(node => {
      if (node.path.length !== path.length + 1) {
        return false;
      }
      if (path.some((value, index) => node.path[index] !== value)) {
        return false;
      }
      const childValue = node.path[path.length];
      return !isMetricToken(childValue) && !isSubtotalToken(childValue);
    });
  Object.values(nodes).forEach(node => {
    if (node.hasChildren && hasLoadedChild(node.path)) {
      pathsByKey.set(node.key, node.path);
    }
  });
  return Array.from(pathsByKey.values());
};

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
  const coverage = buildFactCoverage({
    reason: 'expand',
    rowDimensions: layout.pivotProgram.rowDimensions,
    columnDimensions: layout.pivotProgram.columnDimensions,
    rowDepth: visibleRowDepth,
    columnDepth: visibleColDepth,
  });
  return collectLoadedBranchPaths({ axis, data, path }).map(branchPath => ({
    coverage,
    facts: [],
    scope: {
      kind: 'branch',
      axis,
      path: branchPath,
    },
  }));
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
      scope: {
        kind: 'batch',
        axis: batch.axis,
        parentPath: parsePath(batch.parentPathKey),
        siblingValues: batch.siblingValues,
      },
    },
  ];
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
