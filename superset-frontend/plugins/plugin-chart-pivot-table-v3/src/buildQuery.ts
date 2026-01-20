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
import { buildQueryContext, QueryFormOrderBy } from '@superset-ui/core';
import { PivotTableQueryFormData } from './types';
import { buildInitialQueryPlan } from './pivot/engine/initialQueryPlan';
import { buildPathFilters } from './pivot/engine/query/pathFilters';
import { formatQueryName } from './pivot/engine/query/queryName';
import { serializePath } from './utils';

export default function buildQuery(formData: PivotTableQueryFormData) {
  const plan = buildInitialQueryPlan(formData);
  return buildQueryContext(formData, baseQueryObject => {
    const { series_limit_metric, order_desc } = baseQueryObject;
    const queryMetrics =
      plan.metrics.length > 0 ? plan.metrics : baseQueryObject.metrics || [];
    let orderby: QueryFormOrderBy[] | undefined;
    if (series_limit_metric) {
      orderby = [[series_limit_metric, !order_desc]];
    } else if (Array.isArray(queryMetrics) && queryMetrics.length > 0) {
      orderby = [[queryMetrics[0], !order_desc]];
    }
    return plan.targets.flatMap(target => {
      const metricsForQuery =
        target.metricsForQuery.length > 0
          ? target.metricsForQuery
          : queryMetrics;
      return target.queryPairs.map(pair => {
        const queryName = formatQueryName(pair.rowDepth, pair.colDepth);
        const suffix =
          target.kind === 'branch'
            ? `|branch:${target.axis}:${serializePath(target.path)}`
            : target.kind === 'root'
              ? '|root'
              : '';
        const axisGroupby =
          target.axis === 'row'
            ? target.rowGroupbyForQuery
            : target.colGroupbyForQuery;
        const filters =
          target.kind === 'branch' && target.axis && axisGroupby
            ? buildPathFilters(axisGroupby, target.sanitizedPath)
            : [];
        return {
          ...baseQueryObject,
          metrics: metricsForQuery,
          orderby,
          columns: [
            ...target.rowGroupbyForQuery.slice(0, pair.rowDepth),
            ...target.colGroupbyForQuery.slice(0, pair.colDepth),
          ],
          filters: [...(baseQueryObject.filters || []), ...filters],
          query_name: `${queryName}${suffix}`,
        };
      });
    });
  });
}
