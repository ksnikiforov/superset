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
import exportPivotV3Excel, {
  exportPivotV3ExcelForChart,
  exportPivotV3ExcelFromSheetData,
} from 'src/utils/exportPivotV3Excel';
import {
  registerPivotV3ExportSheetData,
  registerPivotV3ExportSheetDataForChart,
} from '../../../plugins/plugin-chart-pivot-table-v3/src/export/buildPivotV3ExportTable';

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
      <table class="pivot-v3-table">
        <thead>
          <tr>
            <th>Rows</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>West</th>
            <td>42.50</td>
          </tr>
        </tbody>
      </table>
    `;
    const table = document.querySelector<HTMLTableElement>('.pivot-v3-table');
    if (!table) {
      throw new Error('Expected pivot table');
    }
    registerPivotV3ExportSheetData(table, [
      [
        { value: 'Region', type: 'string', isHeader: true },
        { value: 'Revenue', type: 'string', isHeader: true },
      ],
      [
        { value: 'West', type: 'string', isHeader: true },
        { value: 42.5, type: 'number', isHeader: false },
      ],
    ]);

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

  it('writes a workbook directly from worksheet data without reading the DOM', () => {
    exportPivotV3ExcelFromSheetData(
      [
        [{ value: 'Revenue', type: 'string', isHeader: true }],
        [{ value: 42.5, type: 'number', isHeader: false }],
      ],
      'direct-export',
    );

    expect(utils.table_to_book).not.toHaveBeenCalled();
    expect(utils.aoa_to_sheet).toHaveBeenCalledWith([
      ['Revenue'],
      [{ t: 'n', v: 42.5 }],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      { workbook: true },
      'direct-export.xlsx',
    );
  });

  it('exports worksheet data registered for a chart without reading the DOM', () => {
    registerPivotV3ExportSheetDataForChart(371, [
      [{ value: 'Revenue', type: 'string', isHeader: true }],
      [{ value: 84, type: 'number', isHeader: false }],
    ]);

    exportPivotV3ExcelForChart(371, 'chart-export');

    expect(utils.table_to_book).not.toHaveBeenCalled();
    expect(utils.aoa_to_sheet).toHaveBeenCalledWith([
      ['Revenue'],
      [{ t: 'n', v: 84 }],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      { workbook: true },
      'chart-export.xlsx',
    );
  });

  it('does not export an unregistered pivot table', () => {
    document.body.innerHTML = '<table class="pivot-v3-table" />';

    exportPivotV3Excel('.pivot-v3-table', 'missing-model');

    expect(utils.aoa_to_sheet).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('uses registered worksheet data instead of reading rendered table metadata', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table">
        <thead>
          <tr>
            <th>Stale DOM</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Ignored</td>
          </tr>
        </tbody>
      </table>
    `;
    const table = document.querySelector<HTMLTableElement>('.pivot-v3-table');
    if (!table) {
      throw new Error('Expected pivot table');
    }
    registerPivotV3ExportSheetData(table, [
      [{ value: 'Registered', type: 'string', isHeader: true }],
      [{ value: 7, type: 'number', isHeader: false }],
    ]);

    exportPivotV3Excel('.pivot-v3-table', 'registered-export');

    expect(utils.aoa_to_sheet).toHaveBeenCalledWith([
      ['Registered'],
      [{ t: 'n', v: 7 }],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      { workbook: true },
      'registered-export.xlsx',
    );
  });
});
