# Pivot Table v3: Excel Export (As-Is)

## Goal
- Pivot Table v3 export should download exactly what the user sees.
- No extra backend query is allowed during export.
- CSV export options stay available for Pivot Table v3.

## User-facing behavior
- In Explore and Dashboard:
  - For `pivot_table_v3`, the Download menu exposes `Export to Excel` (DOM export).
  - CSV entries remain available.
- Export scope:
  - Current visible table state only (current expansions/collapses, totals, formatting labels).
  - What is visible in the rendered pivot table is what gets exported.

## Export pipeline
1. User clicks `Download -> Export to Excel`.
2. UI calls `exportPivotExcel()` with a Pivot v3 table selector (`.pivot-v3-table`).
3. Export uses the rendered HTML table as source (`xlsx.utils.table_to_book`).
4. Workbook is saved with `writeFile`.

## Hierarchy and layout preservation
- Row hierarchy indentation:
  - Row depth is exposed via `data-pivot-row-depth`.
  - Export applies Excel cell alignment indentation (`alignment.indent`) on row header cells based on row depth.
  - Source DOM text is not mutated.
- Column hierarchy:
  - Header `rowSpan/colSpan` from the rendered table is preserved for export input.
  - This allows Excel merge regions to follow the displayed column hierarchy.

## Implementation notes
- Pivot v3 table now includes stable selector classes:
  - `pivot-v3-table` for v3-specific targeting.
  - `pvtTable` retained for compatibility.
- Export utility:
  - `superset-frontend/src/utils/downloadAsPivotExcel.ts`
- Dashboard menu wiring:
  - `superset-frontend/src/dashboard/components/SliceHeaderControls/index.tsx`
- Explore menu wiring:
  - `superset-frontend/src/explore/components/useExploreAdditionalActionsMenu/index.jsx`
- Pivot table render metadata:
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/pivot/render/PivotTableView.tsx`

## Tests
- Dashboard menu behavior:
  - `superset-frontend/src/dashboard/components/SliceHeaderControls/SliceHeaderControls.test.tsx`
- Explore menu behavior:
  - `superset-frontend/src/explore/components/ExploreChartHeader/ExploreChartHeader.test.tsx`
- Pivot view selector:
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/render/PivotTableView.test.tsx`
- Export utility behavior:
  - `superset-frontend/src/utils/downloadAsPivotExcel.test.ts`
