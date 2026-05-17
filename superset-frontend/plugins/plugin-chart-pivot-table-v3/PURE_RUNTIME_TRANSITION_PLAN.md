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

Current fact-store contract:

- fact batches represent loaded query coverage only;
- non-requestable paths, such as expansions that only reveal Values tiers, do
  not create empty coverage marker batches;
- repeated no-query behavior should be prevented by planner/requestability
  policy, not by pretending that an empty fact batch was loaded.

Current semantic-layout contract:

- Values placement changes are semantic layout changes and trigger fetch;
- dimension-only changes may reuse loaded facts only when the coverage manifest
  proves the next visible root coverage is already loaded;
- seamless runtime update should not locally project around Values placement by
  comparing shared dimension prefixes;
- seamless runtime update should ask fact coverage directly instead of using
  manifest-signature equality as a proxy for loaded data.

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

- Production `src`: `14335` insertions, `15784` deletions, net `-1449`.
- Current production TypeScript/TSX total: about `32557` lines.
- Implied baseline production TypeScript/TSX total: about `33510` lines.

The refactor has substantially reduced the original chart and expansion
hotspots, and plugin-wide source is now slightly below the starting point.
Future work should remain high-impact-first while still deleting code where the
new runtime authority makes old branches redundant. Avoid helper layers that
only move complexity.

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
- Expansion requestability should become a compiled runtime rule, for example
  `program.canRequestExpansion(axis, semanticPath)`, or an equivalent policy
  derived directly from `PivotProgram`. Rendered tree nodes may identify present
  paths and ancestors, but they should not decide whether a query is allowed.

Immediate policy:

- Synthetic display paths, including subtotal-token paths, may exist in the
  rendered tree and expansion state.
- Those paths must not become query coverage requests. They are display
  projections, not real fact-store coverage anchors.
- Expansion requestability authority is the compiled runtime policy:

  ```ts
  program.canRequestExpansion(axis, semanticPath);
  ```

  or an equivalent `PivotProgram`-derived function. This is the selected model.

- Query requestability belongs at the compiled runtime-policy level, not at the
  rendered-node level. The preferred shape is
  `program.canRequestExpansion(axis, semanticPath)` or an equivalent
  `PivotProgram`-derived function. A node may expose `kind` or `fetchable` as a
  cached projection of that policy, but planner/query code should not use node
  shape as the authority for whether a request is allowed.
- The rejected model is making fetchability depend directly on rendered tree
  shape, for example `node.kind === 'dimension' && node.fetchable === true`.
  That is lower effort short term, but it keeps query authority in the display
  tree and preserves the current tree-shape-as-loaded-state problem.
- Expansion planning now filters by the program-derived requestability rule
  before coverage diffing. The larger cleanup is to keep moving remaining
  token/path fetchability checks behind compiled runtime policy.
- Branch and batch query-spec construction now use the same requestability
  policy, so synthetic subtotal paths cannot bypass the planner and create
  query loads from the query-spec boundary.

Primary files:

- `src/pivot/expansion/stateTransitions.ts`
- `src/pivot/expansion/planner.ts`
- `src/pivot/runtime/compilePivotProgram.ts`
- `src/pivot/runtime/projection.ts`
- `src/pivot/chart/usePivotRenderModel.ts`
- `src/pivot/render/renderModel.ts`
- `src/pivot/chart/layoutRuntime.ts`
- `src/pivot/chart/renderDisplay.ts`

Success criteria:

- One config builder or one shared policy object feeds both expansion
  visibility planning and visible rendering.
- Expansion fetch planning asks the compiled program/policy whether a semantic
  path can request children; it does not infer query eligibility from rendered
  node shape or synthetic display tokens.
- Subtotal, metric, and measure display nodes cannot independently generate
  query loads unless the compiled policy explicitly maps them to a real
  semantic dimension request.
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
- Query shape now owns query-intent support-metric decisions directly; the
  separate `queryIntent.ts` helper layer has been removed.
- Branch and batch fetch params no longer expose tree shape.
- Fetch results describe loaded coverage through fact batches.
- Expansion loaded/fetched state is fact-coverage based.
- Semantic materialization is centralized under `materializePivotTree`.
- Export uses a worksheet model rather than DOM reconstruction.
- The chart delegates seamless update, runtime layout state, dataset metadata,
  dimension filter values, and export registration to helper modules.
- Formatting no longer rebuilds query-support metric lists or tree-data
  signatures. Those belong to transform/query planning, and the chart consumes
  the supplied signature.
- Metric-axis layout policy, axis child projection, and collapsed Values
  projection now read metric placement from the compiled `PivotProgram`
  instead of accepting duplicated chart-owned placement inputs.
- Values-position helpers now live under runtime projection. Layout,
  formatting, pruning, and expansion no longer recalculate metric-axis indexes
  from `metricsLayoutResolved`, raw dimension counts, or hook-local flags.
- Auto-expanded Values-tier behavior is now a program-derived projection rule.
  Chart layout no longer passes `shouldExpandMetricRows` /
  `shouldExpandMetricCols` through render and expansion boundaries.
- Runtime coverage and column display now use Values-position projection helpers
  instead of reading `metricsLayoutResolved` / `metricInsertIndex` directly.
- Row subtotal filtering and stale collapsed-branch pruning also read metric
  axis/index semantics from `PivotProgram`; chart layout no longer passes those
  placement facts into those policy helpers separately.
- Metric total and node-depth classification now derive metrics-first and row
  metric-index semantics from `PivotProgram`, removing another render-time
  placement flag path.
- Expansion-state signatures now derive metric identity from
  `PivotProgram.metricKeys` instead of re-reading raw layout metrics.
- Metric-key derivation and node-label formatting now consume `PivotProgram`
  directly instead of receiving separate `metricsLayout` / row metric-index
  inputs from formatting.
- Render-model root suppression now consumes `PivotProgram`; render config no
  longer carries separate metric-layout and metrics-first flags.
- Render-model and display-state depth policy now derive row/column groupby
  depth from `PivotProgram`; render config no longer accepts duplicate groupby
  length inputs from chart layout.
- `LayoutContext` no longer exposes duplicate semantic row/column dimension
  arrays. Runtime planning, formatting, rendering, and transform signatures read
  semantic dimensions from `PivotProgram`; raw groupby arrays remain only for
  form/control serialization.
- `LayoutContext` also no longer re-exposes metric layout or metric insertion
  position. Consumers read those placement facts from `PivotProgram`.
- `LayoutContext` no longer returns raw placeholder-preserving groupby arrays
  or the input-only collapse defaults. Those remain local compile inputs, not
  runtime context authority.
- `LayoutContext` no longer duplicates metric keys; consumers read metric keys
  from `PivotProgram`.
- `PivotLayoutResult` no longer exposes the unused `hasMultipleMeasures` alias;
  it remains local to render-model config construction.
- Column display path policy now consumes `PivotProgram`; render no longer
  passes separate column metric-layout, metric-first, or metric-at-end flags into
  the display helper.
- Cross-filter and context-menu filter construction now consume `PivotProgram`
  directly. Interaction code no longer passes separate groupby, metric, or
  metric-layout inputs into filter helpers.
- Applied interaction layout now compiles through `compilePivotProgram`; the
  placement-only compiler bridge has been removed.
- Persisted expansion-state coercion now lives under `expansion/stateModel`;
  the misplaced query-owned expansion-state module has been removed.
- Initial bootstrap query planning is folded into the query spec builder; the
  old standalone bootstrap planner wrapper has been removed.
- Initial root prefetch planning no longer builds a third redundant root fetch
  context. It reuses the row-root context for root-prefetch metadata while
  keeping row and column root coverage generation separate.
- The old visible-fact coverage wrapper has been removed. Initial query
  planning now builds explicit fact coverage directly, while layout visibility
  requirements are represented by the runtime coverage manifest.
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
- Branch and batch query-spec construction now share one axis-expansion spec
  builder. Branch and batch still own their different filters/scopes, but
  requestability, fetch context, coverage mapping, and spec assembly are no
  longer duplicated.
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
- The fact-store runtime API no longer exposes exact-read/test convenience
  methods. Runtime callers use compatible manifest coverage checks and
  compatible fact reads, keeping the store aligned with batch-level coverage
  authority.
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
- Expansion planning now builds the candidate coverage request set before
  deciding fetch requests, then diffs that set once through the manifest-diff
  API. Grouped expansion transport now derives from those explicit fetch
  requests instead of from a separate fetch-key plan, and the old grouped
  planner wrapper has been deleted.
- The materializer no longer exports a dead fact-store compatibility wrapper or
  test-fixture-only materialization entrypoints. Production callers now go
  through the explicit branch/initial materialization APIs.
- Materializer entrypoints now share one spec-to-materialization input path, so
  branch, initial sync, and initial async materialization no longer rebuild the
  same spec metadata object separately.
- Initial sync and async materialization now share the same spec-list
  fact-batch materialization path as branch materialization. Initial trees no
  longer materialize each query spec independently and then run a second
  measure-leaf pass during finalization.
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
- Same-axis expansion and cross-axis hydration now share one local
  `ExpansionFetchRuntime` builder inside `useExpansionEngine`, removing
  duplicate hook-owned fetch runtime wiring.
- Collapsed row and column Values-tier projection now share one
  axis-neutral hook path in `usePivotLayout`, with row/column differences
  passed as policy parameters instead of separate callbacks.
- `usePivotLayout` no longer wraps render child policy helpers just to re-pass
  the compiled program. Row/column child assembly now calls the shared policy
  boundary directly, reducing hook-owned runtime plumbing.
- Grouped branch batch execution now lives in the branch fetch boundary. The
  standalone batch fetch module has been removed, and branch/batch fetches now
  share one query-spec-to-fact-store materialization path.
- Cross-axis hydration no longer repairs missing row x column coverage by
  forcing a broad root-depth fetch. Expansion planning can now emit an explicit
  bounded intersection target, query planning can fetch that row-path set
  crossed with that column-path set, and the fact store records the loaded
  result as intersection-scoped coverage.
- Initial hydration prefetch no longer has a separate `skip-root` action. The
  root-only no-fetch case is represented as ordinary idle state.
- Seamless dashboard sync no longer performs stale committed-layout coverage
  recovery. If committed runtime layout needs facts that are not loaded, that is
  now treated as a query/bootstrap coverage responsibility instead of a
  chart-owned repair path.
- Runtime layout reuse/fetch policy now lives under `seamlessRuntimeUpdate`.
  `coverage.ts` owns coverage manifests and fact-batch diffing, not the
  decision to reuse the current interactive layout tree during a seamless
  layout edit.
- Coverage manifest types now expose only implemented need reasons. Future
  subtotal or sort-specific needs must be added with real planner behavior,
  not kept as unused manifest variants.
- Seamless runtime reuse now has an explicit snapshot that pairs the reusable
  runtime layout with the fact batches it is allowed to reuse. Runtime-layout
  equality also moved out of `coverage.ts`, keeping coverage focused on fact
  availability rather than UI/runtime state comparison.
- Formatting options are now derived inside the formatting boundary from
  `formData`; the chart no longer unpacks and forwards value format,
  per-column formats, currency formats, HTML rendering, or pivot theme props.
- `transformProps` no longer exposes duplicate top-level chart props for
  formatting, sorting, groupby, aggregate, and theme fields that already belong
  to `formData` or hook-owned runtime state.
- Render ordering and column type metadata now come from `formData`; the chart
  no longer forwards duplicate top-level row order, column order, or
  `colTypeMap` props into the render model and dimension-filter boundary.
- Metrics layout now comes from the applied layout `formData`; `PivotTableChart`
  and `transformProps` no longer expose it as a duplicate top-level chart prop.
- Collapse and initial-depth policy now also comes from applied layout
  `formData`; tests that need expanded headers set that intent in form data
  instead of relying on chart-prop overrides.
- Expansion-level policy now comes from applied layout `formData`; the chart
  and layout hook no longer accept duplicate top-level expand-level props.
- Dataset verbose labels and date formatters now come from `formData`; the
  chart no longer accepts or forwards duplicate top-level metadata props.
- Sticky-header policy now comes from `formData`; the chart no longer accepts
  duplicate top-level sticky-header props.
- Interaction time-grain context now comes from applied layout `formData`; the
  chart no longer accepts a duplicate top-level time-grain prop.
- Totals, subtotal levels, and subtotal/total positions now come from applied
  layout `formData`; `PivotTableChart` no longer forwards that policy into
  `usePivotLayout`, and `transformProps` no longer exposes duplicate top-level
  normalized subtotal props.
- Source metric metadata now has an explicit chart contract through
  `sourceMetrics`. `PivotTableChart`, applied interaction layout, and seamless
  update planning no longer fall back to duplicate top-level chart `metrics` or
  nearby form-data snapshots to decide source metric order/labels.
- `PivotTableProps` no longer advertises duplicate top-level collapse,
  subtotal, total, or total-position props. Those policies are form-data/runtime
  layout inputs, not chart-shell inputs.
- `PivotTableProps` no longer extends the full Superset `ChartProps` shell.
  `transformProps` now returns only the fields the pivot chart actually
  consumes instead of forwarding raw datasource, annotations, legend state,
  behaviors, raw form data, or input refs through the runtime path.
- Source measure-leaf metadata now follows the same explicit contract as source
  metrics. Runtime layout and seamless update planning no longer fall back to
  adjacent form-data snapshots for `measureLeavesByMetric`.
- Seamless update planning no longer carries a separate `sourceFormData`
  snapshot. The boundary takes query-ready `baseFormData` plus explicit source
  metric and measure-leaf metadata.
- The dead `extraControls` chart prop has been removed from the runtime prop
  contract.
- Collapsed Values-tier exposure now derives directly from `PivotProgram`
  inside the collapsed-values projection helper. `usePivotLayout` no longer
  carries separate row/column single-metric-between or metrics-at-end flags.
- Resolved query fetch context no longer exposes internal projection and
  support-policy booleans to callers. The query boundary now exposes only query
  shape, materialization metadata, depth, and fact coverage.
- Render toggle policy no longer hides metric-total nodes by matching raw
  display labels such as `Total <metric>`. Toggle behavior now depends on
  explicit subtotal/metric-total node predicates supplied by materialization and
  layout policy.
- `metricLabelSet` is no longer part of `LayoutContext`,
  `PivotLayoutResult`, or the chart-to-expansion boundary. Runtime code derives
  metric-token lookup sets locally from `PivotProgram.metricKeys`.
- `LayoutContext` also no longer exports an `isMetricTokenValue` predicate.
  The layout context exposes the compiled program; render/layout helpers derive
  metric-token predicates from that program where needed.
- Render model config no longer accepts a metric-token predicate. Column-root
  suppression derives metric leaves directly from `PivotProgram.metricKeys`, so
  the visibility helper no longer receives metric-token authority.
- Render visibility, column display, databar runtime, node display state, and
  label formatting now derive metric-node policy directly from `PivotProgram`;
  render config no longer threads metric total/subtotal/count callbacks from
  layout into those boundaries.
- Layout runtime child filtering, collapsed Values projection, row subtotal
  policy, and stale collapsed-branch pruning also derive metric-node policy
  from `PivotProgram`; the layout hook no longer passes metric total/subtotal
  predicates into those helpers.
- `PivotLayoutResult` no longer exports metric-node predicates or dimension
  depth counters. Render model, formatting, and the table view derive that
  display policy from the compiled `PivotProgram` at their own boundary.
- Collapsed Values projection no longer receives a separate metric-label set.
  It derives metric lookup from `PivotProgram.metricKeys`, keeping that layout
  helper program-owned.
- Render display helpers no longer receive metric-token predicates from layout
  for metric-node auto-expansion or toggle checks. They derive those checks from
  the compiled `PivotProgram`.
- The chart-to-expansion boundary no longer passes a metric-token predicate.
  Expansion derives metric-token checks from `PivotProgram.metricKeys`, keeping
  that semantic lookup local to the expansion policy that uses it.
- `PivotLayoutResult` no longer exports a metric-token predicate. Layout,
  formatting, render display, render model, pruning, and expansion use the
  shared core token check against local `PivotProgram.metricKeys` sets instead
  of threading a chart/layout-owned callback through policy boundaries.
- Expansion state transitions no longer accept a separate metric-token
  predicate. Reinitialization, metric-pattern expansion, and same-axis merge
  preservation all use canonical encoded metric tokens checked against
  `metricLabelSet`.
- `pivot/core/tokens.ts` is token-only again. Metric identity helpers
  (`getMetricKey`, `getMetricKeys`, `getFormattingMetricKey`) now live in
  `pivot/metrics.ts`, so placeholder/runtime token ownership is not mixed with
  source metric metadata extraction.
- Expansion fetchability now calls the program-derived
  `canRequestAxisExpansion` projection rule instead of embedding next-level and
  synthetic-token checks inside the expansion hook.
- Expansion planning filters non-requestable candidates before coverage diffing,
  including missing-node candidates. Subtotal nodes can remain in the rendered
  tree and expansion state, but they no longer independently trigger query
  loads because synthetic display paths are not requestable.
- Expansion visibility and reinitialization no longer accept a duplicate
  metric-label-set input from the hook. Visibility config owns only visible
  depth, fetchability, and render-model policy; reinitialization derives metric
  token authority from `PivotProgram`.
- Desired expansion seeding now also receives `PivotProgram` instead of a
  caller-built metric label set, keeping auto-expanded Values-tier behavior
  tied to the compiled runtime program.
- Expansion requestability is axis/path-only. The planner no longer passes
  serialized tree keys into the fetchability predicate, keeping request
  eligibility independent from rendered tree identity.
- Materialization no longer has a second reduced fact-batch adapter for
  spec-backed fact-store reads. Branch and initial materialization both reuse
  `buildFactStoreBatchesFromSpecs`, keeping batch construction under one
  selector path.
- Expansion requestability is no longer a hook-supplied predicate threaded
  through hydration and same-axis fetch execution. Expansion planning now takes
  `PivotProgram` directly and calls the runtime projection rule at the planner
  boundary, so query permission is program-derived rather than callback-owned.
- Expansion requestability no longer has a second axis-level walker. It derives
  requestable dimension levels from the same axis projection result used by
  query planning, including skipped pre-Values dimensions.
- Expansion fetch execution now has one lifecycle/loading/warning/error shell
  for single branch, batched branch, and intersection requests. The separate
  query builders remain, but request bookkeeping is no longer copied across
  each fetch shape.
- Expansion fetch execution now returns fact-store deltas directly from the
  single caller path. The old exported `fetchExpansionTargets` wrapper and
  optional no-data branch have been removed.
- Expansion visibility, same-axis merge preservation, and reinitialization no
  longer receive caller-built metric-label sets or dimension-depth callbacks.
  `stateTransitions` derives expansion metric policy from `PivotProgram`,
  keeping the expansion hook out of semantic token/depth ownership.
- Same-axis expansion merge preservation also derives Values-at-end behavior
  from `PivotProgram`; the hook no longer decides metric-child preservation
  from layout placement.
- Expansion visibility planning now consumes `buildRenderModelAxes`, the same
  visible-axis policy used by the render model, without building column headers
  or visible cell entries during expansion planning.
- Same-axis expansion fetch loops now receive the shared visibility config
  directly instead of a hook-owned visible-depth callback.
- Same-axis expansion planning now consistently uses `config.program`, fixing
  a runtime path where grouped same-axis expansion could reference an undefined
  local `program` instead of the compiled runtime program.
- Expansion coverage-key grouping is now planner-owned and program-derived.
  The hook, hydration loop, and same-axis fetch loop no longer thread a
  `getCoverageKey` callback through expansion boundaries.
- Hydration and same-axis expansion fetch loops now derive missing coverage
  from the runtime fact store and compiled `PivotProgram`. The hook no longer
  supplies a missing-coverage callback for fetch-loop execution; initial
  prefetch still passes a concrete coverage diff into the pure planner before
  the fetch runtime exists.
- Render visibility policy now lives inside `render/renderModel.ts`, its only
  production caller. The separate `pivot/visibility.ts` policy surface has been
  deleted, so expansion and rendering share `buildRenderModelAxes` without an
  extra visibility module sitting between them.
- Dimension-key and non-metric-path projection now derive from
  `PivotProgram` through metric-node policy at the consumer boundary. The
  layout hook no longer exports those callbacks through `PivotLayoutResult` for
  render date labels, dimension formatting, sorting, or filter-value
  collection.
- Metric-path lookup for render labels, column header display, metric ordering,
  and column sort now derives from `PivotProgram.metricKeys` at the owning
  helper boundary. `PivotLayoutResult` no longer exports a metric-label path
  callback for render/formatting/sort helpers.

## Current Risks

- Metric placement authority is now program-owned, but there are still
  display-policy branches that may be removable after UX review.
- Expansion and rendering share the layout-owned render-model config builder;
  remaining risk is smaller visibility-only logic inside expansion planning,
  not fetched-state inference from metric tree nodes.
- Expansion no longer receives raw row/column dimension counts from the chart
  just to decide metric-depth behavior. That boundary now uses `PivotProgram`
  as the semantic owner for axis dimensions.
- `materializePivotTree.ts` is too large and combines several internal
  responsibilities.
- `PivotTableChart.tsx` is smaller and no longer owns pending display or
  pending layout snapshots, but it is still the rendezvous point for multiple
  runtime state machines.
- `useExpansionEngine.ts` and `stateTransitions.ts` remain large. Split only by
  real ownership, not by wrapper files.
- Values-in-the-middle expansion now uses the same projection query dimensions
  for query planning and coverage diffing. This restored the metrics-before and
  metrics-between expansion regression suite and removes one source of repeated
  fetches for already-requested expanded paths.
- The older `runtime/paths.ts` projection helper has been deleted. Runtime
  projection, next-level checks, and coverage-key path encoding now live under
  `runtime/projection.ts`.
- Expansion no longer receives row/column metric indexes from
  `PivotTableChart.tsx`. The expansion boundary derives Values-level indexes
  directly from `PivotProgram`, so the chart passes the program instead of
  duplicating semantic placement facts.
- The explicit intersection target added production code. Follow-up cleanup has
  started by deleting the separate root-prefetch action and seamless stale
  coverage recovery, but more older recovery/planning branches should still be
  removed where coverage ownership now makes them redundant.
- Missing visible bootstrap cells are no longer repaired by expansion prefetch.
  Initial visible grid coverage must come from bootstrap/query planning, not a
  chart-owned recovery path.
- A tempting render/materializer cleanup is to replace remaining
  `metricInsertIndex` suppression and measure-axis fallback checks with pure
  projection helpers. Measure leaves must stay non-dimensional in loaded
  coverage, otherwise preloaded tree coverage can overclaim a deeper dimension
  and skip a targeted expansion fetch. Do not cut this without first making
  loaded measure-tier coverage explicit in the manifest/materializer contract.
- A manifest-only runtime-layout fetch decision was attempted and reverted
  after `interaction-seamless-expansion.test.tsx` exposed broad UX regressions.
  Fact coverage alone is not yet enough to decide reuse. The remaining
  seamless-runtime policy still depends on whether the current interactive
  layout tree can be locally reused for layout edits such as trimming/re-adding
  hidden dimensions and moving Values. The next version needs an explicit
  loaded-snapshot contract, not another previous-layout heuristic.
- Large result sets still pay main-thread JSON parsing and React commit costs.
- Direct chart tests that need source metric metadata should pass
  `sourceMetrics` or encode the metric intent in `formData`. Reintroducing
  top-level chart metric fallbacks would blur the source-metadata contract
  again.
- Expansion requestability is centralized in the runtime projection rule, but
  the final API shape is still a standalone function rather than an explicit
  program policy object. Only move it again if that deletes call-site plumbing
  or combines more layout/coverage policy.

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
- **Runtime layout fetch authority.** Deleting the previous-layout semantic
  fetch branch requires a loaded runtime snapshot contract. A pure fact-coverage
  diff changes visible interaction/fetch behavior and must not be repeated as a
  direct replacement.
- **Persisted expansion replay.** Initial query planning still replays persisted
  expanded/collapsed paths to prefetch saved branches. Removing that behavior
  would simplify `buildInitialQuerySpecs` and reduce startup query planning, but
  dashboards would no longer restore expanded branches after reload. Do not cut
  it without an explicit UX decision.
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
