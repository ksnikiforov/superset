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
import { type QueryFormColumn } from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  type PivotAxis,
  type PivotTableQueryFormData,
} from '../../types';

const filterDepthPairsForAxis = (
  pairs: Array<{ rowDepth: number; colDepth: number }>,
  axis: PivotAxis,
  pathLength: number,
) => {
  if (pathLength === 0) {
    return pairs;
  }
  return pairs.filter(pair =>
    axis === 'row' ? pair.rowDepth >= pathLength : pair.colDepth >= pathLength,
  );
};

export const buildBranchQueryPairs = ({
  axis,
  pathLength,
  rowDepth,
  colDepth,
  rowGroupby,
  colGroupby,
  rowSubtotalLevels,
  colSubtotalLevels,
  hasRowFormatting,
  hasColFormatting,
  hasRowTotalSorting,
  hasColTotalSorting,
  metricsLayoutResolved,
  metricInsertIndex,
  formData,
}: {
  axis: PivotAxis;
  pathLength: number;
  rowDepth: number;
  colDepth: number;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  hasRowFormatting: boolean;
  hasColFormatting: boolean;
  hasRowTotalSorting: boolean;
  hasColTotalSorting: boolean;
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
  formData: PivotTableQueryFormData;
}) => {
  const depthPairs: Array<{ rowDepth: number; colDepth: number }> = [];
  const addDepthPair = (rowDepthVal: number, colDepthVal: number) => {
    const key = `${rowDepthVal}|${colDepthVal}`;
    if (depthPairs.find(pair => `${pair.rowDepth}|${pair.colDepth}` === key)) {
      return;
    }
    depthPairs.push({ rowDepth: rowDepthVal, colDepth: colDepthVal });
  };
  addDepthPair(rowDepth, colDepth);

  const needsMetricFrontRoot =
    metricsLayoutResolved === MetricsLayoutEnum.ROWS &&
    metricInsertIndex === 0 &&
    axis === 'col' &&
    rowDepth > 0;
  if (needsMetricFrontRoot) {
    addDepthPair(0, colDepth);
  }
  const needsMetricFrontColumnRootForRows =
    metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndex === 0 &&
    axis === 'row' &&
    colDepth > 0;
  if (needsMetricFrontColumnRootForRows) {
    addDepthPair(rowDepth, 0);
  }
  if (axis === 'col' && rowDepth > 0 && colDepth > 0) {
    addDepthPair(Math.max(rowDepth - 1, 0), colDepth);
  }
  if (axis === 'col' && colDepth > 0 && rowDepth > 0) {
    const colParentDepth = Math.max(colDepth - 1, 0);
    for (let depth = 1; depth <= rowDepth; depth += 1) {
      addDepthPair(depth, colDepth);
      if (colParentDepth !== colDepth) {
        addDepthPair(depth, colParentDepth);
      }
    }
  }
  if (axis === 'row' && colDepth > 0) {
    const rowParentDepth = Math.max(rowDepth - 1, 0);
    for (let depth = 1; depth <= colDepth; depth += 1) {
      addDepthPair(rowDepth, depth);
      if (rowDepth > 0) {
        addDepthPair(rowParentDepth, depth);
      }
    }
  }
  if (metricsLayoutResolved === MetricsLayoutEnum.COLUMNS && colDepth > 0) {
    const colParentDepth = Math.max(colDepth - 1, 0);
    if (axis === 'col') {
      addDepthPair(rowDepth, colParentDepth);
      if (rowDepth > 0) {
        addDepthPair(Math.max(rowDepth - 1, 0), colDepth);
        addDepthPair(Math.max(rowDepth - 1, 0), colParentDepth);
      }
    } else if (axis === 'row') {
      addDepthPair(rowDepth, colParentDepth);
      if (rowDepth > 0) {
        addDepthPair(Math.max(rowDepth - 1, 0), colDepth);
        addDepthPair(Math.max(rowDepth - 1, 0), colParentDepth);
      }
    }
  }

  const includeRowTotalForColFormatting =
    axis === 'col' && (hasColFormatting || hasColTotalSorting);
  const includeColTotalForRowFormatting =
    axis === 'row' && (hasRowFormatting || hasRowTotalSorting);
  const effectiveRowLevels = Array.from(
    new Set([
      ...rowSubtotalLevels,
      ...(includeRowTotalForColFormatting ? [0] : []),
    ]),
  ).filter(level => level <= rowDepth);
  const effectiveColLevels = Array.from(
    new Set([
      ...colSubtotalLevels,
      ...(formData.rowTotals ? [0] : []),
      ...(includeColTotalForRowFormatting ? [0] : []),
    ]),
  ).filter(level => level <= colDepth);
  const subtotalRowDepths = new Set<number>([rowDepth, ...effectiveRowLevels]);
  const subtotalColDepths = new Set<number>([colDepth, ...effectiveColLevels]);
  subtotalRowDepths.forEach(rowDepthVal => {
    subtotalColDepths.forEach(colDepthVal =>
      addDepthPair(rowDepthVal, colDepthVal),
    );
  });
  const queryPairs = filterDepthPairsForAxis(depthPairs, axis, pathLength);
  const hasTotalRow = formData.colTotals || rowSubtotalLevels.includes(0);
  const hasTotalColumn = formData.rowTotals || colSubtotalLevels.includes(0);
  const shouldIncludeGrandTotalPair =
    (rowGroupby.length === 0 && colGroupby.length === 0) ||
    (hasTotalRow && hasTotalColumn) ||
    (metricsLayoutResolved === MetricsLayoutEnum.ROWS &&
      metricInsertIndex === 0 &&
      hasTotalColumn) ||
    (metricsLayoutResolved === MetricsLayoutEnum.COLUMNS &&
      metricInsertIndex === 0 &&
      hasTotalRow);
  return shouldIncludeGrandTotalPair
    ? queryPairs
    : queryPairs.filter(pair => !(pair.rowDepth === 0 && pair.colDepth === 0));
};
