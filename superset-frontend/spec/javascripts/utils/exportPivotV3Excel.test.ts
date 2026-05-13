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
import { utils, writeFile } from 'xlsx';
import exportPivotV3Excel from 'src/utils/exportPivotV3Excel';

jest.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: jest.fn(() => ({ worksheet: true })),
    book_new: jest.fn(() => ({ workbook: true })),
    table_to_book: jest.fn(),
  },
  writeFile: jest.fn(),
}));

describe('exportPivotV3Excel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('builds the workbook from the pivot v3 worksheet model', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["Region"]' data-pivot-row-depth-count="1">
        <thead>
          <tr>
            <th>Rows</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          <tr data-pivot-row-export-values='["West"]'>
            <th>West</th>
            <td data-pivot-export-type="number" data-pivot-export-value="42.5">42.50</td>
          </tr>
        </tbody>
      </table>
    `;

    exportPivotV3Excel('.pivot-v3-table', 'pivot-export');

    expect(utils.table_to_book).not.toHaveBeenCalled();
    expect(utils.aoa_to_sheet).toHaveBeenCalledWith([
      ['Region', 'Revenue'],
      ['West', { t: 'n', v: 42.5 }],
    ]);
    expect(utils.book_new).toHaveBeenCalledWith({ worksheet: true }, 'Sheet1');
    expect(writeFile).toHaveBeenCalledWith(
      { workbook: true },
      'pivot-export.xlsx',
    );
  });
});
