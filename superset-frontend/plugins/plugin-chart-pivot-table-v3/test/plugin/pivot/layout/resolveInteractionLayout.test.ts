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
import {
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';
import {
  normalizeRuntimeLayout,
  resolveAppliedInteractionLayout,
  resolveInteractionFormData,
} from '../../../../src/pivot/layout/resolveInteractionLayout';
import { getStableColumnKey } from '../../../../src/utils';
import {
  getMetricKeys,
  METRICS_PLACEHOLDER,
} from '../../../../src/pivot/core/tokens';
import {
  MetricsLayoutEnum,
  PivotRuntimeLayout,
  PivotTableQueryFormData,
} from '../../../../src/types';
import { buildFormData } from '../../fixtures/pivotFormData';

describe('resolveInteractionFormData', () => {
  it('normalizes persisted runtime layout against available dimensions and metrics', () => {
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: ['country', 'missing-row'],
      cols: ['state', 'missing-col'],
      metrics: ['sum__sales', 'missing-metric'],
      leafSelection: {},
      valuePlacement: { axis: 'col', index: 0 },
    };

    expect(
      normalizeRuntimeLayout(
        runtimeLayout,
        ['country', 'state'],
        ['sum__sales'],
      ),
    ).toEqual({
      ...runtimeLayout,
      rows: ['country'],
      cols: ['state'],
      metrics: ['sum__sales'],
    });
  });

  it('uses runtime layout for rows/cols, metrics order, and value placement', () => {
    const formData: PivotTableQueryFormData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['country', 'state'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['sum__sales', 'sum__profit'],
      measureLeavesByMetric: {
        sum__sales: [buildValueLeaf()],
        sum__profit: [buildValueLeaf()],
      },
    });

    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [getStableColumnKey('country')],
      cols: [getStableColumnKey('state')],
      metrics: ['sum__profit'],
      leafSelection: { value: true },
      valuePlacement: { axis: 'col', index: 1 },
    };

    const resolved = resolveInteractionFormData({ formData, runtimeLayout });
    expect(resolved.groupbyRows).toEqual(['country']);
    expect(resolved.groupbyColumns).toEqual(['state', METRICS_PLACEHOLDER]);
    expect(getMetricKeys(resolved.metrics)).toEqual(['sum__profit']);
  });

  it('filters measure leaves by selection and respects selection order', () => {
    const leafIx = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const valueLeaf = buildValueLeaf();
    const formData: PivotTableQueryFormData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['country'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['sum__sales'],
      measureLeavesByMetric: {
        sum__sales: [valueLeaf, leafIx],
      },
    });

    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [getStableColumnKey('country')],
      cols: [],
      metrics: ['sum__sales'],
      leafSelection: { value: true, [leafIx.id]: true },
      leafOrder: [leafIx.id, valueLeaf.id],
      valuePlacement: { axis: 'row', index: 1 },
    };

    const resolved = resolveInteractionFormData({ formData, runtimeLayout });
    const leaves = resolved.measureLeavesByMetric?.sum__sales ?? [];
    expect(leaves.map(leaf => leaf.id)).toEqual([leafIx.id, valueLeaf.id]);
  });

  it('allows removing the value leaf to disable metrics', () => {
    const valueLeaf = buildValueLeaf();
    const formData: PivotTableQueryFormData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['country'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['sum__sales'],
      measureLeavesByMetric: {
        sum__sales: [valueLeaf],
      },
    });

    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [getStableColumnKey('country')],
      cols: [],
      metrics: ['sum__sales'],
      leafSelection: { value: false },
      valuePlacement: { axis: 'row', index: 1 },
    };

    const resolved = resolveInteractionFormData({ formData, runtimeLayout });
    expect(resolved.metrics).toEqual([]);
    expect(resolved.measureLeavesByMetric).toEqual({});
    expect(resolved.groupbyRows).toEqual(['country']);
    expect(resolved.groupbyColumns).toEqual([]);
  });
});

describe('resolveAppliedInteractionLayout', () => {
  it('keeps prop-driven layout inputs unchanged outside user-controlled mode', () => {
    const formData: PivotTableQueryFormData = buildFormData({
      interactionMode: 'standard',
      metrics: ['sum__sales'],
      groupbyRows: ['country'],
      groupbyColumns: ['state'],
    });
    const runtimeLayout = normalizeRuntimeLayout(undefined, [], ['sum__sales']);

    const resolved = resolveAppliedInteractionLayout({
      isUserControlled: false,
      appliedFormData: formData,
      formData,
      runtimeLayout,
      committedRuntimeLayout: {
        ...runtimeLayout,
        rows: ['state'],
      },
      appliedDimensionKeys: ['country', 'state'],
    });

    expect(resolved.appliedLayoutFormData).toBe(formData);
    expect(resolved.appliedRuntimeLayout).toBe(runtimeLayout);
  });

  it('preserves committed runtime metrics that are available in the source form', () => {
    const formData: PivotTableQueryFormData = buildFormData({
      interactionMode: 'user_controlled',
      dimensions: ['country', 'state'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['sum__sales', 'sum__profit'],
      measureLeavesByMetric: {
        sum__sales: [buildValueLeaf()],
        sum__profit: [buildValueLeaf()],
      },
    });
    const appliedFormData = formData;
    const runtimeLayout: PivotRuntimeLayout = {
      version: 1,
      rows: [getStableColumnKey('country')],
      cols: [getStableColumnKey('state')],
      metrics: ['sum__sales'],
      leafSelection: { value: true },
      valuePlacement: { axis: 'row', index: 1 },
    };
    const committedRuntimeLayout: PivotRuntimeLayout = {
      ...runtimeLayout,
      metrics: ['sum__profit'],
    };

    const resolved = resolveAppliedInteractionLayout({
      isUserControlled: true,
      appliedFormData,
      formData,
      runtimeLayout,
      committedRuntimeLayout,
      appliedDimensionKeys: [
        getStableColumnKey('country'),
        getStableColumnKey('state'),
      ],
    });

    expect(resolved.appliedRuntimeLayout.metrics).toEqual(['sum__profit']);
    expect(getMetricKeys(resolved.appliedLayoutFormData.metrics)).toEqual([
      'sum__profit',
    ]);
    expect(resolved.appliedLayoutFormData.groupbyRows).toEqual([
      'country',
      METRICS_PLACEHOLDER,
    ]);
    expect(resolved.appliedLayoutFormData.groupbyColumns).toEqual(['state']);
    expect(resolved.appliedLayoutFormData.metricsLayout).toBe(
      MetricsLayoutEnum.ROWS,
    );
    expect(resolved.appliedPivotProgram?.valueAxis).toBe('row');
    expect(resolved.appliedPivotProgram?.metricInsertIndex).toBe(1);
    expect(resolved.appliedPivotProgram?.rowDimensions).toEqual(['country']);
  });
});
