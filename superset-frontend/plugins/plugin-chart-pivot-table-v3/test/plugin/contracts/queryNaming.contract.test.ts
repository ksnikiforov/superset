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
import buildQuery from '../../../src/buildQuery';
import { PATH_DIVIDER, serializePath } from '../../../src/utils';
import { buildFormData } from '../fixtures/pivotFormData';

describe('query naming (contracts)', () => {
  it('uses serializePath() for branch suffixes, including divider values', () => {
    const dividerValue = `A${PATH_DIVIDER}B`;
    const queryContext = buildQuery(
      buildFormData({
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: [],
        metrics: ['m1'],
        pivotExpansionState: {
          rowKeys: ['r1', 'r2'],
          colKeys: [],
          rows: [[dividerValue]],
          cols: [],
          collapsedRows: [],
          collapsedCols: [],
        },
      }),
    );
    const names = queryContext.queries.map(query =>
      typeof query.query_name === 'string' ? query.query_name : '',
    );

    expect(
      names.some(name =>
        name.includes(`|branch:row:${serializePath([dividerValue])}`),
      ),
    ).toBe(true);
  });

  it('uses serializePath() for branch suffixes, including null values', () => {
    const queryContext = buildQuery(
      buildFormData({
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: [],
        metrics: ['m1'],
        pivotExpansionState: {
          rowKeys: ['r1', 'r2'],
          colKeys: [],
          rows: [[null]],
          cols: [],
          collapsedRows: [],
          collapsedCols: [],
        },
      }),
    );
    const names = queryContext.queries.map(query =>
      typeof query.query_name === 'string' ? query.query_name : '',
    );

    expect(
      names.some(name => name.includes(`|branch:row:${serializePath([null])}`)),
    ).toBe(true);
  });

  it('uses serializePath() for branch suffixes, including undefined values', () => {
    const queryContext = buildQuery(
      buildFormData({
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: [],
        metrics: ['m1'],
        pivotExpansionState: {
          rowKeys: ['r1', 'r2'],
          colKeys: [],
          rows: [[undefined]],
          cols: [],
          collapsedRows: [],
          collapsedCols: [],
        },
      }),
    );
    const names = queryContext.queries.map(query =>
      typeof query.query_name === 'string' ? query.query_name : '',
    );
    expect(
      names.some(name =>
        name.includes(`|branch:row:${serializePath([undefined])}`),
      ),
    ).toBe(true);
  });
});
