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

import { fetchPivotBranch } from '../../../src/fetchPivotBranch';
import { baseFormData, buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

describe('PivotTableChart expand without global loader for same-axis actions', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  it('keeps the table visible while expanding rows when columns are empty', async () => {
    const records = [
      { orderPriority: '1-URGENT', revenueBand: 'REV-A', grossRevenue: 10 },
      { orderPriority: '1-URGENT', revenueBand: 'REV-B', grossRevenue: 20 },
      { orderPriority: '2-HIGH', revenueBand: 'REV-A', grossRevenue: 15 },
    ];
    const rowGroupby = ['orderPriority', 'revenueBand'];
    const metrics = ['grossRevenue'];
    const baseTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rowGroupby, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
    );
    const expandedTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, rowGroupby, [], 2, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
    );

    fetchPivotBranchMock.mockResolvedValueOnce({
      data: expandedTree,
      factBatches: [],
    });

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
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

    const tbody = container.querySelector('tbody') as HTMLElement;
    const rowToggle = within(tbody).getAllByLabelText('plus-square')[0];
    fireEvent.click(rowToggle);

    expect(container.querySelector('table')).toBeInTheDocument();
    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1));
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(await findByText('REV-A')).toBeInTheDocument();
  });
});
