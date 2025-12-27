## Pivot Table v3 – Subtotal duplication (current blocker)

### Problem statement
- When column totals and branch subtotals are enabled and multiple column roots exist (e.g., flags A/N with priorities underneath), the rendered leaf headers still include the parent total leaf (e.g., “A”, “N”) alongside the injected “Subtotal” child, producing duplicated totals and repeated value columns.
- The bug appears after expanding columns with totals/subtotals selected; expected behavior is one subtotal leaf per branch and no parent-total leaf at the same depth. Grand totals should remain only at the configured position.
- Existing tests did not cover this multi-root column subtotal scenario; current UI output shows parent totals and subtotals rendered together.

### Repro (to be encoded in tests)
- Columns: two top-level values (e.g., `flag: A, N`) with a second-level priority (`1-URGENT`, `2-HIGH`, …).
- Options: `colTotals` enabled, `colSubtotalLevels` includes level 1, `colSubtotalPosition` start, `colTotalPosition` end, `metricsLayout` on columns.
- Data: per-priority values for each flag plus a grand total; when expanded, headers show `[A, A Subtotal, N, N Subtotal, Grand total]` (or similar), indicating duplication.

### Plan of attack
1) Add failing regression test that builds a pivot tree with multiple column roots and level-1 subtotals, asserting that parent column totals are NOT rendered as leaf headers when branch subtotals exist. Include an explicit check that “A”/“N” (parent totals) are absent while subtotals remain.
2) Investigate column tree shaping and rendering:
   - `buildTreeFromRecords`/`prefixTreeWithPath`/`mergeTrees`: ensure branch subtotal nodes are keyed/labeled distinctly and parent totals are not emitted as leaves when a child subtotal is present.
   - `buildColLeavesWithSubtotals` and leaf pruning: traverse columns so that when a node is subtotal-eligible and children exist, only the subtotal child renders; parent total stays non-leaf.
   - Preserve grand total ordering per `colTotalPosition` without reintroducing parent totals.
3) Fix implementation accordingly, keeping row/metric behaviors intact (no regression to metric-first expansion).
4) Verify against new regression plus existing pivot v3 suite; run full plugin tests.

