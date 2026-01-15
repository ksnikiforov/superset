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
  serializePath,
} from '../../../src/utils';
import {
  fetchPivotBranch,
  peekPivotBranchCache,
} from '../../../src/fetchPivotBranch';
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
  }: {
    data: PivotTreeData;
    ownState?: Record<string, unknown>;
    setDataMask?: jest.Mock;
    setControlValue?: jest.Mock;
    formDataOverrides?: Partial<PivotTableQueryFormData>;
    groupbyRowsOverride?: string[];
    groupbyColumnsOverride?: string[];
    formDataGroupbyColumnsOverride?: string[];
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
      chart_id: 1,
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
    const lastCall = setDataMask.mock.calls[setDataMask.mock.calls.length - 1][0];
    expect(lastCall?.ownState?.expansionState?.rows).toContain(
      serializePath(['A']),
    );
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
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
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
    expect(expansionState.rows).toContainEqual(['A']);
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
      await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    }

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
      expect.arrayContaining([['A'], ['A', 'X']]),
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
        buildTreeFromRecords(deepRecords, metrics, deepGroupby, [], rowDepth, 0),
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
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

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
      expect.arrayContaining([['A'], ['A', 'X']]),
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
      expect.arrayContaining([['A'], ['A', 'X'], ['A', 'X', 'I']]),
    );
  });
});
