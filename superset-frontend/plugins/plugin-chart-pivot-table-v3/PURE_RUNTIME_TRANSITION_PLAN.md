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

## Selected Architecture: Set-Oriented Coverage Manifest

This is the next concrete architecture cut. It replaces scattered
fetch/layout/expansion heuristics with one rule:

```text
build required visible coverage
  -> diff against loaded fact coverage
  -> fetch only missing explicit coverage
  -> materialize from loaded facts
  -> render
```

The decision criteria are:

1. **Elegant:** one rule explains query/loading behavior across layout changes,
   expansion, and recovery.
2. **Low code:** the change replaces existing planner/coverage branches instead
   of adding a parallel runtime framework.
3. **Fast:** the runtime avoids hidden/not-expanded layers, diffs loaded
   coverage before querying, and keeps interaction state responsive while data
   loads.

The manifest is **set-oriented**, not cell/intersection-entry oriented. A single
logical need can describe multiple explicit row branches crossed with multiple
explicit column branches:

```ts
type AxisPathScope =
  | { kind: 'root' }
  | { kind: 'paths'; paths: PivotPath[] }
  | { kind: 'scopedFull'; ancestorPaths: PivotPath[] };

type CoverageNeed = {
  rowDepth: number;
  columnDepth: number;
  rowScope: AxisPathScope;
  columnScope: AxisPathScope;
  reason: 'root' | 'expand' | 'intersection' | 'subtotal' | 'sort';
};
```

Rules:

- `root` means root/no branch filter. It never means "all possible paths".
- `paths` means only the listed explicit visible/expanded branches.
- Adding a dimension to the layout does not create a query need by itself.
- Expanding a node creates a path-scoped need for the newly visible layer.
- Row x column expansion creates intersection needs for explicit visible row
  path sets crossed with explicit visible column path sets.
- Full expansion is path-scoped, not level-global. A middle layer can be fully
  expanded under an explicit ancestor such as `[USA] -> all states -> city`
  without implying that the same layer is fully expanded for every country.
- A later layer can also be fully expanded under that scoped middle layer. The
  manifest must represent this as explicit ancestor-scoped sets, not as a
  requirement for full expansion of all previous layers.
- Consecutive full-expansion layers are also scoped. For example,
  `[USA] -> [full states] -> [full cities] -> [store]` still means only the
  explicit subtree under `USA`, not all states and cities globally.
- Broader loaded scoped coverage can satisfy narrower scoped-full descendant
  needs. For example, loaded coverage for `[USA]` at the requested depth covers
  `[USA, California]`; the reverse is not true.
- Many small expands may be transport-batched, but they must not be promoted
  into an unbounded full-level query.
- No full-level expansion query is allowed unless the user action explicitly
  requests a bounded broad scope.
- Loaded broader coverage can satisfy narrower explicit needs only through a
  conservative, tested dominance check.

This is the selected path because it centralizes the right complexity:

- manifest construction owns "what visible data is required";
- fact coverage diff owns "what is already loaded";
- query planning owns "how to batch explicit missing needs";
- materialization and rendering stop repairing or inferring loaded state.

Expected deletion targets:

- remaining non-manifest coverage planning in expansion and query batching;
- duplicate expansion/query coverage planning;
- tree-shape-as-loaded-state checks;
- seamless recovery branches that exist only because coverage ownership is
  implicit;
- render/chart fallbacks that re-decide whether semantic data is loaded.

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

- Production `src`: `13993` insertions, `14260` deletions, net `-267`.
- Current production TypeScript/TSX total: `33243` lines.
- Implied baseline production TypeScript/TSX total: about `33510` lines.

The refactor has substantially reduced the original chart and expansion
hotspots, and plugin-wide source is now slightly below the starting point.
Future work should remain deletion-first and should avoid creating helper layers
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
  editing.

Target:

- Runtime truth is `PivotRuntimeLayout.valuePlacement` and `PivotProgram`.
- `METRICS_PLACEHOLDER` exists only as a control/form-data serialization adapter.
- Drag/drop and control-panel behavior route through the same placement
  compiler.
- Model the boundary explicitly as `loadedProgram`, `interactiveProgram`, and a
  transition decision that chooses reuse, targeted fetch, or seamless recovery.

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
- Applied interaction layout now compiles through `compilePivotProgram`; the
  placement-only compiler bridge has been removed.
- Set-oriented coverage manifest primitives now exist for root runtime-layout
  coverage and explicit path-set coverage diffing.
- Runtime layout fetches now route through manifest diff instead of the old
  root-depth/leading-dimension heuristic.
- Hidden-dimension layout edits no longer force a fetch when the visible
  coverage manifest is unchanged.
- Values index shifts caused only by hidden dimensions no longer count as
  semantic placement changes; moving Values across an already shared visible
  dimension still fetches.
- Runtime coverage and fact-store selectors now include metric payload
  `valueKeys`, so metric add/remove decisions go through the same coverage
  manifest instead of a separate semantic-layout fetch branch.
- Broader metric batches can satisfy narrower metric requests, while missing
  metric payloads no longer count as loaded coverage even when row/column depth
  matches.
- Fact-store compatibility now uses the coverage manifest dominance rule for
  branch and batch reuse, so a batched explicit path set can satisfy a narrower
  branch without a duplicate fetch.
- Expansion fetched coverage is derived from loaded fact batches; the hook no
  longer maintains or prunes a separate fetched-depth map. Removing a hidden
  trailing dimension after expansion can now reuse exact loaded coverage without
  a seamless recovery fetch.
- Resolved query fetch context owns its fact coverages, so branch, batch, and
  signature callers no longer rebuild the same coverage list separately.
- Expansion planner no longer owns a fetched-depth lookup. It asks a runtime
  coverage predicate whether an axis path is loaded, and the old
  `fetchedRequests.ts` module has been deleted.
- The old standalone expansion coverage planner module has been collapsed into
  the grouped expansion planner boundary.
- Expansion/query transport targets no longer carry duplicate
  `childDepth`/`requiredOppositeDepth` metadata. Depth remains planner/signature
  input, while fetch targets only identify the branch to fetch.
- Expansion coverage lookup now reads from the fact store directly. The hook no
  longer mirrors loaded fact batches or wires a separate `recordFactBatches`
  callback through fetch loops.
- Expansion coverage now uses the same set-oriented manifest diff as runtime
  layout coverage. Expansion needs are path-local on the expanded axis
  (`path + next dimension`) and keep only the opposite-axis visible context.
  This avoids promoting nested persisted paths such as `[A]` and `[A, X]` into
  repeated broad `[A]` depth-3 fetches.
- Expansion fetchability is now expressed as an axis/path policy instead of a
  tree-node policy. The planner still consumes tree nodes to find present or
  missing ancestors, but it no longer asks node shape whether semantic children
  should be fetched.
- Branch and batch execution now fetch only query specs whose coverage is
  missing from the fact store, then materialize from the full requested spec
  set. This avoids refetching already-loaded support coverage while preserving a
  single transport batch for the truly missing specs.
- Branch and batch execution no longer run a separate all-local preflight before
  entering the spec fetch path. The spec fetch path owns both all-local
  materialization and partial missing-spec fetches.
- Fact-store compatibility keeps root/no-branch coverage separate from explicit
  branch coverage. Root is not a wildcard for arbitrary expanded paths under
  the set-oriented manifest.
- Expansion coverage checks now use a manifest-diff API that returns missing
  coverage requests instead of a single-key loaded predicate. Hydration and
  branch fetch loops can now reason from the same "which coverage is missing"
  shape used by runtime layout fetch decisions.
- Cross-axis root recovery no longer scans rendered intersection cells to infer
  whether root data is loaded. It asks the expansion coverage manifest for the
  missing root request and only applies during an actual cross-axis fetch.
- The materializer no longer exports a dead fact-store compatibility wrapper or
  test-fixture-only materialization entrypoints. Production callers now go
  through the explicit branch/initial materialization APIs.
- Measure-axis materialization now uses one axis-neutral cell projection loop
  for row and column Values placement. Row-only subtotal placement and
  column-only single-metric base-cell propagation remain explicit visible
  behavior instead of duplicated axis branches.
- Hydration finalization now applies parent deltas before descendant deltas, so
  persisted nested expansion results survive branch pruning.
- Seamless layout updates no longer freeze the table behind a separate pending
  display snapshot. The chart renders the committed runtime tree directly while
  fetch/materialization is pending, so expansion/loading feedback remains live
  instead of being hidden by chart-owned snapshot state.
- Seamless runtime no longer owns a duplicate pending-layout object ref. Pending
  local layout intent is derived from the existing UI-layout and committed-layout
  refs at the prop-sync boundary, which keeps local edits from being overwritten
  by stale props without adding a second layout authority.

## Current Risks

- Metric placement authority is now program-owned, but there are still
  display-policy branches that may be removable after UX review.
- Expansion and rendering share the layout-owned render-model config builder;
  remaining risk is smaller visibility-only logic inside expansion planning,
  not fetched-state inference from metric tree nodes.
- `materializePivotTree.ts` is too large and combines several internal
  responsibilities.
- `PivotTableChart.tsx` is smaller and no longer owns pending display or
  pending layout snapshots, but it is still the rendezvous point for multiple
  runtime state machines.
- `useExpansionEngine.ts` and `stateTransitions.ts` remain large. Split only by
  real ownership, not by wrapper files.
- Expansion now has the right manifest-diff API, but the grouped planner still
  builds fetch targets from keys after identifying missing coverage. The next
  deletion opportunity is to make the planner produce missing coverage requests
  first, then derive transport batches directly from those requests.
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
  persisted control behavior needs approval.
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
