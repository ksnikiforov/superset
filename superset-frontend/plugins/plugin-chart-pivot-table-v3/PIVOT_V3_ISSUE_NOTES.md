# Pivot Table v3 – Metrics Placement (current state)

This file documents the current, working implementation of metrics placement and drag/drop for Pivot v3. Previous duplication bugs have been resolved; logic is now plugin-scoped and aligned across UI, query, and cache.

## Overview
- **Plugin-scoped DnD:** Rows/Columns use a pivot-specific control (`PivotDndColumnSelect`) so Explore’s global DnD behavior stays unchanged. Cross-axis syncing, dedupe, and ordering logic live entirely in the plugin.
- **Single metrics placeholder:** `resolveMetricPlacement` guarantees only one `__MEASURES__` placeholder across axes, normalizes on every state read (`controlPanel.tsx` mapState, `formDataOverrides`, `transformProps`, `fetchPivotBranch`).
- **Cross-axis synchronization:** Drops/reorders/deletes dispatch both axes via the resolver so UI, query payloads, and cached branches stay in sync.
- **Move semantics for dimensions:** Non-measure fields are deduped across axes on drop (move instead of copy).
- **Inline, non-removable placeholder:** “Σ Values” renders as a standard chip with an inline “Fixed” badge and no close affordance to signal it cannot be removed; height matches other options.

## Behavior details
- **Resolver:** `utils.ts` → `resolveMetricPlacement(rows, cols, { hasMetrics, preferredAxis })`:
  - Dedupes `__MEASURES__` across axes.
  - Honors `metricsLayout`/preferred axis when metrics exist.
  - Preserves user order when possible.
- **Control panel wiring:** `controlPanel.tsx`
  - Injects placeholder option only when metrics exist.
  - Passes `pivotPlacement` (axis, resolved rows/cols, hasMetrics, resolver, control names, setControlValue) into the plugin DnD control.
  - Normalizes `formData` via the resolver so backend/query state matches UI.
- **DnD control:** `controls/PivotDndColumnSelect/`
  - Uses Redux `setControlValue` fallback when actions aren’t injected.
  - Cross-axis drops: resolve both axes, dedupe non-measures, update both controls.
  - Ordering: computes insert index from pointer position within the list container for consistent placement; reorders within a list via hover swaps.
  - Accepts string/adhoc values safely (option selector updated).
- **Styling/UX:** Placeholder uses the standard option layout with an inline “Fixed” badge and muted text color; no delete icon; caret suppressed.

## Current status
- Placeholder drag/drop works without duplication; UI chips, queries, and branch cache stay aligned.
- Placeholder is non-removable and visually distinguished while keeping the same height as other chips.
- Global Explore DnD controls are restored to baseline (commit `6a1c30e5e7c3e28d0549c9c2ac0ff61607f26a2f`).

## Files of interest
- Control wiring & placeholder option: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controlPanel.tsx`
- Resolver + tests: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/utils.ts`, `utils.test.ts`
- Plugin DnD control: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/controls/PivotDndColumnSelect/`
- Query/transform alignment: `superset-frontend/plugins/plugin-chart-pivot-table-v3/src/transformProps.ts`, `buildQuery.ts`, `fetchPivotBranch.ts`
