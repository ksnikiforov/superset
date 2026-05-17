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
import { isMetricTokenForKeys } from '../core/tokens';
import { buildLayoutContext } from '../layout/LayoutContext';
import { getValuesLevelIndex } from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';
import type { RenderModelConfig } from '../render/renderModel';
import {
  createMetricNodePolicy,
  getMetricLabelFromPath as getMetricLabelFromPathBase,
  isExplicitSubtotalNode,
} from '../metricsTotals';
import { pruneStaleCollapsedAxis } from './pruneCollapsedAxis';
import {
  buildMetricOrderComparator,
  resolveAxisChildrenBeforeSubtotalPolicy,
  resolveCollapsedValuesNodesForAxis,
  resolveMetricAxisLayoutPolicy,
  resolveRowSubtotalChildrenPolicy,
} from './layoutRuntime';

const defaultPivotNodeSorter = () => 0;
const EMPTY_SUBTOTAL_LEVELS: number[] = [];

export type PivotLayoutResult = {
  layout: ReturnType<typeof buildLayoutContext>;
  measureHierarchy: MeasureHierarchy;
  expandedStateSignature: string;
  expandedStateSharedSignature: string;
  expandRowsLevelRaw?: number;
  expandColumnsLevelRaw?: number;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  resolvedColTotalPosition: TotalPosition;
  effectiveRowSubtotalPosition: TotalPosition;
  hideMetricHeaderOnRows: boolean;
  compareMetricOrder: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getMetricLabelFromPath: (path: PivotTreeNode['path']) => string | undefined;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
  isExplicitSubtotalNode: (node?: PivotTreeNode) => boolean;
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
  pruneMergedTree: (params: {
    axis: 'row' | 'col';
    tree: PivotTreeData;
    parent?: PivotTreeNode;
    branch?: PivotTreeData;
  }) => PivotTreeData;
};

export const usePivotLayout = ({
  formData,
  pivotProgram,
}: {
  formData: PivotTableProps['formData'];
  pivotProgram?: PivotProgram;
}): PivotLayoutResult => {
  const expandRowsLevelRaw = formData.expandRowsLevel;
  const expandColumnsLevelRaw = formData.expandColumnsLevel;
  const metricsLayout =
    (formData.metricsLayout as MetricsLayoutEnum) || MetricsLayoutEnum.COLUMNS;
  const startCollapsed = formData.startCollapsed ?? true;
  const initialDepth = formData.initialDepth ?? 1;
  const rowTotals = formData.rowTotals ?? false;
  const colTotals = formData.colTotals ?? true;
  const rowSubTotals = formData.rowSubTotals ?? false;
  const rowSubtotalLevels = formData.rowSubtotalLevels ?? EMPTY_SUBTOTAL_LEVELS;
  const colSubtotalLevels = formData.colSubtotalLevels ?? EMPTY_SUBTOTAL_LEVELS;
  const rowTotalPosition = formData.rowTotalPosition ?? 'start';
  const rowSubtotalPosition = formData.rowSubtotalPosition ?? 'start';
  const colTotalPosition = formData.colTotalPosition ?? 'start';
  const colSubtotalPosition = formData.colSubtotalPosition ?? 'start';

  const layout = useMemo(
    () =>
      buildLayoutContext({
        groupbyRows: formData.groupbyRows,
        groupbyColumns: formData.groupbyColumns,
        metrics: formData.metrics,
        measureLeavesByMetric: formData.measureLeavesByMetric,
        verboseMap: formData.verboseMap,
        metricsLayout,
        rowTotals,
        colTotals,
        rowSubTotals,
        rowSubtotalLevels,
        colSubtotalLevels,
        rowTotalPosition,
        rowSubtotalPosition,
        colTotalPosition,
        colSubtotalPosition,
        startCollapsed,
        initialDepth,
        expandRowsLevel: expandRowsLevelRaw,
        expandColumnsLevel: expandColumnsLevelRaw,
        pivotProgram,
      }),
    [
      colSubtotalLevels,
      colSubtotalPosition,
      colTotalPosition,
      colTotals,
      expandColumnsLevelRaw,
      expandRowsLevelRaw,
      formData,
      initialDepth,
      metricsLayout,
      pivotProgram,
      rowSubtotalLevels,
      rowSubtotalPosition,
      rowTotalPosition,
      rowTotals,
      rowSubTotals,
      startCollapsed,
    ],
  );
  const isLeafTierVisible =
    layout.measureHierarchy.kind === 'measureStackV1' &&
    layout.measureHierarchy.leafTierVisibility === 'visible';

  const {
    resolvedExpandRowsLevel,
    resolvedExpandColsLevel: resolvedExpandColumnsLevel,
    metricLabelMap,
    metrics,
  } = layout;
  const { metricsLayoutResolved: resolvedMetricsLayout, metricInsertIndex } =
    layout.pivotProgram;
  const { metricKeys: metricLabels } = layout.pivotProgram;
  const metricNodePolicy = useMemo(
    () => createMetricNodePolicy(layout.pivotProgram),
    [layout.pivotProgram],
  );
  const { metricLabelSet, isMetricGrandTotalNode, isMetricSubtotalNode } =
    metricNodePolicy;
  const metricVerboseMap = formData.verboseMap as
    | Record<string, string>
    | undefined;

  const isMultiMetric = metricLabels.length > 1;
  const hasMultipleMeasures =
    isMultiMetric ||
    (layout.measureHierarchy.kind === 'measureStackV1' &&
      layout.measureHierarchy.groups.some(group => group.leaves.length > 1));

  const normalizedRowSubtotalLevels = layout.rowSubtotalLevels;
  const normalizedColSubtotalLevels = useMemo(() => {
    if (rowTotals && !layout.colSubtotalLevels.includes(0)) {
      return [0, ...layout.colSubtotalLevels];
    }
    return layout.colSubtotalLevels;
  }, [layout.colSubtotalLevels, rowTotals]);

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
      rowTotals,
      colTotals,
      rowSubTotals,
      expandRowsLevel: resolvedExpandRowsLevel,
      expandColumnsLevel: resolvedExpandColumnsLevel,
      measureHierarchy: layout.measureHierarchy,
    }),
    [
      colTotals,
      layout.measureHierarchy,
      metricInsertIndex,
      metricLabels,
      normalizedColSubtotalLevels,
      normalizedRowSubtotalLevels,
      resolvedMetricsLayout,
      resolvedExpandColumnsLevel,
      resolvedExpandRowsLevel,
      rowSubTotals,
      rowTotals,
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
        rowSubTotals,
        resolvedRowSubtotalPosition,
        resolvedColSubtotalPosition,
      }),
    [
      isLeafTierVisible,
      layout.pivotProgram,
      resolvedColSubtotalPosition,
      resolvedRowSubtotalPosition,
      rowSubTotals,
    ],
  );
  const metricIndexOnRows = getValuesLevelIndex(layout.pivotProgram, 'row');

  const getMetricLabelFromPath = useCallback(
    (path: PivotTreeNode['path']) =>
      getMetricLabelFromPathBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const getMetricDisplayLabelForKey = useCallback(
    (metricKey: string) =>
      resolveMetricDisplayLabel(metricKey, {
        metricLabelMap,
        verboseMap: metricVerboseMap,
        metrics,
      }),
    [metricLabelMap, metricVerboseMap, metrics],
  );

  const compareMetricOrder = useMemo(
    () =>
      buildMetricOrderComparator({
        metricKeys: metricLabels,
        measureHierarchy: layout.measureHierarchy,
        getMetricLabelFromPath,
      }),
    [getMetricLabelFromPath, layout.measureHierarchy, metricLabels],
  );

  const getAxisChildrenBeforeSubtotalPolicy = useCallback(
    (params: {
      axis: 'row' | 'col';
      parent: PivotTreeNode;
      nodes: Record<string, PivotTreeNode>;
      hideMetricHeader: boolean;
      keepValuesChild: (
        child: PivotTreeNode,
        hasNonValuesChildren: boolean,
      ) => boolean;
    }) =>
      resolveAxisChildrenBeforeSubtotalPolicy({
        ...params,
        program: layout.pivotProgram,
      }),
    [layout.pivotProgram],
  );

  const getRowSubtotalPosition = useCallback(
    (node: PivotTreeNode) => {
      if (!forceRowSubtotalEnd) {
        return resolvedRowSubtotalPosition;
      }
      const metricIndex = node.path.findIndex(val =>
        isMetricTokenForKeys(val, metricLabelSet),
      );
      return metricIndex >= 0 && node.path.length > metricIndex + 1
        ? resolvedRowSubtotalPosition
        : 'end';
    },
    [forceRowSubtotalEnd, metricLabelSet, resolvedRowSubtotalPosition],
  );

  const getCollapsedValuesNodesForAxis = useCallback(
    (params: {
      axis: 'row' | 'col';
      parent: PivotTreeNode;
      expandedSet: Set<string>;
      nodes: Record<string, PivotTreeNode>;
      suppressSubtotalParent: boolean;
      normalizeSubtotalExisting: boolean;
    }) =>
      resolveCollapsedValuesNodesForAxis({
        ...params,
        program: layout.pivotProgram,
        isLeafTierVisible,
      }),
    [isLeafTierVisible, layout.pivotProgram],
  );

  const getCollapsedChildrenForAxis = useCallback(
    (
      axis: 'row' | 'col',
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      const isRow = axis === 'row';
      return getCollapsedValuesNodesForAxis({
        axis,
        parent,
        expandedSet,
        nodes,
        suppressSubtotalParent: isRow,
        normalizeSubtotalExisting: !isRow,
      });
    },
    [getCollapsedValuesNodesForAxis],
  );

  const getRowChildrenForNodes = useCallback(
    (parent: PivotTreeNode, nodes: Record<string, PivotTreeNode>) => {
      const rowSubtotalPositionForParent = getRowSubtotalPosition(parent);
      const filtered = getAxisChildrenBeforeSubtotalPolicy({
        axis: 'row',
        parent,
        nodes,
        hideMetricHeader: hideMetricHeaderOnRows,
        keepValuesChild: (child, hasNonMetricChildren) => {
          if (!hasNonMetricChildren) {
            return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
          }
          return (
            isMetricGrandTotalNode(child) &&
            (colTotals ||
              metricIndexOnRows === undefined ||
              parent.level >= metricIndexOnRows ||
              metricIndexOnRows !== 0)
          );
        },
      });
      return resolveRowSubtotalChildrenPolicy({
        program: layout.pivotProgram,
        children: filtered,
        parent,
        nodes,
        rowSubTotals,
        rowSubtotalPositionForParent,
        hideMetricHeaderOnRows,
      });
    },
    [
      colTotals,
      getAxisChildrenBeforeSubtotalPolicy,
      getRowSubtotalPosition,
      hideMetricHeaderOnRows,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      layout.pivotProgram,
      metricIndexOnRows,
      rowSubTotals,
    ],
  );

  const getColChildrenForNodes = useCallback(
    (parent: PivotTreeNode, nodes: Record<string, PivotTreeNode>) =>
      getAxisChildrenBeforeSubtotalPolicy({
        axis: 'col',
        parent,
        nodes,
        hideMetricHeader: hideMetricHeaderOnCols,
        keepValuesChild: child =>
          isMetricGrandTotalNode(child) ||
          (normalizedColSubtotalLevels.length > 0 &&
            isMetricSubtotalNode(child)),
      }),
    [
      getAxisChildrenBeforeSubtotalPolicy,
      hideMetricHeaderOnCols,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      normalizedColSubtotalLevels.length,
    ],
  );

  const pruneMergedTree = useCallback(
    ({
      axis,
      tree: nextTree,
      parent,
      branch,
    }: {
      axis: 'row' | 'col';
      tree: PivotTreeData;
      parent?: PivotTreeNode;
      branch?: PivotTreeData;
    }) => {
      if (!parent || !branch) {
        return nextTree;
      }
      return pruneStaleCollapsedAxis({
        currentTree: nextTree,
        axis,
        parent,
        branch,
        program: layout.pivotProgram,
      });
    },
    [layout.pivotProgram],
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
      getRowChildren: parent => getRowChildrenForNodes(parent, tree.rows),
      getCollapsedRowChildren: parent =>
        getCollapsedChildrenForAxis('row', parent, expandedRows, tree.rows),
      getColChildren: parent => getColChildrenForNodes(parent, tree.cols),
      getCollapsedColLeaves: parent =>
        getCollapsedChildrenForAxis('col', parent, expandedCols, tree.cols),
      getColumnDisplayPath,
      getColumnHeaderLabel,
    }),
    [
      effectiveColSubtotalPosition,
      getColChildrenForNodes,
      getCollapsedChildrenForAxis,
      getRowChildrenForNodes,
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
    expandRowsLevelRaw,
    expandColumnsLevelRaw,
    resolvedExpandRowsLevel,
    resolvedExpandColumnsLevel,
    normalizedRowSubtotalLevels,
    normalizedColSubtotalLevels,
    resolvedColTotalPosition,
    effectiveRowSubtotalPosition,
    hideMetricHeaderOnRows,
    compareMetricOrder,
    getMetricLabelFromPath,
    getMetricDisplayLabelForKey,
    isExplicitSubtotalNode,
    getRowSubtotalPosition,
    buildRenderModelConfig,
    pruneMergedTree,
  };
};
