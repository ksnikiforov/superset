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

import { createFetchedFactCoverageLookup } from '../../../src/pivot/expansion/fetchedRequests';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import { serializePath } from '../../../src/pivot/core/path';

describe('pivot/expansion/fetchedRequests', () => {
  it('derives fetched depth from loaded fact batches', () => {
    const factBatches: PivotFactStoreBatch[] = [
      {
        coverage: {
          reason: 'expand',
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['country', 'city'],
          columnDimensions: ['month'],
        },
        scope: {
          kind: 'branch',
          axis: 'row',
          path: ['France'],
        },
        valueKeys: ['sales'],
        facts: [],
      },
      {
        coverage: {
          reason: 'expand',
          rowDepth: 2,
          columnDepth: 3,
          rowDimensions: ['country', 'city'],
          columnDimensions: ['year', 'quarter', 'month'],
        },
        scope: {
          kind: 'branch',
          axis: 'row',
          path: ['France'],
        },
        valueKeys: ['sales'],
        facts: [],
      },
    ];

    const lookup = createFetchedFactCoverageLookup({
      factBatches,
      getCoverageKey: (_axis, key) => key,
    });

    expect(
      lookup.getFetchedDepth({
        axis: 'row',
        pathKey: serializePath(['France']),
        requiredOppositeDepth: 1,
      }),
    ).toBe(3);
    expect(
      lookup.getFetchedDepth({
        axis: 'col',
        pathKey: serializePath(['France']),
        requiredOppositeDepth: 1,
      }),
    ).toBeUndefined();
  });
});
