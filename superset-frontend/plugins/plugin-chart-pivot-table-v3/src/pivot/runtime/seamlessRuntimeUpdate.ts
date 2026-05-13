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
import {
  type PivotRuntimeLayout,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import { METRICS_PLACEHOLDER, parsePath } from '../../utils';
import { stableStringify } from '../shared/stableStringify';
import {
  type ChartDataQueryResult,
  type ChartDataWarning,
} from '../data/ChartDataClient';
import { type PlannedQuerySpec } from '../query/specs';
import { buildInitialPivotUpdatePlan } from '../update/initialUpdatePlan';
import {
  buildInitialRuntimeFromSpecResultsAsync,
  type PivotFactStoreBatch,
} from './ingestQueryResults';
import { insertValuesPlaceholder } from './compilePivotProgram';
import {
  executeLatestRequest,
  executeScheduledLatestRequest,
  type LatestRequestLifecycle,
  yieldToMainThread,
} from './requestLifecycle';

export const SEAMLESS_REQUEST_GROUP = 'pivot-v3-seamless';
export const SEAMLESS_MATERIALIZATION_GROUP = 'pivot-v3-seamless-materialize';

const collectWarnings = (results: ChartDataQueryResult[]): ChartDataWarning[] =>
  results.flatMap(result => result.warnings ?? []);

export type SeamlessRuntimeSyncSnapshot = {
  filtersSignature: string | null;
  layoutSignature: string;
  upstreamSignature: string;
};

export const buildSeamlessRuntimeSyncSnapshot = ({
  runtimeLayout,
  selection,
  upstreamSignature,
}: {
  runtimeLayout: PivotRuntimeLayout;
  selection: Record<string, DataRecordValue[]>;
  upstreamSignature: string;
}): SeamlessRuntimeSyncSnapshot => ({
  filtersSignature:
    Object.keys(selection).length > 0 ? stableStringify(selection) : null,
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
  runtimeLayout: PivotRuntimeLayout;
  selection: Record<string, DataRecordValue[]>;
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
      sourceFormData.metricsBase ??
      sourceFormData.metrics ??
      baseFormData.metrics,
    measureLeavesByMetricOverride:
      sourceFormData.measureLeavesByMetricBase ??
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
