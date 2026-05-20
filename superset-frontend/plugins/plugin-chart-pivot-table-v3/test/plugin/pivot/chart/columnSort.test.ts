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
  type MeasureHierarchy,
  type PivotTreeNode,
} from '../../../../src/types';
import type { PivotProgram } from '../../../../src/pivot/runtime/types';
import {
  buildBuiltInLeaf,
  buildMeasureLeafOutputKey,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';
import {
  buildPivotColumnSortStateForClick,
  reconcilePivotColumnSortState,
  resolvePivotColumnSortDataKey,
  resolvePivotColumnSortMetric,
  type PivotColumnSortLayout,
} from '../../../../src/pivot/chart/columnSort';
import {
  encodeMeasureLeafKey,
  encodeMetricKey,
} from '../../../../src/pivot/core/tokens';

const valueLeaf = buildValueLeaf();
const deltaLeaf = buildBuiltInLeaf('delta');
const metricToken = encodeMetricKey('sales');
const valueLeafToken = encodeMeasureLeafKey(valueLeaf.id);
const deltaLeafToken = encodeMeasureLeafKey(deltaLeaf.id);
const deltaOutputKey = buildMeasureLeafOutputKey('sales', deltaLeaf);

const node = (key: string, path: PivotTreeNode['path']): PivotTreeNode => ({
  axis: 'col',
  key,
  path,
  label: key,
  formattedLabel: key,
  level: path.length,
  hasChildren: false,
});

const measureHierarchy: MeasureHierarchy = {
  kind: 'measureStackV1',
  groups: [
    {
      metricKey: 'sales',
      leaves: [valueLeaf, deltaLeaf],
    },
  ],
  leafTierVisibility: 'visible',
};

const pivotProgram: PivotProgram = {
  rowDimensions: [],
  columnDimensions: ['year'],
  metrics: [{ key: 'sales', metric: 'sales', index: 0 }],
  metricKeys: ['sales'],
  valueAxis: 'col',
  metricInsertIndex: 1,
};

const layout: PivotColumnSortLayout = {
  measureHierarchy,
  layout: { pivotProgram },
};

describe('column sort helpers', () => {
  it('resolves measure group headers to the default value leaf metric', () => {
    expect(
      resolvePivotColumnSortMetric({
        node: node('group', ['2025', metricToken]),
        layout,
      }),
    ).toBe('sales');
  });

  it('resolves clicked measure leaves to their output metric keys', () => {
    expect(
      resolvePivotColumnSortMetric({
        node: node('delta', ['2025', metricToken, deltaLeafToken]),
        layout,
      }),
    ).toBe(deltaOutputKey);
  });

  it('uses a matching descendant leaf as the data column for group headers', () => {
    const groupNode = node('group', ['2025', metricToken]);
    const valueNode = node('value', ['2025', metricToken, valueLeafToken]);
    const deltaNode = node('delta', ['2025', metricToken, deltaLeafToken]);

    expect(
      resolvePivotColumnSortDataKey({
        node: groupNode,
        metricKey: deltaOutputKey,
        layout,
        columnNodes: {
          [groupNode.key]: groupNode,
          [valueNode.key]: valueNode,
          [deltaNode.key]: deltaNode,
        },
      }),
    ).toBe(deltaNode.key);
  });

  it('cycles click state from ascending to descending to cleared', () => {
    const groupNode = node('group', ['2025', metricToken]);
    const valueNode = node('value', ['2025', metricToken, valueLeafToken]);
    const columns = {
      [groupNode.key]: groupNode,
      [valueNode.key]: valueNode,
    };

    const asc = buildPivotColumnSortStateForClick({
      current: null,
      node: groupNode,
      layout,
      columnNodes: columns,
    });
    expect(asc).toEqual({
      colKey: valueNode.key,
      displayColKey: groupNode.key,
      metricKey: 'sales',
      order: 'asc',
    });

    const desc = buildPivotColumnSortStateForClick({
      current: asc,
      node: groupNode,
      layout,
      columnNodes: columns,
    });
    expect(desc).toEqual({
      colKey: valueNode.key,
      displayColKey: groupNode.key,
      metricKey: 'sales',
      order: 'desc',
    });

    expect(
      buildPivotColumnSortStateForClick({
        current: desc,
        node: groupNode,
        layout,
        columnNodes: columns,
      }),
    ).toBeNull();
  });

  it('reconciles active group sorting to the current descendant data key', () => {
    const groupNode = node('group', ['2025', metricToken]);
    const valueNode = node('value-new', ['2025', metricToken, valueLeafToken]);
    const current = {
      colKey: 'value-old',
      displayColKey: groupNode.key,
      metricKey: 'sales',
      order: 'asc' as const,
    };

    expect(
      reconcilePivotColumnSortState({
        current,
        layout,
        columnNodes: {
          [groupNode.key]: groupNode,
          [valueNode.key]: valueNode,
        },
      }),
    ).toEqual({
      ...current,
      colKey: valueNode.key,
    });
  });

  it('ignores clicks on non-metric column headers', () => {
    const rowValueAxisLayout: PivotColumnSortLayout = {
      ...layout,
      layout: {
        pivotProgram: {
          ...pivotProgram,
          valueAxis: 'row',
          metricInsertIndex: 0,
        },
      },
    };

    expect(
      buildPivotColumnSortStateForClick({
        current: null,
        node: node('year', ['2025']),
        layout: rowValueAxisLayout,
        columnNodes: {},
      }),
    ).toBeUndefined();
  });
});
