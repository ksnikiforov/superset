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
import { getColumnLabel } from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  MeasureHierarchy,
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import {
  resolveMetricDisplayLabel,
  getMetricKey,
  getStableColumnKey,
  isSubtotalToken,
} from '../../utils';
import { buildLayoutContext } from '../layout/LayoutContext';
import {
  countDimDepth as countDimDepthBase,
  getMetricLabelFromPath as getMetricLabelFromPathBase,
  getNonMetricPathParts as getNonMetricPathPartsBase,
  isExplicitSubtotalNode,
  isMetricGrandTotalNode as isMetricGrandTotalNodeBase,
  isMetricSubtotalNode as isMetricSubtotalNodeBase,
} from '../metricsTotals';
import { pruneStaleCollapsedAxis } from './pruneCollapsedAxis';
import {
  buildMetricOrderComparator,
  resolveAxisChildrenBeforeSubtotalPolicy,
  resolveCollapsedValuesNodesForAxis,
  resolveMetricAxisLayoutPolicy,
  resolveRowSubtotalChildrenPolicy,
} from './layoutRuntime';

export type PivotLayoutResult = {
  layout: ReturnType<typeof buildLayoutContext>;
  measureHierarchy: MeasureHierarchy;
  hasMultipleMeasures: boolean;
  expandedStateSignature: string;
  expandedStateSharedSignature: string;
  expandRowsLevelRaw?: number;
  expandColumnsLevelRaw?: number;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  resolvedMetricsLayout: MetricsLayoutEnum;
  metricInsertIndex: number;
  metricLabels: string[];
  metricLabelSet: Set<string>;
  isMetricTokenValue: (value: unknown) => boolean;
  groupbyRowKeys: string[];
  groupbyColumnKeys: string[];
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  resolvedRowTotalPosition: TotalPosition;
  resolvedColTotalPosition: TotalPosition;
  effectiveRowSubtotalPosition: TotalPosition;
  effectiveColSubtotalPosition: TotalPosition;
  metricsFirstOnRows: boolean;
  metricsFirstOnCols: boolean;
  metricIndexOnRows?: number;
  metricIndexOnCols?: number;
  metricLayoutIndexOnRows?: number;
  metricLayoutIndexOnCols?: number;
  metricIntentIndexOnRows?: number;
  metricIntentIndexOnCols?: number;
  hideMetricHeaderOnRows: boolean;
  metricsAtColEnd: boolean;
  shouldExpandMetricRows: boolean;
  shouldExpandMetricCols: boolean;
  compareMetricOrder: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getMetricLabelFromPath: (path: PivotTreeNode['path']) => string | undefined;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
  getNonMetricPathParts: (path: PivotTreeNode['path']) => PivotTreeNode['path'];
  getDimensionKeyForNode: (
    node: PivotTreeNode,
    axis: 'row' | 'col',
  ) => string | undefined;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node?: PivotTreeNode) => boolean;
  isExplicitSubtotalNode: (node?: PivotTreeNode) => boolean;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  countEngineDimDepth: (path: PivotTreeNode['path']) => number;
  getRowSubtotalPosition: (node: PivotTreeNode) => TotalPosition;
  getCollapsedRowChildrenForNodes: (
    parent: PivotTreeNode,
    expandedSet: Set<string>,
    nodes: Record<string, PivotTreeNode>,
  ) => PivotTreeNode[];
  getCollapsedColLeavesForNodes: (
    parent: PivotTreeNode,
    expandedSet: Set<string>,
    nodes: Record<string, PivotTreeNode>,
  ) => PivotTreeNode[];
  getRowChildrenForNodes: (
    parent: PivotTreeNode,
    nodes: Record<string, PivotTreeNode>,
    metricIndexOverride?: number,
  ) => PivotTreeNode[];
  getColChildrenForNodes: (
    parent: PivotTreeNode,
    nodes: Record<string, PivotTreeNode>,
    metricIndexOverride?: number,
  ) => PivotTreeNode[];
  pruneMergedTree: (params: {
    axis: 'row' | 'col';
    tree: PivotTreeData;
    parent?: PivotTreeNode;
    branch?: PivotTreeData;
  }) => PivotTreeData;
};

export const usePivotLayout = ({
  data,
  formData,
  metricsLayout,
  startCollapsed,
  initialDepth,
  expandRowsLevel,
  expandColumnsLevel,
  rowTotals,
  colTotals,
  rowSubTotals,
  rowSubtotalLevels,
  colSubtotalLevels,
  rowTotalPosition,
  rowSubtotalPosition,
  colTotalPosition,
  colSubtotalPosition,
}: {
  data: PivotTableProps['data'];
  formData: PivotTableProps['formData'];
  metricsLayout: MetricsLayoutEnum;
  startCollapsed: boolean;
  initialDepth: number;
  expandRowsLevel?: number;
  expandColumnsLevel?: number;
  rowTotals: boolean;
  colTotals: boolean;
  rowSubTotals: boolean;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  rowTotalPosition: TotalPosition;
  rowSubtotalPosition: TotalPosition;
  colTotalPosition: TotalPosition;
  colSubtotalPosition: TotalPosition;
}): PivotLayoutResult => {
  const expandRowsLevelRaw = expandRowsLevel ?? formData.expandRowsLevel;
  const expandColumnsLevelRaw =
    expandColumnsLevel ?? formData.expandColumnsLevel;

  const layout = useMemo(
    () =>
      buildLayoutContext({
        groupbyRows: formData.groupbyRows,
        groupbyColumns: formData.groupbyColumns,
        metrics: formData.metrics,
        measureLeavesByMetric: formData.measureLeavesByMetric,
        verboseMap: formData.verboseMap,
        metricsLayout:
          (formData.metricsLayout as MetricsLayoutEnum) || metricsLayout,
        rowTotals,
        colTotals,
        rowSubTotals,
        rowSubtotalLevels,
        colSubtotalLevels,
        rowTotalPosition: formData.rowTotalPosition || rowTotalPosition,
        rowSubtotalPosition:
          formData.rowSubtotalPosition || rowSubtotalPosition,
        colTotalPosition: formData.colTotalPosition || colTotalPosition,
        colSubtotalPosition:
          formData.colSubtotalPosition || colSubtotalPosition,
        startCollapsed,
        initialDepth,
        expandRowsLevel: expandRowsLevelRaw,
        expandColumnsLevel: expandColumnsLevelRaw,
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
    metricsLayoutResolved: resolvedMetricsLayout,
    metricInsertIndex,
    metricKeys: metricLabels,
    metricLabelSet,
    metricLabelMap,
    isMetricTokenValue,
    metrics,
  } = layout;
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

  const { groupbyRows, groupbyColumns } = layout;
  const rowDimCount = groupbyRows.length;
  const colDimCount = groupbyColumns.length;

  const groupbyRowKeys = useMemo(
    () => groupbyRows.map(getStableColumnKey),
    [groupbyRows],
  );
  const groupbyColumnKeys = useMemo(
    () => groupbyColumns.map(getStableColumnKey),
    [groupbyColumns],
  );

  const expansionStateSharedSignatureData = useMemo(
    () => ({
      metrics: metrics.map(getMetricKey),
      metricsLayout: resolvedMetricsLayout,
      metricPosition: metrics.length > 0 ? metricInsertIndex : -1,
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
      metrics,
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
    singleMetricBetweenRows,
    singleMetricBetweenCols,
    shouldExpandMetricRows,
    shouldExpandMetricCols,
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
    effectiveColSubtotalPosition,
    hideMetricHeaderOnRows,
    hideMetricHeaderOnCols,
  } = useMemo(
    () =>
      resolveMetricAxisLayoutPolicy({
        rows: data.rows,
        cols: data.cols,
        formGroupbyRows: formData.groupbyRows,
        formGroupbyColumns: formData.groupbyColumns,
        groupbyColumnsLength: groupbyColumns.length,
        metricsCount: metrics.length,
        metricLabelCount: metricLabels.length,
        rowDimCount,
        colDimCount,
        metricInsertIndex: layout.metricInsertIndex,
        resolvedMetricsLayout,
        resolvedExpandRowsLevel,
        resolvedExpandColumnsLevel,
        metricLabelSet,
        isMetricTokenValue,
        isLeafTierVisible,
        rowSubTotals,
        resolvedRowSubtotalPosition,
        resolvedColSubtotalPosition,
      }),
    [
      colDimCount,
      data.cols,
      data.rows,
      formData.groupbyColumns,
      formData.groupbyRows,
      groupbyColumns.length,
      isLeafTierVisible,
      isMetricTokenValue,
      layout.metricInsertIndex,
      metricLabelSet,
      metricLabels.length,
      metrics.length,
      resolvedColSubtotalPosition,
      resolvedExpandColumnsLevel,
      resolvedExpandRowsLevel,
      resolvedMetricsLayout,
      resolvedRowSubtotalPosition,
      rowDimCount,
      rowSubTotals,
    ],
  );

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

  const getNonMetricPathParts = useCallback(
    (path: PivotTreeNode['path']) =>
      getNonMetricPathPartsBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const getDimensionKeyForNode = useCallback(
    (node: PivotTreeNode, axis: 'row' | 'col') => {
      const nonSubtotalParts = getNonMetricPathParts(node.path).filter(
        part => !isSubtotalToken(part),
      );
      const dimensionIndex = nonSubtotalParts.length - 1;
      const dimension =
        axis === 'row'
          ? groupbyRows[dimensionIndex]
          : groupbyColumns[dimensionIndex];
      return dimension ? getColumnLabel(dimension) : undefined;
    },
    [getNonMetricPathParts, groupbyColumns, groupbyRows],
  );

  const isMetricGrandTotalNode = useCallback(
    (node?: PivotTreeNode) =>
      isMetricGrandTotalNodeBase(node, {
        metricLabelSet,
        metricsFirstOnRows,
        metricsFirstOnCols,
      }),
    [metricLabelSet, metricsFirstOnCols, metricsFirstOnRows],
  );

  const isMetricSubtotalNode = useCallback(
    (node?: PivotTreeNode) => isMetricSubtotalNodeBase(node, metricLabelSet),
    [metricLabelSet],
  );

  const countDimDepth = useCallback(
    (path: PivotTreeNode['path']) => countDimDepthBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const countEngineDimDepth = useCallback(
    (path: PivotTreeNode['path']) =>
      countDimDepthBase(
        path.filter(val => !isSubtotalToken(val)),
        metricLabelSet,
      ),
    [metricLabelSet],
  );

  const getAxisChildrenBeforeSubtotalPolicy = useCallback(
    (params: {
      axis: 'row' | 'col';
      parent: PivotTreeNode;
      nodes: Record<string, PivotTreeNode>;
      metricIndex?: number;
      metricLayoutIndex?: number;
      groupbyLength: number;
      hideMetricHeader: boolean;
      metricsFirst: boolean;
      keepValuesChild: (
        child: PivotTreeNode,
        hasNonValuesChildren: boolean,
      ) => boolean;
    }) =>
      resolveAxisChildrenBeforeSubtotalPolicy({
        ...params,
        program: layout.pivotProgram,
        resolvedMetricsLayout,
        isMetricTokenValue,
        isMetricGrandTotalNode,
      }),
    [
      isMetricGrandTotalNode,
      isMetricTokenValue,
      layout.pivotProgram,
      resolvedMetricsLayout,
    ],
  );

  const getRowSubtotalPosition = useCallback(
    (node: PivotTreeNode) => {
      if (!forceRowSubtotalEnd) {
        return resolvedRowSubtotalPosition;
      }
      const metricIndex = node.path.findIndex(val => isMetricTokenValue(val));
      return metricIndex >= 0 && node.path.length > metricIndex + 1
        ? resolvedRowSubtotalPosition
        : 'end';
    },
    [forceRowSubtotalEnd, isMetricTokenValue, resolvedRowSubtotalPosition],
  );

  const getCollapsedValuesNodesForAxis = useCallback(
    (params: {
      axis: 'row' | 'col';
      parent: PivotTreeNode;
      expandedSet: Set<string>;
      nodes: Record<string, PivotTreeNode>;
      exposeCollapsedMetricTier: boolean;
      metricsAtEnd: boolean;
      suppressSubtotalParent: boolean;
      normalizeSubtotalExisting: boolean;
    }) =>
      resolveCollapsedValuesNodesForAxis({
        ...params,
        program: layout.pivotProgram,
        resolvedMetricsLayout,
        metricLabelSet,
        isMetricTokenValue,
        isExplicitSubtotalNode,
        isMetricSubtotalNode,
      }),
    [
      isMetricSubtotalNode,
      isMetricTokenValue,
      layout.pivotProgram,
      metricLabelSet,
      resolvedMetricsLayout,
    ],
  );

  const getCollapsedRowChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) =>
      getCollapsedValuesNodesForAxis({
        axis: 'row',
        parent,
        expandedSet,
        nodes,
        exposeCollapsedMetricTier:
          isMultiMetric ||
          singleMetricBetweenRows ||
          (isLeafTierVisible && metricsAtRowEnd),
        metricsAtEnd: metricsAtRowEnd,
        suppressSubtotalParent: true,
        normalizeSubtotalExisting: false,
      }),
    [
      getCollapsedValuesNodesForAxis,
      isLeafTierVisible,
      isMultiMetric,
      metricsAtRowEnd,
      singleMetricBetweenRows,
    ],
  );

  const getCollapsedColLeavesForNodes = useCallback(
    (
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) =>
      getCollapsedValuesNodesForAxis({
        axis: 'col',
        parent,
        expandedSet,
        nodes,
        exposeCollapsedMetricTier:
          isMultiMetric ||
          singleMetricBetweenCols ||
          (isLeafTierVisible && metricsAtColEnd),
        metricsAtEnd: metricsAtColEnd,
        suppressSubtotalParent: false,
        normalizeSubtotalExisting: true,
      }),
    [
      getCollapsedValuesNodesForAxis,
      isLeafTierVisible,
      isMultiMetric,
      metricsAtColEnd,
      singleMetricBetweenCols,
    ],
  );

  const getRowChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
      metricIndexOverride?: number,
    ) => {
      const rowSubtotalPositionForParent = getRowSubtotalPosition(parent);
      const filtered = getAxisChildrenBeforeSubtotalPolicy({
        axis: 'row',
        parent,
        nodes,
        metricIndex: metricIndexOverride ?? metricIndexOnRows,
        metricLayoutIndex: metricLayoutIndexOnRows,
        groupbyLength: groupbyRows.length,
        hideMetricHeader: hideMetricHeaderOnRows,
        metricsFirst: metricsFirstOnRows,
        keepValuesChild: (child, hasNonMetricChildren) => {
          if (!hasNonMetricChildren) {
            return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
          }
          return (
            isMetricGrandTotalNode(child) &&
            (colTotals ||
              metricLayoutIndexOnRows === undefined ||
              parent.level >= metricLayoutIndexOnRows ||
              metricIndexOnRows !== 0)
          );
        },
      });
      return resolveRowSubtotalChildrenPolicy({
        children: filtered,
        parent,
        nodes,
        rowSubTotals,
        rowSubtotalPositionForParent,
        resolvedMetricsLayout,
        isMultiMetric,
        metricLayoutIndexOnRows,
        hideMetricHeaderOnRows,
        countDimDepth,
        isMetricTokenValue,
        isMetricGrandTotalNode,
        isExplicitSubtotalNode,
      });
    },
    [
      colTotals,
      countDimDepth,
      getAxisChildrenBeforeSubtotalPolicy,
      getRowSubtotalPosition,
      groupbyRows.length,
      hideMetricHeaderOnRows,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      isMultiMetric,
      metricIndexOnRows,
      metricLayoutIndexOnRows,
      metricsFirstOnRows,
      resolvedMetricsLayout,
      rowSubTotals,
    ],
  );

  const getColChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
      metricIndexOverride?: number,
    ) =>
      getAxisChildrenBeforeSubtotalPolicy({
        axis: 'col',
        parent,
        nodes,
        metricIndex: metricIndexOverride ?? metricIndexOnCols,
        metricLayoutIndex: metricLayoutIndexOnCols,
        groupbyLength: groupbyColumns.length,
        hideMetricHeader: hideMetricHeaderOnCols,
        metricsFirst: metricsFirstOnCols,
        keepValuesChild: child =>
          isMetricGrandTotalNode(child) ||
          (normalizedColSubtotalLevels.length > 0 &&
            isMetricSubtotalNode(child)),
      }),
    [
      getAxisChildrenBeforeSubtotalPolicy,
      groupbyColumns.length,
      hideMetricHeaderOnCols,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricIndexOnCols,
      metricLayoutIndexOnCols,
      metricsFirstOnCols,
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
        resolvedMetricsLayout,
        metricLayoutIndex:
          axis === 'row' ? metricLayoutIndexOnRows : metricLayoutIndexOnCols,
        preserveMetricAtParentLevel: axis === 'col' && metricsAtColEnd,
        isMetricTokenValue,
        isExplicitSubtotalNode,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
      });
    },
    [
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricLayoutIndexOnCols,
      metricLayoutIndexOnRows,
      metricsAtColEnd,
      resolvedMetricsLayout,
    ],
  );

  return {
    layout,
    measureHierarchy: layout.measureHierarchy,
    hasMultipleMeasures,
    expandedStateSignature,
    expandedStateSharedSignature,
    expandRowsLevelRaw,
    expandColumnsLevelRaw,
    resolvedExpandRowsLevel,
    resolvedExpandColumnsLevel,
    resolvedMetricsLayout,
    metricInsertIndex,
    metricLabels,
    metricLabelSet,
    isMetricTokenValue,
    groupbyRowKeys,
    groupbyColumnKeys,
    normalizedRowSubtotalLevels,
    normalizedColSubtotalLevels,
    resolvedRowTotalPosition,
    resolvedColTotalPosition,
    effectiveRowSubtotalPosition,
    effectiveColSubtotalPosition,
    metricsFirstOnRows,
    metricsFirstOnCols,
    metricIndexOnRows,
    metricIndexOnCols,
    metricLayoutIndexOnRows,
    metricLayoutIndexOnCols,
    metricIntentIndexOnRows,
    metricIntentIndexOnCols,
    hideMetricHeaderOnRows,
    metricsAtColEnd,
    shouldExpandMetricRows,
    shouldExpandMetricCols,
    compareMetricOrder,
    getMetricLabelFromPath,
    getMetricDisplayLabelForKey,
    getNonMetricPathParts,
    getDimensionKeyForNode,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
    isExplicitSubtotalNode,
    countDimDepth,
    countEngineDimDepth,
    getRowSubtotalPosition,
    getCollapsedRowChildrenForNodes,
    getCollapsedColLeavesForNodes,
    getRowChildrenForNodes,
    getColChildrenForNodes,
    pruneMergedTree,
  };
};
