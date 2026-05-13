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

import { formatQueryName } from '../../../../src/pivot/query/queryName';
import buildQuery from '../../../../src/buildQuery';
import {
  buildInitialPivotUpdatePlan,
  buildSelectionFilteredFormData,
  buildSelectionFilterClauses,
} from '../../../../src/pivot/update/initialUpdatePlan';
import { MetricsLayoutEnum, PivotRuntimeLayout } from '../../../../src/types';
import { METRICS_PLACEHOLDER } from '../../../../src/utils';
import { buildFormData } from '../../fixtures/pivotFormData';

describe('buildInitialPivotUpdatePlan', () => {
  it('builds selection filters from stable-key selections', () => {
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

  it('builds normalized form data with selection filters', () => {
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

  it('applies runtime layout + selection override before building specs', () => {
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

  it('stays query-shape compatible with buildQuery', () => {
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
});
