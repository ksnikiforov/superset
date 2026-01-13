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
# Pivot Table v3 - Code Review Complaints

## Critical
- Data corruption: `buildTreeFromRecords` writes row/col node `values` from per-cell records, so when both row and col groupbys exist the last cell wins and row/col totals become wrong. This breaks totals, total sorting, databar scales, and formatting. (`src/utils.ts`)
- Key collisions: `serializePath` stringifies values and uses sentinel strings (`__NULL__`, `__UNDEFINED__`, metric token prefix, subtotal token). Real data values matching these or differing only by type (1 vs "1", Date vs string) collapse into the same node and cell key. (`src/utils.ts`)
- Cell key ambiguity: `serializeCellKey` does not escape `CELL_KEY_DIVIDER`, so any row/col value containing `\u0001` makes keys unparsable and can corrupt the grid. (`src/utils.ts`)
- Metric label collisions in paths: `resolveFetchContext` treats any path value equal to a metric label as a metric token. If a dimension value matches a metric name, the code strips the wrong segment, builds wrong filters, and fetches the wrong depth. (`src/fetchPivotBranch.ts`)
- Initial expansion is broken: `initialDepth` is computed then ignored, so `startCollapsed` always collapses to root only. This contradicts requirements and makes fetch depth and UI out of sync. (`src/PivotTableChart.tsx`)
- Placeholder collisions: `METRICS_PLACEHOLDER` detection keys off `column_name`/`label`, so a real column with that label is removed from groupbys and disappears from queries. (`src/utils.ts`, `src/controlPanel.tsx`)
- Metrics with duplicate labels are dropped: `mergeMetrics` de-dupes by `getMetricKey`, so two adhoc metrics sharing a label silently lose one metric and its values. (`src/utils.ts`)
- Metric selection is non-deterministic: `deriveMetricKey` falls back to the first cell value key, which can be a formatting-only metric or just arbitrary object key order. Cells can render the wrong metric. (`src/pivot/cellUtils.ts`)

## High
- Subtotal depth detection counts subtotal tokens for current depth, so visible depth is overestimated and branch fetches can request the wrong level. (`src/fetchPivotBranch.ts`)
- Column subtotal injection does not exclude existing subtotal nodes, so nested subtotals and duplicate subtotal columns are possible. (`src/fetchPivotBranch.ts`)
- Cache key does not include row/col formatting or sorting config; enabling formatting or total sorting changes query pairs but the cache can return stale branches. (`src/fetchPivotBranch.ts`)
- `stableStringify` does not normalize array order and stringifies `undefined` as "undefined"; cache keys can collide or thrash for semantically identical filters. (`src/fetchPivotBranch.ts`)
- No cancellation for in-flight branch fetches; stale responses can merge into collapsed nodes or after unmount. The only pruning is partial and metric-specific. (`src/PivotTableChart.tsx`)
- `maxDepthPerFetch` falls back to `Number.MAX_SAFE_INTEGER` when undefined or 0, so an expand can silently fetch full depth and blow up query cost. (`src/fetchPivotBranch.ts`)
- Hard-coded labels ("Total", "Subtotal", "Grand total") are not translated and can become duplicated or awkward ("Total Total"). (`src/utils.ts`, `src/pivot/cellUtils.ts`, `src/PivotTableChart.tsx`)
- `buildQuery` always sets `orderby` to the first metric when `series_limit_metric` is missing, which can reorder data unexpectedly and fight client-side ordering. (`src/buildQuery.ts`)
- Formatting helper `normalizeMetricFormattingValue` picks the first element from arrays with no warning; the behavior is arbitrary and hidden. (`src/utils.ts`)
- Filter builders only strip encoded metric tokens. Raw metric labels in paths (supported in tests) leak into filters and context menus. (`src/pivot/filters.ts`)

## Medium
- The plugin uses `any` all over the place, violating the "no any" rule and making real type errors invisible. (`src/PivotTableChart.tsx`, `src/utils.ts`, `src/transformProps.ts`, `src/controlPanel.tsx`, tests)
- UI code bypasses `@superset-ui/core/components` and antd tokens, leaning on `@ant-design/icons`, `supersetTheme`, and `theme as any`. This is out of policy and fragile across theme updates. (`src/PivotTableChart.tsx`, `src/controlPanel.tsx`)
- `formatMetricValue` creates a new `CurrencyFormatter` for every cell. This is a huge perf hit for large tables and should be cached. (`src/pivot/viewModel.ts`)
- Formatting value maps depend on `Object.values(cells)` iteration order. Formatting can change depending on fetch order and cache merges. (`src/pivot/cellUtils.ts`)
- Metric placement logic is duplicated across control panel, buildQuery, transformProps, and fetchPivotBranch. Any drift yields subtle query/render mismatches. (multiple files)
- `buildTreeFromRecords` uses `getColumnLabel` without guarding empty labels; this can read `record['']` or `record[undefined]` and insert bogus paths. (`src/utils.ts`)
- Temporal sorting uses `new Date(a as any)` which depends on browser parsing and timezone; ordering can differ across clients. (`src/pivot/viewModel.ts`)
- `buildColumnHeaderRows` generates synthetic nodes without the formatting/sorting metadata of real nodes, so headers can render inconsistently. (`src/pivot/viewModel.ts`)
- Formatting and databar "collect" helpers can inject extra metrics with no cap or warning, inflating query cost unexpectedly. (`src/utils.ts`, `src/buildQuery.ts`, `src/fetchPivotBranch.ts`)
- A debug hook `window.__PIVOT_V3_DEBUG_PLACEMENT` is shipped in production and can spam the console. (`src/controlPanel.tsx`)

## Low / Nitpicks
- `normalizeThemeColor` accepts `hsl(...)` without validation and silently drops invalid input; there is no user feedback. (`src/utils.ts`)
- `splitThemeColors` is a naive parser and fails on newer CSS color functions like `color-mix()`; commas inside nested functions break parsing. (`src/utils.ts`)
- Duplicate single-metric propagation blocks in `applyMetricAxis` look like leftover refactor and make the behavior hard to reason about. (`src/utils.ts`)
- `buildFilterKey` includes large blobs (like `post_processing`) which bloat cache keys and make stringify slower without clear benefit. (`src/fetchPivotBranch.ts`)
- `formatMetricValue` falls back to `String(value)` for non-numerics, yielding `[object Object]` for JSON-like values and polluting the UI. (`src/pivot/viewModel.ts`)

## Missing edge cases and tests
- Dimension values that match metric labels or sentinel tokens (`__NULL__`, `__UNDEFINED__`, metric token prefix, subtotal token) should not break grouping or expansion.
- Values containing `PATH_DIVIDER` or `CELL_KEY_DIVIDER` should not corrupt keys or parsing.
- Duplicate metric labels and duplicate groupby labels should not drop metrics or merge unrelated nodes.
- `initialDepth` combined with `startCollapsed` should expand to the requested depth, and `initialDepth = 0` should be handled.
- `autoExpandColumns` behavior is missing entirely and not tested.
- Collapse while an expand fetch is in flight should not re-open nodes or merge stale data.
- Switching formatting/sorting configs should invalidate the branch cache and trigger new queries.
- Drag-and-drop placement, especially cross-axis inserts and hover index accuracy, has no coverage.
- Sorting by totals and subtotal depths with metric-first layouts is not covered.
- Rendering with zero metrics, with only one axis, and with metric layout moved mid-axis needs coverage.
