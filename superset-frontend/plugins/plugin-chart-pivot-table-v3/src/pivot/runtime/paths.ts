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
import type { PivotAxis, PivotPath } from '../../types';
import { decodeMetricKey, isMeasureLeafToken } from '../core/tokens';
import type { PivotAxisLevel, PivotProgram } from './types';

export type AxisPathInput = {
  program: PivotProgram;
  axis: PivotAxis;
  path: PivotPath;
};

export type AxisPathProjection = {
  dimensionPath: PivotPath;
  nextLevel?: PivotAxisLevel;
};

const axisProgramFor = (program: PivotProgram, axis: PivotAxis) =>
  axis === 'row' ? program.rows : program.columns;

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

export const projectAxisPath = ({
  program,
  axis,
  path,
}: AxisPathInput): AxisPathProjection => {
  const dimensionPath: PivotPath = [];
  let pathIndex = 0;

  for (const level of axisProgramFor(program, axis)) {
    if (pathIndex >= path.length) {
      return { dimensionPath, nextLevel: level };
    }
    const value = path[pathIndex];
    if (level.kind === 'dimension') {
      if (isCanonicalValuesPathToken(value, program)) {
        return { dimensionPath, nextLevel: level };
      }
      dimensionPath.push(value);
      pathIndex += 1;
      continue;
    }

    let consumedValuesToken = false;
    while (
      pathIndex < path.length &&
      isCanonicalValuesPathToken(path[pathIndex], program)
    ) {
      consumedValuesToken = true;
      pathIndex += 1;
    }
    if (!consumedValuesToken) {
      return { dimensionPath, nextLevel: level };
    }
  }
  return { dimensionPath };
};

export const projectAxisPathToDimensions = (input: AxisPathInput): PivotPath =>
  projectAxisPath(input).dimensionPath;

export const getNextAxisLevelForPath = (
  input: AxisPathInput,
): PivotAxisLevel | undefined => projectAxisPath(input).nextLevel;
