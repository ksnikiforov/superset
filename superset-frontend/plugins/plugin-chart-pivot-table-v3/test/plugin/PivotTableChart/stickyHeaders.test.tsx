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
import { buildFormData } from '../fixtures/pivotFormData';
import { mergeTrees } from '../fixtures/tree';
import { METRICS_PLACEHOLDER } from '../../../src/pivot/core/tokens';
import { MetricsLayoutEnum } from '../../../src/types';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

describe('PivotTableChart sticky headers', () => {
  const metrics = ['metric1'];
  const groupbyRows = ['country'];
  const groupbyColumns: string[] = [];
  const tree = buildTreeFromRecords(
    [{ country: 'Brazil', metric1: 10 }],
    metrics,
    groupbyRows,
    groupbyColumns,
    1,
    0,
  );

  it('marks sticky headers and pins the grand total row at the top', () => {
    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          colTotals: true,
          colTotalPosition: 'start',
          stickyHeaders: true,
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        colTotals
        colTotalPosition="start"
      />,
    );

    const table = container.querySelector('table') as HTMLElement;
    expect(table).toHaveAttribute('data-sticky-headers', 'true');

    const tbody = container.querySelector('tbody') as HTMLElement;
    const totalRow = within(tbody)
      .getByText('Grand total')
      .closest('tr') as HTMLTableRowElement;
    expect(totalRow).toHaveClass('pivot-grand-total-row');
    expect(totalRow).toHaveClass('pivot-grand-total-row--top');
  });

  it('allows sticky headers to be disabled', () => {
    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          colTotals: true,
          colTotalPosition: 'end',
          stickyHeaders: false,
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        colTotals
        colTotalPosition="end"
      />,
    );

    const table = container.querySelector('table') as HTMLElement;
    expect(table).toHaveAttribute('data-sticky-headers', 'false');

    const tbody = container.querySelector('tbody') as HTMLElement;
    const totalRow = within(tbody)
      .getByText('Grand total')
      .closest('tr') as HTMLTableRowElement;
    expect(totalRow).toHaveClass('pivot-grand-total-row');
    expect(totalRow).toHaveClass('pivot-grand-total-row--bottom');
  });

  it('stacks multi-level column headers with offsets when sticky headers are enabled', async () => {
    const multiLevelTree = buildTreeFromRecords(
      [{ country: 'Brazil', region: 'South', state: 'SC', metric1: 10 }],
      metrics,
      groupbyRows,
      ['region', 'state'],
      1,
      2,
    );
    const getBoundingClientRectSpy = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'TR' && this.closest('thead')) {
          const rows = Array.from(this.parentElement?.children ?? []);
          const idx = rows.indexOf(this);
          const heights = [20, 18];
          const height = heights[idx] ?? 0;
          return {
            width: 0,
            height,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

    const { container } = render(
      <PivotTableChart
        data={multiLevelTree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns: ['region', 'state', METRICS_PLACEHOLDER],
          metrics,
          startCollapsed: false,
          initialDepth: 2,
          stickyHeaders: true,
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={['region', 'state']}
      />,
    );

    const headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    expect(headerRows.length).toBeGreaterThan(1);

    await waitFor(() => {
      const row1Cell = headerRows[1].querySelector('th') as HTMLElement;
      expect(row1Cell).toHaveStyle({ top: '20px' });
    });

    getBoundingClientRectSpy.mockRestore();
  });

  it('renders row metric totals as grand-total rows with grand-total indentation', () => {
    const rowMetrics = ['sum__num', 'count'];
    const detailTree = buildTreeFromRecords(
      [
        {
          name: 'A',
          sum__num: 10,
          count: 2,
        },
      ],
      rowMetrics,
      ['name'],
      [],
      1,
      0,
    );
    const totalTree = buildTreeFromRecords(
      [
        {
          sum__num: 10,
          count: 2,
        },
      ],
      rowMetrics,
      ['name'],
      [],
      0,
      0,
    );
    const treeWithMetricsOnRows = applyMetricAxis(
      mergeTrees(detailTree, totalTree),
      rowMetrics,
      MetricsLayoutEnum.ROWS,
      ['name'],
      [],
      1,
      {
        sum__num: 'sum__num',
        count: 'count',
      },
    );

    const { container } = render(
      <PivotTableChart
        data={treeWithMetricsOnRows}
        formData={buildFormData({
          groupbyRows: ['name', METRICS_PLACEHOLDER],
          groupbyColumns: [],
          metrics: rowMetrics,
          metricsLayout: MetricsLayoutEnum.ROWS,
          colTotals: true,
          colTotalPosition: 'start',
          stickyHeaders: true,
          metricLabelMap: {
            sum__num: 'sum__num',
            count: 'count',
          },
          verboseMap: {
            count: 'COUNT(*)',
          },
        })}
        metrics={rowMetrics}
        groupbyRows={['name']}
        groupbyColumns={[]}
        colTotals
        colTotalPosition="start"
      />,
    );

    const tbody = container.querySelector('tbody') as HTMLElement;
    expect(within(tbody).queryByText('Grand total')).not.toBeInTheDocument();

    const assertMetricTotalRow = (label: string) => {
      const row = within(tbody)
        .getByText(label)
        .closest('tr') as HTMLTableRowElement;
      expect(row).toHaveClass('pivot-grand-total-row');
      expect(row).toHaveClass('pivot-grand-total-row--top');
      const headerCell = within(row)
        .getByText(label)
        .closest('div') as HTMLElement;
      expect(Number.parseInt(headerCell.style.paddingLeft || '0', 10)).toBe(0);
      return row;
    };

    const firstTotalRow = assertMetricTotalRow('Total sum__num');
    const secondTotalRow = assertMetricTotalRow('Total COUNT(*)');

    return waitFor(() => {
      expect(
        firstTotalRow.style.getPropertyValue('--pivot-grand-total-offset'),
      ).toBe('0px');
      expect(
        secondTotalRow.style.getPropertyValue('--pivot-grand-total-offset'),
      ).toBe('28px');
    });
  });
});
