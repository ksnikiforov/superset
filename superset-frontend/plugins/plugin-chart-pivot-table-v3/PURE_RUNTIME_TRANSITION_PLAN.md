# Pivot v3 Pure Runtime Transition

Main tracker for the current transition plan. Update this Markdown file on every pivot v3 runtime change, including tests, metrics, status rows, constraints, and execution order when the change alters transition progress or validation state.

Done items stay in place and use strikethrough; do not move them into a separate archive.

## Goal

Finish the transition to a pure pivot runtime with fewer authority layers and a smaller core engine. Only fetches, fact-store mutation, and persistence should have side effects. Tree nodes and rendered cells are projections, not canonical state.

## Target Pipeline

```text
form data + UI intent
  -> compilePivotProgram
  -> build required visible coverage
  -> diff against PivotFactStore coverage
  -> plan transport batches for missing coverage
  -> fetch DB aggregate facts
  -> ingest exact fact batches into PivotFactStore
  -> materializePivotTree
  -> render/export
```

## Summary

| Metric          | Value           | Note                                   |
| --------------- | --------------- | -------------------------------------- |
| Active tasks    | 2                  | 1 in progress, 1 not done              |
| Completed tasks | 15                 | Crossed out in the progress table      |
| Plugin tests    | Green              | 89 suites, 700 tests passed            |
| Next best move  | Render/export projection parity | Remove remaining export-side structural assumptions |

## Current Metrics

Baseline: `7088db374448845ef6e71cf74817aa53efbc5fc1`

Latest slice delta: measured from `HEAD`, **-74** production `src` lines (`+159` / `-233`). Metric/header/subtotal structures are materialized before render traversal: collapsed metric aliases, column subtotal metric aliases, row subtotal parent links, and visible measure-leaf rows are present in the tree instead of synthesized by `renderModel.ts`.

| Scope                         | Baseline Lines | Current Lines |  Delta | Target          |
| ----------------------------- | -------------: | ------------: | -----: | --------------- |
| Full production `src`         |         33,510 |        26,464 | -7,046 | <20,000         |
| Strict core pipeline          |         12,907 |        10,507 | -2,400 | <8,000          |
| Core pipeline dirs diagnostic |          8,698 |         7,711 |   -987 | Lower over time |

## Progress Tracker

| Item                                                                 | Status      | Current Problem                                                                                                                  | Impact | Difficulty  | Confidence | Ease | ICE | Success Criteria                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -----: | ----------- | ---------: | ---: | --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Query-context-scoped fact matching~~                               | Done        | Previous risk was fact-store coverage reuse across filtered, unfiltered, and time-offset query contexts.                         |     10 | Done        |          8 |    7 | 560 | Filtered, unfiltered, and time-offset fact batches cannot satisfy each other, and the upstream signature test passes with the intended filter shape.                                                                                  |
| ~~Fix failing upstream query-context signature test~~                | Done        | Previous test expectation used normalized dashboard filter shape instead of Superset adhoc filter shape.                         |      9 | Done        |          9 |    9 | 729 | The expected signature intentionally preserves Superset adhoc filters; `seamlessRuntimeUpdate.test.ts` passes.                                                                                                                        |
| ~~Keep plugin test suite green~~                                     | Done        | Previous checkout had one failing query-context signature test.                                                                  |     10 | Done        |          8 |    8 | 640 | `npm test plugins/plugin-chart-pivot-table-v3` passes with `0` failed suites/tests.                                                                                                                                                   |
| ~~Reduce expansion scheduler state in `useExpansionEngine.ts`~~      | Done        | Previous risk was hydration planning, loading-key derivation, reinit decisions, and complete/fetch branching living in the hook. |      9 | Done        |          8 |    5 | 360 | `useExpansionEngine.ts` no longer owns separate request lifecycle, loading-key derivation, hydration planning, or hydration execution branches; those live in manifest, executor, and transition helpers with tests.                  |
| ~~Remove duplicated row/column hydration orchestration~~             | Done        | Previous risk was mirrored row and column planning paths drifting apart during hydration/reinitialization cleanup.               |      9 | Done        |          7 |    4 | 252 | Row and column hydration planning uses one shared axis-parameterized execution path; remaining axis branches only select axis data, and row-only plus column-only tests guard opposite-root behavior.                                 |
| ~~Separate materializer tree construction from subtotal injection~~  | Done        | Previous risk was `materializePivotTree.ts` building semantic nodes and injecting subtotal leaves in the same flow.              |      8 | Done        |          7 |    3 | 168 | Fact-tree construction can run without subtotal injection; subtotal injection is isolated behind one narrow tested projection step, and non-root configured subtotal leaves are not repaired by render.                                |
| ~~Separate materializer tree construction from measure-axis projection~~ | Done    | Previous risk was caller-side measure-axis flags spreading hidden leaf and single-metric policy outside the projection owner.     |      9 | Done        |          6 |    3 | 162 | Measure-axis projection policy has one tested owner; caller-side preserve/promote flags are removed, and single-metric plus measure-leaf behavior is preserved by focused tests.                                                     |
| ~~Separate semantic materialization from display labeling~~          | Done        | Previous risk was date/display label formatting being duplicated inside semantic and measure-axis node construction.              |      7 | Done        |          7 |    5 | 245 | Dimension display formatting has one materializer helper used by fact-tree and measure-axis projections; semantic path/depth/coverage construction no longer owns duplicated formatter branches, and label/date behavior is preserved by tests. |
| ~~Remove metric/header/subtotal inference from `renderModel.ts`~~    | Done        | Previous risk was render inventing collapsed metrics, subtotal/header aliases, and row subtotal parentage from missing tree structure. |      9 | Done        |          6 |    3 | 162 | Render model no longer invents metric/subtotal/header nodes; tests prove those structures are present before render traversal and are not recovered in render code.                                                                   |
| Make render/export pure projections over materialized tree           | Not done    | Render and export still have separate structural assumptions and repair-like behavior.                                           |      9 | Hard        |          5 |    3 | 135 | Render and export consume the same materialized semantic tree with no divergent structural reconstruction, fallback subtotal synthesis, or metric/header repair path.                                                                 |
| Shrink `PivotTableChart.tsx` runtime coordination                    | In progress | Chart still coordinates seamless runtime sync, expansion, layout state, filtering, and materialization boundaries.               |      7 | Medium-hard |          7 |    4 | 196 | Chart code wires hooks and props only; loaded-state, materialization, query-context, and expansion decisions live in runtime, expansion, materialization, or interaction modules, and the slice deletes more chart code than it adds. |
| ~~Compiled pivot program owns layout semantics~~                     | Done        | Previous risk was multiple places interpreting pivot layout semantics independently.                                             |     10 | Done        |          9 |   10 | 900 | Layout semantics flow through `compilePivotProgram`; no equivalent parallel semantic compiler remains.                                                                                                                                |
| ~~Initial root coverage lives in coverage layer~~                    | Done        | Previous root-load behavior was partly embedded in query planning.                                                               |      9 | Done        |          9 |   10 | 810 | Initial query planning consumes coverage needs from the coverage layer.                                                                                                                                                               |
| ~~Pre-expansion compiles into manifest coverage~~                    | Done        | Previous pre-expand behavior could act like a separate loading model.                                                            |      9 | Done        |          9 |   10 | 810 | Configured pre-expand levels produce manifest coverage needs like manual expansion.                                                                                                                                                   |
| ~~Manual/persisted expansion hydration is manifest-planned~~         | Done        | Previous hydration risk was deriving fetch needs from tree shape.                                                                |     10 | Done        |          9 |   10 | 900 | Hydration derives required coverage from explicit intent plus configured needs, then diffs through manifest coverage.                                                                                                                 |
| ~~Fact store owns loaded coverage~~                                  | Done        | Previous loaded state could be inferred from tree shape or chart state.                                                          |     10 | Done        |          9 |   10 | 900 | Loaded state is represented by fact batches/selectors; planning checks fact-store coverage.                                                                                                                                           |
| ~~Update transition-plan metrics~~                                   | Done        | Plan line counts must stay current so progress accounting is not misleading.                                                     |      4 | Easy        |         10 |   10 | 400 | The plan reflects measured current full `src`, strict core, diagnostic core dirs, and latest-slice delta.                                                                                                                             |

## Constraints And Gates

| Constraint                                             | Tracking State | Current Problem                                                                                                 | Current                     | Target          | Passing Criteria                                                                                                                             |
| ------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Full production `src` size                             | Above target   | Source is smaller than baseline but still above the transition target.                                          | 26,464 lines                | <20,000 lines   | Final transition state is below target without moving production authority into test fixtures or compatibility adapters.                     |
| Strict core pipeline size                              | Above target   | Core still contains too much scheduler/materializer/render-policy code.                                         | 10,507 lines                | <8,000 lines    | Runtime, expansion, query, layout/core, domain helper, and support scope total is below target.                                              |
| Diagnostic core dirs size                              | Watch          | Core pipeline dirs are below baseline but grew in this slice to remove render-side authority.                   | 7,711 lines                 | Lower over time | `pivot/runtime`, `pivot/expansion`, `pivot/query`, `pivot/layout`, and `pivot/core` do not grow without deleting a larger authority surface. |
| Plugin test suite                                      | Guarded        | Plugin tests pass after metric/header/subtotal inference was moved out of render.                              | 89 suites, 700 tests passed | 0 failing tests | `npm test plugins/plugin-chart-pivot-table-v3` passes.                                                                                       |
| Hidden/not-expanded layers do not fetch                | Guarded        | Must remain true while scheduler and materializer code are reduced.                                             | Guarded by tests            | Always true     | Adding a hidden trailing dimension or collapsed layer does not create a query need.                                                          |
| Semantic layout changes are query-backed               | Guarded        | Local projection from old facts must not reappear during cleanup.                                               | Guarded by tests            | Always true     | Semantic layout changes fetch or reuse tested fact-store coverage; they are not projected from stale tree shape.                             |
| Interactions stay live during requests/materialization | Guarded        | Async fetch/materialization boundaries must survive further deletion.                                           | Guarded by chart tests      | Always true     | Interaction tests pass while expansion/seamless requests and async materialization are in progress.                                          |
| Query planning only through coverage                   | Gap            | The tracker must prevent new direct query-planning branches from bypassing coverage needs and manifest diffing. | Manual/code review          | Always true     | No production query-planning path bypasses coverage needs, `diffCoverageManifest`, or fact-store selectors.                                  |
| Batching remains transport-only                        | Review         | Batching can accidentally become another runtime state model while fetch execution is simplified.               | Manual/code review          | Always true     | Batching only groups transport requests; loaded state remains fact-store coverage selectors and never batch names or request groups.         |
| Materialization boundary is exclusive                  | Guarded        | Subtotal, measure-axis, display-label, collapsed metric, and subtotal alias projection boundaries are guarded; export boundaries still need cleanup. | Mostly true                 | Always true     | Semantic tree construction happens only through `materializePivotTree` materializer paths; other code consumes trees as projections.         |
| Render/export do not repair semantics                  | Gap            | Render no longer synthesizes metric/header/subtotal structure; export assumptions remain to be paid down.       | Partially true              | Always true     | Render/export traverse materialized semantics and do not invent missing metric/subtotal/header structure.                                    |
| No compatibility adapters without net deletion         | Review         | Short-term adapters can hide duplicate authority if not constrained.                                            | Manual review               | Always true     | Any adapter added in a slice deletes a larger old surface in the same slice.                                                                 |
| Source reduction is authority reduction                | Review         | Line-count targets can be gamed by moving code instead of deleting duplicate authority.                         | Manual review               | Always true     | Source reductions delete or centralize authority; they do not relocate it into controllers, adapters, fixtures, or chart-side orchestration. |
| Pre-push validation                                    | Not run        | Full pre-commit has not been run for this assessment.                                                           | Not run                     | Passing         | Stage changes, run `pre-commit run --all-files`, fix failures, and rerun before pushing.                                                     |

## Architecture Rules

- `root` coverage means no branch filter, not all possible paths.
- `paths` coverage means only listed visible/expanded branches.
- `scopedFull` coverage means full expansion only inside explicit ancestors.
- Pre-expand levels compile to the same manifest shape as manual expansion.
- Row x column expansion creates explicit intersection coverage needs.
- Batching is a query transport optimization, not a runtime state model.
- No unbounded full-level query unless the user action requests a bounded broad scope.
- Adding a hidden trailing dimension does not create a query need.
- Semantic layout changes fetch query-backed coverage, not local projections from old facts.
- Metric reorder can remain cosmetic when the selected metric set is unchanged.
- Broader loaded coverage may satisfy narrower needs only through tested dominance rules.

## Behavior Checkpoint

Single-metric base-cell propagation is not a safe deletion target. Removing it breaks visible single-metric cells, column subtotal values, databar/sorting offsets, and expansion subtotal cells. The rejected alternative was forcing single-metric pivots to always show the metric tier, so the current single-metric base-cell behavior must remain unless an explicit UX redesign is approved.

## Execution Order

Work from the highest-impact authority surface to the lowest-impact cleanup. A commit is successful only if it removes or clearly centralizes an authority surface while staying deletion-conscious.

1. ~~Reduce expansion scheduler state in `useExpansionEngine.ts`.~~
2. ~~Remove duplicated row/column hydration orchestration.~~
3. Isolate subtotal, measure-axis, and display-label behavior in `materializePivotTree.ts`.
4. ~~Remove metric/header/subtotal inference from `renderModel.ts`.~~
5. Shrink `PivotTableChart.tsx` only where code is deleted, not merely moved.

## Verification Standard

- Focused unit/contract tests for the touched runtime boundary.
- Relevant chart interaction tests when behavior crosses the UI surface.
- ESLint for changed TypeScript files.
- `git diff --check`.
- Updated metrics and status in this tracker on every change.

## Known Test Noise

- Jest reports duplicate manual mocks in the wider Superset frontend setup.
- Browserslist data is stale.
- Babel lodash emits an `isModuleDeclaration` deprecation warning.

These warnings are not pivot-table-v3 regressions, but test failures are.
