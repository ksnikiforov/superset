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
import { MetricsLayoutEnum, PivotTreeNode } from '../types';
import {
  decodeMetricKey,
  decodeMeasureLeafId,
  isSubtotalToken,
} from './core/tokens';

type MetricTotalsConfig = {
  metricLabelSet: Set<string>;
  metricsFirstOnRows: boolean;
  metricsFirstOnCols: boolean;
};

type NodeDepthConfig = {
  metricLabelSet: Set<string>;
  metricsLayout: MetricsLayoutEnum;
  hideMetricHeaderOnRows: boolean;
  metricLayoutIndexOnRows?: number;
};

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
  {
    metricLabelSet,
    metricsFirstOnRows,
    metricsFirstOnCols,
  }: MetricTotalsConfig,
) => {
  if (!node || !node.isSubtotal) {
    return false;
  }
  const hasExplicitTotalToken = node.path.some(isSubtotalToken);
  if (node.axis === 'row' && metricsFirstOnRows && !hasExplicitTotalToken) {
    return false;
  }
  if (node.axis === 'col' && metricsFirstOnCols && !hasExplicitTotalToken) {
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
  if (node.axis === 'row' && metricsFirstOnRows) {
    return firstMetric === metricLabel;
  }
  if (node.axis === 'col' && metricsFirstOnCols) {
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

export const getMetricIndexFromNodes = ({
  nodes,
  isMetricTokenValue,
}: {
  nodes: Record<string, PivotTreeNode>;
  isMetricTokenValue: (value: unknown) => boolean;
}): number | undefined => {
  let found: number | undefined;
  let foundFromSubtotal: number | undefined;
  Object.values(nodes).forEach(node => {
    const idx = node.path.findIndex(val => isMetricTokenValue(val));
    if (idx < 0) {
      return;
    }
    if (node.path.some(val => isSubtotalToken(val))) {
      foundFromSubtotal = Math.max(foundFromSubtotal ?? idx, idx);
      return;
    }
    found = Math.max(found ?? idx, idx);
  });
  return found ?? foundFromSubtotal;
};

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
  {
    metricLabelSet,
    metricsLayout,
    hideMetricHeaderOnRows,
    metricLayoutIndexOnRows,
  }: NodeDepthConfig,
) => {
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
    metricsLayout === MetricsLayoutEnum.ROWS &&
    metricLayoutIndexOnRows === 1 &&
    subtotalIndex === metricLayoutIndexOnRows &&
    metricIndex > subtotalIndex;
  const adjustedDimDepth = boundarySubtotal
    ? dimDepth
    : Math.max(dimDepth - subtotalTokenCount, 0);
  const hasMetric = node.path.some(val => {
    const decoded = decodeMetricKey(val);
    return decoded !== undefined && metricLabelSet.has(decoded);
  });
  const metricDepth =
    metricsLayout === MetricsLayoutEnum.ROWS &&
    !hideMetricHeaderOnRows &&
    hasMetric
      ? 1
      : 0;
  const leafDepth =
    metricsLayout === MetricsLayoutEnum.ROWS &&
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
    metricsLayout === MetricsLayoutEnum.ROWS &&
    metricLayoutIndexOnRows === 1 &&
    subtotalIndex === metricLayoutIndexOnRows &&
    metricIndex > subtotalIndex;
  return shouldOffsetSubtotal && !skipOffsetAtBoundary
    ? Math.max(depth - 1, 0)
    : depth;
};
