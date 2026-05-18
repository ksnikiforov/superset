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
import { useCallback, useMemo } from 'react';
import {
  MetricsLayoutEnum,
  MeasureHierarchy,
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import { resolveMetricDisplayLabel, getStableColumnKey } from '../../utils';
import { decodeMetricKey } from '../core/tokens';
import { buildLayoutContext } from '../layout/LayoutContext';
import type { PivotProgram } from '../runtime/types';
import type { RenderModelConfig } from '../render/renderModel';
import {
  buildMetricOrderComparator,
  resolveAxisChildrenBeforeSubtotalPolicy,
  resolveCollapsedValuesNodesForAxis,
  resolveMetricAxisLayoutPolicy,
  resolveRowSubtotalChildrenPolicy,
} from './layoutRuntime';

const defaultPivotNodeSorter = () => 0;

export type PivotLayoutResult = {
  layout: ReturnType<typeof buildLayoutContext>;
  measureHierarchy: MeasureHierarchy;
  expandedStateSignature: string;
  expandedStateSharedSignature: string;
  axisCoverageNeeds: ReturnType<typeof buildLayoutContext>['axisCoverageNeeds'];
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  resolvedColTotalPosition: TotalPosition;
  effectiveRowSubtotalPosition: TotalPosition;
  hideMetricHeaderOnRows: boolean;
  compareMetricOrder: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
  getRowSubtotalPosition: (node: PivotTreeNode) => TotalPosition;
  buildRenderModelConfig: (params: {
    tree: PivotTreeData;
    expandedRows: Set<string>;
    expandedCols: Set<string>;
    rowTotals?: boolean;
    colTotals?: boolean;
    rowSorter?: (a: PivotTreeNode, b: PivotTreeNode) => number;
    colSorter?: (a: PivotTreeNode, b: PivotTreeNode) => number;
    getColumnDisplayPath?: (
      col: PivotTreeNode,
      maxDepth: number,
    ) => PivotTreeNode['path'];
    getColumnHeaderLabel?: (value: unknown) => string;
  }) => RenderModelConfig;
};

export const usePivotLayout = ({
  formData,
  pivotProgram,
}: {
  formData: PivotTableProps['formData'];
  pivotProgram?: PivotProgram;
}): PivotLayoutResult => {
  const layout = useMemo(
    () =>
      buildLayoutContext({
        ...formData,
        metricsLayout:
          (formData.metricsLayout as MetricsLayoutEnum) ||
          MetricsLayoutEnum.COLUMNS,
        colTotals: formData.colTotals ?? true,
        rowSubTotals: formData.rowSubTotals ?? false,
        pivotProgram,
      }),
    [formData, pivotProgram],
  );
  const isLeafTierVisible =
    layout.measureHierarchy.leafTierVisibility === 'visible';

  const { metricLabelMap, metrics } = layout;
  const { metricsLayoutResolved: resolvedMetricsLayout, metricInsertIndex } =
    layout.pivotProgram;
  const { axisCoverageNeeds } = layout;
  const { metricKeys: metricLabels } = layout.pivotProgram;
  const isMultiMetric = metricLabels.length > 1;
  const hasMultipleMeasures =
    isMultiMetric ||
    layout.measureHierarchy.groups.some(group => group.leaves.length > 1);

  const normalizedRowSubtotalLevels = layout.rowSubtotalLevels;
  const normalizedColSubtotalLevels = useMemo(() => {
    if (layout.rowTotals && !layout.colSubtotalLevels.includes(0)) {
      return [0, ...layout.colSubtotalLevels];
    }
    return layout.colSubtotalLevels;
  }, [layout.colSubtotalLevels, layout.rowTotals]);

  const groupbyRowKeys = useMemo(
    () => layout.pivotProgram.rowDimensions.map(getStableColumnKey),
    [layout.pivotProgram.rowDimensions],
  );
  const groupbyColumnKeys = useMemo(
    () => layout.pivotProgram.columnDimensions.map(getStableColumnKey),
    [layout.pivotProgram.columnDimensions],
  );

  const expansionStateSharedSignatureData = useMemo(
    () => ({
      metrics: metricLabels,
      metricsLayout: resolvedMetricsLayout,
      metricPosition: metricLabels.length > 0 ? metricInsertIndex : -1,
      rowSubtotalLevels: normalizedRowSubtotalLevels,
      colSubtotalLevels: normalizedColSubtotalLevels,
      rowTotals: layout.rowTotals,
      colTotals: layout.colTotals,
      rowSubTotals: layout.rowSubTotals,
      axisCoverageNeeds,
      measureHierarchy: layout.measureHierarchy,
    }),
    [
      axisCoverageNeeds,
      layout.measureHierarchy,
      layout.colTotals,
      layout.rowSubTotals,
      layout.rowTotals,
      metricInsertIndex,
      metricLabels,
      normalizedColSubtotalLevels,
      normalizedRowSubtotalLevels,
      resolvedMetricsLayout,
    ],
  );
  const expandedStateSignature = useMemo(
    () =>
      JSON.stringify({
        rows: groupbyRowKeys,
        cols: groupbyColumnKeys,
        ...expansionStateSharedSignatureData,
      }),
    [expansionStateSharedSignatureData, groupbyColumnKeys, groupbyRowKeys],
  );
  const expandedStateSharedSignature = useMemo(
    () => JSON.stringify(expansionStateSharedSignatureData),
    [expansionStateSharedSignatureData],
  );

  const resolvedRowTotalPosition = layout.rowTotalPosition;
  const resolvedRowSubtotalPosition = layout.rowSubtotalPosition;
  const resolvedColTotalPosition = layout.colTotalPosition;
  const resolvedColSubtotalPosition = layout.colSubtotalPosition;

  const {
    forceRowSubtotalEnd,
    effectiveRowSubtotalPosition,
    effectiveColSubtotalPosition,
    hideMetricHeaderOnRows,
    hideMetricHeaderOnCols,
  } = useMemo(
    () =>
      resolveMetricAxisLayoutPolicy({
        program: layout.pivotProgram,
        isLeafTierVisible,
        rowSubTotals: layout.rowSubTotals,
        resolvedRowSubtotalPosition,
        resolvedColSubtotalPosition,
      }),
    [
      isLeafTierVisible,
      layout.pivotProgram,
      layout.rowSubTotals,
      resolvedColSubtotalPosition,
      resolvedRowSubtotalPosition,
    ],
  );

  const getMetricDisplayLabelForKey = useCallback(
    (metricKey: string) =>
      resolveMetricDisplayLabel(metricKey, {
        metricLabelMap,
        verboseMap: formData.verboseMap as Record<string, string> | undefined,
        metrics,
      }),
    [formData.verboseMap, metricLabelMap, metrics],
  );

  const compareMetricOrder = useMemo(
    () =>
      buildMetricOrderComparator({
        program: layout.pivotProgram,
        measureHierarchy: layout.measureHierarchy,
      }),
    [layout.measureHierarchy, layout.pivotProgram],
  );

  const getRowSubtotalPosition = useCallback(
    (node: PivotTreeNode) => {
      if (!forceRowSubtotalEnd) {
        return resolvedRowSubtotalPosition;
      }
      const metricKeySet = new Set(layout.pivotProgram.metricKeys);
      const metricIndex = node.path.findIndex(val => {
        const decoded = decodeMetricKey(val);
        return decoded !== undefined && metricKeySet.has(decoded);
      });
      return metricIndex >= 0 && node.path.length > metricIndex + 1
        ? resolvedRowSubtotalPosition
        : 'end';
    },
    [forceRowSubtotalEnd, layout.pivotProgram, resolvedRowSubtotalPosition],
  );

  const getCollapsedChildrenForAxis = useCallback(
    (
      axis: 'row' | 'col',
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) =>
      resolveCollapsedValuesNodesForAxis({
        program: layout.pivotProgram,
        axis,
        parent,
        expandedSet,
        nodes,
        isLeafTierVisible,
      }),
    [isLeafTierVisible, layout.pivotProgram],
  );

  const getAxisChildrenForNodes = useCallback(
    (
      axis: 'row' | 'col',
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      const filtered = resolveAxisChildrenBeforeSubtotalPolicy({
        program: layout.pivotProgram,
        axis,
        parent,
        nodes,
        hideMetricHeader:
          axis === 'row' ? hideMetricHeaderOnRows : hideMetricHeaderOnCols,
        colTotals: axis === 'row' ? layout.colTotals : undefined,
        normalizedColSubtotalLevelCount:
          axis === 'col' ? normalizedColSubtotalLevels.length : undefined,
      });
      if (axis === 'col') {
        return filtered;
      }
      return resolveRowSubtotalChildrenPolicy({
        program: layout.pivotProgram,
        children: filtered,
        parent,
        nodes,
        rowSubTotals: layout.rowSubTotals,
        rowSubtotalPositionForParent: getRowSubtotalPosition(parent),
        hideMetricHeaderOnRows,
      });
    },
    [
      getRowSubtotalPosition,
      hideMetricHeaderOnCols,
      hideMetricHeaderOnRows,
      layout.colTotals,
      layout.pivotProgram,
      layout.rowSubTotals,
      normalizedColSubtotalLevels.length,
    ],
  );

  const buildRenderModelConfig = useCallback(
    ({
      tree,
      expandedRows,
      expandedCols,
      rowTotals: rowTotalsForModel = layout.rowTotals,
      colTotals: colTotalsForModel = layout.colTotals,
      rowSorter = defaultPivotNodeSorter,
      colSorter = defaultPivotNodeSorter,
      getColumnDisplayPath,
      getColumnHeaderLabel,
    }: Parameters<PivotLayoutResult['buildRenderModelConfig']>[0]) => ({
      normalizedRowSubtotalLevels,
      normalizedColSubtotalLevels,
      rowTotals: rowTotalsForModel,
      colTotals: colTotalsForModel,
      rowTotalPosition: resolvedRowTotalPosition,
      colTotalPosition: resolvedColTotalPosition,
      resolvedColSubtotalPosition: effectiveColSubtotalPosition,
      pivotProgram: layout.pivotProgram,
      hasMultipleMeasures,
      rowSorter,
      colSorter,
      getRowChildren: parent =>
        getAxisChildrenForNodes('row', parent, tree.rows),
      getCollapsedRowChildren: parent =>
        getCollapsedChildrenForAxis('row', parent, expandedRows, tree.rows),
      getColChildren: parent =>
        getAxisChildrenForNodes('col', parent, tree.cols),
      getCollapsedColLeaves: parent =>
        getCollapsedChildrenForAxis('col', parent, expandedCols, tree.cols),
      getColumnDisplayPath,
      getColumnHeaderLabel,
    }),
    [
      effectiveColSubtotalPosition,
      getAxisChildrenForNodes,
      getCollapsedChildrenForAxis,
      hasMultipleMeasures,
      layout.colTotals,
      layout.pivotProgram,
      layout.rowTotals,
      normalizedColSubtotalLevels,
      normalizedRowSubtotalLevels,
      resolvedColTotalPosition,
      resolvedRowTotalPosition,
    ],
  );

  return {
    layout,
    measureHierarchy: layout.measureHierarchy,
    expandedStateSignature,
    expandedStateSharedSignature,
    axisCoverageNeeds,
    normalizedRowSubtotalLevels,
    normalizedColSubtotalLevels,
    resolvedColTotalPosition,
    effectiveRowSubtotalPosition,
    hideMetricHeaderOnRows,
    compareMetricOrder,
    getMetricDisplayLabelForKey,
    getRowSubtotalPosition,
    buildRenderModelConfig,
  };
};
