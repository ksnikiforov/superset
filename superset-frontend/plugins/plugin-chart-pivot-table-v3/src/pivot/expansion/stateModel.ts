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

import { type PivotAxis, type PivotPath, PivotTreeNode } from '../../types';
import {
  decodeMetricKey,
  isMetricTokenForKeys,
  isSubtotalToken,
} from '../core/tokens';
import { parsePath, serializePath } from '../core/path';
import { countDimDepth } from '../metricsTotals';
import { rootKey } from '../viewModel';
import type { PivotProgram } from '../runtime/types';

export type PivotExpansionStateKeys = {
  rows: string[];
  cols: string[];
  collapsedRows: string[];
  collapsedCols: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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
  const rows = coerceExpansionAxis(value.rows);
  const cols = coerceExpansionAxis(value.cols);
  const collapsedRows = coerceExpansionAxis(value.collapsedRows);
  const collapsedCols = coerceExpansionAxis(value.collapsedCols);
  if (!rows || !cols) {
    return undefined;
  }
  return {
    rows,
    cols,
    collapsedRows: collapsedRows || [],
    collapsedCols: collapsedCols || [],
  };
};

const keysMatch = (actual: string[], candidate: unknown) =>
  Array.isArray(candidate) &&
  actual.length === candidate.length &&
  actual.every((key, index) => candidate[index] === key);

export const coerceExpansionStateForLayout = ({
  value,
  rowKeys,
  colKeys,
}: {
  value: unknown;
  rowKeys: string[];
  colKeys: string[];
}): PivotExpansionStateKeys | undefined => {
  if (
    !isRecord(value) ||
    !keysMatch(rowKeys, value.rowKeys) ||
    !keysMatch(colKeys, value.colKeys)
  ) {
    return undefined;
  }
  return coerceExpansionState(value);
};

const pathStartsWith = (path: PivotPath, prefix: PivotPath) =>
  prefix.every((value, index) => path[index] === value);

const isCollapsedMetricTierDescendant = ({
  candidatePath,
  collapsedPath,
  metricLabelSet,
}: {
  candidatePath: PivotPath;
  collapsedPath: PivotPath;
  metricLabelSet: ReadonlySet<string>;
}) =>
  candidatePath.length > collapsedPath.length &&
  isMetricTokenForKeys(candidatePath[collapsedPath.length], metricLabelSet);

const resolveNodePath = (
  key: string,
  nodes: Record<string, PivotTreeNode>,
): PivotPath => nodes[key]?.path ?? parsePath(key);

export const buildDesiredExpandedKeys = ({
  axis,
  nodes,
  program,
  baseExpanded = new Set<string>([rootKey]),
  manualExpanded,
  manualCollapsed,
}: {
  axis: PivotAxis;
  nodes: Record<string, PivotTreeNode>;
  program: PivotProgram;
  baseExpanded?: Set<string>;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
}) => {
  const next = new Set<string>([...baseExpanded, ...manualExpanded]);
  const metricLabelSet = new Set(program.metricKeys);
  manualCollapsed.forEach(key => {
    const collapsedPath = resolveNodePath(key, nodes);
    Array.from(next).forEach(candidate => {
      const candidatePath = resolveNodePath(candidate, nodes);
      if (
        pathStartsWith(candidatePath, collapsedPath) &&
        !isCollapsedMetricTierDescendant({
          candidatePath,
          collapsedPath,
          metricLabelSet,
        })
      ) {
        next.delete(candidate);
      }
    });
  });
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
