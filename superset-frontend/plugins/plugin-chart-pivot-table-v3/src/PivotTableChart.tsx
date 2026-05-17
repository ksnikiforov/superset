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
  styled,
  t,
} from '@superset-ui/core';
import { Loading } from '@superset-ui/core/components';
import {
  type PivotTableProps,
  MetricsLayoutEnum,
  PivotRuntimeLayout,
} from './types';
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
  normalizeRuntimeLayout,
  resolveAppliedInteractionLayout,
} from './pivot/layout/resolveInteractionLayout';
import { buildSelectionFilteredFormData } from './pivot/update/initialUpdatePlan';
import { buildTreeDimensionFilterValues } from './pivot/filters';
import { useDimensionFilterValues } from './pivot/chart/useDimensionFilterValues';
import { buildInteractionChips } from './pivot/layout/interactionDrag';
import { getStableColumnKey } from './utils';
import { getMetricKeys } from './pivot/core/tokens';
import { useSyncRef } from './pivot/shared/useSyncRef';
import {
  buildSeamlessRuntimeUpstreamSignature,
  type SeamlessRuntimeSyncSnapshot,
} from './pivot/runtime/seamlessRuntimeUpdate';
import { usePivotSeamlessRuntimeUpdate } from './pivot/chart/usePivotSeamlessRuntimeUpdate';
import { PivotTableView } from './pivot/render/PivotTableView';

const EMPTY_SELECTED_FILTERS: Record<string, DataRecordValue[]> = {};
const MetaLoadingWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
`;

function PivotTableChart(props: PivotTableProps) {
  const {
    data,
    factBatches,
    formData,
    queryFormData,
    width,
    height,
    metrics,
    startCollapsed = true,
    initialDepth = 1,
    expandRowsLevel,
    expandColumnsLevel,
    verboseMap,
    ownState,
    setDataMask,
    setControlValue,
    emitCrossFilters,
    selectedFilters,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    persistExpansionState: persistExpansionStateProp,
    onContextMenu,
    timeGrainSqla,
    dateFormatters = {},
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
    stickyHeaders = true,
    theme = supersetTheme,
    appSection,
  } = props;

  const { interactionMode } = formData;
  const isUserControlled = interactionMode === 'user_controlled';
  const isDashboardContext =
    appSection === AppSection.Dashboard || formData.dashboardId !== undefined;
  const isDashboardRuntimeSync = isUserControlled && isDashboardContext;
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
  const {
    resolvedVerboseMap,
    resolvedDateFormatters,
    metaState,
    needsVerboseMap,
    needsDateFormatters,
  } = usePivotDatasetMeta({
    datasourceId,
    dimensions: dimensionList,
    formData,
    fetchFormDataBase,
    verboseMap,
    dateFormatters,
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
  const resolvedStickyHeaders = formData.stickyHeaders ?? stickyHeaders;

  const expandedRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const expandedColsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingColsForSeamlessRef = useRef<Set<string>>(new Set());
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
  const metricsForUi = useMemo(
    () => sourceMetrics ?? formData.metrics ?? metrics,
    [formData.metrics, metrics, sourceMetrics],
  );
  const metricKeys = useMemo(() => getMetricKeys(metricsForUi), [metricsForUi]);
  const hasMetrics = metricKeys.length > 0;
  const runtimeLayout = useMemo(() => {
    const persisted =
      (ownState?.pivotRuntimeLayout as PivotRuntimeLayout | undefined) ??
      formData.pivotRuntimeLayout;
    return normalizeRuntimeLayout(persisted, dimensionKeys, metricKeys);
  }, [dimensionKeys, formData.pivotRuntimeLayout, metricKeys, ownState]);
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
    isUserControlled,
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
  });

  const { appliedLayoutFormData, appliedPivotProgram } =
    resolveAppliedInteractionLayout({
      isUserControlled,
      appliedFormData,
      formData,
      sourceMetrics,
      sourceMeasureLeavesByMetric,
      committedRuntimeLayout: committedRuntimeLayoutRef.current,
      appliedDimensionKeys,
    });
  const fetchFormData = useMemo(() => {
    if (!isUserControlled) {
      return appliedLayoutFormData;
    }
    return buildSelectionFilteredFormData({
      formData: appliedLayoutFormData,
      selection: committedFilters,
    });
  }, [appliedLayoutFormData, committedFilters, isUserControlled]);

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
    isUserControlled,
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
    sourceFormData: formData,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    upstreamSignature: upstreamSeamlessSignature,
    seamlessSyncRef: lastSeamlessSyncRef,
    expandedRowsRef: expandedRowsForSeamlessRef,
    expandedColsRef: expandedColsForSeamlessRef,
    pendingRowsRef: pendingRowsForSeamlessRef,
    pendingColsRef: pendingColsForSeamlessRef,
    commitFilters,
    updateUiSelectedFilters,
    lastLocalSyncDashboardQueryContextRef,
    suppressStalePersistedFilterRestoreRef,
    commitUiRuntimeLayout: updateUiRuntimeLayout,
    persistRuntimeState,
  });

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
    pivotProgram: appliedPivotProgram,
  });
  const layoutGroupbyRows = layoutResult.layout.groupbyRows;
  const rowAxisLabels = useMemo(
    () =>
      layoutGroupbyRows.map(dimension => {
        const baseLabel = getColumnLabel(dimension);
        const stableKey = getStableColumnKey(dimension);
        return (
          resolvedVerboseMap[stableKey] ??
          (typeof dimension === 'string'
            ? (resolvedVerboseMap[dimension] ?? baseLabel)
            : baseLabel)
        );
      }),
    [layoutGroupbyRows, resolvedVerboseMap],
  );
  const {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    pendingRows,
    pendingCols,
    errorMessage,
    warnings,
    isHydrating,
    handleToggle,
    handleRetry,
  } = useExpansionEngine({
    data: dataForRender,
    factBatches: factBatchesForRender,
    expandedStateSignature: layoutResult.expandedStateSignature,
    expandedStateSharedSignature: layoutResult.expandedStateSharedSignature,
    fetchFormData,
    resolvedExpandRowsLevel: layoutResult.resolvedExpandRowsLevel,
    resolvedExpandColumnsLevel: layoutResult.resolvedExpandColumnsLevel,
    metricLabelSet: layoutResult.metricLabelSet,
    isMetricTokenValue: layoutResult.isMetricTokenValue,
    pivotProgram: layoutResult.layout.pivotProgram,
    buildRenderModelConfig: layoutResult.buildRenderModelConfig,
    expandRowsLevelRaw: layoutResult.expandRowsLevelRaw,
    expandColumnsLevelRaw: layoutResult.expandColumnsLevelRaw,
    setControlValue,
    setDataMask: shouldPersistOwnState ? setDataMask : undefined,
    mergeOwnState: shouldPersistOwnState ? mergeOwnState : undefined,
    persistedExpansionState:
      appliedLayoutFormData.pivotExpansionState ??
      ownState?.pivotExpansionState,
    shouldPersistExpansionState: persistExpansionState,
    pruneMergedTree: layoutResult.pruneMergedTree,
  });

  useSyncRef(expandedRowsForSeamlessRef, expandedRows);
  useSyncRef(expandedColsForSeamlessRef, expandedCols);
  useSyncRef(pendingRowsForSeamlessRef, pendingRows);
  useSyncRef(pendingColsForSeamlessRef, pendingCols);

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
        layout: layoutResult,
        verboseMap: resolvedVerboseMap,
      }),
    [
      dimensionList,
      layoutResult,
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

  const tableWidth = isUserControlled
    ? Math.max(
        0,
        width - INTERACTION_PANEL_WIDTH - INTERACTION_SIDE_CHIPS_WIDTH,
      )
    : width;

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
    treeDataSignature: formatting.treeDataSignature,
    layout: layoutResult,
    onContextMenu,
    ownState,
    dateFormatters: resolvedDateFormatters,
    timeGrainSqla,
  });

  const combinedWarnings = useMemo(
    () => [...warnings, ...seamlessWarnings],
    [seamlessWarnings, warnings],
  );
  const activeErrorMessage = seamlessError ?? errorMessage;
  const cornerLoaderVisible = isUserControlled
    ? seamlessLoading || isHydrating
    : isHydrating;
  const tableHeight = isUserControlled
    ? Math.max(0, height - INTERACTION_TOP_CHIPS_HEIGHT)
    : height;
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
    isMetricGrandTotalNode: layoutResult.isMetricGrandTotalNode,
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
  const shouldDelayRender =
    !isUserControlled &&
    datasourceId !== null &&
    (metaState === 'loading' ||
      (metaState === 'idle' && (needsVerboseMap || needsDateFormatters)));

  if (shouldDelayRender) {
    return (
      <MetaLoadingWrap>
        <Loading />
      </MetaLoadingWrap>
    );
  }

  if (!isUserControlled) {
    return (
      <PivotTableView
        {...sharedPivotViewProps}
        height={height}
        width={width}
        showGlobalLoader={isHydrating}
        showCornerLoader={isHydrating}
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
          measureLeavesByMetric={
            sourceMeasureLeavesByMetric ?? formData.measureLeavesByMetric
          }
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
