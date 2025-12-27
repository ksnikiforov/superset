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

import { MetricsLayoutEnum, PivotTreeData } from '../../src/types';
import { applyMetricAxis, serializePath } from '../../src/utils';

const baseTree: PivotTreeData = {
  rows: {
    '': {
      axis: 'row',
      key: '',
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: true,
    },
    A: {
      axis: 'row',
      key: serializePath(['A']),
      path: ['A'],
      label: 'A',
      formattedLabel: 'A',
      level: 1,
      hasChildren: true,
    },
  },
  cols: {
    '': {
      axis: 'col',
      key: '',
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: true,
    },
  },
  cells: {
    [`${serializePath(['A'])}|`]: {
      rowKey: serializePath(['A']),
      colKey: '',
      values: { m1: 10 },
    },
  },
};

describe('applyMetricAxis', () => {
  it('preserves dimension nodes when metrics are inserted at the front of rows', () => {
    const result = applyMetricAxis(
      baseTree,
      ['m1'],
      MetricsLayoutEnum.ROWS,
      ['r1'],
      [],
      0,
    );

    expect(result.rows[serializePath(['A'])]).toBeDefined();
    expect(result.rows[serializePath(['m1'])]).toBeDefined();
  });

  it('preserves dimension nodes when metrics are inserted at the front of columns', () => {
    const result = applyMetricAxis(
      baseTree,
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
      0,
    );

    expect(result.cols[serializePath([])]).toBeDefined();
    expect(result.cols[serializePath(['m1'])]).toBeDefined();
  });

  it('surfaces single metric values on the base column when the metric is first', () => {
    const tree = {
      rows: {
        '': {
          axis: 'row',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        A: {
          axis: 'row',
          key: serializePath(['A']),
          path: ['A'],
          label: 'A',
          formattedLabel: 'A',
          level: 1,
          hasChildren: false,
        },
      },
      cols: {
        '': {
          axis: 'col',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        AUTO: {
          axis: 'col',
          key: serializePath(['AUTO']),
          path: ['AUTO'],
          label: 'AUTO',
          formattedLabel: 'AUTO',
          level: 1,
          hasChildren: false,
        },
      },
      cells: {
        [`${serializePath(['A'])}|${serializePath(['AUTO'])}`]: {
          rowKey: serializePath(['A']),
          colKey: serializePath(['AUTO']),
          values: { m1: 10 },
        },
      },
    } as PivotTreeData;

    const withMetrics = applyMetricAxis(
      tree,
      ['m1'],
      MetricsLayoutEnum.COLUMNS,
      ['r1'],
      ['c1'],
      0,
    );

    expect(withMetrics.cells['A|AUTO']?.values.m1).toBe(10);
    expect(withMetrics.cells['A|']?.values.m1).toBe(10);
  });

  it('surfaces single metric values at the base row when the metric is not first', () => {
    const tree = {
      rows: {
        '': {
          axis: 'row',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        USA: {
          axis: 'row',
          key: serializePath(['USA']),
          path: ['USA'],
          label: 'USA',
          formattedLabel: 'USA',
          level: 1,
          hasChildren: true,
        },
      },
      cols: {
        '': {
          axis: 'col',
          key: '',
          path: [],
          label: 'Total',
          formattedLabel: 'Total',
          level: 0,
          hasChildren: true,
        },
        BUILDING: {
          axis: 'col',
          key: serializePath(['BUILDING']),
          path: ['BUILDING'],
          label: 'BUILDING',
          formattedLabel: 'BUILDING',
          level: 1,
          hasChildren: false,
        },
      },
      cells: {
        [`${serializePath(['USA'])}|${serializePath(['BUILDING'])}`]: {
          rowKey: serializePath(['USA']),
          colKey: serializePath(['BUILDING']),
          values: { countCustomers: 10 },
        },
      },
    } as PivotTreeData;

    const withMetrics = applyMetricAxis(
      tree,
      ['countCustomers'],
      MetricsLayoutEnum.ROWS,
      ['nation', 'orderPriority'],
      ['segment'],
      1,
    );

    expect(withMetrics.cells['USA|BUILDING']?.values.countCustomers).toBe(10);
    expect(
      withMetrics.cells['USA__countCustomers|BUILDING']?.values.countCustomers,
    ).toBe(10);
  });
});
