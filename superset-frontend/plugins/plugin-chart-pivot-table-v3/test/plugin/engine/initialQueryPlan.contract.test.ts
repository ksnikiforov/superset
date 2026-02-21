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
import { buildInitialQuerySpecs } from '../../../src/pivot/query/specs';
import { buildFormData } from '../fixtures/pivotFormData';
import { serializePath } from '../../../src/utils';

describe('buildInitialQuerySpecs (contracts)', () => {
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

    const specs = buildInitialQuerySpecs(formData);
    const uniquePrefetch = new Map<string, unknown>();
    specs.forEach(spec => {
      if (spec.meta.kind === 'branch' && spec.meta.axis && spec.meta.path) {
        uniquePrefetch.set(
          `branch|${spec.meta.axis}|${serializePath(spec.meta.path)}`,
          { kind: 'branch', axis: spec.meta.axis, path: spec.meta.path },
        );
      }
      if (
        spec.meta.kind === 'batch' &&
        spec.meta.axis &&
        spec.meta.parentPath
      ) {
        uniquePrefetch.set(
          `batch|${spec.meta.axis}|${serializePath(spec.meta.parentPath)}`,
          {
            kind: 'batch',
            axis: spec.meta.axis,
            parentPath: spec.meta.parentPath,
            siblingValues: spec.meta.siblingValues ?? [],
          },
        );
      }
    });

    const targets = Array.from(uniquePrefetch.values());
    expect(targets).toEqual(
      expect.arrayContaining([
        { kind: 'branch', axis: 'row', path: ['A'] },
        {
          kind: 'batch',
          axis: 'col',
          parentPath: [],
          siblingValues: expect.arrayContaining(['X', 'Y']),
        },
      ]),
    );
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

    const specs = buildInitialQuerySpecs(formData);
    const branchPaths = new Set<string>();
    specs.forEach(spec => {
      if (spec.meta.kind === 'branch' && spec.meta.axis === 'row') {
        branchPaths.add(serializePath(spec.meta.path || []));
      }
    });

    expect(Array.from(branchPaths)).toEqual([serializePath(['A'])]);
  });
});
