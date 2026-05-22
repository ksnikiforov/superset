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
import { useMemo } from 'react';
import { type JsonObject } from '@superset-ui/core';
import {
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  INTERACTION_PANEL_WIDTH,
  INTERACTION_SIDE_CHIPS_WIDTH,
  INTERACTION_TOP_CHIPS_HEIGHT,
} from './PivotInteractionLayout';
import { useStickyHeaders } from './useStickyHeaders';
import { usePivotFormatting } from './usePivotFormatting';
import { usePivotInteractions } from './usePivotInteractions';
import { type PivotLayoutResult } from './usePivotLayout';
import { type PivotRenderModelResult } from './usePivotRenderModel';
import { type PivotTableViewProps } from '../render/PivotTableView';
import { type ChartDataWarning } from '../data/ChartDataClient';

type UsePivotTableViewSurfaceInput = {
  width: number;
  height: number;
  isUserControlledMode: boolean;
  stickyHeaders: boolean;
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  loadingKeys: Set<string>;
  errorMessage?: string;
  warnings: ChartDataWarning[];
  seamlessLoading: boolean;
  seamlessWarnings: ChartDataWarning[];
  seamlessError?: string;
  formData: PivotTableProps['formData'];
  appliedLayoutFormData: PivotTableProps['formData'];
  layout: PivotLayoutResult;
  renderModelResult: PivotRenderModelResult;
  emitCrossFilters?: boolean;
  setDataMask: PivotTableProps['setDataMask'];
  mergeOwnState: (partial: JsonObject) => JsonObject;
  treeDataSignature: string;
  onContextMenu?: PivotTableProps['onContextMenu'];
  ownState?: JsonObject;
  dateFormatters: PivotTableProps['formData']['dateFormatters'];
  theme: PivotTableProps['theme'];
  onToggleNode: (axis: 'row' | 'col', node: PivotTreeNode) => void;
  onRetry: () => void;
  rowAxisLabels: string[];
};

export const usePivotTableViewSurface = ({
  width,
  height,
  isUserControlledMode,
  stickyHeaders,
  tree,
  expandedRows,
  expandedCols,
  loadingKeys,
  errorMessage,
  warnings,
  seamlessLoading,
  seamlessWarnings,
  seamlessError,
  formData,
  appliedLayoutFormData,
  layout,
  renderModelResult,
  emitCrossFilters,
  setDataMask,
  mergeOwnState,
  treeDataSignature,
  onContextMenu,
  ownState,
  dateFormatters,
  theme,
  onToggleNode,
  onRetry,
  rowAxisLabels,
}: UsePivotTableViewSurfaceInput) => {
  const tableWidth = Math.max(
    0,
    isUserControlledMode
      ? width - INTERACTION_PANEL_WIDTH - INTERACTION_SIDE_CHIPS_WIDTH
      : width,
  );
  const tableHeight = Math.max(
    0,
    isUserControlledMode ? height - INTERACTION_TOP_CHIPS_HEIGHT : height,
  );

  const { headerOffset, headerRowOffsets, headerRef } = useStickyHeaders({
    enabled: stickyHeaders,
    columnHeaderRows: renderModelResult.renderModel.columnHeaderRows,
    width: tableWidth,
  });

  const formatting = usePivotFormatting({
    tree,
    renderModel: renderModelResult.renderModel,
    expandedRows,
    formData: appliedLayoutFormData,
    layout,
    rowValuesMap: renderModelResult.rowValuesMap,
    colValuesMap: renderModelResult.colValuesMap,
    getNodeDimDepth: renderModelResult.getNodeDimDepth,
    theme,
  });

  const interactions = usePivotInteractions({
    emitCrossFilters,
    setDataMask,
    mergeOwnState,
    treeDataSignature,
    layout,
    onContextMenu,
    ownState,
    dateFormatters,
    timeGrainSqla:
      appliedLayoutFormData.timeGrainSqla ??
      appliedLayoutFormData.time_grain_sqla,
  });

  const combinedWarnings = useMemo(
    () => [...warnings, ...seamlessWarnings],
    [seamlessWarnings, warnings],
  );
  const activeErrorMessage = seamlessError ?? errorMessage;
  const exportChartId =
    typeof formData.slice_id === 'number' ||
    typeof formData.slice_id === 'string'
      ? formData.slice_id
      : undefined;

  const pivotViewProps: Omit<PivotTableViewProps, 'height' | 'width'> = {
    renderModel: renderModelResult.renderModel,
    tree,
    expandedRows,
    expandedCols,
    errorMessage: activeErrorMessage,
    onRetry,
    warnings: combinedWarnings,
    showGlobalLoader: false,
    showCornerLoader: seamlessLoading,
    stickyHeaders,
    headerOffset,
    headerRowOffsets,
    headerRef,
    colTotalPosition: layout.layout.colTotalPosition,
    formatting,
    onToggleNode,
    onSortColumn: renderModelResult.handleColumnSort,
    isColumnSortable: renderModelResult.isColumnSortable,
    getColumnSortOrder: renderModelResult.getColumnSortOrder,
    shouldShowToggle: renderModelResult.shouldShowToggle,
    showSpinner: (key: string) => !seamlessLoading && loadingKeys.has(key),
    isRowAggregateBold: renderModelResult.isRowAggregateBold,
    isColAggregateBold: renderModelResult.isColAggregateBold,
    getNodeDimDepth: renderModelResult.getNodeDimDepth,
    pivotProgram: layout.layout.pivotProgram,
    emitCrossFilters,
    handleCellClick: interactions.handleCellClick,
    handleCellKeyDown: interactions.handleCellKeyDown,
    handleCellContextMenu: interactions.handleCellContextMenu,
    rowAxisLabels,
    exportChartId,
  };

  return {
    tableWidth,
    tableHeight,
    pivotViewProps,
  };
};
