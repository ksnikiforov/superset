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
import { FeatureFlag, isFeatureEnabled } from '@superset-ui/core';
// eslint-disable-next-line import/no-extraneous-dependencies -- Phase 0.5 requires mirroring Superset core GAQ handling.
import { waitForAsyncData } from 'src/middleware/asyncEvent';

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

export const handleChartDataResponse = async ({
  response,
  json,
}: {
  response: Response;
  json: unknown;
}): Promise<unknown> => {
  if (!isFeatureEnabled(FeatureFlag.GlobalAsyncQueries)) {
    return unwrapResult(json);
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
