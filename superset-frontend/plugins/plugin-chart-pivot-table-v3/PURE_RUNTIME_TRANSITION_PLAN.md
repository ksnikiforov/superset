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

type PivotAxisCoverageNeed = {
  axis: 'row' | 'col';
  depth: number;
  scope: AxisPathScope;
};
```

Rules:

- `root` means root/no branch filter. It never means "all possible paths".
- `paths` means only the listed explicit visible/expanded branches.
- Adding a dimension to the layout does not create a query need by itself.
- Expanding a node creates a path-scoped need for the newly visible layer.
- Configured pre-expand depth compiles to the same manifest-shaped visible
  coverage need as manual expansion, not to an expansion-local model. For
  example, row pre-expand level `2` becomes
  `{ axis: 'row', depth: 2, scope: { kind: 'scopedFull', ancestorPaths: [[]] } }`.
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
- Query/branch fetch records exact loaded fact batches only. Compatible coverage
  is derived by the set-oriented manifest/fact-store dominance checks, not by
  registering alias batches.
- Branch fetch results no longer return fact batches. Loaded coverage is
  observable through the fact store, not through expansion result payloads.

Current semantic-layout contract:

- Values placement changes, metric add/remove, measure-leaf selection changes,
  axis removals, axis replacements, and axis reorders are semantic layout
  changes and trigger fetch.
- Metric reorder is cosmetic and can commit locally when the selected metric set
  is unchanged.
- Adding a trailing dimension to an already non-empty axis can commit locally
  because the added layer is hidden/not expanded and must not create a query
  load by itself.
- Seamless runtime no longer locally rematerializes semantic layout changes from
  previously loaded fact batches. Query-backed materialization is the only path
  that advances the committed loaded runtime snapshot for semantic changes.
- User draft layout is persisted and shown immediately, but the loaded runtime
  layout/tree/facts advance only after the matching query result materializes.
- While a semantic layout fetch is in flight, expansion planning stays pinned to
  the committed loaded query layout. It must not plan expansion requests against
  a draft layout that the loaded tree/fact store does not yet support.
- Semantic layout fetches include the visible row/column root coverage in
  the same request so the chart does not immediately issue a hydration follow-up
  for the newly committed visible root layer.
- Initial query planning does not replay persisted expansion branches. It
  fetches root coverage for the currently visible root layers only;
  persisted expanded/collapsed intent is restored by the expansion hydration
  path through the coverage manifest.
- Async initial runtime materialization now uses the loaded fact-store
  materializer; there is no separate spec-backed initial materialization path.
- Branch fetch no longer runs a separate fetch-context resolution before query
  spec planning. Intersection query specs now flow through the shared
  axis-expansion spec boundary instead of a separate local planning path.
- Branch, batch, and intersection fetch no longer expose separate production
  query APIs. Expansion query execution now enters through
  `fetchPivotExpansion({ kind })`, and the legacy `fetchPivotBranch`,
  `fetchPivotBranchesBatch`, and `fetchPivotIntersection` wrapper exports have
  been removed.
- Branch, batch, and intersection query-spec construction now also enters
  through one request-shaped API, `buildExpansionQuerySpecs({ kind })`. The
  separate production `buildBranchQuerySpecs`, `buildBatchQuerySpecs`, and
  `buildIntersectionQuerySpecs` exports have been removed.
- Expansion fetch request typing now derives from the same
  `ExpansionQuerySpecRequest` union used by query-spec construction. The fetch
  layer no longer maintains a duplicate branch/batch/intersection request
  union.
- Expansion fetch execution no longer carries separate same-axis/hydration
  request-kind overrides. Branch, batch, and intersection identity now comes
  from the typed expansion request itself.
- Seamless runtime fetch execution no longer accepts hook-injected fetch,
  fetch-start, or error callbacks. It calls the chart-data client directly
  through its runtime boundary, leaving the chart hook responsible only for UI
  loading/error state.
- Planned query specs now carry their exact fact-store selector. Ingestion and
  fetch dedupe consume `spec.meta.factSelector`; materialization no longer
  derives branch, batch, or intersection fact-store scope from query metadata.
- Expansion coverage planning no longer depends on the render model to compute
  visible row/column depths. It derives visible coverage depth from the compiled
  `PivotProgram`, loaded tree paths, and explicit expansion intent.
- Persisted or pending expansion paths that are not present in the loaded tree
  request their explicit semantic path directly. The old nearest-ancestor/root
  fallback is removed; compatibility with older expansion payload shape is not a
  goal.
- Singleton row x column expansion intersections are not fetched as separate
  intersection queries. If both explicit axis branches are already covered, the
  set-oriented coverage diff decides whether a real intersection request is
  needed.
- During semantic layout fetches that already include visible coverage, the
  committed table remains visible instead of switching into a partial draft tree
  plus branch-loader follow-up.
- Same-axis expansion now uses the shared hydration/manifest executor instead
  of a dedicated branch loop. Expansion prefetch, cross-axis hydration, and
  direct row/column expansion all follow the same plan/fetch/rematerialize
  iteration boundary.
- Expansion-state persistence no longer calls the render model to decide which
  expansion keys are visible. It filters persisted keys from loaded tree
  structure plus expansion intent, keeping render policy out of expansion
  ownership.
- Expansion batching no longer builds a Superset query context just to decide
  whether sibling expansion paths can be transported together. Batch grouping is
  now based on explicit manifest transport shape, and the real query specs are
  built only at the query boundary.
- Branch fetch context is no longer a separate production module. Expansion
  query context is private to `query/specs.ts`, so branch, batch, intersection,
  and root query specs share one local query-spec boundary.
- Initial query metadata no longer has a separate `bootstrap` scope. Initial
  visible coverage and full-level expansion intent use the same root-scope fact
  selector, so fact-store and coverage dominance checks no longer special-case a
  root alias.
- Initial bootstrap query planning no longer fetches the 0x0 grand-total layer
  when row totals, column totals, and subtotals are hidden. Bootstrap root
  coverage is now requested only when the layer is visible/semantically needed
  or there are no row/column dimensions.
- Initial configured pre-expansion now compiles inside the coverage manifest
  layer. The old generic expand-level helpers are gone; configured visible
  depth becomes scoped-full axis coverage needs, and expansion/display/query
  code consume the same manifest shape.
- User draft layout and loaded/applied layout now have a clearer chart boundary:
  when `queryFormData` carries a different applied runtime layout, it seeds the
  committed loaded layout, while `formData`/`ownState` continue to own the UI
  draft layout. This prevents stale dashboard rerenders from overwriting a
  locally committed seamless layout and keeps loaded rendering pinned to the
  query-backed snapshot.
- Expansion fetch execution no longer returns fetched target-group payloads.
  Hydration only needs to know whether any fetch ran before rematerializing, so
  branch, batch, and intersection execution now share a smaller boolean result
  boundary. Persisted prefetch tests now assert the intended interactive UX:
  the table remains visible with row-level loading while hydration continues.
- Expansion state management now uses an axis-shaped state boundary for
  expanded, pending, manual-expanded, and manual-collapsed keys. The hook and
  reinitialization transition no longer repeat row/column commit and toggle
  wiring, and expansion fetch execution no longer keeps a generic fetch wrapper
  around the single concrete expansion-query path.
- Expansion query fetch now has one error channel: warnings are returned,
  failures throw. The old `{ error }` result-object branch is removed from the
  production expansion fetch path and tests now model failures as rejected
  fetches.
- `PivotFactStore` now exposes one mutation API, `upsertBatch`. The
  `upsertBatches` convenience wrapper is removed so callers explicitly submit
  loaded fact batches through the same store boundary.
- Query-result ingestion no longer exports the `upsertQueryResultsIntoFactStore`
  wrapper. Planned fetch execution ingests results and upserts through the
  private ingestion boundary, leaving runtime callers with explicit
  `ingestQueryResults` or planned fetch execution.

Expected deletion targets:

- separate root/branch/batch/intersection query builders once all query
  requests are represented as coverage needs;
- remaining non-manifest coverage planning in expansion and query batching;
- duplicate expansion/query coverage planning;
- tree-shape-as-loaded-state checks;
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

- Production `src`: `13364` insertions, `17556` deletions, net `-4192`.
- Current production TypeScript/TSX total: about `29318` lines.
- Implied baseline production TypeScript/TSX total: about `33510` lines.

Engine-size accounting must be updated with every plan update that changes
source. Count production `src` TypeScript/TSX only; exclude tests and markdown.
The strict core pipeline excludes visual components, control-panel UI, sticky
headers, and interaction panels. The broad core pipeline adds non-visual chart
runtime hooks/policies such as layout, render-model, seamless update,
formatting, databars, and interaction logic.

| Scope | Baseline lines | Current lines | Delta | Target |
| --- | ---: | ---: | ---: | ---: |
| Full production `src` | `33510` | `29318` | `-4192` | `< 28000` |
| Strict core pipeline | `11337` | `11886` | `+549` | `8000` |
| Non-visual chart runtime hooks | `4683` | `5063` | `+380` | `3000-4000` |
| Broad core pipeline | `16020` | `16949` | `+929` | `11000-13000` |

Current strict core breakdown:

| Area | Lines |
| --- | ---: |
| `pivot/runtime/*` | `4050` |
| `pivot/expansion/*` | `2606` |
| `pivot/query/*` | `1432` |
| `pivot/layout/*` | `770` |
| core/shared/domain helpers | `1812` |
| formatting/data/render-model/update support | `1211` |

Interpretation: plugin-wide source has shrunk, but core pipeline source has
grown because runtime authority moved out of chart/control code before the old
planner and render-repair surfaces were fully deleted. The next large cuts must
reduce strict core, not only move lines into it.

Latest core cleanup: row display intent now uses the same
`axisCoverageNeeds` manifest as expansion/loading. The old numeric
`seedExpandedByLevel` display path and `shouldAutoExpandValuesLevel` helper are
deleted. This keeps pre-expanded UX encoded in coverage manifest shape instead
of maintaining a separate row-display expansion model.

Latest pipeline cleanup: `LayoutContext` now owns initial
`axisCoverageNeeds`, so initial query planning, expansion hydration, and render
display consume the same manifest. The numeric `resolvedExpand*Level` fields are
gone from the runtime boundary; query/update/state helper wrappers were trimmed
to keep the strict core moving down while this ownership moved into core.

Latest chart-layout cleanup: `usePivotLayout` no longer repeats most
`LayoutContext` defaulting and normalization locally. The hook preserves the
two UI-specific defaults at the boundary, then delegates layout compilation,
totals, subtotals, expansion coverage, and measure hierarchy defaults to
`buildLayoutContext`.

Latest query cleanup: `QueryIntent` is gone. Bootstrap query planning now emits
root-scoped planned specs directly, and `buildQueryShape` consumes concrete
coverage depths plus support-metric flags instead of a separate intent object.

Latest bootstrap cleanup: hidden grand-total coverage is no longer requested
on initial load. Query planning now emits only visible bootstrap coverage
unless the 0x0 layer is required for visible totals/subtotals, no-dimension
tables, or empty-metric compatibility.

Latest expansion cleanup: duplicated child-map traversal in
`stateTransitions.ts` was collapsed into one visible-axis traversal helper used
by both visible-depth calculation and persisted expansion-state pruning.

Latest fact-store cleanup: `PivotFactStore` no longer exposes the unused
production `getCompatibleFacts()` read API, and loaded facts no longer carry a
`visible`/`support` role. Query specs and fact selectors own value-key intent;
the fact store now stores exact loaded fact batches plus coverage only.

Latest query-meta cleanup: planned query specs no longer carry materialization
metadata such as subtotal levels, materialized metrics, or materialized measure
hierarchy. Query specs own fetch metadata only; loaded materialization is driven
by the fact store and current `LayoutContext`.

Latest materializer cleanup: batch materialization plans now carry one loaded
metric set and one loaded measure hierarchy. The materializer no longer accepts
separate `metricsForQuery`, `materializedMetrics`, or optional materialized
hierarchy aliases for the same runtime state.

Latest selector cleanup: planned query metadata no longer duplicates
branch/batch/intersection shape fields. Fetch scope identity now lives in the
fact selector; tests that need request shape inspect `spec.meta.factSelector`
instead of parallel `meta.kind`/`meta.axis`/`meta.path` fields.

Latest query-layout cleanup: planned query specs no longer carry
`pivotProgram`. Query planning consumes the compiled program while building
coverage and selectors, but the emitted spec no longer re-exports layout
authority.

Latest coverage cleanup: fact coverage no longer carries a semantic `reason`,
and coverage diff now consumes fact selectors directly instead of fake empty
fact batches. Coverage is only loaded aggregate shape plus exact selector scope;
fact batches remain exact loaded facts only.

Latest query-scope cleanup: query specs no longer build an intermediate
`CoverageQueryMeta` and then translate it to fact-store scope. Root, branch,
batch, and intersection planners now construct the exact `factSelector.scope`
directly at the query boundary.

Latest query-shape cleanup: the separate `queryShape.ts` intent helper is gone.
Support metric shaping for values, totals, formatting, databars, sorting, and
measure leaves now lives inside the query-spec planner that consumes it, so the
query pipeline has one less public core module and one less helper-specific test
surface.

Latest query/coverage ownership cleanup: branch fact coverage planning now lives
inside the query-spec boundary instead of `runtime/coverage.ts`. Coverage owns
manifest primitives, coverage needs, fact selectors, and diffing; query specs
own the conversion from expansion requests to query fact coverage. This keeps
the runtime coverage module from becoming another query planner.

Latest query-execution ownership cleanup: planned query fetch/ingest now lives
under `runtime/ingestQueryResults.ts`, while expansion-specific query execution
lives under `expansion/fetchPivotExpansion.ts` and is consumed by
`expansion/fetchExecution.ts`. The old `query/fetchPivotBranch.ts`
compatibility module has been deleted; no production query execution logic or
legacy branch-fetch export remains behind the branch-era module name.

Latest initial-query cleanup: bootstrap query planning no longer turns
pre-expanded depth into broad `|root` prefetch specs. Initial specs fetch only
root-visible coverage; the requested pre-expanded layers remain in
`axisCoverageNeeds` and are loaded by the expansion hydration loop. This removes
the duplicated pre-expand authority from `query/specs.ts` and avoids first-load
full-depth queries for layers that should be governed by the manifest/batching
runtime.

Latest expansion scheduler cleanup: same-axis expansion, cross-axis hydration,
and initial prefetch no longer pass active-axis or manual `planRows`/`planCols`
suppression flags through the hydration loop. Expansion submits desired visible
coverage, diffs both axes through the manifest, batches the explicit missing
requests, and rematerializes from the fact store. Fetch suppression now comes
from loaded coverage and requestability, not from scheduler mode.

Latest seamless cleanup: semantic layout fetches no longer serialize current
expanded/pending paths back into `pivotExpansionState`. Initial/seamless query
planning does not replay expansion branches, so that payload was a dead query
bridge. Expansion intent remains persisted by the expansion state store and is
rehydrated by the expansion manifest loop after the query-backed layout
materializes.

Latest hydration cleanup: initial expansion restore no longer runs a separate
prefetch dry-run planner before entering hydration. If there is configured
coverage intent or persisted expansion/collapse intent, the hook enters the
same hydration loop used by toggles; the loop diffs loaded coverage before
fetching, so no-query cases stay local without a duplicate planner/action
surface.

Latest runtime-state cleanup: expansion pending row/column intent is no longer
part of the hook's public result or React reducer state. Pending intent is
internal ref state consumed by the hydration loop; only loading keys and global
hydration state remain render state. The seamless reuse policy also accepts the
reusable runtime layout directly instead of wrapping it in a one-field reuse
snapshot.

Latest expansion-planner cleanup: `planExpansionForAxis` no longer exposes
coverage request objects or pending-key sets to hydration. It emits executable
axis fetch targets directly, keeps ancestor/descendant request pruning inside
the planner, and leaves hydration with only visible depths plus target
execution. Expansion request lifecycle ownership also moved into
`LatestRequestScope.finish`, so `useExpansionEngine` no longer injects request
tracking helpers into the fetch executor.

Latest fixed/runtime unification cleanup: fixed form-data row/column layout now
compiles into the same `PivotRuntimeLayout` shape as user-controlled layout.
Fixed and user-controlled behavior should differ by UI surface only: fixed mode
uses Explore row/column controls and renders the table without the in-chart side
panel, while user-controlled mode uses the in-chart side panel/chips. Expansion,
sorting, formatting/coloring, loading, query planning, and materialization all
continue through the same runtime pipeline. During this cut, expansion planning
also stopped issuing an opposite-axis root fetch when a one-axis branch
expansion already defines the visible scoped coverage. For example, expanding
column `[1992]` at row depth `1` no longer also requests the row-root branch at
the deeper column depth.

Latest expansion-persistence cleanup: persisted expansion state no longer stores
`rowKeys`/`colKeys`. Layout identity belongs to the runtime layout signature and
stable-prefix pruning. Persisted expansion state is now only row/column
expanded intent plus explicit collapsed intent:
`rows`, `cols`, `collapsedRows`, and `collapsedCols`. This removes the second
layout-signature system from the expansion boundary.

Latest expansion-layout cleanup: expansion fetch/materialization now receives
the already-compiled `LayoutContext` from the committed runtime snapshot. It no
longer rebuilds layout context from `formData` inside the fetch wrapper or
materialization callback. This keeps expansion query specs pinned to the loaded
runtime authority instead of letting a secondary form-data compile decide
metric placement, measure hierarchy, subtotal policy, and expansion coverage.
Expansion remains a rendered-tree action: fixed and user-controlled UI modes
both pass through the same loaded runtime layout, while semantic draft layout
changes continue through the separate seamless runtime update path.

Latest Values-projection coverage cleanup: rendered metric/measure paths are
projected to semantic fact paths before expansion coverage diffing, so a loaded
branch such as `[A]` can satisfy a rendered metric-first request such as
`[__metric__m1, A]` without a duplicate query. Fact batches now carry the
effective Values-tier materialization placement for skipped pre-Values
dimensions, so a column path like `[Revenue, __metric__m1]` materializes the
loaded post-Values child as `[Revenue, __metric__m1, C2]` instead of inserting
the metric at the original full-layout index. Intersection specs also select a
requestable row or column anchor instead of hard-coding row expansion, keeping
row x column hydration bounded to the visible explicit paths.

This slice is intentionally core-positive because it fixes the remaining
authority gap between coverage, query specs, and materialization for flexible
Values placement. The next slice must spend this new authority by deleting
duplicated query/planner/render fallback branches; otherwise the strict core
will keep drifting away from the `8000` line target.

Latest expansion execution cleanup: branch, batch, and intersection expansion
fetches now submit through one lifecycle/loading/warning executor. Request
group id construction moved into that executor, so target-specific code only
builds request payloads and loading keys. This is a small deletion slice, but it
continues the larger direction: expansion transport shapes should not own
separate request bookkeeping.

Latest expansion state/layout policy cleanup: `useExpansionEngine` no longer
wraps persisted expansion intent in a hook-local store object. Expansion intent
is now plain runtime memory plus one persistence function, and expanded row/col
render state commits through one axis map instead of two setter branches.
`stateTransitions.ts` also reinitializes row/column expansion from one
axis-neutral path, and `usePivotLayout` builds row/column child policies through
one axis-aware callback. This keeps fixed and user-controlled UI modes separate
only at the visual shell while continuing to reduce duplicated runtime behavior.

Latest expansion execution ownership cleanup: the hydration fetch loop moved out
of `stateTransitions.ts` and into `fetchExecution.ts`. `stateTransitions.ts`
now owns pure expansion state/planning decisions only; `fetchExecution.ts` owns
request lifecycle, coverage diffing, fetching, warnings/loading, and
rematerialization. The old generic hydration-loop API and its fake-render test
surface were removed instead of preserved as a wrapper.

Latest fact-store boundary cleanup: loaded batch replay is now owned by
`createPivotFactStoreFromBatches` in the fact-store module. `useExpansionEngine`
and initial runtime ingestion no longer open-code store construction from loaded
batches at their own boundaries.

Latest expansion-planning cleanup: the one-field `ExpansionPlanningConfig`
wrapper is gone. Hydration planning now receives the compiled `PivotProgram`
directly, and expansion fetch execution requires a fact store instead of
falling back to the current tree when coverage state is absent.

Latest query-boundary cleanup: the tiny `queryName.ts` and
`toChartDataQueries.ts` modules are gone. Query naming and conversion from
planned specs to Superset `QueryObject`s now live in `query/specs.ts`, and
`InitialPivotUpdatePlan` no longer returns an unused `selectionFilters` copy.

Latest expansion-transport cleanup: `query/fetchPlanOptimizer.ts` is gone.
Sibling batching is now owned by `expansion/fetchExecution.ts`, and the batch
request shape is owned by `expansion/planner.ts`. Query planning no longer owns
transport batching vocabulary.

Latest metric-identity cleanup: metric keys no longer fall back to saved metric
verbose names, and formatting keys now use the same canonical metric key as the
runtime. Display labels remain display-only through `metricLabelMap`/verbose
metadata. The broad alias scan that treated metric name, verbose name, label,
and query label as equivalent identities has been removed.

The refactor has substantially reduced the original chart and expansion
hotspots, and plugin-wide source is now slightly below the starting point.
Future work should remain high-impact-first while still deleting code where the
new runtime authority makes old branches redundant. Avoid helper layers that
only move complexity.

## High-Impact Deletion Reassessment

The next work should not be deletion-first in the sense of shaving local
branches. It should be impact-first: remove whole responsibilities once the pure
runtime boundary makes them redundant. A deeper source audit after the latest
runtime/query cuts shows that narrow render-policy cleanup is no longer the best
top-level target. The largest remaining simplification targets are whole
authority boundaries:

| Target | Current source surface | Why it is a large simplification target | UX/product risk | Expected deletion shape |
| --- | ---: | --- | --- | --- |
| Keep UI modes, unify runtime behavior | `interactionMode` remains as a UI/authoring switch. Fixed mode exposes Explore row/column controls and no in-chart side panel. User-controlled mode exposes dimensions plus the in-chart side panel/chips. Both modes normalize through `PivotRuntimeLayout` before query planning/rendering. | The old problem was not the UI mode itself; it was letting UI mode imply different runtime semantics. The runtime path is shared, while the UI presentation remains selectable. | Low to medium. The user-facing mode choice is preserved. The requirement is that expansion, sorting, formatting/coloring, loading, and materialization stay identical below the UI surface. | Do not delete the UI mode. Delete only behavior branches below normalization. Remaining high-impact deletion should target duplicated query/coverage/executor paths, not the fixed-vs-user authoring distinction. |
| Represent level expansion as manifest-shaped coverage need | `expandRowsLevel`, `expandColumnsLevel`, `initialDepth`, `useExpansionEngine.ts`, `stateTransitions.ts`, and root-prefetch planning in `query/specs.ts` | Pre-expand depth is a real saved visibility feature. The complexity problem is not that it exists; the problem is that level expansion, path expansion, persisted restore, root prefetch, and hydration are still separate mechanisms. | Low if visible behavior is preserved. A dashboard configured to pre-expand level `N` must still load and show level `N` on fresh load. | Pre-expand compiles directly to `PivotAxisCoverageNeed` with `scope: { kind: 'scopedFull', ancestorPaths: [[]] }`. Manual branch expansion uses the same type with `scope: { kind: 'paths', paths }`. Delete separate expansion-local vocabulary and then collapse duplicate hydration branches around coverage diff/execution. |
| Replace expansion hydration scheduler with a manifest executor | `useExpansionEngine.ts` about `867` lines, `stateTransitions.ts` about `878` lines, `fetchExecution.ts` about `328` lines | Expansion still has same-axis toggle flow, cross-axis hydration, initial prefetch, persisted restore, in-flight expansion maps, loading-key counts, and branch/batch/intersection execution as separate mechanisms. The selected manifest model should make this one diff/execute/rematerialize loop. | Low to medium if explicit expansion behavior is preserved. Higher if combined with removing auto-expand levels or exact persisted restore. | Build required visible coverage, diff fact store, execute missing needs, rematerialize. Delete same-axis/cross-axis/prefetch loop splits and request-group/loading bookkeeping that only exists because flows are separate. |
| Merge initial, seamless, and expansion query planning | `query/specs.ts`, `runtime/coverage.ts`, `runtime/seamlessRuntimeUpdate.ts`, `update/initialUpdatePlan.ts`, `expansion/fetchExecution.ts`; query/expansion/runtime totals remain large | Initial load, semantic layout change, and expansion still enter through different request/spec paths. The fact selector is unified, but root/branch/batch/intersection are still first-class query paths instead of outputs of one coverage manifest. | Low if fetch counts are locked by tests. Main risk is underfetch/overfetch around sorting support metrics, measure leaves, and row x column intersections. | One manifest-to-query-spec executor handles root, layout, expansion, batch, and intersection needs. Delete root target planning, `buildBranchFactCoverages`, expansion request-kind query branches, and duplicated coverage/spec conversion. |
| Reduce Explore DnD controls to source-pool controls | `controls/PivotDndMetricSelect/*` about `3995` lines, `controls/PivotDndColumnSelect/*` about `1745` lines, in-chart panel/layout about `1784` lines | Metric/dimension controls and the in-chart panel both edit formatting, metric order, measure leaves, dimension formatting/sorting, and Values placement. The metric control alone is larger than most runtime modules. | High. This changes where users configure formatting, measure leaves, and layout. It should follow the decision on making interactive runtime the only mode. | Keep minimal Explore controls for selecting available dimensions/metrics. Move formatting/measure-leaf editing to one surface or simplify those features. Delete duplicated DnD/formatting transfer logic. |
| Standardize or cut formatting/databar formula features | `utils.ts` about `1169` lines, `usePivotFormatting.tsx` about `1212` lines, `databarRuntime.ts` about `432` lines, Excel formula helpers, metric controls | Formatting support drives many support metrics, key normalization paths, render wrappers, databar runtime models, Excel formula parsing, and control-state repair. Some complexity is core value; some is feature breadth. | High if features are removed. Medium if only legacy aliases/normalizers are deleted. | First remove compatibility aliasing and duplicate key remapping. Larger deletion requires a feature checkpoint: e.g. keep basic formatting but remove formula-driven formatting or waterfall databars. |
| Canonicalize metric identity | `metrics.ts`, `utils.ts`, metric controls, query support metrics, measure leaves, formatting/databars, expansion path labels | Metric identity is still partly display-label based for adhoc and saved metrics. That forces separate formatting keys, label maps, rename repair, and support-metric fallback logic. | High. Existing dashboards that identify adhoc metrics by label/verbose name may stop restoring formatting, databars, sorting support metrics, or expansion labels exactly. | Define one durable metric id, likely saved `metric_name` and adhoc `optionName`, and treat display labels as labels only. Delete label fallback resolution, rename repair branches, and duplicate key/label normalization paths. |
| Replace materialized tree as render contract with a typed grid model | `materializePivotTree.ts` about `1276` lines, `renderModel.ts`, `renderDisplay.ts`, `PivotTableView.tsx`, export model | The materializer builds a semantic tree, render projects/hides/relabels it, and export builds a worksheet model from render output. The tree still carries both semantic and display responsibilities. | Medium to high. It touches render and export heavily, but can preserve visible behavior if done after query/executor unification. | Materializer emits typed axes/headers/cells from facts and program. Render/export consume the same grid model. Delete display repair and duplicate export/header assembly. |

Near-term priority should be:

1. Unify query planning around the set-oriented manifest executor. This is the
   highest-impact pipeline target because it removes duplicated initial,
   seamless, expansion, branch, batch, and intersection entrypoints.
   Current status: initial query construction and result ingestion share
   `buildInitialPivotUpdatePlan`, and expansion branch/batch/intersection fetch
   is unified under `fetchPivotExpansion({ kind })`. Remaining work is to move
   initial/root query execution onto a manifest executor instead of keeping
   separate plan/fetch/materialize wrappers. Seamless layout fetch and expansion
   fetch now share the same planned-spec execution path for missing coverage,
   query-form metric/time-offset shaping, warnings, and fact-store ingestion.
2. Finish the expansion scheduler cut by making same-axis, cross-axis, and
   prefetch hydration submit the same manifest request shape.
   Current status: active-axis priority and manual partial-axis planning flags
   have been removed from `stateTransitions.ts` and `useExpansionEngine.ts`.
   Remaining scheduler work is to shrink pending/loading state and move any
   remaining mode-specific request bookkeeping behind the unified manifest
   executor.
3. Bring the dual-editor question to an explicit UX/product checkpoint. It is
   the largest raw deletion target, but it changes where users configure pivot
   layout.
4. Only continue Gate 6 render cleanup where it deletes display repair as part
   of the worksheet/render-contract move or directly removes duplicated policy.

Gate 6 render-policy cleanup remains useful, but it is no longer the largest
available deletion target unless it is part of the materialized-render-model
replacement.

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
- Expansion fetches still return branch trees and then merge/prune those trees
  into the current loaded tree. That keeps tree shape involved in loaded-state
  progression even though fact coverage is now the runtime authority.

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
- Expansion fetches upsert fact batches into the fact store and rematerialize
  the visible runtime tree from loaded facts, rather than merging fetched branch
  trees into the current tree.
- Same-axis branch merge preservation and `pruneMergedTree` plumbing are
  deleted or demoted once the fact-store-first path is active.

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
- Query-backed level expansion remains supported as intended visible state; the
  current cleanup removes redundant collapsed/level reconciliation,
  not the pre-expand feature.
- Semantic materialization is centralized under `materializePivotTree`.
- Export uses a worksheet model rather than DOM reconstruction.
- The chart delegates seamless update, runtime layout state, dataset metadata,
  dimension filter values, and export registration to helper modules.
- Formatting no longer rebuilds query-support metric lists or tree-data
  signatures. Those belong to transform/query planning, and the chart consumes
  the supplied signature.
- Tree-data signature is now a top-level chart/runtime prop. It no longer lives
  inside query form data, keeping runtime interaction identity out of the
  semantic query/layout snapshot.
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
- Measure hierarchy is now canonical. The old `flatMetrics` hierarchy shape has
  been removed from production runtime types and tests; single-value metrics are
  represented as hidden `measureStackV1` groups with one Value leaf.
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
- Expansion hook state now stores row and column expansion refs behind one
  axis-shaped boundary, and the reinitialization transition returns the same
  shape. This retires duplicated row/column commit, toggle, and rehydrate
  plumbing without changing the persisted expansion UX.
- Expansion fetch failures now reject through the request lifecycle instead of
  being wrapped as `{ error }` payloads. This removes a second expansion error
  protocol and keeps fetch execution aligned with the planned-query executor.
- Fact-store mutation now has one production surface, `upsertBatch`; bulk
  insertion is caller iteration rather than a second runtime-store method.
- Query-result ingestion no longer exports a store-upsert wrapper. Query result
  fetching owns result-to-store insertion internally, while tests and direct
  materialization paths use `ingestQueryResults` plus the single fact-store
  mutation API.
- Same-axis expansion no longer has a separate in-flight expansion map or
  branch-specific fetch loop. Toggle expansion writes pending visible coverage
  and enters the same hydration loop used by prefetch and cross-axis hydration.
- Manual collapsed branches now persist as first-class expansion state and
  suppress descendant keys produced by full-level coverage needs, so pre-expand
  intent does not reopen user-collapsed branches during hydration.
- Collapsed row and column Values-tier projection now share one
  axis-neutral hook path in `usePivotLayout`, with row/column differences
  passed as policy parameters instead of separate callbacks.
- `usePivotLayout` no longer wraps render child policy helpers just to re-pass
  the compiled program. Row/column child assembly now calls the shared policy
  boundary directly, reducing hook-owned runtime plumbing.
- Grouped branch batch execution now lives in the branch fetch boundary. The
  standalone batch fetch module has been removed, and branch/batch fetches now
  share one query-spec-to-fact-store materialization path.
- Expansion fetch execution now submits branch, batch, and intersection work
  through one query-side expansion request function. Same-axis and cross-axis
  execution still build different request payloads, but they no longer call
  three separate transport-specific query wrappers from the expansion runtime.
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
- Metric formatting and databar map normalization now uses canonical metric
  keys only. Saved metric verbose-name and display-label fallback remapping has
  been removed, so future formatting state cannot silently target a metric by a
  non-canonical label alias.
- Formatting metric values now accept only canonical metric keys, Excel formula
  references, or typed `QueryFormMetric` objects with `expressionType`.
  Loose legacy select wrappers, nested `{ value }`/`{ metric }` objects,
  label-only objects, numeric keys, and inferred adhoc metric types have been
  removed.
- Dimension formatting and sorting maps now use canonical dimension keys only.
  Label/sql-expression alias remapping and unmapped-setting preservation were
  removed, so row/column settings cannot silently retarget themselves through a
  non-canonical dimension identity.
- Support metric resolution for formatting, sorting, and custom measure leaves
  no longer carries a separate metric-label fallback path; it resolves through
  the same metric identity helpers used by metric layout and formatting keys.
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
- Expansion fetch loop request identity now comes from the runtime request
  scope. Hydration, same-axis expansion, and grouped fetch execution no longer
  thread a separate transaction id through the hook boundary.
- Expansion fetch runtime now owns request group id construction as well as
  request scope, loading, warnings, and fact-store access. Hydration and
  same-axis fetch loops no longer receive a separate request-id helper.
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
- Layout child policy now owns row/column Values-child retention and collapsed
  Values subtotal normalization. `usePivotLayout` no longer threads
  row/column-specific metric-total callbacks or collapsed Values flags into
  those render-policy helpers.
- Render node display state now uses the materialized explicit-subtotal token
  predicate directly instead of receiving that semantic predicate through
  `PivotLayoutResult`.
- `PivotLayoutResult` no longer exports the explicit-subtotal predicate.
  Formatting, databar, render display, and render sorting use the canonical
  materialized subtotal-token predicate directly.
- Initial expansion prefetch now builds its coverage diff directly at the
  planner call site. The expansion hook no longer carries a one-off
  `getMissingExpansionCoverage` callback just to invoke it inside the
  reinitialization effect.
- Fact coverage compatibility is now exact on aggregate depth and dimensions.
  A deeper fact batch can no longer satisfy a shallower aggregate request,
  because detailed facts are not generally safe substitutes for parent
  aggregates. Broader same-depth scope reuse still works through the
  set-oriented manifest.
- Set-oriented coverage diff can now satisfy a path-set need from the union of
  exact compatible batches. Separate loaded branch batches for `A` and `B` can
  satisfy a later batched `A+B` request without refetching, while a partial set
  still reports missing coverage.
- Fact-store compatible reads now ignore coverage `reason` for shape matching.
  `reason` is provenance, not aggregate identity; depth, dimensions, scope, and
  value keys remain the compatibility authority.
- Fact-store coverage no longer records compatible alias batches. Loaded
  coverage is exact query output; compatible reads and coverage checks derive
  reuse from the manifest dominance rules.
- Seamless runtime no longer owns local semantic rematerialization from prior
  fact batches. Semantic layout changes fetch and materialize through the same
  query-backed runtime path as initial data.
- The user-controlled draft runtime layout can update and persist immediately,
  while the committed loaded runtime layout remains tied to the last
  successfully materialized query-backed tree/fact snapshot.
- Expansion no longer resets its fact store during render when draft query shape
  changes. During a seamless semantic fetch, expansion request form data remains
  pinned to the committed loaded layout so hidden draft layers cannot create
  premature expansion loads.
- Semantic layout fetch planning now includes visible row and column bootstrap
  coverage in the same request, avoiding the immediate follow-up hydration that
  previously appeared after committing a newly fetched layout.
- Values-first column metric branches may return collapsed after a semantic
  layout fetch. The important contract is that stale deeper leaves are removed
  and the metric branch can expand from already-loaded coverage without another
  fetch.
- Hydration no longer exposes staged tree-delta helpers from the pure expansion
  state module. `runHydrationLoop` now carries a current tree forward and asks
  fetch execution for the next tree, while branch merge/prune mechanics are
  localized under `fetchExecution.ts`.
- The exported `applyExpansionFetchDelta` helper has been deleted from
  `stateTransitions.ts`; same-axis and hydration fetch paths now use the same
  fetch-execution merge/prune helper pending the full fact-store-first
  rematerialization cut.
- Initial query planning no longer parses or prefetches persisted expansion
  state. Stable-prefix pruning, persisted branch depth promotion, sibling
  batching, and branch-spec replay were removed from `buildInitialQuerySpecs`.
  Persisted expansion restore is now expansion-hydration responsibility, which
  keeps startup query planning bounded to visible bootstrap coverage.
- Branch, batch, and intersection fetches now share the same internal
  query-spec-to-fact-store materialization executor. The old branch-only plan
  wrapper has been removed, and the executor takes the compiled layout directly
  instead of threading a separate measure hierarchy argument.
- Expansion fetches now upsert fact batches into the fact store and
  rematerialize the runtime tree from loaded facts. Branch-tree deltas,
  same-axis tree merge preservation, collapsed-axis pruning, and the
  `pruneMergedTree` chart/layout plumbing have been removed from production.
- Same-iteration branch and batch fetches are now allowed to satisfy later
  intersection needs before intersection transport runs. Expansion execution
  rechecks fact-store coverage after branch/batch results arrive, which avoids
  redundant row x column intersection requests.
- Fact-store scopes for branch, batch, and intersection specs now use projected
  query dimension paths instead of rendered display paths. Metric, measure, and
  subtotal tokens can exist in UI paths, but they do not become fact-store
  coverage anchors.
- Exact-depth root/bootstrap coverage can satisfy narrower explicit visible
  path needs when the aggregate shape is the same. It still does not imply
  deeper hidden/expanded coverage.
- Branch, batch, and intersection fetch APIs no longer return materialized
  branch trees. Their production contract is warning/error reporting plus
  fact-store mutation; callers that need a tree rematerialize from the loaded
  fact store through the materializer boundary.
- Fact-store batches no longer carry per-batch materialization metadata.
  The store owns loaded facts and coverage only; loaded-tree materialization
  derives visible metric/measure structure from the loaded batch value keys plus
  the current loaded layout context.
- Sync initial materialization now uses the same loaded fact-store
  materializer as expansion. The separate sync initial-tree wrapper and the
  exported spec-to-fact-batch materialization helper have been removed.

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
- Seamless runtime now has the start of an explicit draft-vs-loaded split, but
  the API names still carry "seamless reuse" history. The next cleanup should
  rename or collapse that boundary only if it deletes runtime branches rather
  than adding another controller wrapper.
- Large result sets still pay main-thread JSON parsing and React commit costs.
- Direct chart tests that need source metric metadata should pass
  `sourceMetrics` or encode the metric intent in `formData`. Reintroducing
  top-level chart metric fallbacks would blur the source-metadata contract
  again.
- Expansion requestability is centralized in the runtime projection rule, but
  the final API shape is still a standalone function rather than an explicit
  program policy object. Only move it again if that deletes call-site plumbing
  or combines more layout/coverage policy.
- Expansion still owns a local fact store while seamless owns committed
  tree/materialization state. The next high-impact cut is to formalize the
  loaded runtime snapshot so fact batches do not carry per-batch materialization
  metadata and query planning can move toward one manifest-to-spec compiler.

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
- **Metric identity canonicalization.** Changing `getMetricKey` so adhoc
  metrics use `optionName` and saved metrics use `metric_name` instead of
  display labels can unlock large formatting/query/control cleanup, but it is a
  persisted-state and visible-label compatibility break.
- **Runtime layout fetch authority.** Deleting the previous-layout semantic
  fetch branch requires a loaded runtime snapshot contract. A pure fact-coverage
  diff changes visible interaction/fetch behavior and must not be repeated as a
  direct replacement.
- **Persisted expansion hydration UX.** Initial query planning no longer
  prefetches persisted expansion branches. Expansion state is still restored as
  intent and hydrated through the expansion path; watch for any dashboard-load
  UX that expects expanded descendants to be present in the initial query
  result rather than appearing through hydration.
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
