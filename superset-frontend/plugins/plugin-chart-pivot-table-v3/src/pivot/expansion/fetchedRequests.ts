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
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { parsePath, serializePath } from '../core/path';
import { METRICS_PLACEHOLDER } from '../core/tokens';
import {
  type PivotFactSelector,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { rootKey } from '../viewModel';

export type FetchedFactCoverageState = {
  depthByAxis: Record<PivotAxis, Map<string, number>>;
};

export type FetchedFactRequestProjection = {
  axis: PivotAxis;
  pathKey: string;
  requiredOppositeDepth: number;
};

export type FetchedFactCoverageLookup = {
  getFetchedDepth: (
    projection: FetchedFactRequestProjection,
  ) => number | undefined;
  isSameFetchedCoverage: (
    left: FetchedFactRequestProjection,
    right: FetchedFactRequestProjection,
  ) => boolean;
};

type CreateFetchedFactCoverageStateConfig = Partial<
  Record<PivotAxis, Map<string, number>>
>;

export const createFetchedFactCoverageState = ({
  row = new Map<string, number>(),
  col = new Map<string, number>(),
}: CreateFetchedFactCoverageStateConfig = {}): FetchedFactCoverageState => ({
  depthByAxis: { row, col },
});

export const projectFactRequestToFetchedCoverage = ({
  coverage,
  scope,
}: PivotFactSelector): FetchedFactRequestProjection[] => {
  switch (scope.kind) {
    case 'bootstrap':
    case 'root':
      return [];
    case 'branch': {
      const requiredOppositeDepth =
        scope.axis === 'row' ? coverage.columnDepth : coverage.rowDepth;
      return [
        {
          axis: scope.axis,
          pathKey: serializePath(scope.path),
          requiredOppositeDepth,
        },
      ];
    }
    case 'batch': {
      const requiredOppositeDepth =
        scope.axis === 'row' ? coverage.columnDepth : coverage.rowDepth;
      const paths =
        scope.siblingValues.length > 0
          ? scope.siblingValues.map(value => [...scope.parentPath, value])
          : [scope.parentPath];
      return paths.map(path => ({
        axis: scope.axis,
        pathKey: serializePath(path),
        requiredOppositeDepth,
      }));
    }
    default:
      return [];
  }
};

export const getFetchedAxisDepthMap = (
  fetchedCoverage: FetchedFactCoverageState,
  axis: PivotAxis,
) => fetchedCoverage.depthByAxis[axis];

export const createFetchedFactCoverageLookup = ({
  fetchedCoverage,
  getCoverageKey,
}: {
  fetchedCoverage: FetchedFactCoverageState;
  getCoverageKey: (axis: PivotAxis, pathKey: string) => string;
}): FetchedFactCoverageLookup => ({
  getFetchedDepth: ({ axis, pathKey }) =>
    getFetchedAxisDepthMap(fetchedCoverage, axis).get(
      getCoverageKey(axis, pathKey),
    ),
  isSameFetchedCoverage: (left, right) =>
    left.axis === right.axis &&
    getCoverageKey(left.axis, left.pathKey) ===
      getCoverageKey(right.axis, right.pathKey),
});

const markFetchedAxisCoverage = ({
  fetchedCoverage,
  getCoverageKey,
  axis,
  pathKey,
  requiredOppositeDepth,
}: {
  fetchedCoverage: FetchedFactCoverageState;
  getCoverageKey: (axis: PivotAxis, pathKey: string) => string;
  axis: PivotAxis;
  pathKey: string;
  requiredOppositeDepth: number;
}) => {
  const depthByKey = getFetchedAxisDepthMap(fetchedCoverage, axis);
  const coverageKey = getCoverageKey(axis, pathKey);
  const existingDepth = depthByKey.get(coverageKey);
  depthByKey.set(
    coverageKey,
    existingDepth === undefined
      ? requiredOppositeDepth
      : Math.max(existingDepth, requiredOppositeDepth),
  );
};

export const markFetchedFactRequestCoverage = ({
  fetchedCoverage,
  getCoverageKey,
  selector,
}: {
  fetchedCoverage: FetchedFactCoverageState;
  getCoverageKey: (axis: PivotAxis, pathKey: string) => string;
  selector: PivotFactSelector;
}) => {
  projectFactRequestToFetchedCoverage(selector).forEach(
    ({ axis, pathKey, requiredOppositeDepth }) => {
      markFetchedAxisCoverage({
        fetchedCoverage,
        getCoverageKey,
        axis,
        pathKey,
        requiredOppositeDepth,
      });
    },
  );
};

export const seedFetchedCoverageFromFactBatches = ({
  fetchedCoverage,
  getCoverageKey,
  batches,
}: {
  fetchedCoverage: FetchedFactCoverageState;
  getCoverageKey: (axis: PivotAxis, pathKey: string) => string;
  batches: PivotFactStoreBatch[];
}) => {
  batches.forEach(batch => {
    markFetchedFactRequestCoverage({
      fetchedCoverage,
      getCoverageKey,
      selector: { coverage: batch.coverage, scope: batch.scope },
    });
  });
};

const isDescendantPath = (
  parentPath: PivotTreeNode['path'],
  candidatePath: PivotTreeNode['path'],
) => parentPath.every((value, idx) => value === candidatePath[idx]);

export const pruneFetchedCoverageForCollapsedNode = ({
  fetchedCoverage,
  axis,
  parentPath,
  nodes,
  parentKey,
}: {
  fetchedCoverage: FetchedFactCoverageState;
  axis: PivotAxis;
  parentPath: PivotTreeNode['path'];
  nodes: Record<string, PivotTreeNode>;
  parentKey: string;
}) => {
  const fetchedDepths = getFetchedAxisDepthMap(fetchedCoverage, axis);
  if (fetchedDepths.size === 0) {
    return;
  }
  const next = new Map<string, number>();
  fetchedDepths.forEach((depth, key) => {
    if (key === parentKey) {
      return;
    }
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    if (isDescendantPath(parentPath, path)) {
      return;
    }
    next.set(key, depth);
  });
  fetchedDepths.clear();
  next.forEach((depth, key) => {
    fetchedDepths.set(key, depth);
  });
};

const remapFetchedDepthsForStableTrim = ({
  fetchedDepthByKey,
  stablePrefix,
  countDimDepth,
}: {
  fetchedDepthByKey: Map<string, number>;
  stablePrefix: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
}) => {
  if (fetchedDepthByKey.size === 0 || stablePrefix <= 0) {
    return new Map<string, number>();
  }
  const countCoverageDimDepth = (path: PivotTreeNode['path']) =>
    countDimDepth(path.filter(value => value !== METRICS_PLACEHOLDER));
  const next = new Map<string, number>();
  fetchedDepthByKey.forEach((requiredDepth, key) => {
    let candidatePath = parsePath(key);
    while (
      candidatePath.length > 0 &&
      countCoverageDimDepth(candidatePath) > stablePrefix
    ) {
      candidatePath = candidatePath.slice(0, candidatePath.length - 1);
    }
    const candidateKey = serializePath(candidatePath);
    if (candidateKey === rootKey && key !== rootKey) {
      return;
    }
    const existingDepth = next.get(candidateKey);
    next.set(
      candidateKey,
      existingDepth === undefined
        ? requiredDepth
        : Math.max(existingDepth, requiredDepth),
    );
  });
  return next;
};

const mapExpandedCoverageForStableTrim = ({
  axis,
  expandedKeys,
  previousNodes,
  nextNodes,
  stablePrefix,
  requiredOppositeDepth,
  countDimDepth,
  getCoverageKey,
}: {
  axis: PivotAxis;
  expandedKeys: Set<string>;
  previousNodes: Record<string, PivotTreeNode>;
  nextNodes: Record<string, PivotTreeNode>;
  stablePrefix: number;
  requiredOppositeDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
}) => {
  if (expandedKeys.size === 0 || stablePrefix <= 0) {
    return new Map<string, number>();
  }
  const resolveNearestSurvivingKey = (key: string) => {
    if (nextNodes[key]) {
      return key;
    }
    const path = parsePath(key);
    for (let size = path.length - 1; size >= 0; size -= 1) {
      const candidate = serializePath(path.slice(0, size));
      if (nextNodes[candidate]) {
        return candidate;
      }
    }
    return nextNodes[rootKey] ? rootKey : undefined;
  };
  const next = new Map<string, number>();
  expandedKeys.forEach(key => {
    if (key === rootKey) {
      return;
    }
    const node = previousNodes[key];
    if (!node) {
      return;
    }
    const hasPreviousDescendants = Object.values(previousNodes).some(
      candidate => {
        if (candidate.key === node.key) {
          return false;
        }
        if (candidate.path.length <= node.path.length) {
          return false;
        }
        return isDescendantPath(node.path, candidate.path);
      },
    );
    if (!node.hasChildren && !hasPreviousDescendants) {
      return;
    }
    let candidatePath = node.path;
    while (
      candidatePath.length > 0 &&
      countDimDepth(candidatePath) > stablePrefix
    ) {
      candidatePath = candidatePath.slice(0, candidatePath.length - 1);
    }
    const candidateKey = serializePath(candidatePath);
    const resolvedKey = resolveNearestSurvivingKey(candidateKey);
    if (resolvedKey === undefined || resolvedKey === rootKey) {
      return;
    }
    const resolvedNode = nextNodes[resolvedKey];
    if (!resolvedNode || countDimDepth(resolvedNode.path) > stablePrefix) {
      return;
    }
    const coverageKey = getCoverageKey(axis, resolvedKey);
    const existingDepth = next.get(coverageKey);
    next.set(
      coverageKey,
      existingDepth === undefined
        ? requiredOppositeDepth
        : Math.max(existingDepth, requiredOppositeDepth),
    );
  });
  return next;
};

const mergeFetchedDepths = (
  target: Map<string, number>,
  source: Map<string, number>,
) => {
  source.forEach((depth, key) => {
    const existing = target.get(key);
    target.set(key, existing === undefined ? depth : Math.max(existing, depth));
  });
};

export const buildFetchedCoverageForStableTrim = ({
  fetchedCoverage,
  previousTree,
  nextTree,
  expandedRows,
  expandedCols,
  shouldCarryRows,
  shouldCarryCols,
  rowStablePrefix,
  colStablePrefix,
  previousVisibleRowDepth,
  previousVisibleColDepth,
  countDimDepth,
  getCoverageKey,
}: {
  fetchedCoverage: FetchedFactCoverageState;
  previousTree: PivotTreeData;
  nextTree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  shouldCarryRows: boolean;
  shouldCarryCols: boolean;
  rowStablePrefix: number;
  colStablePrefix: number;
  previousVisibleRowDepth: number;
  previousVisibleColDepth: number;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  getCoverageKey: (axis: PivotAxis, key: string) => string;
}) => {
  const remappedRows = shouldCarryRows
    ? remapFetchedDepthsForStableTrim({
        fetchedDepthByKey: getFetchedAxisDepthMap(fetchedCoverage, 'row'),
        stablePrefix: rowStablePrefix,
        countDimDepth,
      })
    : new Map<string, number>();
  const remappedCols = shouldCarryCols
    ? remapFetchedDepthsForStableTrim({
        fetchedDepthByKey: getFetchedAxisDepthMap(fetchedCoverage, 'col'),
        stablePrefix: colStablePrefix,
        countDimDepth,
      })
    : new Map<string, number>();

  const expandedRowCoverage = shouldCarryRows
    ? mapExpandedCoverageForStableTrim({
        axis: 'row',
        expandedKeys: expandedRows,
        previousNodes: previousTree.rows,
        nextNodes: nextTree.rows,
        stablePrefix: rowStablePrefix,
        requiredOppositeDepth: previousVisibleColDepth,
        countDimDepth,
        getCoverageKey,
      })
    : new Map<string, number>();
  const expandedColCoverage = shouldCarryCols
    ? mapExpandedCoverageForStableTrim({
        axis: 'col',
        expandedKeys: expandedCols,
        previousNodes: previousTree.cols,
        nextNodes: nextTree.cols,
        stablePrefix: colStablePrefix,
        requiredOppositeDepth: previousVisibleRowDepth,
        countDimDepth,
        getCoverageKey,
      })
    : new Map<string, number>();

  mergeFetchedDepths(remappedRows, expandedRowCoverage);
  mergeFetchedDepths(remappedCols, expandedColCoverage);

  return createFetchedFactCoverageState({
    row: remappedRows,
    col: remappedCols,
  });
};
