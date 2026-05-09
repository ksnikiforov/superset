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

As of May 9, 2026:

### Plan Reassessment

The refactor is still directionally correct and is now past the boundary-building
phase. The compiler/fact-store/materializer path exists; the remaining work must
pay down the old interpretation paths that still live in render, expansion, and
chart orchestration. New helper files are no longer the right default move unless
they delete more code than they add in the same slice.

Current source-only diff from pre-refactor baseline
`7088db374448845ef6e71cf74817aa53efbc5fc1`:

- Production `src`: `7838` insertions, `8134` deletions, net `-296`.
- Current production `src` TypeScript/TSX total: `33214` lines.
- Pre-existing production files are net negative:
  `+3048 / -8134`, net `-5086`.
- Added runtime/helper files are still the source of total growth:
  `+4790 / -0` across `16` added files.

The important read is mixed but improving: production files that predated the
refactor have shrunk substantially, but the runtime layer has not yet paid for
itself in total source lines. The next changes should continue to be net
negative in `src`, and should target old chart/render/expansion branches rather
than expanding runtime surface.

### Completion Reassessment

Overall transition completion estimate: **80%**.

Goal-weighted completion estimate: **79%**. This is lower than the architecture
score because the original goal was not only to create a pure runtime boundary,
but to use it to remove old production code. The runtime pipeline is mostly in
place; the line-reduction payoff is now slightly past break-even but still not
done.

This is a functionality/architecture completion estimate, not a line-deletion
score. The completed work has moved the runtime toward a compiler/fact-store
pipeline. The remaining work is more concentrated now: `PivotTableChart.tsx`
(`2578` lines), `useExpansionEngine.ts` (`1731` lines), `usePivotLayout.ts`
(`1071` lines), `usePivotRenderModel.ts` (`695` lines), `expansion/engine.ts`
(`854` lines), `materializePivotTree.ts` (`1266` lines), and `visibility.ts`
(`266` lines).

| Gate                                         | Completion | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1: compiled layout model                |        71% | `PivotProgram` is established, materialization consumes it directly, many query/render call sites use it, and Values placeholder insertion is now shared by program placement, interaction layout, and seamless expansion-state planning. `usePivotLayout`, interaction layout, and control/layout cleanup still read compatibility layout state.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Gate 2: query planning from program/coverage |        88% | Initial/root/branch/batch query paths use coverage metadata and canonical paths. Expansion planning now trusts fetched coverage depth directly. Remaining complexity is mostly support/totals coverage composition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Gate 3: central fact ingestion/store         |        91% | Fetch paths return fact batches, fact-store hits and cache hits reuse exact coverage, ingestion is isolated, and materializer handoff is explicit. Remaining coupling is mostly initial wrapper compatibility and tree-shaped APIs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Gate 4: one tree materializer                |        86% | `materializePivotTree.ts` owns fact-to-tree materialization, Values/metric/measure axes, subtotal leaf injection, row subtotal labeling, and the measure-leaf value contract consumed by the chart. The last initial-tree compatibility wrapper is deleted, raw-record tree construction has moved out of production `src` into test fixtures, and test-only metric-axis fixture wrappers no longer live in production runtime exports. Remaining work is export parity and materializer module split only where it deletes callers.                                                                                                                                                                                                                                                           |
| Gate 5: expansion reducer/runtime effects    |        73% | Expansion has stronger pure helpers, typed coverage, shared latest-request lifecycles, reducer-owned pending/loading state, axis-neutral pending/expanded state setters, shared local/single/batch fetch execution, shared fetched-result delta application, pure reinitialized expansion-state resolution, coverage-only planner satisfaction, and visible-key persistence now reuses the already-built render model. Auto-expansion seeding now belongs to the state model, and the unused legacy fetch-coordinator prototype is gone. The hook still owns hydration iteration, cancellation, and React state commits.                                                                                                                                                                       |
| Gate 6: pure render model                    |        83% | Projection now drives toggle eligibility, collapsed Values, and column display behavior. Visible-axis construction is shared by render and expansion-state, collapsed Values projection is axis-neutral in layout, layout-owned metric placement now drives row-subtotal filtering without a rendered-tree scan, dead row-subtotal branches are gone, metric-first column header presentation is behind `columnDisplay.ts`, rendered-tree loaded-child inference is deleted, column subtotal header behavior trusts visible child state, the row/column child-filter prelude is shared, single-use visible-axis helpers are folded into the render boundary, and dead layout/render result surface is gone. Remaining duplication is mostly deeper row subtotal policy.                        |
| Gate 7: chart component cleanup              |        46% | `PivotTableChart.tsx` now delegates seamless fetch planning/materialization and runtime-layout comparison to layout/runtime helpers and no longer re-materializes measure leaves, vetoes upstream trees based on leaf source metrics, rejects incoming props trees through the stale-coverage regression branch, checks rendered tree shape for recovery coverage, uses tree projection to decide layout-change fetches, calls a single-use committed-tree sync guard, or carries its own runtime-layout normalizer. The old committed-tree sync guard module is gone; exact runtime-layout fact coverage now lives in the runtime coverage boundary. It still owns committed-tree sync, runtime layout checks, dimension filters, interaction wiring, and several local UI-state controllers. |

Weighted interpretation:

- Strongest completed areas: Gate 2 and Gate 3.
- Best current deletion target: Gate 6 render/visibility cleanup. Gate 5 has
  been improved, but additional helper extraction there is now close to
  break-even unless it removes a much larger hook branch.
- Biggest remaining architectural risk: Gate 5 hydration/persistence, because it
  still owns hydration iteration, cancellation, and React commits.
- Biggest remaining UX risk: very large result sets can still monopolize JSON
  parsing and React commit despite chunked ingestion/materialization.
- Biggest remaining line-count debt: the runtime layer is correct, but the
  `4790` added-file lines still need more old chart/render/expansion code
  deleted.

Requirement reassessment:

- Architecture completion: **76%**. The compiler/fact-store/materializer
  pipeline exists and is used by the main fetch paths. Remaining work is mostly
  deleting old interpretation surfaces, not inventing the architecture.
- Production line-deletion completion: **83%**. Pre-existing files are net `5086`
  lines smaller, and total production source is now net `296` lines smaller
  because the runtime materializer, render/visibility, and chart sync surfaces
  have started to shed compatibility API.
- Interactivity requirement completion: **70%**. Layout refresh and expansion
  fetches have targeted/latest-only state and chunked materialization. The
  plugin still needs lower-cost large-result commits and less chart-owned
  fallback/loading orchestration.
- Query visibility requirement completion: **88%**. Planning is now strongly
  coverage based and no longer treats rendered child/cell shape as fetched
  coverage. Remaining risk is support/totals coverage composition and hydration
  edge paths still tied to hook compatibility state.
- Simplification/deletion requirement completion: **83%**. Recent Gate 4/Gate 6
  work removed duplicate render/visibility loaded-state policy and moved
  fixture-only metric-axis helpers out of production runtime code. The latest
  visibility pass also removed single-use visible row/column/depth exports, and
  the chart sync pass removed a single-use committed-tree sync predicate and its
  module, but deeper row subtotal policy, hydration/persistence, and chart
  controller logic still keep meaningful old complexity alive.

Pipeline goal reassessment:

- Pure runtime pipeline completion: **83%**. The main path now has the intended
  shape: `PivotProgram` compiles layout semantics, coverage/query planning
  requests visible fact batches, fact-store ingestion records exact coverage,
  and `materializePivotTree.ts` builds the tree consumed by expansion/render.
- Remaining pipeline debt is not a missing layer; it is old orchestration still
  bypassing or second-guessing the pipeline. The largest examples are
  `PivotTableChart.tsx` runtime layout coordination, `useExpansionEngine.ts`
  hydration/cancellation/commit loops, `usePivotLayout.ts` row/column policy
  branches, and export/fixture paths that still rely on raw tree construction.
- Pipeline simplification is now gated by deletion. New runtime helpers are only
  justified when they remove more chart/render/expansion code in the same slice.

Refactor health:

- Direction: **good**. The compiler/fact-store/materializer shape is now real
  and production fetch paths use it.
- Deletion payoff: **past break-even and improving**. Pre-existing source files
  are net `-5086`, and added runtime/helper files now leave the plugin net
  `-296`.
- Interactivity: **partially improved**. Latest-only requests, reducer loading
  state, chunked materialization, and no-hidden-layer fetch planning are in
  place, but the user-visible lag from large materialization/render commits is
  still not solved.
- Risk profile: **concentrated**. The most dangerous areas are now fewer:
  `useExpansionEngine.ts`, `usePivotLayout.ts`, `usePivotRenderModel.ts`,
  `expansion/engine.ts`, and `PivotTableChart.tsx`.

Full reassessment conclusion:

- The architectural transition is roughly four-fifths complete, but the
  simplification goal still has remaining debt because the runtime layer has
  only just started to earn back its added surface.
- The latest Gate 4/Gate 6 cleanup was deletion-positive: rendered-tree
  loaded-state inference is gone from expansion planning, and fixture-only
  metric-axis materializer wrappers no longer live in production runtime code.
- The next work should keep prioritizing net-negative production changes. The
  best deletion odds are now in render/layout policy, not in creating more
  runtime abstractions.

Current best next move:

1. Continue Gate 6 child-filter/render-policy cleanup in `usePivotLayout.ts`
   and `usePivotRenderModel.ts`, but only where it deletes duplicated row/column
   policy or render repair.
2. Continue Gate 7 where it deletes chart-owned runtime second-guessing,
   especially committed-tree sync branches that duplicate materializer or
   coverage truth. Avoid a controller split unless it deletes chart code in the
   same slice.
3. Continue Gate 5 only if the next change deletes a meaningfully larger
   `useExpansionEngine.ts` branch than it adds to `expansion/engine.ts`.
4. Keep every next slice net-negative in production `src`; test-line deletion
   remains a non-goal.

### Source Surface Audit From Pre-Refactor Baseline

Baseline commit: `7088db374448845ef6e71cf74817aa53efbc5fc1`.

Scope: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src` only.
Tests and Markdown are excluded.

Current diff from baseline:

- `7838` insertions
- `8134` deletions
- net `-296` production source lines
- current `src` code total: `33214` lines
- implied baseline `src` total: about `33510` lines

By file status:

- Added files: `+4790 / -0` across `16` files
- Deleted files: `+0 / -1060` across `5` files
- Modified files: `+3048 / -7074`, net `-4026`

By area:

| Area              | Additions | Deletions |     Net | Readout                                                                                                      |
| ----------------- | --------: | --------: | ------: | ------------------------------------------------------------------------------------------------------------ |
| Runtime           |      3645 |         0 | `+3645` | Correct new boundary, but still the largest source of net growth.                                            |
| Expansion         |      1991 |      2639 |  `-648` | Recent Gate 5 work made this area net-negative, but future work must still delete hook branches immediately. |
| Chart hooks       |       787 |      1722 |  `-935` | Render/layout repair is shrinking; the latest Gate 6 slices are net-negative.                                |
| Query             |       593 |       609 |   `-16` | Old branch planner deleted, but specs/bootstrap grew around coverage.                                        |
| Core tree         |         8 |      1014 | `-1006` | Best completed simplification; raw-record fixture construction is no longer in production `src`.             |
| `PivotTableChart` |       291 |       863 |  `-572` | Chart shrinkage is now visible, but controller cleanup still has a long way to go.                           |
| Other             |       523 |      1287 |  `-764` | Utility/render/visibility cleanup is smaller than major chart/layout wins.                                   |

Why deletions are lower than expected:

- We paid the runtime-layer cost first: materializer, fact store, coverage,
  projection, paths, request lifecycle, chunking, and seamless runtime helpers
  add `3645` lines before all old callers/repairs have been deleted.
- Compatibility has not been cut deeply enough. Flexible Values placement stayed
  and old row/column projection/layout behavior is still being supported in
  `usePivotLayout`, `visibility`, `usePivotRenderModel`, and `PivotTableChart`.
- The refactor frequently extracted complexity into new files before deleting
  the old branch. That improved boundaries but delayed line reduction.
- Tests correctly grew around regressions, but the production issue is separate:
  `src` still has both new runtime truth and several old render/layout/persistence
  interpretation paths.

Code-reduction corrective plan:

1. Treat every new runtime module as a deletion obligation. A runtime helper is
   only successful when it removes older chart/render/expansion code.
2. Prioritize Gate 6 render repair deletion before adding more runtime surface.
   The first target is `usePivotRenderModel.ts` plus `visibility.ts`, replacing
   render-time loaded/metric/subtotal repair with materialized tree/projection
   truth.
3. Prioritize Gate 5 hydration/persistence deletion only where it removes
   duplicated hook branches. Do not add another large controller file unless
   `useExpansionEngine.ts` shrinks in the same change.
4. Stop expanding runtime architecture until a matching production deletion lands.
   The next meaningful slice should be net-negative in `src`.
5. Measure every next PR against this baseline and against previous-step `src`
   totals. Test-line deletion remains a non-goal.

Latest code-reduction slice:

- Deleted the old axis-specific collapsed metric row/column pruning in
  `usePivotLayout.ts`; `pruneStaleCollapsedAxis` is now the single pruning path.
- Deleted render-time tree-depth pruning from `usePivotRenderModel.ts`; the
  render model now trusts the committed/materialized tree and only applies date
  label formatting.
- Follow-up deletion slice: collapsed Values projection in `usePivotLayout.ts`
  now uses one axis-neutral helper, the unused `getExpandedDepths` visibility
  export is gone, and automatic render expansion seeding now reads the small
  expansion-state model instead of the broad expansion engine facade.
- Net production change for the latest follow-up slice: `+139 / -176`, net
  `-37` across touched `src` files.
- Gate 6 visibility follow-up: render and expansion-state now share
  `buildVisiblePivotAxes`, so metric-total hiding, metric-first column-root
  suppression, and column subtotal leaf projection are decided once in
  `visibility.ts`. The column subtotal selector was also tightened to remove
  duplicate subtotal predicates while preserving visible behavior.
- Additional production change for that Gate 6 slice: `+108 / -137`, net `-29`.
- Gate 6 loaded-child/child-filter follow-up: `hasLoadedChildren` now derives
  path projection, Values presence, subtotal presence, skipped pre-Values state,
  and metric index from one local path-info object instead of separate
  projection/fallback helpers. `usePivotLayout.ts` now shares the
  "child introduces Values" filtering branch across row and column child
  selection.
- Additional production change for that follow-up: `+125 / -141`, net `-16`.
- Gate 5/Gate 6 deletion follow-up: dead row subtotal branches in
  `usePivotLayout.ts` were removed, metric-first expanded column header padding
  moved from `usePivotRenderModel.ts` into `columnDisplay.ts`, expansion
  pending/expanded setters became axis-neutral, unused runtime reducer actions
  were deleted, and same-axis/hydration fetch promise construction now shares
  one `fetchExpansionTargets` path.
- Additional production change for that follow-up: `+181 / -253`, net `-72`.
- Gate 5 reinit-state follow-up: session expansion-cache clearing,
  auto-seeded expansion stripping, stable-prefix pruning, persisted-layout
  reset detection, and initial desired expansion building now live in pure
  `resolveReinitializedExpansionState`. This removed the biggest inline
  persistence/pruning branch from `useExpansionEngine.ts`, but the helper had to
  preserve the separate effective-expand and desired-auto-expand levels.
- Additional production change for that follow-up: `+253 / -259`, net `-6`.
- Gate 6 coverage-first loaded-state follow-up: expansion planning now trusts
  fetched fact coverage when the requested opposite-axis depth is already
  covered, instead of re-checking local tree shape. `hasLoadedChildren` no
  longer scans descendant cells to infer opposite-axis completeness; it keeps
  only a narrow metric-branch guard for structural metric children that do not
  yet have direct facts.
- Additional production change for that follow-up since the last baseline
  snapshot: `+5 / -120`, net `-115`.
- Gate 6 approved behavior follow-up: column subtotal header logic no longer
  scans the whole rendered column tree to decide whether a subtotal has deeper
  non-metric descendants. It trusts `col.hasChildren`, which makes the visible
  behavior hierarchical instead of synthesizing `Group metric` labels. The
  approved UX change is covered in `totals/columns.test.tsx`.
- Gate 6 measure-leaf cleanup: prebuilt measure-leaf fixture trees now seed
  fact-store coverage, which makes the intended contract explicit in tests:
  measure leaves are display/runtime nodes and do not require another query
  when the DB aggregate coverage is already present. With that contract locked,
  the row-end Values child-filter bandaid in `usePivotLayout.ts` was deleted.
- Additional production change for that follow-up: `+2 / -51`, net `-49`.
- Gate 4 raw-record fixture cleanup: `buildTreeFromRecords` moved from
  production `src/pivot/core/tree.ts` to `test/plugin/fixtures`, and all test
  imports now depend on the fixture helper directly. Production tree core now
  contains only `mergeTrees` and label formatting helpers.
- Additional production change for that follow-up: `+2 / -165`, net `-163`.
- Gate 7/Gate 4 chart-owned measure-leaf cleanup: `PivotTableChart.tsx` no
  longer re-applies derived measure-leaf values, scans committed trees for
  required custom/offset source metrics, rejects upstream refreshes with missing
  source metrics, or materializes measure leaves again for render. The chart now
  treats the upstream/runtime materialized tree as the source of truth. Tests now
  build materialized upstream fixtures explicitly and accept a missing custom
  leaf as missing upstream data rather than preserving stale committed values.
- Additional production change for that follow-up: `+3 / -135`, net `-132`.
- Gate 7 committed-tree sync cleanup: the incoming-props stale-coverage
  regression branch was deleted from `shouldSyncCommittedTreeFromProps` and
  `PivotTableChart.tsx`. The chart still performs the visible stale-remount
  recovery fetch when the committed runtime layout is missing required tree
  coverage, but it no longer rejects a props tree by comparing old committed
  coverage against incoming props coverage. Existing stale-dashboard tests keep
  the recovery UX locked.
- Additional production change for that follow-up: `+2 / -59`, net `-57`.
- Gate 7 fact-coverage recovery cleanup: stale-remount recovery now checks
  `committedFactBatches` for exact bootstrap/root coverage of the committed
  runtime layout instead of inspecting rendered tree node depth. The old
  `treeHasRuntimeLayoutCoverage` helper was deleted. The component fixture that
  exercises add/remove column behavior now passes the initial runtime fact
  batches alongside its prebuilt tree, making the pure-runtime contract explicit
  in the test.
- Additional production change for that follow-up: `+21 / -80`, net `-59`.
- Gate 7 layout-change coverage cleanup: layout changes now decide the
  non-structural fetch path from exact committed fact coverage instead of
  projecting rendered tree cells across row/column depth. The old
  `canProjectValueAxisShrinkWithoutFetch` helper and its path-surgery tests were
  deleted. Layout-interaction fixtures now pass the fact batches implied by
  their prebuilt runtime trees, so tests encode the runtime contract directly.
- Additional production change for that follow-up: `+5 / -155`, net `-150`.
- Gate 6 child-filter/render-policy cleanup: row and column child selection now
  share the axis-neutral pre-subtotal filtering path for metric position,
  Values introduction, hidden metric headers, and metric-first grand-total
  filtering. Row-only subtotal ordering remains local. The unused
  `PivotLayoutResult` fields and a few render-model aliases/callback duplicates
  were deleted.
- Additional production change for that follow-up: `+120 / -149`, net `-29`.
- Gate 5/Gate 6/Gate 7 fact-contract cleanup: expansion planning no longer
  treats non-root materialized children as loaded without fact coverage, branch
  and component fixtures now seed explicit runtime fact batches, stale
  `pruneMergedTree` expanded-state parameters were deleted, render-model
  groupby aliases were removed, and repeated measure-leaf path scans now share
  `findMeasureLeafIdInPath`.
- Additional production change for that follow-up: `+19 / -62`, net `-43`.
- Gate 7 chart/runtime-layout surface cleanup: always-on control-value
  persistence indirection, committed-tree and render-tree aliases, unused
  interaction-layout normalization input, unused temporal filter input, and
  avoidable DnD/measure-leaf definition-order warnings were removed. This
  keeps the chart/runtime sync path thinner without changing the committed
  layout or expansion persistence contract.
- Additional production change for that follow-up: `+19 / -32`, net `-13`.
- Gate 6/Gate 7 render-sort follow-up: the stale seamless-update hook
  dependency left by the chart sync cleanup was removed, and metric sorting plus
  UI column sorting now share one render-model missing-value/numeric comparison
  policy instead of keeping duplicate sort-value branches. The metric-sort
  config resolver was then inlined into the only sort callback that used it, so
  dimension-key lookup is no longer duplicated. Row/column projected-path
  wrapper callbacks and a nested measure-leaf header-label guard were also
  removed from the render model.
- Additional production change for that follow-up: `+47 / -76`, net `-29`.
- Gate 4/Gate 6 row-subtotal cleanup: the render/layout boundary no longer
  exports a derived `rowSubtotalDepths` field, row subtotal value hiding now
  consumes the normalized subtotal levels already present in the layout result,
  databar spacing reuses the same hide-row-values predicate as cell rendering,
  and sync/async materialization no longer keep separate row-subtotal-depth
  loop variables. The same slice also removed a nested formatting guard and a
  single-use grand-total callback from render formatting.
- Additional production change for that follow-up: `+32 / -59`, net `-27`.
- Gate 7 column-sort cleanup: measure-leaf column sort fallback resolution now
  uses one local fallback value, and the sort-order display callback no longer
  carries a separate early-return branch.
- Additional production change for that follow-up: `+10 / -17`, net `-7`.
- Gate 6/Gate 7 spinner surface cleanup: the render model now exposes one
  loading-key spinner predicate instead of duplicate row and column aliases,
  while the chart still maps it to the existing view props.
- Additional production change for that follow-up: `+8 / -10`, net `-2`.
- Gate 7 view-prop assembly cleanup: `PivotTableChart.tsx` now builds the
  shared `PivotTableView` props once and applies only mode-specific size and
  loader props for user-controlled versus normal rendering. This removes the
  duplicated chart/view prop list without changing the view API.
- Additional production change for that follow-up: `+10 / -41`, net `-31`.
- Gate 6/Gate 7 spinner API cleanup: `PivotTableView` now accepts the single
  spinner predicate already produced by the render model, and the chart no
  longer maps it back to duplicate row/column props. The same cleanup removed a
  dead non-user overlay branch from the user-controlled table wrapper.
- Additional production change for that follow-up: `+3 / -12`, net `-9`.
- Gate 6 render-model micro cleanup: row sorting no longer has an unnecessary
  memo wrapper, and row aggregate bolding now returns the existing predicate
  directly instead of carrying a separate false/true branch.
- Additional production change for that follow-up: `+2 / -8`, net `-6`.
- Gate 7 seamless snapshot cleanup: the frozen-view snapshot path no longer
  creates a redundant local alias, and the seamless-update callback no longer
  lists stable React state setters as dependencies.
- Additional production change for that follow-up: `+9 / -17`, net `-8`.
- Gate 7 runtime-layout comparison cleanup: metric-order-only detection and
  full layout equality now share one comparison helper for row keys, column
  keys, metric matching, leaf selection, leaf ordering, and Values placement.
- Additional production change for that follow-up: `+28 / -71`, net `-43`.
- Gate 7 seamless-sync signature cleanup: persisted-filter sync checks and
  seamless-sync state commits now share one selected-filter signature helper
  instead of repeating empty-filter and stringification branches.
- Additional production change for that follow-up: `+6 / -12`, net `-6`.
- Gate 7 selected-filter source cleanup: persisted interaction filters and
  persisted selected filters now reuse the normalized `ownState` filter source
  and normalized form-data filter source instead of repeating local casts,
  optional guards, and non-empty checks.
- Additional production change for that follow-up: `+41 / -55`, net `-14`.
- Gate 6 primitive render/layout memo cleanup: metric placement indexes,
  placeholder checks, metric-header hiding, visible measure-leaf metric
  expansion, and manual row aggregate-depth detection no longer carry
  unnecessary memoized intermediate state. The same cleanup removed a
  hook-local wrapper around the pure subtotal predicate, inlined single-use
  render sorting callbacks, tightened metric-index fallback resolution, and
  removed collapsed Values metric-depth wrapper callbacks. The child-filter
  path now computes axis child projection inside the shared policy callback
  instead of carrying four single-use projection wrappers.
- Additional production change for that follow-up: `+148 / -284`, net `-136`.
- Gate 7 seamless ref-sync cleanup: the chart now updates the expanded and
  pending seamless-layout refs from one effect instead of four adjacent
  controller-style mirror effects.
- Additional production change for that follow-up: `+1 / -10`, net `-9`.
- Gate 7 column-sort data-key cleanup: measure-leaf column sort lookup now scans
  for the nearest matching descendant leaf directly instead of building,
  filtering, and sorting an intermediate descendant list, and selected metric
  leaf resolution now uses one hierarchy lookup instead of separate group and
  leaf fallback branches.
- Additional production change for that follow-up: `+22 / -37`, net `-15`.
- Gate 6/Gate 7 primitive layout cleanup: chart-side primitive runtime-layout
  values no longer carry memo wrappers, layout metric-header checks no longer
  guard equality with redundant undefined branches, column metric-index fallback
  uses one ternary path, and metric/measure comparator fallback now returns
  directly instead of nesting duplicate zero-result branches.
- Additional production change for that follow-up: `+22 / -36`, net `-14`.
- Gate 6 render-model guard cleanup: render metric-index resolution now uses one
  numeric fallback path, manual row aggregate-depth collection uses a single
  optional-child guard, and row/column aggregate bolding shares combined
  missing/root guards instead of adjacent early returns.
- Additional production change for that follow-up: `+8 / -16`, net `-8`.
- Gate 6 row-subtotal/render-model single-use cleanup: forced row subtotal
  placement now resolves with one metric-index branch, metric-tier subtotal
  descendant checks stay local to the descendant loop, automatic row expansion
  seeding is scoped to manual aggregate-depth collection, and the render-model
  spinner predicate is returned directly instead of carrying a separate hook
  wrapper.
- Additional production change for that follow-up: `+14 / -36`, net `-22`.
- Gate 6 render-model config cleanup: the render-model config callback was
  inlined into the only memo that consumes it, removing the exported
  `RenderModelConfig` import and the extra current-tree/current-expansion
  wrapper parameters while keeping metric-index resolution local to render-model
  construction.
- Additional production change for that follow-up: `+68 / -90`, net `-22`.
- Gate 6 render-sort normalization cleanup: row and column dimension-sort
  normalization now feeds the key-map memos directly instead of carrying two
  adjacent intermediate sorting memos, and missing-value sort comparison uses
  one fallback branch instead of three early returns.
- Additional production change for that follow-up: `+18 / -26`, net `-8`.
- Gate 6 dimension-key cleanup: render-layout dimension-key resolution now
  filters non-metric path parts directly instead of carrying a separate
  intermediate alias.
- Additional production change for that follow-up: `+1 / -2`, net `-1`.
- Gate 6 row-subtotal predicate cleanup: row subtotal child filtering now uses
  direct boolean predicates instead of stacked true/false return blocks while
  preserving the same explicit subtotal and metric grand-total policy.
- Additional production change for that follow-up: `+12 / -18`, net `-6`.
- Gate 6 subtotal ordering predicate cleanup: column Values-child retention now
  uses one boolean expression, and row subtotal ordering reuses numeric boolean
  ranks instead of paired ternary totals.
- Additional production change for that follow-up: `+13 / -15`, net `-2`.
- Gate 6 layout/render guard cleanup: layout now reuses a single-metric flag,
  metric-index scans update max positions directly, row subtotal descendant
  filters share one prefix guard and one metric-token scan, column child
  retention inlines its subtotal allowance, and column aggregate bolding uses a
  compact root-depth guard.
- Additional production change for that follow-up: `+15 / -23`, net `-8`.
- Gate 6 render/layout rank cleanup: the remaining metric-dimension scan now
  updates its minimum index directly, metric-order fallback returns through one
  ternary, row subtotal sorting uses one subtotal rank delta, leaf-tier toggle
  suppression returns directly, and row aggregate bolding short-circuits through
  one expression.
- Additional production change for that follow-up: `+16 / -21`, net `-5`.
- Gate 6 render/layout guard consolidation: dimension-key lookup now lets the
  missing dimension fall through naturally, metric-dimension scanning increments
  only for non-metric/non-subtotal parts, row subtotal descendant merging no
  longer special-cases the empty list, measure-leaf header fallback returns
  through one expression, manual aggregate-depth tracking uses one skip guard,
  and synthetic total toggle suppression is part of the aggregate guard.
- Additional production change for that follow-up: `+24 / -38`, net `-14`.
- Gate 5 collapse-axis cleanup: expansion in-flight key collection now merges
  from the selected axis map directly, and collapse handling computes the active
  axis node map once before descendant pruning, pending pruning, and fetched
  coverage trimming. Row/column expanded and pending state setters now write
  through the selected axis ref/setter directly instead of carrying separate
  branch bodies.
- Additional production change for that follow-up: `+14 / -32`, net `-18`.
- Gate 6 toggle projection guard cleanup: render toggle eligibility now checks
  the missing-next-level case and collapsed Values-level case through one
  projection guard before applying leaf-tier metric suppression.
- Additional production change for that follow-up: `+2 / -5`, net `-3`.
- Gate 6 child-filter predicate cleanup: collapsed Values exposure now shares
  the subtotal-parent and metric-token parent guard, row Values-child retention
  returns directly from the grand-total predicate plus axis-position allowance,
  and row subtotal descendant filtering combines adjacent subtotal/metric-tier
  exclusion checks.
- Additional production change for that follow-up: `+23 / -29`, net `-6`.
- Gate 6 date-label/subtotal predicate cleanup: render date-label formatting
  filters projected non-metric path parts directly, and row subtotal descendant
  metric-token policy returns through one conditional expression.
- Additional production change for that follow-up: `+6 / -8`, net `-2`.
- Gate 7/Gate 5 seamless runtime planning cleanup: seamless layout refresh now
  builds its query plan, Values placeholder expansion state, metric overrides,
  and measure-leaf overrides inside `seamlessRuntimeUpdate.ts` instead of
  `PivotTableChart.tsx`. Same-axis and hydration expansion fetches now share
  fetched-result coverage seeding and branch/batch delta application before
  committing the merged tree or staged hydration tree.
- Additional production change for that follow-up: `+151 / -175`, net `-24`.
- Gate 7 runtime-layout comparison cleanup: chart-side runtime layout equality
  and metric-order-only checks now reuse the layout-change comparison helper
  instead of carrying duplicate array, leaf-selection, leaf-order, and Values
  placement signature logic in `PivotTableChart.tsx`.
- Additional production change for that follow-up: `+34 / -44`, net `-10`.
- Gate 1/Gate 7 Values-placement cleanup: compiled program placement,
  user-controlled interaction form-data resolution, and seamless expansion-state
  planning now share one clamped Values-placeholder insertion helper instead of
  each carrying separate row/column splice logic.
- Additional production change for that follow-up: `+25 / -31`, net `-6`.
- Gate 5/Gate 6 visible-expansion-key and metric-index cleanup: expansion persistence now
  collects visible persisted keys from the render model it already built,
  instead of rebuilding visible row/column axes through a parameter-heavy
  expansion-state wrapper. Layout, render, and expansion now also share
  `getMetricIndexFromNodes` from `metricsTotals.ts`, deleting the duplicate
  tree-scanning implementation and the extra layout-result callback surface.
- Additional production change for that follow-up: `+55 / -175`, net `-120`.
- Gate 6 render-model output cleanup: `RenderModel` no longer exposes
  unused debug/compatibility fields for column leaves, hidden metric headers,
  skipped roots, hidden metric totals, or suppressed column roots. The render
  config no longer accepts fields that only existed to echo those values back.
- Additional production change for that follow-up: `+0 / -27`, net `-27`.
- Gate 5/Gate 6 hook surface cleanup: the render hook no longer returns
  loading aliases that the chart already owns from expansion state, the layout
  result no longer exports unused `isMultiMetric` or column hidden-header
  fields, and two single-use expansion wrappers around visible-key collection
  and loaded-child construction were inlined.
- Additional production change for that follow-up: `+17 / -51`, net `-34`.
- Gate 5/Gate 6 loaded-state fallback deletion: expansion planning no longer
  accepts rendered-tree loaded-child inference. Planner satisfaction now comes
  from explicit fetched/fact coverage only, and the old `visibility.ts`
  child/cell loaded-state scan was deleted with its obsolete unit suite.
- Additional production change for that follow-up: `+2 / -230`, net `-228`.
- Verification after deleting rendered-tree loaded-state fallback: focused
  planner/engine/prefetch suites passed (`24` tests), the full plugin test
  command passed `93` suites / `697` tests, and full plugin ESLint passed with
  `0` errors and `6` existing warnings.
- Gate 4 materializer fixture-surface cleanup: production runtime no longer
  exports test-only `applyMetricAxis`, and `applyMeasureHierarchyAxis` now
  accepts the compiled `PivotProgram` path only. The legacy metric-axis layout
  overload moved to `test/plugin/fixtures/metricAxis.ts`, so tests can still
  build fixture trees without keeping that compatibility API in production.
- Additional production change for that follow-up: `+3 / -107`, net `-104`.
- Verification after moving metric-axis fixture wrappers out of production:
  single-process Jest batches passed for materializer/runtime fixtures
  (`42` tests), chart interaction/sorting/measure-leaf suites (`54` tests),
  seamless/expansion/totals suites (`138` tests), runtime/planner/materializer
  suites (`87` tests), and expansion/prefetch regressions (`38` tests). A broad
  full-plugin Jest run was intentionally interrupted after it produced many
  hanging node processes; validation continued with `--runInBand --forceExit`
  batches. Full plugin ESLint passed with `0` errors and the existing `6`
  hook-dependency warnings.
- Gate 6 visible-axis helper cleanup: `buildVisibleRows`, `buildVisibleCols`,
  and the exported visible-depth helper were deleted. Row fallback, end-position
  root movement, column root fallback, and visible depth calculation now live at
  the render/expansion call sites that consume them instead of remaining as
  single-use exported compatibility surface.
- Additional production change for that follow-up: `+63 / -109`, net `-46`.
- Gate 7 committed-tree sync guard cleanup: the single-use
  `shouldSyncCommittedTreeFromProps` export was deleted and the equivalent sync
  condition now lives directly beside the chart state it guards. The
  stale-coverage recovery reset was also folded into the recovery effect that
  already depends on the committed coverage boolean. The follow-up moved exact
  runtime-layout fact coverage into `runtime/coverage.ts` and deleted the old
  layout guard module entirely. Persisted runtime-layout normalization now
  reuses `resolveInteractionLayout.ts` instead of keeping a chart-local copy.
- Additional production change for that follow-up: `+73 / -161`, net `-88`.
- Verification after deleting the single-use sync guard/module:
  single-process Jest passed for runtime coverage plus chart interaction
  layout/filter seamless suites plus interaction-form-data normalization
  (`43` tests), and touched-file ESLint, Prettier, and `git diff --check`
  passed.
- Gate 6 row-subtotal metric-index cleanup: row-subtotal child filtering now
  trusts the layout-owned metric position instead of scanning the rendered row
  tree to rediscover the deepest metric dimension index.
- Additional production change for that follow-up: `+2 / -37`, net `-35`.
- Verification after the row-subtotal metric-index cleanup: single-process Jest
  passed for row totals, metric-first row-subtotal expansion, and interaction
  layout suites (`61` tests).
- Gate 5 dead coordinator cleanup: the unused
  `src/pivot/engine/fetchCoordinator.ts` prototype and its test were deleted.
  Expansion planning now uses the existing `FetchTarget` type from
  `query/fetchPlanOptimizer.ts`, and test-only `resetStagingTree` plus the
  unused expansion-store `read` method are gone.
- Additional production change for that follow-up: `+2 / -183`, net `-181`.
- Verification after the dead coordinator cleanup: single-process Jest passed
  for fetch-plan optimizer, staging tree, expansion planner, and prefetch
  batching suites (`16` tests).
- Combined recent Gate 4/Gate 5/Gate 6/Gate 7 source-reduction sequence:
  `+2071 / -4441`, net `-2370`.
- Attempted render-model plumbing cleanup around spinner callbacks, sorting
  value-map aliases, leaf-label flattening, and aggregate-bold returns was
  reverted before this slice because it did not pay for itself clearly enough
  while the measure-leaf fixture coverage was stale. It is not counted as a
  retained deletion.
- Attempted to remove tree-scanned metric-index compatibility as well, but it
  changed visible header ordering in `interaction-layout.test.tsx`; that cut is
  not safe without a deliberate UX decision.

Gate status:

- Gate 1 is partially complete (`71%`). `PivotProgram` is established and many call
  sites consume it, and Values-placeholder insertion is now shared across
  program placement, interaction layout, and seamless expansion-state planning.
  `usePivotLayout` and `resolveInteractionLayout` still translate raw layout
  state into runtime behavior.
- Gate 2 is largely complete (`88%`). Initial, root, branch, and batch query paths now
  flow through explicit coverage metadata. Remaining complexity is mostly
  support/totals coverage expansion inside `coverage.ts`; branch-pair planning
  and fetched-depth shape compatibility have been removed from the main path.
- Gate 3 is mostly complete at the ingestion boundary (`91%`). Initial load, seamless
  refresh, branch fetch, batch fetch, local fact-store hits, and branch-cache
  hits now carry `PivotFactStoreBatch[]`. The remaining dependency is mostly
  tree-shaped compatibility at the initial/chart boundary.
- Gate 4 is in progress (`86%`). `src/pivot/runtime/materializePivotTree.ts` now owns
  production fact-store-to-tree materialization for branch, batch, and initial
  trees, metric/measure axis materialization, row and column subtotal leaf
  injection, and row subtotal labeling. `ingestQueryResults.ts` is back to
  ingestion/fact-store orchestration. `pivot/core/tree.ts` now exposes only
  production merge/label formatting helpers; raw-record tree fixture
  construction lives under `test/plugin/fixtures`. Values/metric axis,
  measure-axis, and subtotal helpers live under the materializer boundary.
  The broad `src/utils.ts` utility surface no longer re-exports the raw-record
  tree builders or subtotal materialization helpers. The legacy initial-tree
  wrapper in `ingestQueryResults.ts` is gone. `PivotTableChart.tsx` also no
  longer performs a second measure-leaf materialization pass; runtime/upstream
  materialization owns that contract.
- Gate 5 is started but still the largest source of complexity (`73%`).
  `useExpansionEngine` no longer infers fetched state from rendered trees and
  the planner no longer consumes raw fetched-depth maps or rendered-child
  loaded-state callbacks. Pending/loading state
  now lives in a reducer, row/column pending/expanded state updates are
  axis-neutral, same-axis/cross-axis branch/batch fetching shares one
  local/single/batch helper path, fetched-result delta application is shared,
  reinitialized expansion-state resolution is pure, visible-key persistence
  reuses the render model, fetched coverage now satisfies planned expansions
  without a local tree-shape recheck, and the unused legacy fetch coordinator is
  gone. The hook still owns hydration iteration, cancellation, and React state
  commits.
- Gate 6 is partially complete (`83%`). Projection now drives toggle eligibility,
  column display projection, collapsed Values semantics,
  visible-axis construction, narrower child-filter decisions, and the
  metric-first expanded column header display rule. Row-subtotal filtering now
  trusts layout-owned metric placement instead of scanning rendered rows for
  the metric dimension index. The rendered-tree loaded-state fallback is gone.
  Column subtotal header projection now trusts visible child state instead of
  scanning all descendants, single-use visible-axis/depth helpers have been
  folded into the render boundary, one row-end Values child-filter branch has
  been deleted, and the row/column child-filter prelude is now shared.
  Remaining work is mostly deeper row subtotal policy.
- Gate 7 has only been lightly reduced (`46%`). `PivotTableChart.tsx` is smaller than
  baseline, but at roughly `2578` lines it still owns committed-tree sync,
  runtime layout coverage checks, dimension filters, interaction wiring, and
  controller-like responsibilities.

Current largest production hotspots by line count:

- `PivotTableChart.tsx`: `2578` lines. It still owns committed-tree sync,
  runtime layout coverage checks, dimension filters, interaction wiring, and
  controller-like responsibilities.
- `useExpansionEngine.ts`: `1731` lines. This is still the largest runtime
  orchestration and deletion target.
- `materializePivotTree.ts`: `1266` lines. It is now production-only runtime
  materialization surface, but still large enough that splits must be tied to
  caller deletion or export parity.
- `expansion/engine.ts`: `854` lines. It now owns most pure expansion
  state/planning helpers; future Gate 5 moves should delete more hook code than
  they add here.
- `usePivotLayout.ts`: `1071` lines. This remains the main render/layout policy
  hotspot.
- `usePivotRenderModel.ts`: `695` lines. This is the next likely Gate 4/Gate 6
  deletion surface because render repair should shrink now that materialization
  creates metric, measure, and subtotal nodes.
- `visibility.ts`: `266` lines. Render/expansion now share the visible-axis
  boundary without exported single-use row/column/depth helpers; remaining
  deletion upside is smaller than `usePivotLayout` and `usePivotRenderModel`.
- `pivot/core/tree.ts`: `93` lines. It now contains only `mergeTrees` and label
  formatting helpers.
- `runtime/ingestQueryResults.ts`: `489` lines after the materialization
  extraction.

Recommended next sequence:

1. Continue Gate 6 child-filter/render-policy cleanup in `usePivotLayout.ts`
   and `usePivotRenderModel.ts`, but only where it deletes duplicated row/column
   policy or render repair.
2. Continue Gate 5 hydration/persistence only if the next helper deletes a
   materially larger hook branch than it adds to `expansion/engine.ts`.
3. Keep shrinking `usePivotLayout` opportunistically where row/column behavior
   is now proven axis-neutral.
4. Keep raw-record tree construction in tests only; any future direct tree
   fixture work should not reintroduce production materialization helpers.
5. Keep working in `PivotTableChart.tsx` only as a deletion exercise. A
   controller split is still not useful by itself; the win is removing chart
   branches that duplicate runtime/materializer decisions.

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
- Non-root planner satisfaction now relies on explicit fetched/fact coverage
  instead of treating rendered descendants as a loaded-state fallback. Tests
  that pass prebuilt `PivotTreeData` now seed bootstrap, branch, or rendered
  fixture fact batches explicitly.
- Verification after this cleanup: focused leaf/sorting, expansion/render,
  subtotal, and interaction suites passed; the normal full plugin test command
  passed `94` suites / `706` tests; full plugin ESLint passed with `0` errors
  and existing warnings. A serialized full-plugin Jest run with
  `--maxWorkers=1` hit broad timeout/JSDOM teardown failures, but the reported
  failed suites passed when rerun directly.
- Verification after the chart/runtime-layout surface cleanup: focused
  interaction layout, seamless expansion, expansion-state, sorting,
  interaction-layout resolver, and extra-filter normalization suites passed
  (`120` tests); the normal full plugin test command passed `94` suites /
  `706` tests; full plugin ESLint passed with `0` errors and `6` remaining
  warnings.
- Verification after the render/expansion surface cleanup: focused render,
  expansion-engine, expansion-state, and interaction-layout suites passed
  (`85` tests).
- Verification after deleting rendered-tree loaded-state fallback: focused
  planner/engine/prefetch suites passed (`24` tests); the normal full plugin
  test command passed `93` suites / `697` tests; full plugin ESLint passed with
  `0` errors and `6` existing warnings.

Immediate next step:

- Continue Gate 6 opportunistically where row/column behavior is visibly
  identical, but do not add render helpers unless they delete existing
  `usePivotLayout.ts` or `usePivotRenderModel.ts` branches in the same slice.
- Continue Gate 5 only when the hook branch removed is larger than the helper
  added. Hydration iteration and React commit orchestration are still the best
  remaining candidates, but only if the change is deletion-positive.
- Continue Gate 7 only where it removes chart-owned runtime logic. The next
  deletion-positive target is committed-tree/runtime-layout sync in
  `PivotTableChart.tsx`: keep exact fact-coverage semantics in
  `runtime/coverage.ts`, delete chart-side materialization/coverage
  second-guessing, and trust runtime materialization whenever possible.
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
  from `test/plugin/fixtures` and metric/measure/subtotal helpers from
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
  now combine `buildTreeFromRecords` from `test/plugin/fixtures` with
  `applyMetricAxis` or `applyMeasureHierarchyAxis` from the runtime materializer.
- `usePivotRenderModel.ts` no longer synthesizes missing column ancestor nodes
  for metrics-at-end layouts. The runtime materializer is now responsible for a
  complete column hierarchy, and the old component test for renderer-side repair
  was replaced with a materialization contract check.
- `PivotTableChart.tsx` no longer re-materializes measure leaves from raw source
  values or blocks upstream tree sync when a custom/offset leaf source metric is
  missing. Measure-leaf values must be present in the runtime/upstream
  materialized tree; missing values render as missing data instead of preserving
  stale committed values.

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
