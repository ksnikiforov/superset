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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LoadingOutlined,
  MinusSquareOutlined,
  PlusSquareOutlined,
} from '@ant-design/icons';
import {
  BinaryQueryObjectFilterClause,
  DataRecordValue,
  getColumnLabel,
  getNumberFormatter,
  styled,
  t,
} from '@superset-ui/core';
import { fetchPivotBranch, peekPivotBranchCache } from './fetchPivotBranch';
import {
  MetricsLayoutEnum,
  PivotTableProps,
  PivotTreeData,
  PivotTreeNode,
} from './types';
import {
  isMetricsPlaceholder,
  isSubtotalToken,
  mergeTrees,
  parseThemeColors,
  PIVOT_THEME_PRESETS,
  resolveMetricPlacement,
  serializePath,
  SUBTOTAL_LABEL,
} from './utils';
import {
  buildColumnHeaderRows,
  findChildren,
  formatMetricValue,
  rootKey,
  sortByOrder,
} from './pivot/viewModel';
import { buildColumnDisplayPath } from './pivot/columnDisplay';
import {
  countDimDepth as countDimDepthBase,
  getMetricDepthForParent as getMetricDepthForParentBase,
  getMetricLabelFromPath as getMetricLabelFromPathBase,
  getMetricTierNodes as getMetricTierNodesBase,
  getNonMetricPathParts as getNonMetricPathPartsBase,
  getNodeDimDepth as getNodeDimDepthBase,
  isExplicitSubtotalNode as isExplicitSubtotalNodeBase,
  isExplicitTotalNode as isExplicitTotalNodeBase,
  isMetricGrandTotalNode as isMetricGrandTotalNodeBase,
  isMetricSubtotalNode as isMetricSubtotalNodeBase,
} from './pivot/metricsTotals';
import {
  buildVisibleCols,
  buildVisibleRows,
  createColLeavesBuilder,
  getExpandedDepths,
  getVisibleDepths,
  hasLoadedChildren as hasLoadedChildrenBase,
} from './pivot/visibility';
import { buildCellFilters, buildContextMenuFilters } from './pivot/filters';
import {
  deriveMetricKey as deriveMetricKeyBase,
  formatNodeLabel as formatNodeLabelBase,
  shouldHideRowValues as shouldHideRowValuesBase,
} from './pivot/cellUtils';

const Container = styled.div<{ height: number; width: number | string }>`
  ${({ height, width }) => `
    height: ${height}px;
    width: ${typeof width === 'string' ? width : `${width}px`};
    overflow: auto;
  `}
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th,
  td {
    border: 1px solid ${({ theme }) => (theme as any).colors?.grayscale?.light2 || (theme as any).colorBorder};
    padding: 6px 8px;
  }

  thead th {
    background: ${({ theme }) =>
      (theme as any).colors?.grayscale?.light4 || (theme as any).colorBgLayout};
    text-align: left;
    vertical-align: top;
  }

  td.value-cell {
    text-align: right;
  }

  tbody th {
    background: ${({ theme }) =>
      (theme as any).colorBgContainer || '#fff'};
    text-align: left;
    vertical-align: top;
  }

  .subtotal-cell {
    font-weight: 600;
  }
`;

const HeaderCell = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => ((theme as any).gridUnit || 4) * 1.5}px;
`;

const ColumnHeaderCell = styled(HeaderCell)`
  align-items: flex-start;
  line-height: 1.2;
`;

const ROW_INDENT_PX = 16;

const ToggleButton = styled.button`
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  color: ${({ theme }) => (theme as any).colors?.grayscale?.base || (theme as any).colorText};

  &:disabled {
    cursor: default;
    color: ${({ theme }) => (theme as any).colors?.grayscale?.light1 || (theme as any).colorTextQuaternary};
  }
`;

const Spinner = styled(LoadingOutlined)`
  font-size: 12px;
`;


function PivotTableChart(props: PivotTableProps) {
  const {
    data,
    formData,
    width,
    height,
    metrics,
    groupbyRows,
    groupbyColumns,
    startCollapsed = true,
    initialDepth = 1,
    maxDepthPerFetch,
    rowOrder,
    colOrder,
    valueFormat,
    columnFormats,
    currencyFormats,
    allowRenderHtml,
    setDataMask,
    emitCrossFilters,
    onContextMenu,
    timeGrainSqla,
    dateFormatters = {},
    colTypeMap,
    metricsLayout = MetricsLayoutEnum.COLUMNS,
    rowSubtotalLevels = [],
    colSubtotalLevels = [],
    rowTotals = false,
    colTotals = false,
    rowSubTotals = false,
    colSubTotals = false,
    rowTotalPosition = 'start',
    rowSubtotalPosition = 'start',
    colTotalPosition = 'start',
    colSubtotalPosition = 'start',
    pivotTheme = 'none',
    pivotThemeColors = '',
  } = props;
  const resolvedMetricsLayout =
    (formData.metricsLayout as MetricsLayoutEnum) || metricsLayout;
  const resolvedRowTotalPosition =
    formData.rowTotalPosition || rowTotalPosition;
  const resolvedRowSubtotalPosition =
    formData.rowSubtotalPosition || rowSubtotalPosition;
  const resolvedColTotalPosition =
    formData.colTotalPosition || colTotalPosition;
  const resolvedColSubtotalPosition =
    formData.colSubtotalPosition || colSubtotalPosition;

  const normalizedRowSubtotalLevels = useMemo(
    () => rowSubtotalLevels.filter(level => level === 0),
    [rowSubtotalLevels],
  );
  const rowSubtotalDepths = useMemo(
    () => rowSubtotalLevels.filter(level => level > 0),
    [rowSubtotalLevels],
  );
  const normalizedColSubtotalLevels = useMemo(
    () =>
      colSubtotalLevels.filter(
        level =>
          level <= Math.max(groupbyColumns.length - 1, 0) && level >= 0,
      ),
    [colSubtotalLevels, groupbyColumns.length],
  );
  const metricPlacement = useMemo(
    () =>
      resolveMetricPlacement(formData.groupbyRows, formData.groupbyColumns, {
        hasMetrics: metrics.length > 0,
        preferredAxis: resolvedMetricsLayout,
      }),
    [
      formData.groupbyColumns,
      formData.groupbyRows,
      metrics.length,
      resolvedMetricsLayout,
    ],
  );
  const metricInsertIndexOnRows = useMemo(() => {
    if (
      resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
      metricPlacement.metricPosition < 0
    ) {
      return undefined;
    }
    return Math.min(metricPlacement.metricPosition, groupbyRows.length);
  }, [groupbyRows.length, metricPlacement.metricPosition, resolvedMetricsLayout]);
  const metricInsertIndexOnCols = useMemo(() => {
    if (
      resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS ||
      metricPlacement.metricPosition < 0
    ) {
      return undefined;
    }
    return Math.min(metricPlacement.metricPosition, groupbyColumns.length);
  }, [
    groupbyColumns.length,
    metricPlacement.metricPosition,
    resolvedMetricsLayout,
  ]);

  const [tree, setTree] = useState<PivotTreeData>(data);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string>();
  const [fetchedRowKeys, setFetchedRowKeys] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [fetchedColKeys, setFetchedColKeys] = useState<Map<string, number>>(
    () => new Map(),
  );

  const numberFormatter = useMemo(
    () => getNumberFormatter(valueFormat),
    [valueFormat],
  );

  useEffect(() => {
    setTree(data);
    const resolvedInitialDepth = initialDepth ?? 1;
    const maxRowDepth =
      Object.values(data.rows).reduce(
        (max, node) => Math.max(max, node.level),
        0,
      ) + 1;
    const maxColDepth =
      Object.values(data.cols).reduce(
        (max, node) => Math.max(max, node.level),
        0,
      ) + 1;
    const seedRowDepth = startCollapsed ? 0 : maxRowDepth;
    const seedColDepth = startCollapsed ? 0 : maxColDepth;
    const seedExpanded = (nodes: Record<string, PivotTreeNode>) => {
      const next = new Set<string>([rootKey]);
      Object.values(nodes).forEach(node => {
        const depthLimit = nodes === data.rows ? seedRowDepth : seedColDepth;
        if (node.level > 0 && node.level <= depthLimit) {
          next.add(node.key);
        }
      });
      return next;
    };
    setExpandedRows(seedExpanded(data.rows));
    setExpandedCols(seedExpanded(data.cols));
    setFetchedRowKeys(new Map());
    setFetchedColKeys(new Map());
  }, [data, startCollapsed, initialDepth]);

  const metricLabels = metrics.map(m =>
    typeof m === 'string' ? m : getColumnLabel(m as any),
  );
  const metricOrderKey = metricLabels.join('|');
  const metricLabelSet = useMemo(
    () => new Set(metricLabels),
    [metricOrderKey],
  );
  const metricOrderMap = useMemo(
    () => new Map(metricLabels.map((label, idx) => [label, idx])),
    [metricOrderKey],
  );
  const isMultiMetric = metricLabels.length > 1;

  const findMetricIndex = useCallback(
    (nodes: Record<string, PivotTreeNode>) => {
      let found: number | undefined;
      let foundFromSubtotal: number | undefined;
      Object.values(nodes).forEach(node => {
        const idx = node.path.findIndex(val =>
          metricLabelSet.has(String(val ?? '')),
        );
        if (idx < 0) {
          return;
        }
        if (node.path.some(val => isSubtotalToken(val) || val === 'Total')) {
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
    [metricLabelSet],
  );

  const metricIndexOnRows = useMemo(() => {
    const treeIndex = findMetricIndex(tree.rows);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnRows;
  }, [findMetricIndex, metricInsertIndexOnRows, tree.rows]);
  const metricIndexOnCols = useMemo(() => {
    const treeIndex = findMetricIndex(tree.cols);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnCols;
  }, [findMetricIndex, metricInsertIndexOnCols, tree.cols]);
  const metricDimIndexOnRows = useMemo(() => {
    if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
      return undefined;
    }
    const maxDimDepth = Object.values(tree.rows).reduce((max, node) => {
      if (node.path.some(val => isSubtotalToken(val) || val === 'Total')) {
        return max;
      }
      return Math.max(max, countDimDepthBase(node.path, metricLabelSet));
    }, 0);
    let found: number | undefined;
    Object.values(tree.rows).forEach(node => {
      if (node.path.some(val => isSubtotalToken(val) || val === 'Total')) {
        return;
      }
      if (countDimDepthBase(node.path, metricLabelSet) !== maxDimDepth) {
        return;
      }
      const idx = node.path.findIndex(val =>
        metricLabelSet.has(String(val ?? '')),
      );
      if (idx < 0) {
        return;
      }
      let dimIndex = 0;
      for (let i = 0; i < idx; i += 1) {
        const val = node.path[i];
        if (metricLabelSet.has(String(val ?? ''))) {
          continue;
        }
        if (isSubtotalToken(val) || val === 'Total') {
          continue;
        }
        dimIndex += 1;
      }
      found = found === undefined ? dimIndex : Math.min(found, dimIndex);
    });
    return found;
  }, [metricLabelSet, resolvedMetricsLayout, tree.rows]);
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
    ? metricInsertIndexOnRows ?? metricIndexOnRows
    : metricIndexOnRows;
  const metricLayoutIndexOnCols = formColsHasPlaceholder
    ? metricInsertIndexOnCols ?? metricIndexOnCols
    : metricIndexOnCols;
  const metricsAtRowEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricInsertIndexOnRows !== undefined &&
    metricInsertIndexOnRows >= groupbyRows.length;
  const metricsAtColEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndexOnCols !== undefined &&
    metricInsertIndexOnCols >= groupbyColumns.length;
  const metricsFirstOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS && metricIndexOnRows === 0;
  const metricsFirstOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS && metricIndexOnCols === 0;
  const forceRowSubtotalEnd =
    rowSubTotals &&
    isMultiMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    !metricsFirstOnRows;
  const effectiveRowSubtotalPosition = forceRowSubtotalEnd
    ? 'end'
    : resolvedRowSubtotalPosition;

  const hideMetricHeaderOnRows = useMemo(
    () =>
      resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
      metricLabels.length === 1 &&
      metricIndexOnRows !== undefined &&
      metricIndexOnRows === groupbyRows.length,
    [
      groupbyRows.length,
      metricIndexOnRows,
      metricLabels.length,
      resolvedMetricsLayout,
    ],
  );
  const hideMetricHeaderOnCols = useMemo(
    () =>
      resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
      metricLabels.length === 1 &&
      metricIndexOnCols !== undefined &&
      metricIndexOnCols === groupbyColumns.length,
    [
      groupbyColumns.length,
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

  const compareMetricOrder = useCallback(
    (a: PivotTreeNode, b: PivotTreeNode) => {
      const aMetric = getMetricLabelFromPath(a.path);
      const bMetric = getMetricLabelFromPath(b.path);
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
    [getMetricLabelFromPath, metricOrderMap],
  );

  const getNonMetricPathParts = useCallback(
    (path: PivotTreeNode['path']) =>
      getNonMetricPathPartsBase(path, metricLabelSet),
    [metricLabelSet],
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

  const metricIndexForRows = metricLayoutIndexOnRows ?? metricIndexOnRows;
  const metricIndexForCols = metricLayoutIndexOnCols ?? metricIndexOnCols;

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

  const getRowSubtotalPosition = useCallback(
    (_node: PivotTreeNode) =>
      forceRowSubtotalEnd ? 'end' : resolvedRowSubtotalPosition,
    [forceRowSubtotalEnd, resolvedRowSubtotalPosition],
  );

  const getRawRowChildren = useCallback(
    (parent: PivotTreeNode) => findChildren(tree.rows, parent),
    [tree.rows],
  );

  const getRawColChildren = useCallback(
    (parent: PivotTreeNode) => findChildren(tree.cols, parent),
    [tree.cols],
  );

  const getCollapsedRowChildren = useCallback(
    (parent: PivotTreeNode) => {
      if (
        !isMultiMetric ||
        resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
        expandedRows.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent)) {
        return [] as PivotTreeNode[];
      }
      if (
        parent.path.some(val => metricLabelSet.has(String(val ?? '')))
      ) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(tree.rows, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(tree.rows, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyRows.length;
      const metricLabels = Array.from(
        new Set(
          metricNodes.map(node => String(node.path[metricDepth] ?? '')),
        ),
      );
      return metricLabels.map(metricLabel => {
        const collapsedPath = [...parent.path, metricLabel];
        const collapsedKey = serializePath(collapsedPath);
        const existing = tree.rows[collapsedKey];
        if (existing) {
          const hasChildren = metricsAtRowEnd
            ? false
            : getRawRowChildren(existing).length > 0 || hasMetricChildren;
          return { ...existing, hasChildren };
        }
        const sourceNode = metricNodes.find(
          node => String(node.path[metricDepth] ?? '') === metricLabel,
        );
        const hasChildren = metricsAtRowEnd
          ? false
          : Object.values(tree.rows).some(
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
      expandedRows,
      isExplicitSubtotalNode,
      getMetricDepthForParent,
      getMetricTierNodes,
      getRawRowChildren,
      groupbyRows.length,
      isMultiMetric,
      isMetricSubtotalNode,
      metricLabelSet,
      metricsAtRowEnd,
      resolvedMetricsLayout,
      tree.rows,
    ],
  );

  const getCollapsedColLeaves = useCallback(
    (parent: PivotTreeNode) => {
      if (
        !isMultiMetric ||
        resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS ||
        expandedCols.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (
        parent.path.some(val => metricLabelSet.has(String(val ?? '')))
      ) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(tree.cols, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(tree.cols, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyColumns.length;
      const metricLabels = Array.from(
        new Set(
          metricNodes.map(node => String(node.path[metricDepth] ?? '')),
        ),
      );
      return metricLabels.map(metricLabel => {
        const collapsedPath = [...parent.path, metricLabel];
        const collapsedKey = serializePath(collapsedPath);
        const sourceNode = metricNodes.find(
          node => String(node.path[metricDepth] ?? '') === metricLabel,
        );
        const existing = tree.cols[collapsedKey];
        if (existing) {
          const hasChildren =
            metricsAtColEnd
              ? false
              : getRawColChildren(existing).length > 0 || hasMetricChildren;
          return { ...existing, hasChildren };
        }
        const hasChildren = metricsAtColEnd
          ? false
          : getRawColChildren({ ...parent, path: collapsedPath }).length > 0 ||
            hasMetricChildren;
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
      expandedCols,
      getMetricDepthForParent,
      getMetricTierNodes,
      getRawColChildren,
      groupbyColumns.length,
      isMultiMetric,
      metricLabelSet,
      metricsAtColEnd,
      resolvedMetricsLayout,
      tree.cols,
    ],
  );

  const getRowChildren = useCallback(
    (parent: PivotTreeNode) => {
      const rowSubtotalPositionForParent = getRowSubtotalPosition(parent);
      const isMetricSubtotalAtMetricTier = (node: PivotTreeNode) => {
        if (
          resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
          !isMultiMetric
        ) {
          return false;
        }
        const subtotalIndex = node.path.findIndex(val =>
          isSubtotalToken(val) || val === 'Total',
        );
        if (subtotalIndex <= 0) {
          return false;
        }
        const prev = node.path[subtotalIndex - 1];
        return metricLabelSet.has(String(prev ?? ''));
      };
      const children = getRawRowChildren(parent);
      const parentHasMetric = parent.path.some(val =>
        metricLabelSet.has(String(val ?? '')),
      );
      const filteredByMetricPosition = parentHasMetric
        ? children
        : children.filter(child => {
            if (metricIndexForRows === undefined) {
              return true;
            }
            if (child.path.length <= metricIndexForRows) {
              return true;
            }
            const metricAtIndex = metricLabelSet.has(
              String(child.path[metricIndexForRows] ?? ''),
            );
            // When metrics sit at the front, ensure we only surface nodes that
            // include the metric at that index, so placeholder/base nodes without
            // metric labels do not render as empty rows.
            return metricAtIndex;
          });
      let filtered = filteredByMetricPosition;
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        parent.axis === 'row' &&
        parent.level < groupbyRows.length &&
        (metricLayoutIndexOnRows === undefined ||
          metricLayoutIndexOnRows > parent.level)
      ) {
        const hasNonMetricChildren = children.some(child => {
          const metricAtLevel = metricLabelSet.has(
            String(child.path[parent.level] ?? ''),
          );
          return !metricAtLevel;
        });
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = metricLabelSet.has(
            String(child.path[parent.level] ?? ''),
          );
          if (!metricAtLevel) {
            return true;
          }
          if (hasNonMetricChildren) {
            if (
              !rowTotals &&
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
          child => !metricLabelSet.has(String(child.path[parent.level] ?? '')),
        );
      }
      if (metricsFirstOnRows) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        !isMultiMetric
      ) {
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
        const isSubtotalLevelToken = (val: unknown) =>
          isSubtotalToken(val) || val === 'Total';
        const subtotalDescendants = Object.values(tree.rows).filter(node => {
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
            return !node.path.some(val =>
              metricLabelSet.has(String(val ?? '')),
            );
          }
          if (requireMetricLabel) {
            return node.path.some(val =>
              metricLabelSet.has(String(val ?? '')),
            );
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
          return child.path.some(val => metricLabelSet.has(String(val ?? '')));
        });
      }
      if (
        rowSubTotals &&
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        isMultiMetric &&
        metricDimIndexOnRows !== undefined &&
        metricLayoutIndexOnRows !== undefined &&
        metricLayoutIndexOnRows < groupbyRows.length
      ) {
        const suppressDepth = metricDimIndexOnRows + 1;
        filtered = filtered.filter(child => {
          if (!isExplicitSubtotalNode(child)) {
            return true;
          }
          const label = child.label ?? '';
          const formattedLabel = child.formattedLabel ?? '';
          if (
            metricLayoutIndexOnRows !== undefined &&
            metricLayoutIndexOnRows > 1 &&
            (child.path.some(val => val === 'Total') ||
              (typeof label === 'string' && label.endsWith(' Total')) ||
              (typeof formattedLabel === 'string' &&
                formattedLabel.endsWith(' Total')))
          ) {
            return true;
          }
          const dimDepth = countDimDepth(child.path);
          const subtotalDepth =
            child.path.some(val => isSubtotalToken(val) || val === 'Total')
              ? Math.max(dimDepth - 1, 0)
              : dimDepth;
          return subtotalDepth !== suppressDepth;
        });
      }
      if (rowSubTotals && !isMultiMetric) {
        filtered = filtered.filter(child => !isMetricSubtotalAtMetricTier(child));
      }
      return filtered;
    },
    [
      countDimDepth,
      getRowSubtotalPosition,
      getRawRowChildren,
      groupbyRows.length,
      metricIndexForRows,
      metricIndexOnRows,
      metricLayoutIndexOnRows,
      hideMetricHeaderOnRows,
      metricLabelSet,
      metricDimIndexOnRows,
      resolvedMetricsLayout,
      isMultiMetric,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      metricsFirstOnRows,
      rowTotals,
      rowSubTotals,
      tree.rows,
    ],
  );

  const pruneCollapsedMetricRows = useCallback(
    (currentTree: PivotTreeData, parent: PivotTreeNode) => {
      if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows === undefined) {
        return currentTree;
      }
      if (parent.path.some(val => metricLabelSet.has(String(val ?? '')))) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows <= parent.level) {
        return currentTree;
      }
      const removedRowKeys = new Set<string>();
      const shouldPruneLeafChildren =
        metricLayoutIndexOnRows < groupbyRows.length &&
        metricLayoutIndexOnRows > parent.level;
      const rowNodes = Object.values(currentTree.rows);
      const expandedCollapsedNodes = Array.from(expandedRows)
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
          const metricIdx = node.path.findIndex(val =>
            metricLabelSet.has(String(val ?? '')),
          );
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
          return metricLabelSet.has(String(valAtIndex ?? ''));
        });
      const shouldPruneCollapsedChildren = hasMetricAtLayoutIndex(parent);
      rowNodes.forEach(node => {
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        const metricIdx = node.path.findIndex(val =>
          metricLabelSet.has(String(val ?? '')),
        );
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
      expandedRows,
      groupbyRows.length,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricLabelSet,
      metricLayoutIndexOnRows,
      resolvedMetricsLayout,
    ],
  );

  const getColChildren = useCallback(
    (parent: PivotTreeNode) => {
      const children = getRawColChildren(parent);
      const filteredByMetricPosition = children.filter(child => {
        if (metricIndexForCols === undefined) {
          return true;
        }
        if (child.path.length <= metricIndexForCols) {
          return true;
        }
        const metricAtIndex = metricLabelSet.has(
          String(child.path[metricIndexForCols] ?? ''),
        );
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
        const allowMetricSubtotals =
          colSubTotals || normalizedColSubtotalLevels.length > 0;
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = metricLabelSet.has(
            String(child.path[parent.level] ?? ''),
          );
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
          child => !metricLabelSet.has(String(child.path[parent.level] ?? '')),
        );
      }
      if (metricsFirstOnCols) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      return filtered;
    },
    [
      colSubTotals,
      getRawColChildren,
      groupbyColumns.length,
      metricIndexForCols,
      metricLayoutIndexOnCols,
      hideMetricHeaderOnCols,
      metricLabelSet,
      normalizedColSubtotalLevels.length,
      resolvedMetricsLayout,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricsFirstOnCols,
    ],
  );

  const rowSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      rowOrder,
      colTypeMap,
      groupbyRows.map(getColumnLabel),
    );
    const pushMetricTotalsToEnd =
      (rowTotals && resolvedRowTotalPosition === 'end') ||
      (rowSubTotals && effectiveRowSubtotalPosition === 'end');
    const pullMetricTotalsToStart =
      rowTotals && resolvedRowTotalPosition === 'start';
    if (!rowSubTotals && !pushMetricTotalsToEnd && !pullMetricTotalsToStart) {
      return baseSorter;
    }
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      if (pullMetricTotalsToStart) {
        const aMetricTotal = isMetricGrandTotalNode(a) ? 1 : 0;
        const bMetricTotal = isMetricGrandTotalNode(b) ? 1 : 0;
        if (aMetricTotal !== bMetricTotal) {
          return bMetricTotal - aMetricTotal;
        }
      }
      const aSubtotal =
        isExplicitSubtotalNode(a) ||
        (pushMetricTotalsToEnd && isMetricGrandTotalNode(a))
          ? 1
          : 0;
      const bSubtotal =
        isExplicitSubtotalNode(b) ||
        (pushMetricTotalsToEnd && isMetricGrandTotalNode(b))
          ? 1
          : 0;
      if (aSubtotal !== bSubtotal) {
        return aSubtotal - bSubtotal;
      }
      const metricOrder = compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      return baseSorter(a, b);
    };
  }, [
    colTypeMap,
    compareMetricOrder,
    effectiveRowSubtotalPosition,
    groupbyRows,
    isExplicitSubtotalNode,
    isMetricGrandTotalNode,
    rowOrder,
    rowTotals,
    resolvedRowTotalPosition,
    rowSubTotals,
  ]);
  const colSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      colOrder,
      colTypeMap,
      groupbyColumns.map(getColumnLabel),
    );
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      const metricOrder = compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      return baseSorter(a, b);
    };
  }, [colOrder, colTypeMap, compareMetricOrder, groupbyColumns]);

  const showRowRootBase =
    groupbyRows.length > 0 &&
    (normalizedRowSubtotalLevels.includes(0) || rowTotals);
  const showRowRoot =
    showRowRootBase &&
    !(
      resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
      isMultiMetric
    );
  const showColRoot =
    groupbyColumns.length > 0 &&
    (normalizedColSubtotalLevels.includes(0) || colTotals || colSubTotals);

  const skipRowRoot = groupbyRows.length > 0 && !showRowRoot;
  const skipColRoot = groupbyColumns.length === 0 || !showColRoot;

  const visibleRows = useMemo(
    () =>
      buildVisibleRows({
        rows: tree.rows,
        expandedRows,
        rowSorter,
        skipRowRoot,
        showRowRoot,
        rowTotalPosition: resolvedRowTotalPosition,
        getRowChildren,
        getCollapsedRowChildren,
      }),
    [
      expandedRows,
      getCollapsedRowChildren,
      getRowChildren,
      resolvedRowTotalPosition,
      rowSorter,
      showRowRoot,
      skipRowRoot,
      tree.rows,
    ],
  );

  const buildColLeavesWithSubtotals = useMemo(
    () =>
      createColLeavesBuilder({
        getColChildren,
        getCollapsedColLeaves,
        colSorter,
        countDimDepth,
        expandedCols,
        normalizedColSubtotalLevels,
        showColRoot,
        colTotals,
        colSubTotals,
        resolvedColTotalPosition,
        resolvedColSubtotalPosition,
        resolvedMetricsLayout,
        isMultiMetric,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
      }),
    [
      colSorter,
      colSubTotals,
      colTotals,
      countDimDepth,
      expandedCols,
      getColChildren,
      getCollapsedColLeaves,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMultiMetric,
      normalizedColSubtotalLevels,
      resolvedColSubtotalPosition,
      resolvedColTotalPosition,
      resolvedMetricsLayout,
      showColRoot,
    ],
  );

  const visibleCols = useMemo(
    () =>
      buildVisibleCols({
        cols: tree.cols,
        skipColRoot,
        colSorter,
        getColChildren,
        buildColLeavesWithSubtotals,
      }),
    [buildColLeavesWithSubtotals, colSorter, getColChildren, skipColRoot, tree.cols],
  );
  const { visibleRowDepth, visibleColDepth } = useMemo(
    () => getVisibleDepths(visibleRows, visibleCols, countDimDepth),
    [countDimDepth, visibleCols, visibleRows],
  );
  const lastVisibleRowDepthRef = useRef(visibleRowDepth);
  const lastVisibleColDepthRef = useRef(visibleColDepth);
  useEffect(() => {
    if (visibleRowDepth > lastVisibleRowDepthRef.current) {
      lastVisibleRowDepthRef.current = visibleRowDepth;
      setFetchedColKeys(new Map());
    } else {
      lastVisibleRowDepthRef.current = visibleRowDepth;
    }
  }, [visibleRowDepth]);
  useEffect(() => {
    if (visibleColDepth > lastVisibleColDepthRef.current) {
      lastVisibleColDepthRef.current = visibleColDepth;
      setFetchedRowKeys(new Map());
    } else {
      lastVisibleColDepthRef.current = visibleColDepth;
    }
  }, [visibleColDepth]);
  const hasLoadedChildren = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode) =>
      hasLoadedChildrenBase({
        axis,
        node,
        getRawChildren: (targetAxis, parent) =>
          targetAxis === 'row'
            ? getRawRowChildren(parent)
            : getRawColChildren(parent),
        groupbyRowsLength: groupbyRows.length,
        groupbyColsLength: groupbyColumns.length,
        metricLabelSet,
        metricIndexForRows,
        metricIndexForCols,
        cells: tree.cells,
        rows: tree.rows,
        cols: tree.cols,
        visibleRowDepth,
        visibleColDepth,
        countDimDepth,
      }),
    [
      countDimDepth,
      getRawColChildren,
      getRawRowChildren,
      groupbyColumns.length,
      groupbyRows.length,
      metricIndexForCols,
      metricIndexForRows,
      metricLabelSet,
      tree.cells,
      tree.cols,
      tree.rows,
      visibleColDepth,
      visibleRowDepth,
    ],
  );
  const getColumnDisplayPath = useCallback(
    (col: PivotTreeNode, maxDepth: number) =>
      buildColumnDisplayPath(col, maxDepth, {
        metricsLayout: resolvedMetricsLayout,
        metricsFirstOnCols,
        metricLabels,
        isExplicitSubtotalNode,
        getMetricLabelFromPath,
        getNonMetricPathParts,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
      }),
    [
      getMetricLabelFromPath,
      getNonMetricPathParts,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricLabels,
      metricsFirstOnCols,
      resolvedMetricsLayout,
    ],
  );
  const columnHeaderRows = useMemo(
    () => buildColumnHeaderRows(visibleCols, tree.cols, getColumnDisplayPath),
    [getColumnDisplayPath, visibleCols, tree.cols],
  );
  const themeColor = useMemo(() => {
    if (pivotTheme === 'custom') {
      return parseThemeColors(pivotThemeColors)[0];
    }
    return PIVOT_THEME_PRESETS[pivotTheme];
  }, [pivotTheme, pivotThemeColors]);
  const getTotalBackground = useCallback(
    (row?: PivotTreeNode) => {
      if (!themeColor) {
        return undefined;
      }
      const isRowTotal = row?.key === rootKey && showRowRoot;
      return isRowTotal ? themeColor : undefined;
    },
    [showRowRoot, themeColor],
  );
  const expandedRowDepths = useMemo(
    () =>
      getExpandedDepths(
        expandedRows,
        tree.rows,
        groupbyRows.length,
        countDimDepth,
      ),
    [countDimDepth, expandedRows, groupbyRows.length, tree.rows],
  );
  const expandedColDepths = useMemo(
    () =>
      getExpandedDepths(
        expandedCols,
        tree.cols,
        groupbyColumns.length,
        countDimDepth,
      ),
    [countDimDepth, expandedCols, groupbyColumns.length, tree.cols],
  );
  const isExplicitTotalNode = useCallback(
    (node: PivotTreeNode) =>
      isExplicitTotalNodeBase(node, {
        metricLabelSet,
        metricsFirstOnRows,
        metricsFirstOnCols,
      }),
    [metricLabelSet, metricsFirstOnCols, metricsFirstOnRows],
  );
  const getNodeDimDepth = useCallback(
    (node: PivotTreeNode) =>
      getNodeDimDepthBase(node, {
        metricLabelSet,
        metricsLayout: resolvedMetricsLayout,
        hideMetricHeaderOnRows,
        metricLayoutIndexOnRows,
      }),
    [
      hideMetricHeaderOnRows,
      metricLayoutIndexOnRows,
      metricLabelSet,
      resolvedMetricsLayout,
    ],
  );
  const shouldShowToggle = useCallback(
    (axis: 'row' | 'col', node?: PivotTreeNode) => {
      if (!node || !node.hasChildren || node.path.length === 0) {
        return false;
      }
      if (isExplicitSubtotalNode(node) || isMetricGrandTotalNode(node)) {
        return false;
      }
      const hideMetricParentToggle =
        axis === 'row'
          ? resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
            isMultiMetric &&
            metricLayoutIndexOnRows !== undefined &&
            metricLayoutIndexOnRows > 0 &&
            metricLayoutIndexOnRows < groupbyRows.length &&
            node.path.length === metricLayoutIndexOnRows &&
            !node.path.some(val => metricLabelSet.has(String(val ?? '')))
          : resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
            isMultiMetric &&
            metricLayoutIndexOnCols !== undefined &&
            metricLayoutIndexOnCols > 0 &&
            metricLayoutIndexOnCols < groupbyColumns.length &&
            node.path.length === metricLayoutIndexOnCols &&
            !node.path.some(val => metricLabelSet.has(String(val ?? '')));
      if (hideMetricParentToggle) {
        return false;
      }
      return true;
    },
    [
      groupbyColumns.length,
      groupbyRows.length,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMultiMetric,
      metricLayoutIndexOnCols,
      metricLayoutIndexOnRows,
      metricLabelSet,
      resolvedMetricsLayout,
    ],
  );

  type CollapsedMetricExpansion = {
    metric: string;
    suffix: PivotTreeNode['path'];
    dimDepth: number;
  };

  const collectCollapsedMetricExpansions = useCallback(
    (parent: PivotTreeNode, expanded: Set<string>) => {
      if (
        resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
        metricLayoutIndexOnRows === undefined ||
        metricLayoutIndexOnRows <= parent.level
      ) {
        return [] as CollapsedMetricExpansion[];
      }
      const parentPath = parent.path;
      const expansions: CollapsedMetricExpansion[] = [];
      expanded.forEach(key => {
        const node = tree.rows[key];
        if (!node || node.path.length <= parentPath.length) {
          return;
        }
        if (!parentPath.every((val, idx) => val === node.path[idx])) {
          return;
        }
        const metricLabel = node.path[parentPath.length];
        if (!metricLabelSet.has(String(metricLabel ?? ''))) {
          return;
        }
        const suffix = node.path.slice(parentPath.length + 1);
        const dimDepth = countDimDepthBase(node.path, metricLabelSet);
        expansions.push({
          metric: String(metricLabel ?? ''),
          suffix,
          dimDepth,
        });
      });
      return expansions;
    },
    [
      metricLabelSet,
      metricLayoutIndexOnRows,
      resolvedMetricsLayout,
      tree.rows,
    ],
  );

  const collectDimPrefixes = useCallback(
    (
      parentPath: PivotTreeNode['path'],
      targetDepth: number,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      let prefixes = [parentPath];
      for (let depth = parentPath.length; depth < targetDepth; depth += 1) {
        const next: PivotTreeNode['path'][] = [];
        prefixes.forEach(prefix => {
          const parentNode = nodes[serializePath(prefix)];
          if (!parentNode) {
            return;
          }
          findChildren(nodes, parentNode).forEach(child => {
            const val = child.path[depth];
            if (
              metricLabelSet.has(String(val ?? '')) ||
              isSubtotalToken(val) ||
              val === 'Total'
            ) {
              return;
            }
            next.push(child.path);
          });
        });
        prefixes = next;
        if (prefixes.length === 0) {
          break;
        }
      }
      return prefixes;
    },
    [metricLabelSet],
  );

  const recomputeExpandedRows = useCallback(
    (expanded: Set<string>) => {
      const visible = buildVisibleRows({
        rows: tree.rows,
        expandedRows: expanded,
        rowSorter,
        skipRowRoot,
        showRowRoot,
        rowTotalPosition: resolvedRowTotalPosition,
        getRowChildren,
        getCollapsedRowChildren,
      });
      const visibleKeys = new Set(visible.map(row => row.key));
      const next = new Set(expanded);
      expanded.forEach(key => {
        const node = tree.rows[key];
        if (!node) {
          next.delete(key);
          return;
        }
        if (!visibleKeys.has(key)) {
          return;
        }
        const hasVisibleDescendant = visible.some(
          row =>
            row.path.length > node.path.length &&
            node.path.every((val, idx) => val === row.path[idx]),
        );
        if (!hasVisibleDescendant) {
          next.delete(key);
        }
      });
      return next;
    },
    [
      getCollapsedRowChildren,
      getRowChildren,
      resolvedRowTotalPosition,
      rowSorter,
      showRowRoot,
      skipRowRoot,
      tree.rows,
    ],
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
      const dimDepth = countDimDepth(row.path);
      if (dimDepth >= groupbyRows.length) {
        return false;
      }
      return expandedRowDepths.has(dimDepth);
    },
    [
      countDimDepth,
      expandedRowDepths,
      groupbyRows.length,
      isExplicitTotalNode,
    ],
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
      const dimDepth = countDimDepth(col.path);
      if (dimDepth >= groupbyColumns.length) {
        return false;
      }
      return expandedColDepths.has(dimDepth);
    },
    [
      countDimDepth,
      expandedColDepths,
      groupbyColumns.length,
      isExplicitTotalNode,
    ],
  );
  const handleToggle = useCallback(
    async (axis: 'row' | 'col', node: PivotTreeNode) => {
      if (!shouldShowToggle(axis, node)) {
        return;
      }
      const expanded = axis === 'row' ? expandedRows : expandedCols;
      const updateExpanded =
        axis === 'row' ? setExpandedRows : setExpandedCols;
      const isOpen = expanded.has(node.key);

      if (isOpen) {
        let next = new Set(expanded);
        next.delete(node.key);
        if (axis === 'row') {
          next = recomputeExpandedRows(next);
        }
        updateExpanded(next);
        return;
      }

      const fetchedKeys = axis === 'row' ? fetchedRowKeys : fetchedColKeys;
      const requiredDepth = axis === 'row' ? visibleColDepth : visibleRowDepth;
      const fetchedDepth = fetchedKeys.get(node.key) ?? -1;
      const markFetched =
        axis === 'row' ? setFetchedRowKeys : setFetchedColKeys;
      const expandedMetricLabels =
        axis === 'row' &&
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        metricLayoutIndexOnRows !== undefined &&
        metricLayoutIndexOnRows > node.level
          ? Array.from(metricLabelSet).filter(label =>
              expandedRows.has(serializePath([...node.path, label])),
            )
          : [];
      const collapsedMetricExpansions =
        axis === 'row'
          ? collectCollapsedMetricExpansions(node, expandedRows)
          : [];
      let nextTree = tree;
      const fetchBranchForNode = async (targetNode: PivotTreeNode) => {
        if (!targetNode.hasChildren) {
          return;
        }
        const targetFetchedDepth = fetchedKeys.get(targetNode.key) ?? -1;
        const directChildren =
          axis === 'row'
            ? findChildren(nextTree.rows, targetNode)
            : findChildren(nextTree.cols, targetNode);
        if (targetFetchedDepth === requiredDepth && directChildren.length > 0) {
          return;
        }
        const cached = peekPivotBranchCache({
          axis,
          path: targetNode.path,
          formData,
          maxDepthPerFetch,
          currentTree: nextTree,
          visibleRowDepth,
          visibleColDepth,
        });
        if (cached) {
          const merged = mergeTrees(nextTree, cached);
          nextTree = merged;
          setTree(merged);
          markFetched(prev => {
            const next = new Map(prev);
            next.set(targetNode.key, requiredDepth);
            return next;
          });
          return;
        }
        setLoadingKeys(prev => new Set(prev).add(targetNode.key));
        const result = await fetchPivotBranch({
          axis,
          path: targetNode.path,
          formData,
          maxDepthPerFetch,
          currentTree: nextTree,
          visibleRowDepth,
          visibleColDepth,
        });
        if (result.error) {
          setErrorMessage(result.error.message);
        }
        if (result.data) {
          const merged = mergeTrees(nextTree, result.data);
          nextTree = merged;
          setTree(merged);
          markFetched(prev => {
            const next = new Map(prev);
            next.set(targetNode.key, requiredDepth);
            return next;
          });
        }
        setLoadingKeys(prev => {
          const next = new Set(prev);
          next.delete(targetNode.key);
          return next;
        });
      };

      if (
        node.hasChildren &&
        (!hasLoadedChildren(axis, node) || fetchedDepth !== requiredDepth)
      ) {
        const cached = peekPivotBranchCache({
          axis,
          path: node.path,
          formData,
          maxDepthPerFetch,
          currentTree: tree,
          visibleRowDepth,
          visibleColDepth,
        });
        if (cached) {
          const merged = mergeTrees(tree, cached);
          nextTree = merged;
          setTree(merged);
          markFetched(prev => {
            const next = new Map(prev);
            next.set(node.key, requiredDepth);
            return next;
          });
        } else {
          setLoadingKeys(prev => new Set(prev).add(node.key));
          const result = await fetchPivotBranch({
            axis,
            path: node.path,
            formData,
            maxDepthPerFetch,
            currentTree: tree,
            visibleRowDepth,
            visibleColDepth,
          });
          if (result.error) {
            setErrorMessage(result.error.message);
          }
          if (result.data) {
            const merged = mergeTrees(tree, result.data);
            nextTree = merged;
            setTree(merged);
            markFetched(prev => {
              const next = new Map(prev);
              next.set(node.key, requiredDepth);
              return next;
            });
          }
          setLoadingKeys(prev => {
            const next = new Set(prev);
            next.delete(node.key);
            return next;
          });
        }
      }
      if (axis === 'row') {
        const prunedTree = pruneCollapsedMetricRows(nextTree, node);
        if (prunedTree !== nextTree) {
          nextTree = prunedTree;
          setTree(prunedTree);
        }
      }
      const next = new Set(expanded);
      next.add(node.key);
      if (axis === 'row' && expandedMetricLabels.length > 0) {
        Object.values(nextTree.rows).forEach(rowNode => {
          if (
            !rowNode.hasChildren ||
            rowNode.path.length <= node.path.length
          ) {
            return;
          }
          if (!node.path.every((val, idx) => val === rowNode.path[idx])) {
            return;
          }
          if (isExplicitSubtotalNode(rowNode) || isMetricGrandTotalNode(rowNode)) {
            return;
          }
          const lastLabel = String(rowNode.path[rowNode.path.length - 1] ?? '');
          if (!expandedMetricLabels.includes(lastLabel)) {
            return;
          }
          next.add(rowNode.key);
        });
      }
      const shouldRemapMetricExpansions =
        axis === 'row' &&
        metricLayoutIndexOnRows !== undefined &&
        metricLayoutIndexOnRows > node.level;
      let metricPrefixes: PivotTreeNode['path'][] = [];
      if (shouldRemapMetricExpansions && expandedMetricLabels.length > 0) {
        metricPrefixes = collectDimPrefixes(
          node.path,
          metricLayoutIndexOnRows,
          nextTree.rows,
        );
      }
      if (
        axis === 'row' &&
        expandedMetricLabels.length > 0 &&
        metricPrefixes.length > 0
      ) {
        const hasNonSubtotalChildren = (parentNode: PivotTreeNode) =>
          findChildren(nextTree.rows, parentNode).some(child => {
            const val = child.path[parentNode.path.length];
            if (isSubtotalToken(val) || val === 'Total') {
              return false;
            }
            return true;
          });
        const metricNodesToFetch = metricPrefixes
          .flatMap(prefix =>
            expandedMetricLabels.map(label => {
              const key = serializePath([...prefix, label]);
              return nextTree.rows[key];
            }),
          )
          .filter((metricNode): metricNode is PivotTreeNode => !!metricNode)
          .filter(metricNode => !hasNonSubtotalChildren(metricNode));
        for (const metricNode of metricNodesToFetch) {
          await fetchBranchForNode(metricNode);
        }
      }
      const mappedExpansionPaths: string[] = [];
      if (
        axis === 'row' &&
        collapsedMetricExpansions.length > 0 &&
        shouldRemapMetricExpansions &&
        metricPrefixes.length === 1
      ) {
        const [prefix] = metricPrefixes;
        collapsedMetricExpansions.forEach(expansion => {
          if (expansion.suffix.length === 0) {
            return;
          }
          const mappedPath = [
            ...prefix,
            expansion.metric,
            ...expansion.suffix,
          ];
          const mappedKey = serializePath(mappedPath);
          mappedExpansionPaths.push(mappedKey);
          next.add(mappedKey);
        });
      }
      if (axis === 'row' && mappedExpansionPaths.length > 0) {
        const hasNonSubtotalChildren = (parentNode: PivotTreeNode) =>
          findChildren(nextTree.rows, parentNode).some(child => {
            const val = child.path[parentNode.path.length];
            if (isSubtotalToken(val) || val === 'Total') {
              return false;
            }
            return true;
          });
        const expansionNodesToFetch = mappedExpansionPaths
          .map(key => nextTree.rows[key])
          .filter((rowNode): rowNode is PivotTreeNode => !!rowNode)
          .filter(rowNode => !hasNonSubtotalChildren(rowNode));
        for (const rowNode of expansionNodesToFetch) {
          await fetchBranchForNode(rowNode);
        }
      }
      updateExpanded(next);
    },
    [
      collectCollapsedMetricExpansions,
      collectDimPrefixes,
      expandedCols,
      expandedRows,
      fetchedColKeys,
      fetchedRowKeys,
      formData,
      groupbyRows.length,
      hasLoadedChildren,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      maxDepthPerFetch,
      metricLabelSet,
      metricLayoutIndexOnRows,
      peekPivotBranchCache,
      pruneCollapsedMetricRows,
      recomputeExpandedRows,
      resolvedMetricsLayout,
      shouldShowToggle,
      tree,
      visibleColDepth,
      visibleRowDepth,
    ],
  );

  const renderValue = useCallback(
    (metric: string, value: DataRecordValue) =>
      formatMetricValue(
        metric,
        value,
        columnFormats,
        currencyFormats,
        val => numberFormatter(val as number),
      ),
    [columnFormats, currencyFormats, numberFormatter],
  );

  const handleCellClick = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      if (!emitCrossFilters) {
        return;
      }
      const filters = buildCellFilters({
        rowNode,
        colNode,
        groupbyRows,
        groupbyColumns,
        metrics,
        metricsLayout: resolvedMetricsLayout,
      });
      const binaryFilters = filters.filter(
        (filter): filter is BinaryQueryObjectFilterClause => 'val' in filter,
      );
      setDataMask({
        extraFormData: {
          filters: filters as any,
        },
        filterState: {
          value: binaryFilters.map(filter => filter.val),
          selectedFilters: binaryFilters.reduce((acc, filter) => {
            const key = String(
              'col' in filter ? (filter as any).col : (filter as any).subject,
            );
            return {
              ...acc,
              [key]: [filter.val],
            };
          }, {} as Record<string, DataRecordValue[]>),
        },
      });
    },
    [
      emitCrossFilters,
      groupbyColumns,
      groupbyRows,
      metrics,
      resolvedMetricsLayout,
      setDataMask,
    ],
  );

  const handleCellContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLTableCellElement>,
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ) => {
      if (!onContextMenu) {
        return;
      }
      event.preventDefault();
      const contextFilters = buildContextMenuFilters({
        rowNode,
        colNode,
        groupbyRows,
        groupbyColumns,
        metrics,
        metricsLayout: resolvedMetricsLayout,
        dateFormatters,
        timeGrainSqla,
      });

      onContextMenu(event.clientX, event.clientY, {
        drillToDetail: contextFilters,
        crossFilter: emitCrossFilters
          ? {
              dataMask: {
                extraFormData: { filters: contextFilters as any },
                filterState: {
                  value: contextFilters.map(filter => filter.val),
                  selectedFilters: contextFilters.reduce(
                    (acc, filter) => ({
                      ...acc,
                      [String(filter.col)]: [filter.val],
                    }),
                    {},
                  ),
                },
              },
              isCurrentValueSelected: false,
            }
          : undefined,
      });
    },
    [
      dateFormatters,
      emitCrossFilters,
      groupbyColumns,
      groupbyRows,
      metrics,
      resolvedMetricsLayout,
      onContextMenu,
      timeGrainSqla,
    ],
  );

  const deriveMetricKey = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) =>
      deriveMetricKeyBase({
        rowNode,
        colNode,
        metrics,
        metricsLayout: resolvedMetricsLayout,
        cells: tree.cells,
      }),
    [metrics, resolvedMetricsLayout, tree.cells],
  );

  const shouldHideRowValues = useCallback(
    (rowNode: PivotTreeNode) =>
      shouldHideRowValuesBase({
        rowNode,
        rowSubTotals,
        effectiveRowSubtotalPosition: getRowSubtotalPosition(rowNode),
        metricLabelSet,
        expandedRows,
        countDimDepth,
        rowSubtotalDepths,
        isExplicitSubtotalNode,
      }),
    [
      countDimDepth,
      expandedRows,
      getRowSubtotalPosition,
      isExplicitSubtotalNode,
      metricLabelSet,
      rowSubtotalDepths,
      rowSubTotals,
    ],
  );

  const renderCellContent = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      if (shouldHideRowValues(rowNode)) {
        return '';
      }
      const cell = tree.cells[`${rowNode.key}|${colNode.key}`];
      if (!cell) {
        return '';
      }
      const metricKey = deriveMetricKey(rowNode, colNode);
      const value = renderValue(metricKey, cell.values[metricKey]);
      if (allowRenderHtml && typeof value === 'string' && value.includes('<')) {
        return <span dangerouslySetInnerHTML={{ __html: value }} />;
      }
      return value;
    },
    [
      allowRenderHtml,
      deriveMetricKey,
      renderValue,
      shouldHideRowValues,
      tree.cells,
    ],
  );

  const formatLabel = useCallback(
    (node: PivotTreeNode, axis: 'row' | 'col') =>
      formatNodeLabelBase({
        node,
        axis,
        metricsLayout: resolvedMetricsLayout,
        metricIndexOnRows,
        isMetricGrandTotalNode,
        getMetricLabelFromPath,
        translate: t,
        subtotalLabel: SUBTOTAL_LABEL,
        isSubtotalToken,
      }),
    [
      getMetricLabelFromPath,
      isMetricGrandTotalNode,
      metricIndexOnRows,
      resolvedMetricsLayout,
      t,
    ],
  );

  return (
    <Container height={height} width={width}>
      {errorMessage && <div>{t('Error loading branch: %s', errorMessage)}</div>}
      <StyledTable>
        <thead>
          {columnHeaderRows.length === 0 ? (
            <tr>
              <th
                style={
                  themeColor
                    ? { backgroundColor: themeColor, fontWeight: 600 }
                    : { fontWeight: 600 }
                }
              >
                {t('Rows')}
              </th>
            </tr>
          ) : (
            columnHeaderRows.map((rowCells, rowIdx) => (
              <tr key={`col-header-row-${rowIdx}`}>
                {rowIdx === 0 && (
                  <th
                    rowSpan={columnHeaderRows.length}
                    style={
                      themeColor
                        ? { backgroundColor: themeColor, fontWeight: 600 }
                        : { fontWeight: 600 }
                    }
                  >
                    {t('Rows')}
                  </th>
                )}
                {rowCells.map(cell => {
                  const showToggle = shouldShowToggle('col', cell.node);
                  const isSubtotalHeader = isColAggregateBold(cell.node);
                  return (
                    <th
                      key={`col-header-${cell.node.key}-${rowIdx}`}
                      colSpan={cell.colSpan}
                      rowSpan={cell.rowSpan}
                      className={isSubtotalHeader ? 'subtotal-cell' : undefined}
                      style={
                        themeColor
                          ? { backgroundColor: themeColor }
                          : undefined
                      }
                    >
                      <ColumnHeaderCell>
                        {showToggle && (
                          <ToggleButton
                            type="button"
                            onClick={() => handleToggle('col', cell.node)}
                          >
                            {expandedCols.has(cell.node.key) ? (
                              <MinusSquareOutlined />
                            ) : (
                              <PlusSquareOutlined />
                            )}
                          </ToggleButton>
                        )}
                        <span>{formatLabel(cell.node, 'col')}</span>
                        {loadingKeys.has(cell.node.key) && <Spinner />}
                      </ColumnHeaderCell>
                    </th>
                  );
                })}
              </tr>
            ))
          )}
        </thead>
        <tbody>
          {visibleRows.map(row => {
            const showToggle = shouldShowToggle('row', row);
            const rowAggregateBold = isRowAggregateBold(row);
            const isSubtotalHeader = rowAggregateBold;
            const rowTotalBg = getTotalBackground(row);
            const rowIndent = getNodeDimDepth(row) * ROW_INDENT_PX;
            return (
              <tr key={row.key}>
                <th
                  className={isSubtotalHeader ? 'subtotal-cell' : undefined}
                  style={rowTotalBg ? { backgroundColor: rowTotalBg } : undefined}
                >
                  <HeaderCell style={{ paddingLeft: rowIndent }}>
                    {showToggle ? (
                      <ToggleButton
                        type="button"
                        onClick={() => handleToggle('row', row)}
                      >
                        {expandedRows.has(row.key) ? (
                          <MinusSquareOutlined />
                        ) : (
                          <PlusSquareOutlined />
                        )}
                      </ToggleButton>
                    ) : null}
                    <span>{formatLabel(row, 'row')}</span>
                    {loadingKeys.has(row.key) && <Spinner />}
                  </HeaderCell>
                </th>
                {visibleCols.map(col => {
                  const cellKey = `${row.key}|${col.key}`;
                  const colAggregateBold = isColAggregateBold(col);
                  const isSubtotalCell = rowAggregateBold || colAggregateBold;
                  const cellTotalBg = rowTotalBg;
                  const cellClassName = isSubtotalCell
                    ? 'subtotal-cell value-cell'
                    : 'value-cell';
                  return (
                    <td
                      key={cellKey}
                      className={cellClassName}
                      style={
                        cellTotalBg ? { backgroundColor: cellTotalBg } : undefined
                      }
                      onClick={() => handleCellClick(row, col)}
                      onContextMenu={event =>
                        handleCellContextMenu(event, row, col)
                      }
                    >
                      {renderCellContent(row, col)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </StyledTable>
    </Container>
  );
}

export default PivotTableChart;
