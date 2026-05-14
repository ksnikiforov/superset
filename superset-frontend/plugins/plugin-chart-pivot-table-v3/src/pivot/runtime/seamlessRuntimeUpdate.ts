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
import { type DataRecordValue, type JsonObject } from '@superset-ui/core';
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
import {
  type ChartDataQueryResult,
  type ChartDataWarning,
} from '../data/ChartDataClient';
import { type PlannedQuerySpec } from '../query/specs';
import { normalizeFormDataExtraFilters } from '../query/normalizeExtraFormData';
import { buildInitialPivotUpdatePlan } from '../update/initialUpdatePlan';
import { normalizeRuntimeLayout } from '../layout/resolveInteractionLayout';
import {
  buildInitialRuntimeFromSpecResultsAsync,
  type PivotFactStoreBatch,
} from './ingestQueryResults';
import { insertValuesPlaceholder } from './compilePivotProgram';
import {
  factBatchesCoverRuntimeLayout,
  isSameRuntimeLayout,
  shouldFetchRuntimeLayout,
} from './coverage';
import {
  executeLatestRequest,
  executeScheduledLatestRequest,
  type LatestRequestLifecycle,
  yieldToMainThread,
} from './requestLifecycle';

export const SEAMLESS_REQUEST_GROUP = 'pivot-v3-seamless';
export const SEAMLESS_MATERIALIZATION_GROUP = 'pivot-v3-seamless-materialize';

type RuntimeSelection = Record<string, DataRecordValue[]>;

const collectWarnings = (results: ChartDataQueryResult[]): ChartDataWarning[] =>
  results.flatMap(result => result.warnings ?? []);

export type SeamlessRuntimeSyncSnapshot = {
  filtersSignature: string | null;
  layoutSignature: string;
  upstreamSignature: string;
};

export type SeamlessRuntimeUpstreamState = {
  data: PivotTreeData;
  signature: string;
} | null;

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

export const matchesSeamlessRuntimeSyncSnapshot = (
  current: SeamlessRuntimeSyncSnapshot | null,
  next: SeamlessRuntimeSyncSnapshot,
) =>
  current?.filtersSignature === next.filtersSignature &&
  current.layoutSignature === next.layoutSignature &&
  current.upstreamSignature === next.upstreamSignature;

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

export const shouldSyncCommittedRuntimeFromProps = ({
  isUserControlled,
  hasLocalSyncForCurrentDashboardQueryContext,
  persistedInteractionFilters,
  runtimeLayout,
  committedRuntimeLayout,
  selectedFiltersForTreeSync,
  committedFilters,
}: {
  isUserControlled: boolean;
  hasLocalSyncForCurrentDashboardQueryContext: boolean;
  persistedInteractionFilters: RuntimeSelection;
  runtimeLayout: PivotRuntimeLayout;
  committedRuntimeLayout: PivotRuntimeLayout;
  selectedFiltersForTreeSync: RuntimeSelection;
  committedFilters: RuntimeSelection;
}) =>
  !isUserControlled ||
  (!hasLocalSyncForCurrentDashboardQueryContext &&
    !hasSelectedFilters(persistedInteractionFilters) &&
    isSameRuntimeLayout(runtimeLayout, committedRuntimeLayout) &&
    isEqual(selectedFiltersForTreeSync, committedFilters));

const shouldRecoverStaleDashboardRuntimeCoverage = ({
  isUserControlled,
  isDashboardRuntimeSync,
  persistedInteractionFilters,
  committedFactBatches,
  committedRuntimeLayout,
}: {
  isUserControlled: boolean;
  isDashboardRuntimeSync: boolean;
  persistedInteractionFilters: RuntimeSelection;
  committedFactBatches: PivotFactStoreBatch[];
  committedRuntimeLayout: PivotRuntimeLayout;
}) =>
  isUserControlled &&
  isDashboardRuntimeSync &&
  !hasSelectedFilters(persistedInteractionFilters) &&
  !factBatchesCoverRuntimeLayout(committedFactBatches, committedRuntimeLayout);

export type SeamlessRuntimeUpdateEffectPlan = {
  nextUpstreamState: SeamlessRuntimeUpstreamState;
  updates: {
    runtimeLayout: PivotRuntimeLayout;
    selection: RuntimeSelection;
  }[];
};

export const prepareSeamlessRuntimeUpdateEffect = ({
  upstreamDashboardQueryContextSignature,
  previousUpstreamState,
  data,
  isUserControlled,
  isDashboardRuntimeSync,
  persistedInteractionFilters,
  committedFactBatches,
  committedRuntimeLayout,
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
  isDashboardRuntimeSync: boolean;
  persistedInteractionFilters: RuntimeSelection;
  committedFactBatches: PivotFactStoreBatch[];
  committedRuntimeLayout: PivotRuntimeLayout;
  committedFilters: RuntimeSelection;
  uiSelectedFilters: RuntimeSelection;
  lastSync: SeamlessRuntimeSyncSnapshot | null;
  uiRuntimeLayout: PivotRuntimeLayout;
  upstreamSeamlessSignature: string;
}): SeamlessRuntimeUpdateEffectPlan => {
  const nextUpstreamState = upstreamDashboardQueryContextSignature
    ? {
        data,
        signature: upstreamDashboardQueryContextSignature,
      }
    : null;
  const shouldApplyStaleUpdate =
    upstreamDashboardQueryContextSignature !== null &&
    (shouldRecoverStaleDashboardRuntimeCoverage({
      isUserControlled,
      isDashboardRuntimeSync,
      persistedInteractionFilters,
      committedFactBatches,
      committedRuntimeLayout,
    }) ||
      (previousUpstreamState !== null &&
        previousUpstreamState.signature !==
          upstreamDashboardQueryContextSignature &&
        previousUpstreamState.data === data));
  const shouldApplyPersistedFilterUpdate =
    isUserControlled &&
    hasSelectedFilters(persistedInteractionFilters) &&
    isEqual(committedFilters, persistedInteractionFilters) &&
    isEqual(uiSelectedFilters, persistedInteractionFilters) &&
    !matchesSeamlessRuntimeSyncSnapshot(
      lastSync,
      buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout: uiRuntimeLayout,
        selection: persistedInteractionFilters,
        upstreamSignature: upstreamSeamlessSignature,
      }),
    );
  const updates: SeamlessRuntimeUpdateEffectPlan['updates'] = [];
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

export type RuntimeLayoutPropSyncPlan = {
  shouldSyncCommittedRuntimeLayout: boolean;
  shouldSyncUiRuntimeLayout: boolean;
  hasPersistedRuntimeLayoutSyncSettled: boolean;
};

export const prepareRuntimeLayoutPropSync = ({
  isUserControlled,
  isDashboardContext,
  isDashboardRuntimeSync,
  pendingPersistedRuntimeLayoutSync,
  hasPendingSeamlessLayout,
  runtimeLayout,
  lastPersistedRuntimeLayout,
}: {
  isUserControlled: boolean;
  isDashboardContext: boolean;
  isDashboardRuntimeSync: boolean;
  pendingPersistedRuntimeLayoutSync: boolean;
  hasPendingSeamlessLayout: boolean;
  runtimeLayout: PivotRuntimeLayout;
  lastPersistedRuntimeLayout: PivotRuntimeLayout;
}): RuntimeLayoutPropSyncPlan => ({
  shouldSyncCommittedRuntimeLayout:
    !(isDashboardRuntimeSync && pendingPersistedRuntimeLayoutSync) &&
    !hasPendingSeamlessLayout,
  shouldSyncUiRuntimeLayout:
    !(
      isUserControlled &&
      isDashboardContext &&
      pendingPersistedRuntimeLayoutSync
    ) && !hasPendingSeamlessLayout,
  hasPersistedRuntimeLayoutSyncSettled:
    isDashboardRuntimeSync &&
    pendingPersistedRuntimeLayoutSync &&
    isSameRuntimeLayout(runtimeLayout, lastPersistedRuntimeLayout),
});

export type RuntimeStatePersistencePlan = {
  ownStatePatch: JsonObject;
  persistedRuntimeLayout?: PivotRuntimeLayout;
  localSyncDashboardQueryContext?: string | null;
  persistedSelection?: RuntimeSelection;
};

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
}): RuntimeStatePersistencePlan => {
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

export const isSeamlessDisplaySnapshotSettled = ({
  seamlessLoading,
  isHydrating,
  loadingKeys,
  pendingRows,
  pendingCols,
}: {
  seamlessLoading: boolean;
  isHydrating: boolean;
  loadingKeys: Set<string>;
  pendingRows: Set<string>;
  pendingCols: Set<string>;
}) =>
  !seamlessLoading &&
  !isHydrating &&
  loadingKeys.size === 0 &&
  pendingRows.size === 0 &&
  pendingCols.size === 0;

export type SeamlessRuntimeLayoutChangeAction =
  | {
      kind: 'fetch';
      runtimeLayout: PivotRuntimeLayout;
    }
  | {
      kind: 'commit-local';
      runtimeLayout: PivotRuntimeLayout;
      syncSnapshot: SeamlessRuntimeSyncSnapshot;
    };

export const prepareSeamlessRuntimeLayoutChange = ({
  nextLayout,
  dimensionKeys,
  metricKeys,
  factBatches,
  pendingSeamlessLayout,
  committedRuntimeLayout,
  selection,
  upstreamSignature,
}: {
  nextLayout: PivotRuntimeLayout;
  dimensionKeys: string[];
  metricKeys: string[];
  factBatches: PivotFactStoreBatch[];
  pendingSeamlessLayout: PivotRuntimeLayout | null;
  committedRuntimeLayout: PivotRuntimeLayout;
  selection: RuntimeSelection;
  upstreamSignature: string;
}): SeamlessRuntimeLayoutChangeAction => {
  const runtimeLayout = normalizeRuntimeLayout(
    nextLayout,
    dimensionKeys,
    metricKeys,
  );
  const previousLayout = pendingSeamlessLayout ?? committedRuntimeLayout;
  if (
    shouldFetchRuntimeLayout({
      factBatches,
      previousLayout,
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

export type SeamlessRuntimeUpdateResult =
  | {
      status: 'success';
      tree: PivotTreeData;
      factBatches: PivotFactStoreBatch[];
      warnings: ChartDataWarning[];
    }
  | {
      status: 'stale';
    }
  | {
      status: 'aborted' | 'error';
      error: unknown;
    };

type SeamlessRuntimeUpdatePlanConfig = {
  baseFormData: PivotTableQueryFormData;
  sourceFormData: PivotTableQueryFormData;
  sourceMetrics?: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric?: PivotTableQueryFormData['measureLeavesByMetric'];
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
  sourceFormData,
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
    metricsOverride:
      sourceMetrics ?? sourceFormData.metrics ?? baseFormData.metrics,
    measureLeavesByMetricOverride:
      sourceMeasureLeavesByMetric ??
      sourceFormData.measureLeavesByMetric ??
      baseFormData.measureLeavesByMetric,
  });
};

export const fetchAndMaterializeSeamlessRuntimeUpdate = async ({
  requestLifecycle,
  materializationLifecycle,
  fetchData,
  onFetchStart,
  onError,
  ...planConfig
}: SeamlessRuntimeUpdateConfig): Promise<SeamlessRuntimeUpdateResult> => {
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
