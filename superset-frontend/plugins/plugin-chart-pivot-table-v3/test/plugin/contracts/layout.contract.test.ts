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
import { MetricsLayoutEnum, PivotTableQueryFormData } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import { buildInitialQuerySpecs } from '../../../src/pivot/query/specs';
import {
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../src/pivot/measureLeaves';

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

    const layout = buildLayoutContext(formData);
    const specs = buildInitialQuerySpecs(formData, layout);
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
    const resultLayout = buildLayoutContext(
      result.formData as PivotTableQueryFormData,
    );
    const signature = JSON.parse(result.treeDataSignature ?? '{}') as {
      rows: string[];
      cols: string[];
      metricsLayout: MetricsLayoutEnum;
      metricInsertIndex: number;
      rowSubtotalLevels: number[];
      colSubtotalLevels: number[];
    };

    expect(signature.rows).toEqual(resultLayout.pivotProgram.rowDimensions);
    expect(signature.cols).toEqual(resultLayout.pivotProgram.columnDimensions);

    expect(
      specs.some(spec => spec.meta.factSelector.scope.kind === 'root'),
    ).toBe(true);
    expect(signature.metricsLayout).toBe(result.formData.metricsLayout);
    expect(signature.metricInsertIndex).toBe(
      resultLayout.pivotProgram.metricInsertIndex,
    );
    expect(signature.rowSubtotalLevels).toEqual(resultLayout.rowSubtotalLevels);
    expect(signature.colSubtotalLevels).toEqual(
      resultLayout.colSubtotalLevelsForQuery,
    );
  });

  it('keeps leaf tiers visible when measure leaves are defined', () => {
    const formData = buildFormData({
      metrics: ['m1'],
      measureLeavesByMetric: {
        m1: [
          buildValueLeaf(),
          buildBuiltInLeaf('ix', {
            n: 1,
            unit: 'year',
            direction: 'past',
          }),
        ],
      },
    });

    const layout = buildLayoutContext(formData);

    expect(layout.measureHierarchy).toMatchObject({
      kind: 'measureStackV1',
      leafTierVisibility: 'visible',
    });
  });

  it('uses only runtime total position values', () => {
    const formData = buildFormData({
      colTotals: true,
      colTotalPosition: 'end',
      rowTotalPosition: 'start',
    });

    const layout = buildLayoutContext(formData);

    expect(layout.colTotalPosition).toBe('end');
    expect(layout.rowTotalPosition).toBe('start');
  });
});
