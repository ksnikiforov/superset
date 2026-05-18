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

describe('buildInitialQuerySpecs (contracts)', () => {
  it('does not replay persisted expansion branches in the initial query plan', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: ['c1'],
      metrics: ['m1'],
      expandRowsLevel: 1,
      pivotExpansionState: {
        rowKeys: ['r1', 'r2'],
        colKeys: ['c1'],
        rows: [['B'], ['A'], ['A']],
        cols: [['Y'], ['X']],
        collapsedRows: [['B']],
        collapsedCols: [],
      },
    });

    const specs = buildInitialQuerySpecs(formData);

    expect(
      specs.some(
        spec =>
          spec.meta.kind === 'branch' ||
          spec.meta.kind === 'batch' ||
          spec.meta.kind === 'intersection',
      ),
    ).toBe(false);
  });

  it('keeps auto-expand root prefetch separate from persisted expansion replay', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: ['c1'],
      metrics: ['m1'],
      expandRowsLevel: 2,
      pivotExpansionState: {
        rowKeys: ['r1', 'old_r2'],
        colKeys: ['c1'],
        rows: [['A'], ['A', 'B']],
        cols: [['X']],
        collapsedRows: [],
        collapsedCols: [],
      },
    });

    const specs = buildInitialQuerySpecs(formData);

    expect(specs.some(spec => spec.meta.kind === 'root')).toBe(true);
    expect(
      specs.some(
        spec =>
          spec.meta.kind === 'branch' ||
          spec.meta.kind === 'batch' ||
          spec.meta.kind === 'intersection',
      ),
    ).toBe(false);
    expect(
      specs
        .filter(spec => spec.meta.kind === 'root')
        .map(spec => [
          spec.meta.coverage.rowDepth,
          spec.meta.coverage.columnDepth,
        ]),
    ).toContainEqual([2, 1]);
  });

  it('does not let persisted deep expansions increase initial visible depth', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: ['c1', 'c2'],
      metrics: ['m1'],
      expandRowsLevel: 0,
      expandColumnsLevel: 0,
      pivotExpansionState: {
        rowKeys: ['r1', 'r2'],
        colKeys: ['c1', 'c2'],
        rows: [['A', 'B']],
        cols: [['X', 'Y']],
        collapsedRows: [],
        collapsedCols: [],
      },
    });

    const specs = buildInitialQuerySpecs(formData);

    expect(specs.some(spec => spec.queryName.includes('|root'))).toBe(false);
    expect(
      specs.some(
        spec =>
          spec.meta.kind === 'branch' ||
          spec.meta.kind === 'batch' ||
          spec.meta.kind === 'intersection',
      ),
    ).toBe(false);
    expect(
      specs.every(
        spec =>
          spec.meta.coverage.rowDepth <= 1 &&
          spec.meta.coverage.columnDepth <= 1,
      ),
    ).toBe(true);
  });

  it('records bootstrap coverage for visible layers only', () => {
    const formData = buildFormData({
      groupbyRows: ['country', 'state'],
      groupbyColumns: ['category', 'subcategory'],
      metrics: ['sales'],
      startCollapsed: true,
      initialDepth: 1,
    });

    const specs = buildInitialQuerySpecs(formData);
    const gridSpec = specs.find(
      spec =>
        spec.meta.kind === 'root' &&
        spec.meta.coverage.rowDepth === 1 &&
        spec.meta.coverage.columnDepth === 1,
    );

    expect(gridSpec?.columns).toEqual(['country', 'category']);
    expect(gridSpec?.meta.coverage).toMatchObject({
      reason: 'initial',
      rowDepth: 1,
      columnDepth: 1,
      rowDimensions: ['country'],
      columnDimensions: ['category'],
    });
  });
});
