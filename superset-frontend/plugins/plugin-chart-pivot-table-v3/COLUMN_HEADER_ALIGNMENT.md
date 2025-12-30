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

Scenario
- Columns: ShipMode -> Category -> Values
- Metrics: Sales, Profit
- Data: AIR/FURNITURE, AIR/OFFICE
- Subtotals enabled at Category

## Desired (no repeated parent labels on leaf metrics)

```
Level 1: AIR (colSpan=6)
Level 2: FURNITURE (colSpan=2)                        OFFICE (colSpan=2)                          Subtotal (colSpan=2)
Level 3: Sales                 Profit                Sales                 Profit                FURNITURE Sales       FURNITURE Profit
```

## Undesired (parent label repeated on every metric leaf)

```
Level 1: AIR (colSpan=6)
Level 2: FURNITURE (colSpan=2)                        OFFICE (colSpan=2)                          Subtotal (colSpan=2)
Level 3: FURNITURE Sales       FURNITURE Profit      OFFICE Sales          OFFICE Profit         FURNITURE Sales       FURNITURE Profit
```
