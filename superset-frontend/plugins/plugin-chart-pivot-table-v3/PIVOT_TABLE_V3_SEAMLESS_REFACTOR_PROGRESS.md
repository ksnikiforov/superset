# Pivot Table V3 Seamless Refactor Progress

## Goals
- Reuse the same planning/building functions between regular and seamless updates.
- Keep interaction updates simple and robust under rapid user actions.
- Avoid global loader flashes during local interaction updates.

## Phase Plan

### Phase 0: Baseline + Guard Tests
- [x] Add initial tests for shared update planning contract.
- [x] Keep baseline tests focused on realistic interaction behavior.

### Phase 1: Shared Initial Update Planner
- [x] Add shared planner utility for runtime-layout resolution, local filter merge, and initial query spec generation.
- [x] Add/keep tests for planner behavior and query-shape compatibility.

### Phase 2: Wire Regular + Seamless Paths to Shared Planner
- [x] Refactor `buildQuery.ts` to use the shared planner.
- [x] Refactor `PivotTableChart.tsx` seamless path to use the shared planner.
- [x] Keep behavior unchanged aside from removing duplicated logic.

### Phase 3: Consolidate Filter-Clause Mapping
- [x] Use shared selection-filter mapping in interaction filtering code paths.
- [x] Verify compatibility with stable keys and label aliases.

### Phase 3.5: Instant Interaction UX (No Eager Axis Reload)
- [x] Disable seamless fetches for row/column axis add/remove/reorder changes.
- [x] Keep metric/leaf-selection changes fetch-driven.
- [x] Update interaction tests to assert instant (no seamless request) axis edits.

### Phase 3.6: Remove Time Grain Control (SQL-Output-Driven Grain)
- [x] Remove `time_grain_sqla` from pivot v3 control panel.
- [x] Stop branch query context from rewriting temporal dimensions into adhoc `timeGrain` columns.
- [x] Add regression tests proving branch/query payload columns stay raw SQL output columns (strings).

### Phase 3.7: Panel Insertion Semantics Hardening
- [x] Lock panel-only add behavior: insert before `Values` only when `Values` is trailing/only; otherwise append at axis end.
- [x] Add/adjust panel and seamless-expansion tests to cover both "value in middle" and "value trailing" paths.
- [x] Validate with full plugin test command.

### Phase 3.8: Values-Axis Switch Robustness (Multi-Measure)
- [x] Treat `Values` axis flips (`col` <-> `row`) as seamless-fetch changes so tree orientation is rebuilt correctly.
- [x] Keep index-only `Values` moves on the same axis local/no-fetch.
- [x] Add interaction test for dragging `Value` chip from columns to rows and assert no stale column metric headers remain.
- [x] Add leading-key-aware fetch policy/tests: first-position changes on active value axis fetch; non-leading middle/reorder edits stay local.

### Phase 3.9: Temporal Header Formatting Guardrails
- [x] Add interaction regression test for `rows: [row2]`, `cols: [datetime, Values]`, `metrics: [m1, m2]` in user-controlled mode.
- [x] Fix render model date-formatting pass to skip metric/measure-leaf nodes so metric headers stay metric labels.
- [x] Validate with standard full plugin suite command.

### Phase 3.10: Values Reposition Reload Policy
- [x] Add regression test for `rows: [r1], cols: [Values] -> add c1 -> drag Values to front` and assert seamless fetch + query shape update.
- [x] Update layout fetch policy to fetch on same-axis `Values` index changes when the target axis has dimensions.
- [x] Add unit tests for populated-axis (fetch) vs empty-axis (no-fetch) index moves.

### Phase 3.11: Trimmed Column Depth Pruning
- [x] Add regression test for `cols: [Values, gender, state]` where removing `state` after expansion must drop stale state headers immediately.
- [x] Prune render-tree nodes/cells that exceed current row/column layout depth on no-fetch layout changes.
- [x] Keep local/no-fetch behavior for dimension trims while fixing stale expanded values.

### Phase 3.12: Re-Add Dimension Stability in Values-First Layouts
- [x] Add regression test for `cols: [Values, gender, state] -> remove state -> add state` and assert metric expansion is preserved and gender regains expand affordance.
- [x] Preserve engine-promoted `hasChildren` flags during render-tree depth pruning so optimistic re-adds keep `+` controls before fetch.
- [x] Prevent expansion-state reset on pure prefix append layout changes (`[gender] -> [gender,state]`) while retaining reset behavior for trims/reorders.

### Phase 3.13: Fresh-Data vs Optimistic-Layout Reconciliation
- [x] Keep stable-prefix pruning/promotion for optimistic layout edits that reuse the existing tree (no new dataset payload yet).
- [x] Skip layout-depth pruning when a fresh query payload is already present for the new layout, so valid newly inserted hierarchy nodes are not dropped.
- [x] Validate by fixing and passing the expansion-state regression: `prunes deeper expansions when inserting a groupby row`.

### Phase 3.14: Basic Regression Smoke Guardrails
- [x] Add a focused smoke suite for baseline failures: totals visible, row expansion works, first column dimension in values-only layout keeps visible headers.
- [x] Fix smoke expansion assertion to be state-agnostic (`plus` or `minus` start state) and verify child-level visibility after interaction.
- [x] Run standard plugin suite command and keep all plugin tests green with smoke included.

### Phase 3.15: Value-First Totals/No-Totals Stability
- [x] Replace brittle value-first total-header assertion with behavior-based guardrails (metric columns stay visible, no phantom `Grand total` header/row).
- [x] Add explicit regression for `Value`-first interaction with totals disabled to protect non-total UX from regressions.
- [x] Revert non-beneficial `showColRoot` tweak in render model to preserve established column-root semantics.
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3` plus targeted lint on touched files.

### Phase 3.16: Empty-Axis Recovery + Layout Restore Cache
- [x] Add failing render-model guard test: no-row-dimension + multi-measure must not render an empty body.
- [x] Add failing interaction test: `rows:[r1] -> rows:[] -> rows:[r1]` keeps grand total visible in empty state and restores detail rows instantly when re-added.
- [x] Add row-visibility fallback to keep root row visible when row traversal is empty.
- [x] Add layout-tree snapshot cache in expansion engine so previously seen layouts restore from cached tree state (avoids blank/stale state on remove/re-add cycles).
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3`.

### Phase 3.17: Seamless Hydration Atomicity (No Rubber-Banding)
- [x] Lock leading-key fetch policy in tests for complex multistep sequences (`first on stack` fetches, non-leading edits stay local).
- [x] Add failing interaction regression proving seamless updates must keep the previous expanded table visible while hydration is still in flight.
- [x] Add failing interaction guard against inline/axis spinner artifacts during seamless hydration windows.
- [x] Implement deferred seamless-view commit:
  - Snapshot the current rendered pivot view at seamless update start.
  - Keep rendering the snapshot while seamless request + expansion hydration settle.
  - Suppress inline row/column loading spinners during the deferred window.
  - Release snapshot only when `seamlessLoading=false`, `isHydrating=false`, `loadingKeys=0`, `pendingRows=0`, `pendingCols=0`.
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3`.

### Phase 4: Validation
- [x] Run targeted plugin unit tests for planner and interaction seamless behavior.
- [x] Run lint on plugin scope and resolve any issues.
- [x] Update this document with completion notes and any follow-up work.

### Phase 4.1: Values-To-Rows Expanded-Branch Guard
- [x] Add/strengthen interaction regression for `cols:[c1,Value], rows:[r1,r2]` with one branch expanded, then move `Value` to row-axis end.
- [x] Assert seamless payload shape uses `groupbyRows:[r1,r2,__MEASURES__]`.
- [x] Assert expanded branch descendants stay visible and collapsed sibling descendants stay hidden after the move.
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3`.

### Phase 4.2: Stale Metric-Variant Hydration Guard
- [x] Add failing unit coverage for `hasLoadedChildren` when a branch has only metric-variant placeholder children and no child-level cells.
- [x] Harden `hasLoadedChildren` so metric variants are considered loaded only when matching metric-variant cells exist (not by node shape alone).
- [x] Add planner-level regression to ensure expanded row branches still request fetches in this stale-variant scenario.
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3`.

### Phase 4.3: Stale Subtotal+Metric Descendant Guard
- [x] Add failing unit coverage for `hasLoadedChildren` when an expanded branch has only subtotal+metric descendants at the same base dimension depth (no real next-dimension children).
- [x] Treat this shape as not loaded so hydration plans a fetch instead of leaving expanded nodes with no visible descendants.
- [x] Add expansion-engine regression to assert row-branch fetch planning for this case.
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3`.

### Phase 4.4: Seamless Expansion State Payload Contract
- [x] Add failing interaction assertion proving seamless `Value -> rows` move must include a `branch:row:A:2:1` spec in the initial request (no bootstrap-only plan).
- [x] Fix seamless payload contract: write `pivotExpansionState.rows/cols` as path arrays (not serialized strings) so query planning can restore expanded branches.
- [x] Validate no extra post-seamless prefetch call is triggered for the preserved branch.
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3`.

### Phase 4.5: Value-Axis Cross-Move Non-Blank Guard
- [x] Add failing interaction regression for sequence: `rows:[r1], cols:[Value] -> rows:[r1,Value] -> cols:[c1] -> cols:[c1,r1], rows:[Value]`.
- [x] Ensure final state renders metric rows (no blank tbody) and requests seamless fetch for the last move.
- [x] Extend `shouldFetchForLayoutChange` with a leading-key cross-axis move rule (leading source key moved to target axis must fetch).
- [x] Add unit coverage for leading row-key cross-axis moves.
- [x] Validate with standard command `npm test plugins/plugin-chart-pivot-table-v3`.

### Phase 4.6: Row Metric-Total Sticky + Indent Parity
- [x] Add failing sticky-header regression for metrics-on-rows totals (`Total sum__num`, `Total COUNT(*)`) to require grand-total row class parity and zero-indent parity.
- [x] Update row rendering so metric grand-total rows share grand-total sticky row classes (`pivot-grand-total-row`, position top/bottom).
- [x] Keep metric grand-total row indentation at root level (same visual depth as `Grand total`).
- [x] Validate with focused sticky test, full plugin suite, and eslint on touched files.

### Phase 4.7: Multi-Total Sticky Stacking
- [x] Add failing sticky-header assertion that top metric total rows must not overlap (`--pivot-grand-total-offset` increments by row).
- [x] Implement stacked sticky offsets for all grand-total-like rows (top and bottom positions), with measured row-height accumulation and fallback height.
- [x] Keep existing class-based sticky behavior while adding per-row offset CSS variable consumed by sticky top/bottom rules.
- [x] Validate with focused sticky test, standard full plugin suite command, and eslint on touched files.

### Phase 4.8: Trailing-Dimension Trim Rubber-Banding Guard
- [x] Keep existing no-fetch regression for trailing row-dimension removal after top-level expansion.
- [x] Add failing interaction regression for deep expanded hierarchy (`rows:[r1,r2,r3]`, expanded `A`) where trimming `r3` must not trigger hydration prefetch/loaders.
- [x] Fix trim-path cell handling by remapping removed-depth cells to nearest surviving ancestors (with value merge) so local trimmed views remain immediately renderable.
- [x] Preserve totals-only collapse behavior by not remapping trimmed leaf cells into root when collapsing an axis to depth `0`.
- [x] Validate with standard command `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart`.

### Phase 4.9: Layout Reinit Source-Of-Truth Simplification
- [x] Remove layout replay from `layoutTreeCacheRef` during interaction reinit; derive non-new-data layout transitions strictly from the currently rendered tree (`treeRef.current`).
- [x] Keep trim/promotion/remap logic intact while eliminating stale cached-layout restores that can cause collapse/re-expand rubber-banding after quick row/column toggles.
- [x] Tighten interaction test mocks to use the real cache hook symbol (`peekPivotBranchCache`) and assert no cache-hydration lookup on deep trailing-dimension trim.
- [x] Validate with standard command `npm test -- plugins/plugin-chart-pivot-table-v3` (79 suites / 546 tests passing).

### Phase 4.10: Stale Data Refresh Guard During No-Fetch Layout Edits
- [x] Add a failing interaction regression for trailing row-dimension trim where a stale parent `data` refresh lands immediately after the local edit; assert no prefetch call and no loader bounce.
- [x] Guard user-controlled committed tree updates: ignore incoming `data` snapshots while parent runtime layout is out-of-sync with local committed runtime layout.
- [x] Keep layout projection preference for current tree only on no-fetch layout transitions **without** new payload (`!hasNewData`), so true new-data transitions still use authoritative payloads.
- [x] Validate with targeted suites:
  - `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/interaction-seamless-expansion.test.tsx`
  - `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/expansion-state.test.tsx`
- [x] Validate with standard command `npm test -- plugins/plugin-chart-pivot-table-v3` (79 suites / 547 tests passing).

## Notes
- Existing unrelated local changes were preserved.
- Interaction mode no longer blocks initial render on dataset metadata fetch.
- Axis edits (add/remove/reorder row/column dimensions) now apply instantly without seamless reload.
- Seamless update planning now snapshots current expansion keys into the initial plan request to reduce post-filter reload rubber-banding.
- `time_grain_sqla` control is removed from pivot v3; branch queries now use raw grouped columns from SQL output instead of plugin-side time-grain rewrites.
- Panel checkbox-add semantics are explicitly covered by tests and now distinguish `Values`-in-middle vs `Values`-trailing cases.
- `Values` axis flips now run through seamless update fetch, preventing mixed/stale metric-axis rendering after multi-measure row/column switches.
- Dimension edits on the active value axis now fetch only when the leading key changes; middle/non-leading stack edits remain no-fetch for instant UX.
- Temporal column formatting no longer overwrites metric header labels when `Values` is on the column axis after a datetime dimension.
- Repositioning `Values` within a populated axis now triggers seamless reload so metric-tier shape updates reliably (no stale no-op drag).
- Trimming a column dimension after expansion now removes stale child headers/cells instantly, including `Values`-first layouts.
- Re-adding a previously trimmed trailing column dimension in `Values`-first layouts now preserves metric expansion and restores gender-level expand controls without collapsing the pivot.
- Reconciliation now distinguishes optimistic layout transitions from fresh-data transitions: stale-depth pruning is applied only to reused tree state, not to new payloads already aligned with the updated layout.
- Added baseline smoke coverage in `test/plugin/PivotTableChart/basic-regression-smoke.test.tsx` to protect against simple UX regressions (totals disappearing, no expansion, hidden headers after first column add).
- Added explicit value-first interaction guardrails for both totals-on and totals-off cases in `test/plugin/PivotTableChart/interaction-layout.test.tsx`, focused on visible metric headers and no phantom `Grand total` artifacts.
- Empty-row-dimension interaction path no longer blanks the table: root row fallback is enforced and prior layout snapshots are restored when a dimension is re-added.
- Seamless updates now render atomically from the user perspective: while post-query hydration is pending, the previous expanded table remains visible (no partial tree/rubber-banding), then swaps to the new hydrated state in one commit.
- Inline row/column loading icons are suppressed during deferred seamless hydration windows, preventing false loader artifacts (including value-axis moves that previously showed irrelevant column loaders).
- Added a dedicated interaction guard for the reported `Value -> rows-end` branch-preservation path (single expanded branch, sibling collapsed) to prevent regressions in expanded-state continuity after value-axis moves.
- Expansion hydration no longer short-circuits on stale metric-variant nodes without real child cells; this prevents false "already loaded" states that could leave expanded nodes rendered with no descendants.
- Expansion hydration now also rejects stale subtotal+metric-only descendants at unchanged base depth as "loaded"; this forces proper branch fetches and prevents `minus` rows without visible children after value-axis moves.
- Seamless update planner was silently dropping expansion targets because `pivotExpansionState.rows/cols` were being sent as serialized strings; payloads are now path arrays, restoring branch-prefetch specs in the first request and removing the second-stage expansion fetch for this flow.
- Cross-axis moves that relocate the leading source-axis dimension (for example `rows:[r1,Value] -> rows:[Value], cols:[...,r1]`) now trigger seamless fetch; this prevents blank-table states caused by optimistic reuse of incompatible tree shape.
- When `Values` are on rows, metric grand-total rows (`Total <metric>`) now render with grand-total sticky row treatment and root-level indentation parity.
- Grand-total-like sticky rows are now stacked by offset (instead of sharing one `top`/`bottom`), so multi-metric total rows stick simultaneously without overlap.
- Trailing row-dimension trims on already-expanded hierarchies now stay local and stable: no hydration prefetch bounce, no transient inline loader flash, and no collapse/re-expand of the expanded branch.
- Deeper expansion-engine unification and strict single-transaction filter hydration can be added as a follow-up phase.
