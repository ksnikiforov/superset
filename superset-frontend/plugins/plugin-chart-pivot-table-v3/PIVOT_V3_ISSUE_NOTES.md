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
