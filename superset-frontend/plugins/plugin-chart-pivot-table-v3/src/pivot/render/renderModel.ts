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
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import { buildColumnHeaderRows, rootKey } from '../viewModel';
import { buildVisibleCellEntries } from '../cellUtils';
import {
  buildVisibleCols,
  buildVisibleRows,
  createColLeavesBuilder,
} from '../visibility';
import { type RenderModel } from '../shared/types';

export type RenderModelConfig = {
  groupbyRowsLength: number;
  groupbyColumnsLength: number;
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  rowTotals: boolean;
  colTotals: boolean;
  rowTotalPosition: TotalPosition;
  colTotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
  resolvedMetricsLayout: MetricsLayoutEnum;
  isMultiMetric: boolean;
  metricsFirstOnCols: boolean;
  hideMetricHeaderOnRows: boolean;
  hideMetricHeaderOnCols: boolean;
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
  const showRowRootBase =
    config.groupbyRowsLength > 0 &&
    (config.normalizedRowSubtotalLevels.includes(0) || config.colTotals);
  const showRowRoot =
    showRowRootBase &&
    !(
      config.resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
      config.isMultiMetric
    );
  const showColRoot =
    config.groupbyColumnsLength > 0 &&
    (config.normalizedColSubtotalLevels.includes(0) || config.rowTotals);

  const skipRowRoot = config.groupbyRowsLength > 0 && !showRowRoot;
  const skipColRoot = config.groupbyColumnsLength === 0 || !showColRoot;

  const shouldHideMetricGrandTotalsOnRows = !showRowRootBase;
  const totalRowPosition = config.colTotals
    ? config.colTotalPosition
    : config.rowTotalPosition;
  const visibleRowsBase = buildVisibleRows({
    rows: tree.rows,
    expandedRows,
    rowSorter: config.rowSorter,
    skipRowRoot,
    showRowRoot,
    rowTotalPosition: totalRowPosition,
    getRowChildren: config.getRowChildren,
    getCollapsedRowChildren: config.getCollapsedRowChildren,
  });
  const visibleRows = shouldHideMetricGrandTotalsOnRows
    ? visibleRowsBase.filter(row => !config.isMetricGrandTotalNode(row))
    : visibleRowsBase;

  const buildColLeavesWithSubtotals = createColLeavesBuilder({
    getColChildren: config.getColChildren,
    getCollapsedColLeaves: config.getCollapsedColLeaves,
    colSorter: config.colSorter,
    countDimDepth: config.countDimDepth,
    expandedCols,
    normalizedColSubtotalLevels: config.normalizedColSubtotalLevels,
    showColRoot,
    rowTotals: config.rowTotals,
    resolvedColTotalPosition: config.colTotalPosition,
    resolvedColSubtotalPosition: config.resolvedColSubtotalPosition,
    isMetricGrandTotalNode: config.isMetricGrandTotalNode,
    isMetricSubtotalNode: config.isMetricSubtotalNode,
  });

  const shouldHideMetricGrandTotalsOnCols = !showColRoot;
  const shouldSuppressColRoot =
    config.resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    config.metricsFirstOnCols;
  const visibleColsBase = buildVisibleCols({
    cols: tree.cols,
    skipColRoot,
    colSorter: config.colSorter,
    getColChildren: config.getColChildren,
    buildColLeavesWithSubtotals,
  });
  let visibleCols = shouldHideMetricGrandTotalsOnCols
    ? visibleColsBase.filter(col => !config.isMetricGrandTotalNode(col))
    : visibleColsBase;
  if (shouldSuppressColRoot) {
    const hasMetricLeaves = visibleCols.some(col =>
      col.path.some(val => config.isMetricTokenValue(val)),
    );
    if (hasMetricLeaves) {
      const withoutRoot = visibleCols.filter(col => col.key !== rootKey);
      visibleCols = withoutRoot.length > 0 ? withoutRoot : visibleCols;
    }
  }

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
    colLeaves: visibleCols,
    columnHeaderRows,
    visibleCellEntries,
    showRowRoot,
    showColRoot,
    skipRowRoot,
    skipColRoot,
    hideMetricHeaderOnRows: config.hideMetricHeaderOnRows,
    hideMetricHeaderOnCols: config.hideMetricHeaderOnCols,
    shouldHideMetricGrandTotalsOnRows,
    shouldHideMetricGrandTotalsOnCols,
    shouldSuppressColRoot,
  };
};
