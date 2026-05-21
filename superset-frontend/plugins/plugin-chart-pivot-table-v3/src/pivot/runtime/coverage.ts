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
import { type PivotAxis, type PivotPath } from '../../types';
import { isMeasureLeafToken, isMetricToken } from '../core/tokens';
import type { PivotFactSelector, PivotFactStoreBatchScope } from './factStore';
import type { PivotFactCoverage, PivotProgram } from './types';

type FactCoverageInput = {
  rowDimensions: PivotProgram['rowDimensions'];
  columnDimensions: PivotProgram['columnDimensions'];
  rowDepth: number;
  columnDepth: number;
};

export type AxisPathScope =
  | { kind: 'root' }
  | { kind: 'paths'; paths: PivotPath[] }
  | { kind: 'scopedFull'; ancestorPaths: PivotPath[] };

export type PivotAxisCoverageNeed = {
  axis: PivotAxis;
  depth: number;
  scope: AxisPathScope;
};

export type PivotCoverageNeed = {
  rowDepth: number;
  columnDepth: number;
  rowDimensions: PivotProgram['rowDimensions'];
  columnDimensions: PivotProgram['columnDimensions'];
  valueKeys: string[];
  rowScope: AxisPathScope;
  columnScope: AxisPathScope;
};

export const pathsFromAxisScope = (scope: AxisPathScope): PivotPath[] => {
  if (scope.kind === 'root') {
    return [];
  }
  return scope.kind === 'paths' ? scope.paths : scope.ancestorPaths;
};

const clampDepth = (depth: number, maxDepth: number) => {
  if (!Number.isFinite(depth)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(depth), 0), maxDepth);
};

export const resolveInitialVisibleAxisDepth = ({
  configuredDepth,
  dimensionCount,
  startCollapsed,
  initialDepth,
}: {
  configuredDepth: number | undefined;
  dimensionCount: number;
  startCollapsed: boolean;
  initialDepth: number;
}) => {
  const parsedDepth = Number(configuredDepth);
  if (configuredDepth !== undefined && Number.isFinite(parsedDepth)) {
    return clampDepth(parsedDepth, dimensionCount);
  }
  if (!startCollapsed) {
    return dimensionCount;
  }
  return clampDepth(Math.max(initialDepth || 1, 1) - 1, dimensionCount);
};

export const buildInitialAxisCoverageNeeds = ({
  rowDepth,
  columnDepth,
}: {
  rowDepth: number;
  columnDepth: number;
}): PivotAxisCoverageNeed[] =>
  (
    [
      ['row', rowDepth],
      ['col', columnDepth],
    ] as const
  ).flatMap(([axis, depth]) =>
    depth > 0
      ? [{ axis, depth, scope: { kind: 'scopedFull', ancestorPaths: [[]] } }]
      : [],
  );

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

const intersectionScopePaths = (
  scope: Extract<PivotFactStoreBatchScope, { kind: 'intersection' }>,
  axis: PivotAxis,
) => (axis === 'row' ? scope.rowPaths : scope.columnPaths);

const isRuntimeLayoutCoverageScope = (
  scope: PivotFactStoreBatchScope,
): boolean => {
  if (scope.kind === 'root') {
    return true;
  }
  if (scope.kind !== 'axisPaths') {
    return (
      scope.kind === 'scopedFull' &&
      scope.ancestorPaths.every(path => path.every(isMetricToken))
    );
  }
  return scope.paths.every(path => path.every(isMetricToken));
};

const scopeRestrictsAxis = (
  scope: PivotFactStoreBatchScope,
  axis: PivotAxis,
) =>
  (scope.kind === 'axisPaths' || scope.kind === 'scopedFull') &&
  scope.axis === axis
    ? true
    : scope.kind === 'intersection';

const scopeAxisPaths = (scope: PivotFactStoreBatchScope, axis: PivotAxis) => {
  if (
    (scope.kind === 'axisPaths' || scope.kind === 'scopedFull') &&
    scope.axis === axis
  ) {
    return scope.kind === 'axisPaths' ? scope.paths : scope.ancestorPaths;
  }
  if (scope.kind === 'intersection') {
    return intersectionScopePaths(scope, axis);
  }
  return [];
};

const scopeCoversAxisPaths = (
  scope: PivotFactStoreBatchScope,
  axis: PivotAxis,
  needScope: AxisPathScope,
  loadedDepth: number,
) => {
  if (needScope.kind === 'root') {
    return scope.kind === 'root' || !scopeRestrictsAxis(scope, axis);
  }
  if (scope.kind === 'root') {
    if (axisScopeContainsValuesToken(needScope)) {
      return false;
    }
    return pathsFromAxisScope(needScope).every(
      path => path.length <= loadedDepth,
    );
  }
  if (
    (scope.kind === 'axisPaths' || scope.kind === 'scopedFull') &&
    scope.axis !== axis
  ) {
    return true;
  }
  const candidatePaths = scopeAxisPaths(scope, axis);
  if (needScope.kind === 'scopedFull') {
    if (
      scope.kind === 'axisPaths' ||
      (scope.kind !== 'scopedFull' && scope.kind !== 'intersection')
    ) {
      return false;
    }
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

export const buildFactCoverage = ({
  rowDimensions,
  columnDimensions,
  rowDepth,
  columnDepth,
}: FactCoverageInput): PivotFactCoverage => {
  const visibleRowDepth = clampDepth(rowDepth, rowDimensions.length);
  const visibleColumnDepth = clampDepth(columnDepth, columnDimensions.length);

  return {
    rowDepth: visibleRowDepth,
    columnDepth: visibleColumnDepth,
    rowDimensions: rowDimensions.slice(0, visibleRowDepth),
    columnDimensions: columnDimensions.slice(0, visibleColumnDepth),
  };
};

const factSelectorCoversNeed = (
  { coverage, scope, valueKeys }: PivotFactSelector,
  need: PivotCoverageNeed,
) => {
  const isRootNeed =
    need.rowScope.kind === 'root' && need.columnScope.kind === 'root';
  const hasCompatibleCoverage =
    coverage.rowDepth === need.rowDepth &&
    coverage.columnDepth === need.columnDepth &&
    columnRefsMatch(coverage.rowDimensions, need.rowDimensions) &&
    columnRefsMatch(coverage.columnDimensions, need.columnDimensions);

  return (
    hasCompatibleCoverage &&
    valueKeysCover(valueKeys, need.valueKeys) &&
    (isRootNeed
      ? isRuntimeLayoutCoverageScope(scope)
      : scopeCoversAxisPaths(scope, 'row', need.rowScope, coverage.rowDepth) &&
        scopeCoversAxisPaths(
          scope,
          'col',
          need.columnScope,
          coverage.columnDepth,
        ))
  );
};

const splitAxisScope = (scope: AxisPathScope): AxisPathScope[] => {
  if (scope.kind === 'root') {
    return [scope];
  }
  if (scope.kind === 'paths') {
    return scope.paths.map(path => ({ kind: 'paths', paths: [path] }));
  }
  return scope.ancestorPaths.map(path => ({
    kind: 'scopedFull',
    ancestorPaths: [path],
  }));
};

const splitCoverageNeed = (need: PivotCoverageNeed): PivotCoverageNeed[] =>
  splitAxisScope(need.rowScope).flatMap(rowScope =>
    splitAxisScope(need.columnScope).map(columnScope => ({
      ...need,
      rowScope,
      columnScope,
    })),
  );

const factSelectorsCoverNeed = (
  factSelectors: PivotFactSelector[],
  need: PivotCoverageNeed,
) =>
  factSelectors.some(selector => factSelectorCoversNeed(selector, need)) ||
  splitCoverageNeed(need).every(part =>
    factSelectors.some(selector => factSelectorCoversNeed(selector, part)),
  );

export const diffCoverageManifest = ({
  required,
  factSelectors,
}: {
  required: PivotCoverageNeed[];
  factSelectors: PivotFactSelector[];
}) => required.filter(need => !factSelectorsCoverNeed(factSelectors, need));

export const buildCoverageNeedFromFactSelector = ({
  coverage,
  scope,
  valueKeys,
}: PivotFactSelector): PivotCoverageNeed => {
  if (scope.kind === 'intersection') {
    return {
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
    scope.kind === 'axisPaths' || scope.kind === 'scopedFull'
      ? scope.axis
      : undefined;
  const axisScope =
    scope.kind === 'axisPaths'
      ? ({ kind: 'paths', paths: scope.paths } as const)
      : scope.kind === 'scopedFull'
        ? ({ kind: 'scopedFull', ancestorPaths: scope.ancestorPaths } as const)
        : ({ kind: 'root' } as const);

  return {
    rowDepth: coverage.rowDepth,
    columnDepth: coverage.columnDepth,
    rowDimensions: coverage.rowDimensions,
    columnDimensions: coverage.columnDimensions,
    valueKeys,
    rowScope: scopedAxis === 'row' ? axisScope : { kind: 'root' },
    columnScope: scopedAxis === 'col' ? axisScope : { kind: 'root' },
  };
};

export const factSelectorsCoverSelector = (
  factSelectors: PivotFactSelector[],
  selector: PivotFactSelector,
) =>
  diffCoverageManifest({
    required: [buildCoverageNeedFromFactSelector(selector)],
    factSelectors,
  }).length === 0;
