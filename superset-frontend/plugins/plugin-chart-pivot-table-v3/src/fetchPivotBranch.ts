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
  ensureIsArray,
  type DataRecord,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  PivotAxis,
  PivotPath,
  PivotTableQueryFormData,
  PivotTreeData,
} from './types';
import {
  buildTreeFromRecords,
  applyMeasureHierarchyAxis,
  mergeTrees,
  serializePath,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  serializeCellKey,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from './utils';
import { applyMeasureLeafValuesToTree } from './pivot/measureLeaves';
import {
  buildFilterSignature,
  buildPivotBranchCacheKey,
  clearPivotBranchCache as clearPivotBranchCacheBase,
  readPivotBranchCache,
  writePivotBranchCache,
} from './pivot/data/cache';
import { type ChartDataWarning } from './pivot/data/ChartDataClient';
import { supersetChartDataClient } from './pivot/data/SupersetChartDataClient';
import {
  buildLayoutContext,
  type LayoutContext,
} from './pivot/layout/LayoutContext';
import {
  resolveFetchContext as resolveFetchContextBase,
  type ResolvedFetchContext as ResolvedQueryFetchContext,
} from './pivot/query/resolveFetchContext';
import { buildBranchQuerySpecs } from './pivot/query/specs';
import { stableStringify as stableStringifyBase } from './pivot/shared/stableStringify';

export interface FetchPivotBranchResult {
  data?: PivotTreeData;
  cached?: boolean;
  warnings?: ChartDataWarning[];
  error?: Error;
}

export interface FetchPivotBranchParams {
  formData: PivotTableQueryFormData;
  axis: PivotAxis;
  path: PivotPath;
  currentTree?: PivotTreeData;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  targetRowDepth?: number;
  targetColDepth?: number;
  requestGroupId?: string;
}

export const stableStringify = stableStringifyBase;

export const peekPivotBranchCacheByKey = (key: string) =>
  readPivotBranchCache(key);
export const clearPivotBranchCache = () => clearPivotBranchCacheBase();

export type ResolvedFetchContext = ResolvedQueryFetchContext & {
  cacheKey: string;
  layout: LayoutContext;
};

const buildMeasureLeafSelectionSignature = (
  measureHierarchy: LayoutContext['measureHierarchy'],
): string => {
  if (measureHierarchy.kind !== 'measureStackV1') {
    return '';
  }
  return measureHierarchy.groups
    .map(group => ({
      metricKey: group.metricKey,
      leafIds: group.leaves.map(leaf => leaf.id).sort(),
    }))
    .sort((left, right) => left.metricKey.localeCompare(right.metricKey))
    .map(group => `${group.metricKey}:${group.leafIds.join(',')}`)
    .join('|');
};

const resolveFetchContext = ({
  formData,
  axis,
  path,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  targetRowDepth,
  targetColDepth,
}: FetchPivotBranchParams): ResolvedFetchContext => {
  const layout = buildLayoutContext(formData);
  const queryCtx = resolveFetchContextBase({
    formData,
    layout,
    axis,
    path,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
    targetRowDepth,
    targetColDepth,
  });
  const filterSignature = buildFilterSignature(formData);
  const cacheKey = buildPivotBranchCacheKey({
    axis,
    path,
    rowDepth: queryCtx.rowDepth,
    colDepth: queryCtx.colDepth,
    rowGroupby: queryCtx.rowGroupbyForQuery,
    colGroupby: queryCtx.colGroupbyForQuery,
    metrics:
      queryCtx.metricsForQuery.length > 0
        ? queryCtx.metricsForQuery
        : queryCtx.materializedMetrics,
    aggregateFunction: formData.aggregateFunction,
    filterSignature,
    cacheMeta: {
      datasource: formData.datasource,
      granularity: formData.granularity,
      granularity_sqla: formData.granularity_sqla,
      rowTotals: formData.rowTotals ?? false,
      colTotals: formData.colTotals ?? false,
      rowSubTotals: formData.rowSubTotals ?? true,
      rowSubtotalLevels: queryCtx.rowSubtotalLevels,
      colSubtotalLevels: queryCtx.colSubtotalLevels,
      metricsLayoutResolved: queryCtx.metricsLayoutResolved,
      metricInsertIndex: queryCtx.metricInsertIndex,
      timeOffsets: queryCtx.requiredTimeOffsets,
      measureLeafSelection: buildMeasureLeafSelectionSignature(
        queryCtx.materializedMeasureHierarchy,
      ),
    },
  });
  return { ...queryCtx, cacheKey, layout };
};

export const peekPivotBranchCache = (params: FetchPivotBranchParams) => {
  const ctx = resolveFetchContext(params);
  return readPivotBranchCache(ctx.cacheKey);
};

// Exported for tests
export const resolveFetchContextForTest = resolveFetchContext;
export const resolveFetchContextForBatch = resolveFetchContext;

function injectColumnSubtotalLeaves(
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) {
  if (depth <= 0 || depth >= fullDepth) {
    return tree;
  }
  const next: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };
  const subtotalNodes = Object.values(tree.cols).filter(
    node => node.path.length === depth && node.path.length > 0,
  );
  subtotalNodes.forEach(node => {
    const subtotalPath = [...node.path, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    if (!next.cols[subtotalKey]) {
      next.cols[subtotalKey] = {
        ...node,
        key: subtotalKey,
        path: subtotalPath,
        label: SUBTOTAL_LABEL,
        formattedLabel: SUBTOTAL_LABEL,
        level: subtotalPath.length,
        hasChildren: subtotalPath.length < fullDepth,
        isSubtotal: true,
      };
    }
  });
  Object.values(tree.cells).forEach(cell => {
    const baseColPath = tree.cols[cell.colKey]?.path;
    if (
      !baseColPath ||
      baseColPath.length !== depth ||
      baseColPath.length === 0
    ) {
      return;
    }
    const subtotalColKey = serializePath([...baseColPath, SUBTOTAL_TOKEN]);
    const cellKey = serializeCellKey(cell.rowKey, subtotalColKey);
    next.cells[cellKey] = {
      ...cell,
      colKey: subtotalColKey,
      isSubtotal: true,
    };
  });
  return next;
}

export const buildBranchTreeFromResults = ({
  results,
  queryPairs,
  metricsForQuery,
  formData,
  measureHierarchy,
  materializedMetrics,
  materializedMeasureHierarchy,
  rowGroupby,
  colGroupby,
  rowSubtotalLevels,
  colSubtotalLevels,
  metricsLayoutResolved,
  metricInsertIndex,
}: {
  results: Array<{ data?: DataRecord[] }>;
  queryPairs: Array<{ rowDepth: number; colDepth: number }>;
  metricsForQuery: QueryFormMetric[];
  formData: PivotTableQueryFormData;
  measureHierarchy: LayoutContext['measureHierarchy'];
  materializedMetrics?: QueryFormMetric[];
  materializedMeasureHierarchy?: LayoutContext['measureHierarchy'];
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
}): PivotTreeData => {
  const queryMetrics =
    metricsForQuery.length > 0 ? metricsForQuery : formData.metrics;
  const visibleMetrics = materializedMetrics ?? queryMetrics;
  const visibleMeasureHierarchy =
    materializedMeasureHierarchy ?? measureHierarchy;
  const branchTree = queryPairs.reduce<PivotTreeData>(
    (acc, pair, idx) =>
      mergeTrees(
        acc,
        (() => {
          let tree = buildTreeFromRecords(
            results[idx]?.data || [],
            queryMetrics,
            rowGroupby,
            colGroupby,
            pair.rowDepth,
            pair.colDepth,
            formData.dateFormatters,
          );
          if (colSubtotalLevels.includes(pair.colDepth)) {
            tree = injectColumnSubtotalLeaves(
              tree,
              pair.colDepth,
              colGroupby.length,
            );
          }
          const rowSubtotalDepths = rowSubtotalLevels.filter(
            level => level > 0 && level <= pair.rowDepth,
          );
          rowSubtotalDepths.forEach(depth => {
            tree = injectRowSubtotalLeaves(tree, depth, rowGroupby.length);
          });
          return tree;
        })(),
      ),
    {} as PivotTreeData,
  );
  const branchWithMeasures = applyMeasureHierarchyAxis(
    applyMeasureLeafValuesToTree({
      tree: branchTree,
      measureHierarchy: visibleMeasureHierarchy,
    }),
    visibleMeasureHierarchy,
    metricsLayoutResolved,
    rowGroupby,
    colGroupby,
    metricInsertIndex,
    formData.metricLabelMap as Record<string, string> | undefined,
  );
  return labelRowSubtotalLeaves(
    branchWithMeasures,
    ensureIsArray(visibleMetrics),
    formData.metricLabelMap as Record<string, string> | undefined,
  );
};

const isAbortError = (error: unknown): boolean => {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
};

export async function fetchPivotBranch({
  formData,
  axis,
  path,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
}: FetchPivotBranchParams): Promise<FetchPivotBranchResult> {
  const {
    rowGroupbyForQueryFull,
    colGroupbyForQueryFull,
    materializedMetrics,
    metricsForQuery,
    materializedMeasureHierarchy,
    requiredTimeOffsets,
    metricsLayoutResolved,
    metricInsertIndex,
    cacheKey,
    rowSubtotalLevels,
    colSubtotalLevels,
    layout,
  } = resolveFetchContext({
    formData,
    axis,
    path,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });
  const treeSnapshot = currentTree ?? { rows: {}, cols: {}, cells: {} };
  const timeOffsets = Array.from(
    new Set([...(formData.time_offsets ?? []), ...requiredTimeOffsets]),
  );
  const queryFormData =
    metricsForQuery.length > 0
      ? {
          ...formData,
          metrics: metricsForQuery,
          ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
        }
      : {
          ...formData,
          ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
        };

  const cached = readPivotBranchCache(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const specs = buildBranchQuerySpecs({
    formData,
    layout,
    axis,
    path,
    currentTree: treeSnapshot,
    visibleRowDepth,
    visibleColDepth,
  });
  const queryPairs = specs.map(spec => ({
    rowDepth: spec.meta.rowDepth,
    colDepth: spec.meta.colDepth,
  }));
  if (specs.length === 0) {
    return { data: undefined };
  }

  try {
    const results = await supersetChartDataClient.fetch({
      formData: queryFormData,
      specs,
      requestGroupId,
    });
    const warnings = results.flatMap(result => result.warnings ?? []);
    const resultsByQueryName = new Map<string, { data?: DataRecord[] }>();
    results.forEach(result => {
      const name =
        typeof result.query?.query_name === 'string'
          ? result.query.query_name
          : typeof result.query_name === 'string'
            ? result.query_name
            : undefined;
      if (name) {
        resultsByQueryName.set(name, result);
      }
    });
    const orderedResults =
      resultsByQueryName.size > 0
        ? specs.map(
            spec => resultsByQueryName.get(spec.queryName) ?? { data: [] },
          )
        : results;
    const labeledBranch = buildBranchTreeFromResults({
      results: orderedResults,
      queryPairs,
      metricsForQuery,
      formData,
      measureHierarchy: layout.measureHierarchy,
      materializedMetrics,
      materializedMeasureHierarchy,
      rowGroupby: rowGroupbyForQueryFull,
      colGroupby: colGroupbyForQueryFull,
      rowSubtotalLevels,
      colSubtotalLevels,
      metricsLayoutResolved,
      metricInsertIndex,
    });
    writePivotBranchCache(cacheKey, labeledBranch);
    return {
      data: labeledBranch,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
