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
  BinaryQueryObjectFilterClause,
  buildQueryContext,
  ensureIsArray,
  getColumnLabel,
  QueryFormColumn,
  QueryObject,
  QueryObjectFilterClause,
  SupersetClient,
  UnaryQueryObjectFilterClause,
} from '@superset-ui/core';
import {
  buildBranchQueryPairs,
  buildBranchTreeFromResults,
  resolveFetchContextForBatch,
} from '../../../fetchPivotBranch';
import { formatQueryName } from './queryName';
import {
  PivotAxis,
  PivotPath,
  PivotPathValue,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../../types';
import { parsePath, serializePath } from '../../../utils';
import { BatchGroup } from './fetchPlanOptimizer';
import { handleChartDataResponse } from './handleChartDataResponse';

export type FetchPivotBranchesBatchParams = {
  formData: PivotTableQueryFormData;
  batch: BatchGroup;
  currentTree: PivotTreeData;
  visibleRowDepth: number;
  visibleColDepth: number;
  getFetchPath: (path: PivotPath) => PivotPath;
};

export type FetchPivotBranchesBatchResult = {
  data?: PivotTreeData;
  error?: Error;
};

const isNullish = (value: PivotPathValue) =>
  value === null || value === undefined;

const buildPrefixFilters = (
  groupby: QueryFormColumn[],
  prefix: PivotPath,
): QueryObjectFilterClause[] =>
  prefix.map((value, index) => {
    if (isNullish(value)) {
      return {
        col: getColumnLabel(groupby[index]),
        op: 'IS NULL',
      } as UnaryQueryObjectFilterClause;
    }
    return {
      col: getColumnLabel(groupby[index]),
      op: '==',
      val: value,
    } as BinaryQueryObjectFilterClause;
  });

const buildSiblingFilter = (
  groupby: QueryFormColumn[],
  siblingIndex: number,
  siblings: PivotPathValue[],
): QueryObjectFilterClause[] => {
  if (siblings.length === 0) {
    return [];
  }
  const column = groupby[siblingIndex];
  if (!column) {
    return [];
  }
  if (siblings.some(isNullish)) {
    return [
      {
        col: getColumnLabel(column),
        op: 'IS NULL',
      } as UnaryQueryObjectFilterClause,
    ];
  }
  return [
    {
      col: getColumnLabel(column),
      op: 'IN',
      val: siblings,
    } as BinaryQueryObjectFilterClause,
  ];
};

export const fetchPivotBranchesBatch = async ({
  formData,
  batch,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  getFetchPath,
}: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
  const representativeKey = batch.targets[0]?.pathKey;
  if (!representativeKey) {
    return { data: undefined };
  }
  const metricPath = parsePath(representativeKey);
  const path = getFetchPath(metricPath);
  const ctx = resolveFetchContextForBatch({
    formData,
    axis: batch.axis,
    path,
    metricPath,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });
  const queryFormData =
    ctx.metricsForQuery.length > 0
      ? { ...formData, metrics: ctx.metricsForQuery }
      : formData;
  const queryPairs = buildBranchQueryPairs({
    axis: batch.axis,
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

  const parentPath = parsePath(batch.parentPathKey);
  const groupby =
    batch.axis === 'row' ? ctx.rowGroupbyForQuery : ctx.colGroupbyForQuery;
  const baseFilters = buildPrefixFilters(groupby, parentPath);
  const siblingFilters = buildSiblingFilter(
    groupby,
    parentPath.length,
    batch.siblingValues,
  );
  const batchFilters = [...baseFilters, ...siblingFilters];
  const batchKey = serializePath(parentPath);

  const queryContext = buildQueryContext(
    queryFormData,
    (baseQueryObject: QueryObject) =>
      queryPairs.map(pair => ({
        ...baseQueryObject,
        columns: [
          ...ctx.rowGroupbyForQuery.slice(0, pair.rowDepth),
          ...ctx.colGroupbyForQuery.slice(0, pair.colDepth),
        ],
        filters: [
          ...(baseQueryObject.filters || []),
          ...(batchFilters as QueryObjectFilterClause[]),
        ],
        query_name: `${formatQueryName(pair.rowDepth, pair.colDepth)}|batch:${batch.axis}:${batchKey}`,
      })),
  );

  try {
    const { json, response } = await SupersetClient.post({
      endpoint: '/api/v1/chart/data',
      jsonPayload: queryContext,
    });
    const resolved = await handleChartDataResponse({ response, json });
    const results = ensureIsArray(resolved) as Array<{
      data?: Record<string, unknown>[];
    }>;
    const tree = buildBranchTreeFromResults({
      results,
      queryPairs,
      metricsForQuery: ctx.metricsForQuery,
      formData,
      rowGroupby: ctx.rowGroupbyForQueryFull,
      colGroupby: ctx.colGroupbyForQueryFull,
      rowSubtotalLevels: ctx.rowSubtotalLevels,
      colSubtotalLevels: ctx.colSubtotalLevels,
      metricsLayoutResolved: ctx.metricsLayoutResolved,
      metricInsertIndex: ctx.metricInsertIndex,
    });
    return { data: tree };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};
