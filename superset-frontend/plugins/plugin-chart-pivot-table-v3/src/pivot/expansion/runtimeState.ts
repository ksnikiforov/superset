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
import { type PivotAxis } from '../../types';

export type ExpansionRuntimeState = {
  pendingRows: Set<string>;
  pendingCols: Set<string>;
  loadingCounts: Map<string, number>;
  isHydrating: boolean;
};

export type ExpansionRuntimeAction =
  | {
      type: 'setPending';
      axis: PivotAxis;
      keys: Set<string>;
    }
  | {
      type: 'updateLoadingKey';
      key: string;
      delta: number;
    }
  | {
      type: 'clearLoading';
    }
  | {
      type: 'setHydrating';
      value: boolean;
    };

export const createExpansionRuntimeState = (): ExpansionRuntimeState => ({
  pendingRows: new Set(),
  pendingCols: new Set(),
  loadingCounts: new Map(),
  isHydrating: false,
});

const updateLoadingCounts = ({
  loadingCounts,
  key,
  delta,
}: {
  loadingCounts: Map<string, number>;
  key: string;
  delta: number;
}) => {
  const counts = new Map(loadingCounts);
  const nextCount = (counts.get(key) ?? 0) + delta;
  if (nextCount <= 0) {
    counts.delete(key);
  } else {
    counts.set(key, nextCount);
  }
  return counts;
};

export const expansionRuntimeReducer = (
  state: ExpansionRuntimeState,
  action: ExpansionRuntimeAction,
): ExpansionRuntimeState => {
  switch (action.type) {
    case 'setPending':
      return action.axis === 'row'
        ? { ...state, pendingRows: new Set(action.keys) }
        : { ...state, pendingCols: new Set(action.keys) };
    case 'updateLoadingKey':
      return {
        ...state,
        loadingCounts: updateLoadingCounts({
          loadingCounts: state.loadingCounts,
          key: action.key,
          delta: action.delta,
        }),
      };
    case 'clearLoading':
      return {
        ...state,
        loadingCounts: new Map(),
      };
    case 'setHydrating':
      return {
        ...state,
        isHydrating: action.value,
      };
    default:
      return state;
  }
};
