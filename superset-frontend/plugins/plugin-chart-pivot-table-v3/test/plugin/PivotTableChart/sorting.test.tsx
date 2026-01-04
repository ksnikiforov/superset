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
import { render, screen } from '@testing-library/react';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../../../src/utils';

describe('PivotTableChart sorting', () => {
  it('sorts rows by metric totals when configured', () => {
    const metrics = ['metric1'];
    const groupbyRows = ['country'];
    const groupbyColumns: string[] = [];
    const tree = buildTreeFromRecords(
      [
        { country: 'Brazil', metric1: 10 },
        { country: 'Canada', metric1: 20 },
      ],
      metrics,
      groupbyRows,
      groupbyColumns,
      1,
      0,
    );

    render(
      <PivotTableChart
        data={tree}
        formData={buildFormData({
          groupbyRows,
          groupbyColumns,
          metrics,
          rowSorting: {
            country: { metric: 'metric1', order: 'desc', mode: 'total' },
          },
        })}
        metrics={metrics}
        groupbyRows={groupbyRows}
        groupbyColumns={groupbyColumns}
        startCollapsed={false}
        rowTotals={false}
        colTotals={false}
        rowSubTotals={false}
        colSubTotals={false}
        rowSubtotalLevels={[]}
        colSubtotalLevels={[]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        width={400}
        height={300}
        margin={0}
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
        verboseMap={{}}
      />,
    );

    const dataRows = screen.getAllByRole('row').slice(1);
    const labels = dataRows.map(row =>
      row.querySelector('th')?.textContent?.trim(),
    );
    expect(labels).toEqual(['Canada', 'Brazil']);
  });
});
