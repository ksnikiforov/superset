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
import { t } from '@apache-superset/core/translation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AppSection,
  DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  type JsonObject,
} from '@superset-ui/core';
import { Loading } from '@superset-ui/core/components';
import { supersetTheme } from '@apache-superset/core/theme';
import { type PivotTableProps, PivotRuntimeLayout } from './types';
import { useExpansionEngine } from './pivot/expansion/useExpansionEngine';
import { usePivotLayout } from './pivot/chart/usePivotLayout';
import { usePivotRenderModel } from './pivot/chart/usePivotRenderModel';
import { usePivotRuntimeLayoutState } from './pivot/chart/usePivotRuntimeLayoutState';
import { PivotInteractionLayout } from './pivot/chart/PivotInteractionLayout';
import { PivotInteractionPanel } from './pivot/chart/PivotInteractionPanel';
import {
  buildRuntimeLayoutFromFormData,
  normalizeRuntimeLayout,
  resolveAppliedInteractionLayout,
} from './pivot/layout/resolveInteractionLayout';
import { buildSelectionFilteredFormData } from './pivot/query/specs';
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
import { usePivotTableViewSurface } from './pivot/chart/usePivotTableViewSurface';
import { useDatasetVerboseMap } from './pivot/chart/useDatasetVerboseMap';

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

  const isUserControlledMode = formData.interactionMode === 'user_controlled';
  const isDashboardRuntimeSync = appSection === AppSection.Dashboard;
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
  const resolvedVerboseMap = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        Object.entries(formData.verboseMap ?? {}).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].length > 0,
        ),
      ),
    [formData.verboseMap],
  );
  const shouldFetchDatasetVerboseMap = useMemo(
    () =>
      isDashboardRuntimeSync &&
      dimensionKeys.some(dimensionKey => !resolvedVerboseMap[dimensionKey]),
    [dimensionKeys, isDashboardRuntimeSync, resolvedVerboseMap],
  );
  const { verboseMap: datasetVerboseMap, loading: isDatasetVerboseMapLoading } =
    useDatasetVerboseMap({
      datasourceKey: formData.datasource,
      enabled: shouldFetchDatasetVerboseMap,
    });
  const effectiveVerboseMap = useMemo(
    () => ({
      ...datasetVerboseMap,
      ...resolvedVerboseMap,
    }),
    [datasetVerboseMap, resolvedVerboseMap],
  );
  const isWaitingForDatasetVerboseMap = useMemo(
    () =>
      isDatasetVerboseMapLoading &&
      dimensionKeys.some(dimensionKey => !effectiveVerboseMap[dimensionKey]),
    [dimensionKeys, effectiveVerboseMap, isDatasetVerboseMapLoading],
  );
  const resolvedDateFormatters = useMemo(
    () => formData.dateFormatters ?? {},
    [formData.dateFormatters],
  );
  const fetchFormDataBaseWithFormatters = useMemo(
    () => ({
      ...fetchFormDataBase,
      dateFormatters: resolvedDateFormatters,
      verboseMap: effectiveVerboseMap,
    }),
    [effectiveVerboseMap, fetchFormDataBase, resolvedDateFormatters],
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
    const persisted = isUserControlledMode
      ? ((ownState?.pivotRuntimeLayout as PivotRuntimeLayout | undefined) ??
        formData.pivotRuntimeLayout)
      : undefined;
    return normalizeRuntimeLayout(
      persisted ?? buildRuntimeLayoutFromFormData(formData),
      dimensionKeys,
      metricKeys,
    );
  }, [dimensionKeys, formData, isUserControlledMode, metricKeys, ownState]);
  const appliedRuntimeLayoutFromQuery = useMemo(
    () =>
      normalizeRuntimeLayout(
        isUserControlledMode
          ? (appliedFormData.pivotRuntimeLayout ?? runtimeLayout)
          : buildRuntimeLayoutFromFormData(appliedFormData),
        appliedDimensionKeys,
        metricKeys,
      ),
    [
      appliedDimensionKeys,
      appliedFormData.pivotRuntimeLayout,
      appliedFormData,
      isUserControlledMode,
      metricKeys,
      runtimeLayout,
    ],
  );
  const appliedRuntimeLayout =
    !isUserControlledMode ||
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
    isDashboardContext: isDashboardRuntimeSync,
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

  const fixedAppliedRuntimeLayout = useMemo(
    () =>
      buildRuntimeLayoutFromFormData({
        ...appliedFormData,
        metrics: sourceMetrics,
        measureLeavesByMetric: sourceMeasureLeavesByMetric,
      }),
    [appliedFormData, sourceMeasureLeavesByMetric, sourceMetrics],
  );
  const committedLayoutForApplied = isUserControlledMode
    ? committedRuntimeLayoutRef.current
    : fixedAppliedRuntimeLayout;
  const draftLayoutForApplied = isUserControlledMode
    ? uiRuntimeLayout
    : fixedAppliedRuntimeLayout;

  const { appliedLayoutFormData, appliedPivotProgram } =
    resolveAppliedInteractionLayout({
      appliedFormData,
      sourceMetrics,
      sourceMeasureLeavesByMetric,
      committedRuntimeLayout: committedLayoutForApplied,
      appliedDimensionKeys,
    });
  const { appliedLayoutFormData: draftLayoutFormData } =
    resolveAppliedInteractionLayout({
      appliedFormData,
      sourceMetrics,
      sourceMeasureLeavesByMetric,
      committedRuntimeLayout: draftLayoutForApplied,
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
    seamlessCornerLoading,
    seamlessWarnings,
    seamlessError,
    applyRuntimeLayoutChange,
    applyDimensionFilterChange,
    clearAllFilters,
    commitFactBatchesForRender,
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
    syncControlValuesOnInteraction: isDashboardRuntimeSync,
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
          ? (effectiveVerboseMap[key] ?? baseLabel)
          : baseLabel;
      map.set(key, label);
    });
    return map;
  }, [dimensionList, effectiveVerboseMap]);

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
          effectiveVerboseMap[stableKey] ??
          (typeof dimension === 'string'
            ? (effectiveVerboseMap[dimension] ?? baseLabel)
            : baseLabel)
        );
      }),
    [effectiveVerboseMap, layoutRowDimensions],
  );
  const {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    isInitialExpansionHydrating,
    errorMessage,
    warnings,
    handleToggle,
    handleRetry,
  } = useExpansionEngine({
    data: dataForRender,
    factBatches: factBatchesForRender,
    onFactBatchesChange: commitFactBatchesForRender,
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

  const treeDimensionFilterValues = useMemo(
    () =>
      buildTreeDimensionFilterValues({
        dimensions: dimensionList,
        rows: tree.rows,
        cols: tree.cols,
        program: layoutResult.layout.pivotProgram,
      }),
    [dimensionList, layoutResult.layout.pivotProgram, tree.cols, tree.rows],
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

  const { tableWidth, tableHeight, pivotViewProps } = usePivotTableViewSurface({
    width,
    height,
    isUserControlledMode,
    stickyHeaders: resolvedStickyHeaders,
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    isInitialExpansionHydrating,
    errorMessage,
    warnings,
    seamlessLoading,
    seamlessCornerLoading,
    seamlessWarnings,
    seamlessError,
    formData,
    appliedLayoutFormData,
    layout: layoutResult,
    renderModelResult,
    emitCrossFilters,
    setDataMask,
    mergeOwnState,
    treeDataSignature,
    onContextMenu,
    ownState,
    dateFormatters: resolvedDateFormatters,
    theme,
    onToggleNode: handleToggle,
    onRetry: handleRetry,
    rowAxisLabels,
  });
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
  if (isWaitingForDatasetVerboseMap) {
    return (
      <div style={{ width, height, display: 'grid', placeItems: 'center' }}>
        <Loading muted position="inline-centered" size="s" />
      </div>
    );
  }

  if (!isUserControlledMode) {
    return (
      <PivotTableView
        {...pivotViewProps}
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
          dimensionLabelMap={effectiveVerboseMap}
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
        {...pivotViewProps}
        height={tableHeight}
        width={tableWidth}
      />
    </PivotInteractionLayout>
  );
}

export default PivotTableChart;
