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
import { resolveInteractionFormData } from '../../../../src/pivot/layout/resolveInteractionLayout';
import {
  getMetricKeys,
  METRICS_PLACEHOLDER,
  getStableColumnKey,
} from '../../../../src/utils';
import {
  PivotRuntimeLayout,
  PivotTableQueryFormData,
} from '../../../../src/types';

describe('resolveInteractionFormData', () => {
  it('uses runtime layout for rows/cols, metrics order, and value placement', () => {
    const formData = {
      interactionMode: 'user_controlled',
      dimensions: ['country', 'state'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['sum__sales', 'sum__profit'],
      measureLeavesByMetric: {
        sum__sales: [buildValueLeaf()],
        sum__profit: [buildValueLeaf()],
      },
    } as PivotTableQueryFormData;

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
    const formData = {
      interactionMode: 'user_controlled',
      dimensions: ['country'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['sum__sales'],
      measureLeavesByMetric: {
        sum__sales: [valueLeaf, leafIx],
      },
    } as PivotTableQueryFormData;

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
    const formData = {
      interactionMode: 'user_controlled',
      dimensions: ['country'],
      groupbyRows: [],
      groupbyColumns: [],
      metrics: ['sum__sales'],
      measureLeavesByMetric: {
        sum__sales: [valueLeaf],
      },
    } as PivotTableQueryFormData;

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
