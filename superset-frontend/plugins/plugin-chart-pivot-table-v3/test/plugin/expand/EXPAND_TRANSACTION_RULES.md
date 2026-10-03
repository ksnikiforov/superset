# Pivot Table v3 expansion transactions

Expansion stages aggregate facts in the fact store and reveals a materialized projection only when its required coverage is complete. Tree fragments and request names do not own loaded state.

## Intent and committed state

`ExpansionSession` owns desired expanded/collapsed sets, the last committed checkpoint, request groups, epochs, and loading scopes. Its public snapshots cannot mutate its internal sets. The React hook adapts the session to incoming data, persistence, and visible state.

- Preserve the committed table while requests are pending; interaction controls remain live.
- Fetch missing coverage as soon as it is known. Independent requests may run in parallel.
- Independent branches on one axis may reveal as each branch completes against the committed opposite axis.
- When both axes have uncommitted expansion intent, reveal their combined projection atomically after all required row, column, and intersection coverage arrives.
- Recheck coverage after asynchronous materialization. A projection computed for superseded intent cannot become visible.
- Persist only the intent represented by the committed projection.

## Cancellation, failure, and refresh

- Collapse cancels pending work and restores the committed checkpoint on both axes before applying the collapse.
- A request failure or 30-second deadline clears owned loading scopes and reports an error without revealing incomplete coverage. Retry repeats pending intent.
- A refreshed base query invalidates the previous epoch. Its late responses cannot replace the refreshed tree or clear a newer request's loading state.
- Each chart owns its request identifiers. Cancellation cannot affect another chart, and an older request's cleanup cannot remove its replacement controller.
- Truncated results never satisfy complete coverage. Partial facts may remain available internally, but expansion fails with a row-limit message.

## Test obligations

Use controlled response ordering to verify cross-axis atomic reveal, independent same-axis completion, collapse rollback, epoch replacement, error/retry, and deadlines. Advance fake timers for timeout tests and dispose sessions to clear pending deadlines. Test coverage selectors independently of tree shape.

Relevant regressions live in `test/runtimeTransactions.test.ts` and `test/plugin/PivotTableChart/interaction-seamless-expansion.test.tsx`, alongside expansion hook/planner tests.
