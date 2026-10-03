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

This slice fixes audited runtime correctness and simplifies ownership. `usePivotRuntime` replaces three cooperating hooks and publishes layout, filters, plan, facts, tree, and expansion state as one checkpoint; `ExpansionSession` handles request intent, deadlines, cancellation, and loading scopes. Seven copied Explore control implementations are replaced by shared Superset controls. Control acknowledgements, formatting compilation, and normalization each have one implementation. Shared cell visibility applies to screen and Excel, and worksheet projection runs only on export. NULL-path batching accumulates groups linearly. Collapse preserves pending layout/filter edits and reconciles refresh expansion against the incoming layout. Partial provenance belongs to materialized labels/values; the shared warning is derived from the rendered projection, without storing transport-warning history or changing export contents.

Historical Done rows below describe earlier slices. They do not establish completion of the transition or its size targets. The audit reopened fact-context matching, request ownership, truncation, and export correctness; those have dedicated regressions in this slice.

| Remaining work                                           | State        | Passing criterion                                                                                  |
| -------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| Full source and strict core size targets                 | Above target | Reduce authority and duplication without relocating them into adapters or fixtures.                |
| Expansion refresh adoption and completion policy         | Guarded      | The runtime owns one committed checkpoint; canceled or incomplete work cannot publish a candidate. |
| Shared total classification across presentation adapters | Partial      | Screen and Excel consume one total classification and label policy.                                |
| Large-table DOM bounds                                   | Deferred     | Establish stable column sizing and browser regressions before enabling row windowing.              |
| Live Superset / SQL smoke tests                          | Unverified   | Exercise expansion, time comparisons, metric edits, and Excel export against a running instance.   |

## Measured Source Scope

Audit baseline: `2b4819e0f2`. Count physical lines in `.ts` / `.tsx` files, including headers. Full source is `src`; core dirs are `pivot/runtime`, `pivot/expansion`, `pivot/query`, `pivot/layout`, and `pivot/core`. Strict core also includes `pivot/shared` and `cellUtils`, `metricsTotals`, `viewModel`, `measureLeaves`, `filters`, and `metrics`.

| Scope                  | Audit baseline | This slice |          Target |
| ---------------------- | -------------: | ---------: | --------------: |
| Full production source |         27,597 |     25,664 |         <20,000 |
| Strict core            |          9,823 |      9,469 |          <8,000 |
| Core dirs diagnostic   |          8,226 |      7,837 | Lower over time |

The previous tracker used different, undocumented counts. These measurements use a fixed comparison commit and an explicit scope. Full plugin source is down 1,933 lines (7.0%), controls are down 1,291 lines (23.9%), and runtime coordination is down 554 lines (35.1%). Runtime coordination counts the former layout-state, seamless-refresh, and expansion hooks against the unified runtime plus expansion session. These are net reductions against the audit baseline, including all replacement code and license headers; the full-source and strict-core targets remain unmet. Shared Superset component changes must also be included in the PR-wide production delta.

## Progress Tracker

| Item                                                                     | Status | Current Problem                                                                                                                            | Impact | Difficulty | Confidence | Ease | ICE | Success Criteria                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -----: | ---------- | ---------: | ---: | --: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Query-context-scoped fact matching~~                                   | Done   | Previous risk was fact-store coverage reuse across filtered, unfiltered, and time-offset query contexts.                                   |     10 | Done       |          8 |    7 | 560 | Filtered, unfiltered, and time-offset fact batches cannot satisfy each other, and the upstream signature test passes with the intended filter shape.                                                                                            |
| ~~Fix failing upstream query-context signature test~~                    | Done   | Previous test expectation used normalized dashboard filter shape instead of Superset adhoc filter shape.                                   |      9 | Done       |          9 |    9 | 729 | The expected signature intentionally preserves Superset adhoc filters; `seamlessRuntimeUpdate.test.ts` passes.                                                                                                                                  |
| ~~Keep plugin test suite green~~                                         | Done   | Previous checkout had one failing query-context signature test.                                                                            |     10 | Done       |          8 |    8 | 640 | `npm test plugins/plugin-chart-pivot-table-v3` passes with `0` failed suites/tests.                                                                                                                                                             |
| ~~Reduce expansion scheduler state in `useExpansionEngine.ts`~~          | Done   | Previous risk was hydration planning, loading-key derivation, reinit decisions, and complete/fetch branching living in the hook.           |      9 | Done       |          8 |    5 | 360 | `useExpansionEngine.ts` is deleted. The unified runtime owns the visible checkpoint; request lifetime and coverage planning remain in the session and planner.                                                                                  |
| ~~Remove duplicated row/column hydration orchestration~~                 | Done   | Previous risk was mirrored row and column planning paths drifting apart during hydration/reinitialization cleanup.                         |      9 | Done       |          7 |    4 | 252 | Row and column hydration planning uses one shared axis-parameterized execution path; remaining axis branches only select axis data, and row-only plus column-only tests guard opposite-root behavior.                                           |
| ~~Separate materializer tree construction from subtotal injection~~      | Done   | Previous risk was `materializePivotTree.ts` building semantic nodes and injecting subtotal leaves in the same flow.                        |      8 | Done       |          7 |    3 | 168 | Fact-tree construction can run without subtotal injection; subtotal injection is isolated behind one narrow tested projection step, and non-root configured subtotal leaves are not repaired by render.                                         |
| ~~Separate materializer tree construction from measure-axis projection~~ | Done   | Previous risk was caller-side measure-axis flags spreading hidden leaf and single-metric policy outside the projection owner.              |      9 | Done       |          6 |    3 | 162 | Measure-axis projection policy has one tested owner; caller-side preserve/promote flags are removed, and single-metric plus measure-leaf behavior is preserved by focused tests.                                                                |
| ~~Separate semantic materialization from display labeling~~              | Done   | Previous risk was date/display label formatting being duplicated inside semantic and measure-axis node construction.                       |      7 | Done       |          7 |    5 | 245 | Dimension display formatting has one materializer helper used by fact-tree and measure-axis projections; semantic path/depth/coverage construction no longer owns duplicated formatter branches, and label/date behavior is preserved by tests. |
| ~~Remove metric/header/subtotal inference from `renderModel.ts`~~        | Done   | Previous risk was render inventing collapsed metrics, subtotal/header aliases, and row subtotal parentage from missing tree structure.     |      9 | Done       |          6 |    3 | 162 | Render model no longer invents metric/subtotal/header nodes; tests prove those structures are present before render traversal and are not recovered in render code.                                                                             |
| ~~Make render/export pure projections over materialized tree~~           | Done   | Previous risk was export consuming raw cells, parallel visible arrays, and visible row order to reconstruct projected worksheet structure. |      9 | Done       |          5 |    3 | 135 | Render and export consume the same materialized semantic tree with no divergent structural reconstruction, fallback subtotal synthesis, or metric/header repair path.                                                                           |
| ~~Shrink `PivotTableChart.tsx` runtime coordination~~                    | Done   | Previous risk was chart owning view-surface assembly in addition to runtime hook orchestration.                                            |      7 | Done       |          7 |    4 | 196 | Chart code wires hooks and props only; loaded-state, materialization, query-context, and expansion decisions live in runtime, expansion, materialization, or interaction modules, and the slice deletes more chart code than it adds.           |
| ~~Compiled pivot program owns layout semantics~~                         | Done   | Previous risk was multiple places interpreting pivot layout semantics independently.                                                       |     10 | Done       |          9 |   10 | 900 | Layout semantics flow through `compilePivotProgram`; no equivalent parallel semantic compiler remains.                                                                                                                                          |
| ~~Initial root coverage lives in coverage layer~~                        | Done   | Previous root-load behavior was partly embedded in query planning.                                                                         |      9 | Done       |          9 |   10 | 810 | Initial query planning consumes coverage needs from the coverage layer.                                                                                                                                                                         |
| ~~Pre-expansion compiles into manifest coverage~~                        | Done   | Previous pre-expand behavior could act like a separate loading model.                                                                      |      9 | Done       |          9 |   10 | 810 | Configured pre-expand levels produce manifest coverage needs like manual expansion.                                                                                                                                                             |
| ~~Manual/persisted expansion hydration is manifest-planned~~             | Done   | Previous hydration risk was deriving fetch needs from tree shape.                                                                          |     10 | Done       |          9 |   10 | 900 | Hydration derives required coverage from explicit intent plus configured needs, then diffs through manifest coverage.                                                                                                                           |
| ~~Fact store owns loaded coverage~~                                      | Done   | Previous loaded state could be inferred from tree shape or chart state.                                                                    |     10 | Done       |          9 |   10 | 900 | Loaded state is represented by fact batches/selectors; planning checks fact-store coverage.                                                                                                                                                     |
| ~~Update transition-plan metrics~~                                       | Done   | Plan line counts must stay current so progress accounting is not misleading.                                                               |      4 | Easy       |         10 |   10 | 400 | The plan reflects measured current full `src`, strict core, diagnostic core dirs, and latest-slice delta.                                                                                                                                       |

## Constraints And Gates

| Constraint                                             | Tracking State | Current Problem                                                                                                        | Current                                                | Target          | Passing Criteria                                                                                                                             |
| ------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Full production `src` size                             | Above target   | Source is below the audit baseline but remains above the transition target.                                            | 25,664 lines                                           | <20,000 lines   | Final transition state is below target without moving production authority into test fixtures or compatibility adapters.                     |
| Strict core pipeline size                              | Above target   | Core still contains too much scheduler/materializer/render-policy code.                                                | 9,469 lines                                            | <8,000 lines    | Runtime, expansion, query, layout/core, domain helper, and support scope total is below target.                                              |
| Diagnostic core dirs size                              | Watch          | Core pipeline dirs shrank as separate expansion state ownership was removed.                                           | 7,837 lines                                            | Lower over time | `pivot/runtime`, `pivot/expansion`, `pivot/query`, `pivot/layout`, and `pivot/core` do not grow without deleting a larger authority surface. |
| Plugin test suite                                      | Passing        | Runtime, chart controls, shared Explore controls, and export regressions pass together.                                | Combined plugin/shared controls and Excel export suite | 0 failing tests | `npm test plugins/plugin-chart-pivot-table-v3` passes.                                                                                       |
| Hidden/not-expanded layers do not fetch                | Guarded        | Must remain true while scheduler and materializer code are reduced.                                                    | Guarded by tests                                       | Always true     | Adding a hidden trailing dimension or collapsed layer does not create a query need.                                                          |
| Semantic layout changes are query-backed               | Guarded        | Local projection from old facts must not reappear during cleanup.                                                      | Guarded by tests                                       | Always true     | Semantic layout changes fetch or reuse tested fact-store coverage; they are not projected from stale tree shape.                             |
| Interactions stay live during requests/materialization | Guarded        | Async fetch/materialization boundaries must survive future deletion.                                                   | Guarded by chart tests                                 | Always true     | Interaction tests pass while expansion/seamless requests and async materialization are in progress.                                          |
| Query planning only through coverage                   | Gap            | The tracker must prevent new direct query-planning branches from bypassing coverage needs and manifest diffing.        | Manual/code review                                     | Always true     | No production query-planning path bypasses coverage needs, `diffCoverageManifest`, or fact-store selectors.                                  |
| Batching remains transport-only                        | Review         | Batching can accidentally become another runtime state model while fetch execution is simplified.                      | Manual/code review                                     | Always true     | Batching only groups transport requests; loaded state remains fact-store coverage selectors and never batch names or request groups.         |
| Materialization boundary is exclusive                  | Guarded        | Subtotal, measure-axis, display-label, collapsed metric, subtotal alias, and export projection boundaries are guarded. | Mostly true                                            | Always true     | Semantic tree construction happens only through `materializePivotTree` materializer paths; other code consumes trees as projections.         |
| Render/export do not repair semantics                  | Guarded        | Render and export consume materialized/render-model projections.                                                       | Mostly true                                            | Always true     | Render/export traverse materialized semantics and do not invent missing metric/subtotal/header structure.                                    |
| No compatibility adapters without net deletion         | Review         | Short-term adapters can hide duplicate authority if not constrained.                                                   | Manual review                                          | Always true     | Any adapter added in a slice deletes a larger old surface in the same slice.                                                                 |
| Source reduction is authority reduction                | Review         | Line-count targets can be gamed by moving code instead of deleting duplicate authority.                                | Manual review                                          | Always true     | Source reductions delete or centralize authority; they do not relocate it into controllers, adapters, fixtures, or chart-side orchestration. |
| Pre-push validation                                    | Passing        | Revision validation runs after staging, with no concurrent tracked-file edits.                                         | Full all-files run required                            | Passing         | Stage changes, run `pre-commit run --all-files`, fix failures, and rerun before pushing.                                                     |

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
5. ~~Shrink `PivotTableChart.tsx` only where code is deleted, not merely moved.~~

## Verification Standard

- Focused unit/contract tests for the touched runtime boundary.
- Relevant chart interaction tests when behavior crosses the UI surface.
- Oxlint, custom frontend rules, TypeScript, and full repository pre-commit.
- `git diff --check`.
- Updated metrics and status in this tracker on every change.

## Known Test Noise

- Jest reports duplicate manual mocks in the wider Superset frontend setup.
- Browserslist data is stale.
- Babel lodash emits an `isModuleDeclaration` deprecation warning.

These warnings are not pivot-table-v3 regressions, but test failures are.
