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
  type MeasureHierarchy,
  type PivotAxis,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import {
  findMeasureLeafIdInPath,
  isMetricTokenForKeys,
  isSubtotalToken,
} from '../core/tokens';
import { serializePath } from '../core/path';
import {
  createMetricNodePolicy,
  getMetricDepthForParent,
  getMetricTierNodes,
  isExplicitSubtotalNode,
} from '../metricsTotals';
import {
  getAxisDimensionCount,
  getValuesLevelIndex,
  isValuesAtAxisEnd,
  isValuesFirstOnAxis,
  resolveAxisChildProjection,
  resolveAxisProjection,
  resolveCollapsedValuesProjection,
} from '../runtime/projection';
import { type PivotProgram } from '../runtime/types';
import { findChildren } from '../viewModel';

type ResolveMetricAxisLayoutParams = {
  program: PivotProgram;
  isLeafTierVisible: boolean;
  rowSubTotals: boolean;
  resolvedRowSubtotalPosition: TotalPosition;
  resolvedColSubtotalPosition: TotalPosition;
};

export type MetricAxisLayoutPolicy = {
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
  program,
  isLeafTierVisible,
  rowSubTotals,
  resolvedRowSubtotalPosition,
  resolvedColSubtotalPosition,
}: ResolveMetricAxisLayoutParams): MetricAxisLayoutPolicy => {
  const { rowDimensions, columnDimensions, metricKeys } = program;
  const metricLabelCount = metricKeys.length;
  const rowDimCount = rowDimensions.length;
  const colDimCount = columnDimensions.length;
  const isSingleMetric = metricLabelCount === 1;
  const isMultiMetric = metricLabelCount > 1;
  const metricIndexOnRows = getValuesLevelIndex(program, 'row');
  const metricIndexOnCols = getValuesLevelIndex(program, 'col');
  const metricsFirstOnRows = isValuesFirstOnAxis(program, 'row');

  const forceRowSubtotalEnd =
    rowSubTotals &&
    isMultiMetric &&
    program.valueAxis === 'row' &&
    !metricsFirstOnRows;
  const effectiveRowSubtotalPosition = forceRowSubtotalEnd
    ? 'end'
    : resolvedRowSubtotalPosition;
  const effectiveColSubtotalPosition =
    isMultiMetric && program.valueAxis === 'col'
      ? 'end'
      : resolvedColSubtotalPosition;

  const hideMetricHeaderOnRows =
    program.valueAxis === 'row' &&
    !isLeafTierVisible &&
    isSingleMetric &&
    metricIndexOnRows === rowDimCount &&
    rowDimCount > 0;
  const hideMetricHeaderOnCols =
    program.valueAxis === 'col' &&
    !isLeafTierVisible &&
    isSingleMetric &&
    metricIndexOnCols === colDimCount &&
    colDimCount > 0;

  return {
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
  hideMetricHeader: boolean;
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
  hideMetricHeader,
  keepValuesChild,
}: ResolveAxisChildrenBeforeSubtotalPolicyParams): PivotTreeNode[] => {
  const children = findChildren(nodes, parent);
  const { metricLabelSet, isMetricGrandTotalNode } =
    createMetricNodePolicy(program);
  const metricIndex = getValuesLevelIndex(program, axis);
  const groupbyLength = getAxisDimensionCount(program, axis);
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
  const isValueAxis = program.valueAxis === axis && parent.axis === axis;
  if (
    isValueAxis &&
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
      child => !isMetricTokenForKeys(child.path[parent.level], metricLabelSet),
    );
  }
  if (isValuesFirstOnAxis(program, axis)) {
    filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
  }
  return filtered;
};

type ResolveCollapsedValuesNodesForAxisParams = {
  program: PivotProgram;
  axis: PivotAxis;
  parent: PivotTreeNode;
  expandedSet: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  isLeafTierVisible: boolean;
  suppressSubtotalParent: boolean;
  normalizeSubtotalExisting: boolean;
};

export const resolveCollapsedValuesNodesForAxis = ({
  program,
  axis,
  parent,
  expandedSet,
  nodes,
  isLeafTierVisible,
  suppressSubtotalParent,
  normalizeSubtotalExisting,
}: ResolveCollapsedValuesNodesForAxisParams): PivotTreeNode[] => {
  const { metricLabelSet, isMetricSubtotalNode } =
    createMetricNodePolicy(program);
  const metricIndex = getValuesLevelIndex(program, axis);
  const axisDimensionCount = getAxisDimensionCount(program, axis);
  const isSingleMetricBetween =
    program.metricKeys.length === 1 &&
    metricIndex !== undefined &&
    metricIndex > 0 &&
    metricIndex < axisDimensionCount;
  const metricsAtEnd = isValuesAtAxisEnd(program, axis);
  const exposeCollapsedMetricTier =
    program.metricKeys.length > 1 ||
    isSingleMetricBetween ||
    (isLeafTierVisible && metricsAtEnd);
  if (
    !exposeCollapsedMetricTier ||
    program.valueAxis !== axis ||
    expandedSet.has(parent.key)
  ) {
    return [];
  }
  if (
    (suppressSubtotalParent &&
      (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent))) ||
    parent.path.some(val => isMetricTokenForKeys(val, metricLabelSet))
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
  program: PivotProgram;
  children: PivotTreeNode[];
  parent: PivotTreeNode;
  nodes: Record<string, PivotTreeNode>;
  rowSubTotals: boolean;
  rowSubtotalPositionForParent: TotalPosition;
  hideMetricHeaderOnRows: boolean;
};

export const resolveRowSubtotalChildrenPolicy = ({
  program,
  children,
  parent,
  nodes,
  rowSubTotals,
  rowSubtotalPositionForParent,
  hideMetricHeaderOnRows,
}: ResolveRowSubtotalChildrenPolicyParams): PivotTreeNode[] => {
  const isMultiMetric = program.metricKeys.length > 1;
  const { metricLabelSet, countDimDepth, isMetricGrandTotalNode } =
    createMetricNodePolicy(program);
  const metricIndexOnRows = getValuesLevelIndex(program, 'row');
  const isRowMetricAxis = program.valueAxis === 'row';
  let filtered = children;
  if (isRowMetricAxis && !isMultiMetric) {
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
      isRowMetricAxis &&
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
        (isRowMetricAxis && !isMultiMetric && isMetricGrandTotalNode(node)) ||
        !isSubtotalToken(node.path[parent.path.length])
      ) {
        return false;
      }
      const hasMetricToken = node.path.some(val =>
        isMetricTokenForKeys(val, metricLabelSet),
      );
      return hideMetricHeaderOnRows
        ? !hasMetricToken
        : !requireMetricLabel || hasMetricToken;
    });
    const seen = new Set(filtered.map(child => child.key));
    subtotalDescendants.forEach(node => {
      const subtotalIndex = node.path.findIndex(val => isSubtotalToken(val));
      if (
        !(
          isRowMetricAxis &&
          isMultiMetric &&
          subtotalIndex > 0 &&
          isMetricTokenForKeys(node.path[subtotalIndex - 1], metricLabelSet)
        ) &&
        !seen.has(node.key)
      ) {
        filtered.push(node);
      }
    });
  }
  if (rowSubTotals && isRowMetricAxis && isMultiMetric) {
    filtered = filtered.filter(
      child =>
        !isExplicitSubtotalNode(child) ||
        isMetricGrandTotalNode(child) ||
        child.path.some(val => isMetricTokenForKeys(val, metricLabelSet)),
    );
  }
  return filtered;
};
