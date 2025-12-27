## Pivot Table v3 – Outstanding Issues

### UI and data gaps discovered (totals/subtotals)

1) **Grand total label**  
   - Requirement: display “Grand total” for totals. Currently labels come from node.formattedLabel. A temporary UI mapping was added in `PivotTableChart.tsx` (see `formatLabel`) but the underlying node labels remain `"Total"`; consider updating tree construction if the source label must change.  
   - Snippet: `src/PivotTableChart.tsx` -> `const formatLabel = useCallback(... node.level === 0 ? t('Grand total') ...);`

2) **Grand total intersection blank / incorrect**  
   - Symptom: cell at grand-total rows x grand-total columns is empty or carries an incorrect value.  
   - Context: `buildTreeFromRecords` seeds `tree.cells['|']` with `rowRoot.values || colRoot.values` when available. If totals come from separate queries or don’t aggregate both axes, the intersection is wrong. Need a deterministic way to populate/sum the grand-total cell from total queries.  
   - Snippet: `src/utils.ts` near end of `buildTreeFromRecords`.

3) **Row subtotal selector still effectively single-value / should be totals-only**  
   - Requirement: rows support only grand totals (no per-level subtotals); selector should be a simple toggle. Control panel now exposes `rowTotals` as a checkbox and removes the row subtotal multi-select, but form data still carries `rowSubtotalLevels` and related normalization may ignore user expectations. Verify Explore UI shows a checkbox, not a multi-select, and remove stale schema if needed.  
   - Snippet: `src/controlPanel.tsx` rows under “Options”.

4) **Column subtotal selector appears single-select in UI**  
   - Requirement: multi-select for column subtotal levels. Control config is `multiple: true`, but UI still behaves like single-select. Investigate the SelectControl props/state plumbing; see `src/controlPanel.tsx` `colSubtotalLevels`.

5) **Column subtotals not rendering**  
   - Symptom: even with levels selected, subtotal columns do not appear. Rendering currently inserts subtotal nodes when `node.isSubtotal` and `(colTotals || selected levels || colSubTotals)` are true. If the server returns subtotal records at fewer depths, verify queries include those depth pairs and that nodes/cells are built.  
   - Snippet: `src/PivotTableChart.tsx` `buildColLeavesWithSubtotals`; fetch depth pairs in `src/fetchPivotBranch.ts` (`effectiveColLevels`).

6) **Column totals & subtotals control should exclude total level and support “Select all”**  
   - Requirement: level picker should list only subtotal levels (>=1); grand total already has its own toggle. Add “Select all” so users can quickly reselect after level changes. UI currently shows level 0 and lacks select-all.  
   - Snippet: `src/controlPanel.tsx` under `colSubtotalLevels` options builder.

7) **Legacy/irrelevant controls in Customize tab**  
   - Aggregation function, metrics layout (“Apply metrics on”), and similar legacy controls may no longer apply to v3 totals/subtotals behavior. Audit and hide/remove irrelevant options to reduce confusion.  
   - Files: `src/controlPanel.tsx` and any dependent formData plumbing.

Notes for next iteration:
- Update labels at the data level if consistent “Grand total” strings are required in nodes/tests.
- Ensure a consistent total record is present (or computed) so `tree.cells['|']` is always populated correctly when either row/column totals are enabled.
- Validate SelectControl behavior in Explore to confirm multi-select UX for column subtotal levels; adjust control props or upstream component if necessary.
