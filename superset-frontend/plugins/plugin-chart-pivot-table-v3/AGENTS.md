We are working on a new pivot table plugin for superset. You can read gerenal requirements in requirements.md file. There are other .md files in plugin folder describing different features.

We are using test driven development. When tackling bugs, FIRST write a test or miltiple tests depending on the issue. Ensure that the said test fails in the place you expect it to fail. Only then you can proceed with solving the bug. Tests must be relevant.

To run tests use **npm test plugins/plugin-chart-pivot-table-v3** From superset-frontend folder
Run tests after every significant change

To run lint use **npx eslint plugins/plugin-chart-pivot-table-v3** from superset-frontend folder
Run lint after every significant change
