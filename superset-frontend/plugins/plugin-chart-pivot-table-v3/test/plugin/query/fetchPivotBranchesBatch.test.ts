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
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
} from '../../../src/pivot/core/tokens';
import { serializeCellKey, serializePath } from '../../../src/pivot/core/path';
import {
  MetricsLayoutEnum,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../src/types';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import { buildBatchQuerySpecs } from '../../../src/pivot/query/specs';
import { createPivotFactStore } from '../../../src/pivot/runtime/factStore';

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
      groupbyRows: ['country', 'state', 'city'],
      groupbyColumns: [],
    });
    const batch: BatchGroup = {
      axis: 'row',
      signature: 'sig',
      parentPathKey: serializePath(['US']),
      siblingValues: ['CA', 'NY'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US', 'CA']),
          batchSignature: 'sig',
        },
        {
          axis: 'row',
          pathKey: serializePath(['US', 'NY']),
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
      groupbyRows: ['country', 'state', 'city'],
      groupbyColumns: [],
    });
    const batch: BatchGroup = {
      axis: 'row',
      signature: 'sig',
      parentPathKey: serializePath(['US']),
      siblingValues: [null],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US', null]),
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

  it('propagates time offsets into batch queries', async () => {
    mockPost.mockImplementation(({ jsonPayload }) =>
      Promise.resolve({
        response: new Response(),
        json: {
          result: jsonPayload.queries.map(() => ({ data: [] })),
        },
      }),
    );

    const formData = buildFormData({
      time_offsets: ['1 year ago'],
      groupbyRows: ['country', 'state'],
      groupbyColumns: [],
    });
    const batch: BatchGroup = {
      axis: 'row',
      signature: 'sig',
      parentPathKey: serializePath([]),
      siblingValues: ['US'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US']),
          batchSignature: 'sig',
        },
      ],
    };

    await fetchPivotBranchesBatch({
      formData,
      batch,
      currentTree: makeTree(),
      visibleRowDepth: 1,
      visibleColDepth: 0,
    });

    const payload = mockPost.mock.calls[0][0].jsonPayload;
    expect(payload.queries[0].time_offsets).toEqual(['1 year ago']);
  });

  it('materializes from an exact fact-store hit without fetching', async () => {
    const formData = buildFormData({
      groupbyRows: ['country', 'state', 'city'],
      groupbyColumns: [],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
    });
    const batch: BatchGroup = {
      axis: 'row',
      signature: 'sig',
      parentPathKey: serializePath(['US']),
      siblingValues: ['CA', 'NY'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US', 'CA']),
          batchSignature: 'sig',
        },
        {
          axis: 'row',
          pathKey: serializePath(['US', 'NY']),
          batchSignature: 'sig',
        },
      ],
    };
    const layout = buildLayoutContext(formData);
    const specs = buildBatchQuerySpecs({
      formData,
      layout,
      batch,
      visibleRowDepth: 2,
      visibleColDepth: 0,
    });
    expect(specs).toHaveLength(1);

    const [spec] = specs;
    const store = createPivotFactStore();
    store.upsertBatch({
      coverage: spec.meta.coverage,
      scope: {
        kind: 'batch',
        axis: 'row',
        parentPath: ['US'],
        siblingValues: ['CA', 'NY'],
      },
      valueKeys: ['m1'],
      facts: [
        {
          rowPath: ['US', 'CA', 'SF'],
          columnPath: [],
          valueKey: 'm1',
          value: 7,
          role: 'visible',
        },
      ],
    });

    const result = await fetchPivotBranchesBatch({
      formData,
      batch,
      visibleRowDepth: 2,
      visibleColDepth: 0,
      factStore: store,
    });

    const rowKey = serializePath(['US', 'CA', 'SF']);
    const metricColKey = serializePath([encodeMetricKey('m1')]);

    expect(result.factBatches).toEqual([
      expect.objectContaining({
        scope: {
          kind: 'batch',
          axis: 'row',
          parentPath: ['US'],
          siblingValues: ['CA', 'NY'],
        },
      }),
    ]);
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.data?.rows[rowKey]).toBeDefined();
    expect(
      result.data?.cells[serializeCellKey(rowKey, metricColKey)]?.values.m1,
    ).toBe(7);
  });

  it('returns a fetched coverage marker when grouped expansion only reveals Values', async () => {
    const formData = buildFormData({
      groupbyRows: ['country', METRICS_PLACEHOLDER, 'state'],
      groupbyColumns: [],
      metrics: ['sales', 'profit'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      rowTotals: false,
      colTotals: false,
    });
    const batch: BatchGroup = {
      axis: 'row',
      signature: 'values-only',
      parentPathKey: '',
      siblingValues: ['US', 'CA'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US']),
          batchSignature: 'values-only',
        },
        {
          axis: 'row',
          pathKey: serializePath(['CA']),
          batchSignature: 'values-only',
        },
      ],
    };

    const result = await fetchPivotBranchesBatch({
      formData,
      batch,
      currentTree: makeTree(),
      visibleRowDepth: 1,
      visibleColDepth: 0,
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.data).toBeUndefined();
    expect(result.factBatches).toEqual([
      expect.objectContaining({
        coverage: expect.objectContaining({
          rowDepth: 1,
          columnDepth: 0,
        }),
        scope: {
          kind: 'batch',
          axis: 'row',
          parentPath: [],
          siblingValues: ['US', 'CA'],
        },
        facts: [],
        valueKeys: ['profit', 'sales'],
      }),
    ]);
  });
});
