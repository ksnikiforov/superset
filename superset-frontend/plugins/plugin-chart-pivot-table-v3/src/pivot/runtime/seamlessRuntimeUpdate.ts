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
import { type DataRecordValue } from '@superset-ui/core';
import { isEqual } from 'lodash';
import {
  type PivotRuntimeLayout,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import { METRICS_PLACEHOLDER } from '../core/tokens';
import { parsePath } from '../core/path';
import { hasSelectedFilters } from '../filters';
import { stableStringify } from '../shared/stableStringify';
import { type ChartDataQueryResult } from '../data/ChartDataClient';
import { type PlannedQuerySpec } from '../query/specs';
import { normalizeFormDataExtraFilters } from '../query/normalizeExtraFormData';
import { buildInitialPivotUpdatePlan } from '../update/initialUpdatePlan';
import { normalizeRuntimeLayout } from '../layout/resolveInteractionLayout';
import {
  buildInitialRuntimeFromSpecResultsAsync,
  type PivotFactStoreBatch,
} from './ingestQueryResults';
import { insertValuesPlaceholder } from './compilePivotProgram';
import { factBatchesCoverRuntimeLayout } from './coverage';
import {
  executeLatestRequest,
  executeScheduledLatestRequest,
  type LatestRequestLifecycle,
  yieldToMainThread,
} from './requestLifecycle';

const SEAMLESS_REQUEST_GROUP = 'pivot-v3-seamless';
const SEAMLESS_MATERIALIZATION_GROUP = 'pivot-v3-seamless-materialize';

type RuntimeSelection = Record<string, DataRecordValue[]>;

const collectWarnings = (results: ChartDataQueryResult[]): ChartDataWarning[] =>
  results.flatMap(result => result.warnings ?? []);

export type SeamlessRuntimeSyncSnapshot = {
  filtersSignature: string | null;
  layoutSignature: string;
  upstreamSignature: string;
};

type SeamlessRuntimeUpstreamState = {
  data: PivotTreeData;
  signature: string;
} | null;

export type SeamlessRuntimeReuseSnapshot = {
  runtimeLayout: PivotRuntimeLayout;
  factBatches: PivotFactStoreBatch[];
};

const selectionSignature = (selection: PivotRuntimeLayout['leafSelection']) =>
  stableStringify(selection ?? {});

export const isSameRuntimeLayout = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
) =>
  isEqual(prev.rows, next.rows) &&
  isEqual(prev.cols, next.cols) &&
  isEqual(prev.metrics, next.metrics) &&
  isEqual(prev.leafOrder ?? [], next.leafOrder ?? []) &&
  selectionSignature(prev.leafSelection) ===
    selectionSignature(next.leafSelection) &&
  prev.valuePlacement.axis === next.valuePlacement.axis &&
  prev.valuePlacement.index === next.valuePlacement.index;

export const shouldFetchRuntimeLayout = ({
  reuseSnapshot,
  nextLayout,
}: {
  reuseSnapshot: SeamlessRuntimeReuseSnapshot;
  nextLayout: PivotRuntimeLayout;
}) => {
  const reusableLayout = reuseSnapshot.runtimeLayout;
  if (
    selectionSignature(reusableLayout.leafSelection) !==
      selectionSignature(nextLayout.leafSelection) ||
    reusableLayout.valuePlacement.axis !== nextLayout.valuePlacement.axis ||
    reusableLayout.valuePlacement.index !== nextLayout.valuePlacement.index
  ) {
    return true;
  }
  return !factBatchesCoverRuntimeLayout(reuseSnapshot.factBatches, nextLayout);
};

export const buildSeamlessRuntimeSyncSnapshot = ({
  runtimeLayout,
  selection,
  upstreamSignature,
}: {
  runtimeLayout: PivotRuntimeLayout;
  selection: RuntimeSelection;
  upstreamSignature: string;
}): SeamlessRuntimeSyncSnapshot => ({
  filtersSignature: hasSelectedFilters(selection)
    ? stableStringify(selection)
    : null,
  layoutSignature: stableStringify(runtimeLayout),
  upstreamSignature,
});

export const buildSeamlessRuntimeUpstreamSignature = (
  queryFormData?: PivotTableQueryFormData | null,
) => {
  if (!queryFormData) {
    return null;
  }
  const normalizedQueryFormData = normalizeFormDataExtraFilters(queryFormData);
  return stableStringify({
    adhoc_filters: normalizedQueryFormData.adhoc_filters ?? [],
    extra_form_data: normalizedQueryFormData.extra_form_data ?? null,
    extras: normalizedQueryFormData.extras ?? null,
    granularity_sqla: normalizedQueryFormData.granularity_sqla ?? null,
    time_grain_sqla: normalizedQueryFormData.time_grain_sqla ?? null,
    time_offsets: normalizedQueryFormData.time_offsets ?? [],
    time_range: normalizedQueryFormData.time_range ?? null,
  });
};

export const prepareSeamlessRuntimeUpdateEffect = ({
  upstreamDashboardQueryContextSignature,
  previousUpstreamState,
  data,
  isUserControlled,
  persistedInteractionFilters,
  committedFilters,
  uiSelectedFilters,
  lastSync,
  uiRuntimeLayout,
  upstreamSeamlessSignature,
}: {
  upstreamDashboardQueryContextSignature: string | null;
  previousUpstreamState: SeamlessRuntimeUpstreamState;
  data: PivotTreeData;
  isUserControlled: boolean;
  persistedInteractionFilters: RuntimeSelection;
  committedFilters: RuntimeSelection;
  uiSelectedFilters: RuntimeSelection;
  lastSync: SeamlessRuntimeSyncSnapshot | null;
  uiRuntimeLayout: PivotRuntimeLayout;
  upstreamSeamlessSignature: string;
}) => {
  const nextUpstreamState = upstreamDashboardQueryContextSignature
    ? {
        data,
        signature: upstreamDashboardQueryContextSignature,
      }
    : null;
  const shouldApplyStaleUpdate =
    upstreamDashboardQueryContextSignature !== null &&
    previousUpstreamState !== null &&
    previousUpstreamState.signature !==
      upstreamDashboardQueryContextSignature &&
    previousUpstreamState.data === data;
  const nextPersistedFilterSync = buildSeamlessRuntimeSyncSnapshot({
    runtimeLayout: uiRuntimeLayout,
    selection: persistedInteractionFilters,
    upstreamSignature: upstreamSeamlessSignature,
  });
  const hasMatchingPersistedFilterSync =
    lastSync?.filtersSignature === nextPersistedFilterSync.filtersSignature &&
    lastSync.layoutSignature === nextPersistedFilterSync.layoutSignature &&
    lastSync.upstreamSignature === nextPersistedFilterSync.upstreamSignature;
  const shouldApplyPersistedFilterUpdate =
    isUserControlled &&
    hasSelectedFilters(persistedInteractionFilters) &&
    isEqual(committedFilters, persistedInteractionFilters) &&
    isEqual(uiSelectedFilters, persistedInteractionFilters) &&
    !hasMatchingPersistedFilterSync;
  const updates: Array<{
    runtimeLayout: PivotRuntimeLayout;
    selection: RuntimeSelection;
  }> = [];
  if (shouldApplyStaleUpdate) {
    updates.push({
      runtimeLayout: uiRuntimeLayout,
      selection: uiSelectedFilters,
    });
  }
  if (shouldApplyPersistedFilterUpdate) {
    updates.push({
      runtimeLayout: uiRuntimeLayout,
      selection: persistedInteractionFilters,
    });
  }
  return {
    nextUpstreamState,
    updates,
  };
};

export const shouldSyncPersistedSelectedFilters = ({
  isUserControlled,
  pendingPersistedSelectionSync,
  persistedSelectedFilters,
  committedFilters,
  uiSelectedFilters,
  suppressStalePersistedFilterRestore,
}: {
  isUserControlled: boolean;
  pendingPersistedSelectionSync: boolean;
  persistedSelectedFilters: RuntimeSelection;
  committedFilters: RuntimeSelection;
  uiSelectedFilters: RuntimeSelection;
  suppressStalePersistedFilterRestore: boolean;
}) => {
  if (isUserControlled && pendingPersistedSelectionSync) {
    return false;
  }
  const shouldSyncFilters =
    !isEqual(persistedSelectedFilters, committedFilters) ||
    !isEqual(persistedSelectedFilters, uiSelectedFilters);
  if (!shouldSyncFilters) {
    return false;
  }
  if (!isUserControlled) {
    return true;
  }
  const hasLocalFilters =
    hasSelectedFilters(uiSelectedFilters) ||
    hasSelectedFilters(committedFilters);
  if (hasLocalFilters) {
    return false;
  }
  return !(
    suppressStalePersistedFilterRestore &&
    hasSelectedFilters(persistedSelectedFilters)
  );
};

export const prepareRuntimeLayoutPropSync = ({
  isUserControlled,
  isDashboardContext,
  isDashboardRuntimeSync,
  pendingPersistedRuntimeLayoutSync,
  hasPendingRuntimeLayout,
  runtimeLayout,
  lastPersistedRuntimeLayout,
}: {
  isUserControlled: boolean;
  isDashboardContext: boolean;
  isDashboardRuntimeSync: boolean;
  pendingPersistedRuntimeLayoutSync: boolean;
  hasPendingRuntimeLayout: boolean;
  runtimeLayout: PivotRuntimeLayout;
  lastPersistedRuntimeLayout: PivotRuntimeLayout;
}) => ({
  shouldSyncCommittedRuntimeLayout:
    !(isDashboardRuntimeSync && pendingPersistedRuntimeLayoutSync) &&
    !hasPendingRuntimeLayout,
  shouldSyncUiRuntimeLayout:
    !(
      isUserControlled &&
      isDashboardContext &&
      pendingPersistedRuntimeLayoutSync
    ) && !hasPendingRuntimeLayout,
  hasPersistedRuntimeLayoutSyncSettled:
    isDashboardRuntimeSync &&
    pendingPersistedRuntimeLayoutSync &&
    isSameRuntimeLayout(runtimeLayout, lastPersistedRuntimeLayout),
});

export const prepareRuntimeStatePersistence = ({
  layout,
  selection,
  isDashboardRuntimeSync,
  lastPersistedRuntimeLayout,
  lastPersistedSelection,
  upstreamDashboardQueryContextSignature,
}: {
  layout: PivotRuntimeLayout;
  selection: RuntimeSelection;
  isDashboardRuntimeSync: boolean;
  lastPersistedRuntimeLayout: PivotRuntimeLayout;
  lastPersistedSelection: RuntimeSelection;
  upstreamDashboardQueryContextSignature: string | null;
}) => {
  const shouldMarkPersistedRuntimeLayoutSyncPending =
    isDashboardRuntimeSync &&
    !isSameRuntimeLayout(lastPersistedRuntimeLayout, layout);
  const shouldMarkPersistedSelectionSyncPending = !isEqual(
    lastPersistedSelection,
    selection,
  );
  return {
    ownStatePatch: {
      pivotRuntimeLayout: layout,
      pivotSelectedFilters: selection,
    },
    persistedRuntimeLayout: shouldMarkPersistedRuntimeLayoutSyncPending
      ? layout
      : undefined,
    localSyncDashboardQueryContext: isDashboardRuntimeSync
      ? upstreamDashboardQueryContextSignature
      : undefined,
    persistedSelection: shouldMarkPersistedSelectionSyncPending
      ? selection
      : undefined,
  };
};

export const prepareSeamlessRuntimeLayoutChange = ({
  nextLayout,
  dimensionKeys,
  metricKeys,
  reuseSnapshot,
  selection,
  upstreamSignature,
}: {
  nextLayout: PivotRuntimeLayout;
  dimensionKeys: string[];
  metricKeys: string[];
  reuseSnapshot: SeamlessRuntimeReuseSnapshot;
  selection: RuntimeSelection;
  upstreamSignature: string;
}) => {
  const runtimeLayout = normalizeRuntimeLayout(
    nextLayout,
    dimensionKeys,
    metricKeys,
  );
  if (
    shouldFetchRuntimeLayout({
      reuseSnapshot,
      nextLayout: runtimeLayout,
    })
  ) {
    return {
      kind: 'fetch',
      runtimeLayout,
    };
  }
  return {
    kind: 'commit-local',
    runtimeLayout,
    syncSnapshot: buildSeamlessRuntimeSyncSnapshot({
      runtimeLayout,
      selection,
      upstreamSignature,
    }),
  };
};

type SeamlessRuntimeUpdatePlanConfig = {
  baseFormData: PivotTableQueryFormData;
  sourceMetrics: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric: PivotTableQueryFormData['measureLeavesByMetric'];
  runtimeLayout: PivotRuntimeLayout;
  selection: RuntimeSelection;
  expandedRows?: Set<string>;
  expandedCols?: Set<string>;
  pendingRows?: Set<string>;
  pendingCols?: Set<string>;
};

type SeamlessRuntimeUpdateConfig = SeamlessRuntimeUpdatePlanConfig & {
  requestLifecycle: LatestRequestLifecycle;
  materializationLifecycle: LatestRequestLifecycle;
  fetchData: (params: {
    formData: PivotTableQueryFormData;
    specs: PlannedQuerySpec[];
    requestGroupId: string;
  }) => Promise<ChartDataQueryResult[]>;
  onFetchStart?: () => void;
  onError?: (error: unknown) => void;
};

const toExpansionPaths = (
  expanded: Set<string> | undefined,
  pending: Set<string> | undefined,
) =>
  Array.from(new Set([...(expanded ?? []), ...(pending ?? [])])).map(parsePath);

const buildSeamlessRuntimeUpdatePlan = ({
  baseFormData,
  sourceMetrics,
  sourceMeasureLeavesByMetric,
  runtimeLayout,
  selection,
  expandedRows,
  expandedCols,
  pendingRows,
  pendingCols,
}: SeamlessRuntimeUpdatePlanConfig) => {
  const { rows: rowKeys, cols: colKeys } = insertValuesPlaceholder(
    runtimeLayout.rows,
    runtimeLayout.cols,
    runtimeLayout.valuePlacement,
    METRICS_PLACEHOLDER,
  );

  return buildInitialPivotUpdatePlan({
    formData: {
      ...baseFormData,
      pivotExpansionState: {
        rowKeys,
        colKeys,
        rows: toExpansionPaths(expandedRows, pendingRows),
        cols: toExpansionPaths(expandedCols, pendingCols),
        collapsedRows: [],
        collapsedCols: [],
      },
    },
    runtimeLayout,
    selection,
    metricsOverride: sourceMetrics,
    measureLeavesByMetricOverride: sourceMeasureLeavesByMetric,
  });
};

export const fetchAndMaterializeSeamlessRuntimeUpdate = async ({
  requestLifecycle,
  materializationLifecycle,
  fetchData,
  onFetchStart,
  onError,
  ...planConfig
}: SeamlessRuntimeUpdateConfig) => {
  const { formData, layout, specs } =
    buildSeamlessRuntimeUpdatePlan(planConfig);
  const fetchResult = await executeLatestRequest({
    lifecycle: requestLifecycle,
    requestGroupId: SEAMLESS_REQUEST_GROUP,
    onStart: () => {
      materializationLifecycle.invalidate();
      onFetchStart?.();
    },
    run: () =>
      fetchData({
        formData,
        specs,
        requestGroupId: SEAMLESS_REQUEST_GROUP,
      }),
    onError,
  });
  if (fetchResult.status === 'stale') {
    return { status: 'stale' };
  }
  if (fetchResult.status !== 'success') {
    return { status: fetchResult.status, error: fetchResult.error };
  }

  const results = fetchResult.value;
  const materializationResult = await executeScheduledLatestRequest({
    lifecycle: materializationLifecycle,
    requestGroupId: SEAMLESS_MATERIALIZATION_GROUP,
    run: token =>
      buildInitialRuntimeFromSpecResultsAsync({
        results,
        specs,
        layout,
        formData,
        shouldContinue: token.isCurrent,
        yieldToMain: yieldToMainThread,
      }),
    onError,
  });
  if (materializationResult.status === 'stale') {
    return { status: 'stale' };
  }
  if (materializationResult.status !== 'success') {
    return {
      status: materializationResult.status,
      error: materializationResult.error,
    };
  }

  return {
    status: 'success',
    tree: materializationResult.value.tree,
    factBatches: materializationResult.value.factBatches,
    warnings: collectWarnings(results),
  };
};
