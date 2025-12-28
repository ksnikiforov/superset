# Pivot Table v3 totals + multi-metric behavior plan

## Scope and sources
- Requirements: `superset-frontend/plugins/plugin-chart-pivot-table-v3/REQUIREMENTS.md`
- Design details: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/totals_design_doc.md`
- Key implementation files: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/types.ts`

## Test status (latest run)
Command: `npm test plugins/plugin-chart-pivot-table-v3`

Failing behaviors (tests):
- Metric tier indentation and toggles:
  - `indents metric rows deeper than shipMode when metrics are last on rows`.
  - `suppresses orderPriority toggle when metrics are between dimensions`.
- Row subtotal placement:
  - `keeps row subtotal values inline and suppresses subtotal rows when expanded at top position (multi-metric columns)`.
  - `keeps row subtotal values inline while collapsed when rowSubtotalPosition is end (multi-metric columns)`.
- Grand totals / subtotals for metrics:
  - `renders metric-specific column grand totals when metrics are on columns`.
  - `renders metric-specific row grand totals when metrics are on rows`.
  - `does not render metric total headers when metrics are the first column level`.
  - `does not render metric total rows when metrics are the first row level`.
  - `renders metric-specific column grand totals when metrics are nested at depth 2`.
  - `renders metric-specific column grand totals when metrics are nested at depth 3`.
  - `renders metric-specific column subtotals even when they match grand totals`.

Non-blocking test harness noise:
- Jest duplicate manual mocks (`mockExportObject`, `mockExportString`, `svgrMock`) from `spec/__mocks__` vs `packages/superset-ui-core/__mocks__`.
- Browserslist data out-of-date warnings.

## Requirements distilled (from design doc + follow-ups)
1) Multi-metric display: when 2+ metrics are selected, the metrics tier is always visible (expanded), even if the parent dimension is collapsed. Metrics appear directly under the collapsed node, with deeper dimensions hidden until expansion.
2) Row subtotals are opt-in, default ON. Inline by default (subtotal values on the parent row). When configured to show at bottom, create explicit subtotal rows and clear parent values. When multiple metrics are selected, force row subtotals to the bottom regardless of the toggle (grand total still obeys UI position).
3) Columns with multi metrics: column subtotals are always at the end of their group, ignoring the subtotal position control. Grand total position is still controlled by the UI.
4) Metric totals labeling rules:
   - When metrics are **not** the top level (e.g., metrics at depth 2 or 3), column grand totals should show `Total <metric>` headers and values.
   - Column subtotals should show `<group> <metric>` labels even if those values match the grand totals.
   - When metrics are already the top level (Values first), **do not** render extra `Total <metric>` headers/rows; the top level already represents grand totals.

## Fixed/implemented items (verify in code)
- Row subtotal controls and positions are wired:
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx:336-375`
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/types.ts:104-184`
- Row subtotal levels normalized and propagated:
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts:64-106`
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/buildQuery.ts:102-154`
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/fetchPivotBranch.ts:86-170`
- Multi-metric tier visibility under collapsed groups works for the basic cases (existing tests pass).
- Column subtotal placement forces `end` when metrics are on columns and multiple metrics are selected:
  - `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/PivotTableChart.tsx:707-736`

## Behavior decisions captured
- For metrics on columns with multiple metrics, subtotals are forced to the end of their group (ignore colSubtotalPosition). Grand total position still controlled by UI.
- Metric totals labeling is required at deeper metric tiers (depth 2/3) when column totals are enabled; metrics-first layouts should not add extra `Total <metric>` headers/rows.

## Unaddressed issues (needs fixes)
1) Row subtotal rendering rules still incorrect
- Top position should suppress explicit subtotal rows (inline values) but `1-URGENT Total` still renders.
- Bottom position should keep parent values visible until expansion, but values are blank while collapsed.
- Tests:
  - `keeps row subtotal values inline and suppresses subtotal rows when expanded at top position (multi-metric columns)`.
  - `keeps row subtotal values inline while collapsed when rowSubtotalPosition is end (multi-metric columns)`.

2) Metric tier indentation + toggles when metrics are last or between dimensions
- Metrics at end should indent deeper than the last dimension; current indentation is flat.
- Metrics between dimensions should receive the toggle; the parent dimension should not.
- Tests:
  - `indents metric rows deeper than shipMode when metrics are last on rows`.
  - `suppresses orderPriority toggle when metrics are between dimensions`.

3) Metric totals and subtotals labeling on columns
- With column totals enabled, `Total <metric>` headers should appear even when metrics are nested at depth 2/3.
- With column subtotals enabled, `<group> <metric>` headers should appear; they may match grand totals and that is OK.
- Metrics-first layouts should **not** emit `Total <metric>` headers/rows.
- Tests:
  - `renders metric-specific column grand totals when metrics are on columns`.
  - `renders metric-specific column grand totals when metrics are nested at depth 2`.
  - `renders metric-specific column grand totals when metrics are nested at depth 3`.
  - `renders metric-specific column subtotals even when they match grand totals`.
  - `does not render metric total headers when metrics are the first column level`.

4) Metric totals on rows
- When metrics are on rows and row totals are enabled, `Total <metric>` rows should render.
- Metrics-first rows should not create extra total rows (already at top level).
- Tests:
  - `renders metric-specific row grand totals when metrics are on rows`.
  - `does not render metric total rows when metrics are the first row level`.

## Risks and edge cases
- Metrics placeholder in the middle of a hierarchy (Values between dimensions) changes the expansion model. Ensure the toggle/indent logic respects `metricIndex` and does not hide real dimension nodes.
- When subtotals are forced to bottom for multi metrics, parent row values should be cleared only after expansion, and only for the affected subtotal depth.
- Column subtotal placement override should only apply to non-root subtotal leaves. Root placement should still obey `colTotalPosition`.
- Metric totals may duplicate existing subtotal nodes from the backend; de-dupe logic must avoid dropping legitimate totals when `Total <metric>` should appear.

## Acceptance checklist
- Multi-metric rows/columns show metric nodes under collapsed groups.
- Row subtotals default to inline (no explicit subtotal rows), and bottom positioning produces explicit subtotal rows.
- Multi-metric rows always show subtotals at the bottom (ignoring the UI toggle), while grand totals still obey position.
- Metrics on columns with multiple metrics always place subtotals at the end, with grand total placement controlled by UI.
- `Total <metric>` appears for column/row grand totals when metrics are nested (depth >= 1), but does **not** appear when metrics are already top-level.
- Column subtotals show `<group> <metric>` labels even if equal to grand totals.
- All pivot-table-v3 tests pass (ignoring the existing mock duplication warning).
