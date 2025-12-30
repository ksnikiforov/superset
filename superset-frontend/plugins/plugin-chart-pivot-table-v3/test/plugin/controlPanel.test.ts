/*
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

import controlPanel from '../../src/controlPanel';

const getControl = (name: string) =>
  controlPanel.controlPanelSections
    .flatMap(section => section.controlSetRows)
    .flatMap(row => row)
    .find(
      control => typeof control === 'object' && control?.name === name,
    ) as any;

describe('pivot table v3 control panel', () => {
  it('builds column subtotal options based on column depth and clamps selections', () => {
    const colSubtotalControl = getControl('colSubtotalLevels');
    const result = colSubtotalControl.config.mapStateToProps({
      controls: {
        groupbyRows: { value: ['row1'] },
        groupbyColumns: { value: ['col1', 'col2', 'col3'] },
        metrics: { value: ['metric1'] },
        colSubtotalLevels: { value: [1, 3, 5, 0] },
      },
    });
    expect(result.options.map((opt: any) => opt.value)).toEqual([1, 2]);
    expect(result.value).toEqual([1]);
  });

  it('returns empty options when there are no column levels', () => {
    const colSubtotalControl = getControl('colSubtotalLevels');
    const result = colSubtotalControl.config.mapStateToProps({
      controls: {
        groupbyRows: { value: ['row1'] },
        groupbyColumns: { value: [] },
        metrics: { value: ['metric1'] },
        colSubtotalLevels: { value: [1, 2] },
      },
    });
    expect(result.options).toEqual([]);
    expect(result.value).toEqual([]);
  });
});