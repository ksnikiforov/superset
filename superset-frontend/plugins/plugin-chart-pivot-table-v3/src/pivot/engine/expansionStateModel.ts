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

import { PivotPath, PivotTreeNode, TotalPosition } from '../../types';
import {
  decodeMetricKey,
  isSubtotalToken,
  parsePath,
  serializePath,
} from '../../utils';
import {
  buildVisibleCols,
  buildVisibleRows,
  createColLeavesBuilder,
} from '../visibility';
import { countDimDepth } from '../metricsTotals';
import { rootKey } from '../viewModel';

export type PivotExpansionStateKeys = {
  rowKeys: string[];
  colKeys: string[];
  rows: string[];
  cols: string[];
  collapsedRows: string[];
  collapsedCols: string[];
};

type SeedExpandedOptions = {
  includeMetricDepthZero?: boolean;
};

export const seedExpandedByLevel = (
  nodes: Record<string, PivotTreeNode>,
  expandLevel: number,
  metricLabelSet: Set<string>,
  options?: SeedExpandedOptions,
) => {
  const next = new Set<string>([rootKey]);
  Object.values(nodes).forEach(node => {
    const depth = countDimDepth(node.path, metricLabelSet);
    if (depth > 0 && depth <= expandLevel) {
      next.add(node.key);
      return;
    }
    if (options?.includeMetricDepthZero && depth === 0) {
      const decoded = decodeMetricKey(node.path[node.path.length - 1]);
      if (decoded && metricLabelSet.has(decoded)) {
        next.add(node.key);
      }
    }
  });
  return next;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const coerceAxisKeys = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const keys = value.filter((item): item is string => typeof item === 'string');
  return keys.length === value.length ? keys : undefined;
};

const coerceExpansionAxis = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const resolved: string[] = [];
  value.forEach(item => {
    if (Array.isArray(item)) {
      if ((item as unknown[]).some(isSubtotalToken)) {
        return;
      }
      resolved.push(serializePath(item as PivotPath));
    }
  });
  return resolved;
};

export const coerceExpansionState = (
  value: unknown,
): PivotExpansionStateKeys | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const rowKeys = coerceAxisKeys(value.rowKeys);
  const colKeys = coerceAxisKeys(value.colKeys);
  const rows = coerceExpansionAxis(value.rows);
  const cols = coerceExpansionAxis(value.cols);
  const collapsedRows = coerceExpansionAxis(value.collapsedRows);
  const collapsedCols = coerceExpansionAxis(value.collapsedCols);
  if (!rowKeys || !colKeys || !rows || !cols) {
    return undefined;
  }
  return {
    rowKeys,
    colKeys,
    rows,
    cols,
    collapsedRows: collapsedRows || [],
    collapsedCols: collapsedCols || [],
  };
};

export const stripAutoSeededExpansions = ({
  keys,
  collapsedKeys,
  nodes,
  metricLabelSet,
  includeMetricDepthZero,
}: {
  keys: string[];
  collapsedKeys: string[];
  nodes: Record<string, PivotTreeNode>;
  metricLabelSet: Set<string>;
  includeMetricDepthZero: boolean;
}): { keys: string[]; collapsedKeys: string[] } => {
  if (keys.length === 0 || collapsedKeys.length > 0) {
    return { keys, collapsedKeys };
  }
  const maxDepth = keys.reduce((max, key) => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    return Math.max(max, countDimDepth(path, metricLabelSet));
  }, 0);
  if (maxDepth <= 0) {
    return { keys, collapsedKeys };
  }
  const seeded = seedExpandedByLevel(nodes, maxDepth, metricLabelSet, {
    includeMetricDepthZero,
  });
  const seededSet = new Set(Array.from(seeded).filter(key => key !== rootKey));
  if (seededSet.size !== keys.length) {
    return { keys, collapsedKeys };
  }
  const isAutoSeeded = keys.every(key => seededSet.has(key));
  if (!isAutoSeeded) {
    return { keys, collapsedKeys };
  }
  return { keys: [], collapsedKeys: [] };
};

export const pruneExpandedToStablePrefix = ({
  expanded,
  nodes,
  stablePrefix,
  metricLabelSet,
}: {
  expanded: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  stablePrefix: number;
  metricLabelSet: Set<string>;
}): Set<string> => {
  if (stablePrefix <= 0) {
    return new Set<string>([rootKey]);
  }
  const next = new Set<string>([rootKey]);
  expanded.forEach(key => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    const depth = countDimDepth(path, metricLabelSet);
    if (depth <= stablePrefix) {
      next.add(key);
    }
  });
  return next;
};

export const getVisibleExpansionKeys = ({
  rowsNodes,
  colsNodes,
  expandedRows,
  expandedCols,
  rowSorter,
  colSorter,
  skipRowRoot,
  showRowRoot,
  rowTotalPosition,
  getRowChildren,
  getCollapsedRowChildren,
  skipColRoot,
  countDimDepth: countDimDepthFn,
  normalizedColSubtotalLevels,
  showColRoot,
  rowTotals,
  colTotalPosition,
  resolvedColSubtotalPosition,
  getColChildren,
  getCollapsedColLeaves,
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
  isMetricTokenValue,
  shouldHideMetricGrandTotalsOnRows,
  shouldHideMetricGrandTotalsOnCols,
  shouldSuppressColRoot,
}: {
  rowsNodes: Record<string, PivotTreeNode>;
  colsNodes: Record<string, PivotTreeNode>;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  rowSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  colSorter: (a: PivotTreeNode, b: PivotTreeNode) => number;
  skipRowRoot: boolean;
  showRowRoot: boolean;
  rowTotalPosition: TotalPosition;
  getRowChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getCollapsedRowChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  skipColRoot: boolean;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  normalizedColSubtotalLevels: number[];
  showColRoot: boolean;
  rowTotals: boolean;
  colTotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
  getColChildren: (parent: PivotTreeNode) => PivotTreeNode[];
  getCollapsedColLeaves: (parent: PivotTreeNode) => PivotTreeNode[];
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node?: PivotTreeNode) => boolean;
  isMetricTokenValue: (value: unknown) => boolean;
  shouldHideMetricGrandTotalsOnRows: boolean;
  shouldHideMetricGrandTotalsOnCols: boolean;
  shouldSuppressColRoot: boolean;
}): { rows: Set<string>; cols: Set<string> } => {
  const visibleRowsBase = buildVisibleRows({
    rows: rowsNodes,
    expandedRows,
    rowSorter,
    skipRowRoot,
    showRowRoot,
    rowTotalPosition,
    getRowChildren,
    getCollapsedRowChildren,
  });
  const visibleRows = shouldHideMetricGrandTotalsOnRows
    ? visibleRowsBase.filter(row => !isMetricGrandTotalNode(row))
    : visibleRowsBase;

  const buildColLeavesWithSubtotals = createColLeavesBuilder({
    getColChildren,
    getCollapsedColLeaves,
    colSorter,
    countDimDepth: countDimDepthFn,
    expandedCols,
    normalizedColSubtotalLevels,
    showColRoot,
    rowTotals,
    resolvedColTotalPosition: colTotalPosition,
    resolvedColSubtotalPosition,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
  });
  const visibleColsBase = buildVisibleCols({
    cols: colsNodes,
    skipColRoot,
    colSorter,
    getColChildren,
    buildColLeavesWithSubtotals,
  });
  let visibleCols = shouldHideMetricGrandTotalsOnCols
    ? visibleColsBase.filter(col => !isMetricGrandTotalNode(col))
    : visibleColsBase;

  if (shouldSuppressColRoot) {
    const hasMetricLeaves = visibleCols.some(col =>
      col.path.some(val => isMetricTokenValue(val)),
    );
    if (hasMetricLeaves) {
      const withoutRoot = visibleCols.filter(col => col.key !== rootKey);
      visibleCols = withoutRoot.length > 0 ? withoutRoot : visibleCols;
    }
  }

  const visibleColKeys = new Set<string>();
  visibleCols.forEach(col => {
    for (let idx = 0; idx <= col.path.length; idx += 1) {
      const key = serializePath(col.path.slice(0, idx));
      visibleColKeys.add(key);
    }
  });

  return {
    rows: new Set(visibleRows.map(row => row.key)),
    cols: visibleColKeys,
  };
};
