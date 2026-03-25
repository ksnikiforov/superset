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
} from '../../../../src/types';
import { serializePath } from '../../../../src/utils';
import {
  shouldSyncCommittedTreeFromProps,
  treeHasStaleCoverageRegression,
  treeHasRuntimeLayoutCoverage,
} from '../../../../src/pivot/layout/committedTreeSyncGuard';

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
});
