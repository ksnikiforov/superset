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
import { PivotRuntimeLayout, MetricsLayoutEnum } from '../../../../src/types';
import { mergeTrees } from '../../../../src/utils';
import {
  canProjectValueAxisShrinkWithoutFetch,
  factBatchesCoverRuntimeLayout,
  shouldSyncCommittedTreeFromProps,
} from '../../../../src/pivot/layout/committedTreeSyncGuard';
import { buildTreeFromRecords } from '../../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../../../../src/pivot/runtime/materializePivotTree';
import { buildFactCoverage } from '../../../../src/pivot/runtime/coverage';
import { type PivotFactStoreBatch } from '../../../../src/pivot/runtime/factStore';

describe('committedTreeSyncGuard', () => {
  const runtimeLayout: PivotRuntimeLayout = {
    version: 1,
    rows: ['row1'],
    cols: ['col1'],
    metrics: ['m1'],
    leafSelection: {},
    valuePlacement: { axis: 'col', index: 0 },
  };

  const factBatch = (
    rowDepth: number,
    columnDepth: number,
    scope: PivotFactStoreBatch['scope'] = { kind: 'bootstrap' },
  ): PivotFactStoreBatch => ({
    coverage: buildFactCoverage({
      reason: 'initial',
      rowDimensions: ['row1', 'row2'].slice(0, Math.max(rowDepth, 1)),
      columnDimensions: ['col1', 'col2'].slice(0, Math.max(columnDepth, 1)),
      rowDepth,
      columnDepth,
    }),
    scope,
    facts: [],
  });

  it('detects missing fact coverage when active runtime layout requires a column dimension', () => {
    expect(
      factBatchesCoverRuntimeLayout([factBatch(1, 0)], runtimeLayout),
    ).toBe(false);
  });

  it('accepts exact bootstrap fact coverage for the active runtime layout', () => {
    expect(
      factBatchesCoverRuntimeLayout([factBatch(1, 1)], runtimeLayout),
    ).toBe(true);
  });

  it('does not treat deeper fact coverage as root runtime-layout coverage', () => {
    expect(
      factBatchesCoverRuntimeLayout([factBatch(2, 1)], runtimeLayout),
    ).toBe(false);
  });

  it('ignores branch coverage when checking root runtime-layout coverage', () => {
    expect(
      factBatchesCoverRuntimeLayout(
        [factBatch(1, 1, { kind: 'branch', axis: 'row', path: ['A'] })],
        runtimeLayout,
      ),
    ).toBe(false);
  });

  it('allows sync when runtime layout and selected filters match committed state', () => {
    const shouldSync = shouldSyncCommittedTreeFromProps({
      isUserControlled: true,
      isDashboardContext: true,
      hasLocalSyncForCurrentDashboardQueryContext: false,
      hasPersistedInteractionFilters: false,
      runtimeLayoutMatchesCommitted: true,
      selectedFiltersMatchCommitted: true,
    });

    expect(shouldSync).toBe(true);
  });

  it('blocks dashboard props sync when local interaction already synced current dashboard query context', () => {
    const shouldSync = shouldSyncCommittedTreeFromProps({
      isUserControlled: true,
      isDashboardContext: true,
      hasLocalSyncForCurrentDashboardQueryContext: true,
      hasPersistedInteractionFilters: false,
      runtimeLayoutMatchesCommitted: true,
      selectedFiltersMatchCommitted: true,
    });

    expect(shouldSync).toBe(false);
  });

  it('requires a fetch when multi-metric trailing Values columns collapse without cached parent cells', () => {
    const metrics = ['m1', 'm2'];
    const records = [
      { row1: 'A', col1: 'X', m1: 10, m2: 20 },
      { row1: 'B', col1: 'Y', m1: 30, m2: 40 },
    ];
    const tree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, ['row1'], ['col1'], 1, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1'],
      1,
    );
    const prevLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: ['col1'],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 1 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: [],
      valuePlacement: { axis: 'col', index: 0 },
    };

    expect(
      canProjectValueAxisShrinkWithoutFetch({
        tree,
        prev: prevLayout,
        next: nextLayout,
      }),
    ).toBe(false);
  });

  it('reuses cached parent cells when multi-metric trailing Values columns shrink from 2 levels to 1', () => {
    const metrics = ['m1', 'm2'];
    const records = [
      { row1: 'A', col1: 'X', col2: 'P', m1: 10, m2: 20 },
      { row1: 'B', col1: 'Y', col2: 'Q', m1: 30, m2: 40 },
    ];
    const deepTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, ['row1'], ['col1', 'col2'], 1, 2),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1', 'col2'],
      2,
    );
    const cachedParentTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, ['row1'], ['col1'], 1, 1),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1'],
      1,
    );
    const prevLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: ['col1', 'col2'],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 1 },
    };

    expect(
      canProjectValueAxisShrinkWithoutFetch({
        tree: mergeTrees(deepTree, cachedParentTree),
        prev: prevLayout,
        next: nextLayout,
      }),
    ).toBe(true);
  });

  it('requires a fetch when multi-metric trailing Values columns shrink with only partial parent coverage', () => {
    const metrics = ['m1', 'm2'];
    const records = [
      { row1: 'A', col1: 'X', col2: 'P', m1: 10, m2: 20 },
      { row1: 'B', col1: 'Y', col2: 'Q', m1: 30, m2: 40 },
    ];
    const deepTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, ['row1'], ['col1', 'col2'], 1, 2),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1', 'col2'],
      2,
    );
    const partialParentTree = applyMetricAxis(
      buildTreeFromRecords(
        [{ row1: 'A', col1: 'X', m1: 10, m2: 20 }],
        metrics,
        ['row1'],
        ['col1'],
        1,
        1,
      ),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      ['row1'],
      ['col1'],
      1,
    );
    const prevLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1'],
      cols: ['col1', 'col2'],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      cols: ['col1'],
      valuePlacement: { axis: 'col', index: 1 },
    };

    expect(
      canProjectValueAxisShrinkWithoutFetch({
        tree: mergeTrees(deepTree, partialParentTree),
        prev: prevLayout,
        next: nextLayout,
      }),
    ).toBe(false);
  });

  it('requires a fetch when multi-metric trailing Values rows shrink with only partial parent coverage', () => {
    const metrics = ['m1', 'm2'];
    const records = [
      { row1: 'A', row2: 'P', col1: 'X', m1: 10, m2: 20 },
      { row1: 'B', row2: 'Q', col1: 'Y', m1: 30, m2: 40 },
    ];
    const deepTree = applyMetricAxis(
      buildTreeFromRecords(records, metrics, ['row1', 'row2'], ['col1'], 2, 1),
      metrics,
      MetricsLayoutEnum.ROWS,
      ['row1', 'row2'],
      ['col1'],
      2,
    );
    const partialParentTree = applyMetricAxis(
      buildTreeFromRecords(
        [{ row1: 'A', col1: 'X', m1: 10, m2: 20 }],
        metrics,
        ['row1'],
        ['col1'],
        1,
        1,
      ),
      metrics,
      MetricsLayoutEnum.ROWS,
      ['row1'],
      ['col1'],
      1,
    );
    const prevLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['row1', 'row2'],
      cols: ['col1'],
      metrics,
      leafSelection: {},
      valuePlacement: { axis: 'row', index: 2 },
    };
    const nextLayout: PivotRuntimeLayout = {
      ...prevLayout,
      rows: ['row1'],
      valuePlacement: { axis: 'row', index: 1 },
    };

    expect(
      canProjectValueAxisShrinkWithoutFetch({
        tree: mergeTrees(deepTree, partialParentTree),
        prev: prevLayout,
        next: nextLayout,
      }),
    ).toBe(false);
  });
});
