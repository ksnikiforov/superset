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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { isEqual } from 'lodash';
import {
  t,
  type DataRecordValue,
  type QueryFormColumn,
} from '@superset-ui/core';
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
import { createPivotFactStoreFromBatches } from '../runtime/factStore';
import { materializeLoadedPivotTreeFromFactStore } from '../runtime/materializePivotTree';
import { buildInitialPivotUpdatePlan } from '../query/specs';
import { normalizeRuntimeLayout } from '../layout/resolveInteractionLayout';
import {
  applyDimensionFilterSelectionChange,
  buildClearSelectedFiltersUpdate,
  hasSelectedFilters,
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
type UsePivotSeamlessRuntimeUpdateConfig = {
  dimensionKeys: string[];
  metricKeys: string[];
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  upstreamDashboardQueryContextSignature: string | null;
  persistedInteractionFilters: RuntimeSelection;
  selectedFiltersForTreeSync: RuntimeSelection;
  runtimeLayout: PivotRuntimeLayout;
  committedRuntimeLayout: PivotRuntimeLayout;
  committedFilters: RuntimeSelection;
  uiSelectedFilters: RuntimeSelection;
  uiRuntimeLayout: PivotRuntimeLayout;
  uiRuntimeLayoutRef: MutableRefObject<PivotRuntimeLayout>;
  baseFormData: PivotTableQueryFormData;
  sourceMetrics: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric: PivotTableQueryFormData['measureLeavesByMetric'];
  upstreamSignature: string;
  seamlessSyncRef: MutableRefObject<SeamlessRuntimeSyncSnapshot | null>;
  commitFilters: (filters: RuntimeSelection) => void;
  updateUiSelectedFilters: (filters: RuntimeSelection) => void;
  lastLocalSyncDashboardQueryContextRef: MutableRefObject<string | null>;
  suppressStalePersistedFilterRestoreRef: MutableRefObject<boolean>;
  commitUiRuntimeLayout: (layout: PivotRuntimeLayout) => void;
  persistRuntimeState: (
    layout: PivotRuntimeLayout,
    filters: RuntimeSelection,
    options?: { commit?: boolean },
  ) => void;
};

export const usePivotSeamlessRuntimeUpdate = (
  config: UsePivotSeamlessRuntimeUpdateConfig,
) => {
  const {
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
    baseFormData,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    upstreamSignature,
    seamlessSyncRef,
    commitFilters,
    updateUiSelectedFilters,
    lastLocalSyncDashboardQueryContextRef,
    suppressStalePersistedFilterRestoreRef,
    commitUiRuntimeLayout,
    persistRuntimeState,
  } = config;
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [committedTree, setCommittedTree] = useState<PivotTreeData>(data);
  const [committedFactBatches, setCommittedFactBatches] =
    useState<PivotFactStoreBatch[]>(factBatches);
  const committedFactBatchesRef = useRef<PivotFactStoreBatch[]>(factBatches);
  const hasMetrics = metricKeys.length > 0;
  const lastUpstreamQueryContextRef = useRef<string | null>(null);
  const lastSyncedPropsRef = useRef({ data, factBatches });
  const requestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
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
      { showLoading = true }: { showLoading?: boolean } = {},
    ) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      setLoading(showLoading);
      setError(undefined);
      const updateResult = await fetchAndMaterializeSeamlessRuntimeUpdate({
        requestLifecycle,
        baseFormData,
        sourceMetrics,
        sourceMeasureLeavesByMetric,
        runtimeLayout: normalized,
        selection: nextFilters,
        factBatches: committedFactBatchesRef.current,
      });
      if (updateResult.status === 'stale') {
        return;
      }
      if (updateResult.status !== 'success') {
        setError(runtimeErrorMessage(updateResult.error));
        setLoading(false);
        return;
      }

      unstable_batchedUpdates(() => {
        setCommittedTree(updateResult.tree);
        committedFactBatchesRef.current = updateResult.factBatches;
        setCommittedFactBatches(updateResult.factBatches);
        commitUiRuntimeLayout(normalized);
        commitFilters(nextFilters);
        setWarnings(updateResult.warnings);
        persistRuntimeState(normalized, nextFilters);
      });
      seamlessSyncRef.current = buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout: normalized,
        selection: nextFilters,
        upstreamSignature,
      });
      setLoading(false);
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

  useEffect(() => {
    const hasLocalSyncForCurrentDashboardQueryContext =
      upstreamDashboardQueryContextSignature !== null &&
      lastLocalSyncDashboardQueryContextRef.current ===
        upstreamDashboardQueryContextSignature;
    if (
      loading ||
      hasLocalSyncForCurrentDashboardQueryContext ||
      hasSelectedFilters(persistedInteractionFilters) ||
      !isSameRuntimeLayout(runtimeLayout, committedRuntimeLayout) ||
      !isEqual(selectedFiltersForTreeSync, committedFilters) ||
      (lastSyncedPropsRef.current.data === data &&
        lastSyncedPropsRef.current.factBatches === factBatches)
    ) {
      return;
    }
    lastSyncedPropsRef.current = { data, factBatches };
    requestLifecycle.invalidate();
    committedFactBatchesRef.current = factBatches;
    setCommittedFactBatches(factBatches);
    setWarnings([]);
    setError(undefined);
    materializeCommittedFacts(
      runtimeLayout,
      selectedFiltersForTreeSync,
      factBatches,
    );
  }, [
    data,
    factBatches,
    committedFilters,
    committedRuntimeLayout,
    lastLocalSyncDashboardQueryContextRef,
    loading,
    materializeCommittedFacts,
    persistedInteractionFilters,
    requestLifecycle,
    runtimeLayout,
    selectedFiltersForTreeSync,
    upstreamDashboardQueryContextSignature,
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
        persistRuntimeState(runtimeLayout, uiSelectedFilters);
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
      });
      seamlessSyncRef.current = syncSnapshot;
      applySeamlessUpdate(runtimeLayout, uiSelectedFilters, {
        showLoading: false,
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
      applySeamlessUpdate(uiRuntimeLayout, nextSelected);
    },
    [
      applySeamlessUpdate,
      suppressStalePersistedFilterRestoreRef,
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
    applySeamlessUpdate(uiRuntimeLayout, nextSelected);
  }, [
    applySeamlessUpdate,
    suppressStalePersistedFilterRestoreRef,
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
    const previousUpstreamState = lastUpstreamQueryContextRef.current;
    lastUpstreamQueryContextRef.current =
      upstreamDashboardQueryContextSignature;
    const shouldApplyStaleUpdate =
      upstreamDashboardQueryContextSignature !== null &&
      previousUpstreamState !== null &&
      previousUpstreamState !== upstreamDashboardQueryContextSignature;
    if (shouldApplyStaleUpdate) {
      applySeamlessUpdate(uiRuntimeLayout, uiSelectedFilters);
    }
  }, [
    applySeamlessUpdate,
    uiRuntimeLayout,
    uiSelectedFilters,
    upstreamDashboardQueryContextSignature,
  ]);

  useEffect(() => {
    if (!hasSelectedFilters(persistedInteractionFilters)) {
      return;
    }
    const syncSnapshot = buildSeamlessRuntimeSyncSnapshot({
      runtimeLayout: uiRuntimeLayout,
      selection: persistedInteractionFilters,
      upstreamSignature,
    });
    if (
      seamlessSyncRef.current?.filtersSignature ===
        syncSnapshot.filtersSignature &&
      seamlessSyncRef.current.layoutSignature ===
        syncSnapshot.layoutSignature &&
      seamlessSyncRef.current.upstreamSignature ===
        syncSnapshot.upstreamSignature
    ) {
      return;
    }
    applySeamlessUpdate(uiRuntimeLayout, persistedInteractionFilters);
  }, [
    applySeamlessUpdate,
    persistedInteractionFilters,
    seamlessSyncRef,
    uiRuntimeLayout,
    upstreamSignature,
  ]);

  return {
    committedTree,
    committedFactBatches,
    dataForRender: committedTree,
    factBatchesForRender: committedFactBatches,
    seamlessLoading: loading,
    seamlessWarnings: warnings,
    seamlessError: error,
    applyRuntimeLayoutChange,
    applyDimensionFilterChange,
    clearAllFilters,
    commitFactBatchesForRender,
    removeRuntimeDimension,
    dropRuntimeDimension,
    dropRuntimeValue,
  };
};
