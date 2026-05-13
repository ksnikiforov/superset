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
import { type QueryFormMetric } from '@superset-ui/core';
import {
  buildDatabarRuntimeModel,
  resolveScaleGroupKey,
  resolveScaleBounds,
  toPercent,
} from '../../../../src/pivot/chart/databarRuntime';
import {
  type PivotMetricDatabarMap,
  type PivotResultCell,
  type PivotTreeNode,
} from '../../../../src/types';
import { serializeCellKey } from '../../../../src/utils';

const node = (
  key: string,
  path: string[],
  overrides: Partial<PivotTreeNode> = {},
): PivotTreeNode => ({
  axis: 'row',
  key,
  path,
  label: key,
  formattedLabel: key,
  level: path.length,
  hasChildren: false,
  ...overrides,
});

const cell = (
  rowKey: string,
  colKey: string,
  values: PivotResultCell['values'],
): PivotResultCell => ({
  rowKey,
  colKey,
  values,
});

const baseParams = {
  expandedRows: new Set<string>(),
  isRowTotalAtStart: false,
  databarScaleWidth: 48,
  databarPaddingX: 8,
  themeSizeUnit: 4,
  getNodeDimDepth: (rowNode: PivotTreeNode) => rowNode.path.length,
  isExplicitSubtotalNode: () => false,
  isMetricGrandTotalNode: () => false,
  isMetricSubtotalNode: () => false,
  shouldHideRowValues: () => false,
  resolveMetricD3Format: () => undefined,
  renderValue: (_metricKey: string, value: unknown) => String(value),
};

test('resolves chained databar scale-like groups safely', () => {
  const metricDatabars: PivotMetricDatabarMap = {
    m1: { type: 'bar' },
    m2: { type: 'bar', scaleLike: 'm1' as QueryFormMetric },
    m3: { type: 'bar', scaleLike: 'm2' as QueryFormMetric },
    cycleA: { type: 'bar', scaleLike: 'cycleB' as QueryFormMetric },
    cycleB: { type: 'bar', scaleLike: 'cycleA' as QueryFormMetric },
  };

  expect(resolveScaleGroupKey('m3', metricDatabars)).toBe('m1');
  expect(resolveScaleGroupKey('cycleA', metricDatabars)).toBe('cycleA');
});

test('uses shared scale groups when computing databar scales and widths', () => {
  const rowNode = node('r1', ['North']);
  const colA = node('c1', ['m1'], { axis: 'col' });
  const colB = node('c2', ['m2'], { axis: 'col' });
  const cellA = cell('r1', 'c1', { m1: 10 });
  const cellB = cell('r1', 'c2', { m2: -30 });

  const runtime = buildDatabarRuntimeModel({
    ...baseParams,
    metricDatabars: {
      m1: { type: 'bar' },
      m2: { type: 'bar', scaleLike: 'm1' as QueryFormMetric },
    },
    metricsForScale: new Set(['m1', 'm2']),
    visibleRows: [rowNode],
    visibleCols: [colA, colB],
    visibleCells: [
      {
        cellKey: serializeCellKey('r1', 'c1'),
        rowNode,
        colNode: colA,
        cell: cellA,
      },
      {
        cellKey: serializeCellKey('r1', 'c2'),
        rowNode,
        colNode: colB,
        cell: cellB,
      },
    ],
    cells: {
      [serializeCellKey('r1', 'c1')]: cellA,
      [serializeCellKey('r1', 'c2')]: cellB,
    },
    deriveMetricKey: (_rowNode, colNode) => colNode.path[0] as string,
  });

  expect(runtime.databarScales.get('m1')).toEqual({ min: -30, max: 10 });
  expect(runtime.databarLabelSpaces.get('m1')).toEqual({
    positive: 20.8,
    negative: 27.200000000000003,
  });
  expect(runtime.databarColumnMinWidths.get('c1')).toBeCloseTo(112);
  expect(runtime.databarColumnMinWidths.get('c2')).toBeCloseTo(112);
});

test('computes waterfall offsets and bridge connector anchors', () => {
  const parent = node('parent', ['A'], { hasChildren: true });
  const spacer = node('spacer', ['A', 'spacer']);
  const sibling = node('sibling', ['B']);
  const colNode = node('c1', ['waterfall'], { axis: 'col' });
  const parentCell = cell('parent', 'c1', { waterfall: 10 });
  const siblingCell = cell('sibling', 'c1', { waterfall: 5 });
  const parentKey = serializeCellKey('parent', 'c1');
  const spacerKey = serializeCellKey('spacer', 'c1');
  const siblingKey = serializeCellKey('sibling', 'c1');

  const runtime = buildDatabarRuntimeModel({
    ...baseParams,
    expandedRows: new Set(['parent']),
    metricDatabars: {
      waterfall: { type: 'waterfall' },
    },
    metricsForScale: new Set(['waterfall']),
    visibleRows: [parent, spacer, sibling],
    visibleCols: [colNode],
    visibleCells: [
      { cellKey: parentKey, rowNode: parent, colNode, cell: parentCell },
      { cellKey: siblingKey, rowNode: sibling, colNode, cell: siblingCell },
    ],
    cells: {
      [parentKey]: parentCell,
      [siblingKey]: siblingCell,
    },
    deriveMetricKey: () => 'waterfall',
  });

  expect(runtime.waterfallOffsets.get(parentKey)).toMatchObject({
    start: 0,
    end: 10,
    connectAbove: false,
    connectBelow: true,
  });
  expect(runtime.waterfallOffsets.get(siblingKey)).toMatchObject({
    start: 0,
    end: 5,
    connectAbove: true,
    connectAboveValue: 0,
  });
  expect(runtime.waterfallBridgeOffsets.get(spacerKey)).toEqual([
    { value: 10, depth: 1, scaleKey: 'waterfall' },
  ]);
  expect(runtime.waterfallScales.get('waterfall')).toEqual({ min: 0, max: 10 });
});

test('bounds databar percentages around zero', () => {
  const scale = { min: -25, max: 75 };

  expect(resolveScaleBounds(scale)).toEqual({
    boundedMin: -25,
    boundedMax: 75,
    span: 100,
    zeroPct: 0.25,
  });
  expect(toPercent(-50, scale)).toBe(0);
  expect(toPercent(25, scale)).toBe(0.5);
  expect(toPercent(100, scale)).toBe(1);
});
