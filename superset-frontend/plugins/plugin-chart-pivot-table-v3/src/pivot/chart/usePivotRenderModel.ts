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
  MetricsLayoutEnum,
} from '../../types';
import { buildColumnDisplayPath } from '../columnDisplay';
import { buildFormattingValueMaps } from '../cellUtils';
import {
  normalizeDimensionSortingMapWithKeys,
  coerceEpochMsStringToNumber,
  getFormattingMetricKey,
  serializePath,
  decodeMetricKey,
  formatPivotLabelValue,
  decodeMeasureLeafId,
  isSubtotalToken,
  SUBTOTAL_TOKEN,
} from '../../utils';
import {
  buildRenderModel,
  type RenderModelConfig,
} from '../render/renderModel';
import { buildDesiredExpandedKeys } from '../expansion/engine';
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
  renderTree: PivotTreeData;
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

  const measureLeafLabelMap = useMemo(() => {
    if (layout.measureHierarchy.kind !== 'measureStackV1') {
      return new Map<string, string>();
    }
    const map = new Map<string, string>();
    layout.measureHierarchy.groups.forEach(group => {
      group.leaves.forEach(leaf => {
        if (!map.has(leaf.id)) {
          map.set(leaf.id, leaf.label);
        }
      });
    });
    return map;
  }, [layout.measureHierarchy]);

  const renderTree = useMemo(() => {
    const { dateFormatters } = formData;

    const formatAxisNodes = (
      nodes: Record<string, PivotTreeNode>,
      axis: 'row' | 'col',
    ) => {
      if (!dateFormatters || Object.keys(dateFormatters).length === 0) {
        return nodes;
      }
      let hasChanges = false;
      const nextNodes: Record<string, PivotTreeNode> = { ...nodes };
      Object.values(nodes).forEach(node => {
        if (node.path.length === 0 || node.path.some(isSubtotalToken)) {
          return;
        }
        const dimensionKey = layout.getDimensionKeyForNode(node, axis);
        if (!dimensionKey) {
          return;
        }
        const formatter = dateFormatters[dimensionKey];
        if (!formatter) {
          return;
        }
        const nonMetricParts = layout.getNonMetricPathParts(node.path);
        const nonSubtotalParts = nonMetricParts.filter(
          part => !isSubtotalToken(part),
        );
        const rawValue = nonSubtotalParts[nonSubtotalParts.length - 1];
        if (rawValue === null || rawValue === undefined) {
          return;
        }
        const normalizedRawValue = coerceEpochMsStringToNumber(rawValue);
        let formatterInput: number;
        if (typeof normalizedRawValue === 'number') {
          formatterInput = normalizedRawValue;
        } else if (normalizedRawValue instanceof Date) {
          formatterInput = normalizedRawValue.getTime();
        } else if (typeof normalizedRawValue === 'string') {
          const parsed = Date.parse(normalizedRawValue);
          if (!Number.isFinite(parsed)) {
            return;
          }
          formatterInput = parsed;
        } else {
          return;
        }
        const formatted = formatter(formatterInput);
        if (formatted !== node.formattedLabel) {
          nextNodes[node.key] = { ...node, formattedLabel: formatted };
          hasChanges = true;
        }
      });
      return hasChanges ? nextNodes : nodes;
    };

    const normalizeAxis = (
      nodes: Record<string, PivotTreeNode>,
      axis: 'row' | 'col',
      groupbyLength: number,
    ) => {
      let hasChanges = false;
      const nextNodes: Record<string, PivotTreeNode> = { ...nodes };
      const ensureNode = (path: PivotTreeNode['path']) => {
        const key = serializePath(path);
        if (nextNodes[key]) {
          return;
        }
        const rawValue = path[path.length - 1];
        const metricKey = decodeMetricKey(rawValue);
        const leafId = decodeMeasureLeafId(rawValue);
        let label = 'Grand total';
        if (path.length > 0) {
          if (metricKey) {
            label = layout.getMetricDisplayLabelForKey(metricKey);
          } else if (leafId) {
            label =
              measureLeafLabelMap.get(leafId) ??
              formatPivotLabelValue(rawValue ?? null, 'Total');
          } else {
            label = formatPivotLabelValue(rawValue ?? null, 'Total');
          }
        }
        const dimDepth = layout.countDimDepth(path);
        nextNodes[key] = {
          axis,
          key,
          path,
          label,
          formattedLabel: label,
          level: path.length,
          hasChildren: false,
          isSubtotal: path.some(isSubtotalToken) || dimDepth < groupbyLength,
        };
        hasChanges = true;
      };

      Object.values(nodes).forEach(node => {
        for (let depth = 0; depth <= node.path.length; depth += 1) {
          ensureNode(node.path.slice(0, depth));
        }
      });

      const parentKeys = new Set<string>();
      Object.values(nextNodes).forEach(node => {
        if (node.path.length === 0) {
          return;
        }
        parentKeys.add(serializePath(node.path.slice(0, -1)));
      });

      Object.values(nextNodes).forEach(node => {
        const hasChildren = node.hasChildren || parentKeys.has(node.key);
        if (node.hasChildren !== hasChildren) {
          nextNodes[node.key] = { ...node, hasChildren };
          hasChanges = true;
        }
      });

      return hasChanges ? nextNodes : nodes;
    };

    const nextCols = layout.metricsAtColEnd
      ? normalizeAxis(tree.cols, 'col', groupbyColumns.length)
      : tree.cols;
    const baseTree =
      nextCols === tree.cols ? tree : { ...tree, cols: nextCols };
    const nextRows = formatAxisNodes(baseTree.rows, 'row');
    const nextColsFormatted = formatAxisNodes(baseTree.cols, 'col');
    if (nextRows === baseTree.rows && nextColsFormatted === baseTree.cols) {
      return baseTree;
    }
    return { ...baseTree, rows: nextRows, cols: nextColsFormatted };
  }, [
    formData.dateFormatters,
    groupbyColumns.length,
    layout,
    measureLeafLabelMap,
    tree,
  ]);

  const { rowValuesMap, colValuesMap } = useMemo(
    () =>
      buildFormattingValueMaps({
        cells: renderTree.cells,
        rows: renderTree.rows,
        cols: renderTree.cols,
        getNonMetricPathParts: layout.getNonMetricPathParts,
        rootKey,
      }),
    [layout.getNonMetricPathParts, renderTree],
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
    Object.values(renderTree.cols).forEach(node => {
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
  }, [layout, renderTree.cols]);

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
        const metricLabel = layout.getMetricDisplayLabelFromPath(col.path);
        if (metricLabel && col.path.length < maxDepth) {
          const nonMetricParts = layout.getNonMetricPathParts(col.path);
          if (nonMetricParts.length === 0) {
            return [...col.path, SUBTOTAL_TOKEN];
          }
          return [
            ...col.path,
            ...Array(Math.max(maxDepth - col.path.length, 0)).fill(metricLabel),
          ];
        }
      }
      return buildColumnDisplayPath(col, maxDepth, {
        metricsLayout: layout.resolvedMetricsLayout,
        metricsFirstOnCols: layout.metricsFirstOnCols,
        metricsAtColEnd: layout.metricsAtColEnd,
        allowMetricSubtotalLabels: layout.normalizedColSubtotalLevels.some(
          level => level > 0,
        ),
        hasDeeperNonMetricDescendants,
        metricLabels: layout.metricLabels,
        isExplicitSubtotalNode: layout.isExplicitSubtotalNode,
        getMetricKeyFromPath: layout.getMetricLabelFromPath,
        getMetricDisplayLabelForKey: layout.getMetricDisplayLabelForKey,
        getNonMetricPathParts: layout.getNonMetricPathParts,
        isMetricGrandTotalNode: layout.isMetricGrandTotalNode,
        isMetricSubtotalNode: layout.isMetricSubtotalNode,
      });
    },
    [expandedCols, hasDeeperNonMetricDescendants, layout],
  );

  const getColumnHeaderLabel = useCallback(
    (rawValue: DataRecordValue) => {
      const decoded = decodeMetricKey(rawValue);
      if (decoded) {
        return layout.getMetricDisplayLabelForKey(decoded);
      }
      const leafId = decodeMeasureLeafId(rawValue);
      if (leafId) {
        if (layout.measureHierarchy.kind === 'measureStackV1') {
          const leafLabel = layout.measureHierarchy.groups
            .flatMap(group => group.leaves)
            .find(leaf => leaf.id === leafId)?.label;
          if (leafLabel) {
            return leafLabel;
          }
        }
      }
      return formatPivotLabelValue(rawValue, '');
    },
    [layout],
  );

  const buildRenderModelConfig = useCallback(
    (
      nextExpandedRows: Set<string>,
      nextExpandedCols: Set<string>,
      nextTree: PivotTreeData,
    ): RenderModelConfig => {
      const resolvedGroupbyRowsLength = layout.layout.groupbyRows.length;
      const resolvedGroupbyColumnsLength = layout.layout.groupbyColumns.length;
      const resolveMetricIndex = (...candidates: Array<number | undefined>) => {
        const values = candidates.filter(
          (value): value is number => value !== undefined,
        );
        return values.length > 0 ? Math.max(...values) : undefined;
      };
      const metricIndexForRowsResolved = resolveMetricIndex(
        layout.metricLayoutIndexOnRows,
        layout.findMetricIndex(nextTree.rows),
        layout.metricIndexOnRows,
      );
      const metricIndexForColsResolved = resolveMetricIndex(
        layout.metricLayoutIndexOnCols,
        layout.findMetricIndex(nextTree.cols),
        layout.metricIndexOnCols,
      );
      return {
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
        isMultiMetric: layout.isMultiMetric,
        hasMultipleMeasures: layout.hasMultipleMeasures,
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
        getColumnHeaderLabel,
      };
    },
    [
      colSorter,
      colTotals,
      getColumnDisplayPath,
      getColumnHeaderLabel,
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
    Object.values(renderTree.rows).forEach(node => {
      if (layout.isMetricTokenValue(node.path[node.path.length - 1])) {
        next.add(node.key);
      }
    });
    return next;
  }, [expandedRows, isLeafTierVisible, layout, renderTree.rows]);
  const expandedColsForRender = useMemo(() => {
    if (!isLeafTierVisible) {
      return expandedCols;
    }
    const next = new Set(expandedCols);
    Object.values(renderTree.cols).forEach(node => {
      if (layout.isMetricTokenValue(node.path[node.path.length - 1])) {
        next.add(node.key);
      }
    });
    return next;
  }, [expandedCols, isLeafTierVisible, layout, renderTree.cols]);

  const autoExpandedRows = useMemo(
    () =>
      buildDesiredExpandedKeys({
        axis: 'row',
        tree: renderTree,
        autoExpandLevel: layout.resolvedExpandRowsLevel,
        metricLabelSet: layout.metricLabelSet,
        includeMetricDepthZero: layout.shouldExpandMetricRows,
        manualExpanded: new Set(),
        manualCollapsed: new Set(),
        pendingKeys: new Set(),
        inFlightKeys: new Set(),
      }),
    [
      layout.metricLabelSet,
      layout.resolvedExpandRowsLevel,
      layout.shouldExpandMetricRows,
      renderTree,
    ],
  );

  const manualExpandedRows = useMemo(() => {
    const next = new Set(expandedRows);
    autoExpandedRows.forEach(key => next.delete(key));
    return next;
  }, [autoExpandedRows, expandedRows]);

  const manualExpandedRowDepths = useMemo(() => {
    const depths = new Set<number>();
    manualExpandedRows.forEach(key => {
      const node = renderTree.rows[key];
      if (!node) {
        return;
      }
      if (!node.hasChildren) {
        return;
      }
      depths.add(layout.countDimDepth(node.path));
    });
    return depths;
  }, [layout, manualExpandedRows, renderTree.rows]);

  const renderModel = useMemo(
    () =>
      buildRenderModel({
        tree: renderTree,
        expandedRows: expandedRowsForRender,
        expandedCols: expandedColsForRender,
        config: buildRenderModelConfig(
          expandedRowsForRender,
          expandedColsForRender,
          renderTree,
        ),
      }),
    [
      buildRenderModelConfig,
      expandedColsForRender,
      expandedRowsForRender,
      renderTree,
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
      if (!node || node.path.length === 0) {
        return false;
      }
      const syntheticMetricTotalLabel =
        node.path.length === 1 &&
        typeof node.path[0] === 'string' &&
        layout.metricLabels.some(label => node.path[0] === `Total ${label}`);
      if (syntheticMetricTotalLabel) {
        return false;
      }
      const dimDepth = layout.countDimDepth(node.path);
      const maxDepth =
        axis === 'row' ? groupbyRows.length : groupbyColumns.length;
      const metricsAtEnd =
        axis === 'row' ? layout.metricsAtRowEnd : layout.metricsAtColEnd;
      const hasMetricToken = node.path.some(val =>
        layout.isMetricTokenValue(val),
      );
      if (dimDepth >= maxDepth) {
        return false;
      }
      if (hasMetricToken && metricsAtEnd) {
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
            (layout.isMultiMetric || layout.singleMetricBetweenRows) &&
            layout.metricLayoutIndexOnRows !== undefined &&
            layout.metricLayoutIndexOnRows > 0 &&
            layout.metricLayoutIndexOnRows < groupbyRows.length &&
            node.path.length === layout.metricLayoutIndexOnRows &&
            !node.path.some(val => layout.isMetricTokenValue(val))
          : layout.resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
            (layout.isMultiMetric || layout.singleMetricBetweenCols) &&
            layout.metricLayoutIndexOnCols !== undefined &&
            layout.metricLayoutIndexOnCols > 0 &&
            layout.metricLayoutIndexOnCols < groupbyColumns.length &&
            node.path.length === layout.metricLayoutIndexOnCols &&
            !node.path.some(val => layout.isMetricTokenValue(val));
      if (hideMetricParentToggle) {
        return false;
      }
      if (metricsAtEnd && dimDepth >= maxDepth) {
        return false;
      }
      if (
        axis === 'row' &&
        layout.resolvedMetricsLayout !== MetricsLayoutEnum.ROWS &&
        dimDepth >= maxDepth
      ) {
        return false;
      }
      if (
        axis === 'col' &&
        layout.resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS &&
        dimDepth >= maxDepth
      ) {
        return false;
      }
      if (isLeafTierVisible) {
        const tail = node.path[node.path.length - 1];
        if (layout.isMetricTokenValue(tail)) {
          return false;
        }
        if (node.path.some(val => decodeMeasureLeafId(val))) {
          if (dimDepth >= maxDepth) {
            return false;
          }
          const metricsAtEnd =
            axis === 'row' ? layout.metricsAtRowEnd : layout.metricsAtColEnd;
          if (metricsAtEnd) {
            return false;
          }
        }
      }
      return true;
    },
    [
      groupbyColumns.length,
      groupbyRows.length,
      isLeafTierVisible,
      layout,
      tree.cols,
      tree.rows,
    ],
  );

  const isRowAggregateBold = useCallback(
    (row?: PivotTreeNode) => {
      if (!row) {
        return false;
      }
      if (row.path.length === 0 && groupbyRows.length === 0) {
        return false;
      }
      if (isExplicitTotalNode(row)) {
        return true;
      }
      const dimDepth = layout.countDimDepth(row.path);
      if (!manualExpandedRowDepths.has(dimDepth) || !row.hasChildren) {
        return false;
      }
      return true;
    },
    [groupbyRows.length, isExplicitTotalNode, manualExpandedRowDepths, layout],
  );

  const isColAggregateBold = useCallback(
    (col?: PivotTreeNode) => {
      if (!col) {
        return false;
      }
      if (col.path.length === 0 && groupbyColumns.length === 0) {
        return false;
      }
      return isExplicitTotalNode(col) || layout.isMetricSubtotalNode(col);
    },
    [groupbyColumns.length, isExplicitTotalNode, layout],
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
    renderTree,
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
