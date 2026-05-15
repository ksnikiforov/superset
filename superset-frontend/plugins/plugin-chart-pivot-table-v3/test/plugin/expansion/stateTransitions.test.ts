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
  applyExpansionFetchDelta,
  buildHydrationStagedTree,
  buildHydrationPrefetchAction,
  buildVisiblePersistedExpansionState,
  finalizeHydrationTree,
  mergeSameAxisExpansionTree,
  planInitialHydrationPrefetch,
  planHydrationIteration,
  resolveCollapsedExpansionState,
  resolveExpandedForMetrics,
  resolveExpansionReinitializationDecision,
  resolveExpansionToggleDecision,
  runHydrationLoop,
  stageHydrationFetchDeltas,
  type HydrationDeltaMap,
  type ExpansionVisibilityConfig,
} from '../../../src/pivot/expansion/stateTransitions';
import { createFetchedFactCoverageLookup } from '../../../src/pivot/expansion/fetchedRequests';
import { findChildren, rootKey } from '../../../src/pivot/viewModel';
import {
  METRICS_PLACEHOLDER,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import {
  parsePath,
  serializeCellKey,
  serializePath,
} from '../../../src/pivot/core/path';
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
      isMetricTokenValue = () => false,
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
      isMetricTokenValue?: (value: unknown) => boolean;
      countDimDepth?: (path: PivotTreeNode['path']) => number;
    } = {}) =>
    ({ tree }: { tree: PivotTreeData }) => {
      const metricsFirstOnRows =
        metricsLayout === MetricsLayoutEnum.ROWS && metricIndexForRows === 0;
      const metricsFirstOnCols =
        metricsLayout === MetricsLayoutEnum.COLUMNS && metricIndexForCols === 0;
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
        resolvedMetricsLayout: metricsLayout,
        hasMultipleMeasures: metricLabelSet.size > 1,
        metricsFirstOnCols,
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
            metricsFirstOnRows,
            metricsFirstOnCols,
          }),
        isMetricSubtotalNode: (node?: PivotTreeNode) =>
          isMetricSubtotalNode(node, metricLabelSet),
        isMetricTokenValue,
      };
    };

  const config: ExpansionVisibilityConfig = {
    groupbyRowsLength: 2,
    groupbyColumnsLength: 2,
    metricLabelSet: new Set<string>(),
    isMetricTokenValue: () => false,
    countDimDepth: path => path.length,
    shouldFetchChildren: ({ node }) => node.hasChildren,
    buildRenderModelConfig: buildTestRenderModelConfig(),
  };

  const getCoverageKey = (_axis: 'row' | 'col', key: string) => key;
  const fetchedCoverageLookupFromBatches = (
    factBatches: PivotFactStoreBatch[] = [],
  ) =>
    createFetchedFactCoverageLookup({
      factBatches,
      getCoverageKey,
    });

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
      otherInFlight: false,
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
      otherInFlight: true,
      visibleRowDepth: 1,
      visibleColDepth: 0,
      manualExpanded: new Set(),
      manualCollapsed: new Set([node.key]),
    });

    expect(decision).toEqual({ kind: 'same-axis' });
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
      otherInFlight: false,
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

  it('applies expansion fetch deltas through the supplied pruning policy', () => {
    const aKey = serializePath(['A']);
    const childKey = serializePath(['A', 'A1']);
    const tree: PivotTreeData = {
      rows: {
        [aKey]: makeNode('row', ['A'], true),
      },
      cols: {},
      cells: {},
    };
    const branch: PivotTreeData = {
      rows: {
        [childKey]: makeNode('row', ['A', 'A1'], false),
      },
      cols: {},
      cells: {},
    };
    const pruneMergedTree = jest.fn(({ tree: nextTree }) => nextTree);

    const result = applyExpansionFetchDelta({
      tree,
      axis: 'row',
      keys: [aKey],
      branch,
      pruneMergedTree,
    });

    expect(result.rows[childKey]).toBe(branch.rows[childKey]);
    expect(pruneMergedTree).toHaveBeenCalledWith({
      axis: 'row',
      tree: result,
      parent: tree.rows[aKey],
      branch,
    });
  });

  it('merges same-axis expansion trees while removing stale touched descendants', () => {
    const aKey = serializePath(['A']);
    const staleKey = serializePath(['A', 'old']);
    const freshKey = serializePath(['A', 'new']);
    const bKey = serializePath(['B']);
    const previousTree: PivotTreeData = {
      rows: {
        [aKey]: makeNode('row', ['A'], true),
        [staleKey]: makeNode('row', ['A', 'old'], false),
        [bKey]: makeNode('row', ['B'], false),
      },
      cols: {},
      cells: {},
    };
    const currentTree: PivotTreeData = {
      rows: {
        [aKey]: makeNode('row', ['A'], true),
        [freshKey]: makeNode('row', ['A', 'new'], false),
      },
      cols: {},
      cells: {},
    };

    const result = mergeSameAxisExpansionTree({
      currentTree,
      previousTree,
      axis: 'row',
      touchedKeys: [aKey],
      isMetricTokenValue: () => false,
    });

    expect(new Set(Object.keys(result.rows))).toEqual(
      new Set([aKey, bKey, freshKey]),
    );
  });

  it('can preserve metric children when merging same-axis column expansions', () => {
    const aKey = serializePath(['A']);
    const staleKey = serializePath(['A', 'old']);
    const metricKey = serializePath(['A', METRICS_PLACEHOLDER]);
    const freshKey = serializePath(['A', 'new']);
    const previousTree: PivotTreeData = {
      rows: {},
      cols: {
        [aKey]: makeNode('col', ['A'], true),
        [staleKey]: makeNode('col', ['A', 'old'], false),
        [metricKey]: makeNode('col', ['A', METRICS_PLACEHOLDER], false),
      },
      cells: {},
    };
    const currentTree: PivotTreeData = {
      rows: {},
      cols: {
        [aKey]: makeNode('col', ['A'], true),
        [freshKey]: makeNode('col', ['A', 'new'], false),
      },
      cells: {},
    };

    const result = mergeSameAxisExpansionTree({
      currentTree,
      previousTree,
      axis: 'col',
      touchedKeys: [aKey],
      preserveMetricChildren: true,
      isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
    });

    expect(new Set(Object.keys(result.cols))).toEqual(
      new Set([aKey, freshKey, metricKey]),
    );
  });

  it('drops stale metric-pattern expansion keys after metric depth changes', () => {
    const staleMetricFirstKey = serializePath([METRICS_PLACEHOLDER, 'A']);
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', METRICS_PLACEHOLDER]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', METRICS_PLACEHOLDER], false),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, aKey, staleMetricFirstKey]),
      tree,
      collapsed: new Set(),
      metricIndex: 1,
      isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
    });

    expect(result).toEqual(new Set([rootKey, aKey]));
  });

  it('applies collapsed metric keys and stale metric-pattern cleanup together', () => {
    const staleMetricFirstKey = serializePath([METRICS_PLACEHOLDER, 'A']);
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', METRICS_PLACEHOLDER]);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', METRICS_PLACEHOLDER], false),
      },
      cols: {},
      cells: {},
    };

    const result = resolveExpandedForMetrics({
      axis: 'row',
      expanded: new Set([rootKey, aKey, aMetricKey, staleMetricFirstKey]),
      tree,
      collapsed: new Set([aMetricKey]),
      metricIndex: 1,
      isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
    });

    expect(result).toEqual(new Set([rootKey, aKey]));
  });

  it('stages hydration deltas by axis and path then builds deterministic staged trees', () => {
    const aKey = serializePath(['A']);
    const bKey = serializePath(['B']);
    const aChildKey = serializePath(['A', '1']);
    const bChildKey = serializePath(['B', '1']);
    const baseTree: PivotTreeData = {
      rows: {
        [aKey]: makeNode('row', ['A'], true),
        [bKey]: makeNode('row', ['B'], true),
      },
      cols: {},
      cells: {},
    };
    const aDelta: PivotTreeData = {
      rows: {
        [aChildKey]: makeNode('row', ['A', '1'], false),
      },
      cols: {},
      cells: {},
    };
    const bDelta: PivotTreeData = {
      rows: {
        [bChildKey]: makeNode('row', ['B', '1'], false),
      },
      cols: {},
      cells: {},
    };
    const deltas: HydrationDeltaMap = new Map();

    stageHydrationFetchDeltas({
      deltas,
      results: [
        { targets: [{ axis: 'row', pathKey: bKey }], data: bDelta },
        { targets: [{ axis: 'row', pathKey: aKey }], data: aDelta },
      ],
    });

    const stagedTree = buildHydrationStagedTree({ baseTree, deltas });
    expect(new Set(Object.keys(stagedTree.rows))).toEqual(
      new Set([aKey, bKey, aChildKey, bChildKey]),
    );
  });

  it('finalizes hydration trees through the supplied pruning policy', () => {
    const aKey = serializePath(['A']);
    const staleKey = serializePath(['A', 'old']);
    const freshKey = serializePath(['A', 'new']);
    const baseTree: PivotTreeData = {
      rows: {
        [aKey]: makeNode('row', ['A'], true),
        [staleKey]: makeNode('row', ['A', 'old'], false),
      },
      cols: {},
      cells: {},
    };
    const deltaTree: PivotTreeData = {
      rows: {
        [freshKey]: makeNode('row', ['A', 'new'], false),
      },
      cols: {},
      cells: {},
    };
    const deltas: HydrationDeltaMap = new Map();
    stageHydrationFetchDeltas({
      deltas,
      results: [{ targets: [{ axis: 'row', pathKey: aKey }], data: deltaTree }],
    });
    const pruneMergedTree = jest.fn(({ tree: nextTree }) => {
      const rows = { ...nextTree.rows };
      delete rows[staleKey];
      return { ...nextTree, rows };
    });

    const result = finalizeHydrationTree({
      baseTree,
      deltas,
      pruneMergedTree,
    });

    expect(new Set(Object.keys(result.rows))).toEqual(
      new Set([aKey, freshKey]),
    );
    expect(pruneMergedTree).toHaveBeenCalledWith({
      axis: 'row',
      tree: expect.objectContaining({
        rows: expect.objectContaining({
          [staleKey]: baseTree.rows[staleKey],
          [freshKey]: deltaTree.rows[freshKey],
        }),
      }),
      parent: baseTree.rows[aKey],
      branch: deltaTree,
    });
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
      maxIterations: 3,
      isCurrent: () => true,
      buildDesiredExpanded: axis =>
        axis === 'row' ? new Set([aKey]) : new Set([xKey]),
      getFetchedCoverageLookup: () =>
        fetchedCoverageLookupFromBatches(factBatches),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
      planCols: false,
      pruneMergedTree: ({ tree: nextTree }) => nextTree,
      fetchDeltas: jest.fn(),
    });

    expect(result).toEqual({
      status: 'complete',
      tree,
      desiredRows: new Set([aKey]),
      desiredCols: new Set([xKey]),
    });
  });

  it('runs hydration loops by fetching and staging missing deltas', async () => {
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
    const fetchDeltas = jest.fn(async ({ targets }) => {
      targets.forEach(target => {
        factBatches.push({
          coverage: {
            reason: 'expand',
            rowDepth: target.axis === 'row' ? target.childDepth : 1,
            columnDepth:
              target.axis === 'col'
                ? target.childDepth
                : target.requiredOppositeDepth,
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
      return [{ targets, data: branch }];
    });
    const result = await runHydrationLoop({
      baseTree: tree,
      maxIterations: 3,
      isCurrent: () => true,
      buildDesiredExpanded: axis =>
        axis === 'row' ? new Set([aKey]) : new Set([xKey]),
      getFetchedCoverageLookup: () =>
        fetchedCoverageLookupFromBatches(factBatches),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
      planCols: false,
      pruneMergedTree: ({ tree: nextTree }) => nextTree,
      fetchDeltas,
    });

    expect(fetchDeltas).toHaveBeenCalledTimes(1);
    expect(fetchDeltas.mock.calls[0][0].targets).toMatchObject([
      {
        axis: 'row',
        pathKey: aKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
    ]);
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') {
      return;
    }
    expect(result.tree.rows[childKey]).toEqual(branch.rows[childKey]);
  });

  it('stops hydration loops when the request becomes stale', async () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const fetchDeltas = jest.fn();
    const result = await runHydrationLoop({
      baseTree: tree,
      maxIterations: 3,
      isCurrent: () => false,
      buildDesiredExpanded: axis =>
        axis === 'row' ? new Set([aKey]) : new Set([xKey]),
      getFetchedCoverageLookup: () => fetchedCoverageLookupFromBatches(),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
      pruneMergedTree: ({ tree: nextTree }) => nextTree,
      fetchDeltas,
    });

    expect(result).toEqual({ status: 'stale' });
    expect(fetchDeltas).not.toHaveBeenCalled();
  });

  it('plans expansion reinitialization for first mount and signature changes', () => {
    expect(
      resolveExpansionReinitializationDecision({
        previousSignature: null,
        expandedStateSignature: 'layout-a',
        previousSharedSignature: null,
        expandedStateSharedSignature: 'shared-a',
        prevExpandRowsLevelRaw: undefined,
        prevExpandColsLevelRaw: undefined,
        expandRowsLevelRaw: undefined,
        expandColumnsLevelRaw: undefined,
        resolvedExpandRowsLevel: 1,
        resolvedExpandColumnsLevel: 2,
        hasNewData: false,
      }),
    ).toMatchObject({
      isInitialMount: true,
      shouldResetExpandedState: true,
      sharedSignatureChanged: true,
      shouldReinitialize: true,
      effectiveExpandRowsLevel: 1,
      effectiveExpandColsLevel: 2,
    });

    expect(
      resolveExpansionReinitializationDecision({
        previousSignature: 'layout-a',
        expandedStateSignature: 'layout-a',
        previousSharedSignature: 'shared-a',
        expandedStateSharedSignature: 'shared-b',
        prevExpandRowsLevelRaw: 1,
        prevExpandColsLevelRaw: 2,
        expandRowsLevelRaw: 1,
        expandColumnsLevelRaw: 2,
        resolvedExpandRowsLevel: 1,
        resolvedExpandColumnsLevel: 2,
        hasNewData: false,
      }),
    ).toMatchObject({
      isInitialMount: false,
      shouldResetExpandedState: false,
      sharedSignatureChanged: true,
      shouldReinitialize: true,
    });
  });

  it('treats cleared expand levels as zero during reinitialization', () => {
    const decision = resolveExpansionReinitializationDecision({
      previousSignature: 'layout-a',
      expandedStateSignature: 'layout-a',
      previousSharedSignature: 'shared-a',
      expandedStateSharedSignature: 'shared-a',
      prevExpandRowsLevelRaw: 3,
      prevExpandColsLevelRaw: 2,
      expandRowsLevelRaw: undefined,
      expandColumnsLevelRaw: undefined,
      resolvedExpandRowsLevel: 3,
      resolvedExpandColumnsLevel: 2,
      hasNewData: false,
    });

    expect(decision).toMatchObject({
      expandRowsLevelChanged: true,
      expandColsLevelChanged: true,
      effectiveExpandRowsLevel: 0,
      effectiveExpandColsLevel: 0,
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
        prevExpandRowsLevelRaw: 1,
        prevExpandColsLevelRaw: undefined,
        expandRowsLevelRaw: 1,
        expandColumnsLevelRaw: undefined,
        resolvedExpandRowsLevel: 1,
        resolvedExpandColumnsLevel: 0,
        hasNewData: false,
      }).shouldReinitialize,
    ).toBe(false);

    expect(
      resolveExpansionReinitializationDecision({
        previousSignature: 'layout-a',
        expandedStateSignature: 'layout-a',
        previousSharedSignature: 'shared-a',
        expandedStateSharedSignature: 'shared-a',
        prevExpandRowsLevelRaw: 1,
        prevExpandColsLevelRaw: undefined,
        expandRowsLevelRaw: 1,
        expandColumnsLevelRaw: undefined,
        resolvedExpandRowsLevel: 1,
        resolvedExpandColumnsLevel: 0,
        hasNewData: true,
      }).shouldReinitialize,
    ).toBe(true);
  });

  it('persists only visible explicit expansion state', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const hiddenRowKey = serializePath(['hidden']);
    const hiddenColKey = serializePath(['hidden-col']);

    const result = buildVisiblePersistedExpansionState({
      tree,
      expandedRows: new Set([rootKey, aKey]),
      expandedCols: new Set([rootKey, xKey]),
      config,
      explicitExpandedRows: new Set([rootKey, aKey, hiddenRowKey]),
      explicitExpandedCols: new Set([rootKey, xKey, hiddenColKey]),
      explicitCollapsedRows: new Set([aKey, hiddenRowKey]),
      explicitCollapsedCols: new Set([xKey, hiddenColKey]),
      resolvedExpandRowsLevel: 1,
      resolvedExpandColumnsLevel: 0,
      groupbyRowKeys: ['country'],
      groupbyColumnKeys: ['month'],
    });

    expect(result.persistedState).toEqual({
      rowKeys: ['country'],
      colKeys: ['month'],
      rows: [aKey],
      cols: [xKey],
      collapsedRows: [aKey],
      collapsedCols: [],
    });
    expect(result.visibleExpandedRows).toEqual(new Set([aKey]));
    expect(result.visibleExpandedCols).toEqual(new Set([xKey]));
    expect(result.visibleCollapsedRows).toEqual(new Set([aKey]));
    expect(result.visibleCollapsedCols).toEqual(new Set());
  });

  it('plans fetch targets for expanded nodes', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverageLookup: fetchedCoverageLookupFromBatches(),
      config,
      getCoverageKey,
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
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
      {
        axis: 'col',
        pathKey: xKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
    ]);
  });

  it('prioritizes the active axis when possible', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverageLookup: fetchedCoverageLookupFromBatches(),
      config,
      getCoverageKey,
      activeAxis: 'col',
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(Array.from(plan.rowPlan.fetchKeys)).toEqual([]);
    expect(Array.from(plan.colPlan.fetchKeys)).toEqual([xKey]);
    expect(plan.targets).toEqual([
      {
        axis: 'col',
        pathKey: xKey,
        childDepth: 2,
        requiredOppositeDepth: 1,
      },
    ]);
  });

  it('forces a root fetch when expanded axes have no intersection cells', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: false });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverageLookup: fetchedCoverageLookupFromBatches(),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.kind).toBe('fetch');
    expect(plan.rowPlan.fetchKeys.has(rootKey)).toBe(true);
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'row', pathKey: rootKey }),
        expect.objectContaining({ axis: 'row', pathKey: aKey }),
        expect.objectContaining({ axis: 'col', pathKey: xKey }),
      ]),
    );
  });

  it('can skip planning for one axis', () => {
    const { tree, aKey, xKey } = buildTree({ includeIntersectionCell: true });
    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverageLookup: fetchedCoverageLookupFromBatches(),
      config,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
      planRows: false,
      planCols: true,
    });

    expect(plan.kind).toBe('fetch');
    expect(plan.rowPlan.fetchKeys.size).toBe(0);
    expect(plan.colPlan.fetchKeys.size).toBe(1);
    if (plan.kind !== 'fetch') {
      throw new Error('Expected a fetch plan');
    }
    expect(plan.targets.map(target => target.axis)).toEqual(['col']);
  });

  it('fetches expanded row branches when only stale metric variants exist', () => {
    const aKey = serializePath(['A']);
    const aMetricKey = serializePath(['A', METRICS_PLACEHOLDER]);
    const xKey = serializePath(['X']);
    const tree: PivotTreeData = {
      rows: {
        [rootKey]: makeNode('row', [], true),
        [aKey]: makeNode('row', ['A'], true),
        [aMetricKey]: makeNode('row', ['A', METRICS_PLACEHOLDER], false),
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
      isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
      countDimDepth: path =>
        path.filter(value => value !== METRICS_PLACEHOLDER).length,
      buildRenderModelConfig: buildTestRenderModelConfig({
        metricsLayout: MetricsLayoutEnum.ROWS,
        metricIndexForRows: 1,
        isMetricTokenValue: value => value === METRICS_PLACEHOLDER,
        countDimDepth: path =>
          path.filter(value => value !== METRICS_PLACEHOLDER).length,
      }),
    };

    const plan = planHydrationIteration({
      tree,
      desiredRows: new Set([rootKey, aKey]),
      desiredCols: new Set([rootKey, xKey]),
      fetchedCoverageLookup: fetchedCoverageLookupFromBatches(),
      config: metricConfig,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.rowPlan.fetchKeys.has(aKey)).toBe(true);
    expect(plan.kind).toBe('fetch');
  });

  it('fetches expanded row branches when only subtotal+metric descendants exist at same base depth', () => {
    const metricToken = '__metric__m1';
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
      groupbyRowsLength: 3,
      isMetricTokenValue: value => value === metricToken,
      countDimDepth: path =>
        path.filter(value => value !== metricToken && value !== SUBTOTAL_TOKEN)
          .length,
      buildRenderModelConfig: buildTestRenderModelConfig({
        groupbyRowsLength: 3,
        metricsLayout: MetricsLayoutEnum.ROWS,
        metricIndexForRows: 2,
        isMetricTokenValue: value => value === metricToken,
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
      fetchedCoverageLookup: fetchedCoverageLookupFromBatches(),
      config: metricConfig,
      getCoverageKey,
      pendingRows: new Set(),
      pendingCols: new Set(),
    });

    expect(plan.rowPlan.fetchKeys.has(aKey)).toBe(true);
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
        autoExpandRowsLevelForDesired: 0,
        autoExpandColsLevelForDesired: 0,
        tree: rootOnlyTree,
        rowPlan: {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchKeys: new Set(),
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
        autoExpandRowsLevelForDesired: 0,
        autoExpandColsLevelForDesired: 0,
        tree: rootOnlyTree,
        rowPlan: {
          fetchKeys: new Set([rootKey]),
          pendingKeys: new Set([rootKey]),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchKeys: new Set(),
          pendingKeys: new Set(),
          hasMissingNodes: false,
        },
      }),
    ).toEqual({ kind: 'skip-root' });

    const { tree, aKey } = buildTree({ includeIntersectionCell: true });
    const childKey = serializePath(['A', 'B']);
    expect(
      buildHydrationPrefetchAction({
        resolvedRows: new Set([rootKey, aKey]),
        resolvedCols: new Set([rootKey]),
        persistedState: { ...emptyState, rows: [aKey] },
        autoExpandRowsLevelForDesired: 0,
        autoExpandColsLevelForDesired: 0,
        tree,
        rowPlan: {
          fetchKeys: new Set([aKey, childKey]),
          pendingKeys: new Set([aKey, childKey]),
          hasMissingNodes: false,
        },
        colPlan: {
          fetchKeys: new Set(),
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
      effectiveExpandRowsLevel: 0,
      effectiveExpandColsLevel: 0,
      autoExpandRowsLevelForDesired: 0,
      autoExpandColsLevelForDesired: 0,
      fetchedCoverageLookup: fetchedCoverageLookupFromBatches(),
      config,
      getCoverageKey,
    });

    expect(prefetch.shouldPlanRows).toBe(true);
    expect(prefetch.shouldPlanCols).toBe(false);
    expect(prefetch.rowPlan.fetchKeys.has(aKey)).toBe(true);
    expect(prefetch.colPlan.fetchKeys.size).toBe(0);
    expect(prefetch.action).toEqual({
      kind: 'hydrate',
      showLoader: false,
    });
  });
});
