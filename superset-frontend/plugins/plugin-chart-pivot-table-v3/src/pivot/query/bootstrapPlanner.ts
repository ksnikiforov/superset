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
import { type QueryFormColumn } from '@superset-ui/core';
import { type PivotTableQueryFormData } from '../../types';
import { hasTotalSorting } from '../../utils';
import { type LayoutContext } from '../layout/LayoutContext';
import { type QueryIntent } from './queryShape';
import {
  buildFactCoverage,
  buildVisibleFactCoverage,
} from '../runtime/coverage';
import { type PivotFactCoverage } from '../runtime/types';

export type BootstrapTargetKind = 'totals' | 'grid' | 'rows' | 'cols';

export type BootstrapTarget = {
  kind: BootstrapTargetKind;
  intent: QueryIntent;
  coverage: PivotFactCoverage;
};

export type BootstrapPlan = {
  targets: BootstrapTarget[];
};

type BootstrapPlanOptions = {
  prefetchRoot?: boolean;
};

type BuildIntentInput = {
  kind: BootstrapTargetKind;
  targetRowDepth: number;
  targetColDepth: number;
  needsTotals: boolean;
  needsMetricFormatting: boolean;
  needsDatabars: boolean;
  needsRowOrdering: boolean;
  needsColOrdering: boolean;
  needsRowDimensionFormatting: boolean;
  needsColDimensionFormatting: boolean;
};

type CoverageTargetInput = Omit<
  BuildIntentInput,
  'kind' | 'targetRowDepth' | 'targetColDepth'
> & {
  layout: LayoutContext;
  kind: Exclude<BootstrapTargetKind, 'totals'>;
  rowDepth: number;
  colDepth: number;
};

const buildIntent = ({
  kind,
  targetRowDepth,
  targetColDepth,
  needsTotals,
  needsMetricFormatting,
  needsDatabars,
  needsRowOrdering,
  needsColOrdering,
  needsRowDimensionFormatting,
  needsColDimensionFormatting,
}: BuildIntentInput): QueryIntent => ({
  kind: kind === 'totals' ? 'totalsOnly' : 'wholeLevel',
  targetRowDepth,
  targetColDepth,
  needsValueCells: kind !== 'totals',
  needsTotals,
  needsMetricFormatting,
  needsDatabars: kind === 'totals' ? false : needsDatabars,
  needsRowOrdering,
  needsColOrdering,
  needsRowDimensionFormatting,
  needsColDimensionFormatting,
});

const firstVisibleDepth = (groupby: QueryFormColumn[]) =>
  groupby.length > 0 ? 1 : 0;

const buildCoverageTarget = ({
  layout,
  kind,
  rowDepth,
  colDepth,
  ...intentFlags
}: CoverageTargetInput): BootstrapTarget | undefined => {
  const [coverage] = buildVisibleFactCoverage({
    program: layout.pivotProgram,
    rowDepth,
    columnDepth: colDepth,
    reason: 'initial',
  });

  if (!coverage) {
    return undefined;
  }

  return {
    kind,
    coverage,
    intent: buildIntent({
      kind,
      targetRowDepth: coverage.rowDepth,
      targetColDepth: coverage.columnDepth,
      ...intentFlags,
    }),
  };
};

export function buildBootstrapPlanFromLayout(
  layout: LayoutContext,
  formData: PivotTableQueryFormData,
  options: BootstrapPlanOptions = {},
): BootstrapPlan {
  const { groupbyRows: rowGroupby, groupbyColumns: colGroupby } = layout;
  const { rowSubtotalLevels, colSubtotalLevelsForQuery: colSubtotalLevels } =
    layout;
  const needsTotals =
    layout.rowTotals ||
    layout.colTotals ||
    rowSubtotalLevels.length > 0 ||
    colSubtotalLevels.length > 0;
  const needsMetricFormatting =
    Object.keys(formData.metricFormatting || {}).length > 0;
  const needsDatabars = Object.keys(formData.metricDatabars || {}).length > 0;
  const needsRowOrdering = Object.keys(formData.rowSorting || {}).length > 0;
  const needsColOrdering = Object.keys(formData.colSorting || {}).length > 0;
  const needsRowDimensionFormatting =
    Object.keys(formData.rowFormatting || {}).length > 0;
  const needsColDimensionFormatting =
    Object.keys(formData.colFormatting || {}).length > 0;
  const needsRowTotals =
    rowGroupby.length > 0 &&
    (layout.rowTotals ||
      rowSubtotalLevels.length > 0 ||
      hasTotalSorting(formData.rowSorting, rowGroupby));
  const needsColTotals =
    colGroupby.length > 0 &&
    (layout.colTotals ||
      colSubtotalLevels.length > 0 ||
      hasTotalSorting(formData.colSorting, colGroupby));
  const firstRowDepth = firstVisibleDepth(rowGroupby);
  const firstColDepth = firstVisibleDepth(colGroupby);
  const needsGrid = firstRowDepth > 0 && firstColDepth > 0;

  const targets: BootstrapTarget[] = [
    {
      kind: 'totals',
      coverage: buildFactCoverage({
        reason: 'initial',
        rowDimensions: layout.pivotProgram.rowDimensions,
        columnDimensions: layout.pivotProgram.columnDimensions,
        rowDepth: 0,
        columnDepth: 0,
      }),
      intent: buildIntent({
        kind: 'totals',
        targetRowDepth: 0,
        targetColDepth: 0,
        needsTotals,
        needsMetricFormatting,
        needsDatabars,
        needsRowOrdering: false,
        needsColOrdering: false,
        needsRowDimensionFormatting: false,
        needsColDimensionFormatting: false,
      }),
    },
  ];

  if (needsGrid) {
    const target = buildCoverageTarget({
      layout,
      kind: 'grid',
      rowDepth: firstRowDepth,
      colDepth: firstColDepth,
      needsTotals: false,
      needsMetricFormatting,
      needsDatabars,
      needsRowOrdering,
      needsColOrdering,
      needsRowDimensionFormatting,
      needsColDimensionFormatting,
    });
    if (target) {
      targets.push(target);
    }
  }

  if (rowGroupby.length > 0 && (!needsGrid || needsRowTotals)) {
    const target = buildCoverageTarget({
      layout,
      kind: 'rows',
      rowDepth: firstRowDepth,
      colDepth: 0,
      needsTotals,
      needsMetricFormatting,
      needsDatabars,
      needsRowOrdering,
      needsColOrdering: false,
      needsRowDimensionFormatting,
      needsColDimensionFormatting: false,
    });
    if (target) {
      targets.push(target);
    }
  }

  if (colGroupby.length > 0 && (!needsGrid || needsColTotals)) {
    const target = buildCoverageTarget({
      layout,
      kind: 'cols',
      rowDepth: 0,
      colDepth: firstColDepth,
      needsTotals,
      needsMetricFormatting,
      needsDatabars,
      needsRowOrdering: false,
      needsColOrdering,
      needsRowDimensionFormatting: false,
      needsColDimensionFormatting,
    });
    if (target) {
      targets.push(target);
    }
  }

  return {
    targets: options.prefetchRoot ? targets.slice(0, 1) : targets,
  };
}
