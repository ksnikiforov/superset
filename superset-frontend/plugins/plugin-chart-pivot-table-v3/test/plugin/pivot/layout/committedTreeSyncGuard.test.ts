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
import {
  PivotRuntimeLayout,
  PivotTreeData,
  PivotTreeNode,
  MetricsLayoutEnum,
} from '../../../../src/types';
import { mergeTrees, serializePath } from '../../../../src/utils';
import {
  canProjectValueAxisShrinkWithoutFetch,
  shouldSyncCommittedTreeFromProps,
  treeHasStaleCoverageRegression,
  treeHasRuntimeLayoutCoverage,
} from '../../../../src/pivot/layout/committedTreeSyncGuard';
import { buildTreeFromRecords } from '../../../../src/pivot/core/tree';
import { applyMetricAxis } from '../../../../src/pivot/runtime/materializePivotTree';

const rootKey = serializePath([]);

const makeNode = (
  axis: 'row' | 'col',
  path: Array<string | number>,
): PivotTreeNode => {
  const key = serializePath(path);
  return {
    axis,
    key,
    path,
    label: String(path[path.length - 1] ?? 'Grand total'),
    formattedLabel: String(path[path.length - 1] ?? 'Grand total'),
    level: path.length,
    hasChildren: false,
  };
};

const makeTree = ({
  rowPaths,
  colPaths,
}: {
  rowPaths: Array<Array<string | number>>;
  colPaths: Array<Array<string | number>>;
}): PivotTreeData => {
  const rows: PivotTreeData['rows'] = {};
  const cols: PivotTreeData['cols'] = {};
  [[], ...rowPaths].forEach(path => {
    const node = makeNode('row', path);
    rows[node.key] = node;
  });
  [[], ...colPaths].forEach(path => {
    const node = makeNode('col', path);
    cols[node.key] = node;
  });
  return {
    rows,
    cols,
    cells: {
      [`${rootKey}|${rootKey}`]: {
        rowKey: rootKey,
        colKey: rootKey,
        values: { m1: 1 },
      },
    },
  };
};

describe('committedTreeSyncGuard', () => {
  const runtimeLayout: PivotRuntimeLayout = {
    version: 1,
    rows: ['row1'],
    cols: ['col1'],
    metrics: ['m1'],
    leafSelection: {},
    valuePlacement: { axis: 'col', index: 0 },
  };

  it('detects missing coverage when active runtime layout requires a column dimension', () => {
    const propsTree = makeTree({
      rowPaths: [['A']],
      colPaths: [],
    });

    expect(treeHasRuntimeLayoutCoverage(propsTree, runtimeLayout)).toBe(false);
  });

  it('accepts coverage when both required runtime dimensions exist in tree nodes', () => {
    const propsTree = makeTree({
      rowPaths: [['A']],
      colPaths: [['Red']],
    });

    expect(treeHasRuntimeLayoutCoverage(propsTree, runtimeLayout)).toBe(true);
  });

  it('blocks stale dashboard overwrite when incoming props tree loses runtime-layout coverage', () => {
    const shouldSync = shouldSyncCommittedTreeFromProps({
      isUserControlled: true,
      isDashboardContext: true,
      hasLocalSyncForCurrentDashboardQueryContext: false,
      hasPersistedInteractionFilters: false,
      runtimeLayoutMatchesCommitted: true,
      selectedFiltersMatchCommitted: true,
      propsTreeHasRequiredLeafSources: true,
      committedTreeHasRuntimeLayoutCoverage: true,
      propsTreeHasStaleCoverageRegression: true,
    });

    expect(shouldSync).toBe(false);
  });

  it('allows sync when incoming props tree still has runtime-layout coverage', () => {
    const shouldSync = shouldSyncCommittedTreeFromProps({
      isUserControlled: true,
      isDashboardContext: true,
      hasLocalSyncForCurrentDashboardQueryContext: false,
      hasPersistedInteractionFilters: false,
      runtimeLayoutMatchesCommitted: true,
      selectedFiltersMatchCommitted: true,
      propsTreeHasRequiredLeafSources: true,
      committedTreeHasRuntimeLayoutCoverage: true,
      propsTreeHasStaleCoverageRegression: false,
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
      propsTreeHasRequiredLeafSources: true,
      committedTreeHasRuntimeLayoutCoverage: true,
      propsTreeHasStaleCoverageRegression: false,
    });

    expect(shouldSync).toBe(false);
  });

  it('treats row-only non-empty tree as stale coverage regression for row+col layout', () => {
    const propsTree = makeTree({
      rowPaths: [['A']],
      colPaths: [],
    });

    expect(treeHasStaleCoverageRegression(propsTree, runtimeLayout)).toBe(true);
  });

  it('does not treat root-only tree as stale coverage regression', () => {
    const propsTree = makeTree({
      rowPaths: [],
      colPaths: [],
    });

    expect(treeHasStaleCoverageRegression(propsTree, runtimeLayout)).toBe(
      false,
    );
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
