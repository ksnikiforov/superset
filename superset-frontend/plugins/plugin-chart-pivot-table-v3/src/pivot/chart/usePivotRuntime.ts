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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { isEqual } from 'lodash';
import { t } from '@apache-superset/core/translation';
import {
  type DataRecordValue,
  type QueryFormColumn,
  type HandlerFunction,
  type JsonObject,
  type SetDataMaskHook,
} from '@superset-ui/core';
import { useSyncRef } from '../shared/useSyncRef';
import {
  type PivotAxis,
  type PivotRuntimeLayout,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { createLatestRequestLifecycle } from '../runtime/requestLifecycle';
import {
  buildSeamlessRuntimeSyncSnapshot,
  fetchAndMaterializeSeamlessRuntimeUpdate,
  isSameRuntimeLayout,
  type SeamlessRuntimeSyncSnapshot,
} from '../runtime/seamlessRuntimeUpdate';
import { type PivotFactStoreBatch } from '../runtime/ingestQueryResults';
import {
  createPivotFactStoreFromBatches,
  buildPivotFactQueryContextKey,
} from '../runtime/factStore';
import { materializeLoadedPivotTreeFromFactStore } from '../runtime/materializePivotTree';
import { buildInitialPivotUpdatePlan } from '../query/specs';
import { normalizeRuntimeLayout } from '../layout/resolveInteractionLayout';
import {
  applyDimensionFilterSelectionChange,
  buildClearSelectedFiltersUpdate,
  hasSelectedFilters,
  buildRuntimeSelectionSyncState,
} from '../filters';
import {
  applyDimensionDrag,
  applyValueDrag,
  removeDimensionFromLayout,
} from '../layout/interactionDrag';
import { getStableColumnKey } from '../../utils';

type RuntimeSelection = Record<string, DataRecordValue[]>;

const runtimeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : t('Failed to update data');
const sameMetricSet = (left: string[], right: string[]) =>
  isEqual([...left].sort(), [...right].sort());
type UsePivotRuntimeConfig = {
  dimensionKeys: string[];
  metricKeys: string[];
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  upstreamDashboardQueryContextSignature: string | null;
  runtimeLayout: PivotRuntimeLayout;
  initialCommittedLayout: PivotRuntimeLayout;
  dimensions: QueryFormColumn[];
  selectedFiltersFromFormData: RuntimeSelection;
  selectedFiltersFromOwnState: RuntimeSelection;
  selectedFiltersFromProps: RuntimeSelection;
  baseFormData: PivotTableQueryFormData;
  sourceMetrics: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric: PivotTableQueryFormData['measureLeavesByMetric'];
  isDashboardContext: boolean;
  mergeOwnState: (partial: JsonObject) => JsonObject;
  setControlValue?: HandlerFunction;
  setDataMask: SetDataMaskHook;
  syncControlValuesOnInteraction: boolean;
};

/** Owns draft edits, committed results, persistence acknowledgments, and refresh adoption. */
export const usePivotRuntime = (config: UsePivotRuntimeConfig) => {
  const {
    dimensionKeys,
    metricKeys,
    data,
    factBatches,
    upstreamDashboardQueryContextSignature,
    runtimeLayout,
    initialCommittedLayout: committedRuntimeLayoutProp,
    dimensions,
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
    selectedFiltersFromProps,
    baseFormData,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    isDashboardContext,
    mergeOwnState,
    setControlValue,
    setDataMask,
    syncControlValuesOnInteraction,
  } = config;
  const suppressStalePersistedFilterRestoreRef = useRef(false);
  const seamlessSyncRef = useRef<SeamlessRuntimeSyncSnapshot | null>(null);
  const upstreamSignature = buildPivotFactQueryContextKey({
    ...baseFormData,
    metrics: sourceMetrics,
  });
  const isDashboardRuntimeSync = isDashboardContext;
  const shouldPersistOwnState = !isDashboardRuntimeSync;
  const committedRuntimeLayoutInput =
    committedRuntimeLayoutProp ?? runtimeLayout;
  const pendingLayout = useRef<PivotRuntimeLayout | null>(null);
  const pendingSelection = useRef<RuntimeSelection | null>(null);
  const lastLocalSyncDashboardQueryContextRef = useRef<string | null>(null);
  const [committedFilters, setCommittedFilters] = useState<RuntimeSelection>(
    selectedFiltersFromProps,
  );
  const [uiSelectedFilters, setUiSelectedFilters] = useState<RuntimeSelection>(
    selectedFiltersFromProps,
  );

  const {
    selectedFiltersForTreeSync,
    persistedInteractionFilters,
    persistedSelectedFilters,
  } = useMemo(
    () =>
      buildRuntimeSelectionSyncState({
        dimensions,
        selectedFiltersFromFormData,
        selectedFiltersFromOwnState,
        selectedFiltersFromProps,
        committedFilters,
      }),
    [
      committedFilters,
      dimensions,
      selectedFiltersFromFormData,
      selectedFiltersFromOwnState,
      selectedFiltersFromProps,
    ],
  );

  const [committedRuntimeLayout, setCommittedRuntimeLayout] =
    useState<PivotRuntimeLayout>(committedRuntimeLayoutInput);
  const committedRuntimeLayoutRef = useRef(committedRuntimeLayout);
  useSyncRef(committedRuntimeLayoutRef, committedRuntimeLayout);

  const [uiRuntimeLayout, setUiRuntimeLayout] =
    useState<PivotRuntimeLayout>(runtimeLayout);
  const uiRuntimeLayoutRef = useRef(runtimeLayout);
  const updateUiRuntimeLayout = useCallback((layout: PivotRuntimeLayout) => {
    uiRuntimeLayoutRef.current = layout;
    setUiRuntimeLayout(layout);
  }, []);

  const commitRuntimeLayout = useCallback((layout: PivotRuntimeLayout) => {
    committedRuntimeLayoutRef.current = layout;
    setCommittedRuntimeLayout(current =>
      isSameRuntimeLayout(current, layout) ? current : layout,
    );
  }, []);

  const persistRuntimeState = useCallback(
    (
      layout: PivotRuntimeLayout,
      filters: RuntimeSelection,
      options: {
        commit?: boolean;
        syncControlValues?: boolean;
        syncOwnState?: boolean;
      } = {},
    ) => {
      if (!isSameRuntimeLayout(runtimeLayout, layout))
        pendingLayout.current = layout;
      if (isDashboardRuntimeSync) {
        lastLocalSyncDashboardQueryContextRef.current =
          upstreamDashboardQueryContextSignature;
      }
      if (!isEqual(selectedFiltersForTreeSync, filters))
        pendingSelection.current = filters;
      if (options.commit !== false) {
        commitRuntimeLayout(layout);
      }
      if (setControlValue && options.syncControlValues !== false) {
        setControlValue('pivotRuntimeLayout', layout);
        setControlValue('pivotSelectedFilters', filters);
      }
      if (shouldPersistOwnState && options.syncOwnState !== false) {
        const nextOwnState = mergeOwnState({
          pivotRuntimeLayout: layout,
          pivotSelectedFilters: filters,
        });
        setDataMask({ ownState: { ...nextOwnState } });
      }
    },
    [
      commitRuntimeLayout,
      runtimeLayout,
      selectedFiltersForTreeSync,
      isDashboardRuntimeSync,
      mergeOwnState,
      setControlValue,
      setDataMask,
      shouldPersistOwnState,
      upstreamDashboardQueryContextSignature,
    ],
  );

  useEffect(() => {
    const hasPendingRuntimeLayout = !isSameRuntimeLayout(
      uiRuntimeLayoutRef.current,
      committedRuntimeLayoutRef.current,
    );
    const parentAcknowledgedPendingLayout =
      pendingLayout.current !== null &&
      isSameRuntimeLayout(runtimeLayout, pendingLayout.current);
    if (parentAcknowledgedPendingLayout) pendingLayout.current = null;
    const shouldSyncLayout =
      pendingLayout.current === null &&
      (!hasPendingRuntimeLayout || parentAcknowledgedPendingLayout);
    if (shouldSyncLayout) commitRuntimeLayout(runtimeLayout);
    if (shouldSyncLayout) {
      updateUiRuntimeLayout(runtimeLayout);
    }
  }, [
    commitRuntimeLayout,
    isDashboardRuntimeSync,
    runtimeLayout,
    updateUiRuntimeLayout,
  ]);

  useEffect(() => {
    if (
      pendingSelection.current &&
      isEqual(selectedFiltersForTreeSync, pendingSelection.current)
    ) {
      pendingSelection.current = null;
    }
    if (
      !pendingSelection.current &&
      (!isEqual(persistedSelectedFilters, committedFilters) ||
        !isEqual(persistedSelectedFilters, uiSelectedFilters)) &&
      !hasSelectedFilters(uiSelectedFilters) &&
      !hasSelectedFilters(committedFilters) &&
      !(
        suppressStalePersistedFilterRestoreRef.current &&
        hasSelectedFilters(persistedSelectedFilters)
      )
    ) {
      setCommittedFilters(persistedSelectedFilters);
      setUiSelectedFilters(persistedSelectedFilters);
    }
  }, [
    committedFilters,
    selectedFiltersForTreeSync,
    persistedSelectedFilters,
    suppressStalePersistedFilterRestoreRef,
    uiSelectedFilters,
  ]);

  const commitUiRuntimeLayout = updateUiRuntimeLayout;
  const commitFilters = setCommittedFilters;
  const updateUiSelectedFilters = setUiSelectedFilters;
  const lastAttempt = useRef<{
    layout: PivotRuntimeLayout;
    filters: RuntimeSelection;
    options: {
      showLoading: boolean;
      showCornerLoading: boolean;
      syncControlValues: boolean;
      syncOwnState: boolean;
    };
  }>();
  const [loading, setLoading] = useState(false);
  const [cornerLoading, setCornerLoading] = useState(false);
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [committedTree, setCommittedTree] = useState<PivotTreeData>(data);
  const [committedFactBatches, setCommittedFactBatches] =
    useState<PivotFactStoreBatch[]>(factBatches);
  const committedFactBatchesRef = useRef<PivotFactStoreBatch[]>(factBatches);
  const hasMetrics = metricKeys.length > 0;
  const lastUpstreamQueryContextRef = useRef<string | null>(null);
  const lastSyncedPropsRef = useRef({ data, factBatches });
  const upstreamAdoptionEpochRef = useRef(0);
  const requestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );
  useEffect(
    () => () => {
      requestLifecycle.invalidate();
    },
    [requestLifecycle],
  );
  const materializeCommittedFacts = useCallback(
    (
      nextRuntimeLayout: PivotRuntimeLayout,
      selection: RuntimeSelection,
      nextFactBatches: PivotFactStoreBatch[],
    ) => {
      const { formData, layout } = buildInitialPivotUpdatePlan({
        formData: baseFormData,
        runtimeLayout: nextRuntimeLayout,
        selection,
        metricsOverride: sourceMetrics,
        measureLeavesByMetricOverride: sourceMeasureLeavesByMetric,
      });
      setCommittedTree(
        materializeLoadedPivotTreeFromFactStore({
          store: createPivotFactStoreFromBatches(nextFactBatches),
          layout,
          formData,
        }),
      );
    },
    [baseFormData, sourceMeasureLeavesByMetric, sourceMetrics],
  );
  const applySeamlessUpdate = useCallback(
    async (
      nextLayout: PivotRuntimeLayout,
      nextFilters: RuntimeSelection,
      {
        showLoading = true,
        showCornerLoading = showLoading,
        syncControlValues = true,
        syncOwnState = true,
      }: {
        showLoading?: boolean;
        showCornerLoading?: boolean;
        syncControlValues?: boolean;
        syncOwnState?: boolean;
      } = {},
    ) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      lastAttempt.current = {
        layout: normalized,
        filters: nextFilters,
        options: {
          showLoading,
          showCornerLoading,
          syncControlValues,
          syncOwnState,
        },
      };
      setLoading(showLoading);
      setCornerLoading(showCornerLoading);
      setError(undefined);
      const upstreamAdoptionEpoch = upstreamAdoptionEpochRef.current;
      const updateResult = await fetchAndMaterializeSeamlessRuntimeUpdate({
        requestLifecycle,
        baseFormData,
        sourceMetrics,
        sourceMeasureLeavesByMetric,
        runtimeLayout: normalized,
        selection: nextFilters,
        factBatches: committedFactBatchesRef.current,
      });
      if (
        updateResult.status === 'stale' ||
        upstreamAdoptionEpoch !== upstreamAdoptionEpochRef.current
      ) {
        return;
      }
      if (updateResult.status !== 'success') {
        setError(runtimeErrorMessage(updateResult.error));
        setLoading(false);
        setCornerLoading(false);
        return;
      }

      unstable_batchedUpdates(() => {
        setCommittedTree(updateResult.tree);
        committedFactBatchesRef.current = updateResult.factBatches;
        setCommittedFactBatches(updateResult.factBatches);
        commitUiRuntimeLayout(normalized);
        commitFilters(nextFilters);
        setWarnings(updateResult.warnings);
        persistRuntimeState(normalized, nextFilters, {
          syncControlValues,
          syncOwnState,
        });
      });
      seamlessSyncRef.current = buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout: normalized,
        selection: nextFilters,
        upstreamSignature,
      });
      setLoading(false);
      setCornerLoading(false);
    },
    [
      baseFormData,
      commitFilters,
      commitUiRuntimeLayout,
      dimensionKeys,
      metricKeys,
      persistRuntimeState,
      requestLifecycle,
      seamlessSyncRef,
      sourceMeasureLeavesByMetric,
      sourceMetrics,
      upstreamSignature,
    ],
  );

  const retrySeamlessUpdate = useCallback(() => {
    const attempt = lastAttempt.current;
    if (attempt)
      applySeamlessUpdate(attempt.layout, attempt.filters, attempt.options);
  }, [applySeamlessUpdate]);

  useEffect(() => {
    const incomingLayoutMatchesCommitted = isSameRuntimeLayout(
      runtimeLayout,
      committedRuntimeLayout,
    );
    const incomingLayoutMatchesUi = isSameRuntimeLayout(
      runtimeLayout,
      uiRuntimeLayoutRef.current,
    );
    const hasLocalSyncForCurrentDashboardQueryContext =
      upstreamDashboardQueryContextSignature !== null &&
      lastLocalSyncDashboardQueryContextRef.current ===
        upstreamDashboardQueryContextSignature;
    const incomingPlan = buildInitialPivotUpdatePlan({
      formData: baseFormData,
      runtimeLayout,
      selection: selectedFiltersForTreeSync,
      metricsOverride: sourceMetrics,
      measureLeavesByMetricOverride: sourceMeasureLeavesByMetric,
    });
    const incomingContext = buildPivotFactQueryContextKey(
      incomingPlan.formData,
    );
    const incomingFactsMatchSelection =
      factBatches.length > 0 &&
      factBatches.every(batch => batch.queryContextKey === incomingContext);
    if (
      loading ||
      hasLocalSyncForCurrentDashboardQueryContext ||
      (hasSelectedFilters(persistedInteractionFilters) &&
        !incomingFactsMatchSelection) ||
      (!incomingLayoutMatchesCommitted && !incomingLayoutMatchesUi) ||
      !isEqual(selectedFiltersForTreeSync, committedFilters) ||
      (lastSyncedPropsRef.current.data === data &&
        lastSyncedPropsRef.current.factBatches === factBatches)
    ) {
      return;
    }
    lastSyncedPropsRef.current = { data, factBatches };
    upstreamAdoptionEpochRef.current += 1;
    requestLifecycle.invalidate();
    committedFactBatchesRef.current = factBatches;
    setCommittedFactBatches(factBatches);
    setWarnings([]);
    setError(undefined);
    const { formData, layout } = buildInitialPivotUpdatePlan({
      formData: baseFormData,
      runtimeLayout,
      selection: selectedFiltersForTreeSync,
      metricsOverride: sourceMetrics,
      measureLeavesByMetricOverride: sourceMeasureLeavesByMetric,
    });
    const nextTree = materializeLoadedPivotTreeFromFactStore({
      store: createPivotFactStoreFromBatches(factBatches),
      layout,
      formData,
    });
    setCommittedTree(
      Object.keys(data.cells).length > 0 &&
        Object.keys(nextTree.cells).length === 0
        ? data
        : nextTree,
    );
  }, [
    baseFormData,
    data,
    factBatches,
    committedFilters,
    committedRuntimeLayout,
    lastLocalSyncDashboardQueryContextRef,
    loading,
    persistedInteractionFilters,
    requestLifecycle,
    runtimeLayout,
    selectedFiltersForTreeSync,
    sourceMeasureLeavesByMetric,
    sourceMetrics,
    upstreamDashboardQueryContextSignature,
    uiRuntimeLayoutRef,
  ]);

  const applyRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const runtimeLayout = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      const syncSnapshot = buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout,
        selection: uiSelectedFilters,
        upstreamSignature,
      });
      const previousLayout = uiRuntimeLayoutRef.current;
      setError(undefined);
      commitUiRuntimeLayout(runtimeLayout);
      if (
        isEqual(previousLayout.rows, runtimeLayout.rows) &&
        isEqual(previousLayout.cols, runtimeLayout.cols) &&
        isEqual(previousLayout.leafSelection, runtimeLayout.leafSelection) &&
        previousLayout.valuePlacement.axis ===
          runtimeLayout.valuePlacement.axis &&
        previousLayout.valuePlacement.index ===
          runtimeLayout.valuePlacement.index &&
        sameMetricSet(previousLayout.metrics, runtimeLayout.metrics)
      ) {
        persistRuntimeState(runtimeLayout, uiSelectedFilters, {
          syncControlValues: syncControlValuesOnInteraction,
          syncOwnState: false,
        });
        seamlessSyncRef.current = syncSnapshot;
        materializeCommittedFacts(
          runtimeLayout,
          uiSelectedFilters,
          committedFactBatchesRef.current,
        );
        return;
      }
      persistRuntimeState(runtimeLayout, uiSelectedFilters, {
        commit: false,
        syncControlValues: syncControlValuesOnInteraction,
        syncOwnState: false,
      });
      seamlessSyncRef.current = syncSnapshot;
      applySeamlessUpdate(runtimeLayout, uiSelectedFilters, {
        showLoading: false,
        showCornerLoading: true,
        syncControlValues: syncControlValuesOnInteraction,
        syncOwnState: false,
      });
    },
    [
      applySeamlessUpdate,
      commitUiRuntimeLayout,
      dimensionKeys,
      materializeCommittedFacts,
      metricKeys,
      persistRuntimeState,
      seamlessSyncRef,
      syncControlValuesOnInteraction,
      uiSelectedFilters,
      uiRuntimeLayoutRef,
      upstreamSignature,
    ],
  );

  const applyDimensionFilterChange = useCallback(
    (dimension: QueryFormColumn, values: DataRecordValue[]) => {
      const dimensionKey = getStableColumnKey(dimension);
      const { selection: nextSelected, suppressStalePersistedFilterRestore } =
        applyDimensionFilterSelectionChange({
          selection: uiSelectedFilters,
          dimensionKey,
          values,
        });
      suppressStalePersistedFilterRestoreRef.current =
        suppressStalePersistedFilterRestore;
      updateUiSelectedFilters(nextSelected);
      applySeamlessUpdate(uiRuntimeLayout, nextSelected, {
        syncControlValues: syncControlValuesOnInteraction,
        syncOwnState: false,
      });
    },
    [
      applySeamlessUpdate,
      suppressStalePersistedFilterRestoreRef,
      syncControlValuesOnInteraction,
      uiRuntimeLayout,
      uiSelectedFilters,
      updateUiSelectedFilters,
    ],
  );

  const clearAllFilters = useCallback(() => {
    const update = buildClearSelectedFiltersUpdate(uiSelectedFilters);
    if (!update) {
      return;
    }
    suppressStalePersistedFilterRestoreRef.current =
      update.suppressStalePersistedFilterRestore;
    const nextSelected = update.selection;
    updateUiSelectedFilters(nextSelected);
    applySeamlessUpdate(uiRuntimeLayout, nextSelected, {
      syncControlValues: syncControlValuesOnInteraction,
      syncOwnState: false,
    });
  }, [
    applySeamlessUpdate,
    suppressStalePersistedFilterRestoreRef,
    syncControlValuesOnInteraction,
    uiRuntimeLayout,
    uiSelectedFilters,
    updateUiSelectedFilters,
  ]);

  const commitFactBatchesForRender = useCallback(
    (nextFactBatches: PivotFactStoreBatch[]) => {
      committedFactBatchesRef.current = nextFactBatches;
      setCommittedFactBatches(nextFactBatches);
    },
    [],
  );

  const removeRuntimeDimension = useCallback(
    (dimensionKey: string) => {
      applyRuntimeLayoutChange(
        removeDimensionFromLayout(uiRuntimeLayoutRef.current, dimensionKey),
      );
    },
    [applyRuntimeLayoutChange, uiRuntimeLayoutRef],
  );

  const dropRuntimeDimension = useCallback(
    (
      dimensionKey: string,
      targetAxis: PivotAxis,
      targetChipIndex: number | undefined,
      insertBeforeValue: boolean,
      sourceAxis?: PivotAxis,
      sourceChipIndex?: number,
    ) => {
      const nextLayout = applyDimensionDrag(uiRuntimeLayoutRef.current, {
        dimensionKey,
        targetAxis,
        targetChipIndex,
        insertBeforeValue,
        sourceAxis,
        sourceChipIndex,
        metricsAvailable: hasMetrics,
      });
      applyRuntimeLayoutChange(nextLayout);
    },
    [applyRuntimeLayoutChange, hasMetrics, uiRuntimeLayoutRef],
  );

  const dropRuntimeValue = useCallback(
    (
      targetAxis: PivotAxis,
      targetChipIndex: number | undefined,
      sourceAxis: PivotAxis,
      sourceChipIndex?: number,
    ) => {
      const nextLayout = applyValueDrag(uiRuntimeLayoutRef.current, {
        targetAxis,
        targetChipIndex,
        sourceAxis,
        sourceChipIndex,
        metricsAvailable: hasMetrics,
      });
      applyRuntimeLayoutChange(nextLayout);
    },
    [applyRuntimeLayoutChange, hasMetrics, uiRuntimeLayoutRef],
  );

  useEffect(() => {
    const previousUpstream = lastUpstreamQueryContextRef.current;
    lastUpstreamQueryContextRef.current =
      upstreamDashboardQueryContextSignature;
    const upstreamChanged =
      previousUpstream !== null &&
      upstreamDashboardQueryContextSignature !== null &&
      previousUpstream !== upstreamDashboardQueryContextSignature;
    const restorePersisted =
      hasSelectedFilters(persistedInteractionFilters) &&
      !(
        suppressStalePersistedFilterRestoreRef.current &&
        !hasSelectedFilters(uiSelectedFilters)
      );
    if (!upstreamChanged && !restorePersisted) return;
    const selection = upstreamChanged
      ? uiSelectedFilters
      : persistedInteractionFilters;
    const snapshot = buildSeamlessRuntimeSyncSnapshot({
      runtimeLayout: uiRuntimeLayout,
      selection,
      upstreamSignature,
    });
    if (isEqual(seamlessSyncRef.current, snapshot)) return;
    // Reserve the snapshot before dispatch so prop acknowledgements cannot restart it.
    seamlessSyncRef.current = snapshot;
    applySeamlessUpdate(uiRuntimeLayout, selection, {
      syncControlValues: syncControlValuesOnInteraction,
      syncOwnState: false,
    });
  }, [
    applySeamlessUpdate,
    persistedInteractionFilters,
    uiSelectedFilters,
    syncControlValuesOnInteraction,
    uiRuntimeLayout,
    upstreamSignature,
    upstreamDashboardQueryContextSignature,
  ]);

  return {
    committedRuntimeLayout,
    committedFilters,
    uiRuntimeLayout,
    uiSelectedFilters,
    dataForRender: committedTree,
    factBatchesForRender: committedFactBatches,
    seamlessLoading: loading,
    seamlessCornerLoading: cornerLoading,
    seamlessWarnings: warnings,
    seamlessError: error,
    retrySeamlessUpdate,
    applyRuntimeLayoutChange,
    applyDimensionFilterChange,
    clearAllFilters,
    commitFactBatchesForRender,
    removeRuntimeDimension,
    dropRuntimeDimension,
    dropRuntimeValue,
  };
};
