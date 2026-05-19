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
import { getMetricLabel, Metric, QueryFormMetric } from '@superset-ui/core';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getMetricOptionName = (metric: QueryFormMetric | Metric) => {
  if (isRecord(metric)) {
    const { optionName } = metric;
    if (typeof optionName === 'string' && optionName.trim().length > 0) {
      return optionName;
    }
  }
  return undefined;
};

export const getMetricKey = (metric: QueryFormMetric | Metric) => {
  if (typeof metric === 'string') {
    return metric;
  }
  const optionName = getMetricOptionName(metric);
  if (optionName) {
    return optionName;
  }
  if (isRecord(metric) && 'expressionType' in metric) {
    return getMetricLabel(metric as unknown as QueryFormMetric) || '';
  }
  if (isRecord(metric) && 'metric_name' in metric) {
    const metricName = metric.metric_name;
    if (typeof metricName === 'string' && metricName.trim().length > 0) {
      return metricName;
    }
  }
  return '';
};

export const getMetricKeys = (metrics: QueryFormMetric[]) =>
  metrics.map(getMetricKey).filter((m): m is string => !!m);

export const getFormattingMetricKey = (metric: QueryFormMetric | Metric) =>
  getMetricKey(metric);
