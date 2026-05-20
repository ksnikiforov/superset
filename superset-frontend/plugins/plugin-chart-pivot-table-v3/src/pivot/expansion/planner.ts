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
  type PivotCoverageNeed,
} from '../runtime/coverage';
import {
  buildFactValueKeys,
  type PivotFactSelector,
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

export type PivotExpansionPlan = {
  targets: ExpansionCoverageTarget[];
  requiresPathDiscovery: boolean;
};

const needKey = ({ need }: ExpansionCoverageTarget) => stableStringify(need);

const axisPathScopeFromPath = (path: PivotPath) => ({
  kind: 'paths' as const,
  paths: [path],
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

const axisDimensionsFor = (program: PivotProgram, axis: PivotAxis) =>
  axis === 'row' ? program.rowDimensions : program.columnDimensions;

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
  const branchDimensionDepth = branchDimensions.length;
  const branchPath = projectionFilterPath(branchProjection);
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
          ? branchDimensions
          : program.rowDimensions.slice(0, rowDepth),
      columnDimensions:
        axis === 'col'
          ? branchDimensions
          : program.columnDimensions.slice(0, columnDepth),
      valueKeys: valueKeysForExpansionPath(path, valueKeys),
      rowScope:
        axis === 'row' ? axisPathScopeFromPath(branchPath) : { kind: 'root' },
      columnScope:
        axis === 'col' ? axisPathScopeFromPath(branchPath) : { kind: 'root' },
    },
  };
};

const buildCanonicalSkippedValuesCoverageTarget = ({
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
}): ExpansionCoverageTarget | undefined => {
  const path = parsePath(pathKey);
  const projection = resolveAxisProjection({
    program,
    axis,
    path,
  });
  if (
    !projection.valuesLevelSeen ||
    projection.skippedPreValuesDimensions.length === 0
  ) {
    return undefined;
  }
  const dimensions = axisDimensionsFor(program, axis);
  const visibleAxisDepth = axis === 'row' ? visibleRowDepth : visibleColDepth;
  const valuesIndex =
    program.valueAxis === axis
      ? Math.max(0, Math.min(program.metricInsertIndex, dimensions.length))
      : dimensions.length;
  const visiblePreValuesDepth = Math.min(
    visibleAxisDepth,
    valuesIndex,
    projection.filterDimensionPath.length + 1,
  );
  if (visiblePreValuesDepth <= projection.filterDimensionPath.length) {
    return undefined;
  }
  const postValuesDimensions = dimensions
    .slice(valuesIndex)
    .slice(0, projection.postValuesDimensionPath.length + 1);
  const branchDimensions = [
    ...dimensions.slice(0, visiblePreValuesDepth),
    ...postValuesDimensions,
  ];
  const canonicalDepth = branchDimensions.length;
  const skippedDepth = axis === 'row' ? visibleRowDepth : visibleColDepth;
  const baseTarget = buildAxisExpansionCoverageTarget({
    axis,
    pathKey,
    program,
    rowDepth: visibleRowDepth,
    columnDepth: visibleColDepth,
  });
  const baseDepth =
    axis === 'row' ? baseTarget.need.rowDepth : baseTarget.need.columnDepth;
  if (canonicalDepth <= skippedDepth || canonicalDepth <= baseDepth) {
    return undefined;
  }
  const rowDepth = axis === 'row' ? canonicalDepth : visibleRowDepth;
  const columnDepth = axis === 'col' ? canonicalDepth : visibleColDepth;
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
          ? branchDimensions
          : program.rowDimensions.slice(0, rowDepth),
      columnDimensions:
        axis === 'col'
          ? branchDimensions
          : program.columnDimensions.slice(0, columnDepth),
      valueKeys: valueKeysForExpansionPath(path, valueKeys),
      rowScope:
        axis === 'row'
          ? axisPathScopeFromPath(projection.filterDimensionPath)
          : { kind: 'root' },
      columnScope:
        axis === 'col'
          ? axisPathScopeFromPath(projection.filterDimensionPath)
          : { kind: 'root' },
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
}): PivotExpansionPlan => {
  const fetchTargets = new Map<string, ExpansionCoverageTarget>();
  let requiresPathDiscovery = false;
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
  const buildCanonicalSkippedTarget = (key: string) =>
    buildCanonicalSkippedValuesCoverageTarget({
      axis,
      pathKey: key,
      program,
      ...coverage,
    });
  const candidates = Array.from(expandedKeys)
    .filter(key => key !== rootKey || !hasNonRootExpanded)
    .map(key => {
      const node = nodes[key];
      const path = node?.path ?? parsePath(key);
      return { key, node, path };
    })
    .filter(({ path }) => canRequestAxisExpansion({ program, axis, path }))
    .map(candidate => ({ ...candidate, target: buildTarget(candidate.key) }));
  const candidateKeys = new Set(candidates.map(candidate => candidate.key));
  const canonicalSkippedCandidates = candidates.flatMap(candidate => {
    const projection = resolveAxisProjection({
      program,
      axis,
      path: candidate.path,
    });
    const ancestorKey =
      projection.filterDimensionPath.length === 0
        ? rootKey
        : serializePath(projection.filterDimensionPath);
    if (!candidateKeys.has(ancestorKey)) {
      return [];
    }
    const target = buildCanonicalSkippedTarget(candidate.key);
    return target ? [{ ...candidate, target }] : [];
  });
  const allCandidates = [...candidates, ...canonicalSkippedCandidates];
  const missingTargetKeys = new Set(
    filterMissingExpansionCoverageTargets({
      targets: allCandidates.map(({ target }) => target),
      factSelectors,
    }).map(needKey),
  );

  allCandidates.forEach(({ target }) => {
    const keyForTarget = needKey(target);
    if (!missingTargetKeys.has(keyForTarget)) {
      return;
    }
    const node = nodes[target.pathKey];
    requiresPathDiscovery ||= !node;
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

  return {
    targets: Array.from(fetchTargets.values()),
    requiresPathDiscovery,
  };
};
