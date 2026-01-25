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
  DataRecordValue,
  GenericDataType,
  getColumnLabel,
} from '@superset-ui/core';
import {
  type PivotSortMode,
  type PivotSortOrder,
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
  MetricsLayoutEnum,
} from '../../types';
import { buildColumnDisplayPath } from '../columnDisplay';
import { getExpandedDepths } from '../visibility';
import { buildFormattingValueMaps } from '../cellUtils';
import {
  normalizeDimensionSortingMapWithKeys,
  getFormattingMetricKey,
  isMeasureLeafToken,
  serializePath,
} from '../../utils';
import {
  buildRenderModel,
  type RenderModelConfig,
} from '../render/renderModel';
import { compareValues, rootKey, sortByOrder } from '../viewModel';
import { type RenderModel } from '../shared/types';
import {
  isExplicitTotalNode as isExplicitTotalNodeBase,
  getNodeDimDepth as getNodeDimDepthBase,
} from '../metricsTotals';
import { type PivotLayoutResult } from './usePivotLayout';

type DimensionSortingKeys = {
  metricKey?: string;
  order: PivotSortOrder;
  mode: PivotSortMode;
};

const DEFAULT_DIMENSION_SORT_ORDER: PivotSortOrder = 'asc';

export type PivotRenderModelResult = {
  renderModel: RenderModel;
  showRowSpinner: (key: string) => boolean;
  showColSpinner: (key: string) => boolean;
  showGlobalLoader: boolean;
  shouldShowToggle: (axis: 'row' | 'col', node?: PivotTreeNode) => boolean;
  isRowAggregateBold: (node?: PivotTreeNode) => boolean;
  isColAggregateBold: (node?: PivotTreeNode) => boolean;
  getNodeDimDepth: (node: PivotTreeNode) => number;
  rowValuesMap: Map<string, Record<string, DataRecordValue>>;
  colValuesMap: Map<string, Record<string, DataRecordValue>>;
  expandedRowsForRender: Set<string>;
  expandedColsForRender: Set<string>;
};

const buildDimensionSortingKeyMap = (sorting: PivotDimensionSortingMap) => {
  const next: Record<string, DimensionSortingKeys> = {};
  Object.entries(sorting).forEach(([dimensionKey, dimensionSorting]) => {
    if (!dimensionKey) {
      return;
    }
    const metricKey = dimensionSorting.metric
      ? getFormattingMetricKey(dimensionSorting.metric)
      : '';
    next[dimensionKey] = {
      metricKey: metricKey || undefined,
      order: dimensionSorting.order ?? DEFAULT_DIMENSION_SORT_ORDER,
      mode: dimensionSorting.mode ?? 'total',
    };
  });
  return next;
};

export const usePivotRenderModel = ({
  tree,
  expandedRows,
  expandedCols,
  loadingKeys,
  isHydrating,
  formData,
  rowOrder,
  colOrder,
  groupbyRows,
  groupbyColumns,
  colTypeMap,
  rowTotals,
  colTotals,
  rowSubTotals,
  layout,
}: {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  loadingKeys: Set<string>;
  isHydrating: boolean;
  formData: PivotTableProps['formData'];
  rowOrder: PivotTableProps['rowOrder'];
  colOrder: PivotTableProps['colOrder'];
  groupbyRows: PivotTableProps['groupbyRows'];
  groupbyColumns: PivotTableProps['groupbyColumns'];
  colTypeMap: PivotTableProps['colTypeMap'];
  rowTotals: boolean;
  colTotals: boolean;
  rowSubTotals: boolean;
  layout: PivotLayoutResult;
}): PivotRenderModelResult => {
  const rowSorting = useMemo(
    () =>
      normalizeDimensionSortingMapWithKeys(formData.rowSorting, groupbyRows),
    [formData.rowSorting, groupbyRows],
  );
  const colSorting = useMemo(
    () =>
      normalizeDimensionSortingMapWithKeys(formData.colSorting, groupbyColumns),
    [formData.colSorting, groupbyColumns],
  );
  const rowSortingKeyMap = useMemo(
    () => buildDimensionSortingKeyMap(rowSorting),
    [rowSorting],
  );
  const colSortingKeyMap = useMemo(
    () => buildDimensionSortingKeyMap(colSorting),
    [colSorting],
  );
  const hasRowSorting = useMemo(
    () => Object.keys(rowSortingKeyMap).length > 0,
    [rowSortingKeyMap],
  );

  const { rowValuesMap, colValuesMap } = useMemo(
    () =>
      buildFormattingValueMaps({
        cells: tree.cells,
        rows: tree.rows,
        cols: tree.cols,
        getNonMetricPathParts: layout.getNonMetricPathParts,
        rootKey,
      }),
    [layout.getNonMetricPathParts, tree.cells, tree.cols, tree.rows],
  );
  const rowSortingValuesMap = rowValuesMap;
  const colSortingValuesMap = colValuesMap;

  const resolveSortConfig = useCallback(
    (axis: 'row' | 'col', a: PivotTreeNode, b: PivotTreeNode) => {
      const dimensionKey =
        layout.getDimensionKeyForNode(a, axis) ||
        layout.getDimensionKeyForNode(b, axis);
      if (!dimensionKey) {
        return undefined;
      }
      const map = axis === 'row' ? rowSortingKeyMap : colSortingKeyMap;
      return map[dimensionKey];
    },
    [colSortingKeyMap, layout, rowSortingKeyMap],
  );

  const getSortValue = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode, metricKey: string) => {
      const nonMetricKey = serializePath(
        layout.getNonMetricPathParts(node.path),
      );
      const valuesMap =
        axis === 'row' ? rowSortingValuesMap : colSortingValuesMap;
      return valuesMap.get(nonMetricKey)?.[metricKey];
    },
    [colSortingValuesMap, layout, rowSortingValuesMap],
  );

  const compareMetricSort = useCallback(
    (axis: 'row' | 'col', a: PivotTreeNode, b: PivotTreeNode) => {
      const config = resolveSortConfig(axis, a, b);
      if (!config) {
        return 0;
      }
      if (!config.metricKey) {
        const dimensionKey =
          layout.getDimensionKeyForNode(a, axis) ||
          layout.getDimensionKeyForNode(b, axis);
        const type = dimensionKey ? colTypeMap?.[dimensionKey] : undefined;
        const cmp = compareValues(a.label, b.label, type);
        return config.order === 'asc' ? cmp : -cmp;
      }
      if (config.mode !== 'total') {
        return 0;
      }
      const aValue = getSortValue(axis, a, config.metricKey);
      const bValue = getSortValue(axis, b, config.metricKey);
      if (aValue === undefined || bValue === undefined) {
        return 0;
      }
      const type =
        typeof aValue === 'number' && typeof bValue === 'number'
          ? GenericDataType.Numeric
          : undefined;
      const cmp = compareValues(aValue, bValue, type);
      return config.order === 'asc' ? cmp : -cmp;
    },
    [colTypeMap, getSortValue, layout, resolveSortConfig],
  );

  const rowSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      rowOrder,
      colTypeMap,
      groupbyRows.map(getColumnLabel),
    );
    const pushMetricTotalsToEnd =
      (colTotals && layout.resolvedColTotalPosition === 'end') ||
      (rowSubTotals && layout.effectiveRowSubtotalPosition === 'end');
    const pullMetricTotalsToStart =
      colTotals && layout.resolvedColTotalPosition === 'start';
    if (
      !rowSubTotals &&
      !pushMetricTotalsToEnd &&
      !pullMetricTotalsToStart &&
      !hasRowSorting
    ) {
      return baseSorter;
    }
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      if (pullMetricTotalsToStart) {
        const aMetricTotal = layout.isMetricGrandTotalNode(a) ? 1 : 0;
        const bMetricTotal = layout.isMetricGrandTotalNode(b) ? 1 : 0;
        if (aMetricTotal !== bMetricTotal) {
          return bMetricTotal - aMetricTotal;
        }
      }
      const aSubtotal =
        layout.isExplicitSubtotalNode(a) ||
        (pushMetricTotalsToEnd && layout.isMetricGrandTotalNode(a))
          ? 1
          : 0;
      const bSubtotal =
        layout.isExplicitSubtotalNode(b) ||
        (pushMetricTotalsToEnd && layout.isMetricGrandTotalNode(b))
          ? 1
          : 0;
      if (aSubtotal !== bSubtotal) {
        return aSubtotal - bSubtotal;
      }
      const metricOrder = layout.compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      const metricSort = compareMetricSort('row', a, b);
      if (metricSort !== 0) {
        return metricSort;
      }
      return baseSorter(a, b);
    };
  }, [
    colTotals,
    colTypeMap,
    compareMetricSort,
    groupbyRows,
    hasRowSorting,
    layout,
    rowOrder,
    rowSubTotals,
  ]);

  const colSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      colOrder,
      colTypeMap,
      groupbyColumns.map(getColumnLabel),
    );
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      const metricOrder = layout.compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      const metricSort = compareMetricSort('col', a, b);
      if (metricSort !== 0) {
        return metricSort;
      }
      return baseSorter(a, b);
    };
  }, [colOrder, colTypeMap, compareMetricSort, groupbyColumns, layout]);

  const colNonMetricDepths = useMemo(() => {
    const depthMap = new Map<string, number>();
    Object.values(tree.cols).forEach(node => {
      const parts = layout.getNonMetricPathParts(node.path);
      for (let i = 0; i <= parts.length; i += 1) {
        const prefixKey = serializePath(parts.slice(0, i));
        const prev = depthMap.get(prefixKey) ?? 0;
        if (parts.length > prev) {
          depthMap.set(prefixKey, parts.length);
        }
      }
    });
    return depthMap;
  }, [layout, tree.cols]);

  const hasDeeperNonMetricDescendants = useCallback(
    (col: PivotTreeNode) => {
      const parts = layout.getNonMetricPathParts(col.path);
      const key = serializePath(parts);
      const maxDepth = colNonMetricDepths.get(key) ?? parts.length;
      return maxDepth > parts.length;
    },
    [colNonMetricDepths, layout],
  );

  const getColumnDisplayPath = useCallback(
    (col: PivotTreeNode, maxDepth: number) => {
      if (
        layout.resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
        layout.metricsFirstOnCols &&
        expandedCols.has(col.key)
      ) {
        const metricLabel = layout.getMetricLabelFromPath(col.path);
        if (metricLabel && col.path.length < maxDepth) {
          const totalLabel = metricLabel;
          return [
            ...col.path,
            ...Array(Math.max(maxDepth - col.path.length, 0)).fill(totalLabel),
          ];
        }
      }
      return buildColumnDisplayPath(col, maxDepth, {
        metricsLayout: layout.resolvedMetricsLayout,
        metricsFirstOnCols: layout.metricsFirstOnCols,
        metricsAtColEnd: layout.metricsAtColEnd,
        allowMetricSubtotalLabels:
          layout.normalizedColSubtotalLevels.length > 0,
        hasDeeperNonMetricDescendants,
        metricLabels: layout.metricLabels,
        isExplicitSubtotalNode: layout.isExplicitSubtotalNode,
        getMetricLabelFromPath: layout.getMetricLabelFromPath,
        getNonMetricPathParts: layout.getNonMetricPathParts,
        isMetricGrandTotalNode: layout.isMetricGrandTotalNode,
        isMetricSubtotalNode: layout.isMetricSubtotalNode,
      });
    },
    [expandedCols, hasDeeperNonMetricDescendants, layout],
  );

  const buildRenderModelConfig = useCallback(
    (
      nextExpandedRows: Set<string>,
      nextExpandedCols: Set<string>,
      nextTree: PivotTreeData,
    ): RenderModelConfig => {
      const metricIndexForRowsResolved =
        layout.findMetricIndex(nextTree.rows) ??
        layout.metricLayoutIndexOnRows ??
        layout.metricIndexOnRows;
      const metricIndexForColsResolved =
        layout.findMetricIndex(nextTree.cols) ??
        layout.metricLayoutIndexOnCols ??
        layout.metricIndexOnCols;
      return {
        groupbyRowsLength: groupbyRows.length,
        groupbyColumnsLength: groupbyColumns.length,
        normalizedRowSubtotalLevels: layout.normalizedRowSubtotalLevels,
        normalizedColSubtotalLevels: layout.normalizedColSubtotalLevels,
        rowTotals,
        colTotals,
        rowTotalPosition: layout.resolvedColTotalPosition,
        colTotalPosition: layout.resolvedRowTotalPosition,
        resolvedColSubtotalPosition: layout.effectiveColSubtotalPosition,
        resolvedMetricsLayout: layout.resolvedMetricsLayout,
        isMultiMetric: layout.isMultiMetric,
        metricsFirstOnCols: layout.metricsFirstOnCols,
        hideMetricHeaderOnRows: layout.hideMetricHeaderOnRows,
        hideMetricHeaderOnCols: layout.hideMetricHeaderOnCols,
        rowSorter,
        colSorter,
        getRowChildren: parent =>
          layout.getRowChildrenForNodes(
            parent,
            nextTree.rows,
            metricIndexForRowsResolved,
          ),
        getCollapsedRowChildren: parent =>
          layout.getCollapsedRowChildrenForNodes(
            parent,
            nextExpandedRows,
            nextTree.rows,
          ),
        getColChildren: parent =>
          layout.getColChildrenForNodes(
            parent,
            nextTree.cols,
            metricIndexForColsResolved,
          ),
        getCollapsedColLeaves: parent =>
          layout.getCollapsedColLeavesForNodes(
            parent,
            nextExpandedCols,
            nextTree.cols,
          ),
        countDimDepth: layout.countDimDepth,
        isMetricGrandTotalNode: layout.isMetricGrandTotalNode,
        isMetricSubtotalNode: layout.isMetricSubtotalNode,
        isMetricTokenValue: layout.isMetricTokenValue,
        getColumnDisplayPath,
      };
    },
    [
      colSorter,
      colTotals,
      getColumnDisplayPath,
      groupbyColumns.length,
      groupbyRows.length,
      layout,
      rowSorter,
      rowTotals,
    ],
  );

  const isLeafTierVisible =
    layout.measureHierarchy.kind === 'measureStackV1' &&
    layout.measureHierarchy.leafTierVisibility === 'visible';
  const expandedRowsForRender = useMemo(() => {
    if (!isLeafTierVisible) {
      return expandedRows;
    }
    const next = new Set(expandedRows);
    Object.values(tree.rows).forEach(node => {
      if (layout.isMetricTokenValue(node.path[node.path.length - 1])) {
        next.add(node.key);
      }
    });
    return next;
  }, [expandedRows, isLeafTierVisible, layout, tree.rows]);
  const expandedColsForRender = useMemo(() => {
    if (!isLeafTierVisible) {
      return expandedCols;
    }
    const next = new Set(expandedCols);
    Object.values(tree.cols).forEach(node => {
      if (layout.isMetricTokenValue(node.path[node.path.length - 1])) {
        next.add(node.key);
      }
    });
    return next;
  }, [expandedCols, isLeafTierVisible, layout, tree.cols]);

  const renderModel = useMemo(
    () =>
      buildRenderModel({
        tree,
        expandedRows: expandedRowsForRender,
        expandedCols: expandedColsForRender,
        config: buildRenderModelConfig(
          expandedRowsForRender,
          expandedColsForRender,
          tree,
        ),
      }),
    [
      buildRenderModelConfig,
      expandedColsForRender,
      expandedRowsForRender,
      tree,
    ],
  );

  const expandedRowDepths = useMemo(
    () =>
      getExpandedDepths(
        expandedRowsForRender,
        tree.rows,
        groupbyRows.length,
        layout.countDimDepth,
      ),
    [
      expandedRowsForRender,
      groupbyRows.length,
      layout.countDimDepth,
      tree.rows,
    ],
  );
  const expandedColDepths = useMemo(
    () =>
      getExpandedDepths(
        expandedColsForRender,
        tree.cols,
        groupbyColumns.length,
        layout.countDimDepth,
      ),
    [
      expandedColsForRender,
      groupbyColumns.length,
      layout.countDimDepth,
      tree.cols,
    ],
  );

  const isExplicitTotalNode = useCallback(
    (node: PivotTreeNode) =>
      isExplicitTotalNodeBase(node, {
        metricLabelSet: layout.metricLabelSet,
        metricsFirstOnRows: layout.metricsFirstOnRows,
        metricsFirstOnCols: layout.metricsFirstOnCols,
      }),
    [
      layout.metricLabelSet,
      layout.metricsFirstOnCols,
      layout.metricsFirstOnRows,
    ],
  );

  const getNodeDimDepth = useCallback(
    (node: PivotTreeNode) =>
      getNodeDimDepthBase(node, {
        metricLabelSet: layout.metricLabelSet,
        metricsLayout: layout.resolvedMetricsLayout,
        hideMetricHeaderOnRows: layout.hideMetricHeaderOnRows,
        metricLayoutIndexOnRows: layout.metricLayoutIndexOnRows,
      }),
    [
      layout.hideMetricHeaderOnRows,
      layout.metricLabelSet,
      layout.metricLayoutIndexOnRows,
      layout.resolvedMetricsLayout,
    ],
  );

  const shouldShowToggle = useCallback(
    (axis: 'row' | 'col', node?: PivotTreeNode) => {
      if (!node || !node.hasChildren || node.path.length === 0) {
        return false;
      }
      if (
        layout.isExplicitSubtotalNode(node) ||
        layout.isMetricGrandTotalNode(node)
      ) {
        return false;
      }
      const hideMetricParentToggle =
        axis === 'row'
          ? layout.resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
            layout.isMultiMetric &&
            layout.metricLayoutIndexOnRows !== undefined &&
            layout.metricLayoutIndexOnRows > 0 &&
            layout.metricLayoutIndexOnRows < groupbyRows.length &&
            node.path.length === layout.metricLayoutIndexOnRows &&
            !node.path.some(val => layout.isMetricTokenValue(val))
          : layout.resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
            layout.isMultiMetric &&
            layout.metricLayoutIndexOnCols !== undefined &&
            layout.metricLayoutIndexOnCols > 0 &&
            layout.metricLayoutIndexOnCols < groupbyColumns.length &&
            node.path.length === layout.metricLayoutIndexOnCols &&
            !node.path.some(val => layout.isMetricTokenValue(val));
      if (hideMetricParentToggle) {
        return false;
      }
      if (isLeafTierVisible) {
        const tail = node.path[node.path.length - 1];
        if (layout.isMetricTokenValue(tail) || isMeasureLeafToken(tail)) {
          return false;
        }
      }
      return true;
    },
    [groupbyColumns.length, groupbyRows.length, isLeafTierVisible, layout],
  );

  const isRowAggregateBold = useCallback(
    (row?: PivotTreeNode) => {
      if (!row) {
        return false;
      }
      if (isExplicitTotalNode(row)) {
        return true;
      }
      if (!row.hasChildren) {
        return false;
      }
      const dimDepth = layout.countDimDepth(row.path);
      if (dimDepth >= groupbyRows.length) {
        return false;
      }
      return expandedRowDepths.has(dimDepth);
    },
    [expandedRowDepths, groupbyRows.length, isExplicitTotalNode, layout],
  );

  const isColAggregateBold = useCallback(
    (col?: PivotTreeNode) => {
      if (!col) {
        return false;
      }
      if (isExplicitTotalNode(col)) {
        return true;
      }
      if (!col.hasChildren) {
        return false;
      }
      const dimDepth = layout.countDimDepth(col.path);
      if (dimDepth >= groupbyColumns.length) {
        return false;
      }
      return expandedColDepths.has(dimDepth);
    },
    [expandedColDepths, groupbyColumns.length, isExplicitTotalNode, layout],
  );

  const showRowSpinner = useCallback(
    (key: string) => loadingKeys.has(key),
    [loadingKeys],
  );
  const showColSpinner = useCallback(
    (key: string) => loadingKeys.has(key),
    [loadingKeys],
  );
  const showGlobalLoader = isHydrating;

  return {
    renderModel,
    expandedRowsForRender,
    expandedColsForRender,
    showRowSpinner,
    showColSpinner,
    showGlobalLoader,
    shouldShowToggle,
    isRowAggregateBold,
    isColAggregateBold,
    getNodeDimDepth,
    rowValuesMap,
    colValuesMap,
  };
};
