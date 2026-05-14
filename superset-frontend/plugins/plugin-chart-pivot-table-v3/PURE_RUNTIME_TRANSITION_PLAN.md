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

This is the living refactor plan for `pivot-table-v3`. It intentionally excludes
the old migration diary. Commit history and tests are the record for completed
slices.

The current goal is no longer to prove the pure runtime pipeline exists. It does.
The goal is to make the remaining runtime authority explicit, predictable, and
smaller.

## Current Pipeline

```text
form data + runtime UI state
  -> compilePivotProgram
  -> derive required fact coverage
  -> fetch missing DB aggregate facts
  -> ingest into PivotFactStore
  -> materializePivotTree
  -> build render/export model
  -> PivotTableView / worksheet export
```

Only fetches and persistence should have side effects. Tree nodes, rendered
cells, and worksheet cells are projections of DB facts, not canonical data.

## Hard Guardrails

- No render-time semantic repair.
- No tree-shape-as-loaded-state.
- No local projection for semantic layout changes.
- No query planning outside coverage.
- No materialization outside `materializePivotTree`.
- No chart-owned runtime second guessing.

Compatibility with previous behavior is not a requirement by itself. If a
simpler runtime model changes visible UX, document the case and get approval
before cutting.

## Current Metrics

Baseline: `7088db374448845ef6e71cf74817aa53efbc5fc1`.

- Production `src`: `14253` insertions, `14011` deletions, net `+242`.
- Current production TypeScript/TSX total: `33752` lines.
- Implied baseline production TypeScript/TSX total: about `33510` lines.

The refactor has substantially reduced the original chart and expansion
hotspots, but plugin-wide source is still slightly above the starting point.
Future work should be deletion-first and should avoid creating helper layers
that only move complexity.

## Active Refactor Points

### 1. Make Pivot Layout Authority Real

Problem:

- `LayoutContext` compiles `PivotProgram`, metric placement, subtotal levels,
  and expansion levels.
- Metric placement now comes from the compiled program instead of rendered-node
  scanning.
- The old intent/layout metric-index aliases have been removed. Layout, render,
  expansion, pruning, and display depth now share one program-derived metric
  index per axis.
- Remaining work is to delete display-only placement policy branches that no
  longer need to exist.

Target:

- `PivotProgram` and a program-derived layout policy are the only semantic
  authority for metric placement.
- Render/layout may inspect nodes for display availability, but not to decide
  where Values semantically belong.

Primary files:

- `src/pivot/layout/LayoutContext.ts`
- `src/pivot/runtime/compilePivotProgram.ts`
- `src/pivot/chart/layoutRuntime.ts`
- `src/pivot/chart/usePivotRenderModel.ts`
- `src/pivot/chart/usePivotLayout.ts`

Success criteria:

- One exported layout policy derived from `PivotProgram`.
- No duplicate metric-index resolution in render-model or expansion assembly.
- Tests cover Values placement at start, middle, and end for rows and columns.

### 2. Split Materialization Internals Without Moving Semantics To Render

Problem:

- `materializePivotTree.ts` owns the correct boundary, but the module mixes
  fact-to-tree construction, subtotal leaf injection, metric/measure tier
  injection, single-metric value propagation, and label/display conveniences.

Target:

- Keep semantic tree construction inside the materializer boundary.
- Split internals by responsibility only when it reduces code or clarifies an
  actual contract.
- Do not push metric, measure, subtotal, or aggregate semantics back into render.

Materializer should own:

- fact-to-tree construction;
- Values, metric, and measure structural nodes;
- subtotal structural nodes;
- canonical cell keys and value availability.

Render/display should own:

- hiding headers;
- visual ordering and CSS classes;
- labels that are purely display text;
- collapsed presentation;
- formatting.

Primary files:

- `src/pivot/runtime/materializePivotTree.ts`
- `src/pivot/measureLeaves.ts`
- `src/pivot/metricsTotals.ts`
- `src/pivot/render/renderModel.ts`
- `src/pivot/chart/renderDisplay.ts`

Success criteria:

- `materializePivotTree.ts` exposes a small semantic API.
- Internal materializer helpers are grouped by real ownership, not by wrapper
  extraction.
- Render tests prove the view consumes materialized structure without creating
  missing semantic nodes.

### 3. Use One Render Policy For Expansion And Rendering

Problem:

- Expansion builds a simplified `RenderModelConfig` for visibility/depth
  planning.
- The actual render path builds its config separately.
- Expansion correctness depends on those two policies staying equivalent.

Target:

- Expansion and rendering share the same render-policy/config builder, or
  expansion consumes a smaller pure visibility policy that is also used by the
  real render model.
- No hard-coded expansion-only subtotal, total-position, or child-policy
  defaults unless they are documented as intentionally different.

Primary files:

- `src/pivot/expansion/stateTransitions.ts`
- `src/pivot/chart/usePivotRenderModel.ts`
- `src/pivot/render/renderModel.ts`
- `src/pivot/chart/layoutRuntime.ts`
- `src/pivot/chart/renderDisplay.ts`

Success criteria:

- One config builder or one shared policy object feeds both expansion
  visibility planning and visible rendering.
- Expansion tests cover subtotal positions, metric-first/metric-last layouts,
  and collapsed Values tiers using the shared policy.
- Removing or changing a render visibility rule cannot silently leave expansion
  with stale behavior.

### 4. Keep Shrinking Chart-Owned Orchestration

Problem:

- `PivotTableChart.tsx` is much smaller than before, but it still composes many
  state machines: dataset metadata, dashboard sync, runtime layout,
  selection filters, seamless updates, expansion, formatting, interactions,
  sticky headers, and export.

Target:

- The chart shell wires inputs and renders the view.
- Runtime decisions live in owning modules: layout state, seamless update,
  expansion, formatting, render model, and export.
- Extract only when the extraction deletes chart-owned decisions or collapses a
  duplicated state machine. Do not add thin wrapper hooks that just relocate
  lines.

Primary files:

- `src/PivotTableChart.tsx`
- `src/pivot/chart/usePivotRuntimeLayoutState.ts`
- `src/pivot/chart/usePivotSeamlessRuntimeUpdate.ts`
- `src/pivot/expansion/useExpansionEngine.ts`
- `src/pivot/chart/useDimensionFilterValues.ts`
- `src/pivot/chart/usePivotDatasetMeta.ts`

Success criteria:

- Chart-level branches do not re-decide coverage, materialization, stale
  recovery, or committed-tree sync.
- Chart prop assembly is local and direct; runtime decisions are delegated to
  tested owning modules.
- File shrink is counted only when plugin-wide `src` also benefits or a real
  behavioral authority is removed from the chart.

### 5. Treat Values Placeholder As A Serialization Boundary

Problem:

- Control-panel form data still uses `METRICS_PLACEHOLDER`.
- Runtime interaction layout uses `valuePlacement`.
- Both models are necessary today, but the boundary must be explicit to avoid
  duplicate Values-placement behavior.
- Interaction mode currently has two valid layout authorities: the layout that
  produced the loaded query/fact coverage, and the local layout the user is
  editing. Attempts to delete the placement compiler before modeling this split
  regressed metric order changes, ownState layout preference, stale dashboard
  rerenders, and targeted fetch counts.

Target:

- Runtime truth is `PivotRuntimeLayout.valuePlacement` and `PivotProgram`.
- `METRICS_PLACEHOLDER` exists only as a control/form-data serialization adapter.
- Drag/drop and control-panel behavior route through the same placement
  compiler.
- Model the boundary explicitly as `loadedProgram`, `interactiveProgram`, and a
  transition decision that chooses reuse, targeted fetch, or seamless recovery.
  After that exists, delete placement-specific compile glue instead of keeping
  it as an implicit bridge.

Primary files:

- `src/controlPanel.tsx`
- `src/pivot/layout/resolveInteractionLayout.ts`
- `src/pivot/layout/interactionDrag.ts`
- `src/pivot/runtime/compilePivotProgram.ts`
- `src/pivot/core/tokens.ts`

Success criteria:

- Placeholder insertion/removal is not duplicated across controls and runtime.
- Tests cover converting placeholder form data to runtime placement and back.
- Runtime query/materialization/render paths do not treat the placeholder as
  semantic truth except through the compiler/adapter.
- Applied/query layout and committed local UI layout are separate typed states,
  not inferred from whichever formData snapshot is newest.

## Current Solid Ground

- Flexible Values placement remains supported on rows or columns, first,
  middle, or last.
- Metric placement policy no longer scans rendered tree nodes; layout, render,
  and expansion use the compiled program position.
- Metric placement no longer exposes separate intent/layout/render indexes.
- Expansion visibility now receives the same render-model config builder used by
  the chart render path instead of constructing its own simplified renderer.
- Main query planning uses explicit fact coverage rather than full possible
  layout depth.
- Branch and batch fetch params no longer expose tree shape.
- Fetch results describe loaded coverage through fact batches.
- Expansion loaded/fetched state is fact-coverage based.
- Semantic materialization is centralized under `materializePivotTree`.
- Export uses a worksheet model rather than DOM reconstruction.
- The chart delegates seamless update, runtime layout state, dataset metadata,
  dimension filter values, and export registration to helper modules.

## Current Risks

- Metric placement authority is now program-owned, but there are still
  display-policy branches that may be removable after UX review.
- Expansion and rendering share the layout-owned render-model config builder;
  remaining risk is smaller visibility-only logic inside expansion planning.
- `materializePivotTree.ts` is too large and combines several internal
  responsibilities.
- `PivotTableChart.tsx` is smaller, but it is still the rendezvous point for
  multiple runtime state machines.
- `useExpansionEngine.ts` and `stateTransitions.ts` remain large. Split only by
  real ownership, not by wrapper files.
- Large result sets still pay main-thread JSON parsing and React commit costs.

## Approval Checkpoints

Bring these back before implementing the behavior change:

- **Metric-placement policy tightening.** Rendered-node metric-index scanning is
  gone. Further simplification of header/subtotal policy can still change
  visible ordering and needs approval if UX changes.
- **Materializer/display split.** Moving label, subtotal, or single-metric
  propagation behavior can change what headers and cells appear before
  expansion.
- **Expansion/render policy unification.** If the shared policy changes
  expansion depth, toggle visibility, subtotal headers, or collapsed Values
  behavior, get UX approval first.
- **Values placeholder boundary.** Removing placeholder tolerance from saved
  form data would be a compatibility break; runtime-only cleanup is fine, but
  persisted control behavior needs approval. Deleting
  `compilePivotProgramFromPlacement` also needs the explicit loaded-vs-local
  program boundary first; otherwise it changes interaction-state UX.
- **Large-result interactivity.** Worker/off-thread/chunked commit changes can
  alter loader timing and must be planned as an interactivity change.

## Testing And Validation

Prefer focused Jest/RTL tests over Cypress. For this plugin, broad Jest can
leave many hanging node processes, so default to serialized focused runs:

```bash
cd superset-frontend
node_modules/.bin/eslint plugins/plugin-chart-pivot-table-v3/<paths>
node_modules/.bin/jest --runInBand --forceExit --silent <test files>
node_modules/.bin/prettier --write <changed files>
git diff --check
```

Minimum coverage by slice:

- Layout authority: `compilePivotProgram`, layout runtime, render model, and
  metric-tier/Values-placement tests.
- Materialization: fact-store/materializer tests plus chart/render smoke for
  visible metric/measure/subtotal structure.
- Expansion/render policy: expansion planner/state transitions, render model,
  subtotal/metric-first/metric-last cases, and at least one chart interaction
  suite.
- Chart orchestration: seamless runtime, runtime layout state, interaction
  layout, filter seamless, and export registration tests.
- Values placeholder: control-panel mapping, interaction drag/layout, compiler
  placement, and applied interaction form-data tests.

## Success Definition

This refactor is complete when:

- `PivotProgram` is the single semantic authority for layout and Values
  placement;
- query planning consumes coverage only;
- fetched/loaded decisions come from fact coverage or pending coverage, not tree
  shape;
- semantic materialization is contained under `materializePivotTree`;
- expansion and render visibility use one policy path;
- render does not create or repair semantic nodes;
- chart code does not override runtime coverage or materialization decisions;
- branch and layout fetches remain targeted and do not globally block
  interaction; and
- plugin-wide source movement is deletion-positive or explicitly justified by a
  clearer runtime boundary.
