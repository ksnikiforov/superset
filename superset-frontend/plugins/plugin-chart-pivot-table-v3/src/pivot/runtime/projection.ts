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
  isSubtotalToken,
} from '../core/tokens';
import { isCanonicalValuesPathToken } from './paths';
import {
  type PivotAxisLevel,
  type PivotAxisProgram,
  type PivotProgram,
} from './types';

export type PivotDimensionAxisLevel = Extract<
  PivotAxisLevel,
  { kind: 'dimension' }
>;

export type PivotAxisProjection = {
  axis: PivotAxis;
  sourceLevels: PivotAxisProgram;
  filterDimensionPath: PivotPath;
  projectedDimensionPath: PivotPath;
  postValuesDimensionPath: PivotPath;
  skippedPreValuesLevels: PivotDimensionAxisLevel[];
  metricKeys: string[];
  measureLeafIds: string[];
  nextLevel?: PivotAxisLevel;
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
  parentProjection: PivotAxisProjection;
  childProjection: PivotAxisProjection;
  valuesTokenIndex?: number;
  rawValuesTokenIndex?: number;
  introducesValues: boolean;
  addsProjectedDimension: boolean;
};

export type ResolveAxisChildProjectionInput = {
  program: PivotProgram;
  axis: PivotAxis;
  parentPath: PivotPath;
  childPath: PivotPath;
};

const axisProgramFor = (program: PivotProgram, axis: PivotAxis) =>
  axis === 'row' ? program.rows : program.columns;

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

const findValuesLevelIndex = (levels: PivotAxisProgram) =>
  levels.findIndex(level => level.kind === 'values');

const collectSkippedPreValuesLevels = (
  levels: PivotAxisProgram,
  startIndex: number,
  valuesLevelIndex: number,
): PivotDimensionAxisLevel[] =>
  levels
    .slice(startIndex, valuesLevelIndex)
    .filter(
      (level): level is PivotDimensionAxisLevel => level.kind === 'dimension',
    );

const withoutSubtotalTokens = (path: PivotPath) =>
  path.filter(value => !isSubtotalToken(value));

export const resolveAxisProjection = ({
  program,
  axis,
  path,
}: ResolveAxisProjectionInput): PivotAxisProjection => {
  const sourceLevels = axisProgramFor(program, axis);
  const valuesLevelIndex = findValuesLevelIndex(sourceLevels);
  const metricKeys = collectPathMetricKeys(path, new Set(program.metricKeys));
  const measureLeafIds = collectPathMeasureLeafIds(path);
  const filterDimensionPath: PivotPath = [];
  const projectedDimensionPath: PivotPath = [];
  const postValuesDimensionPath: PivotPath = [];
  const skippedPreValuesLevels: PivotDimensionAxisLevel[] = [];
  let valuesLevelSeen = false;
  let sourceIndex = 0;
  let pathIndex = 0;

  while (sourceIndex < sourceLevels.length) {
    const level = sourceLevels[sourceIndex];
    if (pathIndex >= path.length) {
      return {
        axis,
        sourceLevels,
        filterDimensionPath,
        projectedDimensionPath,
        postValuesDimensionPath,
        skippedPreValuesLevels,
        metricKeys,
        measureLeafIds,
        nextLevel: level,
        valuesLevelSeen,
      };
    }

    const value = path[pathIndex];
    if (level.kind === 'dimension') {
      if (isCanonicalValuesPathToken(value, program)) {
        if (valuesLevelIndex > sourceIndex) {
          skippedPreValuesLevels.push(
            ...collectSkippedPreValuesLevels(
              sourceLevels,
              sourceIndex,
              valuesLevelIndex,
            ),
          );
          sourceIndex = valuesLevelIndex;
          continue;
        }
        return {
          axis,
          sourceLevels,
          filterDimensionPath,
          projectedDimensionPath,
          postValuesDimensionPath,
          skippedPreValuesLevels,
          metricKeys,
          measureLeafIds,
          nextLevel: level,
          valuesLevelSeen,
        };
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
      return {
        axis,
        sourceLevels,
        filterDimensionPath,
        projectedDimensionPath,
        postValuesDimensionPath,
        skippedPreValuesLevels,
        metricKeys,
        measureLeafIds,
        nextLevel: level,
        valuesLevelSeen,
      };
    }
    sourceIndex += 1;
  }

  return {
    axis,
    sourceLevels,
    filterDimensionPath,
    projectedDimensionPath,
    postValuesDimensionPath,
    skippedPreValuesLevels,
    metricKeys,
    measureLeafIds,
    valuesLevelSeen,
  };
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
  const valuesTokenIndex = projectableChildPath.findIndex(value =>
    isCanonicalValuesPathToken(value, program),
  );
  const rawValuesTokenIndex = childPath.findIndex(value =>
    isCanonicalValuesPathToken(value, program),
  );
  const firstChildValue = projectableChildPath[projectableParentPath.length];
  return {
    parentProjection,
    childProjection,
    valuesTokenIndex: valuesTokenIndex >= 0 ? valuesTokenIndex : undefined,
    rawValuesTokenIndex:
      rawValuesTokenIndex >= 0 ? rawValuesTokenIndex : undefined,
    introducesValues:
      !parentProjection.valuesLevelSeen &&
      childProjection.valuesLevelSeen &&
      isCanonicalValuesPathToken(firstChildValue, program),
    addsProjectedDimension:
      childProjection.projectedDimensionPath.length >
      parentProjection.projectedDimensionPath.length,
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
      hasProjectedChildren: metricProjection.nextLevel?.kind === 'dimension',
    });
  });
  return collapsedMetrics;
};
