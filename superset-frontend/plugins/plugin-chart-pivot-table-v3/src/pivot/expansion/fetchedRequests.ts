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

export type FetchedFactCoverageState = {
  depthByAxis: Record<PivotAxis, Map<string, number>>;
};

export type FetchedFactRequestProjection = {
  axis: PivotAxis;
  pathKey: string;
  requiredOppositeDepth: number;
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
