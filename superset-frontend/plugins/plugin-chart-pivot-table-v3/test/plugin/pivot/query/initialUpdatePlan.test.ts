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

import buildQuery from '../../../../src/buildQuery';
import {
  buildInitialPivotUpdatePlan,
  buildSelectionFilteredFormData,
  buildSelectionFilterClauses,
  formatQueryName,
} from '../../../../src/pivot/query/specs';
import { MetricsLayoutEnum, PivotRuntimeLayout } from '../../../../src/types';
import {
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';
import { METRICS_PLACEHOLDER } from '../../../../src/pivot/core/tokens';
import { buildFormData } from '../../fixtures/pivotFormData';

describe('buildInitialPivotUpdatePlan', () => {
  test('builds selection filters from stable-key selections', () => {
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['country', 'state'],
    });

    const filters = buildSelectionFilterClauses({
      formData,
      selection: {
        country: ['US'],
        state: ['CA'],
      },
    });

    expect(filters).toEqual([
      { col: 'country', op: 'IN', val: ['US'] },
      { col: 'state', op: 'IN', val: ['CA'] },
    ]);
  });

  test('ignores selection filters outside canonical dimension keys', () => {
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['country'],
    });

    const filters = buildSelectionFilterClauses({
      formData,
      selection: {
        Country: ['US'],
        country: ['CA'],
        unknown: ['ignored'],
      },
    });

    expect(filters).toEqual([{ col: 'country', op: 'IN', val: ['CA'] }]);
  });

  test('builds normalized form data with selection filters', () => {
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['country', 'state'],
      extra_form_data: {
        filters: [{ col: 'segment', op: 'IN', val: ['Consumer'] }],
      },
    });

    const filteredFormData = buildSelectionFilteredFormData({
      formData,
      selection: {
        country: ['US'],
      },
    });

    expect(filteredFormData.extra_form_data?.filters).toEqual([
      { col: 'segment', op: 'IN', val: ['Consumer'] },
      { col: 'country', op: 'IN', val: ['US'] },
    ]);
  });

  test('applies runtime layout + selection override before building specs', () => {
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['r2'],
      cols: ['c1'],
      metrics: ['countCustomers'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['r1', 'r2', 'c1'],
      groupbyRows: ['r1', 'r2'],
      groupbyColumns: [],
      metrics: ['countCustomers'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: {
        ...runtimeLayout,
        rows: ['r1'],
        cols: [],
      },
    });

    const plan = buildInitialPivotUpdatePlan({
      formData,
      runtimeLayout,
      selection: { r2: ['B'] },
    });

    expect(plan.formData.groupbyRows).toEqual(['r2']);
    expect(plan.formData.groupbyColumns).toEqual([METRICS_PLACEHOLDER, 'c1']);
    expect(plan.formData.extra_form_data?.filters).toEqual(
      expect.arrayContaining([{ col: 'r2', op: 'IN', val: ['B'] }]),
    );

    const bootstrapSpec = plan.specs.find(
      spec => spec.queryName === formatQueryName(1, 1),
    );
    expect(bootstrapSpec?.columns).toEqual(['r2', 'c1']);
  });

  test('ignores stale runtime layout when planning fixed-mode queries', () => {
    const formData = buildFormData({
      interactionMode: 'fixed',
      dimensions: ['age', 'month'],
      groupbyRows: ['age', 'month'],
      groupbyColumns: [],
      metrics: ['countCustomers'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: {
        version: 1,
        rows: ['month'],
        cols: [],
        metrics: ['countCustomers'],
        leafSelection: {},
        valuePlacement: { axis: 'col', index: 0 },
      },
    });

    const plan = buildInitialPivotUpdatePlan({ formData });
    const queryContext = buildQuery(formData);

    expect(plan.formData.groupbyRows).toEqual(['age', 'month']);
    expect(plan.formData.groupbyColumns).toEqual([METRICS_PLACEHOLDER]);
    expect(plan.specs.map(spec => spec.columns)).toContainEqual(['age']);
    expect(plan.specs.map(spec => spec.columns)).not.toContainEqual(['month']);
    expect(queryContext.queries.map(query => query.columns)).toEqual(
      plan.specs.map(spec => spec.columns),
    );
  });

  test('stays query-shape compatible with buildQuery', () => {
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['shipMode'],
      cols: ['orderStatus'],
      metrics: ['grossRevenue'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };
    const formData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['shipMode', 'orderStatus'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['grossRevenue'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      pivotRuntimeLayout: runtimeLayout,
      pivotSelectedFilters: { shipMode: ['MAIL'] },
      startCollapsed: true,
      initialDepth: 1,
    });

    const plan = buildInitialPivotUpdatePlan({ formData });
    const queryContext = buildQuery(formData);

    const queryShape = queryContext.queries.map(query => ({
      name: query.query_name,
      columns: query.columns,
    }));
    const planShape = plan.specs.map(spec => ({
      name: spec.queryName,
      columns: spec.columns,
    }));

    expect(queryShape).toEqual(planShape);
  });

  test('uses saved empty measure leaves as comparison defaults', () => {
    const formData = buildFormData({
      metrics: ['grossRevenue'],
      measureLeavesByMetric: {},
    });

    const plan = buildInitialPivotUpdatePlan({ formData });

    expect(plan.formData.measureLeavesByMetric?.grossRevenue).toEqual([
      buildValueLeaf(),
      buildBuiltInLeaf('offset_value', {
        n: 1,
        unit: 'month',
        direction: 'past',
      }),
      buildBuiltInLeaf('offset_value', {
        n: 1,
        unit: 'year',
        direction: 'past',
      }),
      buildBuiltInLeaf('ix', {
        n: 1,
        unit: 'month',
        direction: 'past',
      }),
    ]);
    expect(plan.formData.time_offsets).toEqual(['1 month ago', '1 year ago']);
  });

  test('does not build comparison queries from string time labels', () => {
    const query = buildQuery(
      buildFormData({
        groupbyRows: ['month', 'age'],
        groupbyColumns: [METRICS_PLACEHOLDER],
        metrics: ['N Baskets'],
        measureLeavesByMetric: {},
        temporal_columns_lookup: {
          transaction_timestamp: true,
        },
        adhoc_filters: [
          {
            clause: 'WHERE',
            comparator: 'No filter',
            expressionType: 'SIMPLE',
            operator: 'TEMPORAL_RANGE',
            subject: 'transaction_timestamp',
          },
        ],
      }),
    ).queries[0];

    expect(query.time_offsets).toEqual([]);
    expect(query.columns).toEqual(['month']);
  });

  test('keeps offsets for categorical dimensions with an enclosed time range', () => {
    const query = buildQuery(
      buildFormData({
        groupbyRows: ['age'],
        groupbyColumns: [METRICS_PLACEHOLDER],
        metrics: ['N Baskets'],
        measureLeavesByMetric: {},
        temporal_columns_lookup: {
          transaction_timestamp: true,
        },
        adhoc_filters: [
          {
            clause: 'WHERE',
            comparator: '2017-06-17T00:00:00 : 2017-07-01T00:00:00',
            expressionType: 'SIMPLE',
            operator: 'TEMPORAL_RANGE',
            subject: 'transaction_timestamp',
          },
        ],
      }),
    ).queries[0];

    expect(query.columns).toEqual(['age']);
    expect(query.time_offsets).toEqual(['1 month ago', '1 year ago']);
  });

  test('builds pivot-v3 comparison queries from a real temporal column', () => {
    const query = buildQuery(
      buildFormData({
        groupbyRows: ['transaction_timestamp', 'age'],
        groupbyColumns: [METRICS_PLACEHOLDER],
        metrics: ['N Baskets'],
        measureLeavesByMetric: {},
        temporal_columns_lookup: {
          transaction_timestamp: true,
        },
        time_grain_sqla: 'P1M',
      }),
    ).queries[0];

    expect(query.time_offsets).toEqual(['1 month ago', '1 year ago']);
    expect(query.columns?.[0]).toEqual({
      timeGrain: 'P1M',
      columnType: 'BASE_AXIS',
      sqlExpression: 'transaction_timestamp',
      label: 'transaction_timestamp',
      expressionType: 'SQL',
    });
    expect(query.columns).toHaveLength(1);
  });
});
