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
import { nanoid } from 'nanoid';
import { type PivotAxis } from '../../types';
import { type PivotExpansionStateKeys } from './stateModel';
import { rootKey } from '../viewModel';
import {
  createLatestRequestLifecycle,
  withRequestDeadline,
} from '../runtime/requestLifecycle';
import { executeExpansionHydrationForIntent } from './hydrationExecutor';

type AxisSetMap = Record<PivotAxis, Set<string>>;
type ExpansionIntentSets = {
  expanded: AxisSetMap;
  collapsed: AxisSetMap;
};
/** Converts persisted key arrays into independent sets for each axis. */
export const expansionStateKeysToIntent = (
  state: PivotExpansionStateKeys,
): ExpansionIntentSets => ({
  expanded: {
    row: new Set(state.rows),
    col: new Set(state.cols),
  },
  collapsed: {
    row: new Set(state.collapsedRows),
    col: new Set(state.collapsedCols),
  },
});

/** Creates a persistence snapshot, excluding the implicit root expansion. */
export const expansionIntentToStateKeys = (
  intent: ExpansionIntentSets,
): PivotExpansionStateKeys => ({
  rows: Array.from(intent.expanded.row).filter(key => key !== rootKey),
  cols: Array.from(intent.expanded.col).filter(key => key !== rootKey),
  collapsedRows: Array.from(intent.collapsed.row).filter(
    key => key !== rootKey,
  ),
  collapsedCols: Array.from(intent.collapsed.col).filter(
    key => key !== rootKey,
  ),
});

type HydrationInput = Omit<
  Parameters<typeof executeExpansionHydrationForIntent>[0],
  | 'expanded'
  | 'getExpanded'
  | 'getCommittedExpanded'
  | 'expansionInstanceId'
  | 'lifecycle'
  | 'onLoadingKeys'
>;

/** Owns expansion intent, committed checkpoints, request lifetime, and scoped loading. */
export class ExpansionSession {
  private desired: ExpansionIntentSets;
  private committed: PivotExpansionStateKeys;
  private epoch = 0;
  private readonly deadlines = new Set<AbortController>();
  private readonly id = nanoid();
  private readonly lifecycle;
  private readonly loadingScopes = new Map<number, Set<string>>();

  constructor(
    initial: PivotExpansionStateKeys,
    cancel: (group: string) => void,
    private readonly onLoading: (keys: Set<string>) => void,
  ) {
    this.desired = expansionStateKeysToIntent(initial);
    this.committed = expansionIntentToStateKeys(this.desired);
    this.lifecycle = createLatestRequestLifecycle({ cancel });
  }

  get intent() {
    return {
      expanded: {
        row: new Set(this.desired.expanded.row),
        col: new Set(this.desired.expanded.col),
      },
      collapsed: {
        row: new Set(this.desired.collapsed.row),
        col: new Set(this.desired.collapsed.col),
      },
    };
  }
  get state() {
    return expansionIntentToStateKeys(this.desired);
  }
  get committedState() {
    return expansionIntentToStateKeys(
      expansionStateKeysToIntent(this.committed),
    );
  }

  /** Applies one axis transition without changing the visible checkpoint. */
  updateAxis(axis: PivotAxis, expanded: Set<string>, collapsed: Set<string>) {
    this.desired.expanded[axis] = new Set(expanded);
    this.desired.collapsed[axis] = new Set(collapsed);
  }

  /** Records the intent represented by the visible projection. */
  acceptCurrent() {
    this.committed = this.state;
  }

  /** Invalidates pending work and adopts the incoming snapshot's intent. */
  reset(state: PivotExpansionStateKeys) {
    this.dispose();
    this.desired = expansionStateKeysToIntent(state);
    this.acceptCurrent();
  }

  /** Cancels all pending intent and restores the last visible checkpoint. */
  rollback() {
    this.reset(this.committed);
  }

  /** Cancels owned requests and clears their loading indicators. */
  dispose() {
    this.epoch += 1;
    this.deadlines.forEach(controller => controller.abort());
    this.deadlines.clear();
    this.lifecycle.invalidate();
    this.loadingScopes.clear();
    this.onLoading(new Set());
  }

  /** Reveals covered branches independently on one axis, atomically across axes. */
  async hydrate(input: HydrationInput) {
    const { epoch } = this;
    const controller = new AbortController();
    this.deadlines.add(controller);
    try {
      const result = await withRequestDeadline(
        executeExpansionHydrationForIntent({
          ...input,
          expanded: this.desired.expanded,
          getExpanded: () => this.desired.expanded,
          getCommittedExpanded: () =>
            expansionStateKeysToIntent(this.committed).expanded,
          expansionInstanceId: this.id,
          lifecycle: this.lifecycle,
          onLoadingKeys: (scope, keys) => {
            if (epoch !== this.epoch) return;
            if (keys.size) this.loadingScopes.set(scope, keys);
            else this.loadingScopes.delete(scope);
            this.onLoading(
              new Set(
                [...this.loadingScopes.values()].flatMap(set => [...set]),
              ),
            );
          },
        }),
        30000,
        controller.signal,
      );
      if (epoch !== this.epoch) return {};
      if (result.tree) {
        const expanded =
          'revealedExpanded' in result
            ? result.revealedExpanded
            : this.desired.expanded;
        this.committed = expansionIntentToStateKeys({
          ...this.desired,
          expanded: expanded ?? this.desired.expanded,
        });
      }
      return result;
    } catch (error) {
      if (epoch !== this.epoch) return {};
      this.dispose();
      throw error;
    } finally {
      this.deadlines.delete(controller);
    }
  }
}
