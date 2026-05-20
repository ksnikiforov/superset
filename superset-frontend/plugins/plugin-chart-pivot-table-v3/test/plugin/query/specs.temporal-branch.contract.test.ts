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
import { GenericDataType } from '@superset-ui/core';
import { MetricsLayoutEnum } from '../../../src/types';
import { buildLayoutContext } from '../../../src/pivot/layout/LayoutContext';
import {
  buildExpansionQuerySpecs,
  formatQueryName,
} from '../../../src/pivot/query/specs';
import { serializePath } from '../../../src/pivot/core/path';
import {
  buildAxisExpansionCoverageTarget,
  type BatchGroup,
} from '../../../src/pivot/expansion/planner';
import { buildFormData } from '../fixtures/pivotFormData';

type FilterClause = {
  col?: string;
  op?: string;
  val?: unknown;
};

const findEqFilter = (filters: FilterClause[], column: string) =>
  filters.find(filter => filter.col === column && filter.op === '==');

const assertColumnsUseRawSqlOutput = (columns: unknown[]) => {
  columns.forEach(column => {
    expect(typeof column).toBe('string');
  });
};

const fetchTarget = ({
  layout,
  axis,
  path,
  visibleRowDepth,
  visibleColDepth,
}: {
  layout: ReturnType<typeof buildLayoutContext>;
  axis: 'row' | 'col';
  path: unknown[];
  visibleRowDepth: number;
  visibleColDepth: number;
}) => {
  const pathKey = serializePath(path);
  return {
    axis,
    pathKey,
    coverageTarget: buildAxisExpansionCoverageTarget({
      program: layout.pivotProgram,
      axis,
      pathKey,
      rowDepth: visibleRowDepth,
      columnDepth: visibleColDepth,
    }),
  };
};

describe('temporal branch query specs contract', () => {
  it('buildExpansionQuerySpecs keeps temporal equality filters backend-safe', () => {
    const formData = buildFormData({
      groupbyRows: ['orderYear', 'orderMonth'],
      groupbyColumns: [],
      metrics: ['grossSales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
      rowSubTotals: false,
      time_grain_sqla: 'P1D',
      temporal_columns_lookup: {
        orderYear: true,
        orderMonth: true,
      },
      colTypeMap: {
        orderYear: GenericDataType.Temporal,
        orderMonth: GenericDataType.Temporal,
        grossSales: GenericDataType.Numeric,
      },
    });
    const layout = buildLayoutContext(formData);
    const path = ['1483228800000'];
    const specs = buildExpansionQuerySpecs({
      kind: 'branch',
      formData,
      layout,
      target: fetchTarget({
        layout,
        axis: 'row',
        path,
        visibleRowDepth: 1,
        visibleColDepth: 0,
      }),
    });

    expect(specs.length).toBeGreaterThan(0);
    specs.forEach(spec => {
      assertColumnsUseRawSqlOutput(spec.columns as unknown[]);
      const temporalFilter = findEqFilter(
        spec.filters as FilterClause[],
        'orderYear',
      );
      expect(temporalFilter).toBeDefined();
      expect(temporalFilter?.val).toBe(1483228800000);
      expect(spec.queryName).toBe(
        `${formatQueryName(
          spec.meta.factSelector.coverage.rowDepth,
          spec.meta.factSelector.coverage.columnDepth,
        )}|branch:row:${serializePath(path)}`,
      );
    });
  });

  it('buildExpansionQuerySpecs keeps temporal sibling filters backend-safe', () => {
    const formData = buildFormData({
      groupbyRows: ['orderYear', 'orderMonth'],
      groupbyColumns: [],
      metrics: ['grossSales'],
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      rowTotals: false,
      colTotals: false,
      rowSubTotals: false,
      time_grain_sqla: 'P1D',
      temporal_columns_lookup: {
        orderYear: true,
        orderMonth: true,
      },
      colTypeMap: {
        orderYear: GenericDataType.Temporal,
        orderMonth: GenericDataType.Temporal,
        grossSales: GenericDataType.Numeric,
      },
    });
    const layout = buildLayoutContext(formData);
    const batch: BatchGroup = {
      axis: 'row',
      signature: 'temporal-batch',
      parentPathKey: '',
      siblingValues: ['1483228800000', '1514764800000'],
      targets: [
        {
          axis: 'row',
          pathKey: serializePath(['1483228800000']),
          batchSignature: 'temporal-batch',
          coverageTarget: fetchTarget({
            layout,
            axis: 'row',
            path: ['1483228800000'],
            visibleRowDepth: 0,
            visibleColDepth: 0,
          }).coverageTarget,
        },
        {
          axis: 'row',
          pathKey: serializePath(['1514764800000']),
          batchSignature: 'temporal-batch',
          coverageTarget: fetchTarget({
            layout,
            axis: 'row',
            path: ['1514764800000'],
            visibleRowDepth: 0,
            visibleColDepth: 0,
          }).coverageTarget,
        },
      ],
    };

    const specs = buildExpansionQuerySpecs({
      kind: 'batch',
      formData,
      layout,
      batch,
    });

    expect(specs.length).toBeGreaterThan(0);
    specs.forEach(spec => {
      assertColumnsUseRawSqlOutput(spec.columns as unknown[]);
      const inFilter = (spec.filters as FilterClause[]).find(
        filter => filter.col === 'orderYear' && filter.op === 'IN',
      );
      expect(inFilter).toBeDefined();
      expect(inFilter?.val).toEqual([1483228800000, 1514764800000]);
      expect(spec.queryName).toBe(
        `${formatQueryName(
          spec.meta.factSelector.coverage.rowDepth,
          spec.meta.factSelector.coverage.columnDepth,
        )}|batch:row:|chunk:0`,
      );
    });
  });
});
