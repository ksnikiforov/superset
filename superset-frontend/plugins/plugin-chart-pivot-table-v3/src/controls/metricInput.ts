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
import { type Metric, type QueryFormMetric } from '@superset-ui/core';
import { AdhocMetric } from '../exploreImports';

/** Serializes editor metrics without losing explicit labels or generating persisted IDs. */
export const normalizeEditorMetric = (
  metric: Metric | AdhocMetric | QueryFormMetric,
): QueryFormMetric => {
  if (typeof metric === 'string') return metric;
  if ('metric_name' in metric && typeof metric.metric_name === 'string')
    return metric.metric_name;
  if (!(metric instanceof AdhocMetric) && !('expressionType' in metric))
    return metric as unknown as QueryFormMetric;
  const adhoc =
    metric instanceof AdhocMetric
      ? metric
      : new AdhocMetric(metric as ConstructorParameters<typeof AdhocMetric>[0]);
  return {
    expressionType: adhoc.expressionType === 'SQL' ? 'SQL' : 'SIMPLE',
    column: adhoc.column,
    aggregate: adhoc.aggregate,
    sqlExpression: adhoc.sqlExpression,
    label: metric.label || adhoc.label,
    hasCustomLabel: metric.hasCustomLabel ?? adhoc.hasCustomLabel,
    optionName:
      typeof metric.optionName === 'string' ? metric.optionName : undefined,
  } as QueryFormMetric;
};

/** Uses the same dataset policy for every pivot metric editor. */
export const disallowsAdhocMetrics = (extra: unknown): boolean => {
  try {
    const parsed: unknown =
      typeof extra === 'string' ? JSON.parse(extra) : extra;
    return Boolean(
      parsed &&
      typeof parsed === 'object' &&
      'disallow_adhoc_metrics' in parsed &&
      parsed.disallow_adhoc_metrics,
    );
  } catch {
    return false;
  }
};
