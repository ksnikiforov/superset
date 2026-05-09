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
import { shouldFetchForLayoutChange } from '../../../../src/pivot/layout/shouldFetchForLayoutChange';
import { PivotRuntimeLayout } from '../../../../src/types';

const baseLayout: PivotRuntimeLayout = {
  version: 1,
  rows: ['country', 'state'],
  cols: ['product'],
  metrics: ['sum__sales', 'sum__profit'],
  leafSelection: { value: true },
  valuePlacement: { axis: 'col', index: 1 },
};

describe('shouldFetchForLayoutChange', () => {
  it('returns true when row reorder changes the leading row key', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['state', 'country'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns false for row reorder that does not change the leading row key', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country', 'state', 'city'],
      cols: ['product'],
      valuePlacement: { axis: 'col', index: 1 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: ['country', 'city', 'state'],
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when moving a dimension across axes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country'],
      cols: ['product', 'state'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
  });

  it('returns true when moving the leading row key across axes', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['r1'],
      cols: ['c1'],
      valuePlacement: { axis: 'row', index: 1 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: [],
      cols: ['c1', 'r1'],
      valuePlacement: { axis: 'row', index: 0 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns false when appending a dimension at the end', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country', 'state', 'city'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
  });

  it('returns true when inserting a value-axis dimension at the first position before Values', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      cols: ['col1', 'col2'],
      valuePlacement: { axis: 'col', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col0', 'col1', 'col2'],
      valuePlacement: { axis: 'col', index: 3 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns false when inserting a value-axis dimension in the middle before Values', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      cols: ['col1', 'col2'],
      valuePlacement: { axis: 'col', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1', 'colX', 'col2'],
      valuePlacement: { axis: 'col', index: 3 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when reordering non-leading value-axis dimensions before Values', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      cols: ['col1', 'col2', 'col3'],
      valuePlacement: { axis: 'col', index: 3 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1', 'col3', 'col2'],
      valuePlacement: { axis: 'col', index: 3 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns true when reordering changes the leading value-axis dimension', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      cols: ['col1', 'col2', 'col3'],
      valuePlacement: { axis: 'col', index: 3 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col2', 'col1', 'col3'],
      valuePlacement: { axis: 'col', index: 3 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns false when only appending at the end of value-axis stack before trailing Values', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      cols: ['col1', 'col2'],
      valuePlacement: { axis: 'col', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1', 'col2', 'col3'],
      valuePlacement: { axis: 'col', index: 3 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when inserting a dimension in the middle', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country', 'city', 'state'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
  });

  it('returns false when trimming a dimension from the end', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
  });

  it('returns true when removing the leading non-value row dimension while keeping another row dimension', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1', 'row2'],
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: ['row2'],
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns true when adding the first non-value row dimension from totals state', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: [],
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: ['row2'],
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns true when adding the first non-value column dimension after leading Values while rows stay stable', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1', 'row2'],
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 0 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns true when adding the first non-value column dimension before trailing Values while rows stay stable', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1', 'row2'],
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 1 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns true when adding the first non-value column dimension from values-only layout', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: [],
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 1 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(true);
  });

  it('returns false when removing the only column dimension before trailing Values with multiple metrics', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1'],
      metrics: ['m1', 'm2'],
      valuePlacement: { axis: 'col', index: 1 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when removing the only column dimension after leading Values with multiple metrics', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1'],
      metrics: ['m1', 'm2'],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when removing the only column dimension before trailing Values with a single metric', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1'],
      metrics: ['m1'],
      valuePlacement: { axis: 'col', index: 1 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when removing the only row dimension before trailing Values with multiple metrics', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1'],
      metrics: ['m1', 'm2'],
      valuePlacement: { axis: 'row', index: 1 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: [],
      valuePlacement: { axis: 'row', index: 0 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when removing the only row dimension after leading Values with multiple metrics', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1'],
      metrics: ['m1', 'm2'],
      valuePlacement: { axis: 'row', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: [],
      valuePlacement: { axis: 'row', index: 0 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when removing the only row dimension with a single metric', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1'],
      metrics: ['m1'],
      valuePlacement: { axis: 'row', index: 1 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: [],
      valuePlacement: { axis: 'row', index: 0 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when shrinking the column value axis from two dimensions to one with multiple metrics', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1', 'col2'],
      metrics: ['m1', 'm2'],
      valuePlacement: { axis: 'col', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 1 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when shrinking the leading-value column axis from two dimensions to one with multiple metrics', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1', 'col2'],
      metrics: ['m1', 'm2'],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 0 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when shrinking the column value axis from two dimensions to one with a single metric', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1'],
      cols: ['col1', 'col2'],
      metrics: ['m1'],
      valuePlacement: { axis: 'col', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 1 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when shrinking the row value axis from two dimensions to one with multiple metrics', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1', 'row2'],
      cols: ['col1'],
      metrics: ['m1', 'm2'],
      valuePlacement: { axis: 'row', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: ['row1'],
      valuePlacement: { axis: 'row', index: 1 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('returns false when shrinking the row value axis from two dimensions to one with a single metric', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['row1', 'row2'],
      cols: ['col1'],
      metrics: ['m1'],
      valuePlacement: { axis: 'row', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: ['row1'],
      valuePlacement: { axis: 'row', index: 1 },
    };

    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });

  it('follows first-on-stack fetch semantics across a multistep row layout sequence', () => {
    const layout0: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['name'],
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const layout1: PivotRuntimeLayout = {
      ...layout0,
      rows: [],
    };
    const layout2: PivotRuntimeLayout = {
      ...layout1,
      rows: ['state'],
    };
    const layout3: PivotRuntimeLayout = {
      ...layout2,
      rows: ['state', 'city'],
    };
    const layout4: PivotRuntimeLayout = {
      ...layout3,
      rows: ['city', 'state'],
    };
    const layout5: PivotRuntimeLayout = {
      ...layout4,
      rows: ['city'],
    };
    const layout6: PivotRuntimeLayout = {
      ...layout5,
      rows: ['state'],
    };

    expect(shouldFetchForLayoutChange(layout0, layout1)).toBe(false);
    expect(shouldFetchForLayoutChange(layout1, layout2)).toBe(true);
    expect(shouldFetchForLayoutChange(layout2, layout3)).toBe(false);
    expect(shouldFetchForLayoutChange(layout3, layout4)).toBe(true);
    expect(shouldFetchForLayoutChange(layout4, layout5)).toBe(false);
    expect(shouldFetchForLayoutChange(layout5, layout6)).toBe(true);
  });

  it('returns true when metrics selection changes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      metrics: ['sum__sales'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns true when leaf selection changes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      leafSelection: { value: true, ix: true },
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns false when only leaf order changes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      leafOrder: ['ix', 'value'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
  });

  it('returns true when value placement axis changes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      valuePlacement: { axis: 'row', index: 0 },
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns true when value placement index changes on a populated axis', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      valuePlacement: { axis: 'col', index: 0 },
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns false when value placement index changes on an empty axis', () => {
    const prevLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: [],
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      valuePlacement: { axis: 'col', index: 1 },
    };
    expect(shouldFetchForLayoutChange(prevLayout, nextLayout)).toBe(false);
  });
});
