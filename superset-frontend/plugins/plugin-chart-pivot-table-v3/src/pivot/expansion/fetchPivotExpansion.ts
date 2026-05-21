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
import { type ChartDataWarning } from '../data/ChartDataClient';
import { type PivotTableQueryFormData, type PivotTreeData } from '../../types';
import { type ExpansionCoverageTarget } from './planner';
import { type LayoutContext } from '../layout/LayoutContext';
import { buildExpansionQuerySpecPhases } from '../query/specs';
import { type PivotFactStore } from '../runtime/factStore';
import { type ChunkedWorkOptions } from '../runtime/chunkedWork';
import {
  collectPlannedQueryWarnings,
  fetchPlannedQuerySpecs,
} from '../runtime/ingestQueryResults';
import { isAbortError } from '../runtime/requestLifecycle';

export type FetchPivotExpansionRequest = {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  targets: ExpansionCoverageTarget[];
  requestGroupId?: string;
  factStore?: PivotFactStore;
} & ChunkedWorkOptions;

export type FetchPivotExpansionResult = {
  didFetch?: true;
  data?: PivotTreeData;
  factBatches?: ReturnType<PivotFactStore['getFactBatches']>;
  warnings?: ChartDataWarning[];
};

export async function fetchPivotExpansion(
  request: FetchPivotExpansionRequest,
): Promise<FetchPivotExpansionResult> {
  try {
    const results = [] as Awaited<
      ReturnType<typeof fetchPlannedQuerySpecs>
    >['results'];
    for (const specs of buildExpansionQuerySpecPhases({
      formData: request.formData,
      layout: request.layout,
      targets: request.targets,
    })) {
      // eslint-disable-next-line no-await-in-loop
      const result = await fetchPlannedQuerySpecs({
        formData: request.formData,
        specs,
        requestGroupId: request.requestGroupId,
        factStore: request.factStore,
        chunkSize: request.chunkSize,
        shouldContinue: request.shouldContinue,
        yieldToMain: request.yieldToMain,
      });
      results.push(...result.results);
    }
    const warnings = collectPlannedQueryWarnings(results);
    return {
      ...(results.length > 0 ? { didFetch: true as const } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}
