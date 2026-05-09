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

As of May 10, 2026, after
`a03baf30b7 refactor(pivot-table-v3): stop vetoing metric order commits`:

- Overall transition estimate: **81%**.
- Goal-weighted completion estimate: **80%**.
- The runtime architecture exists and is used by the main paths.
- The project is past line-count break-even, but not done.
- The remaining work is mostly deletion of old chart, expansion, and render
  interpretation paths.

Source-only diff from pre-refactor baseline
`7088db374448845ef6e71cf74817aa53efbc5fc1`:

- Production `src`: `7712` insertions, `9190` deletions, net `-1478`.
- Current production `src` TypeScript/TSX total: `32032` lines.
- Implied baseline `src` total: about `33510` lines.
- Added files: `+4228 / -0` across `15` files.
- Deleted files: `+0 / -1419` across `8` files.
- Modified files: `+3484 / -7771`, net `-4287`.
- Pre-existing production files are net `-5706`.

The readout is mixed but improving: the new runtime files still account for
`4228` added lines, while old production files have shrunk enough to leave the
plugin net-negative overall.

## Gate Status

| Gate                                      | Completion | Current readout                                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1: compiled layout model             |        72% | `PivotProgram` exists and drives many paths. `usePivotLayout` and interaction layout still translate raw form/runtime layout into compatibility fields.                                                                                              |
| Gate 2: query planning from coverage      |        90% | Initial/root/branch/batch query paths use explicit coverage metadata. Branch and grouped-batch fetch params no longer expose tree shape. Remaining work is mostly support/totals coverage composition.                                               |
| Gate 3: central fact ingestion/store      |        91% | Fetch paths return fact batches, cache/fact-store hits use exact coverage, and ingestion is isolated. Remaining coupling is mostly tree-shaped chart/test boundaries.                                                                                |
| Gate 4: one tree materializer             |        87% | `materializePivotTree.ts` owns fact-to-tree materialization, Values/metric/measure axes, subtotal leaf injection, and measure-leaf value application. Remaining work is export parity and module splits only if they delete callers.                 |
| Gate 5: expansion reducer/runtime effects |        78% | Expansion no longer derives fetched state from rendered tree shape. It uses explicit fact coverage, semantic fetchability, shared fetch execution, and request lifecycles. The hook still owns hydration iteration, cancellation, and React commits. |
| Gate 6: pure render model                 |        84% | Projection drives toggle eligibility, collapsed Values, column display, and visible-axis construction. Remaining risk is deeper row subtotal policy and some metric-index compatibility behavior.                                                    |
| Gate 7: chart component cleanup           |        52% | The chart delegates runtime fetch decisions and no longer vetoes metric-order-only commits. It still owns committed-tree sync, dimension filters, interaction wiring, and several controller-like effects.                                           |

## What Is Now Solid

- Flexible Values placement remains supported on rows or columns, first,
  middle, or last.
- Main query planning uses explicit fact coverage rather than full possible
  layout depth.
- Branch and batch fetch results describe loaded coverage through fact batches,
  not through materialized tree shape.
- Expansion planning asks the compiled pivot program whether a visible toggle
  can fetch a semantic child.
- No-dimension layouts require explicit root coverage before materialization.
- Branch-cache entries store fact batches, not rendered trees.
- Measure-leaf value application is inside `materializePivotTree`.
- The chart no longer contains separate runtime-layout fetch predicates, stale
  coverage predicates, or metric-order commit vetoes.
- Pending seamless layout refresh keeps a display snapshot instead of freezing
  the whole view prop bundle.

## Remaining Risk

- `PivotTableChart.tsx` is still the largest chart-owned orchestration surface.
  It handles committed tree/fact sync, local runtime layout state, dashboard
  persistence, dimension filters, interaction panel wiring, and stale recovery.
- `useExpansionEngine.ts` still owns hydration loops, cancellation boundaries,
  and React commit sequencing. More helper extraction is useful only if it
  deletes more hook code than it adds.
- `usePivotLayout.ts` and `usePivotRenderModel.ts` still carry render/layout
  policy that is hard to separate from historical row/column presentation
  behavior.
- Large result sets still run JSON parsing and React commits on the main thread.
  Chunked ingestion/materialization reduces monopolization but does not make
  the full commit non-blocking.
- Export parity is not yet fully proven against the same runtime/render model.

## Current Hotspots

Largest relevant production files:

- `PivotTableChart.tsx`: `2531` lines.
- `useExpansionEngine.ts`: `1702` lines.
- `usePivotFormatting.tsx`: `1632` lines.
- `PivotDndMetricSelect.tsx`: `1566` lines.
- `utils.ts`: `1464` lines.
- `PivotMetricDefinitionValue.tsx`: `1448` lines.
- `materializePivotTree.ts`: `1326` lines.
- `PivotInteractionPanel.tsx`: `1186` lines.
- `PivotDndColumnSelect.tsx`: `1109` lines.
- `usePivotLayout.ts`: `1071` lines.
- `PivotTableView.tsx`: `805` lines.
- `usePivotRenderModel.ts`: `801` lines.

Not all large files are equal for this refactor. The next high-impact files are
`PivotTableChart.tsx`, `useExpansionEngine.ts`, `usePivotLayout.ts`, and
`usePivotRenderModel.ts`. Control components are large but less central to the
pure runtime boundary unless they delete runtime-layout translation code.

## Next Work, Highest Impact First

1. Remove chart-owned runtime sync branches that duplicate runtime coverage or
   materializer truth.

   Target examples: committed tree/fact sync effects, stale dashboard recovery
   signatures, and local layout/filter persistence branches in
   `PivotTableChart.tsx`. Do not split a controller just to move code; the slice
   must delete chart logic or reduce a runtime decision surface.

2. Reduce `useExpansionEngine.ts` hydration orchestration only where the helper
   is deletion-positive.

   Good targets: shared commit/finalization of fetched deltas, hydration
   iteration state, and cancellation checks. Bad targets: creating another
   controller file that only moves refs out of sight.

3. Continue Gate 6 render/layout cleanup where behavior is already proven
   axis-neutral.

   Good targets: duplicated row/column child policy and render-time subtotal or
   metric-placement branches. Avoid changing subtotal/header UX without an
   explicit approval checkpoint.

4. Prove or remove export drift.

   Export should consume the same materialized tree/render model, or a sibling
   model derived from the same tree and program. It should not rebuild semantic
   layout from local rules.

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

Minimum test coverage for future slices:

- Query/coverage changes: runtime coverage, query specs, branch fetch, batch
  fetch, and at least one chart interaction suite.
- Expansion changes: expansion planner, expansion engine, fetched requests,
  prefetch suites, and one live chart interaction suite.
- Render/layout changes: render model, interaction layout, totals/metrics
  suites relevant to the touched policy.
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
