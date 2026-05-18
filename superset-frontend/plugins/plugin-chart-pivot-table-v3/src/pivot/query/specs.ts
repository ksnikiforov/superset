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
import {
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  hasTotalSorting,
} from '../../utils';
import { serializePath, parsePath } from '../core/path';
import {
  buildLayoutContext,
  type LayoutContext,
} from '../layout/LayoutContext';
import { getMetricKey } from '../metrics';
import { collectRequiredTimeOffsets } from '../measureLeaves';
import { type BatchGroup } from './fetchPlanOptimizer';
import { formatQueryName } from './queryName';
import { buildPathFilters, coerceValueForColumn } from './pathFilters';
import { buildQueryShape, type QueryIntent } from './queryShape';
import {
  buildBranchFactCoverages,
  buildFactCoverage,
} from '../runtime/coverage';
import {
  buildFactValueKeys,
  type PivotFactSelector,
  type PivotFactStoreBatchScope,
} from '../runtime/factStore';
import {
  canRequestAxisExpansion,
  projectionQueryDimensions,
  projectionQueryFilterPath,
  resolveAxisProjection,
  type PivotAxisProjection,
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
  requiredTimeOffsets: string[];
  pivotProgram: PivotProgram;
  coverage: PivotFactCoverage;
  factSelector: PivotFactSelector;
};

export type PlannedQuerySpec = QuerySpec & {
  meta: QuerySpecMeta;
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

const factStoreScopeForMeta = ({
  layout,
  meta,
}: {
  layout: LayoutContext;
  meta: CoverageQueryMeta;
}): PivotFactStoreBatchScope => {
  if (meta.kind === 'branch') {
    if (!meta.axis) {
      throw new Error('Branch fact-store batch requires an axis');
    }
    return {
      kind: 'branch',
      axis: meta.axis,
      path: projectQueryFilterPath({
        layout,
        axis: meta.axis,
        path: meta.path ?? [],
      }),
    };
  }
  if (meta.kind === 'batch') {
    if (!meta.axis) {
      throw new Error('Batch fact-store batch requires an axis');
    }
    return {
      kind: 'batch',
      axis: meta.axis,
      parentPath: projectQueryFilterPath({
        layout,
        axis: meta.axis,
        path: meta.parentPath ?? [],
      }),
      siblingValues: meta.siblingValues ?? [],
    };
  }
  if (meta.kind === 'intersection') {
    return {
      kind: 'intersection',
      rowPaths: (meta.rowPaths ?? []).map(path =>
        projectQueryFilterPath({ layout, axis: 'row', path }),
      ),
      columnPaths: (meta.columnPaths ?? []).map(path =>
        projectQueryFilterPath({ layout, axis: 'col', path }),
      ),
    };
  }
  return { kind: meta.kind };
};

const buildSpecFactSelector = ({
  coverage,
  scope,
  metrics,
  requiredTimeOffsets,
}: {
  coverage: PivotFactCoverage;
  scope: PivotFactStoreBatchScope;
  metrics: QueryFormMetric[];
  requiredTimeOffsets: string[];
}): PivotFactSelector => ({
  coverage,
  scope,
  valueKeys: buildFactValueKeys({
    metricKeys: metrics.map(getMetricKey).filter(Boolean) as string[],
    requiredTimeOffsets,
  }),
});

const buildInitialRootIntents = (
  layout: LayoutContext,
  formData: PivotTableQueryFormData,
  prefetchRoot = false,
): QueryIntent[] => {
  const rowGroupby = layout.pivotProgram.rowDimensions;
  const colGroupby = layout.pivotProgram.columnDimensions;
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
  const firstRowDepth = rowGroupby.length > 0 ? 1 : 0;
  const firstColDepth = colGroupby.length > 0 ? 1 : 0;
  const needsGrid = firstRowDepth > 0 && firstColDepth > 0;
  const intentFlags = {
    needsMetricFormatting,
    needsDatabars,
    needsRowDimensionFormatting,
    needsColDimensionFormatting,
  };

  const intents: QueryIntent[] = [
    {
      targetRowDepth: 0,
      targetColDepth: 0,
      needsValueCells: false,
      needsTotals,
      needsMetricFormatting,
      needsDatabars: false,
      needsRowOrdering: false,
      needsColOrdering: false,
      needsRowDimensionFormatting: false,
      needsColDimensionFormatting: false,
    },
  ];

  const addCoverageTarget = ({
    rowDepth,
    colDepth,
    needsTotals: targetNeedsTotals,
    needsRowOrdering: targetNeedsRowOrdering,
    needsColOrdering: targetNeedsColOrdering,
    needsRowDimensionFormatting: targetNeedsRowDimensionFormatting,
    needsColDimensionFormatting: targetNeedsColDimensionFormatting,
  }: {
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
    intents.push({
      targetRowDepth: rowDepth,
      targetColDepth: colDepth,
      needsValueCells: true,
      ...intentFlags,
      needsTotals: targetNeedsTotals,
      needsRowOrdering: targetNeedsRowOrdering,
      needsColOrdering: targetNeedsColOrdering,
      needsRowDimensionFormatting: targetNeedsRowDimensionFormatting,
      needsColDimensionFormatting: targetNeedsColDimensionFormatting,
    });
  };

  if (needsGrid) {
    addCoverageTarget({
      rowDepth: firstRowDepth,
      colDepth: firstColDepth,
      needsTotals: false,
      needsRowOrdering,
      needsColOrdering,
      needsRowDimensionFormatting,
      needsColDimensionFormatting,
    });
  }

  if (
    rowGroupby.length > 0 &&
    (!needsGrid || needsRowTotals || firstRowDepth > 0)
  ) {
    addCoverageTarget({
      rowDepth: firstRowDepth,
      colDepth: 0,
      needsTotals,
      needsRowOrdering,
      needsColOrdering: false,
      needsRowDimensionFormatting,
      needsColDimensionFormatting: false,
    });
  }

  if (
    colGroupby.length > 0 &&
    (!needsGrid || needsColTotals || firstColDepth > 0)
  ) {
    addCoverageTarget({
      rowDepth: 0,
      colDepth: firstColDepth,
      needsTotals,
      needsRowOrdering: false,
      needsColOrdering,
      needsRowDimensionFormatting: false,
      needsColDimensionFormatting,
    });
  }

  return prefetchRoot ? intents.slice(0, 1) : intents;
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

type ResolvedFetchContext = {
  rowGroupbyForQuery: QueryFormColumn[];
  colGroupbyForQuery: QueryFormColumn[];
  metricsForQuery: QueryFormMetric[];
  requiredTimeOffsets: string[];
  sanitizedPath: PivotPath;
  coverages: PivotFactCoverage[];
};

const filterMetricsByScope = (
  metrics: QueryFormMetric[],
  metricKeys: string[],
): QueryFormMetric[] => {
  if (metricKeys.length === 0) {
    return metrics;
  }
  const metricKeySet = new Set(metricKeys);
  return metrics.filter(metric => metricKeySet.has(getMetricKey(metric)));
};

const filterMeasureHierarchyByScope = ({
  measureHierarchy,
  metricKeys,
  leafIds,
}: {
  measureHierarchy: MeasureHierarchy;
  metricKeys: string[];
  leafIds: string[];
}): MeasureHierarchy => {
  const metricKeySet = metricKeys.length > 0 ? new Set(metricKeys) : undefined;
  const leafIdSet = leafIds.length > 0 ? new Set(leafIds) : undefined;
  return {
    ...measureHierarchy,
    groups: measureHierarchy.groups
      .filter(group => !metricKeySet || metricKeySet.has(group.metricKey))
      .map(group => ({
        ...group,
        leaves: leafIdSet
          ? group.leaves.filter(leaf => leafIdSet.has(leaf.id))
          : group.leaves,
      }))
      .filter(group => group.leaves.length > 0),
  };
};

const resolveFetchContext = ({
  formData,
  layout,
  axis,
  path,
  visibleRowDepth = 0,
  visibleColDepth = 0,
  targetRowDepth,
  targetColDepth,
  coverageReason = 'expand',
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  targetRowDepth?: number;
  targetColDepth?: number;
  coverageReason?: PivotFactCoverage['reason'];
}): ResolvedFetchContext => {
  const { metrics } = layout;
  const rowGroupby = layout.pivotProgram.rowDimensions;
  const colGroupby = layout.pivotProgram.columnDimensions;
  const hasRowTotalSorting = hasTotalSorting(formData.rowSorting, rowGroupby);
  const hasColTotalSorting = hasTotalSorting(formData.colSorting, colGroupby);
  const maxRowSubtotalDepth = Math.max(rowGroupby.length - 1, 0);
  const rowSubtotalLevels = layout.rowSubtotalLevels.filter(
    level => level <= maxRowSubtotalDepth,
  );
  const maxColSubtotalDepth = Math.max(colGroupby.length - 1, 0);
  const colSubtotalLevels = layout.colSubtotalLevelsForQuery.filter(
    level => level <= maxColSubtotalDepth,
  );
  const projection: PivotAxisProjection = resolveAxisProjection({
    program: layout.pivotProgram,
    axis,
    path,
  });
  const sanitizedPath = projectionQueryFilterPath(projection);
  const rowGroupbyForBranch =
    axis === 'row' && targetRowDepth === undefined
      ? projectionQueryDimensions(projection)
      : rowGroupby;
  const colGroupbyForBranch =
    axis === 'col' && targetColDepth === undefined
      ? projectionQueryDimensions(projection)
      : colGroupby;
  const currentRowDepth = Math.min(visibleRowDepth, rowGroupbyForBranch.length);
  const currentColDepth = Math.min(visibleColDepth, colGroupbyForBranch.length);
  let rowDepth =
    axis === 'row'
      ? rowGroupbyForBranch.length
      : Math.min(rowGroupby.length, currentRowDepth);
  let colDepth =
    axis === 'col'
      ? colGroupbyForBranch.length
      : Math.min(colGroupby.length, currentColDepth);
  if (targetRowDepth !== undefined) {
    rowDepth = Math.min(rowGroupby.length, Math.max(targetRowDepth, 0));
  }
  if (targetColDepth !== undefined) {
    colDepth = Math.min(colGroupby.length, Math.max(targetColDepth, 0));
  }

  const needsMetricFormatting =
    Object.keys(formData.metricFormatting || {}).length > 0;
  const needsDatabars = Object.keys(formData.metricDatabars || {}).length > 0;
  const hasRowFormatting =
    collectDimensionFormattingMetricsForQuery(
      formData.rowFormatting,
      rowGroupby,
      metrics,
    ).length > 0;
  const hasColFormatting =
    collectDimensionFormattingMetricsForQuery(
      formData.colFormatting,
      colGroupby,
      metrics,
    ).length > 0;
  const needsRowOrdering =
    collectDimensionSortingMetricsForQuery(
      formData.rowSorting,
      rowGroupby,
      metrics,
    ).length > 0;
  const needsColOrdering =
    collectDimensionSortingMetricsForQuery(
      formData.colSorting,
      colGroupby,
      metrics,
    ).length > 0;
  const materializedMetrics = filterMetricsByScope(
    metrics,
    projection.metricKeys,
  );
  const materializedMeasureHierarchy = filterMeasureHierarchyByScope({
    measureHierarchy: layout.measureHierarchy,
    metricKeys: projection.metricKeys,
    leafIds: projection.measureLeafIds,
  });
  const requiredTimeOffsets = collectRequiredTimeOffsets(
    materializedMeasureHierarchy,
  );
  const needsTotals =
    !!formData.rowTotals ||
    !!formData.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const queryShape = buildQueryShape({
    intent: {
      targetRowDepth: rowDepth,
      targetColDepth: colDepth,
      needsValueCells: true,
      needsTotals,
      needsMetricFormatting,
      needsDatabars,
      needsRowOrdering,
      needsColOrdering,
      needsRowDimensionFormatting: hasRowFormatting,
      needsColDimensionFormatting: hasColFormatting,
    },
    rowGroupby: rowGroupbyForBranch,
    colGroupby: colGroupbyForBranch,
    metrics: materializedMetrics,
    availableMetrics: metrics,
    metricFormattingScope: formData.metricFormattingScope,
    metricFormatting: formData.metricFormatting,
    metricDatabars: formData.metricDatabars,
    rowFormatting: formData.rowFormatting,
    colFormatting: formData.colFormatting,
    rowSorting: formData.rowSorting,
    colSorting: formData.colSorting,
    measureHierarchy: materializedMeasureHierarchy,
  });
  const coverages = buildBranchFactCoverages({
    program: layout.pivotProgram,
    axis,
    projection,
    rowDepth,
    columnDepth: colDepth,
    rowDimensions: queryShape.rowGroupby,
    columnDimensions: queryShape.colGroupby,
    rowSubtotalLevels,
    columnSubtotalLevels: colSubtotalLevels,
    rowTotals: layout.rowTotals,
    columnTotals: layout.colTotals,
    includeRowTotalForColumnFormatting:
      axis === 'col' && (hasColFormatting || hasColTotalSorting),
    includeColumnTotalForRowFormatting:
      axis === 'row' && (hasRowFormatting || hasRowTotalSorting),
    reason: coverageReason,
  });

  return {
    rowGroupbyForQuery: queryShape.rowGroupby,
    colGroupbyForQuery: queryShape.colGroupby,
    metricsForQuery: queryShape.metrics,
    requiredTimeOffsets,
    sanitizedPath,
    coverages,
  };
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
    columns: [...coverage.rowDimensions, ...coverage.columnDimensions],
    metrics: ctx.metricsForQuery,
    filters,
    meta: {
      requiredTimeOffsets: ctx.requiredTimeOffsets,
      pivotProgram: layout.pivotProgram,
      coverage,
      factSelector: buildSpecFactSelector({
        coverage,
        scope: factStoreScopeForMeta({ layout, meta }),
        metrics: ctx.metricsForQuery,
        requiredTimeOffsets: ctx.requiredTimeOffsets,
      }),
    },
  }));

const buildAxisExpansionSpecs = ({
  formData,
  layout,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
  filters,
  suffix,
  meta,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  visibleRowDepth?: number;
  visibleColDepth?: number;
  filters: (ctx: ResolvedFetchContext) => QueryObjectFilterClause[];
  suffix: string;
  meta: CoverageQueryMeta;
}): PlannedQuerySpec[] => {
  if (!canRequestAxisExpansion({ program: layout.pivotProgram, axis, path })) {
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

  return buildSpecsForCoverages({
    coverages: ctx.coverages,
    ctx,
    layout,
    filters: filters(ctx),
    suffix,
    meta,
  });
};

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

export type ExpansionQuerySpecRequest =
  | {
      kind: 'branch';
      formData: PivotTableQueryFormData;
      layout: LayoutContext;
      axis: PivotAxis;
      path: PivotPath;
      visibleRowDepth?: number;
      visibleColDepth?: number;
    }
  | {
      kind: 'batch';
      formData: PivotTableQueryFormData;
      layout: LayoutContext;
      batch: BatchGroup;
      visibleRowDepth: number;
      visibleColDepth: number;
      chunkIndex?: number;
      representativePath?: PivotPath;
    }
  | {
      kind: 'intersection';
      formData: PivotTableQueryFormData;
      layout: LayoutContext;
      rowPathKeys: string[];
      columnPathKeys: string[];
      visibleRowDepth: number;
      visibleColDepth: number;
    };

export const buildExpansionQuerySpecs = (
  request: ExpansionQuerySpecRequest,
): PlannedQuerySpec[] => {
  if (request.kind === 'branch') {
    return buildAxisExpansionSpecs({
      ...request,
      filters: ctx =>
        buildPathFilters(
          request.axis === 'row'
            ? ctx.rowGroupbyForQuery
            : ctx.colGroupbyForQuery,
          ctx.sanitizedPath,
          request.formData.colTypeMap,
        ),
      suffix: `|branch:${request.axis}:${serializePath(request.path)}`,
      meta: { kind: 'branch', axis: request.axis, path: request.path },
    });
  }
  if (request.kind === 'batch') {
    const {
      formData,
      layout,
      batch,
      visibleRowDepth,
      visibleColDepth,
      chunkIndex = 0,
      representativePath,
    } = request;
    const representativeKey = batch.targets[0]?.pathKey;
    if (!representativeKey && !representativePath) {
      return [];
    }
    const representative = representativePath ?? parsePath(representativeKey);
    const parentPath = parsePath(batch.parentPathKey);
    const parentDimensionPath = projectQueryFilterPath({
      layout,
      axis: batch.axis,
      path: parentPath,
    });
    return buildAxisExpansionSpecs({
      formData,
      layout,
      axis: batch.axis,
      path: representative,
      visibleRowDepth,
      visibleColDepth,
      filters: ctx =>
        buildBatchFilterClauses({
          axisGroupby:
            batch.axis === 'row'
              ? ctx.rowGroupbyForQuery
              : ctx.colGroupbyForQuery,
          parentPath: parentDimensionPath,
          siblingValues: batch.siblingValues,
          colTypeMap: formData.colTypeMap,
        }),
      suffix: `|batch:${batch.axis}:${batch.parentPathKey}|chunk:${chunkIndex}`,
      meta: {
        kind: 'batch',
        axis: batch.axis,
        parentPath,
        siblingValues: batch.siblingValues,
      },
    });
  }

  const {
    formData,
    layout,
    rowPathKeys,
    columnPathKeys,
    visibleRowDepth,
    visibleColDepth,
  } = request;
  const rowPaths = rowPathKeys.map(parsePath);
  const columnPaths = columnPathKeys.map(parsePath);
  return buildAxisExpansionSpecs({
    formData,
    layout,
    axis: 'row',
    path: rowPaths[0] ?? [],
    visibleRowDepth,
    visibleColDepth,
    filters: ctx => [
      ...buildPathSetFilterClauses({
        axisGroupby: ctx.rowGroupbyForQuery,
        paths: rowPaths.map(path =>
          projectQueryFilterPath({
            layout,
            axis: 'row',
            path,
          }),
        ),
        colTypeMap: formData.colTypeMap,
      }),
      ...buildPathSetFilterClauses({
        axisGroupby: ctx.colGroupbyForQuery,
        paths: columnPaths.map(path =>
          projectQueryFilterPath({
            layout,
            axis: 'col',
            path,
          }),
        ),
        colTypeMap: formData.colTypeMap,
      }),
    ],
    suffix: `|intersection:${stableStringify([rowPathKeys, columnPathKeys])}`,
    meta: { kind: 'intersection', rowPaths, columnPaths },
  });
};

const buildInitialRootSpecs = ({
  formData,
  layout,
  intents,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  intents: QueryIntent[];
}): PlannedQuerySpec[] => {
  const { metrics } = layout;
  const rowGroupby = layout.pivotProgram.rowDimensions;
  const colGroupby = layout.pivotProgram.columnDimensions;

  return intents.flatMap(intent => {
    const coverage = buildFactCoverage({
      reason: 'initial',
      rowDimensions: layout.pivotProgram.rowDimensions,
      columnDimensions: layout.pivotProgram.columnDimensions,
      rowDepth: intent.targetRowDepth,
      columnDepth: intent.targetColDepth,
    });
    const queryShape = buildQueryShape({
      intent,
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
    return buildSpecsForCoverages({
      coverages: [coverage],
      ctx: {
        rowGroupbyForQuery: queryShape.rowGroupby,
        colGroupbyForQuery: queryShape.colGroupby,
        metricsForQuery: queryShape.metrics,
        requiredTimeOffsets: layout.requiredTimeOffsets,
        sanitizedPath: [],
        coverages: [coverage],
      },
      layout,
      filters: [],
      suffix: '',
      meta: { kind: 'root' },
    });
  });
};

const initialAxisCoverageDepth = (
  layout: LayoutContext,
  axis: PivotAxis,
): number =>
  layout.axisCoverageNeeds.reduce(
    (depth, need) => (need.axis === axis ? Math.max(depth, need.depth) : depth),
    0,
  );

export const buildInitialQuerySpecs = (
  formData: PivotTableQueryFormData,
  layout: LayoutContext = buildLayoutContext(formData),
): PlannedQuerySpec[] => {
  const rowGroupby = layout.pivotProgram.rowDimensions;
  const colGroupby = layout.pivotProgram.columnDimensions;
  const baseRowDepth =
    rowGroupby.length === 0
      ? 0
      : Math.min(
          rowGroupby.length,
          Math.max(1, initialAxisCoverageDepth(layout, 'row')),
        );
  const baseColDepth =
    colGroupby.length === 0
      ? 0
      : Math.min(
          colGroupby.length,
          Math.max(1, initialAxisCoverageDepth(layout, 'col')),
        );
  const shouldPrefetchRoot = baseRowDepth > 1 || baseColDepth > 1;
  const initialRootIntents = buildInitialRootIntents(
    layout,
    formData,
    shouldPrefetchRoot,
  );

  const specs: PlannedQuerySpec[] = buildInitialRootSpecs({
    formData,
    layout,
    intents: initialRootIntents,
  });

  if (shouldPrefetchRoot) {
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
        ctx: rowRootContext,
        layout,
        filters: [],
        suffix: '|root',
        meta: { kind: 'root' },
      }),
    );
  }

  return specs;
};
