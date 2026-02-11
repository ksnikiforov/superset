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

### Phase 4: Validation
- [x] Run targeted plugin unit tests for planner and interaction seamless behavior.
- [x] Run lint on plugin scope and resolve any issues.
- [x] Update this document with completion notes and any follow-up work.

## Notes
- Existing unrelated local changes were preserved.
- Interaction mode no longer blocks initial render on dataset metadata fetch.
- Axis edits (add/remove/reorder row/column dimensions) now apply instantly without seamless reload.
- Seamless update planning now snapshots current expansion keys into the initial plan request to reduce post-filter reload rubber-banding.
- `time_grain_sqla` control is removed from pivot v3; branch queries now use raw grouped columns from SQL output instead of plugin-side time-grain rewrites.
- Panel checkbox-add semantics are explicitly covered by tests and now distinguish `Values`-in-middle vs `Values`-trailing cases.
- `Values` axis flips now run through seamless update fetch, preventing mixed/stale metric-axis rendering after multi-measure row/column switches.
- Dimension edits on the active value axis now fetch only when the leading key changes; middle/non-leading stack edits remain no-fetch for instant UX.
- Deeper expansion-engine unification and strict single-transaction filter hydration can be added as a follow-up phase.
