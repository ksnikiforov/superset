/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership. The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { renderHook } from '@testing-library/react-hooks';
import { usePivotFormatting } from '../src/pivot/chart/usePivotFormatting';
import { usePivotLayout } from '../src/pivot/chart/usePivotLayout';
import { buildFormData } from './plugin/fixtures/pivotFormData';
import { type PivotTreeNode } from '../src/types';
import { serializePath, serializeCellKey } from '../src/pivot/core/path';

const node = (
  path: string[],
  axis: 'row' | 'col' = 'row',
  hasChildren = false,
): PivotTreeNode => ({
  path,
  axis,
  key: serializePath(path),
  label: path.at(-1) ?? '',
  formattedLabel: path.at(-1) ?? '',
  level: path.length,
  hasChildren,
});

test('screen, databar and Excel hide parent values while retaining waterfall spacer rendering', () => {
  const parent = node(['A'], 'row', true);
  const child = node(['A', 'X']);
  const spacer = node(['B']);
  const col = node([], 'col');
  const parentCell = {
    rowKey: parent.key,
    colKey: col.key,
    values: { m1: 10 },
  };
  const childCell = { rowKey: child.key, colKey: col.key, values: { m1: 20 } };
  const cells = {
    [serializeCellKey(parent.key, col.key)]: parentCell,
    [serializeCellKey(child.key, col.key)]: childCell,
  };
  const tree = {
    rows: { [parent.key]: parent, [child.key]: child, [spacer.key]: spacer },
    cols: { [col.key]: col },
    cells,
  };
  const renderModel = {
    visibleRows: [parent, child, spacer],
    visibleCols: [col],
    columnHeaderRows: [],
    showRowRoot: false,
    visibleCellEntries: [
      {
        rowNode: parent,
        colNode: col,
        cell: parentCell,
        cellKey: serializeCellKey(parent.key, col.key),
      },
      {
        rowNode: child,
        colNode: col,
        cell: childCell,
        cellKey: serializeCellKey(child.key, col.key),
      },
    ],
  };
  const formData = buildFormData({
    groupbyRows: ['r1', 'r2'],
    groupbyColumns: [],
    metrics: ['m1'],
    rowSubTotals: true,
    rowSubtotalPosition: 'end',
    rowSubtotalLevels: [1],
    metricDatabars: { m1: { type: 'waterfall' } },
  });
  const { result, unmount } = renderHook(() => {
    const layout = usePivotLayout({ formData });
    return usePivotFormatting({
      tree,
      renderModel,
      formData,
      layout,
      expandedRows: new Set([parent.key]),
      rowValuesMap: new Map(),
      colValuesMap: new Map(),
      getNodeDimDepth: n => n.path.length,
      theme: undefined,
    });
  });
  expect(result.current.renderCellContent(parent, col, 'm1')).toBe('');
  expect(
    result.current.renderDatabarContent(parent, col, parentCell, 'm1'),
  ).toBe('');
  expect(result.current.formatExportCell(parent, col)).toBe('');
  expect(result.current.formatExportCell(child, col)).toBe(20);
  expect(
    result.current.renderDatabarContent(spacer, col, undefined, 'm1'),
  ).not.toBe('');
  unmount();
});
