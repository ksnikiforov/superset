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
import { buildQueryContext, type QueryObject } from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
} from '../../types';
import {
  buildLayoutContext,
  type LayoutContext,
} from '../layout/LayoutContext';
import { stableStringify } from '../shared/stableStringify';
import { formatQueryName } from './queryName';
import {
  buildFetchContextFactCoverages,
  resolveFetchContext,
} from './resolveFetchContext';
import { toChartDataQueries } from './toChartDataQueries';
import { type QuerySpec } from './specs';

export type BatchSignatureParams = {
  formData: PivotTableQueryFormData;
  layout?: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth: number;
  visibleColDepth: number;
};

export const buildBatchSignature = ({
  formData,
  layout,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
}: BatchSignatureParams): string => {
  const resolvedLayout = layout ?? buildLayoutContext(formData);
  const ctx = resolveFetchContext({
    formData,
    layout: resolvedLayout,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });
  const queryFormData =
    ctx.metricsForQuery.length > 0
      ? { ...formData, metrics: ctx.metricsForQuery }
      : formData;
  const timeOffsets = Array.from(
    new Set([...(formData.time_offsets ?? []), ...ctx.requiredTimeOffsets]),
  );
  const queryFormDataWithOffsets =
    timeOffsets.length > 0
      ? { ...queryFormData, time_offsets: timeOffsets }
      : queryFormData;
  const coverages = buildFetchContextFactCoverages({
    layout: resolvedLayout,
    axis,
    ctx,
  });

  const specs: QuerySpec[] = coverages.map(coverage => ({
    queryName: formatQueryName(coverage.rowDepth, coverage.columnDepth),
    columns: [...coverage.rowDimensions, ...coverage.columnDimensions],
    metrics: ctx.metricsForQuery,
    filters: [],
  }));

  const queryContext = buildQueryContext(
    queryFormDataWithOffsets,
    (baseQueryObject: QueryObject) =>
      toChartDataQueries({ specs, baseQueryObject }),
  );

  const queries = queryContext.queries.map(query => {
    const rest = { ...query };
    delete (rest as { query_name?: unknown }).query_name;
    return rest;
  });

  return stableStringify({
    axis,
    childDepth: axis === 'row' ? ctx.rowDepth : ctx.colDepth,
    requiredOppositeDepth: axis === 'row' ? ctx.colDepth : ctx.rowDepth,
    datasource: queryContext.datasource,
    queries,
  });
};
