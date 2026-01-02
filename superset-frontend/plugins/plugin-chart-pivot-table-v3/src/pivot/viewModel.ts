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
import {
  CurrencyFormatter,
  DataRecordValue,
  GenericDataType,
  getNumberFormatter,
} from '@superset-ui/core';
import { PivotTreeNode } from '../types';
import { isSubtotalToken, serializePath } from '../utils';

export const rootKey = serializePath([]);

export const findChildren = (
  nodes: Record<string, PivotTreeNode>,
  parent: PivotTreeNode,
) =>
  Object.values(nodes).filter(
    child =>
      child.path.length === parent.path.length + 1 &&
      parent.path.every((val, index) => val === child.path[index]),
  );

export const buildVisibleList = (
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

export type HeaderCellInfo = {
  node: PivotTreeNode;
  colSpan: number;
  rowSpan: number;
};

export const buildColumnHeaderRows = (
  cols: PivotTreeNode[],
  nodes: Record<string, PivotTreeNode>,
  getDisplayPath?: (col: PivotTreeNode, maxDepth: number) => PivotTreeNode['path'],
) => {
  if (cols.length === 0) {
    return [] as HeaderCellInfo[][];
  }
  const baseMaxDepth = Math.max(
    ...cols.map(col => Math.max(col.path.length, 1)),
  );
  const resolvedCols = cols.map(col => ({
    col,
    path: getDisplayPath ? getDisplayPath(col, baseMaxDepth) : col.path,
  }));
  const maxDepth = Math.max(
    baseMaxDepth,
    ...resolvedCols.map(({ path }) => Math.max(path.length, 1)),
  );
  const rows: HeaderCellInfo[][] = Array.from({ length: maxDepth }, () => []);
  // Track the last cell per row to aggregate colspan across adjacent columns.
  const lastCells: (HeaderCellInfo | undefined)[] = Array(maxDepth).fill(
    undefined,
  );

  resolvedCols.forEach(({ col, path: rawPath }) => {
    const path = rawPath.length === 0 ? col.path : rawPath;
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
      let node = nodes[key];
      if (!node) {
        if (level === lastLevel) {
          node = {
            ...col,
            label: headerPath[level]?.toString() ?? '',
            formattedLabel: headerPath[level]?.toString() ?? '',
          };
        } else {
          node = {
            axis: 'col',
            key,
            path: headerPath,
            label: headerPath[level]?.toString() ?? '',
            formattedLabel: headerPath[level]?.toString() ?? '',
            level: headerPath.length,
            hasChildren: level < maxDepth - 1,
            isSubtotal:
              headerPath.some(isSubtotalToken) ||
              String(headerPath[level] ?? '').startsWith('Total ') ||
              String(headerPath[level] ?? '').endsWith(' Total'),
          } as PivotTreeNode;
        }
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

export const compareValues = (
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

export const sortByOrder = (
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

export const formatMetricValue = (
  metric: string,
  value: DataRecordValue,
  columnFormats: Record<string, string>,
  currencyFormats: Record<string, any>,
  defaultFormatter: (v: number | null | undefined) => string,
  d3FormatOverride?: string,
) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'number') {
    return String(value);
  }
  if (d3FormatOverride) {
    try {
      return getNumberFormatter(d3FormatOverride)(value);
    } catch {
      // Fall through to default formatting when override is invalid.
    }
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
