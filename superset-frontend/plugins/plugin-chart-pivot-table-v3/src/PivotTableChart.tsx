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
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AppSection,
  DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  supersetTheme,
  type JsonObject,
  t,
} from '@superset-ui/core';
import { type PivotTableProps, PivotRuntimeLayout } from './types';
import { useExpansionEngine } from './pivot/expansion/useExpansionEngine';
import { usePivotLayout } from './pivot/chart/usePivotLayout';
import { usePivotRenderModel } from './pivot/chart/usePivotRenderModel';
import { useStickyHeaders } from './pivot/chart/useStickyHeaders';
import { usePivotFormatting } from './pivot/chart/usePivotFormatting';
import { usePivotInteractions } from './pivot/chart/usePivotInteractions';
import { usePivotDatasetMeta } from './pivot/chart/usePivotDatasetMeta';
import { usePivotRuntimeLayoutState } from './pivot/chart/usePivotRuntimeLayoutState';
import {
  INTERACTION_PANEL_WIDTH,
  INTERACTION_SIDE_CHIPS_WIDTH,
  INTERACTION_TOP_CHIPS_HEIGHT,
  PivotInteractionLayout,
} from './pivot/chart/PivotInteractionLayout';
import { PivotInteractionPanel } from './pivot/chart/PivotInteractionPanel';
import {
  buildRuntimeLayoutFromFormData,
  normalizeRuntimeLayout,
  resolveAppliedInteractionLayout,
} from './pivot/layout/resolveInteractionLayout';
import { buildSelectionFilteredFormData } from './pivot/update/initialUpdatePlan';
import { buildTreeDimensionFilterValues } from './pivot/filters';
import { useDimensionFilterValues } from './pivot/chart/useDimensionFilterValues';
import { buildInteractionChips } from './pivot/layout/interactionDrag';
import { getStableColumnKey } from './utils';
import { getMetricKeys } from './pivot/metrics';
import {
  isSameRuntimeLayout,
  buildSeamlessRuntimeUpstreamSignature,
  type SeamlessRuntimeSyncSnapshot,
} from './pivot/runtime/seamlessRuntimeUpdate';
import { usePivotSeamlessRuntimeUpdate } from './pivot/chart/usePivotSeamlessRuntimeUpdate';
import { PivotTableView } from './pivot/render/PivotTableView';

const EMPTY_SELECTED_FILTERS: Record<string, DataRecordValue[]> = {};

function PivotTableChart(props: PivotTableProps) {
  const {
    data,
    factBatches,
    formData,
    treeDataSignature = '',
    queryFormData,
    width,
    height,
    ownState,
    setDataMask,
    setControlValue,
    emitCrossFilters,
    selectedFilters,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    persistExpansionState: persistExpansionStateProp,
    onContextMenu,
    theme = supersetTheme,
    appSection,
  } = props;

  const isDashboardContext =
    appSection === AppSection.Dashboard || formData.dashboardId !== undefined;
  const isUserControlledMode = formData.interactionMode === 'user_controlled';
  const isDashboardRuntimeSync = isDashboardContext;
  const shouldPersistOwnState = !isDashboardRuntimeSync;
  const fetchFormDataBase = queryFormData || formData;
  const dimensionList = useMemo(
    () => ensureIsArray(formData.dimensions),
    [formData.dimensions],
  );
  const dimensionKeys = useMemo(
    () => dimensionList.map(dimension => getStableColumnKey(dimension)),
    [dimensionList],
  );
  const datasourceId = useMemo(() => {
    const datasource = formData.datasource || '';
    const [idPart] = datasource.split('__');
    const id = Number(idPart);
    return Number.isFinite(id) ? id : null;
  }, [formData.datasource]);
  const { resolvedVerboseMap, resolvedDateFormatters } = usePivotDatasetMeta({
    datasourceId,
    dimensions: dimensionList,
    formData,
    fetchFormDataBase,
    verboseMap: formData.verboseMap,
    dateFormatters: formData.dateFormatters ?? {},
  });
  const fetchFormDataBaseWithFormatters = useMemo(
    () => ({
      ...fetchFormDataBase,
      dateFormatters: resolvedDateFormatters,
      verboseMap: resolvedVerboseMap,
    }),
    [fetchFormDataBase, resolvedDateFormatters, resolvedVerboseMap],
  );

  const appliedFormData = fetchFormDataBaseWithFormatters;
  const persistExpansionState = persistExpansionStateProp ?? true;
  const resolvedStickyHeaders = formData.stickyHeaders ?? true;

  const lastSeamlessSyncRef = useRef<SeamlessRuntimeSyncSnapshot | null>(null);
  const ownStateRef = useRef<JsonObject>(ownState ?? {});
  useEffect(() => {
    ownStateRef.current = { ...ownStateRef.current, ...(ownState ?? {}) };
  }, [ownState]);

  const mergeOwnState = useCallback((partial: JsonObject) => {
    const next = { ...ownStateRef.current, ...partial };
    ownStateRef.current = next;
    return next;
  }, []);

  const appliedDimensionKeys = useMemo(
    () =>
      ensureIsArray(appliedFormData.dimensions).map(dimension =>
        getStableColumnKey(dimension),
      ),
    [appliedFormData.dimensions],
  );
  const metricsForUi = sourceMetrics;
  const metricKeys = useMemo(() => getMetricKeys(metricsForUi), [metricsForUi]);
  const hasMetrics = metricKeys.length > 0;
  const runtimeLayout = useMemo(() => {
    const persisted =
      (ownState?.pivotRuntimeLayout as PivotRuntimeLayout | undefined) ??
      formData.pivotRuntimeLayout ??
      buildRuntimeLayoutFromFormData(formData);
    return normalizeRuntimeLayout(persisted, dimensionKeys, metricKeys);
  }, [dimensionKeys, formData, metricKeys, ownState]);
  const appliedRuntimeLayoutFromQuery = useMemo(
    () =>
      normalizeRuntimeLayout(
        appliedFormData.pivotRuntimeLayout ?? runtimeLayout,
        appliedDimensionKeys,
        metricKeys,
      ),
    [
      appliedDimensionKeys,
      appliedFormData.pivotRuntimeLayout,
      metricKeys,
      runtimeLayout,
    ],
  );
  const appliedRuntimeLayout =
    ownState?.pivotRuntimeLayout ||
    isSameRuntimeLayout(appliedRuntimeLayoutFromQuery, runtimeLayout)
      ? runtimeLayout
      : appliedRuntimeLayoutFromQuery;
  const selectedFiltersFromProps = selectedFilters ?? EMPTY_SELECTED_FILTERS;
  const suppressStalePersistedFilterRestoreRef = useRef(false);
  const selectedFiltersFromFormData =
    formData.pivotSelectedFilters ?? EMPTY_SELECTED_FILTERS;
  const selectedFiltersFromOwnState =
    (ownState?.pivotSelectedFilters as
      | Record<string, DataRecordValue[]>
      | undefined) ?? EMPTY_SELECTED_FILTERS;
  const upstreamDashboardQueryContextSignature = useMemo(() => {
    if (!isDashboardRuntimeSync) {
      return null;
    }
    return buildSeamlessRuntimeUpstreamSignature(queryFormData);
  }, [isDashboardRuntimeSync, queryFormData]);
  const {
    committedFilters,
    uiSelectedFilters,
    updateUiSelectedFilters,
    commitFilters,
    persistedInteractionFilters,
    selectedFiltersForTreeSync,
    committedRuntimeLayout,
    committedRuntimeLayoutRef,
    uiRuntimeLayout,
    uiRuntimeLayoutRef,
    updateUiRuntimeLayout,
    lastLocalSyncDashboardQueryContextRef,
    persistRuntimeState,
  } = usePivotRuntimeLayoutState({
    isDashboardContext,
    runtimeLayout,
    dimensions: dimensionList,
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
    selectedFiltersFromProps,
    upstreamDashboardQueryContextSignature,
    suppressStalePersistedFilterRestoreRef,
    mergeOwnState,
    setControlValue,
    setDataMask,
    committedRuntimeLayout: appliedRuntimeLayout,
  });

  const { appliedLayoutFormData, appliedPivotProgram } =
    resolveAppliedInteractionLayout({
      appliedFormData,
      sourceMetrics,
      sourceMeasureLeavesByMetric,
      committedRuntimeLayout: committedRuntimeLayoutRef.current,
      appliedDimensionKeys,
    });
  const { appliedLayoutFormData: draftLayoutFormData } =
    resolveAppliedInteractionLayout({
      appliedFormData,
      sourceMetrics,
      sourceMeasureLeavesByMetric,
      committedRuntimeLayout: uiRuntimeLayout,
      appliedDimensionKeys,
    });
  const fetchFormData = useMemo(
    () =>
      buildSelectionFilteredFormData({
        formData: draftLayoutFormData,
        selection: committedFilters,
      }),
    [committedFilters, draftLayoutFormData],
  );

  const upstreamSeamlessSignature =
    upstreamDashboardQueryContextSignature ?? '';
  const {
    dataForRender,
    factBatchesForRender,
    seamlessLoading,
    seamlessWarnings,
    seamlessError,
    applyRuntimeLayoutChange,
    applyDimensionFilterChange,
    clearAllFilters,
    removeRuntimeDimension,
    dropRuntimeDimension,
    dropRuntimeValue,
  } = usePivotSeamlessRuntimeUpdate({
    dimensionKeys,
    metricKeys,
    data,
    factBatches,
    upstreamDashboardQueryContextSignature,
    persistedInteractionFilters,
    selectedFiltersForTreeSync,
    runtimeLayout,
    committedRuntimeLayout,
    committedFilters,
    uiSelectedFilters,
    uiRuntimeLayout,
    uiRuntimeLayoutRef,
    baseFormData: fetchFormDataBaseWithFormatters,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    upstreamSignature: upstreamSeamlessSignature,
    seamlessSyncRef: lastSeamlessSyncRef,
    commitFilters,
    updateUiSelectedFilters,
    lastLocalSyncDashboardQueryContextRef,
    suppressStalePersistedFilterRestoreRef,
    commitUiRuntimeLayout: updateUiRuntimeLayout,
    persistRuntimeState,
  });
  const expansionFetchFormData = seamlessLoading
    ? appliedLayoutFormData
    : fetchFormData;

  const dimensionLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    dimensionList.forEach(dimension => {
      const key = getStableColumnKey(dimension);
      const baseLabel = getColumnLabel(dimension);
      const label =
        typeof dimension === 'string'
          ? (resolvedVerboseMap[key] ?? baseLabel)
          : baseLabel;
      map.set(key, label);
    });
    return map;
  }, [dimensionList, resolvedVerboseMap]);

  const layoutResult = usePivotLayout({
    formData: appliedLayoutFormData,
    pivotProgram: appliedPivotProgram,
  });
  const layoutRowDimensions = layoutResult.layout.pivotProgram.rowDimensions;
  const rowAxisLabels = useMemo(
    () =>
      layoutRowDimensions.map(dimension => {
        const baseLabel = getColumnLabel(dimension);
        const stableKey = getStableColumnKey(dimension);
        return (
          resolvedVerboseMap[stableKey] ??
          (typeof dimension === 'string'
            ? (resolvedVerboseMap[dimension] ?? baseLabel)
            : baseLabel)
        );
      }),
    [layoutRowDimensions, resolvedVerboseMap],
  );
  const {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    errorMessage,
    warnings,
    isHydrating,
    handleToggle,
    handleRetry,
  } = useExpansionEngine({
    data: dataForRender,
    factBatches: factBatchesForRender,
    expansionSemanticSignature: layoutResult.expansionSemanticSignature,
    fetchFormData: expansionFetchFormData,
    axisCoverageNeeds: layoutResult.layout.axisCoverageNeeds,
    pivotProgram: layoutResult.layout.pivotProgram,
    fetchLayout: layoutResult.layout,
    setControlValue,
    setDataMask: shouldPersistOwnState ? setDataMask : undefined,
    mergeOwnState: shouldPersistOwnState ? mergeOwnState : undefined,
    persistedExpansionState:
      appliedLayoutFormData.pivotExpansionState ??
      ownState?.pivotExpansionState,
    shouldPersistExpansionState: persistExpansionState,
  });

  const renderModelResult = usePivotRenderModel({
    tree,
    expandedRows,
    expandedCols,
    formData: appliedLayoutFormData,
    layout: layoutResult,
  });
  const { renderTree } = renderModelResult;

  const treeDimensionFilterValues = useMemo(
    () =>
      buildTreeDimensionFilterValues({
        dimensions: dimensionList,
        rows: renderTree.rows,
        cols: renderTree.cols,
        program: layoutResult.layout.pivotProgram,
        verboseMap: resolvedVerboseMap,
      }),
    [
      dimensionList,
      layoutResult.layout.pivotProgram,
      renderTree.cols,
      renderTree.rows,
      resolvedVerboseMap,
    ],
  );
  const {
    values: dimensionFilterValues,
    loading: dimensionFilterLoading,
    fetchValues: handleFetchDimensionValues,
  } = useDimensionFilterValues({
    dimensions: dimensionList,
    treeValues: treeDimensionFilterValues,
    formData: fetchFormDataBaseWithFormatters,
    selectedFilters: uiSelectedFilters,
    colTypeMap: fetchFormDataBaseWithFormatters.colTypeMap,
  });

  const tableWidth = Math.max(
    0,
    isUserControlledMode
      ? width - INTERACTION_PANEL_WIDTH - INTERACTION_SIDE_CHIPS_WIDTH
      : width,
  );

  const { headerOffset, headerRowOffsets, headerRef } = useStickyHeaders({
    enabled: resolvedStickyHeaders,
    columnHeaderRows: renderModelResult.renderModel.columnHeaderRows,
    width: tableWidth,
  });

  const formatting = usePivotFormatting({
    tree: renderTree,
    renderModel: renderModelResult.renderModel,
    expandedRows: renderModelResult.expandedRowsForRender,
    formData: appliedLayoutFormData,
    layout: layoutResult,
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
    layout: layoutResult,
    onContextMenu,
    ownState,
    dateFormatters: resolvedDateFormatters,
    timeGrainSqla:
      appliedLayoutFormData.timeGrainSqla ??
      appliedLayoutFormData.time_grain_sqla,
  });

  const combinedWarnings = useMemo(
    () => [...warnings, ...seamlessWarnings],
    [seamlessWarnings, warnings],
  );
  const activeErrorMessage = seamlessError ?? errorMessage;
  const cornerLoaderVisible = seamlessLoading || isHydrating;
  const tableHeight = Math.max(
    0,
    isUserControlledMode ? height - INTERACTION_TOP_CHIPS_HEIGHT : height,
  );
  const exportChartId =
    typeof formData.slice_id === 'number' ||
    typeof formData.slice_id === 'string'
      ? formData.slice_id
      : undefined;
  const sharedPivotViewProps = {
    renderModel: renderModelResult.renderModel,
    tree: renderTree,
    expandedRows: renderModelResult.expandedRowsForRender,
    expandedCols: renderModelResult.expandedColsForRender,
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
    showSpinner: (key: string) => !seamlessLoading && loadingKeys.has(key),
    isRowAggregateBold: renderModelResult.isRowAggregateBold,
    isColAggregateBold: renderModelResult.isColAggregateBold,
    getNodeDimDepth: renderModelResult.getNodeDimDepth,
    pivotProgram: layoutResult.layout.pivotProgram,
    emitCrossFilters,
    handleCellClick: interactions.handleCellClick,
    handleCellKeyDown: interactions.handleCellKeyDown,
    handleCellContextMenu: interactions.handleCellContextMenu,
    rowAxisLabels,
    exportChartId,
  };
  const rowChips = useMemo(
    () =>
      buildInteractionChips({
        axis: 'row',
        layout: uiRuntimeLayout,
        dimensionLabelMap,
        hasMetrics,
        valueLabel: t('Value'),
      }),
    [dimensionLabelMap, hasMetrics, uiRuntimeLayout],
  );
  const colChips = useMemo(
    () =>
      buildInteractionChips({
        axis: 'col',
        layout: uiRuntimeLayout,
        dimensionLabelMap,
        hasMetrics,
        valueLabel: t('Value'),
      }),
    [dimensionLabelMap, hasMetrics, uiRuntimeLayout],
  );
  if (!isUserControlledMode) {
    return (
      <PivotTableView
        {...sharedPivotViewProps}
        height={tableHeight}
        width={tableWidth}
      />
    );
  }

  return (
    <PivotInteractionLayout
      height={height}
      tableHeight={tableHeight}
      tableWidth={tableWidth}
      rowChips={rowChips}
      colChips={colChips}
      onDropDimension={dropRuntimeDimension}
      onDropValue={dropRuntimeValue}
      onRemoveDimension={removeRuntimeDimension}
      panel={
        <PivotInteractionPanel
          dimensions={dimensionList}
          metrics={metricsForUi}
          measureLeavesByMetric={sourceMeasureLeavesByMetric}
          metricLabelMap={formData.metricLabelMap}
          dimensionLabelMap={resolvedVerboseMap}
          dateFormatters={resolvedDateFormatters}
          dimensionFilterValues={dimensionFilterValues}
          dimensionFilterLoading={dimensionFilterLoading}
          selectedFilters={uiSelectedFilters}
          onFilterChange={applyDimensionFilterChange}
          onClearFilters={clearAllFilters}
          onFilterValuesOpen={handleFetchDimensionValues}
          onFilterValuesSearch={handleFetchDimensionValues}
          runtimeLayout={uiRuntimeLayout}
          onChange={applyRuntimeLayoutChange}
        />
      }
    >
      <PivotTableView
        {...sharedPivotViewProps}
        height={tableHeight}
        width={tableWidth}
      />
    </PivotInteractionLayout>
  );
}

export default PivotTableChart;
