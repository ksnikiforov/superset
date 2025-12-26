## Pivot Table v3 Requirements

This document summarizes the functional requirements gathered from user feedback and where they are implemented (or still pending) in the current code.

### Data fetching & correctness
- **DB-accurate totals/subtotals (incl. count distinct):** Pivot must fetch per-depth aggregates from the database instead of client-side recomputation. Queries are built for multiple depths (`buildQuery.ts`) and branch fetches are supported (`fetchPivotBranch.ts`), then merged into a tree (`transformProps.ts` + `buildTreeFromRecords` in `utils.ts`).
- **Lazy expansion with collapsed start:** Chart should load in a collapsed state and only fetch deeper data when a branch is expanded. Expansion state and branch fetching are handled in `PivotTableChart.tsx` (`handleToggle`, `fetchPivotBranch`).
- **Full-depth fallback when query metadata is missing:** If `query_name` is absent but data exists, infer full groupby depth to populate the tree (`transformProps.ts`).

### Hierarchy & expansion UX
- **Start collapsed with expand toggles:** Only root is expanded initially; children show plus icons. Controlled in `PivotTableChart.tsx` (initial `expandedRows/expandedCols` seed).
- **Hierarchy nodes created for all levels:** Intermediate nodes are built so multi-level hierarchies can expand beyond depth 2 (`buildTreeFromRecords` in `utils.ts`).
- **Indented headers by depth:** Visual indentation reflects hierarchy depth (`PivotTableChart.tsx` header rendering).

### Metrics placement & values
- **Metrics as their own tier in the hierarchy:** Metrics are projected into row/col headers (depending on metrics layout) instead of being combined inside a single cell (`applyMetricAxis` in `utils.ts`, invoked from `transformProps.ts`).
- **Correct metric selection per cell:** Cell rendering derives the metric key from the metric tier node, not defaulting to the first metric (`deriveMetricKey` in `PivotTableChart.tsx`).
- **Multiple metrics show as separate headers, not combined values:** Each metric produces its own header node; cells display a single metric’s value (`applyMetricAxis`, `renderCellContent`).
- **Pending:** Drag-and-drop “Measures” virtual field to control where the metrics tier sits (rows/cols and relative position) is not yet implemented; current behavior appends metrics at the end of the chosen axis.
Here is how the desired behavoiur should look like - dummy column selection in UI, which becomes present when at least one measure is selected. It is dragable to columns, rows, and between columns and rows (not to measures). So lets say we have
rows: segment -> nation
cols:
measures:

Then as soon as we select a measure, new dummy "measures" field appears in columns
rows: segment -> nation
columns: measures
measures: orderCount

And it is draggable like so (even between hierarchy levels. This case has to be handled accordingly)
rows: segment -> measures -> nation
columns:
measures: orderCount

This is a crucial requiremnt and the whole project depends on getting this right.

### Totals behavior
- **No column total when there is no column hierarchy:** Root column node is suppressed if there are no column groupbys, avoiding an extra “Total” column (`buildTreeFromRecords` guard in `utils.ts`, `visibleCols` filter in `PivotTableChart.tsx`).
- **Column totals only when columns exist; totals should follow hierarchy:** When columns exist, totals belong after the column hierarchy (and after metrics when metrics are on columns). Current code ensures totals only appear when a column hierarchy exists; further ordering refinement may be needed.

### Sorting
- **Type-aware sorting of headers:** Sorting uses column type metadata to sort numeric and temporal values correctly instead of lexicographically (`sortByOrder`/`compareValues` in `PivotTableChart.tsx`, type map built in `transformProps.ts`).

### Branch fetching depth
- **Configurable per-fetch depth with sensible default:** If `maxDepthPerFetch` is unset, branch fetches pull all remaining levels; otherwise they respect the configured depth (`fetchPivotBranch.ts`).

### Known gaps / TODOs
- Implement the draggable “Measures” placeholder in the control panel to allow explicit placement and ordering of the metrics tier within rows/columns.
- Ensure totals ordering precisely follows: column hierarchy → metrics tier → totals (when columns exist); row totals alignment when metrics on rows.
- Validate metrics rendering for deep hierarchies after measure placement control is added.

### Key file references
- Query construction: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts`
- Branch fetching: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`
- Data shaping & type map: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`
- Tree building & metric axis projection: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts`
- Rendering, expansion, sorting, cell metrics: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx`
