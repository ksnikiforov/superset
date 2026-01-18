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

import { PivotTreeData, PivotTreeNode } from '../../../src/types';
import {
  buildStagedTree,
  createStagingTree,
  resetStagingTree,
  stageDelta,
} from '../../../src/pivot/engine/stagingTree';
import { serializeCellKey, serializePath } from '../../../src/utils';
import { rootKey } from '../../../src/pivot/viewModel';

const makeNode = ({
  axis,
  path,
  hasChildren = false,
}: {
  axis: 'row' | 'col';
  path: PivotTreeNode['path'];
  hasChildren?: boolean;
}): PivotTreeNode => ({
  axis,
  key: serializePath(path),
  path,
  label: String(path[path.length - 1] ?? 'Total'),
  formattedLabel: String(path[path.length - 1] ?? 'Total'),
  level: path.length,
  hasChildren,
});

const makeTree = (): PivotTreeData => ({
  rows: {
    [rootKey]: makeNode({ axis: 'row', path: [], hasChildren: true }),
  },
  cols: {
    [rootKey]: makeNode({ axis: 'col', path: [], hasChildren: true }),
  },
  cells: {},
});

const makeCell = (
  rowKey: string,
  colKey: string,
  value: number,
): PivotTreeData['cells'] => ({
  [serializeCellKey(rowKey, colKey)]: {
    rowKey,
    colKey,
    values: { m1: value },
  },
});

describe('stagingTree', () => {
  it('merges deltas in a stable order regardless of arrival', () => {
    const base = makeTree();
    const rowKey = serializePath(['A']);
    const colKey = serializePath(['X']);

    const deltaA: PivotTreeData = {
      rows: {
        [rowKey]: makeNode({ axis: 'row', path: ['A'] }),
      },
      cols: {},
      cells: makeCell(rowKey, rootKey, 1),
    };
    const deltaB: PivotTreeData = {
      rows: {},
      cols: {
        [colKey]: makeNode({ axis: 'col', path: ['X'] }),
      },
      cells: makeCell(rootKey, colKey, 2),
    };

    const stagedAB = buildStagedTree(
      stageDelta(stageDelta(createStagingTree(base), 'a', deltaA), 'b', deltaB),
    );
    const stagedBA = buildStagedTree(
      stageDelta(stageDelta(createStagingTree(base), 'b', deltaB), 'a', deltaA),
    );

    expect(stagedBA).toEqual(stagedAB);
  });

  it('replaces staged deltas for the same key', () => {
    const base = makeTree();
    const rowKey = serializePath(['A']);

    const deltaA: PivotTreeData = {
      rows: {
        [rowKey]: makeNode({ axis: 'row', path: ['A'] }),
      },
      cols: {},
      cells: makeCell(rowKey, rootKey, 1),
    };
    const deltaB: PivotTreeData = {
      rows: {
        [rowKey]: makeNode({ axis: 'row', path: ['A'], hasChildren: true }),
      },
      cols: {},
      cells: makeCell(rowKey, rootKey, 2),
    };

    const staged = buildStagedTree(
      stageDelta(stageDelta(createStagingTree(base), 'a', deltaA), 'a', deltaB),
    );

    expect(staged.rows[rowKey]?.hasChildren).toBe(true);
    expect(staged.cells[serializeCellKey(rowKey, rootKey)]?.values.m1).toBe(2);
  });

  it('clears staged deltas on reset', () => {
    const base = makeTree();
    const rowKey = serializePath(['A']);
    const delta: PivotTreeData = {
      rows: {
        [rowKey]: makeNode({ axis: 'row', path: ['A'] }),
      },
      cols: {},
      cells: makeCell(rowKey, rootKey, 1),
    };

    const withDelta = stageDelta(createStagingTree(base), 'a', delta);
    const reset = resetStagingTree(withDelta, base);
    const staged = buildStagedTree(reset);

    expect(staged.rows[rowKey]).toBeUndefined();
  });
});
