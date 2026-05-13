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
import { type DataRecordValue } from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  type MeasureHierarchy,
  type PivotTreeNode,
} from '../../types';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  formatPivotLabelValue,
  SUBTOTAL_TOKEN,
} from '../../utils';

export type ColumnDisplayConfig = {
  metricsLayout: MetricsLayoutEnum;
  metricsFirstOnCols: boolean;
  metricsAtColEnd: boolean;
  allowMetricSubtotalLabels: boolean;
  metricLabels: string[];
  isExplicitSubtotalNode: (node: PivotTreeNode) => boolean;
  getMetricKeyFromPath: (path: PivotTreeNode['path']) => string | undefined;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
  getNonMetricPathParts: (path: PivotTreeNode['path']) => PivotTreeNode['path'];
  isMetricGrandTotalNode: (node: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node: PivotTreeNode) => boolean;
  isExpanded?: (node: PivotTreeNode) => boolean;
};

export const buildColumnDisplayPath = (
  col: PivotTreeNode,
  maxDepth: number,
  config: ColumnDisplayConfig,
) => {
  const {
    metricsLayout,
    metricsFirstOnCols,
    metricsAtColEnd,
    allowMetricSubtotalLabels,
    metricLabels,
    isExplicitSubtotalNode,
    getMetricKeyFromPath,
    getMetricDisplayLabelForKey,
    getNonMetricPathParts,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
    isExpanded,
  } = config;
  const metricKey = getMetricKeyFromPath(col.path);
  const metricLabel = metricKey
    ? getMetricDisplayLabelForKey(metricKey)
    : undefined;
  if (
    metricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricsFirstOnCols &&
    isExpanded?.(col) &&
    metricLabel &&
    col.path.length < maxDepth
  ) {
    const nonMetricParts = getNonMetricPathParts(col.path);
    if (nonMetricParts.length === 0) {
      return [...col.path, SUBTOTAL_TOKEN];
    }
    return [
      ...col.path,
      ...Array(Math.max(maxDepth - col.path.length, 0)).fill(metricLabel),
    ];
  }
  if (metricsLayout !== MetricsLayoutEnum.COLUMNS || metricsFirstOnCols) {
    return col.path;
  }
  const padToDepth = (path: PivotTreeNode['path']) => {
    if (!isExplicitSubtotalNode(col) || path.length >= maxDepth) {
      return path;
    }
    const decoded = decodeMetricKey(path[path.length - 1]);
    const lastLabel = decoded
      ? getMetricDisplayLabelForKey(decoded)
      : String(path[path.length - 1] ?? '');
    return [
      ...path,
      ...Array(Math.max(maxDepth - path.length, 0)).fill(lastLabel),
    ];
  };
  if (!metricKey || !metricLabel) {
    return padToDepth(col.path);
  }
  const nonMetricParts = getNonMetricPathParts(col.path);
  const buildMetricSubtotalPathAtEnd = () => {
    if (nonMetricParts.length === 0) {
      return [metricLabel];
    }
    const displayParts = [...nonMetricParts];
    const lastIndex = displayParts.length - 1;
    displayParts[lastIndex] = `${displayParts[lastIndex]} ${metricLabel}`;
    return displayParts;
  };
  if (isMetricGrandTotalNode(col)) {
    const leafPath = col.path.filter(val => decodeMeasureLeafId(val));
    const totalLabel =
      metricLabels.length === 1 ? 'Grand total' : `Total ${metricLabel}`;
    return leafPath.length > 0 ? [totalLabel, ...leafPath] : [totalLabel];
  }
  const metricIsLeaf =
    (decodeMetricKey(col.path[col.path.length - 1]) ??
      String(col.path[col.path.length - 1] ?? '')) === metricKey;
  if (
    metricIsLeaf &&
    nonMetricParts.length > 0 &&
    metricsAtColEnd &&
    allowMetricSubtotalLabels &&
    isMetricSubtotalNode(col) &&
    (col.hasChildren || nonMetricParts.length > 1)
  ) {
    return buildMetricSubtotalPathAtEnd();
  }
  return padToDepth(col.path);
};

export const resolveColumnHeaderLabel = ({
  rawValue,
  measureHierarchy,
  getMetricDisplayLabelForKey,
}: {
  rawValue: DataRecordValue;
  measureHierarchy: MeasureHierarchy;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
}) => {
  const decoded = decodeMetricKey(rawValue);
  if (decoded) {
    return getMetricDisplayLabelForKey(decoded);
  }
  const leafId = decodeMeasureLeafId(rawValue);
  if (leafId && measureHierarchy.kind === 'measureStackV1') {
    return (
      measureHierarchy.groups
        .flatMap(group => group.leaves)
        .find(leaf => leaf.id === leafId)?.label ||
      formatPivotLabelValue(rawValue, '')
    );
  }
  return formatPivotLabelValue(rawValue, '');
};

export const expandMetricNodesForRender = ({
  expanded,
  nodes,
  isLeafTierVisible,
  isMetricTokenValue,
}: {
  expanded: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  isLeafTierVisible: boolean;
  isMetricTokenValue: (value: unknown) => boolean;
}) => {
  if (!isLeafTierVisible) {
    return expanded;
  }
  const next = new Set(expanded);
  Object.values(nodes).forEach(node => {
    if (isMetricTokenValue(node.path[node.path.length - 1])) {
      next.add(node.key);
    }
  });
  return next;
};
