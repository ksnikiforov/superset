# Pivot Table v3 Test Generalization Plan

## Goal
Broaden existing pivot-table tests to validate invariant behavior across variable metric counts, hierarchy depths, and totals/subtotals configurations without adding new tests.

## Plan
- [x] 1) Audit tests for fixed assumptions (metric count, depth, axis placement, totals position) and tag candidates for parameterization.
- [x] 2) Generalize metric-count-dependent tests with shared fixtures and `test.each` loops.
- [ ] 3) Generalize depth/placement-dependent tests (initialDepth, startCollapsed, axis placement) with shared helpers.
- [x] 4) Broaden totals/subtotals tests across positions and multi-metric expectations while preserving existing assertions.
- [x] 5) Update `superset-frontend/plugins/plugin-chart-pivot-table-v3/TEST_BEHAVIOR.md` to document generalized invariants.
- [ ] 6) Run targeted tests (`npm test plugins/plugin-chart-pivot-table-v3`) and address regressions.

## Audit Notes
- Metric-count candidates (multi-metric only, keep single-metric behavior separate): `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/metrics.test.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/totals/rows.test.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/totals/columns.test.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/utils.test.ts`.
- Depth/placement candidates: `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.metric-first.test.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.layout.test.tsx`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.expansion.test.tsx`.
- Query/transform invariants (can generalize depth/metrics where behavior is invariant): `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/buildQuery.test.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/transformProps.test.ts`, `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/fetchPivotBranch.test.ts`.
- Keep single-metric-specific behavior tests separate (metric tier suppression, base-cell propagation) in `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/metrics.test.tsx` and `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/utils.test.ts`.

## Tracking
- Status: in progress
- Last updated: 2025-02-14
