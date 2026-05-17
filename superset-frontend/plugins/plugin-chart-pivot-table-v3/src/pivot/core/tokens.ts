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
import { QueryFormColumn } from '@superset-ui/core';

export const METRICS_PLACEHOLDER = '__MEASURES__';
export const METRICS_PLACEHOLDER_LABEL = 'Σ Values';
export const METRIC_TOKEN_PREFIX = '__metric__';
export const MEASURE_LEAF_TOKEN_PREFIX = '__mleaf__';
export const SUBTOTAL_TOKEN = '\u0002subtotal';
export const SUBTOTAL_LABEL = 'Subtotal';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isSubtotalToken = (val: unknown) => val === SUBTOTAL_TOKEN;

export const encodeMetricKey = (metricKey: string) =>
  `${METRIC_TOKEN_PREFIX}${metricKey}`;

export const isMetricToken = (val: unknown): val is string =>
  typeof val === 'string' && val.startsWith(METRIC_TOKEN_PREFIX);

export const decodeMetricKey = (val: unknown): string | undefined =>
  isMetricToken(val) ? val.slice(METRIC_TOKEN_PREFIX.length) : undefined;

export const isMetricTokenForKeys = (
  val: unknown,
  metricKeys: ReadonlySet<string>,
) => {
  const decoded = decodeMetricKey(val);
  return decoded !== undefined && metricKeys.has(decoded);
};

export const encodeMeasureLeafKey = (leafId: string) =>
  `${MEASURE_LEAF_TOKEN_PREFIX}${leafId}`;

export const isMeasureLeafToken = (val: unknown): val is string =>
  typeof val === 'string' && val.startsWith(MEASURE_LEAF_TOKEN_PREFIX);

export const decodeMeasureLeafId = (val: unknown): string | undefined =>
  isMeasureLeafToken(val)
    ? val.slice(MEASURE_LEAF_TOKEN_PREFIX.length)
    : undefined;

export const findMeasureLeafIdInPath = (path: readonly unknown[]) =>
  [...path]
    .reverse()
    .map(val => decodeMeasureLeafId(val))
    .find((candidate): candidate is string => Boolean(candidate));

export const normalizePlaceholder = (val: QueryFormColumn) => {
  if (val === METRICS_PLACEHOLDER) return METRICS_PLACEHOLDER;
  if (
    isRecord(val) &&
    (val.column_name === METRICS_PLACEHOLDER ||
      val.label === METRICS_PLACEHOLDER)
  ) {
    return METRICS_PLACEHOLDER;
  }
  return val;
};

export const isMetricsPlaceholder = (val: QueryFormColumn) =>
  normalizePlaceholder(val) === METRICS_PLACEHOLDER;

export const stripMetricsPlaceholder = (groupby: QueryFormColumn[]) =>
  groupby.filter(col => !isMetricsPlaceholder(col));
