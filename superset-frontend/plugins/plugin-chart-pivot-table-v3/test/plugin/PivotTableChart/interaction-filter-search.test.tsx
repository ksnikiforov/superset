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
import { GenericDataType } from '@superset-ui/core';
import { fireEvent, render, screen, waitFor } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { buildFormData } from '../fixtures/pivotFormData';
import { MetricsLayoutEnum, PivotRuntimeLayout } from '../../../src/types';

import { supersetChartDataClient } from '../../../src/pivot/data/SupersetChartDataClient';
import { fetchPivotBranch } from '../../../src/pivot/query/fetchPivotBranch';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

jest.mock('../../../src/pivot/chart/PivotInteractionPanel', () => ({
  PivotInteractionPanel: ({
    onFilterValuesOpen,
    onFilterValuesSearch,
  }: {
    onFilterValuesOpen?: (dimension: string) => void;
    onFilterValuesSearch?: (dimension: string, search: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onFilterValuesOpen?.('row1')}>
        Open row1 filter
      </button>
      <button
        type="button"
        onClick={() => onFilterValuesSearch?.('row1', '100')}
      >
        Search row1 values
      </button>
    </>
  ),
}));

jest.mock('../../../src/pivot/data/SupersetChartDataClient', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/data/SupersetChartDataClient',
  );
  return {
    ...actual,
    supersetChartDataClient: {
      fetch: jest.fn(),
      cancel: jest.fn(),
    },
  };
});

jest.mock('../../../src/pivot/query/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/pivot/query/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

describe('PivotTableChart interaction filter search', () => {
  const fetchMock = supersetChartDataClient.fetch as jest.Mock;
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchPivotBranchMock.mockReset();
    fetchPivotBranchMock.mockResolvedValue({
      data: undefined,
      factBatches: [],
    });
  });

  it('uses a dynamic search query for dimension filter values', async () => {
    const metrics = ['m1'];
    const rows = ['row1'];
    const records = [
      { row1: 'A100', m1: 10 },
      { row1: 'B200', m1: 20 },
    ];
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dashboardId: 1,
      dimensions: rows,
      groupbyRows: [],
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      startCollapsed: false,
      initialDepth: 1,
    });
    const tree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rows, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rows,
      [],
      0,
    );

    fetchMock.mockResolvedValue([{ data: [{ row1: 'A100' }] }]);

    render(
      <PivotTableChart
        data={tree}
        formData={formData}
        rawFormData={formData}
        queryFormData={formData}
        metrics={metrics}
        groupbyRows={[]}
        groupbyColumns={[]}
        colTypeMap={{ row1: GenericDataType.String }}
        width={600}
        height={300}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open row1 filter' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Search row1 values' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestGroupId: 'pivot-v3-dimension-values-row1',
        specs: [
          expect.objectContaining({
            queryName: 'pivot_v3|dimension-values|row1',
            filters: [
              expect.objectContaining({
                col: 'row1',
                op: 'ILIKE',
                val: '%100%',
              }),
            ],
          }),
        ],
      }),
    );
  });
});
