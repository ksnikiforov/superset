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
import { type PivotAxis } from '../../types';
import { serializePath } from '../core/path';
import {
  type PivotFactSelector,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { rootKey } from '../viewModel';

export type FetchedFactRequestProjection = {
  axis: PivotAxis;
  pathKey: string;
  requiredOppositeDepth: number;
};

export type FetchedFactCoverageLookup = {
  getFetchedDepth: (
    projection: FetchedFactRequestProjection,
  ) => number | undefined;
};

export const projectFactRequestToFetchedCoverage = ({
  coverage,
  scope,
}: PivotFactSelector): FetchedFactRequestProjection[] => {
  switch (scope.kind) {
    case 'bootstrap':
    case 'root': {
      const projections: FetchedFactRequestProjection[] = [];
      if (coverage.rowDepth > 0) {
        projections.push({
          axis: 'row',
          pathKey: rootKey,
          requiredOppositeDepth: coverage.columnDepth,
        });
      }
      if (coverage.columnDepth > 0) {
        projections.push({
          axis: 'col',
          pathKey: rootKey,
          requiredOppositeDepth: coverage.rowDepth,
        });
      }
      return projections;
    }
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

export const createFetchedFactCoverageLookup = ({
  factBatches,
  getCoverageKey,
}: {
  factBatches: PivotFactStoreBatch[];
  getCoverageKey: (axis: PivotAxis, pathKey: string) => string;
}): FetchedFactCoverageLookup => {
  const depthByAxis: Record<PivotAxis, Map<string, number>> = {
    row: new Map<string, number>(),
    col: new Map<string, number>(),
  };
  factBatches.forEach(batch => {
    projectFactRequestToFetchedCoverage({
      coverage: batch.coverage,
      scope: batch.scope,
      valueKeys: batch.valueKeys,
    }).forEach(({ axis, pathKey, requiredOppositeDepth }) => {
      const coverageKey = getCoverageKey(axis, pathKey);
      const existingDepth = depthByAxis[axis].get(coverageKey);
      depthByAxis[axis].set(
        coverageKey,
        existingDepth === undefined
          ? requiredOppositeDepth
          : Math.max(existingDepth, requiredOppositeDepth),
      );
    });
  });
  return {
    getFetchedDepth: ({ axis, pathKey }) =>
      depthByAxis[axis].get(getCoverageKey(axis, pathKey)),
  };
};
