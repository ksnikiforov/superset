## Pivot Table v3 Requirements

This document summarizes the functional requirements gathered from user feedback and where they are implemented (or still pending) in the current code.

### Data fetching & correctness
- **DB-accurate totals/subtotals (incl. count distinct):** Pivot fetches per-depth aggregates from the database. Multi-depth queries are built (`buildQuery.ts`), branch fetches are supported (`fetchPivotBranch.ts`), and results are merged into a tree (`transformProps.ts` + `buildTreeFromRecords` in `utils.ts`).
- **Lazy expansion with collapsed start:** Loads collapsed, fetching deeper data only on expand (`PivotTableChart.tsx` `handleToggle` + `fetchPivotBranch`).
- **Full-depth fallback when query metadata is missing:** If `query_name` is absent but data exists, infer full groupby depth to populate the tree (`transformProps.ts`).
- **Branch cache with auto reuse:** Fetched branches are cached; re-expanding uses cached data instantly (`fetchPivotBranch.ts` + cache peek in `PivotTableChart.tsx`).
- **Configurable fetch depth:** `maxDepthPerFetch` controls branch fetch depth; default pulls all remaining levels (`fetchPivotBranch.ts`).

### Hierarchy & expansion UX
- **Start collapsed with expand toggles:** Root only expanded; children show toggles. Initial expansion respects `initialDepth`; optional column auto-expand (`autoExpandColumns`) expands all column levels on load (`PivotTableChart.tsx`).
- **Hierarchy nodes created for all levels:** Intermediate nodes are built so multi-level hierarchies can expand beyond depth 2 (`buildTreeFromRecords`).
- **Column headers render top-to-bottom hierarchy:** Column headers are stacked with row/col spans, reflecting depth instead of flat indentation (`PivotTableChart.tsx`).

### Metrics placement & values
- **Metrics as their own tier in the hierarchy:** Metrics are projected into row/col headers (depending on layout) instead of being combined in a single cell (`applyMetricAxis` in `utils.ts`, invoked from `transformProps.ts`).
- **Draggable metrics placeholder (“Σ Values”):** Selecting a metric injects a non-removable “Σ Values” placeholder into Rows/Columns controls; it is draggable across/within hierarchies to place the metrics tier where desired (`controlPanel.tsx`, placeholder metadata in `utils.ts`, placement handled in `transformProps.ts`/`applyMetricAxis`).
- **Correct metric selection per cell:** Cell rendering derives the metric key from the metric tier node; optional user-selected fallback resolves metric collisions (`deriveMetricKey` in `PivotTableChart.tsx`, `metricConflictFallback` control).
- **Multiple metrics as separate headers:** Each metric produces its own header node; cells display a single metric’s value (`applyMetricAxis`, `renderCellContent`).

### Drag & drop behavior (current)
- **Metrics placeholder dedupe & move:** Resolver ensures only one `__MEASURES__` lives across axes; cross-axis drops dispatch both axes in sync (control panel + DnD plumbing). Metrics move without duplication; backend/query alignment uses the same resolver.
- **Dimensions move instead of copy:** Non-measure fields are deduped across axes on drop so they move between Rows/Columns rather than copying.
- **Ordering gap:** Cross-axis drops currently append when hover index isn’t captured reliably (no preview). Further work needed to compute insert index from pointer position for consistent placement.

### Totals behavior
- **No column total when there is no column hierarchy:** Root column node is suppressed when no column groupbys, avoiding an extra “Total” column (`buildTreeFromRecords`, `visibleCols` filter in `PivotTableChart.tsx`).
- **Column totals only when columns exist; ordering follows hierarchy:** Totals appear only when column hierarchy exists; ordering follows hierarchy → metrics → totals (column root suppressed when empty). Row totals suppressed when no row totals selected.

### Sorting
- **Type-aware sorting of headers:** Sorting uses column type metadata to sort numeric/temporal values correctly (`sortByOrder`/`compareValues` in `PivotTableChart.tsx`, type map built in `transformProps.ts`).

### Branch fetching depth
- **Configurable per-fetch depth:** If `maxDepthPerFetch` is unset, branch fetches pull all remaining levels; otherwise they respect the configured depth (`fetchPivotBranch.ts`).

### Known gaps / TODOs
- Solidify metrics placeholder styling/affordance in the control panel to ensure visibility across all Explore themes.
- Align totals ordering for complex layouts (metrics on rows + row totals) and verify deep hierarchy totals.
- Add comprehensive tests for column header stacking and metric conflict fallback behavior.

### Key file references
- Query construction: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts`
- Branch fetching: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`
- Data shaping & type map: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`
- Tree building & metric axis projection: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts`
- Rendering, expansion, sorting, cell metrics: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx`
