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
import { getColumnLabel, QueryFormMetric } from '@superset-ui/core';
import { MetricsLayoutEnum, PivotResultCell, PivotTreeNode } from '../types';

type DeriveMetricKeyParams = {
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
  metrics: QueryFormMetric[];
  metricsLayout: MetricsLayoutEnum;
  cells: Record<string, PivotResultCell>;
};

export const deriveMetricKey = ({
  rowNode,
  colNode,
  metrics,
  metricsLayout,
  cells,
}: DeriveMetricKeyParams) => {
  const metricLabels = metrics.map(m =>
    typeof m === 'string' ? m : getColumnLabel(m as any),
  );
  // When metrics are on rows, the metric key is the last element in the row path.
  // When metrics are on cols, it is the last element in the col path.
  const metricCandidate =
    metricsLayout === MetricsLayoutEnum.ROWS
      ? rowNode.path[rowNode.path.length - 1]
      : colNode.path[colNode.path.length - 1];
  if (metricCandidate && metricLabels.includes(String(metricCandidate))) {
    return metricCandidate as string;
  }
  // Fallback: first available metric in the cell values.
  return Object.keys(cells[`${rowNode.key}|${colNode.key}`]?.values || {})[0];
};

type ShouldHideRowValuesParams = {
  rowNode: PivotTreeNode;
  rowSubTotals: boolean;
  effectiveRowSubtotalPosition: 'start' | 'end';
  metricLabelSet: Set<string>;
  expandedRows: Set<string>;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  rowSubtotalDepths: number[];
  isExplicitSubtotalNode: (node?: PivotTreeNode) => boolean;
};

export const shouldHideRowValues = ({
  rowNode,
  rowSubTotals,
  effectiveRowSubtotalPosition,
  metricLabelSet,
  expandedRows,
  countDimDepth,
  rowSubtotalDepths,
  isExplicitSubtotalNode,
}: ShouldHideRowValuesParams) => {
  if (!rowSubTotals || effectiveRowSubtotalPosition !== 'end') {
    return false;
  }
  if (rowNode.path.length === 0 || isExplicitSubtotalNode(rowNode)) {
    return false;
  }
  if (rowNode.path.some(val => metricLabelSet.has(String(val ?? '')))) {
    return false;
  }
  if (!rowNode.hasChildren) {
    return false;
  }
  if (!expandedRows.has(rowNode.key)) {
    return false;
  }
  const dimDepth = countDimDepth(rowNode.path);
  return rowSubtotalDepths.includes(dimDepth);
};

type FormatLabelParams = {
  node: PivotTreeNode;
  axis: 'row' | 'col';
  metricsLayout: MetricsLayoutEnum;
  metricIndexOnRows?: number;
  isMetricGrandTotalNode: (node: PivotTreeNode) => boolean;
  getMetricLabelFromPath: (path: PivotTreeNode['path']) => string | undefined;
  translate: (label: string) => string;
  subtotalLabel: string;
  isSubtotalToken: (val: unknown) => boolean;
};

export const formatNodeLabel = ({
  node,
  axis,
  metricsLayout,
  metricIndexOnRows,
  isMetricGrandTotalNode,
  getMetricLabelFromPath,
  translate,
  subtotalLabel,
  isSubtotalToken,
}: FormatLabelParams) => {
  const rawLabel = node.formattedLabel || node.label;
  const normalizedLabel = isSubtotalToken(rawLabel) ? subtotalLabel : rawLabel;
  if (node.level === 0) {
    return translate(normalizedLabel || 'Grand total');
  }
  if (
    axis === 'row' &&
    metricsLayout === MetricsLayoutEnum.ROWS &&
    metricIndexOnRows !== undefined &&
    metricIndexOnRows > 0 &&
    isMetricGrandTotalNode(node)
  ) {
    const metricLabel = getMetricLabelFromPath(node.path);
    if (metricLabel) {
      return `Total ${metricLabel}`;
    }
  }
  return normalizedLabel;
};
