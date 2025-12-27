# Pivot Table v3 – Metrics Placeholder Drag Bugs

## Problem
Dragging the metrics placeholder (“Σ Values”, `__MEASURES__`) between Columns and Rows in Explore often duplicates or fails to move. The Columns/Rows DnD controls hold independent state; moving the placeholder updates only one control, leaving stale `__MEASURES__` on the other unless both are explicitly synchronized.

## Approaches Tried → Results

1) **Resolver normalization (utils.ts)**  
   - Implemented `resolveMetricPlacement(rows, cols, hasMetrics, preferredAxis)` to dedupe placeholder, prefer one axis, and preserve drop order by index; auto-place when metrics exist. Exposed as `globalThis.__pivot_v3_resolveMetricPlacement`.  
   - **Result:** Logic works in isolation; doesn’t fix UI alone because each DnD control retains its own stale value.

2) **Control mapState sanitization + bias (controlPanel.tsx)**  
   - Always recompute placement (`shouldMapStateToProps: () => true`), bias preferred axis toward the control that currently holds the placeholder, fall back to `metricsLayout`.  
   - Pass `pivotPlacement` (axis, rowsValue, colsValue, hasMetrics, preferredLayout, resolver, setControlValue) to DnD; force new array value to drop stale chips.  
   - **Result:** Payloads/logs show correct `resolvedRows/cols`, but UI chips still stale without explicit cross-axis mutation.

3) **Backend/query alignment (transformProps.ts, buildQuery.ts, fetchPivotBranch.ts)**  
   - Pass `metricsLayout` into resolver so query payloads match UI placement/order.  
   - **Result:** API payloads become clean (placeholder stripped from one axis) but does not drive UI chips.

4) **Cross-axis onChange synchronization (DndColumnSelect.tsx + controlPanel pivotPlacement)**  
   - Added `pivotPlacement` prop; on drop/reorder/delete resolve with both axes and dispatch:
     ```ts
     const [rowsResolved, colsResolved] = resolveMetricPlacement(nextRows, nextCols, hasMetrics, preferredLayout);
     setControlValue('groupbyRows', rowsResolved, []);
     setControlValue('groupbyColumns', colsResolved, []);
     ```
   - Added local `toArray` helper (replacing missing `ensureIsArray` to avoid ReferenceError).  
   - **Result:** Intended to mutate both axes immediately. Needs confirmation that `setControlValue` is actually injected; user still sees stale UI and duplication after refresh, suggesting dispatch not firing or controls not rerendering.

5) **Debug hook**  
   - `window.__PIVOT_V3_DEBUG_PLACEMENT = true` logs `{ axis, rowsRaw, colsRaw, resolvedRows, resolvedCols, value }` from `controlPanel.tsx`.  
   - **Result:** Logs show resolver stripping placeholder from one axis, but chips don’t update.

## Additional work (current iteration)

- **New resolver + plumbing**: Introduced `normalizePlaceholder`, `isMetricsPlaceholder`, and `resolveMetricPlacement` in `utils.ts`. All flows (control panel mapState, formDataOverrides, transformProps, fetchPivotBranch) now use the resolver so UI/query/cache align. Added unit tests (`utils.test.ts`).
- **Cross-axis DnD wiring**: `controlPanel` passes `pivotPlacement` to `DndColumnSelect`, including resolver and `setControlValue`. `DndColumnSelect` now:
  - Uses Redux `setControlValue` fallback if actions aren’t injected.
  - Syncs both axes on drop/reorder/delete and dedupes non-measure dimensions across axes (move, not copy).
  - Tracks hover index/list to try to insert at the hovered position; debug logs added for drop/applyChange.
  - Allows string/adhoc values in OptionSelector (fixed `isColumnMeta` error).
- **Placement/position issues**:
  - Current drop logs show cross-axis moves resolve correctly (`resolvedCols`/`resolvedRows`), but placement still appends because hover index is not consistently captured during cross-list drags. Added drop-details logging, but hover index often null → insertAt = end.
  - No visual preview; still reliant on hover capture. Needs a more reliable index (e.g., pointer offset → index calculation).
- **Warnings/tech debt**:
  - Console noise from upstream (componentWillMount, Tooltip deprecation, Emotion ref warning) untouched.
  - DndSelectLabel key warning persists in upstream control; not addressed.
  - Added debug hooks and extra logging guarded by `__PIVOT_V3_DEBUG_PLACEMENT`.
  - Cross-axis dedupe/move logic is custom; should be aligned with a shared DnD utility if one exists.

## What works now
- Σ placeholder moves across axes without duplication (resolver + cross-axis dispatch).
- Non-measure fields move (not copy) between Rows/Columns; metrics placeholder preserved.
- Query/transform/cache use the same resolver, so backend matches UI placement.

## What still doesn’t work
- **Drop ordering**: Cross-axis drops often append instead of inserting at the hovered position because hover index is not reliably captured for cross-list drags. Debug shows `insertAt` falling back to end. No visual preview.
- **setControlValue injection**: In mapState debug, `hasSetControlValue` is false; relying on Redux fallback may affect rerender timing.
- **Upstream warnings**: Key warning in DndSelectLabel and other dev warnings still present.

## Next steps (proposed)
- Derive drop index by pointer position relative to target list (similar to datasource panel) instead of relying on hover in React DnD cross-list hover.
- Ensure `setControlValue` is passed into control mapState (or always use Redux dispatch) and verify controls rerender after cross-axis dispatch.
- Clean up debug logs once behavior stabilizes; consider adding a small utility to compute insert index for cross-list drops.

## User Logs / Outcomes

- Drop no-op / duplication after refresh:
  ```
  axis: "groupbyRows"
  rowsRaw: ["nation","orderPriority","__MEASURES__"]
  colsRaw: ["__MEASURES__"]
  resolvedRows: ["nation","orderPriority","__MEASURES__"]
  resolvedCols: []

  axis: "groupbyColumns"
  rowsRaw: ["nation","orderPriority","__MEASURES__"]
  colsRaw: ["__MEASURES__"]
  resolvedRows: ["nation","orderPriority"]
  resolvedCols: ["__MEASURES__"]
  ```
  After refresh, placeholder visible on both axes; UI chips unchanged despite logs.

- Runtime errors hit:
  - `ensureIsArray is not defined` (DndColumnSelect.tsx) → fixed via `toArray`.
  - Duplicate identifier `rowsHas` (controlPanel.tsx) → fixed by renaming flags.

- Dispatch uncertainty:
  - `pivotPlacement.setControlValue` taken from `state?.actions?.setControlValue`; may be undefined, causing fallback to single-axis `onChange` (no cleanup). Needs verification that Control receives actions in this context and that both controls rerender after dispatch.

## Next Steps
- Ensure `setControlValue` is injected into DnD controls (or explicitly passed) so cross-axis dispatch fires.
- Confirm controls rerender after dispatch (consider forcing a `key`/version bump) so chips reflect resolved values.
- Retest drag with debug hook; expect only one axis to have `__MEASURES__` and UI to match `resolvedRows/cols` immediately.
