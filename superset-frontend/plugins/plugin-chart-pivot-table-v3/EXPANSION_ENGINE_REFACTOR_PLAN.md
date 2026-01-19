# Pivot Table v3 — Expansion Engine Refactor Plan (v2, developer documentation)

This document is a **developer-facing refactor plan + behavioral spec** for the Pivot Table v3 plugin’s expansion/cache/hydration system.

It is written for **test-driven development**: every behavior described below is locked in by tests (unit tests for pure logic + focused RTL tests for end-to-end user-visible behavior).

Scope: `superset-frontend/plugins/plugin-chart-pivot-table-v3/` only.

Related spec:
- `test/plugin/expand/EXPAND_TRANSACTION_RULES.md` (cross-axis transaction rules)

Notes for implementers:
- File/line references in this document are meant as **starting points** and will drift as the refactor progresses. Search by symbol name (e.g. `rg "handleToggle"`).
- Keep changes within `superset-frontend/plugins/plugin-chart-pivot-table-v3/` only.
- TypeScript-only: do not add new `.js`/`.jsx` files; avoid `any`.
- New `.ts`/`.tsx` files must include the ASF license header.
- Quality gates:
  - tests: `npm test plugins/plugin-chart-pivot-table-v3`
  - lint should be run from superst-forntend folder: `npx eslint plugins/plugin-chart-pivot-table-v3`

## 0) Why this refactor exists

The pivot table has multiple expansion drivers that all touch the same underlying problem: **data is fetched in branches**, may arrive **out of order**, and a branch may be **incomplete** relative to the current opposite-axis depth (missing intersection cells).

The system must:
- keep the table snappy (parallel fetch wherever possible),
- never show blank values due to missing intersection data,
- never “collapse → expand” due to async ordering,
- support both ordered, user-driven expansion steps and known-target auto-expand,
- and eventually batch multiple expansions into fewer queries.

### 0.1 Decisions locked in (current stance)

These decisions are locked for this refactor:
- Atomic reveal for cross-axis: never show blanks or collapse-flicker; Cancel-and-revert on collapse during pending (§6).
- Remove depth bumping in `src/buildQuery.ts` (§8).
- Remove `maxDepthPerFetch` (§2.3).
- Swap `rowTotals`/`colTotals` naming to match pivot terminology (§5.12).
- Replace legacy `formData.expansionState` with a dedicated hidden control
  (`pivotExpansionState`) for Explore-only Save/Update persistence (§2.4).
- Keep persistence plugin-only: no Superset core changes; use `setControlValue`
  with a hidden control instead of changing global persistence behavior.
- Use query intent + minimization over unconditional “formatting metrics everywhere” (§5.10).

## 1) Current code map (starting point)

These are the current “hot” files/functions that the engine will replace/own:

- UI + state orchestration:
  - `src/PivotTableChart.tsx` (large component; currently handles persistence + fetch + merge + rendering)
    - Manual toggle handler + ad-hoc cross-axis behavior: `src/PivotTableChart.tsx:4099` (`handleToggle`)
    - “Avoid blanks” render gating hack (causes flicker; must be deleted in refactor): `src/PivotTableChart.tsx:3244` (`shouldGateCrossAxisReveal`) and `src/PivotTableChart.tsx:3289` (`displayedRows`/`displayedCols`)
    - Visible rows/cols orchestration: `src/PivotTableChart.tsx:2933` (row/col root visibility flags) and `src/PivotTableChart.tsx:2947` (calls into `buildVisibleRows` / `buildVisibleCols`)
- Branch fetch:
  - `src/fetchPivotBranch.ts`
    - Query-shape resolution + formatting metrics merge (currently over-fetches): `src/fetchPivotBranch.ts:238` (`resolveFetchContext`) and `src/fetchPivotBranch.ts:251` (`collect*ForQuery` + `mergeMetrics`)
    - Query context construction (many `(rowDepth,colDepth)` pairs per POST): `src/fetchPivotBranch.ts:734` (`buildQueryContext(...)`)
    - Response → tree delta: `src/fetchPivotBranch.ts:764` (`buildTreeFromRecords`)
- Persisted expansion state normalization:
  - `src/pivot/expansionPersistence.ts`
    - Input coercion: `src/pivot/expansionPersistence.ts:95` (`coerceExpansionState`)
    - “visible expansion only” filtering: `src/pivot/expansionPersistence.ts:180` (`getVisibleExpansionKeys`)
- Current satisfaction/hydration planning + loop:
  - `src/pivot/hydrationPlanner.ts` (`planHydrationForAxis`): `src/pivot/hydrationPlanner.ts:86`
  - `src/pivot/usePivotHydration.ts` (hydration loop): `src/pivot/usePivotHydration.ts:35`
- Base tree building:
  - `src/transformProps.ts`
    - Adds formatting/sorting metrics into base query metrics (may also over-fetch): `src/transformProps.ts:134`
  - `src/utils.ts`
    - Path encoding preserves NULL values (keys are fine): `src/utils.ts:217` (`serializePathValue`)
    - Tree construction (NULL label bug lives here): `src/utils.ts:1799` (`buildTreeFromRecords`) and `src/utils.ts:1820` (label fallback)
- Query building:
  - `src/buildQuery.ts` (required change; see §8)
- View-model + visibility helpers (currently split but orchestrated in `PivotTableChart.tsx`):
  - `src/pivot/visibility.ts`: `src/pivot/visibility.ts:34` (`buildVisibleRows`) and `src/pivot/visibility.ts:242` (`buildVisibleCols`)
  - `src/pivot/viewModel.ts`: `src/pivot/viewModel.ts:83` (`buildColumnHeaderRows`) — header label fallback for `null` currently becomes `''` at `src/pivot/viewModel.ts:130`

Existing test areas that must remain green and will be used as regression harness:
- `test/plugin/PivotTableChart/expansion-state.test.tsx`
- `test/plugin/PivotTableChart/prefetch.satisfied-targets.test.tsx`
- `test/plugin/expand/*`

### 1.1 Target new file structure (post-refactor)

Goal: keep “engine”, “query”, and “rendering” separable and testable. The current `src/PivotTableChart.tsx` becomes a thin wrapper.

Target layout:

```
superset-frontend/plugins/plugin-chart-pivot-table-v3/
  src/
    PivotTableChart.tsx                # thin wrapper: hooks + view composition
    pivot/
      engine/
        expansionStateModel.ts         # pure normalization; “visible-only” + auto-expand exception
        expansionPlanner.ts            # pure: desired state + staging tree -> FetchPlan
        revealPolicy.ts                # pure: when to commit + which loaders
        fetchCoordinator.ts            # side effects: cache + in-flight dedupe + epoch gating + parallel dispatch
        useExpansionEngine.ts          # wiring hook: owns committed/staging/transactions
        query/
          queryIntent.ts               # pure: intent model for minimizing query shape
          queryShape.ts                # pure: intent -> columns/metrics needed
          fetchPlanOptimizer.ts        # pure: batch compatible plan targets
          fetchPivotBranch.ts          # side effects: execute a single planned target fetch
          fetchPivotBranchesBatch.ts   # side effects: execute batched request(s)
      render/
        renderModel.ts                 # pure: committed tree + UI state -> RenderModel
        PivotTableView.tsx             # presentational renderer
      shared/
        types.ts                       # engine/render-only types (separate from chart form-data types)
  test/plugin/
    engine/                            # unit tests for pure engine modules
    query/                             # unit tests for intent/shape/batching
    render/                            # unit tests for renderModel
    expand/                            # RTL integration tests (transactions, sequences, regressions)
      helpers/                         # deferred + sequence runners
```

Notes:
- This plan keeps everything within the plugin folder and stays TypeScript-only.
- New `.ts`/`.tsx` files must include the ASF header.

## 2) Definitions and invariants (non-negotiable)

### 2.1 Terminology

- **Axis**: `row` | `col`
- **Key**: serialized path key (see `src/utils.ts` path helpers)
- **Delta**: `PivotTreeData` fragment returned by `fetchPivotBranch` (must not be a merged snapshot)
- **Opposite required depth**:
  - For a row-branch target: required depth is the visible column depth (use the transaction’s target depth when computing plans during atomic reveal).
  - For a col-branch target: required depth is the visible row depth (use the transaction’s target depth when computing plans during atomic reveal).
- **Satisfied target**: a (axis, key) expansion whose fetched data is sufficient for the required opposite depth.
- **Driver**: who requested the expansion (manual clicks, persisted restore, auto-expand, buffered layer expand).

### 2.2 UX invariants

These are the “MUST” behaviors we test relentlessly:

- **No blank intersections**: the user must never see a state where the hierarchy implies certain intersection cells should exist, but those cells are blank purely because the data hasn’t arrived yet.
- **No collapse flicker**: once a node is visible/expanded, it must not disappear just because another request started or another axis expanded.
- **Parallel fetch first**: for any `FetchPlan`, the coordinator starts every required request without awaiting any other request (dedupe and batch-splitting are the only reasons the number of started requests can be lower than the number of planned targets). Waiting is a *reveal/commit* concern, not a fetch concern.
- **No wasted fetch**: do not request data that the UI cannot possibly read/render for the current intent (see §5.10).

### 2.3 Deliberate simplifications (remove knobs)

#### Remove `maxDepthPerFetch` entirely

Decision: delete the `maxDepthPerFetch` concept from the plugin.

Rationale:
- The value is currently hardcoded to `1` in `src/transformProps.ts` and `src/controlPanel.tsx`, so it is not an actual user-facing feature.
- The implementation is a footgun: `0/undefined` effectively turns into “infinite depth” (`Number.MAX_SAFE_INTEGER` in `src/fetchPivotBranch.ts`), which can explode payload size, memory, and latency.
- It overlaps/confuses “cap per request” vs “desired auto-expand table shape”. The expansion engine owns desired shape explicitly; branch fetch does not guess or prefetch.

Replacement rule:
- **Interactive branch expand always fetches exactly one additional level** for that branch (i.e. `targetDepth = path.length + 1`), and nothing deeper “just in case”.
- **Auto-expand / known-target shape** is handled by the planner/engine by emitting explicit “whole-level” targets for the configured depths (see §4.3 and §5.2), not by “fetch deeper per branch”.

Where this impacts code (to be removed during migration):
- Types/props:
  - `src/types.ts` (`PivotTableCustomizeProps.maxDepthPerFetch`, `PivotTableProps.maxDepthPerFetch`)
- Query plumbing:
  - `src/transformProps.ts` (stop setting `maxDepthPerFetch`)
  - `src/controlPanel.tsx` (stop overriding `maxDepthPerFetch`)
- Fetch layer:
  - `src/fetchPivotBranch.ts` (`FetchPivotBranchParams.maxDepthPerFetch`, cache-key meta, `depthIncrement` computation)
- UI orchestration:
  - `src/PivotTableChart.tsx` (stop passing `maxDepthPerFetch` through; replace any “use autoExpandDepth as maxDepthPerFetch” with explicit engine planning)

Tests required (TDD):
- Unit: `test/plugin/fetchPivotBranch.test.ts`
  - Assert branch fetch depth rule is always `path.length + 1` (for the target axis) and never depends on any external “max depth per fetch” parameter.
  - Assert cache-key stability after removing the field (cache is still correct across equivalent calls).
- RTL: expand suites
  - Ensure existing expand behavior remains “one level per click” (until buffered multi-level expand is implemented).
  - Ensure auto-expand no longer routes through a “fetch deeper per branch” mechanism (auto-expand produces explicit whole-level planned targets; §4.3 and §5.2).

### 2.4 Deletions and consolidations (engine replaces legacy)

These are deliberate cuts to reduce moving parts. Each deletion must be backed by tests in the new engine/render model.

#### Delete legacy hydration system

The engine replaces the entire “hydrate expanded branches” loop and planner.

Remove/replace:
- `src/pivot/usePivotHydration.ts` (loop/orchestration; currently runs parallel row+col fetch iterations)
- `src/pivot/hydrationPlanner.ts` (`planHydrationForAxis`)

Key current references:
- loop: `src/pivot/usePivotHydration.ts:83` (main `useEffect`) and `src/pivot/usePivotHydration.ts:114` (`Promise.all([...])`)
- planner: `src/pivot/hydrationPlanner.ts:86`

Replacement:
- `pivot/engine/*` modules (`expansionPlanner.ts`, `fetchCoordinator.ts`, `revealPolicy.ts`) own planning + fetching + satisfaction + reveal.

Tests required:
- Unit: planner/coordinator/reveal policy cover the same “missing opposite-depth” reconciliation logic.
- RTL: persisted restore and cross-axis transaction suites cover the user-visible behaviors previously guarded by hydration.

#### Delete cross-axis “hide nodes to avoid blanks” render gating

This approach causes “collapse → expand” flicker and is explicitly disallowed by UX requirements.

Remove:
- `src/PivotTableChart.tsx:3244` (`shouldGateCrossAxisReveal`)
- `src/PivotTableChart.tsx:3289` (`displayedRows` / `displayedCols` filtering)

Replacement:
- atomic reveal via engine: keep rendering the last committed `RenderModel` and show a blocking overlay until satisfied.

Tests required:
- RTL: “no collapse flicker” and “no blanks” enforced under out-of-order responses.

#### Consolidate in-flight dedupe + epoch gating into the coordinator

Today this logic is scattered across `src/PivotTableChart.tsx` and the hydration hook.

Remove/replace (current state in component):
- `inFlightBranchFetchesRef` and related per-key promise maps: `src/PivotTableChart.tsx:1158`
- ad-hoc epoch gating based on `dataEpochRef.current`: used inside `src/PivotTableChart.tsx:3352` and `src/PivotTableChart.tsx:4165`
- per-key loading key updates mixed into fetch logic

Replacement:
- `pivot/engine/fetchCoordinator.ts` owns:
  - in-flight dedupe (by transaction + target)
  - epoch gating (ignore stale resolves)
  - parallel dispatch + cancellation (Cancel-and-revert semantics)

Explicit rules:
- **Epoch**:
  - Define `epochId: number` owned by the engine.
  - Increment `epochId` on any base dataset/query change that invalidates in-flight results (Update Now, dashboard filter change, form data change that affects the query).
  - Any request is tagged with the `epochId` at dispatch time; a resolve is applied only if its `epochId` still matches the current engine epoch.
  - On epoch change, the coordinator clears:
    - in-flight maps,
    - per-toggle loading state,
    - and the per-chart branch cache.
- **In-flight dedupe key**:
  - A target is uniquely identified by:
    - `axis`
    - `pathKey`
    - `childDepth`
    - `requiredOppositeDepth`
    - `BatchSignature`/query-shape signature (§5.5.1)
  - If the same target is requested while it is in-flight, the coordinator reuses the existing promise and does not dispatch a second network request.

Tests required:
- Unit-ish coordinator tests for dedupe, epoch ignore, cancel behavior.

#### Consolidate expansion state into one model (delete parallel sets)

Today the component uses multiple overlapping sets:
- committed “effective” expanded sets (`expandedRows`/`expandedCols`)
- “fullyExpanded” sets used for partial expansion pruning
- explicit manual expanded/collapsed refs + visibility filtering

Current references:
- `src/PivotTableChart.tsx:1111` (fullyExpanded state)
- `src/PivotTableChart.tsx:3121` (`persistExpansionState` / manual filtering)
- pruning helpers: `src/PivotTableChart.tsx:3993` (`prunePartialExpansions`) and `src/PivotTableChart.tsx:4035` (`dropManualDescendants`)

Replacement:
- `pivot/engine/expansionStateModel.ts` produces one normalized desired state with source metadata (manual vs persisted vs auto vs buffered-step) and the engine derives any needed “effective visible keys”.

Tests required:
- Unit: expansion state model covers “visible-only” + auto-expand exception + manual overrides.
- RTL: sequences of expand/collapse ensure no regressions.

#### Remove unconditional “formatting/sorting metrics are always queried” behavior

Replace global metric-merging with query intent + minimal query shapes.

Current over-fetch references:
- `src/fetchPivotBranch.ts:251` (unconditional merge into `metricsForQuery`)
- `src/transformProps.ts:134` (base query also merges formatting/sorting/databar metrics)

Replacement:
- `pivot/engine/query/queryIntent.ts` + query-shape builder (§5.10).

Tests required:
- Unit: intent → minimal metrics/columns.
- Integration-ish: payload assertions on mocked `SupersetClient.post`.

#### Move branch cache into the coordinator (delete fetch-layer LRU)

Decision: caching lives in the coordinator only. Delete the module-level LRU cache from `src/fetchPivotBranch.ts`.

Current references:
- cache implementation: `src/fetchPivotBranch.ts:82` (`cache` Map + LRU behavior)

Rationale:
- One place for caching and in-flight dedupe reduces race conditions and “why did this fetch?” confusion.
- Per-chart instance cache is sufficient for responsiveness; we do not need a global module singleton.

Explicit cache rules:
- Cache is **per chart instance** and **per epoch** (cleared on `epochId` increment; see §2.4).
- Cache stores **deltas** (`PivotTreeData` fragments) keyed by the same unique target identifier used for in-flight dedupe:
  - `axis`, `pathKey`, `childDepth`, `requiredOppositeDepth`, `BatchSignature` (§5.5.1)
- Eviction policy: LRU, `MAX_BRANCH_CACHE_ENTRIES = 200`.
- Cache correctness rule: a cache hit is treated as an immediately-resolved fetch result and is merged through the same staging path as a network result.

Tests required:
- Unit: cache hit avoids network call and still returns a valid delta.

#### Delete legacy `react-pivottable` code (JS/JSX)

This plugin ships a full `src/react-pivottable/` subtree that conflicts with the “TypeScript-only” modernization.

Decision: delete `src/react-pivottable/` (entire directory).

Tests required:
- Build + plugin tests still pass; no runtime import references remain.

#### Delete `expansionPersistence.ts` once the state model is in place

The engine owns:
- persisted expansion state normalization,
- “visible-only” pruning rules,
- auto-expand exception rules,
- and any future buffered-step semantics.

After `pivot/engine/expansionStateModel.ts` exists and is fully unit-tested, delete/inline the legacy helpers:
- `src/pivot/expansionPersistence.ts`

Current references:
- coercion: `src/pivot/expansionPersistence.ts:95` (`coerceExpansionState`)
- visibility filtering helper: `src/pivot/expansionPersistence.ts:180` (`getVisibleExpansionKeys`)
- auto-seed stripping: `src/pivot/expansionPersistence.ts:116` (`stripAutoSeededExpansions`)

Tests required:
- Unit tests in the new state model must cover all behaviors currently provided by this file.

#### Replace legacy `formData.expansionState` with a hidden persistence control

We do not allow expansion state to affect queries, but Explore must persist expansion
state on Save/Update without triggering re-queries.

Decision:
- Introduce a hidden control (e.g. `pivotExpansionState`) stored in `formData`.
- Mark it `dontRefreshOnChange: true` and `renderTrigger: false` so it never
  triggers Explore queries or refresh warnings.
- The engine writes this hidden control whenever `setControlValue` is available
  (Explore + dashboards) and does not use `ownState` for expansion persistence.
- Plugin-only: do not change Superset core persistence; avoid `setDataMask` for
  expansion persistence in all contexts.
- `buildQuery.ts` must ignore all expansion persistence fields (no depth bumping).

Rationale:
- Explore Save/Update serializes `formData` only; `ownState` is not persisted.
- Dashboards already merge `extraControls` into `formData`, so the same hidden
  control works for dashboard refreshes without new core behavior.
- A hidden control keeps persistence explicit and avoids re-query side effects.

Implementation:
- `src/controlPanel.tsx`: add `pivotExpansionState` as `HiddenControl`.
- `src/types.ts`: add `pivotExpansionState` to chart form-data types.
- `src/PivotTableChart.tsx` / engine: read/write `pivotExpansionState` for Explore persistence.
- Gate Explore writeback behind `persistExpansionState` and use `setControlValue`
  (do not trigger a data fetch).
- `src/buildQuery.ts`: ignore any persisted expansion state (already required in §8).

Tests required:
- RTL: Explore expand updates the hidden control without triggering a global requery.
- RTL: Save/Update restores expansion state via the hidden control.

#### Remove legacy `colSubTotals` boolean + hidden control plumbing

`colSubTotals` exists as a legacy boolean (“all column subtotal levels”) and is still plumbed through:
- query builders,
- cache keys,
- and UI controls (even though the control is hidden).

Simplification:
- Delete `colSubTotals` entirely and rely on `colSubtotalLevels: number[]` only.
- If “select all levels” is desired, model it explicitly as “all levels selected” in `colSubtotalLevels`, not a second boolean.

Current references:
- selector still toggles the boolean: `src/controlPanel.tsx:231` (`setControlValue('colSubTotals', ...)`)
- hidden control: `src/controlPanel.tsx:734` (`name: 'colSubTotals'`)
- legacy behavior inference:
  - `src/buildQuery.ts` uses `colSubTotals` to infer subtotals: `src/buildQuery.ts:111` (destructure) and `src/buildQuery.ts:151` (`colSubtotalsLegacyEnabled`)
  - `src/transformProps.ts:154` and `src/fetchPivotBranch.ts:377` (`colSubtotalsLegacyEnabled`)

Tests required:
- Unit: subtotal-level normalization does not depend on the boolean.
- RTL: column subtotal behavior is driven solely by selected levels.

#### Remove `treeData` snapshot caching in `ownState`

`transformProps` currently uses `ownState.treeData` + a JSON signature to reuse previous tree merges:
- signature build: `src/transformProps.ts:287`
- reuse: `src/transformProps.ts:297`

Remove this: the engine owns committed/staging trees and caching.

Tests required:
- RTL: repeated renders still stable and correct without `ownState.treeData`.

#### Remove legacy alias fields that increase complexity

This plugin is not released yet; keep one canonical field name and delete aliases:
- Conditional formatting:
  - today supports both `conditionalFormatting` and `conditional_formatting` (`src/transformProps.ts:280`)
- Extra form data/time range:
  - `src/fetchPivotBranch.ts` reads `extraFormData` and `timeRange` aliases (`src/fetchPivotBranch.ts:118`)

Plan:
- Keep only the canonical snake_case names produced by Superset form data (`conditional_formatting`, `extra_form_data`, `time_range`) and delete alias handling + `@ts-ignore`.

Tests required:
- Unit: transformProps uses only canonical inputs.

#### Unify initial-load query path with expansion fetches (delete the “two fetch systems”)

Today we have two separate systems that fetch and assemble the tree:
- Initial query path (Explore/dashboard base render):
  - query construction: `src/buildQuery.ts` (multi-query matrix)
  - response assembly: `src/transformProps.ts` (merge all query slices into `PivotTreeData`)
- Expansion query path (interactive / hydration):
  - branch fetch: `src/fetchPivotBranch.ts`
  - ad-hoc orchestration inside `src/PivotTableChart.tsx`

This duplication is a major source of complexity and inconsistent behavior (different caching, different metric merging, different depth handling).

Simplification goal:
- The expansion engine is the **only** place that decides:
  - what to fetch (targets, batches),
  - how to merge (staging),
  - when to reveal (policy).

Decision:
- The initial load is an engine-driven transaction. We delete the “initial multi-query matrix → transformProps merge” pipeline as a primary data path.
- `buildQuery.ts` becomes a minimal bootstrap query (single query) and does not attempt to prefetch the table shape.
- The engine then fetches the real table state via the coordinator, using the same query builder used for expansions.

Concrete current references to delete/simplify:
- Multi-query generation in `src/buildQuery.ts`:
  - `requireMultiQuery` logic: `src/buildQuery.ts:151`
  - query matrix creation: `src/buildQuery.ts:326`
- Depth inference + merge logic in `src/transformProps.ts`:
  - `resolveQueryDepth` parsing/inference: `src/transformProps.ts:190`
  - merging slices into a single tree: `src/transformProps.ts:300`

Tests required:
- RTL: first-load (dashboard + Explore) shows global loader and reveals once (atomic).
- RTL: totals/subtotals correctness is preserved on first load (engine fetch path), without relying on `buildQuery.ts` multi-query matrix.

#### Delete “persist auto-expand zero back into form data” hacks

Current behavior:
- When auto-expand is cleared, the component sometimes forces `expandRowsLevel`/`expandColumnsLevel` to `0` by calling `setControlValue` so the control “sticks” in Explore.
- This is handled via `forcedExpandRowsZeroRef`/`forcedExpandColsZeroRef` and logic at:
  - `src/PivotTableChart.tsx:1235`–`src/PivotTableChart.tsx:1254`

Simplification:
- Treat auto-expand as a pure input to the engine (and don’t mutate Explore controls as a side-effect of runtime state).
- With the hidden persistence control (`pivotExpansionState`), Explore controls still define the
  initial shape, while runtime expansion is persisted via `pivotExpansionState` in both Explore
  and dashboards without requery.

Tests required:
- RTL: clearing auto-expand does not trigger unexpected control mutations and does not change persisted expansion behavior.

#### Delete `legacy_order_by` plumbing (unreleased plugin)

The plugin currently carries `legacy_order_by` in its form-data type, but the v3 query/renderer path uses `orderby` derived from `series_limit_metric` or metrics in `src/buildQuery.ts`.

Remove:
- `legacy_order_by` field from `PivotTableQueryFormData` in `src/types.ts` (and any fixtures/tests that still set it).

Current references:
- type field: `src/types.ts:214` (`legacy_order_by`)

Tests required:
- Type-check + existing unit tests compile after removing the field.

## 3) Universal model: Fetch / Stage / Reveal

The core simplification is to make all expansion behavior go through one pipeline:

1) **Fetch** (parallel):
   - decide what is missing and dispatch requests concurrently (with cache and in-flight dedupe)
2) **Stage** (order-independent):
   - merge deltas into a staging tree as responses arrive
3) **Reveal** (policy-controlled):
   - decide if/when it is safe to update the user-visible tree/expanded sets

Important: the “reveal” layer is where we enforce “no blanks/no flicker”. We do not enforce it by mutating visible rows/cols mid-flight (that causes collapse flicker).

## 4) Expansion drivers (must all use the same engine)

### 4.1 Manual click (today)

Input: one expand/collapse at a time (`handleToggle` in `src/PivotTableChart.tsx:4099` today).

Required behavior:
- same-axis expansions are incremental (no unnecessary waiting),
- cross-axis rapid actions must not produce blanks/flicker.

### 4.2 Persisted restore (dashboard initial load / chart refresh)

Input: many expansions already persisted in `formData.pivotExpansionState`
(Explore Save/Update + dashboard extraControls). Legacy `formData.expansionState`
is removed (see §2.4).

Current entry points (for reference):
- persistence normalization + “visible-only” filtering:
  - `src/pivot/expansionPersistence.ts:95` (`coerceExpansionState`)
  - `src/PivotTableChart.tsx:3121` (`persistExpansionState`)
- hydration loop used to prefetch persisted targets:
  - `src/pivot/usePivotHydration.ts:83` (hydration `useEffect`)

Required behavior:
- global loader stays up until satisfied (Requirement #3),
- fetch is parallel; responses can arrive in any order,
- reveal happens only when all persisted targets satisfied.

### 4.3 Auto-expand (known target)

Input: per-axis levels (`expandRowsLevel`, `expandColumnsLevel`) – known target depths.

Current references (for reference only; logic will be replaced by engine):
- Expand level normalization: `src/PivotTableChart.tsx:706` (`resolveExpandLevel(...)` usage)
- Auto-expand branch fetches mixed into hydration: `src/PivotTableChart.tsx:3380` (auto-expand handling inside `fetchExpandedBranches`)

Required behavior:
- Auto-expand is modeled as a **depth rule**, not as an explicit list of expanded keys:
  - `autoExpandRowsDepth: number` and `autoExpandColsDepth: number`
  - A node is treated as expanded when `nodeDepth < autoExpand*Depth` unless it is explicitly collapsed.
- The planner emits **whole-level targets** for auto-expand:
  - rows auto-expand: one whole-level target with `rowDepth = autoExpandRowsDepth`
  - cols auto-expand: one whole-level target with `colDepth = autoExpandColsDepth`
  - if both axes are auto-expanded, the fetch plan uses the cross-product depth pair (rowDepth, colDepth) so intersections exist at reveal.
- Fetch is parallel and reveal is atomic:
  - dispatch all whole-level targets without awaiting
  - stage results as they arrive
  - reveal exactly once when the final desired depth state is satisfied

### 4.4 Future buffered “full layer expand” (ordered user steps)

Input: user triggers a step like “expand next layer on rows”; later triggers “expand next layer on cols”.

Required behavior:
- **ordered** steps: each step is a transaction boundary (rows-step reveal must happen before cols-step reveal if the user triggered in that order),
- within a step: fetch is parallel, stage is incremental, reveal is atomic when satisfied.

## 5) The Expansion Engine (new modules and responsibilities)

We will add/own these modules under `src/pivot/` (module names and layout are fixed by this plan):

### 5.1 `expansionStateModel.ts` (pure)

Responsibilities:
- Normalize inputs from:
  - persisted expansion state (see `src/pivot/expansionPersistence.ts`),
  - explicit manual expansions/collapses (refs in `src/PivotTableChart.tsx:4099` today),
  - auto-expand levels,
  - buffered layer expand step definitions (future).
- Apply “visible expansion only” rules (Requirement #1).
- Apply “auto-expand exception” rules (Requirement #2).

Current reference points to replace:
- Persisted expansion decoding + filtering: `src/pivot/expansionPersistence.ts:95` and `src/pivot/expansionPersistence.ts:180`
- Manual expansion sets + persistence writeback: `src/PivotTableChart.tsx:3121`

Tests (unit):
- Normalize/merge precedence: persisted vs manual overrides vs auto-expand.
- Visibility filtering:
  - expansion on deep level under collapsed ancestor is dropped.
  - expanding ancestor makes it eligible again.
- Auto-expand exception:
  - if rows auto-expand is active, row expansions are not persisted; col expansions still are (and vice versa).
- Metrics changes:
  - adding/removing/reordering measures does not prune expansions; only row/col prefix changes may prune.

### 5.2 `expansionPlanner.ts` (pure)

Responsibilities:
- Given:
  - `desiredExpansionState`
  - current `stagingTree`
  - required opposite depths (current or target)
  - fetched-depth maps (equivalent to today’s `fetchedRowKeys`/`fetchedColKeys`)
- Output a `FetchPlan`:
  - list of targets where each target is one of:
    - **BranchTarget**: `(axis, pathKey, childDepth, requiredOppositeDepth, metricPath)`
      - used for user/persisted explicit expansions (one key at a time)
    - **WholeLevelTarget**: `(rowDepth, colDepth, prefixKey = rootKey)`
      - used for auto-expand and buffered “expand next layer” steps
  - a `SatisfiedState`/pending set per axis (what is missing)
  - a `SatisfiedState`/pending set per axis (what is missing)

This generalizes/replaces current `planHydrationForAxis` in `src/pivot/hydrationPlanner.ts`.

Current reference points to port:
- Satisfaction rules + missing-node handling: `src/pivot/hydrationPlanner.ts:30` (`isSatisfiedNode`) and `src/pivot/hydrationPlanner.ts:86` (`planHydrationForAxis`)
- “Do we have enough intersection data?” helper used by planner: `src/pivot/visibility.ts:318` (`hasLoadedChildren`)

Tests (unit, exhaustive sequences):
- Single target satisfied vs not satisfied across depth changes.
- Cross-axis depth bump:
  - plan must request top-up when required opposite depth increases.
- Missing node resolution:
  - a persisted/desired expanded key that is not present in the current tree is still fetched directly by its key (no “nearest ancestor” fetch workaround).
- Sequence tests:
  - 5 expands (mixed row/col), assert plan output at each step.
  - collapse of ancestor drops descendant targets from plan.
  - expand/collapse/expand again produces stable plan transitions.

### 5.3 `fetchCoordinator.ts` (side effects, but testable)

Responsibilities:
- Execute a `FetchPlan`:
  - consult a coordinator-owned per-chart cache (no fetch-layer cache)
  - in-flight dedupe (avoid duplicate requests)
  - epoch gating (ignore stale results after base `data` changes)
  - parallel dispatch
- Collect results:
  - per-target delta
  - per-target error
  - completion state

Tests (unit-ish with mocked fetch):
- In-flight dedupe:
  - same target requested twice before resolve only calls fetch once.
- Epoch gating:
  - resolve after epoch change is ignored (tree not mutated).
- Parallel dispatch:
  - N targets → N requests started without awaiting previous.
- Partial failure:
  - persisted restore / auto-expand / cross-axis transaction: one failure fails the transaction; no reveal; table remains on last committed state.
  - same-axis manual expand: one failure fails only that key (spinner clears + error state for that key); table remains interactive.

Current reference points to replace:
- In-flight dedupe + per-key loading counters currently live inside `src/PivotTableChart.tsx:3352` (`fetchExpandedBranches`) and are keyed by `dataEpochRef.current`.
- Hydration loop that repeatedly calls row+col fetch in parallel: `src/pivot/usePivotHydration.ts:114` (`Promise.all([...])`).

### 5.4 `revealPolicy.ts` (pure)

Responsibilities:
- Given:
  - driver type
  - desired state
  - satisfied/pending state
  - staging tree readiness
- Decide:
  - whether to reveal now (commit staged → visible)
  - which loaders are shown (blocking overlay vs per-toggle spinners)
  - whether an incoming manual intent must be treated as an atomic transaction (cross-axis) or can apply incrementally (same-axis)

Current anti-pattern to delete (for clarity):
- Hiding nodes during cross-axis pending by filtering the rendered lists:
  - `src/PivotTableChart.tsx:3244` (`shouldGateCrossAxisReveal`)
  - `src/PivotTableChart.tsx:3289` (`displayedRows`/`displayedCols`)
This causes visible “collapse → expand” flicker and must be replaced by atomic reveal (keep old committed render + overlay).

Policies required:
- Persisted restore: global loader + atomic reveal when satisfied.
- Manual:
  - same-axis expand/collapse: apply incrementally per response (table stays interactive; per-toggle loader only)
  - cross-axis expand clicks within the coalescing window or while the other axis has an in-flight expand: atomic reveal transaction (blocking overlay; last committed table stays visible until satisfied)
- Auto-expand: atomic reveal when satisfied.
- Buffered layer expand: ordered steps; atomic reveal per step.

Tests (unit):
- For each policy, given a matrix of pending/satisfied states, assert reveal/no-reveal and loader mode.

### 5.5 `fetchPlanOptimizer.ts` + `fetchPivotBranchesBatch` (query batching)

Responsibilities:
- Group compatible plan targets into batched *database queries* (not just “one POST containing many independent queries”).
- Build one query per batch using **structured `IN` filters** (no SQL-string filters).
- Return a delta that is equivalent to merging the deltas from running each target individually.

This interacts with `src/fetchPivotBranch.ts` and the query builder (see `src/buildQuery.ts` patterns).

#### 5.5.1 What “compatible targets” means (batching contract)

A set of targets is batch-compatible if and only if all of the following are true:

1) Same **axis**.
2) Same **requested child depth** on that axis.
   - For an expanded key at path length `L`, the “child depth” is `L + 1` (one-level expansion).
3) Same **required opposite-axis depth**.
4) Same **query-shape signature** (the backend query must be identical aside from the branch filter):
   - dataset, datasource, time range, granularity, post_processing
   - base filters (`filters`, `adhoc_filters`, `extra_filters`, `extra_form_data`)
   - the minimized metrics/columns decided by `queryIntent`/`queryShape` (§5.10)
   - totals/subtotals config that changes the `(rowDepth,colDepth)` depth-pair set
5) Same **parent prefix** on the batching axis:
   - Let each target be identified by its expanded path `P` of length `L`.
   - Targets are batch-compatible only when their prefixes `P[0..L-2]` are identical.
   - This is required so we can represent “multiple sibling parents” via one `IN` predicate on the `L-1`th groupby column.

This rule deliberately forbids general boolean OR across arbitrary path predicates because the `filters` clause used by `/api/v1/chart/data` is an AND-list; building SQL strings is not allowed.

Implementation rule (signature computation):
- Define a `BatchSignature` as a stable serialization of:
  - axis
  - `(childDepth, requiredOppositeDepth)`
  - the **query object template** (everything that goes into the Superset query object except `filters` and `query_name`)
- Two targets are “same query-shape signature” when their `BatchSignature` is identical byte-for-byte.

#### 5.5.2 How a batch query is constructed (IN batching)

Given a batch group with:
- axis `A`
- groupby columns `G = (g0, g1, ..., gN-1)` for axis `A` (after metrics-axis stripping)
- parent prefix `prefix = (p0, ..., pL-2)` for expanded paths of length `L`
- expanded sibling values `siblings = (s0, s1, ..., sk-1)` where `si = P_i[L-1]`

The branch filter for the batch is:
- For `i in [0, L-2]`: filter `gi == pi` (or `IS NULL` if `pi` is `null`)
- For `i = L-1`: filter `g(L-1) IN (siblings)` for non-null siblings

Null handling (explicit rule):
- If any `siblings` value is `null`, split into two batches:
  - one batch with `g(L-1) IS NULL`
  - one batch with `g(L-1) IN (nonNullSiblings)`

Concrete example:
- `groupbyRows = [country, state, city]`
- Expanded sibling parents at depth 2: `(US, CA)` and `(US, NY)`
- We are fetching their children (depth 3), so `L = 2`, `prefix = [US]`, `siblings = [CA, NY]`
- Batched branch filter becomes:
  - `country == 'US'`
  - `state IN ('CA', 'NY')`
  - and the query groups by `[country, state, city, ...oppositeAxisColumns]` for the chosen depth pair

Depth pairs (explicit rule):
- The batch executes the same depth-pair matrix that an individual `fetchPivotBranch` would execute for that axis at `(childDepth, requiredOppositeDepth)` (including subtotal/total-driven pairs).
- The only difference from the individual case is the branch filter: `==` becomes `IN` at the last parent column for the sibling set.

Backend request shape (explicit rule):
- A “batched fetch” is still one POST to `/api/v1/chart/data`, but the `queries` array contains:
  - **one query object per required depth pair** (not one per target)
  - each query object uses the shared `IN`-based branch filter for the sibling set
- This reduces DB query count from `(#targets × #depthPairs)` to `(#batches × #depthPairs)`.

Result interpretation (explicit rule):
- A batched query returns one `PivotTreeData` delta that contains the union of nodes/cells for all sibling targets in the batch.
- The coordinator does not need to split the delta by target key. Satisfaction is recomputed after merging by checking each pending target key against the staged tree (`hasLoadedChildren` + fetched-depth tracking).

Batch size cap (explicit rule):
- `MAX_BATCH_SIBLINGS = 50`. If a batch has more than 50 siblings, split into chunks of 50, each producing its own batch query.

#### 5.5.3 What batching is NOT

- Not “one POST with N independent queries”: that only saves network overhead and does not reduce DB query count.
- Not “OR across arbitrary prefixes”: forbidden by the structured-filter requirement.
- Not “union by concatenating two unrelated trees”: the delta must be produced by `buildTreeFromRecords(...)` from the batched records, then merged via the same staging merge path as individual branches.

Tests:
- Optimizer grouping:
  - only compatible targets are batched (rules in §5.5.1).
  - sibling batching groups by parent prefix and splits null vs non-null siblings.
  - batch size cap `MAX_BATCH_SIBLINGS = 50` is enforced.
- Equivalence:
  - batched delta equals merging individual deltas for the same sibling set (node set + cell set).
- Out-of-order batch results:
  - staging merge yields same final tree independent of batch completion order.

### 5.6 `renderModel.ts` (pure, “table UI constructor”)

This refactor is a good time to make the renderer deterministic and testable.

Today, `src/PivotTableChart.tsx` performs a lot of “UI construction” in-line (visible rows/cols, leaf building, header rows, filtering metric totals, etc.). Some logic already lives in helpers, but it’s still orchestrated through many `useMemo` blocks.

Goal: centralize that orchestration into a **single pure builder** that takes a committed tree + UI state and returns a complete `RenderModel` that a dumb view can render.

Inputs:
- `tree: PivotTreeData` (committed or staging snapshot)
- expansion controls:
  - `explicitlyExpandedRows`, `explicitlyExpandedCols` (manual/persisted key sets)
  - `explicitlyCollapsedRows`, `explicitlyCollapsedCols` (manual collapse overrides)
  - `autoExpandRowsDepth`, `autoExpandColsDepth` (depth rules; §4.3)
- chart config that affects shape (metrics layout, totals/subtotals settings, sorters, “skip root” flags, etc.)

Output (final shape; implement as a single `RenderModel` type in `src/pivot/shared/types.ts`):
- `visibleRows: PivotTreeNode[]`
- `visibleCols: PivotTreeNode[]`
- `colLeaves: PivotTreeNode[]` (including subtotal leaves)
- `columnHeaderRows: PivotTreeNode[][]` (for rendering `<thead>`)
- `visibleCellEntries: Array<{ rowKey; colKey; cellKey; cell?: PivotResultCell }>`
- derived rendering flags (explicit, no extra “misc flags”):
  - `showRowRoot`, `showColRoot`
  - `skipRowRoot`, `skipColRoot`
  - `hideMetricHeaderOnRows`, `hideMetricHeaderOnCols`
  - `shouldHideMetricGrandTotalsOnRows`, `shouldHideMetricGrandTotalsOnCols`

Implementation notes / links to existing logic:
- Visible row/col construction:
  - `src/pivot/visibility.ts:34` (`buildVisibleRows`)
  - `src/pivot/visibility.ts:242` (`buildVisibleCols`)
  - `src/pivot/visibility.ts:77` (`createColLeavesBuilder`)
- Column header modeling:
  - `src/pivot/viewModel.ts:83` (`buildColumnHeaderRows`)
- Cell enumeration + formatting:
  - `src/pivot/cellUtils.ts:169` (`buildVisibleCellEntries`)
  - `src/pivot/cellUtils.ts:115` (`formatNodeLabel`)
- Metric/totals node handling:
  - `src/pivot/metricsTotals.ts:65` (`isMetricGrandTotalNode`)
  - `src/pivot/metricsTotals.ts:185` (`isExplicitTotalNode`)
  - `src/pivot/metricsTotals.ts:176` (`countDimDepth`)

Non-goals:
- This is not the expansion engine; it must not start network requests or decide reveal policy.

Tests (unit, exhaustive):
- “Shape invariants”:
  - stable ordering given the same tree + state
  - no duplicate keys in visible rows/cols/leaves
- Totals/subtotals layouts:
  - row totals on/off; col totals on/off; subtotal levels; subtotal positions
  - “metric grand total” suppression cases
- Metrics layout edge cases:
  - metrics-before vs metrics-between and root suppression scenarios
  - multi-metric tier headers preserve order
- Five-action UI state sequence (pure):
  - simulate expansion set changes (no network), rebuild render model each step, assert no impossible intermediate shapes are produced (e.g. a visible child without its ancestor in the visible list)

### 5.7 `PivotTableView.tsx` (presentational)

Create a view component that renders only from a `RenderModel` + loader flags and emits UI events.

Responsibilities:
- render table layout (headers + body) from `RenderModel`
- show loaders:
  - **global blocking overlay** for atomic reveal transactions (persisted restore, auto-expand, cross-axis transaction)
  - per-toggle spinners for incremental same-axis expands
- emit user intents:
  - `onToggleNode(axis: PivotAxis, key: PivotKey): void`

Important invariant:
- When an atomic transaction is pending, render the **last committed** `RenderModel` and show a blocking overlay. Do not hide nodes or partially mutate visible rows/cols to “avoid blanks” (that causes collapse flicker).

Tests (RTL):
- Loader semantics:
  - atomic transaction keeps old table visible + global overlay spinner until reveal
  - same-axis expand keeps table interactive and shows only per-toggle loader
- “No collapse flicker” regression:
  - expanding on the other axis must not visually collapse already-expanded nodes while loading

### 5.8 `useExpansionEngine.ts` (wiring layer)

This is the glue between:
- state model (`expansionStateModel.ts`)
- planner (`expansionPlanner.ts`)
- coordinator (`fetchCoordinator.ts`)
- reveal policy (`revealPolicy.ts`)
- renderer (`renderModel.ts`)

Responsibilities:
- maintain:
  - committed tree + committed expansion sets
  - staging tree + staged deltas
  - transaction state (pending/satisfied, loader mode)
- expose to the view:
  - `renderModel` for the committed state
  - loader flags (global vs per-key)
  - event handlers for user intents

Tests:
- Use unit tests for pure modules; keep this layer’s tests focused on “wiring correctness” and epoch cancellation.

### 5.9 Test harness helpers (`test/plugin/expand/helpers/*`)

To keep “test every little thing” maintainable, add small shared utilities:
- `deferred()` promises for deterministic out-of-order resolve (already used in some suites)
- helpers to run sequences:
  - `clickExpandRow(key)`, `clickExpandCol(key)`
  - `resolveFetch({ axis, key, payload })` in a controlled order
  - “assert no blanks” and “assert no collapse flicker” helpers that encode the UX invariants in one place

This reduces copy/paste when adding the long scenario matrix (5 expands, collapses, mixed sequences, epoch changes).

### 5.10 `queryIntent.ts` + metric/column minimization (eliminate unneeded requests)

Problem statement:
- Today, branch fetches can include extra metrics/columns because formatting/sorting configuration is merged into the query shape globally (e.g. conditional formatting or dimension sorting based on a measure).
- In many cases the UI will **never read** those values for a given target depth (e.g. formatting that applies only to totals, or a sort metric only needed to order a specific level), but we still pay the DB cost and payload cost for every fetch.

Concrete current references (where over-fetch happens today):
- Branch fetch path:
  - `src/fetchPivotBranch.ts:238` (`resolveFetchContext`)
  - `src/fetchPivotBranch.ts:251` collects formatting/sorting metrics and merges them into `metricsForQuery` unconditionally.
  - Collector implementations live in `src/utils.ts:910` (`collectMetricFormattingMetricsForQuery`), `src/utils.ts:928` (`collectDimensionFormattingMetricsForQuery`), `src/utils.ts:948` (`collectDimensionSortingMetricsForQuery`), `src/utils.ts:1144` (`collectMetricDatabarMetricsForQuery`).
- Base query path:
  - `src/transformProps.ts:134` also merges formatting/sorting/databar metrics into the base query metrics.

Goal:
- Make every request explicit about **what it is for** (“intent”), and compute the minimal query shape for that intent.

Proposed API surface:
- `QueryIntent` (pure data):
  - `kind: 'branch' | 'wholeLevel' | 'totalsOnly' | 'formattingOnly' | ...` (exact set evolves)
  - `axis`, `path/key` (if branch)
  - `targetRowDepth/targetColDepth`
  - which UI operations require the result:
    - `needsRowOrdering`, `needsColOrdering`
    - `needsValueCells`, `needsRowTotals`, `needsColTotals`
    - `needsDimensionFormatting`, `needsMetricFormatting`, `needsDatabars`
    - “applyTo” scopes (values only vs totals vs include grand totals)

Key rule:
- If a formatting/sorting rule applies only to a subset of cells/levels, only include its dependency metrics in the request(s) that will actually render/order that subset.

Where this plugs in:
- Replace the current “always merge formatting metrics into `metricsForQuery`” approach in:
  - `src/fetchPivotBranch.ts` (today: `collect*ForQuery` + `mergeMetrics` at `src/fetchPivotBranch.ts:251`)
- The expansion engine decides intent per target, and the query builder translates that into:
  - minimal `columns` (groupby subset)
  - minimal `metrics` (only those needed for rendering/order at the requested depths)

Tests required (TDD):
- Unit: intent → query shape
  - Given a single conditional formatting rule with `applyTo = values only`, assert that totals-only requests do not include its dependency metrics.
  - Given a row/col sort-by-metric rule that sorts only at a specific level, assert the metric is included only when that level is being fetched/rendered.
  - Given multiple rules, assert the union is minimal and stable (no duplicates, deterministic order).
- Integration-ish (mock `SupersetClient.post` payload):
  - Expand a branch where formatting does not apply to any newly visible cells → assert payload does not include formatting-only metrics.
  - Persisted restore with many targets + some formatting rules → assert only relevant batched queries include those metrics.

### 5.11 Data correctness: NULL must not look like totals

Bug/regression to lock down:
- A dimension value of `NULL` returned from the DB renders as a normal member (`(NULL)`), not as “Grand total” / “Total” or an empty header.

Current root causes:
- Node label generation in `src/utils.ts:1799` (`buildTreeFromRecords`) uses `path[last]?.toString() ?? totalLabel` at `src/utils.ts:1820`, which turns `null` into `totalLabel` (often “Total”).
- Header label fallback in `src/pivot/viewModel.ts:83` (`buildColumnHeaderRows`) uses `String(headerPath[level] ?? '')` at `src/pivot/viewModel.ts:130`, which turns `null` into `''` in synthesized headers.

Important nuance:
- Path keys already preserve `null` distinctly (`src/utils.ts:217` `serializePathValue` encodes `null` as `__NULL__`). This bug is primarily about **labeling/rendering**, not key collisions.

Plan:
- Introduce one canonical formatter `formatDimensionMemberLabel(value)` used in both tree-building and header modeling:
  - `null` → `(NULL)` (stable)
  - `undefined` → `(undefined)` (still stable)
  - other primitives → `String(value)`
- Ensure totals labels (“Total”, “Grand total”) are reserved for explicit subtotal/total nodes only.

Tests (unit):
- Build-tree correctness:
  - Given a record with a groupby value `null`, assert the node label is `(NULL)` and its key is `serializePath([null])`, not `rootKey`.
  - Assert that `(NULL)` nodes are never classified as explicit totals by `isExplicitTotalNode` unless they actually have subtotal tokens.
- Render-model correctness:
  - Column header rows for a `(NULL)` member show `(NULL)` and do not merge with root/grand total headers.

### 5.12 UI config correctness: row totals vs column totals

Bug/regression to lock down:
- Row totals and column totals appear swapped/mixed in the UI (labels or toggles affecting the opposite axis).

Decision (breaking change is OK): swap the names to match standard pivot terminology.

Target semantics:
- `rowTotals` = totals per row → render a **grand total column** (position: front/end).
- `colTotals` = totals per column → render a **grand total row** (position: top/bottom).

Implementation approach:
- Perform a deliberate, repository-local breaking rename (this plugin is not released yet):
  - Rename the existing “grand total row” toggle from `rowTotals` → `colTotals`.
  - Rename the existing “grand total column” toggle from `colTotals` → `rowTotals`.
  - Swap the corresponding position controls as well:
    - `rowTotalPosition` (top/bottom) → `colTotalPosition`
    - `colTotalPosition` (front/end) → `rowTotalPosition`
- After the swap, UI labels/descriptions read literally (“Row totals”, “Column totals”) and match behavior.

Current behavior (why this is not just UI copy):
- In the tree builder, totals are interpreted as:
  - row-node totals when `colPath.length === 0` (`src/utils.ts:1866` / `src/utils.ts:1869`)
  - col-node totals when `rowPath.length === 0` (`src/utils.ts:1867` / `src/utils.ts:1875`)
- In the renderer, the config toggles are wired to *where the grand total appears*:
  - `rowTotals` currently drives whether the **row root / grand total row** is shown (`src/PivotTableChart.tsx:2933`)
  - `colTotals` currently drives whether the **col root / grand total column** is shown (`src/PivotTableChart.tsx:2939`)

Concrete current references (where to look during implementation):
- Controls (source of truth for form-data keys):
  - `src/controlPanel.tsx:629` (`rowTotals`, `rowTotalPosition`)
  - `src/controlPanel.tsx:705` (`colTotals`, `colTotalPosition`)
- Render shape flags:
  - `src/PivotTableChart.tsx:2933` (`showRowRootBase` depends on `rowTotals`)
  - `src/PivotTableChart.tsx:2939` (`showColRoot` depends on `colTotals`/`colSubTotals`)
- Visibility helpers:
  - `src/pivot/visibility.ts:34` (`buildVisibleRows` uses `rowTotalPosition`)
  - `src/pivot/visibility.ts:77` (`createColLeavesBuilder` decides when to inject/position subtotal/total leaves)

Plan:
- Do the swap early in the refactor (before splitting out `renderModel.ts`) so the extracted code uses correct naming from day one.
- Apply the rename consistently across:
  - `src/types.ts` (form-data/props fields),
  - `src/controlPanel.tsx` (control `name` keys and UI copy),
  - `src/transformProps.ts` (query form-data defaults/derivations),
  - `src/PivotTableChart.tsx` (render shape + behavior),
  - all tests + fixtures under `test/plugin/`.
- During the refactor, ensure the “RenderModel builder” is the only place where these flags affect shape, so mistakes are localized.

Tests (RTL):
- Toggle matrix:
  - (rowTotals on/off) × (colTotals on/off)
  - assert:
    - `rowTotals=true` produces a total **column** (and respects `rowTotalPosition` front/end),
    - `colTotals=true` produces a total **row** (and respects `colTotalPosition` top/bottom),
    - the two toggles are independent.
- Copy regression:
  - assert the control labels and descriptions match the new semantics (“Row totals”/“Column totals”).

## 6) Cross-axis transactions (atomic reveal, parallel fetch)

Cross-axis is the hard case: expanding one axis changes the required opposite depth for intersections.

The engine must support:
- parallel fetch (requests start immediately),
- incremental staging (merge deltas as they arrive),
- atomic reveal (commit only when satisfied),
- deterministic cancellation/superseding.

The strict rules live in `test/plugin/expand/EXPAND_TRANSACTION_RULES.md`. This plan adds a test matrix to enforce it.

### Required test scenarios (RTL integration)

Add a dedicated suite: `test/plugin/expand/PivotTableChart.expand.transaction.test.tsx`, using deferred promises like existing expand tests.

Minimum scenarios (each is a separate test; “test every little thing”):

1) **Row→Col rapid expand, col resolves first**
- Click row expand key A, then col expand key C.
- Resolve col response; assert nothing is revealed that would require missing intersections.
- Resolve row response; still not revealed if top-up required is missing.
- Resolve required top-up; then reveal occurs once, atomically.

2) **Row→Col rapid expand, row resolves first** (mirror)

3) **Five-action sequence (mixed)**
- Expand row A, expand col C, expand row A/X, collapse col C, expand col C again.
- Resolve responses in a shuffled order.
- Assert:
  - no blanks
  - no collapse flicker
  - final state matches the final desired expansion sets

4) **Collapse during pending transaction**
- Expand row A (starts fetch), then expand col C (transaction).
- Before resolve, collapse a key involved in the transaction (row A on rows; equivalently: col C on columns).
- Assert deterministic rule:
  - transaction canceled and UI returns to previous stable state (Cancel-and-revert).

5) **Epoch change during pending transaction**
- Start cross-axis transaction.
- Simulate base `data` change (Update Now).
- Resolve old promises; assert ignored, no reveal changes.

6) **Auto-expand + persisted restore interplay**
- Persisted expansions exist, auto-expand enabled on one axis (exception rule).
- Assert that persisted expansions for that axis are ignored, other axis still restored, and reveal gated globally.

## 7) Persisted restore (dashboard load): batching and correctness

Persisted restore is the highest ROI for batching:
- many targets known up-front,
- global loader already blocks reveal until satisfied,
- parallel fetch is desirable to reduce wall-clock time.

Tests (RTL integration):
- Persisted expansions with 3 row keys + 3 col keys:
  - optimizer produces sibling batches where possible (§5.5.1) and reduces DB query count (assert on mock payload query count, not just number of POSTs).
- Out-of-order results still produce correct final render once.
- Global loader stays up until satisfied (no partial reveal).

Unit tests:
- `fetchPlanOptimizer` chooses batching.
- `fetchPivotBranchesBatch` returns correct delta union.

## 8) Required: remove `buildQuery.ts` depth bumping

Decision: remove depth bumping entirely.

What “depth bumping” is today:
- `src/buildQuery.ts` computes `rowDepthLimit`/`colDepthLimit` from the initial UI shape (expand level), then raises them based on persisted expansion depth (legacy `formData.expansionState`).
- This happens here:
  - bump rows: `src/buildQuery.ts:253`
  - bump cols: `src/buildQuery.ts:262`

Why we remove it:
- It forces the initial Explore/dashboard query to fetch deeper groupby levels **globally** (no branch filters), which can massively inflate payloads and DB work.
- It conflicts with the expansion engine goals:
  - persisted restore is handled by planned branch/batched fetches (parallel fetch, staging merge, atomic reveal),
  - auto-expand uses whole-level shape queries (known target depth), not “bump because some persisted key exists”.

Implementation checklist (TDD):
- Update `src/buildQuery.ts`:
  - delete `resolveExpansionDepth(...)` usage for persisted expansion bumping (legacy `formData.expansionState` only; `pivotExpansionState` must never affect queries).
  - ensure totals/subtotals queries still include required `(rowDepth,colDepth)` pairs based on the *visible* initial shape.
- Add/adjust unit tests for `buildQuery`:
  - persisted `expansionState` must not increase `rowDepthLimit`/`colDepthLimit` (snapshot or structural assertions on generated `columns`).
  - auto-expand still produces the expected whole-level depth (based on `expandRowsLevel`/`expandColumnsLevel` only).
- totals/sorting/formatting forcing `rowDepths`/`colDepths` to include `0` still works (regression coverage).

## 9) Migration strategy (TDD, phased, non-negotiable)

This migration must include §8, plus the naming cleanups and query minimization work described earlier.

Principles:
- Implement **pure modules first** (unit tests), then minimal wiring, then RTL integration tests.
- Keep the UI stable during refactors by rendering the **last committed** table when transactions are pending (overlay loader), rather than mutating visible lists mid-flight.
- Land changes in small, test-locked increments; each phase leaves the suite green.

### Phase 0 — Remove legacy query behavior (required, before engine)

0.1) Remove `buildQuery.ts` depth bumping (§8)
- Implement: `src/buildQuery.ts:253` and `src/buildQuery.ts:262`
- Tests:
  - add/adjust `buildQuery` unit tests to prove persisted `expansionState` no longer increases initial depths.

0.2) Remove “fetch knobs” that conflict with the engine (and do not reintroduce them)
- Implement: delete `maxDepthPerFetch` as described in §2.3.
- Tests:
  - adjust affected unit + RTL tests to rely on explicit engine intent rather than per-fetch caps.

0.3) Fix naming now (since backwards compatibility is not a concern)
- Implement: apply the rowTotals/colTotals swap described in §5.12 across `src/types.ts`, `src/controlPanel.tsx`, `src/transformProps.ts`, `src/PivotTableChart.tsx`, tests/fixtures.
- Tests:
  - add the RTL toggle matrix for totals semantics and copy assertions.

0.4) Remove legacy/duplicate config fields (unreleased plugin simplification)
- Remove legacy `formData.expansionState` and replace with `pivotExpansionState`
  hidden control (plugin-only, no Superset core changes) for Explore-only persistence: see §2.4.
- Remove `colSubTotals` legacy boolean (levels only): see §2.4.
- Remove alias fields (`conditionalFormatting`, `extraFormData`, `timeRange`): see §2.4.
- Remove `legacy_order_by`: see §2.4.
- Tests:
  - update fixtures and unit tests to use only canonical fields; keep the plugin suite green.

Exit criteria (Phase 0):
- `buildQuery` no longer bumps depths from persisted expansions.
- Chart config surface area is smaller: no `maxDepthPerFetch`, no legacy `formData.expansionState`, no `colSubTotals`, no legacy aliases, no `legacy_order_by`.
- Explore persistence uses hidden `pivotExpansionState` without triggering queries (via `setControlValue`).
- Totals naming is correct and tested.

### Phase 1 — Extract pure state model + planner (engine core, no UI wiring yet)

1.1) Extract `expansionStateModel.ts` (unit tests first)
- Inputs: persisted expansion state (`src/pivot/expansionPersistence.ts:95`), manual overrides (`src/PivotTableChart.tsx:4099`), auto-expand levels.
- Output: normalized desired state + “visible-only” filtering + auto-expand exception.
- Tests:
  - precedence rules, visibility filtering, auto-expand persistence exception.

1.1a) Delete legacy persistence helpers once parity is reached
- Remove `src/pivot/expansionPersistence.ts` (see §2.4).

1.2) Extract `expansionPlanner.ts` (unit tests first)
- Port rules from:
  - `src/pivot/hydrationPlanner.ts:30` and `src/pivot/hydrationPlanner.ts:86`
  - `src/pivot/visibility.ts:318` (`hasLoadedChildren`) as a dependency or re-implemented pure equivalent.
- Tests:
  - per-axis satisfaction, cross-axis required-depth bump, missing-node resolution, 5-action sequence plan evolution.

Exit criteria (Phase 1):
- New state model + planner are fully covered by unit tests and do not depend on React/component state.
- Legacy persistence helpers are deleted.

### Phase 2 — Coordinator + staging tree (no renderer changes yet)

2.1) Add `fetchCoordinator.ts` (unit-ish tests with mocked fetch)
- Responsibilities: cache, in-flight dedupe, epoch gating, parallel dispatch, result collection.
- Replace/centralize logic currently in `src/PivotTableChart.tsx:3352` and `src/pivot/usePivotHydration.ts:114`.
- Tests:
  - dedupe, epoch ignore, parallel start, cancellation semantics.

2.2) Introduce a staging tree abstraction (pure merge semantics)
- Reuse existing `mergeTrees` (`src/utils.ts`) but wrap it with “transaction staging” semantics (order-independent).
- Tests:
  - out-of-order deltas produce identical final staged tree.

Exit criteria (Phase 2):
- Coordinator is the single owner of in-flight dedupe + epoch gating.
- Staging merge is order-independent and test-proven.

### Phase 3 — Rendering split (RenderModel + View), then wire engine

3.1) Extract `renderModel.ts` (unit tests first)
- Move orchestration currently in `src/PivotTableChart.tsx:2933`–`src/PivotTableChart.tsx:3058` into a pure builder.
- Reuse helpers:
  - `src/pivot/visibility.ts`, `src/pivot/viewModel.ts`, `src/pivot/cellUtils.ts`, `src/pivot/metricsTotals.ts`.
- Tests:
  - deterministic render model, totals/subtotals, metrics layouts, no impossible intermediate shapes.

3.2) Add `PivotTableView.tsx` (RTL tests)
- Render-only component: headers + body + loaders, emits toggle intents.
- Tests:
  - global overlay for atomic transactions, per-toggle loader for incremental same-axis expands.
  - “no collapse flicker” regression.

3.3) Add `useExpansionEngine.ts` and wire into `PivotTableChart.tsx`
- Start with persisted restore only (global loader), then manual expand, then auto-expand.
- Tests:
  - reuse existing persisted restore tests and add the strict cross-axis transaction suite.

3.4) Delete component-level expansion plumbing as it becomes redundant
- Remove:
  - hydration hook usage (`src/pivot/usePivotHydration.ts`) once engine owns fetching/reveal
  - ad-hoc in-flight maps/refs and fetched-depth maps in `src/PivotTableChart.tsx`
  - “auto-expand zero persist” hack (`src/PivotTableChart.tsx:1235`–`:1254`)
- Tests:
  - keep cross-axis + persisted restore + same-axis incremental tests green.

Exit criteria (Phase 3):
- Rendering is isolated (View + RenderModel), and the engine hook is the only mutation source for expansion state and tree updates.
- Cross-axis transactions satisfy “no blanks/no flicker” with Cancel-and-revert behavior.

### Phase 4 — Query minimization + batching (performance + correctness)

4.1) Add `queryIntent.ts` + query-shape builder (§5.10) (unit tests first)
- Stop unconditional metric merging in `src/fetchPivotBranch.ts:251` and `src/transformProps.ts:134`.
- Tests:
  - intent→metrics/columns minimality, deterministic union behavior.

4.2) Add batching optimizer + batched fetch (§5.5) (unit + RTL)
- Use structured `IN` batching for compatible sibling targets (§5.5.1–§5.5.2); keep staging merge order-independent.
- Tests:
  - payload grouping rules, equivalence vs individual fetch, out-of-order batches.

Exit criteria (Phase 4):
- Requests contain only required metrics/columns for the intent.
- Persisted restore uses batching and stays correct under out-of-order responses.

### Phase 5 — Correctness cleanups + deletions

5.1) Fix NULL labeling bug (§5.11) with a single shared formatter
- Update `src/utils.ts:1820` and `src/pivot/viewModel.ts:130` to render `(NULL)` rather than totals/empty labels.
- Add unit tests for both tree-building and render headers.

5.2) Delete legacy paths once tests cover parity
- Remove cross-axis render gating (`src/PivotTableChart.tsx:3244`/`:3289`).
- Delete remaining legacy modules/directories that are now redundant:
  - `src/pivot/usePivotHydration.ts`
  - `src/pivot/hydrationPlanner.ts`
  - `src/react-pivottable/` (delete directory)
  - `ownState.treeData` snapshot caching in `src/transformProps.ts` (engine owns trees)

### Phase 6 — Unify the initial-load query pipeline (required, “one fetch system”)

Implement the “single fetch system” decision from §2.4:
- Replace the `buildQuery.ts` multi-query matrix + `transformProps.ts` slice-merging with an engine-driven initial transaction.

Implementation:
- `src/buildQuery.ts`:
  - emit exactly one minimal bootstrap query (no depth matrix, no persisted-expansion bumping).
  - keep `query_name` stable for debugging, but do not use it to infer table shape.
- `src/transformProps.ts`:
  - stop merging query slices into the full tree (`src/transformProps.ts:300` becomes obsolete).
  - provide a minimal initial `tree` (root nodes only) and pass through the necessary config/hooks for the engine to fetch.
- Engine:
  - on mount, start an initial “load transaction” (global loader) to fetch the desired initial shape (auto-expand levels + totals/subtotals requirements), then reveal once.

Exit criteria (Phase 6):
- First-load Explore and dashboard use the coordinator fetch path (same code path as expansions).
- No depth inference from `parseDepth` is needed in `transformProps.ts`.
- Initial load remains fast (parallel fetch + batching where applicable) and preserves totals/subtotals correctness.

Always keep these green:
- `npm test plugins/plugin-chart-pivot-table-v3`
- plugin lint (`npm run lint` or `eslint` subset)

## Refactor log (work completed)

### Phase 0 + early Phase 1
- Removed legacy knobs/aliases:
  - `maxDepthPerFetch`, legacy `formData.expansionState` (replacement hidden control planned), `colSubTotals`, alias fields (`conditionalFormatting`, `extraFormData`, `timeRange`), `legacy_order_by`.
- Swapped totals semantics (rowTotals/colTotals) across types, control panel, query building, fetch, and rendering.
- Removed depth bumping from `buildQuery.ts` (persisted expansion no longer increases initial depths).
- Simplified branch fetch depth to one level per expand (no auto bump).
- Updated README/requirements to reflect the new config surface (no maxDepthPerFetch).
- Updated tests/fixtures to use canonical fields only and new totals semantics.
- Expansion persistence uses the hidden control (`pivotExpansionState`) via `setControlValue`
  and does not rely on `ownState`.
- Added engine state model:
  - New `src/pivot/engine/expansionStateModel.ts` (moved logic from `src/pivot/expansionPersistence.ts`).
  - Added unit tests: `test/plugin/engine/expansionStateModel.test.ts`.
  - Removed `src/pivot/expansionPersistence.ts` and rewired `PivotTableChart.tsx` imports.

### Phase 1 continuation
- Added engine expansion planner:
  - New `src/pivot/engine/expansionPlanner.ts` (pure planner extracted from hydration logic).
  - Added unit tests: `test/plugin/engine/expansionPlanner.test.ts`.
  - `src/pivot/hydrationPlanner.ts` now re-exports `planExpansionForAxis` to keep legacy wiring aligned.

### Phase 2
- Added fetch coordinator + staging tree primitives:
  - New `src/pivot/engine/fetchCoordinator.ts` with LRU cache, in-flight dedupe, epoch gating, and cancellation semantics.
  - New `src/pivot/engine/stagingTree.ts` for order-independent delta merging.
  - Added unit tests: `test/plugin/engine/fetchCoordinator.test.ts`, `test/plugin/engine/stagingTree.test.ts`.

### Phase 3 (partial)
- Rendering split started:
  - Added `src/pivot/render/renderModel.ts` + `src/pivot/shared/types.ts` (RenderModel + formatting keys).
  - Added `src/pivot/render/PivotTableView.tsx` and moved table rendering into the view component.
  - Added tests: `test/plugin/render/renderModel.test.ts`, `test/plugin/render/PivotTableView.test.tsx`.
- PivotTableChart now builds a RenderModel and delegates rendering to `PivotTableView`.
- Removed cross-axis “displayed rows/cols” gating in the component and show the global loader during cross-axis hydration.

### Validation notes
- Phase 3 changes: `npm test plugins/plugin-chart-pivot-table-v3` passes (duplicate mock + Browserslist warnings).
- Phase 3 lint: `npx eslint plugins/plugin-chart-pivot-table-v3` passes with warnings (unused vars + exhaustive-deps).

### Phase 3 (current refactor progress)
- Implemented metric-aware expansion resolution in the engine:
  - Added metric-pattern expansion helpers (e.g. `expandMetricPatternExpansions`, `resolveExpandedForMetrics`) and collapse-aware pruning in `src/pivot/engine/useExpansionEngine.ts`.
  - Added fetched-depth pruning on collapse to avoid stale expansion depth entries.
- Reworked same-axis expansion hydration to avoid refetch storms:
  - Same-axis expands now iterate a bounded hydration loop and group fetch keys by their metric-less path to reuse a single branch fetch across metric tier keys.
  - Added representative-key selection and per-branch fetched-depth tracking to avoid re-fetching already satisfied metric siblings.
- Tightened cross-axis detection:
  - Added in-flight counters in `useExpansionEngine.ts` so a click on the opposite axis can trigger atomic hydration when another axis expand is still in-flight.
- Propagated `metricPath` to branch fetch context (`src/fetchPivotBranch.ts`) so query intent respects metric-tier paths.
- Removed `ownState`-based expansion persistence; `setControlValue('pivotExpansionState', ...)` is the only write path.
- Stabilized expansion tests by re-querying headers/bodies after re-render and removing temporary debug logs.
- Cleaned up expansion-engine iteration helpers to avoid loop-captured callbacks and kept formatting aligned with Prettier.
- Removed legacy hydration modules (`src/pivot/usePivotHydration.ts`, `src/pivot/hydrationPlanner.ts`).
- Disabled global loader for cross-axis expands and added a regression test to keep the table visible on same-axis expands with empty columns.
- Added opt-in expansion persistence (`persistExpansionState`) so manual expands do not trigger Explore re-queries by default.
- Added a regression test asserting expansion succeeds without calling `setDataMask` when persistence is disabled.
- Added an RTL regression test ensuring expansions persist when metrics change.
- Added Explore persistence via `pivotExpansionState` hidden control (no requery):
  - `setControlValue` writeback when persistence is enabled.
  - Restore from form data on rerender.
  - Tests for Explore persistence and groupby append/insertion behavior.

### Phase 3 (remaining work)
- None. Phase 3 complete; proceed to Phase 4 (query intent + batching).

Status: Phase 3 complete.

### Phase 3 (latest updates)
- Fixed Explore persistence wiring by passing `setControlValue` into `useExpansionEngine`.
- Adjusted Prettier formatting in `useExpansionEngine.ts` and expansion-state tests.
- Re-ran `npm test plugins/plugin-chart-pivot-table-v3` and `npx eslint plugins/plugin-chart-pivot-table-v3` (warnings only).
- Defaulted expansion persistence to on, persisting `pivotExpansionState` via `setControlValue` in Explore and dashboards.
- Engine now uses form-data `pivotExpansionState` for all contexts (no `ownState` fallback).
- Added tests for default Explore persistence and dashboard persistence with `dashboardId`.
- Ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/expansion-state.test.tsx` (warnings about duplicate mocks/Browserslist).
- Pivot expansion persistence now stores `rowKeys`/`colKeys` plus path arrays (no concatenated key strings); dropped string-key rehydration.
- Expansion pruning now uses persisted `rowKeys`/`colKeys` for stable-prefix matching when restoring.
- Added Explore test for column expansion persistence via `setControlValue`.
- On layout changes or invalid persisted state, we now reset persisted expansions to the pruned manual set and update `rowKeys`/`colKeys` immediately.
- Re-ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/expansion-state.test.tsx` (warnings only).
- `getVisibleExpansionKeys` now uses the engine’s current tree instead of a stale chart ref, so column expansions persist after layout changes.
- `getVisibleExpansionKeys` now keeps visible column keys even when nodes are virtual (not in the tree map), preventing column expansion persistence from dropping; added `expansionStateModel` unit test and ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/engine/expansionStateModel.test.ts`.
- Cross-axis expansion persistence now writes both row and column keys after atomic hydration; added a regression test covering row+col expansions and ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/expansion-state.test.tsx`.
- Collapsed expansion deltas are now only persisted when auto-expand is active (baseline > 0), preventing empty collapse payloads when auto-expand is off; added a regression test and ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/expansion-state.test.tsx`.
- Removed dashboard `ownState` expansion persistence/caching (non-enumerable hack removed); expansion state now round-trips via `pivotExpansionState` only.
- Unified expansion persistence on `pivotExpansionState` (no dashboard fallback), and updated expansion-state RTL coverage to read from `setControlValue`.
- Ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/expansion-state.test.tsx` (passes; duplicate mock + Browserslist warnings).
- Ran `npx eslint plugins/plugin-chart-pivot-table-v3` (fails due to existing warnings/Prettier errors in unrelated files; see lint output).
- Added a dashboard refresh regression test to ensure `pivotExpansionState` restores expanded rows after filter apply; ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/expansion-state.test.tsx` (passes; duplicate mock + Browserslist warnings).

### Phase 4 (in progress)
- Added `pivot/engine/query/queryIntent.ts` + `queryShape.ts` with unit tests for metric/column minimization and deterministic unions.
- Refactored `src/fetchPivotBranch.ts` and `src/transformProps.ts` to use intent-driven query shape instead of unconditional formatting metric merges.
- Ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/query/queryShape.test.ts`, `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/fetchPivotBranch.test.ts`, and `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/transformProps.test.ts` (passes; duplicate mock + Browserslist warnings).
- Added batching primitives (`fetchPlanOptimizer`, `batchSignature`, `fetchPivotBranchesBatch`) and reused branch query-pair/tree builders for batch fetches.
- Wired batching into same-axis expansion and atomic hydration (cache-aware, IN batching for sibling targets, per-target pruning on merge).
- Added unit coverage for batching optimizer and batched query filters; ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/query/fetchPlanOptimizer.test.ts`, `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/query/fetchPivotBranchesBatch.test.ts`, and `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/fetchPivotBranch.test.ts` (passes; duplicate mock + Browserslist warnings).
- Added null-label styling for true NULL dimension values (muted label color) and a render-unit test; ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/render/PivotTableView.test.tsx` (passes; duplicate mock + Browserslist warnings).
- Added RTL batching coverage for persisted restore (query count + out-of-order batch merge); ran `npm test -- plugins/plugin-chart-pivot-table-v3/test/plugin/PivotTableChart/prefetch.batching.test.tsx` (passes; duplicate mock + Browserslist warnings).
- Fixed branch tree construction to use full groupby lengths (via `rowGroupbyForQueryFull`/`colGroupbyForQueryFull`) so nodes retain expand toggles when query intent truncates groupby depth.
- Updated prefetch/persistence RTL coverage to drive persisted restores through `pivotExpansionState` in form data and tolerate single-root/batched fetches; added batch->single test adapters for prefetch/expansion-state/ancestor-subtotals suites.
- Ran `npm test -- plugins/plugin-chart-pivot-table-v3` (passes; duplicate mock + Browserslist warnings; Jest open-handles warning).
