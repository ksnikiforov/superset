I am creating a new pivot table chart in superset. The details of implementation are located in requirements.md
Read the whole document and the the relevant code.
I want the following changes to the code of the plugin

1) When there are 2 and more metrics, the metrics layer is always expanded and shown. Here the case without totals is described:
   So, lets say the state is:

- rows: group, product, values
- columns:
- measures: measure1, measure2
  When two measures are selected, and group is collapsed i want to see:

* [+] group
  - measure1
  - measure2

So the product level is skipped, but is expandable from group.
When expanded the levels will look like this

* [-] group
  - product
    - measure1
    - measure2

If the measures value is placed inbetween, then the measures become expandable
rows: group, Values, product
So before the expand it will look like this

* group
  - [+] measure1
  - [+] measure2
    with both being expandable
    And on expand like this
* group
  - [-] measure1
    - product
  - [+] measure2

2) Now what do we do with totals. Here only the case with one column is examined. Measures are on rows.
   Earlier one of the requirements was no subototals for rows (well, there are subtotals, but they are basically baked in). This requirement is now lifted and we are doing proper row subototals. Here is how they should behave.
   First, the subtotals are opt-in. By default the row subototals are turned on. and appear as they appear now in the row that is of higher hierarchy.
   So for scenario with one measure like this
   rows: group, product, values
   will generate

- [-] group # group subototal values
  - product

Now there should be an option: show subtotals at the top/bottom of the group. When bottom is selected, here is how our hierarchy would change

- Rows
  - [-] Bikes # no values here
    - bike product 1
    - bike product 2
    - bike product 3
  - Bikes Total # here will be subtotals for the upper group
- Grand total # row grand total

 When hierarchy becomes more complex here is how it should be handled (only one measure, subtotals at the bottom)
 rows: group, product, product_parts, values

- Rows
  - [-] Bikes # no values here
    - [+] bike product 1 # no values here
      - bike part 1
      - bike part 2
    - bike product 1 Total # total of group here
    - [+] bike product 2 # also group totals presen. Will disaper only after expand
    - [+] bike product 3
  - Bikes Total # here will be subtotals for the upper group
- Grand total # row grand total

So what happens to subtotals when there are multiple measures selected. It's simple, we automaticlly use the case of "subtotals appear at the bottom", ignoring the flag even if it is selected "on top". (but for grand totals we respect the flag)
Here is an example with subtotals enabled

- rows: group, product, product_parts, values
- columns:
- measures: measure1, measure2
- Rows

  - [-] Bikes # no values here
    - [+] bike product 1 # no values here
      - bike part 1
        - measure1
        - measure2
      - bike part 2
        - measure1
        - measure2
    - bike product 1 measure1 # total of group here, note, we use the measure name
    - bike product 1 measure1
    - [+] bike product 2 # also group totals presen. Will disaper only after expand
    - [+] bike product 3
  - Bikes measure1 # total of group here. Note, such totals are bold.
  - Bikes measure2
- Total measure1
- Total measure2

 Here is a fully expanede example in table form with subtotals active (hierarchy sturcutre)

| Rows           |                |                |       |          |    |
| -------------- | -------------- | -------------- | ----- | -------- | -- |
|                | Bikes          |                |       |          |    |
|                |                | Bike1          |       |          |    |
|                |                |                | Part1 |          |    |
|                |                |                |       | measure1 | 1  |
|                |                |                |       | measure2 | 5  |
|                |                |                | Part2 |          |    |
|                |                |                |       | measure1 | 2  |
|                |                |                |       | measure2 | 1  |
|                |                |                | Part3 |          |    |
|                |                |                |       | measure1 | 3  |
|                |                |                |       | measure2 | 3  |
|                |                | Bike1 measure1 |       |          | 6  |
|                |                | Bike1 measure2 |       |          | 9  |
|                |                | Bike2          |       |          |    |
|                |                |                | Part1 |          |    |
|                |                |                |       | measure1 | 4  |
|                |                |                |       | measure2 | 4  |
|                |                |                | Part2 |          |    |
|                |                |                |       | measure1 | 4  |
|                |                |                |       | measure2 | 4  |
|                |                |                | Part3 |          |    |
|                |                |                |       | measure1 | 1  |
|                |                |                |       | measure2 | 2  |
|                |                | Bike2 measure1 |       |          | 9  |
|                |                | Bike2 measure2 |       |          | 10 |
|                | Bikes measure1 |                |       |          | 15 |
|                | Bikes measure2 |                |       |          | 19 |
| Total measure1 |                |                |       |          | 15 |
| Total measure2 |                |                |       |          | 19 |

3) And this leaves the case when measures are on columns. Here is how to deal with that. Lets consider this case:

- rows:
- columns: group, product, values
- measures: measure1, measure2

Basically this scenario follows the case in rows, BUT, the values are folded inside the vertical cells, not to the bottom
The location of subtotals is also ignored, only grand totals cab be moved.

| Column Labels |          |          |          |          |          |                |                |          |          |          |          |          |          |                |                |                |                | Total measure1 | Total measure2 |
| ------------- | -------- | -------- | -------- | -------- | -------- | -------------- | -------------- | -------- | -------- | -------- | -------- | -------- | -------- | -------------- | -------------- | -------------- | -------------- | -------------- | -------------- |
| Bikes         |          |          |          |          |          |                |                |          |          |          |          |          |          |                |                | Bikes measure1 | Bikes measure2 |                |                |
| Bike1         |          |          |          |          |          | Bike1 measure1 | Bike1 measure2 | Bike2    |          |          |          |          |          | Bike2 measure1 | Bike2 measure2 |                |                |                |                |
| Part1         |          | Part2    |          | Part3    |          |                |                | Part1    |          | Part2    |          | Part3    |          |                |                |                |                |                |                |
| measure1      | measure2 | measure1 | measure2 | measure1 | measure2 |                |                | measure1 | measure2 | measure1 | measure2 | measure1 | measure2 |                |                |                |                |                |                |
| 1             | 5        | 2        | 1        | 3        | 3        | 6              | 9              | 4        | 4        | 4        | 4        | 1        | 2        | 9              | 10             | 15             | 19             | 15             | 19             |

Here is an even harer case

|                |                |                |       |          | Column Labels |            |                  |            |            |                  | Grand Total |
| -------------- | -------------- | -------------- | ----- | -------- | ------------- | ---------- | ---------------- | ---------- | ---------- | ---------------- | ----------- |
|                |                |                |       |          | col_lvl1_1    |            | col_lvl1_1 Total | col_lvl1_2 |            | col_lvl1_2 Total |             |
| Rows           |                |                |       |          | col_lvl2_1    | col_lvl2_2 |                  | col_lvl2_1 | col_lvl2_2 |                  |             |
|                | Bikes          |                |       |          |               |            |                  |            |            |                  |             |
|                |                | Bike1          |       |          |               |            |                  |            |            |                  |             |
|                |                |                | Part1 |          |               |            |                  |            |            |                  |             |
|                |                |                |       | measure1 | 1             |            | 1                | 1          |            | 1                | 2           |
|                |                |                |       | measure2 | 5             |            | 5                | 5          |            | 5                | 10          |
|                |                |                | Part2 |          |               |            |                  |            |            |                  |             |
|                |                |                |       | measure1 | 2             |            | 2                | 2          |            | 2                | 4           |
|                |                |                |       | measure2 | 1             |            | 1                | 1          |            | 1                | 2           |
|                |                |                | Part3 |          |               |            |                  |            |            |                  |             |
|                |                |                |       | measure1 | 3             |            | 3                | 3          |            | 3                | 6           |
|                |                |                |       | measure2 | 3             |            | 3                | 3          |            | 3                | 6           |
|                |                | Bike1 measure1 |       |          | 6             |            | 6                | 6          |            | 6                | 12          |
|                |                | Bike1 measure2 |       |          | 9             |            | 9                | 9          |            | 9                | 18          |
|                |                | Bike2          |       |          |               |            |                  |            |            |                  |             |
|                |                |                | Part1 |          |               |            |                  |            |            |                  |             |
|                |                |                |       | measure1 |               | 4          | 4                |            | 4          | 4                | 8           |
|                |                |                |       | measure2 |               | 4          | 4                |            | 4          | 4                | 8           |
|                |                |                | Part2 |          |               |            |                  |            |            |                  |             |
|                |                |                |       | measure1 |               | 4          | 4                |            | 4          | 4                | 8           |
|                |                |                |       | measure2 |               | 4          | 4                |            | 4          | 4                | 8           |
|                |                |                | Part3 |          |               |            |                  |            |            |                  |             |
|                |                |                |       | measure1 |               | 1          | 1                |            | 1          | 1                | 2           |
|                |                |                |       | measure2 |               | 2          | 2                |            | 2          | 2                | 4           |
|                |                | Bike2 measure1 |       |          |               | 9          | 9                |            | 9          | 9                | 18          |
|                |                | Bike2 measure2 |       |          |               | 10         | 10               |            | 10         | 10               | 20          |
|                | Bikes measure1 |                |       |          | 6             | 9          | 15               | 6          | 9          | 15               | 30          |
|                | Bikes measure2 |                |       |          | 9             | 10         | 19               | 9          | 10         | 19               | 38          |
| Total measure1 |                |                |       |          | 6             | 9          | 15               | 6          | 9          | 15               | 30          |
| Total measure2 |                |                |       |          | 9             | 10         | 19               | 9          | 10         | 19               | 38          |

Same data, but layout of measures at the bottom of columns
