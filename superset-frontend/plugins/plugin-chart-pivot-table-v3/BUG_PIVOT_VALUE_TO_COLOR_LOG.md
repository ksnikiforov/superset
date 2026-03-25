# Pivot v3 bug log: `Value -> color` + resize regression

Date: 2026-03-25
Dashboard used for manual repro: `http://localhost:8088/superset/dashboard/19/`

## 1) Exact issues tracked

### Issue A: extra fetch on layout transition
Starting layout:
- columns: `Value`
- rows: `resellerName` (or `row1,row2` in tests)
- measures: two metrics

Transition:
- columns: `Value, color` (`productColor` / `col1`)

Observed problem:
- an extra seamless fetch was sent in a scenario where existing data could be projected.

### Issue B: resize regression after `Value -> color`
Starting layout:
- apply `Value -> color` transition

Then:
- collapse filter panel (changes working area width)

Observed problem:
- table could fall back to a stale/totals-only view while color dimension chip stayed active.

---

## 2) MCP evidence collected

Using dashboard 19 and toggling `ТП| Цвет`:
- Request captured: `POST /api/v1/chart/data` (`reqid=92` in one repro).
- Payload contained query set:
  - `pivot_v3|row0|col0`
  - `pivot_v3|row1|col1`
  - `pivot_v3|row1|col0`
  - `pivot_v3|row0|col1`
- `row1|col1` used columns: `["resellerName", "productColor"]`
- `row_limit` in payload: `1000`

Resize symptom seen in MCP:
- after collapsing filters, text snapshot sometimes showed rows reverting to a totals-like view even though `ТП| Цвет` chip remained in columns.

Note on `row_limit=1000`:
- This can truncate high-cardinality intersections.
- It was tracked as a **separate data-volume risk**, not treated as root cause of the resize state desync.

---


### MCP verification update (2026-03-25, later run)

Fresh MCP run on dashboard URL:
- `http://localhost:8088/superset/dashboard/19/?native_filters_key=2wiozeuXkYo`

Captured request/response sequence:
- `POST /api/v1/chart/data` (`reqid=45`): `groupbyColumns=["productColor","__MEASURES__"]`, `pivot_v3|row1|col1` query included `columns=["resellerName","productColor"]`.
- `POST /api/v1/chart/data` (`reqid=46`) after re-toggle/reflow: payload still had `pivotRuntimeLayout.cols=["productColor"]` and `groupbyColumns=["productColor","__MEASURES__"]`.

UI/render state at the same time:
- `ТП| Цвет` chip remained active in layout chips (`Remove dimension` count = 2).
- Table header rendered as `Rows | Total | Продажи в деньгах | Продажи в шт`.
- No exact color headers (for example `Black`, `Blue`, `Red`) were present in header cells.

Interpretation:
- Query payload and runtime layout are already at `row1|col1` (data side correct).
- Render output still collapses to totals-only columns (view side stale/desynced).
- This reinforces Issue B as a frontend state reconciliation failure, not a query-shape failure.


## 3) Theories, code, and outcomes

## Theory 1 (KEPT): fetch decision for first column dimension after leading `Value`
Hypothesis:
- when adding first column dimension with `Value` at index `0`, no fetch should be required if rows are unchanged.

Code touched:
- `src/pivot/layout/shouldFetchForLayoutChange.ts`
- Added helper: `canProjectFirstColumnDimensionWithoutFetch(prev, next)`
- Added early return:
  - if `prev.cols.length===0`, `next.cols.length>0`, `valuePlacement.axis==='col'`, both index `0`, and rows unchanged -> `return false`

Tests added/kept:
- `test/plugin/pivot/layout/shouldFetchForLayoutChange.test.ts`
- Cases kept:
  - returns false for first non-value column dimension after leading Values
  - returns true when inserted before trailing Values (`index=1`)
  - returns true from values-only layout with trailing placement

Result:
- targeted unit tests passed.
- this logic is retained.

---

## Theory 2 (REVERTED): runtime-layout adoption was overriding local committed layout on resize
Hypothesis:
- resize rerender was re-adopting stale runtime layout/tree from props or form data.

Code that was tried (later reverted):
- `src/PivotTableChart.tsx`
- Added/used:
  - `treeHasRuntimeLayoutCoverage(...)`
  - `shouldSyncCommittedTreeFromProps` hardening
  - `shouldAdoptRuntimeLayoutFromProps` gating
  - `pendingPersistedRuntimeLayoutSyncRef` / `lastPersistedRuntimeLayoutRef`
  - altered defer behavior around `valuePlacement` updates
  - passed `preserveTreeOnStaleData` into expansion engine

Representative tests that were used while exploring:
- `interaction-seamless-expansion.test.tsx`
- e.g. `keeps fetched col1 layout on resize when runtime-layout ownState falls back to stale form layout`

Result:
- tests could pass, but live MCP repro still not reliably solved.
- high complexity and low confidence in correctness under real dashboard rerender conditions.
- reverted.

---

## Theory 3 (REVERTED): expansion engine should ignore stale incoming tree on stable layout
Hypothesis:
- expansion engine reinit path accepted incoming stale tree and dropped fetched coverage on resize.

Code that was tried (later reverted):
- `src/pivot/expansion/useExpansionEngine.ts`
- Added/used:
  - `shouldIgnoreIncomingDataForStableLayout(...)`
  - coverage checks comparing incoming tree vs current tree
  - `sourceTree` selection to keep `treeRef.current` in stable-layout stale-data cases
  - additional depth-coverage logic and placeholder-depth experiments

Tests that were created during this branch:
- `test/plugin/pivot/expansion/useExpansionEngine.test.ts`
- included a placeholder-depth case for `__MEASURES__`

Result:
- isolated unit tests passed, but did not prove fix in target MCP scenario.
- exploratory test file and this code branch were reverted.

---

## Theory 4 (REVERTED): blanks were from missing subtotal/parent cell values
Hypothesis:
- blanks after layout change came from missing precomputed cells for parent/total nodes.

Code that was tried (later reverted):
- `src/pivot/chart/usePivotRenderModel.ts`
- Added synthetic aggregation paths:
  - `aggregateMissingCellValues(...)`
  - `ensureGrandTotalRowCells(...)`
  - `ensureCollapsedParentColumnCells(...)`

Tests that were added while exploring:
- `test/plugin/PivotTableChart/metric-tier-layout.test.tsx`
- several `synthesizes missing ... cells` cases

Result:
- did not address the core resize desync symptom.
- reverted.

---

## Theory 5 (REVERTED): dashboard/no-ownState specific integration test
Hypothesis:
- a dashboard-mode test without runtime ownState persistence would reproduce the exact bug.

Code/tests tried (later reverted):
- `interaction-seamless-expansion.test.tsx`
- test: `keeps col1 headers and values after resize in dashboard mode without runtime ownState persistence`

Important note:
- initial failure in that test was partly due to a test regex bug (using `\\d` in the regex class, e.g. `/^-?[\\d,.]+$/`), then corrected.
- after correction, test passed, but it was not a reliable representation of the live failing path.

Result:
- removed as non-authoritative for this bug.

---

## 4) What is currently left in git changes

Current intentional changes for this bug line:
- `src/PivotTableChart.tsx`
- `src/pivot/layout/committedTreeSyncGuard.ts`
- `src/pivot/layout/shouldFetchForLayoutChange.ts`
- `test/plugin/PivotTableChart/interaction-layout.test.tsx`
- `test/plugin/pivot/layout/committedTreeSyncGuard.test.ts`
- `test/plugin/pivot/layout/shouldFetchForLayoutChange.test.ts`

---

## 5) Current status

- Issue A (extra fetch decision path): fixed and covered by `shouldFetchForLayoutChange` tests.
- Issue B (resize regression after `Value -> color`): fixed in current branch.

Residual known risk (separate from Issue B):
- `row_limit=1000` can still truncate high-cardinality intersections by design.

---

## 6) Verification summary

Automated:
- `npm test plugins/plugin-chart-pivot-table-v3` -> pass (`83/83` suites, `598/598` tests).
- New deterministic regression tests for Issue B are passing.

Lint:
- `npx eslint plugins/plugin-chart-pivot-table-v3` still reports pre-existing plugin-wide errors/warnings in files outside this fix.
- Lint on touched Issue B files: no errors (warnings in `PivotTableChart.tsx` are pre-existing).

Manual MCP:
- Repro path validated on dashboard 19 after hot rebuild:
  1. Toggle `ТП| Цвет` column on.
  2. Confirm color headers (`Black`, `Blue`, etc.).
  3. Collapse filter panel (width reflow).
  4. Table stays on color headers; no fallback to totals-only header.

---

## 7) Relevant files

Runtime/layout sync and stale-props protection:
- `src/PivotTableChart.tsx`
- `src/pivot/layout/committedTreeSyncGuard.ts`

Fetch decision for first column dimension after leading `Value`:
- `src/pivot/layout/shouldFetchForLayoutChange.ts`

Coverage:
- `test/plugin/PivotTableChart/interaction-layout.test.tsx`
- `test/plugin/pivot/layout/committedTreeSyncGuard.test.ts`
- `test/plugin/pivot/layout/shouldFetchForLayoutChange.test.ts`

---

## 8) Deterministic regression + fix direction (Issue B)

### Deterministic failing tests (before fix)
Added dashboard-style rerender regressions in:
- `test/plugin/PivotTableChart/interaction-layout.test.tsx`

Critical cases:
- `keeps seamless data after stale dashboard rerender with unchanged query context`
- `keeps seamless data after stale dashboard rerender when only treeDataSignature changes`

Failure mode before fix:
- local seamless update value (`999`) was overwritten by stale props value (`111`) after dashboard rerender/reflow.

### Final fix

1. New committed-tree sync guard module:
- `src/pivot/layout/committedTreeSyncGuard.ts`
- blocks props -> committed-tree sync when:
  - dashboard mode is active,
  - current query-context already has a local sync,
  - incoming tree is a stale coverage regression versus active runtime layout.

2. Query-context scoped lock in chart container:
- `src/PivotTableChart.tsx`
- lock key moved to dashboard query-context signature (not tree-data signature), so tree signature churn cannot unlock stale overwrite.

3. Stale-coverage auto-recovery:
- `src/PivotTableChart.tsx`
- when dashboard rerender lands a tree that loses active layout coverage, trigger one seamless recovery fetch and guard against fetch loops via recovery signature ref.

4. Preserve no-fetch layout commits:
- persisted local runtime-layout updates now also mark local sync for current dashboard query context, so later stale dashboard props do not roll back committed tree.

---

## 9) MCP confirmation after hot rebuild

Date/time: 2026-03-25 (latest run in this thread)

Dashboard:
- `http://localhost:8088/superset/dashboard/19/?native_filters_key=2wiozeuXkYo`

Observed request:
- `POST /api/v1/chart/data` (`reqid=181`)
- query set includes `pivot_v3|row1|col1` with `columns=["resellerName","productColor"]`
- `groupbyColumns=["productColor","__MEASURES__"]`
- payload still carries stale-looking `form_data.pivotRuntimeLayout.cols=[]` (known dashboard payload inconsistency)

Observed UI after collapse:
- `ТП| Цвет` chip stays active.
- Header remains color-expanded (`(NULL)`, `Black`, `Blue`, ...), not totals-only.

Conclusion:
- Issue B repro path is fixed at render/sync layer in this branch, even when request payload still carries stale `pivotRuntimeLayout` form-data fields.
