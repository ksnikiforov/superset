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

# Pivot Table v3 — Plugin Improvement Plan (Modularization + Future Features)

This is a concrete, incremental improvement plan for Pivot Table v3. It includes:
- a **modularization refactor** (to create clear boundaries and make the codebase outsource-friendly), and
- a set of **explicit, separately-scoped behavior changes** required for upcoming major features.

Unless a section is explicitly labeled **Behavior change**, the work MUST be behavior-preserving.

Source-of-truth for current behavior: code in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src`.

Related docs:
- Architecture deep dive: `superset-frontend/plugins/plugin-chart-pivot-table-v3/ARCHITECTURE.md`
- Expansion methodology: `superset-frontend/plugins/plugin-chart-pivot-table-v3/EXPANSION_QUERY_METHODOLOGY.md`

Canonical doc note:
- `EXPANSION_ENGINE_REFACTOR_PLAN.md` (developer log/spec) has been merged into this document where relevant (see “Current state: expansion engine”), and the standalone file has been deleted to avoid spec drift.

---

## Normative language

This document is **normative** for the refactor. Keywords are used as follows:
- **MUST / MUST NOT**: required for acceptance
- **SHOULD / SHOULD NOT**: strong guidance; deviations require explicit approval
- **MAY**: optional

Unless a section is explicitly labeled “Behavior change”, the refactor MUST be behavior-preserving.

---

## Definitions (shared vocabulary)

These terms are used throughout the plan/spec.

- **Axis**: `row` or `col`.
- **Groupby**: the configured dimension list on an axis (from Explore controls).
- **Metrics placeholder**: the special groupby token `__MEASURES__` (Σ Values) that indicates where the metric tier lives.
- **Metric tier**: the hierarchy layer produced by injecting metric tokens (e.g. `__metric__Sales`) into row/col paths.
- **Measure**: a base metric selected by the user (e.g. `GrossRevenue`). (Today this is equivalent to “metric”; future work may introduce multi-level measures.)
- **Measure leaf**: a leaf under a measure that represents either the raw value or an always-present derived calculation (e.g. `Value`, `IXYA`, `%YA`, `DYA`). (Future feature; not part of today’s behavior.)
- **Measure stack**: the contiguous tier(s) inserted at the “Σ Values” position on an axis:
  - either a single-level measure (`MeasureGroup` only) or a two-level measure (`MeasureGroup → MeasureLeaf`)
  - dimensions may exist above and/or below the stack, but MUST NOT be placed between `MeasureGroup` and `MeasureLeaf` (FC-1)
- **Runtime layout**: a layout spec produced at runtime (e.g. via an in-chart builder panel) and stored in `ownState`, which is then resolved into `LayoutContext`. (Future feature; not part of today’s behavior.)
- **Path**: a `PivotPath` array of values representing a node’s position in the hierarchy.
- **Key**: a serialized path string (`serializePath(path)`), used as the stable identifier inside sets/maps.
- **Root key**: `serializePath([])`, which is the empty string `""`. It represents the “Grand total” node.
- **Subtotal token**: the literal `SUBTOTAL_TOKEN` value (`\u0002subtotal`) used to represent subtotal leaves inside a path.
- **Explicit subtotal node**: any node whose `path` contains `SUBTOTAL_TOKEN` (see `isExplicitSubtotalNode()` in `pivot/metricsTotals.ts`).
- **Dimension depth**: the number of *dimension* values in a path, ignoring metric tokens and ignoring `SUBTOTAL_TOKEN` (this is the depth used when interpreting subtotal “levels”).
- **Subtotal level**: an integer `d`:
  - `d = 0` means the grand total (root path `[]`)
  - `d > 0` means a subtotal for each node at dimension depth `d`
- **Stable prefix**: the longest prefix length where two axis dimension-key arrays match exactly (used to prune/migrate expansions on layout changes; see `getStablePrefixLength()` and `pruneExpandedToStablePrefix()` patterns in `useExpansionEngine.ts`).
- **Layout signature**: a deterministic string that changes whenever the *meaning* of expansions changes (groupbys, metric placement, totals/subtotals selections, etc). Today this is equivalent to `expandedStateSignature` in `PivotTableChart.tsx`.
- **Filter signature**: a deterministic string that changes whenever the *data slice* changes (time range, filters, extra_form_data, limits, etc). Today this is equivalent to `buildFilterKey()` in `fetchPivotBranch.ts`.
- **Global Async Queries (GAQ)**: a Superset feature flag (`FeatureFlag.GlobalAsyncQueries`) that can cause `/api/v1/chart/data` to return **HTTP 202** (Accepted) instead of **HTTP 200**. In that case the response body describes an async job, and the client must wait for completion and then fetch the cached results from `result_url` (Superset core does this in `superset-frontend/src/components/Chart/chartAction.js` via `waitForAsyncData` from `superset-frontend/src/middleware/asyncEvent.ts`).
- **HTTP 202 (Accepted)**: the server accepted the request but did not return results synchronously. It is not an error; it means “wait for async completion”.
- **Branch fetch**: a fetch operation that applies path filters for a specific expanded node (implemented as one branch/batch query object, possibly bundled with other query objects inside the same chart-data request).
- **Query object**: a single entry in the `/api/v1/chart/data` payload list (one aggregate query with its own `columns`, `filters`, `metrics`, and `query_name`).
- **Chart data request**: one network call to `/api/v1/chart/data` that may include **multiple** query objects in a single payload.
- **Branch query object**: a query object whose `query_name` includes `|branch:{axis}:...` and whose filters are built from a single expanded path.
- **Batch query object**: a query object whose `query_name` includes `|batch:{axis}:...` and whose filters include an `IN (...)` predicate to cover multiple sibling expansions under the same parent.
- **Hydration**: the process of issuing branch fetches until all expanded nodes have the children/cells required to render the current visible grid.
- **Expansion intent**: what the user wants expanded/collapsed (independent of what data is currently fetched).
- **Branch result data**: the fetched aggregates (tree deltas) used to render.

---

## Behavioral requirements (explicit, behavior-preserving)

This section defines the required runtime behavior after refactor. Outsourced implementation MUST preserve these behaviors unless a later PR explicitly declares a behavior change.

### BR-1 — Metric placement (“Σ Values”) and layout resolution

1) The system MUST treat `__MEASURES__` as the only representation of the “metric tier position” in Explore groupby arrays.
2) When metrics are selected (`formData.metrics` non-empty), layout resolution MUST ensure there is exactly one metrics placeholder across `groupbyRows` and `groupbyColumns`.
3) Metric placement resolution MUST remain equivalent to `resolveMetricPlacement()` in `src/utils.ts`:
   - the resolved axis determines `metricsLayoutResolved` (`ROWS` or `COLUMNS`)
   - the placeholder position determines `metricInsertIndex`
4) Query groupbys MUST NEVER include the placeholder token; it MUST be stripped before building query `columns`.
5) Expansion paths MAY contain metric tokens; any path used for backend filters MUST be normalized to match `getFetchPath()` behavior in `PivotTableChart.tsx` (decode metric tokens into metric labels).

### BR-2 — Totals/subtotals: normalization, token nodes, and positioning

This requirement defines how totals/subtotals are derived from controls, how they are represented in the tree, and how they are rendered (top vs bottom / front vs end). It MUST remain behavior-equivalent to the current implementation in `transformProps.ts`, `fetchPivotBranch.ts`, `PivotTableChart.tsx`, `pivot/visibility.ts`, and `pivot/cellUtils.ts`.

Informative note: `src/totals_design_doc.md` contains design intent and examples, but it is not the source of truth. This BR is derived from current code behavior.

#### BR-2.1 — Normalization (controls → normalized level sets)

1) The system MUST normalize “row subtotal levels” using `normalizeSubtotalLevels()` exactly like current code:
   - Let `maxRowSubtotalDepth = max(groupbyRows.length - 1, 0)` where `groupbyRows` has the metrics placeholder stripped.
   - Let `rowSubTotalsEnabled = formData.rowSubTotals ?? true` (default-on).
   - Compute `normalizedRowSubtotalLevels = normalizeSubtotalLevels(formData.rowSubtotalLevels, maxRowSubtotalDepth, legacyTotal=formData.colTotals, legacySubtotals=rowSubTotalsEnabled)`.
2) The system MUST normalize “column subtotal levels” in two stages, matching current code paths:
   - Let `maxColSubtotalDepth = max(groupbyColumns.length - 1, 0)` where `groupbyColumns` has the metrics placeholder stripped.
   - Compute `colSubtotalLevelsForQuery = normalizeSubtotalLevels(ensureIsArray(formData.colSubtotalLevels), maxColSubtotalDepth, legacyTotal=false, legacySubtotals=false).filter(level => level > 0)`.
     - This is the levels set used for query-pair generation and token injection (see `transformProps.ts` and `fetchPivotBranch.ts`).
   - Compute `normalizedColSubtotalLevels = normalizeSubtotalLevels(colSubtotalLevelsForQuery, maxColSubtotalDepth, legacyTotal=formData.rowTotals, legacySubtotals=false)`.
     - This is the levels set used for render/visibility (see `PivotTableChart.tsx`); it adds level `0` when `rowTotals=true`.
3) Level meaning MUST be preserved:
   - Level `0` means the **grand total** for that axis (root path `[]` / root key `""`), not a per-dimension subtotal.
   - Level `d > 0` means a subtotal for each node at **dimension depth** `d` (i.e., after `d` dimension values; metric tokens do not count; subtotal tokens do not count for the purposes of “which level is this subtotal for”).
   - By construction, `max*SubtotalDepth = groupbyLength - 1`, so there is **never** a subtotal at the leaf depth `groupbyLength`.
4) Query planning MUST treat “grand totals” as separate from “selected subtotal levels” for columns, matching current behavior:
   - The column subtotal selector (`formData.colSubtotalLevels`) MUST be treated as **levels > 0 only** for query pairs and token injection (`colSubtotalLevelsForQuery`).
   - The “grand total column” MUST be controlled by `rowTotals` (and/or level `0` in `normalizedColSubtotalLevels`, which is derived from `rowTotals`), not by `colSubtotalLevelsForQuery`.

#### BR-2.2 — Column subtotal selector semantics (control panel)

1) The `colSubtotalLevels` control MUST only expose selectable levels `1..maxColSubtotalDepth` (it MUST NOT expose level `0`).
2) Any incoming `colSubtotalLevels` value MUST be clamped and de-duplicated to that range (dropping `<= 0`, `> maxColSubtotalDepth`, and non-numeric values), matching `controlPanel.tsx` `mapStateToProps` behavior.

#### BR-2.3 — Token representation in `PivotTreeData`

1) `SUBTOTAL_TOKEN` MUST remain the canonical marker for **explicit** subtotal nodes:
   - explicit subtotal nodes MUST be represented by appending the literal `SUBTOTAL_TOKEN` (`\u0002subtotal`) to a base path
   - implementations MUST NOT “replace” explicit subtotal identity with a different marker (e.g. relying only on `node.isSubtotal`)
2) Row subtotal nodes MUST be injected by `injectRowSubtotalLeaves(tree, depth, fullDepth)` semantics:
   - For each requested subtotal depth `d` where `1 <= d < rowGroupby.length`, create `rowPathSubtotal = [...rowPathBase, SUBTOTAL_TOKEN]` for every row node with `rowPathBase.length === d` and no subtotal tokens.
   - Subtotal row nodes MUST have `hasChildren = false` and MUST be non-expandable.
   - Cells MUST be duplicated so that `(rowPathSubtotal, colKey)` receives the same metric values as `(rowPathBase, colKey)`.
3) Column subtotal nodes MUST be injected by `injectColumnSubtotalLeaves(tree, depth, fullDepth)` semantics (current implementation lives in `fetchPivotBranch.ts`):
   - For each requested subtotal depth `d` where `1 <= d < colGroupby.length`, create `colPathSubtotal = [...colPathBase, SUBTOTAL_TOKEN]` for every column node with `colPathBase.length === d`.
   - Column subtotal nodes MUST set `hasChildren = (colPathSubtotal.length < fullDepth)` (current behavior).
   - Cells MUST be duplicated so that `(rowKey, colPathSubtotal)` receives the same metric values as `(rowKey, colPathBase)`.
4) Row subtotal labels MUST be derived by `labelRowSubtotalLeaves()` semantics:
   - Single-metric default: `"{BaseLabel} Total"`.
   - Multi-metric cases: use `"{BaseLabel} {MetricLabel}"` when a metric label is present and is not “before” the base label in the path (see `labelRowSubtotalLeaves()` for the exact rule).
5) When projecting metrics into the row axis (`MetricsLayoutEnum.ROWS`), the relative ordering of `SUBTOTAL_TOKEN` vs metric tokens MUST match `applyMetricAxis()`:
   - If a row path has `SUBTOTAL_TOKEN` at the metric insertion boundary, the metric token MUST be inserted **after** `SUBTOTAL_TOKEN` (i.e. `[..., SUBTOTAL_TOKEN, __metric__X, ...]`), not before it.

#### BR-2.4 — Placement / visibility (start vs end) and multi-metric forcing

1) Column subtotal placement MUST be behavior-equivalent to `createColLeavesBuilder()` in `pivot/visibility.ts`:
   - grand total column placement uses `rowTotalPosition` (front/end)
   - subtotal column placement uses `colSubtotalPosition` (front/end), after any forcing rules below
2) Row subtotal placement MUST be behavior-equivalent to:
   - `getRowChildrenForNodes()` (controls whether explicit subtotal nodes are in the visible row list)
   - `shouldHideRowValues()` (controls whether parent rows display values when bottom-subtotals are enabled)
3) Forced subtotal position rules MUST remain:
   - `forceRowSubtotalEnd = rowSubTotals && isMultiMetric && (resolvedMetricsLayout === MetricsLayoutEnum.ROWS) && (metricsFirstOnRows === false)`
   - `forceColSubtotalEnd = isMultiMetric && (resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS)`
4) When `forceRowSubtotalEnd` is true, the effective row-subtotal position MUST be computed per node exactly like `getRowSubtotalPosition(node)`:
   - if `node.path` contains no metric token → position MUST be `'end'`
   - else let `metricIndex` be the first metric-token index:
     - if `node.path.length > metricIndex + 1` → position MUST be `resolvedRowSubtotalPosition`
     - else → position MUST be `'end'`
5) When `forceColSubtotalEnd` is true, `effectiveColSubtotalPosition` MUST be `'end'` regardless of the control value.

#### BR-2.5 — Expansion persistence excludes subtotal nodes

1) Expansion state MUST NEVER persist paths that contain `SUBTOTAL_TOKEN` (subtotals are non-expandable). Any persisted payload that includes subtotal-token paths MUST be ignored during coercion (`coerceExpansionState()` drops them).

### BR-3 — Query naming and traceability

1) Every query generated by pivot v3 MUST include a `query_name` with the prefix `pivot_v3|row{n}|col{m}` (see `formatQueryName()` in `src/pivot/query/queryName.ts`).
2) Query names MUST use the existing suffix conventions for diagnostics:
   - root prefetch: `...|root`
   - branch fetch: `...|branch:{axis}:{serializePath(path)}`
   - batch fetch: `...|batch:{axis}:{serializePath(parentPath)}`
3) Query execution MUST NOT rely on `query_name` ordering; names are for debugging and mapping results back to specs.
4) Path serialization MUST be lossless and consistent across the plugin:
   - Any time a `PivotPath` becomes a key string, it MUST use the same `serializePath()` implementation (not `path.join(...)`, not `key.split(...)`).
   - Any time a key string is parsed back into a `PivotPath`, it MUST round-trip values correctly, including:
     - values containing the path divider,
     - `null` / `undefined` values (must not turn into the literal strings `"__NULL__"` / `"__UNDEFINED__"` or similar).
   - This is required for correctness when dimension values are large strings or contain separators (user-facing requirement).

### BR-4 — Initial load query set (bootstrap + optional root/branch prefetch)

Initial render MUST be driven by a deterministic plan equivalent to `buildInitialQueryPlan()` in `src/pivot/engine/initialQueryPlan.ts`.

This requirement is intentionally explicit because initial-load query selection is the foundation for:
- perceived performance (minimal queries)
- deterministic loading behavior (stable, reproducible query sets)
- correct hydration when persisted expansions exist

#### BR-4.1 — Resolve “visible depth” (what the initial UI needs to render)

Let `rowGroupby` and `colGroupby` be the placeholder-stripped groupbys after metric placement resolution (BR-1). Let `rowLen = rowGroupby.length` and `colLen = colGroupby.length`.

1) Expand-level defaults MUST remain:
   - `resolvedStartCollapsed = formData.startCollapsed ?? true`
   - `resolvedInitialDepth = formData.initialDepth ?? 1`
   - `resolvedExpandRowsLevel = resolveExpandLevel(formData.expandRowsLevel ?? undefined, rowLen, resolvedStartCollapsed, resolvedInitialDepth)`
   - `resolvedExpandColsLevel = resolveExpandLevel(formData.expandColumnsLevel ?? undefined, colLen, resolvedStartCollapsed, resolvedInitialDepth)`
2) Base visible depth per axis MUST be computed exactly like current `buildInitialQueryPlan()`:
   - `baseRowDepth = rowLen === 0 ? 0 : min(rowLen, max(1, resolvedExpandRowsLevel))`
   - `baseColDepth = colLen === 0 ? 0 : min(colLen, max(1, resolvedExpandColsLevel))`
3) Persisted expansions MUST affect visible depth (because expanded nodes require one more level of data to render children):
   - Seed persisted expansion state via `coerceExpansionState(formData.pivotExpansionState)` (BR-8/BR-2.5 apply).
   - Compute stable-prefix lengths using the persisted `rowKeys`/`colKeys` compared to current stable keys derived from `rowGroupby`/`colGroupby` (`getStableColumnKey()`), matching `getStablePrefixLength()` logic in `buildInitialQueryPlan()`.
   - Prune persisted `rows/cols/collapsedRows/collapsedCols` paths exactly like `prunePaths()`:
     - drop any path whose dimension depth (ignoring metric tokens) is `<= 0`
     - drop any path whose dimension depth exceeds `min(stablePrefix, axisGroupbyLength)`
     - drop any path that contains `SUBTOTAL_TOKEN` (BR-2.5)
4) Persisted depth contribution MUST match `maxExpandedDepth()`:
   - For each persisted expansion path with dimension depth `d > 0`, it contributes an “expanded visible depth” of `min(axisGroupbyLength, d + 1)`.
   - `persistedRowDepth` is the max of those contributions across persisted row expansions; `persistedColDepth` is analogous.
5) Final visible depths MUST be:
   - `visibleRowDepth = max(baseRowDepth, persistedRowDepth)`
   - `visibleColDepth = max(baseColDepth, persistedColDepth)`

#### BR-4.2 — Decide whether to prefetch “root” (deep base views) (behavior change)

1) `shouldPrefetchRoot` MUST be computed as:
   - `shouldPrefetchRoot = baseRowDepth > 1 || baseColDepth > 1`
2) Persisted expansions MUST NOT force a deeper root prefetch:
   - If `baseRowDepth <= 1` and `baseColDepth <= 1`, then `shouldPrefetchRoot` MUST be `false` even if persisted expansions would make `visibleRowDepth/visibleColDepth` exceed `1`.
   - Deeper levels that are visible only under persisted expansions MUST be satisfied via branch/batch prefetch (BR-4.5 + BR-4.7), not via a global root query.
   - This is an intentional query-minimization rule; it differs from the current `buildInitialQueryPlan()` implementation and MUST be enforced by the refactor.
3) When `shouldPrefetchRoot` is true, the initial load MUST include a `|root` query (BR-3), and MUST NOT include the non-totals bootstrap queries (BR-4.3).

#### BR-4.3 — Bootstrap queries (minimal shallow baseline)

1) Bootstrap targets MUST be derived exactly like `buildBootstrapPlan(formData)`, with these explicit rules:
   - `normalizedRowSubtotalLevels` and `colSubtotalLevelsForQuery` refer to the normalized level sets defined in BR-2.1.
   - Define:
     - `needsTotals = !!formData.rowTotals || !!formData.colTotals || normalizedRowSubtotalLevels.length > 0 || colSubtotalLevelsForQuery.length > 0`
     - `needsMetricFormatting = Object.keys(formData.metricFormatting ?? {}).length > 0`
     - `needsDatabars = Object.keys(formData.metricDatabars ?? {}).length > 0`
     - `needsRowOrdering = Object.keys(formData.rowSorting ?? {}).length > 0`
     - `needsColOrdering = Object.keys(formData.colSorting ?? {}).length > 0`
     - `needsRowDimensionFormatting = Object.keys(formData.rowFormatting ?? {}).length > 0`
     - `needsColDimensionFormatting = Object.keys(formData.colFormatting ?? {}).length > 0`
     - `needsGrid = rowLen > 0 && colLen > 0`
     - `needsRowTotals = rowLen > 0 && (!!formData.rowTotals || normalizedRowSubtotalLevels.length > 0 || hasTotalSorting(formData.rowSorting, rowGroupby))`
     - `needsColTotals = colLen > 0 && (!!formData.colTotals || colSubtotalLevelsForQuery.length > 0 || hasTotalSorting(formData.colSorting, colGroupby))`
   - The target list MUST be constructed in this order:
     1) Always include a “totals-only” target:
        - `targetRowDepth=0`, `targetColDepth=0`
        - `intent.kind='totalsOnly'`
        - `intent.needsValueCells=false`
        - `intent.needsTotals=needsTotals`
        - `intent.needsMetricFormatting=needsMetricFormatting`
        - `intent.needsDatabars=false` (totals-only never requests databars)
        - ordering + dimension formatting flags MUST be `false`
     2) If `needsGrid` is true, include a “grid” target:
        - `targetRowDepth=1`, `targetColDepth=1`
        - `intent.kind='wholeLevel'`, `intent.needsValueCells=true`
        - `intent.needsTotals=false`
        - `intent.needsMetricFormatting=needsMetricFormatting`
        - `intent.needsDatabars=needsDatabars`
        - `intent.needsRowOrdering=needsRowOrdering`, `intent.needsColOrdering=needsColOrdering`
        - `intent.needsRowDimensionFormatting=needsRowDimensionFormatting`, `intent.needsColDimensionFormatting=needsColDimensionFormatting`
     3) If `rowLen > 0` and (`!needsGrid` or `needsRowTotals`), include a “rows” target:
        - `targetRowDepth=1`, `targetColDepth=0`
        - `intent.kind='wholeLevel'`, `intent.needsValueCells=true`
        - `intent.needsTotals=needsTotals`
        - `intent.needsMetricFormatting=needsMetricFormatting`
        - `intent.needsDatabars=needsDatabars`
        - `intent.needsRowOrdering=needsRowOrdering`, `intent.needsColOrdering=false`
        - `intent.needsRowDimensionFormatting=needsRowDimensionFormatting`, `intent.needsColDimensionFormatting=false`
     4) If `colLen > 0` and (`!needsGrid` or `needsColTotals`), include a “cols” target:
        - `targetRowDepth=0`, `targetColDepth=1`
        - `intent.kind='wholeLevel'`, `intent.needsValueCells=true`
        - `intent.needsTotals=needsTotals`
        - `intent.needsMetricFormatting=needsMetricFormatting`
        - `intent.needsDatabars=needsDatabars`
        - `intent.needsRowOrdering=false`, `intent.needsColOrdering=needsColOrdering`
        - `intent.needsRowDimensionFormatting=false`, `intent.needsColDimensionFormatting=needsColDimensionFormatting`
2) When `shouldPrefetchRoot` is false:
   - the plan MUST include **all** bootstrap targets returned by `buildBootstrapPlan(formData)` in order.
3) When `shouldPrefetchRoot` is true:
   - the plan MUST include **only** the first bootstrap target (`kind: 'totals'`, i.e. `(row0,col0)`).
   - it MUST NOT include the other bootstrap targets (`grid/rows/cols`) because the root prefetch will cover the deeper initial grid requirements.

#### BR-4.4 — Root prefetch target (only when `shouldPrefetchRoot` is true)

When `shouldPrefetchRoot` is true:
1) The plan MUST include exactly one `kind: 'root'` target.
2) The “root target axis” MUST be chosen exactly like `buildInitialQueryPlan()`:
   - use `'row'` if `rowLen > 0`, else `'col'`.
3) Root target depth MUST equal the computed *base* depths (clamped to axis groupby lengths via `resolveFetchContextForBatch`):
   - the root fetch context MUST be built via `resolveFetchContextForBatch({ formData, axis, path: [], metricPath: [], currentTree: emptyTree, visibleRowDepth: baseRowDepth, visibleColDepth: baseColDepth, targetRowDepth: baseRowDepth, targetColDepth: baseColDepth })`
4) Root target query pairs MUST be:
   - `dedupePairs([...buildBranchQueryPairs(axis:'row', pathLength:0, ...), ...buildBranchQueryPairs(axis:'col', pathLength:0, ...)])`
   - i.e. the union of “row-style” and “col-style” root branch pairs for `pathLength=0`, de-duplicated.

#### BR-4.5 — Persisted branch-prefetch targets (only for persisted expanded paths)

If persisted expansions exist after pruning (BR-4.1), the plan MUST include branch-prefetch targets for them.

1) “Collapsed overrides” MUST match current behavior:
   - `collapsedRows/collapsedCols` MUST be ignored unless the corresponding `resolvedExpand*Level > 0` (auto-expansion enabled).
2) Targets MUST be unique and stable:
   - Paths MUST be deduped by `serializePath(normalizeMetricPath(metricPath))`, matching `uniqueTargets()`.
   - Any target whose normalized key appears in the collapsed set MUST be excluded.
3) Target ordering MUST be deterministic:
   - row branch targets MUST be emitted first, sorted lexicographically by `serializePath(path)`.
   - col branch targets MUST be emitted second, sorted lexicographically by `serializePath(path)`.
4) Each branch target MUST be built using the same fetch-context + pair-builder pipeline as runtime branch fetching:
   - `ctx = resolveFetchContextForBatch({ formData, axis, path, metricPath, currentTree: emptyTree, visibleRowDepth, visibleColDepth })`
   - `queryPairs = buildBranchQueryPairs({ axis, pathLength: ctx.sanitizedPath.length, rowDepth: ctx.rowDepth, colDepth: ctx.colDepth, ...ctx, formData })`

#### BR-4.6 — Target ordering (determinism)

The initial plan target ordering MUST be stable:
1) Bootstrap targets first (BR-4.3), in the order they were constructed.
2) Root target second (BR-4.4), if `shouldPrefetchRoot` is true.
3) Row prefetch targets third (BR-4.5 + BR-4.7), in deterministic order:
   - batch-prefetch targets sorted by `{parentPathKey, batchSignature, required depths}`
   - then single branch-prefetch targets sorted by `serializePath(path)`
4) Col prefetch targets last (BR-4.5 + BR-4.7), in deterministic order:
   - batch-prefetch targets sorted by `{parentPathKey, batchSignature, required depths}`
   - then single branch-prefetch targets sorted by `serializePath(path)`

#### BR-4.7 — Persisted expansion prefetch MUST be batch-optimized (query minimization) (behavior change)

This is a required query-construction optimization for **full reloads** and **filter reloads**.
It is also intentionally stronger than the current initial-load behavior: today, persisted expansions are prefetched as separate branch queries; after refactor they MUST be batch-optimized where eligible.

When the initial plan includes prefetch targets for persisted expansions (BR-4.5), the planner MUST minimize the number of query objects by converting eligible sibling-prefetches into batch-prefetches.

Requirements:
1) A set of persisted prefetched expansions is eligible for batching if and only if:
   - they are on the same `axis`
   - they share the same parent path (same prefix)
   - their non-filter query shape is identical (same `batchSignature` equivalent to `buildBatchSignature()`)
   - their required depths match (same `childDepth` and same required opposite-axis depth)
2) For any eligible group with `>= 2` siblings, the plan MUST emit a batch-prefetch target instead of N single branch-prefetch targets:
   - the batch query MUST apply:
     - prefix filters for the parent path
     - an `IN (...)` filter on the next groupby level for the sibling values (non-null siblings)
     - nullish siblings in a separate batch (BR-6)
   - batch size MUST respect `MAX_BATCH_SIBLINGS` (splitting into multiple batch targets when needed)
3) For any remaining singletons (groups of size `1`), the plan MUST emit a normal branch-prefetch target (BR-5).
4) This optimization MUST NOT introduce extra round-trips:
   - the initial `/api/v1/chart/data` payload MUST include the minimal set of bootstrap/root queries plus the optimized branch/batch prefetch queries so “row2 prefetch” runs without waiting for a follow-up request (see BR-4.8).

#### BR-4.8 — Initial request bundling (round-trip minimization)

This requirement makes the “simultaneous row1 bootstrap + row2 prefetch” objective explicit.

1) The initial plan output (bootstrap + optional root + optional branch/batch prefetch) MUST be executed in a single `/api/v1/chart/data` HTTP request:
   - In Explore, this is achieved by having `buildQuery.ts` return a QueryContext with **all** planned query objects.
   - Superset core then POSTs that QueryContext as one request (default Explore behavior).
2) The plugin MUST NOT rely on “follow-up requests” to satisfy the initial visible grid when persisted expansions exist:
   - persisted expansion prefetch targets (BR-4.7) MUST be included in the same initial QueryContext.
3) Payload-size limits exist in real Superset deployments (e.g. Superset’s Docker nginx sets `client_max_body_size 10m` in `docker/nginx/nginx.conf`, and proxies commonly return HTTP 413 for larger bodies).
   - Explore-driven initial load cannot be transparently split by the pivot plugin (it emits one QueryContext and Superset core sends one request).
   - Therefore, initial-load robustness MUST come primarily from **minimizing query objects** (batch optimization, BR-4.7/BR-6), not from request splitting.
4) Runtime (non-Explore) fetches executed by `ChartDataClient` MUST implement a deterministic split-on-413 retry policy (Contract 2.A / Contract 6.B).

### BR-5 — Branch fetch semantics (single)

1) Expanding a node MUST fetch exactly “one dimension level deeper” along that axis (fixed increment = 1), while respecting the currently visible depth of the opposite axis (so that visible cells are populated).
2) Branch filters MUST be built exactly like current `buildPathFilters()`:
   - `null`/`undefined` values produce `IS NULL`
   - non-null values use `==`
3) Branch fetch depth-pair generation MUST remain equivalent to current `buildBranchQueryPairs()` logic in `src/fetchPivotBranch.ts` (including totals/subtotal and formatting/sorting-related pairs).
4) Temporal groupby normalization MUST be preserved:
   - When `time_grain_sqla` (or `extra_form_data.time_grain_sqla`) is present and a groupby column is a physical temporal column, the query groupby MUST use an `AdhocColumn` with `timeGrain` (equivalent to `normalizeColumn()` in `resolveFetchContext()` in `src/fetchPivotBranch.ts`).

### BR-6 — Branch fetch batching semantics (siblings under same parent)

This section defines how sibling expansions can be combined into fewer queries. It exists to enforce the “minimum required number of queries” objective across:
- initial load persisted prefetch (BR-4.7)
- user-driven expansions (hydration)
- filter/layout reloads (FC-3)

1) Batch eligibility MUST be decided using a stable signature equivalent to `buildBatchSignature()` (same non-filter query shape).
2) Batching MUST only combine expansions that share the same **parent path** and differ only by their **next-level sibling value**.
3) When there are `>= 2` eligible siblings in a group, the system MUST issue a batch fetch for that group (it MUST NOT emit one single-branch query per sibling).
4) The batch query MUST:
   - apply prefix filters for the parent path
   - apply an `IN` filter on the next groupby level for non-null siblings
   - handle nullish siblings in a separate batch (current behavior)
5) Batch size MUST be capped (current constant `MAX_BATCH_SIBLINGS = 50`) by splitting into multiple batch queries.

### BR-7 — Tree model assembly and merging

1) The canonical in-memory representation MUST remain `PivotTreeData` (rows/cols/cells maps keyed by serialized keys).
2) All record-to-tree transforms MUST preserve:
   - creation of intermediate nodes for every prefix (expandability)
   - consistent root nodes (`""`) for both axes
3) Metric tier projection MUST preserve `applyMetricAxis()` behavior, including the single-metric “surface value at base path” optimizations (collapsed rendering must not regress).
4) Subtotal leaf injection and labeling MUST preserve current behavior (`injectRowSubtotalLeaves`, column subtotal injection, `labelRowSubtotalLeaves`).
5) Merging MUST preserve `mergeTrees()` semantics (node and cell value maps are shallow-merged; subtotal flags preserved).

### BR-8 — Expansion intent persistence (the key lifecycle requirement)

This is the primary behavioral requirement driving the “store vs cache” separation.

1) User-driven expansion intent MUST be remembered at least until page reload.
2) Expansion intent MUST survive data refreshes caused by filter changes, even when Superset does not provide `setControlValue` (dashboard flows).
3) Expansion intent persistence MUST be implemented as a first-class store with these semantics:
   - **Memory-first**: in-session source of truth while mounted
   - **Best-effort persistence**:
     - if `setControlValue` exists: write to `pivotExpansionState`
     - else if `setDataMask` exists: write to `ownState.pivotExpansionState` using an atomic merge (MUST NOT clobber unrelated ownState fields)
     - else: memory-only
   - Persistence writes MUST occur on every user-driven expand/collapse intent change (no intentional throttling/debouncing in the plugin).
4) Persisted state MUST be treated as a **seed**, not an authoritative prop:
   - On mount: read persisted state and seed/prune memory
   - On in-session layout changes: memory intent MUST be preserved as far as it remains valid (migrate/prune by stable-prefix rules); it MUST NOT be overwritten from persisted state just because the signature changed
   - On pure data/filter refresh with unchanged layout signature: MUST keep memory intent (MUST NOT overwrite from props)
5) Persisted payload MUST contain only:
   - `rowKeys`, `colKeys` (layout identifiers)
   - `rows`, `cols`, `collapsedRows`, `collapsedCols` as arrays of paths
   - It MUST NOT store query results or tree data.

### BR-9 — Cache correctness (branch result data)

1) Branch result caches MUST be invalidated by filter changes (different `filterSignature`).
2) Branch result caches MUST NOT be used to preserve expansion intent (intent is owned by the store).
3) Cache keys MUST include enough context to prevent incorrect reuse:
   - at minimum: `{layoutSignature, filterSignature, axis, pathKey/metricPathKey, required depths, query shape signature}`
4) Concurrency MAY be unbounded per chart instance.
   - This refactor MUST preserve the current behavior (which uses unbounded `Promise.all` fan-out in the expansion engine) unless a PR explicitly declares a behavior change.

### BR-10 — Rendering and visibility

1) The render model MUST remain a pure function of `{tree, expandedRows, expandedCols, layout}`.
2) Visible depth computation MUST remain consistent with current behavior (expansion fetch planning depends on it).
3) Any refactor of `renderModel.ts` / `visibility.ts` / `viewModel.ts` MUST preserve output for the same inputs (verified by tests).

### BR-11 — Backwards compatibility and acceptance criteria

1) All existing unit tests under `superset-frontend/plugins/plugin-chart-pivot-table-v3/test` MUST pass after each refactor PR.
2) The refactor MUST NOT require changes to Superset backend code to satisfy BR-8 (dashboard persistence fallback is mandatory).
3) Any intentional behavior change MUST be:
   - explicitly called out in a “Behavior change” section in the PR description, and
   - accompanied by updated/added tests.

---

## Acceptance scenarios (Given/When/Then)

These scenarios are normative acceptance criteria. They are intentionally phrased in a way that can be turned into unit tests.

### AS-1 — Minimal bootstrap on collapsed start

Given:
- `groupbyRows = ["row1","row2"]`, `groupbyColumns = ["col1","col2"]`
- `metrics = ["metric1"]`
- `startCollapsed = true`, `initialDepth = 1`
- totals disabled (`rowTotals=false`, `colTotals=false`, `rowSubTotals=false`)

When: initial `buildQuery()` executes

Then:
- exactly 2 queries are emitted:
  - `pivot_v3|row0|col0` with `columns=[]`
  - `pivot_v3|row1|col1` with `columns=["row1","col1"]`

### AS-2 — Bootstrap includes totals axis queries when totals enabled

Given the same as AS-1, but `rowTotals=true` and `colTotals=true`

When: initial `buildQuery()` executes

Then:
- queries include:
  - `pivot_v3|row1|col0`
  - `pivot_v3|row0|col1`
  - in addition to `pivot_v3|row0|col0` and `pivot_v3|row1|col1`

### AS-3 — Root prefetch appears when base initial depth > 1

Given:
- any layout where either axis *base* (non-expansion) initial depth exceeds 1 (e.g. `startCollapsed=false`, or `initialDepth > 1`, or `expandRowsLevel/expandColumnsLevel > 1`)

When: initial `buildQuery()` executes

Then:
- at least one query name includes the `|root` suffix.

### AS-4 — Root prefetch suppresses non-totals bootstrap queries

Given:
- `groupbyRows = ["row1","row2"]`, `groupbyColumns = ["col1","col2"]`
- `metrics = ["metric1"]`
- `startCollapsed = true`, `initialDepth = 3` (so the computed initial visible depth exceeds 1 on both axes)
- totals disabled (`rowTotals=false`, `colTotals=false`, `rowSubTotals=false`)

When: initial `buildQuery()` executes

Then:
- query names include:
  - `pivot_v3|row0|col0` (bootstrap totals-only)
  - at least one `...|root` query
- query names MUST NOT include any of the following **without a suffix**:
  - `pivot_v3|row1|col1`
  - `pivot_v3|row1|col0`
  - `pivot_v3|row0|col1`
- query names MAY include `pivot_v3|row1|col1|root` (and similar) as part of the root prefetch.

### AS-5 — Persisted expansions are prefetched (branch queries on initial load)

Given:
- `pivotExpansionState.rows` includes `["A"]`
- `pivotExpansionState.cols` includes `["B"]`
- and the persisted layout keys match the current layout (or are prunable by stable prefix rules)

When: initial `buildQuery()` executes

Then:
- query names include `|branch:row:A` and `|branch:col:B` (suffix formatting preserved).

### AS-6 — Expansion intent survives filter change without `setControlValue`

Given:
- a runtime where `setControlValue` is unavailable (dashboard flow)
- user expands a row node `["A"]` and a col node `["B"]`
- expansion intent is persisted via `setDataMask({ ownState: { pivotExpansionState: ... } })`

When:
- filters change, producing new `formData` and new `data` (new `filterSignature`) and the chart rerenders (and may even unmount/remount)

Then:
- expanded/collapsed intent is preserved (at least until page reload):
  - if still mounted: memory-first state is retained
  - if remounted: the `ownState` payload is read and re-seeds expansions
- branch-result caches from the previous filterSignature MUST NOT be reused.

### AS-7 — Batch combines sibling expansions under the same parent

Given:
- expanding multiple siblings under the same parent (e.g. `["USA","Consumer"]` and `["USA","Corporate"]`)
- identical non-filter query shape (same batch signature)

When: the engine plans and executes fetches

Then:
- it MUST fetch using a single batch request (or multiple batches when `MAX_BATCH_SIBLINGS` is exceeded) that applies:
  - prefix filters for `["USA"]`
  - an `IN` filter on the next groupby level (`segment IN (...)`)
- it MUST NOT batch expansions across different parents (e.g. `["USA","Consumer"]` + `["Canada","Corporate"]`).

### AS-8 — Column subtotal selector clamps selections and excludes level 0

Given:
- `groupbyColumns = ["col1","col2","col3"]` (so `maxColSubtotalDepth = 2`)
- control-state `colSubtotalLevels.value = [1, 3, 5, 0]`

When: `controlPanel.tsx` `colSubtotalLevels.mapStateToProps` executes

Then:
- `options[].value` is exactly `[1,2]`
- the normalized `value` is exactly `[1]`

### AS-9 — Persisted expansion state drops subtotal-token paths

Given:
- `pivotExpansionState.rows = [["A"], ["B"], ["A", SUBTOTAL_TOKEN]]`
- `pivotExpansionState.cols = [["X"], ["Y"], ["X", SUBTOTAL_TOKEN]]`

When: `coerceExpansionState(pivotExpansionState)` executes

Then:
- `rows` contains only `serializePath(["A"])` and `serializePath(["B"])`
- `cols` contains only `serializePath(["X"])` and `serializePath(["Y"])`
- any axis entries containing `SUBTOTAL_TOKEN` are dropped (including in `collapsedRows`/`collapsedCols`)

### AS-10 — Bottom row subtotals hide parent values when expanded

Given:
- `rowSubTotals=true`
- `rowSubtotalPosition="end"` and the effective position for the node is `"end"`
- normalized row subtotal depths include `1` (e.g. `rowSubtotalDepths=[1]`)
- a parent row node with `path=["Bikes"]`, `hasChildren=true`, and `isExplicitSubtotalNode=false`
- `expandedRows` includes that parent row key

When: `shouldHideRowValues()` executes for that parent row node

Then:
- it returns `true` (so the parent row does not render value cells)
- the explicit subtotal row `["Bikes", SUBTOTAL_TOKEN]` is the row that renders the subtotal values

### AS-11 — Multi-metric forces row subtotal position to end (rows metrics layout)

Given:
- `metrics.length >= 2` (`isMultiMetric=true`)
- `resolvedMetricsLayout = MetricsLayoutEnum.ROWS`
- `rowSubTotals=true`
- `metricsFirstOnRows=false`
- user-selected `rowSubtotalPosition="start"`

When: `getRowSubtotalPosition(node)` executes for a row node whose `path` contains no metric token

Then:
- it returns `"end"` (forced) regardless of the configured control value

### AS-12 — Multi-metric forces column subtotal position to end (columns metrics layout)

Given:
- `metrics.length >= 2` (`isMultiMetric=true`)
- `resolvedMetricsLayout = MetricsLayoutEnum.COLUMNS`
- user-selected `colSubtotalPosition="start"`

When: `effectiveColSubtotalPosition` is computed

Then:
- it is `"end"` (forced) regardless of the configured control value

### AS-13 — Default row subtotal normalization (rowSubTotals defaults on)

Given:
- `groupbyRows.length = 3` (so `maxRowSubtotalDepth = 2`)
- `formData.rowSubTotals` is `undefined` (so `rowSubTotalsEnabled=true`)
- `formData.colTotals = true`
- `formData.rowSubtotalLevels` is `undefined`

When: `normalizedRowSubtotalLevels` is computed

Then:
- it is exactly `[0, 1, 2]`

### AS-14 — Column subtotal levels exclude 0 for queries, but render adds 0 when `rowTotals=true`

Given:
- `groupbyColumns.length = 3` (so `maxColSubtotalDepth = 2`)
- `formData.colSubtotalLevels = [1, 0, 99]`
- `formData.rowTotals = true`

When:
- `colSubtotalLevelsForQuery` is computed
- and then `normalizedColSubtotalLevels` is computed for render/visibility

Then:
- `colSubtotalLevelsForQuery` is exactly `[1]`
- `normalizedColSubtotalLevels` is exactly `[0, 1]`

### AS-15 — Row subtotal labeling uses “Total” for single-metric layouts

Given:
- `metrics = ["Sales"]` (single metric)
- a row node exists with `path=["Bikes", SUBTOTAL_TOKEN]` (an explicit subtotal node)

When: `labelRowSubtotalLeaves(tree, metrics)` executes

Then:
- the subtotal node label is `"Bikes Total"` (same for `formattedLabel`)

### AS-16 — Row subtotal labeling uses metric labels for multi-metric subtotal nodes

Given:
- `metrics = ["Sales", "Profit"]` (multi metric)
- a row node exists with `path=["Bike1", SUBTOTAL_TOKEN, encodeMetricKey("Profit")]`

When: `labelRowSubtotalLeaves(tree, metrics)` executes

Then:
- the subtotal node label is `"Bike1 Profit"` (same for `formattedLabel`)

### AS-17 — Persisted sibling expansions are prefetched via one batch query (no root prefetch)

Given:
- `groupbyRows = ["row1","row2"]`, `groupbyColumns = []`
- `metrics = ["metric1"]`
- `startCollapsed = true`, `initialDepth = 1` (so base depth is 1; no global auto-expansion)
- persisted expansion state contains multiple expanded siblings at row depth 1:
  - `pivotExpansionState.rowKeys = ["row1","row2"]`
  - `pivotExpansionState.rows = [["A"], ["B"], ["C"]]`
- totals disabled (`rowTotals=false`, `colTotals=false`, `rowSubTotals=false`)

When: initial `buildQuery()` executes

Then:
- query names MUST NOT include `|root` (persisted expansions must not force a global root prefetch)
- query names MUST include the bootstrap query for the visible collapsed level:
  - `pivot_v3|row1|col0`
- query names MUST include `pivot_v3|row2|col0|batch:row:` (one batched row2 prefetch for the root-parent sibling group)
- query names MUST NOT include three separate `|branch:row:` queries for `A`, `B`, and `C`.

### AS-18 — Path serialization round-trips separators and nullish values

Given:
- a path containing values that require escaping and nullish handling:
  - `path = ["a|b", null, undefined, "x"]` (the concrete divider character is implementation-defined)

When:
- `key = serializePath(path)` is computed
- and `parsed = parseSerializedPath(key)` is computed

Then:
- `parsed` MUST equal the original `path` value-by-value (including `null` and `undefined`)
- no path segment may be corrupted by delimiter splitting.

### AS-19 — Collapse aborts request group when it is no longer needed (hybrid cancellation)

Given:
- a committed table exists (so the UI can keep rendering while updates run)
- user expands a node `["A"]` on the row axis
- the planner produces at least one needed branch/batch fetch in a single request group `RG-1` (one `cancelScopeKey`)

When:
- before `RG-1` resolves, the user collapses `["A"]`

Then:
- the UI MUST collapse immediately (subtree hidden) and the per-node spinner for `["A"]` MUST stop immediately
- `RG-1` MUST be cancelled/aborted **if and only if** no still-needed specs remain inside `RG-1` (Contract 6.A.2)
- if results from `RG-1` still arrive (abort is best-effort), they MUST NOT be applied to the visible table (Contract 6.A.4)
- those results MUST still warm cache if cache-key signatures match (Contract 6.A.4; BR-9)

### AS-20 — Collapsing one sibling does not abort a shared batched request when other siblings still need it

Given:
- two sibling nodes `["A"]` and `["B"]` are expanded under the same parent (root)
- the planner batches them into one `|batch:row:` spec / request group `RG-2` (shared `cancelScopeKey`)

When:
- the user collapses `["A"]` while `["B"]` remains expanded and `RG-2` is still in-flight

Then:
- `RG-2` MUST NOT be aborted (it is still needed for `["B"]`)
- when results arrive, the engine MUST apply only what is still needed for the desired intent:
  - `["B"]` becomes expanded when coverage is sufficient
  - `["A"]` remains collapsed (and MUST NOT show newly-visible children)
- results MUST warm cache for `["A"]` as well (so re-expanding `["A"]` can be instant if coverage is satisfied)

### AS-21 — Interactive expansion requests are not bundled across unrelated cancellation scopes

Given:
- committed table exists
- user expands a row node and a column node that produce different `cancelScopeKey` values (different axis and/or parent group)

When:
- the client executes the resulting fetch plan

Then:
- the client MUST NOT bundle those unrelated scopes into a single HTTP `/api/v1/chart/data` request (Contract 6.B.2)
- each scope must be independently cancellable/ignorable without affecting the other

### AS-22 — Any fetch error shows full-chart failure and supports retry

Given:
- a committed table exists
- a new transaction starts (initial load, filter/layout update, or interactive expansion)
- at least one required request group fails (network error, non-2xx HTTP, or server-side chart-data error)

When:
- the first error is observed by the engine for that transaction

Then:
- the chart MUST render a full-chart error UI (no table visible) (Contract 6.C.1)
- the error UI MUST expose a single “Retry” action (Contract 6.C.2)
- clicking “Retry” MUST start a new transaction using the latest inputs and re-run standard planning/execution rules (Contract 6.C.2)
- expansion intent MUST remain intact across the failure and retry (Contract 6.C.4)

### AS-23 — Layout/filters changes auto-retry while failed (no special error logic)

Given:
- the chart is currently in a failed state (Contract 6.C.1)

When:
- the user changes `formData` and/or filters (new signatures)

Then:
- the plugin MUST attempt to fetch and render the new state using standard rules (Contract 6.C.3)
- if it succeeds, the error UI MUST be replaced by the table

---

## Forward-compat acceptance scenarios (future features)

These scenarios define required behavior for the upcoming features (FC-1/FC-2/FC-3). They are acceptance criteria for the future feature PRs, and they constrain this refactor by requiring clean boundaries and testable pure modules.

### FC-AS-1 — Measure leaves are adjacent to measures (no dimensions inside the stack)

Given:
- `groupbyRows = ["OrderStatus", "__MEASURES__", "Region"]`
- `metrics = ["GrossRevenue"]`
- selected measure leaves for `GrossRevenue` are `[Value, IXYA]` (so the leaf tier is rendered)

When: the axis hierarchy is constructed for rendering

Then:
- the row axis ordering MUST be `OrderStatus → GrossRevenue → (Value, IXYA) → Region`
- it MUST NOT be possible to produce `GrossRevenue → Region → (Value, IXYA)` or `GrossRevenue → OrderStatus → (Value, IXYA)`

### FC-AS-2 — Collapse to one tier when only one leaf is selected

Given:
- `metrics = ["GrossRevenue"]`
- selected measure leaves for `GrossRevenue` are `[IXYA]` (no `Value`)

When: the render model is built

Then:
- the hierarchy MUST collapse to a single visible measure tier (no visible `MeasureLeaf` tier)
- the measure label MUST become `GrossRevenue IXYA`

---

## Flow (before vs after refactor) (informative)

This section explains the runtime flow **today** and the intended flow **after modularization**, focusing on responsibilities and data lifecycles.

### Before refactor (today)

**Initial load**
1) Explore/dashboard provides `formData` → `buildQuery()` emits an initial multi-query request (bootstrap + optional root/branch prefetch).
2) `/api/v1/chart/data` returns query results → `transformProps.ts` merges them into a `PivotTreeData`.
3) `PivotTableChart.tsx` derives layout + totals policy + visibility config from `formData`, then renders via `buildRenderModel()` and `PivotTableView`.

**User expands/collapses**
1) The chart toggles expansion keys (`expandedRows`/`expandedCols`).
2) The expansion engine (`pivot/engine/useExpansionEngine.ts`) plans branch fetches and calls the branch fetcher (`fetchPivotBranch.ts`), which also owns a module-level cache.
3) Branch results are merged into the tree; rendering recomputes visible rows/cols and cells.

**Filter change / data refresh**
1) Superset sends new `formData` and/or new initial data (new “filter slice”).
2) Expansion intent persistence is coupled to `setControlValue('pivotExpansionState', ...)` (Explore); when that hook is absent, persistence relies on in-memory state only.
3) Branch-result caching and expansion-intent persistence are easy to conflate, creating pressure to “keep caches warm” to avoid collapsing UX.

### After refactor (target)

**Initial load**
1) `LayoutContext = resolveLayout(formData)` becomes a single-source-of-truth for:
   - metric placement, subtotal levels, forcing rules, and signatures
2) `QueryPlanner` emits a stable set of `QuerySpec`s (bootstrap/root/branch) with explicit IDs.
3) Batch optimization runs on planned branch specs (BR-4.7/BR-6), producing a minimal set of branch/batch specs.
4) `QueryBuilder` turns the final `QuerySpec`s into chart-data query objects (pure transform; no network).
5) `ChartDataClient` bundles query objects into the minimum number of `/api/v1/chart/data` requests (BR-4.8) and executes them; `TreeAssembler` merges results into `PivotTreeData`.

**User expands/collapses**
1) UI emits explicit intents: `expandRow(pathKey)` / `collapseRow(pathKey)` / same for cols.
2) `ExpansionStateStore` updates **memory-first** state immediately (UX source of truth).
3) The expansion planner produces a `FetchPlan` (a set of missing branch targets/specs).
4) Batch optimization runs on that plan (BR-6) to reduce query objects when multiple siblings are eligible.
5) `ChartDataClient` bundles the resulting query objects per cancellation scope (Contract 6.B) and executes them; `TreeAssembler` merges results; rendering updates.

**Filter change / data refresh**
1) `ChartDataClient` invalidates branch-result caches on `filterSignature` changes.
2) `ExpansionStateStore` does **not** reset memory expansion intent on filter changes; on layout changes it migrates/prunes intent by stable-prefix rules and only re-seeds from persistence on mount (or when memory is empty/uninitialized).
3) Persistence writes are best-effort:
   - Explore: `setControlValue('pivotExpansionState', ...)`
   - Dashboard: `setDataMask({ ownState: { pivotExpansionState: ... } })`

Net result: expansion intent is an explicit “store”, and branch-result caching is just an optimization.

---

## Current state: expansion engine (post-refactor summary)

This section captures the outcomes and non-negotiable invariants from the (now completed) expansion engine refactor, so implementers do not need to consult a separate drifting document.

### Why the engine refactor exists (context)

Pivot Table v3 fetches **branches** of a hierarchy and may receive results **out of order**. A branch may also be **incomplete** relative to the current opposite-axis visible depth (missing intersection cells). The engine must:
- keep the table snappy (parallel fetch where possible),
- never show blank intersection cells due to missing fetch coverage (“no empty grid”),
- avoid flicker/collapse due to async ordering,
- support manual expand/collapse + persisted expansion restore + auto-expand.

### UX invariants (engine-level)

These are treated as non-negotiable UX constraints for engine work:
1) **No empty grid**: expansions only become visible when the engine has enough data to fully render the expanded area for the current opposite-axis visible depth.
2) **Cross-axis atomic reveal**: if an expansion on one axis requires additional work on the other axis, the reveal is coordinated so we do not render incomplete intersections.
3) **Loaders represent user intent, not DB work**:
   - expanding rows shows row spinners only; expanding columns shows column spinners only
   - global overlay loader is reserved for full-table transactions when there is no committed table to show (FC-3).

### Engine architecture (what exists in code today)

Key modules introduced by the engine refactor (names are representative; search by symbol if paths drift):
- `pivot/engine/expansionStateModel.ts`: the canonical expansion intent model (pure)
- `pivot/engine/expansionPlanner.ts`: computes fetch targets for a desired expansion state (pure)
- `pivot/engine/fetchCoordinator.ts`: in-flight dedupe + epoch gating + cache priming (side-effects, but testable)
- `pivot/engine/stagingTree.ts`: order-independent merge of branch deltas (pure)
- `pivot/query/*`: query-intent helpers + batching optimizer
- `pivot/render/renderModel.ts` + `pivot/render/PivotTableView.tsx`: render model is pure; view is presentational
- `pivot/engine/useExpansionEngine.ts`: wiring layer (React state/effects; delegates to pure modules)

### What was completed (high signal)

Completed work includes (summary):
- Removed legacy expansion knobs/aliases (`maxDepthPerFetch`, legacy expansion state plumbing, and other unreleased/alias fields).
- Stabilized totals semantics across the plugin (rowTotals/colTotals naming consistency).
- Removed `buildQuery.ts` “depth bumping” hacks; branch fetch depth is explicit and predictable.
- Introduced a unified bootstrap planner for initial load (minimal bootstrap query set), and a single initial plan (“single-plan + single-wave”) that can include persisted expansion prefetch targets.
- Introduced fetch coordination primitives (cache + in-flight dedupe + epoch gating), and split render model vs view for testability.

### Remaining TODOs (explicitly tracked)

Engine-level TODOs that are intentionally deferred:
- Align loader policy strictly in `revealPolicy.ts` so the global overlay is used only for full-table transactions.
- Replace heuristic “hasLoadedChildren” logic with explicit loaded-depth evidence + policy (Phase 7 in the engine plan).

## Architecture critique (current state) (informative)

This section is intentionally critical: it highlights why the refactor plan exists and what risks it addresses.

1) **Cross-cutting logic is concentrated in `PivotTableChart.tsx`**
   - Layout policy, totals/subtotals rules, expansion planning, persistence hooks, render-model wiring, interactions, and formatting concerns are all entangled.
   - This makes behavior changes risky and unit testing expensive.
2) **Normalization logic is duplicated across layers**
   - Metric placement and subtotal level normalization appear in `transformProps.ts`, `fetchPivotBranch.ts`, `bootstrapPlanner.ts`, and `PivotTableChart.tsx`.
   - Duplication increases the chance of drift (a common source of subtle bugs).
3) **Caching boundaries are unclear**
   - `fetchPivotBranch.ts` owns a module-level cache, but cache lifetime and ownership are not aligned with chart instance lifecycles.
   - This makes it harder to reason about invalidation, memory pressure, and cross-instance correctness.
4) **Expansion intent vs branch-result data is easy to conflate**
   - Expansion is user state and must survive filter refresh.
   - Branch results are data that MUST be invalidated on filter changes.
   - When these are not explicitly separated, the “solution” tends to be more caches, not clearer state ownership.
5) **Totals/subtotals/metrics interactions are policy-heavy**
   - Many behaviors are encoded as scattered conditional rules (e.g. forcing subtotal positions in multi-metric layouts).
   - Without an explicit `LayoutContext`, the policy is hard to audit and hard to evolve.

## Goals (what “better architecture” means here)

1. **Single-source-of-truth for layout policy**
   - Metric tier placement, totals/subtotals normalization, “hide metric headers”, root suppression rules, etc.
2. **Single-source-of-truth for query specification**
   - Given `{formData, layout, intent}` produce the same query specs everywhere (initial load, branch fetch, batch fetch).
3. **Explicit I/O boundary**
   - Only one module talks to `/api/v1/chart/data` and owns caching/concurrency/tracing.
4. **Expansion persistence is a store, not a side-effect**
   - Remember user-driven expands/collapses at least until page reload, and persist through filter-driven refreshes via the best-effort persistence policy (Explore `setControlValue`, dashboard `setDataMask`/`ownState`, otherwise memory-only).
5. **Expansion engine is a state machine, not a React component**
   - The hook becomes a thin adapter around a testable core.
6. **Rendering is pure**
   - Tree + expanded keys + layout → `RenderModel` (no fetching logic).
7. **`PivotTableChart.tsx` becomes composition glue**
   - Orchestrates, but does not implement domain logic.
8. **Query construction is optimized and unified**
   - The planner MUST minimize query objects (batch siblings where possible) and minimize round-trips (bundle query objects within cancellation scopes, with split-on-413 fallback), without compromising cache correctness or UX (BR-4.7, BR-6, FC-3).

Non-goals (in this plan):
- Rewriting UI markup/styling or swapping component libraries.
- Changing query semantics or totals behavior (that comes later as an explicit feature PR).
- Introducing new runtime dependencies unless absolutely necessary.

---

## Forward-compatibility requirements (upcoming major features)

This refactor is required not only to clean up today’s code, but to support two planned, large feature additions without re-architecting again:
1) **Multi-level measures** (“additional calculations” under a metric like `Value`, `IXYA`, `%YA`, `DYA`)
2) **Runtime pivot builder mode** (end-users can reconfigure layout on the fly inside the chart)

The refactor MUST keep the following extension constraints in mind. These are architectural requirements for the modularization work (not today’s runtime behavior).

### FC-1 — Multi-level measures (“metric + calculation leaves”)

**Goal:** Treat “metric calculations” as a **structural** tier in the hierarchy, not as an expansion.

Requirements:
1) `LayoutContext` MUST be able to represent a **measure hierarchy**:
   - `MeasureGroup` (base metric label, e.g. `GrossRevenue`)
   - `MeasureLeaf` (always-present leaf under that group, e.g. `Value`, `IXYA`, `%YA`, `DYA`)
2) **Hard constraint — measure hierarchy depth is max 2**:
   - The system MUST support only:
     - a single-level measure (`GrossRevenue`) **or**
     - a two-level measure stack (`GrossRevenue` → `Value|IXYA|%YA|DYA`)
   - The system MUST NOT support any third “measure tier” (e.g. `GrossRevenue → IXYA → IXYA Type1|Type2` is impossible by design).
3) **Hard constraint — dimensions MUST NOT be interleaved between measure group and leaf**:
   - When the measure leaf tier is present (i.e. more than one leaf is rendered), `MeasureLeaf` nodes MUST be immediate children of their `MeasureGroup`.
   - A dimension field MUST NOT appear between `MeasureGroup` and `MeasureLeaf`.
   - Practically: the “Σ Values” placeholder represents the insertion point for the *entire* measure stack. Dimension tiers may exist above the stack and/or below the stack, but never inside it.

   Allowed examples (rows axis):
   - `OrderStatus → GrossRevenue → (Value, IXYA, DYA)` ✅
   - `GrossRevenue → (Value, IXYA, DYA) → OrderStatus` ✅

   Forbidden example (rows axis):
   - `GrossRevenue → OrderStatus → (Value, IXYA, DYA)` ❌ (dimension tier inside the measure stack)
4) Measure leaves MUST be selectable at runtime, and query planning MUST request **only the minimal required source data** to produce the selected leaf outputs:
   - Leaf selection controls the *output shape* (what the pivot renders as measure leaves), not necessarily the exact backend metric list.
   - The planner MUST compute a “leaf plan” per measure that determines:
     - which backend metric(s) are required (source metrics), and
     - which leaf outputs are computed client-side vs returned directly by the backend.
   - Deselecting a leaf MUST remove its output and SHOULD remove any now-unused source requirements (do not keep unused “warm” metrics).
   - If `Value` is deselected:
     - the `Value` leaf output MUST not be rendered, and
     - the base metric SHOULD be omitted from the requested metrics *if and only if* no remaining selected leaf requires it as a dependency.
       - If a selected derived leaf requires the base metric (common for time-comparison-derived leaves), the base metric MAY still be requested as an internal dependency even though the `Value` output is not shown.

4.1) **Default implementation for “Superset-style” derived leaves: reuse time-comparison source data, compute leaf outputs client-side**
   - Superset’s regular Table chart supports time comparison by requesting `time_offsets` (from `formData.time_compare`) and relying on the standard metric-offset naming convention `${metricLabel}__${offset}` (see `TIME_COMPARISON_SEPARATOR = "__"` and `getMetricOffsetsMap()` in `superset-frontend/packages/superset-ui-chart-controls/src/operators/utils/getMetricOffsetsMap.ts`).
   - Pivot v3 MUST prefer the same “single query object returns base + offsets” approach for derived leaves that depend on time offsets, rather than issuing separate query objects per derived leaf.
   - Because pivot v3 needs to support multiple derived leaf outputs simultaneously (e.g. `Value`, `DYA`, `%YA`, `IXYA`), it MUST NOT rely on the single-output `compare` post-processing operator alone (it supports one `compare_type` at a time).
   - Therefore, the default design is:
     - request the minimal set of source metrics + required time offsets, and
     - compute the derived leaf outputs as a pure post-fetch assembly step.

4.2) **Responsibility boundaries (robustness requirement)**
   - UI is responsible only for capturing leaf selection (and storing it in `ownState` / layout spec).
   - `pivot/layout` is responsible for validating selection + enforcing hard constraints (max 2 tiers; atomic measure stack; no dimensions inside).
   - `pivot/query` is responsible for translating a leaf selection into QuerySpecs (source metrics + time offsets + any required query flags).
   - `pivot/core` (or tree assembly code) is responsible for computing derived leaf outputs from the returned source values as a pure function.
   - The expansion engine MUST remain agnostic: it operates on the resulting tree/cell values regardless of how leaves were produced.
5) The measure leaf tier MUST NOT be modeled as “expand/collapse”:
   - it is always present in the tree when enabled by selection
   - expansion persistence MUST NOT store keys that exist only because of the measure-leaf tier (same spirit as “do not persist `SUBTOTAL_TOKEN` paths”)
6) The render model MUST support the UI rule “collapse to 1 level when only 1 leaf is selected”:
   - If selected leaves are `[Value]`, the hierarchy must look identical to today (one-level metric).
   - If selected leaves are `[IXYA]` (no `Value`), collapse the hierarchy to one level and rename the label:
     - `GrossRevenue` becomes `GrossRevenue IXYA`.
   - If selected leaves are `[Value, IXYA, %YA]`, the hierarchy must be two-level:
     - `GrossRevenue`
       - `Value`
       - `IXYA`
       - `%YA`
   - Implementation guidance (key stability):
     - The engine SHOULD keep a stable internal identity for `{MeasureGroup, MeasureLeaf}` even when the UI is “flattened” to one visible tier, so that:
       - expansion intent does not depend on leaf-tier keys, and
       - switching between 1-leaf and multi-leaf states does not require brittle “key migration” logic beyond a normal `layoutSignature` change.
7) Query naming and spec IDs MUST remain stable and debuggable when measures become multi-level:
   - `query_name` continues to represent *depths* and *axis/path*; it MUST NOT become ambiguous due to the measure hierarchy.
8) Empty-selection guard:
   - The system MUST NOT allow an “empty leaf selection” state.
   - If the effective selected measure leaves set is empty across all measures, the engine MUST coerce the selection to the “Value-only” state (equivalent to `[Value]` selected).

Architectural implication (what the refactor must enable):
- `applyMetricAxis()` must not be hard-coded to “single metric tier forever”; it should be refactorable into a more general “apply measure hierarchy tiers” transform without touching expansion/query/render modules.
  - That transform MUST preserve the “atomic measure stack” constraint: if a leaf tier exists, it is inserted immediately under its measure group, and never interleaved with dimension tiers (FC-1).

### FC-2 — Runtime pivot builder mode (dynamic layout without global loader)

**Goal:** Allow end-users to reconfigure rows/cols/measures at runtime while preserving expansion intent and avoiding full-chart reloads for non-destructive changes.

Requirements:
1) There MUST be an explicit “layout spec” type that is independent of Explore control plumbing:
   - Explore mode: layout spec is derived from `formData.groupbyRows/groupbyColumns/metrics/...`
   - Runtime builder mode: layout spec is derived from `ownState` (e.g. `ownState.pivotLayout`) plus a developer-defined “inventory” (allowed dimensions/measures/calcs)
   - The layout spec MUST preserve the “Σ Values is an atomic slot” rule:
     - dimensions may be placed above or below the measures stack
     - dimensions MUST NOT be placeable between `MeasureGroup` and `MeasureLeaf` (FC-1)
2) The refactor MUST ensure the same planning pipeline is usable in both modes:
   - `LayoutContext` MUST be derivable from either layout source
   - `QueryPlanner` MUST accept `LayoutContext` + intents and produce `QuerySpec`s
   - `ChartDataClient` MUST execute those specs without relying on the Explore refresh loop
   - The runtime builder UI MUST NOT implement query logic:
     - it may only mutate `layoutSpec` / measure selections in `ownState`
     - all query construction MUST flow through `LayoutContext` → `QueryPlanner` → (batch optimization) → `ChartDataClient` (Contract 2.A)
   - Builder UX constraint: layout changes MUST apply on “drop” (or equivalent commit action), not as a live-preview during drag operations.
3) Expansion intent MUST be preserved through **non-destructive** runtime layout changes:
   - the in-session store remains the source of truth
   - expansion keys are migrated/pruned (stable-prefix) rather than reset
4) Definition — “non-destructive layout change” (for preservation/no global loader):
   - A change is non-destructive for an axis if the new dimension key list shares a stable prefix with the previous list (e.g. append/remove-at-end changes).
   - Toggling measure leaves (FC-1) and toggling totals/subtotals positions are non-destructive changes with respect to expansion intent (they MUST NOT collapse expansions).
   - Moving a dimension between axes (rows ↔ columns) is **lossy**: some previously-expanded nodes no longer exist as a single axis node (they become “split” across axes).
     - The system MUST migrate/prune expansion intent using deterministic “representable-only” rules (no heuristics):
       - **Exact axis swap**: if and only if `{newRowKeys === oldColKeys}` and `{newColKeys === oldRowKeys}` (same ordering), the system MUST migrate expansion intent by swapping the axis sets:
         - `rows ↔ cols`
         - `collapsedRows ↔ collapsedCols`
         - then apply stable-prefix pruning (BR-4.1) against the new keys.
       - **All other cross-axis moves**: the system MUST NOT attempt to “infer” a mapping of expansions across axes.
         - It MUST preserve only expansions that remain valid prefix nodes on their original axis under stable-prefix pruning (BR-4.1).
         - Any expansion that relied on a dimension that moved to the other axis MUST be pruned (dropped).
     - Reordering earlier dimensions is also lossy/ambiguous; it MUST be handled by stable-prefix pruning (BR-4.1) with no migration heuristics.
     - Rationale (why “no heuristics”):
       - Cross-axis remapping is under-specified and can easily become incorrect in subtle ways (e.g. “same label” does not imply “same semantic node” after re-layout).
       - Heuristic remaps would also create hard-to-debug “phantom expansions” (UI shows expanded nodes, but they map to different SQL groupings than the user originally expanded).
       - Therefore: if a future product requirement needs more aggressive migration, it MUST be specified as a separate, explicitly-designed feature (not a one-off heuristic inside the planner/store).
5) Data fetching for runtime layout changes MUST be incremental and scoped:
   - the engine MUST compute what additional queries are needed to satisfy the new visible grid
   - it MUST NOT throw away already-fetched branch results when `filterSignature` is unchanged, unless the query shape truly differs
   - it MUST NOT use branch-result caches as the persistence mechanism for expansions (BR-8/BR-9 still apply)
   - A layout change that introduces only **deeper-than-visible** dimensions MUST NOT trigger new queries:
     - Example: if the current visible row depth is 1 (no deeper expansions), adding a new row dimension at the **end** of the rows stack MUST only make affected nodes expandable (render `+`), but MUST NOT fetch that dimension level until the user expands into it.
     - Example: if a layout change is destructive (reorders earlier dimensions), the engine MUST prune/collapse invalid expansions and show `+` for newly-available branches; it MUST NOT “auto-fetch” deeper levels just because the builder changed.
6) UX constraint (what “no global loader” means in practice):
   - runtime layout changes MUST NOT require mutating Explore controls (`groupbyRows`, `groupbyColumns`, etc) to trigger a full Superset chart refresh
   - the plugin MUST handle the change via the internal planner + `ChartDataClient` and show only local/incremental loading affordances

Architectural implication (what the refactor must enable):
- The initial “bootstrap/root” query planning must be invokable from runtime code (not only from `buildQuery.ts`), so runtime layout changes can plan/fetch without delegating to Superset’s global refresh.

---

### FC-3 — Stale-while-revalidate updates (keep previous table visible)

**Goal:** When the desired state changes (filters or runtime layout), keep rendering the last committed table while fetching the next table, and only show a lightweight “updating” indicator (not a full overlay) once there is committed data.

Definitions:
- **Committed view**: `{layout, tree, expandedKeys}` currently rendered.
- **Desired state**: `{layoutSpec, filterSignature, expansionIntent}` that the system is converging toward.
- **Update transaction**: a monotonically increasing ID used to ignore stale fetch results.

Requirements:
1) Loader policy MUST be two-tier:
   - **Initial load (no committed data)**: a full-table loader MUST be shown.
   - **Any subsequent update when committed data exists**: the table MUST remain visible and interactive; a lightweight “updating” indicator MUST be shown (e.g. in the top-left header cell near “Rows”).
     - The “updating” indicator MUST remain visible until the new committed view is swapped in (i.e. until the user can see the new data).
   - Scroll position MUST be preserved across non-destructive updates (filter changes, measure-leaf toggles, and runtime layout changes) as long as the previously-committed table remains visible; if implementation complexity is unexpectedly high, the implementer MUST raise it as a product question (do not silently drop this behavior).
2) Updates MUST be transaction-scoped:
   - Any layout/filter/selection change MUST start (or advance) an update transaction.
   - Query results MUST be tagged to a transaction; results from older transactions MUST NOT be merged into the pending/desired tree.
3) Interaction during update MUST remain coherent:
   - Expand/collapse actions during an update MUST mutate the **desired** expansion intent immediately.
   - If the user expands while a filter/layout update is pending, the engine MUST fetch data for the **desired** filter/layout immediately (it MUST NOT wait for a separate “filter update completes” phase).
   - The planner MUST either:
     - **append**: extend the pending fetch plan (if the transaction’s layout + filterSignature remain the same), or
     - **reset**: cancel/restart planning (if layout or filterSignature changed).
   - When the desired `filterSignature` differs from the committed `filterSignature`, branch fetches MUST be executed only for the desired transaction (avoid fetching “old filter” branches); the committed view MAY still reflect the toggle UI state via spinners/pending indicators.
   - The committed view MAY reflect toggles optimistically, but MUST NOT block the update transaction from converging to the desired state.
4) Commit semantics MUST be explicit:
   - The system MUST define what “ready to swap” means (minimum query coverage for the visible grid + required totals).
   - Once the pending data satisfies the desired visible grid, the pending view MUST become the new committed view in one atomic swap.
5) Cache correctness MUST still hold (BR-9):
   - Keeping the committed view visible MUST NOT cause reuse of branch-result caches across filterSignature changes.

6) “No empty grid” UX rule MUST be enforced:
   - The UI MUST NOT render newly-expanded areas with missing/empty cells.
   - Practically: an expansion is considered “complete” (and its per-node loader stops) only when the engine has enough query results to fully render the expanded area for the currently-visible opposite-axis depth.
   - Cross-axis note: a row expansion MUST NOT show a column loader (and vice versa). Loaders represent user expansion intent on that axis, not “all database queries that happened to be triggered”.

Architectural implication (what the refactor must enable):
- The expansion/hydration layer must become a real state machine with a “committed vs pending” concept (or equivalent), rather than tying the rendered tree directly to the newest `data` prop update.

---

## Assessment: blockers for FC-1/FC-2/FC-3 (informative)

This section calls out current architecture constraints that will make the upcoming features painful unless addressed by the refactor (or explicitly planned around). These are “watch items” for outsourced work: if a refactor PR preserves these blockers, it is not actually future-proof.

1) **Rendered tree is coupled to the latest `data` prop**
   - Today, `useExpansionEngine` resets local tree state whenever `data`/signatures change, and `PivotTableView` can fully replace the table with a loader.
   - This conflicts directly with FC-3 (“keep previous table visible”). The refactor MUST introduce a committed vs pending model (Contract 6).
2) **Single-tier metric assumptions are embedded across the stack**
   - Many functions assume the “metric token” is the only metric-related tier and often assume it is at/near the end of a path (`deriveMetricKey`, metric grand total detection, label formatting).
   - Multi-level measures (FC-1) will require an explicit “measure hierarchy” model; even with the hard constraints (max 2 tiers, atomic measure stack, no interleaved dimensions), the refactor must keep tokens/depth/label logic centralized and extensible (Phase 1 + Phase 2).
3) **Expansion state is modeled only as row/col prefix nodes**
   - This works for dimension trees, but FC-1 introduces a structural leaf tier that MUST NOT be treated as an expansion.
   - The refactor must allow “always-present tiers” that are visible without user expansion, and must keep expansion persistence scoped to expandable dimension tiers only.
4) **Query assembly and result mapping are too tied to array ordering**
   - `transformProps.ts` currently slices `queriesData` by “the next N pairs”.
   - Runtime updates (FC-2/FC-3) need robust, transaction-scoped result application; the refactor must enforce `QuerySpec` IDs and mapping-by-ID (Contract 2).
5) **Branch caching is module-level and not transaction-aware**
   - `fetchPivotBranch.ts` has a module-level cache; it cannot safely support concurrent “pending” updates and “committed” interactions without careful scoping.
   - The refactor must move caching into `ChartDataClient` and scope caches by `{filterSignature, layoutSignature, queryShape/spec}` (Phase 4 + BR-9).
6) **Loader semantics are too binary**
   - Today `showGlobalLoader` is a boolean that replaces the entire table.
   - FC-3 requires distinct loading states: initial load vs background update vs per-branch spinners. The refactor must make “loading model” explicit (Contract 6 + FC-3).
7) **Layout resolution must accept a runtime layout spec**
   - FC-2 requires a runtime layout builder without mutating Explore controls.
   - If `LayoutContext` remains hard-coded to Explore `formData`, runtime mode will fork logic and reintroduce duplication. The refactor must keep `layoutSpec` as a first-class input (Contract 1 + Phase 1).

---

## Target module boundaries (ownership map)

Proposed internal package layout under `src/pivot/`:

```
src/pivot/
  core/        # Pure domain: tokens, path keys, tree ops, transforms
  layout/      # Pure policy: resolve LayoutContext (Explore formData or runtime layout, FC-2)
  query/       # Pure planning/building: QuerySpec builders, batching rules
  data/        # Impure boundary: chart-data client, cache, warnings, tracing
  expansion/   # Mostly pure: expansion state model + fetch planning + reducer
  render/      # Pure view-model: visibility + header model + cell entries
  ui/          # React view components (presentational; includes runtime builder panel, FC-2)
```

Hard rules:
- `core/layout/query/expansion/render` must be usable in unit tests without React and without network.
- Only `data` may import `SupersetClient`.
- Only `ui` may import React/JSX.
- `PivotTableChart.tsx` should not contain new business logic; it should call module APIs.

---

## Non-negotiable contracts (to avoid a “reorganized monolith”)

These contracts are the guardrails that keep the refactor from devolving into the same complexity spread across more files. Each contract should be enforced by unit tests and (where useful) lightweight runtime assertions in dev builds.

### Contract 1 — `LayoutContext` is deterministic, pure, and authoritative

**Owner:** `pivot/layout`

**API shape (conceptual):**
- `buildLayoutContext(layoutSpec, datasource?) => LayoutContext`
  - `layoutSpec` MUST be derivable from Explore `formData` or from runtime builder state (`ownState`) (FC-2).

**Invariants:**
- Pure + deterministic: same inputs → byte-for-byte equivalent output.
- `LayoutContext` is the *only* place that resolves:
  - metric placement (`metricsLayoutResolved`, `metricInsertIndex`)
  - placeholder stripping (`groupbyRows`, `groupbyColumns`)
  - measure hierarchy resolution (today: flat metrics; future: multi-level measures with calculation leaves, FC-1)
    - MUST enforce “max 2 tiers” and “no dimensions inside the measure stack” constraints (FC-1)
  - normalized subtotal selections (`rowSubtotalLevels`, `colSubtotalLevels`)
  - normalized expand levels (`resolvedExpandRowsLevel`, `resolvedExpandColsLevel`)
- Provides stable signatures:
  - `layoutSignature` (changes when layout semantics change)
  - `filterSignature` is **not** part of `LayoutContext` (belongs to `pivot/data`)

**Enforcement:**
- Unit tests: same formData yields stable `layoutSignature`, and all downstream modules consume layout only from context (no recomputation).

### Contract 2 — Query planning emits explicit `QuerySpec` ids; consumers never rely on array order

**Owner:** `pivot/query`

**API shape (conceptual):**
- `buildInitialQuerySpecs(...) => QuerySpec[]`
- `buildBranchQuerySpecs(...) => QuerySpec[]`
- `buildBatchQuerySpecs(...) => QuerySpec[]`

**Invariants:**
- Each `QuerySpec` has a stable identifier (e.g. `specId`) that is derived from its semantic meaning (depths + axis + pathKey + intent), not from array position.
- `transformProps` and fetchers map results → specs by `specId`/`query_name` correlation, not by “slice the next N results”.
- Query planning MUST minimize query objects where possible:
  - de-duplicate identical depth-pairs/specs
  - batch sibling expansions under the same parent when eligible (BR-6; initial persisted prefetch BR-4.7)
- Query shape rules are centralized:
  - depth pairs, columns, and extra-metrics-for-formatting/sorting must be decided here (not duplicated in fetch code).
  - required measures/metric leaves are decided here based on `LayoutContext` (today: flat `metrics`; future: multi-level measures, FC-1).

**Enforcement:**
- Unit tests: given a plan/spec set, reordering the returned results does not break tree assembly.

### Contract 2.A — Batch optimization and request bundling are part of query construction

**Owner:** `pivot/query` (batch optimization) and `pivot/data` (request bundling)

This clarifies what happens to existing “batching” logic and where the “query builder” lives in the final architecture.

**Definitions:**
- **Batch optimization**: reduce the number of **query objects** by turning many sibling branch fetches into fewer `|batch:` queries (BR-6; initial persisted prefetch BR-4.7).
- **Request bundling**: reduce the number of **network round-trips** by sending multiple query objects in a single `/api/v1/chart/data` request payload.

**Invariants:**
1) Batch optimization MUST remain relevant and MUST be applied in all places where the system can plan ahead:
   - initial load persisted prefetch (BR-4.7)
   - user-driven expansions (hydration)
   - filter/layout reloads (FC-3)
2) Batch optimization MUST be implemented once and reused:
   - no separate “initial batching” vs “hydration batching” algorithms
   - a single optimizer consumes a list of planned fetch targets/specs and emits `{batches, singles}` (conceptually equivalent to today’s `optimizeFetchPlan()`), subject to `MAX_BATCH_SIBLINGS`.
3) The query builder MUST become a thin adapter around the planner output:
   - **Explore `buildQuery.ts`** MUST do nothing pivot-specific beyond:
     - `specs = QueryPlanner.buildInitialSpecs(...)`
     - `queries = QueryBuilder.toChartDataQueries(specs, baseQueryObject)`
     - `return buildQueryContext(formData, () => queries)`
   - runtime mode (FC-2/FC-3) MUST call the same `QueryPlanner` + `QueryBuilder` via `ChartDataClient` (without mutating Explore controls).
4) Request bundling MUST be used whenever multiple query objects are ready at once (within the same cancellation scope; Contract 6.B):
   - example: bootstrap/root queries plus persisted expansion batch-prefetch queries MUST be included in the same request payload (no extra round-trip).
   - example: a hydration iteration that decides multiple independent batch/single fetches MUST bundle them (per cancel-scope keys) and send them together.

**Bundling split policy (“split-on-413”, required):**
1) `ChartDataClient` MUST attempt to execute each request group as a **single** `/api/v1/chart/data` request containing all query objects for that group.
2) If the server rejects the request with HTTP 413 (or an equivalent “request too large” failure), `ChartDataClient` MUST retry by splitting the request group into smaller bundles and reissuing them (in parallel).
   - Splitting MUST be deterministic: order specs by stable `specId` and chunk/split consistently (so “same inputs” yields the same split sets).
   - Splitting MUST continue until either all bundles succeed, or a bundle contains a single spec and still fails (in which case the transaction fails per Contract 6.C).
3) Split execution MUST preserve semantics:
   - all split requests belong to the same `transactionId`
   - results are mapped back to `QuerySpec` ids (Contract 2) and merged order-independently
   - any single-request failure still follows the chart-level error policy (Contract 6.C)
4) Limitation (Explore initial load): Explore-driven initial load emits one QueryContext and Superset core sends one request; it cannot be transparently split by the pivot plugin. See BR-4.8.

**Batch optimization usage (when it runs, and when it does not):**
1) Batch optimization MUST run on **planned branch-prefetches** (including “persisted expansions prefetch” and “hydration fetch plan”), not on bootstrap/root intents:
   - bootstrap/root query objects are not “per-expanded-node” and therefore are not candidates for sibling batching.
2) Batch optimization MUST run at the point where the system has a **set** of branch targets/specs:
   - Initial load: after the initial plan (BR-4.5) enumerates branch targets from persisted expansion intent, before query objects are constructed (BR-4.7).
   - Hydration: once per hydration iteration, on the current queued set of missing branch targets (so multiple user-driven expansions within the same cycle can be combined).
   - Filter/layout reload: on the desired-state prefetch set for the next transaction (FC-3), before issuing new network requests.
3) A group is batch-eligible if and only if BR-6 eligibility holds (same axis, same parent path, same `batchSignature`, same required depths). If a group has size `1`, it remains a single branch query object.
4) Batch optimization MUST NOT be “skipped” just because request bundling exists:
   - bundling reduces network round-trips; batching reduces query objects (and backend work). They are complementary.

**Hybrid cancellation constraints (why bundling cannot be unconditional):**
1) Superset request cancellation is HTTP-request scoped (AbortController). It is not “per query object” within a bundled payload.
2) Therefore, request bundling MUST respect the desired cancellation granularity:
   - Initial load and filter/layout updates MUST bundle aggressively (BR-4.8; FC-3).
   - Interactive expansion fetches MUST NOT be bundled across unrelated cancellation scopes (Contract 6), otherwise collapsing one node would require cancelling work for other nodes (or accepting “soft cancel only”).

### Contract 3 — Only `ChartDataClient` performs I/O and owns cache correctness

**Owner:** `pivot/data`

**API shape (conceptual):**
- `client.fetch({ requestGroupId, transactionId, formData, specs }) => Promise<QueryResult[]>`
- `client.cancel(requestGroupId) => void` (best-effort; aborts the underlying HTTP request if still in-flight)

**Invariants:**
- Only this layer imports `SupersetClient`.
- Cache correctness is **filter-scoped**:
  - cached branch results must never be reused across different `filterSignature` values (time range, filters, extra_form_data, limits, etc).
- Concurrency is owned per chart instance.
  - Today, concurrency is effectively unbounded fan-out (`Promise.all`) in the expansion engine.
  - This refactor MUST NOT introduce concurrency throttling unless explicitly declared as a behavior change.
- Request cancellation is HTTP-request scoped:
  - cancellation MUST be implemented via `AbortController` passed to `SupersetClient` (`signal`)
  - there is no supported concept of “cancel one query object inside a bundled payload”; cancellation granularity is determined by request grouping (Contract 6.B)
- Global Async Queries (GAQ) MUST be supported using the same policy as Superset core:
  - When `FeatureFlag.GlobalAsyncQueries` is enabled, `/api/v1/chart/data` MAY return **HTTP 202**.
  - `ChartDataClient` MUST mirror `handleChartDataResponse()` behavior from `superset-frontend/src/components/Chart/chartAction.js`:
    - on **HTTP 200**: return `json.result` (or `json` if `result` is absent)
    - on **HTTP 202**: call `waitForAsyncData(asyncEvent)` from `superset-frontend/src/middleware/asyncEvent.ts` and return the resolved results
    - on any other status: treat as an error
- Returns structured warnings alongside data (e.g. truncation/partial results), rather than requiring callers to infer them ad-hoc.

**Enforcement:**
- Unit tests for cache keys: change any filter-relevant input → miss cache.
- Runtime dev assert: if cache hit occurs, verify matching `filterSignature`.

### Contract 4 — Expansion intent persistence is store-backed and data-refresh-safe

**Owner:** `pivot/expansion` (`ExpansionStateStore`)

**API shape (conceptual):**
- `store.read(): PivotExpansionState | undefined`
- `store.write(next: PivotExpansionState): void`

**Invariants:**
- Memory-first: user toggles immediately update in-session state and survive data refresh while mounted.
- Best-effort persistence:
  - prefer `setControlValue('pivotExpansionState', ...)`
  - else persist to dashboard `ownState` (merged/atomic; must not clobber unrelated ownState fields)
- Persisted state is a **seed**, not authoritative on every refresh:
  - on mount (or when memory is empty/uninitialized): seed + prune
  - on in-session layout changes: migrate/prune by stable-prefix rules; do not overwrite in-memory intent from persisted state
  - on filter/data refresh with same layout: keep in-memory intent, rehydrate data
- Store payload contains only expansion intent (paths/keys), never query results or tree data.

**Enforcement:**
- Tests: simulated “filters change” must keep expanded/collapsed intent, while branch-result caches are invalidated.

### Contract 5 — Render model is pure, and expansion uses it via stable interfaces

**Owner:** `pivot/render`

**API shape (conceptual):**
- `buildRenderModel({ tree, expandedRows, expandedCols, layout }) => RenderModel`
- `getVisibleDepths(renderModel, layout) => { visibleRowDepth, visibleColDepth }`

**Invariants:**
- Pure + deterministic: no side effects, no mutation of inputs.
- Expansion engine depends on render outputs via stable functions (not by injecting ad-hoc callbacks from `PivotTableChart.tsx`).
- RenderModel must be internally consistent:
  - every visible cell entry references existing row/col nodes
  - header model generation does not assume presence/absence of nodes outside `tree`

**Enforcement:**
- Unit tests: given a tree+expanded sets, render model outputs are stable and self-consistent.

### Contract 6 — Update transactions support “keep previous table” UX (FC-3)

**Owner:** `pivot/expansion` (state machine) + `pivot/data` (fetch execution)

**API shape (conceptual):**
- `reconcile(committed, desired) => { pending, fetchPlan, commitPolicy }`
- `applyResults(pending, results, transactionId) => pending`
- `commit(pending) => committed` (atomic swap when policy is satisfied)

**Invariants:**
- A “transaction id” (or equivalent) exists and is attached to all fetches; stale results are ignored.
- The UI can render the committed view while the pending view is being built (no hard dependency on “latest data prop”).
- Expand/collapse events always mutate the desired intent and cause either an append or reset of the pending fetch plan (FC-3).
- Full-table overlay loaders are only used when there is no committed table to show (FC-3).
- Cross-axis updates share a single transaction:
  - Row- and column-axis intents participate in one combined desired-state transaction (not two independent axis transactions).
  - This is required because the “required opposite depth” rule couples row/col coverage (a column expansion can require refetching row branches and vice versa).
- Planning MUST be immediate (no artificial debounce for user intents):
  - expand/collapse and builder “drop” events update desired state immediately and trigger a reconcile cycle.
- Collapse semantics MUST be immediate and cancel work:
  - collapsing a node MUST immediately remove its children from the visible model (no waiting for pending fetches).
  - collapsing a node MUST cancel (or render irrelevant) all in-flight fetches that exist solely to satisfy that node’s subtree (including descendant expansions).
- Expand semantics MUST be “no empty grid” and cache-first:
  - expanding a node MUST immediately update the desired expansion intent,
  - before showing a spinner or issuing any network request, the engine MUST attempt to satisfy the expansion from cache (Contract 6.A.3),
  - if cache coverage is sufficient, the UI MUST expand immediately (and MUST NOT show a spinner),
  - if cache coverage is not sufficient, the node MUST show a per-node spinner, and the UI MUST NOT expand (render the newly-visible children/cells) until the engine has enough data to fully render the expanded area for the current opposite-axis visible depth (FC-3.6).
- Event storms MUST converge to the latest desired state:
  - user intents are never “lost”, but network work MUST NOT accumulate as a long backlog of obsolete intermediate states.
  - the engine MUST cancel/ignore stale request groups and prioritize executing the minimal work required to satisfy the latest desired state.
- Fetch cancellation MUST be implemented using Superset’s request cancellation mechanism:
  - If a request cannot be cancelled at a fine-grained level (e.g. because multiple query objects were bundled into one HTTP request), stale results MUST be ignored for the expansion intent that no longer exists.
  - Any fully-received and parsed results MUST still be stored in cache (filter-scoped) to make immediate re-expansion snappy.

#### Contract 6.A — Hybrid cancellation model (abort + soft-cancel apply)

This section codifies the chosen approach:
- **Hard cancel** (best-effort): abort the HTTP request when no longer needed.
- **Soft cancel** (always available): ignore stale / no-longer-needed results, but optionally warm cache.

This is required because Superset cancellation is request-scoped (AbortController), and the backend does not provide “cancel a single query object inside a multi-query payload”.

##### Definitions

- **Request group** (a.k.a. *cancellation scope*): a set of query objects executed as one HTTP request and therefore sharing the same abort fate.
- **Needed spec**: a `QuerySpec` that is required to satisfy the current **desired** state (layout + filterSignature + expansion intent + visible depth policy).
- **Spec apply**: merging a spec’s results into the pending/committed `PivotTreeData`.
- **Cache warm**: storing a spec’s results in the branch-result cache (BR-9) without necessarily applying them to the currently-visible table.

##### Requirements

1) **Correctness is transaction-scoped**
   - Every fetch execution MUST be tagged with the current update `transactionId`.
   - Results from a different `transactionId` MUST NOT be applied (they are stale). They MUST be cached if their `{layoutSignature, filterSignature, spec key}` matches (BR-9).

2) **Collapse is immediate, and cancels work**
   - Collapsing a node MUST immediately remove its subtree from the *visible* model (no waiting for fetch completion).
   - Collapsing a node MUST stop the per-node spinner for that node immediately.
   - Collapsing a node MUST cause the engine to recompute “needed specs”; any in-flight request group that contains **no** still-needed specs MUST be aborted (best-effort) via `ChartDataClient.cancel(requestGroupId)` (or equivalent).
   - If an in-flight request group contains a mix of still-needed and no-longer-needed specs, it MUST NOT be aborted; instead, apply rules (4) decide what to do with results.

3) **Expand is immediate intent, but commits only when renderable**
   - Expanding a node MUST immediately update the desired expansion intent.
   - Before showing a spinner or issuing any network request, the engine MUST attempt to satisfy the expansion from cache (BR-9).
     - If cache coverage is sufficient to fully render the expanded area (FC-3.6), the UI MUST expand immediately and MUST NOT show a spinner.
   - If cache coverage is not sufficient, the node MUST remain unexpanded and MUST show a spinner until fetch results provide full coverage (FC-3.6).

4) **Soft-cancel apply is required**
   - If results arrive for a spec that is no longer needed (e.g. the node was collapsed, or the transaction advanced), the engine MUST NOT apply them to the visible table.
   - Those results MUST still warm cache if and only if:
     - they are fully received and parsed (no “partial response caching”), and
     - the cache key matches the current `{layoutSignature, filterSignature, spec key}` rules (BR-9).

5) **Descendant cancellation is mandatory**
   - If a parent collapses, any in-flight request groups that exist solely to satisfy descendant expansions MUST be cancelled/ignored as in (2).

##### Informative example (collapse during in-flight fetch)

Scenario:
- User expands `row=["A"]` → engine starts a request group `RG-1` for the needed branch/batch specs.
- Before `RG-1` resolves, user collapses `row=["A"]`.

Expected behavior:
- UI collapses immediately (subtree hidden).
- `RG-1` is aborted if it is now entirely unnecessary.
- If `RG-1` still resolves (abort may be best-effort), results are ignored for apply; they MUST warm cache (if cache keys match).

#### Contract 6.B — Request grouping and bundling policy (cancellation-aware)

This section defines *how to choose request groups* so cancellation semantics remain predictable.

##### Definitions

- **Cancel-scope key** (`cancelScopeKey`): a deterministic key used to decide what can share an HTTP request without harming cancellation granularity.
  - It MUST include enough information that “cancel this group” maps cleanly to “cancel the user intent(s) it serves”.
  - A suitable minimal definition is:
    - `{transactionId, filterSignature, layoutSignature, axis, parentPathKey, batchSignature, childDepth, requiredOppositeDepth}`
    - (exact fields may vary, but the principle must hold).

##### Requirements

1) **Initial load and update transactions (plan known up-front)**
   - For any plan-known-up-front transaction executed by `ChartDataClient` (e.g. runtime layout mode, or FC-3 background updates), the client MUST bundle the planned specs into the minimum number of HTTP requests.
   - If a bundle is rejected with HTTP 413, the client MUST split and retry per the split-on-413 policy (Contract 2.A).

2) **Interactive expansion/hydration (preserve cancellation granularity)**
   - During interactive expansion/hydration, `ChartDataClient` MUST NOT bundle query objects across different `cancelScopeKey` values into the same HTTP request.
   - The intent is: collapsing one node (or cancelling one subtree) should not require cancelling unrelated work for other nodes.
   - Within one `cancelScopeKey`, the client MUST bundle all query objects required by the planner for that scope (e.g. multiple queryPairs for totals/formatting), subject only to split-on-413 retries (Contract 2.A).

3) **Batching creates shared cancellation fate**
   - If BR-6 batching combines multiple sibling expansions under the same parent into one `|batch:` spec, those siblings necessarily share a `cancelScopeKey`.
   - Therefore, collapsing one sibling while other siblings in the same batch remain expanded MUST NOT abort the shared request group; results MUST be selectively applied based on still-expanded intent (Contract 6.A.2/6.A.4).

#### Contract 6.C — Error handling and retry (simple, fail-fast)

This contract defines the required error UX and error semantics. It intentionally prioritizes simplicity and predictability over partial recovery.

##### Requirements

1) **Any fetch error fails the chart**
   - If any request group required for the current transaction fails (network error, non-2xx HTTP, server-side error, or partial query errors), the chart MUST enter a “failed” state and render a full-chart error UI (no table).
   - The implementation MUST NOT partially apply results to the visible table when the transaction is considered failed.

2) **Retry is whole-transaction and deterministic**
   - The error UI MUST expose a single “Retry” action.
   - Clicking “Retry” MUST start a new transaction using the *current* inputs (latest `formData`, dataMask/filters, runtime layout if enabled, and the in-memory expansion intent store).
   - The retry MUST re-run the same query planning rules (batch optimization + request bundling policy + cancellation policy) as if the chart were loaded fresh for that state.

3) **No special-casing for layout changes while failed**
   - If the user changes layout/metrics/filters while the chart is failed, the plugin MUST attempt to fetch and render the new state using the standard transaction rules (no additional error-specific migration logic).
   - If the new transaction succeeds, the error UI MUST be replaced by the table.
   - If it fails, the error UI MUST remain (with the latest error).

4) **State retention rules on error**
   - Expansion intent store MUST NOT be cleared by errors (so a retry preserves the user’s intended expansion state).
   - Branch-result caches MUST NOT be mutated by failed/partial responses; they MAY be retained as-is.

5) **Error is a cancellation boundary**
   - When a transaction enters “failed”, the engine MUST cancel/ignore any remaining in-flight request groups belonging to that transaction (best-effort hard abort + required soft-cancel apply).

#### Concurrency note (resolved)

Concurrency bounding/backpressure is explicitly **out of scope** for this refactor.
- The implementation MAY issue many parallel request groups (unbounded fan-out), consistent with current behavior.
- If a bounded scheduler is introduced later, it MUST be explicitly called out as a behavior change and designed carefully (it will impact perceived latency of large expansion sets).

**Enforcement:**
- Unit test: “keep previous data” behavior (committed remains renderable while pending fetches run; swapping is atomic).

---

## Improvement Roadmap (TDD, minimal risk)

Quality gates (keep green throughout):
- tests: `npm test plugins/plugin-chart-pivot-table-v3`
- lint (plugin scope): `npx eslint plugins/plugin-chart-pivot-table-v3`

### Implementation status (non-normative)

This section tracks what has been implemented in this working tree. It does not change the acceptance criteria below.

- [x] Phase 0 — Safety net and invariants
  - Added contract tests under `test/plugin/contracts/*` + `test/plugin/engine/initialQueryPlan.contract.test.ts`.
  - Added a dev/test-only runtime invariant in `src/transformProps.ts` to catch missing axis root nodes early.
- [x] Phase 0.5 — Global Async Queries (HTTP 202) support for plugin-owned fetches
  - Added GAQ response handling inside `src/pivot/data/SupersetChartDataClient.ts` and applied it to plugin-owned fetches (`src/fetchPivotBranch.ts`, `src/pivot/query/fetchPivotBranchesBatch.ts`).
  - Added unit tests under `test/plugin/gaq/*`.
- [x] Phase 1 — Introduce `LayoutContext`
  - Added `src/pivot/layout/LayoutContext.ts` and routed layout resolution through it (single entrypoint).
  - Updated callers to consume `LayoutContext`: `src/transformProps.ts`, `src/fetchPivotBranch.ts`, `src/pivot/engine/initialQueryPlan.ts`, `src/pivot/query/bootstrapPlanner.ts`, `src/PivotTableChart.tsx`.
  - Preserved subtotal semantics by differentiating `colSubtotalLevels` (includes 0) vs `colSubtotalLevelsForQuery` (> 0) for query planning.
  - Verified: `npm test plugins/plugin-chart-pivot-table-v3` and `npx eslint plugins/plugin-chart-pivot-table-v3`.
- [x] Phase 2 — Extract “tree transforms” into `pivot/core`
  - Added `src/pivot/core/path.ts`, `src/pivot/core/tokens.ts`, `src/pivot/core/tree.ts`.
  - Moved path/token/tree implementations out of `src/utils.ts` and kept it as a compatibility re-export barrel.
  - Added unit tests under `test/plugin/pivot/core/*`.
  - Verified: `npm test plugins/plugin-chart-pivot-table-v3` and `npx eslint plugins/plugin-chart-pivot-table-v3`.
- [x] Phase 3 — Unify query specification under `pivot/query`
  - Added query-spec contract + builders: `src/pivot/query/types.ts`, `src/pivot/query/specs.ts`, `src/pivot/query/toChartDataQueries.ts`.
  - Routed initial load and expansion fetches through query specs: `src/buildQuery.ts`, `src/fetchPivotBranch.ts`, `src/pivot/query/fetchPivotBranchesBatch.ts`.
  - Centralized batching primitives under `src/pivot/query/*` (`batchSignature.ts`, `fetchPlanOptimizer.ts`) and reused them across hydration/prefetch.
  - Verified: `npm test plugins/plugin-chart-pivot-table-v3`.
- [x] Phase 4 — Create a `ChartDataClient` boundary in `pivot/data`
  - Added `src/pivot/data/ChartDataClient.ts`, `src/pivot/data/SupersetChartDataClient.ts`, `src/pivot/data/cache.ts`.
  - Centralized multi-query bundling + split-on-413 retry and GAQ handling inside `SupersetChartDataClient`.
  - Moved branch-result caching behind `pivot/data/cache` (keyed by `filterSignature`) and removed direct `SupersetClient` usage elsewhere.
  - Verified: `npm test plugins/plugin-chart-pivot-table-v3`.
- [x] Phase 4.5 — Error UX: full-chart failure + Retry (**behavior change**)
  - Added a full-chart error UI + single “Retry” action in `src/pivot/render/PivotTableView.tsx` (no table visible while failed).
  - Treated any branch/batch fetch error as transaction-fatal (Contract 6.C): cancel in-flight request groups and avoid partial apply.
  - Added tests under `test/plugin/PivotTableChart/error-ux.test.tsx` for AS-22 and AS-23.
  - Verified: `NODE_ENV=test npx jest plugins/plugin-chart-pivot-table-v3/test/plugin --runInBand` and `npx eslint plugins/plugin-chart-pivot-table-v3 --max-warnings=0`.
- [x] Phase 5 — Split expansion engine into pure planner + thin hook
  - Added `src/pivot/expansion/store.ts` (`ExpansionStateStore`, memory-first; best-effort persistence via `setControlValue` or dashboard `ownState`).
  - Added `src/pivot/expansion/planner.ts` + `src/pivot/expansion/engine.ts` and refactored `src/pivot/expansion/useExpansionEngine.ts` to delegate hydration planning/visibility decisions.
  - Kept compatibility re-export at `src/pivot/engine/useExpansionEngine.ts`.
  - Added unit tests under `test/plugin/expansion/*` and updated expansion persistence tests (`test/plugin/PivotTableChart/expansion-state.test.tsx`).
  - Verified: `npm test plugins/plugin-chart-pivot-table-v3/test/plugin`.
- [x] Phase 6 — Decompose `PivotTableChart.tsx` into a composition root
  - Extracted chart orchestration hooks under `src/pivot/chart/*`:
    - `usePivotLayout.ts` (layout + signatures + prune callbacks)
    - `usePivotRenderModel.ts` (sorters + `buildRenderModel()` wiring)
    - `usePivotFormatting.tsx` (formatting maps + databar model + cell renderers)
    - `usePivotInteractions.ts` (cross-filter + context-menu payload builders)
    - `useStickyHeaders.ts` (sticky header offset calculation)
  - Reduced `src/PivotTableChart.tsx` to a wiring-only composition root (layout → expansion → render model → formatting → view).
  - Verified: `npm test plugins/plugin-chart-pivot-table-v3/test/plugin`.
- [x] Cleanup — remove duplicate query artifacts
  - Removed duplicate query modules under `src/pivot/engine/query/*` after all call sites moved to `src/pivot/query/*`.
  - Removed duplicate bootstrap planner (`src/pivot/engine/bootstrapPlanner.ts`) in favor of `src/pivot/query/bootstrapPlanner.ts`.
  - Unified persisted expansion-state coercion via `src/pivot/query/persistedExpansionState.ts` (re-exported from `src/pivot/engine/expansionStateModel.ts`).
  - Verified: `npx eslint plugins/plugin-chart-pivot-table-v3 --max-warnings=0` and `npx jest plugins/plugin-chart-pivot-table-v3/test/plugin --runInBand`.

### Phase 0 — Safety net and invariants (1 PR)

**Purpose:** Make refactors safe by locking down behavior with a few high-signal tests and invariants.

Changes:
- Add “contract tests” focused on:
  - `LayoutContext` equivalence (future): metric placement, subtotal normalization.
  - Query spec equivalence (future): branch/batch query specs match current outputs for representative scenarios.
  - Expansion engine equivalence (future): same visible nodes + same fetch targets for same inputs.
- Add lightweight runtime assertions in dev builds only (optional) to catch inconsistent tree shapes (e.g., missing root nodes).

Files likely touched:
- Add new test files under `test/plugin/...` (prefer unit tests).

Exit criteria:
- Baseline tests pass and cover the scenarios you consider “must not regress” (metrics-first layouts, subtotal selections, persisted expansions, batching).

---

### Phase 0.5 — Global Async Queries (HTTP 202) support for plugin-owned fetches (1 PR)

**Purpose:** Ensure the plugin behaves correctly when Superset executes `/api/v1/chart/data` asynchronously (GAQ enabled).

Changes:
- Implement GAQ handling using the same policy as Superset core:
  - mirror `handleChartDataResponse()` in `superset-frontend/src/components/Chart/chartAction.js`
  - use `waitForAsyncData()` from `superset-frontend/src/middleware/asyncEvent.ts` for HTTP 202
- Apply this to all plugin-owned calls (today: `fetchPivotBranch.ts`; future: `pivot/data/ChartDataClient`).

Exit criteria:
- Manual expand/collapse continues to work with GAQ enabled (no “async job object treated as data” failures).
- The change is behavior-preserving for non-GAQ environments.

---

### Phase 1 — Introduce `LayoutContext` (single source of layout truth) (1–2 PRs)

**Purpose:** Remove repeated layout computations spread across `PivotTableChart.tsx`, `transformProps.ts`, `fetchPivotBranch.ts`, `initialQueryPlan.ts`, and `buildQuery.ts`.

Add:
- `src/pivot/layout/LayoutContext.ts`:
  - `buildLayoutContext(layoutSpec, datasource?) => LayoutContext`
    - for behavior-preserving refactor, `layoutSpec` can initially just be `formData`
    - the type MUST be chosen such that it can later accept runtime builder layouts from `ownState` (FC-2)

`LayoutContext` should include (minimum viable):
- `groupbyRowsRaw`, `groupbyColumnsRaw`
- `groupbyRows`, `groupbyColumns` (placeholder stripped)
- `metrics`, `metricKeys`, `metricLabelSet`
- `metricsLayoutResolved`, `metricInsertIndex`
- measure hierarchy (initially “flat metrics”; must remain extensible to multi-level measures, FC-1)
- `rowSubtotalLevels`, `colSubtotalLevels`
- `rowTotals`, `colTotals`, `rowTotalPosition`, `colTotalPosition`, `rowSubtotalPosition`, `colSubtotalPosition`
- `startCollapsed`, `initialDepth`, `resolvedExpandRowsLevel`, `resolvedExpandColsLevel`
- helpers:
  - `isMetricTokenValue(val)`
  - `getFetchPath(path)` (decode metric tokens into metric labels)

Refactor to use it:
- `transformProps.ts`: stop re-deriving placement and subtotal normalization.
- `fetchPivotBranch.ts`: stop re-deriving placement and subtotal normalization.
- `initialQueryPlan.ts`: use `LayoutContext` as input.
- `PivotTableChart.tsx`: use `LayoutContext` and build signatures from it.

Compatibility strategy:
- Keep existing exports; `LayoutContext` is internal. Minimal surface change.

Exit criteria:
- No behavior change (tests + manual spot-check).
- “layout resolution” logic has a single entrypoint.
- `LayoutContext` can be evolved to support FC-1/FC-2 without reworking expansion/query/render boundaries.

---

### Phase 2 — Extract “tree transforms” into `pivot/core` (1–3 PRs)

**Purpose:** Split the giant `src/utils.ts` into cohesive, pure modules without breaking callers.

Create:
- `src/pivot/core/path.ts` (serialize/parse path and cell keys)
- `src/pivot/core/tokens.ts` (metric/subtotal token helpers; must remain extensible for future “measure leaf” tokens, FC-1)
- `src/pivot/core/tree.ts`:
  - `mergeTrees`
  - `buildTreeFromRecords`
  - `applyMetricAxis` (refactorable into a more general “apply measure hierarchy tiers” transform, FC-1)
  - subtotal injection and labeling helpers

Keep `src/utils.ts` temporarily as a compatibility barrel that re-exports from the new modules:
- Step 1: move implementation, keep old exports stable.
- Step 2: migrate imports gradually.
- Step 3: delete unused leftovers once imports converge.

Exit criteria:
- `utils.ts` shrinks to mostly re-exports (or small glue).
- Tree transforms have their own unit tests and do not import React/network.

---

### Phase 3 — Unify query specification under `pivot/query` (2–4 PRs)

**Purpose:** Make “what queries do we run?” come from one place, regardless of initial load vs expansion, and make that planner invokable from runtime builder mode (FC-2).

Create:
- `src/pivot/query/specs.ts` (or folder):
  - `buildInitialQuerySpecs(formData, layout, persistedState?) => QuerySpec[]`
  - `buildBranchQuerySpecs({ axis, pathKey, visibleDepths, layout, treeSnapshot }) => QuerySpec[]`
  - `buildBatchQuerySpecs(batchGroup, ...) => QuerySpec[]`
  - NOTE: these builders MUST be driven by `LayoutContext` (not by re-parsing `formData`) so they can support FC-1/FC-2 without duplication.
- `src/pivot/query/toChartDataQueries.ts` (or similar):
  - `toChartDataQueries({ specs, baseQueryObject }) => QueryObject[]`
  - MUST be the only place that translates `QuerySpec` → `/api/v1/chart/data` query objects (`columns`, `filters`, `metrics`, `query_name`), so `buildQuery.ts` and `ChartDataClient` do not duplicate that mapping logic.

Move logic into this layer:
- `buildBranchQueryPairs()` from `fetchPivotBranch.ts`
- `buildQueryShape()` and `QueryIntent` plumbing remain in `pivot/query/shape.ts` / `pivot/query/intent.ts`
- `batchSignature` generation should be based on `QuerySpec` (not on re-building queryContext as a side-effect)
- initial and update planning MUST share the same batch-optimization step:
  - given N planned branch targets/specs, group eligible siblings and emit batch specs to minimize query objects (BR-6 + BR-4.7)
 - move the existing batching primitives into `pivot/query` as pure code:
   - `buildBatchSignature()` (currently `pivot/query/batchSignature.ts`)
   - `optimizeFetchPlan()` / `MAX_BATCH_SIBLINGS` (currently `pivot/query/fetchPlanOptimizer.ts`)
   - the optimizer MUST be usable for both “initial persisted prefetch” and “hydration” (Contract 2.A)

Define `QuerySpec` (pure data) as the canonical query contract:

```ts
type QuerySpec = {
  queryName: string;
  columns: string[];
  metrics: unknown[]; // keep as QueryFormMetric in code; shown as unknown in doc only
  filters: unknown[]; // keep as QueryObjectFilterClause[]
};
```

Then:
- `buildQuery.ts` becomes: `buildQueryContext(formData, base => specsToQueries(specs, base))`
- `fetchPivotBranch.ts` / `fetchPivotBranchesBatch.ts` become consumers of query-spec builders.

Exit criteria:
- Only one place “decides” depth pairs and required columns.
- Initial load and expansion use the same query-spec machinery.
- Initial load planning satisfies the query-minimization behavior changes:
  - persisted expansions do not force a `|root` query (BR-4.2)
  - persisted sibling expansions are batch-prefetched when eligible (BR-4.7)
- Query planning can be reused for future multi-level measures (FC-1) and runtime layout changes (FC-2).

---

### Phase 4 — Create a `ChartDataClient` boundary in `pivot/data` (2–3 PRs)

**Purpose:** Isolate I/O, caching, concurrency, warnings, and tracing in one module.

Create:
- `src/pivot/data/ChartDataClient.ts`:
  - interface: `fetch(specs, formData) => QueryResult[]`
  - optional: `fetchBatched(specs, ...)` if it differs
- `src/pivot/data/SupersetChartDataClient.ts`:
  - uses `SupersetClient.post({ endpoint: '/api/v1/chart/data', jsonPayload })`
  - owns error mapping and response validation
- `src/pivot/data/cache.ts`:
  - a shared cache keyed by a canonical `CacheKey` derived from `QuerySpec + formData filters + datasource + time grain`
  - replaces module-level cache in `fetchPivotBranch.ts`

Add cross-cutting concerns here (behavior-preserving initially):
- **Concurrency ownership**: keep all concurrency decisions centralized in this module.
  - Concurrency limiting/backpressure is a deferred optimization and is not required for this refactor.
- **Truncation warnings**: detect `rowcount == row_limit` in any result and expose a typed warning to UI (the code currently doesn’t surface this).
 - **Filter-scoped caching**: branch-result caches must be keyed by a `filterSignature` (time range + filters + extra_form_data + row_limit + etc). When filters change, it is correct to invalidate branch-result cache while keeping expansion intent.
 - **Request bundling**: accept many `QuerySpec`s and send them as a single `/api/v1/chart/data` request payload (multi-query) per request group; if the server rejects a bundle with HTTP 413, split and retry (Contract 2.A).

Exit criteria:
- No other module imports `SupersetClient`.
- Cache + concurrency are centralized.
- Request bundling is centralized:
  - the plugin can execute a set of `QuerySpec`s as one multi-query `/api/v1/chart/data` request payload, and deterministically split-on-413 (Contract 2.A), so “simultaneous bootstrap + batch prefetch” is not implemented via ad-hoc multiple calls.

---

### Phase 4.5 — Error UX: full-chart failure + Retry (1 PR) (**behavior change**)

**Purpose:** Adopt the simplified error policy (Contract 6.C) in a dedicated behavior-change PR, after `ChartDataClient` centralizes error mapping and GAQ handling.

Changes:
- Any fetch error (initial load, branch expansion, cross-axis hydration) renders a full-chart error UI (no table).
- The error UI exposes one “Retry” action that starts a new transaction for the current state.
- Layout/filter changes while failed are handled by standard rules (no special “error mode” logic).

Exit criteria:
- Error behavior matches Contract 6.C and AS-22/AS-23.
- No other runtime behavior changes are introduced in this PR.

---

### Phase 5 — Split expansion engine into pure planner + thin hook (3–5 PRs)

**Purpose:** Make expansion/hydration a testable state machine with explicit inputs/outputs.

#### 5.A — Introduce an explicit `ExpansionStateStore` (separate from data caches)

**Why:** “Expansion state” is user-driven UI state (expand/collapse) that must survive data refreshes. It should not be implicitly preserved via query-result caches.

Create:
- `src/pivot/expansion/store.ts`:
  - `ExpansionStateStore` interface (read/write)
  - store composition (memory-first, persistent best-effort)

Concrete behavior:
- **Memory is always the in-session source of truth** (survives filter refresh while the component stays mounted).
- Persist best-effort after any user toggle:
  - If `setControlValue` exists → write to `pivotExpansionState` (Explore-native persistence).
  - Else if `setDataMask` exists → write to `ownState.pivotExpansionState` (dashboard-friendly persistence through refresh/unmount).
  - Else → memory-only (still satisfies “until page reload”).
- The `ownState` backend must merge updates (do not clobber unrelated `ownState` fields like `treeData`); inject an “atomic merge ownState” helper from `PivotTableChart.tsx`.

Important rule (prevents “losing expansions on filter change”):
- Treat persisted state as a **seed**, not as a continuously-authoritative prop.
  - On mount (or when memory is empty/uninitialized): read persisted state and seed the memory store; prune invalid keys.
  - On in-session **layout signature** changes: migrate/prune by stable-prefix rules; do not clobber the in-memory store from persisted props.
  - On **data/filter** refresh with the same layout signature: do **not** overwrite memory expansion state from props; keep the user’s intent and rehydrate data.

Exit criteria:
- Expansions persist through filter refresh even when `setControlValue` is unavailable (dashboard flow).
- Branch-result caches can be cleared on filter change without collapsing the UI.

#### 5.B — Refactor the expansion engine implementation

Refactor `src/pivot/engine/useExpansionEngine.ts` into:

1) `src/pivot/expansion/engine.ts` (pure-ish):
   - inputs:
     - `tree`, `layout`, persisted state, explicit expand/collapse intents
   - outputs:
     - next `expandedRows/expandedCols`, `pending*`, `FetchPlan`
     - persistence payload to write back (optional)

2) `src/pivot/expansion/planner.ts` (pure):
   - wraps today’s `planExpansionForAxis` + “required opposite depth” rules
   - returns `FetchTargets` with stable IDs

3) `src/pivot/expansion/useExpansionEngine.ts` (thin React):
   - keeps refs/epochs/cancellation
   - calls the pure planner to get what to fetch
   - delegates fetching to `ChartDataClient`
   - persists expansion intent via `ExpansionStateStore`

Key architectural change:
- The expansion layer should not need to call `buildRenderModelConfig` from `PivotTableChart.tsx`.
- Instead, expansion should depend on `LayoutContext` + `render/getVisibleDepths()` and the render layer should be pure and importable.

Exit criteria:
- Hydration decisions can be unit tested without React.
- The hook shrinks dramatically and becomes primarily “effects + cancellation”.

---

### Phase 6 — Decompose `PivotTableChart.tsx` into a composition root (2–4 PRs)

**Purpose:** Make the top-level React component predictable and modular.

Extract hooks/modules:
- `usePivotLayout()` → builds `LayoutContext` and signatures
- `usePivotFormatting()` → formatting maps + databar scale model
- `usePivotInteractions()` → cross-filtering + context menu payload builders
- `useStickyHeaders()` → header offsets/row offsets
- `usePivotRenderModel()` → calls `render/buildRenderModel()`

`PivotTableChart.tsx` becomes:
- compute layout once
- call expansion hook once
- compute render model
- render `PivotTableView`

Exit criteria:
- `PivotTableChart.tsx` is “wiring code” with minimal branching.
- Layout/query/expansion/render logic lives in their owned modules.

---

## After modularization: targeted behavior improvements (separate PRs)

Once the boundaries are clean, you can safely tackle behavior enhancements (each as its own PR), e.g.:
- Better truncation warnings and partial-results UX.
- Clear “expand all in level” commands.
- More predictable ordering of subtotals vs metric tiers (policy becomes explicit in `layout`).
- FC-3 “keep previous table visible” (stale-while-revalidate): implement committed vs pending transactions and replace global overlay loaders with a lightweight updating indicator once committed data exists (approved as a separate behavior-change phase).

Do not mix these with the modularization PRs; keep refactors behavior-preserving.

---

## Migration checklist (definition of done)

- No cyclic imports between `core/layout/query/data/expansion/render/ui`.
- `buildQuery`, `transformProps`, and expansion fetching all use the same query-spec builders.
- Only `pivot/data` touches `SupersetClient`.
- Expansion core is unit-testable without React.
- Expansion intent persists through filter refreshes without relying on branch-result caches (memory-first; `setControlValue`/`ownState` persistence when available).
- `PivotTableChart.tsx` contains no new business logic and is substantially smaller.

---

## Suggested first PR order (lowest risk first)

1) Phase 0: Safety net and invariants (tests first).
2) Phase 0.5: GAQ (HTTP 202) support for plugin-owned fetches (behavior-preserving).
3) Phase 1: `LayoutContext` (no file moves yet; mostly “stop recomputing”).
4) Phase 4: `ChartDataClient` boundary (wrap I/O; centralize GAQ + error mapping).
5) Phase 3: query spec unification (use the data client; keep old names).
6) Phase 2: split `utils.ts` into `core/*` (mostly mechanical, after call sites stabilize).
7) Phase 4.5: error UX (full-chart failure + Retry) (**behavior change**).
8) Phase 5.A: `ExpansionStateStore` (memory-first persistence; dashboard fallback).
9) Phase 5.B: split expansion engine further (biggest change, now safer).
10) Phase 6: split the chart component.
11) Feature work (separate PR series): FC-1 (multi-level measures), FC-2 (runtime builder), FC-3 (stale-while-revalidate; approved as a behavior-change phase after modularization).
