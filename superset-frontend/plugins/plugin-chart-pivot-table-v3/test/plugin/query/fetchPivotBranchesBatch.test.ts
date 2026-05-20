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
import {
  fetchPivotExpansion,
  type FetchPivotExpansionRequest,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import {
  buildAxisExpansionCoverageTarget,
  type BatchGroup,
} from '../../../src/pivot/expansion/planner';
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
import { buildExpansionQuerySpecs } from '../../../src/pivot/query/specs';
import {
  createPivotFactStore,
  type PivotFactSelector,
  type PivotFactStore,
} from '../../../src/pivot/runtime/factStore';
import { materializeLoadedPivotTreeFromFactStore } from '../../../src/pivot/runtime/materializePivotTree';
import { factSelectorsCoverSelector } from '../../../src/pivot/runtime/coverage';

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

const hasCompatibleCoverage = (
  store: Pick<PivotFactStore, 'getCoverageSelectors'>,
  selector: PivotFactSelector,
) => factSelectorsCoverSelector(store.getCoverageSelectors(), selector);

const mockPost = SupersetClient.post as jest.Mock;

const withBatchCoverageTargets = ({
  layout,
  batch,
  visibleRowDepth,
  visibleColDepth,
}: {
  layout: ReturnType<typeof buildLayoutContext>;
  batch: BatchGroup;
  visibleRowDepth: number;
  visibleColDepth: number;
}): BatchGroup => ({
  ...batch,
  targets: batch.targets.map(target => ({
    ...target,
    coverageTarget: buildAxisExpansionCoverageTarget({
      program: layout.pivotProgram,
      axis: target.axis,
      pathKey: target.pathKey,
      rowDepth: visibleRowDepth,
      columnDepth: visibleColDepth,
    }),
  })),
});

const fetchBatch = (
  params: Omit<FetchPivotExpansionRequest, 'kind' | 'layout' | 'batch'> & {
    batch: BatchGroup;
    visibleRowDepth: number;
    visibleColDepth: number;
    currentTree?: PivotTreeData;
  },
) => {
  const layout = buildLayoutContext(params.formData);
  const {
    batch,
    visibleRowDepth,
    visibleColDepth,
    formData,
    factStore,
    requestGroupId,
  } = params;
  return fetchPivotExpansion({
    kind: 'batch',
    formData,
    factStore,
    requestGroupId,
    layout,
    batch: withBatchCoverageTargets({
      layout,
      batch,
      visibleRowDepth,
      visibleColDepth,
    }),
  });
};

describe('fetchBatch', () => {
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

    await fetchBatch({
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

    await fetchBatch({
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

    await fetchBatch({
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
    const batchWithCoverage = withBatchCoverageTargets({
      layout,
      batch,
      visibleRowDepth: 2,
      visibleColDepth: 0,
    });
    const specs = buildExpansionQuerySpecs({
      kind: 'batch',
      formData,
      layout,
      batch: batchWithCoverage,
    });
    expect(specs).toHaveLength(1);

    const [spec] = specs;
    const store = createPivotFactStore();
    store.upsertBatch({
      ...spec.meta.factSelector,
      facts: [
        {
          rowPath: ['US', 'CA', 'SF'],
          columnPath: [],
          valueKey: 'm1',
          value: 7,
        },
      ],
    });

    await fetchBatch({
      formData,
      batch,
      visibleRowDepth: 2,
      visibleColDepth: 0,
      factStore: store,
    });
    const tree = materializeLoadedPivotTreeFromFactStore({
      store,
      layout,
      formData,
    });

    const rowKey = serializePath(['US', 'CA', 'SF']);
    const metricColKey = serializePath([encodeMetricKey('m1')]);

    expect(hasCompatibleCoverage(store, spec.meta.factSelector)).toBe(true);
    expect(mockPost).not.toHaveBeenCalled();
    expect(tree.rows[rowKey]).toBeDefined();
    expect(tree.cells[serializeCellKey(rowKey, metricColKey)]?.values.m1).toBe(
      7,
    );
  });

  it('fetches only missing specs when batch support coverage is partially loaded', async () => {
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
      groupbyColumns: ['category'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
    });
    const batch: BatchGroup = {
      axis: 'row',
      signature: 'sig',
      parentPathKey: serializePath(['US']),
      siblingValues: ['CA'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['US', 'CA']),
          batchSignature: 'sig',
        },
      ],
    };
    const layout = buildLayoutContext(formData);
    const batchWithCoverage = withBatchCoverageTargets({
      layout,
      batch,
      visibleRowDepth: 2,
      visibleColDepth: 1,
    });
    const specs = buildExpansionQuerySpecs({
      kind: 'batch',
      formData,
      layout,
      batch: batchWithCoverage,
    });
    expect(specs.length).toBeGreaterThan(1);

    const store = createPivotFactStore();
    const preloadedSpec = specs[specs.length - 1];
    store.upsertBatch({
      coverage: preloadedSpec.meta.coverage,
      scope: {
        kind: 'axisPaths',
        axis: 'row',
        paths: [['US', 'CA']],
      },
      valueKeys: ['m1'],
      facts: [],
    });
    const expectedMissingSpecs = specs.filter(
      spec => !hasCompatibleCoverage(store, spec.meta.factSelector),
    );

    await fetchBatch({
      formData,
      batch,
      visibleRowDepth: 2,
      visibleColDepth: 1,
      factStore: store,
    });

    const payload = mockPost.mock.calls[0][0].jsonPayload;
    expect(payload.queries).toHaveLength(expectedMissingSpecs.length);
    expect(payload.queries.length).toBeLessThan(specs.length);
  });

  it('does not fetch or mark coverage when grouped expansion only reveals Values', async () => {
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

    const result = await fetchBatch({
      formData,
      batch,
      currentTree: makeTree(),
      visibleRowDepth: 1,
      visibleColDepth: 0,
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});
