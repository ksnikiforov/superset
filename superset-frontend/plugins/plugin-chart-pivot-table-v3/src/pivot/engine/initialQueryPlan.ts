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
import { QueryFormColumn, QueryFormMetric } from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  PivotAxis,
  PivotPath,
  PivotTableQueryFormData,
} from '../../types';
import { getStableColumnKey, parsePath, serializePath } from '../../utils';
import { countDimDepth } from '../metricsTotals';
import { coerceExpansionState } from './expansionStateModel';
import { buildBootstrapPlanFromLayout } from './bootstrapPlanner';
import { buildQueryShape } from './query/queryShape';
import {
  buildBranchQueryPairs,
  resolveFetchContextForBatch,
} from '../../fetchPivotBranch';
import { buildLayoutContext, LayoutContext } from '../layout/LayoutContext';

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

const collapseSet = (
  paths: PivotPath[],
  getFetchPath: (path: PivotPath) => PivotPath,
) => {
  const collapsed = new Set<string>();
  paths.forEach(path => {
    collapsed.add(serializePath(getFetchPath(path)));
  });
  return collapsed;
};

const uniqueTargets = (
  paths: PivotPath[],
  getFetchPath: (path: PivotPath) => PivotPath,
  collapsed: Set<string>,
) => {
  const result: Array<{ path: PivotPath; metricPath: PivotPath }> = [];
  const seen = new Set<string>();
  paths.forEach(metricPath => {
    const path = getFetchPath(metricPath);
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
): InitialQueryPlan =>
  buildInitialQueryPlanFromLayout(buildLayoutContext(formData), formData);

export const buildInitialQueryPlanFromLayout = (
  layout: LayoutContext,
  formData: PivotTableQueryFormData,
): InitialQueryPlan => {
  const {
    groupbyRows: rowGroupby,
    groupbyColumns: colGroupby,
    metrics,
  } = layout;
  const { metricLabelSet } = layout;
  const rowKeys = rowGroupby.map(getStableColumnKey);
  const colKeys = colGroupby.map(getStableColumnKey);
  const {
    rowSubtotalLevels,
    colSubtotalLevelsForQuery: colSubtotalLevels,
    resolvedExpandRowsLevel,
    resolvedExpandColsLevel,
  } = layout;

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
      ? collapseSet(collapsedRows, layout.getFetchPath)
      : new Set<string>();
  const colCollapsedSet =
    resolvedExpandColsLevel > 0
      ? collapseSet(collapsedCols, layout.getFetchPath)
      : new Set<string>();

  const rowTargets = uniqueTargets(rows, layout.getFetchPath, rowCollapsedSet);
  const colTargets = uniqueTargets(cols, layout.getFetchPath, colCollapsedSet);

  const shouldPrefetchRoot = visibleRowDepth > 1 || visibleColDepth > 1;
  const bootstrapPlan = buildBootstrapPlanFromLayout(layout, formData);
  const emptyTree = createEmptyTree();
  const targets: InitialQueryTarget[] = [];

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
      metricsLayoutResolved: layout.metricsLayoutResolved,
      metricInsertIndex: layout.metricInsertIndex,
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
