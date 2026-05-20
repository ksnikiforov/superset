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
import { PATH_DIVIDER, serializePath } from '../../../src/pivot/core/path';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import { buildAxisExpansionCoverageTarget } from '../../../src/pivot/expansion/planner';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildExpansionQuerySpecs } from '../fixtures/querySpecs';

const branchQuerySpecs = ({
  formData,
  path,
}: {
  formData: ReturnType<typeof buildFormData>;
  path: unknown[];
}) => {
  const layout = buildLayoutContext(formData);
  const pathKey = serializePath(path);
  return buildExpansionQuerySpecs({
    formData,
    layout,
    targets: [
      buildAxisExpansionCoverageTarget({
        program: layout.pivotProgram,
        axis: 'row',
        pathKey,
        rowDepth: 0,
        columnDepth: 0,
      }),
    ],
  });
};

describe('query naming (contracts)', () => {
  it('derives expansion query identity from fact scope with divider values', () => {
    const dividerValue = `A${PATH_DIVIDER}B`;
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
    });
    const specs = branchQuerySpecs({ formData, path: [dividerValue] });

    expect(specs.some(spec => spec.queryName.includes('|scope:'))).toBe(true);
    expect(
      specs.every(
        spec =>
          spec.meta.factSelector.scope.kind === 'scopedFull' &&
          spec.meta.factSelector.scope.axis === 'row' &&
          spec.meta.factSelector.scope.ancestorPaths[0]?.[0] === dividerValue,
      ),
    ).toBe(true);
  });

  it('derives expansion query identity from fact scope with null values', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
    });
    const specs = branchQuerySpecs({ formData, path: [null] });

    expect(
      specs.every(
        spec =>
          spec.meta.factSelector.scope.kind === 'scopedFull' &&
          spec.meta.factSelector.scope.ancestorPaths[0]?.[0] === null,
      ),
    ).toBe(true);
  });

  it('derives expansion query identity from fact scope with undefined values', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
    });
    const specs = branchQuerySpecs({ formData, path: [undefined] });

    expect(
      specs.every(
        spec =>
          spec.meta.factSelector.scope.kind === 'scopedFull' &&
          spec.meta.factSelector.scope.ancestorPaths[0]?.[0] === undefined,
      ),
    ).toBe(true);
  });
});
