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
  useMemo,
  useState,
  type ComponentProps,
  type MutableRefObject,
} from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { t, type DataRecordValue } from '@superset-ui/core';
import {
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
  type SeamlessRuntimeSyncSnapshot,
} from '../runtime/seamlessRuntimeUpdate';
import { type PivotFactStoreBatch } from '../runtime/ingestQueryResults';
import { normalizeRuntimeLayout } from '../layout/resolveInteractionLayout';
import { PivotTableView } from '../render/PivotTableView';

type RuntimeSelection = Record<string, DataRecordValue[]>;
type PivotViewProps = ComponentProps<typeof PivotTableView>;
export type PivotDisplaySnapshot = Pick<
  PivotViewProps,
  'renderModel' | 'tree' | 'expandedRows' | 'expandedCols'
>;

type UsePivotSeamlessRuntimeUpdateConfig = {
  dimensionKeys: string[];
  metricKeys: string[];
  baseFormData: PivotTableQueryFormData;
  sourceFormData: PivotTableQueryFormData;
  upstreamSignature: string;
  displaySnapshotRef: MutableRefObject<PivotDisplaySnapshot | null>;
  pendingSeamlessLayoutRef: MutableRefObject<PivotRuntimeLayout | null>;
  seamlessSyncRef: MutableRefObject<SeamlessRuntimeSyncSnapshot | null>;
  expandedRowsRef: MutableRefObject<Set<string>>;
  expandedColsRef: MutableRefObject<Set<string>>;
  pendingRowsRef: MutableRefObject<Set<string>>;
  pendingColsRef: MutableRefObject<Set<string>>;
  commitTree: (tree: PivotTreeData) => void;
  commitFactBatches: (batches: PivotFactStoreBatch[]) => void;
  commitFilters: (filters: RuntimeSelection) => void;
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
    baseFormData,
    sourceFormData,
    upstreamSignature,
    displaySnapshotRef,
    pendingSeamlessLayoutRef,
    seamlessSyncRef,
    expandedRowsRef,
    expandedColsRef,
    pendingRowsRef,
    pendingColsRef,
    commitTree,
    commitFactBatches,
    commitFilters,
    commitUiRuntimeLayout,
    persistRuntimeState,
  } = config;
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pendingDisplaySnapshot, setPendingDisplaySnapshot] =
    useState<PivotDisplaySnapshot | null>(null);
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
    setPendingDisplaySnapshot(null);
    pendingSeamlessLayoutRef.current = null;
  }, [materializationLifecycle, pendingSeamlessLayoutRef]);

  const clearPendingDisplaySnapshot = useCallback(() => {
    setPendingDisplaySnapshot(null);
  }, []);

  const applySeamlessUpdate = useCallback(
    async (nextLayout: PivotRuntimeLayout, nextFilters: RuntimeSelection) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      const displaySnapshot = displaySnapshotRef.current;
      if (displaySnapshot) {
        setPendingDisplaySnapshot(displaySnapshot);
      }
      const updateResult = await fetchAndMaterializeSeamlessRuntimeUpdate({
        requestLifecycle,
        materializationLifecycle,
        baseFormData,
        sourceFormData,
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
        pendingSeamlessLayoutRef.current = null;
        setLoading(false);
        return;
      }

      unstable_batchedUpdates(() => {
        commitTree(updateResult.tree);
        commitFactBatches(updateResult.factBatches);
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
      pendingSeamlessLayoutRef.current = null;
      setLoading(false);
    },
    [
      baseFormData,
      commitFactBatches,
      commitFilters,
      commitTree,
      commitUiRuntimeLayout,
      dimensionKeys,
      displaySnapshotRef,
      expandedColsRef,
      expandedRowsRef,
      materializationLifecycle,
      metricKeys,
      pendingColsRef,
      pendingRowsRef,
      pendingSeamlessLayoutRef,
      persistRuntimeState,
      requestLifecycle,
      seamlessSyncRef,
      sourceFormData,
      upstreamSignature,
    ],
  );

  return {
    seamlessLoading: loading,
    seamlessWarnings: warnings,
    seamlessError: error,
    pendingDisplaySnapshot,
    applySeamlessUpdate,
    clearPendingDisplaySnapshot,
    resetSeamlessRuntimeState,
  };
};
