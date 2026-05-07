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
import type { PivotAxis } from '../../types';
import { isMeasureLeafToken } from '../core/tokens';
import type {
  PivotAxisLevel,
  PivotCoverageReason,
  PivotFactCoverage,
  PivotProgram,
} from './types';

export type VisibleFactCoverageInput = {
  program: PivotProgram;
  rowDepth: number;
  columnDepth: number;
  reason?: PivotCoverageReason;
};

export type FactCoverageInput = {
  rowDimensions: PivotProgram['rowDimensions'];
  columnDimensions: PivotProgram['columnDimensions'];
  rowDepth: number;
  columnDepth: number;
  reason?: PivotCoverageReason;
};

export type ExpansionFactCoverageInput = {
  program: PivotProgram;
  axis: PivotAxis;
  expandedAxisLevelIndex: number;
  currentRowDepth: number;
  currentColumnDepth: number;
};

export type ExpansionValuesLevelInput = {
  program: PivotProgram;
  axis: PivotAxis;
  path: unknown[];
  isMetricTokenValue: (value: unknown) => boolean;
};

const clampDepth = (depth: number, maxDepth: number) => {
  if (!Number.isFinite(depth)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(depth), 0), maxDepth);
};

const axisProgramFor = (program: PivotProgram, axis: PivotAxis) =>
  axis === 'row' ? program.rows : program.columns;

const isStrictValuesPathToken = (
  value: unknown,
  isMetricTokenValue: (value: unknown) => boolean,
) => isMetricTokenValue(value) || isMeasureLeafToken(value);

const isValuesLevelPathToken = ({
  value,
  program,
  isMetricTokenValue,
}: {
  value: unknown;
  program: PivotProgram;
  isMetricTokenValue: (value: unknown) => boolean;
}) =>
  isStrictValuesPathToken(value, isMetricTokenValue) ||
  (typeof value === 'string' && program.metricKeys.includes(value));

const countDimensionsThroughLevel = (
  axisProgram: PivotProgram['rows'],
  levelIndex: number,
) =>
  axisProgram
    .slice(0, levelIndex + 1)
    .filter(
      (level): level is Extract<PivotAxisLevel, { kind: 'dimension' }> =>
        level.kind === 'dimension',
    ).length;

const getNextAxisLevelForPath = ({
  program,
  axis,
  path,
  isMetricTokenValue,
}: ExpansionValuesLevelInput): PivotAxisLevel | undefined => {
  let pathIndex = 0;

  for (const level of axisProgramFor(program, axis)) {
    if (pathIndex >= path.length) {
      return level;
    }
    const value = path[pathIndex];
    if (level.kind === 'dimension') {
      if (isStrictValuesPathToken(value, isMetricTokenValue)) {
        return level;
      }
      pathIndex += 1;
      continue;
    }

    let consumedValuesToken = false;
    while (
      pathIndex < path.length &&
      isValuesLevelPathToken({
        value: path[pathIndex],
        program,
        isMetricTokenValue,
      })
    ) {
      consumedValuesToken = true;
      pathIndex += 1;
    }
    if (!consumedValuesToken) {
      return level;
    }
  }
  return undefined;
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

export const buildVisibleFactCoverage = ({
  program,
  rowDepth,
  columnDepth,
  reason = 'initial',
}: VisibleFactCoverageInput): PivotFactCoverage[] => {
  if (program.metricKeys.length === 0) {
    return [];
  }

  return [
    buildFactCoverage({
      reason,
      rowDimensions: program.rowDimensions,
      columnDimensions: program.columnDimensions,
      rowDepth,
      columnDepth,
    }),
  ];
};

export const buildExpansionFactCoverage = ({
  program,
  axis,
  expandedAxisLevelIndex,
  currentRowDepth,
  currentColumnDepth,
}: ExpansionFactCoverageInput): PivotFactCoverage[] => {
  const axisProgram = axisProgramFor(program, axis);
  const nextLevelIndex = expandedAxisLevelIndex + 1;
  const nextLevel = axisProgram[nextLevelIndex];

  if (!nextLevel || nextLevel.kind === 'values') {
    return [];
  }

  const requiredDepth = countDimensionsThroughLevel(
    axisProgram,
    nextLevelIndex,
  );

  if (axis === 'row') {
    const currentDepth = clampDepth(
      currentRowDepth,
      program.rowDimensions.length,
    );
    if (requiredDepth <= currentDepth) {
      return [];
    }
    return buildVisibleFactCoverage({
      program,
      rowDepth: requiredDepth,
      columnDepth: currentColumnDepth,
      reason: 'expand',
    });
  }

  const currentDepth = clampDepth(
    currentColumnDepth,
    program.columnDimensions.length,
  );
  if (requiredDepth <= currentDepth) {
    return [];
  }
  return buildVisibleFactCoverage({
    program,
    rowDepth: currentRowDepth,
    columnDepth: requiredDepth,
    reason: 'expand',
  });
};
