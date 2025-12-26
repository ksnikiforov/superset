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
} from '@superset-ui/core';
import { formatQueryName } from './buildQuery';
import { PivotAxis, PivotPath, PivotTableQueryFormData, PivotTreeData } from './types';
import { buildTreeFromRecords, mergeTrees, serializePath } from './utils';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
  cached?: boolean;
  error?: Error;
}

export interface FetchPivotBranchParams {
  formData: PivotTableQueryFormData;
  axis: PivotAxis;
  path: PivotPath;
  maxDepthPerFetch?: number;
  currentTree?: PivotTreeData;
}

const cache = new Map<string, PivotTreeData>();

const buildPathFilters = (
  groupby: QueryFormColumn[],
  path: PivotPath,
): BinaryQueryObjectFilterClause[] =>
  path.map((value, index) => ({
    col: getColumnLabel(groupby[index]),
    op: value === null || value === undefined ? 'IS NULL' : ('==' as const),
    val: value === null || value === undefined ? null : value,
  }));

export async function fetchPivotBranch({
  formData,
  axis,
  path,
  maxDepthPerFetch,
  currentTree,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const rowGroupby = ensureIsArray<QueryFormColumn>(formData.groupbyRows);
  const colGroupby = ensureIsArray<QueryFormColumn>(formData.groupbyColumns);
  const depthIncrement = Math.max(maxDepthPerFetch || formData.maxDepthPerFetch || 1, 1);

  const rowDepth =
    axis === 'row'
      ? Math.min(rowGroupby.length, path.length + depthIncrement)
      : rowGroupby.length;
  const colDepth =
    axis === 'col'
      ? Math.min(colGroupby.length, path.length + depthIncrement)
      : colGroupby.length;

  const cacheKey = `${axis}|${serializePath(path)}|${rowDepth}|${colDepth}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const columns = [
    ...rowGroupby.slice(0, rowDepth),
    ...colGroupby.slice(0, colDepth),
  ];

  const filters =
    axis === 'row'
      ? buildPathFilters(rowGroupby, path)
      : buildPathFilters(colGroupby, path);

  const queryContext = buildQueryContext(formData, (baseQueryObject: QueryObject) => [
    {
      ...baseQueryObject,
      columns,
      filters: [
        ...(baseQueryObject.filters || []),
        ...(filters as QueryObjectFilterClause[]),
      ],
      query_name: `${formatQueryName(rowDepth, colDepth)}|branch:${axis}:${serializePath(
        path,
      )}`,
    },
  ]);

  try {
    const { json = {} } = await SupersetClient.post({
      endpoint: '/api/v1/chart/data',
      jsonPayload: queryContext,
    });
    const [result] = (json as any).result || [];
    const branchTree = buildTreeFromRecords(
      result?.data || [],
      formData.metrics,
      rowGroupby,
      colGroupby,
      rowDepth,
      colDepth,
    );
    const merged = mergeTrees(currentTree, branchTree);
    cache.set(cacheKey, merged);
    return { data: merged };
  } catch (error) {
    return { error: error as Error };
  }
}
