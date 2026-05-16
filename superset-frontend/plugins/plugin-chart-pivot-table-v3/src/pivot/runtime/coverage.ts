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
  MetricsLayoutEnum,
  type PivotAxis,
  type PivotPath,
  type PivotRuntimeLayout,
} from '../../types';
import { parsePath } from '../core/path';
import {
  decodeMetricKey,
  isMeasureLeafToken,
  isMetricToken,
} from '../core/tokens';
import { stableStringify } from '../shared/stableStringify';
import { getNextAxisLevelForPath } from './paths';
import {
  projectionQueryDimensions,
  projectionQueryFilterPath,
  resolveAxisProjection,
  type PivotAxisProjection,
} from './projection';
import type { PivotFactSelector, PivotFactStoreBatch } from './factStore';
import type {
  PivotCoverageReason,
  PivotFactCoverage,
  PivotProgram,
} from './types';

export type FactCoverageInput = {
  rowDimensions: PivotProgram['rowDimensions'];
  columnDimensions: PivotProgram['columnDimensions'];
  rowDepth: number;
  columnDepth: number;
  reason?: PivotCoverageReason;
};

export type ExpansionValuesLevelInput = {
  program: PivotProgram;
  axis: PivotAxis;
  path: PivotPath;
};

export type BranchFactCoverageInput = {
  program: PivotProgram;
  axis: PivotAxis;
  projection: PivotAxisProjection;
  rowDepth: number;
  columnDepth: number;
  rowDimensions?: PivotProgram['rowDimensions'];
  columnDimensions?: PivotProgram['columnDimensions'];
  rowSubtotalLevels: number[];
  columnSubtotalLevels: number[];
  rowTotals?: boolean;
  columnTotals?: boolean;
  includeRowTotalForColumnFormatting?: boolean;
  includeColumnTotalForRowFormatting?: boolean;
  reason?: PivotCoverageReason;
};

export type AxisPathScope =
  | { kind: 'root' }
  | { kind: 'paths'; paths: PivotPath[] }
  | { kind: 'scopedFull'; ancestorPaths: PivotPath[] };

export type PivotExpansionCoverageRequest = {
  axis: PivotAxis;
  pathKey: string;
  rowDepth: number;
  columnDepth: number;
  rowPathKeys?: string[];
  columnPathKeys?: string[];
};

export type PivotExpansionCoverageDiff = (
  requests: PivotExpansionCoverageRequest[],
) => PivotExpansionCoverageRequest[];

export type PivotCoverageNeedReason =
  | 'root'
  | 'expand'
  | 'intersection'
  | 'subtotal'
  | 'sort';

export type PivotCoverageNeed = {
  rowDepth: number;
  columnDepth: number;
  rowDimensions: PivotProgram['rowDimensions'];
  columnDimensions: PivotProgram['columnDimensions'];
  valueKeys: string[];
  rowScope: AxisPathScope;
  columnScope: AxisPathScope;
  reason: PivotCoverageNeedReason;
};

type DepthPair = { rowDepth: number; columnDepth: number };

const clampDepth = (depth: number, maxDepth: number) => {
  if (!Number.isFinite(depth)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(depth), 0), maxDepth);
};

const parentDepth = (depth: number) => Math.max(depth - 1, 0);

const rangeFromOne = (depth: number): number[] =>
  Array.from({ length: depth }, (_, idx) => idx + 1);

const uniqueDepths = (depths: number[]) => Array.from(new Set(depths));
const arraysEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const normalizeFactValueKeys = (valueKeys: string[] = []) =>
  Array.from(new Set(valueKeys)).sort();

const valueKeysCover = (
  available: string[] | undefined,
  required: string[],
) => {
  const requiredValueKeys = normalizeFactValueKeys(required);
  if (requiredValueKeys.length === 0) {
    return true;
  }
  const availableValueKeys = new Set(normalizeFactValueKeys(available));
  return requiredValueKeys.every(valueKey => availableValueKeys.has(valueKey));
};

const columnRefKey = (column: PivotProgram['rowDimensions'][number]) =>
  typeof column === 'string'
    ? column
    : column.sqlExpression || column.label || '';

const columnRefsMatch = (
  left: PivotProgram['rowDimensions'],
  right: PivotProgram['rowDimensions'],
) =>
  left.length === right.length &&
  left.every(
    (column, index) => columnRefKey(column) === columnRefKey(right[index]),
  );

const columnRefsStartWith = (
  left: PivotProgram['rowDimensions'],
  prefix: PivotProgram['rowDimensions'],
) =>
  left.length >= prefix.length &&
  prefix.every(
    (column, index) => columnRefKey(column) === columnRefKey(left[index]),
  );

const pathStartsWith = (path: PivotPath, prefix: PivotPath) =>
  prefix.every((value, index) => path[index] === value);

const pathContainsValuesToken = (path: PivotPath) =>
  path.some(value => isMetricToken(value) || isMeasureLeafToken(value));

const axisScopeContainsValuesToken = (scope: AxisPathScope) => {
  if (scope.kind === 'root') {
    return false;
  }
  const paths = scope.kind === 'paths' ? scope.paths : scope.ancestorPaths;
  return paths.some(pathContainsValuesToken);
};

const batchScopePaths = ({
  parentPath,
  siblingValues,
}: Extract<PivotFactStoreBatch['scope'], { kind: 'batch' }>) =>
  siblingValues.map(value => [...parentPath, value]);

const intersectionScopePaths = (
  scope: Extract<PivotFactStoreBatch['scope'], { kind: 'intersection' }>,
  axis: PivotAxis,
) => (axis === 'row' ? scope.rowPaths : scope.columnPaths);

const axisPathScopeFromPath = (path: PivotPath): AxisPathScope => ({
  kind: 'paths',
  paths: [path],
});

const valueKeysForExpansionPath = (
  path: PivotPath,
  fallbackValueKeys: string[],
) => {
  const metricKeys = path
    .map(value => decodeMetricKey(value))
    .filter((value): value is string => value !== undefined);
  return metricKeys.length > 0
    ? normalizeFactValueKeys(metricKeys)
    : fallbackValueKeys;
};

const buildExpansionCoverageNeed = ({
  request,
  program,
  valueKeys,
}: {
  request: PivotExpansionCoverageRequest;
  program: PivotProgram;
  valueKeys: string[];
}): PivotCoverageNeed => {
  if (request.rowPathKeys && request.columnPathKeys) {
    const rowPaths = request.rowPathKeys.map(parsePath);
    const columnPaths = request.columnPathKeys.map(parsePath);
    return {
      reason: 'intersection',
      rowDepth: request.rowDepth,
      columnDepth: request.columnDepth,
      rowDimensions: program.rowDimensions.slice(0, request.rowDepth),
      columnDimensions: program.columnDimensions.slice(0, request.columnDepth),
      valueKeys,
      rowScope: { kind: 'paths', paths: rowPaths },
      columnScope: { kind: 'paths', paths: columnPaths },
    };
  }
  const path = parsePath(request.pathKey);
  const branchDimensions = projectionQueryDimensions(
    resolveAxisProjection({
      program,
      axis: request.axis,
      path,
    }),
  );
  const branchDimensionDepth = branchDimensions.length;
  const rowDepth =
    request.axis === 'row' ? branchDimensionDepth : request.rowDepth;
  const columnDepth =
    request.axis === 'col' ? branchDimensionDepth : request.columnDepth;
  const rowDimensions =
    request.axis === 'row'
      ? branchDimensions
      : program.rowDimensions.slice(0, rowDepth);
  const columnDimensions =
    request.axis === 'col'
      ? branchDimensions
      : program.columnDimensions.slice(0, columnDepth);

  return {
    reason: 'expand',
    rowDepth,
    columnDepth,
    rowDimensions,
    columnDimensions,
    valueKeys: valueKeysForExpansionPath(path, valueKeys),
    rowScope:
      request.axis === 'row' ? axisPathScopeFromPath(path) : { kind: 'root' },
    columnScope:
      request.axis === 'col' ? axisPathScopeFromPath(path) : { kind: 'root' },
  };
};

const isRuntimeLayoutCoverageScope = (
  scope: PivotFactStoreBatch['scope'],
): boolean => {
  if (scope.kind === 'bootstrap' || scope.kind === 'root') {
    return true;
  }
  if (scope.kind !== 'branch') {
    return false;
  }
  return scope.path.every(isMetricToken);
};

const scopeRestrictsAxis = (
  scope: PivotFactStoreBatch['scope'],
  axis: PivotAxis,
) =>
  (scope.kind === 'branch' || scope.kind === 'batch') && scope.axis === axis
    ? true
    : scope.kind === 'intersection';

const scopeCoversAxisPaths = (
  scope: PivotFactStoreBatch['scope'],
  axis: PivotAxis,
  needScope: AxisPathScope,
) => {
  if (needScope.kind === 'root') {
    return (
      scope.kind === 'bootstrap' ||
      scope.kind === 'root' ||
      !scopeRestrictsAxis(scope, axis)
    );
  }
  if (scope.kind === 'bootstrap' || scope.kind === 'root') {
    if (axisScopeContainsValuesToken(needScope)) {
      return false;
    }
    const paths =
      needScope.kind === 'paths' ? needScope.paths : needScope.ancestorPaths;
    return paths.every(path => path.length === 0);
  }
  if (
    (scope.kind === 'branch' || scope.kind === 'batch') &&
    scope.axis !== axis
  ) {
    return true;
  }
  const candidatePaths =
    scope.kind === 'branch'
      ? [scope.path]
      : scope.kind === 'batch'
        ? batchScopePaths(scope)
        : scope.kind === 'intersection'
          ? intersectionScopePaths(scope, axis)
          : [];
  if (needScope.kind === 'scopedFull') {
    return needScope.ancestorPaths.every(ancestorPath =>
      candidatePaths.some(candidatePath =>
        pathStartsWith(ancestorPath, candidatePath),
      ),
    );
  }
  return needScope.paths.every(needPath =>
    candidatePaths.some(candidatePath =>
      pathStartsWith(needPath, candidatePath),
    ),
  );
};

const selectionSignature = (selection: PivotRuntimeLayout['leafSelection']) =>
  stableStringify(selection ?? {});

export const isSameRuntimeLayout = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
) =>
  arraysEqual(prev.rows, next.rows) &&
  arraysEqual(prev.cols, next.cols) &&
  arraysEqual(prev.metrics, next.metrics) &&
  arraysEqual(prev.leafOrder ?? [], next.leafOrder ?? []) &&
  selectionSignature(prev.leafSelection) ===
    selectionSignature(next.leafSelection) &&
  prev.valuePlacement.axis === next.valuePlacement.axis &&
  prev.valuePlacement.index === next.valuePlacement.index;

const placementBeforeSharedDimensions = (
  axisDimensions: string[],
  index: number,
  sharedDimensions: Set<string>,
) => axisDimensions.slice(0, index).filter(item => sharedDimensions.has(item));

const shouldFetchForValuePlacementChange = ({
  prev,
  next,
}: {
  prev: PivotRuntimeLayout;
  next: PivotRuntimeLayout;
}) => {
  if (prev.valuePlacement.axis !== next.valuePlacement.axis) {
    const prevValueAxis =
      prev.valuePlacement.axis === 'row' ? prev.rows : prev.cols;
    const nextValueAxis =
      next.valuePlacement.axis === 'row' ? next.rows : next.cols;
    return prevValueAxis.length > 0 || nextValueAxis.length > 0;
  }
  const prevValueAxis =
    prev.valuePlacement.axis === 'row' ? prev.rows : prev.cols;
  const nextValueAxis =
    next.valuePlacement.axis === 'row' ? next.rows : next.cols;
  if (prevValueAxis.length === 0 && nextValueAxis.length === 0) {
    return false;
  }
  const sharedDimensions = new Set(
    prevValueAxis.filter(dimension => nextValueAxis.includes(dimension)),
  );
  return !arraysEqual(
    placementBeforeSharedDimensions(
      prevValueAxis,
      prev.valuePlacement.index,
      sharedDimensions,
    ),
    placementBeforeSharedDimensions(
      nextValueAxis,
      next.valuePlacement.index,
      sharedDimensions,
    ),
  );
};

const shouldFetchForSemanticLayoutChange = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
): boolean => {
  if (
    selectionSignature(prev.leafSelection) !==
    selectionSignature(next.leafSelection)
  ) {
    return true;
  }
  if (
    prev.valuePlacement.axis !== next.valuePlacement.axis ||
    prev.valuePlacement.index !== next.valuePlacement.index
  ) {
    if (
      shouldFetchForValuePlacementChange({
        prev,
        next,
      })
    ) {
      return true;
    }
    return false;
  }
  return false;
};

export const expansionRevealsValuesLevel = (input: ExpansionValuesLevelInput) =>
  getNextAxisLevelForPath(input)?.kind === 'values';

export const buildFactCoverage = ({
  rowDimensions,
  columnDimensions,
  rowDepth,
  columnDepth,
  reason = 'expand',
}: FactCoverageInput): PivotFactCoverage => {
  const visibleRowDepth = clampDepth(rowDepth, rowDimensions.length);
  const visibleColumnDepth = clampDepth(columnDepth, columnDimensions.length);

  return {
    reason,
    rowDepth: visibleRowDepth,
    columnDepth: visibleColumnDepth,
    rowDimensions: rowDimensions.slice(0, visibleRowDepth),
    columnDimensions: columnDimensions.slice(0, visibleColumnDepth),
  };
};

export const buildRuntimeLayoutCoverageManifest = (
  runtimeLayout: PivotRuntimeLayout,
): PivotCoverageNeed[] => {
  if (runtimeLayout.metrics.length === 0) {
    return [];
  }
  const rowDepth = runtimeLayout.rows.length > 0 ? 1 : 0;
  const columnDepth = runtimeLayout.cols.length > 0 ? 1 : 0;
  return [
    {
      reason: 'root',
      rowDepth,
      columnDepth,
      rowDimensions: runtimeLayout.rows.slice(0, rowDepth),
      columnDimensions: runtimeLayout.cols.slice(0, columnDepth),
      valueKeys: normalizeFactValueKeys(runtimeLayout.metrics),
      rowScope: { kind: 'root' },
      columnScope: { kind: 'root' },
    },
  ];
};

const factBatchCoversNeed = (
  { coverage, scope, valueKeys }: PivotFactStoreBatch,
  need: PivotCoverageNeed,
) => {
  const isRootNeed =
    need.rowScope.kind === 'root' && need.columnScope.kind === 'root';
  const hasCompatibleCoverage = isRootNeed
    ? coverage.rowDepth === need.rowDepth &&
      coverage.columnDepth === need.columnDepth &&
      columnRefsMatch(coverage.rowDimensions, need.rowDimensions) &&
      columnRefsMatch(coverage.columnDimensions, need.columnDimensions)
    : coverage.rowDepth >= need.rowDepth &&
      coverage.columnDepth >= need.columnDepth &&
      columnRefsStartWith(coverage.rowDimensions, need.rowDimensions) &&
      columnRefsStartWith(coverage.columnDimensions, need.columnDimensions);

  return (
    hasCompatibleCoverage &&
    valueKeysCover(valueKeys, need.valueKeys) &&
    (isRootNeed
      ? isRuntimeLayoutCoverageScope(scope)
      : scopeCoversAxisPaths(scope, 'row', need.rowScope) &&
        scopeCoversAxisPaths(scope, 'col', need.columnScope))
  );
};

export const diffCoverageManifest = ({
  required,
  factBatches,
}: {
  required: PivotCoverageNeed[];
  factBatches: PivotFactStoreBatch[];
}) =>
  required.filter(
    need => !factBatches.some(batch => factBatchCoversNeed(batch, need)),
  );

export const createExpansionCoverageDiff = ({
  factBatches,
  program,
  valueKeys,
}: {
  factBatches: PivotFactStoreBatch[];
  program: PivotProgram;
  valueKeys: string[];
}): PivotExpansionCoverageDiff => {
  const cache = new Map<string, boolean>();
  const isLoaded = (request: PivotExpansionCoverageRequest) => {
    const key = stableStringify(request);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const loaded =
      diffCoverageManifest({
        required: [
          buildExpansionCoverageNeed({
            request,
            program,
            valueKeys,
          }),
        ],
        factBatches,
      }).length === 0;
    cache.set(key, loaded);
    return loaded;
  };
  return requests => requests.filter(request => !isLoaded(request));
};

export const buildCoverageNeedFromFactSelector = ({
  coverage,
  scope,
  valueKeys,
}: PivotFactSelector): PivotCoverageNeed => {
  if (scope.kind === 'intersection') {
    return {
      reason: 'intersection',
      rowDepth: coverage.rowDepth,
      columnDepth: coverage.columnDepth,
      rowDimensions: coverage.rowDimensions,
      columnDimensions: coverage.columnDimensions,
      valueKeys,
      rowScope: { kind: 'paths', paths: scope.rowPaths },
      columnScope: { kind: 'paths', paths: scope.columnPaths },
    };
  }
  const scopedAxis =
    scope.kind === 'branch' || scope.kind === 'batch' ? scope.axis : undefined;
  const scopedPaths =
    scope.kind === 'branch'
      ? [scope.path]
      : scope.kind === 'batch'
        ? batchScopePaths(scope)
        : undefined;
  const axisScope = scopedPaths
    ? ({ kind: 'paths', paths: scopedPaths } as const)
    : ({ kind: 'root' } as const);

  return {
    reason:
      scope.kind === 'bootstrap' || scope.kind === 'root' ? 'root' : 'expand',
    rowDepth: coverage.rowDepth,
    columnDepth: coverage.columnDepth,
    rowDimensions: coverage.rowDimensions,
    columnDimensions: coverage.columnDimensions,
    valueKeys,
    rowScope: scopedAxis === 'row' ? axisScope : { kind: 'root' },
    columnScope: scopedAxis === 'col' ? axisScope : { kind: 'root' },
  };
};

export const factBatchesCoverRuntimeLayout = (
  factBatches: PivotFactStoreBatch[],
  runtimeLayout: PivotRuntimeLayout,
) => {
  const required = buildRuntimeLayoutCoverageManifest(runtimeLayout);
  return diffCoverageManifest({ required, factBatches }).length === 0;
};

const coverageManifestSignature = (runtimeLayout: PivotRuntimeLayout) =>
  stableStringify(buildRuntimeLayoutCoverageManifest(runtimeLayout));

export const shouldFetchRuntimeLayout = ({
  factBatches,
  previousLayout,
  nextLayout,
}: {
  factBatches: PivotFactStoreBatch[];
  previousLayout: PivotRuntimeLayout;
  nextLayout: PivotRuntimeLayout;
}) => {
  if (shouldFetchForSemanticLayoutChange(previousLayout, nextLayout)) {
    return true;
  }
  const coverageNeedChanged =
    coverageManifestSignature(previousLayout) !==
    coverageManifestSignature(nextLayout);
  return (
    coverageNeedChanged &&
    !factBatchesCoverRuntimeLayout(factBatches, nextLayout)
  );
};

export const buildBranchFactCoverages = ({
  program,
  axis,
  projection,
  rowDepth,
  columnDepth,
  rowDimensions = program.rowDimensions,
  columnDimensions = program.columnDimensions,
  rowSubtotalLevels,
  columnSubtotalLevels,
  rowTotals = false,
  columnTotals = false,
  includeRowTotalForColumnFormatting = false,
  includeColumnTotalForRowFormatting = false,
  reason = 'expand',
}: BranchFactCoverageInput): PivotFactCoverage[] => {
  const depthPairs: DepthPair[] = [];
  const addDepthPair = (rowDepthVal: number, columnDepthVal: number) => {
    const key = `${rowDepthVal}|${columnDepthVal}`;
    if (
      depthPairs.find(pair => `${pair.rowDepth}|${pair.columnDepth}` === key)
    ) {
      return;
    }
    depthPairs.push({
      rowDepth: rowDepthVal,
      columnDepth: columnDepthVal,
    });
  };
  const addDepthGrid = (rowDepths: number[], columnDepths: number[]) => {
    uniqueDepths(rowDepths).forEach(rowDepthVal => {
      uniqueDepths(columnDepths).forEach(columnDepthVal =>
        addDepthPair(rowDepthVal, columnDepthVal),
      );
    });
  };
  addDepthPair(rowDepth, columnDepth);

  const valuesAtRowFront =
    program.metricsLayoutResolved === MetricsLayoutEnum.ROWS &&
    program.metricInsertIndex === 0;
  const valuesAtColumnFront =
    program.metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
    program.metricInsertIndex === 0;
  const rowParentDepth = parentDepth(rowDepth);
  const columnParentDepth = parentDepth(columnDepth);

  if (axis === 'col' && columnDepth > 0) {
    if (valuesAtRowFront && rowDepth > 0) {
      addDepthPair(0, columnDepth);
    }
    if (rowDepth > 0) {
      addDepthGrid(rowDepth === 1 ? [0, 1] : rangeFromOne(rowDepth), [
        columnDepth,
        columnParentDepth,
      ]);
    } else if (program.metricsLayoutResolved === MetricsLayoutEnum.COLUMNS) {
      addDepthPair(rowDepth, columnParentDepth);
    }
  }

  if (axis === 'row' && columnDepth > 0) {
    if (valuesAtColumnFront) {
      addDepthPair(rowDepth, 0);
    }
    addDepthGrid(
      rowDepth > 0 ? [rowDepth, rowParentDepth] : [rowDepth],
      rangeFromOne(columnDepth),
    );
  }

  if (
    program.metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
    columnDepth > 0
  ) {
    addDepthGrid(rowDepth > 0 ? [rowDepth, rowParentDepth] : [rowDepth], [
      columnParentDepth,
    ]);
    if (rowDepth > 0) {
      addDepthPair(rowParentDepth, columnDepth);
    }
  }

  const effectiveRowLevels = Array.from(
    new Set([
      ...rowSubtotalLevels,
      ...(includeRowTotalForColumnFormatting ? [0] : []),
    ]),
  ).filter(level => level <= rowDepth);
  const effectiveColumnLevels = Array.from(
    new Set([
      ...columnSubtotalLevels,
      ...(rowTotals ? [0] : []),
      ...(includeColumnTotalForRowFormatting ? [0] : []),
    ]),
  ).filter(level => level <= columnDepth);
  addDepthGrid(
    [rowDepth, ...effectiveRowLevels],
    [columnDepth, ...effectiveColumnLevels],
  );

  const branchAnchorDepth = projectionQueryFilterPath(projection).length;
  const queryPairs =
    branchAnchorDepth === 0
      ? depthPairs
      : depthPairs.filter(pair =>
          axis === 'row'
            ? pair.rowDepth >= branchAnchorDepth
            : pair.columnDepth >= branchAnchorDepth,
        );
  const hasTotalRow = columnTotals || rowSubtotalLevels.includes(0);
  const hasTotalColumn = rowTotals || columnSubtotalLevels.includes(0);
  const shouldIncludeGrandTotalPair =
    (rowDimensions.length === 0 && columnDimensions.length === 0) ||
    (hasTotalRow && hasTotalColumn) ||
    (valuesAtRowFront && hasTotalColumn) ||
    (valuesAtColumnFront && hasTotalRow);

  return (
    shouldIncludeGrandTotalPair
      ? queryPairs
      : queryPairs.filter(
          pair => !(pair.rowDepth === 0 && pair.columnDepth === 0),
        )
  ).map(pair =>
    buildFactCoverage({
      rowDimensions,
      columnDimensions,
      rowDepth: pair.rowDepth,
      columnDepth: pair.columnDepth,
      reason,
    }),
  );
};
