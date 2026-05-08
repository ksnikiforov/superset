<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Pivot Table v3 Pure Runtime Transition Plan

This plan describes how to streamline the pivot-table-v3 pipeline with the
explicit goal of reducing code size and removing duplicated behavior.

The target architecture keeps the current user-facing power of Pivot Table v3,
including flexible Values placement. The simplification is internal: every
layer should interpret the same compiled pivot program instead of re-deriving
metric placement, expansion, totals, and tree shape independently.

Compatibility with previous pivot-table-v3 behavior is not a hard requirement.
When old behavior conflicts with a simpler and more predictable runtime model,
the simpler model should win after the behavior change is explicitly called out
and tested.

## Goals

- Preserve flexible Values placement on either axis and at any position.
- Replace metric-placement special cases with one typed axis model.
- Stop synthesizing semantic aggregate values from rendered cells.
- Reuse already fetched DB aggregate facts when they exactly cover the requested
  layout.
- Fetch only missing DB aggregate coverage for visible or expanded layers.
- Never fetch hidden or collapsed layers.
- Make rendering consume a complete model instead of repairing tree structure.
- Delete old placement, tree-projection, visibility, and expansion branches as
  each runtime layer moves to the compiled model.
- Count deletion wins against production/runtime code. Test deletion is not a
  goal; keep as many tests and test lines as needed to prove the simpler model.
- Prefer direct replacement over long-lived compatibility adapters.
- Keep the table interactive while any load is in flight.
- Bring potential large deletion wins from edge-case behavior to the user for
  approval before removing that behavior.
- Bring inconsistent behavior that blocks major simplification to the user for
  approval before changing it, even when it is not a narrow edge case.

## Non-goals

- Do not preserve previous behavior solely for compatibility.
- Do not keep old saved form-data semantics if a new shape removes meaningful
  code.
- Do not keep previous expansion or layout persistence behavior if it complicates
  the runtime model.
- Do not remove flexible Values placement.
- Do not introduce browser-side aggregation for totals, subtotals, averages,
  count distinct, ratios, or custom SQL metrics.
- Do not introduce speculative prefetching for hidden or collapsed layers.
- Do not use global loading locks that block scrolling, dragging, row/column
  selection, measure selection, or expansion of already-loaded branches.
- Do not optimize for fewer test lines. Test code may grow when it protects a
  production-code deletion or locks in a simpler behavior contract.
- Do not silently remove edge-case behavior just because it unlocks a large code
  deletion. Those simplifications need an explicit approval checkpoint.
- Do not silently normalize inconsistent behavior when that behavior change is
  the reason a large deletion becomes possible. First describe the current
  behavior, proposed simpler behavior, UX impact, and expected deletion upside.

## Current Problem

The plugin currently has several partial sources of truth:

- `LayoutContext` resolves some layout behavior.
- `resolveInteractionLayout` resolves runtime layout behavior.
- `buildInitialQuerySpecs`, `resolveFetchContext`, and `branchQueryPairs` resolve
  query behavior.
- `transformProps`, `fetchPivotBranch`, and `PivotTableChart` each materialize
  trees in different paths.
- `useExpansionEngine` decides what is loaded and what must be fetched.
- `usePivotRenderModel` and `visibility` also infer tree shape and loaded state.

This makes the code hard to simplify because files are coupled by behavior
rather than by clear data contracts.

## Runtime Invariants

These requirements are not compatibility constraints. They define the intended
runtime model.

### Interactivity must not be blocked by loading

The plugin must remain interactive while queries are in flight:

- scrolling stays available
- already-loaded expansions stay available
- row and column selection stays available
- measure selection stays available
- dragging layout chips stays available
- loaded cells and headers stay visible
- only the specific branch, axis path, or layout commit that is waiting for data
  should show loading state

Loading should be represented as targeted pending coverage, not as a global
chart lock. A request for one branch must not disable unrelated controls or
unrelated loaded branches.

Current interactivity checkpoint:

- The pure runtime direction supports this requirement, but only if chart
  interaction state is treated as a draft separate from committed fact coverage.
- `PivotTableChart.tsx` still contains old modal-loading behavior and remains a
  Gate 7/Gate 5 hotspot. The immediate cleanup path is to keep the committed
  table data visible while updating the layout editor draft immediately, reject
  stale requests by request id, and avoid pointer-event/global-loader locks
  during layout fetches. The remaining stale-table fallback should become a
  display snapshot rather than a broad prop freeze.
- Large query results can still lag the page because JSON parsing,
  fact-store ingestion, materialization, and React table commit happen
  synchronously on the main thread. The architecture should move toward a
  non-blocking commit lane: request epoch first, then cancellable/chunked
  materialization, then a low-priority React commit.
- Current implementation: seamless layout refresh now has a separate latest-only
  materialization lifecycle. Fetched results yield back to the browser before
  materialization and again before commit, and stale layout requests can be
  rejected before the expensive materializer runs or before a stale result
  commits.
- Current implementation extension: result ingestion, fact-store upsert, and
  fact-to-tree materialization now have a cooperative chunked async path for
  seamless layout refreshes. Large result sets yield between chunks and check the
  active request token before continuing. This reduces main-thread monopolies,
  but it is not a Web Worker yet; JSON parsing and each individual chunk still
  run on the main thread.

### Queries must follow visibility

The runtime must never request DB coverage for hidden or collapsed layers.

Query planning must derive required coverage from:

- the compiled pivot program
- visible expansion state
- requested user action
- totals and subtotals that are visible under the current state

It must not derive coverage from the full possible depth of the layout unless
those layers are expanded or otherwise visible. Values is a synthetic level; it
may reveal metric nodes, but should not trigger a DB query by itself.

This applies especially to layout edits. When a user adds a row or column layer
to an axis that already has another layer, the new layer is not automatically
visible. The runtime should update the compiled program and visible scaffold,
but must not request DB coverage for the newly added layer until the user expands
into that layer. Adding the first and only layer on an axis may require a query
because that layer is immediately visible.

This rule is intentionally stricter than the current implementation. It should
remove eager depth planning, hidden-layer prefetches, and fallback behavior that
loads data the user has not exposed.

## Target Pipeline

```text
formData + runtime UI state
  -> compilePivotProgram
  -> diffVisibleFactCoverage
  -> fetchMissingFacts
  -> materializePivotTree
  -> derivePivotRenderModel
  -> PivotTableView / export
```

Each step should be a pure function except data fetching and persistence.

## Core Model

### Axis program

Values placement should be represented as a normal axis level.

```ts
type PivotAxisLevel =
  | {
      kind: 'dimension';
      column: PivotColumnRef;
    }
  | {
      kind: 'values';
      metrics: PivotMetricRef[];
    };

type PivotAxisProgram = PivotAxisLevel[];
```

Examples:

```text
Columns: [Values, Month]
Axis program: [values, dimension: Month]

Columns: [Region, Values, Month]
Axis program: [dimension: Region, values, dimension: Month]

Columns: [Region, Month, Values]
Axis program: [dimension: Region, dimension: Month, values]
```

Metric-first, metric-middle, and metric-last are then all the same behavior:
walk the next axis level. If the next level is `values`, reveal metric nodes. If
the next level is `dimension`, require DB facts at the matching dimension depth.

### Pivot program

```ts
type PivotProgram = {
  rows: PivotAxisProgram;
  columns: PivotAxisProgram;
  metrics: PivotMetricRef[];
  totals: PivotTotalsProgram;
  subtotals: PivotSubtotalProgram;
  formatting: PivotFormattingProgram;
  sorting: PivotSortingProgram;
};
```

The compiled program should be the only structure consumed by query planning,
tree materialization, expansion, rendering, and export.

### Fact store

The fact store should contain only DB-returned aggregate values.

```ts
type PivotFact = {
  rowPath: PivotDimensionPath;
  columnPath: PivotDimensionPath;
  metricKey: string;
  value: unknown;
  coverage: PivotFactCoverage;
};
```

Rules:

- Facts may be reused across layouts only when coverage is exact enough.
- Facts must not be created by summing rendered cells.
- Missing coverage must produce a fetch request.
- Tree nodes and render cells are projections of facts, not the canonical data.

## Deletion Strategy

The transition should be organized around deletion gates. A phase is not done
until old code is removed. Any temporary bridge must have a named deletion
target in the same change set.

## Progress Snapshot

As of May 8, 2026:

### Plan Reassessment

The refactor is still directionally correct, but it has reached the point where
new abstractions must be paired with deletions. The safest next work is not to
add another planner layer; it is to move remaining local projection and coverage
mutation out of React hooks and then delete the hook-local branches.

Current visible diff from baseline `3affd1cc6db691fe08eddf0914e2050207f95ed0`:

- Full plugin: `114` files changed, `11382` insertions, `4823` deletions.
- Production `src`: `40` files changed, `5894` insertions, `4037`
  deletions.
- Tests: `73` files changed, `4841` insertions, `774` deletions.

The total diff is still net additive because the refactor added runtime
infrastructure and protective tests. That is acceptable only if the next changes
delete production hook/layout/materialization branches. Test-line reduction
remains a non-goal.

### Completion Reassessment

Overall transition completion estimate: **72%**.

This is a functionality/architecture completion estimate, not a line-deletion
score. The completed work has moved the runtime toward a compiler/fact-store
pipeline, but the remaining work is disproportionately concentrated in a few
large files and in the not-yet-built reducer/controller split.

| Gate                                         | Completion | Assessment                                                                                                                                                                                                                          |
| -------------------------------------------- | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1: compiled layout model                |        70% | `PivotProgram` is established, materialization consumes it directly, and many query/render call sites use it. `usePivotLayout`, interaction layout, and control/layout cleanup still read compatibility layout state.               |
| Gate 2: query planning from program/coverage |        87% | Initial/root/branch/batch query paths use coverage metadata and canonical paths. Remaining complexity is mostly support/totals coverage composition and old fetched-depth compatibility in expansion planning.                      |
| Gate 3: central fact ingestion/store         |        91% | Fetch paths return fact batches, fact-store hits and cache hits reuse exact coverage, ingestion is isolated, and materializer handoff is explicit. Remaining coupling is mostly initial wrapper compatibility and tree-shaped APIs. |
| Gate 4: one tree materializer                |        80% | `materializePivotTree.ts` owns fact-to-tree materialization, Values/metric/measure axes, subtotal leaf injection, and row subtotal labeling. The last initial-tree compatibility wrapper is deleted; remaining work is export parity and fixture-only raw tree construction. |
| Gate 5: expansion reducer/runtime effects    |        64% | Expansion has stronger pure helpers, typed coverage, shared latest-request lifecycles, reducer-owned pending/loading state, and shared local/single/batch fetch helpers. The hook still owns persistence, hydration iteration, and layout transition responsibilities. |
| Gate 6: pure render model                    |        64% | Projection now drives loaded-state, toggle eligibility, collapsed Values, and column display behavior. `visibility.ts`, `usePivotLayout`, and `usePivotRenderModel` still duplicate some inference/presentation policy.             |
| Gate 7: chart component cleanup              |        30% | `PivotTableChart.tsx` now delegates seamless fetch/materialization to a runtime effect helper, but still owns committed-tree sync, runtime layout checks, dimension filters, and interaction wiring.                                |

Weighted interpretation:

- Strongest completed areas: Gate 2 and Gate 3.
- Best current deletion target: Gate 4 render repair and test-only raw fixture
  surface.
- Biggest remaining architectural risk: Gate 5, because a reducer rewrite before
  more extraction would mostly move the current hook complexity instead of
  simplifying it.
- Biggest remaining file-size hotspot: `PivotTableChart.tsx`, but it should be
  split after expansion/materialization contracts are thinner.

Complete reassessment after the runtime-controller/reducer slice:

- Architecture completion: **72%**.
- Production line-deletion completion: **48%**. Existing production files shrank
  in this slice (`PivotTableChart.tsx`, `useExpansionEngine.ts`, and
  `ingestQueryResults.ts` net `76` lines smaller), but the new reducer and
  seamless runtime helper are still additive until the next deletions consume
  their boundaries.
- Interactivity requirement completion: **68%**. Seamless layout fetches are now
  latest-only and chunked, second drags during pending loads are planned against
  the pending layout, expansion pending/loading state is reducer-owned, and
  same-axis/cross-axis branch loading uses shared local/single/batch helpers.
  Large JSON parse, large React commit, and hydration iteration still create
  visible lag under very large results.
- Query visibility requirement completion: **85%**. Initial/root/branch/batch
  planning follows coverage and visible expansion state. Remaining risk is
  support/totals coverage composition and any residual expansion edge path that
  still plans from hook-local compatibility state.
- Simplification/deletion requirement completion: **60%**. The compiler/fact
  store/materializer boundaries exist, but `PivotTableChart.tsx`
  (`3086` lines), `useExpansionEngine.ts` (`2057` lines), and
  `usePivotRenderModel.ts` (`948` lines) still contain the biggest removable
  orchestration and projection surfaces.

Latest execution of the previous next move:

- Deleted the test-only `buildInitialTreeFromSpecResults` compatibility wrapper;
  tests now call `buildInitialRuntimeFromSpecResults(...).tree` directly.
- Added `runtime/seamlessRuntimeUpdate.ts` so `PivotTableChart.tsx` delegates
  seamless fetch, latest-only cancellation, and async materialization.
- Added `expansion/runtimeState.ts` so pending row/column keys, loading counts,
  and hydration state are reducer-owned rather than split across React state and
  mutable refs.
- Deleted duplicate same-axis vs cross-axis branch/batch loading mechanics by
  sharing `resolveExpansionFetchPlan`, `fetchExpansionSingleTarget`, and
  `fetchExpansionBatchTarget` inside `useExpansionEngine.ts`.
- Verification: touched-file ESLint passes; focused Jest suite passes
  (`6` suites, `113` tests), and the prefetch/cross-axis expansion regression
  suite also passes (`7` suites, `13` tests). Full `npm run type` still fails
  only on the known broader plugin debts: control-panel metric typing, older
  test mocks missing `factBatches`, expansion engine fixture config missing
  `pivotProgram`, and an unused test helper.

Current best next move:

1. Continue Gate 5 by moving expansion hydration iteration and persistence into
   reducer actions now that pending/loading and fetch helpers are centralized.
   This should delete more imperative hook branches without changing visible
   expansion behavior.
2. Then continue Gate 4/Gate 6 by deleting render-layer repair in
   `usePivotRenderModel.ts` that is redundant with materialized metric/measure
   and subtotal nodes.
3. Keep `PivotTableChart.tsx` extraction scoped to effect boundaries until
   dimension-filter orchestration can move behind a controller cleanly.

Gate status:

- Gate 1 is partially complete (`70%`). `PivotProgram` is established and many call
  sites consume it, but `usePivotLayout` and `resolveInteractionLayout` still
  translate raw layout state into runtime behavior.
- Gate 2 is largely complete (`87%`). Initial, root, branch, and batch query paths now
  flow through explicit coverage metadata. Remaining complexity is mostly
  support/totals coverage expansion inside `coverage.ts`, not old branch-pair
  planning.
- Gate 3 is mostly complete at the ingestion boundary (`91%`). Initial load, seamless
  refresh, branch fetch, batch fetch, local fact-store hits, and branch-cache
  hits now carry `PivotFactStoreBatch[]`. The remaining dependency is mostly
  tree-shaped compatibility at the initial/chart boundary.
- Gate 4 is in progress (`80%`). `src/pivot/runtime/materializePivotTree.ts` now owns
  production fact-store-to-tree materialization for branch, batch, and initial
  trees, metric/measure axis materialization, row and column subtotal leaf
  injection, and row subtotal labeling. `ingestQueryResults.ts` is back to
  ingestion/fact-store orchestration. `pivot/core/tree.ts` now exposes raw tree
  fixture construction plus merge/label formatting helpers; Values/metric axis,
  measure-axis, and subtotal helpers live under the materializer boundary.
  The broad `src/utils.ts` utility surface no longer re-exports the raw-record
  tree builders or subtotal materialization helpers. The legacy initial-tree
  wrapper in `ingestQueryResults.ts` is gone.
- Gate 5 is started but still the largest source of complexity (`64%`).
  `useExpansionEngine` no longer infers fetched state from rendered trees and
  the planner no longer consumes raw fetched-depth maps. Pending/loading state
  now lives in a reducer and same-axis/cross-axis branch/batch fetching shares
  one local/single/batch helper path. The hook still owns layout trimming, local
  tree projection, fetched-coverage remapping, hydration iteration,
  persistence, cancellation, and expansion normalization.
- Gate 6 is partially complete (`64%`). Projection now drives loaded-child checks,
  toggle eligibility, column display projection, and collapsed Values semantics.
  `visibility.ts`, `usePivotLayout`, and `usePivotRenderModel` still contain
  descendant/cell scanning and presentation repair that overlap with projection
  and fetched coverage.
- Gate 7 has only been lightly reduced (`30%`). `PivotTableChart.tsx` is smaller than
  baseline, but at roughly `3086` lines it still owns committed-tree sync,
  runtime layout coverage checks, dimension filters, interaction wiring, and
  controller-like responsibilities.

Current largest production hotspots by line count:

- `PivotTableChart.tsx`: `3086` lines. It still owns committed-tree sync,
  runtime layout coverage checks, dimension filters, interaction wiring, and
  controller-like responsibilities.
- `useExpansionEngine.ts`: `2057` lines. This is still the largest runtime
  orchestration and deletion target.
- `usePivotLayout.ts`: `1657` lines. This remains the main render/layout policy
  hotspot.
- `runtime/materializePivotTree.ts`: `1140` lines. This is now the correct Gate
  4 owner, but should be split into internal materializer modules only when that
  enables deleting render repair or fixture-only production helpers.
- `usePivotRenderModel.ts`: `1034` lines. This is the next likely Gate 4/Gate 6
  deletion surface because render repair should shrink now that materialization
  creates metric, measure, and subtotal nodes.
- `visibility.ts`: `602` lines. Loaded-state inference should keep shrinking as
  fetched coverage becomes the source of truth.
- `pivot/core/tree.ts`: `256` lines. It is now mostly raw record fixture
  construction plus `mergeTrees`/label formatting. It has no production reason
  to keep `buildTreeFromRecords` long term.
- `runtime/ingestQueryResults.ts`: `275` lines after the materialization
  extraction.

Recommended next sequence:

1. Continue Gate 4 by deleting render-layer tree repair that is now redundant
   with `materializePivotTree.ts`. Start in `usePivotRenderModel.ts` and prove
   that metric/measure/subtotal nodes are model input, not render-created
   fallback nodes.
2. Move `buildTreeFromRecords` out of production `src/pivot/core/tree.ts` into a
   test fixture helper, or replace targeted fixture setup with fact batches. This
   is production-code deletion; test-line reduction remains a non-goal.
3. Then return to Gate 5 and extract the next pure effect/controller boundary
   from `useExpansionEngine`: request lifecycle, hydration loops, or expansion
   persistence. Do not start the full reducer until those responsibilities are
   smaller.
4. Revisit `usePivotLayout`/`visibility.ts` after render repair shrinks. The goal
   is one source of truth for projection and loaded-state, with row/column
   presentation adapters only where visible UX truly differs.
5. Defer `PivotTableChart.tsx` splitting until Gate 4 render repair and Gate 5
   request lifecycle are thinner; otherwise the split mostly moves the current
   orchestration around.

Latest execution of that sequence:

- Collapse pruning, stable-trim fetched-depth remapping, and expanded-coverage
  remapping now live behind `src/pivot/expansion/fetchedRequests.ts`.
  `useExpansionEngine` no longer manipulates fetched-depth maps directly during
  collapse or layout reinitialization.
- The layout-change transition block is now a pure
  `src/pivot/expansion/layoutTransition.ts` helper. It owns stable-prefix
  layout pruning, local projection/promotion, auto-expand depth adjustment, and
  carried fetched-coverage flags. The hook calls the helper and keeps only the
  React state/persistence/effect orchestration.
- Focused tests now cover stable layout trim, missing-depth layer promotion,
  merged projection over fresh data plus current expansion tree, and fetched
  coverage carryover after stable trims.
- Row/column stale collapsed-branch pruning in `usePivotLayout` now shares one
  axis-neutral `src/pivot/chart/pruneCollapsedAxis.ts` helper. The column-only
  UX policy that preserves metric children at the parent level when metrics are
  at the end is explicit instead of hidden in a duplicated column branch.
- The broader metrics-between and metrics-at-end component checks passed after
  this extraction, so no visible row/column layout behavior change was taken.
- `src/pivot/runtime/materializePivotTree.ts` now owns the production-facing
  fact-store-to-tree materialization boundary. Branch fetch, grouped batch
  fetch, fact-store hits, and initial runtime materialization now materialize
  through that module.
- `src/pivot/runtime/ingestQueryResults.ts` no longer contains the local
  fact-to-tree materializer or planned-spec materialization loop. It now orders
  results, extracts facts, upserts fact batches, and calls the runtime
  materializer for the initial `{ tree, factBatches }` wrapper.
- The unused `buildBranchTreeFromSpecResults` compatibility wrapper was deleted
  after production and tests were moved to `buildBranchTreeFromFactStore`.
- Interaction layout changes now commit the editor draft immediately, including
  Values-axis moves that require a seamless fetch. The table may still keep the
  previous committed view visible while hydration settles, but the chip editor is
  no longer gated on the request finishing and `TableArea` no longer applies a
  `pointer-events: none` lock during that transition.
- `src/pivot/runtime/requestLifecycle.ts` now owns the reusable latest-request
  lifecycle primitive for runtime requests. Seamless layout refresh uses it for
  request-id creation, request-group cancellation, stale response suppression,
  abort handling, and latest-only loading cleanup.
- Expansion same-axis and atomic hydration fetches now use the same lifecycle
  primitive for branch and grouped-batch requests. `useExpansionEngine` no
  longer owns `transactionIdRef`, `activeRequestGroupIdsRef`, or a local
  `trackRequestGroup`; request invalidation and active-group cancellation live
  behind the runtime lifecycle boundary.
- The reducer rewrite remains intentionally deferred. The hook is thinner, but
  materialization and render/layout policy are still better deletion targets
  than a reducer that would absorb legacy behavior.

Potential approval checkpoints now visible:

- `layoutTransition.ts` still merges cells when layout depth is reduced.
  Deleting that behavior and showing only exact fetched/materialized coverage
  would remove meaningful code and avoid local aggregation, but it may make
  layout changes show less carried-over data until the new coverage is fetched
  or materialized.
- Persisted expansion state currently tries to survive semantic layout changes
  through stable-prefix pruning and coverage remapping. Simplifying this to a
  stricter reset-on-semantic-change rule could remove code, but it would change
  dashboard restore behavior after row/column edits.
- Row and column collapsed-metric child pruning still have similar but not
  identical branches. Unifying them is a deletion opportunity only if visible row
  body behavior and column header behavior remain the same. Any visible
  subtotal/header change needs approval first.

Approved collapsed Values projection boundary:

- Rows and columns should share the same semantic collapsed Values projection:
  given an axis, parent path, and compiled pivot program, the runtime should
  answer whether a collapsed parent exposes Values/metrics, which metric leaves
  are visible, what canonical path represents each metric, and whether that
  metric has a next dimension after Values.
- Rows and columns should keep separate presentation policy. Rows render
  collapsed metrics as body rows; columns render collapsed metrics as header
  leaves. Subtotal placement, total/root display, header padding/colspans, and
  column stale-leaf pruning remain axis-specific unless a visible UX change is
  brought back for approval.
- The intended refactor should not change visible UX. If removing a branch would
  alter subtotal/header behavior, that becomes an approval checkpoint rather
  than an internal cleanup.

### Detailed Progress

- Gate 1 is in progress.
- `PivotProgram`, `PivotAxisLevel`, and visible coverage types exist under
  `src/pivot/runtime/`.
- `LayoutContext` compiles `pivotProgram` and derives its current compatibility
  fields from that program.
- Control-panel Values placement uses the runtime compiler.
- The old `resolveMetricPlacement` helper has been deleted from `utils.ts`.
- `rg "resolveMetricPlacement"` should return no plugin source or test matches.
- Tests now cover Values first, middle, and last on both axes.
- Tests now cover visible coverage rules for hidden/non-expanded layers.

Remaining Gate 1 work:

- Remove raw layout interpretation from `usePivotLayout`.
- Remove raw layout interpretation from `resolveInteractionLayout`.
- Remove duplicated Values-placeholder cleanup that still exists around controls
  and runtime layout conversion.

Gate 2 has started:

- `coverage.ts` exists.
- Bootstrap query targets consume visible coverage for grid, row, and column
  axis targets.
- Bootstrap query metadata records the visible coverage it requested.
- The unused duplicate `src/pivot/engine/initialQueryPlan.ts` planner has been
  deleted.
- Root, branch, and batch query specs now record fact coverage metadata and use
  that coverage to derive query columns.
- Branch and batch query specs return no DB query when expansion only reveals
  synthetic Values.
- `fetchPivotBranch` treats an empty branch spec list as a no-op instead of
  sending an empty chart-data request.
- `resolveFetchContext` no longer returns unused raw groupby fields.
- The compatibility `pivot/engine/useExpansionEngine.ts` re-export has been
  deleted; the chart imports the expansion hook directly.
- `src/pivot/runtime/paths.ts` now centralizes canonical axis path projection.
- Runtime query planning uses one path shape: dimension values stay raw, metric
  and measure leaves stay encoded, and query filters project dimension paths from
  that canonical axis path.
- The old separate `metricPath` branch/fetch/batch API has been deleted.
- Raw metric-label expansion tolerance has been removed. This is an approved
  compatibility break: old persisted expansion state with raw metric labels may
  reset, while future behavior uses canonical encoded paths.
- `LayoutContext.getFetchPath` has been deleted. Query specs and expansion
  planning now use `src/pivot/runtime/paths.ts` for axis coverage keys.
- The old metric-index grouped fetch-key heuristic in `useExpansionEngine` has
  been deleted. Fetched state is keyed by canonical axis coverage.
- Canonical coverage keys keep the Values-tier marker and the encoded
  metric/measure-leaf scope. This keeps `before Values` and `after Values`
  expansion branches separate, and prevents expanding one metric or one
  measure leaf from marking sibling metrics/leaves as loaded.
- The metric-prefix missing-node workaround in `expansionPlanner.ts` has been
  deleted; expansion satisfaction now flows through canonical coverage keys.
- Branch fetch now separates query support metrics from visible/materialized
  metrics. Sorting, formatting, databars, and custom measure-leaf dependencies
  can ride in the same request, but only the expanded metric/leaf branch is
  materialized into the returned tree.
- Branch measure-leaf fetches now scope required time offsets to the selected
  visible leaf. Expanding `IX 1YA` does not request unrelated sibling offsets
  such as `1 month ago`.
- Tests now cover metric sibling split loading, support metric query inclusion,
  non-materialization of support metrics, IX/time-offset scoping, and planner
  fetch-target separation for metric siblings.
- `branchQueryPairs.ts` has been deleted. Branch, batch, and root query specs
  now consume `buildBranchFactCoverages` from `src/pivot/runtime/coverage.ts`
  and receive `PivotFactCoverage[]` directly.
- Branch, batch, and root query specs now use one coverage-to-query-spec
  assembly helper in `specs.ts`. Metadata, query names, columns, filters, and
  materialized metrics flow through the same path for all coverage-driven
  fetches.
- `src/pivot/runtime/ingestQueryResults.ts` now owns the first fact-store
  boundary. It orders chart-data results by planned query name and extracts
  `PivotFact[]` batches from DB records and coverage metadata.
- Ingestion-boundary tests now cover support metrics and offset metric values
  becoming facts/cell values without materializing support metric branches, plus
  column subtotal leaf materialization from planned coverage specs.
- Planned-spec tree materialization now consumes ingested `PivotFact[]` batches
  directly instead of calling the legacy raw-record tree builder. The old
  `buildBranchTreeFromResults` compatibility bridge and `fetchPivotBranch`
  re-export have been deleted.
- `src/pivot/runtime/factStore.ts` now owns exact fact identity. Facts are keyed
  by query scope, coverage, row path, column path, value key, and
  visible/support role. Initial, branch, and batch materialization upsert
  ingested facts into a local store before reading scope-specific fact batches
  back out.
- Initial loads and seamless layout/filter refreshes now return fact batches
  alongside the rendered tree. `useExpansionEngine` seeds a runtime-owned fact
  store from those batches and keeps it alive across branch and batch expansion
  fetches.
- Branch and batch fetches can now materialize directly from the runtime fact
  store when every planned coverage is already loaded. Network results upsert
  exact fact batches back into the same store, including empty result coverage,
  before tree materialization.
- The branch cache no longer stores rendered `PivotTreeData`. It stores
  `PivotFactStoreBatch[]`, and cache hits materialize a tree from those cached
  facts. This removes one more tree-as-data cache from the runtime path while
  preserving branch-cache behavior.
- Fact batches now carry query-scope metadata. `useExpansionEngine` seeds
  fetched-depth state from exact branch and batch fact scopes when available,
  instead of inspecting rendered tree shape.
- The rendered-tree fetched-depth fallback in `useExpansionEngine` has been
  deleted. Direct component fixtures that pass prebuilt `PivotTreeData` must now
  also pass fact batches or an explicit runtime seed describing the preloaded
  coverage. This removes another production path where rendered tree shape was
  treated as loaded-state truth.
- `useExpansionEngine` no longer calls `peekPivotBranchCache` as a separate
  cache side channel. Branch fact-store hits and branch-cache hits now flow
  through `resolvePivotBranchLocalResult`, producing the same single-target
  result shape consumed by the expansion fetch-plan merge path. This keeps
  cached branches out of batch fetches without requiring the hook to materialize
  trees from cache directly.
- `resolveFetchContext` no longer carries raw layout passthrough fields such as
  full row/column groupby arrays, resolved metrics layout, or metric insertion
  index. Query spec metadata and branch-cache keys now read those values from
  `LayoutContext`, while fetch context keeps only query-specific outputs:
  sanitized path, target depths, query groupbys, scoped metrics, support metrics,
  subtotal levels, and formatting/sorting coverage flags.
- The old `resolveFetchContextForBatch` alias has been deleted. Branch, batch,
  root, and batch-signature planning now call the same `resolveFetchContext`
  entry point directly.
- `QuerySpecMeta` no longer carries duplicated `rowDepth` / `colDepth` fields.
  Planned specs now treat `meta.coverage.rowDepth` and
  `meta.coverage.columnDepth` as the single source of truth, and fact-store
  batch scopes derive their depth from coverage during ingestion.
- Branch fetch regression coverage now proves that an exact branch coverage
  containing a visible metric plus a sorting support metric is reused from the
  fact store on a later request. The support metric stays available to cell
  values but is not materialized as a visible metric branch, and no duplicate
  query is issued for the same Values-first coverage.
- Fact-store batch scopes no longer carry `rowDepth` / `colDepth`. Scope now
  describes only interaction identity (`branch` path or `batch` sibling set),
  while fetched-depth reconstruction reads the required opposite depth from
  `batch.coverage`. Test-only preloaded branch batches now include coverage
  metadata for the same reason.
- Facts are now payload-only inside the fact store. `PivotFact.coverage`,
  `PivotFact.queryName`, the production-unused `upsertMany` API, and the
  coverage-less query-name fallback have been deleted. Exact coverage and query
  identity live on `PivotFactStoreBatch`, and the fact key is built from the
  batch selector plus path/value/role.
- Fact-store identity no longer uses opaque `queryName`. Batches and selectors
  are addressed by exact coverage plus typed request scope (`bootstrap`, `root`,
  `branch` path, or `batch` sibling set). A regression now proves sibling
  branch scopes with identical depth/dimension coverage do not satisfy each
  other. Query names remain on query specs for backend result matching only.
- `useExpansionEngine` now consumes typed fact-request identity when seeding and
  completing fetched state from fact batches. `buildPivotFactRequestKey`
  provides the shared `coverage + scope` key, branch/batch request projection is
  covered by focused tests, and fetch/cached fact batches are marked through the
  typed request path before being projected to the legacy axis-depth map.
- `src/pivot/expansion/fetchedRequests.ts` now owns the typed fact-request to
  fetched-depth compatibility bridge. The hook no longer exports projection
  helpers or keeps an unused request-key set; exact `coverage + scope` request
  identity remains inside the fact store, while the expansion planner still
  receives legacy row/column depth maps until that boundary is removed.
- Hydration and grouped expansion planning now receive one axis-indexed fetched
  coverage state instead of separate row/column fetched-depth maps. The
  remaining map lookup is contained behind `fetchedRequests.ts` and the
  single-axis planner API, so `useExpansionEngine` no longer passes duplicate
  fetched-depth maps through the planner boundary.
- Branch and grouped-batch fetch result contracts now always carry
  `factBatches`. DB fetches, fact-store hits, cache hits, empty/error results,
  and synthetic Values-tier no-query expansions all return the same field.
  Values-tier no-query expansions return explicit empty fact batches as fetched
  coverage markers, so the hook no longer needs to infer loaded coverage from
  a missing fact-batch result.
- The local `markFetchedCoverage` fallback branches after fetch results have
  been deleted from `useExpansionEngine`. The old `groupKeyMap` compatibility
  return from expansion planning was deleted too, because it existed only to
  support that fallback.
- Pending/loading state was inspected during this step. It still needs visible
  axis path keys for row/column spinners and pending toggles, so it should not
  be collapsed into request keys until the UI has a separate
  request-to-visible-node mapping.
- Component-level branch and batch fetch mocks now use explicit fact-batch test
  fixtures instead of returning rendered `{ data }` alone. This locks in the
  production contract that successful fetch/local results describe loaded fact
  coverage directly.
- The test fixture contract intentionally marks only dimensional loaded
  children, not metric or subtotal-only children. This matches the runtime rule
  that Values can expose synthetic nodes without proving a DB-backed child layer
  is fetched.
- Persisted-restore batching tests now model deferred row/column batch fetches
  with follow-up calls resolved through the same fact-batch helper. This keeps
  out-of-order batch behavior interactive while avoiding hidden fallback
  coverage in the hook.
- Branch and grouped-batch fetch results now append loaded-branch coverage
  markers for metric-rich descendants that were materialized by the returned
  data. These markers are returned to fetched-coverage seeding only; they are
  not upserted into the fact store and are not written to the branch cache, so
  an empty coverage marker cannot later masquerade as materializable facts.
- `src/pivot/runtime/loadedBranchCoverage.ts` centralizes the marker rule:
  collect only loaded dimensional children under the requested branch/batch
  target paths, and ignore metric-only or subtotal-only children. This is the
  production version of the old test fixture behavior and avoids marking
  unrelated ancestors such as the root when only one sibling branch was loaded.
- The post-merge rendered-tree fetched-depth bridge has now been deleted from
  `useExpansionEngine`, and `markFetchedLoadedTreeCoverage` has been removed
  from `fetchedRequests.ts`. Same-axis expansion and atomic hydration both rely
  on fetch/local result fact batches to seed loaded coverage.
- Component-level branch fetch mocks in metrics-between, metric-first,
  stability, and seamless expansion suites were upgraded to return fact-batch
  aware results. This was required because rendered `{ data }` alone is no
  longer a valid successful fetch contract for expansion planning.
- Verification after deleting the bridge: the full plugin test directory passed
  `89` suites / `687` tests.
- Expansion planning now consumes a typed fetched-coverage lookup instead of raw
  row/column fetched-depth maps plus a coverage-key callback. The remaining
  axis-depth map shape is contained inside `fetchedRequests.ts` and the local
  hook state that prunes/remaps coverage during collapse and layout changes.
- Planner regression coverage now exercises typed branch coverage, typed batch
  sibling coverage, and metric-sibling split loading through the grouped
  expansion planner. This locks the no-overfetch rule before removing more of
  the old coverage-state shape.

Immediate next step:

- Continue Gate 4 by shrinking the legacy core tree surface. The likely next
  deletion-positive cut is to move direct test fixtures away from the `utils.ts`
  barrel exports of `buildTreeFromRecords`, `applyMetricAxis`, and
  `applyMeasureHierarchyAxis`, then demote those helpers to explicit legacy
  wrappers in `pivot/core/tree.ts`.
- After the public helper surface is smaller, decide whether
  `materializePivotTree.ts` should absorb subtotal leaf injection/labeling from
  `pivot/core/tree.ts` or keep those pieces as core tree utilities. This should
  be a pure boundary decision unless it changes visible subtotal labels.
- Keep shrinking `usePivotLayout` opportunistically where row/column behavior is
  visibly identical. The next safe target is likely collapsed metric child
  exposure, but subtotal/header presentation must stay axis-specific unless an
  approval checkpoint says otherwise.
- Before deleting any broad behavior branch, bring inconsistent behavior or
  edge-case behavior that unlocks large deletion wins to the user for approval
  with UX impact and deletion upside.

Resolved approval checkpoint:

- Loaded/fetched state is still partly keyed by rendered axis paths and partly by
  projected fetch paths. Standardizing it on canonical axis coverage keys should
  remove the metric-index heuristic in `useExpansionEngine` and the no-axis
  `getFetchPath` bridge in `LayoutContext`.
- Approved and implemented with one refinement: coverage keys are not pure
  dimension-only keys. They preserve the Values tier as `__MEASURES__`, because
  deleting that tier made `before Values` and `after Values` branches look like
  the same coverage and caused metrics-between expansion to underfetch.
- Refined after query-efficiency review: coverage keys also preserve the encoded
  metric and measure-leaf tokens. Metric siblings do not share loaded state.
  Support metrics may be queried with the visible branch, but they do not mark
  sibling visible branches as loaded or materialize extra headers/cells.

Resolved behavior checkpoint:

- Metrics-between layouts currently allow a metric branch under a hidden
  pre-Values dimension to reveal post-Values dimensions. Example:
  `orderPriority -> Values -> returnFlag` can load while `shipMode` is still
  hidden, even when the full axis program is `orderPriority -> shipMode ->
Values -> returnFlag`. Keeping this behavior preserves current UX, but it
  requires runtime projection to support "skipped pre-Values dimension"
  branches.
- Decision: this behavior stays. The simplification path is not to remove it,
  but to represent it explicitly as a projected axis view. Query planning,
  coverage keys, materialization, visibility, and toggles should all consume the
  same projection descriptor instead of each layer rediscovering which
  pre-Values dimensions are currently skipped.
- The projection model must be axis-neutral because rows and columns support the
  same user behavior: a branch can expose Values and post-Values levels while
  omitting intermediate pre-Values dimensions. The implementation should still
  account for legitimate row/column differences through a small axis policy or
  adapter, rather than forcing all rendering and totals behavior into one
  oversized helper.
- `src/pivot/runtime/projection.ts` now contains the first axis-neutral
  projection helper. It describes the source axis program, query filter
  dimension path, projected dimension path, post-Values dimension path, skipped
  pre-Values dimension levels, metric scope, measure-leaf scope, and next source
  level. `resolveFetchContext` now consumes this helper for sanitized query path
  and metric/measure-leaf scope instead of rediscovering those details locally.
- Branch and batch coverage planning now consume that projection descriptor
  directly. Coverage filtering is anchored to the projected query filter depth,
  not the raw canonical Values path length, so skipped pre-Values row and column
  branches follow the same axis-neutral rule.
- Tests now cover skipped pre-Values projection behavior in visibility and
  toggles. Parent dimension nodes above the skipped level still report missing
  child coverage, while projected metric branches report loaded children once
  post-Values cells exist; row and column metric toggles stay available and flip
  from expand to collapse after the projected branch loads.
- Runtime loaded-child checks now receive the compiled `PivotProgram` and use
  `resolveAxisProjection` for comparable axis paths. This replaces local
  metric-token stripping in the visibility path and makes skipped pre-Values
  row/column branches follow the same projection contract as query planning.
- `usePivotRenderModel.shouldShowToggle` now uses `resolveAxisProjection` to
  decide toggle eligibility from the next axis level. This deleted the local
  `hideMetricParentToggle`, `hasMetricToken && metricsAtEnd`, and measure-leaf
  placement branches while preserving row and column Values-placement behavior.
- Column render projection now also uses `resolveAxisProjection` for axis-aware
  formatting/sorting value maps, non-metric column depth detection,
  metrics-first display padding, and `buildColumnDisplayPath`. This keeps
  column headers on the same projected axis contract as query planning,
  loaded-state checks, and toggle eligibility.
- `resolveCollapsedValuesProjection` now centralizes the semantic collapsed
  Values projection. Tests lock that metrics-between rows render metric body rows
  and metrics-between columns render metric header leaves, while the helper
  itself only answers metric path and projected-child questions. `usePivotLayout`
  uses it inside `getCollapsedRowChildrenForNodes` and
  `getCollapsedColLeavesForNodes`, preserving separate row/column presentation
  adapters.
- `resolveAxisChildProjection` now centralizes the semantic child classification
  used by `usePivotLayout` child filtering. `getRowChildrenForNodes` and
  `getColChildrenForNodes` still keep their row/column presentation policies,
  but the first metric-position filtering stage now reads whether a child has
  entered Values and whether it adds a projected dimension from the shared
  projection descriptor instead of rediscovering that locally.
- `src/pivot/runtime/materializePivotTree.ts` now routes flat metric axes and
  measure-leaf axes through one internal `applyMeasureAxis` materializer.
  `applyMetricAxis` is now a thin runtime wrapper that normalizes flat metrics
  into hidden value leaves, while `applyMeasureHierarchyAxis` passes real
  measure leaves into the same path. The two remaining behavior-policy switches
  are explicit: flat metrics keep their old source-axis-node preservation rule,
  and measure stacks keep their old always-preserve rule. This keeps the visible
  metric/measure-leaf layout contract while moving the behavior under the Gate 4
  materializer boundary.
- Planned query metadata now carries `pivotProgram` instead of separate
  `metricsLayoutResolved` and `metricInsertIndex` fields. The shared tree
  materializer derives Values axis, Values insertion depth, axis dimensions, and
  metric-at-end behavior from that program. Legacy raw-argument wrappers remain
  only for direct tree test fixtures and normalize through `compilePivotProgram`
  before reaching the shared materializer.
- `rowGroupbyForQueryFull` and `colGroupbyForQueryFull` have been deleted from
  planned query metadata. Fact ingestion reads row and column path columns from
  `coverage.rowDimensions` and `coverage.columnDimensions`; base dimension-tree
  materialization reads full axis depth from `pivotProgram.rowDimensions` and
  `pivotProgram.columnDimensions`. Bootstrap totals now also carry explicit
  `0 x 0` coverage so initial materialization has one coverage contract for
  totals, grid, row-only, and column-only specs.
- `src/pivot/runtime/materializePivotTree.ts` is now the explicit Gate 4
  materialization boundary. It owns fact-store selectors, branch/batch
  materialization from exact fact batches, initial materialization from the fact
  store, Values/metric/measure-axis construction, subtotal leaf injection, and
  row subtotal labeling.
- Production branch and grouped-batch fetch paths now import
  `buildBranchTreeFromFactStore`, `buildFactStoreBatchesFromSpecs`, and
  `canMaterializeSpecsFromFactStore` from the materializer module instead of
  `ingestQueryResults.ts`.
- The old `buildBranchTreeFromSpecResults` wrapper was deleted. Materialization
  tests now exercise the fact-store materializer boundary directly after
  ingestion upserts facts.
- `src/utils.ts` no longer re-exports the legacy raw-record tree builder or
  materialization helpers. Direct tree fixtures now import `buildTreeFromRecords`
  from `src/pivot/core/tree` and metric/measure/subtotal helpers from
  `src/pivot/runtime/materializePivotTree.ts`, making the split between raw
  fixture construction and runtime materialization explicit.
- Row subtotal leaf injection and row subtotal labeling moved out of
  `pivot/core/tree.ts` and into `src/pivot/runtime/materializePivotTree.ts`.
  Row and column subtotal leaf injection now share one runtime helper, while
  fixture-heavy tests import the subtotal helpers from the materializer module
  instead of the broad `src/utils.ts` barrel.
- Metric and measure-axis construction moved out of `pivot/core/tree.ts` and
  into `src/pivot/runtime/materializePivotTree.ts`. Production no longer bridges
  through core tree helpers for Values/measure tiers, and direct tree fixtures
  now combine `buildTreeFromRecords` from core with `applyMetricAxis` or
  `applyMeasureHierarchyAxis` from the runtime materializer.
- `usePivotRenderModel.ts` no longer synthesizes missing column ancestor nodes
  for metrics-at-end layouts. The runtime materializer is now responsible for a
  complete column hierarchy, and the old component test for renderer-side repair
  was replaced with a materialization contract check.

### Gate 1: One compiled layout model

Add:

- `src/pivot/runtime/compilePivotProgram.ts`
- `src/pivot/runtime/types.ts`
- focused tests for Values placement at first, middle, and end on both axes

Route existing layout code through the compiler, but keep old outputs available
only where a short-lived call-site bridge is needed during the same deletion
phase.

Delete or shrink:

- scattered metric-placement resolution in `utils.ts`
- duplicated Values-placeholder cleanup in chart and controls
- layout interpretation branches in `usePivotLayout`
- layout interpretation branches in `resolveInteractionLayout`

Exit criteria:

- There is one function that answers "what are the row and column axis levels?"
- No runtime layer needs to inspect raw `groupbyRows`, `groupbyColumns`, or
  `metricsLayout` directly. Those fields are read only by controls and the
  compiler.

### Gate 2: Query planning reads only the pivot program

Add:

- `src/pivot/runtime/coverage.ts`
- `src/pivot/runtime/planPivotQueries.ts`

Move query planning to:

```text
PivotProgram + visible expansion state + requested action -> visible fact coverage
visible fact coverage -> QuerySpec[]
```

Delete or shrink:

- metric-placement branches in `branchQueryPairs.ts`
- path surgery in `resolveFetchContext.ts`
- duplicate depth-pair calculations in initial, branch, and batch query paths
- query planning assumptions inside `fetchPivotBranch.ts`

Exit criteria:

- Initial queries, branch queries, and batch branch queries use the same planner.
- Query specs explain their requested coverage in metadata.
- Values placement changes do not require placement-specific query code.
- Hidden or collapsed layers never appear in requested coverage.
- Adding a non-only row or column layer does not request coverage for that layer
  until expansion makes it visible.
- Expanding a synthetic Values level does not create a DB request by itself.

### Gate 3: Central fact ingestion

Add:

- `src/pivot/runtime/factStore.ts`
- `src/pivot/runtime/ingestQueryResults.ts`

The fact store should normalize DB results into aggregate facts keyed by:

- row dimension path
- column dimension path
- metric key
- query coverage
- time offset where applicable
- measure leaf where applicable

Delete or shrink:

- result-to-tree logic in `transformProps.ts`
- result-to-tree logic in `PivotTableChart.tsx`
- branch-specific result-to-tree logic in `fetchPivotBranch.ts`
- batch-specific result handling in `fetchPivotBranchesBatch.ts`

Exit criteria:

- Initial load, seamless update, branch fetch, and batch fetch all ingest through
  the same function.
- No fetch path directly mutates the render tree.

### Gate 4: One tree materializer

Add:

- `src/pivot/runtime/materializePivotTree.ts`

The materializer should interpret:

```text
PivotProgram + FactStore + expansion state -> PivotTreeData
```

It should create all synthetic nodes, including:

- Values nodes
- metric leaves
- measure leaves
- row totals
- column totals
- row subtotals
- column subtotals

Delete or shrink:

- legacy `buildTreeFromRecords` fixture dependency where tests can use fact
  batches directly
- any remaining subtotal construction outside `materializePivotTree.ts`
- tree repair logic in `usePivotRenderModel`
- subtotal labeling that happens after runtime materialization

Exit criteria:

- The render layer never creates missing model nodes.
- Export and UI use trees produced by the same materializer.
- Totals terminology remains consistent:
  - row total appears on the columns axis
  - column total appears on the rows axis

### Gate 5: Expansion as a reducer

Add:

- `src/pivot/runtime/pivotRuntimeReducer.ts`
- `src/pivot/runtime/runtimeEffects.ts`

Replace the current expansion orchestration with explicit actions:

```ts
type PivotRuntimeAction =
  | { type: 'propsLoaded'; program: PivotProgram; facts: PivotFact[] }
  | { type: 'layoutCommitted'; program: PivotProgram }
  | { type: 'toggleExpanded'; axis: 'row' | 'column'; path: PivotPath }
  | { type: 'fetchStarted'; requestId: string; coverage: PivotFactCoverage[] }
  | { type: 'fetchResolved'; requestId: string; facts: PivotFact[] }
  | { type: 'fetchFailed'; requestId: string; error: Error };
```

Expansion logic should ask only:

```text
What is the next axis level?
Is it synthetic Values?
Is it a DB dimension?
Do we already have the required facts?
Which exact coverage is pending?
```

Delete or shrink:

- most refs in `useExpansionEngine.ts`
- duplicate same-axis and cross-axis fetch loops
- local tree projection in `trimTreeForLayout`
- ad hoc loaded-state checks spread across expansion and visibility

Current status:

- Seamless layout fetches and expansion branch/batch fetches share the same
  latest-request lifecycle instead of hook-local request ids.
- Seamless result materialization is now scheduled through a second latest-only
  lifecycle, so stale layout edits can cancel pending materialization before it
  starts or before it commits.
- Seamless initial runtime materialization now uses chunked async ingestion,
  chunked fact-store upsert, and chunked fact-to-tree construction. Subsequent
  layout edits are planned against the pending layout baseline, so dragging again
  during a load cancels/replaces the stale plan instead of being misclassified as
  a local projection.
- Remaining deletion target is the reducer/controller split: expansion state,
  pending coverage, persistence, and materialization scheduling still live across
  `PivotTableChart.tsx` and `useExpansionEngine.ts`.

Exit criteria:

- A layout change produces a deterministic state transition.
- Fetching is an effect of missing coverage, not an inline branch in the UI hook.
- Expansion does not synthesize aggregate values.
- Pending fetch state is scoped to exact coverage, not the whole chart.
- Loading one branch does not block scrolling, dragging, selection, or expansion
  of already-loaded branches.

### Gate 6: Pure render model

Move rendering to:

```text
PivotProgram + PivotTreeData + visible expansion state -> PivotRenderModel
```

Delete or shrink:

- tree normalization in `usePivotRenderModel`
- loaded-state inference duplicated in `visibility.ts`
- special toggle checks tied to metric placement
- UI/export drift in render-model construction

Exit criteria:

- `PivotTableView` receives a complete render model.
- Toggle visibility comes from the axis program and known coverage.
- Export consumes the same render model or a sibling export model derived from
  the same tree.

### Gate 7: Chart component cleanup

Split `PivotTableChart.tsx` into composition-only pieces:

- `PivotRuntimeController`
- `PivotInteractionPanel`
- `PivotDimensionFilterController`
- `PivotTableViewport`
- `PivotTableView`

Delete or shrink:

- runtime layout persistence branches in `PivotTableChart.tsx`
- seamless update tree construction in `PivotTableChart.tsx`
- dimension-filter fetch orchestration inside the chart body
- embedded DnD/editing logic that can live behind a controller

Exit criteria:

- `PivotTableChart.tsx` mostly wires props to controllers and renders the view.
- Data correctness logic is outside React components.
- Runtime UI state is separate from fact coverage and tree materialization.

## Expected Line Removal Targets

These are directional targets, not promises. They should be measured after each
gate with `wc -l` and compared against the baseline.

| Area              | Removal source                                                | Expected reduction |
| ----------------- | ------------------------------------------------------------- | ------------------ |
| Query planning    | placement-specific branch pairs and fetch context surgery     | high               |
| Tree construction | duplicate initial, branch, update, and export materialization | high               |
| Expansion         | ref-heavy orchestration and duplicate fetch loops             | high               |
| Render model      | tree repair and loaded-state inference                        | medium             |
| Chart component   | persistence/fetch/materialization orchestration               | high               |
| Utilities         | kitchen-sink layout, metric, subtotal helpers                 | medium             |

The project should track both total line count and number of files that can be
deleted or reduced to thin call sites.

Suggested tracking command:

```bash
find superset-frontend/plugins/plugin-chart-pivot-table-v3/src -type f \
  \( -name '*.ts' -o -name '*.tsx' \) -exec wc -l {} +
```

## Test Plan

Before deleting old behavior, add contract tests around the intended canonical
behavior. Tests should preserve existing behavior only when that behavior is
still desirable under the pure runtime model.

- compile program for Values first, middle, and last on rows
- compile program for Values first, middle, and last on columns
- initial query coverage for collapsed and expanded starts
- branch query coverage for expansion before Values
- branch query coverage for expansion after Values
- no query coverage for collapsed layers
- no query coverage for hidden layers
- adding a non-only row layer does not request coverage for that layer until
  expansion
- adding a non-only column layer does not request coverage for that layer until
  expansion
- adding the first and only row or column layer may request visible root coverage
- no DB request when expanding only into a synthetic Values level
- targeted loading state while an unrelated branch remains interactive
- dragging remains available while a query is in flight
- row/column/measure selection remains available while a query is in flight
- expansion into a Values level without DB fetch
- expansion into a dimension level with DB fetch
- row totals on the columns axis
- column totals on the rows axis
- subtotals at selected levels
- export matches visible render model
- count distinct totals are never locally synthesized

Each migration gate should include tests that prove the simplified model, not
tests that lock in old implementation quirks.

Run from `superset-frontend`:

```bash
npm test plugins/plugin-chart-pivot-table-v3
npx eslint plugins/plugin-chart-pivot-table-v3
```

## Breaking-change Strategy

Breaking previous pivot-table-v3 behavior is allowed when it removes complexity
or makes the runtime more predictable. Changes should be intentional and listed
in the PR description.

Behavior that may change:

- saved chart form data shape
- dashboard own-state persistence
- expansion state persistence across layout changes
- exact loading behavior during layout edits
- whether old locally projected values are shown after semantic layout changes
- chart control field names if renaming removes translation layers
- query metadata shape if new coverage metadata removes planner branches

Prefer deleting compatibility paths over supporting both old and new behavior.
If an adapter is required to land a PR safely, it must have a named follow-up
deletion target.

The only behavior that must stay is the intentionally supported product model:

- flexible Values placement on either axis
- DB-accurate aggregate values
- lazy loading only where visible fact coverage is missing
- no queries for hidden or collapsed layers
- no global loading lock during branch or layout fetches
- predictable totals terminology and placement
- UI and export derived from the same runtime model

## UX Strategy

Flexible Values placement stays.

Dragging should remain immediate for the control chips. Data refresh should
happen on committed layout changes, not on every hover state.

When layout changes require missing fact coverage:

- keep the previous table visible
- show a targeted updating state
- fetch missing facts
- swap to the new materialized tree on success
- keep the previous tree and show an error on failure
- do not block scrolling, dragging, selection, or already-loaded expansions

When layout changes can be served by existing DB facts:

- rematerialize locally
- avoid a network request

When layout changes are cosmetic only:

- update the render model only

## First Three Change Sets

### Change set 1: Replace layout interpretation with PivotProgram

- Add `PivotProgram` and `PivotAxisLevel` types.
- Add `compilePivotProgram`.
- Add tests for Values placement across both axes.
- Make `LayoutContext`, interaction layout, and query preparation consume the
  compiled program.
- Allow behavior changes where old placeholder cleanup or fallback semantics
  exist only to support legacy paths.

Deletion target:

- remove duplicated metric-placeholder normalization paths.
- remove raw layout interpretation from runtime hooks.

### Change set 2: Replace query planning with coverage planning

- Add coverage types.
- Add planner for initial, branch, and batch coverage.
- Make query spec builders consume only coverage output.
- Change query metadata if needed to make coverage explicit.

Deletion target:

- delete placement-specific logic from `branchQueryPairs`.
- delete path mutation in `resolveFetchContext` where coverage planning makes it
  obsolete.
- remove separate initial, branch, and batch depth-pair planning.

### Change set 3: Replace result-to-tree paths with facts and materialization

- Add fact ingestion.
- Add one materializer from facts to tree.
- Make initial transform, seamless update, branch fetch, and batch fetch use the
  same ingestion and materialization path.
- Change tree shape if needed to remove render repair logic.

Deletion target:

- remove duplicate result-to-tree construction from initial load, branch fetch,
  batch fetch, and chart update paths.
- remove render-layer tree repair made unnecessary by the materializer.

## Design Decisions To Settle

- Should the fact store live only for the chart instance, or should it reuse the
  existing plugin-level LRU cache?
- Should sort order be part of fact coverage or only render-model state?
- Should formatting helper metrics be facts, metadata, or a separate side
  channel?
- How much existing expanded state should survive a semantic layout change?
- Should user-controlled layout editing stay embedded in the chart, move to a
  side panel, or stay embedded but isolated behind a controller?

## Success Definition

The transition succeeds when:

- flexible Values placement is preserved
- the same compiled program drives query planning, materialization, expansion,
  rendering, and export
- tree construction has one implementation
- expansion has one reducer-like state transition path
- render code does not repair tree shape
- no semantic aggregate is synthesized from rendered cells
- the largest plugin files shrink instead of growing permanently
