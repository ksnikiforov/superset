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
import { type PivotAxis, PivotTreeNode } from '../types';
import {
  decodeMetricKey,
  decodeMeasureLeafId,
  isSubtotalToken,
} from './core/tokens';
import type { PivotProgram } from './runtime/types';

type MetricTotalsConfig = {
  metricLabelSet: Set<string>;
  program: PivotProgram;
};

type NodeDepthConfig = {
  metricLabelSet: Set<string>;
  program: PivotProgram;
  hideMetricHeaderOnRows: boolean;
};

const metricsFirstOnAxis = (program: PivotProgram, axis: PivotAxis) =>
  program.valueAxis === axis &&
  program.metricKeys.length > 0 &&
  program.metricInsertIndex === 0;

const metricIndexOnRows = (program: PivotProgram) =>
  program.valueAxis === 'row' && program.metricKeys.length > 0
    ? Math.min(program.metricInsertIndex, program.rowDimensions.length)
    : undefined;

export const getMetricLabelFromPath = (
  path: PivotTreeNode['path'],
  metricLabelSet: Set<string>,
) => {
  const match = path.find(val => {
    const decoded = decodeMetricKey(val);
    return decoded !== undefined && metricLabelSet.has(decoded);
  });
  if (match === undefined) {
    return undefined;
  }
  const decoded = decodeMetricKey(match);
  return decoded && metricLabelSet.has(decoded) ? decoded : undefined;
};

export const getNonMetricPathParts = (
  path: PivotTreeNode['path'],
  metricLabelSet: Set<string>,
) =>
  path.filter(val => {
    const decoded = decodeMetricKey(val);
    if (decoded && metricLabelSet.has(decoded)) {
      return false;
    }
    if (decodeMeasureLeafId(val)) {
      return false;
    }
    if (isSubtotalToken(val)) {
      return false;
    }
    return true;
  });

export const isMetricGrandTotalNode = (
  node: PivotTreeNode | undefined,
  { metricLabelSet, program }: MetricTotalsConfig,
) => {
  if (!node || !node.isSubtotal) {
    return false;
  }
  const hasExplicitTotalToken = node.path.some(isSubtotalToken);
  const metricsFirst = metricsFirstOnAxis(program, node.axis);
  if (metricsFirst && !hasExplicitTotalToken) {
    return false;
  }
  const metricLabel = getMetricLabelFromPath(node.path, metricLabelSet);
  if (!metricLabel) {
    return false;
  }
  const nonMetricParts = getNonMetricPathParts(node.path, metricLabelSet);
  if (nonMetricParts.length !== 0) {
    return false;
  }
  const metricTokens = node.path
    .map(val => decodeMetricKey(val))
    .filter((decoded): decoded is string =>
      decoded ? metricLabelSet.has(decoded) : false,
    );
  if (metricTokens.length === 0) {
    return false;
  }
  const firstMetric = metricTokens[0];
  const lastMetric = metricTokens[metricTokens.length - 1];
  if (metricsFirst) {
    return firstMetric === metricLabel;
  }
  return lastMetric === metricLabel;
};

export const isMetricSubtotalNode = (
  node: PivotTreeNode | undefined,
  metricLabelSet: Set<string>,
) => {
  if (!node) {
    return false;
  }
  const metricLabel = getMetricLabelFromPath(node.path, metricLabelSet);
  if (!metricLabel) {
    return false;
  }
  const nonMetricParts = getNonMetricPathParts(node.path, metricLabelSet);
  if (nonMetricParts.length === 0) {
    return false;
  }
  const hasSubtotalToken = node.path.some(isSubtotalToken);
  const hasMeasureLeaf = node.path.some(val => decodeMeasureLeafId(val));
  if (hasMeasureLeaf) {
    return hasSubtotalToken;
  }
  return hasSubtotalToken || node.isSubtotal === true || node.hasChildren;
};

export const isExplicitSubtotalNode = (node?: PivotTreeNode) => {
  if (!node) {
    return false;
  }
  return node.path.some(isSubtotalToken);
};

export const getMetricDepthForParent = (
  nodes: Record<string, PivotTreeNode>,
  parent: PivotTreeNode,
  metricLabelSet: Set<string>,
) => {
  let minIndex: number | undefined;
  Object.values(nodes).forEach(node => {
    if (
      node.path.length <= parent.path.length ||
      !parent.path.every((val, idx) => val === node.path[idx])
    ) {
      return;
    }
    const idx = node.path.findIndex(val => {
      const decoded = decodeMetricKey(val);
      return decoded !== undefined && metricLabelSet.has(decoded);
    });
    if (idx >= 0) {
      minIndex = minIndex === undefined ? idx : Math.min(minIndex, idx);
    }
  });
  return minIndex;
};

export const getMetricTierNodes = (
  nodes: Record<string, PivotTreeNode>,
  parent: PivotTreeNode,
  metricDepth: number,
  metricLabelSet: Set<string>,
) =>
  Object.values(nodes).filter(
    node =>
      node.path.length === metricDepth + 1 &&
      parent.path.every((val, idx) => val === node.path[idx]) &&
      (() => {
        const decoded = decodeMetricKey(node.path[metricDepth]);
        return decoded !== undefined && metricLabelSet.has(decoded);
      })(),
  );

export const countDimDepth = (
  path: PivotTreeNode['path'],
  metricLabelSet: Set<string>,
) =>
  path.filter(val => {
    const decoded = decodeMetricKey(val);
    if (decoded && metricLabelSet.has(decoded)) {
      return false;
    }
    if (decodeMeasureLeafId(val)) {
      return false;
    }
    return true;
  }).length;

export const isExplicitTotalNode = (
  node: PivotTreeNode,
  config: MetricTotalsConfig,
) => {
  if (node.path.length === 0) {
    return true;
  }
  if (isExplicitSubtotalNode(node)) {
    return true;
  }
  return isMetricGrandTotalNode(node, config);
};

export const getNodeDimDepth = (
  node: PivotTreeNode,
  { metricLabelSet, program, hideMetricHeaderOnRows }: NodeDepthConfig,
) => {
  const rowMetricIndex = metricIndexOnRows(program);
  const dimDepth = countDimDepth(node.path, metricLabelSet);
  const subtotalTokenCount = node.path.filter(val =>
    isSubtotalToken(val),
  ).length;
  const subtotalIndex = node.path.findIndex(val => isSubtotalToken(val));
  const metricIndex = node.path.findIndex(val => {
    const decoded = decodeMetricKey(val);
    return decoded !== undefined && metricLabelSet.has(decoded);
  });
  const boundarySubtotal =
    program.valueAxis === 'row' &&
    rowMetricIndex === 1 &&
    subtotalIndex === rowMetricIndex &&
    metricIndex > subtotalIndex;
  const adjustedDimDepth = boundarySubtotal
    ? dimDepth
    : Math.max(dimDepth - subtotalTokenCount, 0);
  const hasMetric = node.path.some(val => {
    const decoded = decodeMetricKey(val);
    return decoded !== undefined && metricLabelSet.has(decoded);
  });
  const metricDepth =
    program.valueAxis === 'row' && !hideMetricHeaderOnRows && hasMetric ? 1 : 0;
  const leafDepth =
    program.valueAxis === 'row' &&
    node.path.some(val => decodeMeasureLeafId(val))
      ? 1
      : 0;
  const depth = adjustedDimDepth + metricDepth + leafDepth;
  if (!isExplicitSubtotalNode(node)) {
    return depth;
  }
  const shouldOffsetSubtotal =
    subtotalIndex >= 0 && (metricIndex < 0 || metricIndex > subtotalIndex);
  const skipOffsetAtBoundary =
    program.valueAxis === 'row' &&
    rowMetricIndex === 1 &&
    subtotalIndex === rowMetricIndex &&
    metricIndex > subtotalIndex;
  return shouldOffsetSubtotal && !skipOffsetAtBoundary
    ? Math.max(depth - 1, 0)
    : depth;
};
