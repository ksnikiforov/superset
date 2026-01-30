# Pivot Table v3 — Interaction Mode + Metric Label Fix (Change Plan)

## Context
This plan covers two items, in order:
1) Fix existing UI bug where pivot headers show **metric keys** instead of **metric labels**.
2) Implement **Interaction mode** (User controlled) with the clarified UX and persistence constraints.

**Requirement:** All changes must be compatible with chart persistence goals from `REFACTOR_PLAN.md` (no breaking changes to persisted state, and all new persisted state must be stable and versionable).

---

## Guiding Constraints
- **TDD required**: add/adjust tests before implementation and keep coverage for all new behavior.
- **No new JS files**; TypeScript only.
- **No `any`** types.
- **Use @superset-ui/core/components** for UI components.
- **Avoid custom CSS**; rely on antd tokens and existing theming.
- **Persistence safety**: runtime layout stored in `ownState`/hidden control must be versioned, stable, and tolerates missing fields.
- **Quality gate after each significant part**: run and pass
  - `npm run test -- plugins/plugin-chart-pivot-table-v3`
  - `npm run lint` from `superset-frontend/plugins/plugin-chart-pivot-table-v3`

---

## Part A — Fix metric label rendering (must land first)

**Status:** implemented; tests green.  
**Quality gate (this part):**
- `npm run test -- plugins/plugin-chart-pivot-table-v3` ✅ (warnings: duplicate Jest mocks, browserslist stale, babel deprecation).
- `npm run lint -- plugins/plugin-chart-pivot-table-v3` ⏱️ timed out after 120s (eslint scans whole repo).

### Problem
Pivot headers (metric tier) display **metric key** instead of **metric label**.

### Desired behavior
- Wherever the metric label is shown to users (headers, chip labels, tooltips), use **metric label**.
- Internally, keep **metric key** for query identity, formatting maps, and data lookups.

### Plan
1) **Add tests (first)**
   - Add unit test in `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/render/` or `.../pivot/`:
     - Build a render model with metrics that have different `metric_name` vs `label`/`verbose_name`.
     - Assert header labels use label (not key).
   - Add unit test in `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/utils.test.ts` (or similar):
     - Verify the new label resolver returns labels, but keeps metric keys for data access.

2) **Implementation**
   - Introduce a **metric label map** in layout context (key -> label).
   - Update `getMetricLabelFromPath` usage to resolve label via that map.
   - Ensure decode token -> key -> label flow is preserved:
     - Token uses **key**; label is only for display.
   - Confirm formatting and databar logic still uses keys (no change).

3) **Update tests**
   - Ensure formatting/metric mapping tests still pass.
   - Add regression test for measure leaf labels (ensure leaf labels still show, base metric label is correct).

### Acceptance
- Metric tier headers display labels in both row and column layouts.
- No regression in metric formatting or query results.

---

## Part B — Interaction Mode (User controlled)

**Status:** in progress (panel + chip strips + filter dropdown + tests added).

**Completed so far**
- Interaction panel (measures dropdown with deferred commit, comparisons chips, dimensions row/col toggles).
- Chip strips outside the table (top + left) with close [x] on dimension chips.
- Filter icon dropdown (multi-select) per dimension; applies data mask filters.
- Custom ordered toggles (numbers inside) + smaller chip styling + Value chip variant.
- UI state is now optimistic (panel updates without waiting for query refresh).
- Resolver + control panel plumbing in place.
- Tests: runtime resolver + interaction panel coverage.
- Table layout now re-renders in user-controlled mode for UI-driven measure reordering without changing fixed-mode behavior.
- New test: interaction-mode measure reorder updates the header order (no requery).
- Filters keyed by stable column key; clear-all filters control added.
- Vertical chip labels flipped + close button positioned opposite.
- Measures dropdown now scrolls to show full list.
- Comparison leaf selection order persisted; value leaf can be disabled (metrics removed).
- Dashboard-only Apply button gates runtime layout updates.
- Chip strip spacing tightened; vertical chips narrowed with end-aligned close buttons.
- Table rendering now uses **applied/query layout** (UI-only changes no longer re-shape totals/hierarchy before a data refresh).
- New interaction layout test covers multi-metric Value leaf headers (user-controlled mode) and asserts no expand toggles when metrics are last on columns.
- Metrics-at-end detection now uses dimension counts (placeholder-safe) to avoid false expand toggles on Value headers.
- New test ensures applied query form data drives table header hierarchy when UI runtime layout differs.
- Removed forced column-header padding that created empty trailing header rows; header depth now follows the resolved display paths.
- Updated `buildColumnHeaderRows` test to assert deepest path length (no extra empty header rows).
- Added interaction-layout test covering row totals so metric-only totals do not interleave with column dimensions.
- Added assertions that total headers collapse per metric (colSpan aligns with leaf count).
- Updated metric grand total detection to treat metric + leaf totals as grand totals.
- Adjusted column display paths for metric grand totals (metrics-at-end) to keep totals above metric/leaf tiers.
- Column header labels now resolve measure leaf tokens to leaf labels (no `__mleaf__` in headers), with regression coverage.
- Drag-and-drop layout helpers (`applyDimensionDrag`/`applyValueDrag`) with unit tests.
- Chip strips now accept drops to reorder/move dimensions; Value chip is draggable between axes.
- Dimension list now exposes a drag handle for cross-axis moves.
- Pivot tests now render with a DnD provider via `test/testUtils` to keep DnD hooks stable.
- Added end-of-strip drop zones so dimensions can be dropped at the end without precision issues.
- Dragging a dimension to the end is now explicit: default insertions keep Value last, but explicit drops can place a dimension after Value; tests cover both cases.
- Drag preview layer is isolated in a memoized component to avoid re-rendering the full chart on pointer moves (reduces DnD lag).
- Fixed duplicate metric headers when measure leaves are visible with row totals (no column dimensions); new interaction-layout regression test added.
- Ensured metric label map is injected before layout/tree building so headers consistently use metric labels (transformProps regression test added).
- Dimension checkbox selection now inserts by dimension list order even when Value sits mid-stack; regression test added.
- Re-adding a dimension keeps Value placement stable (no unintended Value shift); regression test added.
- Checkbox selection now appends dimensions to the end of the axis (click order), while keeping Value last when it is last.

**Quality gate (latest run)**
- `npm run test -- plugins/plugin-chart-pivot-table-v3` ✅ (warnings: duplicate Jest mocks, browserslist stale, babel deprecation).
- `npm run lint -- plugins/plugin-chart-pivot-table-v3` ❌ blocked by unrelated `plugins/plugin-chart-echarts/src/Gantt/transformProps.ts` import/no-unresolved.

**Still pending / needs follow-up**
- Filter values source (currently derived from tree; consider async values for large domains).

### Summary of behavior (final UX)
- **Explore controls**: Rows + Columns are replaced by a single **Dimensions** list.
- **User controlled mode** allows only preselected **Dimensions** and **Measures** (no dataset-wide selection).
- Conditional formatting **remains active** (no disable toggle in interactive UI).
- **Chip strips** are **outside the table**: left strip between panel and table, top strip above table.
- Chip strips are **tab-like** (no scroll, shrink-to-fit, hover tooltip).
- Custom measure leaves are **allowed** and appear as chips.
- Switching back to Fixed mode: **default all dimensions to Rows**.

### Data model additions
- `interactionMode: 'fixed' | 'user_controlled'` (string literal).
- `pivotRuntimeLayout` (persisted in Explore + ownState):
  ```ts
  export type PivotRuntimeLayout = {
    version: 1;
    rows: string[];            // dimension keys
    cols: string[];            // dimension keys
    metrics: string[];         // ordered metric keys
    leafSelection: Record<string, boolean>; // leafId -> enabled
    valuePlacement: { axis: 'row' | 'col'; index: number };
    lastMoved?: 'row' | 'col';
  };
  ```
- Store **dimension keys** using `getStableColumnKey()` for persistence stability.

### New/updated UX components
- **Interaction Mode control** (radio): Fixed | User controlled.
- **Dimensions control**: DnD selector for preselected dimensions only.
- **Measures dropdown**: numbered checkboxes (order), commit on close.
- **Leaf chips**: Value / IX / 1YA / custom leaves.
- **Dimension list**: row/col toggle checkboxes + filter icon.
- **Chip strips**: top and left, outside the table, tabs-like compression.

### Persistence considerations
- `pivotRuntimeLayout` must be stored in:
  - **Explore**: `setControlValue('pivotRuntimeLayout', ...)`
  - **Dashboard / embedded**: `setDataMask({ ownState: { pivotRuntimeLayout } })`
- Must tolerate missing or older versions (coercion step).
- Layout signature should include runtime layout to keep expansion persistence correct.

---

## Implementation Plan (TDD order)

### 1) Add tests for interaction mode data resolution
- Unit tests in `test/plugin/pivot/layout/` or `test/plugin/utils.test.ts`:
  - Runtime layout -> effective `groupbyRows`/`groupbyColumns` and metric order.
  - Value placement insertion rule (before/after Value).
  - Leaf selection filtering (disabled leafs removed from query metrics).
  - Switching back to Fixed defaults to all rows.

### 2) Add form controls and runtime layout storage
- `controlPanel.tsx`:
  - Add `interactionMode` control.
  - Replace `groupbyRows` + `groupbyColumns` with `dimensions` control when in user-controlled mode.
  - Add hidden `pivotRuntimeLayout` control.

### 3) Runtime layout resolver (core logic)
- New helper in `src/pivot/layout/resolveRuntimeLayout.ts`:
  - Inputs: `formData`, `ownState`, `datasource`, `interactionMode`.
  - Outputs: effective layout spec for `buildLayoutContext`.
  - Coerce missing values and enforce minimum selections.

### 4) Render integration
- In `transformProps.ts`, use effective layout when `interactionMode === 'user_controlled'`.
- Ensure layout signature includes runtime layout to avoid mismatched expansions.

### 5) UI components
- Build interaction panel and chip strips under `src/pivot/chart/`.
- Tests:
  - Measure selection ordering and commit-on-close.
  - Row/col toggle exclusivity.
  - Chip strip shrink-to-fit behavior (text truncation + tooltip).

### 6) Filter dropdown integration
- Use standard filter control behavior for dimension list filter icon.
- Test: selecting filter updates data mask and triggers correct extra form data.

### 7) Docs & snapshots
- Update plugin README or add short section in `REFACTOR_PLAN.md` addendum.

---

## Test Checklist
- **Metric label fix**: header labels and leaf labels use correct display label.
- **Totals + leaf stack**: `Total <metric>` headers flow directly to leaf labels (no repeated metric label tier).
- **Totals toggles**: no expand/collapse toggle appears on `Total <metric>` headers.
- **Runtime layout resolution**: row/col order, value placement rule, leaf toggles.
- **Persistence**: runtime layout stored and re-applied after refresh.
- **User controlled UI**:
  - Measure dropdown ordering numbers.
  - Commit on close (no updates while open).
  - Chip strips external positioning and tab behavior.

---

## Rollout Notes
- Ship metric label fix first (isolated, low risk).
- Then add interaction mode behind explicit control.
- Ensure any new persisted state is versioned and backward compatible.
