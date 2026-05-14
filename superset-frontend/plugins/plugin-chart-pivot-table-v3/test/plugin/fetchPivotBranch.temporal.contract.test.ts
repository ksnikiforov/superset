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
import { GenericDataType, SupersetClient } from '@superset-ui/core';
import { fetchPivotBranch } from '../../src/fetchPivotBranch';
import { clearPivotBranchCache } from '../../src/pivot/data/cache';
import {
  MetricsLayoutEnum,
  PivotTreeData,
  PivotTreeNode,
} from '../../src/types';
import { serializePath } from '../../src/pivot/core/path';
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

type QueryFilter = {
  col?: string;
  op?: string;
  val?: unknown;
};

type QueryPayload = {
  queries?: Array<{
    filters?: QueryFilter[];
    columns?: unknown[];
  }>;
};

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

const flattenFilters = (payload?: {
  jsonPayload?: QueryPayload;
}): QueryFilter[] =>
  payload?.jsonPayload?.queries?.flatMap(query => query.filters ?? []) ?? [];

const assertNoInvalidTemporalIso = (filters: QueryFilter[]) => {
  const temporalEqualsFilters = filters.filter(
    filter => filter.op === '==' && filter.col === 'orderYear',
  );
  expect(temporalEqualsFilters.length).toBeGreaterThan(0);
  temporalEqualsFilters.forEach(filter => {
    expect(typeof filter.val).toBe('number');
    expect(String(filter.val)).not.toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });
};

const assertColumnsUseRawSqlOutput = (payload?: {
  jsonPayload?: QueryPayload;
}) => {
  const queries = payload?.jsonPayload?.queries ?? [];
  queries.forEach(query => {
    (query.columns ?? []).forEach(column => {
      expect(typeof column).toBe('string');
    });
  });
};

describe('fetchPivotBranch temporal payload contract', () => {
  const postMock = SupersetClient.post as jest.MockedFunction<
    typeof SupersetClient.post
  >;

  beforeEach(() => {
    postMock.mockReset();
    clearPivotBranchCache();
    postMock.mockResolvedValue({
      response: { status: 200 } as Response,
      json: {
        result: [{ data: [] }],
      },
    } as Awaited<ReturnType<typeof SupersetClient.post>>);
  });

  it('builds backend-safe temporal filters for row expansion', async () => {
    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: true }),
        [serializePath(['1483228800000'])]: makeNode({
          axis: 'row',
          path: ['1483228800000'],
          label: '2017',
          formattedLabel: '2017',
          level: 1,
          hasChildren: true,
        }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: false }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: buildFormData({
        groupbyRows: ['orderYear', 'orderMonth'],
        groupbyColumns: [],
        metrics: ['grossSales'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
        rowSubTotals: false,
        time_grain_sqla: 'P1D',
        temporal_columns_lookup: {
          orderYear: true,
          orderMonth: true,
        },
        colTypeMap: {
          orderYear: GenericDataType.Temporal,
          orderMonth: GenericDataType.Temporal,
          grossSales: GenericDataType.Numeric,
        },
      }),
      axis: 'row',
      path: ['1483228800000'],
      currentTree,
      visibleColDepth: 0,
    });
    expect(postMock).toHaveBeenCalledTimes(1);

    const payload = postMock.mock.calls[0]?.[0] as
      | { jsonPayload?: QueryPayload }
      | undefined;
    assertNoInvalidTemporalIso(flattenFilters(payload));
    assertColumnsUseRawSqlOutput(payload);
  });

  it('builds backend-safe temporal filters for column expansion', async () => {
    const currentTree: PivotTreeData = {
      rows: {
        '': makeNode({ axis: 'row', path: [], hasChildren: false }),
      },
      cols: {
        '': makeNode({ axis: 'col', path: [], hasChildren: true }),
        [serializePath(['1483228800000'])]: makeNode({
          axis: 'col',
          path: ['1483228800000'],
          label: '2017',
          formattedLabel: '2017',
          level: 1,
          hasChildren: true,
        }),
      },
      cells: {},
    };

    await fetchPivotBranch({
      formData: buildFormData({
        groupbyRows: [],
        groupbyColumns: ['orderYear', 'orderMonth'],
        metrics: ['grossSales'],
        metricsLayout: MetricsLayoutEnum.ROWS,
        rowSubTotals: false,
        time_grain_sqla: 'P1D',
        temporal_columns_lookup: {
          orderYear: true,
          orderMonth: true,
        },
        colTypeMap: {
          orderYear: GenericDataType.Temporal,
          orderMonth: GenericDataType.Temporal,
          grossSales: GenericDataType.Numeric,
        },
      }),
      axis: 'col',
      path: ['1483228800000'],
      currentTree,
      visibleRowDepth: 0,
    });
    expect(postMock).toHaveBeenCalledTimes(1);

    const payload = postMock.mock.calls[0]?.[0] as
      | { jsonPayload?: QueryPayload }
      | undefined;
    assertNoInvalidTemporalIso(flattenFilters(payload));
    assertColumnsUseRawSqlOutput(payload);
  });
});
