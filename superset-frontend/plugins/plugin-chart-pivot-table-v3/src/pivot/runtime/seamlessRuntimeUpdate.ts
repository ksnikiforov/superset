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
import { hasSelectedFilters } from '../filters';
import { stableStringify } from '../shared/stableStringify';
import {
  buildInitialPivotUpdatePlan,
  normalizeFormDataExtraFilters,
} from '../query/specs';
import { normalizeRuntimeLayout } from '../layout/resolveInteractionLayout';
import {
  collectPlannedQueryWarnings,
  createPivotFactStore,
  fetchPlannedQuerySpecs,
} from './ingestQueryResults';
import { materializeLoadedPivotTreeFromFactStoreAsync } from './materializePivotTree';
import {
  isAbortError,
  type LatestRequestLifecycle,
  yieldToMainThread,
} from './requestLifecycle';

const SEAMLESS_REQUEST_GROUP = 'pivot-v3-seamless';

type RuntimeSelection = Record<string, DataRecordValue[]>;

export type SeamlessRuntimeSyncSnapshot = {
  filtersSignature: string | null;
  layoutSignature: string;
  upstreamSignature: string;
};

type SeamlessRuntimeUpstreamState = {
  data: PivotTreeData;
  signature: string;
} | null;

const selectionSignature = (selection: PivotRuntimeLayout['leafSelection']) =>
  stableStringify(selection ?? {});

const hasMetricSelectionChanged = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return true;
  }
  const rightSet = new Set(right);
  return left.some(metric => !rightSet.has(metric));
};

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
  reusableLayout,
  nextLayout,
}: {
  reusableLayout: PivotRuntimeLayout;
  nextLayout: PivotRuntimeLayout;
}) => {
  const isTrailingHiddenAppend = (previous: string[], next: string[]) =>
    previous.length > 0 &&
    next.length > previous.length &&
    previous.every((value, index) => value === next[index]);
  const axisChangeRequiresFetch = (previous: string[], next: string[]) =>
    !isEqual(previous, next) && !isTrailingHiddenAppend(previous, next);

  if (
    hasMetricSelectionChanged(reusableLayout.metrics, nextLayout.metrics) ||
    selectionSignature(reusableLayout.leafSelection) !==
      selectionSignature(nextLayout.leafSelection) ||
    reusableLayout.valuePlacement.axis !== nextLayout.valuePlacement.axis ||
    reusableLayout.valuePlacement.index !== nextLayout.valuePlacement.index
  ) {
    return true;
  }
  return (
    axisChangeRequiresFetch(reusableLayout.rows, nextLayout.rows) ||
    axisChangeRequiresFetch(reusableLayout.cols, nextLayout.cols)
  );
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
  pendingPersistedSelectionSync,
  persistedSelectedFilters,
  committedFilters,
  uiSelectedFilters,
  suppressStalePersistedFilterRestore,
}: {
  pendingPersistedSelectionSync: boolean;
  persistedSelectedFilters: RuntimeSelection;
  committedFilters: RuntimeSelection;
  uiSelectedFilters: RuntimeSelection;
  suppressStalePersistedFilterRestore: boolean;
}) => {
  if (pendingPersistedSelectionSync) {
    return false;
  }
  const shouldSyncFilters =
    !isEqual(persistedSelectedFilters, committedFilters) ||
    !isEqual(persistedSelectedFilters, uiSelectedFilters);
  if (!shouldSyncFilters) {
    return false;
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
  isDashboardRuntimeSync,
  pendingPersistedRuntimeLayoutSync,
  hasPendingRuntimeLayout,
  runtimeLayout,
  lastPersistedRuntimeLayout,
}: {
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
    !(isDashboardRuntimeSync && pendingPersistedRuntimeLayoutSync) &&
    !hasPendingRuntimeLayout,
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
  reusableLayout,
  selection,
  upstreamSignature,
}: {
  nextLayout: PivotRuntimeLayout;
  dimensionKeys: string[];
  metricKeys: string[];
  reusableLayout: PivotRuntimeLayout;
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
      reusableLayout,
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

type SeamlessRuntimeUpdateConfig = {
  baseFormData: PivotTableQueryFormData;
  sourceMetrics: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric: PivotTableQueryFormData['measureLeavesByMetric'];
  runtimeLayout: PivotRuntimeLayout;
  selection: RuntimeSelection;
  requestLifecycle: LatestRequestLifecycle;
};

export const fetchAndMaterializeSeamlessRuntimeUpdate = async ({
  requestLifecycle,
  baseFormData,
  sourceMetrics,
  sourceMeasureLeavesByMetric,
  runtimeLayout,
  selection,
}: SeamlessRuntimeUpdateConfig) => {
  const queryFormData = { ...baseFormData };
  delete queryFormData.pivotExpansionState;
  const { formData, layout, specs } = buildInitialPivotUpdatePlan({
    formData: queryFormData,
    runtimeLayout,
    selection,
    metricsOverride: sourceMetrics,
    measureLeavesByMetricOverride: sourceMeasureLeavesByMetric,
  });
  const factStore = createPivotFactStore();
  const requestScope = requestLifecycle.beginScope();
  requestScope.beginRequest(SEAMLESS_REQUEST_GROUP);

  try {
    const { results } = await fetchPlannedQuerySpecs({
      formData,
      specs,
      requestGroupId: SEAMLESS_REQUEST_GROUP,
      factStore,
      shouldContinue: requestScope.isCurrent,
      yieldToMain: yieldToMainThread,
    });
    requestScope.finish(SEAMLESS_REQUEST_GROUP);
    if (!requestScope.isCurrent()) {
      return { status: 'stale' as const };
    }

    await yieldToMainThread();
    if (!requestScope.isCurrent()) {
      return { status: 'stale' as const };
    }
    const tree = await materializeLoadedPivotTreeFromFactStoreAsync({
      store: factStore,
      layout,
      formData,
      shouldContinue: requestScope.isCurrent,
      yieldToMain: yieldToMainThread,
    });
    await yieldToMainThread();
    if (!requestScope.isCurrent()) {
      return { status: 'stale' as const };
    }

    return {
      status: 'success' as const,
      tree,
      factBatches: factStore.getFactBatches(),
      warnings: collectPlannedQueryWarnings(results),
    };
  } catch (error) {
    if (!requestScope.isCurrent()) {
      return { status: 'stale' as const };
    }
    return isAbortError(error)
      ? { status: 'aborted' as const, error }
      : { status: 'error' as const, error };
  } finally {
    requestScope.finish(SEAMLESS_REQUEST_GROUP);
  }
};
