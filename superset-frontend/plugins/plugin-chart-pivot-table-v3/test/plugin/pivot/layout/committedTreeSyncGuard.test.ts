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
  factBatchesCoverRuntimeLayout,
  shouldSyncCommittedTreeFromProps,
} from '../../../../src/pivot/layout/committedTreeSyncGuard';
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
});
