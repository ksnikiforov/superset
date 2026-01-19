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
  QueryFormOrderBy,
} from '@superset-ui/core';
import { PivotTableQueryFormData } from './types';

export const QUERY_NAME_PREFIX = 'pivot_v3';
export const formatQueryName = (rowDepth: number, colDepth: number) =>
  `${QUERY_NAME_PREFIX}|row${rowDepth}|col${colDepth}`;

export default function buildQuery(formData: PivotTableQueryFormData) {
  const metrics = ensureIsArray(formData.metrics);
  return buildQueryContext(formData, baseQueryObject => {
    const { series_limit_metric, order_desc } = baseQueryObject;
    const queryMetrics =
      metrics.length > 0 ? metrics : baseQueryObject.metrics;
    let orderby: QueryFormOrderBy[] | undefined;
    if (series_limit_metric) {
      orderby = [[series_limit_metric, !order_desc]];
    } else if (Array.isArray(queryMetrics)) {
      orderby = queryMetrics[0] ? [[queryMetrics[0], !order_desc]] : undefined;
    }

    return [
      {
        ...baseQueryObject,
        metrics: queryMetrics,
        orderby,
        columns: [],
        query_name: formatQueryName(0, 0),
      },
    ];
  });
}
