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
import { type RefObject } from 'react';
import { type ChartDataWarning } from '../data/ChartDataClient';
import {
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { type PivotTableViewProps } from '../render/PivotTableView';
import { type PivotDisplaySnapshot } from './usePivotSeamlessRuntimeUpdate';
import { type PivotFormattingResult } from './usePivotFormatting';
import { type PivotInteractionsResult } from './usePivotInteractions';
import { type PivotLayoutResult } from './usePivotLayout';
import { type PivotRenderModelResult } from './usePivotRenderModel';

export type SharedPivotViewProps = Omit<
  PivotTableViewProps,
  'height' | 'width'
>;

export const resolveActivePivotDisplaySnapshot = ({
  renderModelResult,
  renderTree,
  pendingDisplaySnapshot,
}: {
  renderModelResult: PivotRenderModelResult;
  renderTree: PivotTreeData;
  pendingDisplaySnapshot: PivotDisplaySnapshot | null;
}): {
  activeDisplaySnapshot: PivotDisplaySnapshot;
  liveDisplaySnapshot: PivotDisplaySnapshot;
} => {
  const liveDisplaySnapshot: PivotDisplaySnapshot = {
    renderModel: renderModelResult.renderModel,
    tree: renderTree,
    expandedRows: renderModelResult.expandedRowsForRender,
    expandedCols: renderModelResult.expandedColsForRender,
  };
  return {
    activeDisplaySnapshot: pendingDisplaySnapshot ?? liveDisplaySnapshot,
    liveDisplaySnapshot,
  };
};

export const buildSharedPivotViewProps = ({
  activeDisplaySnapshot,
  activeErrorMessage,
  handleRetry,
  combinedWarnings,
  cornerLoaderVisible,
  resolvedStickyHeaders,
  headerOffset,
  headerRowOffsets,
  headerRef,
  layoutResult,
  formatting,
  handleToggle,
  renderModelResult,
  pendingDisplaySnapshot,
  seamlessLoading,
  loadingKeys,
  emitCrossFilters,
  interactions,
  rowAxisLabels,
  exportChartId,
}: {
  activeDisplaySnapshot: PivotDisplaySnapshot;
  activeErrorMessage?: string;
  handleRetry: () => void;
  combinedWarnings: ChartDataWarning[];
  cornerLoaderVisible: boolean;
  resolvedStickyHeaders: boolean;
  headerOffset: number;
  headerRowOffsets: number[];
  headerRef: RefObject<HTMLTableSectionElement>;
  layoutResult: PivotLayoutResult;
  formatting: PivotFormattingResult;
  handleToggle: (axis: PivotAxis, node: PivotTreeNode) => void;
  renderModelResult: PivotRenderModelResult;
  pendingDisplaySnapshot: PivotDisplaySnapshot | null;
  seamlessLoading: boolean;
  loadingKeys: Set<string>;
  emitCrossFilters?: boolean;
  interactions: PivotInteractionsResult;
  rowAxisLabels: string[];
  exportChartId?: string | number;
}): SharedPivotViewProps => ({
  renderModel: activeDisplaySnapshot.renderModel,
  tree: activeDisplaySnapshot.tree,
  expandedRows: activeDisplaySnapshot.expandedRows,
  expandedCols: activeDisplaySnapshot.expandedCols,
  errorMessage: activeErrorMessage,
  onRetry: handleRetry,
  warnings: combinedWarnings,
  showGlobalLoader: false,
  showCornerLoader: cornerLoaderVisible,
  stickyHeaders: resolvedStickyHeaders,
  headerOffset,
  headerRowOffsets,
  headerRef,
  colTotalPosition: layoutResult.resolvedColTotalPosition,
  formatting,
  onToggleNode: handleToggle,
  onSortColumn: renderModelResult.handleColumnSort,
  isColumnSortable: renderModelResult.isColumnSortable,
  getColumnSortOrder: renderModelResult.getColumnSortOrder,
  shouldShowToggle: renderModelResult.shouldShowToggle,
  showSpinner: key =>
    !pendingDisplaySnapshot && !seamlessLoading && loadingKeys.has(key),
  isRowAggregateBold: renderModelResult.isRowAggregateBold,
  isColAggregateBold: renderModelResult.isColAggregateBold,
  getNodeDimDepth: renderModelResult.getNodeDimDepth,
  isMetricGrandTotalNode: layoutResult.isMetricGrandTotalNode,
  emitCrossFilters,
  handleCellClick: interactions.handleCellClick,
  handleCellKeyDown: interactions.handleCellKeyDown,
  handleCellContextMenu: interactions.handleCellContextMenu,
  rowAxisLabels,
  exportChartId,
});
