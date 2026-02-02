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
  it('returns true for row reorder within the same axis', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['state', 'country'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns true when moving a dimension across axes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country'],
      cols: ['product', 'state'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns true when appending a dimension at the end', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country', 'state', 'city'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns true when inserting a dimension in the middle', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country', 'city', 'state'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });

  it('returns true when trimming a dimension from the end', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country'],
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
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

  it('returns true when only value placement changes', () => {
    const nextLayout: PivotRuntimeLayout = {
      ...baseLayout,
      valuePlacement: { axis: 'row', index: 0 },
    };
    expect(shouldFetchForLayoutChange(baseLayout, nextLayout)).toBe(true);
  });
});
