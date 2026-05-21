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
  type PivotAxis,
  type PivotPath,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { parsePath, serializePath } from '../core/path';
import { decodeMetricKey, isSubtotalToken } from '../core/tokens';
import {
  diffCoverageManifest,
  normalizeFactValueKeys,
  pathsFromAxisScope,
  type PivotAxisCoverageNeed,
  type PivotCoverageNeed,
} from '../runtime/coverage';
import {
  buildFactValueKeys,
  type PivotFactSelector,
  type PivotFactStoreBatchScope,
} from '../runtime/factStore';
import {
  canRequestAxisExpansion,
  getAxisDimensionCount,
  isValuesFirstOnAxis,
  type PivotAxisProjection,
  resolveAxisProjection,
} from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';
import { stableStringify } from '../shared/stableStringify';
import { rootKey } from '../viewModel';
import { createMetricNodePolicy } from '../metricsTotals';

type PivotExpansionCoverageDepths = {
  rowDepth: number;
  columnDepth: number;
};

const PIVOT_EXPANSION_AXES: PivotAxis[] = ['row', 'col'];

const oppositeAxis = (axis: PivotAxis): PivotAxis =>
  axis === 'row' ? 'col' : 'row';

export type ExpansionCoverageTarget = {
  axis: PivotAxis;
  pathKey: string;
  need: PivotCoverageNeed;
};

export const isIntersectionCoverageTarget = (target: ExpansionCoverageTarget) =>
  target.need.rowScope.kind !== 'root' &&
  target.need.columnScope.kind !== 'root';

export const targetAxisScope = (
  target: ExpansionCoverageTarget,
  paths = pathsFromAxisScope(
    target.axis === 'row' ? target.need.rowScope : target.need.columnScope,
  ),
): PivotFactStoreBatchScope => {
  const scope =
    target.axis === 'row' ? target.need.rowScope : target.need.columnScope;
  return scope.kind === 'scopedFull'
    ? {
        kind: 'scopedFull',
        axis: target.axis,
        ancestorPaths: paths,
      }
    : {
        kind: 'axisPaths',
        axis: target.axis,
        paths,
      };
};

export const factSelectorFromTarget = (
  target: ExpansionCoverageTarget,
  queryContextKey: string,
): PivotFactSelector => ({
  coverage: {
    rowDepth: target.need.rowDepth,
    columnDepth: target.need.columnDepth,
    rowDimensions: target.need.rowDimensions,
    columnDimensions: target.need.columnDimensions,
  },
  scope: targetAxisScope(target),
  queryContextKey,
  valueKeys: target.need.valueKeys,
});

const needKey = ({ need }: ExpansionCoverageTarget) => stableStringify(need);

const axisPathScopeFromPath = (path: PivotPath) => ({
  kind: 'scopedFull' as const,
  ancestorPaths: [path],
});

const projectionFilterPath = (projection: PivotAxisProjection) =>
  projection.valuesLevelSeen
    ? [...projection.filterDimensionPath, ...projection.postValuesDimensionPath]
    : projection.filterDimensionPath;

const expansionFilterPath = ({
  program,
  axis,
  path,
}: {
  program: PivotProgram;
  axis: PivotAxis;
  path: PivotPath;
}) => {
  const projection = resolveAxisProjection({
    program,
    axis,
    path,
  });
  return projectionFilterPath(projection);
};

const valueKeysForExpansionPath = (
  path: PivotPath,
  fallbackValueKeys: string[],
) => {
  const metricKeys = path
    .map(value => decodeMetricKey(value))
    .filter((value): value is string => value !== undefined);
  return metricKeys.length > 0
    ? normalizeFactValueKeys(metricKeys)
    : fallbackValueKeys;
};

export const buildAxisExpansionCoverageTarget = ({
  axis,
  pathKey,
  program,
  rowDepth: visibleRowDepth,
  columnDepth: visibleColDepth,
}: {
  axis: PivotAxis;
  pathKey: string;
  program: PivotProgram;
  rowDepth: number;
  columnDepth: number;
}): ExpansionCoverageTarget => {
  const path = parsePath(pathKey);
  const branchProjection = resolveAxisProjection({
    program,
    axis,
    path,
  });
  const branchDimensions = branchProjection.queryDimensions;
  let coverageDimensions = branchDimensions;
  const branchPath = projectionFilterPath(branchProjection);
  if (
    branchProjection.valuesLevelSeen &&
    branchProjection.skippedPreValuesDimensions.length > 0 &&
    branchProjection.postValuesDimensionPath.length === 0
  ) {
    const axisDimensions =
      axis === 'row' ? program.rowDimensions : program.columnDimensions;
    const visibleAxisDepth = axis === 'row' ? visibleRowDepth : visibleColDepth;
    const valuesIndex =
      program.valueAxis === axis
        ? Math.max(
            0,
            Math.min(program.metricInsertIndex, axisDimensions.length),
          )
        : axisDimensions.length;
    const visiblePreValuesDepth = Math.min(
      visibleAxisDepth,
      valuesIndex,
      branchProjection.filterDimensionPath.length + 1,
    );
    if (visiblePreValuesDepth > branchProjection.filterDimensionPath.length) {
      const canonicalDimensions = [
        ...axisDimensions.slice(0, visiblePreValuesDepth),
        ...axisDimensions
          .slice(valuesIndex)
          .slice(0, branchProjection.postValuesDimensionPath.length + 1),
      ];
      if (
        canonicalDimensions.length > visibleAxisDepth &&
        canonicalDimensions.length > branchDimensions.length
      ) {
        coverageDimensions = canonicalDimensions;
      }
    }
  }
  const branchDimensionDepth = coverageDimensions.length;
  const rowDepth = axis === 'row' ? branchDimensionDepth : visibleRowDepth;
  const columnDepth = axis === 'col' ? branchDimensionDepth : visibleColDepth;
  const valueKeys = buildFactValueKeys({
    metricKeys: program.metricKeys,
  });

  return {
    axis,
    pathKey,
    need: {
      rowDepth,
      columnDepth,
      rowDimensions:
        axis === 'row'
          ? coverageDimensions
          : program.rowDimensions.slice(0, rowDepth),
      columnDimensions:
        axis === 'col'
          ? coverageDimensions
          : program.columnDimensions.slice(0, columnDepth),
      valueKeys: valueKeysForExpansionPath(path, valueKeys),
      rowScope:
        axis === 'row' ? axisPathScopeFromPath(branchPath) : { kind: 'root' },
      columnScope:
        axis === 'col' ? axisPathScopeFromPath(branchPath) : { kind: 'root' },
    },
  };
};

const buildAxisCoverageNeedTarget = ({
  need,
  program,
  rowDepth: visibleRowDepth,
  columnDepth: visibleColDepth,
}: {
  need: PivotAxisCoverageNeed;
  program: PivotProgram;
  rowDepth: number;
  columnDepth: number;
}): ExpansionCoverageTarget => ({
  axis: need.axis,
  pathKey: serializePath(pathsFromAxisScope(need.scope)[0] ?? []),
  need: {
    rowDepth: need.axis === 'row' ? need.depth : visibleRowDepth,
    columnDepth: need.axis === 'col' ? need.depth : visibleColDepth,
    rowDimensions: program.rowDimensions.slice(
      0,
      need.axis === 'row' ? need.depth : visibleRowDepth,
    ),
    columnDimensions: program.columnDimensions.slice(
      0,
      need.axis === 'col' ? need.depth : visibleColDepth,
    ),
    valueKeys: buildFactValueKeys({ metricKeys: program.metricKeys }),
    rowScope: need.axis === 'row' ? need.scope : { kind: 'root' },
    columnScope: need.axis === 'col' ? need.scope : { kind: 'root' },
  },
});

export const buildIntersectionCoverageTarget = ({
  program,
  rowPathKeys,
  columnPathKeys,
  rowDepth,
  columnDepth,
}: {
  program: PivotProgram;
  rowPathKeys: string[];
  columnPathKeys: string[];
  rowDepth: number;
  columnDepth: number;
}): ExpansionCoverageTarget => ({
  axis: 'row',
  pathKey: rootKey,
  need: {
    rowDepth,
    columnDepth,
    rowDimensions: program.rowDimensions.slice(0, rowDepth),
    columnDimensions: program.columnDimensions.slice(0, columnDepth),
    valueKeys: buildFactValueKeys({
      metricKeys: program.metricKeys,
    }),
    rowScope: {
      kind: 'paths',
      paths: rowPathKeys.map(pathKey =>
        expansionFilterPath({
          program,
          axis: 'row',
          path: parsePath(pathKey),
        }),
      ),
    },
    columnScope: {
      kind: 'paths',
      paths: columnPathKeys.map(pathKey =>
        expansionFilterPath({
          program,
          axis: 'col',
          path: parsePath(pathKey),
        }),
      ),
    },
  },
});

const pathStartsWith = (path: PivotPath, prefix: PivotPath) =>
  prefix.every((value, index) => path[index] === value);

const addAncestors = (path: PivotPath, expanded: Set<string>) => {
  for (let depth = 0; depth <= path.length; depth += 1) {
    expanded.add(serializePath(path.slice(0, depth)));
  }
};

export const buildExpandedKeysForCoverageNeeds = ({
  axis,
  tree,
  axisCoverageNeeds,
  program,
}: {
  axis: PivotAxis;
  tree: PivotTreeData;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  program: PivotProgram;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const { metricLabelSet, countDimDepth } = createMetricNodePolicy(program);
  const expanded = new Set<string>([rootKey]);
  axisCoverageNeeds.forEach(need => {
    if (need.axis !== axis) {
      return;
    }
    if (need.scope.kind === 'root') {
      return;
    }
    if (need.scope.kind === 'paths') {
      need.scope.paths.forEach(path => addAncestors(path, expanded));
      return;
    }
    const includeMetricDepthZero =
      program.metricKeys.length > 0 &&
      isValuesFirstOnAxis(program, need.axis) &&
      need.depth > 0;
    need.scope.ancestorPaths.forEach(anchor => {
      addAncestors(anchor, expanded);
      Object.values(nodes).forEach(node => {
        if (!pathStartsWith(node.path, anchor)) {
          return;
        }
        const lastValue = node.path[node.path.length - 1];
        const decodedMetric = decodeMetricKey(lastValue);
        const isMetricNode = decodedMetric
          ? metricLabelSet.has(decodedMetric)
          : false;
        const depth = countDimDepth(
          node.path.filter(val => !isSubtotalToken(val)),
        );
        if (
          depth > 0 &&
          (isMetricNode ? depth < need.depth : depth <= need.depth)
        ) {
          addAncestors(node.path, expanded);
          return;
        }
        if (includeMetricDepthZero && depth === 0 && isMetricNode) {
          addAncestors(node.path, expanded);
        }
      });
    });
  });
  return expanded;
};

export const planExpansionForAxis = ({
  axis,
  program,
  expandedKeys,
  coverage,
}: {
  axis: PivotAxis;
  program: PivotProgram;
  expandedKeys: Set<string>;
  coverage: PivotExpansionCoverageDepths;
  nodes?: Record<string, PivotTreeNode>;
  factSelectors?: PivotFactSelector[];
}): ExpansionCoverageTarget[] => {
  const fetchTargets = new Map<string, ExpansionCoverageTarget>();
  const hasNonRootExpanded =
    expandedKeys.size > 1 ||
    (expandedKeys.size === 1 && !expandedKeys.has(rootKey));

  const buildTarget = (key: string): ExpansionCoverageTarget =>
    buildAxisExpansionCoverageTarget({
      axis,
      pathKey: key,
      program,
      ...coverage,
    });
  const candidates = Array.from(expandedKeys)
    .filter(key => key !== rootKey || !hasNonRootExpanded)
    .map(key => ({ key, path: parsePath(key) }))
    .filter(({ path }) => {
      if (!canRequestAxisExpansion({ program, axis, path })) {
        return false;
      }
      const projection = resolveAxisProjection({ program, axis, path });
      if (projection.skippedPreValuesDimensions.length === 0) {
        return true;
      }
      const ancestorKey =
        projection.filterDimensionPath.length === 0
          ? rootKey
          : serializePath(projection.filterDimensionPath);
      return expandedKeys.has(ancestorKey);
    })
    .map(candidate => ({ ...candidate, target: buildTarget(candidate.key) }));

  candidates.forEach(({ target }) => {
    fetchTargets.set(needKey(target), target);
  });

  const rootTarget = buildTarget(rootKey);
  const rootNeedKey = needKey(rootTarget);
  if (fetchTargets.size > 1 && fetchTargets.has(rootNeedKey)) {
    fetchTargets.delete(rootNeedKey);
  }

  return Array.from(fetchTargets.values());
};

const selectMissingCoverageTargets = ({
  targets,
  factSelectors,
  queryContextKey,
}: {
  targets: ExpansionCoverageTarget[];
  factSelectors: PivotFactSelector[];
  queryContextKey: string;
}) => {
  const plannedSelectors = [...factSelectors];
  return targets.filter(target => {
    const isMissing =
      diffCoverageManifest({
        required: [target.need],
        factSelectors: plannedSelectors,
      }).length > 0;
    if (isMissing) {
      plannedSelectors.push(factSelectorFromTarget(target, queryContextKey));
    }
    return isMissing;
  });
};

const dropRedundantAncestorExpansionTargets = ({
  targets,
  rowDepth,
  columnDepth,
}: {
  targets: ExpansionCoverageTarget[];
  rowDepth: number;
  columnDepth: number;
}) =>
  targets.filter(target => {
    const path = parsePath(target.pathKey);
    const axisDepth = target.axis === 'row' ? rowDepth : columnDepth;
    return !(
      path.length > axisDepth &&
      targets.some(ancestorTarget => {
        const ancestorPath = parsePath(ancestorTarget.pathKey);
        return (
          ancestorTarget.pathKey !== target.pathKey &&
          ancestorPath.length > 0 &&
          ancestorPath.length < path.length &&
          pathStartsWith(path, ancestorPath)
        );
      })
    );
  });

const depthForExpansionKeys = ({
  axis,
  axisCoverageNeeds,
  expanded,
  program,
}: {
  axis: PivotAxis;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  expanded: Set<string>;
  program: PivotProgram;
}) => {
  const { countDimDepth } = createMetricNodePolicy(program);
  const dimensionCount = getAxisDimensionCount(program, axis);
  const configuredDepth = axisCoverageNeeds.reduce(
    (max, need) => (need.axis === axis ? Math.max(max, need.depth) : max),
    0,
  );
  const expansionDepth = Array.from(expanded).reduce((max, key) => {
    if (key === rootKey) {
      return Math.max(max, dimensionCount > 0 ? 1 : 0);
    }
    return Math.max(
      max,
      countDimDepth(parsePath(key).filter(val => !isSubtotalToken(val))) + 1,
    );
  }, 0);
  return Math.min(dimensionCount, Math.max(configuredDepth, expansionDepth));
};

export const planHydrationIteration = ({
  desired,
  axisCoverageNeeds = [],
  factSelectors,
  program,
  queryContextKey = '',
}: {
  desired: Record<PivotAxis, Set<string>>;
  axisCoverageNeeds?: PivotAxisCoverageNeed[];
  factSelectors: PivotFactSelector[];
  program: PivotProgram;
  queryContextKey?: string;
  tree?: PivotTreeData;
}) => {
  const coverageDepths = Object.fromEntries(
    PIVOT_EXPANSION_AXES.map(axis => [
      axis === 'row' ? 'rowDepth' : 'columnDepth',
      depthForExpansionKeys({
        axis,
        expanded: desired[axis],
        axisCoverageNeeds,
        program,
      }),
    ]),
  ) as PivotExpansionCoverageDepths;
  const pathKeysByAxis = Object.fromEntries(
    PIVOT_EXPANSION_AXES.map(axis => [
      axis,
      Array.from(desired[axis]).filter(key => key !== rootKey),
    ]),
  ) as Record<PivotAxis, string[]>;
  const directCoverageTargets = selectMissingCoverageTargets({
    targets: axisCoverageNeeds.map(need =>
      buildAxisCoverageNeedTarget({
        need,
        program,
        ...coverageDepths,
      }),
    ),
    factSelectors,
    queryContextKey,
  });
  const factSelectorsWithPlannedCoverage = [
    ...factSelectors,
    ...directCoverageTargets.map(target =>
      factSelectorFromTarget(target, queryContextKey),
    ),
  ];
  const axisTargets = PIVOT_EXPANSION_AXES.flatMap(axis =>
    dropRedundantAncestorExpansionTargets({
      targets: selectMissingCoverageTargets({
        targets: planExpansionForAxis({
          axis,
          program,
          expandedKeys:
            pathKeysByAxis[axis].length === 0 &&
            pathKeysByAxis[oppositeAxis(axis)].length > 0
              ? new Set<string>()
              : desired[axis],
          coverage: coverageDepths,
        }),
        factSelectors: factSelectorsWithPlannedCoverage,
        queryContextKey,
      }),
      ...coverageDepths,
    }),
  );

  const shouldCheckIntersection =
    coverageDepths.rowDepth > 0 &&
    coverageDepths.columnDepth > 0 &&
    pathKeysByAxis.row.length > 0 &&
    pathKeysByAxis.col.length > 0 &&
    pathKeysByAxis.row.length * pathKeysByAxis.col.length > 1;
  const intersectionCoverageTarget = shouldCheckIntersection
    ? buildIntersectionCoverageTarget({
        program,
        rowDepth: coverageDepths.rowDepth,
        columnDepth: coverageDepths.columnDepth,
        rowPathKeys: pathKeysByAxis.row,
        columnPathKeys: pathKeysByAxis.col,
      })
    : undefined;
  const intersectionTargets =
    intersectionCoverageTarget &&
    selectMissingCoverageTargets({
      targets: [intersectionCoverageTarget],
      factSelectors,
      queryContextKey,
    }).length > 0
      ? [intersectionCoverageTarget]
      : [];
  const targets = [
    ...directCoverageTargets,
    ...axisTargets,
    ...intersectionTargets,
  ];

  return targets.length === 0
    ? { kind: 'complete' as const, targets: [] }
    : { kind: 'fetch' as const, targets };
};
