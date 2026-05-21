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

This file is the current operating plan only. It intentionally does not keep a
full refactor history; commit history and tests are the record for completed
slices.

## Goal

Finish the transition to a pure pivot runtime with fewer authority layers and a
smaller core engine.

Concrete success criteria:

- One compiled pivot program is the source of layout semantics.
- A set-oriented coverage manifest decides what data is required.
- The fact store owns loaded query coverage only.
- Query planning fetches only missing visible/expanded coverage.
- Materialization builds the semantic tree from loaded facts.
- Render/export consume the materialized tree without semantic repair.
- Chart code wires runtime pieces but does not second-guess loaded state.
- Interactions remain live while requests/materialization are in progress.
- Hidden or not-expanded layers do not trigger query loads.
- Strict core pipeline source keeps moving toward the `8000` line target.
- Full production `src` keeps moving toward the `<20000` line target.

## Target Pipeline

```text
form data + UI intent
  -> compilePivotProgram
  -> build required visible coverage
  -> diff against PivotFactStore coverage
  -> plan transport batches for missing coverage
  -> fetch DB aggregate facts
  -> ingest exact fact batches into PivotFactStore
  -> materializePivotTree
  -> render/export
```

Only fetches, fact-store mutation, and persistence should have side effects.
Tree nodes and rendered cells are projections, not canonical state.

## Architecture Rules

- `root` coverage means no branch filter. It never means all possible paths.
- `paths` coverage means only the listed visible/expanded branches.
- `scopedFull` coverage means full expansion only inside explicit ancestors.
- Pre-expand levels compile to the same coverage manifest as manual expansion.
- Row x column expansion creates explicit intersection coverage needs.
- Many explicit expands may be transport-batched.
- Batching is a query transport optimization, not a runtime state model.
- No unbounded full-level query unless the user action explicitly requests a
  bounded broad scope.
- Adding a hidden trailing dimension does not create a query need.
- Semantic layout changes fetch query-backed coverage; they are not locally
  projected from old facts.
- Metric reorder can remain cosmetic when the selected metric set is unchanged.
- Loaded broader coverage may satisfy narrower needs only through tested
  fact-store dominance rules.

## Guardrails

- No render-time semantic repair.
- No tree-shape-as-loaded-state.
- No local projection for semantic layout changes.
- No query planning outside coverage.
- No materialization outside `materializePivotTree`.
- No chart-owned runtime second guessing.
- No fetch for hidden/not-expanded layers.
- No compatibility adapters unless they delete a larger old surface in the same
  slice.
- UX changes that alter visible behavior need approval before cutting.

## Current Status

Baseline: `7088db374448845ef6e71cf74817aa53efbc5fc1`.

| Scope | Baseline lines | Current lines | Delta | Target |
| --- | ---: | ---: | ---: | ---: |
| Full production `src` | `33510` | `26546` | `-6964` | `< 20000` |
| Strict core pipeline | `12907` | `10556` | `-2351` | `< 8000` |

Diagnostic scope only:

| Scope | Baseline lines | Current lines | Delta |
| --- | ---: | ---: | ---: |
| Core pipeline dirs (`runtime/expansion/query/layout/core`) | `8698` | `7777` | `-921` |

Core pipeline breakdown:

| Area | Lines |
| --- | ---: |
| `pivot/runtime/*` | `3466` |
| `pivot/expansion/*` | `1971` |
| `pivot/query/*` | `1372` |
| `pivot/layout/*` + `pivot/core/*` | `878` |
| core domain helpers | `1549` |
| formatting/data/render-model support | `1311` |

Completed structural cuts:

- Branch/batch/intersection fetch APIs were removed from production callers.
- Expansion fetch now receives coverage targets, not request kinds.
- Production query planning exposes phased expansion specs only; flattened query
  spec helpers are test-fixture utilities.
- Axis expansion and sibling batching now share one axis-path scope query
  builder; batching is no longer represented in query names.
- Query specs carry exact fact-store selectors.
- Expansion query planning now emits ordered target groups instead of separate
  batch/single transport branches; intersection specs remain a later phase so
  branch fetches can satisfy them before they load.
- Expansion coverage planning no longer depends on the render model.
- Configured pre-expansion now compiles into manifest-shaped coverage.
- Initial query planning fetches visible root coverage only.
- Same-axis expansion, persisted expansion, and hydration share the same
  manifest executor.
- Expansion layout transitions no longer locally prune/project tree shape; the
  loaded tree stays intact and expansion state controls visibility.
- Expansion layout transition planning now reports layout metadata only; loaded
  tree selection stays in the expansion engine.
- Skipped pre-Values metric expansion now requests canonical visible coverage
  when an ancestor expansion makes the skipped dimension visible; it does not
  request still-hidden skipped layers.
- Expansion planning now returns coverage targets directly; path-discovery is
  no longer a parallel planner result and intersection gating derives from the
  requested expansion keys against the current tree.
- Expansion query specs now derive filter dimensions and anchor depth from the
  coverage target instead of passing a separate query-context callback through
  the planner.
- Expansion fetch execution now uses the request lifecycle scope as the request
  group identity instead of serializing target payloads into scheduler state.
- Expansion hook loading reset no longer has a separate callback wrapper; the
  hook updates loading state directly where request lifecycle changes occur.
- Expansion fetch runtime now captures the form-data snapshot at request start
  and uses its request scope directly for liveness checks.
- Seamless runtime updates now use one latest-request scope across fetch and
  materialization; the duplicate materialization lifecycle and generic request
  wrapper were removed.
- Seamless runtime sync now produces a single optional follow-up update instead
  of an array of duplicate chart-side updates.
- The latest-request lifecycle no longer exposes token objects or a top-level
  finish API; request-group liveness is scope-owned.
- Expansion hydration now rematerializes through the async materializer after
  fetches, so large expansion result commits can yield like seamless updates.
- Fact-batch materialization now owns fact-tree construction directly; the
  separate sync/async fact-tree wrapper functions were removed.
- Planned query fetch ingestion now uses one fact-store upsert path; the
  hook-local sync ingestion branch was deleted.
- Sync and async fact-store materialization now share the same plan-group to
  materializer input mapping.
- Expansion fetch commits now always use the async materializer boundary; the
  expansion hook no longer owns a fact-count-based sync/async branch.
- Skipped pre-Values metric expansion now canonicalizes inside the normal
  coverage target builder; the parallel skipped-target planner branch was
  removed, and skipped requests require the visible ancestor to be expanded.
- Initial query planning now builds its root coverage specs as one declarative
  list, and the single-use metric override helper was inlined into the initial
  update plan.
- Branch coverage planning now stores requested depth pairs directly in one
  ordered set instead of maintaining parallel pair arrays and key maps.
- Hydration now executes one compiled manifest fetch instead of an iterative
  expansion loop; the old `fetchExecution.ts` wrapper and convergence/exhaustion
  states were removed.
- Expansion branch coverage is now first-class `scopedFull` fact coverage
  instead of overloading `axisPaths` to mean subtree loading.
- Hydration manifest planning no longer reads materialized tree visibility or
  loaded node maps; it derives requested depths and branch targets from explicit
  expansion keys plus configured coverage needs.
- Fact store batch filtering now only carries the intersection scope matcher it
  actually enforces; root and axis-path batches stay batch-level coverage
  records.
- Column subtotal rendering now expects explicit materialized subtotal leaves;
  tests no longer preserve parent-node subtotal fixture shapes that production
  render would need to repair.
- Metric rows and measure-leaf rows now share one conditional-formatting/databar
  control implementation; measure-leaf controls no longer duplicate formatter,
  color, and scale-like UI logic.
- The in-chart interaction panel now uses the shared interaction drag placement
  helper for checkbox row/column moves; panel-local value-index surgery was
  removed.
- Interaction chip strips now own their drop behavior directly; duplicate
  filler drop-zone components were removed.
- Query-support metrics for metric formatting, dimension formatting, dimension
  sorting, and databars now share one metric-reference resolver before query
  planning adds extra metrics.
- Test fact-tree fixtures no longer rewrite every partially loaded aggregate
  path into a subtotal leaf; subtotal leaves are explicit fixtures or injected
  by the materializer path.
- Fixed and user-controlled control-panel layouts now share the same dimension
  state mapping helpers, and fixed row/column controls call the canonical pivot
  placement compiler directly instead of accepting an injected placement
  resolver.
- Collapsed dimension state no longer suppresses visible metric-tier expansion
  keys, so metric rows can reopen under a collapsed parent without expanding the
  dimension children.
- Values-at-end materialization now preserves the hidden value-axis root anchor
  needed by render traversal.
- Materialization is fact-store backed for initial and incremental paths.
- Materialization batch projection now shares the subtotal injection plan between
  sync and async paths instead of carrying separate coverage/subtotal branches.
- Materialization no longer has a final root relabel wrapper; root labels are
  produced by tree construction/projection.
- The legacy production `pivot/core/tree.ts` wrapper was removed; label
  formatting now lives with the view model, and tree merging is local
  materializer plumbing.
- Chart-owned metadata recovery and several render-policy adapters were
  removed.
- The render model hook no longer exposes a second `renderTree`; chart code now
  passes the materialized expansion tree directly into formatting, filters, and
  view rendering.
- Expansion reinitialization and hydration planning now use axis-keyed
  transition state instead of parallel row/column transition fields.
- Expansion persistence now stores explicit user intent directly instead of
  deriving a "visible persisted state" from the materialized tree. This removes
  tree-visibility scanning from `stateTransitions.ts`; coverage planning still
  decides which persisted/explicit paths are fetchable.
- Expansion hydration now builds direct, axis, and intersection coverage
  candidates first, then uses `diffCoverageManifest` as the loading authority;
  the old exported target-level coverage filter was removed.
- Expansion hydration fetch planning now uses explicit expansion intent plus
  configured coverage needs; materialized tree-derived expansion is only used
  after materialization to commit visible UI state.
- Seamless runtime state now treats committed fact batches as the authority:
  expansion fetches publish their updated fact batches back to seamless state,
  prop sync rematerializes the committed tree from fact batches, and covered
  layout changes rematerialize locally from committed facts instead of trusting
  the previous committed tree.
- Fact selectors and fact batches now carry the query-context identity that
  produced them. Filtered, unfiltered, and time-offset contexts can no longer
  satisfy each other accidentally.
- Seamless runtime coverage no longer drops all committed fact batches when
  filters are present. The fact store now decides compatibility through
  context-scoped selectors and `diffCoverageManifest`.
- Query ingestion, expansion hydration, and materialization now read only the
  active query context's fact selectors/batches.
- Measure-leaf query coverage remains leaf-scoped for offsets and support
  metrics, while the materializer preserves configured sibling leaf headers for
  loaded metrics and only projects expanded child branches when that leaf's
  value is present.
- Expansion reinitialization no longer decides whether to fetch from layout
  transition heuristics, persisted expansion flags, or hidden-append branches.
  It asks the same manifest hydration plan used by expansion fetches. If
  visible coverage is missing, the manifest fetches it; if fact-store coverage
  satisfies the visible need, no request is sent.
- The expansion state model no longer receives coverage needs or scans the tree
  to derive fetchable coverage. It only merges manual expanded/collapsed UI
  intent over already-planned coverage-expanded keys.
- Hydration planning moved out of `stateTransitions.ts` and into
  `expansion/planner.ts`, next to coverage targets and
  `diffCoverageManifest`.
- Initial root-load coverage construction moved from `query/specs.ts` into the
  coverage manifest layer, so query specs consume required root coverage instead
  of carrying the initial-load branch list directly.

Latest source delta for this slice: `-2` production `src` lines.

Coverage-manifest loading authority status: complete for root bootstrap,
configured pre-expansion, persisted/manual expansion, expansion reinitialization,
seamless runtime sync, and query-context-scoped fact-store matching. Remaining
work below is pure-runtime simplification after that loading authority is in
place.

Completion checklist for the loading-authority plan:

- Source code line count is lower than before the slice.
- `query/specs.ts` has less initial-load special branching.
- `stateModel.ts` no longer derives fetch needs from tree scans.
- `stateTransitions.ts` no longer has a separate hydration planner authority.
- `useExpansionEngine.ts` executes coverage diff through the manifest planner,
  not tree repair.
- `seamlessRuntimeUpdate.ts` keeps committed fact batches authoritative instead
  of erasing expansion state and relying on later hydration.
- No fallback, compatibility adapter, or duplicate loading planner was added.

Remaining duplicate authority:

- `stateTransitions.ts` and `useExpansionEngine.ts` still own too much
  scheduler state and row/column orchestration.
- `materializePivotTree.ts` still mixes tree construction, subtotal injection,
  measure-axis projection, and some display labeling.
- Render/layout code still contains policy that should become pure projection
  over the materialized tree.
- `PivotTableChart.tsx` still coordinates too many runtime state machines.

Open behavior checkpoints:

- Removing single-metric base-cell propagation from measure-axis projection
  breaks visible single-metric cells, column subtotal values, databar/sorting
  offsets, and expansion subtotal cells. This branch is not a safe deletion
  target without an explicit UX redesign for single-metric layouts. The visible
  redesign where single-metric pivots always show the metric tier is rejected,
  so current single-metric base-cell behavior must remain.

## Execution Order

There is one active priority: complete the pure runtime transition while
shrinking production source. Work from the highest-impact authority surface to
the lowest-impact cleanup. A commit is successful only if it removes or clearly
centralizes an authority surface while staying deletion-conscious.

Current order:

1. Expansion scheduler reduction: delete duplicated row/column hydration,
   loading, pending, and request lifecycle state now that the manifest is the
   loading authority.
2. Materializer one-pass model: separate semantic tree construction from display
   projection and delete post-processing where behavior allows.
3. Render-policy deletion: remove metric/header/subtotal inference from
   render/layout code.
4. Chart runtime shrink: delete chart-owned runtime decisions; avoid
   extraction-only controllers.

## Next Commits

1. Reduce the remaining expansion hook scheduler state or fold it into manifest
   execution.
2. Isolate subtotal and measure-axis materialization behavior, then delete
   post-processing wrappers.
3. Remove render metric/subtotal structure inference after materializer behavior
   is stable.
4. Shrink `PivotTableChart.tsx` only where code is deleted, not merely moved.

## Verification Standard

Each source-changing commit should include:

- focused unit/contract tests for the touched runtime boundary;
- relevant chart interaction tests when behavior crosses the UI surface;
- ESLint for changed TypeScript files;
- `git diff --check`;
- updated metrics in this file.

Known recurring test noise:

- Jest reports duplicate manual mocks in the wider Superset frontend setup.
- Browserslist data is stale.
- Babel lodash emits an `isModuleDeclaration` deprecation warning.

These warnings are not pivot-table-v3 regressions, but test failures are.
