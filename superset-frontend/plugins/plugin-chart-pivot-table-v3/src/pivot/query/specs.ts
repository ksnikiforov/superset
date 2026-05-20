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
  type DataRecordValue,
  type ExtraFormData,
  GenericDataType,
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
  type QueryObject,
  type QueryObjectFilterClause,
  type SetQueryObjectFilterClause,
  type UnaryQueryObjectFilterClause,
} from '@superset-ui/core';
import {
  type MeasureHierarchy,
  type MetricFormattingScope,
  type PivotAxis,
  type PivotDimensionFormattingMap,
  type PivotDimensionSortingMap,
  type PivotMetricDatabarMap,
  type PivotMetricFormattingMap,
  type PivotRuntimeLayout,
  type PivotPath,
  type PivotPathValue,
  type PivotTableQueryFormData,
} from '../../types';
import {
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  collectMeasureLeafMetricsForQuery,
  collectMetricDatabarMetricsForQuery,
  collectMetricFormattingMetricsForQuery,
  hasTotalSorting,
  mergeMetrics,
  getStableColumnKey,
} from '../../utils';
import { parsePath, serializePath } from '../core/path';
import {
  buildLayoutContext,
  type LayoutContext,
} from '../layout/LayoutContext';
import { resolveInteractionFormData } from '../layout/resolveInteractionLayout';
import { getMetricKey } from '../metrics';
import { collectRequiredTimeOffsets } from '../measureLeaves';
import { type ExpansionCoverageTarget } from '../expansion/planner';
import {
  buildPathFilters,
  coerceValueForColumn,
  normalizeTemporalValue,
} from './pathFilters';
import { buildFactCoverage, pathsFromAxisScope } from '../runtime/coverage';
import {
  buildFactValueKeys,
  type PivotFactSelector,
  type PivotFactMaterialization,
  type PivotFactStoreBatchScope,
} from '../runtime/factStore';
import {
  canRequestAxisExpansion,
  isValuesFirstOnAxis,
  resolveAxisProjection,
  type PivotAxisProjection,
} from '../runtime/projection';
import { type PivotFactCoverage } from '../runtime/types';
import { stableStringify } from '../shared/stableStringify';

export const QUERY_NAME_PREFIX = 'pivot_v3';
export const formatQueryName = (rowDepth: number, colDepth: number) =>
  `${QUERY_NAME_PREFIX}|row${rowDepth}|col${colDepth}`;

export type QuerySpec = {
  queryName: string;
  columns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  filters: QueryObjectFilterClause[];
};

export type QuerySpecMeta = {
  requiredTimeOffsets: string[];
  factSelector: PivotFactSelector;
};

export type PlannedQuerySpec = QuerySpec & {
  meta: QuerySpecMeta;
};

export const toChartDataQueries = ({
  specs,
  baseQueryObject,
}: {
  specs: QuerySpec[];
  baseQueryObject: QueryObject;
}): QueryObject[] =>
  specs.map(spec => ({
    ...baseQueryObject,
    columns: spec.columns,
    metrics:
      spec.metrics.length > 0
        ? spec.metrics
        : ((baseQueryObject.metrics ?? []) as QueryFormMetric[]),
    filters: [
      ...((baseQueryObject.filters ?? []) as QueryObjectFilterClause[]),
      ...spec.filters,
    ],
    query_name: spec.queryName,
  }));

type QueryShape = {
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
};

const buildQueryShape = ({
  rowDepth,
  columnDepth,
  hasValueCells,
  needsTotals,
  rowGroupby,
  colGroupby,
  metrics,
  availableMetrics = metrics,
  metricFormattingScope,
  metricFormatting,
  metricDatabars,
  rowFormatting,
  colFormatting,
  rowSorting,
  colSorting,
  measureHierarchy,
}: {
  rowDepth: number;
  columnDepth: number;
  hasValueCells: boolean;
  needsTotals: boolean;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metrics: QueryFormMetric[];
  availableMetrics?: QueryFormMetric[];
  metricFormattingScope?: MetricFormattingScope;
  metricFormatting?: PivotMetricFormattingMap;
  metricDatabars?: PivotMetricDatabarMap;
  rowFormatting?: PivotDimensionFormattingMap;
  colFormatting?: PivotDimensionFormattingMap;
  rowSorting?: PivotDimensionSortingMap;
  colSorting?: PivotDimensionSortingMap;
  measureHierarchy?: MeasureHierarchy;
}): QueryShape => {
  const rowGroupbyForQuery = rowGroupby.slice(0, rowDepth);
  const colGroupbyForQuery = colGroupby.slice(0, columnDepth);
  const metricKeys = new Set(
    metrics.map(getMetricKey).filter((key): key is string => Boolean(key)),
  );
  const filterMetricKeyedMap = <T>(
    map: Record<string, T> | undefined,
  ): Record<string, T> | undefined => {
    if (!map) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(map).filter(([metricKey]) => metricKeys.has(metricKey)),
    );
  };

  const extraMetrics: QueryFormMetric[] = [];
  if (
    metricFormattingScope === 'values'
      ? hasValueCells
      : hasValueCells || needsTotals
  ) {
    extraMetrics.push(
      ...collectMetricFormattingMetricsForQuery(
        filterMetricKeyedMap(metricFormatting),
        availableMetrics,
      ),
    );
  }
  if (hasValueCells) {
    extraMetrics.push(
      ...collectMetricDatabarMetricsForQuery(
        filterMetricKeyedMap(metricDatabars),
        availableMetrics,
      ),
    );
  }
  extraMetrics.push(
    ...collectDimensionFormattingMetricsForQuery(
      rowFormatting,
      rowGroupbyForQuery,
      availableMetrics,
    ),
    ...collectDimensionFormattingMetricsForQuery(
      colFormatting,
      colGroupbyForQuery,
      availableMetrics,
    ),
    ...collectDimensionSortingMetricsForQuery(
      rowSorting,
      rowGroupbyForQuery,
      availableMetrics,
    ),
    ...collectDimensionSortingMetricsForQuery(
      colSorting,
      colGroupbyForQuery,
      availableMetrics,
    ),
  );
  extraMetrics.push(
    ...collectMeasureLeafMetricsForQuery(
      measureHierarchy,
      metrics,
      availableMetrics,
    ),
  );

  return {
    rowGroupby: rowGroupbyForQuery,
    colGroupby: colGroupbyForQuery,
    metrics: mergeMetrics(metrics, extraMetrics),
  };
};

type ResolvedFetchContext = {
  rowGroupbyForQuery: QueryFormColumn[];
  colGroupbyForQuery: QueryFormColumn[];
  metricsForQuery: QueryFormMetric[];
  requiredTimeOffsets: string[];
  materialization?: PivotFactMaterialization;
  coverages: PivotFactCoverage[];
};

type PlannedQuerySpecParams = {
  coverage: PivotFactCoverage;
  metrics: QueryFormMetric[];
  requiredTimeOffsets: string[];
  materialization?: PivotFactMaterialization;
  scope: PivotFactStoreBatchScope;
  filters: QueryObjectFilterClause[];
  suffix: string;
};

type DepthPair = { rowDepth: number; columnDepth: number };

const parentDepth = (depth: number) => Math.max(depth - 1, 0);

const rangeFromOne = (depth: number): number[] =>
  Array.from({ length: depth }, (_, idx) => idx + 1);

const uniqueDepths = (depths: number[]) => Array.from(new Set(depths));

const buildBranchFactCoverages = ({
  program,
  axis,
  coverageTarget,
  branchAnchorDepth,
  rowSubtotalLevels,
  columnSubtotalLevels,
  rowTotals = false,
  columnTotals = false,
  includeRowTotalForColumnFormatting = false,
  includeColumnTotalForRowFormatting = false,
}: {
  program: LayoutContext['pivotProgram'];
  axis: PivotAxis;
  coverageTarget: ExpansionCoverageTarget;
  branchAnchorDepth: number;
  rowSubtotalLevels: number[];
  columnSubtotalLevels: number[];
  rowTotals?: boolean;
  columnTotals?: boolean;
  includeRowTotalForColumnFormatting?: boolean;
  includeColumnTotalForRowFormatting?: boolean;
}): PivotFactCoverage[] => {
  const depthPairs: DepthPair[] = [];
  const addDepthPair = (rowDepthVal: number, columnDepthVal: number) => {
    const key = `${rowDepthVal}|${columnDepthVal}`;
    if (
      depthPairs.find(pair => `${pair.rowDepth}|${pair.columnDepth}` === key)
    ) {
      return;
    }
    depthPairs.push({
      rowDepth: rowDepthVal,
      columnDepth: columnDepthVal,
    });
  };
  const addDepthGrid = (rowDepths: number[], columnDepths: number[]) => {
    uniqueDepths(rowDepths).forEach(rowDepthVal => {
      uniqueDepths(columnDepths).forEach(columnDepthVal =>
        addDepthPair(rowDepthVal, columnDepthVal),
      );
    });
  };
  const { rowDepth, columnDepth, rowDimensions, columnDimensions } =
    coverageTarget.need;
  addDepthPair(rowDepth, columnDepth);

  const valuesAtRowFront = isValuesFirstOnAxis(program, 'row');
  const valuesAtColumnFront = isValuesFirstOnAxis(program, 'col');
  const rowParentDepth = parentDepth(rowDepth);
  const columnParentDepth = parentDepth(columnDepth);

  if (axis === 'col' && columnDepth > 0) {
    if (valuesAtRowFront && rowDepth > 0) {
      addDepthPair(0, columnDepth);
    }
    if (rowDepth > 0) {
      addDepthGrid(rowDepth === 1 ? [0, 1] : rangeFromOne(rowDepth), [
        columnDepth,
        columnParentDepth,
      ]);
    } else if (program.valueAxis === 'col') {
      addDepthPair(rowDepth, columnParentDepth);
    }
  }

  if (axis === 'row' && columnDepth > 0) {
    if (valuesAtColumnFront) {
      addDepthPair(rowDepth, 0);
    }
    addDepthGrid(
      rowDepth > 0 ? [rowDepth, rowParentDepth] : [rowDepth],
      rangeFromOne(columnDepth),
    );
  }

  if (program.valueAxis === 'col' && columnDepth > 0) {
    addDepthGrid(rowDepth > 0 ? [rowDepth, rowParentDepth] : [rowDepth], [
      columnParentDepth,
    ]);
    if (rowDepth > 0) {
      addDepthPair(rowParentDepth, columnDepth);
    }
  }

  const effectiveRowLevels = Array.from(
    new Set([
      ...rowSubtotalLevels,
      ...(includeRowTotalForColumnFormatting ? [0] : []),
    ]),
  ).filter(level => level <= rowDepth);
  const effectiveColumnLevels = Array.from(
    new Set([
      ...columnSubtotalLevels,
      ...(rowTotals ? [0] : []),
      ...(includeColumnTotalForRowFormatting ? [0] : []),
    ]),
  ).filter(level => level <= columnDepth);
  addDepthGrid(
    [rowDepth, ...effectiveRowLevels],
    [columnDepth, ...effectiveColumnLevels],
  );

  const queryPairs =
    branchAnchorDepth === 0
      ? depthPairs
      : depthPairs.filter(pair =>
          axis === 'row'
            ? pair.rowDepth >= branchAnchorDepth
            : pair.columnDepth >= branchAnchorDepth,
        );
  const hasTotalRow = columnTotals || rowSubtotalLevels.includes(0);
  const hasTotalColumn = rowTotals || columnSubtotalLevels.includes(0);
  const shouldIncludeGrandTotalPair =
    (rowDimensions.length === 0 && columnDimensions.length === 0) ||
    (hasTotalRow && hasTotalColumn) ||
    (valuesAtRowFront && hasTotalColumn) ||
    (valuesAtColumnFront && hasTotalRow);

  return (
    shouldIncludeGrandTotalPair
      ? queryPairs
      : queryPairs.filter(
          pair => !(pair.rowDepth === 0 && pair.columnDepth === 0),
        )
  ).map(pair =>
    buildFactCoverage({
      rowDimensions,
      columnDimensions,
      rowDepth: pair.rowDepth,
      columnDepth: pair.columnDepth,
    }),
  );
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

const resolveFactMaterialization = ({
  layout,
  axis,
  projection,
}: {
  layout: LayoutContext;
  axis: PivotAxis;
  projection: PivotAxisProjection;
}): PivotFactMaterialization | undefined =>
  axis === layout.pivotProgram.valueAxis && projection.valuesLevelSeen
    ? {
        valueAxis: axis,
        valueInsertIndex: projection.filterDimensionPath.length,
      }
    : undefined;

const resolveFetchContext = ({
  formData,
  layout,
  axis,
  path,
  queryAnchorPath,
  coverageTarget,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  queryAnchorPath: PivotPath;
  coverageTarget: ExpansionCoverageTarget;
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
  const rowGroupbyForBranch =
    axis === 'row' ? coverageTarget.need.rowDimensions : rowGroupby;
  const colGroupbyForBranch =
    axis === 'col' ? coverageTarget.need.columnDimensions : colGroupby;
  const { rowDepth, columnDepth: colDepth } = coverageTarget.need;

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
    rowDepth,
    columnDepth: colDepth,
    hasValueCells: true,
    needsTotals,
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
    coverageTarget,
    branchAnchorDepth: queryAnchorPath.length,
    rowSubtotalLevels,
    columnSubtotalLevels: colSubtotalLevels,
    rowTotals: layout.rowTotals,
    columnTotals: layout.colTotals,
    includeRowTotalForColumnFormatting:
      axis === 'col' && (hasColFormatting || hasColTotalSorting),
    includeColumnTotalForRowFormatting:
      axis === 'row' && (hasRowFormatting || hasRowTotalSorting),
  });

  return {
    rowGroupbyForQuery: queryShape.rowGroupby,
    colGroupbyForQuery: queryShape.colGroupby,
    metricsForQuery: queryShape.metrics,
    requiredTimeOffsets,
    materialization: resolveFactMaterialization({
      layout,
      axis,
      projection,
    }),
    coverages,
  };
};

const buildPlannedQuerySpec = ({
  coverage,
  metrics,
  requiredTimeOffsets,
  materialization,
  scope,
  filters,
  suffix,
}: PlannedQuerySpecParams): PlannedQuerySpec => ({
  queryName: `${formatQueryName(coverage.rowDepth, coverage.columnDepth)}${suffix}`,
  columns: [...coverage.rowDimensions, ...coverage.columnDimensions],
  metrics,
  filters,
  meta: {
    requiredTimeOffsets,
    factSelector: {
      coverage,
      materialization,
      scope,
      valueKeys: buildFactValueKeys({
        metricKeys: metrics.map(getMetricKey).filter(Boolean) as string[],
        requiredTimeOffsets,
      }),
    },
  },
});

const buildAxisExpansionSpecs = ({
  formData,
  layout,
  axis,
  path,
  queryAnchorPath,
  coverageTarget,
  filters,
  suffix,
  scope,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  queryAnchorPath: PivotPath;
  coverageTarget: ExpansionCoverageTarget;
  filters: (ctx: ResolvedFetchContext) => QueryObjectFilterClause[];
  suffix: string;
  scope: PivotFactStoreBatchScope;
}): PlannedQuerySpec[] => {
  if (!canRequestAxisExpansion({ program: layout.pivotProgram, axis, path })) {
    return [];
  }

  const ctx = resolveFetchContext({
    formData,
    layout,
    axis,
    path,
    queryAnchorPath,
    coverageTarget,
  });

  const resolvedFilters = filters(ctx);
  return ctx.coverages.map(coverage =>
    buildPlannedQuerySpec({
      coverage,
      metrics: ctx.metricsForQuery,
      requiredTimeOffsets: ctx.requiredTimeOffsets,
      materialization: ctx.materialization,
      scope,
      filters: resolvedFilters,
      suffix,
    }),
  );
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

const resolveIntersectionExpansionAnchor = ({
  layout,
  rowPaths,
  columnPaths,
}: {
  layout: LayoutContext;
  rowPaths: PivotPath[];
  columnPaths: PivotPath[];
}): { axis: PivotAxis; path: PivotPath } => {
  const rowPath =
    rowPaths.find(path =>
      canRequestAxisExpansion({
        program: layout.pivotProgram,
        axis: 'row',
        path,
      }),
    ) ?? rowPaths[0];
  const columnPath =
    columnPaths.find(path =>
      canRequestAxisExpansion({
        program: layout.pivotProgram,
        axis: 'col',
        path,
      }),
    ) ?? columnPaths[0];

  if (
    columnPath &&
    canRequestAxisExpansion({
      program: layout.pivotProgram,
      axis: 'col',
      path: columnPath,
    })
  ) {
    return { axis: 'col', path: columnPath };
  }
  return { axis: 'row', path: rowPath ?? [] };
};

const targetScopePaths = (
  target: ExpansionCoverageTarget,
  axis: PivotAxis,
): PivotPath[] =>
  pathsFromAxisScope(
    axis === 'row' ? target.need.rowScope : target.need.columnScope,
  );

export type ExpansionQuerySpecRequest =
  | {
      kind: 'branch';
      formData: PivotTableQueryFormData;
      layout: LayoutContext;
      target: ExpansionCoverageTarget;
    }
  | {
      kind: 'batch';
      formData: PivotTableQueryFormData;
      layout: LayoutContext;
      batch: ExpansionCoverageTarget[];
    }
  | {
      kind: 'intersection';
      formData: PivotTableQueryFormData;
      layout: LayoutContext;
      target: ExpansionCoverageTarget;
    };

export const buildExpansionQuerySpecs = (
  request: ExpansionQuerySpecRequest,
): PlannedQuerySpec[] => {
  if (request.kind === 'branch') {
    const coverageTarget = request.target;
    const { axis } = coverageTarget;
    const path = parsePath(coverageTarget.pathKey);
    const scopedPath = targetScopePaths(coverageTarget, axis)[0] ?? [];
    return buildAxisExpansionSpecs({
      ...request,
      axis,
      path,
      queryAnchorPath: scopedPath,
      coverageTarget,
      filters: ctx =>
        buildPathFilters(
          axis === 'row' ? ctx.rowGroupbyForQuery : ctx.colGroupbyForQuery,
          scopedPath,
          request.formData.colTypeMap,
        ),
      suffix: `|branch:${axis}:${coverageTarget.pathKey}`,
      scope: {
        kind: 'axisPaths',
        axis,
        paths: [scopedPath],
      },
    });
  }
  if (request.kind === 'batch') {
    const { formData, layout, batch } = request;
    const coverageTarget = batch[0];
    if (!coverageTarget) {
      return [];
    }
    const batchAxis = coverageTarget.axis;
    const representative = parsePath(coverageTarget.pathKey);
    const parentPathKey = serializePath(representative.slice(0, -1));
    const scopedPaths = batch.flatMap(target =>
      targetScopePaths(target, batchAxis),
    );
    const parentDimensionPath = scopedPaths[0]?.slice(0, -1) ?? [];
    const siblingValues = scopedPaths.map(path => path[path.length - 1]);
    return buildAxisExpansionSpecs({
      formData,
      layout,
      axis: batchAxis,
      path: representative,
      queryAnchorPath: scopedPaths[0] ?? [],
      coverageTarget,
      filters: ctx =>
        buildBatchFilterClauses({
          axisGroupby:
            batchAxis === 'row'
              ? ctx.rowGroupbyForQuery
              : ctx.colGroupbyForQuery,
          parentPath: parentDimensionPath,
          siblingValues,
          colTypeMap: formData.colTypeMap,
        }),
      suffix: `|batch:${batchAxis}:${parentPathKey}`,
      scope: {
        kind: 'axisPaths',
        axis: batchAxis,
        paths: scopedPaths,
      },
    });
  }

  const { formData, layout, target } = request;
  const rowPaths = pathsFromAxisScope(target.need.rowScope);
  const columnPaths = pathsFromAxisScope(target.need.columnScope);
  const anchor = resolveIntersectionExpansionAnchor({
    layout,
    rowPaths,
    columnPaths,
  });
  return buildAxisExpansionSpecs({
    formData,
    layout,
    axis: anchor.axis,
    path: anchor.path,
    queryAnchorPath: anchor.path,
    coverageTarget: target,
    filters: ctx => [
      ...buildPathSetFilterClauses({
        axisGroupby: ctx.rowGroupbyForQuery,
        paths: rowPaths,
        colTypeMap: formData.colTypeMap,
      }),
      ...buildPathSetFilterClauses({
        axisGroupby: ctx.colGroupbyForQuery,
        paths: columnPaths,
        colTypeMap: formData.colTypeMap,
      }),
    ],
    suffix: `|intersection:${stableStringify([rowPaths, columnPaths])}`,
    scope: {
      kind: 'intersection',
      rowPaths,
      columnPaths,
    },
  });
};

export const buildInitialQuerySpecs = (
  formData: PivotTableQueryFormData,
  layout: LayoutContext = buildLayoutContext(formData),
): PlannedQuerySpec[] => {
  const { metrics } = layout;
  const rowGroupby = layout.pivotProgram.rowDimensions;
  const colGroupby = layout.pivotProgram.columnDimensions;
  const { rowSubtotalLevels, colSubtotalLevelsForQuery: colSubtotalLevels } =
    layout;
  const needsTotals =
    layout.rowTotals ||
    layout.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const firstRowDepth = rowGroupby.length > 0 ? 1 : 0;
  const firstColDepth = colGroupby.length > 0 ? 1 : 0;
  const rootSpecs: Array<{
    rowDepth: number;
    columnDepth: number;
    hasValueCells: boolean;
    includeTotals: boolean;
  }> = [];

  if (
    needsTotals ||
    layout.pivotProgram.metricKeys.length === 0 ||
    (firstRowDepth === 0 && firstColDepth === 0)
  ) {
    rootSpecs.push({
      rowDepth: 0,
      columnDepth: 0,
      hasValueCells: false,
      includeTotals: needsTotals,
    });
  }
  if (layout.pivotProgram.metricKeys.length > 0) {
    if (firstRowDepth > 0 && firstColDepth > 0) {
      rootSpecs.push({
        rowDepth: firstRowDepth,
        columnDepth: firstColDepth,
        hasValueCells: true,
        includeTotals: false,
      });
    }
    if (rowGroupby.length > 0) {
      rootSpecs.push({
        rowDepth: firstRowDepth,
        columnDepth: 0,
        hasValueCells: true,
        includeTotals: needsTotals,
      });
    }
    if (colGroupby.length > 0) {
      rootSpecs.push({
        rowDepth: 0,
        columnDepth: firstColDepth,
        hasValueCells: true,
        includeTotals: needsTotals,
      });
    }
  }

  return rootSpecs.map(
    ({ rowDepth, columnDepth, hasValueCells, includeTotals }) => {
      const coverage = buildFactCoverage({
        rowDimensions: layout.pivotProgram.rowDimensions,
        columnDimensions: layout.pivotProgram.columnDimensions,
        rowDepth,
        columnDepth,
      });
      const queryShape = buildQueryShape({
        rowDepth,
        columnDepth,
        hasValueCells,
        needsTotals: includeTotals,
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
      return buildPlannedQuerySpec({
        coverage,
        metrics: queryShape.metrics,
        requiredTimeOffsets: layout.requiredTimeOffsets,
        scope: { kind: 'root' },
        filters: [],
        suffix: '',
      });
    },
  );
};

export type SelectionFilterMap = Record<string, DataRecordValue[]>;

type BuildSelectionFilterClausesParams = {
  formData: PivotTableQueryFormData;
  selection?: SelectionFilterMap;
};

export const buildSelectionFilterClauses = ({
  formData,
  selection,
}: BuildSelectionFilterClausesParams): QueryObjectFilterClause[] => {
  if (!selection || Object.keys(selection).length === 0) {
    return [];
  }
  const dimensionMap = new Map(
    formData.dimensions.map(dimension => [
      getStableColumnKey(dimension),
      dimension,
    ]),
  );
  return Object.entries(selection).flatMap(([key, values]) => {
    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }
    const col = dimensionMap.get(key) ?? (key as unknown as QueryFormColumn);
    return [
      {
        col,
        op: 'IN' as const,
        val: values,
      },
    ];
  });
};

const shouldCoerceTemporalValue = ({
  column,
  colTypeMap,
  temporalLookup,
}: {
  column?: QueryFormColumn;
  colTypeMap?: Record<string, GenericDataType>;
  temporalLookup?: Record<string, boolean>;
}): boolean => {
  const columnLabel = column ? getColumnLabel(column) : undefined;
  if (!columnLabel) {
    return false;
  }
  return (
    colTypeMap?.[columnLabel] === GenericDataType.Temporal ||
    temporalLookup?.[columnLabel] === true
  );
};

const coerceTemporalValue = (value: DataRecordValue): DataRecordValue =>
  typeof value === 'string' || typeof value === 'number'
    ? normalizeTemporalValue(value)
    : value;

const normalizeFilterValue = ({
  value,
  column,
  colTypeMap,
  temporalLookup,
}: {
  value: DataRecordValue;
  column?: QueryFormColumn;
  colTypeMap?: Record<string, GenericDataType>;
  temporalLookup?: Record<string, boolean>;
}): DataRecordValue =>
  shouldCoerceTemporalValue({ column, colTypeMap, temporalLookup })
    ? coerceTemporalValue(value)
    : value;

const normalizeExtraFormDataFilters = (
  extraFormData: ExtraFormData,
  colTypeMap?: Record<string, GenericDataType>,
  temporalLookup?: Record<string, boolean>,
): ExtraFormData => {
  if (
    !Array.isArray(extraFormData.filters) ||
    extraFormData.filters.length === 0
  ) {
    return extraFormData;
  }
  let hasChanges = false;
  const nextFilters = extraFormData.filters.map(filter => {
    if (!('val' in filter)) {
      return filter;
    }
    const { col, val } = filter;
    if (Array.isArray(val)) {
      const filterWithArray = filter as SetQueryObjectFilterClause;
      let arrayChanged = false;
      const nextValues = val.map(item => {
        const normalized = normalizeFilterValue({
          value: item,
          column: col,
          colTypeMap,
          temporalLookup,
        });
        if (normalized !== item) {
          arrayChanged = true;
        }
        return normalized;
      });
      if (!arrayChanged) {
        return filter;
      }
      hasChanges = true;
      return { ...filterWithArray, val: nextValues };
    }
    const filterWithValue = filter as BinaryQueryObjectFilterClause;
    const nextValue = normalizeFilterValue({
      value: val,
      column: col,
      colTypeMap,
      temporalLookup,
    });
    if (nextValue === val) {
      return filter;
    }
    hasChanges = true;
    return { ...filterWithValue, val: nextValue };
  });
  return hasChanges
    ? {
        ...extraFormData,
        filters: nextFilters,
      }
    : extraFormData;
};

export const normalizeFormDataExtraFilters = (
  formData: PivotTableQueryFormData,
): PivotTableQueryFormData => {
  const extraFormData = formData.extra_form_data;
  if (!extraFormData) {
    return formData;
  }
  const normalizedExtra = normalizeExtraFormDataFilters(
    extraFormData,
    formData.colTypeMap,
    formData.temporal_columns_lookup,
  );
  return normalizedExtra === extraFormData
    ? formData
    : {
        ...formData,
        extra_form_data: normalizedExtra,
      };
};

export const buildSelectionFilteredFormData = ({
  formData,
  selection,
}: BuildSelectionFilterClausesParams): PivotTableQueryFormData => {
  const selectionFilters = buildSelectionFilterClauses({
    formData,
    selection,
  });
  return normalizeFormDataExtraFilters(
    selectionFilters.length > 0
      ? {
          ...formData,
          extra_form_data: {
            ...(formData.extra_form_data ?? {}),
            filters: [
              ...(formData.extra_form_data?.filters ?? []),
              ...selectionFilters,
            ],
          },
        }
      : formData,
  );
};

const withMetricOverrides = ({
  formData,
  metricsOverride,
  measureLeavesByMetricOverride,
}: {
  formData: PivotTableQueryFormData;
  metricsOverride?: PivotTableQueryFormData['metrics'];
  measureLeavesByMetricOverride?: PivotTableQueryFormData['measureLeavesByMetric'];
}) => {
  if (
    metricsOverride === undefined &&
    measureLeavesByMetricOverride === undefined
  ) {
    return formData;
  }
  return {
    ...formData,
    ...(metricsOverride !== undefined ? { metrics: metricsOverride } : {}),
    ...(measureLeavesByMetricOverride !== undefined
      ? { measureLeavesByMetric: measureLeavesByMetricOverride }
      : {}),
  };
};

export type BuildInitialPivotUpdatePlanParams = {
  formData: PivotTableQueryFormData;
  runtimeLayout?: PivotRuntimeLayout;
  selection?: SelectionFilterMap;
  metricsOverride?: PivotTableQueryFormData['metrics'];
  measureLeavesByMetricOverride?: PivotTableQueryFormData['measureLeavesByMetric'];
};

export type InitialPivotUpdatePlan = {
  formData: PivotTableQueryFormData;
  layout: ReturnType<typeof buildLayoutContext>;
  specs: PlannedQuerySpec[];
};

export const buildInitialPivotUpdatePlan = ({
  formData,
  runtimeLayout,
  selection,
  metricsOverride,
  measureLeavesByMetricOverride,
}: BuildInitialPivotUpdatePlanParams): InitialPivotUpdatePlan => {
  const resolvedSelection =
    selection === undefined ? formData.pivotSelectedFilters : selection;
  const normalizedFormData = buildSelectionFilteredFormData({
    formData,
    selection: resolvedSelection,
  });
  const formDataWithOverrides = withMetricOverrides({
    formData: normalizedFormData,
    metricsOverride,
    measureLeavesByMetricOverride,
  });
  const resolvedFormData = resolveInteractionFormData({
    formData: formDataWithOverrides,
    runtimeLayout: runtimeLayout ?? normalizedFormData.pivotRuntimeLayout,
  });
  const layout = buildLayoutContext(resolvedFormData);
  const timeOffsets = Array.from(
    new Set([
      ...(resolvedFormData.time_offsets ?? []),
      ...layout.requiredTimeOffsets,
    ]),
  );
  const resolvedFormDataWithOffsets =
    timeOffsets.length > 0
      ? { ...resolvedFormData, time_offsets: timeOffsets }
      : resolvedFormData;
  return {
    formData: resolvedFormDataWithOffsets,
    layout,
    specs: buildInitialQuerySpecs(resolvedFormDataWithOffsets, layout),
  };
};
