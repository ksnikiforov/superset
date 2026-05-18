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
} from '../../../src/pivot/query/fetchPivotBranch';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import { buildFactCoverage } from '../../../src/pivot/runtime/coverage';
import {
  type PivotFact,
  type PivotFactStoreBatchScope,
  type PivotFactStoreBatch,
} from '../../../src/pivot/runtime/factStore';
import { parsePath } from '../../../src/pivot/core/path';
import {
  factStoreSelectorFromSpec,
} from '../../../src/pivot/runtime/materializePivotTree';
import {
  buildBatchQuerySpecs,
  buildBranchQuerySpecs,
  buildIntersectionQuerySpecs,
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
      rowPath: row.path.slice(0, coverage.rowDepth),
      columnPath: col.path.slice(0, coverage.columnDepth),
      valueKey,
      value,
      role: 'visible' as const,
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
  return buildFactsForScope(facts, factStoreSelectorFromSpec(spec).scope);
};

const buildMockFactBatchesFromSpecs = (
  specs: PlannedQuerySpec[],
  data?: PivotTreeData,
): PivotFactStoreBatch[] =>
  specs.map(spec => ({
    ...factStoreSelectorFromSpec(spec),
    facts: buildFactsForSpec(spec, data),
  }));

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
> & { data?: PivotTreeData }): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  const specs = buildBranchQuerySpecs({
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
  if (!result.error) {
    params.factStore?.upsertBatches(factBatches);
  }
  return stripMockFactBatches(result);
};

export const resolveMockBranchFetchResult =
  (result: MockFetchResult<FetchPivotBranchResult> = {}) =>
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
> & { data?: PivotTreeData }): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  const specs = buildBatchQuerySpecs({
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
  if (!result.error) {
    params.factStore?.upsertBatches(factBatches);
  }
  return stripMockFactBatches(result);
};

export const resolveMockBatchFetchResult =
  (result: MockFetchResult<FetchPivotBranchesBatchResult> = {}) =>
  (params: FetchPivotBranchesBatchParams) =>
    Promise.resolve(buildMockBatchFetchResult(params, result));

export const buildMockIntersectionFactBatches = ({
  formData,
  rowPathKeys,
  columnPathKeys,
  visibleRowDepth,
  visibleColDepth,
  data,
}: Pick<
  FetchPivotIntersectionParams,
  | 'columnPathKeys'
  | 'formData'
  | 'rowPathKeys'
  | 'visibleColDepth'
  | 'visibleRowDepth'
> & { data?: PivotTreeData }): PivotFactStoreBatch[] => {
  const layout = buildLayoutContext(formData);
  const specs = buildIntersectionQuerySpecs({
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
            reason: 'expand',
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
  if (!result.error) {
    params.factStore?.upsertBatches(factBatches);
  }
  return stripMockFactBatches(result);
};
