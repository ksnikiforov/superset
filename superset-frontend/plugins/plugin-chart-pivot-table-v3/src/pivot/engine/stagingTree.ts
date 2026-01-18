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

import { PivotTreeData } from '../../types';
import { mergeTrees } from '../../utils';

export type StagingTreeState = {
  base: PivotTreeData;
  deltas: Map<string, PivotTreeData>;
};

export const createStagingTree = (base: PivotTreeData): StagingTreeState => ({
  base,
  deltas: new Map<string, PivotTreeData>(),
});

export const stageDelta = (
  state: StagingTreeState,
  key: string,
  delta: PivotTreeData,
): StagingTreeState => {
  const deltas = new Map(state.deltas);
  deltas.set(key, delta);
  return { base: state.base, deltas };
};

export const resetStagingTree = (
  _state: StagingTreeState,
  base: PivotTreeData,
): StagingTreeState => ({
  base,
  deltas: new Map<string, PivotTreeData>(),
});

export const buildStagedTree = (state: StagingTreeState): PivotTreeData => {
  let merged = state.base;
  const orderedKeys = Array.from(state.deltas.keys()).sort();
  orderedKeys.forEach(key => {
    const delta = state.deltas.get(key);
    if (!delta) {
      return;
    }
    merged = mergeTrees(merged, delta);
  });
  return merged;
};
