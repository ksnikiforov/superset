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
import { buildInitialQueryPlan } from '../../../src/pivot/engine/initialQueryPlan';
import { buildFormData } from '../fixtures/pivotFormData';

describe('buildInitialQueryPlan (contracts)', () => {
  it('emits branch targets in deterministic order and drops collapsed/duplicate paths', () => {
    const formData = buildFormData({
      groupbyRows: ['r1'],
      groupbyColumns: ['c1'],
      metrics: ['m1'],
      expandRowsLevel: 1,
      pivotExpansionState: {
        rowKeys: ['r1'],
        colKeys: ['c1'],
        rows: [['B'], ['A'], ['A']],
        cols: [['Y'], ['X']],
        collapsedRows: [['B']],
        collapsedCols: [],
      },
    });

    const plan = buildInitialQueryPlan(formData);
    const branchTargets = plan.targets.filter(t => t.kind === 'branch');

    expect(branchTargets.map(t => ({ axis: t.axis, path: t.path }))).toEqual([
      { axis: 'row', path: ['A'] },
      { axis: 'col', path: ['X'] },
      { axis: 'col', path: ['Y'] },
    ]);
  });

  it('prunes persisted expansions beyond the stable prefix', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
      pivotExpansionState: {
        rowKeys: ['r1', 'old_r2'],
        colKeys: [],
        rows: [['A'], ['A', 'B']],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
    });

    const plan = buildInitialQueryPlan(formData);
    const branchTargets = plan.targets.filter(t => t.kind === 'branch');

    expect(branchTargets.map(t => ({ axis: t.axis, path: t.path }))).toEqual([
      { axis: 'row', path: ['A'] },
    ]);
  });
});
