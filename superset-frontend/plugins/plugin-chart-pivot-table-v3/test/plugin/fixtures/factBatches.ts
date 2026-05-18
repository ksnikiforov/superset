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
import { buildFactCoverage } from '../../../src/pivot/runtime/coverage';
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
import {
  buildExpansionQuerySpecs,
  type PlannedQuerySpec,
} from '../../../src/pivot/query/specs';
import { type PivotFactCoverage } from '../../../src/pivot/runtime/types';
import { type PivotPath, type PivotTreeData } from '../../../src/types';

type MockFetchResult<T> = Partial<T> & {
  data?: PivotTreeData;
  factBatches?: PivotFactStoreBatch[];
};

type FetchPivotBranchParams = Extract<
  FetchPivotExpansionRequest,
  { kind: 'branch' }
>;
type FetchPivotBranchesBatchParams = Extract<
  FetchPivotExpansionRequest,
  { kind: 'batch' }
>;
type FetchPivotIntersectionParams = Extract<
  FetchPivotExpansionRequest,
  { kind: 'intersection' }
>;
type FetchPivotBranchResult = FetchPivotExpansionResult;
type FetchPivotBranchesBatchResult = FetchPivotExpansionResult;
type FetchPivotIntersectionResult = FetchPivotExpansionResult;

const stripMockFactBatches = <T>(result: MockFetchResult<T>): Partial<T> => {
  const fetchResult = { ...result };
  delete fetchResult.factBatches;
  return fetchResult;
};

const toFactPath = (path: PivotPath, depth: number): PivotPath =>
  path
    .filter(
      value =>
        !isMetricToken(value) &&
        !isMeasureLeafToken(value) &&
        !isSubtotalToken(value),
    )
    .slice(0, depth);

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
    return Object.entries(cell.values).map(([valueKey, value]) => ({
      rowPath: toFactPath(row.path, coverage.rowDepth),
      columnPath: toFactPath(col.path, coverage.columnDepth),
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
      return facts.filter(fact =>
        scope.axis === 'row'
          ? pathStartsWith(fact.rowPath, scope.path)
          : pathStartsWith(fact.columnPath, scope.path),
      );
    case 'batch': {
      const paths =
        scope.siblingValues.length > 0
          ? scope.siblingValues.map(value => [...scope.parentPath, value])
          : [scope.parentPath];
      return facts.filter(fact =>
        scope.axis === 'row'
          ? matchesAnyPath(fact.rowPath, paths)
          : matchesAnyPath(fact.columnPath, paths),
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
  const facts = buildFactsForCoverage(data, spec.meta.coverage);
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

export const buildMockBranchFactBatches = ({
  formData,
  layout,
  axis,
  path,
  visibleRowDepth = 0,
  visibleColDepth = 0,
  data,
}: Pick<
  FetchPivotBranchParams,
  | 'axis'
  | 'formData'
  | 'layout'
  | 'path'
  | 'visibleColDepth'
  | 'visibleRowDepth'
> & { data?: PivotTreeData }): PivotFactStoreBatch[] => {
  const specs = buildExpansionQuerySpecs({
    kind: 'branch',
    formData,
    layout,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });
  return buildMockFactBatchesFromSpecs(specs, data);
};

export const buildMockBranchFetchResult = (
  params: FetchPivotBranchParams,
  result: MockFetchResult<FetchPivotBranchResult> = {},
): FetchPivotBranchResult => {
  const factBatches =
    result.factBatches ??
    buildMockBranchFactBatches({ ...params, data: result.data });
  factBatches.forEach(batch => params.factStore?.upsertBatch(batch));
  return stripMockFactBatches(result);
};

export const resolveMockBranchFetchResult =
  (result: MockFetchResult<FetchPivotBranchResult> = {}) =>
  (params: FetchPivotBranchParams) =>
    Promise.resolve(buildMockBranchFetchResult(params, result));

export const buildMockBatchFactBatches = ({
  formData,
  layout,
  batch,
  visibleRowDepth,
  visibleColDepth,
  data,
}: Pick<
  FetchPivotBranchesBatchParams,
  'batch' | 'formData' | 'layout' | 'visibleColDepth' | 'visibleRowDepth'
> & { data?: PivotTreeData }): PivotFactStoreBatch[] => {
  const specs = buildExpansionQuerySpecs({
    kind: 'batch',
    formData,
    layout,
    batch,
    visibleRowDepth,
    visibleColDepth,
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
  return stripMockFactBatches(result);
};

export const resolveMockBatchFetchResult =
  (result: MockFetchResult<FetchPivotBranchesBatchResult> = {}) =>
  (params: FetchPivotBranchesBatchParams) =>
    Promise.resolve(buildMockBatchFetchResult(params, result));

export const buildMockIntersectionFactBatches = ({
  formData,
  layout,
  rowPathKeys,
  columnPathKeys,
  visibleRowDepth,
  visibleColDepth,
  data,
}: Pick<
  FetchPivotIntersectionParams,
  | 'columnPathKeys'
  | 'formData'
  | 'layout'
  | 'rowPathKeys'
  | 'visibleColDepth'
  | 'visibleRowDepth'
> & { data?: PivotTreeData }): PivotFactStoreBatch[] => {
  const specs = buildExpansionQuerySpecs({
    kind: 'intersection',
    formData,
    layout,
    rowPathKeys,
    columnPathKeys,
    visibleRowDepth,
    visibleColDepth,
  });
  return specs.length > 0
    ? buildMockFactBatchesFromSpecs(specs, data)
    : [
        {
          coverage: buildFactCoverage({
            rowDimensions: layout.pivotProgram.rowDimensions,
            columnDimensions: layout.pivotProgram.columnDimensions,
            rowDepth: visibleRowDepth,
            columnDepth: visibleColDepth,
          }),
          facts: [],
          valueKeys: [],
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
  result: MockFetchResult<FetchPivotIntersectionResult> = {},
): FetchPivotIntersectionResult => {
  const factBatches =
    result.factBatches ??
    buildMockIntersectionFactBatches({ ...params, data: result.data });
  factBatches.forEach(batch => params.factStore?.upsertBatch(batch));
  return stripMockFactBatches(result);
};

export const buildMockExpansionFetchResult = (
  params: FetchPivotExpansionRequest,
  result: MockFetchResult<FetchPivotExpansionResult> = {},
): FetchPivotExpansionResult => {
  switch (params.kind) {
    case 'branch':
      return buildMockBranchFetchResult(params, result);
    case 'batch':
      return buildMockBatchFetchResult(params, result);
    case 'intersection':
      return buildMockIntersectionFetchResult(params, result);
    default:
      return stripMockFactBatches(result);
  }
};

export const resolveMockExpansionFetchResult =
  (result: MockFetchResult<FetchPivotExpansionResult> = {}) =>
  (params: FetchPivotExpansionRequest) =>
    Promise.resolve(buildMockExpansionFetchResult(params, result));
