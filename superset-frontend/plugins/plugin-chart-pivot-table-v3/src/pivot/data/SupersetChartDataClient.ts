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
  buildQueryContext,
  ensureIsArray,
  FeatureFlag,
  isFeatureEnabled,
  SupersetClient,
  type QueryObject,
} from '@superset-ui/core';
// eslint-disable-next-line import/no-extraneous-dependencies -- Phase 4 requires mirroring Superset core GAQ handling.
import { waitForAsyncData } from 'src/middleware/asyncEvent';
import { type PivotTableQueryFormData } from '../../types';
import { toChartDataQueries } from '../query/toChartDataQueries';
import { type QuerySpec } from '../query/types';
import {
  type ChartDataClient,
  type ChartDataFetchParams,
  type ChartDataQueryResult,
  type ChartDataWarning,
} from './ChartDataClient';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null;

const unwrapResult = (json: unknown): unknown => {
  if (!isRecord(json)) {
    return undefined;
  }
  return 'result' in json ? json.result : undefined;
};

const unwrapResultForGaq = (json: unknown): unknown => {
  if (!isRecord(json)) {
    return json;
  }
  return 'result' in json ? json.result : json;
};

const handleChartDataResponse = async ({
  response,
  json,
}: {
  response?: Response;
  json: unknown;
}): Promise<unknown> => {
  if (!isFeatureEnabled(FeatureFlag.GlobalAsyncQueries)) {
    return unwrapResult(json);
  }

  if (!response) {
    throw new Error('Missing response status while fetching chart data');
  }

  const result = unwrapResultForGaq(json);
  switch (response.status) {
    case 200:
      return result;
    case 202:
      return waitForAsyncData(result as Parameters<typeof waitForAsyncData>[0]);
    default:
      throw new Error(
        `Received unexpected response status (${response.status}) while fetching chart data`,
      );
  }
};

class RequestTooLargeError extends Error {
  constructor(message = 'Chart data request too large') {
    super(message);
    this.name = 'RequestTooLargeError';
  }
}

const isRequestTooLargeError = (error: unknown): boolean =>
  error instanceof RequestTooLargeError;

const getQueryName = (result: ChartDataQueryResult): string | undefined =>
  typeof result.query?.query_name === 'string'
    ? result.query.query_name
    : typeof result.query_name === 'string'
      ? result.query_name
      : undefined;

const applyWarnings = (
  result: ChartDataQueryResult,
  warnings: ChartDataWarning[],
): ChartDataQueryResult =>
  warnings.length > 0 ? { ...result, warnings } : result;

const collectWarningsForResult = (
  result: ChartDataQueryResult,
  rowLimit?: number,
): ChartDataWarning[] => {
  if (!rowLimit || !Number.isFinite(rowLimit) || rowLimit <= 0) {
    return [];
  }
  if (typeof result.rowcount !== 'number') {
    return [];
  }
  if (result.rowcount !== rowLimit) {
    return [];
  }
  return [
    {
      type: 'truncation',
      queryName: getQueryName(result),
      rowcount: result.rowcount,
      rowLimit,
    },
  ];
};

const splitSpecs = (specs: QuerySpec[]): [QuerySpec[], QuerySpec[]] => {
  const ordered = [...specs].sort((left, right) =>
    left.queryName.localeCompare(right.queryName),
  );
  const mid = Math.ceil(ordered.length / 2);
  return [ordered.slice(0, mid), ordered.slice(mid)];
};

export class SupersetChartDataClient implements ChartDataClient {
  private controllers = new Map<string, AbortController>();

  cancel(requestGroupId: string): void {
    const controller = this.controllers.get(requestGroupId);
    if (!controller) {
      return;
    }
    controller.abort();
    this.controllers.delete(requestGroupId);
  }

  private beginRequestGroup(requestGroupId: string): AbortSignal {
    const prev = this.controllers.get(requestGroupId);
    if (prev) {
      prev.abort();
    }
    const controller = new AbortController();
    this.controllers.set(requestGroupId, controller);
    return controller.signal;
  }

  private async executeBundle({
    formData,
    specs,
    signal,
  }: {
    formData: PivotTableQueryFormData;
    specs: QuerySpec[];
    signal?: AbortSignal;
  }): Promise<ChartDataQueryResult[]> {
    const queryContext = buildQueryContext(
      formData,
      (baseQueryObject: QueryObject) =>
        toChartDataQueries({ specs, baseQueryObject }),
    );

    const { json, response } = await SupersetClient.post({
      endpoint: '/api/v1/chart/data',
      jsonPayload: queryContext,
      ...(signal ? { signal } : {}),
    });

    if (response?.status === 413) {
      throw new RequestTooLargeError();
    }

    if (!isFeatureEnabled(FeatureFlag.GlobalAsyncQueries) && response) {
      if (response.status !== 200) {
        throw new Error(
          `Received unexpected response status (${response.status}) while fetching chart data`,
        );
      }
    }

    const resolved = await handleChartDataResponse({ response, json });
    const results = ensureIsArray(resolved) as ChartDataQueryResult[];
    const rowLimit =
      typeof formData.row_limit === 'number' ? formData.row_limit : undefined;

    return results.map(result =>
      applyWarnings(result, collectWarningsForResult(result, rowLimit)),
    );
  }

  private async fetchWithSplit({
    formData,
    specs,
    signal,
  }: {
    formData: PivotTableQueryFormData;
    specs: QuerySpec[];
    signal?: AbortSignal;
  }): Promise<ChartDataQueryResult[]> {
    try {
      return await this.executeBundle({ formData, specs, signal });
    } catch (error) {
      if (!isRequestTooLargeError(error) || specs.length <= 1) {
        throw error;
      }
      const [left, right] = splitSpecs(specs);
      const [leftResults, rightResults] = await Promise.all([
        this.fetchWithSplit({ formData, specs: left, signal }),
        this.fetchWithSplit({ formData, specs: right, signal }),
      ]);
      return [...leftResults, ...rightResults];
    }
  }

  async fetch({
    formData,
    specs,
    requestGroupId,
    signal,
  }: ChartDataFetchParams): Promise<ChartDataQueryResult[]> {
    if (specs.length === 0) {
      return [];
    }

    const resolvedSignal =
      signal ?? (requestGroupId ? this.beginRequestGroup(requestGroupId) : undefined);

    try {
      return await this.fetchWithSplit({ formData, specs, signal: resolvedSignal });
    } finally {
      if (requestGroupId && !signal) {
        this.controllers.delete(requestGroupId);
      }
    }
  }
}

export const supersetChartDataClient = new SupersetChartDataClient();
