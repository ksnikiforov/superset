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
import { type PivotTableQueryFormData, type PivotTreeData } from '../../types';
import {
  type ChartDataQueryResult,
  type ChartDataWarning,
} from '../data/ChartDataClient';
import { type LayoutContext } from '../layout/LayoutContext';
import { type PlannedQuerySpec } from '../query/specs';
import {
  buildInitialRuntimeFromSpecResultsAsync,
  type PivotFactStoreBatch,
} from './ingestQueryResults';
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

export const fetchAndMaterializeSeamlessRuntimeUpdate = async ({
  requestLifecycle,
  materializationLifecycle,
  formData,
  specs,
  layout,
  fetchData,
  onFetchStart,
  onError,
}: {
  requestLifecycle: LatestRequestLifecycle;
  materializationLifecycle: LatestRequestLifecycle;
  formData: PivotTableQueryFormData;
  specs: PlannedQuerySpec[];
  layout: LayoutContext;
  fetchData: (params: {
    formData: PivotTableQueryFormData;
    specs: PlannedQuerySpec[];
    requestGroupId: string;
  }) => Promise<ChartDataQueryResult[]>;
  onFetchStart?: () => void;
  onError?: (error: unknown) => void;
}): Promise<SeamlessRuntimeUpdateResult> => {
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
