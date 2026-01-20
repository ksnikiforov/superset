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
  QueryFormColumn,
  QueryFormMetric,
} from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  PivotAxis,
  PivotPath,
  PivotTableQueryFormData,
} from '../../types';
import {
  decodeMetricKey,
  getMetricKeys,
  getStableColumnKey,
  normalizeSubtotalLevels,
  parsePath,
  resolveExpandLevel,
  resolveMetricPlacement,
  serializePath,
  stripMetricsPlaceholder,
} from '../../utils';
import { countDimDepth } from '../metricsTotals';
import { coerceExpansionState } from './expansionStateModel';
import { buildBootstrapPlan } from './bootstrapPlanner';
import { buildQueryShape } from './query/queryShape';
import {
  buildBranchQueryPairs,
  resolveFetchContextForBatch,
} from '../../fetchPivotBranch';

export type InitialQueryTarget = {
  kind: 'bootstrap' | 'root' | 'branch';
  axis?: PivotAxis;
  path: PivotPath;
  metricPath: PivotPath;
  sanitizedPath: PivotPath;
  queryPairs: Array<{ rowDepth: number; colDepth: number }>;
  rowGroupbyForQuery: QueryFormColumn[];
  colGroupbyForQuery: QueryFormColumn[];
  rowGroupbyForQueryFull: QueryFormColumn[];
  colGroupbyForQueryFull: QueryFormColumn[];
  metricsForQuery: QueryFormMetric[];
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
};

export type InitialQueryPlan = {
  targets: InitialQueryTarget[];
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
};

const getStablePrefixLength = (prev: string[], next: string[]) => {
  const limit = Math.min(prev.length, next.length);
  let prefix = 0;
  for (let idx = 0; idx < limit; idx += 1) {
    if (prev[idx] !== next[idx]) {
      return prefix;
    }
    prefix += 1;
  }
  return prefix;
};

const normalizeMetricPath = (path: PivotPath, metricLabelSet: Set<string>) =>
  path.map(val => {
    const decoded = decodeMetricKey(val);
    if (decoded && metricLabelSet.has(decoded)) {
      return decoded;
    }
    return val;
  });

const dedupePairs = (pairs: Array<{ rowDepth: number; colDepth: number }>) => {
  const seen = new Set<string>();
  return pairs.filter(pair => {
    const key = `${pair.rowDepth}|${pair.colDepth}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const maxExpandedDepth = (
  paths: PivotPath[],
  maxDepth: number,
  metricLabelSet: Set<string>,
) =>
  paths.reduce((max, path) => {
    const depth = countDimDepth(path, metricLabelSet);
    if (depth <= 0) {
      return max;
    }
    const expandedDepth = Math.min(maxDepth, depth + 1);
    return Math.max(max, expandedDepth);
  }, 0);

const prunePaths = (
  paths: PivotPath[],
  stablePrefix: number,
  maxDepth: number,
  metricLabelSet: Set<string>,
) =>
  paths.filter(path => {
    const depth = countDimDepth(path, metricLabelSet);
    return depth > 0 && depth <= Math.min(stablePrefix, maxDepth);
  });

const resolvePersisted = (
  formData: PivotTableQueryFormData,
  rowKeys: string[],
  colKeys: string[],
  metricLabelSet: Set<string>,
  rowDepth: number,
  colDepth: number,
): {
  rows: PivotPath[];
  cols: PivotPath[];
  collapsedRows: PivotPath[];
  collapsedCols: PivotPath[];
} => {
  const session = coerceExpansionState(formData.pivotExpansionState);
  if (!session) {
    return { rows: [], cols: [], collapsedRows: [], collapsedCols: [] };
  }
  const parsePaths = (values: string[]) => values.map(parsePath);
  const rowStablePrefix = getStablePrefixLength(session.rowKeys, rowKeys);
  const colStablePrefix = getStablePrefixLength(session.colKeys, colKeys);
  return {
    rows: prunePaths(
      parsePaths(session.rows),
      rowStablePrefix,
      rowDepth,
      metricLabelSet,
    ),
    cols: prunePaths(
      parsePaths(session.cols),
      colStablePrefix,
      colDepth,
      metricLabelSet,
    ),
    collapsedRows: prunePaths(
      parsePaths(session.collapsedRows),
      rowStablePrefix,
      rowDepth,
      metricLabelSet,
    ),
    collapsedCols: prunePaths(
      parsePaths(session.collapsedCols),
      colStablePrefix,
      colDepth,
      metricLabelSet,
    ),
  };
};

const collapseSet = (paths: PivotPath[], metricLabelSet: Set<string>) => {
  const collapsed = new Set<string>();
  paths.forEach(path => {
    const sanitized = normalizeMetricPath(path, metricLabelSet);
    collapsed.add(serializePath(sanitized));
  });
  return collapsed;
};

const uniqueTargets = (
  paths: PivotPath[],
  metricLabelSet: Set<string>,
  collapsed: Set<string>,
) => {
  const result: Array<{ path: PivotPath; metricPath: PivotPath }> = [];
  const seen = new Set<string>();
  paths.forEach(metricPath => {
    const path = normalizeMetricPath(metricPath, metricLabelSet);
    const key = serializePath(path);
    if (collapsed.has(key) || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({ path, metricPath });
  });
  return result;
};

const createEmptyTree = () => ({ rows: {}, cols: {}, cells: {} });

export const buildInitialQueryPlan = (
  formData: PivotTableQueryFormData,
): InitialQueryPlan => {
  const rowGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyRows);
  const colGroupbyRaw = ensureIsArray<QueryFormColumn>(formData.groupbyColumns);
  const metrics = ensureIsArray<QueryFormMetric>(formData.metrics);
  const metricLabelSet = new Set(getMetricKeys(metrics));
  const placement = resolveMetricPlacement(rowGroupbyRaw, colGroupbyRaw, {
    hasMetrics: metrics.length > 0,
    preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
  });
  const rowGroupby = stripMetricsPlaceholder(placement.rows);
  const colGroupby = stripMetricsPlaceholder(placement.cols);
  const rowKeys = rowGroupby.map(getStableColumnKey);
  const colKeys = colGroupby.map(getStableColumnKey);

  const resolvedStartCollapsed = formData.startCollapsed ?? true;
  const resolvedInitialDepth = formData.initialDepth ?? 1;
  const resolvedExpandRowsLevel = resolveExpandLevel(
    formData.expandRowsLevel ?? undefined,
    rowGroupby.length,
    resolvedStartCollapsed,
    resolvedInitialDepth,
  );
  const resolvedExpandColsLevel = resolveExpandLevel(
    formData.expandColumnsLevel ?? undefined,
    colGroupby.length,
    resolvedStartCollapsed,
    resolvedInitialDepth,
  );

  const rowSubTotalsEnabled = formData.rowSubTotals ?? true;
  const maxRowSubtotalDepth = Math.max(rowGroupby.length - 1, 0);
  const rowSubtotalLevels = normalizeSubtotalLevels(
    formData.rowSubtotalLevels,
    maxRowSubtotalDepth,
    formData.colTotals,
    rowSubTotalsEnabled,
  );
  const maxColSubtotalDepth = Math.max(colGroupby.length - 1, 0);
  const colSubtotalLevels = normalizeSubtotalLevels(
    ensureIsArray<number>(formData.colSubtotalLevels),
    maxColSubtotalDepth,
    false,
    false,
  ).filter(level => level > 0);

  const { rows, cols, collapsedRows, collapsedCols } = resolvePersisted(
    formData,
    rowKeys,
    colKeys,
    metricLabelSet,
    rowGroupby.length,
    colGroupby.length,
  );
  const baseRowDepth =
    rowGroupby.length === 0
      ? 0
      : Math.min(rowGroupby.length, Math.max(1, resolvedExpandRowsLevel));
  const baseColDepth =
    colGroupby.length === 0
      ? 0
      : Math.min(colGroupby.length, Math.max(1, resolvedExpandColsLevel));
  const persistedRowDepth = maxExpandedDepth(
    rows,
    rowGroupby.length,
    metricLabelSet,
  );
  const persistedColDepth = maxExpandedDepth(
    cols,
    colGroupby.length,
    metricLabelSet,
  );
  const visibleRowDepth = Math.max(baseRowDepth, persistedRowDepth);
  const visibleColDepth = Math.max(baseColDepth, persistedColDepth);
  const rowCollapsedSet =
    resolvedExpandRowsLevel > 0
      ? collapseSet(collapsedRows, metricLabelSet)
      : new Set<string>();
  const colCollapsedSet =
    resolvedExpandColsLevel > 0
      ? collapseSet(collapsedCols, metricLabelSet)
      : new Set<string>();

  const rowTargets = uniqueTargets(rows, metricLabelSet, rowCollapsedSet);
  const colTargets = uniqueTargets(cols, metricLabelSet, colCollapsedSet);

  const shouldPrefetchRoot = visibleRowDepth > 1 || visibleColDepth > 1;
  const bootstrapPlan = buildBootstrapPlan(formData);
  const emptyTree = createEmptyTree();
  const targets: InitialQueryTarget[] = [];

  const metricInsertIndex =
    placement.layout === MetricsLayoutEnum.ROWS
      ? placement.metricPosition >= 0
        ? Math.min(placement.metricPosition, rowGroupby.length)
        : rowGroupby.length
      : placement.metricPosition >= 0
        ? Math.min(placement.metricPosition, colGroupby.length)
        : colGroupby.length;

  const bootstrapTargets = shouldPrefetchRoot
    ? bootstrapPlan.targets.slice(0, 1)
    : bootstrapPlan.targets;

  bootstrapTargets.forEach(target => {
    const queryShape = buildQueryShape({
      intent: target.intent,
      rowGroupby,
      colGroupby,
      metrics,
      metricFormattingScope: formData.metricFormattingScope,
      metricFormatting: formData.metricFormatting,
      metricDatabars: formData.metricDatabars,
      rowFormatting: formData.rowFormatting,
      colFormatting: formData.colFormatting,
      rowSorting: formData.rowSorting,
      colSorting: formData.colSorting,
    });
    targets.push({
      kind: 'bootstrap',
      path: [],
      metricPath: [],
      sanitizedPath: [],
      queryPairs: [
        {
          rowDepth: target.intent.targetRowDepth,
          colDepth: target.intent.targetColDepth,
        },
      ],
      rowGroupbyForQuery: queryShape.rowGroupby,
      colGroupbyForQuery: queryShape.colGroupby,
      rowGroupbyForQueryFull: rowGroupby,
      colGroupbyForQueryFull: colGroupby,
      metricsForQuery: queryShape.metrics,
      metricsLayoutResolved: placement.layout,
      metricInsertIndex,
      rowSubtotalLevels,
      colSubtotalLevels,
    });
  });

  if (shouldPrefetchRoot) {
    const axis: PivotAxis = rowGroupby.length > 0 ? 'row' : 'col';
    const rootContext = resolveFetchContextForBatch({
      formData,
      axis,
      path: [],
      metricPath: [],
      currentTree: emptyTree,
      visibleRowDepth,
      visibleColDepth,
      targetRowDepth: visibleRowDepth,
      targetColDepth: visibleColDepth,
    });
    const rowPairs = buildBranchQueryPairs({
      axis: 'row',
      pathLength: 0,
      rowDepth: rootContext.rowDepth,
      colDepth: rootContext.colDepth,
      rowGroupby: rootContext.rowGroupby,
      colGroupby: rootContext.colGroupby,
      rowSubtotalLevels: rootContext.rowSubtotalLevels,
      colSubtotalLevels: rootContext.colSubtotalLevels,
      hasRowFormatting: rootContext.hasRowFormatting,
      hasColFormatting: rootContext.hasColFormatting,
      hasRowTotalSorting: rootContext.hasRowTotalSorting,
      hasColTotalSorting: rootContext.hasColTotalSorting,
      metricsLayoutResolved: rootContext.metricsLayoutResolved,
      metricInsertIndex: rootContext.metricInsertIndex,
      formData,
    });
    const colPairs = buildBranchQueryPairs({
      axis: 'col',
      pathLength: 0,
      rowDepth: rootContext.rowDepth,
      colDepth: rootContext.colDepth,
      rowGroupby: rootContext.rowGroupby,
      colGroupby: rootContext.colGroupby,
      rowSubtotalLevels: rootContext.rowSubtotalLevels,
      colSubtotalLevels: rootContext.colSubtotalLevels,
      hasRowFormatting: rootContext.hasRowFormatting,
      hasColFormatting: rootContext.hasColFormatting,
      hasRowTotalSorting: rootContext.hasRowTotalSorting,
      hasColTotalSorting: rootContext.hasColTotalSorting,
      metricsLayoutResolved: rootContext.metricsLayoutResolved,
      metricInsertIndex: rootContext.metricInsertIndex,
      formData,
    });
    const queryPairs = dedupePairs([...rowPairs, ...colPairs]);
    targets.push({
      kind: 'root',
      path: [],
      metricPath: [],
      sanitizedPath: [],
      queryPairs,
      rowGroupbyForQuery: rootContext.rowGroupbyForQuery,
      colGroupbyForQuery: rootContext.colGroupbyForQuery,
      rowGroupbyForQueryFull: rootContext.rowGroupbyForQueryFull,
      colGroupbyForQueryFull: rootContext.colGroupbyForQueryFull,
      metricsForQuery: rootContext.metricsForQuery,
      metricsLayoutResolved: rootContext.metricsLayoutResolved,
      metricInsertIndex: rootContext.metricInsertIndex,
      rowSubtotalLevels: rootContext.rowSubtotalLevels,
      colSubtotalLevels: rootContext.colSubtotalLevels,
    });
  }

  const buildBranchTargets = (
    axis: PivotAxis,
    entries: Array<{ path: PivotPath; metricPath: PivotPath }>,
  ) => {
    const sorted = [...entries].sort((a, b) =>
      serializePath(a.path).localeCompare(serializePath(b.path)),
    );
    sorted.forEach(({ path, metricPath }) => {
      const ctx = resolveFetchContextForBatch({
        formData,
        axis,
        path,
        metricPath,
        currentTree: emptyTree,
        visibleRowDepth,
        visibleColDepth,
      });
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
      targets.push({
        kind: 'branch',
        axis,
        path,
        metricPath,
        sanitizedPath: ctx.sanitizedPath,
        queryPairs,
        rowGroupbyForQuery: ctx.rowGroupbyForQuery,
        colGroupbyForQuery: ctx.colGroupbyForQuery,
        rowGroupbyForQueryFull: ctx.rowGroupbyForQueryFull,
        colGroupbyForQueryFull: ctx.colGroupbyForQueryFull,
        metricsForQuery: ctx.metricsForQuery,
        metricsLayoutResolved: ctx.metricsLayoutResolved,
        metricInsertIndex: ctx.metricInsertIndex,
        rowSubtotalLevels: ctx.rowSubtotalLevels,
        colSubtotalLevels: ctx.colSubtotalLevels,
      });
    });
  };

  buildBranchTargets('row', rowTargets);
  buildBranchTargets('col', colTargets);

  return {
    targets,
    rowGroupby,
    colGroupby,
    metrics,
  };
};
