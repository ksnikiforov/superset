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
import { usePivotRenderModel } from './pivot/chart/usePivotRenderModel';
import { PivotInteractionLayout } from './pivot/chart/PivotInteractionLayout';
import { PivotInteractionPanel } from './pivot/chart/PivotInteractionPanel';
import {
  buildRuntimeLayoutFromFormData,
  normalizeRuntimeLayout,
} from './pivot/layout/resolveInteractionLayout';
import { buildTreeDimensionFilterValues } from './pivot/filters';
import { useDimensionFilterValues } from './pivot/chart/useDimensionFilterValues';
import { buildInteractionChips } from './pivot/layout/interactionDrag';
import { getStableColumnKey } from './utils';
import { getMetricKeys } from './pivot/metrics';
import { shouldHideMetricHeaderOnAxis } from './pivot/metricsTotals';
import {
  isSameRuntimeLayout,
  buildSeamlessRuntimeUpstreamSignature,
} from './pivot/runtime/seamlessRuntimeUpdate';
import { usePivotRuntime } from './pivot/chart/usePivotRuntime';
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

  const ownStateRef = useRef<JsonObject>(ownState ?? {});
  useEffect(() => {
    ownStateRef.current = { ...ownStateRef.current, ...ownState };
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
      ? (formData.pivotRuntimeLayout ??
        (ownState?.pivotRuntimeLayout as PivotRuntimeLayout | undefined))
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
    uiSelectedFilters,
    uiRuntimeLayout,
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    isInitialExpansionHydrating,
    errorMessage,
    warnings,
    handleToggle,
    handleRetry,
    layoutResult,
    appliedLayoutFormData,
    cornerLoading,
    applyRuntimeLayoutChange,
    applyDimensionFilterChange,
    clearAllFilters,
    removeRuntimeDimension,
    dropRuntimeDimension,
    dropRuntimeValue,
  } = usePivotRuntime({
    dimensionKeys,
    metricKeys,
    data,
    factBatches,
    upstreamDashboardQueryContextSignature,
    runtimeLayout,
    initialCommittedLayout: appliedRuntimeLayout,
    dimensions: dimensionList,
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
    selectedFiltersFromProps,
    baseFormData: fetchFormDataBaseWithFormatters,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    isDashboardContext: isDashboardRuntimeSync,
    mergeOwnState,
    setControlValue,
    setDataMask,
    persistedExpansionState:
      appliedFormData.pivotExpansionState ?? ownState?.pivotExpansionState,
    shouldPersistExpansionState: persistExpansionState,
  });

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

  const layoutRowDimensions = layoutResult.layout.pivotProgram.rowDimensions;
  const rowAxisLabels = useMemo(() => {
    const labels = layoutRowDimensions.map(dimension => {
      const baseLabel = getColumnLabel(dimension);
      const stableKey = getStableColumnKey(dimension);
      return (
        effectiveVerboseMap[stableKey] ??
        (typeof dimension === 'string'
          ? (effectiveVerboseMap[dimension] ?? baseLabel)
          : baseLabel)
      );
    });
    const program = layoutResult.layout.pivotProgram;
    const isLeafTierVisible =
      layoutResult.layout.measureHierarchy.leafTierVisibility === 'visible';
    if (
      program.valueAxis === 'row' &&
      program.metricKeys.length > 0 &&
      !shouldHideMetricHeaderOnAxis({ program, axis: 'row', isLeafTierVisible })
    ) {
      labels.splice(
        program.metricInsertIndex,
        0,
        t('Metric'),
        ...(isLeafTierVisible ? [t('Value')] : []),
      );
    }
    return labels;
  }, [
    effectiveVerboseMap,
    layoutRowDimensions,
    layoutResult.layout.pivotProgram,
    layoutResult.layout.measureHierarchy.leafTierVisibility,
  ]);
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
    cornerLoading,
    formData,
    appliedLayoutFormData,
    layout: layoutResult,
    renderModelResult,
    emitCrossFilters,
    selectedFilters: selectedFiltersFromProps,
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
