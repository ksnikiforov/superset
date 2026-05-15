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
import {
  MetricsLayoutEnum,
  type MeasureHierarchy,
  type PivotAxis,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import { findMeasureLeafIdInPath, isSubtotalToken } from '../core/tokens';
import { serializePath } from '../core/path';
import { getMetricDepthForParent, getMetricTierNodes } from '../metricsTotals';
import {
  resolveAxisChildProjection,
  resolveAxisProjection,
  resolveCollapsedValuesProjection,
} from '../runtime/projection';
import { type PivotProgram } from '../runtime/types';
import { findChildren } from '../viewModel';

type ResolveMetricAxisLayoutParams = {
  metricLabelCount: number;
  rowDimCount: number;
  colDimCount: number;
  metricInsertIndex: number;
  resolvedMetricsLayout: MetricsLayoutEnum;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  isLeafTierVisible: boolean;
  rowSubTotals: boolean;
  resolvedRowSubtotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
};

export type MetricAxisLayoutPolicy = {
  singleMetricBetweenRows: boolean;
  singleMetricBetweenCols: boolean;
  shouldExpandMetricRows: boolean;
  shouldExpandMetricCols: boolean;
  metricIndexOnRows?: number;
  metricIndexOnCols?: number;
  metricsAtRowEnd: boolean;
  metricsAtColEnd: boolean;
  metricsFirstOnRows: boolean;
  metricsFirstOnCols: boolean;
  forceRowSubtotalEnd: boolean;
  effectiveRowSubtotalPosition: TotalPosition;
  effectiveColSubtotalPosition: TotalPosition;
  hideMetricHeaderOnRows: boolean;
  hideMetricHeaderOnCols: boolean;
};

export const buildMetricOrderComparator = ({
  metricKeys,
  measureHierarchy,
  getMetricLabelFromPath,
}: {
  metricKeys: string[];
  measureHierarchy: MeasureHierarchy;
  getMetricLabelFromPath: (path: PivotTreeNode['path']) => string | undefined;
}) => {
  const metricOrderMap = new Map(metricKeys.map((label, idx) => [label, idx]));
  const measureLeafOrderMap = new Map<string, Map<string, number>>();
  if (measureHierarchy.kind === 'measureStackV1') {
    measureHierarchy.groups.forEach(group => {
      const order = new Map<string, number>();
      group.leaves.forEach((leaf, index) => {
        order.set(leaf.id, index);
      });
      measureLeafOrderMap.set(group.metricKey, order);
    });
  }

  return (a: PivotTreeNode, b: PivotTreeNode) => {
    const aMetric = getMetricLabelFromPath(a.path);
    const bMetric = getMetricLabelFromPath(b.path);
    if (!aMetric || !bMetric) {
      return 0;
    }
    if (aMetric === bMetric) {
      const leafOrder = measureLeafOrderMap.get(aMetric);
      const aLeaf = findMeasureLeafIdInPath(a.path);
      const bLeaf = findMeasureLeafIdInPath(b.path);
      if (!leafOrder || !aLeaf || !bLeaf || aLeaf === bLeaf) {
        return 0;
      }
      const aIndex = leafOrder.get(aLeaf);
      const bIndex = leafOrder.get(bLeaf);
      return aIndex !== undefined && bIndex !== undefined ? aIndex - bIndex : 0;
    }
    const aIndex = metricOrderMap.get(aMetric);
    const bIndex = metricOrderMap.get(bMetric);
    return aIndex !== undefined && bIndex !== undefined ? aIndex - bIndex : 0;
  };
};

export const resolveMetricAxisLayoutPolicy = ({
  metricLabelCount,
  rowDimCount,
  colDimCount,
  metricInsertIndex,
  resolvedMetricsLayout,
  resolvedExpandRowsLevel,
  resolvedExpandColumnsLevel,
  isLeafTierVisible,
  rowSubTotals,
  resolvedRowSubtotalPosition,
  resolvedColSubtotalPosition,
}: ResolveMetricAxisLayoutParams): MetricAxisLayoutPolicy => {
  const hasMetrics = metricLabelCount > 0;
  const isSingleMetric = metricLabelCount === 1;
  const isMultiMetric = metricLabelCount > 1;
  const metricIndexOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS && hasMetrics
      ? Math.min(metricInsertIndex, rowDimCount)
      : undefined;
  const metricIndexOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS && hasMetrics
      ? Math.min(metricInsertIndex, colDimCount)
      : undefined;
  const singleMetricBetweenRows =
    isSingleMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricIndexOnRows !== undefined &&
    metricIndexOnRows > 0 &&
    metricIndexOnRows < rowDimCount;
  const singleMetricBetweenCols =
    isSingleMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricIndexOnCols !== undefined &&
    metricIndexOnCols > 0 &&
    metricIndexOnCols < colDimCount;

  const shouldExpandMetricRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    hasMetrics &&
    metricInsertIndex === 0 &&
    resolvedExpandRowsLevel > 0;
  const shouldExpandMetricCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    hasMetrics &&
    metricInsertIndex === 0 &&
    resolvedExpandColumnsLevel > 0;

  const metricsAtRowEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricIndexOnRows !== undefined &&
    metricIndexOnRows >= rowDimCount;
  const metricsAtColEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricIndexOnCols !== undefined &&
    metricIndexOnCols >= colDimCount;
  const metricsFirstOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS && metricIndexOnRows === 0;
  const metricsFirstOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricIndexOnCols === 0;

  const forceRowSubtotalEnd =
    rowSubTotals &&
    isMultiMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    !metricsFirstOnRows;
  const effectiveRowSubtotalPosition = forceRowSubtotalEnd
    ? 'end'
    : resolvedRowSubtotalPosition;
  const effectiveColSubtotalPosition =
    isMultiMetric && resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS
      ? 'end'
      : resolvedColSubtotalPosition;

  const hideMetricHeaderOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    !isLeafTierVisible &&
    isSingleMetric &&
    metricIndexOnRows === rowDimCount &&
    rowDimCount > 0;
  const hideMetricHeaderOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    !isLeafTierVisible &&
    isSingleMetric &&
    metricIndexOnCols === colDimCount &&
    colDimCount > 0;

  return {
    singleMetricBetweenRows,
    singleMetricBetweenCols,
    shouldExpandMetricRows,
    shouldExpandMetricCols,
    metricIndexOnRows,
    metricIndexOnCols,
    metricsAtRowEnd,
    metricsAtColEnd,
    metricsFirstOnRows,
    metricsFirstOnCols,
    forceRowSubtotalEnd,
    effectiveRowSubtotalPosition,
    effectiveColSubtotalPosition,
    hideMetricHeaderOnRows,
    hideMetricHeaderOnCols,
  };
};

type ResolveAxisChildrenBeforeSubtotalPolicyParams = {
  program: PivotProgram;
  axis: PivotAxis;
  parent: PivotTreeNode;
  nodes: Record<string, PivotTreeNode>;
  metricIndex?: number;
  groupbyLength: number;
  hideMetricHeader: boolean;
  metricsFirst: boolean;
  isMetricTokenValue: (value: unknown) => boolean;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  keepValuesChild: (
    child: PivotTreeNode,
    hasNonValuesChildren: boolean,
  ) => boolean;
};

export const resolveAxisChildrenBeforeSubtotalPolicy = ({
  program,
  axis,
  parent,
  nodes,
  metricIndex,
  groupbyLength,
  hideMetricHeader,
  metricsFirst,
  isMetricTokenValue,
  isMetricGrandTotalNode,
  keepValuesChild,
}: ResolveAxisChildrenBeforeSubtotalPolicyParams): PivotTreeNode[] => {
  const children = findChildren(nodes, parent);
  const getChildProjection = (child: PivotTreeNode) =>
    resolveAxisChildProjection({
      program,
      axis,
      parentPath: parent.path,
      childPath: child.path,
    });
  const { valuesLevelSeen } = resolveAxisProjection({
    program,
    axis,
    path: parent.path.filter(val => !isSubtotalToken(val)),
  });
  let filtered =
    valuesLevelSeen || metricIndex === undefined
      ? children
      : children.filter(
          child =>
            child.path.length <= metricIndex ||
            getChildProjection(child).rawValuesTokenIndex === metricIndex,
        );
  const expectedMetricsLayout =
    axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;
  if (
    program.metricsLayoutResolved === expectedMetricsLayout &&
    parent.axis === axis &&
    parent.level < groupbyLength &&
    (metricIndex === undefined || metricIndex > parent.level)
  ) {
    const projected = children.map(child => ({
      child,
      introducesValues: getChildProjection(child).introducesValues,
    }));
    const hasNonValuesChildren = projected.some(
      child => !child.introducesValues,
    );
    const withoutMetrics = projected
      .filter(
        ({ child, introducesValues }) =>
          !introducesValues || keepValuesChild(child, hasNonValuesChildren),
      )
      .map(({ child }) => child);
    filtered = withoutMetrics.length > 0 ? withoutMetrics : children;
  }
  if (
    hideMetricHeader &&
    parent.axis === axis &&
    parent.level >= groupbyLength
  ) {
    filtered = filtered.filter(
      child => !isMetricTokenValue(child.path[parent.level]),
    );
  }
  if (metricsFirst) {
    filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
  }
  return filtered;
};

type ResolveCollapsedValuesNodesForAxisParams = {
  program: PivotProgram;
  metricLabelSet: Set<string>;
  axis: PivotAxis;
  parent: PivotTreeNode;
  expandedSet: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  exposeCollapsedMetricTier: boolean;
  metricsAtEnd: boolean;
  suppressSubtotalParent: boolean;
  normalizeSubtotalExisting: boolean;
  isMetricTokenValue: (value: unknown) => boolean;
  isExplicitSubtotalNode: (node?: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node?: PivotTreeNode) => boolean;
};

export const resolveCollapsedValuesNodesForAxis = ({
  program,
  metricLabelSet,
  axis,
  parent,
  expandedSet,
  nodes,
  exposeCollapsedMetricTier,
  metricsAtEnd,
  suppressSubtotalParent,
  normalizeSubtotalExisting,
  isMetricTokenValue,
  isExplicitSubtotalNode,
  isMetricSubtotalNode,
}: ResolveCollapsedValuesNodesForAxisParams): PivotTreeNode[] => {
  const expectedMetricsLayout =
    axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;
  if (
    !exposeCollapsedMetricTier ||
    program.metricsLayoutResolved !== expectedMetricsLayout ||
    expandedSet.has(parent.key)
  ) {
    return [];
  }
  if (
    (suppressSubtotalParent &&
      (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent))) ||
    parent.path.some(val => isMetricTokenValue(val))
  ) {
    return [];
  }
  const metricDepth = getMetricDepthForParent(nodes, parent, metricLabelSet);
  if (metricDepth === undefined || parent.path.length > metricDepth) {
    return [];
  }
  const metricNodes = getMetricTierNodes(
    nodes,
    parent,
    metricDepth,
    metricLabelSet,
  );
  if (metricNodes.length === 0) {
    return [];
  }
  const collapsedMetrics = resolveCollapsedValuesProjection({
    program,
    axis,
    parentPath: parent.path,
    sourceMetricPaths: metricNodes.map(node => node.path),
  });
  return collapsedMetrics.map(metric => {
    const collapsedKey = serializePath(metric.metricPath);
    const existing = nodes[collapsedKey];
    const sourceNode = nodes[serializePath(metric.sourceMetricPath)];
    const hasChildren = metricsAtEnd
      ? false
      : findChildren(nodes, existing || { ...parent, path: metric.metricPath })
          .length > 0 || metric.hasProjectedChildren;
    if (existing) {
      if (normalizeSubtotalExisting && isMetricSubtotalNode(existing)) {
        return {
          ...existing,
          label: metric.metricKey,
          formattedLabel: metric.metricKey,
          isSubtotal: false,
          hasChildren,
        };
      }
      return { ...existing, hasChildren };
    }
    return {
      ...(sourceNode || metricNodes[0]),
      key: collapsedKey,
      path: metric.metricPath,
      label: metric.metricKey,
      formattedLabel: metric.metricKey,
      level: metric.metricPath.length,
      hasChildren,
    };
  });
};

type ResolveRowSubtotalChildrenPolicyParams = {
  children: PivotTreeNode[];
  parent: PivotTreeNode;
  nodes: Record<string, PivotTreeNode>;
  rowSubTotals: boolean;
  rowSubtotalPositionForParent: TotalPosition;
  resolvedMetricsLayout: MetricsLayoutEnum;
  isMultiMetric: boolean;
  metricIndexOnRows?: number;
  hideMetricHeaderOnRows: boolean;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  isMetricTokenValue: (value: unknown) => boolean;
  isMetricGrandTotalNode: (node?: PivotTreeNode) => boolean;
  isExplicitSubtotalNode: (node?: PivotTreeNode) => boolean;
};

export const resolveRowSubtotalChildrenPolicy = ({
  children,
  parent,
  nodes,
  rowSubTotals,
  rowSubtotalPositionForParent,
  resolvedMetricsLayout,
  isMultiMetric,
  metricIndexOnRows,
  hideMetricHeaderOnRows,
  countDimDepth,
  isMetricTokenValue,
  isMetricGrandTotalNode,
  isExplicitSubtotalNode,
}: ResolveRowSubtotalChildrenPolicyParams): PivotTreeNode[] => {
  let filtered = children;
  if (resolvedMetricsLayout === MetricsLayoutEnum.ROWS && !isMultiMetric) {
    filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
  }
  if (!rowSubTotals || rowSubtotalPositionForParent === 'start') {
    filtered = filtered.filter(
      child =>
        child.path.length === 0 ||
        !isExplicitSubtotalNode(child) ||
        isMetricGrandTotalNode(child),
    );
  }
  if (rowSubTotals && rowSubtotalPositionForParent === 'end') {
    const requireMetricLabel =
      resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
      isMultiMetric &&
      metricIndexOnRows !== undefined &&
      countDimDepth(parent.path) > metricIndexOnRows;
    const subtotalDescendants = Object.values(nodes).filter(node => {
      if (
        node.path.length <= parent.path.length ||
        !parent.path.every((val, idx) => val === node.path[idx])
      ) {
        return false;
      }
      if (
        (resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
          !isMultiMetric &&
          isMetricGrandTotalNode(node)) ||
        !isSubtotalToken(node.path[parent.path.length])
      ) {
        return false;
      }
      const hasMetricToken = node.path.some(val => isMetricTokenValue(val));
      return hideMetricHeaderOnRows
        ? !hasMetricToken
        : !requireMetricLabel || hasMetricToken;
    });
    const seen = new Set(filtered.map(child => child.key));
    subtotalDescendants.forEach(node => {
      const subtotalIndex = node.path.findIndex(val => isSubtotalToken(val));
      if (
        !(
          resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
          isMultiMetric &&
          subtotalIndex > 0 &&
          isMetricTokenValue(node.path[subtotalIndex - 1])
        ) &&
        !seen.has(node.key)
      ) {
        filtered.push(node);
      }
    });
  }
  if (
    rowSubTotals &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    isMultiMetric
  ) {
    filtered = filtered.filter(
      child =>
        !isExplicitSubtotalNode(child) ||
        isMetricGrandTotalNode(child) ||
        child.path.some(val => isMetricTokenValue(val)),
    );
  }
  return filtered;
};
