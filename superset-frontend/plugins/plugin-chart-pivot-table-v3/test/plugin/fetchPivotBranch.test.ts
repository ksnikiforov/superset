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
  MetricsLayoutEnum,
  PivotTreeData,
  PivotTreeNode,
} from '../../src/types';
import { resolveFetchContextForTest, fetchPivotBranch } from '../../src/fetchPivotBranch';
import { METRICS_PLACEHOLDER, serializePath, SUBTOTAL_TOKEN } from '../../src/utils';
import { formatQueryName } from '../../src/buildQuery';
import { SupersetClient } from '@superset-ui/core';

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

describe('resolveFetchContext', () => {
  beforeEach(() => {
    (SupersetClient.post as jest.Mock).mockReset();
  });

  it('keeps column depth aligned to visible dimensions when metrics are on columns', () => {
    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        A: makeNode({
          axis: 'row',
          path: ['A'],
          level: 1,
          hasChildren: true,
          label: 'A',
          formattedLabel: 'A',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        m1: makeNode({
          axis: 'col',
          path: ['m1'],
          level: 1,
          label: 'm1',
          formattedLabel: 'm1',
        }),
      },
      cells: {},
    };

    const ctx = resolveFetchContextForTest({
      formData: {
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: [METRICS_PLACEHOLDER, 'c1'],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
      } as any,
      axis: 'row',
      path: ['A'],
      currentTree,
    });

    expect(ctx.rowDepth).toBe(2);
    expect(ctx.colDepth).toBe(0);
  });

  it('uses the visible column depth for row fetches', () => {
    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        A: makeNode({
          axis: 'row',
          path: ['A'],
          level: 1,
          hasChildren: true,
          label: 'A',
          formattedLabel: 'A',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        m1: makeNode({
          axis: 'col',
          path: ['m1'],
          level: 1,
          hasChildren: true,
          label: 'm1',
          formattedLabel: 'm1',
        }),
        'm1__AUTO': makeNode({
          axis: 'col',
          path: ['m1', 'AUTO'],
          level: 2,
          hasChildren: false,
          label: 'AUTO',
          formattedLabel: 'AUTO',
        }),
      },
      cells: {},
    };

    const ctx = resolveFetchContextForTest({
      formData: {
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: [METRICS_PLACEHOLDER, 'c1'],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
      } as any,
      axis: 'row',
      path: ['A'],
      currentTree,
      visibleColDepth: 0,
    });

    expect(ctx.colDepth).toBe(0);
  });

  it('limits column fetch row depth to what is visible', () => {
    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        A: makeNode({
          axis: 'row',
          path: ['A'],
          level: 1,
          hasChildren: true,
          label: 'A',
          formattedLabel: 'A',
        }),
        'A__B': makeNode({
          axis: 'row',
          path: ['A', 'B'],
          level: 2,
          hasChildren: false,
          label: 'B',
          formattedLabel: 'B',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        m1: makeNode({
          axis: 'col',
          path: ['m1'],
          level: 1,
          hasChildren: true,
          label: 'm1',
          formattedLabel: 'm1',
        }),
      },
      cells: {},
    };

    const ctx = resolveFetchContextForTest({
      formData: {
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: [METRICS_PLACEHOLDER, 'c1'],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
      } as any,
      axis: 'col',
      path: ['m1'],
      currentTree,
      visibleRowDepth: 1,
    });

    expect(ctx.rowDepth).toBe(1);
  });

  it('fetches metric-front column expansion with root metrics populated', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockResolvedValueOnce({
      json: {
        result: [
          {
            data: [
              {
                nation: 'USA',
                customerName: 'ACME',
                segment: 'BUILDING',
                orderPriority: '1-URGENT',
                countCustomers: 4,
              },
            ],
          },
          {
            data: [
              {
                segment: 'BUILDING',
                orderPriority: '1-URGENT',
                countCustomers: 10,
              },
            ],
          },
        ],
      },
    });

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        countCustomers: makeNode({
          axis: 'row',
          path: ['countCustomers'],
          level: 1,
          hasChildren: true,
          label: 'countCustomers',
          formattedLabel: 'countCustomers',
        }),
        'countCustomers__USA': makeNode({
          axis: 'row',
          path: ['countCustomers', 'USA'],
          level: 2,
          hasChildren: true,
          label: 'USA',
          formattedLabel: 'USA',
        }),
        'countCustomers__USA__ACME': makeNode({
          axis: 'row',
          path: ['countCustomers', 'USA', 'ACME'],
          level: 3,
          hasChildren: false,
          label: 'ACME',
          formattedLabel: 'ACME',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        BUILDING: makeNode({
          axis: 'col',
          path: ['BUILDING'],
          level: 1,
          hasChildren: true,
          label: 'BUILDING',
          formattedLabel: 'BUILDING',
        }),
      },
      cells: {},
    };

    const result = await fetchPivotBranch({
      formData: {
        groupbyRows: [METRICS_PLACEHOLDER, 'nation', 'customerName'],
        groupbyColumns: ['segment', 'orderPriority'],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.ROWS,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'col',
      path: ['BUILDING'],
      currentTree,
    });

    expect(postMock).toHaveBeenCalled();
    expect(result.data?.cells['countCustomers|BUILDING__1-URGENT']?.values.countCustomers).toBe(
      10,
    );
    expect(
      result.data?.cells[
        `${serializePath(['countCustomers', 'USA', 'ACME'])}|BUILDING__1-URGENT`
      ]?.values.countCustomers,
    ).toBe(4);
  });

  it('fetches both col root and expanded col depth when rows fetch under metric-first columns', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockImplementationOnce(({ jsonPayload }) => ({
      json: {
        result: (jsonPayload.queries || []).map((query: any) => {
          const name = query.query_name as string;
          if (name.includes(formatQueryName(2, 2))) {
            return {
              data: [
                {
                  nation: 'USA',
                  orderPriority: 'HIGH',
                  segment: 'AUTO',
                  countCustomers: 5,
                },
              ],
            };
          }
          if (name.includes(formatQueryName(2, 1))) {
            return {
              data: [
                {
                  nation: 'USA',
                  orderPriority: 'HIGH',
                  segment: 'AUTO',
                  countCustomers: 5,
                },
              ],
            };
          }
          return { data: [] };
        }),
      },
    }));

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        USA: makeNode({
          axis: 'row',
          path: ['USA'],
          level: 1,
          hasChildren: true,
          label: 'USA',
          formattedLabel: 'USA',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        countCustomers: makeNode({
          axis: 'col',
          path: ['countCustomers'],
          level: 1,
          hasChildren: true,
          label: 'countCustomers',
          formattedLabel: 'countCustomers',
        }),
        'countCustomers__AUTO': makeNode({
          axis: 'col',
          path: ['countCustomers', 'AUTO'],
          level: 2,
          hasChildren: false,
          label: 'AUTO',
          formattedLabel: 'AUTO',
        }),
      },
      cells: {},
    };

    const result = await fetchPivotBranch({
      formData: {
        groupbyRows: ['nation', 'orderPriority'],
        groupbyColumns: [METRICS_PLACEHOLDER, 'segment'],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'row',
      path: ['USA'],
      currentTree,
    });

    expect(postMock).toHaveBeenCalled();
    expect(
      result.data?.cells[
        `${serializePath(['USA', 'HIGH'])}|${serializePath(['countCustomers', 'AUTO'])}`
      ]?.values.countCustomers,
    ).toBe(5);
    expect(
      result.data?.cells[
        `${serializePath(['USA', 'HIGH'])}|${serializePath([])}`
      ]?.values.countCustomers,
    ).toBe(5);
  });

  it('fetches parent column depth when expanding rows under expanded columns', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockImplementationOnce(({ jsonPayload }) => ({
      json: {
        result: (jsonPayload.queries || []).map(() => ({ data: [] })),
      },
    }));

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        USA: makeNode({
          axis: 'row',
          path: ['USA'],
          level: 1,
          hasChildren: true,
          label: 'USA',
          formattedLabel: 'USA',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        Consumer: makeNode({
          axis: 'col',
          path: ['Consumer'],
          level: 1,
          hasChildren: true,
          label: 'Consumer',
          formattedLabel: 'Consumer',
        }),
        'Consumer__AIR': makeNode({
          axis: 'col',
          path: ['Consumer', 'AIR'],
          level: 2,
          hasChildren: false,
          label: 'AIR',
          formattedLabel: 'AIR',
        }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: {
        groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
        groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'row',
      path: ['USA'],
      currentTree,
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    const queries = (postMock.mock.calls[0][0] as any).jsonPayload?.queries || [];
    expect(queries.length).toBe(4);
    const queryNames = queries.map((q: any) => q.query_name);
    expect(queryNames).toEqual(
      expect.arrayContaining([
        `${formatQueryName(3, 2)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(3, 1)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(2, 2)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(2, 1)}|branch:row:${serializePath(['USA'])}`,
      ]),
    );
  });

  it('fetches column subtotal slices for expanded rows and maps them to subtotal leaves', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockImplementationOnce(({ jsonPayload }) => ({
      json: {
        result: (jsonPayload.queries || []).map((query: any) => {
          const name = query.query_name as string;
          if (name.includes(formatQueryName(2, 1))) {
            return {
              data: [{ r1: 'A', r2: 'B', c1: 'X', metric1: 42 }],
            };
          }
          return { data: [] };
        }),
      },
    }));

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        A: makeNode({
          axis: 'row',
          path: ['A'],
          level: 1,
          hasChildren: true,
          label: 'A',
          formattedLabel: 'A',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        X: makeNode({
          axis: 'col',
          path: ['X'],
          level: 1,
          hasChildren: true,
          label: 'X',
          formattedLabel: 'X',
        }),
        'X__Y': makeNode({
          axis: 'col',
          path: ['X', 'Y'],
          level: 2,
          hasChildren: false,
          label: 'Y',
          formattedLabel: 'Y',
        }),
      },
      cells: {},
    };

    const result = await fetchPivotBranch({
      formData: {
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: ['c1', 'c2', METRICS_PLACEHOLDER],
        metrics: ['metric1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        colSubtotalLevels: [1],
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'row',
      path: ['A'],
      currentTree,
      visibleColDepth: 2,
      maxDepthPerFetch: 1,
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    const queries = (postMock.mock.calls[0][0] as any).jsonPayload?.queries || [];
    const queryNames = queries.map((q: any) => q.query_name);
    expect(queryNames).toEqual(
      expect.arrayContaining([
        `${formatQueryName(2, 1)}|branch:row:${serializePath(['A'])}`,
      ]),
    );
    const subtotalKey = serializePath(['X', SUBTOTAL_TOKEN]);
    const rowKey = serializePath(['A', 'B']);
    expect(result.data?.cols[subtotalKey]).toBeDefined();
    expect(result.data?.cells[`${rowKey}|${subtotalKey}`]?.values.metric1).toBe(42);
  });

  it('fetches ancestor column aggregates when expanding columns with deeper rows', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockImplementationOnce(({ jsonPayload }) => ({
      json: {
        result: (jsonPayload.queries || []).map(() => ({ data: [] })),
      },
    }));

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        USA: makeNode({
          axis: 'row',
          path: ['USA'],
          level: 1,
          hasChildren: true,
          label: 'USA',
          formattedLabel: 'USA',
        }),
        'USA__HIGH': makeNode({
          axis: 'row',
          path: ['USA', 'HIGH'],
          level: 2,
          hasChildren: true,
          label: 'HIGH',
          formattedLabel: 'HIGH',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        Consumer: makeNode({
          axis: 'col',
          path: ['Consumer'],
          level: 1,
          hasChildren: true,
          label: 'Consumer',
          formattedLabel: 'Consumer',
        }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: {
        groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
        groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'col',
      path: ['Consumer'],
      currentTree,
      visibleRowDepth: 2,
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    const queries = (postMock.mock.calls[0][0] as any).jsonPayload?.queries || [];
    expect(queries.length).toBe(4);
    const queryNames = queries.map((q: any) => q.query_name);
    expect(queryNames).toEqual(
      expect.arrayContaining([
        `${formatQueryName(2, 2)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(1, 2)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(2, 1)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(1, 1)}|branch:col:${serializePath(['Consumer'])}`,
      ]),
    );
  });

  it('fetches ancestor column aggregates for all visible row depths when rows are deeper than two levels', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockImplementationOnce(({ jsonPayload }) => ({
      json: {
        result: (jsonPayload.queries || []).map(() => ({ data: [] })),
      },
    }));

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        USA: makeNode({
          axis: 'row',
          path: ['USA'],
          level: 1,
          hasChildren: true,
          label: 'USA',
          formattedLabel: 'USA',
        }),
        'USA__HIGH': makeNode({
          axis: 'row',
          path: ['USA', 'HIGH'],
          level: 2,
          hasChildren: true,
          label: 'HIGH',
          formattedLabel: 'HIGH',
        }),
        'USA__HIGH__F': makeNode({
          axis: 'row',
          path: ['USA', 'HIGH', 'F'],
          level: 3,
          hasChildren: false,
          label: 'F',
          formattedLabel: 'F',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        Consumer: makeNode({
          axis: 'col',
          path: ['Consumer'],
          level: 1,
          hasChildren: true,
          label: 'Consumer',
          formattedLabel: 'Consumer',
        }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: {
        groupbyRows: ['nation', 'orderPriority', 'orderStatus'],
        groupbyColumns: ['segment', 'shipMode', METRICS_PLACEHOLDER],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'col',
      path: ['Consumer'],
      currentTree,
      visibleRowDepth: 3,
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    const queries = (postMock.mock.calls[0][0] as any).jsonPayload?.queries || [];
    expect(queries.length).toBe(6);
    const queryNames = queries.map((q: any) => q.query_name);
    expect(queryNames).toEqual(
      expect.arrayContaining([
        `${formatQueryName(3, 2)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(2, 2)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(1, 2)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(3, 1)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(2, 1)}|branch:col:${serializePath(['Consumer'])}`,
        `${formatQueryName(1, 1)}|branch:col:${serializePath(['Consumer'])}`,
      ]),
    );
  });

  it('fetches ancestor column levels when expanding rows after deeper column expansions', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockImplementationOnce(({ jsonPayload }) => ({
      json: {
        result: (jsonPayload.queries || []).map(() => ({ data: [] })),
      },
    }));

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        USA: makeNode({
          axis: 'row',
          path: ['USA'],
          level: 1,
          hasChildren: true,
          label: 'USA',
          formattedLabel: 'USA',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        AUTO: makeNode({
          axis: 'col',
          path: ['AUTO'],
          level: 1,
          hasChildren: true,
          label: 'AUTO',
          formattedLabel: 'AUTO',
        }),
        'AUTO__AIR': makeNode({
          axis: 'col',
          path: ['AUTO', 'AIR'],
          level: 2,
          hasChildren: true,
          label: 'AIR',
          formattedLabel: 'AIR',
        }),
        'AUTO__AIR__F': makeNode({
          axis: 'col',
          path: ['AUTO', 'AIR', 'F'],
          level: 3,
          hasChildren: false,
          label: 'F',
          formattedLabel: 'F',
        }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: {
        groupbyRows: ['nation', 'orderPriority'],
        groupbyColumns: ['segment', 'shipMode', 'orderStatus', METRICS_PLACEHOLDER],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'row',
      path: ['USA'],
      currentTree,
      visibleColDepth: 3,
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    const queries = (postMock.mock.calls[0][0] as any).jsonPayload?.queries || [];
    const queryNames = queries.map((q: any) => q.query_name);
    expect(queryNames).toEqual(
      expect.arrayContaining([
        `${formatQueryName(2, 3)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(2, 2)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(2, 1)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(1, 3)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(1, 2)}|branch:row:${serializePath(['USA'])}`,
        `${formatQueryName(1, 1)}|branch:row:${serializePath(['USA'])}`,
      ]),
    );
  });
});
