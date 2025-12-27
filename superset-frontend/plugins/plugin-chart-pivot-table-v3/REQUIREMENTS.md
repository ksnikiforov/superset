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
- **Draggable metrics placeholder (“Σ Values”):** Selecting a metric injects a non-removable “Σ Values” placeholder into Rows/Columns controls; it is draggable across/within hierarchies to place the metrics tier where desired (`controlPanel.tsx`, placeholder metadata in `utils.ts`, placement handled in `transformProps.ts`/`applyMetricAxis`). The placeholder is styled inline with a small “Fixed” badge and no delete affordance to signal it cannot be removed from the layout.
- **Correct metric selection per cell:** Cell rendering derives the metric key from the metric tier node; optional user-selected fallback resolves metric collisions (`deriveMetricKey` in `PivotTableChart.tsx`, `metricConflictFallback` control).
- **Multiple metrics as separate headers:** Each metric produces its own header node; cells display a single metric’s value (`applyMetricAxis`, `renderCellContent`).

### Drag & drop behavior (current)
- **Metrics placeholder dedupe & move:** Resolver ensures only one `__MEASURES__` lives across axes; cross-axis drops dispatch both axes in sync (control panel + DnD plumbing). Metrics move without duplication; backend/query alignment uses the same resolver. Placeholder DnD logic lives entirely in the plugin control (no global Explore overrides).
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

### Interaction & behavior guide (expected)
- **Layout resolution:** The “Σ Values” placeholder is resolved into the target axis at a specific index (`resolveMetricPlacement` → `transformProps.ts`), producing an ordered list of row/col groupbys and a metrics axis. Only one placeholder exists across axes; cross-axis moves update both controls. _Coverage: missing._
- **Initial render (collapsed):** Build queries for the initial visible depths (respecting `initialDepth`, metrics placement, and selected totals/subtotals). Render only top-level row/col nodes. If metrics are on columns (or rows) and there is exactly one metric, also surface the metric value at the base axis key so cells are populated without expanding. _Coverage: `buildQuery.test.ts` (query depth when collapsed), `src/utils.test.ts` (single-metric propagation), `test/plugin/utils.test.ts` (metric-first column propagation)._
- **Expand rows:** Clicking “+” on a row should fetch the next row depth only (plus any selected subtotal depths), merged into the tree, and the visible traversal should progress through the dimension levels before showing metrics. Example expected path with `rows: [r1, r2], columns: [Values, c1], metrics: [m1]`: `r1 → r2` (metrics on columns stay off the row hierarchy). _Coverage: `PivotTableChart.expand.test.tsx` (metrics on columns, metric-first column toggle then row expand), `fetchPivotBranch.test.ts` (depth alignment)._
- **Expand columns:** Clicking “+” on a column should fetch the next column depth (plus selected subtotal depths) with row depth limited to what is currently rendered. Example with `rows: [r1], columns: [Values, c1], metrics: [m1]`: expanding a column shows metric headers/values; row depth should not be forced deeper. _Coverage: partial via `fetchPivotBranch.test.ts` (metric-first column expansion); UI coverage missing._
- **Single metric at the bottom:** When only one metric is selected and Values is the last level on an axis, suppress the extra metric header row/column while keeping values visible. _Coverage: `PivotTableChart.test.tsx` (metric tier suppression), `src/utils.test.ts` (collapsed cell propagation)._
- **Metric-first column/row propagation:** When metrics are first on an axis and only one metric is selected, base row/column cells and the metric root should still carry values so collapsed/expanded toggles preserve data. _Coverage: `test/plugin/utils.test.ts` (metric-first columns), `src/utils.test.ts` (branch merge with metric-first columns)._
- **Totals/subtotals:** Level-aware selections (arrays) define which depths to request. Initial load queries only visible depths + selected totals/subtotals; branch fetches request the same depth pairs when expanding. _Coverage: `buildQuery.test.ts` (multi-query when totals/collapse); deeper totals rendering coverage missing._
- **Drag & drop:** Placeholder is deduped across axes; drag should not throw; cross-axis drops update both controls and rerun placement. Keys are stable to avoid react-dnd target invalidation. _Coverage: missing._

### Current bugs to fix
- **Row expansion skips last dimension when metrics are on columns:** With `rows: [r1, r2]`, `columns: [Values, c1]`, `metrics: [m1]`, expansion still goes `r1 → Value` instead of `r1 → r2`. Suspected areas: `PivotTableChart.tsx` (`getRowChildren`, `buildVisibleList`, `hasLoadedChildren`) and row-depth alignment in `fetchPivotBranch.ts` (context resolver). Metric filtering may be hiding the `r2` node before it is fetched.
- **Metric tier suppression vs. expand:** Hiding the metric tier for single-metric cases must not suppress the needed row/col depth. Filtering in `getRowChildren`/`getColChildren` should coexist with branch fetching so dimension nodes still materialize; verify branch depth calculation (`resolveFetchContext` in `fetchPivotBranch.ts`) respects current visible depth when metrics are on the opposite axis.

### Key file references
- Query construction: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts`
- Branch fetching: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`
- Data shaping & type map: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`
- Tree building & metric axis projection: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts`
- Rendering, expansion, sorting, cell metrics: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx`
