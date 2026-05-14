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

import { utils, writeFile, type CellObject } from 'xlsx';
import {
  getPivotV3ExportSheetDataForChart,
  type PivotV3ExportSheetCell,
} from '../../plugins/plugin-chart-pivot-table-v3/src/export/buildPivotV3ExportTable';

const toSheetCell = (
  cell: PivotV3ExportSheetCell,
): string | number | CellObject => {
  if (cell.type === 'number') {
    return {
      t: 'n',
      v: cell.value,
    };
  }
  return cell.value;
};

export function exportPivotV3ExcelFromSheetData(
  sheetData: PivotV3ExportSheetCell[][],
  fileName: string,
) {
  const worksheet = utils.aoa_to_sheet(
    sheetData.map(row => row.map(toSheetCell)),
  );
  const workbook = utils.book_new(worksheet, 'Sheet1');
  writeFile(workbook, `${fileName}.xlsx`);
}

export function exportPivotV3ExcelForChart(
  chartId: string | number,
  fileName: string,
) {
  const sheetData = getPivotV3ExportSheetDataForChart(chartId);
  if (!sheetData) {
    return;
  }
  exportPivotV3ExcelFromSheetData(sheetData, fileName);
}
