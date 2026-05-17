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
  prepareSeamlessRuntimeUpdateEffect,
  prepareSeamlessRuntimeLayoutChange,
  type SeamlessRuntimeSyncSnapshot,
} from '../runtime/seamlessRuntimeUpdate';
import { type PivotFactStoreBatch } from '../runtime/ingestQueryResults';
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
import { isSameRuntimeLayout } from '../runtime/coverage';

type RuntimeSelection = Record<string, DataRecordValue[]>;

type UsePivotSeamlessRuntimeUpdateConfig = {
  dimensionKeys: string[];
  metricKeys: string[];
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  isUserControlled: boolean;
  isDashboardRuntimeSync: boolean;
  hasMetrics: boolean;
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
  sourceFormData: PivotTableQueryFormData;
  sourceMetrics?: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric?: PivotTableQueryFormData['measureLeavesByMetric'];
  upstreamSignature: string;
  seamlessSyncRef: MutableRefObject<SeamlessRuntimeSyncSnapshot | null>;
  expandedRowsRef: MutableRefObject<Set<string>>;
  expandedColsRef: MutableRefObject<Set<string>>;
  pendingRowsRef: MutableRefObject<Set<string>>;
  pendingColsRef: MutableRefObject<Set<string>>;
  commitFilters: (filters: RuntimeSelection) => void;
  updateUiSelectedFilters: (filters: RuntimeSelection) => void;
  lastLocalSyncDashboardQueryContextRef: MutableRefObject<string | null>;
  suppressStalePersistedFilterRestoreRef: MutableRefObject<boolean>;
  commitUiRuntimeLayout: (layout: PivotRuntimeLayout) => void;
  persistRuntimeState: (
    layout: PivotRuntimeLayout,
    filters: RuntimeSelection,
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
    isUserControlled,
    isDashboardRuntimeSync,
    hasMetrics,
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
    sourceFormData,
    sourceMetrics,
    sourceMeasureLeavesByMetric,
    upstreamSignature,
    seamlessSyncRef,
    expandedRowsRef,
    expandedColsRef,
    pendingRowsRef,
    pendingColsRef,
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
  const lastUpstreamQueryContextRef = useRef<{
    data: PivotTreeData;
    signature: string;
  } | null>(null);
  const requestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );
  const materializationLifecycle = useMemo(
    () => createLatestRequestLifecycle(),
    [],
  );

  const resetSeamlessRuntimeState = useCallback(() => {
    materializationLifecycle.invalidate();
    setWarnings([]);
    setError(undefined);
    setLoading(false);
  }, [materializationLifecycle]);

  useEffect(() => {
    // Ignore stale upstream updates while a local interaction update is still
    // pending.
    const hasLocalSyncForCurrentDashboardQueryContext =
      isDashboardRuntimeSync &&
      upstreamDashboardQueryContextSignature !== null &&
      lastLocalSyncDashboardQueryContextRef.current ===
        upstreamDashboardQueryContextSignature;
    const shouldSyncCommittedTreeFromProps =
      !isUserControlled ||
      (!hasLocalSyncForCurrentDashboardQueryContext &&
        !hasSelectedFilters(persistedInteractionFilters) &&
        isSameRuntimeLayout(runtimeLayout, committedRuntimeLayout) &&
        isEqual(selectedFiltersForTreeSync, committedFilters));
    if (!shouldSyncCommittedTreeFromProps) {
      return;
    }
    setCommittedTree(data);
    setCommittedFactBatches(factBatches);
    resetSeamlessRuntimeState();
  }, [
    data,
    factBatches,
    committedFilters,
    committedRuntimeLayout,
    isDashboardRuntimeSync,
    isUserControlled,
    lastLocalSyncDashboardQueryContextRef,
    persistedInteractionFilters,
    resetSeamlessRuntimeState,
    runtimeLayout,
    selectedFiltersForTreeSync,
    upstreamDashboardQueryContextSignature,
  ]);

  const applySeamlessUpdate = useCallback(
    async (nextLayout: PivotRuntimeLayout, nextFilters: RuntimeSelection) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      const updateResult = await fetchAndMaterializeSeamlessRuntimeUpdate({
        requestLifecycle,
        materializationLifecycle,
        baseFormData,
        sourceFormData,
        sourceMetrics,
        sourceMeasureLeavesByMetric,
        runtimeLayout: normalized,
        selection: nextFilters,
        expandedRows: expandedRowsRef.current,
        expandedCols: expandedColsRef.current,
        pendingRows: pendingRowsRef.current,
        pendingCols: pendingColsRef.current,
        fetchData: params => supersetChartDataClient.fetch(params),
        onFetchStart: () => {
          setLoading(true);
          setError(undefined);
        },
        onError: nextError => {
          setError(
            nextError instanceof Error
              ? nextError.message
              : t('Failed to update data'),
          );
        },
      });
      if (updateResult.status === 'stale') {
        return;
      }
      if (updateResult.status !== 'success') {
        setLoading(false);
        return;
      }

      unstable_batchedUpdates(() => {
        setCommittedTree(updateResult.tree);
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
      expandedColsRef,
      expandedRowsRef,
      materializationLifecycle,
      metricKeys,
      pendingColsRef,
      pendingRowsRef,
      persistRuntimeState,
      requestLifecycle,
      seamlessSyncRef,
      sourceFormData,
      sourceMeasureLeavesByMetric,
      sourceMetrics,
      upstreamSignature,
    ],
  );

  const applyRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const action = prepareSeamlessRuntimeLayoutChange({
        nextLayout,
        dimensionKeys,
        metricKeys,
        factBatches: committedFactBatches,
        baseFormData,
        sourceFormData,
        sourceMetrics,
        sourceMeasureLeavesByMetric,
        selection: uiSelectedFilters,
        upstreamSignature,
      });
      if (action.kind === 'fetch') {
        commitUiRuntimeLayout(action.runtimeLayout);
        applySeamlessUpdate(action.runtimeLayout, uiSelectedFilters);
        return;
      }
      commitUiRuntimeLayout(action.runtimeLayout);
      persistRuntimeState(action.runtimeLayout, uiSelectedFilters);
      seamlessSyncRef.current = action.syncSnapshot;
    },
    [
      applySeamlessUpdate,
      baseFormData,
      commitUiRuntimeLayout,
      committedFactBatches,
      dimensionKeys,
      metricKeys,
      persistRuntimeState,
      seamlessSyncRef,
      sourceFormData,
      sourceMeasureLeavesByMetric,
      sourceMetrics,
      uiSelectedFilters,
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
    const updatePlan = prepareSeamlessRuntimeUpdateEffect({
      upstreamDashboardQueryContextSignature,
      previousUpstreamState: lastUpstreamQueryContextRef.current,
      data,
      isUserControlled,
      persistedInteractionFilters,
      committedFilters,
      uiSelectedFilters,
      lastSync: seamlessSyncRef.current,
      uiRuntimeLayout,
      upstreamSeamlessSignature: upstreamSignature,
    });
    lastUpstreamQueryContextRef.current = updatePlan.nextUpstreamState;
    updatePlan.updates.forEach(({ runtimeLayout: nextLayout, selection }) => {
      applySeamlessUpdate(nextLayout, selection);
    });
  }, [
    applySeamlessUpdate,
    committedFilters,
    data,
    isUserControlled,
    persistedInteractionFilters,
    seamlessSyncRef,
    uiRuntimeLayout,
    uiSelectedFilters,
    upstreamDashboardQueryContextSignature,
    upstreamSignature,
  ]);

  return {
    committedTree,
    committedFactBatches,
    dataForRender: isUserControlled ? committedTree : data,
    factBatchesForRender: isUserControlled ? committedFactBatches : factBatches,
    seamlessLoading: loading,
    seamlessWarnings: warnings,
    seamlessError: error,
    applyRuntimeLayoutChange,
    applyDimensionFilterChange,
    clearAllFilters,
    removeRuntimeDimension,
    dropRuntimeDimension,
    dropRuntimeValue,
  };
};
