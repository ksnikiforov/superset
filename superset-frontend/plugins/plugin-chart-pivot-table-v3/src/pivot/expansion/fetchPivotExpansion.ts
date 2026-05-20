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
import { type PivotTableQueryFormData } from '../../types';
import { type ExpansionCoverageTarget } from './planner';
import { type LayoutContext } from '../layout/LayoutContext';
import { buildExpansionQuerySpecs } from '../query/specs';
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
  warnings?: ChartDataWarning[];
};

export const fetchPivotExpansion = async (
  request: FetchPivotExpansionRequest,
): Promise<FetchPivotExpansionResult> => {
  try {
    const nonIntersectionSpecs = buildExpansionQuerySpecs({
      formData: request.formData,
      layout: request.layout,
      targets: request.targets,
      includeIntersections: false,
    });
    const nonIntersectionResult = await fetchPlannedQuerySpecs({
      formData: request.formData,
      specs: nonIntersectionSpecs,
      requestGroupId: request.requestGroupId,
      factStore: request.factStore,
      chunkSize: request.chunkSize,
      shouldContinue: request.shouldContinue,
      yieldToMain: request.yieldToMain,
    });
    const intersectionSpecs = buildExpansionQuerySpecs({
      formData: request.formData,
      layout: request.layout,
      targets: request.targets,
    }).filter(spec => spec.meta.factSelector.scope.kind === 'intersection');
    const intersectionResult = await fetchPlannedQuerySpecs({
      formData: request.formData,
      specs: intersectionSpecs,
      requestGroupId: request.requestGroupId,
      factStore: request.factStore,
      chunkSize: request.chunkSize,
      shouldContinue: request.shouldContinue,
      yieldToMain: request.yieldToMain,
    });
    const results = [
      ...nonIntersectionResult.results,
      ...intersectionResult.results,
    ];
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
};
