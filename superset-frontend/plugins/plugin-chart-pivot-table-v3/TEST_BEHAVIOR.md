<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Pivot Table v3 Required Behavior (from tests)

This document summarizes required behavior inferred from the pivot-table
plugin tests under `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/`.
It maps expectations to specific test suites and extrapolates broader user
scenarios based on those tests.

## Expansion and data loading fundamentals

- Expansion is incremental and depth-aware. Expanding a row/column fetches the
  next level for that axis without forcing deeper levels on the other axis.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.column-metrics.test.tsx`
  and `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.expansion.test.tsx`.
- Expansion keeps previously visible values stable. Collapsing and re-expanding
  should not drop already-fetched values or duplicate nodes.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.column-metrics.test.tsx`
  and `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.regressions.test.tsx`.
- Deep hierarchies expand sequentially across multiple levels without errors.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.depth.test.tsx`.

## Metrics before dimensions (metrics-first or metrics-on-columns)

### Metrics-first rows
- If a node has only metric-tier children, expanding that node still fetches the
  correct branch and does not duplicate the base node.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.metric-first.test.tsx`.
- Metric-first values remain visible when expanding deeper levels under that
  metric node.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.metric-first.test.tsx`.

### Metric count independence
- Metric-tier layout, toggles, and collapsed initial rendering behave the same
  for single-metric and multi-metric selections; tests iterate across multiple
  metric counts to assert layout behavior is not tied to a fixed number.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/metric-tier-layout.test.tsx`
  and `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/initial-depth.test.tsx`.
- Collapsed multi-metric layouts surface metric headers while keeping deeper
  dimension members hidden until expanded, for both rows and columns.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/metrics.test.tsx`.

### Metrics on columns
- Expanding a row when metrics live on columns fetches the next row dimension
  and correctly rehydrates values across metric columns.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.column-metrics.test.tsx`.
- Column expand/collapse cycles do not break subsequent row expansions; metrics
  remain available after column toggles.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.column-metrics.test.tsx`.
- Row expansion respects `initialDepth`, advancing exactly one row level beyond
  the currently visible depth when metrics are on columns.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.column-metrics.test.tsx`.

### Ancestor values, totals, and subtotals
- Ancestor row values persist when columns are expanded under deeper row levels.
- Ancestor column values are filled for all visible rows when additional column
  branches are expanded after deep row expansion.
- Row subtotals are suppressed when disabled, and synthesized subtotal nodes are
  hidden across multi-level expansions.
- Column subtotal cells fill correctly when columns expand before rows.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.ancestor-subtotals.test.tsx`.

## Metrics between dimensions

### Layout and toggles
- The metric tier appears between specific row dimensions and receives the
  expand toggle where appropriate.
- Parent dimension toggles are hidden when metrics sit after the parent level.
- Metric nodes can act as expansion points (the "Values" level expands to
  downstream dimensions).
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.layout.test.tsx`.

### Metric-tier behavior and subtotals
- When metrics are placed right after the top dimension, metrics appear as a
  second layer without extra toggles.
- Metric subtotals appear only when row subtotals are enabled.
- Non-metric totals are hidden when metrics sit between row dimensions.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.metrics-tier.test.tsx`.

### Expansion sequences
- Expanding the Values level loads the next dimension beneath it (for example,
  expanding Values reveals `orderStatus`).
- Expanding a parent dimension above the Values level recalculates the order and
  placement of deeper levels, but keeps metric nodes in the correct position.
- Re-expansion preserves nested values (for example, `returnFlag` rows remain
  under the same metric nodes).
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.expansion.test.tsx`.

### Regression-focused expectations
- Toggle state and values are consistent after collapsing and re-expanding
  parent levels or metric tiers.
- Column values remain in column headers and do not appear in row headers after
  expanding above the Values level.
- When more dimensions follow Values, expanding Values triggers further
  downstream dimension expansion (for example, Values then `orderStatus`).
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.regressions.test.tsx`.

## Totals and subtotals

- Grand totals honor `rowTotalPosition` and `colTotalPosition` for start/end
  ordering.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/totals/columns.test.tsx`.

## Stability guarantees

- Expand/collapse cycles should not change row/column counts for the same pivot
  state. This is tested across row-only, column-only, and mixed toggle sequences
  with different metric counts and layouts.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/PivotTableChart.expand.stability.test.tsx`.

## Broader scenarios (extrapolated from tests)

### Scenario A: Metrics between dimensions with multi-step expansion
Given `orderPriority -> shipMode -> Values -> orderStatus -> orderClass`
and columns `shipInstruction -> customerSegment -> returnFlag`:
- The initial view shows `orderPriority` rows with metric rows in the middle.
  See the layout behavior in
  `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.layout.test.tsx`.
- Expanding the Values level reveals `orderStatus` without showing column labels
  in the row header. See
  `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.expansion.test.tsx`
  and `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.regressions.test.tsx`.
- Collapsing and re-expanding the metric tier keeps `returnFlag` rows nested and
  preserves values. See
  `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-between/PivotTableChart.expand.metrics-between.regressions.test.tsx`.

### Scenario B: Metrics on columns with deep row expansion
Given rows `nation -> orderPriority -> orderStatus`, columns `segment`, and
metrics on columns:
- Expanding rows fetches the next dimension while column expansions can be
  toggled without losing row-level values.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.column-metrics.test.tsx`.
- After deep row expansion, expanding additional columns fills ancestor column
  values for all visible rows and preserves existing totals/subtotals when
  enabled.
  See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.ancestor-subtotals.test.tsx`.

### Scenario C: Five-level hierarchies
For deep hierarchies (five levels on rows or columns), each expansion step
fetches and reveals one additional level without skipping or repeating.
See `superset-frontend/plugins/plugin-chart-pivot-table-v3/test/plugin/expand/metrics-before/PivotTableChart.expand.metrics-before.depth.test.tsx`.

## Notes

- These expectations are derived from the test suite; they are intended to be
  treated as required behavior unless superseded by updated requirements in
  `superset-frontend/plugins/plugin-chart-pivot-table-v3/REQUIREMENTS.md`.
