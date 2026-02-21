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

import { fireEvent, render, screen, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum } from '../../../src/types';
import { applyMetricAxis, buildTreeFromRecords } from '../../../src/utils';
import { fetchPivotBranch } from '../../../src/fetchPivotBranch';
import { baseFormData, buildFormData } from '../fixtures/pivotFormData';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart expand resilience to explore data refresh', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  it('keeps expanded rows visible when explore refreshes base data', async () => {
    const records = [
      { orderPriority: '5-LOW', revenueBand: 'REV-A', grossRevenue: 10 },
      { orderPriority: '5-LOW', revenueBand: 'REV-B', grossRevenue: 20 },
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

    fetchPivotBranchMock.mockResolvedValueOnce({ data: expandedTree });

    const renderChart = ({
      data,
      setDataMask,
    }: {
      data: typeof baseTree;
      setDataMask: jest.Mock;
    }) => (
      <PivotTableChart
        data={data}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          expandRowsLevel: 0,
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
        persistExpansionState={false}
        setDataMask={setDataMask}
        metricColorFormatters={[]}
        dateFormatters={{}}
        ownState={undefined}
      />
    );

    const setDataMask = jest.fn();
    const { container } = render(renderChart({ data: baseTree, setDataMask }));

    const tbody = container.querySelector('tbody') as HTMLElement;
    fireEvent.click(within(tbody).getAllByLabelText('plus-square')[0]);

    await waitFor(() => expect(screen.getByText('REV-A')).toBeInTheDocument());
    expect(setDataMask).not.toHaveBeenCalled();
  });
});
