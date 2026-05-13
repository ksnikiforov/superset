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

import { type PivotAxis, type PivotTreeNode } from '../../../src/types';
import {
  createFetchedFactCoverageState,
  getFetchedAxisDepthMap,
  pruneFetchedCoverageForCollapsedNode,
  seedFetchedCoverageFromLoadedMetricNodes,
} from '../../../src/pivot/expansion/fetchedRequests';
import { rootKey } from '../../../src/pivot/viewModel';
import {
  encodeMetricKey,
  isMetricToken,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../../src/utils';

const makeNode = ({
  axis,
  path,
  hasChildren = true,
}: {
  axis: PivotAxis;
  path: PivotTreeNode['path'];
  hasChildren?: boolean;
}): PivotTreeNode => ({
  axis,
  key: path.length === 0 ? rootKey : serializePath(path),
  path,
  label: path.length === 0 ? 'Total' : String(path[path.length - 1]),
  formattedLabel: path.length === 0 ? 'Total' : String(path[path.length - 1]),
  level: path.length,
  hasChildren,
});

describe('pivot/expansion/fetchedRequests', () => {
  it('prunes collapsed fetched coverage through the coverage helper', () => {
    const aKey = serializePath(['A']);
    const abKey = serializePath(['A', 'B']);
    const cKey = serializePath(['C']);
    const fetchedCoverage = createFetchedFactCoverageState({
      row: new Map([
        [aKey, 1],
        [abKey, 2],
        [cKey, 1],
      ]),
    });

    pruneFetchedCoverageForCollapsedNode({
      fetchedCoverage,
      axis: 'row',
      parentPath: ['A'],
      parentKey: aKey,
      nodes: {
        [rootKey]: makeNode({ axis: 'row', path: [] }),
        [aKey]: makeNode({ axis: 'row', path: ['A'] }),
        [abKey]: makeNode({ axis: 'row', path: ['A', 'B'] }),
        [cKey]: makeNode({ axis: 'row', path: ['C'] }),
      },
    });

    expect(Array.from(getFetchedAxisDepthMap(fetchedCoverage, 'row'))).toEqual([
      [cKey, 1],
    ]);
  });

  it('seeds fetched coverage for loaded terminal metric nodes', () => {
    const metricPath = ['A', encodeMetricKey('sales')];
    const fetchedCoverage = createFetchedFactCoverageState();

    seedFetchedCoverageFromLoadedMetricNodes({
      fetchedCoverage,
      getCoverageKey: (_axis, pathKey) => pathKey,
      tree: {
        rows: {
          [serializePath(metricPath)]: makeNode({
            axis: 'row',
            path: metricPath,
            hasChildren: false,
          }),
        },
        cols: {},
        cells: {},
      },
      visibleRowDepth: 2,
      visibleColDepth: 1,
      isMetricTokenValue: isMetricToken,
    });

    expect(Array.from(getFetchedAxisDepthMap(fetchedCoverage, 'row'))).toEqual([
      [serializePath(metricPath), 1],
    ]);
  });

  it('seeds fetched coverage for loaded metric subtotal nodes', () => {
    const metricSubtotalPath = ['A', SUBTOTAL_TOKEN, encodeMetricKey('sales')];
    const fetchedCoverage = createFetchedFactCoverageState();

    seedFetchedCoverageFromLoadedMetricNodes({
      fetchedCoverage,
      getCoverageKey: (_axis, pathKey) => pathKey,
      tree: {
        rows: {
          [serializePath(metricSubtotalPath)]: makeNode({
            axis: 'row',
            path: metricSubtotalPath,
            hasChildren: true,
          }),
        },
        cols: {},
        cells: {},
      },
      visibleRowDepth: 3,
      visibleColDepth: 2,
      isMetricTokenValue: isMetricToken,
    });

    expect(Array.from(getFetchedAxisDepthMap(fetchedCoverage, 'row'))).toEqual([
      [serializePath(metricSubtotalPath), 2],
    ]);
  });

  it('does not seed fetched coverage for expandable non-subtotal metric nodes', () => {
    const metricPath = ['A', encodeMetricKey('sales')];
    const fetchedCoverage = createFetchedFactCoverageState();

    seedFetchedCoverageFromLoadedMetricNodes({
      fetchedCoverage,
      getCoverageKey: (_axis, pathKey) => pathKey,
      tree: {
        rows: {
          [serializePath(metricPath)]: makeNode({
            axis: 'row',
            path: metricPath,
            hasChildren: true,
          }),
        },
        cols: {},
        cells: {},
      },
      visibleRowDepth: 3,
      visibleColDepth: 2,
      isMetricTokenValue: isMetricToken,
    });

    expect(Array.from(getFetchedAxisDepthMap(fetchedCoverage, 'row'))).toEqual(
      [],
    );
  });
});
