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

import {
  ControlPanelState,
  ControlState,
  CustomControlItem,
  isCustomControlItem,
} from '@superset-ui/chart-controls';
import controlPanel from '../../src/controlPanel';

type SubtotalOption = { value: number; label: string };

const getControl = (name: string) => {
  const control = controlPanel.controlPanelSections
    .flatMap(section => (section ? section.controlSetRows : []))
    .flatMap(row => row)
    .find(
      (controlItem): controlItem is CustomControlItem =>
        isCustomControlItem(controlItem) && controlItem.name === name,
    );

  if (!control) {
    throw new Error(`Control ${name} not found`);
  }

  return control;
};

describe('pivot table v3 control panel', () => {
  it('exposes auto-expand level controls with blank defaults', () => {
    const expandRowsLevelControl = getControl('expandRowsLevel');
    const expandColumnsLevelControl = getControl('expandColumnsLevel');

    expect(expandRowsLevelControl).toBeDefined();
    expect(expandRowsLevelControl.config.default).toBeUndefined();
    expect(expandRowsLevelControl.config.placeholder).toBe('0');
    expect(expandRowsLevelControl.config.mapStateToProps).toBeUndefined();
    expect(expandColumnsLevelControl).toBeDefined();
    expect(expandColumnsLevelControl.config.default).toBeUndefined();
    expect(expandColumnsLevelControl.config.placeholder).toBe('0');
    expect(expandColumnsLevelControl.config.mapStateToProps).toBeUndefined();
  });

  it('builds column subtotal options based on column depth and clamps selections', () => {
    const colSubtotalControl = getControl('colSubtotalLevels');
    const mapStateToProps = colSubtotalControl.config.mapStateToProps;
    if (!mapStateToProps) {
      throw new Error('mapStateToProps not configured for colSubtotalLevels');
    }
    const state = {
      controls: {
        groupbyRows: { value: ['row1'] },
        groupbyColumns: { value: ['col1', 'col2', 'col3'] },
        metrics: { value: ['metric1'] },
        colSubtotalLevels: { value: [1, 3, 5, 0] },
      },
    } as unknown as ControlPanelState;
    const controlState = {
      ...colSubtotalControl.config,
      name: colSubtotalControl.name,
    } as ControlState;
    const result = mapStateToProps(state, controlState) as {
      options: SubtotalOption[];
      value: number[];
    };
    expect(result.options.map(({ value }) => value)).toEqual([1, 2]);
    expect(result.value).toEqual([1]);
  });

  it('returns empty options when there are no column levels', () => {
    const colSubtotalControl = getControl('colSubtotalLevels');
    const mapStateToProps = colSubtotalControl.config.mapStateToProps;
    if (!mapStateToProps) {
      throw new Error('mapStateToProps not configured for colSubtotalLevels');
    }
    const state = {
      controls: {
        groupbyRows: { value: ['row1'] },
        groupbyColumns: { value: [] },
        metrics: { value: ['metric1'] },
        colSubtotalLevels: { value: [1, 2] },
      },
    } as unknown as ControlPanelState;
    const controlState = {
      ...colSubtotalControl.config,
      name: colSubtotalControl.name,
    } as ControlState;
    const result = mapStateToProps(state, controlState) as {
      options: SubtotalOption[];
      value: number[];
    };
    expect(result.options).toEqual([]);
    expect(result.value).toEqual([]);
  });

  it('selects all column levels when subtotals are enabled with no explicit levels', () => {
    const colSubtotalControl = getControl('colSubtotalLevels');
    const mapStateToProps = colSubtotalControl.config.mapStateToProps;
    if (!mapStateToProps) {
      throw new Error('mapStateToProps not configured for colSubtotalLevels');
    }
    const state = {
      controls: {
        groupbyColumns: { value: ['col1', 'col2', 'col3'] },
        colSubtotalLevels: { value: [] },
        colSubTotals: { value: true },
      },
    } as unknown as ControlPanelState;
    const controlState = {
      ...colSubtotalControl.config,
      name: colSubtotalControl.name,
    } as ControlState;
    const result = mapStateToProps(state, controlState) as {
      value: number[];
      enabled: boolean;
    };
    expect(result.value).toEqual([1, 2]);
    expect(result.enabled).toEqual(true);
  });
});
