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
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import { buildColumnHeaderRows, type HeaderCellInfo } from '../viewModel';
import { buildVisibleCellEntries, type VisibleCellEntry } from '../cellUtils';
import { buildVisiblePivotAxes } from '../visibility';
import type { PivotProgram } from '../runtime/types';

export type RenderModel = {
  visibleRows: PivotTreeNode[];
  visibleCols: PivotTreeNode[];
  columnHeaderRows: HeaderCellInfo[][];
  visibleCellEntries: VisibleCellEntry[];
  showRowRoot: boolean;
};

export type RenderModelConfig = {
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  rowTotals: boolean;
  colTotals: boolean;
  rowTotalPosition: TotalPosition;
  colTotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
  pivotProgram: PivotProgram;
  hasMultipleMeasures: boolean;
  rowSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  colSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getRowChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getCollapsedRowChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getColChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getCollapsedColLeaves: (parent: PivotTreeNode) => PivotTreeNode[];
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node?: PivotTreeNode) => boolean;
  isMetricTokenValue: (value: unknown) => boolean;
  getColumnDisplayPath?: (
    col: PivotTreeNode,
    maxDepth: number,
  ) => PivotTreeNode['path'];
  getColumnHeaderLabel?: (value: unknown) => string;
};

export type RenderModelInput = {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  config: RenderModelConfig;
};

export const buildRenderModel = ({
  tree,
  expandedRows,
  expandedCols,
  config,
}: RenderModelInput): RenderModel => {
  const groupbyRowsLength = config.pivotProgram.rowDimensions.length;
  const groupbyColumnsLength = config.pivotProgram.columnDimensions.length;
  const showRowRootBase =
    groupbyRowsLength > 0 &&
    (config.normalizedRowSubtotalLevels.includes(0) || config.colTotals);
  const suppressRowRootForMultiMeasure =
    config.hasMultipleMeasures &&
    (config.pivotProgram.valueAxis === 'row' || config.rowTotals);
  const showRowRoot = showRowRootBase && !suppressRowRootForMultiMeasure;
  const showColRoot =
    groupbyColumnsLength > 0 &&
    (config.normalizedColSubtotalLevels.includes(0) || config.rowTotals);

  const skipRowRoot =
    (groupbyRowsLength > 0 && !showRowRoot) ||
    (groupbyRowsLength === 0 && config.hasMultipleMeasures);
  const skipColRoot = groupbyColumnsLength === 0 || !showColRoot;

  const shouldHideMetricGrandTotalsOnRows = !showRowRootBase;
  const totalRowPosition = config.colTotals
    ? config.colTotalPosition
    : config.rowTotalPosition;
  const shouldHideMetricGrandTotalsOnCols = !showColRoot;
  const shouldSuppressColRoot =
    config.pivotProgram.valueAxis === 'col' &&
    config.pivotProgram.metricKeys.length > 0 &&
    config.pivotProgram.metricInsertIndex === 0;
  const { visibleRows, visibleCols } = buildVisiblePivotAxes({
    rows: tree.rows,
    cols: tree.cols,
    expandedRows,
    expandedCols,
    rowSorter: config.rowSorter,
    colSorter: config.colSorter,
    skipRowRoot,
    showRowRoot,
    rowTotalPosition: totalRowPosition,
    getRowChildren: config.getRowChildren,
    getCollapsedRowChildren: config.getCollapsedRowChildren,
    skipColRoot,
    countDimDepth: config.countDimDepth,
    normalizedColSubtotalLevels: config.normalizedColSubtotalLevels,
    showColRoot,
    rowTotals: config.rowTotals,
    resolvedColTotalPosition: config.colTotalPosition,
    resolvedColSubtotalPosition: config.resolvedColSubtotalPosition,
    getColChildren: config.getColChildren,
    getCollapsedColLeaves: config.getCollapsedColLeaves,
    isMetricGrandTotalNode: config.isMetricGrandTotalNode,
    isMetricSubtotalNode: config.isMetricSubtotalNode,
    isMetricTokenValue: config.isMetricTokenValue,
    shouldHideMetricGrandTotalsOnRows,
    shouldHideMetricGrandTotalsOnCols,
    shouldSuppressColRoot,
  });

  const columnHeaderRows = buildColumnHeaderRows(
    visibleCols,
    tree.cols,
    config.getColumnDisplayPath,
    config.getColumnHeaderLabel,
  );

  const visibleRowKeySet = new Set(visibleRows.map(row => row.key));
  const visibleColKeySet = new Set(visibleCols.map(col => col.key));
  const visibleCellEntries = buildVisibleCellEntries({
    cells: tree.cells,
    rows: tree.rows,
    cols: tree.cols,
    visibleRowKeys: visibleRowKeySet,
    visibleColKeys: visibleColKeySet,
  });

  return {
    visibleRows,
    visibleCols,
    columnHeaderRows,
    visibleCellEntries,
    showRowRoot,
  };
};
