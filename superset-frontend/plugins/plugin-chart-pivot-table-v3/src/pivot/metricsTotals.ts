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
import { isSubtotalToken, SUBTOTAL_LABEL } from '../utils';

type MetricTotalsConfig = {
  metricLabelSet: Set<string>;
  metricsFirstOnRows: boolean;
  metricsFirstOnCols: boolean;
};

type NodeDepthConfig = {
  metricLabelSet: Set<string>;
  metricsLayout: MetricsLayoutEnum;
  hideMetricHeaderOnRows: boolean;
};

export const getMetricLabelFromPath = (
  path: PivotTreeNode['path'],
  metricLabelSet: Set<string>,
) => {
  const match = path.find(val => metricLabelSet.has(String(val ?? '')));
  return match === undefined ? undefined : String(match);
};

export const getNonMetricPathParts = (
  path: PivotTreeNode['path'],
  metricLabelSet: Set<string>,
) =>
  path.filter(val => {
    const value = String(val ?? '');
    if (metricLabelSet.has(value)) {
      return false;
    }
    if (isSubtotalToken(val) || value === 'Total') {
      return false;
    }
    return true;
  });

export const isMetricGrandTotalNode = (
  node: PivotTreeNode | undefined,
  { metricLabelSet, metricsFirstOnRows, metricsFirstOnCols }: MetricTotalsConfig,
) => {
  if (!node || !node.isSubtotal) {
    return false;
  }
  const hasExplicitTotalToken = node.path.some(
    val => isSubtotalToken(val) || val === 'Total',
  );
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
  if (node.axis === 'row' && metricsFirstOnRows) {
    return String(node.path[0] ?? '') === metricLabel;
  }
  if (node.axis === 'col' && metricsFirstOnCols) {
    return String(node.path[0] ?? '') === metricLabel;
  }
  if (String(node.path[node.path.length - 1] ?? '') !== metricLabel) {
    return false;
  }
  return nonMetricParts.length === 0;
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
  const hasSubtotalToken = node.path.some(
    val => isSubtotalToken(val) || val === 'Total',
  );
  return hasSubtotalToken || node.isSubtotal === true || node.hasChildren;
};

export const isExplicitSubtotalNode = (node?: PivotTreeNode) => {
  if (!node) {
    return false;
  }
  if (node.path.some(isSubtotalToken)) {
    return true;
  }
  if (node.isSubtotal && node.path.some(val => val === 'Total')) {
    return true;
  }
  const label = node.formattedLabel || node.label;
  if (label === SUBTOTAL_LABEL) {
    return true;
  }
  if (node.isSubtotal && typeof label === 'string') {
    const trimmed = label.trim();
    return trimmed.startsWith('Total ') || trimmed.endsWith(' Total');
  }
  return false;
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
    const idx = node.path.findIndex(val =>
      metricLabelSet.has(String(val ?? '')),
    );
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
      metricLabelSet.has(String(node.path[metricDepth] ?? '')),
  );

export const countDimDepth = (
  path: PivotTreeNode['path'],
  metricLabelSet: Set<string>,
) => path.filter(val => !metricLabelSet.has(String(val ?? ''))).length;

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
  { metricLabelSet, metricsLayout, hideMetricHeaderOnRows }: NodeDepthConfig,
) => {
  const dimDepth = countDimDepth(node.path, metricLabelSet);
  const hasMetric = node.path.some(val =>
    metricLabelSet.has(String(val ?? '')),
  );
  const metricDepth =
    metricsLayout === MetricsLayoutEnum.ROWS &&
    !hideMetricHeaderOnRows &&
    hasMetric
      ? 1
      : 0;
  const depth = dimDepth + metricDepth;
  return isExplicitSubtotalNode(node) ? Math.max(depth - 1, 0) : depth;
};
