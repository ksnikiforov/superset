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
  const resolvedVerboseMap = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        Object.entries(formData.verboseMap ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    [formData.verboseMap],
  );
  const resolvedDateFormatters = useMemo(
    () => formData.dateFormatters ?? {},
    [formData.dateFormatters],
  );
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
    errorMessage,
    warnings,
    seamlessLoading,
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
        {...pivotViewProps}
        height={tableHeight}
        width={tableWidth}
      />
    </PivotInteractionLayout>
  );
}

export default PivotTableChart;
