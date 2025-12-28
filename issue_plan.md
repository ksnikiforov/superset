# Pivot Table v3 totals + multi-metric behavior plan

## Scope and sources
- Requirements: `superset-frontend/plugins/plugin-chart-pivot-table-v3/REQUIREMENTS.md`
- Design details: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/totals_design_doc.md`
- Key implementation files: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/types.ts`

## Test status (from requested run)
Command: `npm test plugins/plugin-chart-pivot-table-v3`

Failures:
- `Pivot Table v3 transformProps propagates rowSubTotals when enabled` (rowSubTotals is forced false).
- `PivotTableChart multi-metric visibility` (metrics not visible under collapsed row/column groups).
- `PivotTableChart totals & subtotals` (row subtotal ordering and positioning).

Non-blocking test harness noise:
- Jest reports duplicate manual mocks (`mockExportObject`, `mockExportString`, `svgrMock`) from `spec/__mocks__` vs `packages/superset-ui-core/__mocks__`.

## Requirements distilled (from design doc)
1) Multi-metric display: when 2+ metrics are selected, the metrics tier is always visible (expanded), even if the parent dimension is collapsed. Metrics appear directly under the collapsed node, with deeper dimensions hidden until expansion.
2) Row subtotals are proper and opt-in, default ON. Inline by default (subtotal values on the parent row). When configured to show at bottom, create explicit subtotal rows and clear parent values. When multiple metrics are selected, force row subtotals to the bottom regardless of the toggle (grand total still obeys UI position).
3) Columns with multi metrics: column subtotals are always at the end of their group, ignoring the subtotal position control. Grand total position is still controlled by the UI.

## Findings and gaps (with code refs)

### 1) rowSubTotals is hard-disabled in transformProps
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts:270-274`

```ts
rowTotals: formData.rowTotals,
colTotals: formData.colTotals,
rowSubTotals: false,
colSubTotals: formData.colSubTotals,
rowSubtotalLevels,
```

Impact: The chart never receives `rowSubTotals: true`, so subtotal rows are always filtered out in the renderer. This directly breaks the `transformProps` test and subtotal rendering.

### 2) Row subtotal levels are not computed for row subtotals
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts:76`

```ts
const rowSubtotalLevels = formData.rowTotals ? [0] : [];
```

Impact: row subtotals are treated as only grand total level (0). There is no support for per-level subtotals or for rowSubTotals default behavior (all levels).

### 3) buildQuery only uses rowTotals, not rowSubTotals or rowSubtotalLevels
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts:112-154`

```ts
const rowLevels = rowTotals ? [0] : [];
const rowDepths = new Set<number>(rowLevels);
rowDepths.add(rowDepthLimit || 0);
```

Impact: queries do not request row subtotals at deeper levels, so true aggregated subtotals are never fetched for rows.

### 4) fetchPivotBranch only uses rowTotals for subtotal depth pairs
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts:398-406`

```ts
const effectiveRowLevels =
  formData.rowTotals && rowDepth >= 0 ? [0] : [];
const subtotalRowDepths = new Set<number>([rowDepth, ...effectiveRowLevels]);
```

Impact: branch fetches never include row subtotal depths beyond 0, so expanding does not request subtotal rows for row hierarchies.

### 5) No row subtotal controls in the control panel
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx:321-433`

Current controls include row totals, column totals, column subtotal levels, column subtotal position, but no row subtotal toggle or row subtotal position.

Impact: row subtotals cannot be configured (default on/off, top/bottom) from the UI.

### 6) rowSubtotalPosition is missing from types
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/types.ts:82-107`

`PivotTableCustomizeProps` includes `rowTotalPosition`, `colTotalPosition`, `colSubtotalPosition`, but not `rowSubtotalPosition`.

Impact: row subtotal position is not typed or carried through, even though tests reference it.

### 7) Row subtotals are not positioned or filtered by rowSubtotalPosition
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:500-559`

```ts
if (!rowSubTotals) {
  filtered = filtered.filter(child => {
    if (!child.isSubtotal || child.path.length === 0) {
      return true;
    }
    const last = child.path[child.path.length - 1];
    if (isSubtotalToken(last)) {
      return false;
    }
    ...
  });
}
```

Impact: when `rowSubTotals` is true, explicit subtotal rows are rendered even when the desired mode is inline (top). This conflicts with the design and the existing tests.

### 8) Multi-metric tier is not forced visible when collapsed
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:500-608`

The current `getRowChildren`/`getColChildren` filtering logic removes metric-tier nodes in collapsed states (based on `metricIndex` and `metricLabelSet`) and relies on standard expand behavior. That conflicts with the requirement: when 2+ metrics are selected, the metric tier must always be visible under collapsed groups.

### 9) Column subtotal placement ignores multi-metric column rule
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:671-736`

```ts
const placeAtFront =
  (dimDepth === 0 ? colTotalPosition : colSubtotalPosition) === 'start';
```

Impact: when metrics are on columns and there are multiple metrics, subtotals should always go to the end, but current logic uses `colSubtotalPosition`.

### 10) applyMetricAxis only adds base cells for single metrics
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts:365-380` and `:456-473`

The base-path value propagation exists only for single metric cases. Multi-metric collapse behavior must be solved in traversal/rendering, not via base cell propagation.

## Behavior decisions captured
- For metrics on columns with multiple metrics, subtotals are forced to the end of their group (ignore colSubtotalPosition). Grand total position still controlled by UI.

## Proposed change plan

### Phase 1: Add missing controls, props, and wiring
1) Control panel
- Add `rowSubTotals` checkbox (default true).
- Add `rowSubtotalPosition` select (start/end, default start).
- Location: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx` near the row/column total controls.

2) Types and prop plumbing
- Add `rowSubtotalPosition?: TotalPosition` to `PivotTableCustomizeProps` and `PivotTableProps` in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/types.ts`.
- Pass through `rowSubTotals` and `rowSubtotalPosition` in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`.

### Phase 2: Row subtotal depth selection and query planning
3) Compute row subtotal levels
- Replace `rowSubtotalLevels = formData.rowTotals ? [0] : []` with a normalized levels helper.
- Suggested behavior: when `rowSubTotals` is true, include all row levels > 0 up to max depth (so row subtotals are “proper” for every level). Always include 0 when `rowTotals` is true.
- Files: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts` and `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`.

4) buildQuery support
- Add row subtotal levels into `rowDepths` in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts`.
- This ensures the initial query set includes row-level aggregates for subtotal display.

5) fetchPivotBranch support
- Use `rowSubtotalLevels` to populate `effectiveRowLevels` in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`.
- This ensures branch expansion fetches include row-level subtotals.

### Phase 3: Row subtotal rendering rules
6) Inline vs bottom subtotal rows
- Inline (default): hide explicit subtotal rows (SUBTOTAL token) in the visible list, but keep the parent row values.
- Bottom: insert explicit subtotal rows after a group’s children, and clear parent row values.
- Multi metrics on rows: force bottom subtotal behavior even if UI chooses top.

Implementation options:
- Option A (data-level): add a helper like `injectRowSubtotalLeaves` into `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts` or `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts` to create explicit subtotal nodes and cells based on parent values.
- Option B (render-level): synthesize subtotal “virtual rows” for display only, by building a visible list that adds subtotal nodes at render time.

Preferred: data-level for consistency with existing column subtotal injection (similar to `injectColumnSubtotalLeaves` in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`).

Pseudocode for injection (data-level):

```ts
// For each parent node with children and row subtotals enabled
// 1) Create subtotal path:
//    - single metric: [...parent.path, SUBTOTAL_TOKEN]
//    - multi metric: [...parent.path, SUBTOTAL_TOKEN, metric]
// 2) Create row node(s) with isSubtotal: true, hasChildren: false
// 3) Copy values from parent cell(s) into subtotal cell(s)
// 4) If rowSubtotalPosition === 'end' or forced-end (multi metrics),
//    clear parent cell values to show blanks
```

### Phase 4: Multi-metric tier visibility
7) Force metric tier visible for 2+ metrics
- Modify `getRowChildren` and `getColChildren` in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx` to surface metric-tier nodes even when the parent is collapsed.
- Logic should:
  - Identify metric tier index.
  - If `metrics.length > 1` and the next tier is metrics, return metric children even if the parent is not expanded.
  - When expanded, return dimension children as usual.

Pseudocode (row side):

```ts
const isMultiMetric = metricsLayout === ROWS && metrics.length > 1;
const metricTierIndex = metricIndexForRows;
const isMetricChild = child => metricLabelSet.has(String(child.path[metricTierIndex]));

if (isMultiMetric && metricTierIndex !== undefined) {
  const metricChildren = children.filter(isMetricChild);
  const dimChildren = children.filter(child => !isMetricChild(child));
  if (!expandedRows.has(parent.key) && metricChildren.length > 0) {
    return metricChildren;
  }
  return dimChildren.length > 0 ? dimChildren : metricChildren;
}
```

Apply similar logic on the column axis to satisfy the “metrics visible under collapsed columns” requirement.

### Phase 5: Column subtotal placement rule for multi metrics on columns
8) Override subtotal placement when metrics are on columns and multiple metrics are selected
- Update `buildColLeavesWithSubtotals` in `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx`.
- If `metricsLayout === COLUMNS` and `metrics.length > 1`, force subtotal position to `end` for non-root subtotal leaves, while still honoring `colTotalPosition` for the root grand total.

### Phase 6: Update and expand tests
9) Test updates
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/transformProps.test.ts`: ensure rowSubTotals is passed through.
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/buildQuery.test.ts`: include row subtotal depth pairs.
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/fetchPivotBranch.test.ts`: ensure row subtotal levels are part of the query depth pairs and result rows.
- `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart.test.tsx`:
  - multi-metric visibility under collapsed rows/columns.
  - row subtotal inline vs bottom.
  - row subtotals forced bottom when multi metrics.
  - column subtotals forced to end when metrics on columns + multi metrics.

## Risks and edge cases
- Metrics placeholder in the middle of a hierarchy (Values between dimensions) changes the expansion model. Ensure the metric auto-visibility logic respects `metricIndex` and does not inadvertently hide real dimension nodes.
- When subtotals are forced to bottom for multi metrics, parent row values should be cleared to avoid duplicates. This must be done carefully to avoid losing grand total values.
- Column subtotal placement override should only apply to non-root subtotal leaves. Root placement should still obey `colTotalPosition`.
- Row subtotal injection should dedupe explicit subtotal nodes if the backend already returns them, to avoid duplicate rows.

## Acceptance checklist
- Multi-metric rows/columns show metric nodes under collapsed groups.
- Row subtotals default to inline (no explicit subtotal rows), and bottom positioning produces explicit subtotal rows.
- Multi-metric rows always show subtotals at the bottom (ignoring the UI toggle), while grand totals still obey position.
- Metrics on columns with multiple metrics always place subtotals at the end, with grand total placement controlled by UI.
- All pivot-table-v3 tests pass (ignoring the existing mock duplication warning).
