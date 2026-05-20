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
  type FetchPivotExpansionRequest,
  type FetchPivotExpansionResult,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import {
  buildFactCoverage,
  pathsFromAxisScope,
} from '../../../src/pivot/runtime/coverage';
import {
  type PivotFact,
  type PivotFactStoreBatchScope,
  type PivotFactStoreBatch,
} from '../../../src/pivot/runtime/factStore';
import { parsePath } from '../../../src/pivot/core/path';
import {
  isMeasureLeafToken,
  isMetricToken,
  isSubtotalToken,
} from '../../../src/pivot/core/tokens';
import { type PlannedQuerySpec } from '../../../src/pivot/query/specs';
import { type PivotFactCoverage } from '../../../src/pivot/runtime/types';
import { type PivotPath, type PivotTreeData } from '../../../src/types';
import { buildExpansionQuerySpecs } from './querySpecs';

type MockFetchResult<T> = Partial<T> & {
  data?: PivotTreeData;
  factBatches?: PivotFactStoreBatch[];
};

type FetchPivotBranchParams = FetchPivotExpansionRequest;
type FetchPivotBranchesBatchParams = FetchPivotExpansionRequest;
type FetchPivotIntersectionParams = FetchPivotExpansionRequest;
type FetchPivotBranchResult = FetchPivotExpansionResult;
type FetchPivotBranchesBatchResult = FetchPivotExpansionResult;
type FetchPivotIntersectionResult = FetchPivotExpansionResult;

export const getMockExpansionRequestAxis = (
  params: FetchPivotExpansionRequest,
) => params.targets[0]?.axis ?? 'row';

export const getMockExpansionRequestPath = (
  params: FetchPivotExpansionRequest,
): PivotPath => {
  const target = params.targets[0];
  if (
    target?.need.rowScope.kind !== 'root' &&
    target?.need.columnScope.kind !== 'root'
  ) {
    return [];
  }
  return parsePath(target?.pathKey ?? '');
};

const stripMockFactBatches = <T>(result: MockFetchResult<T>): Partial<T> => {
  const fetchResult = { ...result };
  delete fetchResult.factBatches;
  return fetchResult;
};

const stripMockFactBatchesWithFetch = <T extends FetchPivotExpansionResult>(
  result: MockFetchResult<T>,
  factBatches: PivotFactStoreBatch[],
): T => ({
  ...stripMockFactBatches(result),
  ...(factBatches.length > 0 ? { didFetch: true as const } : {}),
});

const toFactPath = (path: PivotPath): PivotPath =>
  path.filter(
    value =>
      !isMetricToken(value) &&
      !isMeasureLeafToken(value) &&
      !isSubtotalToken(value),
  );

const buildFactsForCoverage = (
  tree: PivotTreeData | undefined,
  coverage: PivotFactCoverage,
): PivotFact[] => {
  if (!tree) {
    return [];
  }
  return Object.values(tree.cells).flatMap(cell => {
    const row = tree.rows[cell.rowKey];
    const col = tree.cols[cell.colKey];
    if (!row || !col) {
      return [];
    }
    const rowPath = toFactPath(row.path);
    const columnPath = toFactPath(col.path);
    if (
      rowPath.length < coverage.rowDepth ||
      columnPath.length < coverage.columnDepth
    ) {
      return [];
    }
    return Object.entries(cell.values).map(([valueKey, value]) => ({
      rowPath: rowPath.slice(0, coverage.rowDepth),
      columnPath: columnPath.slice(0, coverage.columnDepth),
      valueKey,
      value,
    }));
  });
};

const pathStartsWith = (path: PivotPath, prefix: PivotPath) =>
  prefix.every((value, index) => path[index] === value);

const matchesAnyPath = (path: PivotPath, prefixes: PivotPath[]) =>
  prefixes.some(prefix => pathStartsWith(path, prefix));

const buildFactsForScope = (
  facts: PivotFact[],
  scope: PivotFactStoreBatchScope,
): PivotFact[] => {
  switch (scope.kind) {
    case 'branch':
    case 'axisPaths': {
      return facts.filter(fact =>
        scope.axis === 'row'
          ? matchesAnyPath(fact.rowPath, scope.paths)
          : matchesAnyPath(fact.columnPath, scope.paths),
      );
    }
    case 'intersection':
      return facts.filter(
        fact =>
          matchesAnyPath(fact.rowPath, scope.rowPaths) &&
          matchesAnyPath(fact.columnPath, scope.columnPaths),
      );
    default:
      return facts;
  }
};

const buildFactsForSpec = (
  spec: PlannedQuerySpec,
  data?: PivotTreeData,
): PivotFact[] => {
  const facts = buildFactsForCoverage(data, spec.meta.factSelector.coverage);
  return buildFactsForScope(facts, spec.meta.factSelector.scope);
};

const buildMockFactBatchesFromSpecs = (
  specs: PlannedQuerySpec[],
  data?: PivotTreeData,
): PivotFactStoreBatch[] =>
  specs.map(spec => ({
    ...spec.meta.factSelector,
    facts: buildFactsForSpec(spec, data),
  }));

export const buildMockExpansionFactBatches = ({
  formData,
  layout,
  targets,
  data,
}: Pick<FetchPivotExpansionRequest, 'formData' | 'layout' | 'targets'> & {
  data?: PivotTreeData;
}): PivotFactStoreBatch[] => {
  const specs = buildExpansionQuerySpecs({
    formData,
    layout,
    targets,
  });
  return buildMockFactBatchesFromSpecs(specs, data);
};

export const buildMockBranchFactBatches = buildMockExpansionFactBatches;

export const buildMockBranchFetchResult = (
  params: FetchPivotBranchParams,
  result: MockFetchResult<FetchPivotBranchResult> = {},
): FetchPivotBranchResult => {
  const factBatches =
    result.factBatches ??
    buildMockExpansionFactBatches({ ...params, data: result.data });
  factBatches.forEach(batch => params.factStore?.upsertBatch(batch));
  return stripMockFactBatchesWithFetch(result, factBatches);
};

export const resolveMockBranchFetchResult =
  (result: MockFetchResult<FetchPivotBranchResult> = {}) =>
  (params: FetchPivotBranchParams) =>
    Promise.resolve(buildMockBranchFetchResult(params, result));

export const buildMockBatchFactBatches = ({
  formData,
  layout,
  targets,
  data,
}: Pick<FetchPivotBranchesBatchParams, 'targets' | 'formData' | 'layout'> & {
  data?: PivotTreeData;
}): PivotFactStoreBatch[] => {
  const specs = buildExpansionQuerySpecs({
    formData,
    layout,
    targets,
  });
  return buildMockFactBatchesFromSpecs(specs, data);
};

export const buildMockBatchFetchResult = (
  params: FetchPivotBranchesBatchParams,
  result: MockFetchResult<FetchPivotBranchesBatchResult> = {},
): FetchPivotBranchesBatchResult => {
  const factBatches =
    result.factBatches ??
    buildMockBatchFactBatches({ ...params, data: result.data });
  factBatches.forEach(batch => params.factStore?.upsertBatch(batch));
  return stripMockFactBatchesWithFetch(result, factBatches);
};

export const resolveMockBatchFetchResult =
  (result: MockFetchResult<FetchPivotBranchesBatchResult> = {}) =>
  (params: FetchPivotBranchesBatchParams) =>
    Promise.resolve(buildMockBatchFetchResult(params, result));

export const buildMockIntersectionFactBatches = ({
  formData,
  layout,
  targets,
  data,
}: Pick<FetchPivotIntersectionParams, 'formData' | 'layout' | 'targets'> & {
  data?: PivotTreeData;
}): PivotFactStoreBatch[] => {
  const specs = buildExpansionQuerySpecs({
    formData,
    layout,
    targets,
  });
  const target = targets[0];
  if (!target) {
    return [];
  }
  return specs.length > 0
    ? buildMockFactBatchesFromSpecs(specs, data)
    : [
        {
          coverage: buildFactCoverage({
            rowDimensions: layout.pivotProgram.rowDimensions,
            columnDimensions: layout.pivotProgram.columnDimensions,
            rowDepth: target.need.rowDepth,
            columnDepth: target.need.columnDepth,
          }),
          facts: [],
          valueKeys: [],
          scope: {
            kind: 'intersection',
            rowPaths: pathsFromAxisScope(target.need.rowScope),
            columnPaths: pathsFromAxisScope(target.need.columnScope),
          },
        },
      ];
};

export const buildMockIntersectionFetchResult = (
  params: FetchPivotIntersectionParams,
  result: MockFetchResult<FetchPivotIntersectionResult> = {},
): FetchPivotIntersectionResult => {
  const factBatches =
    result.factBatches ??
    buildMockIntersectionFactBatches({ ...params, data: result.data });
  factBatches.forEach(batch => params.factStore?.upsertBatch(batch));
  return stripMockFactBatchesWithFetch(result, factBatches);
};

export const buildMockExpansionFetchResult = (
  params: FetchPivotExpansionRequest,
  result: MockFetchResult<FetchPivotExpansionResult> = {},
): FetchPivotExpansionResult => {
  const factBatches =
    result.factBatches ??
    buildMockExpansionFactBatches({ ...params, data: result.data });
  factBatches.forEach(batch => params.factStore?.upsertBatch(batch));
  return stripMockFactBatchesWithFetch(result, factBatches);
};

export const resolveMockExpansionFetchResult =
  (result: MockFetchResult<FetchPivotExpansionResult> = {}) =>
  (params: FetchPivotExpansionRequest) =>
    Promise.resolve(buildMockExpansionFetchResult(params, result));
