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

import React from 'react';
import { render, within } from '@testing-library/react';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../../../src/utils';

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
          rowTotals: true,
          rowTotalPosition: 'start',
          stickyHeaders: true,
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        rowTotals
        rowTotalPosition="start"
        stickyHeaders
      />,
    );

    const table = container.querySelector('table') as HTMLElement;
    expect(table.getAttribute('data-sticky-headers')).toBe('true');

    const tbody = container.querySelector('tbody') as HTMLElement;
    const totalRow = within(tbody).getByText('Grand total')
      .closest('tr') as HTMLElement;
    expect(totalRow.classList.contains('pivot-grand-total-row')).toBe(true);
    expect(totalRow.classList.contains('pivot-grand-total-row--top')).toBe(true);
  });

  it('allows sticky headers to be disabled', () => {
    const { container } = render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          rowTotals: true,
          rowTotalPosition: 'end',
          stickyHeaders: false,
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        rowTotals
        rowTotalPosition="end"
        stickyHeaders={false}
      />,
    );

    const table = container.querySelector('table') as HTMLElement;
    expect(table.getAttribute('data-sticky-headers')).toBe('false');

    const tbody = container.querySelector('tbody') as HTMLElement;
    const totalRow = within(tbody).getByText('Grand total')
      .closest('tr') as HTMLElement;
    expect(totalRow.classList.contains('pivot-grand-total-row')).toBe(true);
    expect(totalRow.classList.contains('pivot-grand-total-row--bottom')).toBe(true);
  });
});
