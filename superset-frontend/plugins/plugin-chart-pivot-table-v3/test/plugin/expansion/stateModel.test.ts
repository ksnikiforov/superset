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

import { PivotTreeNode } from '../../../src/types';
import {
  coerceExpansionState,
  pruneExpandedToStablePrefix,
  seedExpandedByLevel,
  stripAutoSeededExpansions,
} from '../../../src/pivot/expansion/stateModel';
import {
  encodeMetricKey,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { serializePath } from '../../../src/pivot/core/path';
import { rootKey } from '../../../src/pivot/viewModel';

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
  it('coerces persisted expansion state and drops subtotal tokens', () => {
    const expansionState = coerceExpansionState({
      rowKeys: ['r1'],
      colKeys: ['c1'],
      rows: [['A'], ['B'], ['A', SUBTOTAL_TOKEN]],
      cols: [['X'], ['Y'], ['X', SUBTOTAL_TOKEN]],
      collapsedRows: [['A', 'Z'], [SUBTOTAL_TOKEN]],
      collapsedCols: [['X', 'Z']],
    });

    expect(expansionState).toEqual({
      rowKeys: ['r1'],
      colKeys: ['c1'],
      rows: [serializePath(['A']), serializePath(['B'])],
      cols: [serializePath(['X']), serializePath(['Y'])],
      collapsedRows: [serializePath(['A', 'Z'])],
      collapsedCols: [serializePath(['X', 'Z'])],
    });
  });

  it('returns undefined when expansion state is malformed', () => {
    expect(coerceExpansionState(null)).toBeUndefined();
    expect(
      coerceExpansionState({
        rowKeys: ['r1'],
        colKeys: ['c1'],
        rows: [],
        cols: 'nope',
      }),
    ).toBeUndefined();
    expect(coerceExpansionState({ rows: [], cols: [] })).toBeUndefined();
  });

  it('seeds expansion keys by depth and supports metric depth zero', () => {
    const metricToken = encodeMetricKey('m1');
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      A: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
      B: makeNode({ axis: 'row', path: ['B'] }),
      [metricToken]: makeNode({ axis: 'row', path: [metricToken] }),
    };
    const metricLabels = new Set<string>(['m1']);

    const expanded = seedExpandedByLevel(nodes, 1, metricLabels);
    expect(expanded.has(rootKey)).toBe(true);
    expect(expanded.has(serializePath(['A']))).toBe(true);
    expect(expanded.has(serializePath(['B']))).toBe(true);
    expect(expanded.has(metricToken)).toBe(false);

    const metricExpanded = seedExpandedByLevel(nodes, 0, metricLabels, {
      includeMetricDepthZero: true,
    });
    expect(metricExpanded.has(rootKey)).toBe(true);
    expect(metricExpanded.has(metricToken)).toBe(true);
  });

  it('strips auto-seeded expansions when they match the seeded set', () => {
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      A: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
      B: makeNode({ axis: 'row', path: ['B'] }),
    };
    const keys = [serializePath(['A']), serializePath(['B'])];
    const result = stripAutoSeededExpansions({
      keys,
      collapsedKeys: [],
      nodes,
      metricLabelSet: new Set(),
      includeMetricDepthZero: false,
    });
    expect(result).toEqual({ keys: [], collapsedKeys: [] });
  });

  it('keeps explicit expansions when collapsed keys are present', () => {
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
      A: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
    };
    const keys = [serializePath(['A'])];
    const result = stripAutoSeededExpansions({
      keys,
      collapsedKeys: [serializePath(['A'])],
      nodes,
      metricLabelSet: new Set(),
      includeMetricDepthZero: false,
    });
    expect(result).toEqual({
      keys,
      collapsedKeys: [serializePath(['A'])],
    });
  });

  it('prunes expansions to the stable prefix depth', () => {
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
});
