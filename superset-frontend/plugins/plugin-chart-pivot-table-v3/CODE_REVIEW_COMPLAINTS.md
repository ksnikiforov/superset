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
- [ ] Unbounded prefetch: `fetchExpandedBranches` blasts one request per expanded node using `Promise.all` with no concurrency limits. A large persisted expansion will spike query load and risk timeouts or rate limiting. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3213`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3302`)
- [x] Redundant branch fetches: the prefetch loop runs for any expanded set and re-fetches data that is already present in the initial tree because `fetchedRowKeys`/`fetchedColKeys` are empty and never seeded for initial data. That means extra `/chart/data` calls for nodes that are already loaded. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3267`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3396`)
- [x] Path parsing is lossy and inconsistent: `parseSerializedPath` never decodes `__NULL__`/`__UNDEFINED__`, so persisted expansions on NULL values turn into string filters. Meanwhile `buildQuery` uses `key.split(PATH_DIVIDER)` and ignores escape semantics entirely. This breaks persisted expansions for values containing the divider and corrupts depth calculations. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:665`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts:225`)
- [x] "Only visible expansions persist" is violated: `persistExpansionState` keeps any expanded key that is not visible as long as it is still in the expanded set, so deep expansions can survive even when a parent is collapsed or removed. That is exactly the case the requirement forbids. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3059`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3090`)
- [ ] Dashboard persistence gap: when `setControlValue` is missing, expansions only land in `ownState` and never in `formData`. That means a dashboard refresh or publish loses the expansion state, which contradicts "persists page refreshes and publishing". (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3130`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx:523`)

## High
- [x] Hidden regression: `startCollapsed`/`initialDepth` controls were removed with no migration, so there is no UI path to start fully expanded anymore. Existing charts that set `startCollapsed=false` are now stranded with a hidden knob. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx:576`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts:179`)
- [x] The prefetch flow hides the entire table behind a global `Loading` spinner. For large expansions or slow queries, users lose access to already-visible data and controls. This is a UX regression compared to per-cell spinners. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3396`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:5107`)
- [x] Synthetic nodes for missing expansion keys always set `hasChildren: true` and do not clamp to groupby depth or subtotal tokens. That triggers pointless branch fetches for leaf nodes and can send bogus `SUBTOTAL_TOKEN` filters to the backend. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3234`)
- [x] `persistExpansionState` and other `setDataMask` calls race and can clobber each other because they spread the stale `ownState` prop instead of using the latest merged state. Expansion state can be dropped by a subsequent tree update. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3130`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:4295`)
- [x] Expand-level logic is duplicated between `buildQuery` and the chart component. Any drift will silently desync fetch depth vs. expansion depth and is already hard to reason about. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:575`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts:179`)

## Medium
- [x] Persisted expansion depth only influences initial query depth when `expandRowsLevel`/`expandColumnsLevel` are zero. If a user expands beyond those levels, the persisted state is ignored at load time, causing avoidable branch fetches and slower rehydration. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts:266`)
- [x] `expandRowsLevel`/`expandColumnsLevel` accept non-integers and negative values; the parser just clamps without normalization. That can yield fractional depth math and opaque behavior for users. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:564`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts:179`)
- [x] `seedExpandedByLevel` uses `countDimDepthBase` which does not strip subtotal tokens, so subtotal nodes can enter the expanded set and get persisted, despite being non-expandable. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:601`)
- [x] Persisting raw `PivotPath` arrays into `formData` can store non-JSON values (e.g., Date objects) and makes serialized chart configs unstable. There is no normalization layer. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:3110`)
- [x] `getStablePrefixLength` uses column labels instead of identifiers; renames or verboseMap changes will drop expansions even when the logical columns are unchanged. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:592`)
- [x] New `chartId`/`chart_id` fields were added to types but are unused. This is dead API surface. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/types.ts:211`)

## Low / Nitpicks
- [x] `expandRowsLevel`/`expandColumnsLevel` are TextControls with no min/max guardrails or UX hints about what zero means. This feels like a power-user trap. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx:576`)
- [x] `parseSerializedPath` lives inside `PivotTableChart.tsx` instead of utils, duplicating path parsing logic and inviting more drift. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:665`)
- [x] `isPrefetching` toggles are scattered (initial load and per-branch fetch), which makes it hard to reason about when the spinner is shown. A single state machine would be clearer. (`superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:1002`)

## Missing edge cases and tests
- [x] Persisted expansions for columns (not just rows), especially with metrics on rows/cols and metric-first layouts.
- [x] Values containing `PATH_DIVIDER`, `__NULL__`, `__UNDEFINED__`, `SUBTOTAL_TOKEN`, or the metric token prefix.
- [x] Collapsing a parent should purge all descendant expansions from persisted state (explicit regression test for the requirement).
- [x] Expansion state that comes in as string keys (legacy/ownState) should still rehydrate correctly.
- [x] `expandRowsLevel`/`expandColumnsLevel` > 0 combined with persisted expansions deeper than those levels.
- [ ] Dashboard flow without `setControlValue` (only `ownState`) to prove persistence across refresh/publish.
- [x] Large expansion sets should not trigger duplicate fetches when initial data already contains the needed depth.
