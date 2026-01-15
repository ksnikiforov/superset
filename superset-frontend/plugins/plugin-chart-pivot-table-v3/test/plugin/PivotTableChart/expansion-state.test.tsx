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

import { QueryFormColumn } from '@superset-ui/core';
import { fireEvent, render, screen, waitFor } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import {
  MetricsLayoutEnum,
  PivotExpansionState,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../../src/types';
import {
  applyMetricAxis,
  buildTreeFromRecords,
  injectRowSubtotalLeaves,
  METRIC_TOKEN_PREFIX,
  PATH_DIVIDER,
  serializePath,
  SUBTOTAL_TOKEN,
} from '../../../src/utils';
import {
  fetchPivotBranch,
  peekPivotBranchCache,
} from '../../../src/fetchPivotBranch';
import type { FetchPivotBranchResult } from '../../../src/fetchPivotBranch';
import { buildFormData } from '../fixtures/pivotFormData';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart expansion state persistence', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const peekPivotBranchCacheMock = peekPivotBranchCache as jest.Mock;

  const createDeferred = <T,>() => {
    let resolve: ((value: T) => void) | undefined;
    const promise = new Promise<T>(res => {
      resolve = res;
    });
    return { promise, resolve: resolve as (value: T) => void };
  };

  const records = [
    { r1: 'A', r2: 'X', m1: 10 },
    { r1: 'A', r2: 'Y', m1: 12 },
    { r1: 'B', r2: 'X', m1: 15 },
  ];
  const rowGroupby = ['r1', 'r2'];
  const metrics = ['m1'];

  const buildTree = (rowDepth: number): PivotTreeData =>
    applyMetricAxis(
      buildTreeFromRecords(records, metrics, rowGroupby, [], rowDepth, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
    );

  const buildChartProps = ({
    data,
    ownState,
    setDataMask,
    setControlValue,
    formDataOverrides,
    groupbyRowsOverride,
    groupbyColumnsOverride,
    formDataGroupbyColumnsOverride,
    emitCrossFilters,
  }: {
    data: PivotTreeData;
    ownState?: Record<string, unknown>;
    setDataMask?: jest.Mock;
    setControlValue?: jest.Mock;
    formDataOverrides?: Partial<PivotTableQueryFormData>;
    groupbyRowsOverride?: QueryFormColumn[];
    groupbyColumnsOverride?: QueryFormColumn[];
    formDataGroupbyColumnsOverride?: QueryFormColumn[];
    emitCrossFilters?: boolean;
  }) => {
    const groupbyRowsValue = groupbyRowsOverride ?? rowGroupby;
    const groupbyColumnsValue = groupbyColumnsOverride ?? [];
    const formDataGroupbyColumnsValue =
      formDataGroupbyColumnsOverride ?? groupbyColumnsValue;
    const formData = buildFormData({
      groupbyRows: groupbyRowsValue,
      groupbyColumns: formDataGroupbyColumnsValue,
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      startCollapsed: true,
      initialDepth: 1,
      expandRowsLevel: 0,
      expandColumnsLevel: 0,
      maxDepthPerFetch: 1,
      rowTotals: false,
      colTotals: false,
      rowSubTotals: false,
      colSubTotals: false,
      ...formDataOverrides,
    });
    return (
      <PivotTableChart
        data={data}
        formData={formData}
        metrics={metrics}
        groupbyRows={groupbyRowsValue}
        groupbyColumns={groupbyColumnsValue}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={formData.startCollapsed}
        initialDepth={formData.initialDepth}
        maxDepthPerFetch={formData.maxDepthPerFetch}
        rowTotals={formData.rowTotals}
        colTotals={formData.colTotals}
        rowSubTotals={formData.rowSubTotals}
        colSubTotals={formData.colSubTotals}
        rowSubtotalLevels={formData.rowSubtotalLevels}
        colSubtotalLevels={formData.colSubtotalLevels}
        metricsLayout={formData.metricsLayout}
        ownState={ownState}
        setDataMask={setDataMask || jest.fn()}
        setControlValue={setControlValue}
        emitCrossFilters={emitCrossFilters}
      />
    );
  };

  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
    peekPivotBranchCacheMock.mockClear();
    peekPivotBranchCacheMock.mockReturnValue(undefined);
  });

  it('stores expansion state in ownState when toggled', async () => {
    const setDataMask = jest.fn();
    render(buildChartProps({ data: buildTree(1), setDataMask }));

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setDataMask).toHaveBeenCalled());
    const lastCall =
      setDataMask.mock.calls[setDataMask.mock.calls.length - 1][0];
    expect(lastCall?.ownState?.expansionState?.rows).toContain(
      serializePath(['A']),
    );
  });

  it('merges expansion state with existing ownState updates', async () => {
    const setDataMask = jest.fn();
    render(
      buildChartProps({
        data: buildTree(2),
        setDataMask,
        emitCrossFilters: true,
      }),
    );

    const valueCell = document.querySelector('td.value-cell[role="button"]');
    expect(valueCell).not.toBeNull();
    fireEvent.click(valueCell as HTMLTableCellElement);

    await waitFor(() => expect(setDataMask).toHaveBeenCalled());
    const firstCall = setDataMask.mock.calls[setDataMask.mock.calls.length - 1];
    const firstOwnState = firstCall?.[0]?.ownState as Record<string, unknown>;
    const treeDataSignature = firstOwnState?.treeDataSignature;
    expect(treeDataSignature).toBeDefined();

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() =>
      expect(setDataMask.mock.calls.length).toBeGreaterThan(1),
    );
    const lastCall = setDataMask.mock.calls[setDataMask.mock.calls.length - 1];
    const lastOwnState = lastCall?.[0]?.ownState as Record<string, unknown>;
    expect(lastOwnState?.treeDataSignature).toEqual(treeDataSignature);
    expect(
      (lastOwnState?.expansionState as PivotExpansionState | undefined)?.rows,
    ).toContain(serializePath(['A']));
  });

  it('restores expansion state by fetching expanded branches', async () => {
    const expandedKey = serializePath(['A']);
    const ownState = {
      expansionState: {
        rows: [expandedKey],
        cols: [],
      },
    };
    fetchPivotBranchMock.mockResolvedValueOnce({ data: buildTree(2) });

    render(buildChartProps({ data: buildTree(1), ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
  });

  it('removes descendant expansions when a parent is collapsed', async () => {
    const setControlValue = jest.fn();
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', m1: 12 },
      { r1: 'A', r2: 'Y', r3: 'I', m1: 5 },
      { r1: 'B', r2: 'Z', r3: 'I', m1: 7 },
    ];
    const deepTree = applyMetricAxis(
      buildTreeFromRecords(deepRecords, metrics, deepGroupby, [], 3, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      deepGroupby,
      [],
    );

    render(
      buildChartProps({
        data: deepTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
      }),
    );

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );

    const nestedLabel = screen.getByText('X');
    const nestedCell = nestedLabel.closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
    fireEvent.click(nestedToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());

    fireEvent.click(rowToggle as HTMLButtonElement);

    const expansionCalls = setControlValue.mock.calls.filter(
      ([controlName]) => controlName === 'expansionState',
    );
    await waitFor(() => expect(expansionCalls.length).toBeGreaterThan(0));
    const expansionState =
      expansionCalls[expansionCalls.length - 1]?.[1] ||
      ({} as PivotExpansionState);
    expect(expansionState.rows).not.toContain(serializePath(['A']));
    expect(expansionState.rows).not.toContain(serializePath(['A', 'X']));
  });

  it('persists expansion state to formData for explore updates', async () => {
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTree(2),
        setControlValue,
      }),
    );
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    const getExpansionCall = () =>
      setControlValue.mock.calls.find(
        ([controlName]) => controlName === 'expansionState',
      );
    await waitFor(() => expect(getExpansionCall()).toBeDefined());
    const expansionState = getExpansionCall()?.[1] as PivotExpansionState;
    expect(expansionState.rows).toContainEqual(serializePath(['A']));
  });

  it('persists nested expansion state to formData for explore updates', async () => {
    const setControlValue = jest.fn();
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', m1: 12 },
      { r1: 'A', r2: 'Y', r3: 'I', m1: 5 },
      { r1: 'B', r2: 'Z', r3: 'I', m1: 7 },
    ];
    const deepTree = applyMetricAxis(
      buildTreeFromRecords(deepRecords, metrics, deepGroupby, [], 3, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      deepGroupby,
      [],
    );

    render(
      buildChartProps({
        data: deepTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
      }),
    );

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    if (!screen.queryByText('X')) {
      fireEvent.click(rowToggle as HTMLButtonElement);
    }
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

    const nestedLabel = screen.getByText('X');
    const nestedCell = nestedLabel.closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
    fireEvent.click(nestedToggle as HTMLButtonElement);

    const expansionCalls = () =>
      setControlValue.mock.calls.filter(
        ([controlName]) => controlName === 'expansionState',
      );
    await waitFor(() => expect(expansionCalls().length).toBeGreaterThan(0));
    const lastCall = expansionCalls()[expansionCalls().length - 1];
    const expansionState = lastCall?.[1] as PivotExpansionState;
    expect(expansionState.rows).toEqual(
      expect.arrayContaining([serializePath(['A']), serializePath(['A', 'X'])]),
    );
  });

  it('restores nested expansion state after re-render', async () => {
    const setControlValue = jest.fn();
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', m1: 12 },
      { r1: 'A', r2: 'Y', r3: 'I', m1: 5 },
      { r1: 'B', r2: 'Z', r3: 'I', m1: 7 },
    ];
    const buildTreeWithDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          deepRecords,
          metrics,
          deepGroupby,
          [],
          rowDepth,
          0,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        deepGroupby,
        [],
      );
    const shallowTree = buildTreeWithDepth(1);
    const midTree = buildTreeWithDepth(2);
    const deepTree = buildTreeWithDepth(3);
    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: midTree })
      .mockResolvedValueOnce({ data: deepTree });

    const { rerender } = render(
      buildChartProps({
        data: shallowTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: { maxDepthPerFetch: 1 },
      }),
    );

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );

    const nestedLabel = screen.getByText('X');
    const nestedCell = nestedLabel.closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
    fireEvent.click(nestedToggle as HTMLButtonElement);
    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());

    const expansionCalls = setControlValue.mock.calls.filter(
      ([controlName]) => controlName === 'expansionState',
    );
    const lastCall = expansionCalls[expansionCalls.length - 1];
    const expansionState = lastCall?.[1] as PivotExpansionState;
    expect(expansionState.rows).toEqual(
      expect.arrayContaining([serializePath(['A']), serializePath(['A', 'X'])]),
    );

    fetchPivotBranchMock.mockClear();
    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: midTree })
      .mockResolvedValueOnce({ data: deepTree });

    const shallowTreeNext = buildTreeWithDepth(1);
    rerender(
      buildChartProps({
        data: shallowTreeNext,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          expansionState,
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const fetchedPaths = fetchPivotBranchMock.mock.calls.map(call =>
      JSON.stringify(call[0].path),
    );
    expect(fetchedPaths).toContain(JSON.stringify(['A']));
    expect(fetchedPaths).toContain(JSON.stringify(['A', 'X']));
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());
  });

  it('rehydrates expansion state from string keys in formData', async () => {
    const expandedKey = serializePath(['A']);
    fetchPivotBranchMock.mockResolvedValueOnce({ data: buildTree(2) });

    render(
      buildChartProps({
        data: buildTree(1),
        formDataOverrides: {
          expansionState: {
            rows: [expandedKey],
            cols: [],
          },
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual(['A']);
    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
  });

  it('keeps expanded rows when groupby labels change', async () => {
    const setDataMask = jest.fn();
    const baseColumn: QueryFormColumn = {
      sqlExpression: 'r1',
      label: 'r1',
      expressionType: 'SQL',
    };
    const renamedColumn: QueryFormColumn = {
      ...baseColumn,
      label: 'Region',
    };
    const groupbyBase: QueryFormColumn[] = [baseColumn, 'r2'];
    const groupbyRenamed: QueryFormColumn[] = [renamedColumn, 'r2'];
    const labelRecords = [
      { r1: 'A', Region: 'A', r2: 'X', m1: 10 },
      { r1: 'A', Region: 'A', r2: 'Y', m1: 12 },
      { r1: 'B', Region: 'B', r2: 'Z', m1: 15 },
    ];
    const buildTreeForGroupby = (groupby: QueryFormColumn[]) =>
      applyMetricAxis(
        buildTreeFromRecords(labelRecords, metrics, groupby, [], 2, 0),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        groupby,
        [],
      );
    const baseTree = buildTreeForGroupby(groupbyBase);
    const renamedTree = buildTreeForGroupby(groupbyRenamed);

    const { rerender } = render(
      buildChartProps({
        data: baseTree,
        groupbyRowsOverride: groupbyBase,
        setDataMask,
      }),
    );

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );

    rerender(
      buildChartProps({
        data: renamedTree,
        groupbyRowsOverride: groupbyRenamed,
        setDataMask,
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
  });

  it('restores nested expansion when auto-expand rows is zero', async () => {
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', m1: 12 },
      { r1: 'A', r2: 'Y', r3: 'I', m1: 5 },
      { r1: 'B', r2: 'Z', r3: 'I', m1: 7 },
    ];
    const buildTreeWithDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          deepRecords,
          metrics,
          deepGroupby,
          [],
          rowDepth,
          0,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        deepGroupby,
        [],
      );
    const shallowTree = buildTreeWithDepth(1);
    const midTree = buildTreeWithDepth(2);
    const deepTree = buildTreeWithDepth(3);
    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: midTree })
      .mockResolvedValueOnce({ data: deepTree });

    render(
      buildChartProps({
        data: shallowTree,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          expansionState: {
            rows: [['A'], ['A', 'X']],
            cols: [],
          },
          expandRowsLevel: 0,
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const fetchedPaths = fetchPivotBranchMock.mock.calls.map(call =>
      JSON.stringify(call[0].path),
    );
    expect(fetchedPaths).toContain(JSON.stringify(['A']));
    expect(fetchedPaths).toContain(JSON.stringify(['A', 'X']));
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());
  });

  it('collapses auto-expanded rows when auto-expand is set to zero', async () => {
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: 1,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );

    rerender(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(screen.queryAllByText('X').length).toEqual(0));
  });

  it('ignores cached auto expansions when auto-expand is explicitly zero', async () => {
    const cachedExpansionState = {
      rows: [serializePath(['A']), serializePath(['B'])],
      cols: [],
    };
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: 2,
          expansionState: cachedExpansionState,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );

    rerender(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: 0,
          expansionState: cachedExpansionState,
        },
      }),
    );

    await waitFor(() => expect(screen.queryAllByText('X').length).toEqual(0));
  });

  it('ignores cached auto expansions when auto-expand is cleared to default', async () => {
    const cachedExpansionState = {
      rows: [serializePath(['A']), serializePath(['B'])],
      cols: [],
    };
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: 2,
          expansionState: cachedExpansionState,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );

    rerender(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: undefined,
          expansionState: cachedExpansionState,
        },
      }),
    );

    await waitFor(() => expect(screen.queryAllByText('X').length).toEqual(0));
  });

  it('collapses auto-expanded rows when auto-expand is cleared', async () => {
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: 2,
          expandColumnsLevel: 0,
          initialDepth: 2,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );

    rerender(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          expandRowsLevel: undefined,
          expandColumnsLevel: 0,
          initialDepth: 2,
        },
      }),
    );

    await waitFor(() => expect(screen.queryAllByText('X').length).toEqual(0));
  });

  it('persists auto-expand rows when cleared to zero', async () => {
    const setControlValue = jest.fn();
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        setControlValue,
        formDataOverrides: {
          expandRowsLevel: 2,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
    setControlValue.mockClear();

    rerender(
      buildChartProps({
        data: buildTree(2),
        setControlValue,
        formDataOverrides: {
          expandRowsLevel: undefined,
        },
      }),
    );

    await waitFor(() =>
      expect(
        setControlValue.mock.calls.some(
          ([controlName, value]) =>
            controlName === 'expandRowsLevel' && value === 0,
        ),
      ).toBe(true),
    );
  });

  it('keeps manual expansions when auto-expand is set to zero', async () => {
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', m1: 12 },
      { r1: 'B', r2: 'Y', r3: 'I', m1: 5 },
    ];
    const deepTree = applyMetricAxis(
      buildTreeFromRecords(deepRecords, metrics, deepGroupby, [], 3, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      deepGroupby,
      [],
    );
    fetchPivotBranchMock.mockResolvedValueOnce({ data: deepTree });

    const setControlValue = jest.fn();
    const { rerender } = render(
      buildChartProps({
        data: deepTree,
        groupbyRowsOverride: deepGroupby,
        setControlValue,
        formDataOverrides: {
          expandRowsLevel: 1,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    const nestedLabel = screen.getByText('X');
    const nestedCell = nestedLabel.closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
    fireEvent.click(nestedToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());
    const expansionState = setControlValue.mock.calls.find(
      ([controlName]) => controlName === 'expansionState',
    )?.[1] as PivotExpansionState | undefined;
    expect(expansionState).toBeDefined();

    rerender(
      buildChartProps({
        data: deepTree,
        groupbyRowsOverride: deepGroupby,
        setControlValue,
        formDataOverrides: {
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
          expansionState,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());
  });

  it('ignores persisted row expansions when auto-expand rows is set', async () => {
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', m1: 12 },
      { r1: 'B', r2: 'Y', r3: 'I', m1: 5 },
    ];
    const buildTreeWithDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          deepRecords,
          metrics,
          deepGroupby,
          [],
          rowDepth,
          0,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        deepGroupby,
        [],
      );
    fetchPivotBranchMock.mockResolvedValue({ data: buildTreeWithDepth(2) });

    render(
      buildChartProps({
        data: buildTreeWithDepth(1),
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          expansionState: {
            rows: [serializePath(['A']), serializePath(['A', 'X'])],
            cols: [],
          },
          expandRowsLevel: 1,
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const rowPaths = fetchPivotBranchMock.mock.calls
      .filter(([args]) => args.axis === 'row')
      .map(call => JSON.stringify(call[0].path));
    expect(rowPaths).toContain(JSON.stringify(['A']));
    expect(rowPaths).not.toContain(JSON.stringify(['A', 'X']));
  });

  it('clears cached row expansions when auto-expand rows is set', async () => {
    const setControlValue = jest.fn();
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        setControlValue,
        formDataOverrides: {
          expansionState: {
            rows: [serializePath(['A']), serializePath(['A', 'X'])],
            cols: [],
          },
          expandRowsLevel: 2,
          expandColumnsLevel: 0,
        },
      }),
    );

    const getExpansionState = () =>
      setControlValue.mock.calls.find(
        ([controlName]) => controlName === 'expansionState',
      )?.[1] as PivotExpansionState | undefined;

    await waitFor(() => expect(getExpansionState()).toBeDefined());
    const clearedState = getExpansionState();
    expect(clearedState?.rows).toEqual([]);
    expect(clearedState?.collapsedRows).toEqual([]);

    rerender(
      buildChartProps({
        data: buildTree(2),
        setControlValue,
        formDataOverrides: {
          expansionState: clearedState,
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(screen.queryAllByText('X').length).toEqual(0));
  });

  it('persists deep expansion state with subtotals and metrics placeholder', async () => {
    const setControlValue = jest.fn();
    const deepGroupby = ['r1', 'r2', 'r3', 'r4'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', r4: 'alpha', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'I', r4: 'beta', m1: 12 },
      { r1: 'A', r2: 'X', r3: 'II', r4: 'alpha', m1: 5 },
      { r1: 'A', r2: 'Y', r3: 'I', r4: 'alpha', m1: 7 },
      { r1: 'B', r2: 'Z', r3: 'I', r4: 'alpha', m1: 9 },
    ];
    const rowSubtotalDepths = [1, 2, 3];
    const buildTreeWithDepth = (rowDepth: number) => {
      const base = buildTreeFromRecords(
        deepRecords,
        metrics,
        deepGroupby,
        [],
        rowDepth,
        0,
      );
      const withSubtotals = rowSubtotalDepths.reduce(
        (acc, depth) => injectRowSubtotalLeaves(acc, depth, deepGroupby.length),
        base,
      );
      return applyMetricAxis(
        withSubtotals,
        metrics,
        MetricsLayoutEnum.COLUMNS,
        deepGroupby,
        [],
      );
    };
    const shallowTree = buildTreeWithDepth(1);
    const midTree = buildTreeWithDepth(2);
    const deepTree = buildTreeWithDepth(3);
    const deepestTree = buildTreeWithDepth(4);
    fetchPivotBranchMock
      .mockResolvedValueOnce({ data: midTree })
      .mockResolvedValueOnce({ data: deepTree })
      .mockResolvedValueOnce({ data: deepestTree });

    render(
      buildChartProps({
        data: shallowTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
        groupbyColumnsOverride: [],
        formDataGroupbyColumnsOverride: ['__MEASURES__'],
        formDataOverrides: {
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          rowTotals: true,
          rowSubTotals: true,
          rowTotalPosition: 'end',
          rowSubtotalPosition: 'start',
          maxDepthPerFetch: 1,
        },
      }),
    );

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

    const nestedLabel = screen.getByText('X');
    const nestedCell = nestedLabel.closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
    fireEvent.click(nestedToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());

    const deeperLabel = screen.getByText('I');
    const deeperCell = deeperLabel.closest('th');
    expect(deeperCell).not.toBeNull();
    const deeperToggle = deeperCell?.querySelector('button');
    expect(deeperToggle).not.toBeNull();
    fireEvent.click(deeperToggle as HTMLButtonElement);
    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalledTimes(3));

    const expansionCalls = setControlValue.mock.calls.filter(
      ([controlName]) => controlName === 'expansionState',
    );
    const lastCall = expansionCalls[expansionCalls.length - 1];
    const expansionState = lastCall?.[1] as PivotExpansionState;
    expect(expansionState.rows).toEqual(
      expect.arrayContaining([
        serializePath(['A']),
        serializePath(['A', 'X']),
        serializePath(['A', 'X', 'I']),
      ]),
    );
  });

  it('does not persist subtotal nodes from seeded expansion levels', async () => {
    const setControlValue = jest.fn();
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', m1: 12 },
      { r1: 'A', r2: 'Y', r3: 'I', m1: 5 },
      { r1: 'B', r2: 'Z', r3: 'I', m1: 7 },
    ];
    const subtotalDepth = 1;
    const buildTreeWithDepth = (rowDepth: number) => {
      const base = buildTreeFromRecords(
        deepRecords,
        metrics,
        deepGroupby,
        [],
        rowDepth,
        0,
      );
      const withSubtotals = injectRowSubtotalLeaves(
        base,
        subtotalDepth,
        deepGroupby.length,
      );
      return applyMetricAxis(
        withSubtotals,
        metrics,
        MetricsLayoutEnum.COLUMNS,
        deepGroupby,
        [],
      );
    };
    const shallowTree = buildTreeWithDepth(2);
    const deepTree = buildTreeWithDepth(3);
    fetchPivotBranchMock.mockResolvedValueOnce({ data: deepTree });

    render(
      buildChartProps({
        data: shallowTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          expandRowsLevel: 2,
          rowSubTotals: true,
          rowSubtotalLevels: [subtotalDepth],
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    const nestedLabel = screen.getByText('X');
    const nestedCell = nestedLabel.closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
    fireEvent.click(nestedToggle as HTMLButtonElement);
    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByText('I').length).toBeGreaterThan(0),
    );

    const expansionCalls = setControlValue.mock.calls.filter(
      ([controlName]) => controlName === 'expansionState',
    );
    const lastCall = expansionCalls[expansionCalls.length - 1];
    const expansionState = lastCall?.[1] as PivotExpansionState;
    expect(expansionState.rows).not.toContain(
      serializePath(['A', SUBTOTAL_TOKEN]),
    );
  });

  it('does not refetch when persisted expansions are already in the tree', async () => {
    const ownState = {
      expansionState: {
        rows: [serializePath(['A'])],
        cols: [],
      },
    };

    render(buildChartProps({ data: buildTree(2), ownState }));

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
  });

  it('shows a global loader for persisted expansion prefetch', async () => {
    const deferredA = createDeferred<FetchPivotBranchResult>();
    const deferredB = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock
      .mockReturnValueOnce(deferredA.promise)
      .mockReturnValueOnce(deferredB.promise);

    const ownState = {
      expansionState: {
        rows: [serializePath(['A']), serializePath(['B'])],
        cols: [],
      },
    };

    render(buildChartProps({ data: buildTree(1), ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();

    deferredA.resolve({ data: buildTree(2) });
    deferredB.resolve({ data: buildTree(2) });

    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: /loading/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('does not show a global loader without persisted expansion state', async () => {
    const deferred = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock.mockReturnValue(deferred.promise);

    render(
      buildChartProps({
        data: buildTree(1),
        formDataOverrides: {
          expandRowsLevel: 1,
          expandColumnsLevel: 0,
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('merges persisted row and column branches without losing data', async () => {
    const colGroupby = ['c1', 'c2'];
    const recordsWithCols = [
      { r1: 'A', r2: 'X', c1: 'C', c2: 'U', m1: 10 },
      { r1: 'A', r2: 'Y', c1: 'C', c2: 'V', m1: 11 },
      { r1: 'B', r2: 'Z', c1: 'D', c2: 'W', m1: 12 },
    ];
    const buildTreeWithCols = (
      rowDepth: number,
      colDepth: number,
    ): PivotTreeData =>
      applyMetricAxis(
        buildTreeFromRecords(
          recordsWithCols,
          metrics,
          rowGroupby,
          colGroupby,
          rowDepth,
          colDepth,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        rowGroupby,
        colGroupby,
      );
    const baseTree = buildTreeWithCols(1, 1);
    const rowBranch = buildTreeWithCols(2, 1);
    const colBranch = buildTreeWithCols(1, 2);

    const deferredRow = createDeferred<FetchPivotBranchResult>();
    const deferredCol = createDeferred<FetchPivotBranchResult>();
    fetchPivotBranchMock.mockImplementation(({ axis }) =>
      axis === 'row' ? deferredRow.promise : deferredCol.promise,
    );

    const ownState = {
      expansionState: {
        rows: [serializePath(['A'])],
        cols: [serializePath(['C'])],
      },
    };

    render(
      buildChartProps({
        data: baseTree,
        ownState,
        groupbyColumnsOverride: colGroupby,
        formDataGroupbyColumnsOverride: colGroupby,
        formDataOverrides: {
          maxDepthPerFetch: 1,
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2));

    deferredRow.resolve({ data: rowBranch });
    deferredCol.resolve({ data: colBranch });

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
      expect(screen.getByText('U')).toBeInTheDocument();
    });
  });

  it('ignores persisted column expansions when auto-expand columns is set', async () => {
    const deepRowGroupby = ['r1', 'r2', 'r3'];
    const deepColGroupby = ['c1', 'c2', 'c3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'I', c1: 'C', c2: 'U', c3: 'p', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'II', c1: 'C', c2: 'V', c3: 'q', m1: 12 },
      { r1: 'B', r2: 'Y', r3: 'I', c1: 'D', c2: 'W', c3: 'r', m1: 5 },
    ];
    const buildTreeWithDepth = (rowDepth: number, colDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          deepRecords,
          metrics,
          deepRowGroupby,
          deepColGroupby,
          rowDepth,
          colDepth,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        deepRowGroupby,
        deepColGroupby,
      );
    fetchPivotBranchMock.mockResolvedValue({ data: buildTreeWithDepth(2, 2) });

    render(
      buildChartProps({
        data: buildTreeWithDepth(1, 1),
        groupbyRowsOverride: deepRowGroupby,
        groupbyColumnsOverride: deepColGroupby,
        formDataGroupbyColumnsOverride: deepColGroupby,
        formDataOverrides: {
          expansionState: {
            rows: [serializePath(['A']), serializePath(['A', 'X'])],
            cols: [serializePath(['C']), serializePath(['C', 'U'])],
          },
          expandRowsLevel: 0,
          expandColumnsLevel: 1,
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const rowPaths = fetchPivotBranchMock.mock.calls
      .filter(([args]) => args.axis === 'row')
      .map(call => JSON.stringify(call[0].path));
    const colPaths = fetchPivotBranchMock.mock.calls
      .filter(([args]) => args.axis === 'col')
      .map(call => JSON.stringify(call[0].path));
    expect(rowPaths).toContain(JSON.stringify(['A', 'X']));
    expect(colPaths).toContain(JSON.stringify(['C']));
    expect(colPaths).not.toContain(JSON.stringify(['C', 'U']));
  });

  it('prefetches auto-expand row level increases with a single root query', async () => {
    const deepGroupby = ['r1', 'r2', 'r3'];
    const deepRecords = [
      { r1: 'A', r2: 'X', r3: 'r3-1', m1: 10 },
      { r1: 'A', r2: 'X', r3: 'r3-2', m1: 12 },
      { r1: 'B', r2: 'Y', r3: 'r3-3', m1: 5 },
    ];
    const buildTreeWithDepth = (rowDepth: number) =>
      applyMetricAxis(
        buildTreeFromRecords(
          deepRecords,
          metrics,
          deepGroupby,
          [],
          rowDepth,
          0,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        deepGroupby,
        [],
      );
    const shallowTree = buildTreeWithDepth(2);
    const deepTree = buildTreeWithDepth(3);
    fetchPivotBranchMock.mockResolvedValue({ data: deepTree });

    const { rerender } = render(
      buildChartProps({
        data: shallowTree,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          expandRowsLevel: 2,
          expandColumnsLevel: 0,
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
    fetchPivotBranchMock.mockClear();

    rerender(
      buildChartProps({
        data: shallowTree,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          expandRowsLevel: 3,
          expandColumnsLevel: 0,
          maxDepthPerFetch: 1,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('r3-1')).toBeInTheDocument());
    const rowCalls = fetchPivotBranchMock.mock.calls.filter(
      ([args]) => args.axis === 'row',
    );
    expect(rowCalls).toHaveLength(1);
    expect(rowCalls[0][0].path).toEqual([]);
  });

  it('does not fetch missing leaf expansions', async () => {
    fetchPivotBranchMock.mockResolvedValue({ data: buildTree(2) });
    const ownState = {
      expansionState: {
        rows: [serializePath(['A']), serializePath(['A', 'X'])],
        cols: [],
      },
    };

    render(buildChartProps({ data: buildTree(1), ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1));
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual(['A']);
  });

  it('does not fetch persisted subtotal expansions', async () => {
    const ownState = {
      expansionState: {
        rows: [serializePath(['A', SUBTOTAL_TOKEN])],
        cols: [],
      },
    };

    render(buildChartProps({ data: buildTree(1), ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).not.toHaveBeenCalled());
  });

  it('decodes null values when prefetching persisted expansions', async () => {
    const ownState = {
      expansionState: {
        rows: [serializePath([null])],
        cols: [],
      },
    };

    render(buildChartProps({ data: buildTree(1), ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual([null]);
  });

  it('decodes undefined values when prefetching persisted expansions', async () => {
    const ownState = {
      expansionState: {
        rows: [serializePath([undefined])],
        cols: [],
      },
    };

    render(buildChartProps({ data: buildTree(1), ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual([undefined]);
  });

  it('handles PATH_DIVIDER values when prefetching persisted expansions', async () => {
    const dividerValue = `A${PATH_DIVIDER}B`;
    const ownState = {
      expansionState: {
        rows: [serializePath([dividerValue])],
        cols: [],
      },
    };

    render(buildChartProps({ data: buildTree(1), ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual([dividerValue]);
  });

  it('keeps metric-like dimension values intact when prefetching', async () => {
    const metricLikeValue = `${METRIC_TOKEN_PREFIX}notmetric`;
    const metricLikeRecords = [
      { r1: metricLikeValue, r2: 'X', m1: 10 },
      { r1: metricLikeValue, r2: 'Y', m1: 12 },
    ];
    const metricLikeTree = applyMetricAxis(
      buildTreeFromRecords(metricLikeRecords, metrics, rowGroupby, [], 1, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
    );
    const ownState = {
      expansionState: {
        rows: [serializePath([metricLikeValue])],
        cols: [],
      },
    };

    render(buildChartProps({ data: metricLikeTree, ownState }));

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual([metricLikeValue]);
  });
});
