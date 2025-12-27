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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { mergeTrees, serializePath } from './utils';

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

  th {
    background: ${({ theme }) => (theme as any).colors?.grayscale?.light4 || (theme as any).colorBgLayout};
    text-align: left;
  }
`;

const HeaderCell = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => ((theme as any).gridUnit || 4) * 1.5}px;
`;

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
) => {
  const ordered: PivotTreeNode[] = [];
  const root = nodes[rootKey];
  if (!root) {
    return ordered;
  }

  const traverse = (node: PivotTreeNode) => {
    ordered.push(node);
    if (!expanded.has(node.key)) {
      return;
    }
    const children = getChildren(node).sort(sorter);
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
      const key = serializePath(path.slice(0, level + 1));
      const node = nodes[key];
      if (!node) {
        continue;
      }
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
  } = props;

  const [tree, setTree] = useState<PivotTreeData>(data);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string>();
  const [fetchedRowKeys, setFetchedRowKeys] = useState<Set<string>>(new Set());
  const [fetchedColKeys, setFetchedColKeys] = useState<Set<string>>(new Set());

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
    setFetchedRowKeys(new Set());
    setFetchedColKeys(new Set());
  }, [data, startCollapsed, initialDepth]);

  const metricLabels = useMemo(
    () =>
      metrics.map(m => (typeof m === 'string' ? m : getColumnLabel(m as any))),
    [metrics],
  );

  const metricLabelSet = useMemo(() => new Set(metricLabels), [metricLabels]);

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
      metricsLayout === MetricsLayoutEnum.ROWS &&
      metricLabels.length === 1 &&
      metricIndexOnRows !== undefined &&
      metricIndexOnRows === groupbyRows.length,
    [groupbyRows.length, metricIndexOnRows, metricLabels.length, metricsLayout],
  );
  const hideMetricHeaderOnCols = useMemo(
    () =>
      metricsLayout === MetricsLayoutEnum.COLUMNS &&
      metricLabels.length === 1 &&
      metricIndexOnCols !== undefined &&
      metricIndexOnCols === groupbyColumns.length,
    [
      groupbyColumns.length,
      metricIndexOnCols,
      metricLabels.length,
      metricsLayout,
    ],
  );

  const metricIndexForRows =
    metricsLayout === MetricsLayoutEnum.ROWS && !hideMetricHeaderOnRows
      ? metricIndexOnRows ?? 0
      : metricIndexOnRows;
  const metricIndexForCols =
    metricsLayout === MetricsLayoutEnum.COLUMNS && !hideMetricHeaderOnCols
      ? metricIndexOnCols ?? 0
      : metricIndexOnCols;

  const getRawRowChildren = useCallback(
    (parent: PivotTreeNode) => findChildren(tree.rows, parent),
    [tree.rows],
  );

  const getRawColChildren = useCallback(
    (parent: PivotTreeNode) => findChildren(tree.cols, parent),
    [tree.cols],
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
        metricsLayout === MetricsLayoutEnum.ROWS &&
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
      return filtered;
    },
    [
      getRawRowChildren,
      groupbyRows.length,
      metricIndexForRows,
      hideMetricHeaderOnRows,
      metricLabelSet,
      metricsLayout,
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
        metricsLayout === MetricsLayoutEnum.COLUMNS &&
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
      metricsLayout,
    ],
  );

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
      const hasChildCells = children.some(child =>
        Object.keys(tree.cells).some(key =>
          axis === 'row' ? key.startsWith(`${child.key}|`) : key.endsWith(`|${child.key}`),
        ),
      );
      if (
        parentDimDepth < groupby.length &&
        (maxChildDimDepth <= parentDimDepth || !hasChildCells)
      ) {
        // Only metric-tier children or placeholder nodes are present; treat as not loaded.
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
    ],
  );

  const handleToggle = useCallback(
    async (axis: 'row' | 'col', node: PivotTreeNode) => {
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
      const markFetched =
        axis === 'row' ? setFetchedRowKeys : setFetchedColKeys;

      if (
        node.hasChildren &&
        !hasLoadedChildren(axis, node) &&
        !fetchedKeys.has(node.key)
      ) {
        const cached = peekPivotBranchCache({
          axis,
          path: node.path,
          formData,
          maxDepthPerFetch,
          currentTree: tree,
        });
        if (cached) {
          setTree(current => mergeTrees(current, cached));
          markFetched(prev => {
            const next = new Set(prev);
            next.add(node.key);
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
          });
          if (result.error) {
            setErrorMessage(result.error.message);
          }
          if (result.data) {
            setTree(current => mergeTrees(current, result.data));
            markFetched(prev => {
              const next = new Set(prev);
              next.add(node.key);
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
      hasLoadedChildren,
      fetchedColKeys,
      fetchedRowKeys,
      maxDepthPerFetch,
      props,
      tree,
    ],
  );

  const rowSorter = useMemo(
    () => sortByOrder(rowOrder, colTypeMap, groupbyRows.map(getColumnLabel)),
    [rowOrder, colTypeMap, groupbyRows],
  );
  const colSorter = useMemo(
    () => sortByOrder(colOrder, colTypeMap, groupbyColumns.map(getColumnLabel)),
    [colOrder, colTypeMap, groupbyColumns],
  );

  const showRowRoot =
    groupbyRows.length > 0 &&
    (rowSubtotalLevels.includes(0) || rowTotals || rowSubTotals);
  const showColRoot =
    groupbyColumns.length > 0 &&
    (colSubtotalLevels.includes(0) || colTotals || colSubTotals);

  const skipRowRoot = groupbyRows.length > 0 && !showRowRoot;
  const skipColRoot = groupbyColumns.length === 0 || !showColRoot;

  const visibleRows = useMemo(
    () =>
      buildVisibleList(
        tree.rows,
        expandedRows,
        rowSorter,
        skipRowRoot,
        getRowChildren,
      ),
    [expandedRows, getRowChildren, rowSorter, skipRowRoot, tree.rows],
  );
  const visibleCols = useMemo(
    () => {
      const leaves = buildVisibleLeafList(
        tree.cols,
        expandedCols,
        colSorter,
        skipColRoot,
        getColChildren,
      );
      if (leaves.length === 0 && tree.cols[rootKey]) {
        return [tree.cols[rootKey]];
      }
      if (showColRoot && tree.cols[rootKey]) {
        return [tree.cols[rootKey], ...leaves];
      }
      return leaves;
    },
    [expandedCols, colSorter, getColChildren, skipColRoot, showColRoot, tree.cols],
  );
  const columnHeaderRows = useMemo(
    () => buildColumnHeaderRows(visibleCols, tree.cols),
    [visibleCols, tree.cols],
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
        metricsLayout === MetricsLayoutEnum.ROWS
          ? rowNode.path.filter(
              val => !metricLabels.includes(String(val ?? '')),
            )
          : rowNode.path;
      const normalizedColPath =
        metricsLayout === MetricsLayoutEnum.COLUMNS
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
    [groupbyColumns, groupbyRows, metrics, metricsLayout],
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
        (axis === 'row' && metricsLayout === MetricsLayoutEnum.ROWS
          ? node.path.filter(
              val =>
                !metrics
                  .map(m => (typeof m === 'string' ? m : getColumnLabel(m as any)))
                  .includes(String(val ?? '')),
            )
          : axis === 'col' && metricsLayout === MetricsLayoutEnum.COLUMNS
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
      metricsLayout,
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
        metricsLayout === MetricsLayoutEnum.ROWS
          ? rowNode.path[rowNode.path.length - 1]
          : colNode.path[colNode.path.length - 1];
      if (metricCandidate && metricLabels.includes(String(metricCandidate))) {
        return metricCandidate as string;
      }
      // Fallback: first available metric in the cell values.
      return Object.keys(tree.cells[`${rowNode.key}|${colNode.key}`]?.values || {})[0];
    },
    [metricsLayout, metrics, tree.cells],
  );

  const renderCellContent = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
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
    [allowRenderHtml, deriveMetricKey, renderValue, tree.cells],
  );

  return (
    <Container height={height} width={width}>
      {errorMessage && <div>{t('Error loading branch: %s', errorMessage)}</div>}
      <StyledTable>
        <thead>
          {columnHeaderRows.length === 0 ? (
            <tr>
              <th>{t('Rows')}</th>
            </tr>
          ) : (
            columnHeaderRows.map((rowCells, rowIdx) => (
              <tr key={`col-header-row-${rowIdx}`}>
                {rowIdx === 0 && (
                  <th rowSpan={columnHeaderRows.length}>{t('Rows')}</th>
                )}
                {rowCells.map(cell => {
                  const showToggle =
                    cell.node.hasChildren && cell.node.path.length > 0;
                  return (
                    <th
                      key={`col-header-${cell.node.key}-${rowIdx}`}
                      colSpan={cell.colSpan}
                      rowSpan={cell.rowSpan}
                    >
                      <HeaderCell>
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
                        <span>{cell.node.formattedLabel}</span>
                        {loadingKeys.has(cell.node.key) && <Spinner />}
                      </HeaderCell>
                    </th>
                  );
                })}
              </tr>
            ))
          )}
        </thead>
        <tbody>
          {visibleRows.map(row => {
            const showToggle =
              row.hasChildren && row.path.length > 0;
            return (
              <tr key={row.key}>
                <th>
                  <HeaderCell style={{ paddingLeft: row.path.length * 12 }}>
                    {showToggle && (
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
                    )}
                    <span>{row.formattedLabel}</span>
                    {loadingKeys.has(row.key) && <Spinner />}
                  </HeaderCell>
                </th>
                {visibleCols.map(col => (
                  <td
                    key={`${row.key}|${col.key}`}
                    onClick={() => handleCellClick(row, col)}
                    onContextMenu={event =>
                      handleCellContextMenu(event, row, col)
                    }
                  >
                    {renderCellContent(row, col)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </StyledTable>
    </Container>
  );
}

export default PivotTableChart;
