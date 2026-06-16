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
import { useEffect, useState } from 'react';
import { ensureIsArray, SupersetClient } from '@superset-ui/core';

type DatasetMetadataColumn = {
  column_name?: unknown;
  verbose_name?: unknown;
};

type DatasetMetadataPayload = {
  verbose_map?: unknown;
  verboseMap?: unknown;
  columns?: DatasetMetadataColumn[] | DatasetMetadataColumn | null;
};

const datasetVerboseMapCache = new Map<string, Record<string, string>>();
const datasetVerboseMapRequests = new Map<
  string,
  Promise<Record<string, string>>
>();

const pickNonEmptyStringMap = (value: unknown): Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].length > 0,
        ),
      )
    : {};

export const clearDatasetVerboseMapCache = () => {
  datasetVerboseMapCache.clear();
  datasetVerboseMapRequests.clear();
};

export const buildDatasetVerboseMap = (
  payload: DatasetMetadataPayload,
): Record<string, string> => {
  const verboseMap = {
    ...pickNonEmptyStringMap(payload.verboseMap),
    ...pickNonEmptyStringMap(payload.verbose_map),
  };
  const columnVerboseMap = ensureIsArray<DatasetMetadataColumn>(
    payload.columns,
  ).reduce<Record<string, string>>((acc, column) => {
    if (
      typeof column.column_name === 'string' &&
      typeof column.verbose_name === 'string' &&
      column.verbose_name
    ) {
      acc[column.column_name] = column.verbose_name;
    }
    return acc;
  }, {});
  return {
    ...columnVerboseMap,
    ...verboseMap,
  };
};

export const getDatasetIdFromKey = (
  datasourceKey: unknown,
): string | undefined => {
  if (typeof datasourceKey !== 'string') {
    return undefined;
  }
  const [id] = datasourceKey.split('__');
  return id || undefined;
};

export const useDatasetVerboseMap = ({
  datasourceKey,
  enabled,
}: {
  datasourceKey: unknown;
  enabled: boolean;
}) => {
  const datasetId = getDatasetIdFromKey(datasourceKey);
  const cachedVerboseMap = datasetId
    ? datasetVerboseMapCache.get(datasetId)
    : undefined;
  const [verboseMap, setVerboseMap] = useState<Record<string, string>>(
    cachedVerboseMap ?? {},
  );
  const [failed, setFailed] = useState(false);
  const shouldLoad = Boolean(enabled && datasetId && !cachedVerboseMap);

  useEffect(() => {
    if (!enabled || !datasetId) {
      setFailed(false);
      setVerboseMap({});
      return;
    }
    const cached = datasetVerboseMapCache.get(datasetId);
    if (cached) {
      setFailed(false);
      setVerboseMap(cached);
      return;
    }
    let cancelled = false;
    setFailed(false);
    const request =
      datasetVerboseMapRequests.get(datasetId) ??
      SupersetClient.get({ endpoint: `/api/v1/dataset/${datasetId}` }).then(
        ({ json }) => {
          const payload =
            typeof json === 'object' &&
            json !== null &&
            'result' in json &&
            typeof json.result === 'object' &&
            json.result !== null
              ? (json.result as DatasetMetadataPayload)
              : {};
          const nextVerboseMap = buildDatasetVerboseMap(payload);
          datasetVerboseMapCache.set(datasetId, nextVerboseMap);
          datasetVerboseMapRequests.delete(datasetId);
          return nextVerboseMap;
        },
      );
    datasetVerboseMapRequests.set(datasetId, request);
    request
      .then(nextVerboseMap => {
        if (!cancelled) {
          setVerboseMap(nextVerboseMap);
        }
      })
      .catch(() => {
        datasetVerboseMapRequests.delete(datasetId);
        if (!cancelled) {
          setFailed(true);
          setVerboseMap({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, enabled]);

  return {
    verboseMap,
    loading: shouldLoad && !failed,
  };
};
