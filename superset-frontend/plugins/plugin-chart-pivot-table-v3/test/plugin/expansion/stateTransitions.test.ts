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
  buildHydrationPrefetchAction,
  buildVisiblePersistedExpansionState,
  planInitialHydrationPrefetch,
  planHydrationIteration,
  resolveCollapsedExpansionState,
  resolveExpandedForMetrics,
  resolveExpansionReinitializationDecision,
  resolveExpansionToggleDecision,
  runHydrationLoop,
  type ExpansionPlanningConfig,
  type ExpansionVisibilityConfig,
} from '../../../src/pivot/expansion/stateTransitions';
import { createExpansionCoverageDiff } from '../../../src/pivot/runtime/coverage';
import { findChildren, rootKey } from '../../../src/pivot/viewModel';
import {
  encodeMetricKey,
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import {
  parsePath,
  serializeCellKey,
  serializePath,
} from '../../../src/pivot/core/path';
import { mergeTrees } from '../../../src/pivot/core/tree';
import {
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
} from '../../../src/pivot/metricsTotals';
import {
  MetricsLayoutEnum,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../src/types';
import { type PivotFactStoreBatch } from '../../../src/pivot/runtime/factStore';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';
import type { PivotAxisCoverageNeed } from '../../../src/pivot/runtime/coverage';

describe('pivot/expansion/stateTransitions', () => {
  const depthSorter = () => 0;
  const buildTestRenderModelConfig =
    ({
      groupbyRowsLength = 2,
      groupbyColumnsLength = 2,
      rowTotals = false,
      colTotals = false,
      metricsLayout = MetricsLayoutEnum.COLUMNS,
      metricLabelSet = new Set<string>(),
      metricIndexForRows,
      metricIndexForCols,
      countDimDepth = (path: PivotTreeNode['path']) => path.length,
    }: {
      groupbyRowsLength?: number;
      groupbyColumnsLength?: number;
      rowTotals?: boolean;
      colTotals?: boolean;
      metricsLayout?: MetricsLayoutEnum;
      metricLabelSet?: Set<string>;
      metricIndexForRows?: number;
      metricIndexForCols?: number;
      countDimDepth?: (path: PivotTreeNode['path']) => number;
    } = {}) =>
    ({ tree }: { tree: PivotTreeData }) => {
      const metricKeys = Array.from(metricLabelSet);
      const rowDims = Array.from(
        { length: groupbyRowsLength },
        (_, idx) => `r${idx}`,
      );
      const colDims = Array.from(
        { length: groupbyColumnsLength },
        (_, idx) => `c${idx}`,
      );
      const withPlaceholder = (dims: string[], index?: number) => [
        ...dims.slice(0, index ?? dims.length),
        METRICS_PLACEHOLDER,
        ...dims.slice(index ?? dims.length),
      ];
      const program = compilePivotProgram({
        groupbyRows:
          metricsLayout === MetricsLayoutEnum.ROWS && metricKeys.length > 0
            ? withPlaceholder(rowDims, metricIndexForRows)
            : rowDims,
        groupbyColumns:
          metricsLayout === MetricsLayoutEnum.COLUMNS && metricKeys.length > 0
            ? withPlaceholder(colDims, metricIndexForCols)
            : colDims,
        metrics: metricKeys,
        metricsLayout,
      });
      return {
        groupbyRowsLength,
        groupbyColumnsLength,
        normalizedRowSubtotalLevels: [],
        normalizedColSubtotalLevels: [],
        rowTotals,
        colTotals,
        rowTotalPosition: 'start' as const,
        colTotalPosition: 'start' as const,
        resolvedColSubtotalPosition: 'start' as const,
        pivotProgram: program,
        hasMultipleMeasures: metricLabelSet.size > 1,
        rowSorter: depthSorter,
        colSorter: depthSorter,
        getRowChildren: (parent: PivotTreeNode) =>
          findChildren(tree.rows, parent),
        getCollapsedRowChildren: () => [] as PivotTreeNode[],
        getColChildren: (parent: PivotTreeNode) =>
          findChildren(tree.cols, parent),
        getCollapsedColLeaves: () => [] as PivotTreeNode[],
        countDimDepth,
        isMetricGrandTotalNode: (node?: PivotTreeNode) =>
          isMetricGrandTotalNode(node, {
            metricLabelSet,
            program,
          }),
        isMetricSubtotalNode: (node?: PivotTreeNode) =>
          isMetricSubtotalNode(node, metricLabelSet),
      };
    };

  const testProgram = compilePivotProgram({
    groupbyRows: ['country', 'city'],
    groupbyColumns: ['month', 'day'],
    metrics: ['sales'],
  });
  const config: ExpansionVisibilityConfig & ExpansionPlanningConfig = {
    program: testProgram,
    buildRenderModelConfig: buildTestRenderModelConfig(),
  };
  const expansionCoverageLoadedFromBatches = (
    factBatches: PivotFactStoreBatch[] = [],
  ) =>
    createExpansionCoverageDiff({
      factBatches,
      program: testProgram,
      valueKeys: ['sales'],
    });
  const fetchPathKeys = (plan: { fetchRequests: Array<{ pathKey: string }> }) =>
    plan.fetchRequests.map(request => request.pathKey);
  const noAxisCoverageNeeds: PivotAxisCoverageNeed[] = [];
  const rowRootLevelNeed: PivotAxisCoverageNeed = {
    axis: 'row',
    depth: 1,
    scope: { kind: 'scopedFull', ancestorPaths: [[]] },
  };

  const makeNode = (
    axis: 'row' | 'col',
    path: string[],
    hasChildren: boolean,
  ): PivotTreeNode => {
    const key = serializePath(path);
    return {
      axis,
      key,
      path,
      label: path.length === 0 ? 'Total' : String(path[path.length - 1]),
      formattedLabel:
        path.length === 0 ? 'Total' : String(path[path.length - 1]),
      level: path.length,
      hasChildren,
    };
  };

  const buildTree = ({
    includeIntersectionCell,
  }: {
    includeIntersectionCell: boolean;
  }): { tree: PivotTreeData; aKey: string; xKey: string } => {
    const aKey = serializePath(['A']);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
        [xKey]: makeNode('col', ['X'], true),
      },
      cells: includeIntersectionCell
        ? {
            [serializeCellKey(aKey, xKey)]: {
              rowKey: aKey,
              colKey: xKey,
              values: {},
            },
          }
        : {},
    };
    return { tree, aKey, xKey };
  };

  it('resolves open expansion toggles as collapse decisions', () => {
    const node = makeNode('row', ['A'], true);
    const decision = resolveExpansionToggleDecision({
      axis: 'row',
      node,
      expanded: new Set([node.key]),
      pending: new Set(),
      otherPending: new Set(),
      visibleRowDepth: 1,
      visibleColDepth: 0,
      manualExpanded: new Set(),
      manualCollapsed: new Set(),
    });

    expect(decision).toEqual({ kind: 'collapse' });
  });

  it('resolves ordinary expansion toggles as same-axis decisions', () => {
    const node = makeNode('row', ['A'], true);
    const decision = resolveExpansionToggleDecision({
      axis: 'row',
      node,
      expanded: new Set(),
      pending: new Set(),
      otherPending: new Set(['other']),
      visibleRowDepth: 1,
      visibleColDepth: 0,
      manualExpanded: new Set(),
      manualCollapsed: new Set([node.key]),
    });

    expect(decision).toEqual({
      kind: 'same-axis',
      nextPending: new Set([node.key]),
      nextManualExpanded: new Set([node.key]),
      nextManualCollapsed: new Set(),
    });
  });

  it('resolves cross-axis expansion toggles with pending and manual state', () => {
    const parentKey = serializePath(['A']);
    const node = makeNode('row', ['A', 'B'], true);
    const pending = new Set<string>();
    const manualExpanded = new Set(['manual']);
    const manualCollapsed = new Set([node.key, 'other']);
    const decision = resolveExpansionToggleDecision({
      axis: 'row',
      node,
      expanded: new Set([parentKey]),
      pending,
      otherPending: new Set(['col-pending']),
      visibleRowDepth: 1,
      visibleColDepth: 1,
      manualExpanded,
      manualCollapsed,
    });

    expect(decision.kind).toBe('cross-axis-hydration');
    if (decision.kind !== 'cross-axis-hydration') {
      return;
    }
    expect([...decision.nextPending].sort()).toEqual(
      [parentKey, node.key].sort(),
    );
    expect([...decision.nextManualExpanded].sort()).toEqual(
      ['manual', parentKey, node.key].sort(),
    );
    expect([...decision.nextManualCollapsed]).toEqual(['other']);
    expect([...pending]).toEqual([]);
    expect([...manualExpanded]).toEqual(['manual']);
    expect([...manualCollapsed].sort()).toEqual([node.key, 'other'].sort());
  });

  it('resolves collapsed expansion state by pruning descendants', () => {
    const parent = makeNode('row', ['A'], true);
    const child = makeNode('row', ['A', 'B'], true);
    const grandchild = makeNode('row', ['A', 'B', 'C'], false);
    const sibling = makeNode('row', ['D'], false);
    const result = resolveCollapsedExpansionState({
      node: child,
      expanded: new Set([parent.key, child.key, grandchild.key, sibling.key]),
      pending: new Set([child.key, grandchild.key, sibling.key]),
      manualExpanded: new Set([child.key, grandchild.key, sibling.key]),
      manualCollapsed: new Set([grandchild.key, sibling.key]),
      nodes: {
        [parent.key]: parent,
        [child.key]: child,
        [grandchild.key]: grandchild,
        [sibling.key]: sibling,
      },
    });

    expect([...result.nextExpanded].sort()).toEqual(
      [parent.key, sibling.key].sort(),
    );
    expect([...result.nextPending]).toEqual([sibling.key]);
    expect([...result.nextManualExpanded]).toEqual([sibling.key]);
    expect([...result.nextManualCollapsed].sort()).toEqual(
      [child.key, sibling.key].sort(),
    );
  });

  it('drops stale metric-pattern expansion keys after metric depth changes', () => {
    const metricToken = encodeMetricKey('m1');
    const staleMetricFirstKey = serializePath([metricToken, 'A']);
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', metricToken]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', metricToken], false),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, aKey, staleMetricFirstKey]),
      tree,
      collapsed: new Set(),
      program: compilePivotProgram({
        groupbyRows: ['r0', METRICS_PLACEHOLDER],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
    });

    expect(result).toEqual(new Set([rootKey, aKey]));
  });

  it('applies collapsed metric keys and stale metric-pattern cleanup together', () => {
    const metricToken = encodeMetricKey('m1');
    const staleMetricFirstKey = serializePath([metricToken, 'A']);
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', metricToken]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', metricToken], false),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, aKey, aMetricKey, staleMetricFirstKey]),
      tree,
      collapsed: new Set([aMetricKey]),
      program: compilePivotProgram({
        groupbyRows: ['r0', METRICS_PLACEHOLDER],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
    });

    expect(result).toEqual(new Set([rootKey, aKey]));
  });

  it('runs hydration loops to completion without fetching when coverage is satisfied', async () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const factBatches: PivotFactStoreBatch[] = [
      {
        coverage: {
          reason: 'expand',
          rowDepth: 2,
          columnDepth: 1,
          rowDimensions: ['country', 'city'],
          columnDimensions: ['month'],
        },
        scope: {
          kind: 'branch',
          axis: 'row',
          path: ['A'],
        },
        valueKeys: ['sales'],
        facts: [],
      },
    ];
    const result = await runHydrationLoop({
      baseTree: tree,
      maxIterations: 4,
      isCurrent: () => true,
      buildDesiredExpanded: axis =>
        axis === 'row' ? new Set([aKey]) : new Set([xKey]),
      getMissingExpansionCoverage: () =>
        expansionCoverageLoadedFromBatches(factBatches),
      config,
      pendingRows: new Set(),
      pendingCols: new Set(),
      planCols: false,
      fetchTree: jest.fn(),
    });

    expect(result).toEqual({
      status: 'complete',
      tree,
      desiredRows: new Set([aKey]),
      desiredCols: new Set([xKey]),
    });
  });

  it('runs hydration loops by fetching the next tree for missing coverage', async () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const childKey = serializePath(['A', 'B']);
    const branch: PivotTreeData = {
      rows: {
        [childKey]: makeNode('row', ['A', 'B'], false),
      },
      cols: {},
      cells: {},
    };
    const factBatches: PivotFactStoreBatch[] = [];
    const fetchTree = jest.fn(
      async ({ targets, context, tree: currentTree }) => {
        targets.forEach(target => {
          const targetDepth = parsePath(target.pathKey).length + 1;
          factBatches.push({
            coverage: {
              reason: 'expand',
              rowDepth:
                target.axis === 'row' ? targetDepth : context.visibleRowDepth,
              columnDepth:
                target.axis === 'col' ? targetDepth : context.visibleColDepth,
              rowDimensions: ['country', 'city'],
              columnDimensions: ['month'],
            },
            scope: {
              kind: 'branch',
              axis: target.axis,
              path: parsePath(target.pathKey),
            },
            valueKeys: ['sales'],
            facts: [],
          });
        });
        return mergeTrees(currentTree, branch);
      },
    );
    const result = await runHydrationLoop({
      baseTree: tree,
      maxIterations: 3,
      isCurrent: () => true,
      buildDesiredExpanded: axis =>
        axis === 'row' ? new Set([aKey]) : new Set([xKey]),
      getMissingExpansionCoverage: () =>
        expansionCoverageLoadedFromBatches(factBatches),
      config,
      pendingRows: new Set(),
      pendingCols: new Set(),
      planCols: false,
      fetchTree,
    });

    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(fetchTree.mock.calls[0][0].targets).toMatchObject([
      {
        axis: 'row',
        pathKey: aKey,
      },
    ]);
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') {
      return;
    }
    expect(result.tree.rows[childKey]).toEqual(branch.rows[childKey]);
  });

  it('runs hydration loops through nested persisted row targets', async () => {
    const aKey = serializePath(['A']);
    const axKey = serializePath(['A', 'X']);
    const axpKey = serializePath(['A', 'X', 'P']);
    const baseTree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
      },
      cols: {
        [rootKey]: makeNode('col', [], false),
      },
      cells: {},
    };
    const branchA: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [axKey]: makeNode('row', ['A', 'X'], true),
      },
      cols: {},
      cells: {},
    };
    const branchAX: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [axKey]: makeNode('row', ['A', 'X'], true),
        [axpKey]: makeNode('row', ['A', 'X', 'P'], false),
      },
      cols: {},
      cells: {},
    };
    const factBatches: PivotFactStoreBatch[] = [];
    const nestedProgram = compilePivotProgram({
      groupbyRows: ['country', 'city', 'store'],
      groupbyColumns: [],
      metrics: ['sales'],
    });
    const fetchTree = jest.fn(
      async ({ targets, context, tree: currentTree }) => {
        const data = targets.some(target => target.pathKey === axKey)
          ? branchAX
          : branchA;
        targets.forEach(target => {
          const path = parsePath(target.pathKey);
          const targetDepth = path.length + 1;
          factBatches.push({
            coverage: {
              reason: 'expand',
              rowDepth:
                target.axis === 'row' ? targetDepth : context.visibleRowDepth,
              columnDepth: context.visibleColDepth,
              rowDimensions: ['country', 'city', 'store'].slice(
                0,
                target.axis === 'row' ? targetDepth : context.visibleRowDepth,
              ),
              columnDimensions: [],
            },
            scope: {
              kind: 'branch',
              axis: 'row',
              path,
            },
            valueKeys: ['sales'],
            facts: [],
          });
        });
        return mergeTrees(currentTree, data);
      },
    );
    const result = await runHydrationLoop({
      baseTree,
      maxIterations: 4,
      isCurrent: () => true,
      buildDesiredExpanded: axis =>
        axis === 'row' ? new Set([aKey, axKey]) : new Set(),
      getMissingExpansionCoverage: () =>
        createExpansionCoverageDiff({
          factBatches,
          program: nestedProgram,
          valueKeys: ['sales'],
        }),
      config: {
        ...config,
        groupbyRowsLength: 3,
        groupbyColumnsLength: 0,
        program: nestedProgram,
        buildRenderModelConfig: buildTestRenderModelConfig({
          groupbyRowsLength: 3,
          groupbyColumnsLength: 0,
        }),
      },
      pendingRows: new Set(),
      pendingCols: new Set(),
      planCols: false,
      fetchTree,
    });

    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') {
      return;
    }
    expect(result.tree.rows[axKey]).toEqual(branchAX.rows[axKey]);
    expect(result.tree.rows[axpKey]).toEqual(branchAX.rows[axpKey]);
  });

  it('stops hydration loops when the request becomes stale', async () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const fetchTree = jest.fn();
    const result = await runHydrationLoop({
      baseTree: tree,
      maxIterations: 3,
      isCurrent: () => false,
      buildDesiredExpanded: axis =>
        axis === 'row' ? new Set([aKey]) : new Set([xKey]),
      getMissingExpansionCoverage: () => expansionCoverageLoadedFromBatches(),
      config,
      pendingRows: new Set(),
      pendingCols: new Set(),
      fetchTree,
    });

    expect(result).toEqual({ status: 'stale' });
    expect(fetchTree).not.toHaveBeenCalled();
  });

  it('plans expansion reinitialization for first mount and signature changes', () => {
    expect(
      resolveExpansionReinitializationDecision({
        previousSignature: null,
        expandedStateSignature: 'layout-a',
        previousSharedSignature: null,
        expandedStateSharedSignature: 'shared-a',
        hasNewData: false,
      }),
    ).toMatchObject({
      isInitialMount: true,
      shouldResetExpandedState: true,
      sharedSignatureChanged: true,
      shouldReinitialize: true,
    });

    expect(
      resolveExpansionReinitializationDecision({
        previousSignature: 'layout-a',
        expandedStateSignature: 'layout-a',
        previousSharedSignature: 'shared-a',
        expandedStateSharedSignature: 'shared-b',
        hasNewData: false,
      }),
    ).toMatchObject({
      isInitialMount: false,
      shouldResetExpandedState: false,
      sharedSignatureChanged: true,
      shouldReinitialize: true,
    });
  });

  it('skips expansion reinitialization when signatures, data, and levels are stable', () => {
    expect(
      resolveExpansionReinitializationDecision({
        previousSignature: 'layout-a',
        expandedStateSignature: 'layout-a',
        previousSharedSignature: 'shared-a',
        expandedStateSharedSignature: 'shared-a',
        hasNewData: false,
      }).shouldReinitialize,
    ).toBe(false);

    expect(
      resolveExpansionReinitializationDecision({
        previousSignature: 'layout-a',
        expandedStateSignature: 'layout-a',
        previousSharedSignature: 'shared-a',
        expandedStateSharedSignature: 'shared-a',
        hasNewData: true,
      }).shouldReinitialize,
    ).toBe(true);
  });

  it('persists only visible explicit expansion state', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const hiddenRowKey = serializePath(['hidden']);
    const hiddenColKey = serializePath(['hidden-col']);
    const bKey = serializePath(['B']);
    const yKey = serializePath(['Y']);
    tree.rows[bKey] = makeNode('row', ['B'], true);
    tree.cols[yKey] = makeNode('col', ['Y'], true);

    const result = buildVisiblePersistedExpansionState({
      tree,
      expandedRows: new Set([rootKey, aKey]),
      expandedCols: new Set([rootKey, xKey]),
      explicitExpandedRows: new Set([rootKey, aKey, hiddenRowKey]),
      explicitExpandedCols: new Set([rootKey, xKey, hiddenColKey]),
      explicitCollapsedRows: new Set([bKey, hiddenRowKey]),
      explicitCollapsedCols: new Set([yKey, hiddenColKey]),
      groupbyRowKeys: ['country'],
      groupbyColumnKeys: ['month'],
    });

    expect(result.persistedState).toEqual({
      rowKeys: ['country'],
      colKeys: ['month'],
      rows: [aKey],
      cols: [xKey],
      collapsedRows: [bKey],
      collapsedCols: [yKey],
    });
    expect(result.visibleExpandedRows).toEqual(new Set([aKey]));
    expect(result.visibleExpandedCols).toEqual(new Set([xKey]));
    expect(result.visibleCollapsedRows).toEqual(new Set([bKey]));
    expect(result.visibleCollapsedCols).toEqual(new Set([yKey]));
  });

  it('plans fetch targets for expanded nodes', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const loadedRootCoverage: PivotFactStoreBatch = {
      coverage: {
        reason: 'expand',
        rowDepth: 1,
        columnDepth: 1,
        rowDimensions: ['country'],
        columnDimensions: ['month'],
      },
      scope: {
        kind: 'branch',
        axis: 'row',
        path: [],
      },
      valueKeys: ['sales'],
      facts: [],
    };
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches([
        loadedRootCoverage,
      ]),
      config,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.targets).toEqual([
      {
        axis: 'row',
        pathKey: aKey,
      },
      {
        axis: 'col',
        pathKey: xKey,
      },
    ]);
  });

  it('prioritizes the active axis when possible', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config,
      activeAxis: 'col',
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(fetchPathKeys(plan.rowPlan)).toEqual([]);
    expect(fetchPathKeys(plan.colPlan)).toEqual([xKey]);
    expect(plan.targets).toEqual([
      {
        axis: 'col',
        pathKey: xKey,
      },
    ]);
  });

  it('suppresses redundant singleton intersection fetches', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: false });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(fetchPathKeys(plan.rowPlan)).not.toContain(rootKey);
    expect(plan.targets).toEqual([
      expect.objectContaining({ axis: 'row', pathKey: aKey }),
      expect.objectContaining({ axis: 'col', pathKey: xKey }),
    ]);
  });

  it('does not plan intersection fetches before both axis nodes are loaded', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: false });
    delete tree.rows[aKey];

    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.rowPlan.hasMissingNodes).toBe(true);
    expect(plan.targets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'intersection' }),
      ]),
    );
  });

  it('can skip planning for one axis', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config,
      pendingRows: new Set(),
      pendingCols: new Set(),
      planRows: false,
      planCols: true,
    });

    expect(plan.kind).toBe('fetch');
    expect(plan.rowPlan.fetchRequests).toHaveLength(0);
    expect(plan.colPlan.fetchRequests).toHaveLength(1);
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.targets.map(target => target.axis)).toEqual(['col']);
  });

  it('fetches expanded row branches when only stale metric variants exist', () => {
    const metricToken = encodeMetricKey('m1');
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', metricToken]);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', metricToken], false),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
        [xKey]: makeNode('col', ['X'], false),
      },
      cells: {
        [serializeCellKey(aKey, xKey)]: {
          rowKey: aKey,
          colKey: xKey,
          values: {},
        },
      },
    };
    const metricConfig: ExpansionVisibilityConfig = {
      ...config,
      program: compilePivotProgram({
        groupbyRows: ['country', 'city'],
        groupbyColumns: ['month', 'day', METRICS_PLACEHOLDER],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.COLUMNS,
      }),
      buildRenderModelConfig: buildTestRenderModelConfig({
        metricsLayout: MetricsLayoutEnum.ROWS,
        metricLabelSet: new Set(['m1']),
        metricIndexForRows: 1,
        countDimDepth: path =>
          path.filter(value => value !== metricToken).length,
      }),
    };

    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config: metricConfig,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(fetchPathKeys(plan.rowPlan)).toContain(aKey);
    expect(plan.kind).toBe('fetch');
  });

  it('fetches expanded row branches when only subtotal+metric descendants exist at same base depth', () => {
    const metricToken = encodeMetricKey('m1');
    const aKey = serializePath(['A']);
    const subtotalKey = serializePath(['A', SUBTOTAL_TOKEN]);
    const subtotalMetricKey = serializePath(['A', SUBTOTAL_TOKEN, metricToken]);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [subtotalKey]: makeNode('row', ['A', SUBTOTAL_TOKEN], true),
        [subtotalMetricKey]: makeNode(
          'row',
          ['A', SUBTOTAL_TOKEN, metricToken],
          false,
        ),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
        [xKey]: makeNode('col', ['X'], false),
      },
      cells: {
        [serializeCellKey(subtotalMetricKey, xKey)]: {
          rowKey: subtotalMetricKey,
          colKey: xKey,
          values: {},
        },
      },
    };
    const metricConfig: ExpansionVisibilityConfig = {
      ...config,
      program: compilePivotProgram({
        groupbyRows: ['country', 'city', METRICS_PLACEHOLDER],
        groupbyColumns: ['month', 'day'],
        metrics: ['m1'],
        metricsLayout: MetricsLayoutEnum.ROWS,
      }),
      buildRenderModelConfig: buildTestRenderModelConfig({
        groupbyRowsLength: 3,
        metricsLayout: MetricsLayoutEnum.ROWS,
        metricLabelSet: new Set(['m1']),
        metricIndexForRows: 2,
        countDimDepth: path =>
          path.filter(
            value => value !== metricToken && value !== SUBTOTAL_TOKEN,
          ).length,
      }),
    };

    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config: metricConfig,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(fetchPathKeys(plan.rowPlan)).toContain(aKey);
    expect(plan.kind).toBe('fetch');
  });

  it('builds hydration prefetch actions from pending plans', () => {
    const emptyState = {
      rowKeys: ['country'],
      colKeys: ['month'],
      rows: [],
      cols: [],
      collapsedRows: [],
      collapsedCols: [],
    };
    const rootOnlyTree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
      },
      cols: {
        [rootKey]: makeNode('col', [], true),
      },
      cells: {},
    };

    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: emptyState,
        axisCoverageNeeds: noAxisCoverageNeeds,
        tree: rootOnlyTree,
        rowPlan: {
          fetchRequests: [],
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchRequests: [],
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'idle' });

    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: emptyState,
        axisCoverageNeeds: noAxisCoverageNeeds,
        tree: rootOnlyTree,
        rowPlan: {
          fetchRequests: [
            {
              axis: 'row',
              pathKey: rootKey,
              rowDepth: 1,
              columnDepth: 0,
            },
          ],
          pendingKeys: new Set([rootKey]),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchRequests: [],
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'idle' });

    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: emptyState,
        axisCoverageNeeds: [rowRootLevelNeed],
        tree: rootOnlyTree,
        rowPlan: {
          fetchRequests: [
            {
              axis: 'row',
              pathKey: rootKey,
              rowDepth: 1,
              columnDepth: 0,
            },
          ],
          pendingKeys: new Set([rootKey]),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchRequests: [],
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'hydrate', showLoader: false });

    const { tree, aKey } = buildTree({ includeIntersectionCell: true });
    const childKey = serializePath(['A', 'B']);
    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey, aKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: { ...emptyState, rows: [aKey] },
        axisCoverageNeeds: noAxisCoverageNeeds,
        tree,
        rowPlan: {
          fetchRequests: [
            {
              axis: 'row',
              pathKey: aKey,
              rowDepth: 1,
              columnDepth: 0,
            },
            {
              axis: 'row',
              pathKey: childKey,
              rowDepth: 1,
              columnDepth: 0,
            },
          ],
          pendingKeys: new Set([aKey, childKey]),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchRequests: [],
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'hydrate', showLoader: true });
  });

  it('plans initial hydration prefetch using persisted expansion state', () => {
    const { tree, aKey } = buildTree({ includeIntersectionCell: true });
    const prefetch = planInitialHydrationPrefetch({
      tree,
      resolvedRows: new Set([rootKey, aKey]),
      resolvedCols: new Set([rootKey]),
      persistedState: {
        rowKeys: ['country'],
        colKeys: ['month'],
        rows: [aKey],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
      axisCoverageNeeds: noAxisCoverageNeeds,
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config,
    });

    expect(prefetch.shouldPlanRows).toBe(true);
    expect(prefetch.shouldPlanCols).toBe(false);
    expect(fetchPathKeys(prefetch.rowPlan)).toContain(aKey);
    expect(prefetch.colPlan.fetchRequests).toHaveLength(0);
    expect(prefetch.action).toEqual({
      kind: 'hydrate',
      showLoader: false,
    });
  });

  it('plans initial hydration prefetch for scoped full coverage need', () => {
    const { tree } = buildTree({ includeIntersectionCell: true });
    const prefetch = planInitialHydrationPrefetch({
      tree,
      resolvedRows: new Set([rootKey]),
      resolvedCols: new Set([rootKey]),
      persistedState: {
        rowKeys: ['country'],
        colKeys: ['month'],
        rows: [],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      },
      axisCoverageNeeds: [rowRootLevelNeed],
      getMissingExpansionCoverage: expansionCoverageLoadedFromBatches(),
      config,
    });

    expect(prefetch.shouldPlanRows).toBe(true);
    expect(prefetch.shouldPlanCols).toBe(false);
    expect(fetchPathKeys(prefetch.rowPlan)).toContain(rootKey);
  });
});
