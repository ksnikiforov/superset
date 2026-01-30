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

# Pivot Table v3 — Seamless Reload (Stale-While-Revalidate)

## Purpose
When the user presses **Update chart** in user-controlled mode (layout or
dimension filters), the current behavior triggers the **global chart loader**
from `Chart.tsx`. This hides the entire chart (including chips and the left
panel). The desired behavior is:

- keep the **left panel and chip stripes visible**
- keep the previous table visible
- show **only the pivot table loader** inside the table area
- swap to new data when ready

This document describes a **seamless reload** implementation plan that makes
the global loader obsolete for this chart.

## Goals
- Avoid the global chart loader for user-controlled updates.
- Preserve the last rendered table while new data loads.
- Scope loading UI to the pivot table area only.
- Work in **Explore** and **Dashboard**.
- Keep state persistence (layout + filters) intact.

## Non-goals
- No change to expansion/hydration behavior.
- No global Superset loader changes for other charts.
- No change to server APIs.

## UX Behavior
1) User edits layout or dimension filters.
2) User clicks **Update chart**.
3) Table area shows a lightweight loader overlay.
4) Previous table remains visible until new data arrives.
5) On success, swap to new table data and stop loader.
6) On error, keep old data and show an error inline (optional).

## State Model
Two layers of state:

- **Committed state** (applied): drives the rendered table.
  - `committedLayout`
  - `committedFilters`
  - `committedTree` (data)
- **Pending state** (UI edits): lives in the left panel until Update.
  - `uiRuntimeLayout`
  - `uiSelectedFilters`

The Update button commits pending state and triggers a **plugin-owned fetch**.

## Data Flow (Seamless Reload)
1) Build a query payload using pending layout + filters (same logic as buildQuery).
2) Fetch data using **pivot-owned fetch path** (ChartDataClient / SupersetChartDataClient).
3) While in-flight:
   - keep committed data visible
   - show loader only over the table area
4) On success:
   - replace committed tree
   - update `pivotRuntimeLayout` persistence
   - update `filterState`/`extraFormData` persistence
5) On error:
   - keep committed tree
   - surface a non-blocking error UI

This mirrors the expansion engine’s behavior, but for full refresh.

## Integration Points
Preferred integration points (current module boundaries):
- `PivotTableChart.tsx`: owns pending vs committed UI state.
- `pivot/data/SupersetChartDataClient.ts`: reuse for chart data fetch.
- `pivot/query/specs.ts`: generate query specs for pending layout/filter.
- `pivot/engine/useExpansionEngine.ts`: remains responsible for expansion fetches.

## Persistence Strategy
Persistence must **not** force a global chart refresh:
- Use `setControlValue('pivotRuntimeLayout', ...)` to persist layout.
- Use `setDataMask({ ownState, filterState, extraFormData })` only after the
  plugin has fetched and committed data.
- Avoid using `setDataMask` as the trigger for data fetching.

This preserves dashboard/Explore state without incurring the global loader.

## Loader Scoping
Loader should be rendered inside the table area container (not the chart root).
The global chart loader from `Chart.tsx` should not be relied on for this path.

## Open Questions
- Should Update trigger a **dashboard filter mask** (cross-filter)
  immediately, or only after data is committed?
- If dashboard filter mask updates trigger other charts, do we accept their
  loaders while keeping the pivot chart seamless?
- Do we need a small "Updating..." indicator in the left panel?

## Rollout Plan
1) Add committed vs pending state split in `PivotTableChart.tsx`.
2) Create a **seamless reload** fetch pipeline using `ChartDataClient`.
3) Switch all user-controlled changes to **auto-apply** (no Update button).
4) Remove Update button UI entirely once seamless reload is active.
5) Optional: add a tiny inline loader badge in the table area header.

## Success Criteria
- Update chart shows **only table loader**.
- Left panel + chip stripes remain visible.
- No global chart loader for pivot v3 user-controlled updates.
- Works consistently in Explore and Dashboard.

---

## Auto-Apply vs Reload — Required Research & Spec

We need explicit, exhaustive rules for when a UI change:
1) can be applied **instantly** (no network),
2) should show a **table-only loader** (fetch required), or
3) can be applied instantly but **still show a loader** (optional UX).

The current behavior is inconsistent. This section defines the **research
matrix** that must be validated against real behavior and query requirements.

### Key principle
Whether a change requires queries depends on whether the **current tree**
already contains the data at the **new depth / new grouping**. If not, a fetch
is required. This must be determined per change.

### Terminology
- **Depth**: dimension depth after placeholder stripping.
- **Tree coverage**: data in `tree` at the depth needed for the new layout.
- **Query required**: no data at needed depth (or aggregation not derivable).

### Research Matrix (must validate each row)

| Change type | Example | Expected UI | Query required? | Notes |
| --- | --- | --- | --- | --- |
| Reorder rows within same axis | swap Row1/Row2 | Instant | **No** | Pure layout reorder; no grouping change. |
| Move dimension row ↔ column | Row1 → Columns | Loader | **Yes** | Groupby axis changes; new query required. |
| Insert/remove dimension **above** expanded level | remove Row1 with Row2 expanded | Loader | **Yes** | Groupby changed; existing data may not cover new prefixes. |
| Remove **deepest** dimension | remove Row3 when Row1/Row2 selected | TBD | **Depends** | If depth-2 values already fetched (totals/explicit depth), maybe no fetch. |
| Add new dimension at end | add Row3 | Loader | **Yes** | New depth needed; likely missing. |
| Change metrics count | +/− metric | Loader | **Yes** | New metrics; query required. |
| Change leaf selection (Value/IX/%) | toggle leaf | Loader | **Yes** | Measure leaves map changes. |
| Change filters | dimension filter values | Loader | **Yes** | Data slice changes. |
| Change value placement within same axis | move Value chip | Loader? | **Depends** | If only layout and tree covers needed depth, no fetch. |
| Expand/collapse nodes | expand Row1 | Loader (local) | **Yes** | Uses expansion fetch; already scoped to table. |

### Specific scenario from bug report (must be validated)

Scenario:
1) Rows: Row1, Row2, Row3.
2) Row1 expanded → shows Row2.
3) User deselects Row2 → Row3 becomes expanded (correct).

Expected:
- If Row3 remains selected, a fetch **may** be required if the tree does not
  already contain Row3-level values under the new grouping.
- If Row3 is **deselected**, and the resulting layout only needs Row1 depth,
  **no fetch should occur** if Row1-level values are already present in the tree.

This must be explicitly validated in code using the tree depth and current
query coverage.

### Required implementation checkpoints

1) **Detect whether required depth is already available**
   - Use render model + layout to determine target depth.
   - Compare against known fetched depths in `tree`.

2) **Define “covered by totals”**
   - If the tree contains totals/subtotals at the target depth, and those
     totals are sufficient for the new grouping, avoid fetch.

3) **Define “aggregation not derivable”**
   - The client does not roll-up from deeper data unless explicitly implemented.
   - If the new layout requires higher-level aggregates not present, fetch.

4) **Formalize the decision**
   - Create a function: `shouldFetchForLayoutChange(prevLayout, nextLayout, tree)`
   - Unit-test this with the matrix above.

### Status
This section is a **spec** and **research checklist**. Each row must be
validated and adjusted based on actual tree/query behavior before changes are
implemented.

---

## Deep Research Requirements (before implementation)

This section explains **what must be investigated and documented** to safely
auto-apply *all* changes (no Update button) while keeping reloads seamless.

### 1) Source-of-truth for “data availability”

We need a reliable answer to: “Does the current `tree` already contain values
for the new grouping depth?”

Investigate and document:
- How to detect the **maximum fetched depth** per axis from `tree.rows` /
  `tree.cols`.
- How to detect **which depth(s)** are available for a given branch path.
- Whether **totals/subtotals** can be reused as full-depth values
  (often no, because they are aggregated by a different grouping).

Deliverable:
- A concrete algorithm (pseudocode) that maps `tree + layout` → `coverage`.

### 2) Layout changes that are **purely visual**

These should never trigger a fetch. Must be explicitly enumerated.

Examples to validate:
- Row/column order changes within the same axis.
- Value chip placement move within the same axis.
- Axis swap *without* changing actual groupby depth (only if the data is
  already fetched for both orientations, which is rare).

Deliverable:
- A “no-fetch” change list with examples and unit tests.

### 3) Layout changes that **require new grouping**

These must trigger a fetch and table-only loader.

Examples to validate:
- Moving a dimension from rows → columns (groupby changes).
- Adding a new dimension (depth increases).
- Removing a dimension above the current expanded level.

Deliverable:
- A “must-fetch” change list with examples and unit tests.

### 4) Metrics / measure leaves changes

Any change that affects `metrics` or `measureLeavesByMetric` **always** requires
a query (new metrics not present in current tree). This includes:
- Add/remove metric
- Change leaf selection (Value/IX/%)
- Change leaf order when leaf presence changes

Deliverable:
- Explicit rule: “any metric/leaf selection change triggers fetch”.

### 5) Filters / time range

Any filter change (dimension filters, time range, etc.) must fetch. We must
ensure **stale-while-revalidate** keeps old table visible.

Deliverable:
- Explicit rule: “any filter signature change triggers fetch”.

### 6) Expansion interactions

Expansion currently uses a **branch fetch** path. We must ensure:
- auto-apply changes do not conflict with expansion hydration
- expansion fetches remain table-scoped (no global loader)
- expanded state is preserved through seamless reload

Deliverable:
- A sequence diagram of “expand + layout change + reload”.

### 7) Concrete scenario analysis (required)

For each scenario below, answer “fetch or no fetch” with reasoning:

1) Rows: Row1, Row2, Row3. Row1 expanded to Row2.
   - Remove Row2 (Row3 becomes expanded).
2) Rows: Row1, Row2, Row3. Row3 removed.
3) Rows: Row1 only. Add Row2.
4) Rows: Row1, Cols: Col1. Swap Row1 ↔ Col1.
5) Metrics: [A]. Add metric B.
6) Leaf selection: Value → Value + IX.
7) Filter value changed on Row1.

Deliverable:
- A table in this document with explicit expected behavior per case.

### 8) UX requirements for loader

Define exactly **where** loader appears:
- only over table area
- no chip stripes / left panel overlay
- optional mini “Updating…” badge

Deliverable:
- A CSS/DOM sketch or reference to the component where loader is rendered.

---

## Implementation guardrails

- Auto-apply is only safe if **all fetch-required changes are detected**.
- If coverage is uncertain, **fetch** (prefer correctness).
- Update button removal should only happen once the coverage rules are proven.
