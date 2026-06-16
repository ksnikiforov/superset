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
  MetricsLayoutEnum,
  PivotTreeData,
  PivotTreeNode,
} from '../../../src/types';
import {
  buildDesiredExpandedKeys,
  coerceExpansionState,
  coerceExpansionStateForLayout,
  pruneExpandedToStablePrefix,
} from '../../../src/pivot/expansion/stateModel';
import { buildExpandedKeysForCoverageNeeds } from '../../../src/pivot/expansion/planner';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { serializePath } from '../../../src/pivot/core/path';
import { rootKey } from '../../../src/pivot/viewModel';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';

const makeNode = ({
  axis,
  path,
  hasChildren = false,
  label,
}: {
  axis: 'row' | 'col';
  path: PivotTreeNode['path'];
  hasChildren?: boolean;
  label?: string;
}): PivotTreeNode => ({
  axis,
  key: serializePath(path),
  path,
  label: label ?? String(path[path.length - 1] ?? 'Grand total'),
  formattedLabel: label ?? String(path[path.length - 1] ?? 'Grand total'),
  level: path.length,
  hasChildren,
  isSubtotal: false,
});

describe('expansionStateModel', () => {
  test('coerces persisted expansion state and drops subtotal tokens', () => {
    const expansionState = coerceExpansionState({
      rowKeys: ['r1'],
      colKeys: ['c1'],
      rows: [['A'], ['B'], ['A', SUBTOTAL_TOKEN]],
      cols: [['X'], ['Y'], ['X', SUBTOTAL_TOKEN]],
      collapsedRows: [['A', 'Z'], [SUBTOTAL_TOKEN]],
      collapsedCols: [['X', 'Z']],
    });

    expect(expansionState).toEqual({
      rows: [serializePath(['A']), serializePath(['B'])],
      cols: [serializePath(['X']), serializePath(['Y'])],
      collapsedRows: [serializePath(['A', 'Z'])],
      collapsedCols: [serializePath(['X', 'Z'])],
    });
  });

  test('returns undefined when expansion state is malformed', () => {
    expect(coerceExpansionState(null)).toBeUndefined();
    expect(
      coerceExpansionState({
        rowKeys: ['r1'],
        colKeys: ['c1'],
        rows: [],
        cols: 'nope',
      }),
    ).toBeUndefined();
    expect(coerceExpansionState({ rows: [], cols: [] })).toEqual({
      rows: [],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    });
  });

  test('rejects persisted expansion state without matching layout keys', () => {
    expect(
      coerceExpansionStateForLayout({
        value: { rows: [['A']], cols: [] },
        rowKeys: ['r1', 'r2'],
        colKeys: [],
      }),
    ).toBeUndefined();
    expect(
      coerceExpansionStateForLayout({
        value: {
          rowKeys: ['r1'],
          colKeys: [],
          rows: [['A']],
          cols: [],
        },
        rowKeys: ['r1', 'r2'],
        colKeys: [],
      }),
    ).toBeUndefined();
  });

  test('accepts persisted expansion state with matching layout keys', () => {
    expect(
      coerceExpansionStateForLayout({
        value: {
          rowKeys: ['r1', 'r2'],
          colKeys: [],
          rows: [['A']],
          cols: [],
        },
        rowKeys: ['r1', 'r2'],
        colKeys: [],
      }),
    ).toEqual({
      rows: [serializePath(['A'])],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    });
  });

  test('builds default expanded keys from coverage manifest needs', () => {
    const metricToken = encodeMetricKey('m1');
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      A: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
      B: makeNode({ axis: 'row', path: ['B'] }),
      [metricToken]: makeNode({ axis: 'row', path: [metricToken] }),
    };
    const program = compilePivotProgram({
      groupbyRows: [METRICS_PLACEHOLDER, 'country'],
      groupbyColumns: [],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.ROWS,
    });
    const tree = { rows: nodes, cols: {}, cells: {} };
    const baseExpanded = buildExpandedKeysForCoverageNeeds({
      axis: 'row',
      tree,
      axisCoverageNeeds: [
        {
          axis: 'row',
          depth: 1,
          scope: { kind: 'scopedFull', ancestorPaths: [[]] },
        },
      ],
      program,
    });
    const expanded = buildDesiredExpandedKeys({
      axis: 'row',
      nodes,
      baseExpanded,
      program,
      manualExpanded: new Set(),
      manualCollapsed: new Set(),
    });
    expect(expanded.has(rootKey)).toBe(true);
    expect(expanded.has(serializePath(['A']))).toBe(true);
    expect(expanded.has(serializePath(['B']))).toBe(true);
    expect(expanded.has(metricToken)).toBe(true);
  });

  test('prunes expansions to the stable prefix depth', () => {
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      A: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
      [serializePath(['A', 'X'])]: makeNode({
        axis: 'row',
        path: ['A', 'X'],
      }),
    };
    const expanded = new Set([
      rootKey,
      serializePath(['A']),
      serializePath(['A', 'X']),
    ]);
    const pruned = pruneExpandedToStablePrefix({
      expanded,
      nodes,
      stablePrefix: 1,
      metricLabelSet: new Set(),
    });
    expect(pruned).toEqual(new Set([rootKey, serializePath(['A'])]));
  });

  test('keeps collapsed branches closed when full-level coverage wants descendants', () => {
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
        A: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
        [serializePath(['A', 'a1'])]: makeNode({
          axis: 'row',
          path: ['A', 'a1'],
        }),
        B: makeNode({ axis: 'row', path: ['B'], hasChildren: true }),
        [serializePath(['B', 'b1'])]: makeNode({
          axis: 'row',
          path: ['B', 'b1'],
        }),
      },
      cols: { [rootKey]: makeNode({ axis: 'col', path: [] }) },
      cells: {},
    };
    const program = compilePivotProgram({
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['m1'],
    });
    const baseExpanded = buildExpandedKeysForCoverageNeeds({
      axis: 'row',
      tree,
      axisCoverageNeeds: [
        {
          axis: 'row',
          depth: 2,
          scope: { kind: 'scopedFull', ancestorPaths: [[]] },
        },
      ],
      program,
    });
    const expanded = buildDesiredExpandedKeys({
      axis: 'row',
      nodes: tree.rows,
      baseExpanded,
      program,
      manualExpanded: new Set([serializePath(['A'])]),
      manualCollapsed: new Set([serializePath(['B'])]),
    });

    expect(expanded).toEqual(
      new Set([rootKey, serializePath(['A']), serializePath(['A', 'a1'])]),
    );
  });
});
