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
import { type LayoutContext } from '../layout/LayoutContext';
import {
  buildExpansionQuerySpecs,
  type ExpansionQuerySpecRequest,
} from '../query/specs';
import { type PivotFactStore } from '../runtime/factStore';
import {
  collectPlannedQueryWarnings,
  fetchPlannedQuerySpecs,
} from '../runtime/ingestQueryResults';
import { isAbortError } from '../runtime/requestLifecycle';

type ExpansionRequestWithoutLayout<Request = ExpansionQuerySpecRequest> =
  Request extends unknown ? Omit<Request, 'layout'> : never;

export type FetchPivotExpansionRequest = ExpansionRequestWithoutLayout & {
  layout: LayoutContext;
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

export type FetchPivotExpansionResult = { warnings?: ChartDataWarning[] };

export const fetchPivotExpansion = async (
  request: FetchPivotExpansionRequest,
): Promise<FetchPivotExpansionResult> => {
  const specs = buildExpansionQuerySpecs(request);

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
    throw error instanceof Error ? error : new Error(String(error));
  }
};
