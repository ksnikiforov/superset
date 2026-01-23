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
import { useCallback, useEffect, useRef } from 'react';
import { supersetTheme, type JsonObject } from '@superset-ui/core';
import { type PivotTableProps, MetricsLayoutEnum, type PivotTreeData } from './types';
import { PivotTableView } from './pivot/render/PivotTableView';
import { useExpansionEngine } from './pivot/engine/useExpansionEngine';
import { usePivotLayout } from './pivot/chart/usePivotLayout';
import { usePivotRenderModel } from './pivot/chart/usePivotRenderModel';
import { useStickyHeaders } from './pivot/chart/useStickyHeaders';
import { usePivotFormatting } from './pivot/chart/usePivotFormatting';
import { usePivotInteractions } from './pivot/chart/usePivotInteractions';

function PivotTableChart(props: PivotTableProps) {
  const {
    data,
    formData,
    queryFormData,
    width,
    height,
    metrics,
    groupbyRows,
    groupbyColumns,
    startCollapsed = true,
    initialDepth = 1,
    expandRowsLevel,
    expandColumnsLevel,
    rowOrder,
    colOrder,
    valueFormat,
    columnFormats,
    currencyFormats,
    allowRenderHtml,
    ownState,
    setDataMask,
    setControlValue,
    emitCrossFilters,
    persistExpansionState: persistExpansionStateProp,
    onContextMenu,
    timeGrainSqla,
    dateFormatters = {},
    colTypeMap,
    metricsLayout = MetricsLayoutEnum.COLUMNS,
    rowSubtotalLevels = [],
    colSubtotalLevels = [],
    rowTotals = false,
    colTotals = true,
    rowSubTotals = false,
    rowTotalPosition = 'start',
    rowSubtotalPosition = 'start',
    colTotalPosition = 'start',
    colSubtotalPosition = 'start',
    pivotTheme = 'none',
    pivotThemeColors = '',
    stickyHeaders = true,
    theme = supersetTheme,
  } = props;

  const fetchFormData = queryFormData || formData;
  const persistExpansionState = persistExpansionStateProp ?? true;
  const resolvedStickyHeaders = formData.stickyHeaders ?? stickyHeaders;

  const treeRef = useRef<PivotTreeData>(data);
  const ownStateRef = useRef<JsonObject>(ownState ?? {});

  useEffect(() => {
    ownStateRef.current = ownState ?? {};
  }, [ownState]);

  const mergeOwnState = useCallback((partial: JsonObject) => {
    const next = { ...ownStateRef.current, ...partial };
    ownStateRef.current = next;
    return next;
  }, []);

  const layoutResult = usePivotLayout({
    data,
    formData,
    metrics,
    groupbyRows,
    groupbyColumns,
    metricsLayout,
    startCollapsed,
    initialDepth,
    expandRowsLevel,
    expandColumnsLevel,
    rowTotals,
    colTotals,
    rowSubTotals,
    rowSubtotalLevels,
    colSubtotalLevels,
    rowTotalPosition,
    rowSubtotalPosition,
    colTotalPosition,
    colSubtotalPosition,
  });

  const {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    errorMessage,
    warnings,
    isHydrating,
    handleToggle,
  } = useExpansionEngine({
    data,
    expandedStateSignature: layoutResult.expandedStateSignature,
    fetchFormData,
    groupbyRowKeys: layoutResult.groupbyRowKeys,
    groupbyColumnKeys: layoutResult.groupbyColumnKeys,
    groupbyRowsLength: groupbyRows.length,
    groupbyColumnsLength: groupbyColumns.length,
    resolvedExpandRowsLevel: layoutResult.resolvedExpandRowsLevel,
    resolvedExpandColumnsLevel: layoutResult.resolvedExpandColumnsLevel,
    shouldExpandMetricRows: layoutResult.shouldExpandMetricRows,
    shouldExpandMetricCols: layoutResult.shouldExpandMetricCols,
    metricLabelSet: layoutResult.metricLabelSet,
    metricIndexForRows: layoutResult.metricIntentIndexOnRows,
    metricIndexForCols: layoutResult.metricIntentIndexOnCols,
    isMetricTokenValue: layoutResult.isMetricTokenValue,
    countDimDepth: layoutResult.countEngineDimDepth,
    expandRowsLevelRaw: layoutResult.expandRowsLevelRaw,
    expandColumnsLevelRaw: layoutResult.expandColumnsLevelRaw,
    setControlValue,
    setDataMask,
    mergeOwnState,
    persistedExpansionState:
      formData.pivotExpansionState ?? ownState?.['pivotExpansionState'],
    shouldPersistExpansionState: persistExpansionState,
    getFetchPath: layoutResult.getFetchPath,
    pruneMergedTree: layoutResult.pruneMergedTree,
  });

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const renderModelResult = usePivotRenderModel({
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    isHydrating,
    formData,
    rowOrder,
    colOrder,
    groupbyRows,
    groupbyColumns,
    colTypeMap,
    rowTotals,
    colTotals,
    rowSubTotals,
    layout: layoutResult,
  });

  const { headerOffset, headerRowOffsets, headerRef } = useStickyHeaders({
    enabled: resolvedStickyHeaders,
    columnHeaderRows: renderModelResult.renderModel.columnHeaderRows,
    width,
  });

  const formatting = usePivotFormatting({
    tree,
    renderModel: renderModelResult.renderModel,
    expandedRows,
    formData,
    groupbyRows,
    groupbyColumns,
    metrics,
    layout: layoutResult,
    rowValuesMap: renderModelResult.rowValuesMap,
    colValuesMap: renderModelResult.colValuesMap,
    getNodeDimDepth: renderModelResult.getNodeDimDepth,
    rowSubTotals,
    valueFormat,
    columnFormats,
    currencyFormats,
    allowRenderHtml,
    pivotTheme,
    pivotThemeColors,
    theme,
  });

  const interactions = usePivotInteractions({
    emitCrossFilters,
    setDataMask,
    mergeOwnState,
    treeRef,
    treeDataSignature: formatting.treeDataSignature,
    groupbyRows,
    groupbyColumns,
    metrics,
    resolvedMetricsLayout: layoutResult.resolvedMetricsLayout,
    onContextMenu,
    ownState,
    dateFormatters,
    timeGrainSqla,
  });

  return (
    <PivotTableView
      height={height}
      width={width}
      renderModel={renderModelResult.renderModel}
      tree={tree}
      expandedRows={expandedRows}
      expandedCols={expandedCols}
      errorMessage={errorMessage}
      warnings={warnings}
      showGlobalLoader={renderModelResult.showGlobalLoader}
      stickyHeaders={resolvedStickyHeaders}
      headerOffset={headerOffset}
      headerRowOffsets={headerRowOffsets}
      headerRef={headerRef}
      themeColor={formatting.themeColor}
      rowTotalPosition={layoutResult.resolvedColTotalPosition}
      metricFormattingScope={formatting.metricFormattingScope}
      metricDatabars={formatting.metricDatabars}
      formattingKeyMap={formatting.formattingKeyMap}
      databarColumnMinWidths={formatting.databarColumnMinWidths}
      onToggleNode={handleToggle}
      shouldShowToggle={renderModelResult.shouldShowToggle}
      showRowSpinner={renderModelResult.showRowSpinner}
      showColSpinner={renderModelResult.showColSpinner}
      formatLabel={formatting.formatLabel}
      isRowAggregateBold={renderModelResult.isRowAggregateBold}
      isColAggregateBold={renderModelResult.isColAggregateBold}
      getNodeDimDepth={renderModelResult.getNodeDimDepth}
      getTotalBackground={formatting.getTotalBackground}
      resolveDimensionStyle={formatting.resolveDimensionStyle}
      deriveMetricKey={formatting.deriveMetricKey}
      isMetricGrandTotalNode={layoutResult.isMetricGrandTotalNode}
      isMetricSubtotalNode={layoutResult.isMetricSubtotalNode}
      renderCellContent={formatting.renderCellContent}
      renderDatabarContent={formatting.renderDatabarContent}
      emitCrossFilters={emitCrossFilters}
      handleCellClick={interactions.handleCellClick}
      handleCellKeyDown={interactions.handleCellKeyDown}
      handleCellContextMenu={interactions.handleCellContextMenu}
    />
  );
}

export default PivotTableChart;
