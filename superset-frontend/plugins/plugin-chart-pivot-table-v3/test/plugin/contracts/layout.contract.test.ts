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
import { ChartProps, GenericDataType, supersetTheme } from '@superset-ui/core';
import transformProps from '../../../src/transformProps';
import { buildInitialQueryPlan } from '../../../src/pivot/engine/initialQueryPlan';
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';

describe('layout resolution (contracts)', () => {
  it('keeps transformProps layout/subtotal normalization consistent with the initial query plan', () => {
    const formData = buildFormData({
      groupbyRows: ['r1', '__MEASURES__', 'r2'],
      groupbyColumns: ['c1', '__MEASURES__', 'c2'],
      metrics: ['m1'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      colTotals: true,
      rowSubTotals: false,
      rowSubtotalLevels: [],
      colSubtotalLevels: [0, 1],
    });

    const plan = buildInitialQueryPlan(formData);
    const chartProps = new ChartProps({
      formData,
      width: 400,
      height: 300,
      queriesData: [],
      hooks: { setDataMask: jest.fn() },
      filterState: { selectedFilters: {} },
      datasource: {
        verboseMap: {},
        columnFormats: {},
        currencyFormats: {},
        columns: [
          { column_name: 'r1', type_generic: GenericDataType.String },
          { column_name: 'r2', type_generic: GenericDataType.String },
          { column_name: 'c1', type_generic: GenericDataType.String },
          { column_name: 'c2', type_generic: GenericDataType.String },
        ],
      },
      theme: supersetTheme,
    });

    const result = transformProps(
      chartProps as ChartProps<PivotTableQueryFormData>,
    );
    const signature = JSON.parse(result.formData.treeDataSignature) as {
      metricsLayout: MetricsLayoutEnum;
      metricInsertIndex: number;
      rowSubtotalLevels: number[];
      colSubtotalLevels: number[];
    };

    expect(result.groupbyRows).toEqual(plan.rowGroupby);
    expect(result.groupbyColumns).toEqual(plan.colGroupby);

    const bootstrapTarget = plan.targets.find(t => t.kind === 'bootstrap');
    expect(bootstrapTarget).toBeDefined();
    expect(signature.metricsLayout).toBe(
      bootstrapTarget?.metricsLayoutResolved,
    );
    expect(signature.metricInsertIndex).toBe(
      bootstrapTarget?.metricInsertIndex,
    );
    expect(signature.rowSubtotalLevels).toEqual(
      bootstrapTarget?.rowSubtotalLevels,
    );
    expect(signature.colSubtotalLevels).toEqual(
      bootstrapTarget?.colSubtotalLevels,
    );
  });
});
