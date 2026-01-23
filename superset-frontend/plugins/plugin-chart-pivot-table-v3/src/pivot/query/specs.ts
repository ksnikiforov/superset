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
  type BinaryQueryObjectFilterClause,
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
  type QueryObjectFilterClause,
  type UnaryQueryObjectFilterClause,
} from '@superset-ui/core';
import {
  type MetricsLayoutEnum,
  type PivotAxis,
  type PivotPath,
  type PivotPathValue,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import { getStableColumnKey } from '../../utils';
import { serializePath, parsePath } from '../core/path';
import { buildLayoutContext, type LayoutContext } from '../layout/LayoutContext';
import { countDimDepth } from '../metricsTotals';
import { buildBatchSignature } from './batchSignature';
import { buildBranchQueryPairs } from './branchQueryPairs';
import { buildBootstrapPlanFromLayout } from './bootstrapPlanner';
import {
  type BatchCandidate,
  type BatchGroup,
  optimizeFetchPlan,
} from './fetchPlanOptimizer';
import { formatQueryName } from './queryName';
import { buildPathFilters } from './pathFilters';
import { coerceExpansionState } from './persistedExpansionState';
import { resolveFetchContextForBatch } from './resolveFetchContext';
import { buildQueryShape } from './queryShape';
import { type QuerySpec } from './types';

export type QuerySpecMeta = {
  kind: 'bootstrap' | 'root' | 'branch' | 'batch';
  axis?: PivotAxis;
  path?: PivotPath;
  metricPath?: PivotPath;
  parentPath?: PivotPath;
  siblingValues?: PivotPathValue[];
  rowDepth: number;
  colDepth: number;
  rowGroupbyForQueryFull: QueryFormColumn[];
  colGroupbyForQueryFull: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
};

export type PlannedQuerySpec = QuerySpec & {
  meta: QuerySpecMeta;
};

type DepthPair = { rowDepth: number; colDepth: number };

const createEmptyTree = (): PivotTreeData => ({ rows: {}, cols: {}, cells: {} });

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

const resolvePersisted = ({
  formData,
  rowKeys,
  colKeys,
  metricLabelSet,
  rowDepth,
  colDepth,
}: {
  formData: PivotTableQueryFormData;
  rowKeys: string[];
  colKeys: string[];
  metricLabelSet: Set<string>;
  rowDepth: number;
  colDepth: number;
}): {
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

const dedupePairs = (pairs: DepthPair[]) => {
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

const buildBranchSpecs = ({
  formData,
  layout,
  axis,
  path,
  metricPath,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  metricPath: PivotPath;
  currentTree: PivotTreeData;
  visibleRowDepth?: number;
  visibleColDepth?: number;
}): PlannedQuerySpec[] => {
  const ctx = resolveFetchContextForBatch({
    formData,
    layout,
    axis,
    path,
    metricPath,
    currentTree,
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

  const axisGroupby =
    axis === 'row' ? ctx.rowGroupbyForQuery : ctx.colGroupbyForQuery;
  const pathFilters = buildPathFilters(axisGroupby, ctx.sanitizedPath);
  const suffix = `|branch:${axis}:${serializePath(path)}`;

  return queryPairs.map(pair => ({
    queryName: `${formatQueryName(pair.rowDepth, pair.colDepth)}${suffix}`,
    columns: [
      ...ctx.rowGroupbyForQuery.slice(0, pair.rowDepth),
      ...ctx.colGroupbyForQuery.slice(0, pair.colDepth),
    ],
    metrics: ctx.metricsForQuery,
    filters: pathFilters,
    meta: {
      kind: 'branch',
      axis,
      path,
      metricPath,
      rowDepth: pair.rowDepth,
      colDepth: pair.colDepth,
      rowGroupbyForQueryFull: ctx.rowGroupbyForQueryFull,
      colGroupbyForQueryFull: ctx.colGroupbyForQueryFull,
      rowSubtotalLevels: ctx.rowSubtotalLevels,
      colSubtotalLevels: ctx.colSubtotalLevels,
      metricsLayoutResolved: ctx.metricsLayoutResolved,
      metricInsertIndex: ctx.metricInsertIndex,
    },
  }));
};

export const buildBranchQuerySpecs = (params: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  metricPath: PivotPath;
  currentTree: PivotTreeData;
  visibleRowDepth?: number;
  visibleColDepth?: number;
}): PlannedQuerySpec[] => buildBranchSpecs(params);

const isNullish = (value: PivotPathValue) =>
  value === null || value === undefined;

const buildBatchFilterClauses = ({
  axisGroupby,
  parentPath,
  siblingValues,
}: {
  axisGroupby: QueryFormColumn[];
  parentPath: PivotPath;
  siblingValues: PivotPathValue[];
}): QueryObjectFilterClause[] => {
  const prefixFilters = buildPathFilters(axisGroupby, parentPath);
  if (siblingValues.length === 0) {
    return prefixFilters;
  }
  const siblingIndex = parentPath.length;
  const siblingColumn = axisGroupby[siblingIndex];
  if (!siblingColumn) {
    return prefixFilters;
  }
  if (siblingValues.some(isNullish)) {
    return [
      ...prefixFilters,
      {
        col: getColumnLabel(siblingColumn),
        op: 'IS NULL',
      } as UnaryQueryObjectFilterClause,
    ];
  }
  return [
    ...prefixFilters,
    {
      col: getColumnLabel(siblingColumn),
      op: 'IN',
      val: siblingValues,
    } as BinaryQueryObjectFilterClause,
  ];
};

const buildBatchSpecs = ({
  formData,
  layout,
  axis,
  parentPathKey,
  siblingValues,
  chunkIndex,
  representative,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  parentPathKey: string;
  siblingValues: PivotPathValue[];
  chunkIndex: number;
  representative: { path: PivotPath; metricPath: PivotPath };
  currentTree: PivotTreeData;
  visibleRowDepth: number;
  visibleColDepth: number;
}): PlannedQuerySpec[] => {
  const parentPath = parsePath(parentPathKey);
  const ctx = resolveFetchContextForBatch({
    formData,
    layout,
    axis,
    path: representative.path,
    metricPath: representative.metricPath,
    currentTree,
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
  const axisGroupby =
    axis === 'row' ? ctx.rowGroupbyForQuery : ctx.colGroupbyForQuery;
  const filters = buildBatchFilterClauses({
    axisGroupby,
    parentPath,
    siblingValues,
  });
  const suffix = `|batch:${axis}:${parentPathKey}|chunk:${chunkIndex}`;

  return queryPairs.map(pair => ({
    queryName: `${formatQueryName(pair.rowDepth, pair.colDepth)}${suffix}`,
    columns: [
      ...ctx.rowGroupbyForQuery.slice(0, pair.rowDepth),
      ...ctx.colGroupbyForQuery.slice(0, pair.colDepth),
    ],
    metrics: ctx.metricsForQuery,
    filters,
    meta: {
      kind: 'batch',
      axis,
      parentPath,
      siblingValues,
      rowDepth: pair.rowDepth,
      colDepth: pair.colDepth,
      rowGroupbyForQueryFull: ctx.rowGroupbyForQueryFull,
      colGroupbyForQueryFull: ctx.colGroupbyForQueryFull,
      rowSubtotalLevels: ctx.rowSubtotalLevels,
      colSubtotalLevels: ctx.colSubtotalLevels,
      metricsLayoutResolved: ctx.metricsLayoutResolved,
      metricInsertIndex: ctx.metricInsertIndex,
    },
  }));
};

export const buildBatchQuerySpecs = ({
  formData,
  layout,
  batch,
  getFetchPath,
  currentTree,
  visibleRowDepth,
  visibleColDepth,
  chunkIndex = 0,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  batch: BatchGroup;
  getFetchPath?: (path: PivotPath) => PivotPath;
  currentTree: PivotTreeData;
  visibleRowDepth: number;
  visibleColDepth: number;
  chunkIndex?: number;
}): PlannedQuerySpec[] => {
  const representativeKey = batch.targets[0]?.pathKey;
  if (!representativeKey) {
    return [];
  }
  const metricPath = parsePath(representativeKey);
  const resolvedGetFetchPath = getFetchPath ?? layout.getFetchPath;
  const representative = {
    path: resolvedGetFetchPath(metricPath),
    metricPath,
  };
  return buildBatchSpecs({
    formData,
    layout,
    axis: batch.axis,
    parentPathKey: batch.parentPathKey,
    siblingValues: batch.siblingValues,
    chunkIndex,
    representative,
    currentTree,
    visibleRowDepth,
    visibleColDepth,
  });
};

export const buildInitialQuerySpecs = (
  formData: PivotTableQueryFormData,
  layout: LayoutContext = buildLayoutContext(formData),
): PlannedQuerySpec[] => {
  const {
    groupbyRows: rowGroupby,
    groupbyColumns: colGroupby,
    metrics,
    metricLabelSet,
  } = layout;
  const rowKeys = rowGroupby.map(getStableColumnKey);
  const colKeys = colGroupby.map(getStableColumnKey);
  const {
    rowSubtotalLevels,
    colSubtotalLevelsForQuery: colSubtotalLevels,
    resolvedExpandRowsLevel,
    resolvedExpandColsLevel,
  } = layout;

  const { rows, cols, collapsedRows, collapsedCols } = resolvePersisted({
    formData,
    rowKeys,
    colKeys,
    metricLabelSet,
    rowDepth: rowGroupby.length,
    colDepth: colGroupby.length,
  });

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

  const shouldPrefetchRoot = baseRowDepth > 1 || baseColDepth > 1;
  const bootstrapPlan = buildBootstrapPlanFromLayout(layout, formData);
  const emptyTree = createEmptyTree();

  const bootstrapTargets = shouldPrefetchRoot
    ? bootstrapPlan.targets.slice(0, 1)
    : bootstrapPlan.targets;

  const specs: PlannedQuerySpec[] = [];

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
    specs.push({
      queryName: formatQueryName(
        target.intent.targetRowDepth,
        target.intent.targetColDepth,
      ),
      columns: [...queryShape.rowGroupby, ...queryShape.colGroupby],
      metrics: queryShape.metrics,
      filters: [],
      meta: {
        kind: 'bootstrap',
        rowDepth: target.intent.targetRowDepth,
        colDepth: target.intent.targetColDepth,
        rowGroupbyForQueryFull: rowGroupby,
        colGroupbyForQueryFull: colGroupby,
        rowSubtotalLevels,
        colSubtotalLevels,
        metricsLayoutResolved: layout.metricsLayoutResolved,
        metricInsertIndex: layout.metricInsertIndex,
      },
    });
  });

  if (shouldPrefetchRoot) {
    const axis: PivotAxis = rowGroupby.length > 0 ? 'row' : 'col';
    const rootContext = resolveFetchContextForBatch({
      formData,
      layout,
      axis,
      path: [],
      metricPath: [],
      currentTree: emptyTree,
      visibleRowDepth: baseRowDepth,
      visibleColDepth: baseColDepth,
      targetRowDepth: baseRowDepth,
      targetColDepth: baseColDepth,
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
    queryPairs.forEach(pair => {
      specs.push({
        queryName: `${formatQueryName(pair.rowDepth, pair.colDepth)}|root`,
        columns: [
          ...rootContext.rowGroupbyForQuery.slice(0, pair.rowDepth),
          ...rootContext.colGroupbyForQuery.slice(0, pair.colDepth),
        ],
        metrics: rootContext.metricsForQuery,
        filters: [],
        meta: {
          kind: 'root',
          rowDepth: pair.rowDepth,
          colDepth: pair.colDepth,
          rowGroupbyForQueryFull: rootContext.rowGroupbyForQueryFull,
          colGroupbyForQueryFull: rootContext.colGroupbyForQueryFull,
          rowSubtotalLevels: rootContext.rowSubtotalLevels,
          colSubtotalLevels: rootContext.colSubtotalLevels,
          metricsLayoutResolved: rootContext.metricsLayoutResolved,
          metricInsertIndex: rootContext.metricInsertIndex,
        },
      });
    });
  }

  const buildPrefetchSpecsForAxis = (
    axis: PivotAxis,
    entries: Array<{ path: PivotPath; metricPath: PivotPath }>,
  ) => {
    if (entries.length === 0) {
      return;
    }

    const groupedKeyForPath = (metricPath: PivotPath) =>
      serializePath(metricPath.filter(val => !layout.isMetricTokenValue(val)));

    const representativeByKey = new Map<
      string,
      { path: PivotPath; metricPath: PivotPath }
    >();
    entries.forEach(entry => {
      const key = groupedKeyForPath(entry.metricPath);
      if (!representativeByKey.has(key)) {
        representativeByKey.set(key, entry);
      }
    });

    const candidates: BatchCandidate[] = [];
    representativeByKey.forEach((entry, pathKey) => {
      const ctx = resolveFetchContextForBatch({
        formData,
        layout,
        axis,
        path: entry.path,
        metricPath: entry.metricPath,
        currentTree: emptyTree,
        visibleRowDepth,
        visibleColDepth,
      });
      const batchSignature = buildBatchSignature({
        formData,
        layout,
        axis,
        path: entry.path,
        metricPath: entry.metricPath,
        currentTree: emptyTree,
        visibleRowDepth,
        visibleColDepth,
      });
      candidates.push({
        axis,
        pathKey,
        childDepth: axis === 'row' ? ctx.rowDepth : ctx.colDepth,
        requiredOppositeDepth: axis === 'row' ? ctx.colDepth : ctx.rowDepth,
        batchSignature,
      });
    });

    const { batches, singles } = optimizeFetchPlan({ targets: candidates });

    const sortedBatches = [...batches].sort((a, b) =>
      JSON.stringify([
        a.parentPathKey,
        a.signature,
        a.childDepth,
        a.requiredOppositeDepth,
      ]).localeCompare(
        JSON.stringify([
          b.parentPathKey,
          b.signature,
          b.childDepth,
          b.requiredOppositeDepth,
        ]),
      ),
    );

    const chunkIndexByGroup = new Map<string, number>();
    sortedBatches.forEach(batch => {
      const groupKey = JSON.stringify([
        batch.axis,
        batch.parentPathKey,
        batch.signature,
        batch.childDepth,
        batch.requiredOppositeDepth,
      ]);
      const index = chunkIndexByGroup.get(groupKey) ?? 0;
      const rep = representativeByKey.get(batch.targets[0].pathKey);
      if (!rep) {
        return;
      }
      specs.push(
        ...buildBatchSpecs({
          formData,
          layout,
          axis: batch.axis,
          parentPathKey: batch.parentPathKey,
          siblingValues: batch.siblingValues,
          chunkIndex: index,
          representative: rep,
          currentTree: emptyTree,
          visibleRowDepth,
          visibleColDepth,
        }),
      );
      chunkIndexByGroup.set(groupKey, index + 1);
    });

    const sortedSingles = [...singles].sort((a, b) =>
      a.pathKey.localeCompare(b.pathKey),
    );
    sortedSingles.forEach(candidate => {
      const rep = representativeByKey.get(candidate.pathKey);
      if (!rep) {
        return;
      }
      specs.push(
        ...buildBranchSpecs({
          formData,
          layout,
          axis,
          path: rep.path,
          metricPath: rep.metricPath,
          currentTree: emptyTree,
          visibleRowDepth,
          visibleColDepth,
        }),
      );
    });
  };

  buildPrefetchSpecsForAxis('row', rowTargets);
  buildPrefetchSpecsForAxis('col', colTargets);

  return specs;
};
