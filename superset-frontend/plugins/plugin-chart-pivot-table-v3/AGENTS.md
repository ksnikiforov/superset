We are working on a new pivot table plugin for superset. You can read gerenal requirements in requirements.md file. There are other .md files in plugin folder describing different features.

We are using test driven development. When tackling bugs, FIRST write a test or miltiple tests depending on the issue. Ensure that the said test fails in the place you expect it to fail. Only then you can proceed with solving the bug. Tests must be relevant.

To run tests use **npm test plugins/plugin-chart-pivot-table-v3** From superset-frontend folder
Run tests after every significant change

To run pivot table v3 e2e use **PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run cypress-run-chrome -- --spec cypress/e2e/explore/visualizations/pivot_table_v3.test.ts --config baseUrl=http://localhost:8081,video=false** from `superset-frontend/cypress-base` folder
Run e2e when validating dashboard-level behavior/regressions

To run lint use **npx eslint plugins/plugin-chart-pivot-table-v3** from superset-frontend folder
Run lint after every significant change

## Totals Terminology (Must Stay Consistent)

- **Row total** means total of rows, and it appears on the **columns axis** (as total column header/cells).
- **Column total** means total of columns, and it appears on the **rows axis** (as total row).
- **Row total position** supports **front** or **end**.
- **Column total position** supports **top** or **bottom**.
- Never swap these meanings in code, tests, docs, or review comments.
