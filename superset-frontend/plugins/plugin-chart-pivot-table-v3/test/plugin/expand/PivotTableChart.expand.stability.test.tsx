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

import { render, fireEvent, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';
import { applyMetricAxis, buildTreeFromRecords } from '../../../src/utils';
import {
  fetchPivotBranch,
  peekPivotBranchCache,
} from '../../../src/fetchPivotBranch';
import { buildFormData } from '../fixtures/pivotFormData';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart expand/collapse count stability', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const peekPivotBranchCacheMock = peekPivotBranchCache as jest.Mock;

  const records = [
    {
      r1: 'A',
      r2: 'X',
      r3: 'I',
      c1: 'G1',
      c2: 'H1',
      c3: 'K1',
      m1: 10,
      m2: 20,
      m3: 5,
    },
    {
      r1: 'A',
      r2: 'X',
      r3: 'J',
      c1: 'G1',
      c2: 'H2',
      c3: 'K1',
      m1: 11,
      m2: 21,
      m3: 6,
    },
    {
      r1: 'A',
      r2: 'Y',
      r3: 'I',
      c1: 'G2',
      c2: 'H1',
      c3: 'K2',
      m1: 12,
      m2: 22,
      m3: 7,
    },
    {
      r1: 'B',
      r2: 'X',
      r3: 'I',
      c1: 'G1',
      c2: 'H1',
      c3: 'K2',
      m1: 13,
      m2: 23,
      m3: 8,
    },
  ];

  const rowGroupby = ['r1', 'r2', 'r3'];
  const colGroupby = ['c1', 'c2', 'c3'];

  const buildTreeAtDepth = ({
    metrics,
    metricsLayout,
    rowDepth,
    colDepth,
    metricPosition,
  }: {
    metrics: string[];
    metricsLayout: MetricsLayoutEnum;
    rowDepth: number;
    colDepth: number;
    metricPosition?: number;
  }) => {
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
      metricsLayout,
      rowGroupby,
      colGroupby,
      metricPosition,
    );
  };

  const renderChart = ({
    data,
    metrics,
    metricsLayout,
  }: {
    data: PivotTreeData;
    metrics: string[];
    metricsLayout: MetricsLayoutEnum;
  }) =>
    render(
      <PivotTableChart
        data={data}
        formData={buildFormData({
          groupbyRows: rowGroupby,
          groupbyColumns: colGroupby,
          metricsLayout,
          metrics,
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

  const getPivotTable = (container: HTMLElement) =>
    (container.querySelector('.pivot_table_v_3 table') ||
      container.querySelector('table')) as HTMLTableElement | null;

  const getCounts = (container: HTMLElement) => {
    const table = getPivotTable(container);
    const rows = table ? table.querySelectorAll('tbody tr').length : 0;
    const firstRow = table?.querySelector('tbody tr');
    const cols = firstRow ? firstRow.querySelectorAll('td').length : 0;
    return { rows, cols };
  };

  const clickToggle = async (
    container: HTMLElement,
    axis: 'row' | 'col',
    action: 'expand' | 'collapse',
  ) => {
    const label = action === 'expand' ? 'plus-square' : 'minus-square';
    let toggle: HTMLElement | undefined;
    await waitFor(() => {
      const table = getPivotTable(container);
      if (!table) {
        throw new Error('Pivot table not found');
      }
      const scope =
        axis === 'row'
          ? table.querySelector('tbody')
          : table.querySelector('thead');
      if (!scope) {
        throw new Error('Pivot table section not found');
      }
      const toggles = within(scope).getAllByLabelText(label);
      expect(toggles.length).toBeGreaterThan(0);
      toggle = action === 'collapse' ? toggles[toggles.length - 1] : toggles[0];
    });
    if (!toggle) {
      throw new Error(`Toggle "${label}" not found`);
    }
    const button = toggle.closest('button') ?? toggle;
    fireEvent.click(button);
  };

  const scenarios = [
    {
      name: 'rows two-level toggle with two metrics',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1', 'm2'],
      actions: ['row+', 'row+', 'row-', 'row-'],
    },
    {
      name: 'rows repeat toggle with one metric',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1'],
      actions: ['row+', 'row-', 'row+', 'row-'],
    },
    {
      name: 'rows deep toggle with three metrics',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1', 'm2', 'm3'],
      actions: ['row+', 'row+', 'row+', 'row-', 'row-', 'row-'],
    },
    {
      name: 'columns two-level toggle with two metrics',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2'],
      actions: ['col+', 'col+', 'col-', 'col-'],
    },
    {
      name: 'columns repeat toggle with one metric',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1'],
      actions: ['col+', 'col-', 'col+', 'col-'],
    },
    {
      name: 'columns deep toggle with three metrics',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2', 'm3'],
      actions: ['col+', 'col+', 'col+', 'col-', 'col-', 'col-'],
    },
    {
      name: 'mixed row then column with two metrics on rows',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1', 'm2'],
      actions: ['row+', 'col+', 'col-', 'row-'],
    },
    {
      name: 'mixed column then row with two metrics on columns',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2'],
      actions: ['col+', 'row+', 'row-', 'col-'],
    },
    {
      name: 'mixed deep rows then columns with one metric on rows',
      metricsLayout: MetricsLayoutEnum.ROWS,
      metrics: ['m1'],
      actions: ['row+', 'row+', 'col+', 'col-', 'row-', 'row-'],
    },
    {
      name: 'mixed deep columns then rows with three metrics on columns',
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      metrics: ['m1', 'm2', 'm3'],
      actions: ['col+', 'col+', 'row+', 'row-', 'col-', 'col-'],
    },
  ];

  beforeEach(() => {
    fetchPivotBranchMock.mockReset();
    peekPivotBranchCacheMock.mockReset();
    peekPivotBranchCacheMock.mockReturnValue(undefined);
  });

  test.each(scenarios)(
    'keeps row/col counts stable after toggles: $name',
    async ({ metricsLayout, metrics, actions }) => {
      const baseRowDepth =
        metricsLayout === MetricsLayoutEnum.ROWS ? rowGroupby.length : 1;
      const baseColDepth =
        metricsLayout === MetricsLayoutEnum.COLUMNS ? colGroupby.length : 1;
      const fullRowDepth = rowGroupby.length;
      const fullColDepth = colGroupby.length;
      const metricPosition =
        metricsLayout === MetricsLayoutEnum.ROWS
          ? rowGroupby.length
          : colGroupby.length;
      const baseTree = buildTreeAtDepth({
        metrics,
        metricsLayout,
        rowDepth: baseRowDepth,
        colDepth: baseColDepth,
        metricPosition,
      });
      const fullTree = buildTreeAtDepth({
        metrics,
        metricsLayout,
        rowDepth: fullRowDepth,
        colDepth: fullColDepth,
        metricPosition,
      });

      fetchPivotBranchMock.mockResolvedValue({ data: fullTree });

      const { container } = renderChart({
        data: baseTree,
        metrics,
        metricsLayout,
      });

      const baseline = getCounts(container);

      await actions.reduce(async (promise, action) => {
        await promise;
        const axis = action.startsWith('row') ? 'row' : 'col';
        const toggle = action.endsWith('+') ? 'expand' : 'collapse';
        await clickToggle(container, axis, toggle);
        const expectedLabel =
          toggle === 'expand' ? 'minus-square' : 'plus-square';
        await waitFor(() => {
          const table = getPivotTable(container);
          if (!table) {
            throw new Error('Pivot table not found');
          }
          const scope =
            axis === 'row'
              ? table.querySelector('tbody')
              : table.querySelector('thead');
          if (!scope) {
            throw new Error('Pivot table section not found');
          }
          const toggles = within(scope).queryAllByLabelText(expectedLabel);
          expect(toggles.length).toBeGreaterThan(0);
        });
        await waitFor(() => {
          const counts = getCounts(container);
          expect(counts.rows).toBeGreaterThan(0);
          expect(counts.cols).toBeGreaterThan(0);
        });
      }, Promise.resolve());

      const finalCounts = getCounts(container);
      expect(finalCounts).toEqual(baseline);
    },
  );
});
