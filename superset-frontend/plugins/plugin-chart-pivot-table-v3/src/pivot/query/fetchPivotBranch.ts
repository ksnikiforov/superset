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
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
} from '../../types';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { buildLayoutContext } from '../layout/LayoutContext';
import {
  buildBatchQuerySpecs,
  buildBranchQuerySpecs,
  buildIntersectionQuerySpecs,
  type PlannedQuerySpec,
} from './specs';
import { type PivotFactStore } from '../runtime/factStore';
import { upsertQueryResultsIntoFactStore } from '../runtime/ingestQueryResults';
import { isAbortError } from '../runtime/requestLifecycle';
import { factStoreSelectorFromSpec } from '../runtime/materializePivotTree';
import { type BatchGroup } from './fetchPlanOptimizer';

export interface FetchPivotBranchResult {
  warnings?: ChartDataWarning[];
  error?: Error;
}

export interface FetchPivotBranchParams {
  formData: PivotTableQueryFormData;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
}

export type FetchPivotBranchesBatchParams = {
  formData: PivotTableQueryFormData;
  batch: BatchGroup;
  visibleRowDepth: number;
  visibleColDepth: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

export type FetchPivotBranchesBatchResult = FetchPivotBranchResult;

export type FetchPivotIntersectionParams = {
  formData: PivotTableQueryFormData;
  rowPathKeys: string[];
  columnPathKeys: string[];
  visibleRowDepth: number;
  visibleColDepth: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

export type FetchPivotIntersectionResult = FetchPivotBranchResult;

export type FetchPivotExpansionRequest =
  | ({
      kind: 'branch';
    } & FetchPivotBranchParams)
  | ({
      kind: 'batch';
    } & FetchPivotBranchesBatchParams)
  | ({
      kind: 'intersection';
    } & FetchPivotIntersectionParams);

const fetchPivotQuerySpecsIntoFactStore = async ({
  formData,
  specs,
  requestGroupId,
  factStore,
}: {
  formData: PivotTableQueryFormData;
  specs: PlannedQuerySpec[];
  requestGroupId?: string;
  factStore?: PivotFactStore;
}): Promise<FetchPivotBranchResult> => {
  if (specs.length === 0) {
    return {};
  }
  const missingSpecs = specs.filter(
    spec => !factStore?.hasCompatibleCoverage(factStoreSelectorFromSpec(spec)),
  );
  if (missingSpecs.length === 0) {
    return {};
  }
  const metricsForQuery = missingSpecs[0]?.metrics ?? specs[0].metrics;
  const timeOffsets = Array.from(
    new Set([
      ...(formData.time_offsets ?? []),
      ...missingSpecs.flatMap(spec => spec.meta.requiredTimeOffsets),
    ]),
  );
  const queryFormData =
    metricsForQuery.length > 0
      ? {
          ...formData,
          metrics: metricsForQuery,
          ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
        }
      : {
          ...formData,
          ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
        };

  try {
    const results = await supersetChartDataClient.fetch({
      formData: queryFormData,
      specs: missingSpecs,
      requestGroupId,
    });
    const warnings = results.flatMap(result => result.warnings ?? []);
    if (factStore) {
      upsertQueryResultsIntoFactStore({
        store: factStore,
        specs: missingSpecs,
        results,
      });
    }
    return {
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

export const fetchPivotExpansion = async (
  request: FetchPivotExpansionRequest,
): Promise<FetchPivotBranchResult> => {
  const layout = buildLayoutContext(request.formData);
  const specs =
    request.kind === 'branch'
      ? buildBranchQuerySpecs({
          formData: request.formData,
          layout,
          axis: request.axis,
          path: request.path,
          visibleRowDepth: request.visibleRowDepth,
          visibleColDepth: request.visibleColDepth,
        })
      : request.kind === 'batch'
        ? buildBatchQuerySpecs({
            formData: request.formData,
            layout,
            batch: request.batch,
            visibleRowDepth: request.visibleRowDepth,
            visibleColDepth: request.visibleColDepth,
            chunkIndex: 0,
          })
        : buildIntersectionQuerySpecs({
            formData: request.formData,
            layout,
            rowPathKeys: request.rowPathKeys,
            columnPathKeys: request.columnPathKeys,
            visibleRowDepth: request.visibleRowDepth,
            visibleColDepth: request.visibleColDepth,
          });

  return fetchPivotQuerySpecsIntoFactStore({
    formData: request.formData,
    specs,
    requestGroupId: request.requestGroupId,
    factStore: request.factStore,
  });
};

export async function fetchPivotBranch({
  formData,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  return fetchPivotExpansion({
    kind: 'branch',
    formData,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
    requestGroupId,
    factStore,
  });
}

export const fetchPivotBranchesBatch = async ({
  formData,
  batch,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> =>
  fetchPivotExpansion({
    kind: 'batch',
    formData,
    batch,
    visibleRowDepth,
    visibleColDepth,
    requestGroupId,
    factStore,
  });

export const fetchPivotIntersection = async ({
  formData,
  rowPathKeys,
  columnPathKeys,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotIntersectionParams): Promise<FetchPivotIntersectionResult> =>
  fetchPivotExpansion({
    kind: 'intersection',
    formData,
    rowPathKeys,
    columnPathKeys,
    visibleRowDepth,
    visibleColDepth,
    requestGroupId,
    factStore,
  });
