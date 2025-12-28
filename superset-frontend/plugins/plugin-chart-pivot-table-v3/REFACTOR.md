# Pivot Table v3 Refactor Notes

This document tracks structural refactor work for the pivot-table v3 plugin. It is not a spec for end-user behavior.

## Goals
- Keep the HTML table output and behavior identical while reducing file size and coupling.
- Isolate pure logic so it is easier to test and reuse.
- Prepare for future changes to metrics/totals policies and query planning.

## Completed changes
- Extracted view-model helpers (tree traversal, header row building, sorting, and metric value formatting) from `src/PivotTableChart.tsx` into `src/pivot/viewModel.ts`.
- Extracted totals/metrics helper logic (metric path helpers, subtotal/total detection, depth helpers) from `src/PivotTableChart.tsx` into `src/pivot/metricsTotals.ts`.
- Extracted visibility and column-display helpers from `src/PivotTableChart.tsx` into `src/pivot/visibility.ts` and `src/pivot/columnDisplay.ts`.

## Current structure
- `src/PivotTableChart.tsx`: React state + rendering.
- `src/pivot/viewModel.ts`: Pure helpers for traversal/sorting/formatting.
- `src/pivot/metricsTotals.ts`: Pure helpers for totals/metrics policies.
- `src/pivot/visibility.ts`: Visible row/column builders, depth helpers, subtotal leaf ordering, and loaded-children checks.
- `src/pivot/columnDisplay.ts`: Column header display-path logic.
- `src/pivot/filters.ts`: Filter construction helpers for cross-filtering and context menu actions.
- `src/pivot/cellUtils.ts`: Cell-level helpers (metric key resolution, row subtotal hide logic, label formatting).

## Next steps
- Extract totals/metrics policy helpers out of `src/PivotTableChart.tsx` into a shared module.
- Introduce a view-model builder that produces visible rows/cols and header rows without React state.
- Keep tests green after each extraction and add focused unit tests for the new helpers.
