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
import PivotTableChart, {
  buildPreloadedTreeFactBatches,
} from '../fixtures/TestPivotTableChart';
import {
  MetricsLayoutEnum,
  PivotExpansionState,
  PivotPath,
  PivotRuntimeLayout,
  PivotTableQueryFormData,
  PivotTreeData,
} from '../../../src/types';
import { mergeTrees } from '../../../src/pivot/core/tree';
import { PATH_DIVIDER, parsePath } from '../../../src/pivot/core/path';
import {
  METRIC_TOKEN_PREFIX,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { fetchPivotBranch } from '../../../src/fetchPivotBranch';
import type {
  FetchPivotBranchParams,
  FetchPivotBranchResult,
} from '../../../src/fetchPivotBranch';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import {
  fetchPivotBranchesBatch,
  type FetchPivotBranchesBatchParams,
  type FetchPivotBranchesBatchResult,
} from '../../../src/pivot/query/fetchPivotBranchesBatch';
import { buildFormData } from '../fixtures/pivotFormData';
import {
  buildMockBranchFetchResult,
  resolveMockBranchFetchResult,
} from '../fixtures/factBatches';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import {
  injectRowSubtotalLeaves,
  applyMetricAxis,
} from '../fixtures/metricAxis';

jest.mock('../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
  };
});

jest.mock('../../../src/pivot/query/fetchPivotBranchesBatch', () => ({
  fetchPivotBranchesBatch: jest.fn(),
}));

describe('PivotTableChart expansion state persistence', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  const fetchPivotBranchesBatchMock =
    fetchPivotBranchesBatch as jest.MockedFunction<
      typeof fetchPivotBranchesBatch
    >;

  const resolveBatchWithSingles = async ({
    batch,
    formData,
    visibleRowDepth,
    visibleColDepth,
  }: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
    const results = await Promise.all(
      batch.targets.map(target => {
        const path = parsePath(target.pathKey);
        return Promise.resolve(
          fetchPivotBranchMock({
            formData,
            axis: batch.axis,
            path,
            visibleRowDepth,
            visibleColDepth,
          }),
        );
      }),
    );
    const merged = results.reduce<PivotTreeData | undefined>(
      (acc, result) => mergeTrees(acc, result.data),
      undefined,
    );
    return {
      data: merged,
      factBatches: results.flatMap(result => result.factBatches),
    };
  };

  const createDeferredBranchFetch = () => {
    const resolvers: Array<(result: Partial<FetchPivotBranchResult>) => void> =
      [];
    const promises: Array<Promise<FetchPivotBranchResult>> = [];
    let resolvedResult: Partial<FetchPivotBranchResult> | undefined;
    const implementation = (params: FetchPivotBranchParams) => {
      if (resolvedResult) {
        const promise = Promise.resolve(
          buildMockBranchFetchResult(params, resolvedResult),
        );
        promises.push(promise);
        return promise;
      }
      const promise = new Promise<FetchPivotBranchResult>(resolve => {
        resolvers.push(result =>
          resolve(buildMockBranchFetchResult(params, result)),
        );
      });
      promises.push(promise);
      return promise;
    };
    return {
      implementation,
      promises,
      resolveAll: (result: Partial<FetchPivotBranchResult>) => {
        resolvedResult = result;
        resolvers.splice(0).forEach(resolve => resolve(result));
      },
    };
  };

  const getLastExpansionState = (setControlValue: jest.Mock) => {
    const calls = setControlValue.mock.calls.filter(
      call => call[0] === 'pivotExpansionState',
    );
    return calls[calls.length - 1]?.[1] as PivotExpansionState | undefined;
  };

  const getExpansionStates = (setControlValue: jest.Mock) =>
    setControlValue.mock.calls
      .filter(call => call[0] === 'pivotExpansionState')
      .map(call => call[1])
      .filter(Boolean) as PivotExpansionState[];

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

  const buildBootstrapTree = (
    rowGroupbyOverride: QueryFormColumn[] = rowGroupby,
    colGroupbyOverride: QueryFormColumn[] = [],
    metricsOverride: PivotTableQueryFormData['metrics'] = metrics,
  ): PivotTreeData =>
    applyMetricAxis(
      buildTreeFromRecords(
        [],
        metricsOverride,
        rowGroupbyOverride,
        colGroupbyOverride,
        0,
        0,
      ),
      metricsOverride,
      MetricsLayoutEnum.COLUMNS,
      rowGroupbyOverride,
      colGroupbyOverride,
    );

  const waitForLabel = async (label: string) => {
    await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
  };

  const waitForValueCell = async () => {
    await waitFor(() =>
      expect(
        document.querySelector('td.value-cell[role="button"]'),
      ).not.toBeNull(),
    );
  };

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
    persistExpansionState = true,
    omitPersistExpansionState = false,
    metricsOverride,
    factBatches,
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
    persistExpansionState?: boolean;
    omitPersistExpansionState?: boolean;
    metricsOverride?: PivotTableQueryFormData['metrics'];
    factBatches?: PivotFactStoreBatch[];
  }) => {
    const metricsValue = metricsOverride ?? metrics;
    const groupbyRowsValue = groupbyRowsOverride ?? rowGroupby;
    const groupbyColumnsValue = groupbyColumnsOverride ?? [];
    const formDataGroupbyColumnsValue =
      formDataGroupbyColumnsOverride ?? groupbyColumnsValue;
    const formData = buildFormData({
      groupbyRows: groupbyRowsValue,
      groupbyColumns: formDataGroupbyColumnsValue,
      metrics: metricsValue,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      startCollapsed: true,
      initialDepth: 1,
      expandRowsLevel: 0,
      expandColumnsLevel: 0,
      colTotals: false,
      rowTotals: false,
      rowSubTotals: false,
      ...formDataOverrides,
    });
    const persistExpansionStateProps =
      omitPersistExpansionState || persistExpansionState === undefined
        ? {}
        : { persistExpansionState };
    return (
      <PivotTableChart
        data={data}
        formData={formData}
        metrics={metricsValue}
        groupbyRows={groupbyRowsValue}
        groupbyColumns={groupbyColumnsValue}
        aggregateFunction="Sum"
        width={600}
        height={300}
        startCollapsed={formData.startCollapsed}
        initialDepth={formData.initialDepth}
        colTotals={formData.colTotals}
        rowTotals={formData.rowTotals}
        rowSubTotals={formData.rowSubTotals}
        rowSubtotalLevels={formData.rowSubtotalLevels}
        colSubtotalLevels={formData.colSubtotalLevels}
        metricsLayout={formData.metricsLayout}
        {...persistExpansionStateProps}
        ownState={ownState}
        setDataMask={setDataMask || jest.fn()}
        setControlValue={setControlValue}
        emitCrossFilters={emitCrossFilters}
        factBatches={factBatches}
      />
    );
  };

  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
    fetchPivotBranchMock.mockImplementation(resolveMockBranchFetchResult());
    fetchPivotBranchesBatchMock.mockReset();
    fetchPivotBranchesBatchMock.mockImplementation(resolveBatchWithSingles);
  });

  it('stores expansion state via setControlValue when toggled', async () => {
    const setControlValue = jest.fn();
    render(buildChartProps({ data: buildTree(1), setControlValue }));

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    const lastCall = setControlValue.mock.calls.slice(-1)[0];
    expect(lastCall?.[0]).toBe('pivotExpansionState');
    expect(lastCall?.[1]?.rows).toContainEqual(['A']);
  });

  it('defaults to persisting expansion state via setControlValue in Explore', async () => {
    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTree(1),
        setDataMask,
        setControlValue,
        omitPersistExpansionState: true,
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    expect(setDataMask).not.toHaveBeenCalled();
  });

  it('persists expansion state via setControlValue when available', async () => {
    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTree(1),
        setDataMask,
        setControlValue,
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    expect(setDataMask).not.toHaveBeenCalled();
    const lastCall = setControlValue.mock.calls.slice(-1)[0];
    expect(lastCall?.[0]).toBe('pivotExpansionState');
    expect(lastCall?.[1]).toMatchObject({
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A']],
      cols: [],
    });
  });

  it('persists column expansions via setControlValue in Explore', async () => {
    const colGroupby = ['c1', 'c2'];
    const recordsWithCols = [
      { r1: 'A', r2: 'X', c1: 'C', c2: 'U', m1: 10 },
      { r1: 'A', r2: 'Y', c1: 'C', c2: 'V', m1: 12 },
      { r1: 'B', r2: 'X', c1: 'D', c2: 'W', m1: 15 },
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
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: buildTreeWithCols(1, 2) }),
    );

    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTreeWithCols(1, 1),
        setDataMask,
        setControlValue,
        groupbyColumnsOverride: colGroupby,
        formDataGroupbyColumnsOverride: colGroupby,
      }),
    );

    await waitForLabel('C');
    const colLabel = screen.getByText('C');
    const colCell = colLabel.closest('th');
    expect(colCell).not.toBeNull();
    const toggle = colCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    expect(setDataMask).not.toHaveBeenCalled();
    const lastCall = setControlValue.mock.calls.slice(-1)[0];
    expect(lastCall?.[1]).toMatchObject({
      rowKeys: rowGroupby,
      colKeys: colGroupby,
      cols: [['C']],
    });
  });

  it('persists row and column expansions when both axes are expanded', async () => {
    const colGroupby = ['c1', 'c2'];
    const recordsWithCols = [
      { r1: 'A', r2: 'X', c1: 'C', c2: 'U', m1: 10 },
      { r1: 'A', r2: 'Y', c1: 'C', c2: 'V', m1: 12 },
      { r1: 'B', r2: 'X', c1: 'D', c2: 'W', m1: 15 },
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
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: buildTreeWithCols(2, 2) }),
    );

    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTreeWithCols(1, 1),
        setControlValue,
        groupbyColumnsOverride: colGroupby,
        formDataGroupbyColumnsOverride: colGroupby,
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    const firstCallCount = setControlValue.mock.calls.length;

    const colLabel = screen.getByText('C');
    const colCell = colLabel.closest('th');
    expect(colCell).not.toBeNull();
    const colToggle = colCell?.querySelector('button');
    expect(colToggle).not.toBeNull();
    fireEvent.click(colToggle as HTMLButtonElement);

    await waitFor(() =>
      expect(setControlValue.mock.calls.length).toBeGreaterThan(firstCallCount),
    );
    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState?.rows).toContainEqual(['A']);
    expect(expansionState?.cols).toContainEqual(['C']);
  });

  it('does not persist collapsed keys when auto-expand is disabled', async () => {
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTree(2),
        setControlValue,
        formDataOverrides: { expandRowsLevel: 0, startCollapsed: true },
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());

    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => {
      const expansionState = getLastExpansionState(setControlValue);
      expect(expansionState).toBeDefined();
      expect(expansionState?.rows).not.toContainEqual(['A']);
      expect(expansionState?.collapsedRows).toEqual([]);
    });
  });

  it('persists expansion state via setControlValue on dashboards', async () => {
    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTree(1),
        setDataMask,
        setControlValue,
        persistExpansionState: true,
        formDataOverrides: { dashboardId: 1 },
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    expect(setDataMask).not.toHaveBeenCalled();
  });

  it('persists expansion state via setDataMask when setControlValue is unavailable', async () => {
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: buildTree(2) }),
    );
    const setDataMask = jest.fn();
    render(
      buildChartProps({
        data: buildTree(1),
        setDataMask,
        persistExpansionState: true,
        formDataOverrides: { dashboardId: 1 },
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setDataMask).toHaveBeenCalled());
    const lastCall = setDataMask.mock.calls.slice(-1)[0];
    const ownState = lastCall?.[0]?.ownState as Record<string, unknown>;
    const persisted = ownState?.pivotExpansionState as PivotExpansionState;
    expect(persisted).toMatchObject({
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A']],
      cols: [],
    });
  });

  it('persists expansion state via setControlValue in user-controlled dashboard mode', async () => {
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: buildTree(2) }),
    );
    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: rowGroupby,
      cols: [],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    render(
      buildChartProps({
        data: buildTree(1),
        setDataMask,
        setControlValue,
        persistExpansionState: true,
        formDataOverrides: {
          dashboardId: 1,
          interactionMode: 'user_controlled',
          dimensions: rowGroupby,
          groupbyRows: [],
          groupbyColumns: [],
          metrics,
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          pivotRuntimeLayout: runtimeLayout,
        },
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    expect(setDataMask).not.toHaveBeenCalled();
    const persisted = getLastExpansionState(setControlValue);
    expect(persisted).toMatchObject({
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A']],
      cols: [],
    });
  });

  it('restores expansion state on dashboard refresh via pivotExpansionState', async () => {
    const setControlValue = jest.fn();
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: buildTree(2) }),
    );

    const { rerender } = render(
      buildChartProps({
        data: buildTree(1),
        setControlValue,
        formDataOverrides: { dashboardId: 1 },
      }),
    );

    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    const pivotExpansionState = getLastExpansionState(setControlValue);
    expect(pivotExpansionState).toBeDefined();

    fetchPivotBranchMock.mockClear();
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: buildTree(2) }),
    );

    rerender(
      buildChartProps({
        data: buildBootstrapTree(),
        setControlValue,
        formDataOverrides: {
          dashboardId: 1,
          pivotExpansionState,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
  });

  it('persists expanded column keys after fetching deeper column nodes', async () => {
    const colGroupby = ['c1', 'c2'];
    const recordsWithCols = [
      { r1: 'A', r2: 'X', c1: 'C', c2: 'U', m1: 10 },
      { r1: 'A', r2: 'Y', c1: 'C', c2: 'V', m1: 12 },
      { r1: 'B', r2: 'X', c1: 'D', c2: 'W', m1: 15 },
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

    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: buildTreeWithCols(1, 2) }),
    );
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTreeWithCols(1, 1),
        setControlValue,
        groupbyColumnsOverride: colGroupby,
        formDataGroupbyColumnsOverride: colGroupby,
      }),
    );

    await waitForLabel('C');
    const colLabel = screen.getByText('C');
    const colCell = colLabel.closest('th');
    expect(colCell).not.toBeNull();
    const toggle = colCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState?.cols).toContainEqual(['C']);
  });

  it('merges expansion state with existing ownState updates', async () => {
    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTree(2),
        setDataMask,
        setControlValue,
        emitCrossFilters: true,
      }),
    );

    await waitForValueCell();
    const valueCell = document.querySelector('td.value-cell[role="button"]');
    expect(valueCell).not.toBeNull();
    fireEvent.click(valueCell as HTMLTableCellElement);

    await waitFor(() => expect(setDataMask).toHaveBeenCalled());
    const firstCall = setDataMask.mock.calls[setDataMask.mock.calls.length - 1];
    const firstOwnState = firstCall?.[0]?.ownState as Record<string, unknown>;
    const treeDataSignature = firstOwnState?.treeDataSignature;
    expect(treeDataSignature).toBeDefined();

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(setControlValue).toHaveBeenCalled());
    expect(setDataMask.mock.calls.length).toBe(1);
    const lastExpansionState = getLastExpansionState(setControlValue);
    expect(lastExpansionState?.rows).toContainEqual(['A']);
  });

  it('merges expansion state into ownState when persisting via setDataMask', async () => {
    const setDataMask = jest.fn();
    render(
      buildChartProps({
        data: buildTree(2),
        setDataMask,
        emitCrossFilters: true,
      }),
    );

    await waitForValueCell();
    const valueCell = document.querySelector('td.value-cell[role="button"]');
    expect(valueCell).not.toBeNull();
    fireEvent.click(valueCell as HTMLTableCellElement);

    await waitFor(() => expect(setDataMask).toHaveBeenCalled());
    const firstCall = setDataMask.mock.calls[setDataMask.mock.calls.length - 1];
    const firstOwnState = firstCall?.[0]?.ownState as Record<string, unknown>;
    const treeDataSignature = firstOwnState?.treeDataSignature;
    expect(treeDataSignature).toBeDefined();

    await waitForLabel('A');
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
    const persisted = lastOwnState?.pivotExpansionState as PivotExpansionState;
    expect(lastOwnState?.treeDataSignature).toBe(treeDataSignature);
    expect(persisted?.rows).toContainEqual(['A']);
  });

  it('keeps expanded rows visible across data refresh without setControlValue', async () => {
    const setDataMask = jest.fn();
    const baseTree = buildTree(1);
    const expandedTree = buildTree(2);
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: expandedTree }),
    );

    const { rerender } = render(
      buildChartProps({
        data: baseTree,
        setDataMask,
        persistExpansionState: true,
        formDataOverrides: { dashboardId: 1 },
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

    fetchPivotBranchMock.mockClear();
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: expandedTree }),
    );

    rerender(
      buildChartProps({
        data: buildTree(1),
        setDataMask,
        persistExpansionState: true,
        formDataOverrides: { dashboardId: 1, time_range: 'Last week' },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
  });

  it('restores expansion state by fetching expanded branches', async () => {
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A']],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: buildTree(2) }),
    );

    render(
      buildChartProps({
        data: buildBootstrapTree(),
        formDataOverrides: { pivotExpansionState },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
  });

  it('restores expansion state from form data persistence', async () => {
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: buildTree(2) }),
    );

    render(
      buildChartProps({
        data: buildBootstrapTree(),
        setControlValue: jest.fn(),
        formDataOverrides: {
          pivotExpansionState: {
            rowKeys: rowGroupby,
            colKeys: [],
            rows: [['A']],
            cols: [],
            collapsedRows: [],
            collapsedCols: [],
          },
        },
      }),
    );

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

    await waitForLabel('A');
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

    await waitFor(() =>
      expect(getExpansionStates(setControlValue).length).toBeGreaterThan(0),
    );
    const expansionState =
      getExpansionStates(setControlValue).slice(-1)[0] ||
      ({} as PivotExpansionState);
    expect(expansionState.rows).not.toContainEqual(['A']);
    expect(expansionState.rows).not.toContainEqual(['A', 'X']);
  });

  it('persists expansion state via setControlValue on toggle', async () => {
    const setControlValue = jest.fn();
    render(
      buildChartProps({
        data: buildTree(2),
        setControlValue,
      }),
    );
    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const toggle = rowCell?.querySelector('button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() =>
      expect(getLastExpansionState(setControlValue)).toBeDefined(),
    );
    const expansionState = getLastExpansionState(
      setControlValue,
    ) as PivotExpansionState;
    expect(expansionState.rows).toContainEqual(['A']);
  });

  it('persists nested expansion state via setControlValue on toggle', async () => {
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

    await waitForLabel('A');
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

    await waitFor(() =>
      expect(getExpansionStates(setControlValue).length).toBeGreaterThan(0),
    );
    const expansionState = getExpansionStates(setControlValue).slice(
      -1,
    )[0] as PivotExpansionState;
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
    const midTree = buildTreeWithDepth(2);
    const deepTree = buildTreeWithDepth(3);
    fetchPivotBranchMock
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: midTree }))
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: deepTree }));

    const shallowTree = buildTreeWithDepth(1);
    const { rerender } = render(
      buildChartProps({
        data: shallowTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
      }),
    );

    await waitForLabel('A');
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
    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());

    const expansionState = getExpansionStates(setControlValue).slice(
      -1,
    )[0] as PivotExpansionState;
    expect(expansionState.rows).toEqual(
      expect.arrayContaining([['A'], ['A', 'X']]),
    );

    fetchPivotBranchMock.mockClear();
    fetchPivotBranchMock
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: midTree }))
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: deepTree }));

    const shallowTreeNext = buildBootstrapTree(deepGroupby);
    rerender(
      buildChartProps({
        data: shallowTreeNext,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: { pivotExpansionState: expansionState },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const fetchedPaths = fetchPivotBranchMock.mock.calls.map(call =>
      JSON.stringify(call[0].path),
    );
    expect(fetchedPaths).toContain(JSON.stringify([]));
    expect(fetchedPaths).toContain(JSON.stringify(['A', 'X']));
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());
  });

  it('keeps expanded rows when groupby labels change', async () => {
    const setControlValue = jest.fn();
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
        setControlValue,
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState).toBeDefined();

    rerender(
      buildChartProps({
        data: renamedTree,
        groupbyRowsOverride: groupbyRenamed,
        setControlValue,
        formDataOverrides: {
          pivotExpansionState: expansionState || undefined,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getAllByText('X').length).toBeGreaterThan(0),
    );
  });

  it('keeps expanded rows when metrics change', async () => {
    const setControlValue = jest.fn();
    const metricsNext = ['m1', 'm2'];
    const metricRecords = [
      { r1: 'A', r2: 'X', m1: 10, m2: 20 },
      { r1: 'A', r2: 'Y', m1: 12, m2: 24 },
      { r1: 'B', r2: 'X', m1: 15, m2: 30 },
    ];
    const buildTreeForMetrics = (
      rowDepth: number,
      metricList: PivotTableQueryFormData['metrics'],
    ) =>
      applyMetricAxis(
        buildTreeFromRecords(
          metricRecords,
          metricList,
          rowGroupby,
          [],
          rowDepth,
          0,
        ),
        metricList,
        MetricsLayoutEnum.COLUMNS,
        rowGroupby,
        [],
      );

    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({
        data: buildTreeForMetrics(2, metrics),
      }),
    );

    const { rerender } = render(
      buildChartProps({
        data: buildTreeForMetrics(1, metrics),
        setControlValue,
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState).toBeDefined();

    fetchPivotBranchMock.mockClear();
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({
        data: buildTreeForMetrics(2, metricsNext),
      }),
    );

    rerender(
      buildChartProps({
        data: buildTreeForMetrics(1, metricsNext),
        setControlValue,
        formDataOverrides: {
          pivotExpansionState: expansionState || undefined,
        },
        metricsOverride: metricsNext,
      }),
    );

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
  });

  it('keeps expanded rows when appending a groupby row', async () => {
    const setControlValue = jest.fn();
    const baseGroupby = ['r1', 'r2'];
    const appendedGroupby = ['r1', 'r2', 'r3'];
    const extendedRecords = [
      { r1: 'A', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', r2: 'Y', r3: 'II', m1: 12 },
      { r1: 'B', r2: 'Z', r3: 'III', m1: 15 },
    ];
    const buildTreeForGroupby = (
      groupby: QueryFormColumn[],
      rowDepth: number,
    ) =>
      applyMetricAxis(
        buildTreeFromRecords(
          extendedRecords,
          metrics,
          groupby,
          [],
          rowDepth,
          0,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        groupby,
        [],
      );

    const { rerender } = render(
      buildChartProps({
        data: buildTreeForGroupby(baseGroupby, 2),
        setControlValue,
        groupbyRowsOverride: baseGroupby,
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState).toBeDefined();

    rerender(
      buildChartProps({
        data: buildTreeForGroupby(appendedGroupby, 2),
        setControlValue,
        groupbyRowsOverride: appendedGroupby,
        formDataOverrides: {
          pivotExpansionState: expansionState || undefined,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    expect(screen.queryByText('I')).not.toBeInTheDocument();

    const nestedCell = screen.getByText('X').closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
  });

  it('prunes deeper expansions when inserting a groupby row', async () => {
    const setControlValue = jest.fn();
    const baseGroupby = ['r1', 'r2', 'r3'];
    const insertedGroupby = ['r1', 'rNew', 'r2', 'r3'];
    const insertedRecords = [
      { r1: 'A', rNew: 'N1', r2: 'X', r3: 'I', m1: 10 },
      { r1: 'A', rNew: 'N1', r2: 'Y', r3: 'II', m1: 12 },
      { r1: 'B', rNew: 'N2', r2: 'Z', r3: 'III', m1: 15 },
    ];
    const buildTreeForGroupby = (
      groupby: QueryFormColumn[],
      rowDepth: number,
    ) =>
      applyMetricAxis(
        buildTreeFromRecords(
          insertedRecords,
          metrics,
          groupby,
          [],
          rowDepth,
          0,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        groupby,
        [],
      );

    const { rerender } = render(
      buildChartProps({
        data: buildTreeForGroupby(baseGroupby, 3),
        setControlValue,
        groupbyRowsOverride: baseGroupby,
      }),
    );

    await waitForLabel('A');
    const rowLabel = screen.getByText('A');
    const rowCell = rowLabel.closest('th');
    expect(rowCell).not.toBeNull();
    const rowToggle = rowCell?.querySelector('button');
    expect(rowToggle).not.toBeNull();
    fireEvent.click(rowToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());

    const nestedCell = screen.getByText('X').closest('th');
    expect(nestedCell).not.toBeNull();
    const nestedToggle = nestedCell?.querySelector('button');
    expect(nestedToggle).not.toBeNull();
    fireEvent.click(nestedToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('I')).toBeInTheDocument());

    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState).toBeDefined();

    rerender(
      buildChartProps({
        data: buildTreeForGroupby(insertedGroupby, 2),
        setControlValue,
        groupbyRowsOverride: insertedGroupby,
        formDataOverrides: {
          pivotExpansionState: expansionState || undefined,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('N1')).toBeInTheDocument());
    expect(screen.queryByText('X')).not.toBeInTheDocument();
  });

  it('keeps expanded columns when appending a groupby column', async () => {
    const setControlValue = jest.fn();
    const rowGroupby = ['r1'];
    const baseColGroupby = ['c1', 'c2'];
    const appendedColGroupby = ['c1', 'c2', 'c3'];
    const extendedRecords = [
      { r1: 'A', c1: 'C', c2: 'U', c3: 'P', m1: 10 },
      { r1: 'B', c1: 'C', c2: 'U', c3: 'Q', m1: 12 },
    ];
    const buildTreeForGroupby = (
      colGroupby: QueryFormColumn[],
      colDepth: number,
    ) =>
      applyMetricAxis(
        buildTreeFromRecords(
          extendedRecords,
          metrics,
          rowGroupby,
          colGroupby,
          1,
          colDepth,
        ),
        metrics,
        MetricsLayoutEnum.COLUMNS,
        rowGroupby,
        colGroupby,
      );

    const { rerender } = render(
      buildChartProps({
        data: buildTreeForGroupby(baseColGroupby, 2),
        setControlValue,
        groupbyRowsOverride: rowGroupby,
        groupbyColumnsOverride: baseColGroupby,
        formDataGroupbyColumnsOverride: baseColGroupby,
      }),
    );

    await waitForLabel('C');
    const colLabel = screen.getByText('C');
    const colCell = colLabel.closest('th');
    expect(colCell).not.toBeNull();
    const colToggle = colCell?.querySelector('button');
    expect(colToggle).not.toBeNull();
    fireEvent.click(colToggle as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('U')).toBeInTheDocument());

    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState).toBeDefined();

    rerender(
      buildChartProps({
        data: buildTreeForGroupby(appendedColGroupby, 2),
        setControlValue,
        groupbyRowsOverride: rowGroupby,
        groupbyColumnsOverride: appendedColGroupby,
        formDataGroupbyColumnsOverride: appendedColGroupby,
        formDataOverrides: {
          pivotExpansionState: expansionState || undefined,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('U')).toBeInTheDocument());
    expect(screen.queryByText('P')).not.toBeInTheDocument();
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
    const midTree = buildTreeWithDepth(2);
    const deepTree = buildTreeWithDepth(3);
    fetchPivotBranchMock
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: midTree }))
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: deepTree }));

    render(
      buildChartProps({
        data: buildBootstrapTree(deepGroupby),
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          pivotExpansionState: {
            rowKeys: deepGroupby,
            colKeys: [],
            rows: [['A'], ['A', 'X']],
            cols: [],
            collapsedRows: [],
            collapsedCols: [],
          },
          expandRowsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const fetchedPaths = fetchPivotBranchMock.mock.calls.map(call =>
      JSON.stringify(call[0].path),
    );
    expect(fetchedPaths).toContain(JSON.stringify([]));
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
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A'], ['B']],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          pivotExpansionState: cachedExpansionState,
          expandRowsLevel: 2,
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
          pivotExpansionState: cachedExpansionState,
          expandRowsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(screen.queryAllByText('X').length).toEqual(0));
  });

  it('ignores cached auto expansions when auto-expand is cleared to default', async () => {
    const cachedExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A'], ['B']],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };
    const { rerender } = render(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          pivotExpansionState: cachedExpansionState,
          expandRowsLevel: 2,
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
          pivotExpansionState: cachedExpansionState,
          expandRowsLevel: undefined,
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
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: deepTree }),
    );

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
    const expansionState = getLastExpansionState(setControlValue);
    expect(expansionState).toBeDefined();

    rerender(
      buildChartProps({
        data: deepTree,
        groupbyRowsOverride: deepGroupby,
        setControlValue,
        formDataOverrides: {
          pivotExpansionState: expansionState || undefined,
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
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
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: buildTreeWithDepth(2) }),
    );

    render(
      buildChartProps({
        data: buildTreeWithDepth(1),
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          pivotExpansionState: {
            rowKeys: deepGroupby,
            colKeys: [],
            rows: [['A'], ['A', 'X']],
            cols: [],
            collapsedRows: [],
            collapsedCols: [],
          },
          expandRowsLevel: 1,
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
        formDataOverrides: {
          pivotExpansionState: {
            rowKeys: rowGroupby,
            colKeys: [],
            rows: [['A'], ['A', 'X']],
            cols: [],
            collapsedRows: [],
            collapsedCols: [],
          },
          expandRowsLevel: 2,
          expandColumnsLevel: 0,
        },
        setControlValue,
      }),
    );

    await waitFor(() =>
      expect(getLastExpansionState(setControlValue)).toBeDefined(),
    );
    const clearedState = getLastExpansionState(setControlValue);
    expect(clearedState?.rows).toEqual([]);
    expect(clearedState?.collapsedRows).toEqual([]);

    rerender(
      buildChartProps({
        data: buildTree(2),
        formDataOverrides: {
          pivotExpansionState: clearedState || undefined,
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
        },
        setControlValue,
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
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: midTree }))
      .mockImplementationOnce(resolveMockBranchFetchResult({ data: deepTree }))
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: deepestTree }),
      );

    render(
      buildChartProps({
        data: shallowTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
        groupbyColumnsOverride: [],
        formDataGroupbyColumnsOverride: ['__MEASURES__'],
        formDataOverrides: {
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          colTotals: true,
          rowSubTotals: true,
          colTotalPosition: 'end',
          rowSubtotalPosition: 'start',
        },
      }),
    );

    await waitForLabel('A');
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
    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(3),
    );

    const expansionState = getExpansionStates(setControlValue).slice(
      -1,
    )[0] as PivotExpansionState;
    expect(expansionState.rows).toEqual(
      expect.arrayContaining([['A'], ['A', 'X'], ['A', 'X', 'I']]),
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
    fetchPivotBranchMock.mockImplementationOnce(
      resolveMockBranchFetchResult({ data: deepTree }),
    );

    render(
      buildChartProps({
        data: shallowTree,
        setControlValue,
        groupbyRowsOverride: deepGroupby,
        formDataOverrides: {
          expandRowsLevel: 2,
          rowSubTotals: true,
          rowSubtotalLevels: [subtotalDepth],
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

    const expansionState = getExpansionStates(setControlValue).slice(
      -1,
    )[0] as PivotExpansionState;
    expect(expansionState.rows).not.toContainEqual(['A', SUBTOTAL_TOKEN]);
  });

  it('does not refetch when persisted expansions are already in the tree', async () => {
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A']],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };
    const mergedTree = mergeTrees(buildTree(1), buildTree(2));

    render(
      buildChartProps({
        data: mergedTree,
        formDataOverrides: { pivotExpansionState },
        factBatches: buildPreloadedTreeFactBatches(mergedTree, {
          groupbyRows: rowGroupby,
          groupbyColumns: [],
        }),
      }),
    );

    await waitFor(() => expect(screen.getByText('X')).toBeInTheDocument());
    expect(fetchPivotBranchMock).not.toHaveBeenCalled();
  });

  it('does not show a global loader for persisted expansion prefetch', async () => {
    const deferred = createDeferredBranchFetch();
    fetchPivotBranchMock.mockImplementation(deferred.implementation);

    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A'], ['B']],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };

    render(
      buildChartProps({
        data: buildBootstrapTree(),
        formDataOverrides: { pivotExpansionState },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument();

    deferred.resolveAll({ data: buildTree(2) });
    await Promise.all(deferred.promises);

    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: /loading/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('does not show a global loader without persisted expansion state', async () => {
    const deferred = createDeferredBranchFetch();
    fetchPivotBranchMock.mockImplementation(deferred.implementation);

    render(
      buildChartProps({
        data: buildBootstrapTree(),
        formDataOverrides: {
          expandRowsLevel: 1,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument();

    deferred.resolveAll({ data: buildTree(1) });
    await Promise.all(deferred.promises);

    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: /loading/i }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
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
    const baseTree = buildBootstrapTree(rowGroupby, colGroupby, metrics);
    const rowBranch = buildTreeWithCols(2, 1);
    const colBranch = buildTreeWithCols(1, 2);

    const deferredRow = createDeferredBranchFetch();
    const deferredCol = createDeferredBranchFetch();
    fetchPivotBranchMock.mockImplementation(params =>
      params.axis === 'row'
        ? deferredRow.implementation(params)
        : deferredCol.implementation(params),
    );

    render(
      buildChartProps({
        data: baseTree,
        groupbyColumnsOverride: colGroupby,
        formDataGroupbyColumnsOverride: colGroupby,
        formDataOverrides: {
          pivotExpansionState: {
            rowKeys: rowGroupby,
            colKeys: colGroupby,
            rows: [['A']],
            cols: [['C']],
            collapsedRows: [],
            collapsedCols: [],
          },
          expandRowsLevel: 0,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    expect(deferredRow.promises.length).toBeGreaterThan(0);
    expect(deferredCol.promises.length).toBeGreaterThan(0);
    deferredRow.resolveAll({ data: rowBranch });
    deferredCol.resolveAll({ data: colBranch });
    await Promise.all([...deferredRow.promises, ...deferredCol.promises]);

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
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: buildTreeWithDepth(2, 2) }),
    );

    render(
      buildChartProps({
        data: buildBootstrapTree(deepRowGroupby, deepColGroupby, metrics),
        groupbyRowsOverride: deepRowGroupby,
        groupbyColumnsOverride: deepColGroupby,
        formDataGroupbyColumnsOverride: deepColGroupby,
        formDataOverrides: {
          pivotExpansionState: {
            rowKeys: deepRowGroupby,
            colKeys: deepColGroupby,
            rows: [['A'], ['A', 'X']],
            cols: [['C'], ['C', 'U']],
            collapsedRows: [],
            collapsedCols: [],
          },
          expandRowsLevel: 0,
          expandColumnsLevel: 1,
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
    expect(rowPaths).toEqual(
      expect.arrayContaining([JSON.stringify(['A', 'X'])]),
    );
    expect(colPaths).toEqual(
      expect.arrayContaining([JSON.stringify(['C']), JSON.stringify(['D'])]),
    );
    expect(colPaths).not.toContain(JSON.stringify(['C', 'U']));
  });

  it('prefetches auto-expand row level increases without redundant root queries', async () => {
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
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: deepTree }),
    );

    const { rerender } = render(
      buildChartProps({
        data: shallowTree,
        groupbyRowsOverride: deepGroupby,
        factBatches: buildPreloadedTreeFactBatches(shallowTree, {
          groupbyRows: deepGroupby,
          groupbyColumns: [],
        }),
        formDataOverrides: {
          expandRowsLevel: 2,
          expandColumnsLevel: 0,
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
        factBatches: buildPreloadedTreeFactBatches(shallowTree, {
          groupbyRows: deepGroupby,
          groupbyColumns: [],
        }),
        formDataOverrides: {
          expandRowsLevel: 3,
          expandColumnsLevel: 0,
        },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('r3-1')).toBeInTheDocument());
    const rowCalls = fetchPivotBranchMock.mock.calls.filter(
      ([args]) => args.axis === 'row',
    );
    expect(rowCalls).toHaveLength(2);
    const rowPaths = rowCalls.map(call => JSON.stringify(call[0].path));
    expect(rowPaths).toEqual(
      expect.arrayContaining([
        JSON.stringify(['A', 'X']),
        JSON.stringify(['B', 'Y']),
      ]),
    );
  });

  it('does not fetch missing leaf expansions', async () => {
    fetchPivotBranchMock.mockImplementation(
      resolveMockBranchFetchResult({ data: buildTree(2) }),
    );
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A'], ['A', 'X']],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };

    render(
      buildChartProps({
        data: buildBootstrapTree(),
        formDataOverrides: { pivotExpansionState },
      }),
    );

    await waitFor(() =>
      expect(fetchPivotBranchMock.mock.calls.length).toBeGreaterThanOrEqual(1),
    );
    const fetchedPaths = fetchPivotBranchMock.mock.calls.map(call =>
      JSON.stringify(call[0].path),
    );
    expect(fetchedPaths).not.toContain(JSON.stringify(['A', 'X']));
  });

  it('does not fetch persisted subtotal expansions', async () => {
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [['A', SUBTOTAL_TOKEN]],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };

    render(
      buildChartProps({
        data: buildTree(1),
        formDataOverrides: { pivotExpansionState },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).not.toHaveBeenCalled());
  });

  it('decodes null values when prefetching persisted expansions', async () => {
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [[null]],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };

    render(
      buildChartProps({
        data: buildTree(1),
        formDataOverrides: { pivotExpansionState },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual([null]);
  });

  it('decodes undefined values when prefetching persisted expansions', async () => {
    const undefinedPath = [undefined] as unknown as PivotPath;
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [undefinedPath],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };

    render(
      buildChartProps({
        data: buildTree(1),
        formDataOverrides: { pivotExpansionState },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual([undefined]);
  });

  it('handles PATH_DIVIDER values when prefetching persisted expansions', async () => {
    const dividerValue = `A${PATH_DIVIDER}B`;
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [[dividerValue]],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };

    render(
      buildChartProps({
        data: buildTree(1),
        formDataOverrides: { pivotExpansionState },
      }),
    );

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
    const pivotExpansionState = {
      rowKeys: rowGroupby,
      colKeys: [],
      rows: [[metricLikeValue]],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };

    render(
      buildChartProps({
        data: metricLikeTree,
        formDataOverrides: { pivotExpansionState },
      }),
    );

    await waitFor(() => expect(fetchPivotBranchMock).toHaveBeenCalled());
    const firstCall = fetchPivotBranchMock.mock.calls[0][0];
    expect(firstCall.path).toEqual([metricLikeValue]);
  });
});
