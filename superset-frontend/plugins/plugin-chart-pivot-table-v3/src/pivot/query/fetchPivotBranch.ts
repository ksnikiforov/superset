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
  type ChartDataWarning,
  type ChartDataQueryResult,
} from '../data/ChartDataClient';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { buildLayoutContext } from '../layout/LayoutContext';
import { type PivotFactStore } from '../runtime/factStore';
import { upsertQueryResultsIntoFactStore } from '../runtime/ingestQueryResults';
import { isAbortError } from '../runtime/requestLifecycle';
import {
  buildExpansionQuerySpecs,
  type ExpansionQuerySpecRequest,
  type PlannedQuerySpec,
} from './specs';

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

export const collectPlannedQueryWarnings = (results: ChartDataQueryResult[]) =>
  results.flatMap(result => result.warnings ?? []);

export const fetchPlannedQuerySpecs = async ({
  formData,
  specs,
  requestGroupId,
  factStore,
}: {
  formData: FetchPivotExpansionRequest['formData'];
  specs: PlannedQuerySpec[];
  requestGroupId?: string;
  factStore?: PivotFactStore;
}): Promise<{ results: ChartDataQueryResult[] }> => {
  const missingSpecs = specs.filter(
    spec => !factStore?.hasCompatibleCoverage(spec.meta.factSelector),
  );
  if (missingSpecs.length === 0) {
    return { results: [] };
  }
  const metricsForQuery = missingSpecs[0]?.metrics;
  const timeOffsets = Array.from(
    new Set([
      ...(formData.time_offsets ?? []),
      ...missingSpecs.flatMap(spec => spec.meta.requiredTimeOffsets),
    ]),
  );
  const results = await supersetChartDataClient.fetch({
    formData: {
      ...formData,
      ...(metricsForQuery && metricsForQuery.length > 0
        ? { metrics: metricsForQuery }
        : {}),
      ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
    },
    specs: missingSpecs,
    requestGroupId,
  });
  if (factStore) {
    upsertQueryResultsIntoFactStore({
      store: factStore,
      specs: missingSpecs,
      results,
    });
  }
  return { results };
};

export const fetchPivotExpansion = async (
  request: FetchPivotExpansionRequest,
): Promise<FetchPivotExpansionResult> => {
  const layout = buildLayoutContext(request.formData);
  const specs = buildExpansionQuerySpecs({ ...request, layout });

  try {
    const { results } = await fetchPlannedQuerySpecs({
      formData: request.formData,
      specs,
      requestGroupId: request.requestGroupId,
      factStore: request.factStore,
    });
    const warnings = collectPlannedQueryWarnings(results);
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
