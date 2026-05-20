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
import { type PivotAxis, type PivotPath } from '../../types';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  encodeMetricKey,
  isMeasureLeafToken,
  isSubtotalToken,
} from '../core/tokens';
import { type PivotProgram, type PivotColumnRef } from './types';

export type PivotAxisProjection = {
  axis: PivotAxis;
  queryDimensions: PivotColumnRef[];
  filterDimensionPath: PivotPath;
  projectedDimensionPath: PivotPath;
  postValuesDimensionPath: PivotPath;
  skippedPreValuesDimensions: PivotColumnRef[];
  metricKeys: string[];
  measureLeafIds: string[];
  nextLevelKind?: 'dimension' | 'values';
  valuesLevelSeen: boolean;
};

export type ResolveAxisProjectionInput = {
  program: PivotProgram;
  axis: PivotAxis;
  path: PivotPath;
};

export type CollapsedValuesMetricProjection = {
  metricKey: string;
  metricToken: string;
  metricPath: PivotPath;
  sourceMetricPath: PivotPath;
  hasProjectedChildren: boolean;
};

export type ResolveCollapsedValuesProjectionInput = {
  program: PivotProgram;
  axis: PivotAxis;
  parentPath: PivotPath;
  sourceMetricPaths: PivotPath[];
};

export type AxisChildProjection = {
  rawValuesTokenIndex?: number;
  introducesValues: boolean;
};

export type ResolveAxisChildProjectionInput = {
  program: PivotProgram;
  axis: PivotAxis;
  parentPath: PivotPath;
  childPath: PivotPath;
};

const axisDimensionsFor = (program: PivotProgram, axis: PivotAxis) =>
  axis === 'row' ? program.rowDimensions : program.columnDimensions;

export const getAxisDimensionCount = (program: PivotProgram, axis: PivotAxis) =>
  axisDimensionsFor(program, axis).length;

export const getValuesLevelIndex = (program: PivotProgram, axis: PivotAxis) => {
  if (axis !== program.valueAxis || program.metricKeys.length === 0) {
    return undefined;
  }
  return Math.max(
    0,
    Math.min(program.metricInsertIndex, getAxisDimensionCount(program, axis)),
  );
};

export const isValuesFirstOnAxis = (program: PivotProgram, axis: PivotAxis) =>
  getValuesLevelIndex(program, axis) === 0;

export const isValuesAtAxisEnd = (program: PivotProgram, axis: PivotAxis) => {
  const valuesIndex = getValuesLevelIndex(program, axis);
  return (
    valuesIndex !== undefined &&
    valuesIndex === getAxisDimensionCount(program, axis)
  );
};

export const isCanonicalValuesPathToken = (
  value: unknown,
  program: PivotProgram,
) => {
  const metricKey = decodeMetricKey(value);
  return (
    (metricKey !== undefined && program.metricKeys.includes(metricKey)) ||
    isMeasureLeafToken(value)
  );
};

const collectPathMetricKeys = (
  path: PivotPath,
  metricKeys: Set<string>,
): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  path.forEach(value => {
    const metricKey = decodeMetricKey(value);
    if (!metricKey || !metricKeys.has(metricKey) || seen.has(metricKey)) {
      return;
    }
    seen.add(metricKey);
    result.push(metricKey);
  });
  return result;
};

const collectPathMeasureLeafIds = (path: PivotPath): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  path.forEach(value => {
    const leafId = decodeMeasureLeafId(value);
    if (!leafId || seen.has(leafId)) {
      return;
    }
    seen.add(leafId);
    result.push(leafId);
  });
  return result;
};

const collectSkippedPreValuesDimensions = (
  dimensions: PivotColumnRef[],
  startIndex: number,
  valuesLevelIndex: number,
): PivotColumnRef[] => dimensions.slice(startIndex, valuesLevelIndex);

const withoutSubtotalTokens = (path: PivotPath) =>
  path.filter(value => !isSubtotalToken(value));

const resolveProjectionQueryDimensions = ({
  program,
  axis,
  filterDimensionPath,
  projectedDimensionPath,
  postValuesDimensionPath,
  valuesLevelSeen,
}: {
  program: PivotProgram;
  axis: PivotAxis;
  filterDimensionPath: PivotPath;
  projectedDimensionPath: PivotPath;
  postValuesDimensionPath: PivotPath;
  valuesLevelSeen: boolean;
}): PivotColumnRef[] => {
  const dimensions = axisDimensionsFor(program, axis);
  if (!valuesLevelSeen) {
    return dimensions.slice(0, filterDimensionPath.length + 1);
  }
  const valuesLevelIndex = getValuesLevelIndex(program, axis);
  if (valuesLevelIndex === undefined) {
    return dimensions.slice(0, projectedDimensionPath.length + 1);
  }
  return [
    ...dimensions
      .slice(0, valuesLevelIndex)
      .slice(0, filterDimensionPath.length),
    ...dimensions
      .slice(valuesLevelIndex)
      .slice(0, postValuesDimensionPath.length + 1),
  ];
};

export const resolveAxisProjection = ({
  program,
  axis,
  path,
}: ResolveAxisProjectionInput): PivotAxisProjection => {
  const axisDimensions = axisDimensionsFor(program, axis);
  const valuesLevelIndex = getValuesLevelIndex(program, axis);
  const sourceLevelCount =
    axisDimensions.length + (valuesLevelIndex === undefined ? 0 : 1);
  const metricKeys = collectPathMetricKeys(path, new Set(program.metricKeys));
  const measureLeafIds = collectPathMeasureLeafIds(path);
  const filterDimensionPath: PivotPath = [];
  const projectedDimensionPath: PivotPath = [];
  const postValuesDimensionPath: PivotPath = [];
  const skippedPreValuesDimensions: PivotColumnRef[] = [];
  let valuesLevelSeen = false;
  let sourceIndex = 0;
  let pathIndex = 0;

  const buildProjection = (
    nextLevelKind?: PivotAxisProjection['nextLevelKind'],
  ): PivotAxisProjection => ({
    axis,
    queryDimensions: resolveProjectionQueryDimensions({
      program,
      axis,
      filterDimensionPath,
      projectedDimensionPath,
      postValuesDimensionPath,
      valuesLevelSeen,
    }),
    filterDimensionPath,
    projectedDimensionPath,
    postValuesDimensionPath,
    skippedPreValuesDimensions,
    metricKeys,
    measureLeafIds,
    nextLevelKind,
    valuesLevelSeen,
  });

  while (sourceIndex < sourceLevelCount) {
    const levelKind = sourceIndex === valuesLevelIndex ? 'values' : 'dimension';
    if (pathIndex >= path.length) {
      return buildProjection(levelKind);
    }

    const value = path[pathIndex];
    if (levelKind === 'dimension') {
      if (isCanonicalValuesPathToken(value, program)) {
        if (valuesLevelIndex !== undefined && valuesLevelIndex > sourceIndex) {
          skippedPreValuesDimensions.push(
            ...collectSkippedPreValuesDimensions(
              axisDimensions,
              sourceIndex,
              valuesLevelIndex,
            ),
          );
          sourceIndex = valuesLevelIndex;
          continue;
        }
        return buildProjection(levelKind);
      }
      projectedDimensionPath.push(value);
      if (valuesLevelSeen) {
        postValuesDimensionPath.push(value);
      } else {
        filterDimensionPath.push(value);
      }
      pathIndex += 1;
      sourceIndex += 1;
      continue;
    }

    let consumedValuesToken = false;
    while (
      pathIndex < path.length &&
      isCanonicalValuesPathToken(path[pathIndex], program)
    ) {
      consumedValuesToken = true;
      valuesLevelSeen = true;
      pathIndex += 1;
    }
    if (!consumedValuesToken) {
      return buildProjection(levelKind);
    }
    sourceIndex += 1;
  }

  return buildProjection();
};

export const canRequestAxisExpansion = ({
  program,
  axis,
  path,
}: ResolveAxisProjectionInput): boolean => {
  if (path.some(isSubtotalToken)) {
    return false;
  }
  const projection = resolveAxisProjection({ program, axis, path });
  return (
    projection.nextLevelKind === 'dimension' ||
    projection.skippedPreValuesDimensions.length > 0
  );
};

export const resolveAxisChildProjection = ({
  program,
  axis,
  parentPath,
  childPath,
}: ResolveAxisChildProjectionInput): AxisChildProjection => {
  const projectableParentPath = withoutSubtotalTokens(parentPath);
  const projectableChildPath = withoutSubtotalTokens(childPath);
  const parentProjection = resolveAxisProjection({
    program,
    axis,
    path: projectableParentPath,
  });
  const childProjection = resolveAxisProjection({
    program,
    axis,
    path: projectableChildPath,
  });
  const rawValuesTokenIndex = childPath.findIndex(value =>
    isCanonicalValuesPathToken(value, program),
  );
  const firstChildValue = projectableChildPath[projectableParentPath.length];
  return {
    rawValuesTokenIndex:
      rawValuesTokenIndex >= 0 ? rawValuesTokenIndex : undefined,
    introducesValues:
      !parentProjection.valuesLevelSeen &&
      childProjection.valuesLevelSeen &&
      isCanonicalValuesPathToken(firstChildValue, program),
  };
};

export const resolveCollapsedValuesProjection = ({
  program,
  axis,
  parentPath,
  sourceMetricPaths,
}: ResolveCollapsedValuesProjectionInput): CollapsedValuesMetricProjection[] => {
  const parentProjection = resolveAxisProjection({
    program,
    axis,
    path: parentPath,
  });
  if (parentProjection.valuesLevelSeen) {
    return [];
  }

  const metricKeySet = new Set(program.metricKeys);
  const seen = new Set<string>();
  const collapsedMetrics: CollapsedValuesMetricProjection[] = [];
  sourceMetricPaths.forEach(sourceMetricPath => {
    const metricKey = collectPathMetricKeys(sourceMetricPath, metricKeySet)[0];
    if (!metricKey || seen.has(metricKey)) {
      return;
    }
    seen.add(metricKey);
    const metricToken = encodeMetricKey(metricKey);
    const metricPath = [...parentPath, metricToken];
    const metricProjection = resolveAxisProjection({
      program,
      axis,
      path: metricPath,
    });
    if (!metricProjection.valuesLevelSeen) {
      return;
    }
    collapsedMetrics.push({
      metricKey,
      metricToken,
      metricPath,
      sourceMetricPath,
      hasProjectedChildren: metricProjection.nextLevelKind === 'dimension',
    });
  });
  return collapsedMetrics;
};
