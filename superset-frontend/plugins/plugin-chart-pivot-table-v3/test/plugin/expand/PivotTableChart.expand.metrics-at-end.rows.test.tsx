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

import { fireEvent, render, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { mergeTrees } from '../fixtures/tree';
import { serializePath } from '../../../src/pivot/core/path';
import { METRICS_PLACEHOLDER } from '../../../src/pivot/core/tokens';
import { fetchPivotExpansion as fetchPivotBranch } from '../../../src/pivot/expansion/fetchPivotExpansion';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';
import {
  buildMockBranchFetchResult,
  getMockExpansionRequestPath,
} from '../fixtures/factBatches';

jest.mock('../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

describe('PivotTableChart expansion with metrics at the row end', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const waitForPivotReady = async () => {
    await waitFor(() => {
      expect(
        document.querySelector('[role="status"][aria-label="Loading"]'),
      ).not.toBeInTheDocument();
    });
  };

  it('expands a row dimension to the next level before showing metrics', async () => {
    const metrics = ['averageOrderValue', 'weightedDiscount'];
    const rowGroupby = ['shipMode', 'quantityBand'];
    const colGroupby = ['discountBand'];
    const record = {
      shipMode: 'AIR',
      quantityBand: '1-5',
      discountBand: '0-2%',
      averageOrderValue: 5196,
      weightedDiscount: 0.05,
    };

    const detail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      1,
    );
    const colTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      1,
      0,
    );
    const baseTree = applyMetricAxis(
      mergeTrees(detail, colTotals),
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );

    const branchDetail = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      2,
      1,
    );
    const branchTotals = buildTreeFromRecords(
      [record],
      metrics,
      rowGroupby,
      colGroupby,
      2,
      0,
    );
    const branchTree = applyMetricAxis(
      mergeTrees(branchDetail, branchTotals),
      metrics,
      MetricsLayoutEnum.ROWS,
      rowGroupby,
      colGroupby,
      rowGroupby.length,
    );
    expect(branchTree.rows[serializePath(['AIR', '1-5'])]).toBeDefined();

    fetchPivotBranchMock.mockImplementation(params => {
      if (getMockExpansionRequestPath(params)[0] === 'AIR') {
        return Promise.resolve(
          buildMockBranchFetchResult(params, { data: branchTree }),
        );
      }
      return Promise.resolve({ data: undefined, factBatches: [] });
    });

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          groupbyRows: [...rowGroupby, METRICS_PLACEHOLDER],
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.ROWS,
          interactionMode: 'user_controlled',
          dimensions: [...rowGroupby, ...colGroupby],
          pivotRuntimeLayout: {
            version: 1,
            rows: rowGroupby,
            cols: colGroupby,
            metrics,
            leafSelection: {},
            valuePlacement: { axis: 'row', index: rowGroupby.length },
          },
          rowTotals: true,
          colTotals: true,
          startCollapsed: true,
          initialDepth: 1,
          rowOrder: 'key_a_to_z',
          colOrder: 'key_a_to_z',
          aggregateFunction: 'Sum',
          viz_type: 'pivot_table_v3',
          datasource: '1__table',
          metricColorFormatters: [],
          dateFormatters: {},
          verboseMap: {},
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={400}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals
        rowTotals
        rowSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
      />,
    );

    await waitForPivotReady();
    const tbody = container.querySelector('tbody') as HTMLElement;
    const airRow = within(tbody).getByText('AIR').closest('tr') as HTMLElement;
    fireEvent.click(within(airRow).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalled();
    });
    const lastCall = fetchPivotBranchMock.mock.calls.at(-1)?.[0];
    expect(lastCall && getMockExpansionRequestPath(lastCall)).toEqual(['AIR']);
    await waitForPivotReady();

    await waitFor(() => {
      const updatedTbody = container.querySelector('tbody') as HTMLElement;
      expect(within(updatedTbody).getByText('1-5')).toBeInTheDocument();
    });
  });
});
