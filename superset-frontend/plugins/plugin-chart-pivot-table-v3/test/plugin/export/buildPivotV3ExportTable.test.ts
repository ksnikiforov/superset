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

import { buildPivotV3ExportTable } from '../../../src/export/buildPivotV3ExportTable';

describe('buildPivotV3ExportTable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('splits row hierarchy into columns using row axis labels', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["Region","City"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Metric</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>West</span>
              </div>
            </th>
            <td>10</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>San Francisco</span>
              </div>
            </th>
            <td>5</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const headerCells = Array.from(exported.tHead?.rows[0].cells ?? []).map(
      cell => cell.textContent?.trim(),
    );
    expect(headerCells).toEqual(['Region', 'City', 'Metric']);

    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );
    expect(bodyRows[0]).toEqual(['West', '', '10']);
    expect(bodyRows[1]).toEqual(['West', 'San Francisco', '5']);

    const originalHeaderCells = Array.from(
      original.tHead?.rows[0].cells ?? [],
    ).map(cell => cell.textContent?.trim());
    expect(originalHeaderCells).toEqual(['Rows', 'Metric']);
  });

  it('falls back to generated row labels when axis labels are missing', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table">
        <thead>
          <tr>
            <th>Rows</th>
            <th>Metric</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>West</span>
              </div>
            </th>
            <td>10</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>San Francisco</span>
              </div>
            </th>
            <td>5</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const headerCells = Array.from(exported.tHead?.rows[0].cells ?? []).map(
      cell => cell.textContent?.trim(),
    );
    expect(headerCells).toEqual(['Row 1', 'Row 2', 'Metric']);
  });

  it('does not create extra row header columns for a single row level', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["resellerName"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Sales</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>A Bike Store</span>
              </div>
            </th>
            <td>10</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const headerCells = Array.from(exported.tHead?.rows[0].cells ?? []).map(
      cell => cell.textContent?.trim(),
    );
    const rowCells = Array.from(exported.tBodies[0].rows[0].cells).map(cell =>
      cell.textContent?.trim(),
    );

    expect(headerCells).toEqual(['resellerName', 'Sales']);
    expect(rowCells).toEqual(['A Bike Store', '10']);
  });

  it('uses semantic depth markers to keep row labels in correct columns', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["productModel","productColor","productName"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Sales</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Road-250</span>
              </div>
            </th>
            <td>100</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Red</span>
              </div>
            </th>
            <td>40</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="2">
                <span data-pivot-row-label>Road-250 Red, 58</span>
              </div>
            </th>
            <td>20</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );

    expect(bodyRows[0]).toEqual(['Road-250', '', '', '100']);
    expect(bodyRows[1]).toEqual(['Road-250', 'Red', '', '40']);
    expect(bodyRows[2]).toEqual(['Road-250', 'Red', 'Road-250 Red, 58', '20']);
  });

  it('keeps grand total isolated with semantic depth markers', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["productModel","productColor","productName"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Sales</th>
          </tr>
        </thead>
        <tbody>
          <tr class="pivot-grand-total-row pivot-grand-total-row--top">
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Grand Total</span>
              </div>
            </th>
            <td>1000</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Road-250</span>
              </div>
            </th>
            <td>500</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Red</span>
              </div>
            </th>
            <td>300</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="2">
                <span data-pivot-row-label>Road-250 Red, 58</span>
              </div>
            </th>
            <td>100</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );

    expect(bodyRows[0]).toEqual(['Grand Total', '', '', '1000']);
    expect(bodyRows[1]).toEqual(['Road-250', '', '', '500']);
    expect(bodyRows[2]).toEqual(['Road-250', 'Red', '', '300']);
    expect(bodyRows[3]).toEqual(['Road-250', 'Red', 'Road-250 Red, 58', '100']);
  });

  it('keeps subtotal rows aligned with semantic depth markers', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["productColor","productModel","productName"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Sales</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th class="subtotal-cell">
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>(NULL)</span>
              </div>
            </th>
            <td>100</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Blue</span>
              </div>
            </th>
            <td>80</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Classic Vest</span>
              </div>
            </th>
            <td>30</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );

    expect(bodyRows[0]).toEqual(['(NULL)', '', '100']);
    expect(bodyRows[1]).toEqual(['Blue', '', '80']);
    expect(bodyRows[2]).toEqual(['Blue', 'Classic Vest', '30']);
  });

  it('keeps alignment when subtotal rows are placed at the bottom', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["productModel","productColor","productName"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Sales</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Road-250</span>
              </div>
            </th>
            <td>900</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Red</span>
              </div>
            </th>
            <td>400</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="2">
                <span data-pivot-row-label>Road-250 Red, 58</span>
              </div>
            </th>
            <td>100</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="2">
                <span data-pivot-row-label>Road-250 Red, 44</span>
              </div>
            </th>
            <td>120</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Subtotal</span>
              </div>
            </th>
            <td>220</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Black</span>
              </div>
            </th>
            <td>500</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );

    expect(bodyRows[0]).toEqual(['Road-250', '', '', '900']);
    expect(bodyRows[1]).toEqual(['Road-250', 'Red', '', '400']);
    expect(bodyRows[2]).toEqual(['Road-250', 'Red', 'Road-250 Red, 58', '100']);
    expect(bodyRows[3]).toEqual(['Road-250', 'Red', 'Road-250 Red, 44', '120']);
    expect(bodyRows[4]).toEqual(['Road-250', 'Subtotal', '', '220']);
    expect(bodyRows[5]).toEqual(['Road-250', 'Black', '', '500']);
  });

  it('keeps top grand total isolated and aligns partial expansions', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["productColor","productModel","productName"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Sales</th>
          </tr>
        </thead>
        <tbody>
          <tr class="pivot-grand-total-row pivot-grand-total-row--top">
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Grand total</span>
              </div>
            </th>
            <td>999</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Blue</span>
              </div>
            </th>
            <td>500</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Classic Vest</span>
              </div>
            </th>
            <td>120</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );

    expect(bodyRows[0]).toEqual(['Grand total', '', '999']);
    expect(bodyRows[1]).toEqual(['Blue', '', '500']);
    expect(bodyRows[2]).toEqual(['Blue', 'Classic Vest', '120']);
  });

  it('keeps alignment with multi-level column headers and grand total rows', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["Region","City"]'>
        <thead>
          <tr>
            <th rowspan="2">Rows</th>
            <th colspan="2">2025</th>
            <th colspan="2">Grand Total</th>
          </tr>
          <tr>
            <th>Sales</th>
            <th>Profit</th>
            <th>Sales</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>West</span>
              </div>
            </th>
            <td>10</td>
            <td>1</td>
            <td>20</td>
            <td>2</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>San Francisco</span>
              </div>
            </th>
            <td>5</td>
            <td>0.5</td>
            <td>8</td>
            <td>0.8</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Grand Total</span>
              </div>
            </th>
            <td>15</td>
            <td>1.5</td>
            <td>28</td>
            <td>2.8</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const topHeaderCells = Array.from(exported.tHead?.rows[0].cells ?? []).map(
      cell => cell.textContent?.trim(),
    );
    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );

    expect(topHeaderCells).toEqual(['Region', 'City', '2025', 'Grand Total']);
    expect(bodyRows[0]).toEqual(['West', '', '10', '1', '20', '2']);
    expect(bodyRows[1]).toEqual([
      'West',
      'San Francisco',
      '5',
      '0.5',
      '8',
      '0.8',
    ]);
    expect(bodyRows[2]).toEqual(['Grand Total', '', '15', '1.5', '28', '2.8']);
    expect(bodyRows[0]).toHaveLength(6);
    expect(bodyRows[1]).toHaveLength(6);
    expect(bodyRows[2]).toHaveLength(6);
  });

  it('exports numeric-marked cells as raw numeric values for Excel typing', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["Region"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>West</span>
              </div>
            </th>
            <td data-pivot-export-type="number" data-pivot-export-value="1234.567890123456">1,234.57</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);
    const numericCell = exported.tBodies[0].rows[0].cells[1];

    expect(numericCell.textContent?.trim()).toBe('1234.567890123456');
    expect(numericCell.dataset.t).toBe('n');
    expect(numericCell.dataset.v).toBe('1234.567890123456');
  });

  it('exports only visible row levels and adds Total label for subtotal rows', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["resellerName","productModel","productName"]'>
        <thead>
          <tr>
            <th>Rows</th>
            <th>Продажи в деньгах</th>
            <th>Продажи в шт</th>
          </tr>
        </thead>
        <tbody>
          <tr class="pivot-grand-total-row pivot-grand-total-row--top">
            <th class="subtotal-cell">
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Grand total</span>
              </div>
            </th>
            <td>110336782.1</td>
            <td>274776</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>[Not Applicable]</span>
              </div>
            </th>
            <td>29358677.22</td>
            <td>60398</td>
          </tr>
          <tr>
            <th class="subtotal-cell">
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>A Bike Store</span>
              </div>
            </th>
            <td>85177.0812</td>
            <td>121</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>LL Road Frame</span>
              </div>
            </th>
            <td>2737.6434</td>
            <td>15</td>
          </tr>
          <tr>
            <th class="subtotal-cell">
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>A Great Bicycle Company</span>
              </div>
            </th>
            <td>9055.2903</td>
            <td>21</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);

    const headerCells = Array.from(exported.tHead?.rows[0].cells ?? []).map(
      cell => cell.textContent?.trim(),
    );
    const bodyRows = Array.from(exported.tBodies[0].rows).map(row =>
      Array.from(row.cells).map(cell => cell.textContent?.trim() ?? ''),
    );

    expect(headerCells).toEqual([
      'resellerName',
      'productModel',
      'Продажи в деньгах',
      'Продажи в шт',
    ]);
    expect(bodyRows[0]).toEqual(['Grand total', '', '110336782.1', '274776']);
    expect(bodyRows[1]).toEqual([
      '[Not Applicable]',
      '',
      '29358677.22',
      '60398',
    ]);
    expect(bodyRows[2]).toEqual(['A Bike Store', 'Total', '85177.0812', '121']);
    expect(bodyRows[3]).toEqual([
      'A Bike Store',
      'LL Road Frame',
      '2737.6434',
      '15',
    ]);
    expect(bodyRows[4]).toEqual([
      'A Great Bicycle Company',
      '',
      '9055.2903',
      '21',
    ]);
  });

  it('uses header cells for grand total and subtotal values so Excel can render totals in bold', () => {
    document.body.innerHTML = `
      <table class="pivot-v3-table" data-pivot-row-axis-labels='["resellerName","productModel"]' data-pivot-row-total-label="Total">
        <thead>
          <tr>
            <th>Rows</th>
            <th>Sales</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          <tr class="pivot-grand-total-row pivot-grand-total-row--top">
            <th class="subtotal-cell">
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>Grand total</span>
              </div>
            </th>
            <td data-pivot-export-type="number" data-pivot-export-value="1000">1,000</td>
            <td data-pivot-export-type="number" data-pivot-export-value="10">10</td>
          </tr>
          <tr>
            <th class="subtotal-cell">
              <div data-pivot-row-depth="0">
                <span data-pivot-row-label>A Bike Store</span>
              </div>
            </th>
            <td data-pivot-export-type="number" data-pivot-export-value="100">100</td>
            <td data-pivot-export-type="number" data-pivot-export-value="1">1</td>
          </tr>
          <tr>
            <th>
              <div data-pivot-row-depth="1">
                <span data-pivot-row-label>Road-150</span>
              </div>
            </th>
            <td data-pivot-export-type="number" data-pivot-export-value="60">60</td>
            <td data-pivot-export-type="number" data-pivot-export-value="1">1</td>
          </tr>
        </tbody>
      </table>
    `;

    const original = document.querySelector('table') as HTMLTableElement;
    const exported = buildPivotV3ExportTable(original);
    const grandTotalRow = exported.tBodies[0].rows[0];
    const subtotalRow = exported.tBodies[0].rows[1];

    expect(grandTotalRow.cells[0].tagName).toBe('TH');
    expect(grandTotalRow.cells[1].tagName).toBe('TH');
    expect(grandTotalRow.cells[2].tagName).toBe('TH');
    expect(grandTotalRow.cells[2].dataset.t).toBe('n');
    expect(grandTotalRow.cells[2].dataset.v).toBe('1000');

    expect(subtotalRow.cells[0].tagName).toBe('TH');
    expect(subtotalRow.cells[1].textContent?.trim()).toBe('Total');
    expect(subtotalRow.cells[1].tagName).toBe('TH');
    expect(subtotalRow.cells[2].tagName).toBe('TH');
    expect(subtotalRow.cells[2].dataset.t).toBe('n');
    expect(subtotalRow.cells[2].dataset.v).toBe('100');
  });
});
