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
  type DateFormatter,
  type MeasureHierarchy,
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { coerceEpochMsStringToNumber } from '../../utils';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  isMetricTokenForKeys,
  isSubtotalToken,
  SUBTOTAL_TOKEN,
} from '../core/tokens';
import { formatPivotLabelValue } from '../core/tree';
import { buildDesiredExpandedKeys } from '../expansion/stateModel';
import {
  createMetricNodePolicy,
  getMetricLabelFromPath,
  getNodeDimDepth as getNodeDimDepthBase,
  isExplicitSubtotalNode,
  isExplicitTotalNode as isExplicitTotalNodeBase,
} from '../metricsTotals';
import {
  isValuesAtAxisEnd,
  isValuesFirstOnAxis,
  resolveAxisProjection,
} from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';
import { type PivotLayoutResult } from './usePivotLayout';

export type ColumnDisplayConfig = {
  program: PivotProgram;
  allowMetricSubtotalLabels: boolean;
  getMetricDisplayLabelForKey: (metricKey: string) => string;
  isExpanded?: (node: PivotTreeNode) => boolean;
};

export const buildColumnDisplayPath = (
  col: PivotTreeNode,
  maxDepth: number,
  config: ColumnDisplayConfig,
) => {
  const {
    program,
    allowMetricSubtotalLabels,
    getMetricDisplayLabelForKey,
    isExpanded,
  } = config;
  const {
    metricLabelSet,
    getNonMetricPathParts,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
  } = createMetricNodePolicy(program);
  const metricsFirstOnCols = isValuesFirstOnAxis(program, 'col');
  const metricsAtColEnd = isValuesAtAxisEnd(program, 'col');
  const metricKey = getMetricLabelFromPath(col.path, metricLabelSet);
  const metricLabel = metricKey
    ? getMetricDisplayLabelForKey(metricKey)
    : undefined;
  if (
    program.valueAxis === 'col' &&
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
  if (program.valueAxis !== 'col' || metricsFirstOnCols) {
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
      program.metricKeys.length === 1 ? 'Grand total' : `Total ${metricLabel}`;
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
  if (leafId) {
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
  program,
}: {
  expanded: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  isLeafTierVisible: boolean;
  program: PivotProgram;
}) => {
  if (!isLeafTierVisible) {
    return expanded;
  }
  const metricKeySet = new Set(program.metricKeys);
  const next = new Set(expanded);
  Object.values(nodes).forEach(node => {
    const decoded = decodeMetricKey(node.path[node.path.length - 1]);
    if (decoded !== undefined && metricKeySet.has(decoded)) {
      next.add(node.key);
    }
  });
  return next;
};

const normalizeDateFormatterInput = (value: DataRecordValue) => {
  const normalizedValue = coerceEpochMsStringToNumber(value);
  if (typeof normalizedValue === 'number') {
    return normalizedValue;
  }
  if (normalizedValue instanceof Date) {
    return normalizedValue.getTime();
  }
  if (typeof normalizedValue === 'string') {
    const parsed = Date.parse(normalizedValue);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const formatAxisDateLabels = ({
  axis,
  nodes,
  dateFormatters,
  program,
}: {
  axis: PivotAxis;
  nodes: Record<string, PivotTreeNode>;
  dateFormatters: Record<string, DateFormatter | undefined>;
  program: PivotLayoutResult['layout']['pivotProgram'];
}) => {
  if (Object.keys(dateFormatters).length === 0) {
    return nodes;
  }
  const metricNodePolicy = createMetricNodePolicy(program);
  let hasChanges = false;
  const nextNodes: Record<string, PivotTreeNode> = { ...nodes };
  Object.values(nodes).forEach(node => {
    if (node.path.length === 0 || node.path.some(isSubtotalToken)) {
      return;
    }
    const tail = node.path[node.path.length - 1];
    if (decodeMetricKey(tail) || decodeMeasureLeafId(tail)) {
      return;
    }
    const dimensionKey = metricNodePolicy.getDimensionKeyForNode(node, axis);
    if (!dimensionKey) {
      return;
    }
    const formatter = dateFormatters[dimensionKey];
    if (!formatter) {
      return;
    }
    const nonSubtotalParts = metricNodePolicy.getNonMetricPathParts(node.path);
    const rawValue = nonSubtotalParts[nonSubtotalParts.length - 1];
    if (rawValue === null || rawValue === undefined) {
      return;
    }
    const formatterInput = normalizeDateFormatterInput(rawValue);
    if (formatterInput === undefined) {
      return;
    }
    const formatted = formatter(formatterInput);
    if (formatted !== node.formattedLabel) {
      nextNodes[node.key] = { ...node, formattedLabel: formatted };
      hasChanges = true;
    }
  });
  return hasChanges ? nextNodes : nodes;
};

export const formatRenderTreeDateLabels = ({
  tree,
  dateFormatters,
  program,
}: {
  tree: PivotTreeData;
  dateFormatters?: Record<string, DateFormatter | undefined>;
  program: PivotLayoutResult['layout']['pivotProgram'];
}) => {
  if (!dateFormatters || Object.keys(dateFormatters).length === 0) {
    return tree;
  }
  const nextRows = formatAxisDateLabels({
    axis: 'row',
    nodes: tree.rows,
    dateFormatters,
    program,
  });
  const nextCols = formatAxisDateLabels({
    axis: 'col',
    nodes: tree.cols,
    dateFormatters,
    program,
  });
  if (nextRows === tree.rows && nextCols === tree.cols) {
    return tree;
  }
  return { ...tree, rows: nextRows, cols: nextCols };
};

export type RenderNodeDisplayState = {
  shouldShowToggle: (axis: PivotAxis, node?: PivotTreeNode) => boolean;
  isRowAggregateBold: (node?: PivotTreeNode) => boolean;
  isColAggregateBold: (node?: PivotTreeNode) => boolean;
  getNodeDimDepth: (node: PivotTreeNode) => number;
};

type RenderNodeDisplayLayout = Pick<
  PivotLayoutResult,
  'hideMetricHeaderOnRows'
> & {
  layout: Pick<
    PivotLayoutResult['layout'],
    'axisCoverageNeeds' | 'pivotProgram'
  >;
};

export const buildRenderNodeDisplayState = ({
  rowNodes,
  expandedRows,
  layout,
  isLeafTierVisible,
}: {
  rowNodes: Record<string, PivotTreeNode>;
  expandedRows: Set<string>;
  layout: RenderNodeDisplayLayout;
  isLeafTierVisible: boolean;
}): RenderNodeDisplayState => {
  const groupbyRowsLength = layout.layout.pivotProgram.rowDimensions.length;
  const groupbyColumnsLength =
    layout.layout.pivotProgram.columnDimensions.length;
  const {
    metricLabelSet,
    countDimDepth,
    isMetricGrandTotalNode,
    isMetricSubtotalNode,
  } = createMetricNodePolicy(layout.layout.pivotProgram);
  const isMetricTokenValue = (value: unknown) =>
    isMetricTokenForKeys(value, metricLabelSet);
  const intentRows = buildDesiredExpandedKeys({
    axis: 'row',
    tree: { rows: rowNodes, cols: {}, cells: {} },
    axisCoverageNeeds: layout.layout.axisCoverageNeeds,
    program: layout.layout.pivotProgram,
    manualExpanded: new Set(),
    manualCollapsed: new Set(),
  });
  const manualExpandedRowDepths = new Set<number>();
  expandedRows.forEach(key => {
    const node = rowNodes[key];
    if (intentRows.has(key) || !node?.hasChildren) {
      return;
    }
    manualExpandedRowDepths.add(countDimDepth(node.path));
  });

  const isExplicitTotalNode = (node: PivotTreeNode) =>
    isExplicitTotalNodeBase(node, {
      metricLabelSet,
      program: layout.layout.pivotProgram,
    });

  const getNodeDimDepth = (node: PivotTreeNode) =>
    getNodeDimDepthBase(node, {
      metricLabelSet,
      program: layout.layout.pivotProgram,
      hideMetricHeaderOnRows: layout.hideMetricHeaderOnRows,
    });

  const shouldShowToggle = (axis: PivotAxis, node?: PivotTreeNode) => {
    if (!node || node.path.length === 0) {
      return false;
    }
    if (isExplicitSubtotalNode(node) || isMetricGrandTotalNode(node)) {
      return false;
    }
    const projection = resolveAxisProjection({
      program: layout.layout.pivotProgram,
      axis,
      path: node.path.filter(value => !isSubtotalToken(value)),
    });
    if (
      !projection.nextLevel ||
      (projection.nextLevel.kind === 'values' && !projection.valuesLevelSeen)
    ) {
      return false;
    }
    return (
      !isLeafTierVisible || !isMetricTokenValue(node.path[node.path.length - 1])
    );
  };

  const isRowAggregateBold = (row?: PivotTreeNode) => {
    if (!row || (row.path.length === 0 && groupbyRowsLength === 0)) {
      return false;
    }
    return (
      isExplicitTotalNode(row) ||
      (manualExpandedRowDepths.has(countDimDepth(row.path)) && row.hasChildren)
    );
  };

  const isColAggregateBold = (col?: PivotTreeNode) => {
    if (!col || (col.path.length === 0 && !groupbyColumnsLength)) {
      return false;
    }
    return isExplicitTotalNode(col) || isMetricSubtotalNode(col);
  };

  return {
    shouldShowToggle,
    isRowAggregateBold,
    isColAggregateBold,
    getNodeDimDepth,
  };
};
