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
import { decodeMeasureLeafId, decodeMetricKey, SUBTOTAL_TOKEN } from '../utils';

type ColumnDisplayConfig = {
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
    if (metricLabels.length === 1) {
      const totalLabel = 'Grand total';
      if (leafPath.length > 0) {
        return [totalLabel, ...leafPath];
      }
      return [totalLabel];
    }
    const totalLabel = `Total ${metricLabel}`;
    if (leafPath.length > 0) {
      return [totalLabel, ...leafPath];
    }
    if (metricsAtColEnd) {
      return [totalLabel];
    }
    return [totalLabel];
  }
  const metricIsLeaf =
    (decodeMetricKey(col.path[col.path.length - 1]) ??
      String(col.path[col.path.length - 1] ?? '')) === metricKey;
  if (metricIsLeaf && nonMetricParts.length > 0) {
    if (
      metricsAtColEnd &&
      allowMetricSubtotalLabels &&
      isMetricSubtotalNode(col) &&
      col.hasChildren
    ) {
      return buildMetricSubtotalPathAtEnd();
    }
  }
  return padToDepth(col.path);
};
