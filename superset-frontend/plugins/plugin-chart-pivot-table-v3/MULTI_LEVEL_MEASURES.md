# Pivot Table v3 — Multi-level Measures (FC-1) Design

This document proposes an implementation design for **FC-1 — Multi-level measures** as defined in `superset-frontend/plugins/plugin-chart-pivot-table-v3/REFACTOR_PLAN.md`.

It is intentionally scoped to the Pivot Table v3 plugin and assumes Phases 0–N of the modularization refactor are already complete (i.e. we have `pivot/layout`, `pivot/query`, a testable expansion engine, and a pure render-model pipeline).

---

## 0) Implemented supporting work — Client-side conditional formatting (“Custom Excel”)

Multi-level measures (FC-1) compute derived leaves **client-side** (e.g. `IX 1YA`, `∆ 1YA`, `∆% 1YA`). That breaks the legacy pattern of using “formatting metrics” as **SQL** expressions (e.g. a `CASE WHEN ... THEN "#fff" END` metric), because there is no longer a 1:1 “SQL metric” for every displayed leaf output.

To unblock formatting for derived outputs (and multi-level measures in general), we added a **plugin-only, user-side** formula option for metric formatting fields: **Custom Excel** formulas evaluated on query results using `fast-formula-parser`.

### 0.1 UX: Add Metric → `Custom SQL` | `Custom Excel`

In the metric “Conditional formatting” popover, each formatting selector (`backgroundColor`, `textColor`, `d3Format`) supports:
- selecting an existing metric (dataset metric / query metric key)
- creating an ad-hoc formatting metric (`Custom SQL`) (existing behavior)
- creating a user-side formatting formula (`Custom Excel`) (new)

The “Add metric” button now opens a small popover with tabs:
- `Custom SQL`: unchanged ad-hoc metric creation (disabled when the dataset disallows ad-hoc metrics)
- `Custom Excel`: a textarea for a spreadsheet-like formula (always available; user-side only)

Saved formulas show up in the selector as `Custom Excel: <formula>`.

### 0.2 Formula syntax (for formatting fields)

Custom Excel formulas are evaluated **per cell** and can reference:
- `value` (no braces): the current measure value for the cell being formatted
- `[metric]`: any other metric key; the referenced metric is pulled into the SQL query, then provided to the formula evaluator from `PivotResultCell.values`

Notes:
- A leading `=` is optional (it is stripped).
- The formula must evaluate to a **string** to be used as:
  - `backgroundColor` / `textColor`: a CSS color string (e.g. `#ff0000`, `rgb(255,0,0)`, `red`)
  - `d3Format`: a d3-format string (e.g. `',.2f'`)
- No custom helpers (e.g. `RGB()`/`RGBA()`) were added; return CSS strings directly.

Examples:
- Background: `IF(value > 0, "#1FA971", "#D64550")`
- Text: `IF([sum__profit] < 0, "white", "black")`
- Format: `IF([sum__sales] > 1000, ",.0f", ",.2f")`

### 0.3 Implementation details (plugin-only)

- We store Excel formulas as `PivotExcelFormula` objects:
  - `{ kind: "excel", formula: string }`
- `fast-formula-parser` does not support `[metric]`-style identifiers, so formulas are preprocessed:
  - `value` → `A1`
  - each `[metric]` → `B1`, `C1`, … (stable per formula)
  - values are fed via the parser `onCell`/`onRange` callbacks using a 1-row “spreadsheet”
- Formulas are compiled once per `(metricKey, field)` and cached.
- The UI validates formulas by compiling + evaluating them with sample values; invalid formulas show an error message and are not saved.

### 0.4 Query planning integration (so `[metric]` works)

When a Custom Excel formula references `[metric]`, that referenced metric must exist in the query results. The plugin now:
- extracts `[metric]` references from formatting formulas
- adds them to the “extra metrics” list via `collectMetricFormattingMetricsForQuery()`
- relies on the existing `buildQueryShape()` / `mergeMetrics()` pipeline to include those metrics in queries when metric formatting is needed

### 0.5 Rendering integration

- `usePivotFormatting()` compiles formulas and exposes `evaluateExcelMetricFormatting(metricKey, field, cell.values, cell.values[metricKey])`.
- `PivotTableView` prefers Excel results for:
  - background / text color (still gated by `metricFormattingScope`)
  - d3 format override (falls back to the legacy SQL-metric-based format key when no Excel formula is defined or it returns a non-string)
- Databar label-width measurement also honors Excel `d3Format` overrides to prevent clipping.

### 0.6 Code touchpoints

All changes are scoped to `superset-frontend/plugins/plugin-chart-pivot-table-v3`:
- `package.json`: add `fast-formula-parser`
- `types/external.d.ts`: local TS declaration for `fast-formula-parser`
- `src/types.ts`: add `PivotExcelFormula` + widen `metricFormatting` value type
- `src/pivot/formatting/excelFormulaReferences.ts`: parse/transform `value` + `[metric]` refs
- `src/pivot/formatting/excelFormula.ts`: compile/evaluate/validate formulas (cached)
- `src/utils.ts`: normalize formatting values + include referenced metrics in queries
- `src/controls/PivotDndMetricSelect/PivotMetricDefinitionValue.tsx`: “Custom Excel” tab + selector support
- `src/pivot/chart/usePivotFormatting.tsx`: compile formulas + provide evaluator
- `src/pivot/render/PivotTableView.tsx` + `src/PivotTableChart.tsx`: apply evaluator results during rendering
- `test/plugin/render/PivotTableView.test.tsx`: update props for new evaluator

---

## 1) Goals and constraints (from `REFACTOR_PLAN.md`)

### Primary goal
Treat “metric calculations” as a **structural tier** in the pivot hierarchy (not expand/collapse), supporting a **two-level measure stack**:
- `MeasureGroup` (base metric, e.g. `GrossRevenue`)
- `MeasureLeaf` (calculation leaf, e.g. `Value`, `IX 1YA`, `∆ 1YA`, `∆% 1YA`, `1YA`)

Note on naming:
- The refactor plan examples use `IXYA`, `DYA`, `%YA` as shorthand for “vs 1 year ago”.
- This design generalizes them to explicit, parameterized leaves (e.g. `IX 1YA`, `∆ 2MA`, `∆% 1WA`, ...).

### Hard constraints (must hold)
1) **Max depth 2** for measure hierarchy (`MeasureGroup` only, or `MeasureGroup → MeasureLeaf`).
2) **Atomic measure stack**: dimensions may be above/below the stack, but **never** between `MeasureGroup` and `MeasureLeaf`.
3) Measure leaves are **selectable at runtime**, but query planning requests **only the minimal required source data**.
4) Prefer **Superset-style time-compare source data** (`time_offsets` + `${metricLabel}__${offset}`) and compute derived leaves client-side.
5) Measure leaf tier is **not** an expansion; persistence must **not store keys** that exist only because the leaf tier is enabled.
6) UI must **collapse to one visible tier** when only one leaf is selected (e.g. `GrossRevenue IX 1YA`).
7) Query naming/spec IDs remain stable and debuggable (must not become ambiguous because of the hierarchy).
8) Empty leaf selection is not allowed; coerce to a default set that includes the base/current `Value` leaf.

### Acceptance scenarios to satisfy
- **FC-AS-1**: leaf tier adjacency (no dimensions inside the stack).
- **FC-AS-2**: collapse to 1 visible tier when only 1 leaf is selected.

---

## 2) Proposed UX model

### What the user sees
For each configured metric (measure), the pivot renders either:

1) **Single-tier (collapsed) measures** (default):
   - If selected leaves for a measure are `[Value]`, render exactly like today:
     - headers: `GrossRevenue`
     - cell values: `GrossRevenue`
   - If selected leaves are `[IX 1YA]` (no `Value`):
     - headers: `GrossRevenue IX 1YA`
     - cell values: derived index output vs `1YA`

2) **Two-tier measures** (when any measure has multiple leaves, or we globally enable the leaf tier):
   - headers:
     - `GrossRevenue`
       - `Value`
       - `IX 1YA`
       - `∆% 1YA`
   - cell values: each leaf output is a separate “metric-like” value column.

### Expansion behavior (dimension expansion stays the same)
Enabling measure leaves must not add a new expand/collapse concept. Expand/collapse continues to mean “show deeper *dimensions*”.

Key design choice to satisfy FC-1 persistence constraints:
- Expansion intent is treated as **leaf-agnostic** (details in §6). Expanding into deeper dimensions applies consistently across all leaf outputs under a measure group.

### Stack placement: Columns vs Rows
The measure stack is inserted at the resolved “Σ Values” slot, just like today’s single-level metrics tier.

When the stack is on **columns**:
- `MeasureGroup` and optional `MeasureLeaf` render as additional **column header tiers**.
- Each selected leaf becomes a separate “metric-like” column under its measure group.

When the stack is on **rows**:
- `MeasureGroup` and optional `MeasureLeaf` render as additional **row header tiers** (nested rows).
- For a given dimension prefix, the table shows:
  - one row per measure group (flattened single-tier case), or
  - measure group rows with leaf rows immediately under them (two-tier case).
- Measure tiers remain **structural**: they should not require the user to “expand” a dimension node just to reach the measures tier (same spirit as the current multi-metric-on-rows behavior).
- If dimensions exist **below** the stack (e.g. `OrderStatus → [Measures] → Region`), those dimensions live under the (group or leaf) measure rows. Expanding deeper dimensions is still a **dimension-only** action; the measure leaf tier does not create a new “expand concept”.
  - Because expansion intent is leaf-agnostic, expanding “under” one leaf effectively expands the corresponding dimension prefix for *all* leaves under that prefix (we should avoid a per-leaf expansion model; FC-1 forbids treating leaves as expand/collapse state).

**Example (stack on rows)**

Inputs:
- `groupbyRows = ["OrderStatus", "__MEASURES__", "Region"]`
- `groupbyColumns = []`
- `metrics = ["GrossRevenue"]`
- selected leaves for `GrossRevenue` are `[Value, IX 1YA]`

Resolved row-axis tiering (FC-AS-1):
- `OrderStatus → GrossRevenue → (Value, IX 1YA) → Region`

UI behavior:
- `GrossRevenue` is a **MeasureGroup header row**:
  - it renders **no value cells** (values live on leaf rows), and
  - it MUST NOT show an expand/collapse toggle (`+`) when the leaf tier is visible.
    - The leaf tier is structural/always-present, so “expanding” the group would be meaningless.
- `Value` / `IX 1YA` are **MeasureLeaf rows**:
  - they render the numeric values for their leaf output, and
  - if there are dimensions below the stack (`Region` here), the `+` toggle (dimension expansion) appears on the leaf rows, not on the group row.

Illustrative row header tree (indentation shows tiers; concrete dimension values are examples):
```
OrderStatus=Closed
  GrossRevenue
    Value
      Region=EMEA
      Region=APAC
    IX 1YA
      Region=EMEA
      Region=APAC
```

If the selected leaves are `[IX 1YA]` (single leaf; FC-AS-2), the visible hierarchy collapses to one measure tier:
- `OrderStatus → GrossRevenue IX 1YA → Region`

---

## 3) Data model and tokens

### 3.1 Leaf identity (stable IDs vs labels)
We should treat each user-created “measure” (e.g. `IX 1YA`) as a **MeasureLeaf** under a base metric (**MeasureGroup**).

The UI described below makes leaves **parameterized** (operation + offset) and also supports custom leaves, so leaf identity cannot be a fixed enum forever.

Proposed types (illustrative):

```ts
export type MeasureLeafOffsetUnit = 'year' | 'month' | 'week' | 'day';

export type MeasureLeafOffsetDirection = 'past' | 'future';

export type MeasureLeafOffset = {
  n: number; // positive integer
  unit: MeasureLeafOffsetUnit;
  direction: MeasureLeafOffsetDirection;
};

// Built-in leaf operators.
// Note: `value` (current/base value) is always the “baseline” leaf; the selector UI
// adds additional leaves (e.g. `IX 1YA`, `∆ 1MA`, ...).
export type MeasureLeafOperator =
  | 'value'
  | 'ix'
  | 'delta'
  | 'delta_pct'
  | 'offset_value';

// Stable leaf identity within a metric group.
// For built-in leaves it should be derived from `{operator, offset}`.
// For custom leaves it can be derived from the custom name.
export type MeasureLeafId = string;

export type MeasureLeafSpec =
  | {
      kind: 'builtIn';
      id: MeasureLeafId;
      operator: MeasureLeafOperator;
      offset: MeasureLeafOffset;
      // fixed display label for built-in leaves
      label: string; // "IX 1YA" | "∆ 1MA" | "∆% 1WA" | "1YA" | ...
    }
  | {
      kind: 'custom';
      id: MeasureLeafId;
      // User-defined leaf name; always manually set, even if an offset is used.
      label: string;
      // Free-form formula/expression (same “formula” concept as conditional formatting).
      // Default: no offset (formula evaluates on the base/current values).
      formula: string;
      offset?: MeasureLeafOffset;
    };
```

Naming conventions requested for built-in leaves:
- Offset shorthand should include direction:
  - past: `formatOffset({ n, unit, direction: "past" }) => "${n}${unitAbbrev}A"` (e.g. `1YA`, `1MA`, `1WA`, `1DA`)
  - future: `formatOffset({ n, unit, direction: "future" }) => "${n}${unitAbbrev}L"` (e.g. `1YL`, `1ML`, `1WL`, `1DL`)
- The final letter is the direction marker:
  - `A` = ago (past)
  - `L` = later (future)

If you prefer a different shorthand (e.g. `F` for future instead of `L`), we can swap it — the important part is that the shorthand is:
- deterministic (used for fixed-name built-in leaves), and
- round-trippable back into `{n, unit, direction}`.

- Built-in leaf display label:
  - `operator = "value"`: `"Value"`
  - `operator = "offset_value"`: `"1YA"` / `"1MA"` / `"1YL"` / `"1WL"` / ...
  - `operator = "ix"`: `"IX 1YA"` / `"IX 1YL"` / ...
  - `operator = "delta"`: `"∆ 1YA"` / `"∆ 1YL"` / ...
  - `operator = "delta_pct"`: `"∆% 1YA"` / `"∆% 1YL"` / ...

Overwrite rule:
- Under a given metric group, **leaf labels are unique**.
- Saving a leaf whose label already exists under that metric group overwrites/replaces that leaf.

### 3.2 Selection storage
FC-1 states the UI captures selection and stores it in `ownState` / a runtime layout spec (not query logic).

Two viable selection models:

1) **Per-measure selection** (max flexibility; matches FC-1 wording “leaf plan per measure”):
```ts
type MeasureLeavesByMetricKey = Record<string, MeasureLeafSpec[]>;
```

2) **Global selection applied to all measures** (simpler UX and alignment):
```ts
type GlobalMeasureLeaves = MeasureLeafSpec[];
```

Given the requested UX (“create a measure under the metric it is assigned to”), the primary model should be **per-measure**:
- each base metric owns a list of leaves (built-in and/or custom)
- the UI renders those leaves directly below the metric

Empty-selection guard (FC-1):
- A metric group MUST NOT end up with an empty effective leaf list.
- If the list becomes empty (e.g. user deletes leaves), coerce to a default state (at least the base `Value` leaf).

### 3.3 `LayoutContext` extensions
`LayoutContext.measureHierarchy` currently is:
- `{ kind: 'flatMetrics'; metricKeys: string[] }`

Proposed evolution:

```ts
export type MeasureHierarchy =
  | { kind: 'flatMetrics'; metricKeys: string[] }
  | {
      kind: 'measureStackV1';
      groups: Array<{
        metricKey: string; // MeasureGroup identity
        leaves: MeasureLeafSpec[]; // coerced non-empty, ordered
      }>;
      // Whether the leaf tier is visible in the render model.
      // (Internal tokens may still include leaves even when hidden.)
      leafTierVisibility: 'hidden' | 'visible';
    };
```

`pivot/layout` responsibilities:
- Validate constraints (max depth, atomic stack).
- Coerce empty selections to a default leaf set (at least the base `Value` leaf).
- Decide `leafTierVisibility`:
  - `hidden` when every group has exactly one effective leaf
  - `visible` when any group has > 1 effective leaf (or global selection length > 1)

### 3.4 Path tokens
Today, metric tier nodes are encoded using `__metric__${metricKey}`.

For measure leaves, introduce a second token prefix:
- `MEASURE_LEAF_TOKEN_PREFIX = '__mleaf__'`
- `encodeMeasureLeaf(leafId) => '__mleaf__' + leafId`
- `decodeMeasureLeaf(val) => leafId | undefined`

Paths would look like:
- `[..., __metric__GrossRevenue, __mleaf__value, ...]`
- `[..., __metric__GrossRevenue, __mleaf__ix:1:year:past, ...]`
- `[..., __metric__GrossRevenue, __mleaf__ix:1:year:future, ...]`

This keeps:
- measure group identity compatible with existing metric-token logic, and
- leaf identity explicit and easy to strip for query filters / persistence.

### 3.5 Measure selector UI (per-metric leaf builder)

This section captures the requested UI/behavior for adding leaves under a metric.

#### 3.5.1 Button placement
In the metric list UI (the same row that currently has the per-metric formatting affordance), add:
- a small button **to the left of the formatting button**, labeled `IX`.

Rules:
- The `IX` button is shown only for **base metrics** (MeasureGroup rows).
- Derived leaves (MeasureLeaf rows) MUST NOT show the `IX` button (enforces the max-2-level hierarchy rule).

#### 3.5.2 Measure selector window (modal)
Clicking `IX` opens a “Measure selector” window with:
- Operation selector: `IX`, `∆`, `∆%`, `Value` (offset value; displayed as `1YA`, `1MA`, `1YL`, ...)
- Period selector:
  - `N` (integer)
  - period type: `year | month | week | day`
- Period direction selector:
  - `ago` (past)
  - `later` (future)
- Preview of the constructed label:
  - `∆ 1YA`, `IX 1YA`, `IX 1MA`, `IX 1YL`, `∆% 1WA`, `1YA`, `1YL`, ...

Save behavior:
- The constructed leaf is added under the selected metric group.
- If a leaf with the same label already exists under that metric group, it is overwritten.

Custom mode:
- A toggle enables “custom name + custom measure”.
- The user sets a custom name (always manually typed; can equal a built-in default and overwrite it).
- The user sets a custom measure formula (free-form expression; ideally reuse the same Excel-formula syntax/engine as conditional formatting — see §0).
- The user may optionally set an offset for that formula; default is **no offset**.

#### 3.5.3 How leaves show up in the metric UI
Under each base metric, render its leaves as “child rows” that:
- display the leaf label (e.g. `IX 1YA`)
- support conditional formatting exactly like normal measures (including client-side “Custom Excel” formulas — see §0)
- can be removed (except the base/current `Value` leaf in the current UI)

Baseline leaf:
- Each metric group starts with the base/current `Value` leaf.
- The selector UI adds additional leaves; it does not create nested tiers.
- In the current UI, the base/current `Value` leaf is always present (no “hide Value” option yet).
  - Future feature: allow leaf visibility selection (e.g. show only `IX 1YA`, or `IX 1YA + ∆ 1YA`).

Constraints:
- Derived leaf rows MUST NOT offer the `IX` button (no leaf-of-leaf).
- Deleting all leaves must be prevented by coercion (FC-1 empty-selection guard).

#### 3.5.4 How leaves behave in the pivot (rows stack case)
When the leaf tier is visible (more than one leaf):
- MeasureGroup row (`GrossRevenue`) renders:
  - no value cells (values live on leaves)
  - no `+` toggle (dimension expansion belongs to leaf rows)
- MeasureLeaf rows (`Value`, `IX 1YA`, …) render:
  - numeric values for that leaf output
  - the `+` toggle for expanding into dimensions below the stack

---

## 4) Query planning (“leaf plan” → minimal source metrics + offsets)

### 4.1 Inputs
`pivot/query` should translate `LayoutContext.measureHierarchy` into query requirements.

Inputs needed:
- Base metrics (`formData.metrics`)
- Selected leaves (from layout/ownState)
- Leaf offset selections (converted into `time_offsets`)

### 4.2 Outputs
Query planning should emit:
1) **Source metrics** to request from the backend (may be a subset of configured measures).
2) **Required time offsets** (if any derived leaves are enabled).
3) A mapping that allows tree assembly to compute leaf outputs deterministically.

Proposed structure:

```ts
type MeasureLeafPlan = {
  metricKey: string;
  leaves: MeasureLeafSpec[];
  // Convenience for the query layer: union of offset specs referenced by `leaves`.
  requiredOffsets: MeasureLeafOffset[];
};

type MeasuresQueryRequirements = {
  plans: MeasureLeafPlan[];
  metricsForQuery: QueryFormMetric[];
  // Union of all offsets required by all leaves, formatted as Superset expects
  // (e.g. "1 year ago", "2 month ago").
  requiredTimeOffsets: string[];
};
```

### 4.3 Time offsets (selector-driven; potentially multiple)
FC-1 prefers the existing Superset convention `${metricLabel}__${offset}` and explicitly recommends:
- request source metrics + required time offsets in a **single query object**, and
- compute multiple derived outputs client-side.

With the proposed per-metric selector UI, users can create multiple leaves with different offsets (e.g. `IX 1YA` and `∆ 1MA`), so the query layer MUST:
1) compute the union of all required offsets across all leaves and metrics
2) send them via `time_offsets` (chart data query object)
3) map returned offset metric keys back to leaf computations using the standard naming convention

Offset formatting:
- `formatTimeOffset({ n: 1, unit: "year", direction: "past" }) => "1 year ago"`
- `formatTimeOffset({ n: 1, unit: "year", direction: "future" }) => "1 year later"`
- Units should be the **singular** form selected in the UI (`year|month|week|day`) regardless of `n` (no pluralization logic):
  - past: `"2 year ago"`, `"3 month ago"`, `"7 day ago"`
  - future: `"2 year later"`, `"3 month later"`, `"7 day later"`
  - Superset accepts both singular/plural (e.g. `"2 year ago"` and `"2 years ago"`); we choose singular for determinism and simplicity.

### 4.4 Query-object integration
We already have:
- `buildQueryShape()` to decide metrics needed for formatting/sorting/etc.
- `toChartDataQueries()` to build query objects from `QuerySpec`s + a base query object.

Integration approach:
1) `pivot/query/queryShape.ts` (or a new `pivot/query/measures.ts`) computes `MeasuresQueryRequirements`.
2) `buildQueryShape()` starts from `metricsForQuery` instead of `formData.metrics`, then unions in any extra metrics needed for:
   - metric formatting scope
   - databars
   - dimension formatting/sorting helpers
3) Ensure query objects include `time_offsets` when required (either by:
   - mutating `baseQueryObject.time_offsets` in the chart-data client input, or
   - adding a `time_offsets` field into `QuerySpec` and merging it in `toChartDataQueries()`).

---

## 5) Tree assembly and render-model mapping

### 5.1 Derived outputs as a pure function
Per FC-1 boundaries:
- `pivot/core` (or tree assembly) computes derived leaf outputs as a pure post-fetch step.

Proposed pure helper:

```ts
type ComputeMeasureLeavesParams = {
  values: Record<string, DataRecordValue>; // raw cell values from API (base + offsets)
  metricKey: string;
  leaves: MeasureLeafSpec[];
  // Helper for resolving the concrete offset string (e.g. "1 year ago") that
  // corresponds to a leaf’s `{n, unit}` selection.
  resolveOffset: (offset: MeasureLeafOffset) => string;
};
```

Rules (illustrative):
- `value`: base metric value (`values[metricKey]`) (baseline leaf)
- `offset_value`: offset metric value (`values[`${metricKey}__${offset}`]`)
- `delta`: `base - offsetValue`
- `delta_pct`: `(base - offsetValue) / offsetValue`
- `ix`: `(base / offsetValue) * 100`

Null/zero handling should be explicit and consistent (likely:
- if either input is nullish → output null
- for division by 0 → output null)

### 5.2 Output keys (cell-values map)
We need stable keys for derived outputs inside `PivotResultCell.values`.

Constraints:
- Must not collide with `${metricKey}__${offset}` columns.
- Should preserve existing behavior for Value-only (`metricKey` still works).

Proposed convention:
- `Value` leaf output key: `metricKey` (unchanged)
- Derived leaf output keys: `__calc__${leafId}__${metricKey}`

Example:
- `GrossRevenue` → `GrossRevenue`
- `GrossRevenue / IX 1YA` → `__calc__ix:1:year:past__GrossRevenue`
- `GrossRevenue / IX 1YL` → `__calc__ix:1:year:future__GrossRevenue`

This keeps legacy formatting logic working for Value-only while making derived outputs unambiguous.

### 5.3 Applying the hierarchy tiers (replacing `applyMetricAxis`)
Today:
- `applyMetricAxis(tree, metrics, metricsLayout, ...)` injects a single metric tier.

For FC-1:
- Introduce `applyMeasureHierarchyAxis(tree, measureHierarchy, metricsLayout, ...)`:
  - inject `MeasureGroup` tokens (existing metric tokens)
  - inject `MeasureLeaf` tokens immediately under group when `leafTierVisibility === 'visible'`
  - keep the *stack* atomic w.r.t. dimensions (FC-AS-1)

Flattening rule (FC-AS-2):
- When `leafTierVisibility === 'hidden'`, the render model hides the leaf tier and maps:
  - label `GrossRevenue` + leaf `IX 1YA` → visible label `GrossRevenue IX 1YA`

Implementation guidance from FC-1 suggests keeping stable `{MeasureGroup, MeasureLeaf}` identity even when hidden:
- internal paths may still include `__mleaf__ix:1:year:past`
- render model collapses leaf tier visually
- expansion persistence uses a leaf-agnostic normalized key (so it’s not brittle)

### 5.4 Cell metric selection (`deriveMetricKey` evolution)
`pivot/cellUtils.ts:deriveMetricKey()` currently inspects only the last path element on the metric axis.

With multi-level measures, we need:
1) Identify the `MeasureGroup` (metric key) from the metric token.
2) Identify the `MeasureLeaf`:
   - if leaf token present: decode it
   - if leaf tier hidden: resolve the single selected leaf for that measure
3) Return the correct output value key (from §5.2).

This can be implemented as a new helper:
- `deriveMeasureOutputKey({ rowNode, colNode, layout, cells })`

### 5.5 Default formatting (d3 formats) for built-in leaves
Built-in leaves should start with sensible defaults, aligned with Superset’s Table “time comparison” formatting behavior:
- “main / offset / delta” values inherit the parent metric’s numeric/currency formatting
- percentage-change uses a percent format by default

Proposed defaults:
- `value` (base/current): inherits the parent metric’s formatting
- `offset_value` (e.g. `1YA`, `1YL`): inherits the parent metric’s formatting
- `delta` (∆): inherits the parent metric’s formatting
- `delta_pct` (∆%):
  - default `d3Format`: Superset’s percent default (Table uses `PERCENT_3_POINT`)
  - do **not** inherit currency
- `ix` (IX):
  - value is computed as `(current / offset) * 100`, so it should be formatted as a plain number (e.g. `100.0`), not as a percent formatter
  - do **not** inherit currency
  - default `d3Format`: `',.2f'` (same as `NumberFormats.FLOAT_2_POINT`)

Implementation approach (conceptual):
- derived leaves produce stable output keys (`__calc__...__${metricKey}`)
- the formatting layer maintains a local `columnFormats`/`currencyFormats` override map:
  - for inherited leaves, point to the parent metric’s entries
  - for ∆% / IX, set leaf-specific defaults

---

## 6) Persistence, signatures, and expansion intent (leaf-agnostic)

FC-1 requires:
- leaf tier is not an expansion
- persistence must not store keys that exist only due to the leaf tier

### 6.1 Normalized “intent path”
Introduce a single normalization function in `pivot/layout` (or `pivot/core/path` helpers) that removes:
- `__metric__*` (measure group token)
- `__mleaf__*` (measure leaf token)
- `SUBTOTAL_TOKEN`

Call this the **intent path** (dimension-only path).

### 6.2 Store and engine behavior
Store:
- Persist expansions keyed by **intent path** only.

Engine/render:
- Determine whether a node is “expanded” by comparing its intent-path key against the persisted set.
- This makes expansions apply uniformly across measure leaves and makes leaf-tier toggles non-destructive to intent.

### 6.3 Signatures
`layoutSignature` must include:
- selected leaves (including their `{operator, offset}` definitions)

`filterSignature` remains unchanged.

This ensures:
- leaf selection changes trigger standard re-plan/re-hydrate logic (no special-casing).

---

## 7) Testing strategy (unit-first)

Add unit tests around pure modules, then a small number of chart-level tests:

1) `pivot/layout`:
   - coercion of empty selection → base `Value` leaf
   - `leafTierVisibility` transitions
   - constraint enforcement (no dimensions inside stack)

2) `pivot/query`:
   - “leaf plan” → `metricsForQuery` and required offsets
   - (future UI) leaf visibility toggles drop unused source requirements

3) `pivot/core`:
   - derived output math (null/zero edge cases)
   - output key stability

4) Render model / view:
   - FC-AS-1 adjacency scenario
   - FC-AS-2 collapse label rule (`GrossRevenue IX 1YA`)

---

## 8) Open questions / decisions needed before implementation

1) **Future shorthand**: confirm `A`/`L` is acceptable for `ago`/`later` (vs alternatives like `A`/`F`).
2) **Future offset math semantics**: for `∆`, `∆%`, `IX` with a `later` offset, should we compute:
   - `current op future` (consistent: `∆ = current - future`, `IX = (current / future) * 100`), or
   - `future op current` (so `∆ 1YL` reads as “change to future”)?
3) **Custom formula inputs**: what variables/fields are available to the formula (base value only, or base + all selected offsets, or the entire cell values map)?
4) **Custom formula + offset**: when an offset is set, does it:
   - shift the entire formula evaluation context (so references resolve “at offset”), or
   - just make the offset value(s) available as additional symbols?
5) **Multiple offsets in one custom formula**: should a single custom leaf be able to reference multiple offsets (e.g. `metric__1 year ago` and `metric__1 year later`)?
6) **Leaf ordering**: should leaves be reorderable under a metric, and what should the default order be?
7) **Sorting**: when sorting by “metric”, can the user choose which leaf drives the sort (base vs derived)?
8) **Default d3 formats**: confirm `∆%` defaults to `NumberFormats.PERCENT_3_POINT` and `IX` defaults to `NumberFormats.FLOAT_2_POINT` (vs `INTEGER`), and confirm that `IX`/`∆%` must not inherit currency.
9) **Label collisions**: confirm overwrite is “per metric group”; also confirm whether custom leaf names may equal the base metric name.

---

## 9) Proposed implementation steps (high level)

1) Add leaf token helpers in `pivot/core/tokens.ts`.
2) Extend `PivotLayoutSpec`/`LayoutContext` to carry leaf selection + resolved `measureHierarchy`.
3) Add `pivot/query` leaf-planning module and integrate with `buildQueryShape()` / query-object building.
4) Add `pivot/core` derived-output assembly (pure).
5) Replace/extend `applyMetricAxis` with `applyMeasureHierarchyAxis`.
6) Update `deriveMetricKey` (or replace with `deriveMeasureOutputKey`) and any “non-metric path parts” helpers to ignore leaf tokens.
7) Add unit tests + minimal chart-level acceptance tests for FC-AS-1 / FC-AS-2.
