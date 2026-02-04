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
  type PivotPath,
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import {
  decodeMetricKey,
  decodeMeasureLeafId,
  encodeMetricKey,
  getMetricKey,
  getStableColumnKey,
  isMetricsPlaceholder,
  isSubtotalToken,
  serializePath,
} from '../../utils';
import { findChildren } from '../viewModel';
import { buildLayoutContext } from '../layout/LayoutContext';
import {
  countDimDepth as countDimDepthBase,
  getMetricDepthForParent as getMetricDepthForParentBase,
  getMetricLabelFromPath as getMetricLabelFromPathBase,
  getMetricTierNodes as getMetricTierNodesBase,
  getNonMetricPathParts as getNonMetricPathPartsBase,
  isExplicitSubtotalNode as isExplicitSubtotalNodeBase,
  isMetricGrandTotalNode as isMetricGrandTotalNodeBase,
  isMetricSubtotalNode as isMetricSubtotalNodeBase,
} from '../metricsTotals';

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
  metricLabelMap: Map<string, string>;
  isMetricTokenValue: (value: unknown) => boolean;
  isMultiMetric: boolean;
  singleMetricBetweenRows: boolean;
  singleMetricBetweenCols: boolean;
  groupbyRowKeys: string[];
  groupbyColumnKeys: string[];
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  rowSubtotalDepths: number[];
  resolvedRowTotalPosition: TotalPosition;
  resolvedRowSubtotalPosition: TotalPosition;
  resolvedColTotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
  effectiveRowSubtotalPosition: TotalPosition;
  effectiveColSubtotalPosition: TotalPosition;
  metricsFirstOnRows: boolean;
  metricsFirstOnCols: boolean;
  metricInsertIndexOnRows?: number;
  metricInsertIndexOnCols?: number;
  metricIndexOnRows?: number;
  metricIndexOnCols?: number;
  metricLayoutIndexOnRows?: number;
  metricLayoutIndexOnCols?: number;
  metricIntentIndexOnRows?: number;
  metricIntentIndexOnCols?: number;
  hideMetricHeaderOnRows: boolean;
  hideMetricHeaderOnCols: boolean;
  metricsAtRowEnd: boolean;
  metricsAtColEnd: boolean;
  shouldExpandMetricRows: boolean;
  shouldExpandMetricCols: boolean;
  getFetchPath: (path: PivotPath) => PivotPath;
  compareMetricOrder: (a: PivotTreeNode, b: PivotTreeNode) => number;
  getMetricLabelFromPath: (path: PivotTreeNode['path']) => string | undefined;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
  getMetricDisplayLabelFromPath: (
    path: PivotTreeNode['path'],
  ) => string | undefined;
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
  findMetricIndex: (nodes: Record<string, PivotTreeNode>) => number | undefined;
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
    expandedRows: Set<string>;
    expandedCols: Set<string>;
  }) => PivotTreeData;
};

export const usePivotLayout = ({
  data,
  formData,
  metrics,
  groupbyRows,
  groupbyColumns,
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
  metrics: PivotTableProps['metrics'];
  groupbyRows: PivotTableProps['groupbyRows'];
  groupbyColumns: PivotTableProps['groupbyColumns'];
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
        metrics,
        measureLeavesByMetric: formData.measureLeavesByMetric,
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
      metrics,
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
    getFetchPath,
  } = layout;

  const metricOrderMap = useMemo(
    () => new Map(metricLabels.map((label, idx) => [label, idx])),
    [metricLabels],
  );
  const isMultiMetric = metricLabels.length > 1;
  const hasMultipleMeasures =
    isMultiMetric ||
    (layout.measureHierarchy.kind === 'measureStackV1' &&
      layout.measureHierarchy.groups.some(group => group.leaves.length > 1));

  const normalizedRowSubtotalLevels = layout.rowSubtotalLevels;
  const rowSubtotalDepths = useMemo(
    () => normalizedRowSubtotalLevels.filter(level => level > 0),
    [normalizedRowSubtotalLevels],
  );
  const normalizedColSubtotalLevels = useMemo(() => {
    if (rowTotals && !layout.colSubtotalLevels.includes(0)) {
      return [0, ...layout.colSubtotalLevels];
    }
    return layout.colSubtotalLevels;
  }, [layout.colSubtotalLevels, rowTotals]);

  const rowDimCount = layout.groupbyRows.length;
  const colDimCount = layout.groupbyColumns.length;

  const metricInsertIndexOnRows = useMemo(() => {
    if (
      resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
      metrics.length === 0
    ) {
      return undefined;
    }
    return Math.min(layout.metricInsertIndex, rowDimCount);
  }, [
    layout.metricInsertIndex,
    metrics.length,
    resolvedMetricsLayout,
    rowDimCount,
  ]);
  const metricInsertIndexOnCols = useMemo(() => {
    if (
      resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS ||
      metrics.length === 0
    ) {
      return undefined;
    }
    return Math.min(layout.metricInsertIndex, colDimCount);
  }, [
    colDimCount,
    layout.metricInsertIndex,
    metrics.length,
    resolvedMetricsLayout,
  ]);
  const singleMetricBetweenRows =
    metricLabels.length === 1 &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricInsertIndexOnRows !== undefined &&
    metricInsertIndexOnRows > 0 &&
    metricInsertIndexOnRows < rowDimCount;
  const singleMetricBetweenCols =
    metricLabels.length === 1 &&
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndexOnCols !== undefined &&
    metricInsertIndexOnCols > 0 &&
    metricInsertIndexOnCols < colDimCount;

  const shouldExpandMetricRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metrics.length > 0 &&
    layout.metricInsertIndex === 0 &&
    resolvedExpandRowsLevel > 0;
  const shouldExpandMetricCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metrics.length > 0 &&
    layout.metricInsertIndex === 0 &&
    resolvedExpandColumnsLevel > 0;

  const groupbyRowKeys = useMemo(
    () => groupbyRows.map(getStableColumnKey),
    [groupbyRows],
  );
  const groupbyColumnKeys = useMemo(
    () => groupbyColumns.map(getStableColumnKey),
    [groupbyColumns],
  );

  const expandedStateSignature = useMemo(
    () =>
      JSON.stringify({
        rows: groupbyRowKeys,
        cols: groupbyColumnKeys,
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
      groupbyColumnKeys,
      groupbyRowKeys,
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
  const expandedStateSharedSignature = useMemo(
    () =>
      JSON.stringify({
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

  const maxColDimDepth = useMemo(
    () =>
      Object.values(data.cols).reduce(
        (max, node) =>
          Math.max(
            max,
            getNonMetricPathPartsBase(node.path, metricLabelSet).length,
          ),
        0,
      ),
    [data.cols, metricLabelSet],
  );

  const findMetricIndex = useCallback(
    (nodes: Record<string, PivotTreeNode>) => {
      let found: number | undefined;
      let foundFromSubtotal: number | undefined;
      Object.values(nodes).forEach(node => {
        const idx = node.path.findIndex(val => isMetricTokenValue(val));
        if (idx < 0) {
          return;
        }
        if (node.path.some(val => isSubtotalToken(val))) {
          foundFromSubtotal =
            foundFromSubtotal === undefined
              ? idx
              : Math.max(foundFromSubtotal, idx);
          return;
        }
        found = found === undefined ? idx : Math.max(found, idx);
      });
      return found ?? foundFromSubtotal;
    },
    [isMetricTokenValue],
  );

  const metricIndexOnRows = useMemo(() => {
    const treeIndex = findMetricIndex(data.rows);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnRows;
  }, [data.rows, findMetricIndex, metricInsertIndexOnRows]);
  const metricIndexOnCols = useMemo(() => {
    const treeIndex = findMetricIndex(data.cols);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnCols;
  }, [data.cols, findMetricIndex, metricInsertIndexOnCols]);
  const metricIntentIndexOnRows = metricInsertIndexOnRows ?? metricIndexOnRows;
  const metricIntentIndexOnCols = metricInsertIndexOnCols ?? metricIndexOnCols;

  const metricDimIndexOnRows = useMemo(() => {
    if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
      return undefined;
    }
    const maxDimDepth = Object.values(data.rows).reduce((max, node) => {
      if (node.path.some(val => isSubtotalToken(val))) {
        return max;
      }
      return Math.max(max, countDimDepthBase(node.path, metricLabelSet));
    }, 0);
    let found: number | undefined;
    Object.values(data.rows).forEach(node => {
      if (node.path.some(val => isSubtotalToken(val))) {
        return;
      }
      if (countDimDepthBase(node.path, metricLabelSet) !== maxDimDepth) {
        return;
      }
      const idx = node.path.findIndex(val => isMetricTokenValue(val));
      if (idx < 0) {
        return;
      }
      let dimIndex = 0;
      for (let i = 0; i < idx; i += 1) {
        const val = node.path[i];
        if (isMetricTokenValue(val)) {
          continue;
        }
        if (isSubtotalToken(val)) {
          continue;
        }
        dimIndex += 1;
      }
      found = found === undefined ? dimIndex : Math.min(found, dimIndex);
    });
    return found;
  }, [data.rows, isMetricTokenValue, metricLabelSet, resolvedMetricsLayout]);

  const formRowsHasPlaceholder = useMemo(
    () =>
      Array.isArray(formData.groupbyRows) &&
      formData.groupbyRows.some(isMetricsPlaceholder),
    [formData.groupbyRows],
  );
  const formColsHasPlaceholder = useMemo(
    () =>
      Array.isArray(formData.groupbyColumns) &&
      formData.groupbyColumns.some(isMetricsPlaceholder),
    [formData.groupbyColumns],
  );
  const metricLayoutIndexOnRows = formRowsHasPlaceholder
    ? (metricInsertIndexOnRows ?? metricIndexOnRows)
    : metricIndexOnRows;
  const metricLayoutIndexOnCols = useMemo(() => {
    if (formColsHasPlaceholder) {
      return metricInsertIndexOnCols ?? metricIndexOnCols;
    }
    if (metricIndexOnCols === undefined) {
      return metricIndexOnCols;
    }
    if (maxColDimDepth < groupbyColumns.length) {
      return groupbyColumns.length;
    }
    return metricIndexOnCols;
  }, [
    formColsHasPlaceholder,
    groupbyColumns.length,
    maxColDimDepth,
    metricIndexOnCols,
    metricInsertIndexOnCols,
  ]);

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

  const resolvedRowTotalPosition = layout.rowTotalPosition;
  const resolvedRowSubtotalPosition = layout.rowSubtotalPosition;
  const resolvedColTotalPosition = layout.colTotalPosition;
  const resolvedColSubtotalPosition = layout.colSubtotalPosition;

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

  const hideMetricHeaderOnRows = useMemo(
    () =>
      resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
      metricLabels.length === 1 &&
      metricIndexOnRows !== undefined &&
      metricIndexOnRows === rowDimCount &&
      rowDimCount > 0,
    [
      metricIndexOnRows,
      metricLabels.length,
      resolvedMetricsLayout,
      rowDimCount,
    ],
  );
  const hideMetricHeaderOnCols = useMemo(
    () =>
      resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
      metricLabels.length === 1 &&
      metricIndexOnCols !== undefined &&
      metricIndexOnCols === colDimCount &&
      colDimCount > 0,
    [
      colDimCount,
      metricIndexOnCols,
      metricLabels.length,
      resolvedMetricsLayout,
    ],
  );

  const getMetricLabelFromPath = useCallback(
    (path: PivotTreeNode['path']) =>
      getMetricLabelFromPathBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const getMetricDisplayLabelForKey = useCallback(
    (metricKey: string) => metricLabelMap.get(metricKey) ?? metricKey,
    [metricLabelMap],
  );
  const getMetricDisplayLabelFromPath = useCallback(
    (path: PivotTreeNode['path']) => {
      const key = getMetricLabelFromPathBase(path, metricLabelSet);
      return key ? getMetricDisplayLabelForKey(key) : undefined;
    },
    [getMetricDisplayLabelForKey, metricLabelSet],
  );

  const measureLeafOrderMap = useMemo(() => {
    const next = new Map<string, Map<string, number>>();
    if (layout.measureHierarchy.kind !== 'measureStackV1') {
      return next;
    }
    layout.measureHierarchy.groups.forEach(group => {
      const order = new Map<string, number>();
      group.leaves.forEach((leaf, index) => {
        order.set(leaf.id, index);
      });
      next.set(group.metricKey, order);
    });
    return next;
  }, [layout.measureHierarchy]);

  const compareMetricOrder = useCallback(
    (a: PivotTreeNode, b: PivotTreeNode) => {
      const aMetric = getMetricLabelFromPath(a.path);
      const bMetric = getMetricLabelFromPath(b.path);
      if (aMetric && bMetric && aMetric === bMetric) {
        const leafOrder = measureLeafOrderMap.get(aMetric);
        if (leafOrder) {
          const resolveLeafId = (node: PivotTreeNode) =>
            [...node.path]
              .reverse()
              .map(val => decodeMeasureLeafId(val))
              .find((candidate): candidate is string => Boolean(candidate));
          const aLeaf = resolveLeafId(a);
          const bLeaf = resolveLeafId(b);
          if (aLeaf && bLeaf && aLeaf !== bLeaf) {
            const aIndex = leafOrder.get(aLeaf);
            const bIndex = leafOrder.get(bLeaf);
            if (aIndex !== undefined && bIndex !== undefined) {
              return aIndex - bIndex;
            }
          }
        }
        return 0;
      }
      if (!aMetric || !bMetric || aMetric === bMetric) {
        return 0;
      }
      const aIndex = metricOrderMap.get(aMetric);
      const bIndex = metricOrderMap.get(bMetric);
      if (aIndex === undefined || bIndex === undefined) {
        return 0;
      }
      return aIndex - bIndex;
    },
    [getMetricLabelFromPath, measureLeafOrderMap, metricOrderMap],
  );

  const getNonMetricPathParts = useCallback(
    (path: PivotTreeNode['path']) =>
      getNonMetricPathPartsBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const getDimensionKeyForNode = useCallback(
    (node: PivotTreeNode, axis: 'row' | 'col') => {
      const nonMetricParts = getNonMetricPathParts(node.path);
      const nonSubtotalParts = nonMetricParts.filter(
        part => !isSubtotalToken(part),
      );
      if (nonSubtotalParts.length === 0) {
        return undefined;
      }
      const dimensionIndex = nonSubtotalParts.length - 1;
      const dimension =
        axis === 'row'
          ? groupbyRows[dimensionIndex]
          : groupbyColumns[dimensionIndex];
      if (!dimension) {
        return undefined;
      }
      return getColumnLabel(dimension);
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

  const isExplicitSubtotalNode = useCallback(
    (node?: PivotTreeNode) => isExplicitSubtotalNodeBase(node),
    [],
  );

  const getMetricDepthForParent = useCallback(
    (nodes: Record<string, PivotTreeNode>, parent: PivotTreeNode) =>
      getMetricDepthForParentBase(nodes, parent, metricLabelSet),
    [metricLabelSet],
  );

  const getMetricTierNodes = useCallback(
    (
      nodes: Record<string, PivotTreeNode>,
      parent: PivotTreeNode,
      metricDepth: number,
    ) => getMetricTierNodesBase(nodes, parent, metricDepth, metricLabelSet),
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

  const getRowSubtotalPosition = useCallback(
    (node: PivotTreeNode) => {
      if (!forceRowSubtotalEnd) {
        return resolvedRowSubtotalPosition;
      }
      const metricIndex = node.path.findIndex(val => isMetricTokenValue(val));
      if (metricIndex < 0) {
        return 'end';
      }
      return node.path.length > metricIndex + 1
        ? resolvedRowSubtotalPosition
        : 'end';
    },
    [forceRowSubtotalEnd, isMetricTokenValue, resolvedRowSubtotalPosition],
  );

  const getCollapsedRowChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      if (
        (!isMultiMetric && !singleMetricBetweenRows) ||
        resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
        expandedSet.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent)) {
        return [] as PivotTreeNode[];
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(nodes, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(nodes, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyRows.length;
      const metricLabelsForNode = Array.from(
        new Set(
          metricNodes
            .map(node => decodeMetricKey(node.path[metricDepth]))
            .filter((label): label is string => !!label),
        ),
      );
      return metricLabelsForNode.map(metricLabel => {
        const metricToken = encodeMetricKey(metricLabel);
        const collapsedPath = [...parent.path, metricToken];
        const collapsedKey = serializePath(collapsedPath);
        const existing = nodes[collapsedKey];
        if (existing) {
          const hasChildren = metricsAtRowEnd
            ? false
            : findChildren(nodes, existing).length > 0 || hasMetricChildren;
          return { ...existing, hasChildren };
        }
        const sourceNode = metricNodes.find(node => {
          const decoded = decodeMetricKey(node.path[metricDepth]);
          return decoded === metricLabel;
        });
        const hasChildren = metricsAtRowEnd
          ? false
          : Object.values(nodes).some(
              node =>
                node.path.length === collapsedPath.length + 1 &&
                collapsedPath.every((val, idx) => val === node.path[idx]),
            ) || hasMetricChildren;
        return {
          ...(sourceNode || metricNodes[0]),
          key: collapsedKey,
          path: collapsedPath,
          label: metricLabel,
          formattedLabel: metricLabel,
          level: collapsedPath.length,
          hasChildren,
        };
      });
    },
    [
      getMetricDepthForParent,
      getMetricTierNodes,
      groupbyRows.length,
      isExplicitSubtotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      isMultiMetric,
      singleMetricBetweenRows,
      metricsAtRowEnd,
      resolvedMetricsLayout,
    ],
  );

  const getCollapsedColLeavesForNodes = useCallback(
    (
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      if (
        (!isMultiMetric && !singleMetricBetweenCols) ||
        resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS ||
        expandedSet.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(nodes, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(nodes, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyColumns.length;
      const metricLabelsForNode = Array.from(
        new Set(
          metricNodes
            .map(node => decodeMetricKey(node.path[metricDepth]))
            .filter((label): label is string => !!label),
        ),
      );
      return metricLabelsForNode.map(metricLabel => {
        const metricToken = encodeMetricKey(metricLabel);
        const collapsedPath = [...parent.path, metricToken];
        const collapsedKey = serializePath(collapsedPath);
        const sourceNode = metricNodes.find(node => {
          const decoded = decodeMetricKey(node.path[metricDepth]);
          return decoded === metricLabel;
        });
        const existing = nodes[collapsedKey];
        if (existing) {
          const hasChildren = metricsAtColEnd
            ? false
            : findChildren(nodes, existing).length > 0 || hasMetricChildren;
          if (isMetricSubtotalNode(existing)) {
            return {
              ...existing,
              label: metricLabel,
              formattedLabel: metricLabel,
              isSubtotal: false,
              hasChildren,
            };
          }
          return { ...existing, hasChildren };
        }
        const hasChildren = metricsAtColEnd
          ? false
          : findChildren(nodes, { ...parent, path: collapsedPath }).length >
              0 || hasMetricChildren;
        return {
          ...(sourceNode || metricNodes[0]),
          key: collapsedKey,
          path: collapsedPath,
          label: metricLabel,
          formattedLabel: metricLabel,
          level: collapsedPath.length,
          hasChildren,
        };
      });
    },
    [
      getMetricDepthForParent,
      getMetricTierNodes,
      groupbyColumns.length,
      isMetricSubtotalNode,
      isMetricTokenValue,
      isMultiMetric,
      singleMetricBetweenCols,
      metricsAtColEnd,
      resolvedMetricsLayout,
    ],
  );

  const getRowChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
      metricIndexOverride?: number,
    ) => {
      const rowSubtotalPositionForParent = getRowSubtotalPosition(parent);
      const isMetricSubtotalAtMetricTier = (node: PivotTreeNode) => {
        if (
          resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
          !isMultiMetric
        ) {
          return false;
        }
        const subtotalIndex = node.path.findIndex(val => isSubtotalToken(val));
        if (subtotalIndex <= 0) {
          return false;
        }
        const prev = node.path[subtotalIndex - 1];
        return isMetricTokenValue(prev);
      };
      const children = findChildren(nodes, parent);
      const parentHasMetric = parent.path.some(val => isMetricTokenValue(val));
      const filteredByMetricPosition = parentHasMetric
        ? children
        : children.filter(child => {
            const metricIndex = metricIndexOverride ?? metricIndexOnRows;
            if (metricIndex === undefined) {
              return true;
            }
            if (child.path.length <= metricIndex) {
              return true;
            }
            const metricAtIndex = isMetricTokenValue(child.path[metricIndex]);
            return metricAtIndex;
          });
      let filtered = filteredByMetricPosition;
      if (
        metricsAtRowEnd &&
        parent.axis === 'row' &&
        parent.level < groupbyRows.length
      ) {
        const nonMetricChildren = children.filter(child => {
          const metricAtLevel = isMetricTokenValue(child.path[parent.level]);
          if (!metricAtLevel) {
            return true;
          }
          return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
        });
        if (nonMetricChildren.length > 0) {
          filtered = nonMetricChildren;
        }
      }
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        parent.axis === 'row' &&
        parent.level < groupbyRows.length &&
        (metricLayoutIndexOnRows === undefined ||
          metricLayoutIndexOnRows > parent.level)
      ) {
        const hasNonMetricChildren = children.some(child => {
          const metricAtLevel = isMetricTokenValue(child.path[parent.level]);
          return !metricAtLevel;
        });
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = isMetricTokenValue(child.path[parent.level]);
          if (!metricAtLevel) {
            return true;
          }
          if (hasNonMetricChildren) {
            if (
              !colTotals &&
              metricLayoutIndexOnRows !== undefined &&
              parent.level < metricLayoutIndexOnRows &&
              metricIndexOnRows === 0
            ) {
              return false;
            }
            return isMetricGrandTotalNode(child);
          }
          return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
        });
        filtered = withoutMetrics.length > 0 ? withoutMetrics : children;
      }
      if (
        hideMetricHeaderOnRows &&
        parent.axis === 'row' &&
        parent.level >= groupbyRows.length
      ) {
        filtered = filtered.filter(
          child => !isMetricTokenValue(child.path[parent.level]),
        );
      }
      if (metricsFirstOnRows) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      if (resolvedMetricsLayout === MetricsLayoutEnum.ROWS && !isMultiMetric) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      if (!rowSubTotals || rowSubtotalPositionForParent === 'start') {
        filtered = filtered.filter(child => {
          if (child.path.length === 0) {
            return true;
          }
          if (!isExplicitSubtotalNode(child)) {
            return true;
          }
          return isMetricGrandTotalNode(child);
        });
      }
      if (rowSubTotals && rowSubtotalPositionForParent === 'end') {
        const requireMetricLabel =
          resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
          isMultiMetric &&
          metricDimIndexOnRows !== undefined &&
          countDimDepth(parent.path) > metricDimIndexOnRows;
        const isSubtotalLevelToken = (val: unknown) => isSubtotalToken(val);
        const subtotalDescendants = Object.values(nodes).filter(node => {
          if (node.path.length <= parent.path.length) {
            return false;
          }
          if (!parent.path.every((val, idx) => val === node.path[idx])) {
            return false;
          }
          if (
            resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
            !isMultiMetric &&
            isMetricGrandTotalNode(node)
          ) {
            return false;
          }
          if (!isSubtotalLevelToken(node.path[parent.path.length])) {
            return false;
          }
          if (hideMetricHeaderOnRows) {
            return !node.path.some(val => isMetricTokenValue(val));
          }
          if (requireMetricLabel) {
            return node.path.some(val => isMetricTokenValue(val));
          }
          return true;
        });
        if (subtotalDescendants.length > 0) {
          const seen = new Set(filtered.map(child => child.key));
          subtotalDescendants.forEach(node => {
            if (isMetricSubtotalAtMetricTier(node)) {
              return;
            }
            if (!seen.has(node.key)) {
              filtered.push(node);
            }
          });
        }
      }
      if (
        rowSubTotals &&
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        isMultiMetric
      ) {
        filtered = filtered.filter(child => {
          if (!isExplicitSubtotalNode(child)) {
            return true;
          }
          if (isMetricGrandTotalNode(child)) {
            return true;
          }
          return child.path.some(val => isMetricTokenValue(val));
        });
      }
      if (
        rowSubTotals &&
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        isMultiMetric &&
        metricDimIndexOnRows !== undefined &&
        metricLayoutIndexOnRows !== undefined &&
        metricLayoutIndexOnRows < groupbyRows.length &&
        metricLayoutIndexOnRows > 1
      ) {
        const suppressDepth = metricDimIndexOnRows + 1;
        filtered = filtered.filter(child => {
          if (!isExplicitSubtotalNode(child)) {
            return true;
          }
          if (metricLayoutIndexOnRows > 1) {
            return true;
          }
          const dimDepth = countDimDepth(child.path);
          const subtotalDepth = child.path.some(val => isSubtotalToken(val))
            ? Math.max(dimDepth - 1, 0)
            : dimDepth;
          return subtotalDepth !== suppressDepth;
        });
      }
      if (rowSubTotals && !isMultiMetric) {
        filtered = filtered.filter(
          child => !isMetricSubtotalAtMetricTier(child),
        );
      }
      return filtered;
    },
    [
      colTotals,
      countDimDepth,
      getRowSubtotalPosition,
      groupbyRows.length,
      hideMetricHeaderOnRows,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      isMultiMetric,
      metricDimIndexOnRows,
      metricIndexOnRows,
      metricLayoutIndexOnRows,
      metricsFirstOnRows,
      resolvedMetricsLayout,
      rowSubTotals,
      metricsAtRowEnd,
    ],
  );

  const expandMetricNodes = useCallback(
    (nodes: Record<string, PivotTreeNode>, expandedSet: Set<string>) => {
      if (!isLeafTierVisible) {
        return expandedSet;
      }
      const next = new Set(expandedSet);
      Object.values(nodes).forEach(node => {
        if (isMetricTokenValue(node.path[node.path.length - 1])) {
          next.add(node.key);
        }
      });
      return next;
    },
    [isLeafTierVisible, isMetricTokenValue],
  );

  const pruneCollapsedMetricRows = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      expanded: Set<string>,
    ) => {
      if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows === undefined) {
        return currentTree;
      }
      if (metricsAtRowEnd) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows <= parent.level) {
        return currentTree;
      }
      const expandedWithMetrics = expandMetricNodes(currentTree.rows, expanded);
      const removedRowKeys = new Set<string>();
      const shouldPruneLeafChildren =
        metricLayoutIndexOnRows < groupbyRows.length &&
        metricLayoutIndexOnRows > parent.level;
      const rowNodes = Object.values(currentTree.rows);
      const expandedCollapsedNodes = Array.from(expandedWithMetrics)
        .map(key => currentTree.rows[key])
        .filter((node): node is PivotTreeNode => {
          if (!node) {
            return false;
          }
          if (node.path.length <= parent.path.length) {
            return false;
          }
          if (!parent.path.every((val, idx) => val === node.path[idx])) {
            return false;
          }
          const metricIdx = node.path.findIndex(val => isMetricTokenValue(val));
          return metricIdx === parent.level;
        });
      const isUnderExpandedCollapsedNode = (node: PivotTreeNode) =>
        expandedCollapsedNodes.some(
          expandedNode =>
            expandedNode.path.length <= node.path.length &&
            expandedNode.path.every((val, idx) => val === node.path[idx]),
        );
      const hasMetricAtLayoutIndex = (node: PivotTreeNode) =>
        rowNodes.some(descendant => {
          if (descendant.path.length <= metricLayoutIndexOnRows) {
            return false;
          }
          if (!node.path.every((val, idx) => val === descendant.path[idx])) {
            return false;
          }
          const valAtIndex = descendant.path[metricLayoutIndexOnRows];
          return isMetricTokenValue(valAtIndex);
        });
      const shouldPruneCollapsedChildren =
        !metricsAtColEnd && hasMetricAtLayoutIndex(parent);
      rowNodes.forEach(node => {
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        if (
          shouldPruneCollapsedChildren &&
          node.path.length === parent.path.length + 1 &&
          !isExplicitSubtotalNode(node) &&
          !isMetricGrandTotalNode(node) &&
          !isMetricSubtotalNode(node) &&
          !hasMetricAtLayoutIndex(node)
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedRowKeys.add(node.key);
          return;
        }
        if (
          shouldPruneLeafChildren &&
          node.path.length === parent.path.length + 1 &&
          !node.hasChildren
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedRowKeys.add(node.key);
        }
      });
      if (removedRowKeys.size === 0) {
        return currentTree;
      }
      const nextRows: PivotTreeData['rows'] = { ...currentTree.rows };
      removedRowKeys.forEach(key => {
        delete nextRows[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedRowKeys.has(cell.rowKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, rows: nextRows, cells: nextCells };
    },
    [
      expandMetricNodes,
      groupbyRows.length,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricLayoutIndexOnRows,
      resolvedMetricsLayout,
      metricsAtRowEnd,
    ],
  );

  const pruneStaleCollapsedRows = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      branch?: PivotTreeData,
    ) => {
      if (!branch) {
        return currentTree;
      }
      if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows === undefined) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows <= parent.level) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      const branchParent = branch.rows[parent.key];
      if (!branchParent) {
        return currentTree;
      }
      const branchChildren = findChildren(branch.rows, branchParent);
      if (branchChildren.length === 0) {
        return currentTree;
      }
      const validChildKeys = new Set(branchChildren.map(child => child.key));
      const removedPrefixes: PivotTreeNode['path'][] = [];
      Object.values(currentTree.rows).forEach(node => {
        if (node.path.length !== parent.path.length + 1) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        if (validChildKeys.has(node.key)) {
          return;
        }
        if (
          isExplicitSubtotalNode(node) ||
          isMetricGrandTotalNode(node) ||
          isMetricSubtotalNode(node)
        ) {
          return;
        }
        removedPrefixes.push(node.path);
      });
      if (removedPrefixes.length === 0) {
        return currentTree;
      }
      const removedKeys = new Set<string>();
      Object.values(currentTree.rows).forEach(node => {
        if (
          removedPrefixes.some(prefix =>
            prefix.every((val, idx) => val === node.path[idx]),
          )
        ) {
          removedKeys.add(node.key);
        }
      });
      const nextRows: PivotTreeData['rows'] = { ...currentTree.rows };
      removedKeys.forEach(key => {
        delete nextRows[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedKeys.has(cell.rowKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, rows: nextRows, cells: nextCells };
    },
    [
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricLayoutIndexOnRows,
      resolvedMetricsLayout,
    ],
  );

  const pruneCollapsedMetricCols = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      expanded: Set<string>,
    ) => {
      if (resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols === undefined) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols <= parent.level) {
        return currentTree;
      }
      const expandedWithMetrics = expandMetricNodes(currentTree.cols, expanded);
      const removedColKeys = new Set<string>();
      const shouldPruneLeafChildren =
        metricLayoutIndexOnCols < groupbyColumns.length &&
        metricLayoutIndexOnCols > parent.level;
      const colNodes = Object.values(currentTree.cols);
      const expandedCollapsedNodes = Array.from(expandedWithMetrics)
        .map(key => currentTree.cols[key])
        .filter((node): node is PivotTreeNode => {
          if (!node) {
            return false;
          }
          if (node.path.length <= parent.path.length) {
            return false;
          }
          if (!parent.path.every((val, idx) => val === node.path[idx])) {
            return false;
          }
          const metricIdx = node.path.findIndex(val => isMetricTokenValue(val));
          return metricIdx === parent.level;
        });
      const isUnderExpandedCollapsedNode = (node: PivotTreeNode) =>
        expandedCollapsedNodes.some(
          expandedNode =>
            expandedNode.path.length <= node.path.length &&
            expandedNode.path.every((val, idx) => val === node.path[idx]),
        );
      const hasMetricAtLayoutIndex = (node: PivotTreeNode) =>
        colNodes.some(descendant => {
          if (descendant.path.length <= metricLayoutIndexOnCols) {
            return false;
          }
          if (!node.path.every((val, idx) => val === descendant.path[idx])) {
            return false;
          }
          const valAtIndex = descendant.path[metricLayoutIndexOnCols];
          return isMetricTokenValue(valAtIndex);
        });
      const shouldPruneCollapsedChildren = hasMetricAtLayoutIndex(parent);
      colNodes.forEach(node => {
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        const metricIdx = node.path.findIndex(val => isMetricTokenValue(val));
        if (
          shouldPruneCollapsedChildren &&
          node.path.length === parent.path.length + 1 &&
          !isExplicitSubtotalNode(node) &&
          !isMetricGrandTotalNode(node) &&
          !isMetricSubtotalNode(node) &&
          metricIdx === parent.level &&
          !hasMetricAtLayoutIndex(node)
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedColKeys.add(node.key);
          return;
        }
        if (
          shouldPruneLeafChildren &&
          node.path.length === parent.path.length + 1 &&
          !node.hasChildren
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedColKeys.add(node.key);
        }
      });
      if (removedColKeys.size === 0) {
        return currentTree;
      }
      const nextCols: PivotTreeData['cols'] = { ...currentTree.cols };
      removedColKeys.forEach(key => {
        delete nextCols[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedColKeys.has(cell.colKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, cols: nextCols, cells: nextCells };
    },
    [
      expandMetricNodes,
      groupbyColumns.length,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricsAtColEnd,
      metricLayoutIndexOnCols,
      resolvedMetricsLayout,
    ],
  );

  const pruneStaleCollapsedCols = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      branch?: PivotTreeData,
    ) => {
      if (!branch) {
        return currentTree;
      }
      if (resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols === undefined) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols <= parent.level) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      const branchParent = branch.cols[parent.key];
      if (!branchParent) {
        return currentTree;
      }
      const branchChildren = findChildren(branch.cols, branchParent);
      if (branchChildren.length === 0) {
        return currentTree;
      }
      const validChildKeys = new Set(branchChildren.map(child => child.key));
      const removedPrefixes: PivotTreeNode['path'][] = [];
      Object.values(currentTree.cols).forEach(node => {
        if (node.path.length !== parent.path.length + 1) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        if (validChildKeys.has(node.key)) {
          return;
        }
        if (metricsAtColEnd && isMetricTokenValue(node.path[parent.level])) {
          return;
        }
        if (
          isExplicitSubtotalNode(node) ||
          isMetricGrandTotalNode(node) ||
          isMetricSubtotalNode(node)
        ) {
          return;
        }
        removedPrefixes.push(node.path);
      });
      if (removedPrefixes.length === 0) {
        return currentTree;
      }
      const removedKeys = new Set<string>();
      Object.values(currentTree.cols).forEach(node => {
        if (
          removedPrefixes.some(prefix =>
            prefix.every((val, idx) => val === node.path[idx]),
          )
        ) {
          removedKeys.add(node.key);
        }
      });
      const nextCols: PivotTreeData['cols'] = { ...currentTree.cols };
      removedKeys.forEach(key => {
        delete nextCols[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedKeys.has(cell.colKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, cols: nextCols, cells: nextCells };
    },
    [
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricsAtColEnd,
      metricLayoutIndexOnCols,
      resolvedMetricsLayout,
    ],
  );

  const getColChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
      metricIndexOverride?: number,
    ) => {
      const children = findChildren(nodes, parent);
      const parentHasMetric = parent.path.some(val => isMetricTokenValue(val));
      const filteredByMetricPosition = parentHasMetric
        ? children
        : children.filter(child => {
            const metricIndex = metricIndexOverride ?? metricIndexOnCols;
            if (metricIndex === undefined) {
              return true;
            }
            if (child.path.length <= metricIndex) {
              return true;
            }
            const metricAtIndex = isMetricTokenValue(child.path[metricIndex]);
            return metricAtIndex;
          });
      let filtered = filteredByMetricPosition;
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
        parent.axis === 'col' &&
        parent.level < groupbyColumns.length &&
        (metricLayoutIndexOnCols === undefined ||
          metricLayoutIndexOnCols > parent.level)
      ) {
        const allowMetricSubtotals = normalizedColSubtotalLevels.length > 0;
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = isMetricTokenValue(child.path[parent.level]);
          if (!metricAtLevel) {
            return true;
          }
          if (allowMetricSubtotals) {
            return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
          }
          return isMetricGrandTotalNode(child);
        });
        filtered = withoutMetrics.length > 0 ? withoutMetrics : children;
      }
      if (
        hideMetricHeaderOnCols &&
        parent.axis === 'col' &&
        parent.level >= groupbyColumns.length
      ) {
        filtered = filtered.filter(
          child => !isMetricTokenValue(child.path[parent.level]),
        );
      }
      if (metricsFirstOnCols) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      return filtered;
    },
    [
      groupbyColumns.length,
      hideMetricHeaderOnCols,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricIndexOnCols,
      metricLayoutIndexOnCols,
      metricsFirstOnCols,
      normalizedColSubtotalLevels.length,
      resolvedMetricsLayout,
    ],
  );

  const pruneMergedTree = useCallback(
    ({
      axis,
      tree: nextTree,
      parent,
      branch,
      expandedRows: nextExpandedRows,
      expandedCols: nextExpandedCols,
    }: {
      axis: 'row' | 'col';
      tree: PivotTreeData;
      parent?: PivotTreeNode;
      branch?: PivotTreeData;
      expandedRows: Set<string>;
      expandedCols: Set<string>;
    }) => {
      if (!parent || !branch) {
        return nextTree;
      }
      if (axis === 'row') {
        let pruned = pruneCollapsedMetricRows(
          nextTree,
          parent,
          nextExpandedRows,
        );
        pruned = pruneStaleCollapsedRows(pruned, parent, branch);
        return pruned;
      }
      let pruned = pruneCollapsedMetricCols(nextTree, parent, nextExpandedCols);
      pruned = pruneStaleCollapsedCols(pruned, parent, branch);
      return pruned;
    },
    [
      pruneCollapsedMetricCols,
      pruneCollapsedMetricRows,
      pruneStaleCollapsedCols,
      pruneStaleCollapsedRows,
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
    metricLabelMap,
    isMetricTokenValue,
    isMultiMetric,
    singleMetricBetweenRows,
    singleMetricBetweenCols,
    groupbyRowKeys,
    groupbyColumnKeys,
    normalizedRowSubtotalLevels,
    normalizedColSubtotalLevels,
    rowSubtotalDepths,
    resolvedRowTotalPosition,
    resolvedRowSubtotalPosition,
    resolvedColTotalPosition,
    resolvedColSubtotalPosition,
    effectiveRowSubtotalPosition,
    effectiveColSubtotalPosition,
    metricsFirstOnRows,
    metricsFirstOnCols,
    metricInsertIndexOnRows,
    metricInsertIndexOnCols,
    metricIndexOnRows,
    metricIndexOnCols,
    metricLayoutIndexOnRows,
    metricLayoutIndexOnCols,
    metricIntentIndexOnRows,
    metricIntentIndexOnCols,
    hideMetricHeaderOnRows,
    hideMetricHeaderOnCols,
    metricsAtRowEnd,
    metricsAtColEnd,
    shouldExpandMetricRows,
    shouldExpandMetricCols,
    getFetchPath,
    compareMetricOrder,
    getMetricLabelFromPath,
    getMetricDisplayLabelForKey,
    getMetricDisplayLabelFromPath,
    getNonMetricPathParts,
    getDimensionKeyForNode,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
    isExplicitSubtotalNode,
    countDimDepth,
    countEngineDimDepth,
    getRowSubtotalPosition,
    findMetricIndex,
    getCollapsedRowChildrenForNodes,
    getCollapsedColLeavesForNodes,
    getRowChildrenForNodes,
    getColChildrenForNodes,
    pruneMergedTree,
  };
};
