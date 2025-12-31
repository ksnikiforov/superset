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

type ColumnDisplayConfig = {
  metricsLayout: MetricsLayoutEnum;
  metricsFirstOnCols: boolean;
  metricsAtColEnd: boolean;
  allowMetricSubtotalLabels: boolean;
  hasDeeperNonMetricDescendants: (node: PivotTreeNode) => boolean;
  metricLabels: string[];
  isExplicitSubtotalNode: (node: PivotTreeNode) => boolean;
  getMetricLabelFromPath: (path: PivotTreeNode['path']) => string | undefined;
  getNonMetricPathParts: (path: PivotTreeNode['path']) => PivotTreeNode['path'];
  isMetricGrandTotalNode: (node: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node: PivotTreeNode) => boolean;
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
    hasDeeperNonMetricDescendants,
    metricLabels,
    isExplicitSubtotalNode,
    getMetricLabelFromPath,
    getNonMetricPathParts,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
  } = config;
  if (metricsLayout !== MetricsLayoutEnum.COLUMNS || metricsFirstOnCols) {
    return col.path;
  }
  const padToDepth = (path: PivotTreeNode['path']) => {
    if (!isExplicitSubtotalNode(col) || path.length >= maxDepth) {
      return path;
    }
    const lastLabel = String(path[path.length - 1] ?? '');
    return [
      ...path,
      ...Array(Math.max(maxDepth - path.length, 0)).fill(lastLabel),
    ];
  };
  const metricLabel = getMetricLabelFromPath(col.path);
  if (!metricLabel) {
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
    if (metricLabels.length === 1) {
      const totalLabel = 'Grand total';
      return metricsAtColEnd
        ? [totalLabel]
        : [totalLabel, ...Array(Math.max(maxDepth - 1, 0)).fill(totalLabel)];
    }
    const totalLabel = `Total ${metricLabel}`;
    if (metricsAtColEnd) {
      return [totalLabel];
    }
    if (maxDepth <= 2) {
      return [totalLabel, metricLabel];
    }
    const padCount = Math.max(maxDepth - 2, 0);
    return [totalLabel, ...Array(padCount).fill(totalLabel), metricLabel];
  }
  const metricIsLeaf =
    String(col.path[col.path.length - 1] ?? '') === metricLabel;
  if (metricIsLeaf && nonMetricParts.length > 0) {
    if (
      metricsAtColEnd &&
      allowMetricSubtotalLabels &&
      isMetricSubtotalNode(col) &&
      hasDeeperNonMetricDescendants(col)
    ) {
      return buildMetricSubtotalPathAtEnd();
    }
    if (!metricsAtColEnd && (isMetricSubtotalNode(col) || col.hasChildren)) {
      const groupLabel = String(nonMetricParts[nonMetricParts.length - 1]);
      return padToDepth([
        ...col.path.slice(0, -1),
        `${groupLabel} ${metricLabel}`,
      ]);
    }
  }
  return padToDepth(col.path);
};
