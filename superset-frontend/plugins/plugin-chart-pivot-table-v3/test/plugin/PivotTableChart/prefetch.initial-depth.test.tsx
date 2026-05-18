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

import { render, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';
import { mergeTrees } from '../../../src/pivot/core/tree';
import {
  fetchPivotExpansion as fetchPivotBranch,
  fetchPivotExpansion as fetchPivotIntersection,
} from '../../../src/pivot/expansion/fetchPivotExpansion';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

jest.mock('../../../src/pivot/expansion/fetchPivotExpansion', () => {
  const actual = jest.requireActual(
    '../../../src/pivot/expansion/fetchPivotExpansion',
  );
  return {
    ...actual,
    fetchPivotExpansion: jest.fn(),
    fetchPivotIntersection: jest.fn(),
  };
});

const rowGroupby = ['r1'];
const colGroupby = ['c1'];
const metrics = ['m1'];

const buildTree = (
  records: Array<{ r1: string; c1: string; m1: number }>,
  rowDepth: number,
  colDepth: number,
): PivotTreeData => {
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
    1,
  );
};

describe('PivotTableChart initial depth prefetch', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.MockedFunction<
    typeof fetchPivotBranch
  >;
  const fetchPivotIntersectionMock =
    fetchPivotIntersection as jest.MockedFunction<
      typeof fetchPivotIntersection
    >;

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    fetchPivotIntersectionMock.mockReset();
  });

  it('does not repair missing bootstrap cells through expansion prefetch', async () => {
    const totalsTree = buildTree([{ r1: 'A', c1: 'B', m1: 30 }], 0, 0);
    const rowTree = buildTree([{ r1: 'A', c1: 'B', m1: 10 }], 1, 0);
    const colTree = buildTree([{ r1: 'A', c1: 'B', m1: 20 }], 0, 1);
    const baseTree = mergeTrees(mergeTrees(totalsTree, rowTree), colTree);

    const { container } = render(
      <PivotTableChart
        data={baseTree}
        factBatches={[]}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: colGroupby,
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          startCollapsed: true,
          initialDepth: 1,
          colTotals: false,
          rowTotals: false,
          rowSubTotals: false,
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
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

    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const tableScope = within(table as HTMLTableElement);
    await waitFor(() => expect(tableScope.getByText('A')).toBeInTheDocument());
    expect(tableScope.getByText('B')).toBeInTheDocument();
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
    expect(fetchPivotIntersectionMock).not.toHaveBeenCalled();
    expect(tableScope.queryByText('100')).not.toBeInTheDocument();
  });
});
