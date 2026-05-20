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
- Core source size keeps moving toward the `8000` line strict-core target.

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
| Full production `src` | `33510` | `27130` | `-6380` | `< 28000` |
| Strict core pipeline | `11337` | `10901` | `-436` | `8000` |
| Non-visual chart runtime hooks | `4683` | `4024` | `-659` | `3000-4000` |
| Broad core pipeline | `16020` | `14927` | `-1093` | `11000-13000` |

Strict core breakdown:

| Area | Lines |
| --- | ---: |
| `pivot/runtime/*` | `3565` |
| `pivot/expansion/*` | `2135` |
| `pivot/query/*` | `1367` |
| `pivot/layout/*` | `739` |
| `pivot/core/*` | `159` |
| core domain helpers | `1549` |
| formatting/data/render-model support | `1389` |

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

Work from most impactful to least impactful. A commit is successful only if it
removes or clearly centralizes an authority surface while staying
deletion-conscious.

| Priority | Chunk | Target |
| --- | --- | --- |
| 1 | Manifest query executor | Collapse private transport helper branches into coverage-phase planning while preserving batching. |
| 2 | Expansion scheduler reduction | Delete duplicated row/column hydration, loading, pending, and reinitialization state. |
| 3 | Materializer one-pass model | Separate semantic tree construction from display projection; delete post-processing where behavior allows. |
| 4 | Render-policy deletion | Remove metric/header/subtotal inference from render/layout code. |
| 5 | Chart runtime shrink | Delete chart-owned runtime decisions; avoid extraction-only controllers. |

## Next Commits

1. Move Priority 2 in one larger pass: convert expansion loading/pending/manual
   state to an axis-neutral transition shape and delete hook-local duplication.
2. Attack Priority 3 only with tests first: isolate subtotal and measure-axis
   materialization behavior, then delete post-processing wrappers.
3. Resume Priority 4 after materializer behavior is stable: render should stop
   inferring metric/subtotal structure from tree shape.
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
