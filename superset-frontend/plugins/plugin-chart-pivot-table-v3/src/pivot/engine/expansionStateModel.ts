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
  type PivotAxis,
  type PivotTreeData,
  PivotTreeNode,
  TotalPosition,
} from '../../types';
import { decodeMetricKey, parsePath, serializePath } from '../../utils';
import { buildVisiblePivotAxes } from '../visibility';
import { countDimDepth } from '../metricsTotals';
import { rootKey } from '../viewModel';

export {
  coerceExpansionState,
  type PivotExpansionStateKeys,
} from '../query/persistedExpansionState';

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
    const lastValue = node.path[node.path.length - 1];
    const decodedMetric = decodeMetricKey(lastValue);
    const isMetricNode = decodedMetric
      ? metricLabelSet.has(decodedMetric)
      : false;
    const depth = countDimDepth(node.path, metricLabelSet);
    if (
      depth > 0 &&
      (isMetricNode ? depth < expandLevel : depth <= expandLevel)
    ) {
      next.add(node.key);
      return;
    }
    if (options?.includeMetricDepthZero && depth === 0 && isMetricNode) {
      next.add(node.key);
    }
  });
  return next;
};

export const buildDesiredExpandedKeys = ({
  axis,
  tree,
  autoExpandLevel,
  metricLabelSet,
  includeMetricDepthZero,
  manualExpanded,
  manualCollapsed,
  pendingKeys,
  inFlightKeys,
}: {
  axis: PivotAxis;
  tree: PivotTreeData;
  autoExpandLevel: number;
  metricLabelSet: Set<string>;
  includeMetricDepthZero: boolean;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
  pendingKeys: Set<string>;
  inFlightKeys: Set<string>;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const autoSeeded = seedExpandedByLevel(
    nodes,
    autoExpandLevel,
    metricLabelSet,
    { includeMetricDepthZero },
  );
  const next = new Set<string>([
    ...autoSeeded,
    ...manualExpanded,
    ...pendingKeys,
    ...inFlightKeys,
  ]);
  manualCollapsed.forEach(key => next.delete(key));
  return next;
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
  includeMetricDepth = false,
}: {
  expanded: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  stablePrefix: number;
  metricLabelSet: Set<string>;
  includeMetricDepth?: boolean;
}): Set<string> => {
  if (stablePrefix <= 0) {
    return new Set<string>([rootKey]);
  }
  const next = new Set<string>([rootKey]);
  expanded.forEach(key => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    const baseDepth = countDimDepth(path, metricLabelSet);
    const hasMetric = path.some(val => {
      const decoded = decodeMetricKey(val);
      return decoded !== undefined && metricLabelSet.has(decoded);
    });
    const depth = includeMetricDepth && hasMetric ? baseDepth + 1 : baseDepth;
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
  const { visibleRows, visibleCols } = buildVisiblePivotAxes({
    rows: rowsNodes,
    cols: colsNodes,
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
    resolvedColTotalPosition: colTotalPosition,
    resolvedColSubtotalPosition,
    getColChildren,
    getCollapsedColLeaves,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
    isMetricTokenValue,
    shouldHideMetricGrandTotalsOnRows,
    shouldHideMetricGrandTotalsOnCols,
    shouldSuppressColRoot,
  });

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
