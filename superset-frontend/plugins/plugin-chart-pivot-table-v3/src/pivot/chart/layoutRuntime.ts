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
  MetricsLayoutEnum,
  type PivotAxis,
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import { isMetricsPlaceholder, isSubtotalToken } from '../../utils';
import {
  getMetricIndexFromNodes,
  getNonMetricPathParts,
} from '../metricsTotals';
import {
  resolveAxisChildProjection,
  resolveAxisProjection,
} from '../runtime/projection';
import { type PivotProgram } from '../runtime/types';
import { findChildren } from '../viewModel';

type ResolveMetricAxisLayoutParams = {
  rows: PivotTreeData['rows'];
  cols: PivotTreeData['cols'];
  formGroupbyRows: PivotTableProps['formData']['groupbyRows'];
  formGroupbyColumns: PivotTableProps['formData']['groupbyColumns'];
  groupbyColumnsLength: number;
  metricsCount: number;
  metricLabelCount: number;
  rowDimCount: number;
  colDimCount: number;
  metricInsertIndex: number;
  resolvedMetricsLayout: MetricsLayoutEnum;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  metricLabelSet: Set<string>;
  isMetricTokenValue: (value: unknown) => boolean;
  isLeafTierVisible: boolean;
  rowSubTotals: boolean;
  resolvedRowSubtotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
};

export type MetricAxisLayoutPolicy = {
  metricInsertIndexOnRows?: number;
  metricInsertIndexOnCols?: number;
  singleMetricBetweenRows: boolean;
  singleMetricBetweenCols: boolean;
  shouldExpandMetricRows: boolean;
  shouldExpandMetricCols: boolean;
  maxColDimDepth: number;
  metricIndexOnRows?: number;
  metricIndexOnCols?: number;
  metricIntentIndexOnRows?: number;
  metricIntentIndexOnCols?: number;
  metricLayoutIndexOnRows?: number;
  metricLayoutIndexOnCols?: number;
  metricsAtRowEnd: boolean;
  metricsAtColEnd: boolean;
  metricsFirstOnRows: boolean;
  metricsFirstOnCols: boolean;
  forceRowSubtotalEnd: boolean;
  effectiveRowSubtotalPosition: TotalPosition;
  forceColSubtotalEnd: boolean;
  effectiveColSubtotalPosition: TotalPosition;
  hideMetricHeaderOnRows: boolean;
  hideMetricHeaderOnCols: boolean;
};

export const resolveMetricAxisLayoutPolicy = ({
  rows,
  cols,
  formGroupbyRows,
  formGroupbyColumns,
  groupbyColumnsLength,
  metricsCount,
  metricLabelCount,
  rowDimCount,
  colDimCount,
  metricInsertIndex,
  resolvedMetricsLayout,
  resolvedExpandRowsLevel,
  resolvedExpandColumnsLevel,
  metricLabelSet,
  isMetricTokenValue,
  isLeafTierVisible,
  rowSubTotals,
  resolvedRowSubtotalPosition,
  resolvedColSubtotalPosition,
}: ResolveMetricAxisLayoutParams): MetricAxisLayoutPolicy => {
  const isSingleMetric = metricLabelCount === 1;
  const isMultiMetric = metricLabelCount > 1;
  const metricInsertIndexOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS && metricsCount > 0
      ? Math.min(metricInsertIndex, rowDimCount)
      : undefined;
  const metricInsertIndexOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS && metricsCount > 0
      ? Math.min(metricInsertIndex, colDimCount)
      : undefined;
  const singleMetricBetweenRows =
    isSingleMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricInsertIndexOnRows !== undefined &&
    metricInsertIndexOnRows > 0 &&
    metricInsertIndexOnRows < rowDimCount;
  const singleMetricBetweenCols =
    isSingleMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndexOnCols !== undefined &&
    metricInsertIndexOnCols > 0 &&
    metricInsertIndexOnCols < colDimCount;

  const shouldExpandMetricRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricsCount > 0 &&
    metricInsertIndex === 0 &&
    resolvedExpandRowsLevel > 0;
  const shouldExpandMetricCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricsCount > 0 &&
    metricInsertIndex === 0 &&
    resolvedExpandColumnsLevel > 0;

  const maxColDimDepth = Object.values(cols).reduce(
    (max, node) =>
      Math.max(max, getNonMetricPathParts(node.path, metricLabelSet).length),
    0,
  );

  const metricIndexOnRows =
    getMetricIndexFromNodes({
      nodes: rows,
      isMetricTokenValue,
    }) ?? metricInsertIndexOnRows;
  const metricIndexOnCols =
    getMetricIndexFromNodes({
      nodes: cols,
      isMetricTokenValue,
    }) ?? metricInsertIndexOnCols;
  const metricIntentIndexOnRows = metricInsertIndexOnRows ?? metricIndexOnRows;
  const metricIntentIndexOnCols = metricInsertIndexOnCols ?? metricIndexOnCols;

  const formRowsHasPlaceholder =
    Array.isArray(formGroupbyRows) &&
    formGroupbyRows.some(isMetricsPlaceholder);
  const formColsHasPlaceholder =
    Array.isArray(formGroupbyColumns) &&
    formGroupbyColumns.some(isMetricsPlaceholder);
  const metricLayoutIndexOnRows = formRowsHasPlaceholder
    ? (metricInsertIndexOnRows ?? metricIndexOnRows)
    : metricIndexOnRows;
  const metricLayoutIndexOnCols = formColsHasPlaceholder
    ? (metricInsertIndexOnCols ?? metricIndexOnCols)
    : metricIndexOnCols !== undefined && maxColDimDepth < groupbyColumnsLength
      ? groupbyColumnsLength
      : metricIndexOnCols;

  const metricsAtRowEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricInsertIndexOnRows !== undefined &&
    metricInsertIndexOnRows >= rowDimCount;
  const metricsAtColEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndexOnCols !== undefined &&
    metricInsertIndexOnCols >= colDimCount;
  const metricsFirstOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS && metricIndexOnRows === 0;
  const metricsFirstOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricIndexOnCols === 0;

  const forceRowSubtotalEnd =
    rowSubTotals &&
    isMultiMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    !metricsFirstOnRows;
  const effectiveRowSubtotalPosition = forceRowSubtotalEnd
    ? 'end'
    : resolvedRowSubtotalPosition;
  const forceColSubtotalEnd =
    isMultiMetric && resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS;
  const effectiveColSubtotalPosition = forceColSubtotalEnd
    ? 'end'
    : resolvedColSubtotalPosition;

  const hideMetricHeaderOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    !isLeafTierVisible &&
    isSingleMetric &&
    metricIndexOnRows === rowDimCount &&
    rowDimCount > 0;
  const hideMetricHeaderOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    !isLeafTierVisible &&
    isSingleMetric &&
    metricIndexOnCols === colDimCount &&
    colDimCount > 0;

  return {
    metricInsertIndexOnRows,
    metricInsertIndexOnCols,
    singleMetricBetweenRows,
    singleMetricBetweenCols,
    shouldExpandMetricRows,
    shouldExpandMetricCols,
    maxColDimDepth,
    metricIndexOnRows,
    metricIndexOnCols,
    metricIntentIndexOnRows,
    metricIntentIndexOnCols,
    metricLayoutIndexOnRows,
    metricLayoutIndexOnCols,
    metricsAtRowEnd,
    metricsAtColEnd,
    metricsFirstOnRows,
    metricsFirstOnCols,
    forceRowSubtotalEnd,
    effectiveRowSubtotalPosition,
    forceColSubtotalEnd,
    effectiveColSubtotalPosition,
    hideMetricHeaderOnRows,
    hideMetricHeaderOnCols,
  };
};

type ResolveAxisChildrenBeforeSubtotalPolicyParams = {
  program: PivotProgram;
  resolvedMetricsLayout: MetricsLayoutEnum;
  axis: PivotAxis;
  parent: PivotTreeNode;
  nodes: Record<string, PivotTreeNode>;
  metricIndex?: number;
  metricLayoutIndex?: number;
  groupbyLength: number;
  hideMetricHeader: boolean;
  metricsFirst: boolean;
  isMetricTokenValue: (value: unknown) => boolean;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  keepValuesChild: (
    child: PivotTreeNode,
    hasNonValuesChildren: boolean,
  ) => boolean;
};

export const resolveAxisChildrenBeforeSubtotalPolicy = ({
  program,
  resolvedMetricsLayout,
  axis,
  parent,
  nodes,
  metricIndex,
  metricLayoutIndex,
  groupbyLength,
  hideMetricHeader,
  metricsFirst,
  isMetricTokenValue,
  isMetricGrandTotalNode,
  keepValuesChild,
}: ResolveAxisChildrenBeforeSubtotalPolicyParams): PivotTreeNode[] => {
  const children = findChildren(nodes, parent);
  const getChildProjection = (child: PivotTreeNode) =>
    resolveAxisChildProjection({
      program,
      axis,
      parentPath: parent.path,
      childPath: child.path,
    });
  const { valuesLevelSeen } = resolveAxisProjection({
    program,
    axis,
    path: parent.path.filter(val => !isSubtotalToken(val)),
  });
  let filtered =
    valuesLevelSeen || metricIndex === undefined
      ? children
      : children.filter(
          child =>
            child.path.length <= metricIndex ||
            getChildProjection(child).rawValuesTokenIndex === metricIndex,
        );
  const expectedMetricsLayout =
    axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;
  if (
    resolvedMetricsLayout === expectedMetricsLayout &&
    parent.axis === axis &&
    parent.level < groupbyLength &&
    (metricLayoutIndex === undefined || metricLayoutIndex > parent.level)
  ) {
    const projected = children.map(child => ({
      child,
      introducesValues: getChildProjection(child).introducesValues,
    }));
    const hasNonValuesChildren = projected.some(
      child => !child.introducesValues,
    );
    const withoutMetrics = projected
      .filter(
        ({ child, introducesValues }) =>
          !introducesValues || keepValuesChild(child, hasNonValuesChildren),
      )
      .map(({ child }) => child);
    filtered = withoutMetrics.length > 0 ? withoutMetrics : children;
  }
  if (
    hideMetricHeader &&
    parent.axis === axis &&
    parent.level >= groupbyLength
  ) {
    filtered = filtered.filter(
      child => !isMetricTokenValue(child.path[parent.level]),
    );
  }
  if (metricsFirst) {
    filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
  }
  return filtered;
};
