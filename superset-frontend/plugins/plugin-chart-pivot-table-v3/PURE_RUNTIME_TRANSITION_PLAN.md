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

# Pivot Table v3 Pure Runtime Transition Plan

This document is the current refactor map for pivot-table-v3. It intentionally
tracks only the useful present state, remaining risk, and next deletion targets.
The older migration diary has been removed from this file; commit history is the
record for already-completed slices.

## Hard Guardrails

The remaining work should be judged against these rules:

- No render-time semantic repair.
- No tree-shape-as-loaded-state.
- No local projection for semantic layout changes.
- No query planning outside coverage.
- No materialization outside `materializePivotTree`.
- No chart-owned runtime second guessing.

Compatibility with previous pivot-table-v3 behavior is not a requirement by
itself. When old behavior conflicts with a simpler runtime model, the simpler
model can win, but the behavior change must be named and tested.

## Target Pipeline

```text
form data + runtime UI state
  -> compilePivotProgram
  -> derive required fact coverage
  -> fetch missing DB aggregate facts
  -> ingest into PivotFactStore
  -> materializePivotTree
  -> derive render/export model
  -> PivotTableView / export
```

Only fetching and persistence should have side effects. Tree nodes and rendered
cells are projections of DB facts, not canonical data.

## Current Status

As of May 13, 2026, after
`bafc60ffb9 refactor(pivot-table-v3): remove rendered export metadata`:

- Overall transition estimate: **95%**.
- Goal-weighted completion estimate: **95%**.
- The runtime architecture exists and is used by the main paths.
- The project is roughly at line-count break-even, but not done.
- The remaining work is mostly deletion of old chart, expansion, and render
  interpretation paths.

Source-only diff from pre-refactor baseline
`7088db374448845ef6e71cf74817aa53efbc5fc1`:

- Production `src`: `12489` insertions, `11818` deletions, net `+671`.
- Current production `src` TypeScript/TSX total: `34181` lines.
- Implied baseline `src` TypeScript/TSX total: about `33510` lines.
- Full plugin Jest pass after the column-sort extraction: `91` suites and
  `729` tests.
- Full plugin Jest pass after extracting the interaction layout shell: `91`
  suites and `729` tests. Focused interaction coverage also passed: `5` suites
  and `69` tests.
- Focused expansion pass after centralizing expansion delta merges: `3` suites
  and `15` tests.
- Focused hydration/expansion pass after centralizing hydration delta staging:
  `4` suites and `18` tests.
- Focused reinitialization pass after centralizing expansion reinit decisions:
  `3` suites and `68` tests.
- Full plugin Jest pass after the expansion-engine cleanup series: `91` suites
  and `737` tests.
- Focused persisted-expansion visibility pass: `2` suites and `65` tests.
- Full plugin Jest pass after extracting the databar runtime model: `92` suites
  and `742` tests.
- Full plugin Jest pass after centralizing expansion toggle/collapse decisions:
  `92` suites and `746` tests.
- Full plugin Jest pass after centralizing seamless persistence and display
  snapshot settlement policy: `92` suites and `748` tests.
- Full plugin Jest pass after centralizing the hydration iteration/cancellation
  loop: `92` suites and `751` tests.
- Full plugin Jest pass after isolating expansion fetch execution: `92` suites
  and `751` tests.
- Full plugin Jest pass after centralizing metric-axis layout policy: `93`
  suites and `755` tests.
- Full plugin Jest pass after centralizing applied runtime layout projection:
  `93` suites and `757` tests.
- Full plugin Jest pass after centralizing axis child layout policy: `93`
  suites and `759` tests.
- Full plugin Jest pass after centralizing collapsed Values layout policy: `93`
  suites and `761` tests.
- Full plugin Jest pass after centralizing row subtotal layout policy: `93`
  suites and `763` tests.
- Full plugin Jest pass after centralizing render display policy: `94` suites
  and `767` tests.
- Full plugin Jest pass after centralizing render date-label policy: `94`
  suites and `770` tests.
- Full plugin Jest pass after centralizing render node display policy: `94`
  suites and `772` tests.
- Full plugin Jest pass after centralizing selection-filtered form-data
  construction: `94` suites and `773` tests.
- Full plugin Jest pass after emitting semantic export row-depth count: `94`
  suites and `774` tests.
- Full plugin Jest pass after unifying metric expansion stale-key cleanup: `94`
  suites and `776` tests.
- Full plugin Jest pass after centralizing expansion ref syncing: `94` suites
  and `776` tests.
- Full plugin Jest pass after tightening hydration plan allocation: `94`
  suites and `776` tests.
- Full plugin Jest pass after centralizing chart ref syncing and table-width
  reuse: `94` suites and `776` tests.
- Full plugin Jest pass after centralizing dimension formatting/sorting key
  remaps: `94` suites and `776` tests.
- Full plugin Jest pass after centralizing expansion-state signature payloads:
  `94` suites and `776` tests.
- Full plugin Jest pass after emitting the export row model from render:
  `94` suites and `776` tests.
- Full plugin Jest pass after batching expansion tree/expanded/pending state
  commits: `94` suites and `776` tests.
- Focused render/export pass after dropping the per-row depth export marker:
  `3` suites and `24` tests.
- Full plugin Jest pass after centralizing runtime-layout prop sync planning:
  `94` suites and `777` tests.
- Full plugin Jest pass after narrowing the runtime-layout sync API: `94`
  suites and `775` tests.
- Focused interaction drag/layout pass after removing unused drag-removal
  metadata: `2` suites and `32` tests.
- Focused interaction drag/layout pass after simplifying dimension removal:
  `2` suites and `32` tests.
- Focused chart-sync/runtime pass after merging persisted selection sync into
  one effect: `5` suites and `76` tests.
- Full plugin Jest pass after merging persisted selection sync into one effect:
  `94` suites and `775` tests.
- Focused export/render/chart pass after preserving numeric export typing
  without row-axis metadata: `3` suites and `25` tests.
- Full plugin Jest pass after preserving numeric export typing without row-axis
  metadata: `94` suites and `776` tests.
- Focused chart-sync/runtime pass after merging seamless runtime update effects:
  `5` suites and `76` tests.
- Full plugin Jest pass after merging seamless runtime update effects: `94`
  suites and `776` tests.
- Focused export/render/chart pass after extracting the row export model: `3`
  suites and `25` tests.
- Full plugin Jest pass after extracting the row export model: `94` suites and
  `776` tests.
- Focused export utility/model/render/chart pass after moving v3 export off
  `table_to_book`: `4` suites and `26` tests.
- Full plugin plus export utility Jest pass after moving v3 export off
  `table_to_book`: `95` suites and `777` tests.
- Focused export model/utility pass after deleting the production export table
  builder: `2` suites and `14` tests.
- Full plugin plus export utility Jest pass after deleting the production export
  table builder: `95` suites and `777` tests.
- Focused export utility/model/render/chart pass after registering worksheet
  data from the rendered view: `4` suites and `27` tests.
- Full plugin plus export utility Jest pass after registering worksheet data
  from the rendered view: `95` suites and `778` tests.
- Focused render/chart/export pass after removing rendered export metadata: `3`
  suites and `14` tests.
- Full plugin plus export utility Jest pass after removing rendered export
  metadata: `95` suites and `778` tests.

The readout remains mixed: the plugin is still modestly above the baseline line
count, but the chart/layout hooks keep losing inline policy and the remaining
added lines are isolated, tested runtime helpers rather than more React
orchestration.

## Gate Status

| Gate                                      | Completion | Current readout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1: compiled layout model             |        74% | `PivotProgram` exists and drives many paths. Metric-axis insert positions, inferred metric indices, subtotal forcing, hidden metric headers, and metric expansion flags now live in a pure chart runtime helper. Applied runtime layout/formData projection for user-controlled charts now lives beside interaction layout normalization. `usePivotLayout` and interaction layout still translate some raw form/runtime layout into compatibility fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Gate 2: query planning from coverage      |        91% | Initial/root/branch/batch query paths use explicit coverage metadata. Bootstrap/root fact batches now seed fetched root expansion coverage. Branch and grouped-batch fetch params no longer expose tree shape. Remaining work is mostly support/totals coverage composition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Gate 3: central fact ingestion/store      |        92% | Fetch paths return fact batches, cache/fact-store hits use typed coverage, and ingestion is isolated. Compatible root/bootstrap coverage can now materialize branch specs without matching the original request scope while exact branch coverage remains authoritative. Remaining coupling is mostly tree-shaped chart/test boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Gate 4: one tree materializer             |        94% | `materializePivotTree.ts` owns fact-to-tree materialization, Values/metric/measure axes, subtotal leaf injection, and measure-leaf value application. Export no longer repairs row depth semantics, infers visible row hierarchy depth from cloned DOM rows, reads per-row depth markers, reconstructs visible row paths by scanning sibling DOM rows, clones/reshapes the rendered table, routes v3 workbook generation through `table_to_book`, exposes a production HTML-table export builder, emits export metadata attributes into the rendered table, or needs to parse rendered DOM metadata on the normal v3 export path. Row export values are produced by a pure export row model, the rendered view registers explicit worksheet cells, and the v3 export path writes that registered worksheet model. A DOM-metadata fallback remains for unregistered tables/tests rather than as the primary runtime path.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Gate 5: expansion reducer/runtime effects |        91% | Expansion no longer derives fetched state from rendered tree shape. It uses explicit fact coverage, semantic fetchability, shared fetch execution, and request lifecycles. Loaded terminal metric nodes and metric subtotal nodes now seed coverage through the fetched-coverage utility, fetched-result delta collection now seeds both fact batches and loaded metric-node coverage for same-axis and hydration paths, same-axis delta merge/stale-subtree preservation policy lives in the expansion engine, hydration delta staging/finalization policy lives in the expansion engine, expansion reinitialization trigger/effective-level policy lives in the expansion engine, persisted expansion visibility normalization lives in the expansion engine, expansion toggle/collapse pruning decisions live in the expansion engine, metric expansion stale-key cleanup uses one path, hydration iteration/cancellation policy lives in the expansion engine, and branch/batch fetch execution now lives in a dedicated expansion fetch executor. Initial hydration prefetch planning and prefetch action selection are also pure engine decisions. Same-axis fetch, cross-axis hydration, collapse, and reinitialization now use one batched tree/expanded/pending commit path. The hook still owns request kickoff and sequencing. |
| Gate 6: pure render model                 |        97% | Projection drives toggle eligibility, collapsed Values, column display, visible-axis construction, semantic export row depth count, semantic export row values, and chart column-sort decisions. Databar scale grouping, waterfall offsets, bridge connectors, label-space sizing, databar column min-width policy, metric-axis layout compatibility policy, pre-subtotal child filtering, collapsed Values node projection, row subtotal child policy, column display path construction, header label resolution, metric-leaf render expansion, render date-label formatting, toggle visibility, row/column aggregate emphasis, render node depth, export row hierarchy projection, worksheet-cell export typing, and registered worksheet export data now live in pure helpers. Remaining risk is mostly sorting/display-map policy and deleting the DOM fallback once all v3 export entrypoints are proven to register the model.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Gate 7: chart component cleanup           |        77% | The chart delegates runtime fetch decisions and no longer vetoes metric-order-only commits or treats rendered tree signatures as seamless refetch identity. Seamless sync snapshots, upstream dashboard query-context signatures, committed-props sync predicates, stale coverage recovery predicates, persisted-filter seamless reload policy, persisted-selection local sync policy, runtime-layout prop sync policy and prop-sync planning, runtime-layout change actions, stale dashboard runtime actions, seamless persistence side-effect planning, pending display snapshot settlement policy, and applied runtime layout/formData projection now live outside the chart. Selected-filter update policy, persisted filter normalization, tree-derived dimension filter value collection, selection-filtered fetch form-data construction, dimension filter search/value fetch state, interaction chip construction, interaction DnD shell rendering, remove-dimension layout policy, and column-sort resolution/reconciliation are now outside the chart. Stale-dashboard recovery and persisted-filter replay now share one seamless runtime update effect. The chart still owns committed tree/fact state, interaction callback wiring, and several controller-like effects.                                                     |

## What Is Now Solid

- Flexible Values placement remains supported on rows or columns, first,
  middle, or last.
- Main query planning uses explicit fact coverage rather than full possible
  layout depth.
- Branch and batch fetch results describe loaded coverage through fact batches,
  not through materialized tree shape.
- Expansion planning asks the compiled pivot program whether a visible toggle
  can fetch a semantic child.
- Expansion fetch execution carries coverage depths, not a staged tree snapshot,
  and hydration loader cleanup now uses one finalization path.
- No-dimension layouts require explicit root coverage before materialization.
- Bootstrap/root fact batches seed fetched root expansion coverage for the axes
  they actually cover.
- Fact-store materialization can reuse compatible root/bootstrap coverage for
  branch requests without weakening exact scoped fact lookups.
- Exact branch coverage wins over broader compatible root/bootstrap coverage
  during fact-store materialization reads.
- Loaded metric subtotal nodes and terminal metric nodes seed fetched expansion
  coverage centrally, while expandable non-subtotal metric nodes still require
  real fetches.
- Fetched-result delta collection now seeds loaded metric-node coverage in one
  path shared by same-axis expansion and atomic hydration.
- Same-axis expansion delta merge and stale-subtree preservation policy now
  lives in the expansion engine instead of in `useExpansionEngine.ts`.
- Hydration delta staging, deterministic staged-tree construction, and final
  hydration prune/merge policy now live in the expansion engine instead of in
  `useExpansionEngine.ts`.
- Expansion reinitialization trigger and cleared expand-level policy now live
  in the expansion engine instead of in `useExpansionEngine.ts`.
- Persisted expansion visibility filtering now lives in the expansion engine
  instead of in `useExpansionEngine.ts`.
- Expansion toggle classification and collapse descendant pruning now live in
  the expansion engine instead of in `useExpansionEngine.ts`.
- Hydration iteration, stale-request cancellation checks, fetch-result staging,
  and loop exhaustion policy now live in the expansion engine instead of in
  `useExpansionEngine.ts`.
- Branch/local-cache fetch planning, branch and grouped-batch request execution,
  loading-key accounting, warning/error forwarding, and fetched-result delta
  collection now live in `fetchExecution.ts` instead of in
  `useExpansionEngine.ts`.
- Initial hydration prefetch participation, root-only skip handling, and loader
  visibility are planned in the expansion engine instead of in
  `useExpansionEngine.ts`.
- Metric expansion stale-key cleanup now has one path for collapsed and
  non-collapsed states.
- Hydration planning reuses one empty-plan construction path, and cross-axis
  root-fetch planning only clones the axis plan it mutates.
- Expansion state/ref synchronization now uses one local hook instead of six
  repeated effects in `useExpansionEngine.ts`.
- Same-axis fetch, cross-axis hydration, collapse, and reinitialization now use
  one batched commit path for tree, expanded keys, and pending keys instead of
  separate React updates.
- Branch-cache entries store fact batches, not rendered trees.
- Measure-leaf value application is inside `materializePivotTree`.
- The chart no longer contains separate runtime-layout fetch predicates, stale
  coverage predicates, metric-order commit vetoes, or rendered tree signatures
  in seamless refetch identity.
- Dashboard upstream query-context signatures, committed-props sync predicates,
  stale coverage recovery predicates, and persisted-filter seamless reload
  policy are built in the seamless runtime module instead of in
  `PivotTableChart.tsx`. Persisted selected-filter local sync policy is also
  centralized there, along with runtime-layout prop sync policy and the combined
  prop-sync plan that the chart applies.
- Runtime-layout change actions and stale dashboard runtime actions are now
  prepared in the seamless runtime module, so the chart no longer owns those
  fetch/local-commit and upstream-query-state decisions.
- Applied runtime layout/formData projection for user-controlled charts now
  lives in `resolveInteractionLayout.ts`, so the chart no longer owns committed
  runtime metric merging, applied layout normalization, or layout prop
  projection for render/fetch.
- Seamless runtime persistence side-effect planning and pending display snapshot
  settlement policy are now in the seamless runtime module, so the chart applies
  persistence/display outcomes instead of deciding them inline.
- The chart now uses one local state-ref synchronization hook for own state,
  render tree state, and seamless expansion state, and it computes table width
  once for sticky headers and render sizing.
- Selected-filter update helpers, persisted filter normalization, and
  tree-derived dimension filter value collection are centralized in
  `pivot/filters.ts`, so the chart no longer owns those filter policies.
- Dimension filter search/value request state and query construction are now
  isolated in `useDimensionFilterValues`, so the chart no longer owns the
  request versioning and loading bookkeeping for filter value menus.
- Interaction chip construction and dimension-removal layout updates are
  centralized in `interactionDrag.ts`, beside the other drag layout policies.
- Dimension formatting/sorting key remapping now uses one helper shared by
  query normalization and cross-axis setting transfer.
- The interaction drag strips, drag preview, chip shell, and panel/table
  scaffolding live in `PivotInteractionLayout.tsx`, leaving the chart to pass
  callbacks and runtime chip state.
- Column-sort metric/data-key resolution, click-state cycling, and active-sort
  reconciliation are centralized in `columnSort.ts`, so the chart no longer
  owns measure-leaf sort policy.
- Databar scale grouping, waterfall offset/cumulative policy, waterfall bridge
  connector anchors, label-space sizing, and databar column min-width policy are
  centralized in `databarRuntime.ts`, so `usePivotFormatting.tsx` no longer
  owns the pure databar runtime model.
- Metric-axis insert positions, inferred metric indices, metric placeholder
  intent positions, subtotal forcing, redundant metric-header hiding, and
  metric expansion flags are centralized in `layoutRuntime.ts`, so
  `usePivotLayout.ts` no longer owns that compatibility policy inline.
- Axis child filtering before subtotal placement is centralized in
  `layoutRuntime.ts`, so `usePivotLayout.ts` no longer owns the Values-child
  projection filter, hidden metric-header filtering, or metric-first grand-total
  suppression inline.
- Collapsed Values metric-node projection is centralized in `layoutRuntime.ts`,
  so `usePivotLayout.ts` no longer owns metric tier discovery, projected
  collapsed metric node construction, or subtotal metric-node normalization.
- Row subtotal child filtering and end-position subtotal descendant insertion
  are centralized in `layoutRuntime.ts`, so `usePivotLayout.ts` no longer owns
  that row presentation policy inline.
- Expansion-state signature payload construction is shared between the full
  layout signature and the cross-layout shared signature.
- Column display path construction, column header label resolution, and
  metric-node render expansion are centralized in `renderDisplay.ts`, so
  `usePivotRenderModel.ts` no longer owns that display shaping inline.
- Render date-label formatting is centralized in `renderDisplay.ts`, so
  `usePivotRenderModel.ts` no longer owns date formatter selection, temporal
  value coercion, or row/column node map cloning inline.
- Toggle visibility, manual expanded-row depth tracking, row/column aggregate
  emphasis, and render node depth are centralized in `renderDisplay.ts`, so
  `usePivotRenderModel.ts` no longer owns those render-node display callbacks
  inline.
- Selection-filtered form-data construction is centralized in
  `initialUpdatePlan.ts`, so the chart and dimension-filter value hook no
  longer duplicate extra-filter merge and normalization policy.
- `PivotTableView` emits semantic visible row-depth count for export, so the
  export path no longer scans cloned DOM rows to infer how many hierarchy
  columns are visible.
- Pending seamless layout refresh keeps a display snapshot instead of freezing
  the whole view prop bundle.
- `PivotTableView` emits explicit row-export values and subtotal-row export
  markers, so the export path no longer scans row depth markers, row labels, or
  following sibling rows to reconstruct the visible row hierarchy.
- Render no longer emits per-row depth export markers. Export only keeps the
  table-level visible row-depth count and the explicit row-export value model.

## Remaining Risk

- `PivotTableChart.tsx` is no longer the largest file, but it remains the
  largest chart-owned orchestration surface. It handles committed tree/fact
  sync, local runtime layout state, dashboard persistence, interaction callback
  wiring, and stale recovery.
- `useExpansionEngine.ts` still owns request kickoff and sequencing. Repeated
  state-ref synchronization and tree/expanded/pending commits are centralized,
  but more helper extraction is useful only if it deletes more hook code than it
  adds.
- `usePivotLayout.ts` is now mostly a composition hook around pure layout
  helpers. `usePivotRenderModel.ts` still carries formatting value maps,
  sorting, and render-model assembly.
- Large result sets still run JSON parsing and React commits on the main thread.
  Chunked ingestion/materialization reduces monopolization but does not make
  the full commit non-blocking.
- Export no longer clones/reshapes the rendered DOM table, uses `table_to_book`,
  reads rendered DOM metadata on the normal v3 workbook path, or emits export
  metadata attributes into the rendered table. Row-depth semantic repair,
  missing-depth fallback, DOM-row depth-count inference, sibling-row hierarchy
  reconstruction, render-owned row-export hierarchy projection, and the
  production HTML-table export builder are gone. A DOM-metadata fallback remains
  for unregistered tables/tests until the last entrypoint coverage is proven.

## Current Hotspots

Largest relevant production files:

- `PivotDndMetricSelect.tsx`: `1566` lines.
- `engine.ts`: `1496` lines.
- `PivotMetricDefinitionValue.tsx`: `1448` lines.
- `utils.ts`: `1429` lines.
- `PivotTableChart.tsx`: `1424` lines.
- `materializePivotTree.ts`: `1329` lines.
- `usePivotFormatting.tsx`: `1325` lines.
- `useExpansionEngine.ts`: `1321` lines.
- `PivotInteractionPanel.tsx`: `1186` lines.
- `PivotDndColumnSelect.tsx`: `1109` lines.
- `controlPanel.tsx`: `1038` lines.
- `usePivotLayout.ts`: `804` lines.
- `PivotTableView.tsx`: `899` lines.
- `usePivotRenderModel.ts`: `542` lines.

Not all large files are equal for this refactor. The next high-impact files are
`engine.ts`, `PivotTableChart.tsx`, `usePivotLayout.ts`,
`usePivotRenderModel.ts`, and the export/materialization boundary.
`useExpansionEngine.ts` is no longer the top hotspot, but it still has React
commit sequencing risk. Control components are large but less central to the
pure runtime boundary unless they delete runtime-layout translation code.

## Next Work, Highest Impact First

1. Remove chart-owned runtime sync branches that duplicate runtime coverage or
   materializer truth.

   Target examples: committed tree/fact sync effects, stale dashboard recovery
   signatures, and local layout/filter persistence branches in
   `PivotTableChart.tsx`. Do not split a controller just to move code; the slice
   must delete chart logic or reduce a runtime decision surface.

2. Reduce `useExpansionEngine.ts` hydration/request orchestration only where the
   helper is deletion-positive.

   Shared tree/expanded/pending commits are now batched. Good remaining targets:
   request kickoff wiring and finalization policy that can delete hook code. Bad
   targets: creating another controller file that only moves refs out of sight.

3. Continue Gate 6 render/layout cleanup where behavior is already proven
   axis-neutral.

   Good targets: duplicated row/column child policy, render-time subtotal or
   metric-placement branches, and render-model-only compatibility state. Avoid
   changing subtotal/header UX without an explicit approval checkpoint.

4. Finish export model cleanup.

   V3 export now writes an XLSX worksheet model directly instead of passing a
   cloned table to `table_to_book`, and it consumes render-emitted row export
   values instead of reconstructing row hierarchy from DOM siblings. The view
   now registers the worksheet model for the export utility. The next export
   slice should prove all v3 export entrypoints receive a registered model and
   then delete the DOM-metadata fallback.

5. Keep every runtime helper under a deletion obligation.

   New helpers are acceptable only when they remove more old production code in
   the same slice or make a tested behavior boundary materially clearer.

## Approval Checkpoints

Bring these back before taking the behavior change:

- **Rendered metric-index compatibility.** Fully trusting layout-owned metric
  placement instead of scanning rendered tree nodes can change visible header or
  subtotal ordering. This is likely worthwhile, but it needs a named UX decision.
- **Row subtotal simplification.** Row subtotals still carry historical
  placement/label rules. Any simplification that changes displayed ordering,
  indentation, or labels needs approval.
- **Expansion persistence reset rules.** Resetting expansion state more
  aggressively on semantic layout changes could delete code, but it changes
  dashboard restore behavior.
- **Large-result commit strategy.** Moving materialization or commit work to a
  worker/transition lane may change loading timing and should be planned as an
  interactivity change, not a local cleanup.

Already resolved:

- Rendered row export depth is now semantic and zero-based; export no longer
  normalizes one-based depth markers or fills missing depth markers as root
  rows.
- Metric-order-only UI changes now commit locally instead of being vetoed by the
  chart when query form data is stale. Runtime coverage still decides whether a
  fetch is needed.
- Expanding a visible semantic dimension must fetch even if the current
  materialized node has `hasChildren: false`.
- Fetched state no longer comes from scanning materialized branch trees.
- Query depth and fetch params no longer accept `currentTree`.
- Layout transitions no longer project child aggregate values, fetched coverage,
  or deep tree shape across semantic trims.

## Testing And Validation

Prefer focused Jest/RTL tests over Cypress. For this plugin, broad Jest can
leave many hanging node processes, so default to serialized focused runs:

```bash
cd superset-frontend
node_modules/.bin/eslint plugins/plugin-chart-pivot-table-v3/<paths>
node_modules/.bin/jest --runInBand --forceExit --silent <test files>
node_modules/.bin/prettier --write <changed files>
git diff --check
```

Recent validation:

- `bafc60ffb9`: removed the rendered table export metadata attributes from
  `PivotTableView.tsx` and moved the affected tests to the registered worksheet
  model; touched-file ESLint, Prettier, `git diff --check`, focused
  render/chart/export Jest (`14` tests), and the full pivot-table-v3 plugin plus
  export utility Jest suite (`95` suites, `778` tests) passed.
- `45b97e4c69`: registered worksheet export data from `PivotTableView` so the
  export utility consumes the render/runtime worksheet model instead of parsing
  rendered table metadata on the normal path; touched-file ESLint, Prettier,
  `git diff --check`, focused export utility/model/render Jest (`27` tests),
  and the full pivot-table-v3 plugin plus export utility Jest suite (`95`
  suites, `778` tests) passed.
- `8a0d03228e`: deleted the production HTML-table export builder so v3
  production export exposes only worksheet-cell generation; touched-file
  ESLint, Prettier, `git diff --check`, focused export model/utility Jest (`14`
  tests), and the full pivot-table-v3 plugin plus export utility Jest suite
  (`95` suites, `777` tests) passed.
- `27f6baa2bd`: moved v3 Excel export from a cloned DOM table plus
  `table_to_book` to explicit worksheet cells and `aoa_to_sheet`; touched-file
  ESLint, Prettier, `git diff --check`, focused export utility/model/render
  Jest (`26` tests), and the full pivot-table-v3 plugin plus export utility
  Jest suite (`95` suites, `777` tests) passed.
- `6b70916730`: extracted the semantic row export model from
  `PivotTableView.tsx` into the export boundary and reused it in the export
  tests; touched-file ESLint, Prettier, `git diff --check`, focused
  export/render/chart Jest (`25` tests), and the full pivot-table-v3 plugin
  Jest suite (`94` suites, `776` tests) passed.
- `71a3f01992`: merged the stale-dashboard recovery and persisted-filter replay
  seamless update effects while preserving their evaluation order; touched-file
  ESLint, Prettier, `git diff --check`, focused chart-sync/runtime Jest (`76`
  tests), and the full pivot-table-v3 plugin Jest suite (`94` suites, `776`
  tests) passed.
- `de63dbe030`: preserved Excel numeric export typing when a table has no
  row-axis export metadata; touched-file ESLint, Prettier, `git diff --check`,
  and focused export/render/chart Jest (`25` tests) passed. The full
  pivot-table-v3 plugin Jest suite also passed (`94` suites, `776` tests).
- `bd8b29c520`: merged persisted selected-filter pending-settlement and state
  sync into one chart effect; touched-file ESLint, Prettier,
  `git diff --check`, focused filter/runtime Jest (`18` tests), and focused
  chart-sync/runtime Jest (`76` tests) passed. The full pivot-table-v3 plugin
  Jest suite also passed (`94` suites, `775` tests).
- `11c9593425`: simplified dimension removal in the interaction layout helper
  to return the runtime layout directly; touched-file ESLint, Prettier,
  `git diff --check`, and focused interaction drag/layout Jest (`32` tests)
  passed.
- `2a29b350a0`: removed unused drag-removal axis/index metadata from the
  interaction layout helper; touched-file ESLint, Prettier, `git diff --check`,
  and focused interaction drag/layout Jest (`32` tests) passed.
- `d8fac22ff6`: narrowed the runtime-layout sync API to the combined plan and
  deleted the now-redundant exported predicate/test surface; touched-file
  ESLint, Prettier, `git diff --check`, and focused chart-sync/runtime Jest
  (`53` tests) passed. The full pivot-table-v3 plugin Jest suite also passed
  (`94` suites, `775` tests).
- `7e724e895b`: centralized runtime-layout prop sync planning in the seamless
  runtime module; touched-file ESLint, Prettier, `git diff --check`, focused
  chart-sync/runtime Jest (`55` tests), and the full pivot-table-v3 plugin Jest
  suite (`94` suites, `777` tests) passed.
- `c2c37db817`: emitted semantic visible row-depth count from
  `PivotTableView` and consumed it in export; touched-file ESLint, Prettier,
  `git diff --check`, focused export/render/chart Jest (`24` tests), and the
  full pivot-table-v3 plugin Jest suite (`94` suites, `774` tests) passed.
- `78aabd4121`: centralized selection-filtered form-data construction in
  `initialUpdatePlan.ts`; touched-file ESLint, Prettier, `git diff --check`,
  focused update/filter/chart Jest (`12` tests), and the full pivot-table-v3
  plugin Jest suite (`94` suites, `773` tests) passed.
- `1e34d0a919`: tightened the render node display helper to reuse the typed
  layout result and reduce production source after the extraction; touched-file
  ESLint, Prettier, `git diff --check`, focused render/display Jest (`20`
  tests), and the full pivot-table-v3 plugin Jest suite (`94` suites, `772`
  tests) passed.
- `7f1f21097b`: centralized render node display policy in
  `renderDisplay.ts`; touched-file ESLint, Prettier, `git diff --check`,
  focused render/display Jest (`20` tests), and the full pivot-table-v3 plugin
  Jest suite (`94` suites, `772` tests) passed.
- `c83ca5b278`: centralized render date-label formatting in
  `renderDisplay.ts`; touched-file ESLint, Prettier, `git diff --check`,
  focused render/display Jest (`18` tests), and the full pivot-table-v3 plugin
  Jest suite (`94` suites, `770` tests) passed.
- `c1bf9fa903`: centralized render display policy in `renderDisplay.ts`;
  touched-file ESLint, Prettier, `git diff --check`, focused render/display
  Jest (`15` tests), and the full pivot-table-v3 plugin Jest suite (`94`
  suites, `767` tests) passed.
- `378459743f`: centralized row subtotal layout policy in
  `layoutRuntime.ts`; touched-file ESLint, Prettier, `git diff --check`,
  focused layout/metric-tier Jest (`18` tests), and the full pivot-table-v3
  plugin Jest suite (`93` suites, `763` tests) passed.
- `27078df0a0`: centralized collapsed Values layout policy in
  `layoutRuntime.ts`; touched-file ESLint, Prettier, `git diff --check`,
  focused layout/metric-tier Jest (`16` tests), and the full pivot-table-v3
  plugin Jest suite (`93` suites, `761` tests) passed.
- `7333feeb08`: centralized axis child layout policy in `layoutRuntime.ts`;
  touched-file ESLint, Prettier, `git diff --check`, focused layout/metric-tier
  Jest (`14` tests), and the full pivot-table-v3 plugin Jest suite (`93`
  suites, `759` tests) passed.
- `11525dd916`: centralized applied runtime layout projection in
  `resolveInteractionLayout.ts`; touched-file ESLint, Prettier,
  `git diff --check`, focused interaction/layout Jest (`29` tests), and the
  full pivot-table-v3 plugin Jest suite (`93` suites, `757` tests) passed.
- `9fc48a2d09`: centralized metric-axis layout policy in
  `layoutRuntime.ts`; touched-file ESLint, Prettier, `git diff --check`,
  focused layout/metric-tier Jest (`23` tests), and the full pivot-table-v3
  plugin Jest suite (`93` suites, `755` tests) passed.
- `18f5a03252`: touched-file ESLint passed for `useExpansionEngine.ts`;
  focused Jest passed for persisted prefetch, stale prefetch, initial-depth
  prefetch, and cross-axis expansion guardrails (`5` suites).
- `c9535fef2b`: touched-file ESLint passed for
  `buildPivotV3ExportTable.ts` and export tests; focused Jest passed for export
  table behavior and chart smoke guardrails (`16` tests).
- `33ff2bf04b`: touched-file ESLint passed for
  `buildPivotV3ExportTable.ts`, `PivotTableView.tsx`, export tests, and the
  basic chart smoke suite; focused Jest passed for export table behavior and the
  chart smoke guardrails (`17` tests).
- `a03baf30b7`: touched-file ESLint passed for
  `PivotTableChart.tsx`, `runtime/coverage.ts`, and
  `interaction-layout.test.tsx`; focused Jest passed for interaction layout,
  runtime coverage, and layout-fetch decision tests (`70` tests).
- `18914bb1ca`: touched-file ESLint passed for branch/batch fetch modules;
  focused Jest passed for branch fetch, batch fetch, and affected
  prefetch/expansion-state suites (`79` tests).
- `61f63d7876`: focused expansion/prefetch/layout batches passed (`167`
  selected tests), and dashboard 12 expansion was verified in the browser after
  the tree-shape fetched-coverage cleanup.
- `b732814384`: touched-file ESLint passed, `git diff --check` passed, and
  focused Jest passed for totals columns, metrics-between regressions, export,
  chart smoke/layout/filter-seamless, fact store, branch fetch, and batch fetch
  guardrails (`113` tests).
- `3862895b84`: touched-file ESLint passed, `git diff --check` passed, and
  focused Jest passed for fetched coverage, metrics-between regressions, totals
  columns, chart smoke/layout/filter-seamless, fact store, branch fetch, and
  batch fetch guardrails (`105` tests).
- `8e1489d4e5`: fixed runtime-layout coverage gating for same-root-depth
  additions versus exact-coverage trims; touched-file ESLint, Prettier,
  `git diff --check`, the six-suite chart/runtime guardrail (`81` tests), and
  the full pivot-v3 plugin Jest run (`89` suites, `700` tests) passed.
- `1e968ea67e`: moved dashboard upstream query-context signature construction
  into the seamless runtime module; touched-file ESLint, Prettier,
  `git diff --check`, and focused seamless runtime/filter tests (`8` tests)
  passed.
- `44dbf87817`: centralized fetched-result loaded metric-node coverage seeding
  in `useExpansionEngine.ts`; touched-file ESLint, Prettier, `git diff --check`,
  and focused fetched-requests, seamless expansion, and satisfied-prefetch tests
  (`36` tests) passed.
- `aa8d14b0dc`: moved committed-props sync and stale dashboard coverage recovery
  predicates into the seamless runtime module; touched-file ESLint, Prettier,
  `git diff --check`, focused seamless runtime/filter/layout tests (`33` tests),
  and the five-suite chart-sync guardrail (`68` tests) passed.
- `bdaf32dc90`: moved persisted-filter seamless reload policy into the seamless
  runtime module; touched-file ESLint, Prettier, `git diff --check`, and focused
  seamless runtime/filter tests (`11` tests) passed.
- `344d17dc17`: moved persisted selected-filter local sync policy into the
  seamless runtime module; touched-file ESLint, Prettier, `git diff --check`,
  focused seamless runtime/filter/layout tests (`35` tests), and the five-suite
  chart-sync guardrail (`70` tests) passed.
- `83f6ef84b1`: moved runtime-layout prop sync policy into the seamless runtime
  module; touched-file ESLint, Prettier, `git diff --check`, and focused
  seamless runtime/filter/layout tests (`37` tests) passed.
- `83b84e9cf2`: centralized selected-filter update helpers in `pivot/filters.ts`
  and reused the shared selected-filter predicate from the seamless runtime
  module; touched-file ESLint, Prettier, `git diff --check`, and focused
  seamless runtime/filter/layout tests (`43` tests) passed.
- `349ea1ed61`: centralized persisted selected-filter normalization in
  `pivot/filters.ts` and removed the chart-only dimension map; touched-file
  ESLint, Prettier, `git diff --check`, and focused seamless runtime/filter
  tests (`21` tests) passed.
- `7b1548eb6c`: centralized tree-derived dimension filter value collection in
  `pivot/filters.ts`; touched-file ESLint, Prettier, `git diff --check`, and
  focused filter helper plus chart filter-seamless tests (`13` tests) passed.
- After the filter cleanup checkpoint, the full pivot-table-v3 plugin Jest suite
  passed (`89` suites, `712` tests).
- `f6e5445750`: centralized runtime-layout change actions in the seamless
  runtime module; touched-file ESLint, Prettier, `git diff --check`, and the
  chart-sync/runtime guardrail (`86` tests) passed.
- `d1b985b012`: centralized stale dashboard runtime actions in the seamless
  runtime module; touched-file ESLint, Prettier, `git diff --check`, and the
  chart-sync/runtime guardrail (`87` tests) passed.
- After the runtime-action checkpoint, the full pivot-table-v3 plugin Jest suite
  passed (`89` suites, `715` tests).
- `50392546d7`: centralized hydration prefetch action decisions in the expansion
  engine; touched-file ESLint, Prettier, `git diff --check`, and focused
  expansion/prefetch guardrails (`53` tests) passed.
- `524d54a0fd`: moved initial hydration prefetch planning into the expansion
  engine, leaving the hook to execute the returned action; touched-file ESLint,
  Prettier, `git diff --check`, and focused expansion/prefetch guardrails
  (`54` tests) passed.
- `bf7c3478d5`: extracted dimension filter search/value fetching into
  `useDimensionFilterValues`; touched-file ESLint, Prettier, `git diff --check`,
  focused hook/filter-search tests (`9` tests) passed.
- After the dimension filter checkpoint, the full pivot-table-v3 plugin Jest
  suite passed (`90` suites, `721` tests).
- `1cd6e74a8a`: centralized interaction chip construction and dimension-removal
  layout policy in `interactionDrag.ts`; touched-file ESLint, Prettier,
  `git diff --check`, and focused interaction layout tests (`32` tests) passed.

Minimum test coverage for future slices:

- Query/coverage changes: runtime coverage, query specs, branch fetch, batch
  fetch, and at least one chart interaction suite.
- Expansion changes: expansion planner, expansion engine, fetched requests,
  prefetch suites, and one live chart interaction suite.
- Render/layout changes: render model, interaction layout, totals/metrics
  suites relevant to the touched policy.
- Export changes: export table tests plus at least one render/chart test that
  proves the DOM attributes export consumes are emitted in their semantic form.
- Chart sync changes: interaction layout, interaction seamless expansion,
  interaction filter seamless, and runtime coverage.

## Success Definition

The refactor is complete when:

- the same compiled program drives query planning, materialization, expansion,
  rendering, and export;
- all loaded/fetched decisions come from explicit fact coverage or pending
  coverage, not tree shape;
- all semantic tree materialization is inside `materializePivotTree`;
- render code does not repair missing semantic nodes;
- chart code does not override runtime coverage/materialization decisions;
- branch and layout fetches remain targeted and do not globally block table
  interaction;
- aggregate values are never synthesized from rendered cells; and
- the largest old production files keep shrinking rather than being offset by
  new runtime surface.
