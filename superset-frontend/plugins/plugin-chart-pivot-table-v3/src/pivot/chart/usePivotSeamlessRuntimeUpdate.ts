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
import {
  createLatestRequestLifecycle,
  yieldToMainThread,
} from '../runtime/requestLifecycle';
import {
  buildSeamlessRuntimeSyncSnapshot,
  fetchAndMaterializeSeamlessRuntimeUpdate,
  isSameRuntimeLayout,
  materializeSeamlessRuntimeFactBatches,
  prepareSeamlessRuntimeUpdateEffect,
  prepareSeamlessRuntimeLayoutChange,
  shouldFetchSeamlessRuntimeCoverage,
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

type RuntimeSelection = Record<string, DataRecordValue[]>;

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
  const lastUpstreamQueryContextRef = useRef<{
    data: PivotTreeData;
    signature: string;
  } | null>(
    upstreamDashboardQueryContextSignature
      ? {
          data,
          signature: upstreamDashboardQueryContextSignature,
        }
      : null,
  );
  const lastAppliedDashboardQueryContextRef = useRef(
    upstreamDashboardQueryContextSignature,
  );
  const lastSyncedPropsRef = useRef({ data, factBatches });
  const requestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );
  const materializeCommittedTree = useCallback(
    (
      nextRuntimeLayout: PivotRuntimeLayout,
      selection: RuntimeSelection,
      nextFactBatches: PivotFactStoreBatch[],
    ) => {
      const requestScope = requestLifecycle.beginScope();
      materializeSeamlessRuntimeFactBatches({
        baseFormData,
        sourceMetrics,
        sourceMeasureLeavesByMetric,
        runtimeLayout: nextRuntimeLayout,
        selection,
        factBatches: nextFactBatches,
        shouldContinue: requestScope.isCurrent,
        yieldToMain: yieldToMainThread,
      })
        .then(tree => {
          if (requestScope.isCurrent()) {
            setCommittedTree(tree);
          }
        })
        .catch(error => {
          if (requestScope.isCurrent()) {
            setError(
              error instanceof Error
                ? error.message
                : t('Failed to update data'),
            );
          }
        });
    },
    [
      baseFormData,
      requestLifecycle,
      sourceMeasureLeavesByMetric,
      sourceMetrics,
    ],
  );

  useEffect(() => {
    // Ignore stale upstream updates while a local interaction update is still
    // pending.
    const hasLocalSyncForCurrentDashboardQueryContext =
      upstreamDashboardQueryContextSignature !== null &&
      lastLocalSyncDashboardQueryContextRef.current ===
        upstreamDashboardQueryContextSignature;
    const shouldSyncCommittedTreeFromProps =
      !loading &&
      !hasLocalSyncForCurrentDashboardQueryContext &&
      !hasSelectedFilters(persistedInteractionFilters) &&
      isSameRuntimeLayout(runtimeLayout, committedRuntimeLayout) &&
      isEqual(selectedFiltersForTreeSync, committedFilters);
    if (!shouldSyncCommittedTreeFromProps) {
      return;
    }
    if (
      lastSyncedPropsRef.current.data === data &&
      lastSyncedPropsRef.current.factBatches === factBatches
    ) {
      return;
    }
    lastSyncedPropsRef.current = { data, factBatches };
    committedFactBatchesRef.current = factBatches;
    setCommittedFactBatches(factBatches);
    setWarnings([]);
    setError(undefined);
    setLoading(false);
    materializeCommittedTree(
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
    materializeCommittedTree,
    persistedInteractionFilters,
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
      setLoading(true);
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
        setError(
          updateResult.error instanceof Error
            ? updateResult.error.message
            : t('Failed to update data'),
        );
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

  const applyRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const action = prepareSeamlessRuntimeLayoutChange({
        nextLayout,
        dimensionKeys,
        metricKeys,
        selection: uiSelectedFilters,
        upstreamSignature,
      });
      if (
        shouldFetchSeamlessRuntimeCoverage({
          baseFormData,
          sourceMetrics,
          sourceMeasureLeavesByMetric,
          runtimeLayout: action.runtimeLayout,
          selection: uiSelectedFilters,
          factBatches: committedFactBatchesRef.current,
        })
      ) {
        setLoading(true);
        setError(undefined);
        commitUiRuntimeLayout(action.runtimeLayout);
        persistRuntimeState(action.runtimeLayout, uiSelectedFilters, {
          commit: false,
        });
        applySeamlessUpdate(action.runtimeLayout, uiSelectedFilters);
        return;
      }
      setLoading(false);
      setError(undefined);
      commitUiRuntimeLayout(action.runtimeLayout);
      persistRuntimeState(action.runtimeLayout, uiSelectedFilters);
      seamlessSyncRef.current = action.syncSnapshot;
      materializeCommittedTree(
        action.runtimeLayout,
        uiSelectedFilters,
        committedFactBatchesRef.current,
      );
    },
    [
      applySeamlessUpdate,
      commitUiRuntimeLayout,
      dimensionKeys,
      metricKeys,
      materializeCommittedTree,
      persistRuntimeState,
      seamlessSyncRef,
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
    const updatePlan = prepareSeamlessRuntimeUpdateEffect({
      upstreamDashboardQueryContextSignature,
      previousUpstreamState: lastUpstreamQueryContextRef.current,
      data,
      persistedInteractionFilters,
      committedFilters,
      uiSelectedFilters,
      lastSync: seamlessSyncRef.current,
      uiRuntimeLayout,
      upstreamSeamlessSignature: upstreamSignature,
    });
    lastUpstreamQueryContextRef.current = updatePlan.nextUpstreamState;
    if (updatePlan.update) {
      const { runtimeLayout: nextLayout, selection } = updatePlan.update;
      applySeamlessUpdate(nextLayout, selection);
    }
  }, [
    applySeamlessUpdate,
    committedFilters,
    data,
    persistedInteractionFilters,
    seamlessSyncRef,
    uiRuntimeLayout,
    uiSelectedFilters,
    upstreamDashboardQueryContextSignature,
    upstreamSignature,
  ]);

  useEffect(() => {
    if (
      upstreamDashboardQueryContextSignature === null ||
      lastAppliedDashboardQueryContextRef.current ===
        upstreamDashboardQueryContextSignature
    ) {
      return;
    }
    lastAppliedDashboardQueryContextRef.current =
      upstreamDashboardQueryContextSignature;
    applySeamlessUpdate(uiRuntimeLayout, uiSelectedFilters);
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
