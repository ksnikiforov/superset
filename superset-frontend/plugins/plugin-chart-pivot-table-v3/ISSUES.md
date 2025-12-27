## Pivot Table v3 – Outstanding Issues (Values at Front)

### Current symptom
- When the “Values” (metrics placeholder) is placed before other fields on rows (or columns), expanding nodes produces duplicated rows/headers. In the UI, the metric tier shows repeated numeric labels (e.g., `0, 1, 10, …`) with values, effectively rendering the metric node plus an extra dimension-like layer. The duplication persists even after branch fetch, just now with data instead of blanks.
- Expansion after Values appears to re-use existing nodes instead of showing a clean next-dimension level; the network panel sometimes shows no branch query or a branch query that doesn’t resolve the hierarchy correctly.

### What was attempted (and why)
- **Child filtering aligned to metric position**: Adjusted `getRowChildren`/`getColChildren` to only surface children that contain the metric at the configured metric index when Values is on that axis, aiming to hide placeholder/base nodes that lack the metric tier.
- **Forcing branch fetch on metric tier**: Updated `hasLoadedChildren` to treat metric-only children as “not loaded” when deeper dimensions remain, so expanding off the metric tier should trigger `fetchPivotBranch` rather than reusing placeholders.
- **Value propagation constraints**: Limited single-metric value propagation to base paths only when the metric tier sits at the end of the axis, to avoid pre-populating metric-first layouts and masking missing fetches.
- **Reactivity fixes**: Added dependencies on resolved metric indices so filtering updates as the tree changes.

### Remaining behavior
- With Values at the front of rows, expanding still renders an extra metric-level “dimension” layer (numeric labels) alongside the actual metric tier, causing visually duplicated rows/headers even though values now populate.
- The duplication suggests the tree still contains both the metric-projected nodes and the original dimension nodes (or placeholders) at the same depth, and the visible traversal isn’t excluding the non-metric layer in this layout.

### Suspected areas to revisit
- `applyMetricAxis` and downstream tree traversal may be retaining original nodes at the metric insertion point when the metric is at position 0, leading to two sibling layers (original base + metric-projected) instead of a single metric tier.
- `buildVisibleList` / `buildVisibleLeafList` may need explicit pruning of non-metric siblings at the metric index when the metric tier is first.
- `hasLoadedChildren` might still treat some metric-projected nodes as valid dimension children if they carry cell data, causing the extra layer to render rather than being filtered out.

### Missing validation
- Need a focused test that builds a tree with `rows: [Values, r1, r2]`, expands the metric node, and asserts the visible row list is a single path (metric → r1) without duplicate numeric labels. Also verify branch fetch is invoked at the metric tier.
