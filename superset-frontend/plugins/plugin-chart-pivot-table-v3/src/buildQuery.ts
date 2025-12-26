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
  AdhocColumn,
  buildQueryContext,
  ensureIsArray,
  isPhysicalColumn,
  QueryFormColumn,
  QueryFormOrderBy,
} from '@superset-ui/core';
import { PivotTableQueryFormData } from './types';

export const QUERY_NAME_PREFIX = 'pivot_v3';
export const formatQueryName = (rowDepth: number, colDepth: number) =>
  `${QUERY_NAME_PREFIX}|row${rowDepth}|col${colDepth}`;

const normalizeColumn = (
  col: QueryFormColumn,
  time_grain_sqla?: string,
  isTemporal?: boolean,
) => {
  if (isPhysicalColumn(col) && time_grain_sqla && isTemporal) {
    return {
      timeGrain: time_grain_sqla,
      columnType: 'BASE_AXIS',
      sqlExpression: col,
      label: col,
      expressionType: 'SQL',
    } as AdhocColumn;
  }
  return col;
};

export default function buildQuery(formData: PivotTableQueryFormData) {
  const {
    groupbyColumns = [],
    groupbyRows = [],
    extra_form_data,
    startCollapsed = true,
    rowTotals,
    colTotals,
    rowSubTotals,
    colSubTotals,
    initialDepth = 1,
  } = formData;

  const time_grain_sqla =
    extra_form_data?.time_grain_sqla || formData.time_grain_sqla;

  const rowGroupby = ensureIsArray<QueryFormColumn>(groupbyRows);
  const colGroupby = ensureIsArray<QueryFormColumn>(groupbyColumns);

  const isTotalsEnabled = rowTotals || colTotals || rowSubTotals || colSubTotals;
  const requireMultiQuery = startCollapsed || isTotalsEnabled;

  const rowDepthLimit = Math.min(
    rowGroupby.length,
    Math.max(initialDepth || 1, 1),
  );
  const colDepthLimit = Math.min(
    colGroupby.length,
    Math.max(initialDepth || 1, 1),
  );

  const temporalLookup = formData?.temporal_columns_lookup || {};
  const isTemporalColumn = (col: QueryFormColumn) =>
    isPhysicalColumn(col) &&
    (temporalLookup?.[col as string] || formData.granularity_sqla === col);

  return buildQueryContext(formData, baseQueryObject => {
    const { series_limit_metric, metrics, order_desc } = baseQueryObject;
    let orderby: QueryFormOrderBy[] | undefined;
    if (series_limit_metric) {
      orderby = [[series_limit_metric, !order_desc]];
    } else if (Array.isArray(metrics) && metrics[0]) {
      orderby = [[metrics[0], !order_desc]];
    }

    if (!requireMultiQuery) {
      return [
        {
          ...baseQueryObject,
          orderby,
        columns: [...rowGroupby, ...colGroupby].map(col =>
            normalizeColumn(col, time_grain_sqla, isTemporalColumn(col)),
          ),
          query_name: formatQueryName(rowGroupby.length, colGroupby.length),
        },
      ];
    }

    const rowDepths = new Set<number>();
    const colDepths = new Set<number>();

    if (rowTotals || rowSubTotals) {
      rowDepths.add(0);
    }
    if (colTotals || colSubTotals) {
      colDepths.add(0);
    }

    for (let depth = 1; depth <= rowDepthLimit; depth += 1) {
      rowDepths.add(depth);
    }
    for (let depth = 1; depth <= colDepthLimit; depth += 1) {
      colDepths.add(depth);
    }

    if (rowDepths.size === 0) {
      rowDepths.add(rowDepthLimit || 0);
    }
    if (colDepths.size === 0) {
      colDepths.add(colDepthLimit || 0);
    }

    const queries = Array.from(rowDepths).flatMap(rowDepth =>
      Array.from(colDepths).map(colDepth => ({
        ...baseQueryObject,
        orderby,
        columns: [
          ...rowGroupby
            .slice(0, rowDepth)
            .map(col =>
              normalizeColumn(col, time_grain_sqla, isTemporalColumn(col)),
            ),
          ...colGroupby
            .slice(0, colDepth)
            .map(col =>
              normalizeColumn(col, time_grain_sqla, isTemporalColumn(col)),
            ),
        ],
        query_name: formatQueryName(rowDepth, colDepth),
      })),
    );

    if (queries.length === 0) {
      queries.push({
        ...baseQueryObject,
        orderby,
        columns: [],
        query_name: formatQueryName(0, 0),
      });
    }

    return queries;
  });
}
