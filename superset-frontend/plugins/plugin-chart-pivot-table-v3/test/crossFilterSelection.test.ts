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
import { act, renderHook } from '@testing-library/react-hooks';
import { type MouseEvent } from 'react';
import { usePivotInteractions } from '../src/pivot/chart/usePivotInteractions';
import { usePivotLayout } from '../src/pivot/chart/usePivotLayout';
import { buildFormData } from './plugin/fixtures/pivotFormData';
import { buildInitialPivotUpdatePlan } from '../src/pivot/query/specs';
import { buildInitialRuntimeFromSpecResults } from '../src/pivot/runtime/ingestQueryResults';

test('clicking a selected cell clears filters and context menu reports selection', () => {
  const formData = buildFormData({
    groupbyRows: ['region'],
    groupbyColumns: [],
    metrics: ['sales'],
  });
  const plan = buildInitialPivotUpdatePlan({ formData });
  const initial = buildInitialRuntimeFromSpecResults({
    ...plan,
    results: plan.specs.map(spec => ({
      query_name: spec.queryName,
      data: [{ region: 'West', sales: 10 }],
    })),
  });
  const setDataMask = jest.fn();
  const onContextMenu = jest.fn();
  const { result } = renderHook(() =>
    usePivotInteractions({
      emitCrossFilters: true,
      setDataMask,
      mergeOwnState: partial => partial,
      treeDataSignature: 'test',
      layout: usePivotLayout({ formData }),
      onContextMenu,
      dateFormatters: {},
    }),
  );
  const row = initial.tree.rows.West;
  const col =
    Object.values(initial.tree.cols).find(node => node.path.length > 0) ??
    initial.tree.cols[''];
  act(() => result.current.handleCellClick(row, col));
  expect(setDataMask.mock.calls[0][0].extraFormData.filters).toHaveLength(1);
  act(() =>
    result.current.handleCellContextMenu(
      {
        preventDefault: jest.fn(),
        clientX: 0,
        clientY: 0,
      } as unknown as MouseEvent<HTMLTableCellElement>,
      row,
      col,
    ),
  );
  expect(
    onContextMenu.mock.calls[0][2].crossFilter.isCurrentValueSelected,
  ).toBe(true);
  expect(
    onContextMenu.mock.calls[0][2].crossFilter.dataMask.extraFormData.filters,
  ).toEqual([]);
  act(() => result.current.handleCellClick(row, col));
  expect(setDataMask.mock.calls[1][0].extraFormData.filters).toEqual([]);
});
