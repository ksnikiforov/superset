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
  optimizeExpansionFetchPlan,
  MAX_EXPANSION_BATCH_SIBLINGS,
} from '../../../src/pivot/query/specs';
import { type ExpansionCoverageTarget } from '../../../src/pivot/expansion/planner';
import {
  buildExpansionHydrationLoadingKeys,
  resolveExpansionHydrationLoadingKeys,
} from '../../../src/pivot/expansion/hydrationExecutor';
import { parsePath, serializePath } from '../../../src/pivot/core/path';
import { encodeMetricKey } from '../../../src/pivot/core/tokens';
import { type PivotPathValue } from '../../../src/types';

const makeTarget = (path: PivotPathValue[]): ExpansionCoverageTarget => ({
  axis: 'row',
  pathKey: serializePath(path),
  need: {
    rowDepth: path.length,
    columnDepth: 0,
    rowDimensions: [],
    columnDimensions: [],
    valueKeys: [],
    rowScope: { kind: 'paths', paths: [path] },
    columnScope: { kind: 'root' },
  },
});

const batchSiblingValues = (
  batch: ReturnType<typeof optimizeExpansionFetchPlan>[number],
) => batch.map(target => parsePath(target.pathKey).slice(-1)[0]);

const multiTargetGroups = (
  groups: ReturnType<typeof optimizeExpansionFetchPlan>,
) => groups.filter(group => group.length > 1);

const singleTargetGroups = (
  groups: ReturnType<typeof optimizeExpansionFetchPlan>,
) => groups.filter(group => group.length === 1);

describe('fetchPlanOptimizer', () => {
  test('groups compatible sibling targets into a batch', () => {
    const targets = [makeTarget(['US', 'CA']), makeTarget(['US', 'NY'])];
    const plan = optimizeExpansionFetchPlan({ targets });

    expect(plan).toHaveLength(1);
    expect(batchSiblingValues(plan[0])).toEqual(['CA', 'NY']);
  });

  test('does not mix null and non-null siblings', () => {
    const targets = [
      makeTarget(['US', null]),
      makeTarget(['US', 'CA']),
      makeTarget(['US', 'NY']),
    ];
    const plan = optimizeExpansionFetchPlan({ targets });

    const siblings = multiTargetGroups(plan).flatMap(batchSiblingValues);
    expect(siblings).toContain('CA');
    expect(siblings).toContain('NY');
    expect(siblings).not.toContain(null);
    const nullSingles = singleTargetGroups(plan).filter(
      ([target]) => parsePath(target.pathKey).slice(-1)[0] === null,
    );
    expect(nullSingles).toHaveLength(1);
  });

  test('groups by query scope path rather than rendered metric path', () => {
    const caTarget = makeTarget(['US', 'CA']);
    const nyTarget = makeTarget(['US', 'NY']);
    const plan = optimizeExpansionFetchPlan({
      targets: [
        {
          ...caTarget,
          pathKey: serializePath([encodeMetricKey('sales'), 'US', 'CA']),
        },
        {
          ...nyTarget,
          pathKey: serializePath([encodeMetricKey('sales'), 'US', 'NY']),
        },
      ],
    });

    expect(plan).toHaveLength(1);
    expect(batchSiblingValues(plan[0])).toEqual(['CA', 'NY']);
  });

  test('enforces max batch size', () => {
    const targets = Array.from(
      { length: MAX_EXPANSION_BATCH_SIBLINGS + 1 },
      (_, idx) => makeTarget(['US', `S${idx}`]),
    );
    const plan = optimizeExpansionFetchPlan({ targets });

    const batchSizes = plan.map(batch => batch.length);
    const hasMaxBatch = batchSizes.includes(MAX_EXPANSION_BATCH_SIBLINGS);
    expect(hasMaxBatch).toBe(true);
    expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(
      MAX_EXPANSION_BATCH_SIBLINGS + 1,
    );
  });

  test('separates incompatible coverage depths', () => {
    const nyTarget = makeTarget(['US', 'NY']);
    const targets = [
      makeTarget(['US', 'CA']),
      {
        ...nyTarget,
        need: {
          ...nyTarget.need,
          columnDepth: 1,
        },
      },
    ];
    const plan = optimizeExpansionFetchPlan({ targets });

    expect(multiTargetGroups(plan)).toHaveLength(0);
    expect(singleTargetGroups(plan)).toHaveLength(2);
  });

  test('separates sibling targets with different value keys', () => {
    const caTarget = makeTarget(['US', 'CA']);
    const nyTarget = makeTarget(['US', 'NY']);
    const plan = optimizeExpansionFetchPlan({
      targets: [
        {
          ...caTarget,
          need: {
            ...caTarget.need,
            valueKeys: ['sales'],
          },
        },
        {
          ...nyTarget,
          need: {
            ...nyTarget.need,
            valueKeys: ['profit'],
          },
        },
      ],
    });

    expect(multiTargetGroups(plan)).toHaveLength(0);
    expect(singleTargetGroups(plan)).toHaveLength(2);
  });

  test('derives loading keys from coverage targets', () => {
    expect(
      buildExpansionHydrationLoadingKeys([makeTarget(['US', 'CA'])]),
    ).toEqual(new Set([serializePath(['US', 'CA'])]));

    expect(
      buildExpansionHydrationLoadingKeys([
        {
          ...makeTarget([]),
          need: {
            ...makeTarget([]).need,
            rowScope: {
              kind: 'paths',
              paths: [['US'], ['FR']],
            },
            columnScope: {
              kind: 'paths',
              paths: [['Q1']],
            },
          },
        },
      ]),
    ).toEqual(
      new Set([
        serializePath(['US']),
        serializePath(['FR']),
        serializePath(['Q1']),
      ]),
    );
  });

  test('uses visible loading keys when provided', () => {
    const clickedKey = serializePath(['US']);

    expect(
      resolveExpansionHydrationLoadingKeys({
        targets: [makeTarget(['US', 'CA']), makeTarget(['US', 'NY'])],
        visibleLoadingKeys: new Set([clickedKey]),
      }),
    ).toEqual(new Set([clickedKey]));
  });
});
