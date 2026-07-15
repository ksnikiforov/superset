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
import {
  exportPivotV3ExcelForChart,
  exportPivotV3ExcelFromSheetData,
} from 'src/utils/exportPivotV3Excel';
import { registerPivotV3ExportSheetDataForChart } from '../../../plugins/plugin-chart-pivot-table-v3/src/export/buildPivotV3ExportTable';

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

  test('writes a workbook directly from worksheet data without reading the DOM', () => {
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

  test('exports worksheet data registered for a chart without reading the DOM', () => {
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

  test('exports worksheet data registered for unsaved Explore charts', () => {
    registerPivotV3ExportSheetDataForChart(0, [
      [{ value: 'Registered', type: 'string', isHeader: true }],
      [{ value: 7, type: 'number', isHeader: false }],
    ]);

    exportPivotV3ExcelForChart(0, 'registered-export');

    expect(utils.aoa_to_sheet).toHaveBeenCalledWith([
      ['Registered'],
      [{ t: 'n', v: 7 }],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      { workbook: true },
      'registered-export.xlsx',
    );
  });

  test('writes worksheet merges from pivot header spans', () => {
    exportPivotV3ExcelFromSheetData(
      [
        [
          {
            value: 'Rows',
            type: 'string',
            isHeader: true,
            rowSpan: 2,
          },
          {
            value: '2025',
            type: 'string',
            isHeader: true,
            colSpan: 2,
          },
          { value: '', type: 'string', isHeader: true },
        ],
        [
          { value: '', type: 'string', isHeader: true },
          { value: 'Sales', type: 'string', isHeader: true },
          { value: 'Profit', type: 'string', isHeader: true },
        ],
      ],
      'merged-export',
    );

    expect(utils.book_new).toHaveBeenCalledWith(
      {
        worksheet: true,
        '!merges': [
          { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
          { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
        ],
      },
      'Sheet1',
    );
  });
});
