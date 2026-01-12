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

# Pivot Table v3 Code Review Complaints

## Critical
- Key collisions are guaranteed because `serializePath` is just `path.join("__")`. Any `null` or `undefined` value becomes an empty segment and collapses into the root key, and any dimension value that includes `__` collides with multi-part paths. This corrupts row/col maps, cell lookups, and merge behavior. (`src/utils.ts:51-95`)
- Subtotal and total detection is driven by literal tokens (`__subtotal__`, "Subtotal", "Total"). If actual data contains those strings, nodes are treated as subtotals and become non-expandable or misformatted. (`src/utils.ts:54-66`, `src/PivotTableChart.tsx:1310-1324`)
- Metric detection is pure string matching against `metricLabelSet`, so any dimension value that matches a metric label is misinterpreted as the metric tier. That corrupts hierarchy traversal, expand behavior, and subtotal logic. (`src/PivotTableChart.tsx:810-845`, `src/utils.ts:1327-1333`)
- Metric labels are derived with `getColumnLabel` (column API) instead of metric label/key helpers. Adhoc metrics or renamed metrics can become `undefined`, which silently removes them from metric placement logic. (`src/PivotTableChart.tsx:810-812`)
- The branch cache is global, never invalidated, and the cache key omits datasource identity, time grain, totals/subtotals, ordering, and post-processing. Stale data can leak across filters and even across charts that share labels. (`src/fetchPivotBranch.ts:75-148`)
- `buildQuery` does not treat `rowSubTotals` as a reason to run multi-depth queries. Enabling row subtotals with empty levels can skip subtotal queries entirely, so totals are just missing. (`src/buildQuery.ts:134-145`, `src/buildQuery.ts:167-174`)
- Branch fetch uses raw groupby columns, while initial queries normalize temporal columns with `time_grain_sqla`. Expansions can query a different expression than the initial tree, so the merge step can map data to the wrong nodes. (`src/buildQuery.ts:74-107`, `src/fetchPivotBranch.ts:480-528`)
- Single-metric, metrics-first-on-rows does not propagate values back to base row paths, so collapsed views can show empty cells even though data exists. (`src/utils.ts:1443-1450`)

## High
- Sorting config supports `axisValueRef` and `mode: axis_value`, but sorting ignores both and only handles `mode === "total"`. The UI exposes settings that do nothing. (`src/utils.ts:500-516`, `src/PivotTableChart.tsx:2129-2144`)
- Sorting and dimension formatting are derived only from root row/col totals. If totals are hidden or not fetched, sorting/formatting silently no-op. (`src/PivotTableChart.tsx:2018-2040`, `src/PivotTableChart.tsx:2121-2148`)
- `transformProps` always merges new query results into `ownState.treeData`. If formData changes (metrics/groupbys), stale nodes and cells from the previous run remain and contaminate the new tree. (`src/transformProps.ts:280-291`)
- Concurrent expands can clobber each other because `handleToggle` merges into a stale `tree` snapshot and calls `setTree` without reconciling with the latest state. Quick multi-clicks can drop previously fetched branches. (`src/PivotTableChart.tsx:2778-2990`)
- `allowRenderHtml` uses `dangerouslySetInnerHTML` without any sanitization. Turning it on with untrusted data is an XSS foot-gun. (`src/PivotTableChart.tsx:3703-3725`)
- The expand cache key ignores subtotal selections; toggling row/col subtotal levels can reuse cached branches that lack the requested totals. (`src/fetchPivotBranch.ts:127-148`, `src/fetchPivotBranch.ts:416-454`)
- No sticky header implementation despite the requirement; the table is a plain overflowed element with no locked row/column headers. (`src/PivotTableChart.tsx:110-140`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/REQUIREMENTS.md:55`)

## Medium
- `buildFilterKey` omits several query-shaping knobs (time grain, granularity, row/series limits, post_processing), so cached data can be wrong even with identical filters. (`src/fetchPivotBranch.ts:116-125`)
- `resolveQueryDepth` infers depth from `colnames` when `query_name` is missing; partial queries can be interpreted as full depth and create phantom nodes. (`src/transformProps.ts:191-221`)
- `METRICS_PLACEHOLDER` is a literal sentinel; a real column named `__MEASURES__` is silently stripped and cannot be grouped on. (`src/utils.ts:51-90`)
- Databar scales are computed only from currently visible cells, so expanding/collapsing changes scale ranges and makes existing bars jump. (`src/PivotTableChart.tsx:3302-3340`)
- Type metadata is taken only from the first query result; later queries with different types are formatted/sorted with stale types. (`src/transformProps.ts:224-231`)
- "Grand total" and "Total" are hard-coded English strings used in logic, so localization is incomplete and data values with those strings are hazardous. (`src/utils.ts:1325-1333`, `src/transformProps.ts:336-349`)
- `normalizeCssColor` rejects named colors, 3-digit hex, and `hsl()`. Formatting silently drops user input. (`src/PivotTableChart.tsx:248-330`)
- `metricColorFormatters` are computed but never used by the chart, which is dead code and a maintenance smell. (`src/transformProps.ts:273-278`)
- Performance is a problem: multiple `useMemo` blocks iterate over all cells/rows/cols on every render (formatting maps, databar scales, waterfall offsets). Large pivots will lock the UI. (`src/PivotTableChart.tsx:2018-2060`, `src/PivotTableChart.tsx:3302-3421`)

## Low
- Row subtotal levels are only partially normalized in the chart layer, while columns are fully normalized. Behavior depends on upstream callers to pre-normalize rows. (`src/PivotTableChart.tsx:675-691`)
- Metric ordering uses `metricLabels.join("|")`; metric labels containing `|` collide and reorder unpredictably. (`src/PivotTableChart.tsx:810-820`)
- `parseThemeColors` only accepts hex and drops everything else with no feedback, making custom theme input fragile. (`src/utils.ts:67-71`)
- The table is a fully custom layout with extensive CSS instead of using Superset UI/antd wrappers, which is the opposite of the frontend modernization guidance. (`src/PivotTableChart.tsx:110-200`)

## Nitpicks
- Direct `@ant-design/icons` imports instead of Superset UI wrappers violate the modernization rules. (`src/PivotTableChart.tsx:20-24`)
- `theme as any` is everywhere, violating the "no any" rule and bypassing antd tokens. (`src/PivotTableChart.tsx:124-133`, `src/PivotTableChart.tsx:158-183`)
- Hard-coded sizes like `ROW_INDENT_PX = 16` ignore theme spacing tokens. (`src/PivotTableChart.tsx:169`, `src/PivotTableChart.tsx:4115`)
- The error banner is never cleared on success or data refresh, so a single failure leaves a permanent error state. (`src/PivotTableChart.tsx:742-808`, `src/PivotTableChart.tsx:4019`)
- Missing tests called out in requirements (drag/drop, locked headers, expand column UI, totals rendering) are still missing, so regressions will slip through. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/REQUIREMENTS.md:50-59`)
