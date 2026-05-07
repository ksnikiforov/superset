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
- Prefer direct replacement over long-lived compatibility adapters.
- Keep the table interactive while any load is in flight.

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

- `applyMetricAxis`
- most of `applyMeasureHierarchyAxis`
- column subtotal injection in `fetchPivotBranch.ts`
- tree repair logic in `usePivotRenderModel`
- subtotal labeling that happens after tree construction

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

| Area | Removal source | Expected reduction |
| --- | --- | --- |
| Query planning | placement-specific branch pairs and fetch context surgery | high |
| Tree construction | duplicate initial, branch, update, and export materialization | high |
| Expansion | ref-heavy orchestration and duplicate fetch loops | high |
| Render model | tree repair and loaded-state inference | medium |
| Chart component | persistence/fetch/materialization orchestration | high |
| Utilities | kitchen-sink layout, metric, subtotal helpers | medium |

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
