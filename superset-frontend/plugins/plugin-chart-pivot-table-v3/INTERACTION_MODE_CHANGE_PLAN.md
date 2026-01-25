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
