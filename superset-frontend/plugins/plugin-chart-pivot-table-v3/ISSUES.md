## Pivot Table v3 – Outstanding Issues

### Current symptom
- Layout: rows `[nation, orderPriority]`, columns `[Values, segment]`, metrics `[countCustomers]`. Initial render and column expand/collapse work, but expanding a row afterward shows a loader and renders blank cells (no metric values) under the expanded row.

### What was attempted (and why)
- **Metric-first column propagation**: `applyMetricAxis` now surfaces single-metric values on the base column key even when the metric is at position 0 and seeds the column root when metrics are first, to keep cells populated after row expansions.
- **Branch fetch triggers**: Added tests to ensure row branch fetch fires after toggling metric-first columns; verified loader appears, indicating fetch invocation.

### Remaining behavior
- After row expansion in the above layout, fetched data is not merged/rendered; values stay blank despite the fetch trigger. The merge or visibility step is likely discarding metric-first column cells for newly fetched row paths.

### Suspected areas to revisit
- `applyMetricAxis` merge for metric-first columns during row branch merges may drop base column/root cells for new row paths.
- `mergeTrees`/cell keying could overwrite or miss base column cells when combining branch data fetched at row depth > 0 with metric-first columns.
- `buildVisibleLeafList`/visible columns might be suppressing the base column node after re-expansion, hiding cells that were populated.

### Missing validation
- Add an integration test that performs: initial render with `rows: [nation, orderPriority]`, `cols: [Values, segment]`, expand Values on columns, collapse, then expand a row node; assert branch fetch occurs and metric values render for the expanded row across visible segments.
