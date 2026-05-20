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
  type PivotPathValue,
  type PivotTreeNode,
} from '../../types';
import { parsePath } from '../core/path';
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
  buildAxisCoverageKeyFromPathKey,
  canRequestAxisExpansion,
  projectionQueryDimensions,
  projectionQueryFilterPath,
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

export type PivotExpansionCoverageDiff = (
  targets: ExpansionCoverageTarget[],
) => ExpansionCoverageTarget[];

export type BatchCandidate = ExpansionCoverageTarget & {
  batchSignature: string;
};

export type BatchGroup = {
  axis: PivotAxis;
  signature: string;
  parentPathKey: string;
  siblingValues: PivotPathValue[];
  targets: BatchCandidate[];
};

export type IntersectionFetchTarget = {
  kind: 'intersection';
  rowPathKeys: string[];
  columnPathKeys: string[];
  coverageTarget: ExpansionCoverageTarget;
};

export type ExpansionFetchTarget =
  | ExpansionCoverageTarget
  | IntersectionFetchTarget;

export const isIntersectionFetchTarget = (
  target: ExpansionFetchTarget,
): target is IntersectionFetchTarget => 'kind' in target;

export type PivotExpansionPlan = {
  targets: ExpansionCoverageTarget[];
  requiresPathDiscovery: boolean;
};

const targetKey = ({ axis, pathKey, need }: ExpansionCoverageTarget) =>
  `${axis}|${pathKey}|${stableStringify(need)}`;

const axisPathScopeFromPath = (path: PivotPath) => ({
  kind: 'paths' as const,
  paths: [path],
});

const expansionFilterPath = ({
  program,
  axis,
  path,
}: {
  program: PivotProgram;
  axis: PivotAxis;
  path: PivotPath;
}) =>
  projectionQueryFilterPath(
    resolveAxisProjection({
      program,
      axis,
      path,
    }),
  );

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

const pathContainsMetricToken = (path: PivotPath) =>
  path.some(value => decodeMetricKey(value) !== undefined);

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
  const branchDimensions = projectionQueryDimensions(branchProjection);
  const branchDimensionDepth = branchDimensions.length;
  const branchPath =
    branchProjection.valuesLevelSeen || !pathContainsMetricToken(path)
      ? projectionQueryFilterPath(branchProjection)
      : path;
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

export const createExpansionCoverageDiff = ({
  factSelectors,
}: {
  factSelectors: PivotFactSelector[];
}): PivotExpansionCoverageDiff => {
  const cache = new Map<string, boolean>();
  const isLoaded = (target: ExpansionCoverageTarget) => {
    const key = stableStringify(target.need);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const loaded =
      diffCoverageManifest({
        required: [target.need],
        factSelectors,
      }).length === 0;
    cache.set(key, loaded);
    return loaded;
  };
  return targets => targets.filter(target => !isLoaded(target));
};

const coverageKeyForPathKey = (
  program: PivotProgram,
  axis: PivotAxis,
  key: string,
) => buildAxisCoverageKeyFromPathKey({ program, axis, key });

const pathStartsWith = (
  path: PivotTreeNode['path'],
  prefix: PivotTreeNode['path'],
) =>
  prefix.length <= path.length &&
  prefix.every((value, index) => path[index] === value);

const buildGroupedFetchTargets = ({
  axis,
  program,
  targets,
  nodes,
}: {
  axis: PivotAxis;
  program: PivotProgram;
  targets: ExpansionCoverageTarget[];
  nodes: Record<string, PivotTreeNode>;
}): ExpansionCoverageTarget[] => {
  const groups = new Map<string, string[]>();
  const targetByPathKey = new Map(
    targets.map(target => [target.pathKey, target]),
  );
  const fetchTargets: ExpansionCoverageTarget[] = [];

  targets.forEach(({ pathKey }) => {
    const groupKey = coverageKeyForPathKey(program, axis, pathKey);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(pathKey);
    } else {
      groups.set(groupKey, [pathKey]);
    }
  });

  for (const keys of groups.values()) {
    const representative =
      keys.find(
        key => coverageKeyForPathKey(program, axis, key) === key && nodes[key],
      ) ??
      keys.find(key => nodes[key]) ??
      keys[0];

    fetchTargets.push(targetByPathKey.get(representative) ?? targets[0]);
  }

  return fetchTargets;
};

export const planExpansionForAxis = ({
  axis,
  program,
  expandedKeys,
  nodes,
  coverage,
  getMissingExpansionCoverage,
}: {
  axis: PivotAxis;
  program: PivotProgram;
  expandedKeys: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  coverage: PivotExpansionCoverageDepths;
  getMissingExpansionCoverage: PivotExpansionCoverageDiff;
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
  const candidates = Array.from(expandedKeys)
    .filter(key => key !== rootKey || !hasNonRootExpanded)
    .map(key => {
      const node = nodes[key];
      const path = node?.path ?? parsePath(key);
      return { key, node, path };
    })
    .filter(({ path }) => canRequestAxisExpansion({ program, axis, path }))
    .map(candidate => ({ ...candidate, target: buildTarget(candidate.key) }));
  const missingTargetKeys = new Set(
    getMissingExpansionCoverage(candidates.map(({ target }) => target)).map(
      targetKey,
    ),
  );

  candidates.forEach(({ target }) => {
    const keyForTarget = targetKey(target);
    if (!missingTargetKeys.has(keyForTarget)) {
      return;
    }
    const node = nodes[target.pathKey];
    requiresPathDiscovery ||= !node;
    fetchTargets.set(keyForTarget, target);
  });

  const rootTarget = buildTarget(rootKey);
  if (fetchTargets.size > 1 && fetchTargets.has(targetKey(rootTarget))) {
    fetchTargets.delete(targetKey(rootTarget));
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
      fetchTargets.delete(targetKey(target));
    }
  });

  return {
    targets: buildGroupedFetchTargets({
      axis,
      program,
      targets: Array.from(fetchTargets.values()),
      nodes,
    }),
    requiresPathDiscovery,
  };
};
