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
import { getNextAxisLevelForPath } from './paths';
import type { PivotAxisProjection } from './projection';
import { type PivotFactStoreBatch } from './factStore';
import type {
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
  rowSubtotalLevels: number[];
  columnSubtotalLevels: number[];
  rowTotals?: boolean;
  columnTotals?: boolean;
  includeRowTotalForColumnFormatting?: boolean;
  includeColumnTotalForRowFormatting?: boolean;
  reason?: PivotCoverageReason;
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

export const factBatchesCoverRuntimeLayout = (
  factBatches: PivotFactStoreBatch[],
  runtimeLayout: PivotRuntimeLayout,
) => {
  const requiredRowDepth = runtimeLayout.rows.length > 0 ? 1 : 0;
  const requiredColumnDepth = runtimeLayout.cols.length > 0 ? 1 : 0;
  return (
    runtimeLayout.metrics.length === 0 ||
    (requiredRowDepth === 0 && requiredColumnDepth === 0) ||
    factBatches.some(
      ({ coverage, scope }) =>
        (scope.kind === 'bootstrap' || scope.kind === 'root') &&
        coverage.rowDepth === requiredRowDepth &&
        coverage.columnDepth === requiredColumnDepth,
    )
  );
};

export const buildBranchFactCoverages = ({
  program,
  axis,
  projection,
  rowDepth,
  columnDepth,
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

  const branchAnchorDepth = projection.filterDimensionPath.length;
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
    (program.rowDimensions.length === 0 &&
      program.columnDimensions.length === 0) ||
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
      rowDimensions: program.rowDimensions,
      columnDimensions: program.columnDimensions,
      rowDepth: pair.rowDepth,
      columnDepth: pair.columnDepth,
      reason,
    }),
  );
};
