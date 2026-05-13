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
`11525dd916 refactor(pivot-table-v3): centralize applied runtime layout projection`:

- Overall transition estimate: **90%**.
- Goal-weighted completion estimate: **90%**.
- The runtime architecture exists and is used by the main paths.
- The project is roughly at line-count break-even, but not done.
- The remaining work is mostly deletion of old chart, expansion, and render
  interpretation paths.

Source-only diff from pre-refactor baseline
`7088db374448845ef6e71cf74817aa53efbc5fc1`:

- Production `src`: `11321` insertions, `11088` deletions, net `+233`.
- Current production `src` TypeScript/TSX total: `33743` lines.
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

The readout remains mixed: the new runtime files now put the plugin modestly
above the baseline line count, but the chart/layout hooks keep losing inline
policy and the added lines are isolated, tested runtime helpers rather than more
React orchestration.

## Gate Status

| Gate                                      | Completion | Current readout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gate 1: compiled layout model             |        74% | `PivotProgram` exists and drives many paths. Metric-axis insert positions, inferred metric indices, subtotal forcing, hidden metric headers, and metric expansion flags now live in a pure chart runtime helper. Applied runtime layout/formData projection for user-controlled charts now lives beside interaction layout normalization. `usePivotLayout` and interaction layout still translate some raw form/runtime layout into compatibility fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Gate 2: query planning from coverage      |        91% | Initial/root/branch/batch query paths use explicit coverage metadata. Bootstrap/root fact batches now seed fetched root expansion coverage. Branch and grouped-batch fetch params no longer expose tree shape. Remaining work is mostly support/totals coverage composition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Gate 3: central fact ingestion/store      |        92% | Fetch paths return fact batches, cache/fact-store hits use typed coverage, and ingestion is isolated. Compatible root/bootstrap coverage can now materialize branch specs without matching the original request scope while exact branch coverage remains authoritative. Remaining coupling is mostly tree-shaped chart/test boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Gate 4: one tree materializer             |        88% | `materializePivotTree.ts` owns fact-to-tree materialization, Values/metric/measure axes, subtotal leaf injection, and measure-leaf value application. Export no longer repairs row depth semantics, but still needs a cleaner model boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Gate 5: expansion reducer/runtime effects |        90% | Expansion no longer derives fetched state from rendered tree shape. It uses explicit fact coverage, semantic fetchability, shared fetch execution, and request lifecycles. Loaded terminal metric nodes and metric subtotal nodes now seed coverage through the fetched-coverage utility, fetched-result delta collection now seeds both fact batches and loaded metric-node coverage for same-axis and hydration paths, same-axis delta merge/stale-subtree preservation policy lives in the expansion engine, hydration delta staging/finalization policy lives in the expansion engine, expansion reinitialization trigger/effective-level policy lives in the expansion engine, persisted expansion visibility normalization lives in the expansion engine, expansion toggle/collapse pruning decisions live in the expansion engine, hydration iteration/cancellation policy lives in the expansion engine, and branch/batch fetch execution now lives in a dedicated expansion fetch executor. Initial hydration prefetch planning and prefetch action selection are also pure engine decisions. The hook still owns request kickoff and React commit sequencing. |
| Gate 6: pure render model                 |        89% | Projection drives toggle eligibility, collapsed Values, column display, visible-axis construction, semantic export row depth, and chart column-sort decisions. Databar scale grouping, waterfall offsets, bridge connectors, label-space sizing, databar column min-width policy, and metric-axis layout compatibility policy now live in pure chart helpers. Remaining risk is deeper row subtotal/child filtering policy and render-model display shaping.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Gate 7: chart component cleanup           |        75% | The chart delegates runtime fetch decisions and no longer vetoes metric-order-only commits or treats rendered tree signatures as seamless refetch identity. Seamless sync snapshots, upstream dashboard query-context signatures, committed-props sync predicates, stale coverage recovery predicates, persisted-filter seamless reload policy, persisted-selection local sync policy, runtime-layout prop sync policy, runtime-layout change actions, stale dashboard runtime actions, seamless persistence side-effect planning, pending display snapshot settlement policy, and applied runtime layout/formData projection now live outside the chart. Selected-filter update policy, persisted filter normalization, tree-derived filter value collection, dimension filter search/value fetch state, interaction chip construction, interaction DnD shell rendering, remove-dimension layout policy, and column-sort resolution/reconciliation are now outside the chart. The chart still owns committed tree/fact state, interaction callback wiring, and several controller-like effects. |

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
- Branch-cache entries store fact batches, not rendered trees.
- Measure-leaf value application is inside `materializePivotTree`.
- The chart no longer contains separate runtime-layout fetch predicates, stale
  coverage predicates, metric-order commit vetoes, or rendered tree signatures
  in seamless refetch identity.
- Dashboard upstream query-context signatures, committed-props sync predicates,
  stale coverage recovery predicates, and persisted-filter seamless reload
  policy are built in the seamless runtime module instead of in
  `PivotTableChart.tsx`. Persisted selected-filter local sync policy is also
  centralized there, along with runtime-layout prop sync policy.
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
- Selected-filter update helpers, persisted filter normalization, and
  tree-derived dimension filter value collection are centralized in
  `pivot/filters.ts`, so the chart no longer owns those filter policies.
- Dimension filter search/value request state and query construction are now
  isolated in `useDimensionFilterValues`, so the chart no longer owns the
  request versioning and loading bookkeeping for filter value menus.
- Interaction chip construction and dimension-removal layout updates are
  centralized in `interactionDrag.ts`, beside the other drag layout policies.
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
- Pending seamless layout refresh keeps a display snapshot instead of freezing
  the whole view prop bundle.
- `PivotTableView` emits semantic zero-based row depth for export, so the export
  path no longer guesses whether rendered depth markers need one-based repair.
  It also no longer fills missing row-depth markers as root rows.

## Remaining Risk

- `PivotTableChart.tsx` is no longer the largest file, but it is still the
  largest chart-owned orchestration surface. It handles committed tree/fact
  sync, local runtime layout state, dashboard persistence, interaction callback
  wiring, and stale recovery.
- `useExpansionEngine.ts` still owns request kickoff and React commit
  sequencing. More helper extraction is useful only if it deletes more hook code
  than it adds.
- `usePivotLayout.ts` still carries child filtering, collapsed Values
  projection, and row subtotal descendant policy. `usePivotRenderModel.ts` still
  carries column display shaping and sorting/display policy that is hard to
  separate from historical row/column presentation behavior.
- Large result sets still run JSON parsing and React commits on the main thread.
  Chunked ingestion/materialization reduces monopolization but does not make
  the full commit non-blocking.
- Export still clones and reshapes the rendered DOM table. Row-depth semantic
  repair and missing-depth fallback are gone, but export is not yet a sibling
  model derived directly from the same tree/program boundary as render.

## Current Hotspots

Largest relevant production files:

- `PivotDndMetricSelect.tsx`: `1566` lines.
- `engine.ts`: `1519` lines.
- `PivotTableChart.tsx`: `1467` lines.
- `utils.ts`: `1464` lines.
- `PivotMetricDefinitionValue.tsx`: `1448` lines.
- `materializePivotTree.ts`: `1329` lines.
- `usePivotFormatting.tsx`: `1325` lines.
- `useExpansionEngine.ts`: `1274` lines.
- `PivotInteractionPanel.tsx`: `1186` lines.
- `PivotDndColumnSelect.tsx`: `1109` lines.
- `controlPanel.tsx`: `1038` lines.
- `usePivotLayout.ts`: `1015` lines.
- `PivotTableView.tsx`: `808` lines.
- `usePivotRenderModel.ts`: `795` lines.

Not all large files are equal for this refactor. The next high-impact files are
`PivotTableChart.tsx`, `usePivotLayout.ts`, `usePivotRenderModel.ts`, and the
export/materialization boundary. `useExpansionEngine.ts` is no longer the top
hotspot, but it still has React commit sequencing risk. Control components are
large but less central to the pure runtime boundary unless they delete
runtime-layout translation code.

## Next Work, Highest Impact First

1. Remove chart-owned runtime sync branches that duplicate runtime coverage or
   materializer truth.

   Target examples: committed tree/fact sync effects, stale dashboard recovery
   signatures, and local layout/filter persistence branches in
   `PivotTableChart.tsx`. Do not split a controller just to move code; the slice
   must delete chart logic or reduce a runtime decision surface.

2. Reduce `useExpansionEngine.ts` hydration orchestration only where the helper
   is deletion-positive.

   Good targets: shared commit/finalization of fetched deltas, request kickoff
   wiring, and React commit sequencing. Bad targets: creating another
   controller file that only moves refs out of sight.

3. Continue Gate 6 render/layout cleanup where behavior is already proven
   axis-neutral.

   Good targets: duplicated row/column child policy, render-time subtotal or
   metric-placement branches, and render-model-only compatibility state. Avoid
   changing subtotal/header UX without an explicit approval checkpoint.

4. Finish export model cleanup.

   Export still uses a DOM clone to split the visible row hierarchy into Excel
   columns. That is acceptable for workbook shaping, but it should not infer
   semantic layout facts that render can emit directly. The next export slice
   should either consume a sibling model derived from the same tree/program
   boundary or delete another DOM-side compatibility rule.

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
