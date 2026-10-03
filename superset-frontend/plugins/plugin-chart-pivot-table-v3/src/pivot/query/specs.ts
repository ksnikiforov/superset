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
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
  type QueryObject,
  type QueryObjectFilterClause,
  type SetQueryObjectFilterClause,
  type UnaryQueryObjectFilterClause,
} from '@superset-ui/core';
import { GenericDataType } from '@apache-superset/core/common';
import {
  type MeasureHierarchy,
  type PivotAxis,
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
import {
  buildTemporalBaseAxisColumn,
  resolvePivotTimeComparison,
  type PivotTimeComparisonSpec,
} from './timeComparison';
import { coerceValueForColumn, normalizeTemporalValue } from './pathFilters';
import {
  buildFactCoverage,
  normalizeFactValueKeys,
  pathsFromAxisScope,
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
import { isSubtotalToken } from '../core/tokens';
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
  meta?: QuerySpecMeta;
};

export type QuerySpecMeta = {
  requiredTimeOffsets: string[];
  factSelector: PivotFactSelector;
  timeComparison?: PivotTimeComparisonSpec;
};

export type PlannedQuerySpec = QuerySpec & {
  meta: QuerySpecMeta;
};

const hasEnclosedTemporalRangeFilter = (
  filters: QueryObjectFilterClause[],
): boolean =>
  filters.some(filter => {
    const candidate = filter as { op?: unknown; val?: unknown };
    return (
      candidate.op === 'TEMPORAL_RANGE' &&
      typeof candidate.val === 'string' &&
      candidate.val !== 'No filter' &&
      candidate.val.includes(':')
    );
  });

export const toChartDataQueries = ({
  specs,
  baseQueryObject,
}: {
  specs: QuerySpec[];
  baseQueryObject: QueryObject;
}): QueryObject[] =>
  specs.map(spec => {
    const comparison = spec.meta?.timeComparison;
    const filters = [
      ...((baseQueryObject.filters ?? []) as QueryObjectFilterClause[]),
      ...spec.filters.map(filter =>
        comparison &&
        getColumnLabel(filter.col) === comparison.temporalColumnLabel
          ? { ...filter, grain: comparison.timeGrain }
          : filter,
      ),
    ];
    const requiredTimeOffsets = spec.meta?.requiredTimeOffsets ?? [];
    const timeOffsets =
      comparison ||
      hasEnclosedTemporalRangeFilter(filters) ||
      spec.meta?.factSelector.scope.kind !== 'root'
        ? requiredTimeOffsets
        : [];
    return {
      ...baseQueryObject,
      columns: comparison
        ? [
            buildTemporalBaseAxisColumn(comparison),
            ...spec.columns.filter(
              column =>
                getColumnLabel(column) !== comparison.temporalColumnLabel,
            ),
          ]
        : spec.columns,
      metrics:
        spec.metrics.length > 0
          ? spec.metrics
          : ((baseQueryObject.metrics ?? []) as QueryFormMetric[]),
      filters,
      query_name: spec.queryName,
      ...(requiredTimeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
    };
  });

/** Resolves configuration-backed query inputs once for a planning operation. */
const compileQueryContext = (
  formData: PivotTableQueryFormData,
  layout: LayoutContext,
) => {
  const { metrics } = layout;
  const compileMetrics = <T>(
    settings: Record<string, T> | undefined,
    collect: (entry: Record<string, T>) => QueryFormMetric[],
  ) =>
    new Map(
      Object.entries(settings ?? {}).map(([key, value]) => [
        key,
        collect({ [key]: value }),
      ]),
    );
  const formatting = compileMetrics(formData.metricFormatting, entry =>
    collectMetricFormattingMetricsForQuery(entry, metrics),
  );
  const databars = compileMetrics(formData.metricDatabars, entry =>
    collectMetricDatabarMetricsForQuery(entry, metrics),
  );
  const dimensionInputs = {
    rowFormatting: compileMetrics(formData.rowFormatting, entry =>
      collectDimensionFormattingMetricsForQuery(
        entry,
        Object.keys(entry),
        metrics,
      ),
    ),
    colFormatting: compileMetrics(formData.colFormatting, entry =>
      collectDimensionFormattingMetricsForQuery(
        entry,
        Object.keys(entry),
        metrics,
      ),
    ),
    rowSorting: compileMetrics(formData.rowSorting, entry =>
      collectDimensionSortingMetricsForQuery(
        entry,
        Object.keys(entry),
        metrics,
      ),
    ),
    colSorting: compileMetrics(formData.colSorting, entry =>
      collectDimensionSortingMetricsForQuery(
        entry,
        Object.keys(entry),
        metrics,
      ),
    ),
  };
  const selectInputs = (
    inputs: Map<string, QueryFormMetric[]>,
    keys: Set<string>,
  ) =>
    Array.from(inputs).flatMap(([key, dependencies]) =>
      keys.has(key) ? dependencies : [],
    );
  const needsAxisTotal = (axis: PivotAxis) => {
    const dimensions =
      axis === 'row'
        ? layout.pivotProgram.rowDimensions
        : layout.pivotProgram.columnDimensions;
    const formattingInputs =
      axis === 'row'
        ? dimensionInputs.rowFormatting
        : dimensionInputs.colFormatting;
    return (
      selectInputs(formattingInputs, new Set(dimensions.map(getColumnLabel)))
        .length > 0 ||
      hasTotalSorting(
        axis === 'row' ? formData.rowSorting : formData.colSorting,
        dimensions,
      )
    );
  };
  return {
    formData,
    layout,
    queryContextKey: buildPivotFactQueryContextKey(formData),
    rowNeedsTotal: needsAxisTotal('row'),
    colNeedsTotal: needsAxisTotal('col'),
    metricsFor: (
      coverage: PivotFactCoverage,
      selectedMetrics: QueryFormMetric[],
      hierarchy: MeasureHierarchy,
      hasValueCells: boolean,
      needsTotals: boolean,
    ) => {
      const keys = new Set(selectedMetrics.map(getMetricKey));
      const rowKeys = new Set(coverage.rowDimensions.map(getColumnLabel));
      const colKeys = new Set(coverage.columnDimensions.map(getColumnLabel));
      return mergeMetrics(selectedMetrics, [
        ...((
          formData.metricFormattingScope === 'values'
            ? hasValueCells
            : hasValueCells || needsTotals
        )
          ? selectInputs(formatting, keys)
          : []),
        ...(hasValueCells ? selectInputs(databars, keys) : []),
        ...selectInputs(dimensionInputs.rowFormatting, rowKeys),
        ...selectInputs(dimensionInputs.colFormatting, colKeys),
        ...selectInputs(dimensionInputs.rowSorting, rowKeys),
        ...selectInputs(dimensionInputs.colSorting, colKeys),
        ...collectMeasureLeafMetricsForQuery(
          hierarchy,
          selectedMetrics,
          metrics,
        ),
      ]);
    },
  };
};
type QueryContext = ReturnType<typeof compileQueryContext>;

type PlannedQuerySpecParams = {
  formData: PivotTableQueryFormData;
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
  context,
  axis,
  projection,
  coverageTarget,
}: {
  context: QueryContext;
  axis: PivotAxis;
  projection: PivotAxisProjection;
  coverageTarget: ExpansionCoverageTarget;
}) => {
  const { formData, layout } = context;
  const {
    metrics,
    rowSubtotalLevels,
    colSubtotalLevelsForQuery: colSubtotalLevels,
  } = layout;
  const branchAnchorDepth =
    pathsFromAxisScope(
      axis === 'row'
        ? coverageTarget.need.rowScope
        : coverageTarget.need.columnScope,
    )[0]?.length ?? 0;

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
  const metricsForQuery = context.metricsFor(
    coverageTarget.need,
    materializedMetrics,
    materializedMeasureHierarchy,
    true,
    needsTotals,
  );
  const coverages = buildBranchFactCoverages({
    program: layout.pivotProgram,
    axis,
    coverageTarget,
    branchAnchorDepth,
    rowSubtotalLevels,
    columnSubtotalLevels: colSubtotalLevels,
    rowTotals: layout.rowTotals,
    columnTotals: layout.colTotals,
    includeRowTotalForColumnFormatting: axis === 'col' && context.colNeedsTotal,
    includeColumnTotalForRowFormatting: axis === 'row' && context.rowNeedsTotal,
  });

  return {
    metricsForQuery,
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
  formData,
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
  const columns = [...coverage.rowDimensions, ...coverage.columnDimensions];
  const timeComparison = resolvePivotTimeComparison({
    columns,
    formData,
    requiredTimeOffsets,
  });
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
    columns,
    metrics,
    filters,
    meta: {
      requiredTimeOffsets,
      ...(timeComparison ? { timeComparison } : {}),
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
  context,
  axis,
  path,
  coverageTarget,
  filters,
  scope,
}: {
  context: QueryContext;
  axis: PivotAxis;
  path: PivotPath;
  coverageTarget: ExpansionCoverageTarget;
  filters: QueryObjectFilterClause[];
  scope: PivotFactStoreBatchScope;
}): PlannedQuerySpec[] => {
  const { formData, layout, queryContextKey } = context;
  const projection = resolveAxisProjection({
    program: layout.pivotProgram,
    axis,
    path,
  });
  if (
    path.some(isSubtotalToken) ||
    !(
      projection.nextLevelKind === 'dimension' ||
      projection.skippedPreValuesDimensions.length
    )
  )
    return [];
  const ctx = resolveFetchContext({
    context,
    axis,
    projection,
    coverageTarget,
  });

  return ctx.coverages.map(coverage =>
    buildPlannedQuerySpec({
      formData,
      coverage,
      metrics: ctx.metricsForQuery,
      measureHierarchy: ctx.measureHierarchy,
      requiredTimeOffsets: ctx.requiredTimeOffsets,
      materialization: ctx.materialization,
      queryContextKey,
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
        col: column,
        op: 'IS NULL',
      } as UnaryQueryObjectFilterClause);
      continue;
    }
    const coercedValues = nonNullValues.map(value =>
      coerceValueForColumn(value, column, colTypeMap),
    ) as DataRecordValue[];
    if (coercedValues.length === 1 && nonNullValues.length === values.length) {
      filters.push({
        col: column,
        op: '==',
        val: coercedValues[0],
      } as QueryObjectFilterClause);
      continue;
    }
    filters.push({
      col: column,
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
    const group = groups.get(groupKey);
    if (group) group.push(target);
    else groups.set(groupKey, [target]);
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

const buildRootSpecs = (
  context: QueryContext,
  needs = context.layout.rootCoverageNeeds,
): PlannedQuerySpec[] => {
  const { formData, layout, queryContextKey } = context;
  const needsTotals =
    layout.rowTotals ||
    layout.colTotals ||
    layout.rowSubtotalLevels.length > 0 ||
    layout.colSubtotalLevelsForQuery.length > 0;
  return needs.map(({ rowDepth, columnDepth }) => {
    const coverage = buildFactCoverage({
      ...layout.pivotProgram,
      rowDepth,
      columnDepth,
    });
    return buildPlannedQuerySpec({
      formData,
      coverage,
      metrics: context.metricsFor(
        coverage,
        layout.metrics,
        layout.measureHierarchy,
        layout.pivotProgram.metricKeys.length > 0 &&
          (rowDepth > 0 || columnDepth > 0),
        needsTotals && (rowDepth === 0 || columnDepth === 0),
      ),
      measureHierarchy: layout.measureHierarchy,
      requiredTimeOffsets: layout.requiredTimeOffsets,
      queryContextKey,
      scope: { kind: 'root' },
      filters: [],
    });
  });
};

export const buildInitialQuerySpecs = (
  formData: PivotTableQueryFormData,
  layout: LayoutContext = buildLayoutContext(formData),
): PlannedQuerySpec[] => buildRootSpecs(compileQueryContext(formData, layout));

const buildAxisPathExpansionSpecs = ({
  context,
  targets,
}: {
  context: QueryContext;
  targets: ExpansionCoverageTarget[];
}): PlannedQuerySpec[] => {
  const { formData } = context;
  const coverageTarget = targets[0];
  if (!coverageTarget) {
    return [];
  }
  if (
    coverageTarget.need.rowScope.kind === 'root' &&
    coverageTarget.need.columnScope.kind === 'root'
  ) {
    return buildRootSpecs(context, [coverageTarget.need]);
  }
  const { axis } = coverageTarget;
  const path = parsePath(coverageTarget.pathKey);
  const scopedPaths = targets.flatMap(targetScopePaths);
  return buildAxisExpansionSpecs({
    context,
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
  context,
  target,
}: {
  context: QueryContext;
  target: ExpansionCoverageTarget;
}): PlannedQuerySpec[] => {
  const { formData, layout } = context;
  const rowPaths = pathsFromAxisScope(target.need.rowScope);
  const columnPaths = pathsFromAxisScope(target.need.columnScope);
  const anchor = resolveIntersectionExpansionAnchor({
    layout,
    rowPaths,
    columnPaths,
  });
  // SQL filter conjunctions cannot express IN (..., NULL). Group by nullness
  // at every path level so each selector describes exactly the requested scope.
  const groupPaths = (paths: PivotPath[]) => {
    const groups = new Map<string, PivotPath[]>();
    paths.forEach(path => {
      const key = path.map(value => (isNullish(value) ? 'n' : 'v')).join('');
      const group = groups.get(key);
      if (group) group.push(path);
      else groups.set(key, [path]);
    });
    return Array.from(groups.values());
  };
  const columnGroups = groupPaths(columnPaths);
  return groupPaths(rowPaths).flatMap(rowGroup =>
    columnGroups.flatMap(columnGroup =>
      buildAxisExpansionSpecs({
        context,
        axis: anchor.axis,
        path: anchor.path,
        coverageTarget: target,
        filters: [
          ...buildPathSetFilterClauses({
            axisGroupby: target.need.rowDimensions,
            paths: rowGroup,
            colTypeMap: formData.colTypeMap,
          }),
          ...buildPathSetFilterClauses({
            axisGroupby: target.need.columnDimensions,
            paths: columnGroup,
            colTypeMap: formData.colTypeMap,
          }),
        ],
        scope: {
          kind: 'intersection',
          rowPaths: rowGroup,
          columnPaths: columnGroup,
        },
      }),
    ),
  );
};

export const buildExpansionQuerySpecPhases = ({
  formData,
  layout,
  targets,
}: ExpansionSpecContext & {
  targets: ExpansionCoverageTarget[];
}): PlannedQuerySpec[][] => {
  const context = compileQueryContext(formData, layout);
  const intersections = targets.filter(isIntersectionCoverageTarget);
  const targetGroups = optimizeExpansionFetchPlan({
    targets: targets.filter(target => !isIntersectionCoverageTarget(target)),
  });
  return [
    targetGroups.flatMap(targetGroup =>
      buildAxisPathExpansionSpecs({
        context,
        targets: targetGroup,
      }),
    ),
    intersections.flatMap(target =>
      buildIntersectionTargetExpansionSpecs({
        context,
        target,
      }),
    ),
  ].filter(phase => phase.length > 0);
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
    (formData.dimensions ?? []).map(dimension => [
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
            ...formData.extra_form_data,
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
  const layoutOverride =
    formDataWithOverrides.interactionMode === 'user_controlled'
      ? (runtimeLayout ?? normalizedFormData.pivotRuntimeLayout)
      : undefined;
  const resolvedFormData = resolveInteractionFormData({
    formData: formDataWithOverrides,
    runtimeLayout: layoutOverride,
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
