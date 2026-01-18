# Pivot Table v3 — Cross-Axis Expand Transaction Rules (Spec)

This document defines strict, testable rules for handling **cross-axis** expands (row+column) without showing blank intersection values and without “collapse → expand” flicker.

Scope: `superset-frontend/plugins/plugin-chart-pivot-table-v3/` only.

## Goals (non-negotiable)

- The UI **MUST NOT** show blank intersection cells caused by missing data while an expansion is considered “applied”.
- The UI **MUST NOT** visually collapse already-expanded structure and then re-expand it as new responses arrive.
- The fetch/query phase **MUST** be as parallel as possible; only the **reveal** (what the user sees) waits for completeness.
- The system must support both:
  - ordered, user-driven “expand one layer at a time” operations, and
  - known-target expansion (auto-expand).

## Definitions

- **Axis**: `row` or `col`.
- **Expand target**: the key/path the user toggled.
- **Opposite-axis required depth**: for a row-branch fetch, this is the currently visible column depth (and vice versa). This depth determines whether row×col intersection cells can be present.
- **Satisfied (branch)**: an expanded key is satisfied when its fetched data is sufficient for the current opposite-axis required depth.
- **Delta**: a `PivotTreeData` fragment representing only the branch data returned from `fetchPivotBranch` (not a full merged snapshot).
- **Transaction**: a short-lived state machine that buffers deltas from multiple requests and applies them atomically.

## Fetch / Apply / Reveal (separation of concerns)

To keep the table “snappy” while still avoiding blanks/flicker, we distinguish:

- **Fetch**: dispatch queries as early and as parallel as possible.
- **Apply (staging)**: merge deltas into an internal/staging tree as responses arrive (order-independent).
- **Reveal (commit)**: update the visible tree/expansion state only when it is safe (no blanks, no collapse flicker).

This document focuses on *Reveal* rules; it does not require sequential fetching unless explicitly stated.

## Expansion drivers (must both be supported)

### A) User-driven “buffered full layer expand” (ordered input)

The user expands **one layer at a time** (ordered operations). For this mode:

- The implementation **MUST** treat each user step as an ordered transaction boundary.
- The implementation **MUST** preserve the order of user intent, even if queries resolve out-of-order.
- The implementation **MUST** run requests in parallel within a step.

Example (rows step, then columns step):

1) **Rows step**:
   - Compute what is required to safely reveal the next row layer under the *current* visible column depth.
   - Fetch in parallel, stage deltas as they arrive.
   - Reveal atomically when satisfied.

2) **Columns step**:
   - Now visible row depth has changed; recompute requirements for the next column layer under the *new* visible row depth.
   - Fetch in parallel, stage deltas, reveal atomically when satisfied.

### B) Auto-expand (known target)

Auto-expand has a known target expansion depth/shape. For this mode:

- The implementation **MUST** compute the final required depths up-front (for both axes).
- The implementation **MUST** dispatch all required requests in parallel.
- The implementation **MUST** stage deltas as they arrive (order-independent).
- The implementation **MUST** reveal atomically once the final state is satisfied.

## When a transaction is used

This spec covers transactions used for **cross-axis manual actions** (row+col). Persisted restore and auto-expand also use atomic reveal, but their transaction boundaries are defined by their drivers (dashboard load, known target).

### Start / Extend criteria

On a user expand click:

- If there is an **in-flight expand** on the *other axis*, the implementation **MUST** start or extend a transaction.
- If there was a click on the other axis within the **coalescing window** (`COALESCE_WINDOW_MS = 50`), the implementation **MUST** start or extend a transaction even if the first request already resolved.

Rationale: cross-axis expands can require intersection cells that are not present in earlier responses fetched at a smaller opposite-axis depth.

## Transaction behavior (strict rules)

### 1) Fetch phase (parallel, buffered)

- The implementation **MUST** compute a “final desired expansion state” from all clicks included in the transaction (rows + cols sets).
- The implementation **MUST** compute a required fetch plan for BOTH axes for that final state.
- The implementation **MUST** fire all required requests **in parallel** (including “top-up” depth variants), subject to:
  - In-flight dedupe (same axis + key + requiredDepth).
  - Cache hits count as immediately resolved.
- As responses resolve, the implementation **MUST**:
  - store the delta into the transaction buffer, keyed by (axis, targetKey, requiredDepth),
  - apply epoch gating (discard results from an older base data epoch),
  - **MUST NOT** mutate the visible tree / visible expanded sets yet (no reveal).

### 2) Reveal phase (atomic, waits for completeness)

- The transaction is “ready to apply” only when all required targets for both axes are satisfied for the transaction’s final desired state.
- Only then the implementation **MUST** apply:
  - a single merge of all buffered deltas into the current tree,
  - a single update of `expandedRows`/`expandedCols` to the final desired sets,
  - a single clear of per-toggle loading state.
- The implementation **MUST NOT** apply partial results from a cross-axis transaction.

### 3) UI rules during a pending transaction

- The UI **MUST NOT**:
  - hide already-visible expanded nodes (no “collapse → expand”),
  - show blank intersection values that would later be filled.
- The UI **MUST**:
  - keep the prior stable state visible,
  - show per-toggle spinners for toggles involved in the transaction,
  - disable those toggles to avoid reentrancy.
- The UI **MUST** show a blocking chart-level overlay spinner while the transaction is pending (atomic reveal guarantee). Same-axis non-transaction expands keep the table interactive and use per-toggle spinners only.

### 4) Cancellation / superseding rules

If the user interacts while a transaction is pending, the implementation **MUST** follow deterministic rules:

- **Collapse (any axis)**:
  - **MUST** cancel the transaction immediately (Cancel-and-revert), keep the prior committed state visible, clear spinners/overlay.
  - The collapse intent is then processed against the committed state as a separate action (no partial transaction reveal).
- **New expand (either axis)**:
  - **MUST** extend the existing transaction: incorporate the new desired final state, recompute the required plan, dispatch any additional requests in parallel, and keep the overlay until the updated final state is satisfied.
- **Dataset/epoch change** (Update Now, filter change):
  - **MUST** cancel/ignore all buffered results (epoch gating) and clear transaction state.

### 5) Error / timeout rules

- If any required request fails:
  - The transaction **MUST** fail closed: keep the prior stable state, show an error message, clear spinners, allow retry.
- If a required request never resolves:
  - The transaction **MUST** time out (`TRANSACTION_TIMEOUT_MS = 30000`) and fail closed as above.

## Required tests (must exist and enforce rules)

Tests should live under `test/plugin/expand/` and should be explicit about request ordering (resolve/reject/never-resolve):

- **Cross-axis atomic apply**: assert no structure/value changes are applied until all required responses resolve.
- **No blank values even briefly**: assert the committed table remains visible until reveal; never show an “expanded but empty intersection” state.
- **No collapse flicker**: assert that previously-visible expanded nodes never disappear while a cross-axis transaction is pending.
- **Parallel fetch / gated reveal**: assert requests are started without awaiting each other and may resolve in any order; reveal still happens once.
- **Extend transaction on new expand**: click row expand, then col expand, then another row expand while pending; assert the transaction extends and reveal occurs once when the final plan is satisfied.
- **Cancel-and-revert on collapse**: start a cross-axis transaction, click collapse while pending; assert the transaction is canceled, committed UI remains stable, and late responses are ignored.
- **Failure closed**: one request rejects; assert no reveal, overlay clears, error displayed.
- **Timeout closed**: one request never resolves; advance timers; assert no reveal, overlay clears, error displayed.

## Notes

- These rules describe the target UX/behavior. They are intentionally stricter than “eventual consistency” to guarantee “no blanks” without cell placeholders.
