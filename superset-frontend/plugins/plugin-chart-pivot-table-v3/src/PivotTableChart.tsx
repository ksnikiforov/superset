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
  CurrencyFormatter,
  DataRecordValue,
  getColumnLabel,
  getNumberFormatter,
  QueryObjectFilterClause,
  GenericDataType,
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
  isSubtotalToken,
  mergeTrees,
  parseThemeColors,
  PIVOT_THEME_PRESETS,
  serializePath,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from './utils';

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

const rootKey = serializePath([]);

const findChildren = (
  nodes: Record<string, PivotTreeNode>,
  parent: PivotTreeNode,
) =>
  Object.values(nodes).filter(
    child =>
      child.path.length === parent.path.length + 1 &&
      parent.path.every((val, index) => val === child.path[index]),
  );

const buildVisibleList = (
  nodes: Record<string, PivotTreeNode>,
  expanded: Set<string>,
  sorter: (a: PivotTreeNode, b: PivotTreeNode) => number,
  skipRoot = false,
  getChildren: (node: PivotTreeNode) => PivotTreeNode[] = node =>
    findChildren(nodes, node),
  getCollapsedChildren?: (node: PivotTreeNode) => PivotTreeNode[],
) => {
  const ordered: PivotTreeNode[] = [];
  const root = nodes[rootKey];
  if (!root) {
    return ordered;
  }

  const traverse = (node: PivotTreeNode) => {
    ordered.push(node);
    const children = getChildren(node).sort(sorter);
    if (!expanded.has(node.key)) {
      if (getCollapsedChildren) {
        const collapsedChildren = getCollapsedChildren(node).sort(sorter);
        collapsedChildren.forEach(traverse);
      }
      return;
    }
    children.forEach(traverse);
  };

  if (skipRoot) {
    const children = getChildren(root).sort(sorter);
    children.forEach(traverse);
  } else {
    traverse(root);
  }
  return ordered;
};

const buildVisibleLeafList = (
  nodes: Record<string, PivotTreeNode>,
  expanded: Set<string>,
  sorter: (a: PivotTreeNode, b: PivotTreeNode) => number,
  skipRoot = false,
  getChildren: (node: PivotTreeNode) => PivotTreeNode[] = node =>
    findChildren(nodes, node),
) => {
  const leaves: PivotTreeNode[] = [];
  const root = nodes[rootKey];
  if (!root) {
    return leaves;
  }

  const traverse = (node: PivotTreeNode) => {
    const children = getChildren(node).sort(sorter);
    if (!expanded.has(node.key) || children.length === 0) {
      leaves.push(node);
      return;
    }
    children.forEach(traverse);
  };

  if (skipRoot) {
    const children = getChildren(root).sort(sorter);
    children.forEach(traverse);
  } else {
    traverse(root);
  }

  return leaves;
};

type HeaderCellInfo = {
  node: PivotTreeNode;
  colSpan: number;
  rowSpan: number;
};

const buildColumnHeaderRows = (
  cols: PivotTreeNode[],
  nodes: Record<string, PivotTreeNode>,
) => {
  if (cols.length === 0) {
    return [] as HeaderCellInfo[][];
  }
  const maxDepth = Math.max(...cols.map(col => Math.max(col.path.length, 1)));
  const rows: HeaderCellInfo[][] = Array.from({ length: maxDepth }, () => []);
  // Track the last cell per row to aggregate colspan across adjacent columns.
  const lastCells: (HeaderCellInfo | undefined)[] = Array(maxDepth).fill(
    undefined,
  );

  cols.forEach(col => {
    const path = col.path;
    if (path.length === 0) {
      const cell: HeaderCellInfo = {
        node: col,
        colSpan: 1,
        rowSpan: maxDepth,
      };
      rows[0].push(cell);
      return;
    }
    const lastLevel = path.length - 1;
    for (let level = 0; level < maxDepth; level += 1) {
      if (level >= path.length) {
        // covered by rowSpan of the last existing level
        break;
      }
      const headerPath = path.slice(0, level + 1);
      const key = serializePath(headerPath);
      const node =
        nodes[key] ||
        ({
          axis: 'col',
          key,
          path: headerPath,
          label: headerPath[level]?.toString() ?? '',
          formattedLabel: headerPath[level]?.toString() ?? '',
          level: headerPath.length,
          hasChildren: level < maxDepth - 1,
          isSubtotal: headerPath.some(isSubtotalToken),
        } as PivotTreeNode);
      const rowSpan = level === lastLevel ? maxDepth - level : 1;
      const prev = lastCells[level];
      if (prev && prev.node.key === node.key && prev.rowSpan === rowSpan) {
        prev.colSpan += 1;
      } else {
        const cell: HeaderCellInfo = {
          node,
          colSpan: 1,
          rowSpan,
        };
        rows[level].push(cell);
        lastCells[level] = cell;
      }
    }
  });

  return rows;
};

const compareValues = (
  a: DataRecordValue,
  b: DataRecordValue,
  type?: GenericDataType,
) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  switch (type) {
    case GenericDataType.Numeric:
      return (Number(a) || 0) - (Number(b) || 0);
    case GenericDataType.Temporal:
      return (new Date(a as any).getTime() || 0) - (new Date(b as any).getTime() || 0);
    default:
      return String(a).localeCompare(String(b));
  }
};

const sortByOrder =
  (
    order: string,
    colTypeMap?: Record<string, GenericDataType>,
    groupby?: string[],
  ) =>
  (a: PivotTreeNode, b: PivotTreeNode) => {
    if (order === 'key_z_to_a') {
      return b.formattedLabel.localeCompare(a.formattedLabel);
    }
    // Determine type based on current level label, if available
    const level = a.path.length - 1;
    const label = groupby?.[level];
    const type = label ? colTypeMap?.[label] : undefined;
    const cmp = compareValues(a.label, b.label, type);
    return order === 'key_a_to_z' ? cmp : -cmp;
  };

const formatMetricValue = (
  metric: string,
  value: DataRecordValue,
  columnFormats: Record<string, string>,
  currencyFormats: Record<string, any>,
  defaultFormatter: (v: number | null | undefined) => string,
) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'number') {
    return String(value);
  }
  const currency = currencyFormats?.[metric];
  const d3Format = columnFormats?.[metric];
  if (currency) {
    return new CurrencyFormatter({
      currency,
      d3Format: d3Format || undefined,
    }).format(value);
  }
  if (d3Format) {
    return getNumberFormatter(d3Format)(value);
  }
  return defaultFormatter(value);
};

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

  const metricLabels = useMemo(
    () =>
      metrics.map(m => (typeof m === 'string' ? m : getColumnLabel(m as any))),
    [metrics],
  );

  const metricLabelSet = useMemo(() => new Set(metricLabels), [metricLabels]);
  const isMultiMetric = metricLabels.length > 1;
  const forceRowSubtotalEnd = rowSubTotals && isMultiMetric;
  const effectiveRowSubtotalPosition = forceRowSubtotalEnd
    ? 'end'
    : resolvedRowSubtotalPosition;

  const findMetricIndex = useCallback(
    (nodes: Record<string, PivotTreeNode>) => {
      let found: number | undefined;
      Object.values(nodes).forEach(node => {
        const idx = node.path.findIndex(val =>
          metricLabelSet.has(String(val ?? '')),
        );
        if (idx >= 0) {
          found = found === undefined ? idx : Math.max(found, idx);
        }
      });
      return found;
    },
    [metricLabelSet],
  );

  const metricIndexOnRows = useMemo(
    () => findMetricIndex(tree.rows),
    [findMetricIndex, tree.rows],
  );
  const metricIndexOnCols = useMemo(
    () => findMetricIndex(tree.cols),
    [findMetricIndex, tree.cols],
  );

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

  const metricIndexForRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS && !hideMetricHeaderOnRows
      ? metricIndexOnRows ?? 0
      : metricIndexOnRows;
  const metricIndexForCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS && !hideMetricHeaderOnCols
      ? metricIndexOnCols ?? 0
      : metricIndexOnCols;

  const getMetricDepthForParent = useCallback(
    (nodes: Record<string, PivotTreeNode>, parent: PivotTreeNode) => {
      let minIndex: number | undefined;
      Object.values(nodes).forEach(node => {
        if (
          node.path.length <= parent.path.length ||
          !parent.path.every((val, idx) => val === node.path[idx])
        ) {
          return;
        }
        const idx = node.path.findIndex(val =>
          metricLabelSet.has(String(val ?? '')),
        );
        if (idx >= 0) {
          minIndex = minIndex === undefined ? idx : Math.min(minIndex, idx);
        }
      });
      return minIndex;
    },
    [metricLabelSet],
  );

  const getMetricTierNodes = useCallback(
    (
      nodes: Record<string, PivotTreeNode>,
      parent: PivotTreeNode,
      metricDepth: number,
    ) =>
      Object.values(nodes).filter(
        node =>
          node.path.length === metricDepth + 1 &&
          parent.path.every((val, idx) => val === node.path[idx]) &&
          metricLabelSet.has(String(node.path[metricDepth] ?? '')),
      ),
    [metricLabelSet],
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
      if (
        parent.path.some(val => metricLabelSet.has(String(val ?? '')))
      ) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(tree.rows, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      return getMetricTierNodes(tree.rows, parent, metricDepth);
    },
    [
      expandedRows,
      getMetricDepthForParent,
      getMetricTierNodes,
      isMultiMetric,
      metricLabelSet,
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
          const hasChildren = getRawColChildren(existing).length > 0;
          return { ...existing, hasChildren };
        }
        return {
          ...(sourceNode || metricNodes[0]),
          key: collapsedKey,
          path: collapsedPath,
          label: metricLabel,
          formattedLabel: metricLabel,
          level: collapsedPath.length,
          hasChildren: false,
        };
      });
    },
    [
      expandedCols,
      getMetricDepthForParent,
      getMetricTierNodes,
      getRawColChildren,
      isMultiMetric,
      metricLabelSet,
      resolvedMetricsLayout,
      tree.cols,
    ],
  );

  const getRowChildren = useCallback(
    (parent: PivotTreeNode) => {
      const children = getRawRowChildren(parent);
      const filteredByMetricPosition = children.filter(child => {
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
        (metricIndexOnRows === undefined ||
          metricIndexOnRows > parent.level)
      ) {
        const withoutMetrics = children.filter(
          child => !metricLabelSet.has(String(child.path[parent.level] ?? '')),
        );
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
      if (!rowSubTotals || effectiveRowSubtotalPosition === 'start') {
        filtered = filtered.filter(child => {
          if (!child.isSubtotal || child.path.length === 0) {
            return true;
          }
          if (child.path.some(isSubtotalToken)) {
            return false;
          }
          if (
            child.label === SUBTOTAL_LABEL ||
            child.formattedLabel === SUBTOTAL_LABEL
          ) {
            return false;
          }
          return true;
        });
      }
      if (rowSubTotals && effectiveRowSubtotalPosition === 'end') {
        const requireMetricLabel =
          resolvedMetricsLayout === MetricsLayoutEnum.ROWS && isMultiMetric;
        const subtotalDescendants = Object.values(tree.rows).filter(node => {
          if (node.path.length <= parent.path.length) {
            return false;
          }
          if (!parent.path.every((val, idx) => val === node.path[idx])) {
            return false;
          }
          if (node.path[parent.path.length] !== SUBTOTAL_TOKEN) {
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
          if (!child.path.some(isSubtotalToken)) {
            return true;
          }
          return child.path.some(val =>
            metricLabelSet.has(String(val ?? '')),
          );
        });
      }
      return filtered;
    },
    [
      getRawRowChildren,
      groupbyRows.length,
      metricIndexForRows,
      hideMetricHeaderOnRows,
      metricLabelSet,
      resolvedMetricsLayout,
      effectiveRowSubtotalPosition,
      isMultiMetric,
      rowSubTotals,
      tree.rows,
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
        (metricIndexOnCols === undefined ||
          metricIndexOnCols > parent.level)
      ) {
        const withoutMetrics = children.filter(
          child => !metricLabelSet.has(String(child.path[parent.level] ?? '')),
        );
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
      return filtered;
    },
    [
      getRawColChildren,
      groupbyColumns.length,
      metricIndexForCols,
      hideMetricHeaderOnCols,
      metricLabelSet,
      resolvedMetricsLayout,
    ],
  );

  const rowSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      rowOrder,
      colTypeMap,
      groupbyRows.map(getColumnLabel),
    );
    if (!rowSubTotals || effectiveRowSubtotalPosition !== 'end') {
      return baseSorter;
    }
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      const aSubtotal = a.path.some(isSubtotalToken) ? 1 : 0;
      const bSubtotal = b.path.some(isSubtotalToken) ? 1 : 0;
      if (aSubtotal !== bSubtotal) {
        return aSubtotal - bSubtotal;
      }
      return baseSorter(a, b);
    };
  }, [
    colTypeMap,
    effectiveRowSubtotalPosition,
    groupbyRows,
    rowOrder,
    rowSubTotals,
  ]);
  const colSorter = useMemo(
    () => sortByOrder(colOrder, colTypeMap, groupbyColumns.map(getColumnLabel)),
    [colOrder, colTypeMap, groupbyColumns],
  );

  const countDimDepth = useCallback(
    (path: PivotTreeNode['path']) =>
      path.filter(val => !metricLabelSet.has(String(val ?? ''))).length,
    [metricLabelSet],
  );

  const showRowRoot =
    groupbyRows.length > 0 &&
    (normalizedRowSubtotalLevels.includes(0) || rowTotals);
  const showColRoot =
    groupbyColumns.length > 0 &&
    (normalizedColSubtotalLevels.includes(0) || colTotals || colSubTotals);

  const skipRowRoot = groupbyRows.length > 0 && !showRowRoot;
  const skipColRoot = groupbyColumns.length === 0 || !showColRoot;

  const visibleRows = useMemo(() => {
    const ordered = buildVisibleList(
      tree.rows,
      expandedRows,
      rowSorter,
      skipRowRoot,
      getRowChildren,
      getCollapsedRowChildren,
    );
    if (resolvedRowTotalPosition === 'end' && showRowRoot) {
      const rootIdx = ordered.findIndex(row => row.key === rootKey);
      if (rootIdx >= 0) {
        const [rootRow] = ordered.splice(rootIdx, 1);
        return [...ordered, rootRow];
      }
    }
    return ordered;
  }, [
    expandedRows,
    getCollapsedRowChildren,
    getRowChildren,
    rowSorter,
    resolvedRowTotalPosition,
    showRowRoot,
    skipRowRoot,
    tree.rows,
  ]);

  const buildColLeavesWithSubtotals = useCallback(
    (node: PivotTreeNode): PivotTreeNode[] => {
      const children = getColChildren(node).sort(colSorter);
      const dimDepth = countDimDepth(node.path);
      const hasChildren = children.length > 0;
      const includeSubtotal =
        hasChildren &&
        ((colTotals && dimDepth === 0) ||
          normalizedColSubtotalLevels.includes(dimDepth) ||
          colSubTotals) &&
        !(dimDepth === 0 && !showColRoot);
      if (!expandedCols.has(node.key) || children.length === 0) {
        const collapsedMetricLeaves = getCollapsedColLeaves(node);
        return collapsedMetricLeaves.length > 0 ? collapsedMetricLeaves : [node];
      }
      const placeAtFront =
        (
          dimDepth === 0
            ? resolvedColTotalPosition
            : resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS && isMultiMetric
            ? 'end'
            : resolvedColSubtotalPosition
        ) === 'start';
      const childLeaves = children.flatMap(buildColLeavesWithSubtotals);
      if (!includeSubtotal) {
        return childLeaves;
      }
      const isBranchLeaf = (leaf: PivotTreeNode) =>
        leaf.isSubtotal &&
        leaf.path.length === node.path.length + 1 &&
        node.path.every((val, idx) => val === leaf.path[idx]);
      const isExplicitSubtotalLeaf = (leaf: PivotTreeNode) => {
        if (!isBranchLeaf(leaf)) {
          return false;
        }
        const token = leaf.path[node.path.length];
        return (
          isSubtotalToken(token) ||
          leaf.formattedLabel === SUBTOTAL_LABEL ||
          leaf.label === SUBTOTAL_LABEL
        );
      };
      const explicitSubtotalLeaf = childLeaves.find(isExplicitSubtotalLeaf);
      const isDuplicateSubtotalLeaf = (leaf: PivotTreeNode) => {
        if (!isBranchLeaf(leaf)) {
          return false;
        }
        const token = leaf.path[node.path.length];
        if (
          isSubtotalToken(token) ||
          leaf.formattedLabel === SUBTOTAL_LABEL ||
          leaf.label === SUBTOTAL_LABEL
        ) {
          return true;
        }
        if (!explicitSubtotalLeaf) {
          return leaf.label === node.label;
        }
        return leaf.label === node.label || node.path.includes(token);
      };
      const subtotalLeaf =
        explicitSubtotalLeaf || childLeaves.find(isDuplicateSubtotalLeaf);
      if (subtotalLeaf) {
        const remainingLeaves = childLeaves.filter(
          leaf =>
            leaf.key !== subtotalLeaf.key && !isDuplicateSubtotalLeaf(leaf),
        );
        return placeAtFront
          ? [subtotalLeaf, ...remainingLeaves]
          : [...remainingLeaves, subtotalLeaf];
      }
      return placeAtFront ? [node, ...childLeaves] : [...childLeaves, node];
    },
    [
      getColChildren,
      colSorter,
      countDimDepth,
      normalizedColSubtotalLevels,
      showColRoot,
      expandedCols,
      resolvedColTotalPosition,
      resolvedColSubtotalPosition,
      colTotals,
      colSubTotals,
      getCollapsedColLeaves,
      isMultiMetric,
      resolvedMetricsLayout,
    ],
  );

  const visibleCols = useMemo(() => {
    const root = tree.cols[rootKey];
    if (!root) {
      return [] as PivotTreeNode[];
    }
    const startNodes = skipColRoot
      ? getColChildren(root).sort(colSorter)
      : [root];
    const leaves = startNodes.flatMap(buildColLeavesWithSubtotals);
    if (leaves.length === 0 && tree.cols[rootKey]) {
      return [tree.cols[rootKey]];
    }
    return leaves;
  }, [
    buildColLeavesWithSubtotals,
    colSorter,
    getColChildren,
    skipColRoot,
    tree.cols,
  ]);
  const visibleRowDepth = useMemo(
    () => Math.max(0, ...visibleRows.map(row => countDimDepth(row.path))),
    [countDimDepth, visibleRows],
  );
  const visibleColDepth = useMemo(
    () => Math.max(0, ...visibleCols.map(col => countDimDepth(col.path))),
    [countDimDepth, visibleCols],
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
    (axis: 'row' | 'col', node: PivotTreeNode) => {
      const children =
        axis === 'row' ? getRawRowChildren(node) : getRawColChildren(node);
      if (children.length === 0) {
        return false;
      }
      const groupby = axis === 'row' ? groupbyRows : groupbyColumns;
      const parentDimDepth = node.path.filter(
        val => !metricLabelSet.has(String(val ?? '')),
      ).length;
      const metricIndex =
        axis === 'row' ? metricIndexForRows : metricIndexForCols;
      if (
        metricIndex !== undefined &&
        node.path.length > metricIndex &&
        metricLabelSet.has(String(node.path[metricIndex] ?? '')) &&
        parentDimDepth < groupby.length
      ) {
        // Sitting on the metric tier and deeper dimensions remain; force fetch.
        return false;
      }
      const childDimDepths = children.map(
        child =>
          child.path.filter(
            val => !metricLabelSet.has(String(val ?? '')),
          ).length,
      );
      const maxChildDimDepth = Math.max(...childDimDepths, 0);
      const childCellRowDepths: number[] = [];
      const childCellColDepths: number[] = [];
      const hasChildCells = children.some(child =>
        Object.keys(tree.cells).some(key => {
          const matches =
            axis === 'row'
              ? key.startsWith(`${child.key}|`)
              : key.endsWith(`|${child.key}`);
          if (matches) {
            const [rowKey, colKey] = key.split('|');
            const rowNode = tree.rows[rowKey];
            const colNode = tree.cols[colKey];
            if (rowNode) {
              childCellRowDepths.push(
                rowNode.path.filter(
                  val => !metricLabelSet.has(String(val ?? '')),
                ).length,
              );
            }
            if (colNode) {
              childCellColDepths.push(
                colNode.path.filter(
                  val => !metricLabelSet.has(String(val ?? '')),
                ).length,
              );
            }
          }
          return matches;
        }),
      );
      const maxChildRowDepth = Math.max(...childCellRowDepths, 0);
      const maxChildColDepth = Math.max(...childCellColDepths, 0);
      if (
        parentDimDepth < groupby.length &&
        (maxChildDimDepth <= parentDimDepth || !hasChildCells)
      ) {
        // Only metric-tier children or placeholder nodes are present; treat as not loaded.
        return false;
      }
      if (axis === 'col' && visibleRowDepth > maxChildRowDepth) {
        return false;
      }
      if (axis === 'row' && visibleColDepth > maxChildColDepth) {
        return false;
      }
      return true;
    },
    [
      getRawColChildren,
      getRawRowChildren,
      groupbyColumns,
      groupbyRows,
      metricLabelSet,
      metricIndexForCols,
      metricIndexForRows,
      tree.cells,
      visibleColDepth,
      visibleRowDepth,
    ],
  );
  const columnHeaderRows = useMemo(
    () => buildColumnHeaderRows(visibleCols, tree.cols),
    [visibleCols, tree.cols],
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
  const expandedRowDepths = useMemo(() => {
    const depths = new Set<number>();
    expandedRows.forEach(key => {
      const node = tree.rows[key];
      if (!node || !node.hasChildren) {
        return;
      }
      if (node.path.length === 0) {
        return;
      }
      const dimDepth = countDimDepth(node.path);
      if (dimDepth < groupbyRows.length) {
        depths.add(dimDepth);
      }
    });
    return depths;
  }, [countDimDepth, expandedRows, groupbyRows.length, tree.rows]);
  const expandedColDepths = useMemo(() => {
    const depths = new Set<number>();
    expandedCols.forEach(key => {
      const node = tree.cols[key];
      if (!node || !node.hasChildren) {
        return;
      }
      if (node.path.length === 0) {
        return;
      }
      const dimDepth = countDimDepth(node.path);
      if (dimDepth < groupbyColumns.length) {
        depths.add(dimDepth);
      }
    });
    return depths;
  }, [countDimDepth, expandedCols, groupbyColumns.length, tree.cols]);
  const isExplicitTotalNode = useCallback(
    (node: PivotTreeNode) => {
      if (node.path.length === 0) {
        return true;
      }
      return (
        node.path.some(isSubtotalToken) ||
        isSubtotalToken(node.label) ||
        isSubtotalToken(node.formattedLabel)
      );
    },
    [],
  );
  const isExplicitSubtotalNode = useCallback(
    (node?: PivotTreeNode) => {
      if (!node) {
        return false;
      }
      return node.path.some(isSubtotalToken);
    },
    [],
  );
  const getNodeDimDepth = useCallback(
    (node: PivotTreeNode) => {
      const dimDepth = countDimDepth(node.path);
      return isExplicitSubtotalNode(node) ? Math.max(dimDepth - 1, 0) : dimDepth;
    },
    [countDimDepth, isExplicitSubtotalNode],
  );
  const shouldShowToggle = useCallback(
    (_axis: 'row' | 'col', node?: PivotTreeNode) => {
      if (!node || !node.hasChildren || node.path.length === 0) {
        return false;
      }
      if (isExplicitSubtotalNode(node)) {
        return false;
      }
      return true;
    },
    [isExplicitSubtotalNode],
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
        const next = new Set(expanded);
        next.delete(node.key);
        updateExpanded(next);
        return;
      }

      const fetchedKeys = axis === 'row' ? fetchedRowKeys : fetchedColKeys;
      const requiredDepth = axis === 'row' ? visibleColDepth : visibleRowDepth;
      const fetchedDepth = fetchedKeys.get(node.key) ?? -1;
      const markFetched =
        axis === 'row' ? setFetchedRowKeys : setFetchedColKeys;

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
          setTree(current => mergeTrees(current, cached));
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
            setTree(current => mergeTrees(current, result.data));
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
      const next = new Set(expanded);
      next.add(node.key);
      updateExpanded(next);
    },
    [
      expandedCols,
      expandedRows,
      fetchedColKeys,
      fetchedRowKeys,
      formData,
      hasLoadedChildren,
      maxDepthPerFetch,
      peekPivotBranchCache,
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

  const buildFilters = useCallback(
    (
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ): QueryObjectFilterClause[] => {
      const metricLabels = metrics.map(m =>
        typeof m === 'string' ? m : getColumnLabel(m as any),
      );
      const normalizedRowPath =
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS
          ? rowNode.path.filter(
              val => !metricLabels.includes(String(val ?? '')),
            )
          : rowNode.path;
      const normalizedColPath =
        resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS
          ? colNode.path.filter(
              val => !metricLabels.includes(String(val ?? '')),
            )
          : colNode.path;
      return [
        ...normalizedRowPath.map((val, i) => ({
          col: getColumnLabel(groupbyRows[i]),
          op: (val === null || val === undefined ? 'IS NULL' : '==') as any,
          val: val === undefined ? null : val,
        })),
        ...normalizedColPath.map((val, i) => ({
          col: getColumnLabel(groupbyColumns[i]),
          op: (val === null || val === undefined ? 'IS NULL' : '==') as any,
          val: val === undefined ? null : val,
        })),
      ];
    },
    [groupbyColumns, groupbyRows, metrics, resolvedMetricsLayout],
  );

  const handleCellClick = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      if (!emitCrossFilters) {
        return;
      }
      const filters = buildFilters(rowNode, colNode);
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
    [buildFilters, emitCrossFilters, setDataMask],
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
      const buildContextFilters = (
        node: PivotTreeNode,
        columns: any[],
        axis: 'row' | 'col',
      ) =>
        (axis === 'row' && resolvedMetricsLayout === MetricsLayoutEnum.ROWS
          ? node.path.filter(
              val =>
                !metrics
                  .map(m => (typeof m === 'string' ? m : getColumnLabel(m as any)))
                  .includes(String(val ?? '')),
            )
          : axis === 'col' && resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS
          ? node.path.filter(
              val =>
                !metrics
                  .map(m => (typeof m === 'string' ? m : getColumnLabel(m as any)))
                  .includes(String(val ?? '')),
            )
          : node.path
        ).map((val, idx) => {
          const col = getColumnLabel(columns[idx]);
          const formatter = dateFormatters[col];
          return {
            col,
            op: '==',
            val,
            formattedVal:
              typeof formatter === 'function'
                ? formatter(val as any)
                : String(val),
            grain: formatter && axis === 'row' ? timeGrainSqla : undefined,
          } as BinaryQueryObjectFilterClause;
        });

      const contextFilters = [
        ...buildContextFilters(rowNode, groupbyRows, 'row'),
        ...buildContextFilters(colNode, groupbyColumns, 'col'),
      ];

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
      getColumnLabel,
      groupbyColumns,
      groupbyRows,
      metrics,
      resolvedMetricsLayout,
      onContextMenu,
      timeGrainSqla,
    ],
  );

  const deriveMetricKey = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      const metricLabels = metrics.map(m =>
        typeof m === 'string' ? m : getColumnLabel(m as any),
      );
      // When metrics are on rows, the metric key is the last element in the row path.
      // When metrics are on cols, it is the last element in the col path.
      const metricCandidate =
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS
          ? rowNode.path[rowNode.path.length - 1]
          : colNode.path[colNode.path.length - 1];
      if (metricCandidate && metricLabels.includes(String(metricCandidate))) {
        return metricCandidate as string;
      }
      // Fallback: first available metric in the cell values.
      return Object.keys(tree.cells[`${rowNode.key}|${colNode.key}`]?.values || {})[0];
    },
    [resolvedMetricsLayout, metrics, tree.cells],
  );

  const shouldHideRowValues = useCallback(
    (rowNode: PivotTreeNode) => {
      if (!rowSubTotals || effectiveRowSubtotalPosition !== 'end') {
        return false;
      }
      if (rowNode.path.length === 0 || rowNode.path.some(isSubtotalToken)) {
        return false;
      }
      if (rowNode.path.some(val => metricLabelSet.has(String(val ?? '')))) {
        return false;
      }
      if (!rowNode.hasChildren) {
        return false;
      }
      const dimDepth = countDimDepth(rowNode.path);
      return rowSubtotalDepths.includes(dimDepth);
    },
    [
      countDimDepth,
      effectiveRowSubtotalPosition,
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
    (node: PivotTreeNode) => {
      const rawLabel = node.formattedLabel || node.label;
      const normalizedLabel = isSubtotalToken(rawLabel)
        ? SUBTOTAL_LABEL
        : rawLabel;
      return node.level === 0
        ? t(normalizedLabel || 'Grand total')
        : normalizedLabel;
    },
    [],
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
                        <span>{formatLabel(cell.node)}</span>
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
                    <span>{formatLabel(row)}</span>
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
