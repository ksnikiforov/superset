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
import { PivotRuntimeLayout } from '../../../../src/types';
import {
  applyDimensionDrag,
  applyValueDrag,
} from '../../../../src/pivot/layout/interactionDrag';

const baseLayout = (overrides: Partial<PivotRuntimeLayout> = {}) =>
  ({
    version: 1,
    rows: [],
    cols: [],
    metrics: ['m1'],
    leafSelection: {},
    valuePlacement: { axis: 'row', index: 0 },
    ...overrides,
  }) as PivotRuntimeLayout;

describe('interaction drag layout helpers', () => {
  it('inserts a new dimension before the value chip by default', () => {
    const layout = baseLayout({
      rows: ['a', 'b'],
      valuePlacement: { axis: 'row', index: 1 },
    });
    const next = applyDimensionDrag(layout, {
      dimensionKey: 'c',
      targetAxis: 'row',
      metricsAvailable: true,
    });
    expect(next.rows).toEqual(['a', 'c', 'b']);
    expect(next.valuePlacement).toEqual({ axis: 'row', index: 2 });
  });

  it('allows dropping a dimension after the last chip when value is first', () => {
    const layout = baseLayout({
      cols: ['c1'],
      valuePlacement: { axis: 'col', index: 0 },
    });
    const next = applyDimensionDrag(layout, {
      dimensionKey: 'c2',
      targetAxis: 'col',
      targetChipIndex: 2,
      metricsAvailable: true,
    });
    expect(next.cols).toEqual(['c1', 'c2']);
    expect(next.valuePlacement).toEqual({ axis: 'col', index: 0 });
  });

  it('inserts before the value chip when dropped on it', () => {
    const layout = baseLayout({
      rows: ['a', 'b'],
      valuePlacement: { axis: 'row', index: 1 },
    });
    const next = applyDimensionDrag(layout, {
      dimensionKey: 'c',
      targetAxis: 'row',
      targetChipIndex: 1,
      insertBeforeValue: true,
      metricsAvailable: true,
    });
    expect(next.rows).toEqual(['a', 'c', 'b']);
    expect(next.valuePlacement).toEqual({ axis: 'row', index: 2 });
  });

  it('keeps value last when inserting by default at the end', () => {
    const layout = baseLayout({
      rows: ['a'],
      valuePlacement: { axis: 'row', index: 1 },
    });
    const next = applyDimensionDrag(layout, {
      dimensionKey: 'b',
      targetAxis: 'row',
      metricsAvailable: true,
    });
    expect(next.rows).toEqual(['a', 'b']);
    expect(next.valuePlacement).toEqual({ axis: 'row', index: 2 });
  });

  it('allows explicitly dropping a dimension after value', () => {
    const layout = baseLayout({
      rows: ['a', 'b'],
      valuePlacement: { axis: 'row', index: 2 },
    });
    const next = applyDimensionDrag(layout, {
      dimensionKey: 'a',
      targetAxis: 'row',
      targetChipIndex: 3,
      sourceAxis: 'row',
      sourceChipIndex: 0,
      metricsAvailable: true,
    });
    expect(next.rows).toEqual(['b', 'a']);
    expect(next.valuePlacement).toEqual({ axis: 'row', index: 1 });
  });

  it('moves value placement across axes at the requested index', () => {
    const layout = baseLayout({
      rows: ['a'],
      cols: ['b'],
      valuePlacement: { axis: 'col', index: 1 },
    });
    const next = applyValueDrag(layout, {
      targetAxis: 'row',
      targetChipIndex: 0,
      sourceAxis: 'col',
      sourceChipIndex: 1,
      metricsAvailable: true,
    });
    expect(next.valuePlacement).toEqual({ axis: 'row', index: 0 });
  });
});
