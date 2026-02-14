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
});
