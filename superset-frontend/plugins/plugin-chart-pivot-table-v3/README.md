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

## @superset-ui/plugin-chart-pivot-table-v3

Pivot Table v3 keeps the familiar formatting/cross-filtering experience while moving aggregation to the database and lazily fetching branches as the user expands them.

### Highlights

- Starts collapsed by default; initial expansion levels are controlled per axis, and each expansion issues a scoped `/api/v1/chart/data` call with a spinner on the header cell.
- Totals and subtotals (including count distinct) come directly from database queries at each depth.
- When totals/subtotals are disabled and the table is fully expanded, the plugin falls back to a single grouped query for efficiency.
- Formatting, cross-filter, and drill-to-detail hooks match Pivot Table v2.

### Usage

```js
import PivotTableV3ChartPlugin from '@superset-ui/plugin-chart-pivot-table-v3';

new PivotTableV3ChartPlugin().configure({ key: 'pivot_table_v3' }).register();
```

Key form fields: `groupbyRows`, `groupbyColumns`, `metrics`, `aggregateFunction`, `expandRowsLevel`, `expandColumnsLevel`, `rowTotals`, `colTotals`, `rowSubTotals`, `rowSubtotalLevels`, `colSubtotalLevels`, `rowOrder`, `colOrder`, `valueFormat`, `dateFormat`, `currencyFormat`, `allowRenderHtml`, `metricsLayout`, `combineMetric`.

### Structure

```
├── CHANGELOG.md
├── README.md
├── package.json
├── tsconfig.json
├── src
│   ├── PivotTableChart.tsx
│   ├── buildQuery.ts
│   ├── controlPanel.tsx
│   ├── fetchPivotExpansion.ts
│   ├── images/thumbnail.png
│   ├── index.ts
│   ├── react-pivottable/
│   ├── transformProps.ts
│   ├── types.ts
│   └── utils.ts
├── test
└── types
    └── external.d.ts
```
