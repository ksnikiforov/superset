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
  type PivotTreeNode,
} from '../../types';
import { parsePath, serializePath } from '../core/path';
import { decodeMetricKey } from '../core/tokens';
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
  type PivotAxisProjection,
  resolveAxisProjection,
} from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';
import { stableStringify } from '../shared/stableStringify';
import { rootKey } from '../viewModel';

type PivotExpansionCoverageDepths = {
  rowDepth: number;
  columnDepth: number;
};

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
): PivotFactSelector => ({
  coverage: {
    rowDepth: target.need.rowDepth,
    columnDepth: target.need.columnDepth,
    rowDimensions: target.need.rowDimensions,
    columnDimensions: target.need.columnDimensions,
  },
  scope: targetAxisScope(target),
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

export const buildAxisCoverageNeedTarget = ({
  need,
  program,
  rowDepth: visibleRowDepth,
  columnDepth: visibleColDepth,
}: {
  need: PivotAxisCoverageNeed;
  program: PivotProgram;
  rowDepth: number;
  columnDepth: number;
}): ExpansionCoverageTarget => {
  const rowDepth = need.axis === 'row' ? need.depth : visibleRowDepth;
  const columnDepth = need.axis === 'col' ? need.depth : visibleColDepth;
  return {
    axis: need.axis,
    pathKey: serializePath(pathsFromAxisScope(need.scope)[0] ?? []),
    need: {
      rowDepth,
      columnDepth,
      rowDimensions: program.rowDimensions.slice(0, rowDepth),
      columnDimensions: program.columnDimensions.slice(0, columnDepth),
      valueKeys: buildFactValueKeys({
        metricKeys: program.metricKeys,
      }),
      rowScope: need.axis === 'row' ? need.scope : { kind: 'root' },
      columnScope: need.axis === 'col' ? need.scope : { kind: 'root' },
    },
  };
};

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

export const filterMissingExpansionCoverageTargets = ({
  targets,
  factSelectors,
}: {
  targets: ExpansionCoverageTarget[];
  factSelectors: PivotFactSelector[];
}) => {
  const missingNeedKeys = new Set(
    diffCoverageManifest({
      required: targets.map(target => target.need),
      factSelectors,
    }).map(stableStringify),
  );
  return targets.filter(target =>
    missingNeedKeys.has(stableStringify(target.need)),
  );
};

const pathStartsWith = (
  path: PivotTreeNode['path'],
  prefix: PivotTreeNode['path'],
) =>
  prefix.length <= path.length &&
  prefix.every((value, index) => path[index] === value);

export const planExpansionForAxis = ({
  axis,
  program,
  expandedKeys,
  nodes,
  coverage,
  factSelectors,
}: {
  axis: PivotAxis;
  program: PivotProgram;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  coverage: PivotExpansionCoverageDepths;
  factSelectors: PivotFactSelector[];
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
    .map(key => {
      const path = nodes[key]?.path ?? parsePath(key);
      return { key, path };
    })
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
  const missingTargetKeys = new Set(
    filterMissingExpansionCoverageTargets({
      targets: candidates.map(({ target }) => target),
      factSelectors,
    }).map(needKey),
  );

  candidates.forEach(({ target }) => {
    const keyForTarget = needKey(target);
    if (!missingTargetKeys.has(keyForTarget)) {
      return;
    }
    fetchTargets.set(keyForTarget, target);
  });

  const rootTarget = buildTarget(rootKey);
  const rootNeedKey = needKey(rootTarget);
  if (fetchTargets.size > 1 && fetchTargets.has(rootNeedKey)) {
    fetchTargets.delete(rootNeedKey);
  }
  const pendingTargets = Array.from(fetchTargets.values()).map(target => ({
    target,
    path: parsePath(target.pathKey),
  }));
  pendingTargets.forEach(({ target, path }) => {
    const axisDepth =
      target.axis === 'row' ? coverage.rowDepth : coverage.columnDepth;
    const hasAncestorRequest = pendingTargets.some(
      ({ target: ancestorTarget, path: ancestorPath }) =>
        ancestorTarget.pathKey !== target.pathKey &&
        ancestorPath.length > 0 &&
        ancestorPath.length < path.length &&
        pathStartsWith(path, ancestorPath),
    );
    if (hasAncestorRequest && path.length > axisDepth) {
      fetchTargets.delete(needKey(target));
    }
  });

  return Array.from(fetchTargets.values());
};
