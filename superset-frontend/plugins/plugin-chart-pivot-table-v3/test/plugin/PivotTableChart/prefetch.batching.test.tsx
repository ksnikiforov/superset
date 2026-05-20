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
import { render, screen, waitFor } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import {
  MetricsLayoutEnum,
  PivotExpansionState,
  PivotTreeData,
} from '../../../src/types';

import {
  fetchPivotExpansion,
  type FetchPivotExpansionRequest,
  type FetchPivotExpansionResult,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildMockExpansionFetchResult } from '../fixtures/factBatches';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

jest.mock('../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest.fn(),
  };
});

const createDeferredExpansionFetch = () => {
  const resolvers: Array<(result: Partial<FetchPivotExpansionResult>) => void> =
    [];
  const promises: Array<Promise<FetchPivotExpansionResult>> = [];
  let resolvedResult: Partial<FetchPivotExpansionResult> | undefined;

  return {
    implementation: (params: FetchPivotExpansionRequest) => {
      if (resolvedResult) {
        const promise = Promise.resolve(
          buildMockExpansionFetchResult(params, resolvedResult),
        );
        promises.push(promise);
        return promise;
      }
      const promise = new Promise<FetchPivotExpansionResult>(resolve => {
        resolvers.push(result =>
          resolve(buildMockExpansionFetchResult(params, result)),
        );
      });
      promises.push(promise);
      return promise;
    },
    promises,
    resolveAll: (result: Partial<FetchPivotExpansionResult>) => {
      resolvedResult = result;
      resolvers.splice(0).forEach(resolve => resolve(result));
    },
  };
};

const buildTree = ({
  records,
  rowGroupby,
  colGroupby,
  metrics,
  rowDepth,
  colDepth,
}: {
  records: Array<Record<string, string | number>>;
  rowGroupby: string[];
  colGroupby: string[];
  metrics: string[];
  rowDepth: number;
  colDepth: number;
}): PivotTreeData => {
  const raw = buildTreeFromRecords(
    records,
    metrics,
    rowGroupby,
    colGroupby,
    rowDepth,
    colDepth,
  );
  return applyMetricAxis(
    raw,
    metrics,
    MetricsLayoutEnum.COLUMNS,
    rowGroupby,
    colGroupby,
    0,
  );
};

describe('PivotTableChart coverage prefetch on persisted restore', () => {
  const fetchPivotExpansionMock = fetchPivotExpansion as jest.MockedFunction<
    typeof fetchPivotExpansion
  >;
  const coverageCalls = () => fetchPivotExpansionMock.mock.calls;

  beforeEach(() => {
    fetchPivotExpansionMock.mockReset();
  });

  it('submits sibling expansions as one coverage request', async () => {
    const records = [
      { r1: 'A', r2: 'X', m1: 10 },
      { r1: 'A', r2: 'Y', m1: 12 },
      { r1: 'B', r2: 'Z', m1: 15 },
    ];
    const rowGroupby = ['r1', 'r2'];
    const colGroupby: string[] = [];
    const metrics = ['m1'];
    const branchTree = buildTree({
      records,
      rowGroupby,
      colGroupby,
      metrics,
      rowDepth: 2,
      colDepth: 0,
    });

    fetchPivotExpansionMock.mockImplementation(params =>
      Promise.resolve(
        buildMockExpansionFetchResult(params, { data: branchTree }),
      ),
    );

    const pivotExpansionState: PivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: colGroupby,
      rows: [['A'], ['B']],
      cols: [],
    };

    render(
      <PivotTableChart
        data={buildTree({
          records,
          rowGroupby,
          colGroupby,
          metrics,
          rowDepth: 1,
          colDepth: 0,
        })}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          startCollapsed: true,
          initialDepth: 1,
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
          rowTotals: false,
          colTotals: false,
          rowSubTotals: false,
          pivotExpansionState,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(coverageCalls()).toHaveLength(1));
    expect(coverageCalls()[0][0].targets.map(target => target.pathKey)).toEqual(
      expect.arrayContaining(['A', 'B']),
    );
  });

  it('hydrates row and column persisted targets from one coverage request', async () => {
    const records = [
      { r1: 'A', r2: 'X', c1: 'CA', c2: 'P', m1: 10 },
      { r1: 'A', r2: 'Y', c1: 'CA', c2: 'Q', m1: 12 },
      { r1: 'B', r2: 'Z', c1: 'NY', c2: 'R', m1: 15 },
      { r1: 'B', r2: 'W', c1: 'NY', c2: 'S', m1: 18 },
    ];
    const rowGroupby = ['r1', 'r2'];
    const colGroupby = ['c1', 'c2'];
    const metrics = ['m1'];
    const deferredFetch = createDeferredExpansionFetch();

    fetchPivotExpansionMock.mockImplementation(params =>
      deferredFetch.implementation(params),
    );

    const pivotExpansionState: PivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: colGroupby,
      rows: [['A'], ['B']],
      cols: [['CA'], ['NY']],
    };

    render(
      <PivotTableChart
        data={buildTree({
          records,
          rowGroupby,
          colGroupby,
          metrics,
          rowDepth: 1,
          colDepth: 1,
        })}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          startCollapsed: true,
          initialDepth: 1,
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
          rowTotals: false,
          colTotals: false,
          rowSubTotals: false,
          pivotExpansionState,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={600}
        height={300}
      />,
    );

    await waitFor(() => expect(coverageCalls()).toHaveLength(1));
    expect(deferredFetch.promises).toHaveLength(1);
    deferredFetch.resolveAll({
      data: buildTree({
        records,
        rowGroupby,
        colGroupby,
        metrics,
        rowDepth: 2,
        colDepth: 2,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
      expect(screen.getByText('P')).toBeInTheDocument();
    });
    expect(coverageCalls()[0][0].targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pathKey: '',
          need: expect.objectContaining({
            rowDepth: 2,
            columnDepth: 2,
            rowScope: { kind: 'paths', paths: [['A'], ['B']] },
            columnScope: { kind: 'paths', paths: [['CA'], ['NY']] },
          }),
        }),
      ]),
    );
  });
});
