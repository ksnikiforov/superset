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
import { buildExpansionQuerySpecs } from '../../../src/pivot/query/specs';
import { buildAxisExpansionCoverageTarget } from '../../../src/pivot/expansion/planner';
import { buildFormData } from '../fixtures/pivotFormData';

const branchQueryNames = ({
  formData,
  path,
}: {
  formData: ReturnType<typeof buildFormData>;
  path: unknown[];
}) => {
  const layout = buildLayoutContext(formData);
  return buildExpansionQuerySpecs({
    kind: 'branch',
    formData,
    layout,
    axis: 'row',
    path,
    coverageTarget: buildAxisExpansionCoverageTarget({
      program: layout.pivotProgram,
      axis: 'row',
      pathKey: serializePath(path),
      rowDepth: 0,
      columnDepth: 0,
    }),
  }).map(spec => spec.queryName);
};

describe('query naming (contracts)', () => {
  it('uses serializePath() for branch suffixes, including divider values', () => {
    const dividerValue = `A${PATH_DIVIDER}B`;
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
    });
    const names = branchQueryNames({ formData, path: [dividerValue] });

    expect(
      names.some(name =>
        name.includes(`|branch:row:${serializePath([dividerValue])}`),
      ),
    ).toBe(true);
  });

  it('uses serializePath() for branch suffixes, including null values', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
    });
    const names = branchQueryNames({ formData, path: [null] });

    expect(
      names.some(name => name.includes(`|branch:row:${serializePath([null])}`)),
    ).toBe(true);
  });

  it('uses serializePath() for branch suffixes, including undefined values', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
    });
    const names = branchQueryNames({ formData, path: [undefined] });

    expect(
      names.some(name =>
        name.includes(`|branch:row:${serializePath([undefined])}`),
      ),
    ).toBe(true);
  });
});
