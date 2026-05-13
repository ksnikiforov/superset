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
  type PivotSortOrder,
  type PivotTreeNode,
} from '../../types';
import { findMeasureLeafIdInPath } from '../../utils';
import {
  buildMeasureLeafOutputKey,
  resolveMeasureSortMetricKey,
} from '../measureLeaves';

export type PivotColumnSortState = {
  colKey: string;
  displayColKey?: string;
  metricKey: string;
  order: PivotSortOrder;
};

export type PivotColumnSortLayout = {
  measureHierarchy: MeasureHierarchy;
  getMetricLabelFromPath: (path: PivotTreeNode['path']) => string | undefined;
};

export const resolvePivotColumnSortMetric = ({
  node,
  layout,
}: {
  node: PivotTreeNode;
  layout: PivotColumnSortLayout;
}) => {
  const metricKey = layout.getMetricLabelFromPath(node.path);
  if (!metricKey) {
    return undefined;
  }
  if (layout.measureHierarchy.kind !== 'measureStackV1') {
    return metricKey;
  }
  const fallbackMetricKey = resolveMeasureSortMetricKey({
    metricKey,
    measureHierarchy: layout.measureHierarchy,
  });
  const leafId = findMeasureLeafIdInPath(node.path);
  if (!leafId) {
    return fallbackMetricKey;
  }
  const leaf = layout.measureHierarchy.groups
    .find(candidate => candidate.metricKey === metricKey)
    ?.leaves.find(candidate => candidate.id === leafId);
  return leaf ? buildMeasureLeafOutputKey(metricKey, leaf) : fallbackMetricKey;
};

export const resolvePivotColumnSortDataKey = ({
  node,
  metricKey,
  layout,
  columnNodes,
}: {
  node: PivotTreeNode;
  metricKey: string;
  layout: PivotColumnSortLayout;
  columnNodes: Record<string, PivotTreeNode>;
}) => {
  const baseMetricKey = layout.getMetricLabelFromPath(node.path);
  if (!baseMetricKey) {
    return node.key;
  }
  if (layout.measureHierarchy.kind !== 'measureStackV1') {
    return node.key;
  }
  const sortLeafId = layout.measureHierarchy.groups
    .find(group => group.metricKey === baseMetricKey)
    ?.leaves.find(
      leaf => buildMeasureLeafOutputKey(baseMetricKey, leaf) === metricKey,
    )?.id;
  if (!sortLeafId) {
    return node.key;
  }
  if (findMeasureLeafIdInPath(node.path) === sortLeafId) {
    return node.key;
  }

  let descendant: PivotTreeNode | undefined;
  Object.values(columnNodes).forEach(candidate => {
    if (
      candidate.key === node.key ||
      candidate.path.length <= node.path.length ||
      !node.path.every((value, index) => candidate.path[index] === value) ||
      findMeasureLeafIdInPath(candidate.path) !== sortLeafId
    ) {
      return;
    }
    if (!descendant || candidate.path.length < descendant.path.length) {
      descendant = candidate;
    }
  });
  return descendant?.key ?? node.key;
};

export const getPivotColumnSortOrder = ({
  current,
  node,
}: {
  current?: PivotColumnSortState | null;
  node: PivotTreeNode;
}) =>
  (current?.displayColKey ?? current?.colKey) === node.key
    ? current?.order
    : undefined;

export const buildPivotColumnSortStateForClick = ({
  current,
  node,
  layout,
  columnNodes,
}: {
  current?: PivotColumnSortState | null;
  node: PivotTreeNode;
  layout: PivotColumnSortLayout;
  columnNodes: Record<string, PivotTreeNode>;
}): PivotColumnSortState | null | undefined => {
  const metricKey = resolvePivotColumnSortMetric({ node, layout });
  if (!metricKey) {
    return undefined;
  }
  const dataColKey = resolvePivotColumnSortDataKey({
    node,
    metricKey,
    layout,
    columnNodes,
  });
  const currentDisplayKey = current?.displayColKey ?? current?.colKey;
  if (
    current &&
    currentDisplayKey === node.key &&
    current.metricKey === metricKey
  ) {
    if (current.order === 'asc') {
      return { ...current, order: 'desc' };
    }
    return null;
  }
  return {
    colKey: dataColKey,
    displayColKey: node.key,
    metricKey,
    order: 'asc',
  };
};

export const reconcilePivotColumnSortState = ({
  current,
  layout,
  columnNodes,
}: {
  current?: PivotColumnSortState | null;
  layout: PivotColumnSortLayout;
  columnNodes: Record<string, PivotTreeNode>;
}): PivotColumnSortState | null => {
  if (!current) {
    return current ?? null;
  }
  const displayNode =
    (current.displayColKey && columnNodes[current.displayColKey]) ||
    columnNodes[current.colKey];
  if (!displayNode) {
    return null;
  }
  const nextMetricKey = resolvePivotColumnSortMetric({
    node: displayNode,
    layout,
  });
  if (!nextMetricKey) {
    return null;
  }
  const nextDataColKey = resolvePivotColumnSortDataKey({
    node: displayNode,
    metricKey: nextMetricKey,
    layout,
    columnNodes,
  });
  const nextDisplayColKey = displayNode.key;
  const currentDisplayColKey = current.displayColKey ?? current.colKey;
  if (
    current.metricKey === nextMetricKey &&
    current.colKey === nextDataColKey &&
    currentDisplayColKey === nextDisplayColKey
  ) {
    return current;
  }
  return {
    ...current,
    metricKey: nextMetricKey,
    colKey: nextDataColKey,
    displayColKey: nextDisplayColKey,
  };
};
