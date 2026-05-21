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
import {
  buildOffsetMetricKey,
  collectRequiredTimeOffsets,
  getRequiredOffsetsForLeaves,
} from '../measureLeaves';
import {
  isIntersectionCoverageTarget,
  targetAxisScope,
  type ExpansionCoverageTarget,
} from '../expansion/planner';
import { coerceValueForColumn, normalizeTemporalValue } from './pathFilters';
import {
  buildFactCoverage,
  normalizeFactValueKeys,
  pathsFromAxisScope,
  type PivotCoverageNeed,
} from '../runtime/coverage';
import {
  buildFactValueKeys,
  buildPivotFactQueryContextKey,
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

type PlannedQuerySpecParams = {
  coverage: PivotFactCoverage;
  metrics: QueryFormMetric[];
  measureHierarchy?: MeasureHierarchy;
  requiredTimeOffsets: string[];
  materialization?: PivotFactMaterialization;
  queryContextKey: string;
  scope: PivotFactStoreBatchScope;
  filters: QueryObjectFilterClause[];
};

export const MAX_EXPANSION_BATCH_SIBLINGS = 50;

const parentDepth = (depth: number) => Math.max(depth - 1, 0);

const depthsFromOne = (depth: number): number[] =>
  Array.from({ length: depth }, (_, idx) => idx + 1);

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
  const depthPairs = new Set<string>();
  const addDepthPair = (rowDepthVal: number, columnDepthVal: number) =>
    depthPairs.add(`${rowDepthVal}|${columnDepthVal}`);
  const addDepthGrid = (rowDepths: number[], columnDepths: number[]) =>
    [...new Set(rowDepths)].forEach(rowDepthVal =>
      [...new Set(columnDepths)].forEach(columnDepthVal =>
        addDepthPair(rowDepthVal, columnDepthVal),
      ),
    );
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
      addDepthGrid(rowDepth === 1 ? [0, 1] : depthsFromOne(rowDepth), [
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
      depthsFromOne(columnDepth),
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
      ? [...depthPairs]
      : [...depthPairs].filter(pairKey => {
          const [pairRowDepth, pairColumnDepth] = pairKey
            .split('|')
            .map(Number);
          return axis === 'row'
            ? pairRowDepth >= branchAnchorDepth
            : pairColumnDepth >= branchAnchorDepth;
        });
  const hasTotalRow = columnTotals || rowSubtotalLevels.includes(0);
  const hasTotalColumn = rowTotals || columnSubtotalLevels.includes(0);
  const shouldIncludeGrandTotalPair =
    (rowDimensions.length === 0 && columnDimensions.length === 0) ||
    (hasTotalRow && hasTotalColumn) ||
    (valuesAtRowFront && hasTotalColumn) ||
    (valuesAtColumnFront && hasTotalRow);
  const coveragePairs = (
    shouldIncludeGrandTotalPair
      ? queryPairs
      : queryPairs.filter(pairKey => pairKey !== '0|0')
  ).map(pairKey => {
    const [rowDepthVal, columnDepthVal] = pairKey.split('|').map(Number);
    return { rowDepth: rowDepthVal, columnDepth: columnDepthVal };
  });

  return coveragePairs.map(pair =>
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

const resolveMaterializedValueInsertIndex = ({
  layout,
  axis,
  coverageTarget,
}: {
  layout: LayoutContext;
  axis: PivotAxis;
  coverageTarget: ExpansionCoverageTarget;
}) => {
  const axisDimensions =
    axis === 'row'
      ? layout.pivotProgram.rowDimensions
      : layout.pivotProgram.columnDimensions;
  const needDimensions =
    axis === 'row'
      ? coverageTarget.need.rowDimensions
      : coverageTarget.need.columnDimensions;
  const valuesIndex = Math.max(
    0,
    Math.min(layout.pivotProgram.metricInsertIndex, axisDimensions.length),
  );
  let insertIndex = 0;
  while (
    insertIndex < valuesIndex &&
    insertIndex < needDimensions.length &&
    getStableColumnKey(axisDimensions[insertIndex]) ===
      getStableColumnKey(needDimensions[insertIndex])
  ) {
    insertIndex += 1;
  }
  return insertIndex;
};

const resolveFactMaterialization = ({
  layout,
  axis,
  projection,
  coverageTarget,
}: {
  layout: LayoutContext;
  axis: PivotAxis;
  projection: PivotAxisProjection;
  coverageTarget: ExpansionCoverageTarget;
}): PivotFactMaterialization | undefined =>
  axis === layout.pivotProgram.valueAxis && projection.valuesLevelSeen
    ? {
        valueAxis: axis,
        valueInsertIndex: resolveMaterializedValueInsertIndex({
          layout,
          axis,
          coverageTarget,
        }),
      }
    : undefined;

const resolveFetchContext = ({
  formData,
  layout,
  axis,
  path,
  coverageTarget,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  coverageTarget: ExpansionCoverageTarget;
}) => {
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
  const { rowDepth, columnDepth: colDepth } = coverageTarget.need;
  const branchAnchorDepth =
    pathsFromAxisScope(
      axis === 'row'
        ? coverageTarget.need.rowScope
        : coverageTarget.need.columnScope,
    )[0]?.length ?? 0;

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
    rowGroupby: coverageTarget.need.rowDimensions,
    colGroupby: coverageTarget.need.columnDimensions,
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
    branchAnchorDepth,
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
    metricsForQuery: queryShape.metrics,
    measureHierarchy: materializedMeasureHierarchy,
    requiredTimeOffsets,
    materialization: resolveFactMaterialization({
      layout,
      axis,
      projection,
      coverageTarget,
    }),
    coverages,
  };
};

const buildPlannedQuerySpec = ({
  coverage,
  metrics,
  measureHierarchy,
  requiredTimeOffsets,
  materialization,
  queryContextKey,
  scope,
  filters,
}: PlannedQuerySpecParams): PlannedQuerySpec => {
  const metricKeys = metrics.map(getMetricKey).filter(Boolean) as string[];
  const metricKeySet = new Set(metricKeys);
  const valueKeys =
    measureHierarchy && measureHierarchy.groups.length > 0
      ? normalizeFactValueKeys([
          ...metricKeys,
          ...measureHierarchy.groups.flatMap(group => {
            if (!metricKeySet.has(group.metricKey)) {
              return [];
            }
            return [
              ...getRequiredOffsetsForLeaves(group.leaves).map(offset =>
                buildOffsetMetricKey(group.metricKey, offset),
              ),
              ...group.leaves.flatMap(leaf => {
                if (leaf.kind !== 'custom') {
                  return [];
                }
                const customMetricKey = getMetricKey(leaf.metric);
                if (!customMetricKey || !metricKeySet.has(customMetricKey)) {
                  return [];
                }
                return leaf.offset
                  ? [
                      customMetricKey,
                      buildOffsetMetricKey(customMetricKey, leaf.offset),
                    ]
                  : [customMetricKey];
              }),
            ];
          }),
        ])
      : buildFactValueKeys({
          metricKeys,
          requiredTimeOffsets,
        });
  return {
    queryName: `${formatQueryName(coverage.rowDepth, coverage.columnDepth)}${
      scope.kind === 'root' ? '' : `|scope:${stableStringify(scope)}`
    }`,
    columns: [...coverage.rowDimensions, ...coverage.columnDimensions],
    metrics,
    filters,
    meta: {
      requiredTimeOffsets,
      factSelector: {
        coverage,
        materialization,
        queryContextKey,
        scope,
        valueKeys,
      },
    },
  };
};

const buildAxisExpansionSpecs = ({
  formData,
  layout,
  axis,
  path,
  coverageTarget,
  filters,
  scope,
}: {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
  axis: PivotAxis;
  path: PivotPath;
  coverageTarget: ExpansionCoverageTarget;
  filters: QueryObjectFilterClause[];
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
    coverageTarget,
  });

  return ctx.coverages.map(coverage =>
    buildPlannedQuerySpec({
      coverage,
      metrics: ctx.metricsForQuery,
      measureHierarchy: ctx.measureHierarchy,
      requiredTimeOffsets: ctx.requiredTimeOffsets,
      materialization: ctx.materialization,
      queryContextKey: buildPivotFactQueryContextKey(formData),
      scope,
      filters,
    }),
  );
};

const isNullish = (value: PivotPathValue | unknown) =>
  value === null || value === undefined;

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

const targetScopePaths = (target: ExpansionCoverageTarget): PivotPath[] =>
  pathsFromAxisScope(
    target.axis === 'row' ? target.need.rowScope : target.need.columnScope,
  );

const chunkTargets = (
  targets: ExpansionCoverageTarget[],
  chunkSize: number,
): ExpansionCoverageTarget[][] => {
  const sorted = [...targets].sort((a, b) =>
    serializePath(targetScopePaths(a)[0] ?? []).localeCompare(
      serializePath(targetScopePaths(b)[0] ?? []),
    ),
  );
  const chunks: ExpansionCoverageTarget[][] = [];
  for (let idx = 0; idx < sorted.length; idx += chunkSize) {
    chunks.push(sorted.slice(idx, idx + chunkSize));
  }
  return chunks;
};

export const optimizeExpansionFetchPlan = ({
  targets,
  maxBatchSize = MAX_EXPANSION_BATCH_SIBLINGS,
}: {
  targets: ExpansionCoverageTarget[];
  maxBatchSize?: number;
}): ExpansionCoverageTarget[][] => {
  const targetGroups: ExpansionCoverageTarget[][] = [];
  const groups = new Map<string, ExpansionCoverageTarget[]>();

  targets.forEach(target => {
    const path = targetScopePaths(target)[0] ?? [];
    if (path.length === 0) {
      targetGroups.push([target]);
      return;
    }
    const parentPathKey = serializePath(path.slice(0, -1));
    const siblingValue = path[path.length - 1];
    const groupKey = stableStringify([
      target.axis,
      parentPathKey,
      isNullish(siblingValue) ? 'null' : 'value',
      target.need.rowDepth,
      target.need.columnDepth,
      target.need.rowDimensions,
      target.need.columnDimensions,
      target.need.valueKeys,
      target.axis === 'row' ? target.need.columnScope : target.need.rowScope,
    ]);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), target]);
  });

  groups.forEach(group => {
    chunkTargets(group, maxBatchSize).forEach(chunk => {
      targetGroups.push(chunk);
    });
  });

  return targetGroups;
};

type ExpansionSpecContext = {
  formData: PivotTableQueryFormData;
  layout: LayoutContext;
};

const buildAxisPathExpansionSpecs = ({
  formData,
  layout,
  targets,
}: ExpansionSpecContext & {
  targets: ExpansionCoverageTarget[];
}): PlannedQuerySpec[] => {
  const coverageTarget = targets[0];
  if (!coverageTarget) {
    return [];
  }
  const { axis } = coverageTarget;
  const path = parsePath(coverageTarget.pathKey);
  const scopedPaths = targets.flatMap(targetScopePaths);
  return buildAxisExpansionSpecs({
    formData,
    layout,
    axis,
    path,
    coverageTarget,
    filters: buildPathSetFilterClauses({
      axisGroupby:
        axis === 'row'
          ? coverageTarget.need.rowDimensions
          : coverageTarget.need.columnDimensions,
      paths: scopedPaths,
      colTypeMap: formData.colTypeMap,
    }),
    scope: targetAxisScope(coverageTarget, scopedPaths),
  });
};

const buildIntersectionTargetExpansionSpecs = ({
  formData,
  layout,
  target,
}: ExpansionSpecContext & {
  target: ExpansionCoverageTarget;
}): PlannedQuerySpec[] => {
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
    coverageTarget: target,
    filters: [
      ...buildPathSetFilterClauses({
        axisGroupby: target.need.rowDimensions,
        paths: rowPaths,
        colTypeMap: formData.colTypeMap,
      }),
      ...buildPathSetFilterClauses({
        axisGroupby: target.need.columnDimensions,
        paths: columnPaths,
        colTypeMap: formData.colTypeMap,
      }),
    ],
    scope: {
      kind: 'intersection',
      rowPaths,
      columnPaths,
    },
  });
};

export const buildExpansionQuerySpecPhases = ({
  formData,
  layout,
  targets,
}: ExpansionSpecContext & {
  targets: ExpansionCoverageTarget[];
}): PlannedQuerySpec[][] => {
  const intersections = targets.filter(isIntersectionCoverageTarget);
  const targetGroups = optimizeExpansionFetchPlan({
    targets: targets.filter(target => !isIntersectionCoverageTarget(target)),
  });
  return [
    targetGroups.flatMap(targetGroup =>
      buildAxisPathExpansionSpecs({
        formData,
        layout,
        targets: targetGroup,
      }),
    ),
    intersections.flatMap(target =>
      buildIntersectionTargetExpansionSpecs({
        formData,
        layout,
        target,
      }),
    ),
  ].filter(phase => phase.length > 0);
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
  const queryContextKey = buildPivotFactQueryContextKey(formData);
  const rootVisibleDepth = (axis: PivotAxis, maxDepth: number) =>
    Math.min(
      layout.axisCoverageNeeds
        .filter(
          need =>
            need.axis === axis &&
            need.scope.kind === 'scopedFull' &&
            need.scope.ancestorPaths.some(path => path.length === 0),
        )
        .reduce((depth, need) => Math.max(depth, need.depth), 0),
      maxDepth,
    );
  const firstRowDepth =
    rowGroupby.length > 0
      ? Math.max(rootVisibleDepth('row', rowGroupby.length), 1)
      : 0;
  const firstColDepth =
    colGroupby.length > 0
      ? Math.max(rootVisibleDepth('col', colGroupby.length), 1)
      : 0;
  const buildRootNeed = (
    rowDepth: number,
    columnDepth: number,
  ): PivotCoverageNeed => ({
    rowDepth,
    columnDepth,
    rowDimensions: layout.pivotProgram.rowDimensions.slice(0, rowDepth),
    columnDimensions: layout.pivotProgram.columnDimensions.slice(
      0,
      columnDepth,
    ),
    valueKeys: buildFactValueKeys({
      metricKeys: layout.pivotProgram.metricKeys,
      requiredTimeOffsets: layout.requiredTimeOffsets,
    }),
    rowScope: { kind: 'root' },
    columnScope: { kind: 'root' },
  });
  const hasMetrics = layout.pivotProgram.metricKeys.length > 0;
  const rootNeeds = [
    needsTotals || !hasMetrics || (firstRowDepth === 0 && firstColDepth === 0)
      ? buildRootNeed(0, 0)
      : undefined,
    hasMetrics && firstRowDepth > 0 && firstColDepth > 0
      ? buildRootNeed(firstRowDepth, firstColDepth)
      : undefined,
    hasMetrics && rowGroupby.length > 0
      ? buildRootNeed(firstRowDepth, 0)
      : undefined,
    hasMetrics && colGroupby.length > 0
      ? buildRootNeed(0, firstColDepth)
      : undefined,
  ].filter((need): need is PivotCoverageNeed => need !== undefined);

  return rootNeeds.map(need => {
    const { rowDepth, columnDepth } = need;
    const hasValueCells = hasMetrics && (rowDepth > 0 || columnDepth > 0);
    const includeTotals = needsTotals && (rowDepth === 0 || columnDepth === 0);
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
      measureHierarchy: layout.measureHierarchy,
      requiredTimeOffsets: layout.requiredTimeOffsets,
      queryContextKey,
      scope: { kind: 'root' },
      filters: [],
    });
  });
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
    const col = dimensionMap.get(key);
    if (!col) {
      return [];
    }
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
  shouldCoerceTemporalValue({ column, colTypeMap, temporalLookup }) &&
  (typeof value === 'string' || typeof value === 'number')
    ? normalizeTemporalValue(value)
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
  const formDataWithOverrides =
    metricsOverride === undefined && measureLeavesByMetricOverride === undefined
      ? normalizedFormData
      : {
          ...normalizedFormData,
          ...(metricsOverride !== undefined
            ? { metrics: metricsOverride }
            : {}),
          ...(measureLeavesByMetricOverride !== undefined
            ? { measureLeavesByMetric: measureLeavesByMetricOverride }
            : {}),
        };
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
