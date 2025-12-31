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

# Column Header Alignment Examples (Metrics Last on Columns)

## Excel-style layout (col_lvl1/col_lvl2 with totals)

Scenario
- Columns: col_lvl1 -> col_lvl2 -> Values
- Metrics: measure1, measure2
- Subtotals at col_lvl1 and grand totals enabled

```
Level 1: col_lvl1_1                                                                                              col_lvl1_1 measure1       col_lvl1_1 measure2       col_lvl1_2                                                                                              col_lvl1_2 measure1       col_lvl1_2 measure2       Total measure1            Total measure2
Level 2: col_lvl2_1                                          col_lvl2_2                                                                                              col_lvl2_1                                          col_lvl2_2
Level 3: measure1                  measure2                  measure1                  measure2                                                                      measure1                  measure2                  measure1                  measure2
```

## Desired (no repeated parent labels on leaf metrics)

Scenario
- Columns: ShipMode -> Category -> Values
- Metrics: Sales, Profit
- Data: AIR/FURNITURE, AIR/OFFICE
- Subtotals enabled at Category

```
Level 1: AIR (colSpan=6)
Level 2: FURNITURE (colSpan=2)                               OFFICE (colSpan=2)                                  Subtotal (colSpan=2)
Level 3: Sales                     Profit                    Sales                     Profit                    FURNITURE Sales           FURNITURE Profit
```

## Undesired (parent label repeated on every metric leaf)

```
Level 1: AIR (colSpan=6)
Level 2: FURNITURE (colSpan=2)                               OFFICE (colSpan=2)                                  Subtotal (colSpan=2)
Level 3: FURNITURE Sales           FURNITURE Profit          OFFICE Sales              OFFICE Profit             FURNITURE Sales           FURNITURE Profit
```
