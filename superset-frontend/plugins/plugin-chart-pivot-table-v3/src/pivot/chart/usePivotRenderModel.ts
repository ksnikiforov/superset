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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { normalizeDimensionSortingMapWithKeys } from '../../utils';
import { serializeCellKey, serializePath } from '../core/path';
import { isSubtotalToken } from '../core/tokens';
import { getMetricKey } from '../metrics';
import { buildRenderModel, type RenderModel } from '../render/renderModel';
import { resolveAxisProjection } from '../runtime/projection';
import { resolveMeasureSortMetricKey } from '../measureLeaves';
import {
  createMetricNodePolicy,
  isExplicitSubtotalNode,
} from '../metricsTotals';
import { compareValues, rootKey, sortByOrder } from '../viewModel';
import { type PivotLayoutResult } from './usePivotLayout';
import {
  buildPivotColumnSortStateForClick,
  getPivotColumnSortOrder,
  reconcilePivotColumnSortState,
  resolvePivotColumnSortMetric,
  type PivotColumnSortState,
} from './columnSort';
import {
  buildColumnDisplayPath,
  buildRenderNodeDisplayState,
  expandMetricNodesForRender,
  formatRenderTreeDateLabels,
  resolveColumnHeaderLabel,
} from './renderDisplay';
import {
  resolveAxisChildrenBeforeSubtotalPolicy,
  resolveCollapsedValuesNodesForAxis,
  resolveRowSubtotalChildrenPolicy,
} from './layoutRuntime';

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
  handleColumnSort: (node: PivotTreeNode) => void;
  isColumnSortable: (node: PivotTreeNode) => boolean;
  getColumnSortOrder: (node: PivotTreeNode) => PivotSortOrder | undefined;
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
          metricKey: getMetricKey(dimensionSorting.metric),
          measureHierarchy: layout.layout.measureHierarchy,
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
  layout,
}: {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  formData: PivotTableProps['formData'];
  layout: PivotLayoutResult;
}): PivotRenderModelResult => {
  const {
    colOrder = 'key_a_to_z',
    colTypeMap,
    rowOrder = 'key_a_to_z',
  } = formData;
  const [activeColumnSort, setActiveColumnSort] =
    useState<PivotColumnSortState | null>(null);
  const resolvedGroupbyRows = layout.layout.pivotProgram.rowDimensions;
  const resolvedGroupbyColumns = layout.layout.pivotProgram.columnDimensions;
  const { colTotals, rowSubTotals } = layout.layout;
  const metricNodePolicy = useMemo(
    () => createMetricNodePolicy(layout.layout.pivotProgram),
    [layout.layout.pivotProgram],
  );

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
  const columnSortLayout = useMemo(
    () => ({
      measureHierarchy: layout.layout.measureHierarchy,
      layout: { pivotProgram: layout.layout.pivotProgram },
    }),
    [layout.layout.measureHierarchy, layout.layout.pivotProgram],
  );
  const hasRowSorting = Object.keys(rowSortingKeyMap).length > 0;
  const hasMultipleMeasures =
    layout.layout.pivotProgram.metricKeys.length > 1 ||
    layout.layout.measureHierarchy.groups.some(
      group => group.leaves.length > 1,
    );
  const isLeafTierVisible =
    layout.layout.measureHierarchy.leafTierVisibility === 'visible';

  const { dateFormatters } = formData;
  const renderTree = useMemo(
    () =>
      formatRenderTreeDateLabels({
        tree,
        dateFormatters,
        program: layout.layout.pivotProgram,
      }),
    [dateFormatters, layout.layout.pivotProgram, tree],
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
        metricNodePolicy.getDimensionKeyForNode(a, axis) ||
        metricNodePolicy.getDimensionKeyForNode(b, axis);
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
      metricNodePolicy,
      rowSortingKeyMap,
      rowValuesMap,
    ],
  );

  const rowSorter = useMemo(() => {
    const { isMetricGrandTotalNode } = metricNodePolicy;
    const baseSorter = sortByOrder(
      rowOrder,
      colTypeMap,
      resolvedGroupbyRows.map(getColumnLabel),
    );
    const pushMetricTotalsToEnd =
      (colTotals && layout.layout.colTotalPosition === 'end') ||
      (rowSubTotals && layout.effectiveRowSubtotalPosition === 'end');
    const pullMetricTotalsToStart =
      colTotals && layout.layout.colTotalPosition === 'start';
    if (
      !rowSubTotals &&
      !pushMetricTotalsToEnd &&
      !pullMetricTotalsToStart &&
      !hasRowSorting &&
      !activeColumnSort
    ) {
      return baseSorter;
    }
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      if (pullMetricTotalsToStart) {
        const metricTotalOrder =
          Number(isMetricGrandTotalNode(b)) - Number(isMetricGrandTotalNode(a));
        if (metricTotalOrder !== 0) {
          return metricTotalOrder;
        }
      }
      const subtotalOrder =
        Number(
          isExplicitSubtotalNode(a) ||
            (pushMetricTotalsToEnd && isMetricGrandTotalNode(a)),
        ) -
        Number(
          isExplicitSubtotalNode(b) ||
            (pushMetricTotalsToEnd && isMetricGrandTotalNode(b)),
        );
      if (subtotalOrder !== 0) {
        return subtotalOrder;
      }
      const metricOrder = layout.compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      if (activeColumnSort) {
        const aValue =
          renderTree.cells[serializeCellKey(a.key, activeColumnSort.colKey)]
            ?.values[activeColumnSort.metricKey];
        const bValue =
          renderTree.cells[serializeCellKey(b.key, activeColumnSort.colKey)]
            ?.values[activeColumnSort.metricKey];
        const uiColumnSortCmp = compareSortValues(
          aValue,
          bValue,
          activeColumnSort.order,
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
    activeColumnSort,
    metricNodePolicy,
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
        program: layout.layout.pivotProgram,
        allowMetricSubtotalLabels: layout.normalizedColSubtotalLevels.some(
          level => level > 0,
        ),
        getMetricDisplayLabelForKey: layout.getMetricDisplayLabelForKey,
        isExpanded: node => expandedCols.has(node.key),
      }),
    [expandedCols, layout],
  );

  const getColumnHeaderLabel = useCallback(
    (rawValue: DataRecordValue) =>
      resolveColumnHeaderLabel({
        rawValue,
        measureHierarchy: layout.layout.measureHierarchy,
        getMetricDisplayLabelForKey: layout.getMetricDisplayLabelForKey,
      }),
    [layout],
  );
  const getCollapsedChildrenForAxis = useCallback(
    (
      axis: 'row' | 'col',
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) =>
      resolveCollapsedValuesNodesForAxis({
        program: layout.layout.pivotProgram,
        axis,
        parent,
        expandedSet,
        nodes,
        isLeafTierVisible,
      }),
    [isLeafTierVisible, layout.layout.pivotProgram],
  );
  const getAxisChildrenForNodes = useCallback(
    (
      axis: 'row' | 'col',
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      const filtered = resolveAxisChildrenBeforeSubtotalPolicy({
        program: layout.layout.pivotProgram,
        axis,
        parent,
        nodes,
        hideMetricHeader:
          axis === 'row'
            ? layout.hideMetricHeaderOnRows
            : layout.hideMetricHeaderOnCols,
        colTotals: axis === 'row' ? layout.layout.colTotals : undefined,
        normalizedColSubtotalLevelCount:
          axis === 'col'
            ? layout.normalizedColSubtotalLevels.length
            : undefined,
      });
      if (axis === 'col') {
        return filtered;
      }
      return resolveRowSubtotalChildrenPolicy({
        program: layout.layout.pivotProgram,
        children: filtered,
        parent,
        nodes,
        rowSubTotals: layout.layout.rowSubTotals,
        rowSubtotalPositionForParent: layout.getRowSubtotalPosition(parent),
        hideMetricHeaderOnRows: layout.hideMetricHeaderOnRows,
      });
    },
    [layout],
  );

  const expandedRowsForRender = useMemo(
    () =>
      expandMetricNodesForRender({
        expanded: expandedRows,
        nodes: renderTree.rows,
        isLeafTierVisible,
        program: layout.layout.pivotProgram,
      }),
    [
      expandedRows,
      isLeafTierVisible,
      layout.layout.pivotProgram,
      renderTree.rows,
    ],
  );
  const expandedColsForRender = useMemo(
    () =>
      expandMetricNodesForRender({
        expanded: expandedCols,
        nodes: renderTree.cols,
        isLeafTierVisible,
        program: layout.layout.pivotProgram,
      }),
    [
      expandedCols,
      isLeafTierVisible,
      layout.layout.pivotProgram,
      renderTree.cols,
    ],
  );

  const renderModel = useMemo(
    () =>
      buildRenderModel({
        tree: renderTree,
        expandedRows: expandedRowsForRender,
        expandedCols: expandedColsForRender,
        config: {
          normalizedRowSubtotalLevels: layout.layout.rowSubtotalLevels,
          normalizedColSubtotalLevels: layout.normalizedColSubtotalLevels,
          rowTotals: layout.layout.rowTotals,
          colTotals: layout.layout.colTotals,
          rowTotalPosition: layout.layout.rowTotalPosition,
          colTotalPosition: layout.layout.colTotalPosition,
          resolvedColSubtotalPosition: layout.effectiveColSubtotalPosition,
          pivotProgram: layout.layout.pivotProgram,
          hasMultipleMeasures,
          rowSorter,
          colSorter,
          getRowChildren: parent =>
            getAxisChildrenForNodes('row', parent, renderTree.rows),
          getCollapsedRowChildren: parent =>
            getCollapsedChildrenForAxis(
              'row',
              parent,
              expandedRowsForRender,
              renderTree.rows,
            ),
          getColChildren: parent =>
            getAxisChildrenForNodes('col', parent, renderTree.cols),
          getCollapsedColLeaves: parent =>
            getCollapsedChildrenForAxis(
              'col',
              parent,
              expandedColsForRender,
              renderTree.cols,
            ),
          getColumnDisplayPath,
          getColumnHeaderLabel,
        },
      }),
    [
      colSorter,
      expandedColsForRender,
      expandedRowsForRender,
      getAxisChildrenForNodes,
      getCollapsedChildrenForAxis,
      getColumnDisplayPath,
      getColumnHeaderLabel,
      hasMultipleMeasures,
      layout,
      renderTree,
      rowSorter,
    ],
  );

  const renderNodeDisplayState = useMemo(
    () =>
      buildRenderNodeDisplayState({
        rowNodes: renderTree.rows,
        expandedRows,
        layout,
        isLeafTierVisible,
      }),
    [expandedRows, isLeafTierVisible, layout, renderTree.rows],
  );

  const isColumnSortable = useCallback(
    (node: PivotTreeNode) =>
      Boolean(resolvePivotColumnSortMetric({ node, layout: columnSortLayout })),
    [columnSortLayout],
  );

  const getColumnSortOrder = useCallback(
    (node: PivotTreeNode) =>
      getPivotColumnSortOrder({ current: activeColumnSort, node }),
    [activeColumnSort],
  );

  const handleColumnSort = useCallback(
    (node: PivotTreeNode) => {
      setActiveColumnSort(current => {
        const next = buildPivotColumnSortStateForClick({
          current,
          node,
          layout: columnSortLayout,
          columnNodes: renderTree.cols,
        });
        return next === undefined ? current : next;
      });
    },
    [columnSortLayout, renderTree.cols],
  );

  useEffect(() => {
    setActiveColumnSort(current => {
      const next = reconcilePivotColumnSortState({
        current,
        layout: columnSortLayout,
        columnNodes: renderTree.cols,
      });
      return next === current ? current : next;
    });
  }, [columnSortLayout, renderTree.cols]);

  return {
    renderTree,
    renderModel,
    expandedRowsForRender,
    expandedColsForRender,
    shouldShowToggle: renderNodeDisplayState.shouldShowToggle,
    isRowAggregateBold: renderNodeDisplayState.isRowAggregateBold,
    isColAggregateBold: renderNodeDisplayState.isColAggregateBold,
    getNodeDimDepth: renderNodeDisplayState.getNodeDimDepth,
    handleColumnSort,
    isColumnSortable,
    getColumnSortOrder,
    rowValuesMap,
    colValuesMap,
  };
};
