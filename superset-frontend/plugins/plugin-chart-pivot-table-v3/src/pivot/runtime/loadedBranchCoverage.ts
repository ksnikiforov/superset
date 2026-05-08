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
} from '../../types';
import { serializePath } from '../core/path';
import { isMetricToken, isSubtotalToken } from '../core/tokens';
import { buildFactCoverage } from './coverage';
import {
  buildPivotFactRequestKey,
  type PivotFactStoreBatch,
} from './factStore';
import { type PivotProgram } from './types';

export type LoadedBranchPathInput = {
  axis: PivotAxis;
  tree?: PivotTreeData;
  basePaths: PivotPath[];
  seedPaths?: PivotPath[];
};

export type LoadedBranchCoverageMarkerInput = LoadedBranchPathInput & {
  pivotProgram: PivotProgram;
  visibleRowDepth: number;
  visibleColDepth: number;
  existingBatches?: PivotFactStoreBatch[];
};

const pathStartsWith = (path: PivotPath, basePath: PivotPath) =>
  basePath.every((value, index) => path[index] === value);

const isSameOrDescendantPath = (path: PivotPath, basePath: PivotPath) =>
  path.length >= basePath.length && pathStartsWith(path, basePath);

const isDirectChildPath = (childPath: PivotPath, parentPath: PivotPath) =>
  childPath.length === parentPath.length + 1 &&
  pathStartsWith(childPath, parentPath);

const isDimensionalChildValue = (value: PivotPath[number]) =>
  !isMetricToken(value) && !isSubtotalToken(value);

export const collectLoadedBranchPaths = ({
  axis,
  tree,
  basePaths,
  seedPaths = [],
}: LoadedBranchPathInput): PivotPath[] => {
  const pathsByKey = new Map<string, PivotPath>();
  seedPaths.forEach(path => {
    pathsByKey.set(serializePath(path), path);
  });
  if (!tree || basePaths.length === 0) {
    return Array.from(pathsByKey.values());
  }

  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const hasLoadedDimensionalChild = (path: PivotPath) =>
    Object.values(nodes).some(node => {
      if (!isDirectChildPath(node.path, path)) {
        return false;
      }
      return isDimensionalChildValue(node.path[path.length]);
    });

  Object.values(nodes).forEach(node => {
    if (
      !node.hasChildren ||
      !basePaths.some(basePath => isSameOrDescendantPath(node.path, basePath))
    ) {
      return;
    }
    if (hasLoadedDimensionalChild(node.path)) {
      pathsByKey.set(serializePath(node.path), node.path);
    }
  });

  return Array.from(pathsByKey.values());
};

export const buildLoadedBranchCoverageMarkers = ({
  axis,
  tree,
  basePaths,
  seedPaths,
  pivotProgram,
  visibleRowDepth,
  visibleColDepth,
  existingBatches = [],
}: LoadedBranchCoverageMarkerInput): PivotFactStoreBatch[] => {
  const coverage = buildFactCoverage({
    reason: 'expand',
    rowDimensions: pivotProgram.rowDimensions,
    columnDimensions: pivotProgram.columnDimensions,
    rowDepth: visibleRowDepth,
    columnDepth: visibleColDepth,
  });
  const existingKeys = new Set(
    existingBatches.map(batch =>
      buildPivotFactRequestKey({
        coverage: batch.coverage,
        scope: batch.scope,
      }),
    ),
  );

  return collectLoadedBranchPaths({
    axis,
    tree,
    basePaths,
    seedPaths,
  })
    .map(path => ({
      coverage,
      facts: [],
      scope: {
        kind: 'branch' as const,
        axis,
        path,
      },
    }))
    .filter(
      batch =>
        !existingKeys.has(
          buildPivotFactRequestKey({
            coverage: batch.coverage,
            scope: batch.scope,
          }),
        ),
    );
};

export const appendLoadedBranchCoverageMarkers = ({
  existingBatches,
  ...input
}: LoadedBranchCoverageMarkerInput): PivotFactStoreBatch[] => {
  const batches = existingBatches ?? [];
  const markers = buildLoadedBranchCoverageMarkers({
    ...input,
    existingBatches: batches,
  });
  return markers.length > 0 ? [...batches, ...markers] : batches;
};
