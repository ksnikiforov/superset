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
} from '../../types';
import { hasSelectedFilters } from '../filters';
import { stableStringify } from '../shared/stableStringify';
import {
  buildInitialPivotUpdatePlan,
  normalizeFormDataExtraFilters,
} from '../query/specs';
import {
  collectPlannedQueryWarnings,
  fetchPlannedQuerySpecs,
} from './ingestQueryResults';
import {
  assignMissingPivotFactQueryContextKey,
  buildPivotFactQueryContextKey,
  createPivotFactStore,
  createPivotFactStoreFromBatches,
  type PivotFactStoreBatch,
} from './factStore';
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
) =>
  queryFormData
    ? buildPivotFactQueryContextKey(
        normalizeFormDataExtraFilters(queryFormData),
      )
    : null;

type SeamlessRuntimeUpdateConfig = {
  baseFormData: PivotTableQueryFormData;
  sourceMetrics: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric: PivotTableQueryFormData['measureLeavesByMetric'];
  runtimeLayout: PivotRuntimeLayout;
  selection: RuntimeSelection;
  factBatches?: PivotFactStoreBatch[];
  requestLifecycle: LatestRequestLifecycle;
};

const buildSeamlessRuntimeCoveragePlan = ({
  baseFormData,
  sourceMetrics,
  sourceMeasureLeavesByMetric,
  runtimeLayout,
  selection,
  factBatches = [],
}: Omit<SeamlessRuntimeUpdateConfig, 'requestLifecycle'>) => {
  const plan = buildInitialPivotUpdatePlan({
    formData: baseFormData,
    runtimeLayout,
    selection,
    metricsOverride: sourceMetrics,
    measureLeavesByMetricOverride: sourceMeasureLeavesByMetric,
  });
  const queryContextKey = buildPivotFactQueryContextKey(plan.formData);
  return {
    ...plan,
    factStore:
      factBatches.length > 0
        ? createPivotFactStoreFromBatches(
            factBatches.map(batch =>
              assignMissingPivotFactQueryContextKey(batch, queryContextKey),
            ),
          )
        : createPivotFactStore(),
  };
};

export const fetchAndMaterializeSeamlessRuntimeUpdate = async ({
  requestLifecycle,
  baseFormData,
  sourceMetrics,
  sourceMeasureLeavesByMetric,
  runtimeLayout,
  selection,
  factBatches,
}: SeamlessRuntimeUpdateConfig) => {
  const { formData, layout, specs, factStore } =
    buildSeamlessRuntimeCoveragePlan({
      baseFormData,
      sourceMetrics,
      sourceMeasureLeavesByMetric,
      runtimeLayout,
      selection,
      factBatches,
    });
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
      factBatches: factStore.getFactBatches(
        buildPivotFactQueryContextKey(formData),
      ),
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
