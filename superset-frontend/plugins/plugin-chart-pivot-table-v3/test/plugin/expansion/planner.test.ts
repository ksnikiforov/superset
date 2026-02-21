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

import { planGroupedExpansionTargets } from '../../../src/pivot/expansion/planner';
import { rootKey } from '../../../src/pivot/viewModel';
import { serializePath } from '../../../src/utils';
import { type PivotTreeNode } from '../../../src/types';

describe('pivot/expansion/planner', () => {
  it('plans grouped fetch targets for an expanded node', () => {
    const aKey = serializePath(['A']);
    const nodes: Record<string, PivotTreeNode> = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: true,
      },
      [aKey]: {
        axis: 'row',
        key: aKey,
        path: ['A'],
        label: 'A',
        formattedLabel: 'A',
        level: 1,
        hasChildren: true,
      },
    };

    const { plan, targets, groupKeyMap } = planGroupedExpansionTargets({
      axis: 'row',
      expandedKeys: new Set([rootKey, aKey]),
      nodes,
      requiredOppositeDepth: 1,
      fetchedDepthByKey: new Map(),
      hasLoadedChildren: () => false,
      getGroupedFetchKey: (_axis, key) => key,
    });

    expect(Array.from(plan.fetchKeys)).toEqual([aKey]);
    expect(targets).toEqual([
      {
        id: JSON.stringify(['row', aKey, 2, 1]),
        axis: 'row',
        pathKey: aKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
    ]);
    expect(groupKeyMap.get(JSON.stringify(['row', aKey]))).toEqual([aKey]);
  });
});
