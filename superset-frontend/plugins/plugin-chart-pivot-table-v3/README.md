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

## @superset-ui/plugin-chart-pivot-table-v3

Pivot Table v3 queries database aggregates and loads branches on expansion. It supports Superset 6.1.0, count-distinct totals, measure leaves, formatting, cross-filtering, and Excel export.

### Behavior

- Initial and persisted expansion use the same coverage planner as manual expansion.
- Independent branches on one axis can finish separately. Pending row and column expansions reveal together after their intersection coverage arrives.
- The committed table remains visible during loading. Collapsing cancels pending expansion intent on both axes. Requests have a 30-second deadline; Retry repeats the failed expansion or layout/filter operation.
- Truncated results can be displayed but cannot satisfy complete coverage. Increase the row limit or narrow the filters before retrying.
- Selecting an already selected cell clears its cross-filter; the context menu exposes the same selection state.
- Hidden parent values stay blank in both databars and Excel. Excel projection is built on export, with separate dimension, metric, and value-tier row columns.
- Sortable column headers support Enter and Space. Expansion controls expose contextual labels and expanded state.

### Registration

```ts
import PivotTableV3ChartPlugin from '@superset-ui/plugin-chart-pivot-table-v3';

new PivotTableV3ChartPlugin().configure({ key: 'pivot_table_v3' }).register();
```

### Architecture

`PivotTableChart.tsx` wires the interaction shell and view. `pivot/chart/usePivotRuntime.ts` owns draft changes and one committed checkpoint containing layout, filters, query plan, fact store, tree, and expansion state. Refreshes publish that checkpoint together after required coverage arrives. `pivot/expansion/ExpansionSession.ts` handles expansion requests, cancellation, deadlines, and loading scopes.

Explore controls reuse Superset's metric editors, option labels, drag wrappers, and option selector. Pivot-specific controls add formatting actions, measure leaves, and the protected Values slot. Pending control edits share one acknowledgement hook.

The data pipeline is:

```text
form data + intent -> compilePivotProgram -> required coverage
  -> fact-store coverage diff -> query specs -> chart data transport
  -> exact fact batches -> materializePivotTree -> render / export
```

- `pivot/runtime/factStore.ts`: canonical facts and complete coverage, scoped to metric definitions, datasource, row limit, filters, and time context.
- `pivot/query/`: query planning and transport query conversion, including NULL scopes and temporal bucket filters.
- `pivot/data/`: request cancellation, response warnings, and query-bundle splitting.
- `pivot/runtime/materializePivotTree.ts`: semantic tree projection from facts.
- `pivot/chart/usePivotFormatting.tsx`: shared cell visibility and value formatting for screen and Excel adapters.
- `export/buildPivotV3ExportTable.ts`: worksheet projection and deferred chart export registration.

Paths and cell keys are opaque. Use `serializePath`, `parsePath`, and `serializeCellKey`; do not concatenate or split keys directly. Legacy safe string keys remain readable, and saved expansion state stores paths rather than serialized node keys.

### Validation

Run Jest for `plugins/plugin-chart-pivot-table-v3` and `spec/javascripts/utils/exportPivotV3Excel.test.ts`. Follow repository pre-commit requirements before pushing. See `PURE_RUNTIME_TRANSITION_PLAN.md` for remaining architecture and validation work.
