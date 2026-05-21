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
  type PivotAxis,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { parsePath, serializePath } from '../core/path';
import { buildExpandedKeysForCoverageNeeds } from './planner';
import {
  buildDesiredExpandedKeys,
  pruneExpandedToStablePrefix,
  type PivotExpansionStateKeys,
} from './stateModel';
import { rootKey } from '../viewModel';
import { type PivotAxisCoverageNeed } from '../runtime/coverage';
import {
  getAxisDimensionCount,
  getValuesLevelIndex,
} from '../runtime/projection';
import type { PivotProgram } from '../runtime/types';
import { isMetricTokenForKeys } from '../core/tokens';
import { createMetricNodePolicy } from '../metricsTotals';

export const PIVOT_AXES: PivotAxis[] = ['row', 'col'];
type AxisSetMap = Record<PivotAxis, Set<string>>;

const findMetricIndex = (
  path: PivotTreeNode['path'],
  metricLabelSet: ReadonlySet<string>,
) => path.findIndex(value => isMetricTokenForKeys(value, metricLabelSet));

const expandMetricPatternExpansions = ({
  expanded,
  nodes,
  metricIndex,
  metricLabelSet,
}: {
  expanded: Set<string>;
  nodes: Record<string, PivotTreeNode>;
  metricIndex: number | undefined;
  metricLabelSet: ReadonlySet<string>;
}) => {
  if (metricIndex === undefined || metricIndex < 0) {
    return expanded;
  }
  const resolved = new Set(expanded);
  const candidates = Object.values(nodes);
  expanded.forEach(key => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    const patternMetricIndex = findMetricIndex(path, metricLabelSet);
    if (patternMetricIndex < 0 || patternMetricIndex > metricIndex) {
      return;
    }
    const prefix = path.slice(0, patternMetricIndex);
    const metricToken = path[patternMetricIndex];
    const suffix = path.slice(patternMetricIndex + 1);
    candidates.forEach(candidate => {
      const candidateMetricIndex = findMetricIndex(
        candidate.path,
        metricLabelSet,
      );
      if (
        candidateMetricIndex < patternMetricIndex ||
        candidateMetricIndex > metricIndex
      ) {
        return;
      }
      if (candidate.path[candidateMetricIndex] !== metricToken) {
        return;
      }
      if (prefix.length > 0) {
        for (let idx = 0; idx < prefix.length; idx += 1) {
          if (candidate.path[idx] !== prefix[idx]) {
            return;
          }
        }
      }
      const suffixStart = candidateMetricIndex + 1;
      if (suffixStart + suffix.length > candidate.path.length) {
        return;
      }
      const expectedLength = suffixStart + suffix.length;
      if (candidate.path.length !== expectedLength) {
        return;
      }
      for (let idx = 0; idx < suffix.length; idx += 1) {
        if (candidate.path[suffixStart + idx] !== suffix[idx]) {
          return;
        }
      }
      resolved.add(candidate.key);
    });
  });
  return resolved;
};

export type PivotLayoutKeyState = Record<'rows' | 'cols', string[]>;
type ResolveLayoutTransitionInput = Record<
  'previousLayout' | 'currentLayout',
  PivotLayoutKeyState
>;

export const resolveLayoutTransition = ({
  previousLayout,
  currentLayout,
}: ResolveLayoutTransitionInput) => {
  const buildAxisTransition = (previous: string[], current: string[]) => {
    const changedAt = previous.findIndex(
      (value, idx) => value !== current[idx],
    );
    const stablePrefix =
      changedAt < 0 ? Math.min(previous.length, current.length) : changedAt;
    return {
      changed: previous.length !== current.length || changedAt >= 0,
      shouldExpand: current.length > previous.length && changedAt < 0,
      stablePrefix,
    };
  };
  return {
    row: buildAxisTransition(previousLayout.rows, currentLayout.rows),
    col: buildAxisTransition(previousLayout.cols, currentLayout.cols),
  };
};

export const addAncestors = (
  path: PivotTreeNode['path'],
  target: Set<string>,
  expanded?: Set<string>,
) => {
  for (let idx = 1; idx <= path.length; idx += 1) {
    const key = serializePath(path.slice(0, idx));
    if (expanded && !expanded.has(key) && idx < path.length) {
      continue;
    }
    target.add(key);
  }
};

export const dropDescendants = (
  parentPath: PivotTreeNode['path'],
  keys: Set<string>,
  nodes: Record<string, PivotTreeNode>,
) => {
  const next = new Set<string>();
  keys.forEach(key => {
    const node = nodes[key];
    const path = node ? node.path : parsePath(key);
    const isDescendant = parentPath.every((val, idx) => val === path[idx]);
    if (!isDescendant) {
      next.add(key);
    }
  });
  return next;
};

export const resolveExpansionToggleDecision = ({
  node,
  expanded,
  manualExpanded,
  manualCollapsed,
}: {
  node: PivotTreeNode;
  expanded: Set<string>;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
}) => {
  const isOpen = expanded.has(node.key) || manualExpanded.has(node.key);
  if (isOpen) {
    return { kind: 'collapse' as const };
  }

  const nextManualExpanded = new Set(manualExpanded);
  addAncestors(node.path, nextManualExpanded);
  const nextManualCollapsed = new Set(manualCollapsed);
  nextManualCollapsed.delete(node.key);
  return {
    kind: 'expand' as const,
    nextManualExpanded,
    nextManualCollapsed,
  };
};

export const resolveCollapsedExpansionState = ({
  node,
  expanded,
  manualExpanded,
  manualCollapsed,
  nodes,
}: {
  node: PivotTreeNode;
  expanded: Set<string>;
  manualExpanded: Set<string>;
  manualCollapsed: Set<string>;
  nodes: Record<string, PivotTreeNode>;
}) => {
  const nextManualExpanded = dropDescendants(node.path, manualExpanded, nodes);
  const nextManualCollapsed = dropDescendants(
    node.path,
    manualCollapsed,
    nodes,
  );
  nextManualCollapsed.add(node.key);

  const nextExpanded = dropDescendants(node.path, expanded, nodes);
  nextExpanded.delete(node.key);

  return {
    nextExpanded,
    nextManualExpanded,
    nextManualCollapsed,
  };
};

export const resolveExpandedForMetrics = ({
  axis,
  expanded,
  tree,
  collapsed,
  program,
  isLeafTierVisible = false,
}: {
  axis: PivotAxis;
  expanded: Set<string>;
  tree: PivotTreeData;
  collapsed: Set<string>;
  program: PivotProgram;
  isLeafTierVisible?: boolean;
}) => {
  const nodes = axis === 'row' ? tree.rows : tree.cols;
  const metricIndex = getValuesLevelIndex(program, axis);
  const { metricLabelSet } = createMetricNodePolicy(program);
  const resolved = expandMetricPatternExpansions({
    expanded,
    nodes,
    metricIndex,
    metricLabelSet,
  });
  const next = new Set(resolved);
  collapsed.forEach(key => next.delete(key));
  if (isLeafTierVisible) {
    Object.values(nodes).forEach(node => {
      const metricValue = node.path[node.path.length - 1];
      if (isMetricTokenForKeys(metricValue, metricLabelSet)) {
        next.add(node.key);
      }
    });
  }
  if (metricIndex === undefined) {
    return next;
  }
  next.forEach(key => {
    if (key === rootKey || nodes[key]) {
      return;
    }
    const path = parsePath(key);
    const keyMetricIndex = findMetricIndex(path, metricLabelSet);
    if (keyMetricIndex >= 0 && keyMetricIndex < metricIndex) {
      next.delete(key);
    }
  });
  return next;
};

export const resolveExpandedByAxisForTree = ({
  tree,
  axisCoverageNeeds,
  manualExpanded,
  manualCollapsed,
  program,
  isLeafTierVisible = false,
}: {
  tree: PivotTreeData;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  manualExpanded: AxisSetMap;
  manualCollapsed: AxisSetMap;
  program: PivotProgram;
  isLeafTierVisible?: boolean;
}) =>
  Object.fromEntries(
    PIVOT_AXES.map(axis => [
      axis,
      resolveExpandedForMetrics({
        axis,
        tree,
        collapsed: manualCollapsed[axis],
        program,
        isLeafTierVisible,
        expanded: buildDesiredExpandedKeys({
          axis,
          nodes: axis === 'row' ? tree.rows : tree.cols,
          baseExpanded: buildExpandedKeysForCoverageNeeds({
            axis,
            tree,
            axisCoverageNeeds,
            program,
          }),
          program,
          manualExpanded: manualExpanded[axis],
          manualCollapsed: manualCollapsed[axis],
        }),
      }),
    ]),
  ) as AxisSetMap;

type ExpansionReinitAxis = {
  axis: PivotAxis;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  keys: string[];
  collapsed: string[];
  nodes: Record<string, PivotTreeNode>;
  stablePrefix: number;
  reset: boolean;
  changed: boolean;
  includeMetricDepth: boolean;
  tree: PivotTreeData;
  program: PivotProgram;
  hasNewData: boolean;
};

const resolveExpansionCacheAxis = (config: ExpansionReinitAxis) => {
  const { metricLabelSet, countDimDepth } = createMetricNodePolicy(
    config.program,
  );
  const shouldPrune = config.reset || config.changed;
  const pruneExpanded = (expanded: Set<string>) =>
    pruneExpandedToStablePrefix({
      expanded,
      nodes: config.nodes,
      stablePrefix: config.stablePrefix,
      metricLabelSet,
      includeMetricDepth: config.includeMetricDepth,
    });
  const prunedManualKeys = shouldPrune
    ? Array.from(
        pruneExpanded(new Set<string>([rootKey, ...config.keys])),
      ).filter(key => key !== rootKey)
    : config.keys.filter(key => key !== rootKey);
  const prunedCollapsedKeys = config.collapsed.filter(key => {
    if (key === rootKey) {
      return false;
    }
    if (!shouldPrune) {
      return true;
    }
    const path = config.nodes[key]?.path ?? parsePath(key);
    const depth =
      countDimDepth(path) +
      (config.includeMetricDepth &&
      path.some(value => isMetricTokenForKeys(value, metricLabelSet))
        ? 1
        : 0);
    return depth <= config.stablePrefix;
  });
  const desiredExpanded = buildDesiredExpandedKeys({
    axis: config.axis,
    nodes: config.nodes,
    baseExpanded: buildExpandedKeysForCoverageNeeds({
      axis: config.axis,
      tree: config.tree,
      axisCoverageNeeds: config.axisCoverageNeeds,
      program: config.program,
    }),
    program: config.program,
    manualExpanded: new Set(prunedManualKeys),
    manualCollapsed: new Set(prunedCollapsedKeys),
  });
  const expandedKeys =
    config.reset || (config.changed && !config.hasNewData)
      ? pruneExpanded(desiredExpanded)
      : desiredExpanded;
  return {
    prunedManualKeys,
    prunedCollapsedKeys,
    expandedKeys,
  };
};

export const resolveExpansionReinitializationPlan = (params: {
  previousSemanticSignature: string | null;
  nextSemanticSignature: string;
  previousData: PivotTreeData | null;
  data: PivotTreeData;
  currentTree: PivotTreeData;
  previousLayout: PivotLayoutKeyState;
  currentLayout: PivotLayoutKeyState;
  sessionState: PivotExpansionStateKeys;
  axisCoverageNeeds: PivotAxisCoverageNeed[];
  program: PivotProgram;
  isLeafTierVisible?: boolean;
}) => {
  const hasNewData = params.previousData !== params.data;
  const tree = hasNewData ? params.data : params.currentTree;
  const layoutTransition = resolveLayoutTransition({
    previousLayout: params.previousLayout,
    currentLayout: params.currentLayout,
  });
  const layoutChanged = PIVOT_AXES.some(axis => layoutTransition[axis].changed);
  const isInitialMount = params.previousSemanticSignature === null;
  const semanticSignatureChanged =
    params.previousSemanticSignature !== params.nextSemanticSignature;
  if (
    !isInitialMount &&
    !semanticSignatureChanged &&
    !layoutChanged &&
    !hasNewData
  ) {
    return undefined;
  }
  const resetExpanded = Object.fromEntries(
    PIVOT_AXES.map(axis => [
      axis,
      semanticSignatureChanged ||
        (layoutTransition[axis].changed &&
          !layoutTransition[axis].shouldExpand),
    ]),
  ) as Record<PivotAxis, boolean>;
  const includeMetricDepth = (axis: PivotAxis) => {
    const metricIndex = getValuesLevelIndex(params.program, axis);
    const dimensionCount = getAxisDimensionCount(params.program, axis);
    return metricIndex !== undefined && metricIndex < dimensionCount;
  };
  const { sessionState } = params;
  const axisState = Object.fromEntries(
    PIVOT_AXES.map(axis => [
      axis,
      resolveExpansionCacheAxis({
        axis,
        keys:
          axis === 'row'
            ? (sessionState.rows ?? [])
            : (sessionState.cols ?? []),
        collapsed:
          axis === 'row'
            ? (sessionState.collapsedRows ?? [])
            : (sessionState.collapsedCols ?? []),
        nodes: axis === 'row' ? tree.rows : tree.cols,
        stablePrefix: layoutTransition[axis].stablePrefix,
        reset: resetExpanded[axis],
        changed: layoutTransition[axis].changed,
        axisCoverageNeeds: params.axisCoverageNeeds,
        tree,
        program: params.program,
        hasNewData,
        includeMetricDepth: includeMetricDepth(axis),
      }),
    ]),
  ) as Record<PivotAxis, ReturnType<typeof resolveExpansionCacheAxis>>;
  const persistedState = {
    rows: axisState.row.prunedManualKeys,
    cols: axisState.col.prunedManualKeys,
    collapsedRows: axisState.row.prunedCollapsedKeys,
    collapsedCols: axisState.col.prunedCollapsedKeys,
  };
  return {
    tree,
    persistedState,
    expanded: Object.fromEntries(
      PIVOT_AXES.map(axis => [
        axis,
        resolveExpandedForMetrics({
          axis,
          expanded: axisState[axis].expandedKeys,
          tree,
          collapsed: new Set(
            axis === 'row'
              ? persistedState.collapsedRows
              : persistedState.collapsedCols,
          ),
          program: params.program,
          isLeafTierVisible: params.isLeafTierVisible,
        }),
      ]),
    ) as AxisSetMap,
    shouldPersistReset:
      !isInitialMount && PIVOT_AXES.some(axis => resetExpanded[axis]),
  };
};
