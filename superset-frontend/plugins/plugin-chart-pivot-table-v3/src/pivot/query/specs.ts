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
  type DataRecordValue,
  type GenericDataType,
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
  type QueryObjectFilterClause,
  type SetQueryObjectFilterClause,
  type UnaryQueryObjectFilterClause,
} from '@superset-ui/core';
import {
  type MeasureHierarchy,
  type PivotAxis,
  type PivotPath,
  type PivotPathValue,
  type PivotTableQueryFormData,
} from '../../types';
import { getStableColumnKey, hasTotalSorting } from '../../utils';
import { serializePath, parsePath } from '../core/path';
import {
  buildLayoutContext,
  type LayoutContext,
} from '../layout/LayoutContext';
import { countDimDepth } from '../metricsTotals';
import { buildBatchSignature } from './batchSignature';
import {
  type BatchCandidate,
  type BatchGroup,
  optimizeFetchPlan,
} from './fetchPlanOptimizer';
import { formatQueryName } from './queryName';
import { buildPathFilters, coerceValueForColumn } from './pathFilters';
import { coerceExpansionState } from '../expansion/stateModel';
import {
  type ResolvedFetchContext,
  resolveFetchContext,
} from './resolveFetchContext';
import { buildQueryShape, type QueryIntent } from './queryShape';
import { buildFactCoverage } from '../runtime/coverage';
import {
  buildAxisCoverageKey,
  getNextAxisLevelForPath,
  projectionQueryFilterPath,
  resolveAxisProjection,
} from '../runtime/projection';
import { type PivotFactCoverage, type PivotProgram } from '../runtime/types';
import { stableStringify } from '../shared/stableStringify';

export type QuerySpec = {
  queryName: string;
  columns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  filters: QueryObjectFilterClause[];
};

export type QuerySpecMeta = {
  kind: 'bootstrap' | 'root' | 'branch' | 'batch' | 'intersection';
  axis?: PivotAxis;
  path?: PivotPath;
  parentPath?: PivotPath;
  siblingValues?: PivotPathValue[];
  rowPaths?: PivotPath[];
  columnPaths?: PivotPath[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  materializedMetrics: QueryFormMetric[];
  materializedMeasureHierarchy: MeasureHierarchy;
  requiredTimeOffsets: string[];
  pivotProgram: PivotProgram;
  coverage: PivotFactCoverage;
};

export type PlannedQuerySpec = QuerySpec & {
  meta: QuerySpecMeta;
};

type BootstrapTargetKind = 'totals' | 'grid' | 'rows' | 'cols';

type BootstrapTarget = {
  kind: BootstrapTargetKind;
  intent: QueryIntent;
  coverage: PivotFactCoverage;
};

type BootstrapPlanOptions = {
  prefetchRoot?: boolean;
};

type BuildIntentInput = {
  kind: BootstrapTargetKind;
  targetRowDepth: number;
  targetColDepth: number;
  needsTotals: boolean;
  needsMetricFormatting: boolean;
  needsDatabars: boolean;
  needsRowOrdering: boolean;
  needsColOrdering: boolean;
  needsRowDimensionFormatting: boolean;
  needsColDimensionFormatting: boolean;
};

const projectQueryFilterPath = ({
  layout,
  axis,
  path,
}: {
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
}) =>
  projectionQueryFilterPath(
    resolveAxisProjection({
      program: layout.pivotProgram,
      axis,
      path,
    }),
  );

const buildIntent = ({
  kind,
  targetRowDepth,
  targetColDepth,
  needsTotals,
  needsMetricFormatting,
  needsDatabars,
  needsRowOrdering,
  needsColOrdering,
  needsRowDimensionFormatting,
  needsColDimensionFormatting,
}: BuildIntentInput): QueryIntent => ({
  kind: kind === 'totals' ? 'totalsOnly' : 'wholeLevel',
  targetRowDepth,
  targetColDepth,
  needsValueCells: kind !== 'totals',
  needsTotals,
  needsMetricFormatting,
  needsDatabars: kind === 'totals' ? false : needsDatabars,
  needsRowOrdering,
  needsColOrdering,
  needsRowDimensionFormatting,
  needsColDimensionFormatting,
});

const firstVisibleDepth = (groupby: QueryFormColumn[]) =>
  groupby.length > 0 ? 1 : 0;

const buildBootstrapPlanFromLayout = (
  layout: LayoutContext,
  formData: PivotTableQueryFormData,
  options: BootstrapPlanOptions = {},
): BootstrapTarget[] => {
  const { groupbyRows: rowGroupby, groupbyColumns: colGroupby } = layout;
  const { rowSubtotalLevels, colSubtotalLevelsForQuery: colSubtotalLevels } =
    layout;
  const needsTotals =
    layout.rowTotals ||
    layout.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const needsMetricFormatting =
    Object.keys(formData.metricFormatting || {}).length > 0;
  const needsDatabars = Object.keys(formData.metricDatabars || {}).length > 0;
  const needsRowOrdering = Object.keys(formData.rowSorting || {}).length > 0;
  const needsColOrdering = Object.keys(formData.colSorting || {}).length > 0;
  const needsRowDimensionFormatting =
    Object.keys(formData.rowFormatting || {}).length > 0;
  const needsColDimensionFormatting =
    Object.keys(formData.colFormatting || {}).length > 0;
  const needsRowTotals =
    rowGroupby.length > 0 &&
    (layout.rowTotals ||
      rowSubtotalLevels.length > 0 ||
      hasTotalSorting(formData.rowSorting, rowGroupby));
  const needsColTotals =
    colGroupby.length > 0 &&
    (layout.colTotals ||
      colSubtotalLevels.length > 0 ||
      hasTotalSorting(formData.colSorting, colGroupby));
  const firstRowDepth = firstVisibleDepth(rowGroupby);
  const firstColDepth = firstVisibleDepth(colGroupby);
  const needsGrid = firstRowDepth > 0 && firstColDepth > 0;
  const intentFlags = {
    needsMetricFormatting,
    needsDatabars,
    needsRowDimensionFormatting,
    needsColDimensionFormatting,
  };

  const targets: BootstrapTarget[] = [
    {
      kind: 'totals',
      coverage: buildFactCoverage({
        reason: 'initial',
        rowDimensions: layout.pivotProgram.rowDimensions,
        columnDimensions: layout.pivotProgram.columnDimensions,
        rowDepth: 0,
        columnDepth: 0,
      }),
      intent: buildIntent({
        kind: 'totals',
        targetRowDepth: 0,
        targetColDepth: 0,
        needsTotals,
        needsMetricFormatting,
        needsDatabars,
        needsRowOrdering: false,
        needsColOrdering: false,
        needsRowDimensionFormatting: false,
        needsColDimensionFormatting: false,
      }),
    },
  ];

  const addCoverageTarget = ({
    kind,
    rowDepth,
    colDepth,
    needsTotals: targetNeedsTotals,
    needsRowOrdering: targetNeedsRowOrdering,
    needsColOrdering: targetNeedsColOrdering,
    needsRowDimensionFormatting: targetNeedsRowDimensionFormatting,
    needsColDimensionFormatting: targetNeedsColDimensionFormatting,
  }: {
    kind: Exclude<BootstrapTargetKind, 'totals'>;
    rowDepth: number;
    colDepth: number;
    needsTotals: boolean;
    needsRowOrdering: boolean;
    needsColOrdering: boolean;
    needsRowDimensionFormatting: boolean;
    needsColDimensionFormatting: boolean;
  }) => {
    if (layout.pivotProgram.metricKeys.length === 0) {
      return;
    }
    const coverage = buildFactCoverage({
      reason: 'initial',
      rowDimensions: layout.pivotProgram.rowDimensions,
      columnDimensions: layout.pivotProgram.columnDimensions,
      rowDepth,
      columnDepth: colDepth,
    });
    targets.push({
      kind,
      coverage,
      intent: buildIntent({
        kind,
        targetRowDepth: coverage.rowDepth,
        targetColDepth: coverage.columnDepth,
        ...intentFlags,
        needsTotals: targetNeedsTotals,
        needsRowOrdering: targetNeedsRowOrdering,
        needsColOrdering: targetNeedsColOrdering,
        needsRowDimensionFormatting: targetNeedsRowDimensionFormatting,
        needsColDimensionFormatting: targetNeedsColDimensionFormatting,
      }),
    });
  };

  if (needsGrid) {
    addCoverageTarget({
      kind: 'grid',
      rowDepth: firstRowDepth,
      colDepth: firstColDepth,
      needsTotals: false,
      needsRowOrdering,
      needsColOrdering,
      needsRowDimensionFormatting,
      needsColDimensionFormatting,
    });
  }

  if (rowGroupby.length > 0 && (!needsGrid || needsRowTotals)) {
    addCoverageTarget({
      kind: 'rows',
      rowDepth: firstRowDepth,
      colDepth: 0,
      needsTotals,
      needsRowOrdering,
      needsColOrdering: false,
      needsRowDimensionFormatting,
      needsColDimensionFormatting: false,
    });
  }

  if (colGroupby.length > 0 && (!needsGrid || needsColTotals)) {
    addCoverageTarget({
      kind: 'cols',
      rowDepth: 0,
      colDepth: firstColDepth,
      needsTotals,
      needsRowOrdering: false,
      needsColOrdering,
      needsRowDimensionFormatting: false,
      needsColDimensionFormatting,
    });
  }

  return options.prefetchRoot ? targets.slice(0, 1) : targets;
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
  layout: LayoutContext,
  axis: PivotAxis,
) => {
  const collapsed = new Set<string>();
  paths.forEach(path => {
    collapsed.add(
      buildAxisCoverageKey({ program: layout.pivotProgram, axis, path }),
    );
  });
  return collapsed;
};

const uniqueTargets = (
  paths: PivotPath[],
  layout: LayoutContext,
  axis: PivotAxis,
  collapsed: Set<string>,
) => {
  const result: PivotPath[] = [];
  const seen = new Set<string>();
  paths.forEach(path => {
    const key = buildAxisCoverageKey({
      program: layout.pivotProgram,
      axis,
      path,
    });
    if (collapsed.has(key) || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(path);
  });
  return result;
};

const dedupeCoverages = (coverages: PivotFactCoverage[]) => {
  const seen = new Set<string>();
  return coverages.filter(coverage => {
    const key = `${coverage.rowDepth}|${coverage.columnDepth}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const columnsForCoverage = (coverage: PivotFactCoverage) => [
  ...coverage.rowDimensions,
  ...coverage.columnDimensions,
];

type CoverageQueryMeta =
  | { kind: 'root' }
  | { kind: 'branch'; axis: PivotAxis; path: PivotPath }
  | {
      kind: 'batch';
      axis: PivotAxis;
      parentPath: PivotPath;
      siblingValues: PivotPathValue[];
    }
  | {
      kind: 'intersection';
      rowPaths: PivotPath[];
      columnPaths: PivotPath[];
    };

const buildSpecsForCoverages = ({
  coverages,
  ctx,
  layout,
  filters,
  suffix,
  meta,
}: {
  coverages: PivotFactCoverage[];
  ctx: ResolvedFetchContext;
  layout: LayoutContext;
  filters: QueryObjectFilterClause[];
  suffix: string;
  meta: CoverageQueryMeta;
}): PlannedQuerySpec[] =>
  coverages.map(coverage => ({
    queryName: `${formatQueryName(coverage.rowDepth, coverage.columnDepth)}${suffix}`,
    columns: columnsForCoverage(coverage),
    metrics: ctx.metricsForQuery,
    filters,
    meta: {
      ...meta,
      rowSubtotalLevels: ctx.rowSubtotalLevels,
      colSubtotalLevels: ctx.colSubtotalLevels,
      materializedMetrics: ctx.materializedMetrics,
      materializedMeasureHierarchy: ctx.materializedMeasureHierarchy,
      requiredTimeOffsets: ctx.requiredTimeOffsets,
      pivotProgram: layout.pivotProgram,
      coverage,
    },
  }));

const buildBranchSpecs = ({
  formData,
  layout,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth?: number;
  visibleColDepth?: number;
}): PlannedQuerySpec[] => {
  if (
    getNextAxisLevelForPath({
      program: layout.pivotProgram,
      axis,
      path,
    })?.kind === 'values'
  ) {
    return [];
  }

  const ctx = resolveFetchContext({
    formData,
    layout,
    axis,
    path,
    visibleRowDepth,
    visibleColDepth,
  });
  const axisGroupby =
    axis === 'row' ? ctx.rowGroupbyForQuery : ctx.colGroupbyForQuery;
  const pathFilters = buildPathFilters(
    axisGroupby,
    ctx.sanitizedPath,
    formData.colTypeMap,
  );
  const suffix = `|branch:${axis}:${serializePath(path)}`;

  return buildSpecsForCoverages({
    coverages: ctx.coverages,
    ctx,
    layout,
    filters: pathFilters,
    suffix,
    meta: { kind: 'branch', axis, path },
  });
};

export const buildBranchQuerySpecs = (params: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth?: number;
  visibleColDepth?: number;
}): PlannedQuerySpec[] => buildBranchSpecs(params);

const isNullish = (value: PivotPathValue) =>
  value === null || value === undefined;

const buildBatchFilterClauses = ({
  axisGroupby,
  parentPath,
  siblingValues,
  colTypeMap,
}: {
  axisGroupby: QueryFormColumn[];
  parentPath: PivotPath;
  siblingValues: PivotPathValue[];
  colTypeMap?: Record<string, GenericDataType>;
}): QueryObjectFilterClause[] => {
  const prefixFilters = buildPathFilters(axisGroupby, parentPath, colTypeMap);
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
  const resolvedSiblingValues = siblingValues.map(value =>
    coerceValueForColumn(value, siblingColumn, colTypeMap),
  ) as DataRecordValue[];
  const siblingClause: SetQueryObjectFilterClause = {
    col: getColumnLabel(siblingColumn),
    op: 'IN',
    val: resolvedSiblingValues,
  };
  return [...prefixFilters, siblingClause];
};

const buildPathSetFilterClauses = ({
  axisGroupby,
  paths,
  colTypeMap,
}: {
  axisGroupby: QueryFormColumn[];
  paths: PivotPath[];
  colTypeMap?: Record<string, GenericDataType>;
}): QueryObjectFilterClause[] => {
  const maxDepth = Math.max(0, ...paths.map(path => path.length));
  const filters: QueryObjectFilterClause[] = [];
  for (let index = 0; index < maxDepth; index += 1) {
    const column = axisGroupby[index];
    if (!column) {
      continue;
    }
    const values = Array.from(new Set(paths.map(path => path[index])));
    const nonNullValues = values.filter(value => !isNullish(value));
    if (nonNullValues.length === 0) {
      filters.push({
        col: getColumnLabel(column),
        op: 'IS NULL',
      } as UnaryQueryObjectFilterClause);
      continue;
    }
    const coercedValues = nonNullValues.map(value =>
      coerceValueForColumn(value, column, colTypeMap),
    ) as DataRecordValue[];
    if (coercedValues.length === 1 && nonNullValues.length === values.length) {
      filters.push({
        col: getColumnLabel(column),
        op: '==',
        val: coercedValues[0],
      } as QueryObjectFilterClause);
      continue;
    }
    filters.push({
      col: getColumnLabel(column),
      op: 'IN',
      val: coercedValues,
    } as SetQueryObjectFilterClause);
  }
  return filters;
};

const buildBatchSpecs = ({
  formData,
  layout,
  axis,
  parentPathKey,
  siblingValues,
  chunkIndex,
  representative,
  visibleRowDepth,
  visibleColDepth,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  parentPathKey: string;
  siblingValues: PivotPathValue[];
  chunkIndex: number;
  representative: PivotPath;
  visibleRowDepth: number;
  visibleColDepth: number;
}): PlannedQuerySpec[] => {
  if (
    getNextAxisLevelForPath({
      program: layout.pivotProgram,
      axis,
      path: representative,
    })?.kind === 'values'
  ) {
    return [];
  }

  const parentPath = parsePath(parentPathKey);
  const parentDimensionPath = projectQueryFilterPath({
    layout,
    axis,
    path: parentPath,
  });
  const ctx = resolveFetchContext({
    formData,
    layout,
    axis,
    path: representative,
    visibleRowDepth,
    visibleColDepth,
  });
  const axisGroupby =
    axis === 'row' ? ctx.rowGroupbyForQuery : ctx.colGroupbyForQuery;
  const filters = buildBatchFilterClauses({
    axisGroupby,
    parentPath: parentDimensionPath,
    siblingValues,
    colTypeMap: formData.colTypeMap,
  });
  const suffix = `|batch:${axis}:${parentPathKey}|chunk:${chunkIndex}`;

  return buildSpecsForCoverages({
    coverages: ctx.coverages,
    ctx,
    layout,
    filters,
    suffix,
    meta: { kind: 'batch', axis, parentPath, siblingValues },
  });
};

export const buildBatchQuerySpecs = ({
  formData,
  layout,
  batch,
  visibleRowDepth,
  visibleColDepth,
  chunkIndex = 0,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  batch: BatchGroup;
  visibleRowDepth: number;
  visibleColDepth: number;
  chunkIndex?: number;
}): PlannedQuerySpec[] => {
  const representativeKey = batch.targets[0]?.pathKey;
  if (!representativeKey) {
    return [];
  }
  const representative = parsePath(representativeKey);
  return buildBatchSpecs({
    formData,
    layout,
    axis: batch.axis,
    parentPathKey: batch.parentPathKey,
    siblingValues: batch.siblingValues,
    chunkIndex,
    representative,
    visibleRowDepth,
    visibleColDepth,
  });
};

export const buildIntersectionQuerySpecs = ({
  formData,
  layout,
  rowPathKeys,
  columnPathKeys,
  visibleRowDepth,
  visibleColDepth,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  rowPathKeys: string[];
  columnPathKeys: string[];
  visibleRowDepth: number;
  visibleColDepth: number;
}): PlannedQuerySpec[] => {
  const rowPaths = rowPathKeys.map(parsePath);
  const columnPaths = columnPathKeys.map(parsePath);
  const ctx = resolveFetchContext({
    formData,
    layout,
    axis: 'row',
    path: rowPaths[0] ?? [],
    visibleRowDepth,
    visibleColDepth,
  });
  const rowFilters = buildPathSetFilterClauses({
    axisGroupby: ctx.rowGroupbyForQuery,
    paths: rowPaths.map(path =>
      projectQueryFilterPath({
        layout,
        axis: 'row',
        path,
      }),
    ),
    colTypeMap: formData.colTypeMap,
  });
  const columnFilters = buildPathSetFilterClauses({
    axisGroupby: ctx.colGroupbyForQuery,
    paths: columnPaths.map(path =>
      projectQueryFilterPath({
        layout,
        axis: 'col',
        path,
      }),
    ),
    colTypeMap: formData.colTypeMap,
  });
  const suffix = `|intersection:${stableStringify([
    rowPathKeys,
    columnPathKeys,
  ])}`;

  return buildSpecsForCoverages({
    coverages: ctx.coverages,
    ctx,
    layout,
    filters: [...rowFilters, ...columnFilters],
    suffix,
    meta: { kind: 'intersection', rowPaths, columnPaths },
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
      ? collapseSet(collapsedRows, layout, 'row')
      : new Set<string>();
  const colCollapsedSet =
    resolvedExpandColsLevel > 0
      ? collapseSet(collapsedCols, layout, 'col')
      : new Set<string>();

  const rowTargets = uniqueTargets(rows, layout, 'row', rowCollapsedSet);
  const colTargets = uniqueTargets(cols, layout, 'col', colCollapsedSet);

  const shouldPrefetchRoot = baseRowDepth > 1 || baseColDepth > 1;
  const bootstrapPlan = buildBootstrapPlanFromLayout(layout, formData, {
    prefetchRoot: shouldPrefetchRoot,
  });

  const specs: PlannedQuerySpec[] = [];

  bootstrapPlan.forEach(target => {
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
      measureHierarchy: layout.measureHierarchy,
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
        rowSubtotalLevels,
        colSubtotalLevels,
        materializedMetrics: metrics,
        materializedMeasureHierarchy: layout.measureHierarchy,
        requiredTimeOffsets: layout.requiredTimeOffsets,
        pivotProgram: layout.pivotProgram,
        coverage: target.coverage,
      },
    });
  });

  if (shouldPrefetchRoot) {
    const axis: PivotAxis = rowGroupby.length > 0 ? 'row' : 'col';
    const rootContext = resolveFetchContext({
      formData,
      layout,
      axis,
      path: [],
      visibleRowDepth: baseRowDepth,
      visibleColDepth: baseColDepth,
      targetRowDepth: baseRowDepth,
      targetColDepth: baseColDepth,
      coverageReason: 'initial',
    });
    const rowRootContext = resolveFetchContext({
      formData,
      layout,
      axis: 'row',
      path: [],
      visibleRowDepth: baseRowDepth,
      visibleColDepth: baseColDepth,
      targetRowDepth: baseRowDepth,
      targetColDepth: baseColDepth,
      coverageReason: 'initial',
    });
    const colRootContext = resolveFetchContext({
      formData,
      layout,
      axis: 'col',
      path: [],
      visibleRowDepth: baseRowDepth,
      visibleColDepth: baseColDepth,
      targetRowDepth: baseRowDepth,
      targetColDepth: baseColDepth,
      coverageReason: 'initial',
    });
    specs.push(
      ...buildSpecsForCoverages({
        coverages: dedupeCoverages([
          ...rowRootContext.coverages,
          ...colRootContext.coverages,
        ]),
        ctx: rootContext,
        layout,
        filters: [],
        suffix: '|root',
        meta: { kind: 'root' },
      }),
    );
  }

  const buildPrefetchSpecsForAxis = (axis: PivotAxis, entries: PivotPath[]) => {
    if (entries.length === 0) {
      return;
    }

    const groupedKeyForPath = (path: PivotPath) =>
      buildAxisCoverageKey({ program: layout.pivotProgram, axis, path });

    const representativeByKey = new Map<string, PivotPath>();
    entries.forEach(path => {
      const key = groupedKeyForPath(path);
      if (!representativeByKey.has(key)) {
        representativeByKey.set(key, path);
      }
    });

    const candidates: BatchCandidate[] = [];
    representativeByKey.forEach((path, pathKey) => {
      const batchSignature = buildBatchSignature({
        formData,
        layout,
        axis,
        path,
        visibleRowDepth,
        visibleColDepth,
      });
      candidates.push({
        axis,
        pathKey,
        batchSignature,
      });
    });

    const { batches, singles } = optimizeFetchPlan({ targets: candidates });

    const sortedBatches = [...batches].sort((a, b) =>
      JSON.stringify([a.parentPathKey, a.signature]).localeCompare(
        JSON.stringify([b.parentPathKey, b.signature]),
      ),
    );

    const chunkIndexByGroup = new Map<string, number>();
    sortedBatches.forEach(batch => {
      const groupKey = JSON.stringify([
        batch.axis,
        batch.parentPathKey,
        batch.signature,
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
          path: rep,
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
