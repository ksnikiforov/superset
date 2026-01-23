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
import { FeatureFlag, SupersetClient } from '@superset-ui/core';
// eslint-disable-next-line import/no-extraneous-dependencies -- Test-only GAQ mock relies on Superset core asyncEvent entrypoint.
import { waitForAsyncData } from 'src/middleware/asyncEvent';
import {
  fetchPivotBranch,
  clearPivotBranchCache,
} from '../../../src/fetchPivotBranch';
import { fetchPivotBranchesBatch } from '../../../src/pivot/engine/query/fetchPivotBranchesBatch';
import { serializePath } from '../../../src/utils';
import { type PivotTreeData, type PivotTreeNode } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { type BatchGroup } from '../../../src/pivot/engine/query/fetchPlanOptimizer';

jest.mock('src/middleware/asyncEvent', () => ({
  waitForAsyncData: jest.fn(),
}));

jest.mock('@superset-ui/core', () => {
  const actual = jest.requireActual('@superset-ui/core');
  return {
    ...actual,
    SupersetClient: {
      post: jest.fn(),
    },
  };
});

const waitForAsyncDataMock = waitForAsyncData as jest.MockedFunction<
  typeof waitForAsyncData
>;

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

describe('Global Async Queries (HTTP 202) support', () => {
  beforeEach(() => {
    window.featureFlags[FeatureFlag.GlobalAsyncQueries] = true;
    (SupersetClient.post as jest.Mock).mockReset();
    waitForAsyncDataMock.mockReset();
    clearPivotBranchCache();
  });

  afterEach(() => {
    window.featureFlags[FeatureFlag.GlobalAsyncQueries] = false;
  });

  it('waits for async chart data in fetchPivotBranch()', async () => {
    (SupersetClient.post as jest.Mock).mockResolvedValue({
      response: new Response(null, { status: 202 }),
      json: { result: { job_id: 'job-1' } },
    });
    waitForAsyncDataMock.mockResolvedValue([{ data: [] }]);

    const result = await fetchPivotBranch({
      formData: buildFormData({
        groupbyRows: ['r1'],
        groupbyColumns: [],
        metrics: ['m1'],
      }),
      axis: 'row',
      path: ['A'],
      visibleRowDepth: 1,
      visibleColDepth: 0,
    });

    expect(waitForAsyncDataMock).toHaveBeenCalledTimes(1);
    expect(result.data).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('waits for async chart data in fetchPivotBranchesBatch()', async () => {
    (SupersetClient.post as jest.Mock).mockResolvedValue({
      response: new Response(null, { status: 202 }),
      json: { result: { job_id: 'job-2' } },
    });
    waitForAsyncDataMock.mockResolvedValue([{ data: [] }]);

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

    const result = await fetchPivotBranchesBatch({
      formData: buildFormData({
        groupbyRows: ['country', 'state'],
        groupbyColumns: [],
        metrics: ['m1'],
      }),
      batch,
      currentTree: makeTree(),
      visibleRowDepth: 2,
      visibleColDepth: 0,
      getFetchPath: path => path,
    });

    expect(waitForAsyncDataMock).toHaveBeenCalledTimes(1);
    expect(result.data).toBeDefined();
    expect(result.error).toBeUndefined();
  });
});
