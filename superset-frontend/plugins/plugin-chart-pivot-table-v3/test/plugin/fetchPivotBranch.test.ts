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
import {
  clearPivotBranchCache,
  fetchPivotBranch,
  resolveFetchContextForTest,
} from '../../src/fetchPivotBranch';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  serializeCellKey,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../src/utils';
import { formatQueryName } from '../../src/buildQuery';
import { SupersetClient } from '@superset-ui/core';
import { buildFormData } from './fixtures/pivotFormData';

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

type QueryPayload = {
  time_range?: string;
  filters?: Array<{ col?: string; op?: string; val?: string }>;
};

describe('resolveFetchContext', () => {
  beforeEach(() => {
    (SupersetClient.post as jest.Mock).mockReset();
    clearPivotBranchCache();
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
        [serializePath([encodeMetricKey('m1')])]: makeNode({
          axis: 'col',
          path: [encodeMetricKey('m1')],
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
        rowSubTotals: false,
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
        [serializePath([encodeMetricKey('m1')])]: makeNode({
          axis: 'col',
          path: [encodeMetricKey('m1')],
          level: 1,
          hasChildren: true,
          label: 'm1',
          formattedLabel: 'm1',
        }),
        [serializePath([encodeMetricKey('m1'), 'AUTO'])]: makeNode({
          axis: 'col',
          path: [encodeMetricKey('m1'), 'AUTO'],
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
        rowSubTotals: false,
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
        [serializePath(['A', 'B'])]: makeNode({
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
        [serializePath([encodeMetricKey('m1')])]: makeNode({
          axis: 'col',
          path: [encodeMetricKey('m1')],
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
        rowSubTotals: false,
      } as any,
      axis: 'col',
      path: [encodeMetricKey('m1')],
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
        [serializePath([encodeMetricKey('countCustomers')])]: makeNode({
          axis: 'row',
          path: [encodeMetricKey('countCustomers')],
          level: 1,
          hasChildren: true,
          label: 'countCustomers',
          formattedLabel: 'countCustomers',
        }),
        [serializePath([encodeMetricKey('countCustomers'), 'USA'])]: makeNode({
          axis: 'row',
          path: [encodeMetricKey('countCustomers'), 'USA'],
          level: 2,
          hasChildren: true,
          label: 'USA',
          formattedLabel: 'USA',
        }),
        [serializePath([encodeMetricKey('countCustomers'), 'USA', 'ACME'])]:
          makeNode({
          axis: 'row',
          path: [encodeMetricKey('countCustomers'), 'USA', 'ACME'],
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
        rowSubTotals: false,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'col',
      path: ['BUILDING'],
      currentTree,
    });

    expect(postMock).toHaveBeenCalled();
    const metricRowKey = serializePath([encodeMetricKey('countCustomers')]);
    const detailRowKey = serializePath([
      encodeMetricKey('countCustomers'),
      'USA',
      'ACME',
    ]);
    const colKey = serializePath(['BUILDING', '1-URGENT']);
    expect(
      result.data?.cells[serializeCellKey(metricRowKey, colKey)]?.values
        .countCustomers,
    ).toBe(10);
    expect(
      result.data?.cells[
        serializeCellKey(detailRowKey, colKey)
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
        [serializePath([encodeMetricKey('countCustomers')])]: makeNode({
          axis: 'col',
          path: [encodeMetricKey('countCustomers')],
          level: 1,
          hasChildren: true,
          label: 'countCustomers',
          formattedLabel: 'countCustomers',
        }),
        [serializePath([encodeMetricKey('countCustomers'), 'AUTO'])]: makeNode({
          axis: 'col',
          path: [encodeMetricKey('countCustomers'), 'AUTO'],
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
        rowSubTotals: false,
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
        serializeCellKey(
          serializePath(['USA', 'HIGH']),
          serializePath([encodeMetricKey('countCustomers'), 'AUTO']),
        )
      ]?.values.countCustomers,
    ).toBe(5);
    expect(
      result.data?.cells[
        serializeCellKey(serializePath(['USA', 'HIGH']), serializePath([]))
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
        [serializePath(['Consumer', 'AIR'])]: makeNode({
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
        rowSubTotals: false,
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
        [serializePath(['X', 'Y'])]: makeNode({
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
        rowSubTotals: false,
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
    expect(
      result.data?.cells[serializeCellKey(rowKey, subtotalKey)]?.values.metric1,
    ).toBe(42);
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
        [serializePath(['USA', 'HIGH'])]: makeNode({
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
        rowSubTotals: false,
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
        [serializePath(['USA', 'HIGH'])]: makeNode({
          axis: 'row',
          path: ['USA', 'HIGH'],
          level: 2,
          hasChildren: true,
          label: 'HIGH',
          formattedLabel: 'HIGH',
        }),
        [serializePath(['USA', 'HIGH', 'F'])]: makeNode({
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
        rowSubTotals: false,
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
        [serializePath(['AUTO', 'AIR'])]: makeNode({
          axis: 'col',
          path: ['AUTO', 'AIR'],
          level: 2,
          hasChildren: true,
          label: 'AIR',
          formattedLabel: 'AIR',
        }),
        [serializePath(['AUTO', 'AIR', 'F'])]: makeNode({
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
        rowSubTotals: false,
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

  it('requests row subtotal depths when row subtotals are enabled', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockImplementationOnce(({ jsonPayload }) => ({
      json: {
        result: (jsonPayload.queries || []).map(() => ({ data: [] })),
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
        '': makeNode({ axis: 'col', path: [], hasChildren: false }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: {
        groupbyRows: ['r1', 'r2'],
        groupbyColumns: [],
        metrics: ['metric1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        rowSubTotals: true,
        datasource: '1__table',
        viz_type: 'pivot_table_v3',
      } as any,
      axis: 'row',
      path: ['A'],
      currentTree,
      visibleColDepth: 0,
      maxDepthPerFetch: 1,
    });

    const queries = (postMock.mock.calls[0][0] as any).jsonPayload?.queries || [];
    const queryNames = queries.map((q: any) => q.query_name);
    expect(queryNames).toEqual(
      expect.arrayContaining([
        `${formatQueryName(1, 0)}|branch:row:${serializePath(['A'])}`,
      ]),
    );
  });

  it('propagates extra_form_data filters into branch queries', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockResolvedValueOnce({
      json: {
        result: [{ data: [] }],
      },
    });

    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        '4-NOT SPECIFIED': makeNode({
          axis: 'row',
          path: ['4-NOT SPECIFIED'],
          level: 1,
          hasChildren: true,
          label: '4-NOT SPECIFIED',
          formattedLabel: '4-NOT SPECIFIED',
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: false }),
      },
      cells: {},
    };

    const formData = buildFormData({
      groupbyRows: ['orderPriority'],
      groupbyColumns: [],
      metrics: ['countCustomers'],
      metricsLayout: MetricsLayoutEnum.ROWS,
      rowSubTotals: false,
      extra_form_data: {
        time_range: '2020-01-01 : 2020-02-01',
        filters: [{ col: 'orderDate', op: '>=', val: '2020-01-01' }],
      },
    });

    await fetchPivotBranch({
      formData,
      axis: 'row',
      path: ['4-NOT SPECIFIED'],
      currentTree,
      visibleColDepth: 0,
    });

    const payload = postMock.mock.calls[0]?.[0] as {
      jsonPayload?: { queries?: QueryPayload[] };
    };
    const firstQuery = payload.jsonPayload?.queries?.[0];
    expect(firstQuery?.time_range).toBe('2020-01-01 : 2020-02-01');
    expect(firstQuery?.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          col: 'orderDate',
          op: '>=',
          val: '2020-01-01',
        }),
      ]),
    );
  });

  it('invalidates cache when extra_form_data filters change', async () => {
    const postMock = SupersetClient.post as jest.Mock;
    postMock.mockResolvedValue({
      json: {
        result: [{ data: [] }],
      },
    });

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
        '': makeNode({ axis: 'col', path: [], hasChildren: false }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: buildFormData({
        groupbyRows: ['orderPriority'],
        groupbyColumns: [],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.ROWS,
        rowSubTotals: false,
        extra_form_data: {
          time_range: '2020-01-01 : 2020-02-01',
        },
      }),
      axis: 'row',
      path: ['A'],
      currentTree,
      visibleColDepth: 0,
    });

    await fetchPivotBranch({
      formData: buildFormData({
        groupbyRows: ['orderPriority'],
        groupbyColumns: [],
        metrics: ['countCustomers'],
        metricsLayout: MetricsLayoutEnum.ROWS,
        rowSubTotals: false,
        extra_form_data: {
          time_range: '2021-01-01 : 2021-02-01',
        },
      }),
      axis: 'row',
      path: ['A'],
      currentTree,
      visibleColDepth: 0,
    });

    expect(postMock).toHaveBeenCalledTimes(2);
  });
});
