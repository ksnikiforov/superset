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
import { useEffect, useMemo, useState } from 'react';
import {
  type DataRecordValue,
  getTimeFormatter,
  type JsonObject,
  type QueryFormColumn,
  SMART_DATE_ID,
  SupersetClient,
  TimeFormats,
} from '@superset-ui/core';
import { type DateFormatter, type PivotTableQueryFormData } from '../../types';
import { coerceEpochMsStringToNumber, getStableColumnKey } from '../../utils';

const { DATABASE_DATETIME } = TimeFormats;

export type PivotDatasetMetaState = 'idle' | 'loading' | 'ready' | 'failed';

type DatasetColumnMeta = {
  column_name?: string;
  verbose_name?: string | null;
  python_date_format?: string | null;
};

type DatasetMeta = {
  verboseMap?: Record<string, string>;
  verbose_map?: Record<string, string>;
  columns?: DatasetColumnMeta[];
};

const datasetMetaCache = new Map<number, DatasetMeta>();

const normalizeVerboseMap = (
  verboseMap?: Record<string, unknown> | JsonObject,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(verboseMap ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

export const buildDateFormattersFromColumns = (
  columns: DatasetColumnMeta[],
  verboseMap: Record<string, string>,
): Record<string, DateFormatter | undefined> =>
  columns.reduce<Record<string, DateFormatter | undefined>>((acc, column) => {
    const columnName = column.column_name;
    const format = column.python_date_format;
    if (columnName && typeof format === 'string' && format.length > 0) {
      const base = getTimeFormatter(format);
      const formatter = (value: DataRecordValue) =>
        base(
          coerceEpochMsStringToNumber(value) as
            | number
            | Date
            | null
            | undefined,
        );
      acc[columnName] = formatter;
      const verbose = column.verbose_name || verboseMap[columnName];
      if (verbose) {
        acc[verbose] = formatter;
      }
    }
    return acc;
  }, {});

export const buildResolvedDateFormatters = ({
  dateFormatters,
  extraDateFormatters,
  fetchFormDataBase,
  resolvedVerboseMap,
}: {
  dateFormatters: Record<string, DateFormatter | undefined>;
  extraDateFormatters: Record<string, DateFormatter | undefined>;
  fetchFormDataBase: PivotTableQueryFormData;
  resolvedVerboseMap: Record<string, string>;
}): Record<string, DateFormatter | undefined> => {
  const merged: Record<string, DateFormatter | undefined> = {
    // Prefer dataset column formats (python_date_format) when available.
    // Dashboard payloads may omit python_date_format, so transformProps falls
    // back to a generic formatter. The dataset meta fetch should override
    // that fallback.
    ...dateFormatters,
    ...extraDateFormatters,
  };

  const temporalLookup = fetchFormDataBase.temporal_columns_lookup ?? {};
  const shouldCreateFallback =
    Object.keys(temporalLookup).length > 0 &&
    typeof fetchFormDataBase.dateFormat === 'string';
  if (!shouldCreateFallback) {
    return merged;
  }

  const formatId =
    fetchFormDataBase.dateFormat === SMART_DATE_ID
      ? DATABASE_DATETIME
      : fetchFormDataBase.dateFormat;
  const base = getTimeFormatter(formatId);
  const fallbackFormatter = (value: DataRecordValue) => {
    const normalized = coerceEpochMsStringToNumber(value);
    if (normalized === null || normalized === undefined) {
      return `${normalized}`;
    }
    if (typeof normalized === 'number' || normalized instanceof Date) {
      return base(normalized as number | Date | null | undefined);
    }
    if (typeof normalized === 'string') {
      const parsed = Date.parse(normalized);
      if (Number.isFinite(parsed)) {
        return base(parsed);
      }
    }
    return String(value);
  };

  Object.entries(temporalLookup).forEach(([columnLabel, isTemporal]) => {
    if (!isTemporal || merged[columnLabel]) {
      return;
    }
    merged[columnLabel] = fallbackFormatter;
    const verbose = resolvedVerboseMap[columnLabel];
    if (verbose && !merged[verbose]) {
      merged[verbose] = fallbackFormatter;
    }
  });

  return merged;
};

export const needsDatasetVerboseMap = ({
  dimensions,
  resolvedVerboseMap,
}: {
  dimensions: QueryFormColumn[];
  resolvedVerboseMap: Record<string, string>;
}) =>
  dimensions.some(dimension => {
    const key = getStableColumnKey(dimension);
    const mapped =
      resolvedVerboseMap[key] ||
      (typeof dimension === 'string' ? resolvedVerboseMap[dimension] : null);
    return !mapped;
  });

export const needsDatasetDateFormatters = ({
  formData,
  resolvedDateFormatters,
  resolvedVerboseMap,
}: {
  formData: PivotTableQueryFormData;
  resolvedDateFormatters: Record<string, DateFormatter | undefined>;
  resolvedVerboseMap: Record<string, string>;
}) => {
  const lookup = formData.temporal_columns_lookup ?? {};
  return Object.entries(lookup).some(([key, isTemporal]) => {
    if (!isTemporal) {
      return false;
    }
    const verbose = resolvedVerboseMap[key];
    return (
      !resolvedDateFormatters[key] &&
      (!verbose || !resolvedDateFormatters[verbose])
    );
  });
};

export const usePivotDatasetMeta = ({
  datasourceId,
  dimensions,
  formData,
  fetchFormDataBase,
  verboseMap,
  dateFormatters,
}: {
  datasourceId: number | null;
  dimensions: QueryFormColumn[];
  formData: PivotTableQueryFormData;
  fetchFormDataBase: PivotTableQueryFormData;
  verboseMap?: JsonObject;
  dateFormatters: Record<string, DateFormatter | undefined>;
}) => {
  const [extraVerboseMap, setExtraVerboseMap] = useState<
    Record<string, string>
  >({});
  const [extraDateFormatters, setExtraDateFormatters] = useState<
    Record<string, DateFormatter | undefined>
  >({});
  const [metaState, setMetaState] = useState<PivotDatasetMetaState>('idle');
  const resolvedVerboseMap = useMemo(
    () => ({ ...extraVerboseMap, ...normalizeVerboseMap(verboseMap) }),
    [extraVerboseMap, verboseMap],
  );
  const resolvedDateFormatters = useMemo(
    () =>
      buildResolvedDateFormatters({
        dateFormatters,
        extraDateFormatters,
        fetchFormDataBase,
        resolvedVerboseMap,
      }),
    [
      dateFormatters,
      extraDateFormatters,
      fetchFormDataBase,
      resolvedVerboseMap,
    ],
  );
  const needsVerboseMap = useMemo(
    () =>
      needsDatasetVerboseMap({
        dimensions,
        resolvedVerboseMap,
      }),
    [dimensions, resolvedVerboseMap],
  );
  const needsDateFormatters = useMemo(
    () =>
      needsDatasetDateFormatters({
        formData,
        resolvedDateFormatters,
        resolvedVerboseMap,
      }),
    [formData, resolvedDateFormatters, resolvedVerboseMap],
  );

  useEffect(() => {
    setMetaState('idle');
    setExtraVerboseMap({});
    setExtraDateFormatters({});
  }, [datasourceId]);

  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
    };

    if (datasourceId === null) {
      setMetaState('ready');
      return cleanup;
    }
    if (!needsVerboseMap && !needsDateFormatters) {
      setMetaState('ready');
      return cleanup;
    }
    const cached = datasetMetaCache.get(datasourceId);
    if (cached) {
      const cachedVerbose = cached.verboseMap ?? cached.verbose_map ?? {};
      setExtraVerboseMap(cachedVerbose);
      const cachedColumns = Array.isArray(cached.columns) ? cached.columns : [];
      setExtraDateFormatters(
        buildDateFormattersFromColumns(cachedColumns, cachedVerbose),
      );
      setMetaState('ready');
      return cleanup;
    }
    setMetaState('loading');
    SupersetClient.get({ endpoint: `/api/v1/dataset/${datasourceId}` })
      .then(({ json }) => {
        if (cancelled) {
          return;
        }
        const { result } = json as { result?: DatasetMeta };
        if (!result) {
          setMetaState('failed');
          return;
        }
        datasetMetaCache.set(datasourceId, result);
        const verboseFromApi = result.verboseMap ?? result.verbose_map ?? {};
        const columnsFromApi = Array.isArray(result.columns)
          ? result.columns
          : [];
        setExtraVerboseMap(verboseFromApi);
        setExtraDateFormatters(
          buildDateFormattersFromColumns(columnsFromApi, verboseFromApi),
        );
        setMetaState('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setMetaState('failed');
        }
      });
    return cleanup;
  }, [datasourceId, needsDateFormatters, needsVerboseMap]);

  return {
    resolvedVerboseMap,
    resolvedDateFormatters,
    metaState,
    needsVerboseMap,
    needsDateFormatters,
  };
};
