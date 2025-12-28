Pivot Table v3 Subtotal Refactor Plan
=====================================

Scope
-----
- Fix fundamental subtotal correctness for pivot table v3 (rows/cols) without post-filtering values.
- Align behavior with Interaction & behavior guide (Excel/Power BI parity) and make failing tests green.
- Preserve lazy branch fetching and metric-axis placement.

Current Failures (from `npm test plugins/plugin-chart-pivot-table-v3`)
----------------------------------------------------------------------
- `PivotTableChart.test.tsx`
  - Line 506: Only grand total column renders for multi-column selection (missing column headers).
  - Line 703: Row subtotal label renders even when row subtotals are disabled.
  - Line 1405: Duplicated ancestor subtotal leaf (`A`) appears alongside branch subtotal headers.
- `PivotTableChart.expand.test.tsx`
  - Line 1608: Row subtotal label appears after column + row expand when row subtotals are disabled.
  - Line 1802: Column subtotal cell empty for expanded row after column expansion.
  - Line 2113: Synthesized row subtotal node shows up across multi-level expand when disabled.

Suspected Root Causes
---------------------
1) `src/fetchPivotBranch.ts` subtotal prefixing:
   - `prefixTreeWithPath` prepends `sanitizedPath` and can append `Subtotal`, yielding duplicated paths (`p` and `p/Subtotal`) even when row subtotals are off. Branch merges then surface synthetic subtotal rows/cols.
   - Depth pairs omit some subtotal combinations; expanding rows after column subtotals doesn’t fetch `(rowDepth, colSubtotalLevel)` slices, leaving subtotal cells blank.
2) UI rendering/filtering (`src/PivotTableChart.tsx`):
   - Row nodes marked `isSubtotal` are rendered even when `rowSubTotals` is false, allowing “Subtotal” rows to appear.
   - Column header leaf builder doesn’t fully suppress redundant ancestor subtotal leaves (e.g., `['A','1-URGENT','A']`) when a branch subtotal exists.
3) Transform fallback (`src/transformProps.ts`):
   - If a multi-column query returns only depth-0 columns, we don’t synthesize the expected column hierarchy, so only “Grand total” shows.

Detailed Plan
-------------
1) Map tests to data flow
   - Keep failing specs open: `PivotTableChart.test.tsx` (lines 439–506, 701–705, 1360–1425) and `PivotTableChart.expand.test.tsx` (lines ~1500–1820, 2100–2115).
   - After each code change, re-run `npm test plugins/plugin-chart-pivot-table-v3`.

2) Fix subtotal fetch/merge at the source (`src/fetchPivotBranch.ts`)
   - Normalize path handling:
     - Avoid double-prefixing: when the query already filters by `path`, don’t re-prepend `sanitizedPath` in `prefixTreeWithPath`. Keep node keys aligned with existing tree (`serializePath(path)`).
     - Gate `appendSubtotalToken`: only create `…/Subtotal` nodes when the corresponding subtotal/total control is enabled for that axis. Never synthesize per-row subtotal nodes when `rowSubTotals` is false (keep grand total when `rowTotals` is true).
   - Expand depth coverage for subtotals:
     - Ensure `depthPairs` includes cross-product of `rowDepth` with `effectiveColLevels` (subtotal + total levels) and `colDepth` with `effectiveRowLevels`, so expanding rows after column subtotals fetches `(rowDepth, colSubtotalLevel)` slices. Add inline comment documenting the subtotal depth cross-product.
   - Merge safety:
     - In `mergeTrees`/`mergeCells` ensure subtotal flags propagate without clobbering existing cell values with undefined slices.
   - Add a targeted test in `test/plugin/fetchPivotBranch.test.ts`:
     - Scenario: expand row with `colSubtotalLevels=[1]`; assert generated queries include `(rowDepth,1)` and merged keys stay `path|subtotalPath` (no duplicated prefixes).

3) Tighten rendering filters (`src/PivotTableChart.tsx`)
   - Row subtotals:
     - Pre-filter row nodes (or within `getRowChildren`) to drop synthetic subtotal nodes (`isSubtotal` with label `Subtotal` or path token `__subtotal__`) when `rowSubTotals` is false. Keep grand total when `rowTotals` is true.
   - Column subtotal leaves:
     - Enhance `buildColLeavesWithSubtotals` duplicate suppression: if an `isSubtotal` leaf’s last label equals an ancestor label or is `Subtotal`, and a branch subtotal exists for that path, omit the redundant leaf. Preserve ordering rules (`colSubtotalPosition`/`colTotalPosition`).
   - Leave metric-tier visibility logic intact; avoid filtering metric nodes.

4) Fallback for shallow column data (`src/transformProps.ts`)
   - After `nextTreeRaw` is built, detect when `groupbyColumns.length > 0` but only root column exists (broken response with depth 0). Synthesize a minimal column hierarchy using `groupbyColumns` order and attach existing cells/values so headers render beyond “Grand total”.
   - Add a regression test in `test/plugin/transformProps.test.ts` for “multi-column selection returns only grand total”.

5) Strengthen UI tests (post-fix)
   - `PivotTableChart.expand.test.tsx`: assert no “Subtotal” row labels when `rowSubTotals` is false; verify column subtotal cells populate for expanded rows; ensure no duplicated ancestor subtotal leaves.
   - `PivotTableChart.test.tsx`: cover duplicate ancestor subtotal suppression and grand-total-only fallback with synthesized headers.

6) Verification
   - Run `npm test plugins/plugin-chart-pivot-table-v3` until all green.
   - Manual spot-check (if time): metrics on columns, `colSubtotalLevels` set; expand columns then rows; confirm subtotal cells populated and no stray “Subtotal” rows.

Key Files to Modify
-------------------
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx`
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts` (merge safety)
- Tests: `test/plugin/fetchPivotBranch.test.ts`, `test/plugin/PivotTableChart.test.tsx`, `test/plugin/PivotTableChart.expand.test.tsx`, `test/plugin/transformProps.test.ts`
