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
  type PivotDimensionSortingMap,
} from '../../types';
import { buildFormattingValueMaps } from '../cellUtils';
import {
  normalizeDimensionSortingMapWithKeys,
  getFormattingMetricKey,
  serializeCellKey,
  serializePath,
  isSubtotalToken,
} from '../../utils';
import { buildRenderModel } from '../render/renderModel';
import { resolveAxisProjection } from '../runtime/projection';
import { resolveMeasureSortMetricKey } from '../measureLeaves';
import { compareValues, rootKey, sortByOrder } from '../viewModel';
import { type RenderModel } from '../shared/types';
import { getMetricIndexFromNodes } from '../metricsTotals';
import { type PivotLayoutResult } from './usePivotLayout';
import { type PivotColumnSortState } from './columnSort';
import {
  buildColumnDisplayPath,
  buildRenderNodeDisplayState,
  expandMetricNodesForRender,
  formatRenderTreeDateLabels,
  resolveColumnHeaderLabel,
} from './renderDisplay';

type DimensionSortingKeys = {
  metricKey?: string;
  order: PivotSortOrder;
  mode: PivotSortMode;
};

const DEFAULT_DIMENSION_SORT_ORDER: PivotSortOrder = 'asc';

const compareSortValues = (
  aValue: DataRecordValue | undefined,
  bValue: DataRecordValue | undefined,
  order: PivotSortOrder,
) => {
  const aMissing = aValue === null || aValue === undefined;
  const bMissing = bValue === null || bValue === undefined;
  if (aMissing || bMissing) {
    return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  }
  const type =
    typeof aValue === 'number' && typeof bValue === 'number'
      ? GenericDataType.Numeric
      : undefined;
  const cmp = compareValues(aValue, bValue, type);
  return order === 'asc' ? cmp : -cmp;
};

export type PivotRenderModelResult = {
  renderTree: PivotTreeData;
  renderModel: RenderModel;
  shouldShowToggle: (axis: 'row' | 'col', node?: PivotTreeNode) => boolean;
  isRowAggregateBold: (node?: PivotTreeNode) => boolean;
  isColAggregateBold: (node?: PivotTreeNode) => boolean;
  getNodeDimDepth: (node: PivotTreeNode) => number;
  rowValuesMap: Map<string, Record<string, DataRecordValue>>;
  colValuesMap: Map<string, Record<string, DataRecordValue>>;
  expandedRowsForRender: Set<string>;
  expandedColsForRender: Set<string>;
};

const buildDimensionSortingKeyMap = (
  sorting: PivotDimensionSortingMap,
  layout: PivotLayoutResult,
) => {
  const next: Record<string, DimensionSortingKeys> = {};
  Object.entries(sorting).forEach(([dimensionKey, dimensionSorting]) => {
    if (!dimensionKey) {
      return;
    }
    const metricKey = dimensionSorting.metric
      ? resolveMeasureSortMetricKey({
          metricKey: getFormattingMetricKey(dimensionSorting.metric),
          measureHierarchy: layout.measureHierarchy,
        })
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
  formData,
  rowOrder,
  colOrder,
  colTypeMap,
  rowTotals,
  colTotals,
  rowSubTotals,
  layout,
  uiColumnSort,
}: {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  formData: PivotTableProps['formData'];
  rowOrder: PivotTableProps['rowOrder'];
  colOrder: PivotTableProps['colOrder'];
  colTypeMap: PivotTableProps['colTypeMap'];
  rowTotals: boolean;
  colTotals: boolean;
  rowSubTotals: boolean;
  layout: PivotLayoutResult;
  uiColumnSort?: PivotColumnSortState | null;
}): PivotRenderModelResult => {
  const resolvedGroupbyRows = layout.layout.groupbyRows;
  const resolvedGroupbyColumns = layout.layout.groupbyColumns;
  const resolvedGroupbyRowsLength = resolvedGroupbyRows.length;
  const resolvedGroupbyColumnsLength = resolvedGroupbyColumns.length;

  const rowSortingKeyMap = useMemo(
    () =>
      buildDimensionSortingKeyMap(
        normalizeDimensionSortingMapWithKeys(
          formData.rowSorting,
          resolvedGroupbyRows,
        ),
        layout,
      ),
    [formData.rowSorting, layout, resolvedGroupbyRows],
  );
  const colSortingKeyMap = useMemo(
    () =>
      buildDimensionSortingKeyMap(
        normalizeDimensionSortingMapWithKeys(
          formData.colSorting,
          resolvedGroupbyColumns,
        ),
        layout,
      ),
    [formData.colSorting, layout, resolvedGroupbyColumns],
  );
  const hasRowSorting = Object.keys(rowSortingKeyMap).length > 0;

  const { dateFormatters } = formData;
  const renderTree = useMemo(
    () =>
      formatRenderTreeDateLabels({
        tree,
        dateFormatters,
        getDimensionKeyForNode: layout.getDimensionKeyForNode,
        getNonMetricPathParts: layout.getNonMetricPathParts,
      }),
    [
      dateFormatters,
      layout.getDimensionKeyForNode,
      layout.getNonMetricPathParts,
      tree,
    ],
  );

  const getProjectedPathParts = useCallback(
    (axis: 'row' | 'col', path: PivotTreeNode['path']) =>
      resolveAxisProjection({
        program: layout.layout.pivotProgram,
        axis,
        path: path.filter(value => !isSubtotalToken(value)),
      }).projectedDimensionPath,
    [layout.layout.pivotProgram],
  );

  const { rowValuesMap, colValuesMap } = useMemo(
    () =>
      buildFormattingValueMaps({
        cells: renderTree.cells,
        rows: renderTree.rows,
        cols: renderTree.cols,
        getRowNonMetricPathParts: path => getProjectedPathParts('row', path),
        getColNonMetricPathParts: path => getProjectedPathParts('col', path),
        rootKey,
      }),
    [getProjectedPathParts, renderTree],
  );

  const compareMetricSort = useCallback(
    (axis: 'row' | 'col', a: PivotTreeNode, b: PivotTreeNode) => {
      const dimensionKey =
        layout.getDimensionKeyForNode(a, axis) ||
        layout.getDimensionKeyForNode(b, axis);
      if (!dimensionKey) {
        return 0;
      }
      const config = (axis === 'row' ? rowSortingKeyMap : colSortingKeyMap)[
        dimensionKey
      ];
      if (!config) {
        return 0;
      }
      if (!config.metricKey) {
        const type = colTypeMap?.[dimensionKey];
        const cmp = compareValues(a.label, b.label, type);
        return config.order === 'asc' ? cmp : -cmp;
      }
      if (config.mode !== 'total') {
        return 0;
      }
      const { metricKey } = config;
      const valuesMap = axis === 'row' ? rowValuesMap : colValuesMap;
      const getSortValue = (node: PivotTreeNode) =>
        valuesMap.get(serializePath(getProjectedPathParts(axis, node.path)))?.[
          metricKey
        ];
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);
      return compareSortValues(aValue, bValue, config.order);
    },
    [
      colSortingKeyMap,
      colTypeMap,
      colValuesMap,
      getProjectedPathParts,
      layout,
      rowSortingKeyMap,
      rowValuesMap,
    ],
  );

  const rowSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      rowOrder,
      colTypeMap,
      resolvedGroupbyRows.map(getColumnLabel),
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
      !hasRowSorting &&
      !uiColumnSort
    ) {
      return baseSorter;
    }
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      if (pullMetricTotalsToStart) {
        const metricTotalOrder =
          Number(layout.isMetricGrandTotalNode(b)) -
          Number(layout.isMetricGrandTotalNode(a));
        if (metricTotalOrder !== 0) {
          return metricTotalOrder;
        }
      }
      const subtotalOrder =
        Number(
          layout.isExplicitSubtotalNode(a) ||
            (pushMetricTotalsToEnd && layout.isMetricGrandTotalNode(a)),
        ) -
        Number(
          layout.isExplicitSubtotalNode(b) ||
            (pushMetricTotalsToEnd && layout.isMetricGrandTotalNode(b)),
        );
      if (subtotalOrder !== 0) {
        return subtotalOrder;
      }
      const metricOrder = layout.compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      if (uiColumnSort) {
        const aValue =
          renderTree.cells[serializeCellKey(a.key, uiColumnSort.colKey)]
            ?.values[uiColumnSort.metricKey];
        const bValue =
          renderTree.cells[serializeCellKey(b.key, uiColumnSort.colKey)]
            ?.values[uiColumnSort.metricKey];
        const uiColumnSortCmp = compareSortValues(
          aValue,
          bValue,
          uiColumnSort.order,
        );
        if (uiColumnSortCmp !== 0) {
          return uiColumnSortCmp;
        }
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
    resolvedGroupbyRows,
    hasRowSorting,
    layout,
    renderTree.cells,
    rowOrder,
    rowSubTotals,
    uiColumnSort,
  ]);

  const colSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      colOrder,
      colTypeMap,
      resolvedGroupbyColumns.map(getColumnLabel),
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
  }, [colOrder, colTypeMap, compareMetricSort, layout, resolvedGroupbyColumns]);

  const getColumnDisplayPath = useCallback(
    (col: PivotTreeNode, maxDepth: number) =>
      buildColumnDisplayPath(col, maxDepth, {
        metricsLayout: layout.resolvedMetricsLayout,
        metricsFirstOnCols: layout.metricsFirstOnCols,
        metricsAtColEnd: layout.metricsAtColEnd,
        allowMetricSubtotalLabels: layout.normalizedColSubtotalLevels.some(
          level => level > 0,
        ),
        metricLabels: layout.metricLabels,
        isExplicitSubtotalNode: layout.isExplicitSubtotalNode,
        getMetricKeyFromPath: layout.getMetricLabelFromPath,
        getMetricDisplayLabelForKey: layout.getMetricDisplayLabelForKey,
        getNonMetricPathParts: path => getProjectedPathParts('col', path),
        isMetricGrandTotalNode: layout.isMetricGrandTotalNode,
        isMetricSubtotalNode: layout.isMetricSubtotalNode,
        isExpanded: node => expandedCols.has(node.key),
      }),
    [expandedCols, getProjectedPathParts, layout],
  );

  const getColumnHeaderLabel = useCallback(
    (rawValue: DataRecordValue) =>
      resolveColumnHeaderLabel({
        rawValue,
        measureHierarchy: layout.measureHierarchy,
        getMetricDisplayLabelForKey: layout.getMetricDisplayLabelForKey,
      }),
    [layout],
  );

  const isLeafTierVisible =
    layout.measureHierarchy.kind === 'measureStackV1' &&
    layout.measureHierarchy.leafTierVisibility === 'visible';
  const expandedRowsForRender = useMemo(
    () =>
      expandMetricNodesForRender({
        expanded: expandedRows,
        nodes: renderTree.rows,
        isLeafTierVisible,
        isMetricTokenValue: layout.isMetricTokenValue,
      }),
    [
      expandedRows,
      isLeafTierVisible,
      layout.isMetricTokenValue,
      renderTree.rows,
    ],
  );
  const expandedColsForRender = useMemo(
    () =>
      expandMetricNodesForRender({
        expanded: expandedCols,
        nodes: renderTree.cols,
        isLeafTierVisible,
        isMetricTokenValue: layout.isMetricTokenValue,
      }),
    [
      expandedCols,
      isLeafTierVisible,
      layout.isMetricTokenValue,
      renderTree.cols,
    ],
  );

  const renderModel = useMemo(() => {
    const resolveMetricIndex = (...candidates: Array<number | undefined>) => {
      const index = Math.max(...candidates.map(value => value ?? -1));
      return index >= 0 ? index : undefined;
    };
    const metricIndexForRowsResolved = resolveMetricIndex(
      layout.metricLayoutIndexOnRows,
      getMetricIndexFromNodes({
        nodes: renderTree.rows,
        isMetricTokenValue: layout.isMetricTokenValue,
      }),
      layout.metricIndexOnRows,
    );
    const metricIndexForColsResolved = resolveMetricIndex(
      layout.metricLayoutIndexOnCols,
      getMetricIndexFromNodes({
        nodes: renderTree.cols,
        isMetricTokenValue: layout.isMetricTokenValue,
      }),
      layout.metricIndexOnCols,
    );
    return buildRenderModel({
      tree: renderTree,
      expandedRows: expandedRowsForRender,
      expandedCols: expandedColsForRender,
      config: {
        groupbyRowsLength: resolvedGroupbyRowsLength,
        groupbyColumnsLength: resolvedGroupbyColumnsLength,
        normalizedRowSubtotalLevels: layout.normalizedRowSubtotalLevels,
        normalizedColSubtotalLevels: layout.normalizedColSubtotalLevels,
        rowTotals,
        colTotals,
        rowTotalPosition: layout.resolvedRowTotalPosition,
        colTotalPosition: layout.resolvedColTotalPosition,
        resolvedColSubtotalPosition: layout.effectiveColSubtotalPosition,
        resolvedMetricsLayout: layout.resolvedMetricsLayout,
        hasMultipleMeasures: layout.hasMultipleMeasures,
        metricsFirstOnCols: layout.metricsFirstOnCols,
        rowSorter,
        colSorter,
        getRowChildren: parent =>
          layout.getRowChildrenForNodes(
            parent,
            renderTree.rows,
            metricIndexForRowsResolved,
          ),
        getCollapsedRowChildren: parent =>
          layout.getCollapsedRowChildrenForNodes(
            parent,
            expandedRowsForRender,
            renderTree.rows,
          ),
        getColChildren: parent =>
          layout.getColChildrenForNodes(
            parent,
            renderTree.cols,
            metricIndexForColsResolved,
          ),
        getCollapsedColLeaves: parent =>
          layout.getCollapsedColLeavesForNodes(
            parent,
            expandedColsForRender,
            renderTree.cols,
          ),
        countDimDepth: layout.countDimDepth,
        isMetricGrandTotalNode: layout.isMetricGrandTotalNode,
        isMetricSubtotalNode: layout.isMetricSubtotalNode,
        isMetricTokenValue: layout.isMetricTokenValue,
        getColumnDisplayPath,
        getColumnHeaderLabel,
      },
    });
  }, [
    colSorter,
    colTotals,
    expandedColsForRender,
    expandedRowsForRender,
    getColumnDisplayPath,
    getColumnHeaderLabel,
    layout,
    renderTree,
    resolvedGroupbyColumnsLength,
    resolvedGroupbyRowsLength,
    rowSorter,
    rowTotals,
  ]);

  const renderNodeDisplayState = useMemo(
    () =>
      buildRenderNodeDisplayState({
        rowNodes: renderTree.rows,
        expandedRows,
        layout,
        isLeafTierVisible,
        groupbyRowsLength: resolvedGroupbyRowsLength,
        groupbyColumnsLength: resolvedGroupbyColumnsLength,
      }),
    [
      expandedRows,
      isLeafTierVisible,
      layout,
      renderTree.rows,
      resolvedGroupbyColumnsLength,
      resolvedGroupbyRowsLength,
    ],
  );

  return {
    renderTree,
    renderModel,
    expandedRowsForRender,
    expandedColsForRender,
    shouldShowToggle: renderNodeDisplayState.shouldShowToggle,
    isRowAggregateBold: renderNodeDisplayState.isRowAggregateBold,
    isColAggregateBold: renderNodeDisplayState.isColAggregateBold,
    getNodeDimDepth: renderNodeDisplayState.getNodeDimDepth,
    rowValuesMap,
    colValuesMap,
  };
};
