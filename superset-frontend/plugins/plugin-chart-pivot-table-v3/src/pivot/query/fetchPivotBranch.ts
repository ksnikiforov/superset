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
import { type PivotTableQueryFormData } from '../../types';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { buildLayoutContext } from '../layout/LayoutContext';
import {
  buildExpansionQuerySpecs,
  type ExpansionQuerySpecRequest,
  type PlannedQuerySpec,
} from './specs';
import { type PivotFactStore } from '../runtime/factStore';
import { upsertQueryResultsIntoFactStore } from '../runtime/ingestQueryResults';
import { isAbortError } from '../runtime/requestLifecycle';
import { factStoreSelectorFromSpec } from '../runtime/materializePivotTree';

export interface FetchPivotExpansionResult {
  warnings?: ChartDataWarning[];
  error?: Error;
}

type ExpansionQueryRequest = ExpansionQuerySpecRequest extends infer Request
  ? Request extends unknown
    ? Omit<Request, 'layout'>
    : never
  : never;

export type FetchPivotExpansionRequest = ExpansionQueryRequest & {
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

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
}): Promise<FetchPivotExpansionResult> => {
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
): Promise<FetchPivotExpansionResult> => {
  const layout = buildLayoutContext(request.formData);
  const specs = buildExpansionQuerySpecs({ ...request, layout });

  return fetchPivotQuerySpecsIntoFactStore({
    formData: request.formData,
    specs,
    requestGroupId: request.requestGroupId,
    factStore: request.factStore,
  });
};
