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

As of May 14, 2026, after the query-result fallback mode removal checkpoint:

- Gate-weighted architecture estimate: **99%**.
- Delivery remaining estimate: **less than 1%**, mostly completion audit and
  any final deletion-positive cleanup found by that audit.
- The runtime architecture exists and is used by the main paths.
- The project is above the starting source line count. The old chart boundary
  is much smaller, but that is a local orchestration relocation, not a
  whole-plugin code reduction.
- The remaining work is mostly deletion of old chart, expansion, and render
  interpretation paths.

Source-only diff from pre-refactor baseline
`7088db374448845ef6e71cf74817aa53efbc5fc1`:

- Production `src`: `14212` insertions, `13756` deletions, net `+456`.
- Current production `src` TypeScript/TSX total: `33966` lines.
- Implied baseline `src` TypeScript/TSX total: about `33510` lines.
- `PivotTableChart.tsx` is now `688` lines and `useExpansionEngine.ts` is now
  `1405` lines; those single-file reductions should not be counted as plugin
  source reduction because the plugin-wide total increased.
- Query/render boundary cleanup deleted the one-type `pivot/query/types.ts`
  file and the mixed `pivot/shared/types.ts` bucket. `QuerySpec` now lives with
  query specs, `RenderModel` lives with the render model builder, and formatting
  key typing is local to formatting. The same slice removed the root branch
  fetch stable-stringify alias, the clear-cache wrapper, the `ForTest` fetch
  context export, and the unused `parseDepth` utility. The source slice was
  deletion-positive: `38` insertions, `110` deletions, net `-72`; source plus
  tests was `53` insertions, `129` deletions, net `-76`.
- Touched-file ESLint passed after the query/render boundary cleanup.
- Focused query/fetch/render/export validation after the cleanup passed: `9`
  suites and `62` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `840` tests.
- Strict expansion fetch-result contract cleanup removed the executor-local
  empty fact-batch fallback constant, the stale impossible missing-result branch,
  and optional fact-batch coercion from local, single-target, and batch-target
  expansion fetch paths. The source slice was deletion-positive: `3`
  insertions, `12` deletions, net `-9`; source plus tests was `178`
  insertions, `77` deletions, net `+101`, because older mocks were updated to
  return the real fetch-result contract.
- Touched-file ESLint passed after the strict expansion fetch-result contract
  cleanup.
- Full plugin/export validation after the cleanup passed: `99` suites / `832`
  tests.
- Query-result fallback mode removal deleted the configurable `index`/`empty`
  ingestion fallback path. Ingestion now has one rule: all-unnamed initial
  results remain positional, but once query names are present, specs match by
  query name and missing specs ingest as empty. The source slice was
  deletion-positive: `1` insertion, `21` deletions, net `-20`; source plus
  tests was `2` insertions, `26` deletions, net `-24`.
- Touched-file ESLint passed after the query-result fallback mode removal.
- Focused query/fetch validation after the fallback removal passed: `4` suites
  / `35` tests.
- Chart runtime-sync cleanup moved the committed-tree sync decision out of
  `PivotTableChart.tsx` and into the seamless runtime hook, then deleted the
  now one-consumer runtime predicate export/test surface. The source slice was
  deletion-positive: `33` insertions, `43` deletions, net `-10`; source plus
  tests was `33` insertions, `82` deletions, net `-49`.
- Touched-file ESLint passed after the chart runtime-sync cleanup.
- Focused seamless/chart validation after the cleanup passed: `5` suites and
  `75` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `839` tests.
- Interaction-layout boundary cleanup removed the unused
  `appliedRuntimeLayout` return value and the unused `runtimeLayout` input from
  `resolveAppliedInteractionLayout`. The consumed outputs remain
  `appliedLayoutFormData` and `appliedPivotProgram`. The source/test slice was
  deletion-only: `10` deletions.
- Touched-file ESLint passed after the interaction-layout boundary cleanup.
- Focused interaction-layout validation after the cleanup passed: `2` suites
  and `29` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `839` tests.
- Expansion transition API cleanup removed internal-only exported result and
  return types from `stateTransitions.ts`, leaving those shapes owned by the
  implementation instead of the module boundary. The source slice was
  deletion-positive: `15` insertions, `88` deletions, net `-73`.
- Touched-file ESLint passed after the expansion transition API cleanup.
- Focused expansion/seamless validation after the cleanup passed: `4` suites
  and `65` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `839` tests.
- Expansion prefetch cleanup folded one-consumer hydration scheduling into the
  owning engine effect and inlined private prefetch/visible-key helpers inside
  their owning transition functions. The source slice was deletion-positive:
  `29` insertions, `94` deletions, net `-65`; source plus tests was `29`
  insertions, `126` deletions, net `-97`.
- Touched-file ESLint passed after the expansion prefetch cleanup.
- Focused expansion/seamless validation after the cleanup passed: `4` suites
  and `64` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `838` tests.
- Seamless helper surface cleanup removed exported one-use runtime wrapper
  helpers, inlined the display-snapshot settled condition at its only call
  site, folded sync-snapshot matching into the owning update decision, and
  stopped returning unused hook callbacks. The source slice was
  deletion-positive: `15` insertions, `45` deletions, net `-30`; source plus
  tests was `15` insertions, `138` deletions, net `-123`.
- Touched-file ESLint passed after the seamless helper surface cleanup.
- Focused chart/runtime validation after the cleanup passed: `4` suites and
  `52` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `836` tests.
- Seamless export surface cleanup made internal request-group constants and
  runtime plan/result types private or inferred, removing names that were not a
  real module contract. The source slice was deletion-positive: `18`
  insertions, `64` deletions, net `-46`.
- Touched-file ESLint passed after the seamless export surface cleanup.
- Focused chart/runtime validation after the cleanup passed: `3` suites and
  `46` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `836` tests.
- Ingestion helper surface cleanup made query-result ordering, low-level fact
  ingestion, async ingestion, and fact-store upsert helpers private, then folded
  the one-consumer async fact wrapper into the async ingestion loop. The source
  slice was deletion-positive: `11` insertions, `25` deletions, net `-14`.
- Touched-file ESLint passed after the ingestion helper surface cleanup.
- Focused ingestion/fetch/runtime validation after the cleanup passed: `4`
  suites and `47` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `836` tests.
- Branch cache peek cleanup deleted the production `peekPivotBranchCache`
  export and removed the test-only mocks/imports plus obsolete `currentTree`
  branch-fetch fixture params that kept that historical API surface alive. The
  source slice was deletion-positive: `8` deletions, net `-8`; source plus
  tests was `11` insertions, `182` deletions, net `-171`.
- Touched-file ESLint passed after the branch cache peek cleanup.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `836` tests.
- Path export cleanup deleted the production `parseCellKey` export after audit
  found no production caller, leaving tests to assert the serialized cell-key
  shape directly. The source slice was deletion-positive: `13` deletions, net
  `-13`; source plus tests was `10` insertions, `19` deletions, net `-9`.
- Touched-file ESLint passed after the path export cleanup.
- Focused path/ancestor-subtotal validation after the cleanup passed: `2`
  suites and `10` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `836` tests.
- Branch fact-cache cleanup deleted the module-level branch fact cache and its
  cache-key/filter-signature machinery. Branch fetch now relies on explicit
  fact-store coverage for local hits, and the cache reset export plus
  cache-behavior tests were removed. The source slice was deletion-positive:
  `3` insertions, `205` deletions, net `-202`; source plus tests was `3`
  insertions, `386` deletions, net `-383`.
- Touched-file ESLint passed after the branch fact-cache cleanup.
- Focused branch-fetch/cache-adjacent validation after the cleanup passed: `5`
  suites and `38` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `833` tests.
- Fact-store result flag cleanup removed the branch/batch fetch `factStoreHit`
  diagnostic return field, which had no production consumer after the cache
  cleanup. Existing tests now assert observable behavior through fact batches
  and network-call absence. The source/test slice was deletion-only: `7`
  deletions, with `4` production source deletions.
- Touched-file ESLint passed after the fact-store result flag cleanup.
- Focused branch/batch fetch validation after the cleanup passed: `2` suites
  and `26` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `832` tests.
- Branch/batch abort-helper cleanup removed duplicate local abort-error
  predicates from the branch and batch fetch paths and reused the existing
  runtime request-lifecycle helper. The source slice was deletion-positive:
  `2` insertions, `32` deletions, net `-30`.
- Touched-file ESLint passed after the abort-helper cleanup.
- Focused branch/batch/request-lifecycle validation after the cleanup passed:
  `3` suites and `34` tests.
- Full plugin plus export entrypoint Jest pass after the cleanup: `99` suites
  and `832` tests.
- Metric source-catalog cleanup removed `metricsBase` and
  `measureLeavesByMetricBase` from the chart `formData` shape. The original
  metric catalog now travels as explicit chart props instead of compatibility
  fields inside query/form data. The source slice was not deletion-positive:
  `35` insertions, `23` deletions, net `+12`, but it removes a compatibility
  data-shape boundary.
- Focused validation after removing those compatibility fields passed: `5`
  suites and `84` tests.
- Full plugin plus export utility Jest pass after removing those compatibility
  fields: `96` suites and `781` tests.
- Core-import facade cleanup removed the historical path/token/tree re-exports
  from `utils.ts` and moved production plus test imports to
  `pivot/core/path`, `pivot/core/tokens`, and `pivot/core/tree`. The source
  slice was deletion-positive: `61` insertions, `107` deletions, net `-46`.
- Full plugin source/test ESLint passed after removing the facade.
- Full plugin plus export utility Jest pass after removing the facade: `96`
  suites and `781` tests.
- Hydration runtime-hook cleanup deleted the one-consumer
  `useExpansionHydrationRuntime.ts` file and kept hydration/prefetch scheduling
  local to `useExpansionEngine.ts`; the source slice was deletion-positive:
  `139` insertions, `275` deletions, net `-136`.
- Focused hydration/prefetch validation after deleting that hook passed: `7`
  suites and `55` tests.
- Full plugin plus export utility Jest pass after deleting that hook: `96`
  suites and `781` tests.
- Touched expansion files passed ESLint, Prettier, and `git diff --check`.
- Expansion runtime-hook cleanup deleted the one-consumer
  `useExpansionInFlight.ts` and `useExpansionRequestRuntime.ts` files and kept
  their state local to `useExpansionEngine.ts`; the source slice was
  deletion-positive: `94` insertions, `174` deletions, net `-80`.
- Focused expansion request/concurrency validation after deleting those hooks
  passed: `5` suites and `54` tests.
- Full plugin plus export utility Jest pass after deleting those hooks: `96`
  suites and `781` tests.
- Touched expansion files passed ESLint, Prettier, and `git diff --check`.
- Chart view-prop helper cleanup deleted the one-consumer `pivotViewProps.ts`
  helper and built the display snapshot plus `PivotTableView` props directly at
  the render site; the source slice was deletion-positive: `34` insertions,
  `162` deletions, net `-128`.
- Focused chart validation after deleting the view-prop helper passed: `3`
  suites and `74` tests.
- Touched chart file passed ESLint, Prettier, and `git diff --check`.
- Full plugin plus export utility Jest pass after the structure/helper cleanup:
  `96` suites and `781` tests.
- Full plugin source ESLint passed after the structure/helper cleanup.
- Chart wrapper cleanup deleted the one-consumer `PivotChartView.tsx` wrapper
  and rendered its two branches directly in `PivotTableChart.tsx`; the source
  slice was deletion-positive: `49` insertions, `110` deletions, net `-61`.
- Focused chart validation after deleting the chart wrapper passed: `3` suites
  and `74` tests.
- Touched chart file passed ESLint, Prettier, and `git diff --check`.
- Expansion structure cleanup removed the false `pivot/engine` namespace, moved
  expansion-only planning/state modules under `pivot/expansion`, renamed the
  expansion transition module away from generic `engine.ts`, folded
  single-consumer runtime/store/layout helper files into their owning modules,
  and moved the misplaced initial-query contract test under query tests. The
  source/test slice was deletion-positive: `267` insertions, `338` deletions,
  net `-71`.
- Focused expansion/query validation after the structure cleanup passed: `8`
  suites and `66` tests.
- Focused render-display plus expansion-state validation after the structure
  cleanup passed: `2` suites and `56` tests.
- Touched expansion/chart files passed ESLint, Prettier, and `git diff --check`.
- Full plugin plus export utility Jest pass after preserving local `ownState`
  merges: `96` suites and `781` tests.
- Full plugin source ESLint passed after preserving local `ownState` merges.
- Focused expansion-state pass after preserving local `ownState` merges: `1`
  suite and `47` tests.
- Focused prefetch/hydration pass after moving hydration prefetch scheduling:
  `5` suites and `31` tests.
- Touched expansion files passed ESLint and `git diff --check`.
- Focused expansion pass after extracting the hydration runtime:
  `7` suites and `34` tests.
- Touched expansion files passed ESLint and `git diff --check`.
- Focused expansion pass after extracting same-axis in-flight state:
  `5` suites and `32` tests.
- Touched expansion files passed ESLint and `git diff --check`.
- Focused expansion pass after extracting request lifecycle/helper ownership:
  `5` suites and `34` tests.
- Touched expansion files passed ESLint and `git diff --check`.
- Focused chart/render/seamless pass after extracting chart view composition:
  `4` suites and `49` tests.
- Touched chart/view files passed ESLint and `git diff --check`.
- Focused chart/render/seamless pass after extracting shared
  `PivotTableView` prop assembly: `4` suites and `49` tests.
- Touched chart/render files passed ESLint and `git diff --check`.
- Focused expansion pass after moving same-axis and hydration fetch-loop wiring
  into the expansion fetch executor: `5` suites and `34` tests.
- Touched expansion files passed ESLint and `git diff --check`.
- Full pivot-table-v3 plugin plus export utility Jest pass after the
  interaction DnD trigger extraction: `96` suites and `781` tests.
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
- Focused export utility/model/render/chart pass after requiring registered
  worksheet export data and deleting the production DOM export fallback: `4`
  suites and `18` tests.
- Full plugin plus export utility Jest pass after requiring registered worksheet
  export data: `95` suites and `769` tests.
- Focused chart/runtime pass after centralizing seamless update triggers: `4`
  suites and `23` tests.
- Full plugin plus export utility Jest pass after centralizing seamless update
  triggers: `95` suites and `769` tests.
- Focused chart/runtime pass after folding stale coverage recovery into the
  seamless update plan: `4` suites and `23` tests.
- Full plugin plus export utility Jest pass after folding stale coverage
  recovery into the seamless update plan: `95` suites and `769` tests.
- Focused expansion-concurrency pass after removing duplicate same-axis
  in-flight counters: `4` suites and `61` tests.
- Full plugin plus export utility Jest pass after removing duplicate same-axis
  in-flight counters: `95` suites and `769` tests.
- Focused export utility/model/render/chart pass after exposing the direct
  worksheet Excel writer: `4` suites and `19` tests.
- Full plugin plus export utility Jest pass after exposing the direct worksheet
  Excel writer: `95` suites and `770` tests.
- Focused export provider/menu pass after routing saved chart exports through
  chart-id worksheet data: `6` suites and `79` tests.
- Full plugin plus export utility Jest pass after routing saved chart exports
  through chart-id worksheet data: `95` suites and `772` tests.
- Focused chart filter-sync pass after centralizing selection source precedence:
  `4` suites and `52` tests.
- Full plugin plus export utility Jest pass after centralizing selection source
  precedence: `95` suites and `775` tests.
- Focused expansion request-helper pass after centralizing request group id and
  scope tracking helpers: `6` suites and `38` tests.
- Full plugin plus export utility Jest pass after centralizing expansion request
  helpers: `96` suites and `778` tests.
- Focused layout/render/sort pass after centralizing metric order comparison:
  `5` suites and `42` tests.
- Full plugin plus export utility Jest pass after centralizing metric order
  comparison: `96` suites and `780` tests.
- Focused dataset-meta/chart interaction pass after extracting dataset metadata
  resolution from the chart: `2` suites and `26` tests.
- Full plugin plus export utility Jest pass after extracting dataset metadata
  resolution from the chart: `97` suites and `783` tests.
- Focused expansion concurrency/error pass after deduplicating async expansion
  error cleanup: `4` suites and `6` tests.
- Focused chart/expansion pass after sharing the local sync-ref hook and
  removing expansion wrapper callbacks: `5` suites and `29` tests.
- Full plugin plus export utility Jest pass after sharing the sync-ref hook:
  `97` suites and `783` tests.
- Focused export provider/menu pass after removing the table-selector export
  adapter and routing all Pivot Table v3 Excel exports through chart-id
  worksheet data: `6` suites and `57` tests.
- Full plugin plus export utility Jest pass after removing the selector/table
  export fallback: `97` suites and `782` tests.
- Focused chart/runtime pass after extracting the seamless runtime update hook:
  `6` suites and `74` tests.
- Full plugin plus export utility Jest pass after extracting the seamless
  runtime update hook: `97` suites and `782` tests.
- Focused column DnD pass after removing production debug logging: `2` suites
  and `21` tests.
- Focused chart interaction pass after passing the interaction tree directly:
  `3` suites and `32` tests.
- Focused control panel pass after removing remaining production debug logging:
  `2` suites and `8` tests.
- Focused metric-control pass after cleaning hook dependency arrays: `1` suite
  and `15` tests.
- Focused metric-tier and interaction-layout pass after deriving
  `usePivotLayout`, formatting, and interaction form-data inputs from the
  compiled layout context: `2` suites and `14` tests.
- Full plugin plus export utility Jest pass after preserving raw compiled
  layout levels for Values placeholder policy: `97` suites and `782` tests.
- Focused interaction pass after deriving interaction filter layout from the
  compiled layout context: `2` suites and `28` tests.

The readout is mixed and should be treated plainly: plugin-wide source lines
increased by `1092`. The meaningful progress is architectural ownership moving
out of overloaded React/chart files into tested runtime helpers plus
deletion-positive structure cleanup; it is still not a net source reduction.

## Gate Status

| Gate                                      | Completion | Current readout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gate 1: compiled layout model             |        84% | `PivotProgram` exists and drives many paths. Metric-axis insert positions, inferred metric indices, subtotal forcing, hidden metric headers, and metric expansion flags now live in a pure chart runtime helper. Applied runtime layout/formData projection for user-controlled charts now lives beside interaction layout normalization. Runtime placement can now compile directly into a `PivotProgram` without first building legacy `Values` placeholder groupby arrays, and `usePivotLayout` accepts that compiled program when resolving chart layout. Metric-axis render policy now reads the layout context's raw placement instead of the form-data compatibility groupbys, and the interaction panel now reuses shared runtime-layout normalization instead of carrying its own copy. `usePivotLayout` now derives metrics and row/column dimensions from the compiled layout context instead of accepting duplicate compatibility inputs from the chart, and formatting plus interaction filters now read the same compiled context. `resolveAppliedInteractionLayout` now returns only the consumed form-data projection and compiled program, not the unused applied runtime layout. Interaction layout still produces compatibility formData for query/export boundaries, but the rendered layout no longer depends on that compatibility projection as its source of truth.                                                                                                                                                                                                                              |
| Gate 2: query planning from coverage      |        93% | Initial/root/branch/batch query paths use explicit coverage metadata. Bootstrap/root fact batches now seed fetched root expansion coverage. Branch and grouped-batch fetch params no longer expose tree shape. Fetch-context support/totals coverage composition now lives in one helper shared by branch specs, batch specs, root prefetch, and batch signatures. `QuerySpec` now lives with the query specs instead of in a one-type query bucket file. Bootstrap planning now returns only query targets, reads normalized total flags from the layout context instead of exposing unused compatibility groupby/metric output, and owns the bootstrap-target trimming used when root prefetch is active. Remaining risk is mostly deeper root target selection and compatibility coverage cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Gate 3: central fact ingestion/store      |        92% | Fetch paths return fact batches, cache/fact-store hits use typed coverage, and ingestion is isolated. Compatible root/bootstrap coverage can now materialize branch specs without matching the original request scope while exact branch coverage remains authoritative. Remaining coupling is mostly tree-shaped chart/test boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Gate 4: one tree materializer             |        97% | `materializePivotTree.ts` owns fact-to-tree materialization, Values/metric/measure axes, subtotal leaf injection, and measure-leaf value application. Export no longer repairs row depth semantics, infers visible row hierarchy depth from cloned DOM rows, reads per-row depth markers, reconstructs visible row paths by scanning sibling DOM rows, clones/reshapes the rendered table, routes v3 workbook generation through `table_to_book`, exposes a production HTML-table export builder, emits export metadata attributes into the rendered table, parses rendered DOM metadata, exports unregistered rendered tables, or uses the legacy table-selector adapter. Row export values are produced by a pure export row model, the rendered view registers explicit worksheet cells by chart id, and the v3 export path writes that registered worksheet model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Gate 5: expansion reducer/runtime effects |       100% | Expansion no longer derives fetched state from rendered tree shape. It uses explicit fact coverage, semantic fetchability, shared fetch execution, and request lifecycles. Loaded terminal metric nodes and metric subtotal nodes now seed coverage through the fetched-coverage utility. Same-axis and hydration paths now use the expansion fetch executor for target fetches, stale-result rejection, coverage seeding, loaded metric-node coverage seeding, and returned tree deltas. Same-axis fetch-loop sequencing, target planning, stale epoch checks, delta application, and touched-key collection now live with expansion fetch execution instead of the React hook. Hydration fetch-delta wiring also routes through the expansion fetch executor, leaving the hook to call a hydration execution boundary instead of assembling target fetch callbacks. Expansion hydration kickoff, loading-state management, async commit, cross-axis persistence, and hydration prefetch scheduling now live with the hydration runtime. Expansion request lifecycle/helper setup, request cancellation cleanup, and fetch-coverage signature invalidation now live in a dedicated request-runtime hook. Same-axis in-flight expansion tracking and reset policy now live in a dedicated in-flight state hook. Same-axis delta merge/stale-subtree preservation policy lives in the expansion engine, hydration delta staging/finalization policy lives in the expansion engine, expansion reinitialization trigger/effective-level policy lives in the expansion engine, persisted expansion visibility normalization lives in the expansion engine, expansion toggle/collapse pruning decisions live in the expansion engine, metric expansion stale-key cleanup uses one path, hydration iteration/cancellation policy lives in the expansion engine, branch/batch fetch execution lives in a dedicated expansion fetch executor, and expansion request group id/scope tracking lives with fetch execution. Initial hydration prefetch planning and prefetch action selection are pure engine decisions. Same-axis fetch, cross-axis hydration, collapse, and reinitialization use one batched tree/expanded/pending commit path. |
| Gate 6: pure render model                 |        99% | Projection drives toggle eligibility, collapsed Values, column display, visible-axis construction, semantic export row depth count, semantic export row values, and chart column-sort decisions. Databar scale grouping, waterfall offsets, bridge connectors, label-space sizing, databar column min-width policy, metric-axis layout compatibility policy, metric and measure-leaf order comparison, pre-subtotal child filtering, collapsed Values node projection, row subtotal child policy, column display path construction, header label resolution, metric-leaf render expansion, render date-label formatting, toggle visibility, row/column aggregate emphasis, render node depth, column-sort state/callback ownership, export row hierarchy projection, worksheet-cell export typing, registered worksheet export data, the direct worksheet-to-XLSX writer, and chart-id export lookup now live in pure/render helpers. `RenderModel` now lives with the render model builder instead of in a mixed shared type bucket. Remaining risk is mostly display-map policy plus the registry shape for export data ownership.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Gate 7: chart component cleanup           |        99% | The chart delegates runtime fetch decisions and no longer vetoes metric-order-only commits or treats rendered tree signatures as seamless refetch identity. Seamless sync snapshots, upstream dashboard query-context signatures, committed-props sync predicates, stale coverage recovery predicates, persisted-filter seamless reload policy, persisted-selection local sync policy, selected-filter source precedence, runtime-layout prop sync policy and prop-sync planning, runtime-layout change actions/triggers, stale dashboard runtime actions, seamless update-trigger planning/execution, seamless persistence side-effect planning, pending display snapshot settlement policy, seamless request lifecycle/loading/error/warning state, seamless display-snapshot freezing, seamless async commit handling, committed tree/fact state, committed-tree prop sync decisions, and applied runtime layout/formData projection now live outside the chart. Runtime-layout committed/UI state, prop synchronization, runtime persistence execution, persisted-filter sync, committed/UI filter state, and selection-sync derivation now live in `usePivotRuntimeLayoutState`, reducing chart-level controller state. Selected-filter update policy/triggers, persisted filter normalization, tree-derived dimension filter value collection, selection-filtered fetch form-data construction, dimension filter search/value fetch state, interaction chip construction, interaction DnD shell rendering/triggers, remove-dimension layout policy, column-sort state/resolution/reconciliation, and dataset metadata/date-formatter resolution are now outside the chart. Stale-dashboard recovery, stale coverage recovery, persisted-filter replay, runtime layout refetch/persistence triggers, interaction filter refetch triggers, and interaction DnD refetch triggers now share the seamless runtime update hook. The one-consumer view-prop helper, final view wrapper, and committed-runtime prop-sync predicate export have been deleted; display-snapshot selection, `PivotTableView` prop assembly, and the user-controlled/non-user-controlled branches now render directly in the chart. The chart still owns high-level dataflow wiring and interaction-panel prop selection. |

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
- Expansion request group id construction and request-scope tracking now live
  with fetch execution instead of inline in `useExpansionEngine.ts`.
- Initial hydration prefetch participation, root-only skip handling, and loader
  visibility are planned in the expansion engine instead of in
  `useExpansionEngine.ts`.
- Metric expansion stale-key cleanup now has one path for collapsed and
  non-collapsed states.
- Hydration planning reuses one empty-plan construction path, and cross-axis
  root-fetch planning only clones the axis plan it mutates.
- Expansion state/ref synchronization now uses one local hook instead of six
  repeated effects in `useExpansionEngine.ts`.
- Chart and expansion state/ref synchronization now share `useSyncRef` instead
  of keeping duplicate local hook implementations.
- Same-axis fetch, cross-axis hydration, collapse, and reinitialization now use
  one batched commit path for tree, expanded keys, and pending keys instead of
  separate React updates.
- Same-axis expansion no longer keeps separate in-flight counters beside the
  in-flight expanded-key maps; cross-axis hydration now checks the existing
  in-flight map state directly.
- Cross-axis hydration and initial prefetch async failures now use
  `reportAsyncError` as the single cleanup authority instead of clearing
  hydrating state both inside and outside the error reporter.
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
  prop-sync plan that the chart applies. Stale-dashboard recovery and
  persisted-filter replay are now one runtime-planned update-trigger decision.
  Stale coverage recovery is also folded into that plan, so the chart no longer
  precomputes that coverage predicate or branches across those seamless update
  paths inline.
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
- Seamless update request lifecycles, loading/error/warning state, display
  snapshot freezing, async result branching, and success commits now live in
  `usePivotSeamlessRuntimeUpdate`, so the chart calls a runtime update executor
  instead of owning that request controller inline.
- The chart now uses one local state-ref synchronization hook for own state,
  render tree state, and seamless expansion state, and it computes table width
  once for sticky headers and render sizing.
- Selected-filter update helpers, persisted filter normalization, and
  tree-derived dimension filter value collection are centralized in
  `pivot/filters.ts`, so the chart no longer owns those filter policies.
- Dimension filter search/value request state and query construction are now
  isolated in `useDimensionFilterValues`, so the chart no longer owns the
  request versioning and loading bookkeeping for filter value menus.
- Dataset verbose-label lookup, dataset date-formatter lookup, temporal
  formatter fallback construction, metadata fetch/cache state, and delayed
  render predicates are isolated in `usePivotDatasetMeta`, so the chart no
  longer owns dataset metadata side effects.
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
- Metric and measure-leaf order comparison is centralized in
  `layoutRuntime.ts`, so `usePivotLayout.ts` no longer builds that comparator
  inline.
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
- Selected-filter source precedence for tree sync, persisted interaction replay,
  and persisted selected-filter sync is centralized in `filters.ts`.
- `PivotTableView` registers a typed worksheet model for export, so the export
  path no longer scans cloned DOM rows or rendered metadata to infer hierarchy
  columns, subtotal rows, or raw cell values.
- The XLSX writer consumes worksheet data directly, and Pivot Table v3 Excel
  export no longer exposes a selector-based table adapter.
- Saved dashboard, saved Explore, and unsaved Explore Pivot Table v3 exports now
  call the chart-id worksheet provider instead of constructing a rendered table
  selector.
- Pending seamless layout refresh keeps a display snapshot instead of freezing
  the whole view prop bundle.
- Row-export values, subtotal worksheet emphasis, and numeric cell typing now
  come from the pure worksheet model. Render no longer emits export-only DOM
  attributes.

## Remaining Risk

- `PivotTableChart.tsx` is no longer the largest file, but it remains the
  largest chart-owned orchestration surface. Committed tree/fact state now
  lives in the seamless runtime update hook, and committed/UI filter state now
  lives in the runtime layout state hook. The committed-tree prop sync decision
  also lives in the seamless runtime update hook. The chart still owns
  high-level view composition and interaction-panel prop selection.
- `useExpansionEngine.ts` still owns request kickoff and sequencing. Repeated
  state-ref synchronization and tree/expanded/pending commits are centralized,
  but further work should delete obsolete state or move functions to real owning
  domains, not create more one-consumer hooks/helpers.
- `usePivotLayout.ts` is now mostly a composition hook around pure layout
  helpers. `usePivotRenderModel.ts` still carries formatting value maps,
  sorting, and render-model assembly.
- Large result sets still run JSON parsing and React commits on the main thread.
  Chunked ingestion/materialization reduces monopolization but does not make
  the full commit non-blocking.
- Export no longer clones/reshapes the rendered DOM table, uses `table_to_book`,
  reads rendered DOM metadata, emits export metadata attributes into the
  rendered table, exports unregistered rendered tables, or exposes a
  selector-based table adapter. Row-depth semantic repair, missing-depth
  fallback, DOM-row depth-count inference, sibling-row hierarchy
  reconstruction, render-owned row-export hierarchy projection, the production
  HTML-table export builder, and the DOM parser fallback are gone. A direct
  worksheet-to-XLSX writer exists, and dashboard/Explore entrypoints export by
  chart id. The remaining export risk is API shape: the chart-id provider is a
  registry rather than an injected export-data prop.

## Current Hotspots

Largest relevant production files:

- `PivotDndMetricSelect.tsx`: `1564` lines.
- `stateTransitions.ts`: `1461` lines.
- `PivotMetricDefinitionValue.tsx`: `1448` lines.
- `utils.ts`: `1399` lines.
- `materializePivotTree.ts`: `1329` lines.
- `usePivotFormatting.tsx`: `1320` lines.
- `useExpansionEngine.ts`: `1405` lines.
- `PivotInteractionPanel.tsx`: `1171` lines.
- `PivotDndColumnSelect.tsx`: `1071` lines.
- `controlPanel.tsx`: `1024` lines.
- `PivotTableView.tsx`: `891` lines.
- `usePivotLayout.ts`: `767` lines.
- `PivotTableChart.tsx`: `688` lines.
- `seamlessRuntimeUpdate.ts`: `502` lines.
- `usePivotRenderModel.ts`: `592` lines.

Not all large files are equal for this refactor. The next high-impact files are
`stateTransitions.ts`, `useExpansionEngine.ts`, `PivotTableChart.tsx`,
`usePivotLayout.ts`, `usePivotRenderModel.ts`, and the export/materialization
boundary. `stateTransitions.ts` is now honestly named and located, but it is
still too large and should be split only by real ownership, not by wrapper
modules. Control components are large but less central to the pure runtime
boundary unless they delete runtime-layout translation code.

## Next Work, Highest Impact First

1. Remove chart-owned runtime sync branches that duplicate runtime coverage or
   materializer truth.

   Target examples: stale dashboard recovery signatures and local layout/filter
   persistence branches in
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

4. Tighten the export model boundary.

   V3 export now writes an XLSX worksheet model directly instead of passing a
   cloned table to `table_to_book`, and it consumes render-emitted row export
   values instead of reconstructing row hierarchy from DOM siblings. The XLSX
   writer accepts worksheet data directly, and dashboard/Explore entrypoints now
   retrieve the registered worksheet model by chart id. The next export slice
   should rename the remaining module/API around worksheet data or replace the
   registry with an injected export-data prop if that deletes more code.

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

- `95f71db57a`: deleted the one-consumer `useExpansionHydrationRuntime.ts`
  file and kept hydration/prefetch scheduling local to
  `useExpansionEngine.ts`; Prettier, focused ESLint, `git diff --check`, and
  focused hydration/prefetch Jest (`55` tests) passed. The full
  pivot-table-v3 plugin plus export utility Jest suite also passed afterward
  (`96` suites, `781` tests).
- `dec50a1e4a`: deleted the one-consumer `useExpansionInFlight.ts` and
  `useExpansionRequestRuntime.ts` files and kept their state local to
  `useExpansionEngine.ts`; Prettier, focused ESLint, `git diff --check`, and
  focused expansion concurrency/request Jest (`54` tests) passed. The full
  pivot-table-v3 plugin plus export utility Jest suite also passed afterward
  (`96` suites, `781` tests).
- Latest broad checkpoint after structure/helper cleanup: full plugin source
  ESLint passed, and the full pivot-table-v3 plugin plus export utility Jest
  suite passed (`96` suites, `781` tests).
- `9953f66b02`: deleted the one-consumer `pivotViewProps.ts` helper and built
  the display snapshot plus `PivotTableView` props directly in
  `PivotTableChart.tsx`; Prettier, file-level ESLint, `git diff --check`, and
  focused chart Jest (`74` tests) passed.
- `4e3c0cccef`: deleted the one-consumer `PivotChartView.tsx` wrapper and
  rendered the user-controlled/non-user-controlled chart branches directly in
  `PivotTableChart.tsx`; Prettier, file-level ESLint, `git diff --check`, and
  focused chart Jest (`74` tests) passed.
- `418d3c471e`: collapsed the expansion module structure by removing the false
  `pivot/engine` namespace, renaming the generic expansion `engine.ts` to
  `stateTransitions.ts`, folding single-consumer `layoutTransition.ts`,
  `runtimeState.ts`, and `store.ts` into owning modules, and moving the
  misplaced initial-query contract test under query tests; Prettier, focused
  ESLint, `git diff --check`, focused expansion/query Jest (`66` tests), and
  focused render-display plus expansion-state Jest (`56` tests) passed.
- `9e8a1dd8c5`: preserved local `ownState` merges so expansion persistence is
  not lost when the parent has not replayed `setDataMask` state into props;
  focused expansion-state Jest (`47` tests), the full pivot-table-v3 plugin
  plus export utility Jest suite (`96` suites, `781` tests), and full plugin
  source ESLint passed.
- `a0334d6977`: removed chart-passed interaction metrics/groupbys and made
  `usePivotInteractions` read them from the compiled layout result; touched-file
  ESLint, Prettier, `git diff --check`, and focused interaction Jest (`28`
  tests) passed.
- `129011563d`: kept raw compiled layout row/column levels for Values
  placeholder child policy after removing chart-owned groupby compatibility
  props; touched-file ESLint, focused sorting Jest, and the full
  pivot-table-v3 plus export utility Jest suite (`97` suites, `782` tests)
  passed.
- `25905610bf`: removed the duplicate layout metrics/groupbys returned from
  `resolveAppliedInteractionLayout`, made `usePivotLayout` derive metrics from
  form data, and made formatting read metrics/groupbys from the compiled layout
  context; touched-file ESLint, Prettier, `git diff --check`, and focused
  metric-tier plus interaction-layout Jest (`14` tests) passed.
- `7fef669ad6`: removed duplicate `usePivotLayout` row/column groupby inputs
  so the hook derives dimensions from the compiled layout context; touched-file
  ESLint, Prettier, `git diff --check`, and focused metric-tier layout Jest
  (`8` tests) passed.
- `2c48cf5e08`: cleaned stale/missing hook dependencies in the Pivot Table v3
  metric controls; touched-file ESLint, Prettier, `git diff --check`, focused
  metric-control Jest (`15` tests), and full pivot-table-v3 source ESLint
  passed with no warnings.
- `18597bcfe1`: removed the remaining production Pivot Table v3 placement debug
  flag and `console.log` path from `controlPanel.tsx`; touched-file ESLint,
  Prettier, `git diff --check`, focused control panel/layout Jest (`8` tests),
  and a production-source debug logging scan passed.
- `f19e33f0fb`: removed the chart-owned `treeRef`/sync indirection and passed
  the current tree directly to interaction handlers; touched-file ESLint,
  Prettier, `git diff --check`, and focused chart interaction Jest (`32`
  tests) passed.
- `b66975cfaf`: removed production Pivot Table v3 column DnD debug logging and
  the now-unused debug flag type/dependency; touched-file ESLint, Prettier,
  `git diff --check`, and focused column DnD Jest (`21` tests) passed.
- `6bb826e7d6`: extracted seamless runtime request lifecycle, loading/error
  state, pending display snapshots, async result branching, and success commits
  from `PivotTableChart.tsx` into `usePivotSeamlessRuntimeUpdate`; touched-file
  ESLint, Prettier, `git diff --check`, focused chart/runtime Jest (`74`
  tests), and the full pivot-table-v3 plugin plus export utility Jest suite
  (`97` suites, `782` tests) passed.
- `b2860a6f0c`: removed the selector/table export adapter, carried render chart
  id through `ChartProps`, and made Pivot Table v3 Excel exports use chart-id
  worksheet data for saved and unsaved Explore paths; touched-file ESLint
  passed with the existing `ChartRenderer.jsx` class-component warning,
  Prettier, `git diff --check`, focused export provider/menu Jest (`57`
  tests), and the full pivot-table-v3 plugin plus export utility Jest suite
  (`97` suites, `782` tests) passed.
- `80e4405426`: shared the local sync-ref hook between `PivotTableChart.tsx`
  and `useExpansionEngine.ts`, and removed expansion invalidation/persistence
  wrapper callbacks that only forwarded to refs; touched-file ESLint, Prettier,
  `git diff --check`, focused chart/expansion Jest (`29` tests), and the full
  pivot-table-v3 plugin plus export utility Jest suite (`97` suites, `783`
  tests) passed.
- `9add9b1625`: deduplicated expansion async error cleanup so cross-axis
  hydration and initial prefetch failures rely on `reportAsyncError` for
  loading/hydrating cleanup; touched-file ESLint, Prettier, `git diff --check`,
  and focused expansion concurrency/error Jest (`6` tests) passed.
- `1daf9b57ce`: extracted dataset metadata lookup, dataset date-formatter
  lookup, temporal fallback construction, metadata fetch/cache state, and
  delayed-render predicates into `usePivotDatasetMeta`; touched-file ESLint,
  Prettier, `git diff --check`, focused dataset-meta/chart interaction Jest
  (`26` tests), and the full pivot-table-v3 plugin plus export utility Jest
  suite (`97` suites, `783` tests) passed.
- `b49e23f203`: centralized metric and measure-leaf order comparison in
  `layoutRuntime.ts` so `usePivotLayout.ts` no longer builds the comparator
  inline; touched-file ESLint, Prettier, `git diff --check`, focused
  layout/render/sort Jest (`42` tests), and the full pivot-table-v3 plugin plus
  export utility Jest suite (`96` suites, `780` tests) passed.
- `214226bffd`: centralized expansion request group id construction and
  request-scope tracking in `fetchExecution.ts`; touched-file ESLint, Prettier,
  `git diff --check`, focused expansion request/hydration Jest (`38` tests),
  and the full pivot-table-v3 plugin plus export utility Jest suite (`96`
  suites, `778` tests) passed.
- `a8231bf2ce`: centralized selected-filter source precedence in `filters.ts`
  so tree sync, persisted interaction replay, and persisted selected-filter sync
  use one helper instead of separate chart branches; touched-file ESLint,
  Prettier, `git diff --check`, focused chart/filter Jest (`52` tests), and
  the full pivot-table-v3 plugin plus export utility Jest suite (`95` suites,
  `775` tests) passed.
- `e6ad0d2f1f`: registered worksheet export data by chart id and routed saved
  dashboard/Explore Pivot Table v3 Excel exports through that provider instead
  of table selectors; touched-file ESLint, Prettier, `git diff --check`,
  focused export provider/menu Jest (`79` tests), and the full pivot-table-v3
  plugin plus export utility Jest suite (`95` suites, `772` tests) passed.
- `f8d002d395`: exposed a direct worksheet-to-XLSX writer so workbook
  generation has a non-DOM entrypoint; touched-file ESLint, Prettier,
  `git diff --check`, focused export utility/model/render/chart Jest (`19`
  tests), and the full pivot-table-v3 plugin plus export utility Jest suite
  (`95` suites, `770` tests) passed.
- `9a192f0e25`: removed duplicate same-axis expansion in-flight counters and
  reused the existing expanded-key in-flight maps for cross-axis gating;
  touched-file ESLint, Prettier, `git diff --check`, focused
  expansion-concurrency Jest (`61` tests), and the full pivot-table-v3 plugin
  plus export utility Jest suite (`95` suites, `769` tests) passed.
- `6d6362443b`: folded stale coverage recovery into the seamless update plan so
  the chart no longer precomputes that trigger; touched-file ESLint, Prettier,
  `git diff --check`, focused chart/runtime Jest (`23` tests), and the full
  pivot-table-v3 plugin plus export utility Jest suite (`95` suites, `769`
  tests) passed.
- `a74a3345e9`: centralized stale-dashboard recovery and persisted-filter
  replay trigger planning in the seamless runtime helper; touched-file ESLint,
  Prettier, `git diff --check`, focused chart/runtime Jest (`23` tests), and
  the full pivot-table-v3 plugin plus export utility Jest suite (`95` suites,
  `769` tests) passed.
- `9913794db3`: deleted the production DOM export fallback and made v3 Excel
  export require registered worksheet data; touched-file ESLint, Prettier,
  `git diff --check`, focused export utility/model/render/chart Jest (`18`
  tests), and the full pivot-table-v3 plugin plus export utility Jest suite
  (`95` suites, `769` tests) passed.
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
- Export changes: worksheet model/export utility tests plus at least one
  render/chart test that proves registered worksheet data is produced and
  consumed without DOM metadata.
- Chart sync changes: interaction layout, interaction seamless expansion,
  interaction filter seamless, and runtime coverage.

## Completion Audit, May 14, 2026

Objective: complete the pure runtime transition with impactful, deletion-first
changes from the highest-impact areas.

Current evidence:

- Source-only baseline comparison from
  `7088db374448845ef6e71cf74817aa53efbc5fc1`: `14455` insertions, `13363`
  deletions, net `+1092`; current production `src` TypeScript/TSX total is
  `34602` lines, up from an implied `33510` line baseline.
- The honest line-count result is not a plugin reduction. `PivotTableChart.tsx`
  is down to `698` lines and `useExpansionEngine.ts` is down to `1439` lines,
  but those are local file reductions offset by extracted runtime/helper code.
- Latest hydration runtime-hook cleanup deleted the one-consumer
  `useExpansionHydrationRuntime.ts` file and kept hydration/prefetch scheduling
  local to `useExpansionEngine.ts`; the source slice was deletion-positive:
  `139` insertions, `275` deletions, net `-136`.
- Latest hydration runtime-hook validation passed focused Jest validation: `7`
  suites and `55` tests; touched expansion files passed Prettier, focused
  ESLint, and `git diff --check`.
- Latest full pivot-table-v3 plugin plus export utility Jest run after the
  hydration runtime-hook cleanup passed: `96` suites and `781` tests.
- Latest expansion runtime-hook cleanup deleted the one-consumer
  `useExpansionInFlight.ts` and `useExpansionRequestRuntime.ts` files and kept
  their state local to `useExpansionEngine.ts`; the source slice was
  deletion-positive: `94` insertions, `174` deletions, net `-80`.
- Latest expansion runtime-hook validation passed focused Jest validation: `5`
  suites and `54` tests; touched expansion files passed Prettier, focused
  ESLint, and `git diff --check`.
- Latest full pivot-table-v3 plugin plus export utility Jest run after the
  expansion runtime-hook cleanup passed: `96` suites and `781` tests.
- Latest chart view-prop helper cleanup deleted the one-consumer
  `pivotViewProps.ts` file and built the display snapshot plus
  `PivotTableView` props directly in `PivotTableChart.tsx`; the source slice
  was deletion-positive: `34` insertions, `162` deletions, net `-128`.
- Latest view-prop helper validation passed focused Jest validation: `3`
  suites and `74` tests; touched chart file passed Prettier, file-level ESLint,
  and `git diff --check`.
- Latest full validation after the structure/helper cleanup passed: full plugin
  source ESLint and the full pivot-table-v3 plugin plus export utility Jest
  suite (`96` suites and `781` tests).
- Latest chart wrapper cleanup deleted the one-consumer `PivotChartView.tsx`
  file and rendered its branches directly in `PivotTableChart.tsx`; the source
  slice was deletion-positive: `49` insertions, `110` deletions, net `-61`.
- Latest chart wrapper validation passed focused Jest validation: `3` suites
  and `74` tests; touched chart file passed Prettier, file-level ESLint, and
  `git diff --check`.
- Latest expansion structure cleanup removed `3` source files, removed the
  false `pivot/engine` namespace, moved expansion-only modules under
  `pivot/expansion`, moved the misplaced initial-query contract test under
  query tests, and was deletion-positive across source/tests: `267`
  insertions, `338` deletions, net `-71`.
- Latest expansion/query structure validation passed focused Jest validation:
  `8` suites and `66` tests; focused render-display plus expansion-state Jest
  validation passed: `2` suites and `56` tests.
- Touched expansion/chart files passed Prettier, focused ESLint, and
  `git diff --check`.
- Latest full pivot-table-v3 plugin plus export utility Jest run after
  preserving local `ownState` merges passed: `96` suites and `781` tests.
- Full plugin source ESLint passed after preserving local `ownState` merges.
- Latest expansion-state fix passed focused Jest validation: `1` suite and `47`
  tests.
- Latest hydration prefetch scheduling extraction passed focused
  prefetch/hydration Jest validation: `5` suites and `31` tests; touched
  expansion files passed ESLint and `git diff --check`.
- Latest expansion hydration runtime extraction passed focused expansion Jest
  validation: `7` suites and `34` tests; touched expansion files passed ESLint
  and `git diff --check`.
- Latest expansion in-flight state extraction passed focused expansion Jest
  validation: `5` suites and `32` tests; touched expansion files passed ESLint
  and `git diff --check`.
- Latest expansion request-runtime extraction passed focused expansion Jest
  validation: `5` suites and `34` tests; touched expansion files passed ESLint
  and `git diff --check`.
- Latest chart view composition extraction passed focused chart/render/seamless
  Jest validation: `4` suites and `49` tests; touched chart/view files passed
  ESLint and `git diff --check`.
- Latest shared view-props extraction passed focused chart/render/seamless Jest
  validation: `4` suites and `49` tests; touched chart/render files passed
  ESLint and `git diff --check`.
- Latest same-axis and hydration fetch-executor extraction passed focused
  expansion Jest validation: `5` suites and `34` tests; touched expansion
  files passed ESLint and `git diff --check`.
- Latest focused query/runtime Jest run passed: `8` suites and `45` tests.
- Touched query files passed ESLint.
- Latest focused expansion Jest run passed: `5` suites and `48` tests.
- Touched expansion files passed ESLint.
- Latest full pivot-table-v3 plus export utility Jest run passed before the
  persisted-filter sync extraction: `97` suites and `784` tests.
- Full plugin source ESLint passed before the persisted-filter sync extraction.
- Latest committed data-state extraction passed focused seamless/interaction
  Jest coverage: `4` suites and `72` tests; touched chart/seamless hook files
  passed ESLint.
- Latest filter-state extraction passed focused chart/filter/seamless Jest
  coverage: `5` suites and `83` tests; touched chart/runtime-layout hook files
  passed ESLint.
- Latest seamless-trigger extraction passed focused chart/filter/seamless Jest
  coverage: `5` suites and `83` tests; touched chart/seamless hook files passed
  ESLint.
- Latest column-sort state extraction passed focused chart/pure sort coverage:
  `2` suites and `18` tests; touched chart/render-model files passed ESLint.
- Latest runtime-layout trigger extraction passed focused chart/filter/seamless
  Jest coverage: `5` suites and `83` tests; touched chart/seamless hook files
  passed ESLint.
- Latest full pivot-table-v3 plugin plus export utility Jest run after the
  runtime-layout trigger extraction passed: `96` suites and `781` tests.
- Latest filter-trigger extraction passed focused chart/filter/seamless Jest
  coverage: `5` suites and `83` tests; touched chart/seamless hook files passed
  ESLint.
- Latest interaction DnD trigger extraction passed focused interaction/seamless
  Jest coverage: `5` suites and `81` tests; touched chart/seamless hook files
  passed ESLint.
- Latest full pivot-table-v3 plugin plus export utility Jest run after the
  interaction DnD trigger extraction passed: `96` suites and `781` tests.
- Full plugin source ESLint passed after the interaction DnD trigger extraction.
- Latest Gate 1 runtime-placement validation passed: `5` focused suites and
  `60` tests covering interaction layout, compiled program placement,
  layout-runtime policy, and metric-tier layout.
- Touched Gate 1 source files passed ESLint.
- Interaction panel runtime-layout normalization cleanup passed focused
  interaction-layout tests and file-level ESLint.
- Bootstrap planner compatibility-output cleanup passed query-focused Jest
  validation: `5` suites and `30` tests, plus query-file ESLint.
- Bootstrap prefetch target-selection ownership cleanup passed the same
  query-focused Jest suite set and query-file ESLint.
- Runtime-layout state hook extraction passed interaction/seamless-focused Jest
  validation: `3` suites and `67` tests, plus touched chart-file ESLint.
- Runtime persistence move into the layout-state hook passed the same
  interaction/seamless-focused Jest suite set and touched chart-file ESLint.
- Persisted-filter sync move into the layout-state hook passed
  interaction/seamless-focused Jest validation: `4` suites and `72` tests, plus
  touched chart-file ESLint.
- Latest checkpoint has no intended Pivot Table v3 files left dirty after
  commit; unrelated `docker-compose.yml` remains modified.

Open checklist:

- Compiled program drives all layout-facing chart hooks: mostly complete, but
  Gate 1 remains at `84%` because interaction form-data normalization still
  produces compatibility formData for query/export boundaries even though the
  source metric catalog no longer lives in compatibility fields inside
  `formData`, rendered layout now consumes a compiled runtime-placement program
  directly, and the unused applied-runtime-layout return value is gone.
- Query planning from coverage: not complete; fetch-context support/totals
  coverage composition is centralized, bootstrap planning no longer exposes
  unused compatibility outputs or leaves bootstrap-target trimming in
  `specs.ts`, and the one-type query bucket file is gone. Deeper root target
  selection and compatibility coverage cases remain Gate 2 risk.
- Central fact ingestion/store: not complete; tree-shaped chart/test
  boundaries and compatible coverage reads remain the Gate 3 gap.
- One tree materializer: effectively complete but not closed; export ownership
  still relies on a chart-id worksheet data registry.
- Expansion reducer/runtime effects: complete for the current transition;
  same-axis fetch-loop sequencing and hydration fetch-delta wiring are in the
  expansion executor, and the deleted one-consumer request, in-flight, and
  hydration hooks now live directly in `useExpansionEngine.ts`.
- Pure render model: nearly complete; `RenderModel` now belongs to the render
  model builder, but display-map policy and export registry ownership remain
  residual risk.
- Chart component cleanup: not complete; runtime-layout state, prop sync,
  runtime persistence execution, persisted-filter sync, committed tree/fact
  state, committed/UI filter state, selection-sync derivation, and seamless
  update-trigger execution plus runtime-layout change triggers now live outside
  `PivotTableChart.tsx`; committed-tree prop sync decisions, interaction
  filter triggers, and interaction DnD triggers now also live outside the chart.
  The one-consumer view-prop helper, final chart view wrapper, and
  one-consumer committed-runtime prop-sync predicate export have been deleted,
  and the chart renders the display snapshot, `PivotTableView` props, and
  user-controlled/non-user-controlled branches directly. The chart still owns
  high-level dataflow wiring and interaction-panel prop selection. Column-sort
  state and callbacks now live with the render model.

Conclusion: the transition is not closed, but the remaining work is now mostly
completion audit. Any further code slice should still be deletion-positive and
target chart runtime sync, export data ownership, or remaining compatibility
data-shape boundaries. Passing tests and the current plan status are evidence
of progress, not completion.

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
- any remaining single-file shrink is backed by deletion of obsolete behavior
  or clearer runtime ownership, not counted as whole-plugin source reduction
  unless the plugin-wide `src` total actually falls.
