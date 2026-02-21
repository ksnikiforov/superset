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
  type HandlerFunction,
  type JsonObject,
  type SetDataMaskHook,
} from '@superset-ui/core';
import { type PivotExpansionState } from '../../types';
import { parsePath } from '../../utils';
import {
  coerceExpansionState,
  type PivotExpansionStateKeys,
} from '../engine/expansionStateModel';

export type ExpansionStateStore = {
  init: (params: {
    persistedState: unknown;
    defaultRowKeys: string[];
    defaultColKeys: string[];
  }) => PivotExpansionStateKeys;
  read: () => PivotExpansionStateKeys | undefined;
  updateDeps: (deps: ExpansionStateStoreDeps) => void;
  write: (
    nextState: PivotExpansionStateKeys,
    options?: { persist?: boolean },
  ) => void;
};

export type ExpansionStateStoreDeps = {
  shouldPersist: boolean;
  setControlValue?: HandlerFunction;
  setDataMask?: SetDataMaskHook;
  mergeOwnState?: (partial: JsonObject) => JsonObject;
};

const toPersistedPayload = (
  state: PivotExpansionStateKeys,
): PivotExpansionState => {
  const toPathArray = (keys: string[]) => keys.map(key => parsePath(key));
  return {
    rowKeys: state.rowKeys,
    colKeys: state.colKeys,
    rows: toPathArray(state.rows),
    cols: toPathArray(state.cols),
    collapsedRows: toPathArray(state.collapsedRows ?? []),
    collapsedCols: toPathArray(state.collapsedCols ?? []),
  };
};

export const createExpansionStateStore = (
  initialDeps: ExpansionStateStoreDeps,
): ExpansionStateStore => {
  let deps = initialDeps;
  let memory: PivotExpansionStateKeys | undefined;

  const persist = (state: PivotExpansionStateKeys) => {
    if (!deps.shouldPersist) {
      return;
    }
    const payload = toPersistedPayload(state);
    if (deps.setControlValue) {
      deps.setControlValue('pivotExpansionState', payload);
      return;
    }
    if (deps.setDataMask && deps.mergeOwnState) {
      const nextOwnState = deps.mergeOwnState({ pivotExpansionState: payload });
      deps.setDataMask({ ownState: { ...nextOwnState } });
    }
  };

  return {
    init: ({ persistedState, defaultRowKeys, defaultColKeys }) => {
      if (memory) {
        return memory;
      }
      const seed = coerceExpansionState(persistedState);
      memory =
        seed ??
        ({
          rowKeys: defaultRowKeys,
          colKeys: defaultColKeys,
          rows: [],
          cols: [],
          collapsedRows: [],
          collapsedCols: [],
        } satisfies PivotExpansionStateKeys);
      return memory;
    },
    read: () => memory,
    updateDeps: nextDeps => {
      deps = nextDeps;
    },
    write: (nextState, options) => {
      memory = nextState;
      if (options?.persist === false) {
        return;
      }
      persist(nextState);
    },
  };
};
