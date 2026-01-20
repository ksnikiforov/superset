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

# Pivot Table v3 — Expansion Query Methodology

This document defines the **query planning methodology** for Pivot Table v3.
It applies to all data fetches (initial load, persisted expansions, user-driven expansion).

## Goals

- **No redundant queries.** Never fetch a deeper root level if only a subset is visible.
- **Minimize query objects.** Prefer batching sibling expansions into a single `IN`-filtered query where possible.
- **No client rollups.** Do not derive deeper levels by aggregating other results.
- **No hidden fetches.** Expansions drive explicit queries; totals are explicit.
- **Deterministic planning.** The same expansion state always yields the same query set.

## Terms

- **Depth**: the number of groupby fields included for a row/column axis.
- **Root query**: a query **without path filters** (no expansion filters).
- **Branch query**: a query **with path filters** for a specific expanded node.
- **Visible nodes**: the set of row/column nodes shown by the expansion state.
- **Expansion path**: an ordered list of values defining a node (e.g. `["11-20", "N"]`).

## Methodology

### 1) Build the visible tree

Use the expansion state to determine **which nodes are visible** on each axis.
Expanded nodes reveal their children; collapsed nodes do not.

### 2) Root queries only for visible collapsed levels

Root queries are **only** used to render levels that are visible **without** expansion.
If a level is only visible under expanded parents, **do not** issue a root query for it.

### 3) Branch queries for expanded nodes only

Expanded nodes require fetching their children one dimension deeper on that axis.
Those fetches MUST be expressed as **branch/batch query objects** (not deeper root queries):
- single branch query objects for individual paths, and/or
- batched query objects when multiple expanded siblings share the same parent (see §5).

### 4) Cross-axis symmetry

For every **row depth** needed, pair it with the required **column depths** (and vice versa).
Do not emit redundant root queries when branch queries already cover the visible nodes.

### 5) Path combination rules (query minimization)

This is the key query-count optimization.

#### 5.1 Batchable expansions (siblings under the same parent)

Multiple expansions are **batchable** when they are all:
- on the same `axis` (row or col),
- at the same `childDepth`,
- under the same `parentPath` (same prefix),
- and have the same non-filter query shape (same metrics/columns/totals/formatting needs).

Then we combine them into **one query** by:
- applying equality filters for the entire parent prefix, and
- applying a single `IN (...)` filter on the *next groupby field* for the sibling values.

This is exactly the “row1 → row2, 3 expanded row1 nodes” optimization:

If expanded siblings are `row1 IN ("A","B","C")`, we can fetch all their `row2` children in **one** query:

```sql
SELECT row1, row2, SUM(metric)
FROM t
WHERE ... AND row1 IN ('A','B','C')
GROUP BY row1, row2;
```

This rule applies at any depth (not only at the root). Example:
- expand `["USA","Consumer"]` and `["USA","Corporate"]` → one query:
  - `country == "USA"` and `segment IN ("Consumer","Corporate")`

#### 5.2 Non-batchable expansions (different parents / tuple-IN required)

Batching is **not** possible when expansions span different parents at the same time, because it would require OR/tuple-IN across multiple columns which structured filters cannot express:

```sql
-- Not supported by structured filters:
(country, segment) IN (("USA","Consumer"),("Canada","Corporate"))
```

In those cases, expansions remain “one query per parent-group” (or worst case “one query per path”).

Truncation note: a combined `IN` query uses a single `row_limit`. If it is
truncated, we surface a warning and treat all included paths as partial.

### 6) Bundle independent queries into one request (round-trip minimization)

Batching reduces the number of **query objects**; bundling reduces the number of **network requests**.

When multiple query objects are known up-front, the client SHOULD send them in a single `/api/v1/chart/data` request payload (multi-query), for example:
- initial load: bootstrap/root queries + persisted expansion batch-prefetch queries
- filter/layout reload: the minimal required query objects for the new desired state (FC-3)
- a hydration iteration: multiple batch/single branch fetches that can be executed independently

This is the mechanism that makes “row2 prefetch should be simultaneous with row1 bootstrap” possible without multiple round-trips.

### 7) Truncation is explicit

If any query hits `row_limit`, treat its results as **partial**:
- render what is returned,
- surface a warning (e.g., "Results truncated; expanded data may be incomplete"),
- do not issue extra queries to "patch" the missing rows.

## Examples

### Example A — Two row levels (L1, L2), one expansion

Row levels: `L1, L2`, Column levels: `C1`.
Expanded row: `L1 = "Row1"`.

Queries:

```sql
-- Root (visible collapsed level)
SELECT L1, C1, SUM(metric)
FROM t
WHERE ...
GROUP BY L1, C1;
```

```sql
-- Branch (only expanded row)
SELECT L1, L2, C1, SUM(metric)
FROM t
WHERE ... AND L1 = 'Row1'
GROUP BY L1, L2, C1;
```

No root query for `(L1, L2)` across **all** rows.

### Example B — Multiple expansions

If multiple L1 nodes are expanded **under the same parent** (the root), combine them into **one** batch branch query:

```sql
-- Root (visible collapsed level)
SELECT L1, C1, SUM(metric)
FROM t
WHERE ...
GROUP BY L1, C1;
```

```sql
-- Batched branch (multiple expanded siblings under the same parent)
SELECT L1, L2, C1, SUM(metric)
FROM t
WHERE ... AND L1 IN ('Row1', 'Row2', 'Row3')
GROUP BY L1, L2, C1;
```

Do not issue a single **root** query for `(L1, L2)` across **all** rows.

If expansions exist under different parents at once (e.g. `("USA","Consumer")` and `("Canada","Corporate")`), those cannot be combined and must remain multiple queries (see §5.2).

### Example C — Persisted expansions on reload (same request as bootstrap)

Scenario:
- row levels: `row1, row2`
- no rows are expanded by default (`startCollapsed=true`, `initialDepth=1`)
- user previously expanded `row1="A"`, `row1="B"`, `row1="C"` and this is persisted

Minimum-query plan:
1) Bootstrap/root query for the visible collapsed level (`row1`) so we can render the top-level rows.
2) One batched branch query for `row2` under the persisted expanded `row1` siblings.

Critical UX requirement:
- for full reloads and filter reloads, the planner SHOULD include both queries in the same `/api/v1/chart/data` request (multi-query payload) so the “row2 prefetch” runs without waiting for a second round-trip.

## Test Expectations

- Initial load without expansions uses **root queries only**.
- Persisted expansions add **only branch/batch queries** for the expanded nodes, not deeper root queries.
- Query count scales with **expanded intent**, but sibling expansions SHOULD collapse into batch queries when possible.
- Truncation triggers a user-visible warning.
