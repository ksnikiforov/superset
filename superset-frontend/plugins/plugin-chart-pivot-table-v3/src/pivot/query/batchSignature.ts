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
  type PivotTreeData,
} from '../../types';
import { type LayoutContext } from '../layout/LayoutContext';
import { stableStringify } from '../shared/stableStringify';
import { buildBranchQueryPairs } from './branchQueryPairs';
import { formatQueryName } from './queryName';
import { resolveFetchContextForBatch } from './resolveFetchContext';
import { toChartDataQueries } from './toChartDataQueries';
import { type QuerySpec } from './types';

export type BatchSignatureParams = {
  formData: PivotTableQueryFormData;
  layout?: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  currentTree: PivotTreeData;
  visibleRowDepth: number;
  visibleColDepth: number;
};

export const buildBatchSignature = ({
  formData,
  layout,
  axis,
  path,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
}: BatchSignatureParams): string => {
  const ctx = resolveFetchContextForBatch({
    formData,
    layout,
    axis,
    path,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });
  const queryFormData =
    ctx.metricsForQuery.length > 0
      ? { ...formData, metrics: ctx.metricsForQuery }
      : formData;
  const queryPairs = buildBranchQueryPairs({
    axis,
    pathLength: ctx.sanitizedPath.length,
    rowDepth: ctx.rowDepth,
    colDepth: ctx.colDepth,
    rowGroupby: ctx.rowGroupby,
    colGroupby: ctx.colGroupby,
    rowSubtotalLevels: ctx.rowSubtotalLevels,
    colSubtotalLevels: ctx.colSubtotalLevels,
    hasRowFormatting: ctx.hasRowFormatting,
    hasColFormatting: ctx.hasColFormatting,
    hasRowTotalSorting: ctx.hasRowTotalSorting,
    hasColTotalSorting: ctx.hasColTotalSorting,
    metricsLayoutResolved: ctx.metricsLayoutResolved,
    metricInsertIndex: ctx.metricInsertIndex,
    formData,
  });

  const specs: QuerySpec[] = queryPairs.map(pair => ({
    queryName: formatQueryName(pair.rowDepth, pair.colDepth),
    columns: [
      ...ctx.rowGroupbyForQuery.slice(0, pair.rowDepth),
      ...ctx.colGroupbyForQuery.slice(0, pair.colDepth),
    ],
    metrics: ctx.metricsForQuery,
    filters: [],
  }));

  const queryContext = buildQueryContext(
    queryFormData,
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
