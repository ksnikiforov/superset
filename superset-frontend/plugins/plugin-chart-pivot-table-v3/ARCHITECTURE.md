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

# Pivot Table v3 — Architecture Deep Dive

This document explains how **Pivot Table v3** works internally in Superset, from query planning to rendering and interactive expansion.

Important notes:
- The **code is the source of truth**. The markdown docs in this folder are helpful context, but some are design notes or historical.
- For the **target modularized architecture** and any intentionally-planned behavior changes (e.g. stricter query minimization on reloads), see `superset-frontend/plugins/plugin-chart-pivot-table-v3/REFACTOR_PLAN.md`.
- File references are provided so you can jump directly into implementation.

Key entrypoints:
- Plugin registration: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/index.ts`
- Query planning (initial load): `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/pivot/engine/initialQueryPlan.ts`
- Query construction: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts`
- Result shaping: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`
- Expansion engine + fetching: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/pivot/engine/useExpansionEngine.ts`
- Branch fetcher + cache: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`
- Tree + tokens + helpers: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts`
- Rendering: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx` and `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/pivot/render/PivotTableView.tsx`

---

## 1) Overview (what Pivot Table v3 *is*)

Pivot Table v3 is a pivot table implementation optimized for:

1. **Database-accurate aggregation** at every visible level (including totals/subtotals).
2. **Lazy expansion**: it starts collapsed and fetches deeper branches only when needed.
3. **A stable, explicit expansion model** that can be persisted (`pivotExpansionState`) and rehydrated deterministically.

The big architectural shift from classic “client-side pivot” is:

> Pivot v3 treats the pivot as a **tree of aggregated nodes**, not as one giant fully-materialized cross-tab.

That tree is incrementally filled by a sequence of `/api/v1/chart/data` requests.

You can think of it like this:

```
Explore formData
  ↓ buildQuery() (initial plan)
/api/v1/chart/data returns N queries (each is a grouped aggregate)
  ↓ transformProps() merges query results into a PivotTreeData
PivotTableChart renders the tree
  ↕ useExpansionEngine expands/collapses nodes
     ↳ fetchPivotBranch()/fetchPivotBranchesBatch() pulls more aggregates
```

### Backend boundary (why v3 does its own shaping)

Pivot Table v3 relies on the standard Chart Data API (`/api/v1/chart/data`) returning **raw, unpivoted aggregate records**.

The important flag here is the query context `result_type`:
- `buildQueryContext()` defaults `result_type` to `"full"` unless formData overrides it.
  - Source: `superset-frontend/packages/superset-ui-core/src/query/buildQueryContext.ts`
- Superset only runs “client processing” (server-side pandas post-processing for text charts like pivot v2) when `result_type` is `"post_processed"`.
  - Source: `superset/charts/data/api.py` → `apply_client_processing()` in `superset/charts/client_processing.py`

So, by default, pivot v3 receives the grouped rows as returned by the datasource/database and builds its own tree model on the frontend.

---

## 2) Medium summary (how the pieces fit)

At a medium level, the system has 6 “subsystems”:

1. **Chart plugin boundary**
   - `index.ts` registers the plugin.
   - `controlPanel.tsx` defines Explore controls (Rows/Columns/Values placeholder, formatting, totals, etc).

2. **Query planning**
   - `initialQueryPlan.ts` decides which aggregate queries are needed for the first render.
   - It accounts for start-collapsed behavior, auto-expand levels, totals/subtotals, and persisted expansions.

3. **Query building**
   - `buildQuery.ts` turns that plan into a Superset query context (`buildQueryContext()`).
   - It uses `query_name` to tag depth pairs and request purpose (`|root`, `|branch`, `|batch`).

4. **Tree model**
   - `types.ts` defines the tree model: nodes + cells.
   - `utils.ts` defines path/cell key serialization and special tokens (metrics and subtotal tokens).

5. **Tree population**
   - `transformProps.ts` converts initial query responses into an initial `PivotTreeData`.
   - `fetchPivotBranch.ts` converts *incremental* branch query responses into a tree delta.
   - Deltas are merged into the main tree with `mergeTrees()`.

6. **Expansion + rendering**
   - `useExpansionEngine.ts` owns expansion state, hydration, batching, and persistence.
   - `renderModel.ts`, `visibility.ts`, and `viewModel.ts` turn the tree into “what to show”.
   - `PivotTableView.tsx` is the table UI; `PivotTableChart.tsx` orchestrates rendering, formatting, sorting, and interactions.

---

## 3) The core data model: `PivotTreeData` (why everything is a “tree”)

### 3.1 The tree types

Defined in `src/types.ts`:

- `PivotTreeNode` represents a node on either axis:
  - `axis: 'row' | 'col'`
  - `path: PivotPath` (array of values for each groupby level)
  - `key: string` (serialized form of `path`)
  - `hasChildren: boolean` (can it expand?)
  - `isSubtotal?: boolean` (used for totals/subtotals styling/behavior)

- `PivotResultCell` represents an aggregated cell at a row-node × col-node intersection:
  - `rowKey`, `colKey`
  - `values: Record<string, DataRecordValue>` keyed by metric name

- `PivotTreeData` is just three maps:
  - `rows: Record<rowKey, PivotTreeNode>`
  - `cols: Record<colKey, PivotTreeNode>`
  - `cells: Record<cellKey, PivotResultCell>`

This is intentionally “denormalized” for fast access:
- row/col nodes can be looked up by key in O(1)
- cell can be looked up by `serializeCellKey(rowKey, colKey)` in O(1)

One special key appears everywhere:
- `rootKey = serializePath([])`, which is the empty string `""`.
  - It represents the “grand total” node on each axis.

### 3.2 Path and cell key serialization (critical detail)

In `src/utils.ts`:

- Paths are serialized using `PATH_DIVIDER = '\u0000'`
- Cells are serialized using `CELL_KEY_DIVIDER = '\u0001'`
- `null` and `undefined` are encoded as string sentinels:
  - `null` → `__NULL__`
  - `undefined` → `__UNDEFINED__`

Example:

```ts
serializePath(['USA', 'Furniture'])
// "USA\u0000Furniture"

serializePath(['USA', null])
// "USA\u0000__NULL__"

serializeCellKey('USA\u0000Furniture', '2024\u0000Q1')
// "USA\u0000Furniture\u00012024\u0000Q1"
```

Why it matters:
- Expansion state is stored as *paths* (arrays) but the engine uses *keys* (strings) for sets/maps.
- Values can legitimately contain separators, so escaping rules matter (`parsePath()` handles this).

### 3.3 Two special tokens: metrics and subtotals

Also in `src/utils.ts`:

1) **Metric token**
- Metric nodes are represented inside paths as `__metric__<metricKey>`.
- Helpers:
  - `encodeMetricKey('m1')` → `__metric__m1`
  - `decodeMetricKey('__metric__m1')` → `m1`

2) **Subtotal token**
- `SUBTOTAL_TOKEN = '\u0002subtotal'`
- A subtotal leaf is represented by injecting this token into the path (more below).

This “token-in-path” strategy is the key enabler for:
- placing metrics as an explicit tier in either axis
- representing subtotals as explicit leaves without requiring special backend row formats

### 3.4 “Σ Values” as a layout primitive (not just a UI label)

Pivot v3 treats “Values” as a *first-class tier* in the row/column hierarchy.
That tier is represented in Explore by inserting a special placeholder into the groupby controls:

- `METRICS_PLACEHOLDER = "__MEASURES__"`
- `METRICS_PLACEHOLDER_LABEL = "Σ Values"`

Key functions in `src/utils.ts`:
- `resolveMetricPlacement(rowsRaw, colsRaw, { hasMetrics, preferredAxis })`
  - ensures there is **exactly one** placeholder across rows+cols when metrics exist
  - returns:
    - `layout: ROWS | COLUMNS` (where the metrics tier lives)
    - `metricPosition` (the insert index within that axis)
- `stripMetricsPlaceholder(groupby)` removes the placeholder when constructing query groupbys

Why this matters architecturally:

- Query planning/building must treat groupby dimensions as **pure dimensions** (no placeholder).
- Rendering must treat metrics as **explicit nodes** (via metric tokens) at the chosen position.
- Branch fetching must be able to interpret expansion paths that include metric tokens and translate them into correct “dimension-only” filters.

That’s why metric placement is resolved in multiple layers:
- Explore controls (`controlPanel.tsx`) make the placeholder draggable and keep rows/cols in sync.
- Query planning and transforms (`initialQueryPlan.ts`, `transformProps.ts`, `fetchPivotBranch.ts`) resolve the placement again from the raw formData to avoid relying on UI-only state.

---

## 4) Query planning and naming (initial load)

### 4.1 The planning contract

Pivot v3 makes a strict trade:

- It will **never** compute deeper-level values by rolling up other query results on the client.
- It will **only** render what it has DB results for.

The plan is deterministic: given the same formData and expansion state, it emits the same query set.

Design reference: `EXPANSION_QUERY_METHODOLOGY.md`
Code reference: `src/pivot/engine/initialQueryPlan.ts`

### 4.2 Targets, depths, and “query pairs”

The plan output is a list of **targets**:

- `kind: 'bootstrap' | 'root' | 'branch'`
- `axis?: 'row' | 'col'` (only for branch targets)
- `path` / `metricPath` (which node is being prefetched)
- `queryPairs: Array<{ rowDepth, colDepth }>`: multiple grouped queries per target

Why multiple depth pairs?

Even “expand one node” may require multiple aggregates:
- The “grid” intersection (rowDepth, colDepth)
- Parent-depth intersections (to keep totals / formatting / ordering consistent)
- Optional `(0, depth)` or `(depth, 0)` totals pairs
- Optional subtotal depths

This is built by `buildBranchQueryPairs()` in `src/fetchPivotBranch.ts`.

### 4.3 `bootstrapPlanner.ts`: why the initial plan often starts with `(0,0)`

`buildBootstrapPlan()` (`src/pivot/engine/bootstrapPlanner.ts`) always includes a “totals-only” intent:

- `targetRowDepth: 0`
- `targetColDepth: 0`

This gives the engine a consistent baseline for “grand total” cells, plus any formatting metrics that must exist even when nothing is expanded.

Then it may add:
- `(1,1)` for the first visible grid
- `(1,0)` / `(0,1)` if row/col totals (or subtotal-related needs) require them

Example from `test/plugin/buildQuery.test.ts` (simplified):

If `startCollapsed=true`, `initialDepth=1`, no totals:

```
queries:
  1) (row0, col0)  // bootstrap totals
  2) (row1, col1)  // top-level grid
```

### 4.4 Root prefetch vs. deeper bootstrap

In `buildInitialQueryPlan()`:

- If the visible depth goes beyond 1 (e.g. `startCollapsed=false` or persisted expansions), it may:
  - emit only the minimal bootstrap totals query
  - plus a special `kind: 'root'` target that prefetches deeper combinations from the root (path `[]`)

This reduces “redundant” bootstrap queries when we already know we need deeper root aggregates.

### 4.5 Query naming (mostly for debugging + tests)

In `src/pivot/engine/query/queryName.ts`:

```ts
formatQueryName(2, 1) // "pivot_v3|row2|col1"
```

The plugin appends extra suffixes:

- Initial root prefetch:
  - `"pivot_v3|row2|col2|root"`
- Initial branch prefetch for persisted expansions:
  - `"pivot_v3|row2|col1|branch:row:A"`
- Batched expansions:
  - `"pivot_v3|row2|col1|batch:row:<parentKey>"`

The code does not fundamentally depend on `query_name` for correctness on initial load; it relies on plan ordering (`transformProps.ts` slices `queriesData` based on the plan).
But `query_name` is extremely useful when debugging server logs or test failures.

---

## 5) Query construction (turning the plan into `/chart/data`)

### 5.1 `buildQuery.ts`: the initial request

`src/buildQuery.ts`:

1. Build the initial plan: `buildInitialQueryPlan(formData)`
2. For each plan target and each `(rowDepth, colDepth)` pair:
   - build `columns = rowGroupby.slice(0,rowDepth) + colGroupby.slice(0,colDepth)`
   - optionally add path filters for branch targets
   - set `query_name`

An important “shape rule”:

> Pivot v3 never asks the backend for “raw rows”; every query is a grouped aggregate at a specific depth.

### 5.2 `QueryIntent` and `QueryShape` (why queries can request extra metrics)

When a user enables features like:
- metric formatting (e.g. conditional colors)
- databars
- sorting by a metric
- dimension formatting by a metric

…the chart may need additional metric values in the result beyond “the metrics being displayed”.

This is handled by:
- `src/pivot/engine/query/queryIntent.ts`
- `src/pivot/engine/query/queryShape.ts`

The shape builder:
- slices groupby to the required depth
- merges in “extra metrics” needed by formatting/sorting

That’s why you’ll sometimes see queries that include metrics like `metric_bg_color` even if it’s not displayed as a value column.

---

## 6) Converting query results into a tree

This happens in two places:

1. Initial load: `src/transformProps.ts`
2. Incremental expansions: `src/fetchPivotBranch.ts`

Both use the same “tree building primitives”.

### 6.1 `buildTreeFromRecords()`: from records to nodes + cells

In `src/utils.ts`:

`buildTreeFromRecords(records, metrics, rowGroupby, colGroupby, rowDepth, colDepth)` does:

1. For each record, compute:
   - `rowPath = record[rowGroupby[0..rowDepth-1]]`
   - `colPath = record[colGroupby[0..colDepth-1]]`
2. Ensure that every prefix of `rowPath` and `colPath` exists as a node (this is what makes the hierarchy expandable).
3. Create a `PivotResultCell` at `(rowKey, colKey)` with the metric values.
4. Populate node-level `values` for “totals rows/cols” when `rowPath` or `colPath` is empty.

Example record set (imagine a query grouped by `Country` and `Segment`):

```json
[
  { "country": "USA", "segment": "Consumer", "sales": 10 },
  { "country": "USA", "segment": "Corporate", "sales": 7 },
  { "country": "USA", "sales": 17 },          // segment rolled up (colDepth=0)
  { "sales": 100 }                            // grand total (rowDepth=0,colDepth=0)
]
```

The tree ends up with:
- row nodes: `[]`, `["USA"]`
- col nodes: `[]`, `["Consumer"]`, `["Corporate"]`
- cells for each intersection that exists in the records

### 6.2 Totals/subtotals as explicit leaves

Pivot v3 uses “token leaves” to represent subtotals, by *reusing DB results* rather than computing new aggregates on the client.

Row subtotal leaves are injected in `src/utils.ts`:
- `injectRowSubtotalLeaves(tree, depth, fullDepth)`

Column subtotal leaves are injected in `src/fetchPivotBranch.ts`:
- `injectColumnSubtotalLeaves(tree, depth, fullDepth)`

What injection actually does:
- For every node at a subtotal depth (e.g. `["Bikes"]`), it creates an extra child leaf:
  - `["Bikes", SUBTOTAL_TOKEN]`
- Then it duplicates cells from the base node depth onto that leaf.

Why this is useful:
- it lets the UI show a “subtotal row” separately from the expandable parent node
- it avoids ambiguous “should the header row show values?” decisions

Then `labelRowSubtotalLeaves()` adjusts labels (e.g. “Bikes Total”, “Bikes Sales”, etc) based on path context.

### 6.3 Metrics as a hierarchy tier: `applyMetricAxis()`

In `src/utils.ts`, `applyMetricAxis(tree, metrics, metricsLayout, ...)` projects metrics into the row or column hierarchy.

If `metricsLayout === ROWS`:
- it inserts a metric token into row paths
- duplicates each original cell into per-metric cells keyed by metric token paths

If `metricsLayout === COLUMNS`:
- same idea, but for column paths

Crucial single-metric optimization:
- If there’s only 1 metric, `applyMetricAxis()` also “surfaces” that value at the base (non-metric) path so collapsed views can still render values without expanding into a 1-item metric tier.

This logic is why the tree can simultaneously support:
- “Values” as an explicit level in the UI
- and sensible rendering when there is only one metric

### 6.4 Tree merging: `mergeTrees()`

All tree population paths eventually merge into a single tree using `mergeTrees(left,right)` (`src/utils.ts`):
- nodes are merged by key (values are shallow-merged)
- cells are merged by cellKey (values are shallow-merged)

This is what makes incremental expansion possible: each branch fetch returns a partial tree delta, which is merged into the full tree.

---

## 7) Expansion engine (the “brain” of pivot v3)

`src/pivot/engine/useExpansionEngine.ts` is the central orchestrator for:
- expanded/collapsed state
- “hydration” (fetching missing branches)
- batching
- persistence of expansion state

If you want to understand pivot v3 deeply, read this file with the following mental model:

> The engine’s job is to keep **(tree, expandedRows, expandedCols)** in a consistent state where all *visible* nodes have the data they need to render.

### 7.1 State concepts

Key states/refs inside the hook:

- `tree`: current merged `PivotTreeData` (initial + fetched branches)
- `expandedRows`, `expandedCols`: sets of serialized keys that are expanded
- `pendingRows`, `pendingCols`: nodes that are intended to be expanded but are waiting for cross-axis hydration
- `loadingKeys`: set of keys currently fetching (used to show per-header spinners)

Two signatures from `PivotTableChart.tsx` help the engine stay sane across config changes:
- `expandedStateSignature`: a JSON string derived from the layout + totals/subtotals + expand-level knobs.
  - If this changes, the engine treats it like “the meaning of expansion keys changed” and resets/prunes state.
- `treeDataSignature`: a “data shape” signature used elsewhere (e.g., chart `ownState`) to detect if stored tree data still matches the current layout.

Additional “engine bookkeeping”:

- `explicitExpanded*` / `explicitCollapsed*`:
  - what the user explicitly expanded/collapsed (for persistence)
  - kept separate from auto-seeded expansions
- `fetchedRowKeysRef` / `fetchedColKeysRef`:
  - map from node key → “required opposite depth” that was satisfied when it was fetched
  - used to decide if it needs a re-fetch when the opposite axis expands deeper
- `dataEpochRef` / `transactionIdRef`:
  - cancellation guards (avoid merging stale fetches after data/config changes)

### 7.2 Auto-expand levels + persisted expansion state

Inputs come from `PivotTableChart.tsx`:
- `resolvedExpandRowsLevel` / `resolvedExpandColumnsLevel`
- `pivotExpansionState` (persisted paths from previous session)

Inside `useExpansionEngine`, initialization logic:

1) Convert persisted payload into internal key arrays:
- `coerceExpansionState()` (`expansionStateModel.ts`)

2) Seed auto-expanded nodes by level:
- `seedExpandedByLevel(nodes, level, metricLabelSet, ...)`

3) Merge explicit expansions and explicit collapsed keys on top of the auto seed.

4) Prune expansions when layout changes:
- the engine computes a “stable prefix” between old and new groupby keys
- expansions deeper than that are dropped (`pruneExpandedToStablePrefix()`)

This is why pivot v3 can survive edits like:
- renaming/reordering groupby fields
- changing metrics layout
…without preserving expansions that no longer make sense.

### 7.3 Planning what to fetch: `planExpansionForAxis()`

Once we know which nodes are expanded, we still need to know which ones need data.

That is computed by:

- `planExpansionForAxis()` in `src/pivot/engine/expansionPlanner.ts`
- `hasLoadedChildren()` in `src/pivot/visibility.ts`

The important concept is **required opposite depth**:

- Expanding a row node doesn’t just need its row-children.
- It needs row-children *with cells populated for whatever column depth is currently visible*.

Example scenario:

- rows: `r1, r2`
- cols: `c1, c2`
- user has expanded columns to show `c2` (visibleColDepth = 2)

Now the user expands row `r1="A"`.

The row branch fetch must include aggregates at:
- rowDepth = 2 (so we can show `r2` children)
- colDepth = 2 (so those row children have values for the visible columns)

That’s why fetch context resolution considers both:
- the path being expanded
- the visible depth of the opposite axis

### 7.4 Fetching: single vs batched

One important distinction:
- **Batching** reduces the number of **query objects** by merging sibling expansions under the same parent using `IN (...)` filters.
- **Request bundling** reduces the number of **HTTP requests** by sending multiple query objects in one `/api/v1/chart/data` payload.

In today’s code:
- Initial load already uses request bundling (`buildQuery.ts` returns a multi-query payload).
- Hydration often issues **multiple** `/api/v1/chart/data` requests in parallel (one per single/batch query object), rather than bundling them into one request. The refactor plan makes bundling a first-class responsibility of `ChartDataClient` (see `superset-frontend/plugins/plugin-chart-pivot-table-v3/REFACTOR_PLAN.md`).

#### Single branch fetch

`fetchPivotBranch()` (`src/fetchPivotBranch.ts`):
- resolves query context for one node
- uses `buildPathFilters()` to add `col == value` predicates for the path
- POSTs `/api/v1/chart/data`
- converts results → tree delta via `buildBranchTreeFromResults()`
- caches the delta in a module-level LRU-ish cache (max 200)

#### Batched branch fetch

If the user expands multiple siblings under the same parent, v3 can often combine them into one query.

This is orchestrated by:
- `buildBatchSignature()` (`src/pivot/engine/query/batchSignature.ts`)
- `optimizeFetchPlan()` (`src/pivot/engine/query/fetchPlanOptimizer.ts`)
- `fetchPivotBranchesBatch()` (`src/pivot/engine/query/fetchPivotBranchesBatch.ts`)

The batching rule (simplified):

- Batching is possible when multiple expanded nodes share the **same parent path**.
  - Example: expanding `["USA","Consumer"]` and `["USA","Corporate"]` can become one query:
    - `country == "USA"` and `segment IN ("Consumer","Corporate")`
- Batching is **not** possible when expansions span **different parent paths** at the same time.
  - Example: `["USA","Consumer"]` + `["Canada","Corporate"]` would require a tuple/OR filter like
    - `(country, segment) IN (("USA","Consumer"),("Canada","Corporate"))`
    - which structured filters can’t express, so those remain “one query per path”.
- The non-filter parts of the query must match (that’s what `batchSignature` encodes).

Then the batch query uses:
- parent prefix filters (`country IN (...)` or `country IS NULL`)
- instead of emitting one query per sibling.

This matches the “IN batching for a single expanded field” described in `EXPANSION_QUERY_METHODOLOGY.md`:
- batching works when multiple expanded nodes share the **same parent path** and differ only by the **next-level value**
- batching does not work when you’d need tuple-`IN` across multiple parent paths (which structured filters cannot express)

### 7.5 Hydration loops (why expanding one node can trigger multiple fetch waves)

When a node is expanded, the engine runs a bounded loop (`MAX_HYDRATION_ITERATIONS = 12`) that:

1. Computes current visible depths using `buildRenderModel()`.
2. Plans which keys need fetching (considering fetched depth and “loaded children”).
3. Fetches some branches (single and/or batches).
4. Merges deltas into a working tree.
5. Recomputes expansions (metrics can create pattern expansions).
6. Repeats until no more fetches are required.

This is what makes cross-axis expansions consistent:
- if you expand columns deeper, some already-expanded row branches may need re-fetching to fill cells at the new column depth.

### 7.6 Persistence: saving expansion state back into Explore

When `shouldPersistExpansionState` is true and `setControlValue` exists, the engine writes:

```ts
setControlValue('pivotExpansionState', {
  rowKeys: [...stable groupby keys...],
  colKeys: [...stable groupby keys...],
  rows: PivotPath[],
  cols: PivotPath[],
  collapsedRows: PivotPath[],
  collapsedCols: PivotPath[],
})
```

This is done by `persistExpansionStateToStore()` inside `useExpansionEngine.ts`.

The engine intentionally persists only expansions that are still “visible” under the current tree and settings, using:
- `getVisibleExpansionKeys()` (`PivotTableChart.tsx` + `expansionStateModel.ts`)

---

## 8) Rendering and visibility (turning the tree into a table)

Rendering is a two-step process:

1) Convert the tree + expansion sets into “visible lists” and header rows.
2) Render the lists and cells into a `<table>`.

### 8.1 `RenderModel`: the “what to show” structure

`src/pivot/render/renderModel.ts` builds:
- `visibleRows: PivotTreeNode[]`
- `visibleCols: PivotTreeNode[]` (treated as leaves)
- `columnHeaderRows: HeaderCellInfo[][]` (row/col spans for multi-level headers)
- `visibleCellEntries: Array<{rowNode,colNode,cell}>`

Under the hood it uses:
- `buildVisibleRows()` and `buildVisibleCols()` from `src/pivot/visibility.ts`
- `buildColumnHeaderRows()` from `src/pivot/viewModel.ts`

### 8.2 Visibility rules are not trivial (totals + metrics interact)

Some notable rules implemented in `renderModel.ts` and helpers:

- Row “root” (grand total row) is only shown when it makes sense for totals/subtotals.
- Column “root” (grand total column) can be suppressed for some multi-metric layouts (to avoid an extra “Total” column that’s visually redundant).
- Metric grand totals and metric subtotals are selectively hidden depending on:
  - whether totals are enabled
  - whether metrics are first on an axis
  - whether the metric header row is hidden (single metric)

Many of these decisions rely on the metric-aware helpers in:
- `src/pivot/metricsTotals.ts`
- `src/pivot/columnDisplay.ts` (header label shaping)

### 8.3 `PivotTableChart.tsx` vs `PivotTableView.tsx`

The responsibilities are intentionally split:

- `PivotTableChart.tsx` (orchestrator):
  - configures and calls `useExpansionEngine()`
  - computes sorting comparators and formatting maps
  - builds the render model
  - handles cross-filtering and context menus
  - computes sticky header offsets
  - renders databars / conditional formatting styles

- `PivotTableView.tsx` (presentational):
  - renders the `<table>`
  - renders expand/collapse toggles and spinners
  - applies indentation and sticky header CSS

This makes it easier to reason about:
- data/expansion correctness (engine + orchestrator)
- vs. pure UI layout (view)

---

## 9) Sorting, formatting, databars (and why they affect queries)

### 9.1 Metric formatting

Metric formatting can apply to:
- values only
- values + totals
- values + totals + grand totals

This is controlled by `metricFormattingScope` and interpreted by:
- `shouldIncludeMetricFormatting()` (`src/pivot/engine/query/queryIntent.ts`)

If formatting requires additional metrics, the query shape includes them (see “QueryShape” earlier).

### 9.2 Dimension formatting and ordering

Dimension formatting (row/col header styling) and dimension sorting are driven by:
- `rowFormatting` / `colFormatting`
- `rowSorting` / `colSorting`

Those maps point at metrics to use as “formatting values” / “ordering values”.
So the query layer may request those metrics even if they aren’t displayed as value cells.

`PivotTableChart.tsx` then builds lookup maps by inspecting “total” cells:
- `buildFormattingValueMaps()` (`src/pivot/cellUtils.ts`)

### 9.3 Databars

Databars are configured via `metricDatabars` and are rendered by `PivotTableChart.tsx`/`PivotTableView.tsx`.

Design reference: `DATABARS.md` (design intent)
Code is in:
- `src/PivotTableChart.tsx` (databar rendering and scaling)
- `src/pivot/render/PivotTableView.tsx` (cell layout hooks)

As with formatting, databars may require additional metric values to exist in the dataset to compute scales consistently.

---

## 10) Interactions: cross-filtering + context menus

### 10.1 Cross-filtering (click a cell)

If `emitCrossFilters` is enabled:

- Clicking a value cell calls `buildCellFilters()` (`src/pivot/filters.ts`).
- It strips metric tokens and subtotal tokens appropriately before building filters.
- Then `setDataMask()` is called with:
  - `extraFormData.filters`
  - `filterState.selectedFilters`
  - and some `ownState` (used by dashboards for state propagation)

### 10.2 Context menus (right click a cell)

If `onContextMenu` is available:
- `buildContextMenuFilters()` builds filters with formatted values (dates respect `timeGrainSqla` and `dateFormatters`).
- The hook is invoked with both:
  - drill-to-detail filters
  - optional cross-filter payload

---

## 11) Practical debugging mental models

### 11.1 If “values are missing” after expansion

The likely causes:
- The tree has children nodes, but **cells aren’t populated at the currently visible opposite depth**.
  - This is exactly what `hasLoadedChildren()` checks in `src/pivot/visibility.ts`.
- A branch was fetched at a shallower opposite depth, then the other axis expanded deeper.
  - The engine should re-fetch, but it only does so if it detects “not satisfied”.

Debug tips:
- Inspect `query_name` suffixes: `|branch:...`, `|batch:...`
- Inspect which `(rowDepth,colDepth)` pairs are being requested (server logs + payload)

### 11.2 If expansion persistence seems “wrong”

Key places:
- Writing persisted state: `persistExpansionStateToStore()` in `useExpansionEngine.ts`
- Coercion and pruning: `coerceExpansionState()` + `pruneExpandedToStablePrefix()` in `expansionStateModel.ts`
- Filtering to visible expansions: `getVisibleExpansionKeys()` in `PivotTableChart.tsx`

### 11.3 If column headers look “duplicated” / “misaligned”

Key places:
- Header row construction: `buildColumnHeaderRows()` in `src/pivot/viewModel.ts`
- Header path shaping: `buildColumnDisplayPath()` in `src/pivot/columnDisplay.ts`
Design reference: `COLUMN_HEADER_ALIGNMENT.md`

---

## 12) Where the markdown docs fit (and what to trust)

These are useful context, but treat them as *design or planning documents* unless the code matches:

- `REQUIREMENTS.md`: implementation map + current behavior notes
- `EXPANSION_QUERY_METHODOLOGY.md`: the intended query-planning rules (the engine largely follows these)
- `EXPANSION_ENGINE_REFACTOR_PLAN.md`: detailed refactor log; great for rationale, but may include intermediate states
- `CODE_REVIEW_COMPLAINTS.md`: historical critique of earlier approaches; some items have been addressed by the current expansion engine

When in doubt: trace the runtime path from `buildQuery.ts` → `transformProps.ts` → `useExpansionEngine.ts` → `fetchPivotBranch.ts`.
