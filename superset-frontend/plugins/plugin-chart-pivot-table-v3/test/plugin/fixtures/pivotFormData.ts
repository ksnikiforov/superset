/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { SetDataMaskHook } from '@superset-ui/core';
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../../src/types';

const noopSetDataMask: SetDataMaskHook = () => undefined;

export const baseFormData: PivotTableQueryFormData = {
  groupbyRows: ['r1', 'r2'],
  groupbyColumns: [],
  metrics: ['countCustomers'],
  aggregateFunction: 'Sum',
  colTotals: false,
  rowTotals: false,
  rowSubTotals: false,
  rowSubtotalLevels: [],
  colSubtotalLevels: [],
  startCollapsed: true,
  initialDepth: 1,
  rowOrder: 'key_a_to_z',
  colOrder: 'key_a_to_z',
  metricsLayout: MetricsLayoutEnum.ROWS,
  viz_type: 'pivot_table_v3',
  datasource: '1__table',
  metricColorFormatters: [],
  dateFormatters: {},
  verboseMap: {
    c1: 'c1',
    c2: 'c2',
    c3: 'c3',
    col1: 'col1',
    col2: 'col2',
    col3: 'col3',
    name: 'name',
    orderDate: 'orderDate',
    r1: 'r1',
    r2: 'r2',
    r3: 'r3',
    row1: 'row1',
    row2: 'row2',
    row3: 'row3',
  },
  columnFormats: {},
  currencyFormats: {},
  order_desc: false,
  height: 300,
  width: 400,
  margin: 0,
  setDataMask: noopSetDataMask,
};

export const buildFormData = (
  overrides: Partial<PivotTableQueryFormData>,
): PivotTableQueryFormData => ({
  ...baseFormData,
  ...overrides,
});
