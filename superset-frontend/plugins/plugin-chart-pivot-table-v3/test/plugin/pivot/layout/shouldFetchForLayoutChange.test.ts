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
  it('returns false for row reorder within the same axis', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['state', 'country'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
  });

  it('returns false when moving a dimension across axes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country'],
      cols: ['product', 'state'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
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

  it('returns false when only value placement index changes on same axis', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      valuePlacement: { axis: 'col', index: 0 },
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(false);
  });
});
