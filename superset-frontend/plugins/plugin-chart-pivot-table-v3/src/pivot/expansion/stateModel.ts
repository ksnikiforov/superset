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
  type PivotPath,
  type PivotTreeData,
  PivotTreeNode,
} from '../../types';
import { decodeMetricKey, isSubtotalToken } from '../core/tokens';
import { parsePath, serializePath } from '../core/path';
import { countDimDepth } from '../metricsTotals';
import { rootKey } from '../viewModel';
import { isValuesFirstOnAxis } from '../runtime/projection';
import type { AxisPathScope, PivotAxisCoverageNeed } from '../runtime/coverage';
import type { PivotProgram } from '../runtime/types';

export type PivotExpansionStateKeys = {
  rowKeys: string[];
  colKeys: string[];
  rows: string[];
  cols: string[];
  collapsedRows: string[];
  collapsedCols: string[];
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

const pathStartsWith = (path: PivotPath, prefix: PivotPath) =>
  prefix.every((value, index) => path[index] === value);

const addAncestors = (path: PivotPath, expanded: Set<string>) => {
  for (let depth = 0; depth <= path.length; depth += 1) {
    expanded.add(serializePath(path.slice(0, depth)));
  }
};

const expandScopedFullCoverageNeed = ({
  need,
  nodes,
  program,
  metricLabelSet,
}: {
  need: PivotAxisCoverageNeed & {
    scope: Extract<AxisPathScope, { kind: 'scopedFull' }>;
  };
  nodes: Record<string, PivotTreeNode>;
  program: PivotProgram;
  metricLabelSet: Set<string>;
}) => {
  const expanded = new Set<string>();
  const includeMetricDepthZero =
    program.metricKeys.length > 0 &&
    isValuesFirstOnAxis(program, need.axis) &&
    need.depth > 0;
  need.scope.ancestorPaths.forEach(anchor => {
    addAncestors(anchor, expanded);
    Object.values(nodes).forEach(node => {
      if (!pathStartsWith(node.path, anchor)) {
        return;
      }
      const lastValue = node.path[node.path.length - 1];
      const decodedMetric = decodeMetricKey(lastValue);
      const isMetricNode = decodedMetric
        ? metricLabelSet.has(decodedMetric)
        : false;
      const depth = countDimDepth(node.path, metricLabelSet);
      if (
        depth > 0 &&
        (isMetricNode ? depth < need.depth : depth <= need.depth)
      ) {
        addAncestors(node.path, expanded);
        return;
      }
      if (includeMetricDepthZero && depth === 0 && isMetricNode) {
        addAncestors(node.path, expanded);
      }
    });
  });
  return expanded;
};

const expandAxisCoverageNeedKeys = ({
  axis,
  tree,
  axisCoverageNeeds,
  program,
}: {
  axis: PivotAxis;
  tree: PivotTreeData;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  program: PivotProgram;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const metricLabelSet = new Set(program.metricKeys);
  const expanded = new Set<string>([rootKey]);
  axisCoverageNeeds.forEach(need => {
    if (need.axis !== axis) {
      return;
    }
    if (need.scope.kind === 'root') {
      expanded.add(rootKey);
      return;
    }
    if (need.scope.kind === 'paths') {
      need.scope.paths.forEach(path => addAncestors(path, expanded));
      return;
    }
    expandScopedFullCoverageNeed({
      need,
      nodes,
      program,
      metricLabelSet,
    }).forEach(key => expanded.add(key));
  });
  return expanded;
};

export const buildDesiredExpandedKeys = ({
  axis,
  tree,
  axisCoverageNeeds,
  program,
  manualExpanded,
  manualCollapsed,
  pendingKeys,
  inFlightKeys,
}: {
  axis: PivotAxis;
  tree: PivotTreeData;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  program: PivotProgram;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
  pendingKeys: Set<string>;
  inFlightKeys: Set<string>;
}) => {
  const needExpanded = expandAxisCoverageNeedKeys({
    axis,
    tree,
    axisCoverageNeeds,
    program,
  });
  const next = new Set<string>([
    ...needExpanded,
    ...manualExpanded,
    ...pendingKeys,
    ...inFlightKeys,
  ]);
  manualCollapsed.forEach(key => next.delete(key));
  return next;
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
