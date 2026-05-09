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
  decodeMeasureLeafId,
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
import {
  resolveAxisChildProjection,
  resolveAxisProjection,
  resolveCollapsedValuesProjection,
} from '../runtime/projection';
import { pruneStaleCollapsedAxis } from './pruneCollapsedAxis';

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
  isMultiMetric: boolean;
  groupbyRowKeys: string[];
  groupbyColumnKeys: string[];
  normalizedRowSubtotalLevels: number[];
  normalizedColSubtotalLevels: number[];
  rowSubtotalDepths: number[];
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
  hideMetricHeaderOnCols: boolean;
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
  } = layout;
  const metricVerboseMap = formData.verboseMap as
    | Record<string, string>
    | undefined;

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
    () => layout.groupbyRows.map(getStableColumnKey),
    [layout.groupbyRows],
  );
  const groupbyColumnKeys = useMemo(
    () => layout.groupbyColumns.map(getStableColumnKey),
    [layout.groupbyColumns],
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
      !isLeafTierVisible &&
      metricLabels.length === 1 &&
      metricIndexOnRows !== undefined &&
      metricIndexOnRows === rowDimCount &&
      rowDimCount > 0,
    [
      isLeafTierVisible,
      metricIndexOnRows,
      metricLabels.length,
      resolvedMetricsLayout,
      rowDimCount,
    ],
  );
  const hideMetricHeaderOnCols = useMemo(
    () =>
      resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
      !isLeafTierVisible &&
      metricLabels.length === 1 &&
      metricIndexOnCols !== undefined &&
      metricIndexOnCols === colDimCount &&
      colDimCount > 0,
    [
      colDimCount,
      isLeafTierVisible,
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
    (metricKey: string) =>
      resolveMetricDisplayLabel(metricKey, {
        metricLabelMap,
        verboseMap: metricVerboseMap,
        metrics,
      }),
    [metricLabelMap, metricVerboseMap, metrics],
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

  const pathHasValuesLevel = useCallback(
    (axis: 'row' | 'col', path: PivotTreeNode['path']) =>
      resolveAxisProjection({
        program: layout.pivotProgram,
        axis,
        path: path.filter(val => !isSubtotalToken(val)),
      }).valuesLevelSeen,
    [layout.pivotProgram],
  );

  const getAxisChildProjection = useCallback(
    (axis: 'row' | 'col', parent: PivotTreeNode, child: PivotTreeNode) =>
      resolveAxisChildProjection({
        program: layout.pivotProgram,
        axis,
        parentPath: parent.path,
        childPath: child.path,
      }),
    [layout.pivotProgram],
  );

  const filterChildrenByMetricPosition = useCallback(
    (
      axis: 'row' | 'col',
      parent: PivotTreeNode,
      children: PivotTreeNode[],
      metricIndex?: number,
    ) => {
      if (pathHasValuesLevel(axis, parent.path)) {
        return children;
      }
      if (metricIndex === undefined) {
        return children;
      }
      return children.filter(child => {
        if (child.path.length <= metricIndex) {
          return true;
        }
        return (
          getAxisChildProjection(axis, parent, child).rawValuesTokenIndex ===
          metricIndex
        );
      });
    },
    [getAxisChildProjection, pathHasValuesLevel],
  );

  const filterChildrenIntroducingValues = useCallback(
    (
      axis: 'row' | 'col',
      parent: PivotTreeNode,
      children: PivotTreeNode[],
      keepValuesChild: (
        child: PivotTreeNode,
        hasNonValuesChildren: boolean,
      ) => boolean,
    ) => {
      const projected = children.map(child => ({
        child,
        introducesValues: getAxisChildProjection(axis, parent, child)
          .introducesValues,
      }));
      const hasNonValuesChildren = projected.some(
        child => !child.introducesValues,
      );
      return projected
        .filter(
          ({ child, introducesValues }) =>
            !introducesValues || keepValuesChild(child, hasNonValuesChildren),
        )
        .map(({ child }) => child);
    },
    [getAxisChildProjection],
  );

  const getAxisChildrenBeforeSubtotalPolicy = useCallback(
    ({
      axis,
      parent,
      nodes,
      metricIndex,
      metricLayoutIndex,
      groupbyLength,
      hideMetricHeader,
      metricsFirst,
      keepValuesChild,
    }: {
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
    }) => {
      const children = findChildren(nodes, parent);
      let filtered = filterChildrenByMetricPosition(
        axis,
        parent,
        children,
        metricIndex,
      );
      const expectedMetricsLayout =
        axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;
      if (
        resolvedMetricsLayout === expectedMetricsLayout &&
        parent.axis === axis &&
        parent.level < groupbyLength &&
        (metricLayoutIndex === undefined || metricLayoutIndex > parent.level)
      ) {
        const withoutMetrics = filterChildrenIntroducingValues(
          axis,
          parent,
          children,
          keepValuesChild,
        );
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
    },
    [
      filterChildrenByMetricPosition,
      filterChildrenIntroducingValues,
      isMetricGrandTotalNode,
      isMetricTokenValue,
      resolvedMetricsLayout,
    ],
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

  const getCollapsedValuesNodesForAxis = useCallback(
    ({
      axis,
      parent,
      expandedSet,
      nodes,
      exposeCollapsedMetricTier,
      metricsAtEnd,
      suppressSubtotalParent,
      normalizeSubtotalExisting,
    }: {
      axis: 'row' | 'col';
      parent: PivotTreeNode;
      expandedSet: Set<string>;
      nodes: Record<string, PivotTreeNode>;
      exposeCollapsedMetricTier: boolean;
      metricsAtEnd: boolean;
      suppressSubtotalParent: boolean;
      normalizeSubtotalExisting: boolean;
    }) => {
      const expectedMetricsLayout =
        axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;
      if (
        !exposeCollapsedMetricTier ||
        resolvedMetricsLayout !== expectedMetricsLayout ||
        expandedSet.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (
        suppressSubtotalParent &&
        (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent))
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
      const collapsedMetrics = resolveCollapsedValuesProjection({
        program: layout.pivotProgram,
        axis,
        parentPath: parent.path,
        sourceMetricPaths: metricNodes.map(node => node.path),
      });
      return collapsedMetrics.map(metric => {
        const collapsedKey = serializePath(metric.metricPath);
        const existing = nodes[collapsedKey];
        const sourceNode = nodes[serializePath(metric.sourceMetricPath)];
        const hasChildren = metricsAtEnd
          ? false
          : findChildren(
              nodes,
              existing || { ...parent, path: metric.metricPath },
            ).length > 0 || metric.hasProjectedChildren;
        if (existing) {
          if (normalizeSubtotalExisting && isMetricSubtotalNode(existing)) {
            return {
              ...existing,
              label: metric.metricKey,
              formattedLabel: metric.metricKey,
              isSubtotal: false,
              hasChildren,
            };
          }
          return { ...existing, hasChildren };
        }
        return {
          ...(sourceNode || metricNodes[0]),
          key: collapsedKey,
          path: metric.metricPath,
          label: metric.metricKey,
          formattedLabel: metric.metricKey,
          level: metric.metricPath.length,
          hasChildren,
        };
      });
    },
    [
      getMetricDepthForParent,
      getMetricTierNodes,
      isExplicitSubtotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      layout.pivotProgram,
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
      const isMetricSubtotalAtMetricTier = (node: PivotTreeNode) => {
        const subtotalIndex = node.path.findIndex(val => isSubtotalToken(val));
        if (subtotalIndex <= 0) {
          return false;
        }
        const prev = node.path[subtotalIndex - 1];
        return isMetricTokenValue(prev);
      };
      let filtered = getAxisChildrenBeforeSubtotalPolicy({
        axis: 'row',
        parent,
        nodes,
        metricIndex: metricIndexOverride ?? metricIndexOnRows,
        metricLayoutIndex: metricLayoutIndexOnRows,
        groupbyLength: groupbyRows.length,
        hideMetricHeader: hideMetricHeaderOnRows,
        metricsFirst: metricsFirstOnRows,
        keepValuesChild: (child, hasNonMetricChildren) => {
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
        },
      });
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
          if (!isSubtotalToken(node.path[parent.path.length])) {
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
            if (
              resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
              isMultiMetric &&
              isMetricSubtotalAtMetricTier(node)
            ) {
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
      return filtered;
    },
    [
      colTotals,
      countDimDepth,
      getAxisChildrenBeforeSubtotalPolicy,
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
    ],
  );

  const getColChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
      metricIndexOverride?: number,
    ) => {
      const allowMetricSubtotals = normalizedColSubtotalLevels.length > 0;
      return getAxisChildrenBeforeSubtotalPolicy({
        axis: 'col',
        parent,
        nodes,
        metricIndex: metricIndexOverride ?? metricIndexOnCols,
        metricLayoutIndex: metricLayoutIndexOnCols,
        groupbyLength: groupbyColumns.length,
        hideMetricHeader: hideMetricHeaderOnCols,
        metricsFirst: metricsFirstOnCols,
        keepValuesChild: child =>
          allowMetricSubtotals
            ? isMetricGrandTotalNode(child) || isMetricSubtotalNode(child)
            : isMetricGrandTotalNode(child),
      });
    },
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
      isExplicitSubtotalNode,
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
    isMultiMetric,
    groupbyRowKeys,
    groupbyColumnKeys,
    normalizedRowSubtotalLevels,
    normalizedColSubtotalLevels,
    rowSubtotalDepths,
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
    hideMetricHeaderOnCols,
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
    findMetricIndex,
    getCollapsedRowChildrenForNodes,
    getCollapsedColLeavesForNodes,
    getRowChildrenForNodes,
    getColChildrenForNodes,
    pruneMergedTree,
  };
};
