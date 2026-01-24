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
import { SupersetClient } from '@superset-ui/core';
import { fetchPivotBranchesBatch } from '../../../src/pivot/query/fetchPivotBranchesBatch';
import { type BatchGroup } from '../../../src/pivot/query/fetchPlanOptimizer';
import { buildFormData } from '../fixtures/pivotFormData';
import { serializePath } from '../../../src/utils';
import { type PivotTreeData, type PivotTreeNode } from '../../../src/types';

jest.mock('@superset-ui/core', () => {
  const actual = jest.requireActual('@superset-ui/core');
  return {
    ...actual,
    SupersetClient: {
      post: jest.fn(),
    },
  };
});

const makeNode = (node: Partial<PivotTreeNode>): PivotTreeNode => ({
  axis: 'row',
  key: serializePath(node.path || []),
  path: [],
  label: 'Total',
  formattedLabel: 'Total',
  level: 0,
  hasChildren: false,
  ...node,
});

const makeTree = (): PivotTreeData => ({
  rows: {
    '': makeNode({ axis: 'row', path: [], hasChildren: true }),
    [serializePath(['US'])]: makeNode({
      axis: 'row',
      path: ['US'],
      level: 1,
      hasChildren: true,
      label: 'US',
      formattedLabel: 'US',
    }),
  },
  cols: {
    '': makeNode({ axis: 'col', path: [], hasChildren: true }),
  },
  cells: {},
});

const mockPost = SupersetClient.post as jest.Mock;

describe('fetchPivotBranchesBatch', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('builds IN filters for sibling batches', async () => {
    mockPost.mockImplementation(({ jsonPayload }) =>
      Promise.resolve({
        response: new Response(),
        json: {
          result: jsonPayload.queries.map(() => ({ data: [] })),
        },
      }),
    );

    const formData = buildFormData({
      groupbyRows: ['country', 'state'],
      groupbyColumns: [],
    });
    const batch: BatchGroup = {
      axis: 'row',
      childDepth: 2,
      requiredOppositeDepth: 0,
      signature: 'sig',
      parentPathKey: serializePath(['US']),
      siblingValues: ['CA', 'NY'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US', 'CA']),
          childDepth: 2,
          requiredOppositeDepth: 0,
          batchSignature: 'sig',
        },
        {
          axis: 'row',
          pathKey: serializePath(['US', 'NY']),
          childDepth: 2,
          requiredOppositeDepth: 0,
          batchSignature: 'sig',
        },
      ],
    };

    await fetchPivotBranchesBatch({
      formData,
      batch,
      currentTree: makeTree(),
      visibleRowDepth: 2,
      visibleColDepth: 0,
      getFetchPath: path => path,
    });

    const payload = mockPost.mock.calls[0][0].jsonPayload;
    const { filters } = payload.queries[0];
    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ col: 'country', op: '==', val: 'US' }),
        expect.objectContaining({
          col: 'state',
          op: 'IN',
          val: ['CA', 'NY'],
        }),
      ]),
    );
  });

  it('uses IS NULL when batching null siblings', async () => {
    mockPost.mockImplementation(({ jsonPayload }) =>
      Promise.resolve({
        response: new Response(),
        json: {
          result: jsonPayload.queries.map(() => ({ data: [] })),
        },
      }),
    );

    const formData = buildFormData({
      groupbyRows: ['country', 'state'],
      groupbyColumns: [],
    });
    const batch: BatchGroup = {
      axis: 'row',
      childDepth: 2,
      requiredOppositeDepth: 0,
      signature: 'sig',
      parentPathKey: serializePath(['US']),
      siblingValues: [null],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US', null]),
          childDepth: 2,
          requiredOppositeDepth: 0,
          batchSignature: 'sig',
        },
      ],
    };

    await fetchPivotBranchesBatch({
      formData,
      batch,
      currentTree: makeTree(),
      visibleRowDepth: 2,
      visibleColDepth: 0,
      getFetchPath: path => path,
    });

    const payload = mockPost.mock.calls[0][0].jsonPayload;
    const { filters } = payload.queries[0];
    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ col: 'country', op: '==', val: 'US' }),
        expect.objectContaining({ col: 'state', op: 'IS NULL' }),
      ]),
    );
  });
});
