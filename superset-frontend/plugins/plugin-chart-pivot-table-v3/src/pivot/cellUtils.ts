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
import { DataRecordValue, QueryFormMetric } from '@superset-ui/core';
import { MetricsLayoutEnum, PivotResultCell, PivotTreeNode } from '../types';
import {
  decodeMetricKey,
  getMetricKey,
  serializeCellKey,
  serializePath,
} from '../utils';

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
  const metricLabels = metrics.map(getMetricKey).filter(label => label.length > 0);
  // When metrics are on rows, the metric key is the last element in the row path.
  // When metrics are on cols, it is the last element in the col path.
  const metricCandidate =
    metricsLayout === MetricsLayoutEnum.ROWS
      ? rowNode.path[rowNode.path.length - 1]
      : colNode.path[colNode.path.length - 1];
  const decodedCandidate = decodeMetricKey(metricCandidate);
  if (decodedCandidate && metricLabels.includes(decodedCandidate)) {
    return decodedCandidate;
  }
  // Fallback: first available metric in the cell values.
  return Object.keys(
    cells[serializeCellKey(rowNode.key, colNode.key)]?.values || {},
  )[0];
};

type ShouldHideRowValuesParams = {
  rowNode: PivotTreeNode;
  rowSubTotals: boolean;
  effectiveRowSubtotalPosition: 'start' | 'end';
  isMetricTokenValue: (val: unknown) => boolean;
  expandedRows: Set<string>;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  rowSubtotalDepths: number[];
  isExplicitSubtotalNode: (node?: PivotTreeNode) => boolean;
};

export const shouldHideRowValues = ({
  rowNode,
  rowSubTotals,
  effectiveRowSubtotalPosition,
  isMetricTokenValue,
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
  const metricIndex = rowNode.path.findIndex(val => isMetricTokenValue(val));
  if (metricIndex === rowNode.path.length - 1) {
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
  const metricLabelFromPath = getMetricLabelFromPath(node.path);
  const decodedLabel = decodeMetricKey(rawLabel);
  const resolvedLabel =
    decodedLabel && metricLabelFromPath === decodedLabel
      ? decodedLabel
      : rawLabel;
  const normalizedLabel = isSubtotalToken(resolvedLabel)
    ? subtotalLabel
    : resolvedLabel;
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

export type VisibleCellEntry = {
  cellKey: string;
  cell: PivotResultCell;
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
};

type BuildVisibleCellEntriesParams = {
  cells: Record<string, PivotResultCell>;
  rows: Record<string, PivotTreeNode>;
  cols: Record<string, PivotTreeNode>;
  visibleRowKeys: Set<string>;
  visibleColKeys: Set<string>;
};

export const buildVisibleCellEntries = ({
  cells,
  rows,
  cols,
  visibleRowKeys,
  visibleColKeys,
}: BuildVisibleCellEntriesParams) => {
  const entries: VisibleCellEntry[] = [];
  Object.values(cells).forEach(cell => {
    if (!visibleRowKeys.has(cell.rowKey) || !visibleColKeys.has(cell.colKey)) {
      return;
    }
    const rowNode = rows[cell.rowKey];
    const colNode = cols[cell.colKey];
    if (!rowNode || !colNode) {
      return;
    }
    entries.push({
      cellKey: serializeCellKey(cell.rowKey, cell.colKey),
      cell,
      rowNode,
      colNode,
    });
  });
  return entries;
};

type BuildFormattingValueMapsParams = {
  cells: Record<string, PivotResultCell>;
  rows: Record<string, PivotTreeNode>;
  cols: Record<string, PivotTreeNode>;
  getNonMetricPathParts: (path: PivotTreeNode['path']) => PivotTreeNode['path'];
  rootKey: string;
};

export const buildFormattingValueMaps = ({
  cells,
  rows,
  cols,
  getNonMetricPathParts,
  rootKey,
}: BuildFormattingValueMapsParams) => {
  const rowValuesMap = new Map<string, Record<string, DataRecordValue>>();
  const colValuesMap = new Map<string, Record<string, DataRecordValue>>();
  Object.values(cells).forEach(cell => {
    const rowNode = rows[cell.rowKey];
    const colNode = cols[cell.colKey];
    if (!rowNode || !colNode) {
      return;
    }
    const rowKey = serializePath(getNonMetricPathParts(rowNode.path));
    const colKey = serializePath(getNonMetricPathParts(colNode.path));
    if (colKey === rootKey && !rowValuesMap.has(rowKey)) {
      rowValuesMap.set(rowKey, cell.values);
    }
    if (rowKey === rootKey && !colValuesMap.has(colKey)) {
      colValuesMap.set(colKey, cell.values);
    }
  });
  return { rowValuesMap, colValuesMap };
};
