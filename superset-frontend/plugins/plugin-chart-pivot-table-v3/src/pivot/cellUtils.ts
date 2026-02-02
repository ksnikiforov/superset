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
import {
  MeasureHierarchy,
  MetricsLayoutEnum,
  PivotResultCell,
  PivotTreeNode,
} from '../types';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  getMetricKey,
  serializeCellKey,
  serializePath,
} from '../utils';
import { buildMeasureLeafOutputKey } from './measureLeaves';

type DeriveMetricKeyParams = {
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
  metrics: QueryFormMetric[];
  metricsLayout: MetricsLayoutEnum;
  cells: Record<string, PivotResultCell>;
  measureHierarchy?: MeasureHierarchy;
};

export const deriveMetricKey = ({
  rowNode,
  colNode,
  metrics,
  metricsLayout,
  cells,
  measureHierarchy,
}: DeriveMetricKeyParams) => {
  const metricLabels = metrics
    .map(getMetricKey)
    .filter(label => label.length > 0);
  const primaryPath =
    metricsLayout === MetricsLayoutEnum.ROWS ? rowNode.path : colNode.path;
  const secondaryPath =
    metricsLayout === MetricsLayoutEnum.ROWS ? colNode.path : rowNode.path;
  const findMetricToken = (path: PivotTreeNode['path']) =>
    [...path].reverse().find(val => {
      const decoded = decodeMetricKey(val);
      return decoded !== undefined && metricLabels.includes(decoded);
    });
  const metricCandidate =
    findMetricToken(primaryPath) ?? findMetricToken(secondaryPath);
  const decodedCandidate = decodeMetricKey(metricCandidate);
  if (decodedCandidate && metricLabels.includes(decodedCandidate)) {
    if (measureHierarchy?.kind === 'measureStackV1') {
      const findLeafId = (path: PivotTreeNode['path']) =>
        [...path]
          .reverse()
          .map(val => decodeMeasureLeafId(val))
          .find((candidate): candidate is string => !!candidate);
      const leafId = findLeafId(primaryPath) ?? findLeafId(secondaryPath);
      const group = measureHierarchy.groups.find(
        entry => entry.metricKey === decodedCandidate,
      );
      const leaf =
        (leafId && group?.leaves.find(item => item.id === leafId)) ||
        group?.leaves[0];
      if (leaf) {
        return buildMeasureLeafOutputKey(decodedCandidate, leaf);
      }
    }
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
  getMetricKeyFromPath: (path: PivotTreeNode['path']) => string | undefined;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
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
  getMetricKeyFromPath,
  getMetricDisplayLabelForKey,
  translate,
  subtotalLabel,
  isSubtotalToken,
}: FormatLabelParams) => {
  const rawLabel = node.formattedLabel || node.label;
  const metricKeyFromPath = getMetricKeyFromPath(node.path);
  const metricDisplayLabel = metricKeyFromPath
    ? getMetricDisplayLabelForKey(metricKeyFromPath)
    : undefined;
  const decodedLabel = decodeMetricKey(rawLabel);
  let resolvedLabel = rawLabel;
  if (
    decodedLabel &&
    metricKeyFromPath === decodedLabel &&
    metricDisplayLabel
  ) {
    resolvedLabel = metricDisplayLabel;
  } else if (
    metricKeyFromPath &&
    rawLabel === metricKeyFromPath &&
    metricDisplayLabel
  ) {
    resolvedLabel = metricDisplayLabel;
  }
  const normalizedLabel = isSubtotalToken(resolvedLabel)
    ? subtotalLabel
    : resolvedLabel;
  if (node.level === 0) {
    return translate(normalizedLabel || 'Grand total');
  }
  const hasNonMetricParts = node.path.some(value => {
    if (isSubtotalToken(value)) {
      return false;
    }
    if (decodeMetricKey(value)) {
      return false;
    }
    if (decodeMeasureLeafId(value)) {
      return false;
    }
    return true;
  });
  if (
    axis === 'col' &&
    metricsLayout === MetricsLayoutEnum.COLUMNS &&
    isMetricGrandTotalNode(node) &&
    !hasNonMetricParts
  ) {
    return translate('Total');
  }
  if (
    axis === 'row' &&
    metricsLayout === MetricsLayoutEnum.ROWS &&
    metricIndexOnRows !== undefined &&
    metricIndexOnRows > 0 &&
    isMetricGrandTotalNode(node)
  ) {
    if (metricDisplayLabel) {
      return `Total ${metricDisplayLabel}`;
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
