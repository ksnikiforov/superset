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
  MAX_BATCH_SIBLINGS,
} from '../../../src/pivot/expansion/fetchExecution';
import { type FetchTarget } from '../../../src/pivot/expansion/planner';
import { parsePath, serializePath } from '../../../src/pivot/core/path';
import { type PivotPathValue } from '../../../src/types';

const makeTarget = (
  path: PivotPathValue[],
  signature = 'sig',
): FetchTarget & { batchSignature: string } => ({
  axis: 'row',
  pathKey: serializePath(path),
  batchSignature: signature,
});

describe('fetchPlanOptimizer', () => {
  it('groups compatible sibling targets into a batch', () => {
    const targets = [makeTarget(['US', 'CA']), makeTarget(['US', 'NY'])];
    const plan = optimizeExpansionFetchPlan({ targets });

    expect(plan.batches).toHaveLength(1);
    expect(plan.singles).toHaveLength(0);
    expect(plan.batches[0].siblingValues).toEqual(['CA', 'NY']);
  });

  it('does not mix null and non-null siblings', () => {
    const targets = [
      makeTarget(['US', null]),
      makeTarget(['US', 'CA']),
      makeTarget(['US', 'NY']),
    ];
    const plan = optimizeExpansionFetchPlan({ targets });

    const siblings = plan.batches.flatMap(batch => batch.siblingValues);
    expect(siblings).toContain('CA');
    expect(siblings).toContain('NY');
    expect(siblings).not.toContain(null);
    const nullSingles = plan.singles.filter(
      target => parsePath(target.pathKey).slice(-1)[0] === null,
    );
    expect(nullSingles).toHaveLength(1);
  });

  it('enforces max batch size', () => {
    const targets = Array.from({ length: MAX_BATCH_SIBLINGS + 1 }, (_, idx) =>
      makeTarget(['US', `S${idx}`]),
    );
    const plan = optimizeExpansionFetchPlan({ targets });

    const batchSizes = plan.batches.map(batch => batch.targets.length);
    const hasMaxBatch = batchSizes.includes(MAX_BATCH_SIBLINGS);
    expect(hasMaxBatch).toBe(true);
    expect(
      batchSizes.reduce((sum, size) => sum + size, 0) + plan.singles.length,
    ).toBe(MAX_BATCH_SIBLINGS + 1);
  });

  it('separates incompatible signatures', () => {
    const targets = [
      makeTarget(['US', 'CA'], 'sig-1'),
      makeTarget(['US', 'NY'], 'sig-2'),
    ];
    const plan = optimizeExpansionFetchPlan({ targets });

    expect(plan.batches).toHaveLength(0);
    expect(plan.singles).toHaveLength(2);
  });
});
