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
  styled,
  t,
} from '@superset-ui/core';
import { fetchPivotBranch } from './fetchPivotBranch';
import { PivotTableProps, PivotTreeData, PivotTreeNode } from './types';
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
    const children = findChildren(nodes, node).sort(sorter);
    children.forEach(traverse);
  };

  traverse(root);
  return ordered;
};

const sortByOrder = (order: string) => (a: PivotTreeNode, b: PivotTreeNode) => {
  if (order === 'key_z_to_a') {
    return b.formattedLabel.localeCompare(a.formattedLabel);
  }
  return a.formattedLabel.localeCompare(b.formattedLabel);
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
  } = props;

  const [tree, setTree] = useState<PivotTreeData>(data);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string>();

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
  }, [data, startCollapsed, initialDepth]);

  const hasLoadedChildren = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode) => {
      const nodes = axis === 'row' ? tree.rows : tree.cols;
      return findChildren(nodes, node).length > 0;
    },
    [tree.cols, tree.rows],
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

      if (node.hasChildren && !hasLoadedChildren(axis, node)) {
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
        }
        setLoadingKeys(prev => {
          const next = new Set(prev);
          next.delete(node.key);
          return next;
        });
      }
      const next = new Set(expanded);
      next.add(node.key);
      updateExpanded(next);
    },
    [
      expandedCols,
      expandedRows,
      hasLoadedChildren,
      maxDepthPerFetch,
      props,
      tree,
    ],
  );

  const rowSorter = useMemo(() => sortByOrder(rowOrder), [rowOrder]);
  const colSorter = useMemo(() => sortByOrder(colOrder), [colOrder]);

  const visibleRows = useMemo(
    () => buildVisibleList(tree.rows, expandedRows, rowSorter),
    [expandedRows, rowSorter, tree.rows],
  );
  const visibleCols = useMemo(
    () => buildVisibleList(tree.cols, expandedCols, colSorter),
    [expandedCols, colSorter, tree.cols],
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
    ): QueryObjectFilterClause[] => [
      ...rowNode.path.map((val, i) => ({
        col: getColumnLabel(groupbyRows[i]),
        op: (val === null || val === undefined ? 'IS NULL' : '==') as any,
        val: val === undefined ? null : val,
      })),
      ...colNode.path.map((val, i) => ({
        col: getColumnLabel(groupbyColumns[i]),
        op: (val === null || val === undefined ? 'IS NULL' : '==') as any,
        val: val === undefined ? null : val,
      })),
    ],
    [groupbyColumns, groupbyRows],
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
        node.path.map((val, idx) => {
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
      onContextMenu,
      timeGrainSqla,
    ],
  );

  const renderCellContent = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      const cell = tree.cells[`${rowNode.key}|${colNode.key}`];
      if (!cell) {
        return '';
      }
      const metricKey =
        Object.keys(cell.values)[0] ||
        (typeof metrics[0] === 'string'
          ? (metrics[0] as string)
          : metrics[0]?.label ||
            '');
      const value = renderValue(metricKey, cell.values[metricKey]);
      if (allowRenderHtml && typeof value === 'string' && value.includes('<')) {
        return <span dangerouslySetInnerHTML={{ __html: value }} />;
      }
      return value;
    },
    [allowRenderHtml, metrics, renderValue, tree.cells],
  );

  return (
    <Container height={height} width={width}>
      {errorMessage && <div>{t('Error loading branch: %s', errorMessage)}</div>}
      <StyledTable>
        <thead>
          <tr>
            <th>{t('Rows')}</th>
            {visibleCols.map(col => (
              <th key={col.key}>
                <HeaderCell style={{ paddingLeft: col.path.length * 12 }}>
                  {col.hasChildren && col.path.length > 0 && (
                    <ToggleButton
                      type="button"
                      onClick={() => handleToggle('col', col)}
                    >
                      {expandedCols.has(col.key) ? (
                        <MinusSquareOutlined />
                      ) : (
                        <PlusSquareOutlined />
                      )}
                    </ToggleButton>
                  )}
                  <span>{col.formattedLabel}</span>
                  {loadingKeys.has(col.key) && <Spinner />}
                </HeaderCell>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(row => (
            <tr key={row.key}>
              <th>
                <HeaderCell style={{ paddingLeft: row.path.length * 12 }}>
                  {row.hasChildren && row.path.length > 0 && (
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
          ))}
        </tbody>
      </StyledTable>
    </Container>
  );
}

export default PivotTableChart;
