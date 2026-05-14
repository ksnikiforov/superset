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
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../src/types';
import { resolveLayoutTransition } from '../../../src/pivot/expansion/stateTransitions';
import { rootKey } from '../../../src/pivot/viewModel';
import { serializeCellKey, serializePath } from '../../../src/utils';

const makeNode = ({
  axis,
  path,
  hasChildren = false,
}: {
  axis: PivotAxis;
  path: PivotTreeNode['path'];
  hasChildren?: boolean;
}): PivotTreeNode => ({
  axis,
  key: path.length === 0 ? rootKey : serializePath(path),
  path,
  label: path.length === 0 ? 'Total' : String(path[path.length - 1]),
  formattedLabel: path.length === 0 ? 'Total' : String(path[path.length - 1]),
  level: path.length,
  hasChildren,
});

const makeTree = ({
  rows,
  cols = [makeNode({ axis: 'col', path: [] })],
  cells = {},
}: {
  rows: PivotTreeNode[];
  cols?: PivotTreeNode[];
  cells?: PivotTreeData['cells'];
}): PivotTreeData => ({
  rows: Object.fromEntries(rows.map(node => [node.key, node])),
  cols: Object.fromEntries(cols.map(node => [node.key, node])),
  cells,
});

const baseTransitionConfig = {
  currentLayout: { rows: ['country'], cols: [] },
  previousLayout: { rows: ['country'], cols: [] },
  hasNewData: false,
  effectiveExpandRowsLevel: 0,
  effectiveExpandColsLevel: 0,
  groupbyRowsLength: 1,
  groupbyColumnsLength: 0,
};

describe('pivot/expansion/stateTransitions layout changes', () => {
  it('keeps the current tree as a display snapshot for layout changes without fresh data', () => {
    const usKey = serializePath(['US']);
    const usCaKey = serializePath(['US', 'CA']);
    const data = makeTree({
      rows: [
        makeNode({ axis: 'row', path: [] }),
        makeNode({ axis: 'row', path: ['US'] }),
      ],
    });
    const currentTree = makeTree({
      rows: [
        makeNode({ axis: 'row', path: [] }),
        makeNode({ axis: 'row', path: ['US'], hasChildren: true }),
        makeNode({ axis: 'row', path: ['US', 'CA'] }),
      ],
    });

    const transition = resolveLayoutTransition({
      ...baseTransitionConfig,
      data,
      currentTree,
      currentLayout: { rows: ['country', 'state'], cols: [] },
    });

    expect(transition.normalizedTree.rows[usKey]).toBeDefined();
    expect(transition.normalizedTree.rows[usCaKey]).toBeDefined();
    expect(transition.normalizedTree.cells).toEqual({});
  });

  it('does not locally trim or roll child cells up to the stable prefix', () => {
    const usKey = serializePath(['US']);
    const usCaKey = serializePath(['US', 'CA']);
    const data = makeTree({
      rows: [makeNode({ axis: 'row', path: [] })],
    });
    const currentTree = makeTree({
      rows: [
        makeNode({ axis: 'row', path: [] }),
        makeNode({ axis: 'row', path: ['US'], hasChildren: true }),
        makeNode({ axis: 'row', path: ['US', 'CA'] }),
      ],
      cells: {
        [serializeCellKey(usKey, rootKey)]: {
          rowKey: usKey,
          colKey: rootKey,
          values: { sales: 100 },
        },
        [serializeCellKey(usCaKey, rootKey)]: {
          rowKey: usCaKey,
          colKey: rootKey,
          values: { sales: 7 },
        },
      },
    });

    const transition = resolveLayoutTransition({
      ...baseTransitionConfig,
      data,
      currentTree,
      previousLayout: { rows: ['country', 'state'], cols: [] },
      currentLayout: { rows: ['country'], cols: [] },
      effectiveExpandRowsLevel: 2,
    });

    expect(transition.rowStablePrefix).toBe(1);
    expect(transition.autoExpandRowsLevelForDesired).toBe(0);
    expect(
      transition.normalizedTree.cells[serializeCellKey(usKey, rootKey)],
    ).toMatchObject({
      rowKey: usKey,
      colKey: rootKey,
      values: { sales: 100 },
    });
    expect(
      transition.normalizedTree.cells[serializeCellKey(usCaKey, rootKey)],
    ).toMatchObject({
      rowKey: usCaKey,
      colKey: rootKey,
      values: { sales: 7 },
    });
  });

  it('limits desired auto-expansion without promoting added layers locally', () => {
    const usKey = serializePath(['US']);
    const data = makeTree({
      rows: [makeNode({ axis: 'row', path: [] })],
    });
    const currentTree = makeTree({
      rows: [
        makeNode({ axis: 'row', path: [] }),
        makeNode({ axis: 'row', path: ['US'] }),
      ],
    });

    const transition = resolveLayoutTransition({
      ...baseTransitionConfig,
      data,
      currentTree,
      previousLayout: { rows: ['country'], cols: [] },
      currentLayout: { rows: ['country', 'state'], cols: [] },
      effectiveExpandRowsLevel: 2,
      groupbyRowsLength: 2,
    });

    expect(transition.rowStablePrefix).toBe(1);
    expect(transition.autoExpandRowsLevelForDesired).toBe(0);
    expect(transition.normalizedTree.rows[usKey]).toMatchObject({
      hasChildren: false,
    });
  });

  it('caps auto-expansion to the last stable expandable level on trailing trims', () => {
    const data = makeTree({
      rows: [makeNode({ axis: 'row', path: [] })],
    });
    const currentTree = makeTree({
      rows: [
        makeNode({ axis: 'row', path: [] }),
        makeNode({ axis: 'row', path: ['US'], hasChildren: true }),
        makeNode({ axis: 'row', path: ['US', 'CA'], hasChildren: true }),
      ],
    });

    const transition = resolveLayoutTransition({
      ...baseTransitionConfig,
      data,
      currentTree,
      previousLayout: { rows: ['country', 'state', 'city'], cols: [] },
      currentLayout: { rows: ['country', 'state'], cols: [] },
      effectiveExpandRowsLevel: 2,
      groupbyRowsLength: 2,
    });

    expect(transition.rowStablePrefix).toBe(2);
    expect(transition.autoExpandRowsLevelForDesired).toBe(1);
  });
});
