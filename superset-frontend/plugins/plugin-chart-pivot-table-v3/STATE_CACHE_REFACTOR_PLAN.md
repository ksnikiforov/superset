# Pivot Table v3 — Expansion Cache / Hydration Robustness Refactor Plan

## Scope and goal

This plan is limited to the pivot table v3 plugin folder (`superset-frontend/plugins/plugin-chart-pivot-table-v3/`).

Goal: make expansion-state restore + branch-fetch caching deterministic and race-safe so values never “disappear” even when:
- multiple branch fetches overlap (manual expands, auto-expand, persisted-expansion prefetch),
- chart updates cause a new base `data` tree while old fetches are still in flight,
- branch results are served from the in-memory cache.

No implementation in this document; it is a refactor plan with specific file/function references.

## Update (implemented test-first hardening)

The first two refactor steps below have now been implemented (tests-first), because they directly address the “sometimes values don’t populate” symptom:

- **Delta-only branch cache/results**: `src/fetchPivotBranch.ts` now caches/returns only the fetched branch delta (not `mergeTrees(currentTree, delta)`).
- **Epoch gating for in-flight requests**: `src/PivotTableChart.tsx` now ignores manual and persisted-prefetch results that resolve after the base `data` tree changes.

New regression tests were added to lock this behavior in:
- `test/plugin/fetchPivotBranch.test.ts`
- `test/plugin/expand/PivotTableChart.expand.epoch.test.tsx`
- `test/plugin/PivotTableChart/prefetch.epoch.test.tsx`
- `test/plugin/PivotTableChart/prefetch.concurrent-merge.test.tsx`

## How the current system works (map)

### Data + rendering pipeline

- Query generation: `src/buildQuery.ts` (`buildQuery(formData)`)
  - Produces multi-queries based on collapse/expand levels, totals/subtotals, formatting/sorting requirements.
  - Also increases initial depth limits when `formData.expansionState` exists (see “Risks” below).
- Shape query results into a pivot tree: `src/transformProps.ts` (`transformProps(chartProps)`)
  - Builds `data: PivotTreeData` by merging all `queriesData` via `mergeTrees()` and projecting metrics via `applyMetricAxis()`.
  - Optionally uses `ownState.treeData` as a base if `ownState.treeDataSignature` matches.
- UI state + lazy expansion:
  - Rendering and expansion logic live in `src/PivotTableChart.tsx`.
  - Lazy branch fetches use `src/fetchPivotBranch.ts` (`fetchPivotBranch(params)`).

### Expansion-state persistence (“chart cache”)

Expansion state is stored in two different places depending on where the chart is rendered:

- Explore (chart builder): `setControlValue` is available → store in hidden control `expansionState`
  - Control definition: `src/controlPanel.tsx` (`name: 'expansionState'`, `dontRefreshOnChange: true`)
  - Read in `src/PivotTableChart.tsx` via `formData.expansionState`
- Dashboard: `setControlValue` is not available → store in `ownState.expansionState` via `setDataMask({ ownState: ... })`
  - Read in `src/PivotTableChart.tsx` via `ownState?.expansionState`

Key functions and state in `src/PivotTableChart.tsx`:
- `coerceExpansionState()` normalizes persisted payload into `{ rows: string[]; cols: string[]; collapsedRows: string[]; collapsedCols: string[] }`
- `persistExpansionState(nextRows, nextCols)` filters to *visible* expansions (Requirement #1) via `getVisibleExpansionKeys()` and then writes:
  - Explore: `setControlValue('expansionState', ...)`
  - Dashboard: `setDataMask({ ownState: { expansionState: ... } })`
- Auto-expand rules (Requirement #2) are enforced in the big `useLayoutEffect` that:
  - seeds expansions using `seedExpandedByLevel()`,
  - strips/clears auto-seeded expansions when auto-expand changes (`stripAutoSeededExpansions`, `shouldClearRowCache`, `shouldClearColCache`),
  - decides whether to run persisted-expansion prefetch (`prefetchFromPersistenceRef`).

### Prefetch (“hydration”) for persisted expansion state

This is the “load the cached expansion state on chart refresh” path:

- `src/PivotTableChart.tsx`
  - `prefetchFromPersistenceRef` is set during `useLayoutEffect` when persisted expansion keys exist and require additional data.
  - An effect calls:
    - `fetchExpandedBranches('row', expandedRows, tree.rows)`
    - `fetchExpandedBranches('col', expandedCols, tree.cols)`
  - It loops until an iteration loads no more data.
  - While hydration is ongoing, the chart shows a global overlay loader via `<Loading />` when:
    - `const isPrefetching = prefetchFromPersistenceRef.current && loadingKeys.size > 0;`

Branch data is fetched via `src/fetchPivotBranch.ts` and optionally served from the in-memory LRU cache.

## Requirements coverage (as implemented today)

The requirements you listed are mostly implemented already:

1) **Persist only visible expansions**:
   - `src/PivotTableChart.tsx`: `persistExpansionState()` → `getVisibleExpansionKeys()` filters out expansions that are not visible under current collapsed ancestors.

2) **Auto-expand exception**:
   - `src/PivotTableChart.tsx`: `useLayoutEffect` logic around:
     - `seedExpandedByLevel()`,
     - `stripAutoSeededExpansions()`,
     - `shouldClearRowCache/shouldClearColCache`.

3) **Global spinner while restoring cached expansions**:
   - `src/PivotTableChart.tsx`: `isPrefetching ? <Loading /> : <StyledTable .../>`
   - Manual expand uses per-node spinners (`loadingKeys.has(node.key)`), keeping table interactive.

4) **Concurrent fetches; whole-level query where possible**:
   - Concurrent: `Promise.all([...])` in `fetchExpandedBranches`.
   - Whole-level: root fetch when `autoExpandFetchDepthRef` is set (calls `fetchPivotBranch` with `path: []` and `maxDepthPerFetch: autoExpandDepth`).
   - “Single query with filters for multiple expansions” is not systematically implemented yet; current approach is “many branch queries in parallel”.

5) **No persistence across full page reload**:
   - True by design (in-memory / runtime state only).

## Findings: likely causes of “values not loaded even though query returned”

### Root cause candidate #1 (highest confidence): `fetchPivotBranch` returns and caches *merged trees* (race-prone)

`src/fetchPivotBranch.ts` currently merges the fetched branch **into the caller-provided `currentTree` snapshot**, then caches and returns that merged result:

```ts
// src/fetchPivotBranch.ts
const merged = mergeTrees(currentTree, labeledBranch);
touchCache(cacheKey, merged);
return { data: merged };
```

Why this is fragile:
- Callers already merge results into their current state (`mergeTrees(current, result.data)` in `src/PivotTableChart.tsx`).
- When multiple fetches overlap, each fetch is built from a potentially different `currentTree` snapshot (whatever existed at request time).
- A late response can therefore re-introduce stale snapshots for overlapping keys and overwrite newer in-memory state during `mergeTrees(...)`.
- The branch cache (`peekPivotBranchCache(...)`) also returns these merged trees, so cached results can replay stale snapshots too.

This exactly matches the symptom pattern: “sometimes” values aren’t populated even though the network response contains them (order-dependent overwrites).

Where it manifests:
- Manual concurrent expands: `src/PivotTableChart.tsx` `handleToggle()` calls `fetchPivotBranch()` per click.
- Persisted-expansion prefetch: `src/PivotTableChart.tsx` `fetchExpandedBranches()` runs many `fetchPivotBranch()` calls concurrently.
- Cache hits: `src/PivotTableChart.tsx` uses `peekPivotBranchCache()` and merges that result into the live tree.

### Root cause candidate #2: stale in-flight responses applied after base `data` changes (no “epoch” gating)

When `data` changes (e.g. Update Now / filter change), `src/PivotTableChart.tsx` resets `tree` via `commitTree(data)` inside `useLayoutEffect`.

However:
- In-flight fetches started before the reset can still resolve afterward and be merged into the new tree.
- There is no request “epoch” or cancellation guard to ignore results from previous base trees / signatures.

This can cause:
- wrong cells merged into a new dataset,
- incorrect pruning decisions,
- and hard-to-reproduce missing cells when older snapshots collide with newer ones.

### Root cause candidate #3: `transformProps` “treeData base reuse” can retain stale cells across filter/time changes

`src/transformProps.ts` uses `ownState.treeData` as a base whenever `treeDataSignature` matches:

```ts
// src/transformProps.ts
const baseTree =
  ownState?.treeData && ownState?.treeDataSignature === treeDataSignature
    ? ownState.treeData
    : ({} as PivotTreeData);
const nextTreeRaw = queriesData.reduce<PivotTreeData>((acc, query) => {
  ...
  return mergeTrees(acc, branch);
}, baseTree);
```

The signature does not include “filter signature” (time range / dashboard filters / adhoc filters). If `ownState.treeData` exists, you can merge a new query result *on top of old cells*.

This is not the same symptom (“missing values”), but it creates correctness risk and makes debugging cache/restore harder because stale cells can remain in memory.

### Secondary fragility points (worth addressing during refactor)

- Prefetch loop termination: `src/PivotTableChart.tsx` prefetch effect continues only when `didLoadData` is true; it ignores `hasMissingNodes` from `fetchExpandedBranches`.
- `fetchExpandedBranches` marks nodes as “fetched” even when `result.data` is undefined (can prevent future retries).
- Loader semantics: `isPrefetching` depends on `loadingKeys.size > 0`; there can be a short gap where persisted-expansion hydration is “armed” but not yet showing the global loader.
- Complexity: `src/PivotTableChart.tsx` is currently a large “god component” handling persistence + fetching + pruning + rendering; it’s hard to reason about and increases regression risk.

## Proposed refactor architecture (robust + extensible)

### 1) Make branch fetch results “deltas” (never merged trees)

**Principle:** `fetchPivotBranch` must return only the branch delta produced from the query response; merging is the caller’s job.

Refactor targets:
- `src/fetchPivotBranch.ts`
  - Change what is cached and returned:
    - Cache: `labeledBranch` (delta), not `mergeTrees(currentTree, labeledBranch)`.
    - Return: `{ data: labeledBranch }` (or rename to `{ delta: ... }`).
  - Keep `currentTree` in params only for:
    - resolving current visible depths when not provided (`resolveFetchContext`),
    - optional “query planning” heuristics (but not for merging).
- `src/PivotTableChart.tsx`
  - Merge only the delta into the current tree:
    - `applyTreeUpdate(current => mergeTrees(current, branchDelta))`

This eliminates stale snapshot replay and makes ordering of concurrent fetch resolutions irrelevant.

Recommended new types (in `src/types.ts` or a new module):
- `PivotBranchDelta = PivotTreeData`
- `FetchPivotBranchResult = { delta?: PivotBranchDelta; cached?: boolean; error?: Error; meta?: ... }`
- `PivotBranchCacheValue = PivotBranchDelta`

### 2) Add “request epoch” gating for all async branch fetches

**Principle:** never apply results from an old base dataset to a new one.

Implementation sketch (in `src/PivotTableChart.tsx`):
- Maintain `const dataEpochRef = useRef(0);`
- Increment epoch whenever the base `data` (or a “data signature”) changes in the `useLayoutEffect` that calls `commitTree(data)`.
- Each `fetchPivotBranch` call captures `const epoch = dataEpochRef.current;`
- When the promise resolves, apply only if `epoch === dataEpochRef.current`.

This should be applied both in:
- `handleToggle()` manual expand path
- `fetchExpandedBranches()` persisted-expansion hydration path

### 3) Extract cache/persistence + hydration into dedicated modules/hooks

Split `src/PivotTableChart.tsx` into smaller, testable units:

Suggested modules (new files under `src/pivot/`):

- `src/pivot/expansionPersistence.ts`
  - Pure functions:
    - `coerceExpansionState(...)` (moved out of the component)
    - `filterExpansionStateToVisible(...)` (current `persistExpansionState` + `getVisibleExpansionKeys` logic)
    - `applyAutoExpandSeed(...)`
    - `stripAutoSeededExpansions(...)`

- `src/pivot/hydrationPlanner.ts`
  - Pure functions that, given:
    - current `tree`,
    - desired expanded keys,
    - visible opposite-axis depth,
    produce a list of `BranchRequest` objects needed to satisfy the desired state.

- `src/pivot/usePivotHydration.ts`
  - Orchestrates:
    - running requests in parallel,
    - applying deltas,
    - tracking `loadingKeys`,
    - tracking a dedicated `isHydratingFromCache` boolean (not derived from `loadingKeys.size`),
    - epoch gating.

Net effect: `PivotTableChart.tsx` becomes a view + event wiring layer; correctness logic becomes unit-testable.

### 4) Make hydration stopping criteria explicit (“done when satisfied”, not “done when no new data loaded”)

Replace the current “recursive while `didLoadData`” loop with “while there exist unsatisfied expansion targets”.

Key change: the loop should continue when:
- some desired expansion keys do not exist in the tree yet (missing nodes),
- or some expanded parents exist but are not fully loaded for current visible opposite depth.

This also makes it easier to guarantee Requirement #3 (“spinner until fully loaded”).

### 5) Clarify and harden loader semantics for persisted expansion restore

Add explicit state:
- `hydrationMode: 'none' | 'persisted' | 'autoExpand' | 'manual'`
- `isHydrating: boolean` (for global overlay)

Rules:
- Persisted restore (`ownState.expansionState` / `formData.expansionState`): show global overlay from the moment we decide to hydrate, even before the first request increments `loadingKeys`.
- Manual expand/collapse: never use global overlay; only use per-node spinners.

This removes flicker gaps and matches the “chart is not ready until cached expansions are filled” expectation.

### 6) Revisit `buildQuery.ts` expansionState depth bumping (optional but recommended)

`src/buildQuery.ts` currently uses `expansionState` to increase `rowDepthLimit` / `colDepthLimit` (global depth), which can cause:
- whole-table deep queries even if only a few branches were expanded,
- larger payloads,
- and more overlapping merges.

Two safer options:
- Option A (minimal): keep this behavior only for whole-level auto-expand, and stop using `expansionState` for depth bumping.
- Option B (ideal for Explore): generate additional *branch-filtered* queries for persisted expansions (similar to how `fetchPivotBranch.ts` builds filtered queries), so:
  - Superset’s global chart spinner naturally covers the prefetch,
  - the amount of data scales with expanded branches rather than full depth.

Note: dashboards persist expansion state in `ownState` (not `formData`), so Option B is most naturally applied to Explore; dashboards would still use client-side hydration.

## Concrete refactor steps (incremental, low-risk ordering)

### Progress checklist

- [x] 1) **Change branch cache semantics to “delta-only”**
   - Touch points:
     - `src/fetchPivotBranch.ts`: stop merging with `currentTree` before caching/returning.
     - `src/PivotTableChart.tsx`: ensure all merges apply deltas.
   - Update tests:
     - `test/plugin/fetchPivotBranch.test.ts` expectations that implicitly rely on `currentTree` being embedded in `result.data`.

- [x] 2) **Add epoch gating to all async apply paths**
   - Touch points:
     - `src/PivotTableChart.tsx`: `handleToggle`, `fetchExpandedBranches`, prefetch effect.
   - Add a regression test:
     - simulate `data` change while a fetch is in flight; ensure resolved results do not apply.

- [x] 3) **Extract persistence + hydration planning into pure helpers**
   - Touch points:
     - move `coerceExpansionState`, `seedExpandedByLevel`, “filter to visible” logic into `src/pivot/expansionPersistence.ts`.
   - Keep behavior identical; tests in:
     - `test/plugin/PivotTableChart/expansion-state.test.tsx` should remain green with minimal edits.

- [x] 4) **Refactor hydration loop to a “satisfied targets” model**
   - Touch points:
     - `src/PivotTableChart.tsx` prefetch effect → new `usePivotHydration`.
   - Add tests to cover:
     - mixed row/col persisted expansions,
     - missing-node → parent fetch → child fetch progression,
     - loader stays up until all targets satisfied.

- [ ] 5) **Optional: restructure `buildQuery.ts` handling of persisted expansions**
  - Only after steps 1–4 stabilize.

## Suggested additional tests (to prevent regressions)

- Implemented (new):
  - **Delta-only branch cache contract**: `test/plugin/fetchPivotBranch.test.ts` (prevents caching/returning merged snapshots).
  - **Manual expand stale-response guard**: `test/plugin/expand/PivotTableChart.expand.epoch.test.tsx`.
  - **Persisted prefetch stale-response guard**: `test/plugin/PivotTableChart/prefetch.epoch.test.tsx`.
  - **Persisted prefetch concurrent merge**: `test/plugin/PivotTableChart/prefetch.concurrent-merge.test.tsx`.
  - **Persisted prefetch satisfied-targets + loader coverage**: `test/plugin/PivotTableChart/prefetch.satisfied-targets.test.tsx`.

- Still recommended (not yet implemented):
  - **Overlap overwrite test**: craft two different branch responses that both include the same `cellKey` but with disjoint `values` keys, and assert `mergeTrees` results keep the union. This is the most direct way to catch “values disappear due to overwrite” if future changes regress merge semantics.

- Optional:
  - **Loader correctness while hydrating**: assert global `<Loading />` stays up until *all* persisted targets are satisfied (not just “some requests completed”), once hydration is refactored to a “satisfied targets” model.

- Optional: transformProps base-tree reuse correctness (if kept):
  - Ensure `ownState.treeData` isn’t reused across filter changes unless the signature includes filterKey/timeRange.

## Notes on expected outcomes

If the delta-only + epoch-gating changes are made first, you should get:
- Deterministic “query received ⇒ values appear” behavior.
- Fewer “Heisenbugs” due to ordering of async resolves.
- A foundation where adding “batch branch queries” (Requirement #4) is much easier because you can treat all responses as independent deltas and merge them safely.
