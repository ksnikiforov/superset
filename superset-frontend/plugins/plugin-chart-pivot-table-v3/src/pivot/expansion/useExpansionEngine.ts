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
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { nanoid } from 'nanoid';
import {
  type HandlerFunction,
  type JsonObject,
  type SetDataMaskHook,
} from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { parsePath, mergeTrees } from '../../utils';
import {
  buildDesiredExpandedKeys,
  type PivotExpansionStateKeys,
} from '../engine/expansionStateModel';
import {
  fetchPivotBranch,
  resolvePivotBranchLocalResult,
} from '../../fetchPivotBranch';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { buildBatchSignature } from '../query/batchSignature';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
  type FetchTarget,
} from '../query/fetchPlanOptimizer';
import { stableStringify } from '../shared/stableStringify';
import { fetchPivotBranchesBatch } from '../query/fetchPivotBranchesBatch';
import { rootKey } from '../viewModel';
import { planGroupedExpansionTargets } from './planner';
import { createExpansionStateStore, type ExpansionStateStore } from './store';
import {
  buildAxisCoverageKeyFromPathKey,
  getNextAxisLevelForPath,
} from '../runtime/paths';
import { isSubtotalToken } from '../core/tokens';
import type { PivotProgram } from '../runtime/types';
import {
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import {
  createLatestRequestLifecycle,
  type LatestRequestScope,
} from '../runtime/requestLifecycle';
import {
  addAncestors,
  computeVisibleDepths as computeVisibleDepthsBase,
  dropDescendants,
  getVisibleExpansionKeys as getVisibleExpansionKeysBase,
  hasNestedPendingKeys,
  planHydrationIteration,
  pruneTreeByPrefixes,
  resolveReinitializedExpansionState,
  resolveExpandedForMetrics as resolveExpandedForMetricsBase,
  type ExpansionVisibilityConfig,
} from './engine';
import {
  createFetchedFactCoverageState,
  pruneFetchedCoverageForCollapsedNode,
  seedFetchedCoverageFromFactBatches as seedFetchedCoverageStateFromFactBatches,
} from './fetchedRequests';
import { resolveLayoutTransition } from './layoutTransition';
import {
  createExpansionRuntimeState,
  expansionRuntimeReducer,
} from './runtimeState';

const MAX_HYDRATION_ITERATIONS = 12;
const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

type ExpansionFetchResult = {
  targets: FetchTarget[];
  data?: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
};

type TrackExpansionRequest = <T>(
  requestScope: LatestRequestScope,
  requestGroupId: string,
  fetcher: () => Promise<T>,
) => Promise<T>;

type BuildExpansionRequestGroupId = (
  payload: Record<string, unknown>,
  transactionId?: number,
) => string;

type ExpansionFetchRuntime = {
  requestScope: LatestRequestScope;
  fetchFormData: PivotTableQueryFormData;
  factStore?: PivotFactStore;
  trackRequestInScope: TrackExpansionRequest;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  updateLoadingKey: (key: string, delta: number) => void;
};

type ExpansionFetchContext = {
  visibleRowDepth: number;
  visibleColDepth: number;
};

const resolveExpansionFetchPlan = ({
  targets,
  formData,
  visibleRowDepth,
  visibleColDepth,
  factStore,
}: {
  targets: FetchTarget[];
  formData: PivotTableQueryFormData;
  visibleRowDepth: number;
  visibleColDepth: number;
  factStore?: PivotFactStore;
}): {
  localResults: ExpansionFetchResult[];
  singles: FetchTarget[];
  batches: BatchGroup[];
} => {
  const localResults: ExpansionFetchResult[] = [];
  const batchCandidates: BatchCandidate[] = [];
  for (const target of targets) {
    const path = parsePath(target.pathKey);
    const localResult = resolvePivotBranchLocalResult({
      axis: target.axis,
      path,
      formData,
      visibleRowDepth,
      visibleColDepth,
      factStore,
    });
    if (localResult) {
      localResults.push({
        targets: [target],
        data: localResult.data,
        factBatches: localResult.factBatches ?? EMPTY_FACT_BATCHES,
      });
      continue;
    }
    const batchSignature = buildBatchSignature({
      formData,
      axis: target.axis,
      path,
      visibleRowDepth,
      visibleColDepth,
    });
    batchCandidates.push({ ...target, batchSignature });
  }
  const { batches, singles } = optimizeFetchPlan({
    targets: batchCandidates,
  });
  return { localResults, singles, batches };
};

const fetchExpansionSingleTarget = async ({
  target,
  context,
  requestGroupId,
  runtime,
}: {
  target: FetchTarget;
  context: ExpansionFetchContext;
  requestGroupId: string;
  runtime: ExpansionFetchRuntime;
}): Promise<ExpansionFetchResult> => {
  const path = parsePath(target.pathKey);
  const {
    addWarnings,
    factStore,
    fetchFormData,
    requestScope,
    trackRequestInScope,
    updateLoadingKey,
  } = runtime;
  if (requestScope.isCurrent()) {
    updateLoadingKey(target.pathKey, 1);
  }
  try {
    const result = await trackRequestInScope(requestScope, requestGroupId, () =>
      fetchPivotBranch({
        axis: target.axis,
        path,
        formData: fetchFormData,
        visibleRowDepth: context.visibleRowDepth,
        visibleColDepth: context.visibleColDepth,
        requestGroupId,
        factStore,
      }),
    );
    if (!result) {
      return {
        targets: [target],
        data: undefined,
        factBatches: EMPTY_FACT_BATCHES,
      };
    }
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
      if (result.error) {
        throw result.error;
      }
    }
    return {
      targets: [target],
      data: result.data,
      factBatches: result.factBatches ?? EMPTY_FACT_BATCHES,
    };
  } finally {
    if (requestScope.isCurrent()) {
      updateLoadingKey(target.pathKey, -1);
    }
  }
};

const fetchExpansionBatchTarget = async ({
  batch,
  context,
  requestGroupId,
  runtime,
}: {
  batch: BatchGroup;
  context: ExpansionFetchContext;
  requestGroupId: string;
  runtime: ExpansionFetchRuntime;
}): Promise<ExpansionFetchResult> => {
  const {
    addWarnings,
    factStore,
    fetchFormData,
    requestScope,
    trackRequestInScope,
    updateLoadingKey,
  } = runtime;
  if (requestScope.isCurrent()) {
    batch.targets.forEach(target => updateLoadingKey(target.pathKey, 1));
  }
  try {
    const result = await trackRequestInScope(requestScope, requestGroupId, () =>
      fetchPivotBranchesBatch({
        formData: fetchFormData,
        batch,
        visibleRowDepth: context.visibleRowDepth,
        visibleColDepth: context.visibleColDepth,
        requestGroupId,
        factStore,
      }),
    );
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
      if (result.error) {
        throw result.error;
      }
    }
    return {
      targets: batch.targets,
      data: result.data,
      factBatches: result.factBatches ?? EMPTY_FACT_BATCHES,
    };
  } finally {
    if (requestScope.isCurrent()) {
      batch.targets.forEach(target => updateLoadingKey(target.pathKey, -1));
    }
  }
};

const fetchExpansionTargets = async ({
  targets,
  context,
  runtime,
  singleRequestKind,
  batchRequestKind = singleRequestKind,
  transactionId,
  buildRequestGroupId,
}: {
  targets: FetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
  singleRequestKind: string;
  batchRequestKind?: string;
  transactionId: number;
  buildRequestGroupId: BuildExpansionRequestGroupId;
}): Promise<ExpansionFetchResult[]> => {
  const { localResults, batches, singles } = resolveExpansionFetchPlan({
    targets,
    formData: runtime.fetchFormData,
    visibleRowDepth: context.visibleRowDepth,
    visibleColDepth: context.visibleColDepth,
    factStore: runtime.factStore,
  });
  const { visibleRowDepth, visibleColDepth } = context;
  const buildSingleRequestGroupId = (target: FetchTarget) =>
    buildRequestGroupId(
      {
        kind: singleRequestKind,
        ...target,
        visibleRowDepth,
        visibleColDepth,
      },
      transactionId,
    );
  const buildBatchRequestGroupId = (batch: BatchGroup) =>
    buildRequestGroupId(
      {
        kind: batchRequestKind,
        axis: batch.axis,
        parentPathKey: batch.parentPathKey,
        childDepth: batch.childDepth,
        requiredOppositeDepth: batch.requiredOppositeDepth,
        signature: batch.signature,
        targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
        visibleRowDepth,
        visibleColDepth,
      },
      transactionId,
    );
  const fetchPromises: Array<Promise<ExpansionFetchResult>> = [
    ...singles.map(target =>
      fetchExpansionSingleTarget({
        target,
        context,
        requestGroupId: buildSingleRequestGroupId(target),
        runtime,
      }),
    ),
    ...batches.map(batch =>
      fetchExpansionBatchTarget({
        batch,
        context,
        requestGroupId: buildBatchRequestGroupId(batch),
        runtime,
      }),
    ),
  ];
  const fetchedResults = await Promise.all(fetchPromises);
  return [...localResults, ...fetchedResults];
};

type FetchResultDelta = {
  targets: FetchTarget[];
  data: PivotTreeData;
};

const collectFetchResultDeltas = ({
  results,
  seedFetchedCoverage,
}: {
  results: ExpansionFetchResult[];
  seedFetchedCoverage: (factBatches: PivotFactStoreBatch[]) => void;
}) => {
  const deltas: FetchResultDelta[] = [];
  results.forEach(result => {
    seedFetchedCoverage(result.factBatches);
    if (!result.data) {
      return;
    }
    deltas.push({
      targets: result.targets,
      data: result.data,
    });
  });
  return deltas;
};

export type ExpansionEngineResult = {
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  loadingKeys: Set<string>;
  pendingRows: Set<string>;
  pendingCols: Set<string>;
  isHydrating: boolean;
  errorMessage?: string;
  warnings: ChartDataWarning[];
  handleToggle: (axis: PivotAxis, node: PivotTreeNode) => void;
  handleRetry: () => void;
};

export type ExpansionEngineConfig = {
  data: PivotTreeData;
  factBatches?: PivotFactStoreBatch[];
  expandedStateSignature: string;
  expandedStateSharedSignature: string;
  fetchFormData: PivotTableQueryFormData;
  groupbyRowKeys: string[];
  groupbyColumnKeys: string[];
  groupbyRowsLength: number;
  groupbyColumnsLength: number;
  resolvedExpandRowsLevel: number;
  resolvedExpandColumnsLevel: number;
  shouldExpandMetricRows: boolean;
  shouldExpandMetricCols: boolean;
  metricLabelSet: Set<string>;
  metricIndexForRows?: number;
  metricIndexForCols?: number;
  isMetricTokenValue: (value: unknown) => boolean;
  pivotProgram: PivotProgram;
  countDimDepth: (path: PivotTreeNode['path']) => number;
  expandRowsLevelRaw?: number;
  expandColumnsLevelRaw?: number;
  setControlValue?: HandlerFunction;
  setDataMask?: SetDataMaskHook;
  mergeOwnState?: (partial: JsonObject) => JsonObject;
  persistedExpansionState?: unknown;
  shouldPersistExpansionState: boolean;
  pruneMergedTree: (params: {
    axis: PivotAxis;
    tree: PivotTreeData;
    parent?: PivotTreeNode;
    branch?: PivotTreeData;
  }) => PivotTreeData;
};

export const useExpansionEngine = ({
  data,
  factBatches = EMPTY_FACT_BATCHES,
  expandedStateSignature,
  expandedStateSharedSignature,
  fetchFormData,
  groupbyRowKeys,
  groupbyColumnKeys,
  groupbyRowsLength,
  groupbyColumnsLength,
  resolvedExpandRowsLevel,
  resolvedExpandColumnsLevel,
  shouldExpandMetricRows,
  shouldExpandMetricCols,
  metricLabelSet,
  metricIndexForRows,
  metricIndexForCols,
  isMetricTokenValue,
  pivotProgram,
  countDimDepth,
  expandRowsLevelRaw,
  expandColumnsLevelRaw,
  setControlValue,
  setDataMask,
  mergeOwnState,
  persistedExpansionState,
  shouldPersistExpansionState,
  pruneMergedTree,
}: ExpansionEngineConfig): ExpansionEngineResult => {
  const [tree, setTree] = useState<PivotTreeData>(data);
  const treeRef = useRef(tree);
  const factStoreRef = useRef<PivotFactStore>();
  if (!factStoreRef.current) {
    const store = createPivotFactStore();
    store.upsertBatches(factBatches);
    factStoreRef.current = store;
  }
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const expandedRowsRef = useRef(expandedRows);
  const expandedColsRef = useRef(expandedCols);
  const [runtimeState, dispatchRuntimeState] = useReducer(
    expansionRuntimeReducer,
    undefined,
    createExpansionRuntimeState,
  );
  const { loadingCounts, pendingCols, pendingRows, isHydrating } = runtimeState;
  const loadingKeys = useMemo(
    () => new Set(loadingCounts.keys()),
    [loadingCounts],
  );
  const pendingRowsRef = useRef(pendingRows);
  const pendingColsRef = useRef(pendingCols);
  const explicitExpandedRowsRef = useRef<Set<string>>(new Set());
  const explicitExpandedColsRef = useRef<Set<string>>(new Set());
  const explicitCollapsedRowsRef = useRef<Set<string>>(new Set());
  const explicitCollapsedColsRef = useRef<Set<string>>(new Set());
  const inFlightRowsRef = useRef(0);
  const inFlightColsRef = useRef(0);
  const inFlightExpandedRowsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpandedColsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpansionIdRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [warnings, setWarnings] = useState<ChartDataWarning[]>([]);
  const warningsRef = useRef<Map<string, ChartDataWarning>>(new Map());
  const prevAutoExpandRowsRef = useRef<number | null>(null);
  const prevAutoExpandColsRef = useRef<number | null>(null);
  const prevExpandRowsLevelRawRef = useRef<number | undefined>(undefined);
  const prevExpandColsLevelRawRef = useRef<number | undefined>(undefined);
  const autoExpandRowsLevelRef = useRef<number>(resolvedExpandRowsLevel);
  const autoExpandColsLevelRef = useRef<number>(resolvedExpandColumnsLevel);
  const expandedStateSignatureRef = useRef<string | null>(null);
  const expandedStateSharedSignatureRef = useRef<string | null>(null);
  const fetchedCoverageRef = useRef(createFetchedFactCoverageState());
  const requestGroupPrefixRef = useRef(nanoid());
  const expansionRequestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );
  const expansionStateStoreRef = useRef<ExpansionStateStore>();
  const persistedExpansionStateRef = useRef<unknown>(persistedExpansionState);
  const dataEpochRef = useRef(0);
  const previousDataRef = useRef<PivotTreeData | null>(null);
  const previousLayoutRef = useRef({
    rows: groupbyRowKeys,
    cols: groupbyColumnKeys,
  });

  if (!expansionStateStoreRef.current) {
    expansionStateStoreRef.current = createExpansionStateStore({
      shouldPersist: shouldPersistExpansionState,
      setControlValue,
      setDataMask,
      mergeOwnState,
    });
  }

  useEffect(() => {
    expansionStateStoreRef.current?.updateDeps({
      shouldPersist: shouldPersistExpansionState,
      setControlValue,
      setDataMask,
      mergeOwnState,
    });
  }, [
    mergeOwnState,
    setControlValue,
    setDataMask,
    shouldPersistExpansionState,
  ]);

  useEffect(() => {
    persistedExpansionStateRef.current = persistedExpansionState;
  }, [persistedExpansionState]);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    expandedRowsRef.current = expandedRows;
  }, [expandedRows]);

  useEffect(() => {
    expandedColsRef.current = expandedCols;
  }, [expandedCols]);

  useEffect(() => {
    pendingRowsRef.current = pendingRows;
  }, [pendingRows]);

  useEffect(() => {
    pendingColsRef.current = pendingCols;
  }, [pendingCols]);

  const updateLoadingKey = useCallback((key: string, delta: number) => {
    dispatchRuntimeState({ type: 'updateLoadingKey', key, delta });
  }, []);

  const clearLoadingState = useCallback(() => {
    dispatchRuntimeState({ type: 'clearLoading' });
  }, []);

  const setHydratingState = useCallback((value: boolean) => {
    dispatchRuntimeState({ type: 'setHydrating', value });
  }, []);

  const getCoverageKey = useCallback(
    (axis: PivotAxis, key: string) =>
      buildAxisCoverageKeyFromPathKey({
        program: pivotProgram,
        axis,
        key,
      }),
    [pivotProgram],
  );

  const seedFetchedCoverageFromFactBatches = useCallback(
    (batches: PivotFactStoreBatch[]) => {
      seedFetchedCoverageStateFromFactBatches({
        fetchedCoverage: fetchedCoverageRef.current,
        getCoverageKey,
        batches,
      });
    },
    [getCoverageKey],
  );

  const collectInFlightExpanded = useCallback((axis: PivotAxis) => {
    const merged = new Set<string>();
    (axis === 'row'
      ? inFlightExpandedRowsRef.current
      : inFlightExpandedColsRef.current
    ).forEach(keys => keys.forEach(key => merged.add(key)));
    return merged;
  }, []);

  const setExpandedState = useCallback((axis: PivotAxis, next: Set<string>) => {
    (axis === 'row' ? expandedRowsRef : expandedColsRef).current = next;
    (axis === 'row' ? setExpandedRows : setExpandedCols)(next);
  }, []);

  const setPendingState = useCallback((axis: PivotAxis, next: Set<string>) => {
    (axis === 'row' ? pendingRowsRef : pendingColsRef).current = next;
    dispatchRuntimeState({ type: 'setPending', axis, keys: next });
  }, []);

  const reportAsyncError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expansionRequestLifecycle.invalidate();
      clearLoadingState();
      setHydratingState(false);
      setErrorMessage(message);
    },
    [clearLoadingState, expansionRequestLifecycle, setHydratingState],
  );

  const addWarnings = useCallback(
    (nextWarnings?: ChartDataWarning[]) => {
      if (!nextWarnings || nextWarnings.length === 0) {
        return;
      }
      const map = new Map(warningsRef.current);
      let didChange = false;
      nextWarnings.forEach(warning => {
        const key = stableStringify(warning);
        if (map.has(key)) {
          return;
        }
        map.set(key, warning);
        didChange = true;
      });
      if (!didChange) {
        return;
      }
      warningsRef.current = map;
      setWarnings(Array.from(map.values()));
    },
    [setWarnings],
  );

  const invalidateInFlightRequests = useCallback(() => {
    expansionRequestLifecycle.invalidate();
  }, [expansionRequestLifecycle]);

  const buildRequestGroupId = useCallback(
    (
      payload: Record<string, unknown>,
      transactionId: number = expansionRequestLifecycle.currentId(),
    ) =>
      stableStringify({
        instanceId: requestGroupPrefixRef.current,
        transactionId,
        ...payload,
      }),
    [expansionRequestLifecycle],
  );

  const trackRequestInScope = useCallback(
    async <T>(
      requestScope: LatestRequestScope,
      requestGroupId: string,
      fetcher: () => Promise<T>,
    ): Promise<T> => {
      const token = requestScope.beginRequest(requestGroupId);
      try {
        return await fetcher();
      } finally {
        expansionRequestLifecycle.finish(token);
      }
    },
    [expansionRequestLifecycle],
  );

  useEffect(
    () => () => {
      invalidateInFlightRequests();
    },
    [invalidateInFlightRequests],
  );

  const shouldFetchChildren = useCallback(
    ({
      axis,
      node,
    }: {
      axis: PivotAxis;
      key: string;
      node: PivotTreeNode;
      requiredDepth: number;
    }) =>
      getNextAxisLevelForPath({
        program: pivotProgram,
        axis,
        path: node.path.filter(value => !isSubtotalToken(value)),
      })?.kind === 'dimension',
    [pivotProgram],
  );

  const visibilityConfig = useMemo<ExpansionVisibilityConfig>(
    () => ({
      groupbyRowsLength,
      groupbyColumnsLength,
      rowTotals: fetchFormData.rowTotals ?? false,
      colTotals: fetchFormData.colTotals ?? false,
      metricsLayout: fetchFormData.metricsLayout,
      metricLabelSet,
      hasMultipleMeasures:
        metricLabelSet.size > 1 ||
        Object.values(fetchFormData.measureLeavesByMetric ?? {}).some(
          leaves => leaves.length > 1,
        ),
      metricIndexForRows,
      metricIndexForCols,
      isMetricTokenValue,
      countDimDepth,
      shouldFetchChildren,
    }),
    [
      countDimDepth,
      fetchFormData.colTotals,
      fetchFormData.metricsLayout,
      fetchFormData.measureLeavesByMetric,
      fetchFormData.rowTotals,
      groupbyColumnsLength,
      groupbyRowsLength,
      isMetricTokenValue,
      metricIndexForCols,
      metricIndexForRows,
      metricLabelSet,
      shouldFetchChildren,
    ],
  );

  const persistExpansionStateToStore = useCallback(
    (nextState: PivotExpansionStateKeys, options?: { persist?: boolean }) => {
      expansionStateStoreRef.current?.write(nextState, options);
    },
    [],
  );

  const persistExpansionState = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>) => {
      const visibleKeys = getVisibleExpansionKeysBase({
        tree: treeRef.current,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: visibilityConfig,
      });
      const filterVisible = (
        keys: Set<string>,
        visible: Set<string>,
      ): string[] =>
        Array.from(keys).filter(key => key !== rootKey && visible.has(key));
      const visibleRows = filterVisible(
        explicitExpandedRowsRef.current,
        visibleKeys.rows,
      );
      const visibleCols = filterVisible(
        explicitExpandedColsRef.current,
        visibleKeys.cols,
      );
      const visibleCollapsedRows = filterVisible(
        resolvedExpandRowsLevel > 0
          ? explicitCollapsedRowsRef.current
          : new Set<string>(),
        visibleKeys.rows,
      );
      const visibleCollapsedCols = filterVisible(
        resolvedExpandColumnsLevel > 0
          ? explicitCollapsedColsRef.current
          : new Set<string>(),
        visibleKeys.cols,
      );
      explicitExpandedRowsRef.current = new Set(visibleRows);
      explicitExpandedColsRef.current = new Set(visibleCols);
      explicitCollapsedRowsRef.current = new Set(visibleCollapsedRows);
      explicitCollapsedColsRef.current = new Set(visibleCollapsedCols);
      persistExpansionStateToStore({
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: visibleRows,
        cols: visibleCols,
        collapsedRows: visibleCollapsedRows,
        collapsedCols: visibleCollapsedCols,
      });
    },
    [
      groupbyColumnKeys,
      groupbyRowKeys,
      persistExpansionStateToStore,
      resolvedExpandColumnsLevel,
      resolvedExpandRowsLevel,
      visibilityConfig,
    ],
  );

  const resolveExpandedForMetrics = useCallback(
    (axis: PivotAxis, nextExpanded: Set<string>, nextTree: PivotTreeData) =>
      resolveExpandedForMetricsBase({
        axis,
        expanded: nextExpanded,
        tree: nextTree,
        collapsed:
          axis === 'row'
            ? explicitCollapsedRowsRef.current
            : explicitCollapsedColsRef.current,
        fallbackMetricIndex:
          axis === 'row' ? metricIndexForRows : metricIndexForCols,
        isMetricTokenValue,
      }),
    [isMetricTokenValue, metricIndexForCols, metricIndexForRows],
  );

  const buildDesiredExpanded = useCallback(
    (axis: PivotAxis, nextTree: PivotTreeData) =>
      buildDesiredExpandedKeys({
        axis,
        tree: nextTree,
        autoExpandLevel:
          axis === 'row'
            ? autoExpandRowsLevelRef.current
            : autoExpandColsLevelRef.current,
        metricLabelSet,
        includeMetricDepthZero:
          axis === 'row' ? shouldExpandMetricRows : shouldExpandMetricCols,
        manualExpanded:
          axis === 'row'
            ? explicitExpandedRowsRef.current
            : explicitExpandedColsRef.current,
        manualCollapsed:
          axis === 'row'
            ? explicitCollapsedRowsRef.current
            : explicitCollapsedColsRef.current,
        pendingKeys:
          axis === 'row' ? pendingRowsRef.current : pendingColsRef.current,
        inFlightKeys: collectInFlightExpanded(axis),
      }),
    [
      collectInFlightExpanded,
      metricLabelSet,
      shouldExpandMetricCols,
      shouldExpandMetricRows,
    ],
  );

  const computeVisibleDepths = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>, nextTree: PivotTreeData) =>
      computeVisibleDepthsBase({
        tree: nextTree,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: visibilityConfig,
      }),
    [visibilityConfig],
  );

  const applyFetchDelta = useCallback(
    (
      currentTree: PivotTreeData,
      axis: PivotAxis,
      keys: string[],
      branch?: PivotTreeData,
    ) => {
      if (!branch) {
        return currentTree;
      }
      let nextTree = mergeTrees(currentTree, branch);
      keys.forEach(key => {
        const parent = axis === 'row' ? nextTree.rows[key] : nextTree.cols[key];
        nextTree = pruneMergedTree({
          axis,
          tree: nextTree,
          parent,
          branch,
        });
      });
      return nextTree;
    },
    [pruneMergedTree],
  );

  const expandSameAxis = useCallback(
    async (axis: PivotAxis, node: PivotTreeNode) => {
      const inFlightRef = axis === 'row' ? inFlightRowsRef : inFlightColsRef;
      inFlightRef.current += 1;
      const requestScope = expansionRequestLifecycle.currentScope();
      const requestId = requestScope.id;
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const manualExpandedRef =
        axis === 'row' ? explicitExpandedRowsRef : explicitExpandedColsRef;
      const manualCollapsedRef =
        axis === 'row' ? explicitCollapsedRowsRef : explicitCollapsedColsRef;

      const nextManualExpanded = new Set(manualExpandedRef.current);
      addAncestors(node.path, nextManualExpanded, expanded);
      manualExpandedRef.current = nextManualExpanded;
      const nextManualCollapsed = new Set(manualCollapsedRef.current);
      nextManualCollapsed.delete(node.key);
      manualCollapsedRef.current = nextManualCollapsed;

      const baseExpanded = new Set(expanded);
      addAncestors(node.path, baseExpanded, expanded);

      const requestEpoch = dataEpochRef.current;
      let currentTree = treeRef.current;
      let resolvedExpanded = resolveExpandedForMetrics(
        axis,
        baseExpanded,
        currentTree,
      );
      const inFlightId = inFlightExpansionIdRef.current + 1;
      inFlightExpansionIdRef.current = inFlightId;
      const inFlightMap =
        axis === 'row'
          ? inFlightExpandedRowsRef.current
          : inFlightExpandedColsRef.current;
      const inFlightKeys = new Set(resolvedExpanded);
      expanded.forEach(key => inFlightKeys.delete(key));
      if (inFlightKeys.size > 0) {
        inFlightMap.set(inFlightId, inFlightKeys);
      }

      const fetchRuntime: ExpansionFetchRuntime = {
        requestScope,
        fetchFormData,
        factStore: factStoreRef.current,
        trackRequestInScope,
        addWarnings,
        updateLoadingKey,
      };

      const touchedKeys = new Set<string>();
      try {
        for (
          let iteration = 0;
          iteration < MAX_HYDRATION_ITERATIONS;
          iteration += 1
        ) {
          if (
            dataEpochRef.current !== requestEpoch ||
            !requestScope.isCurrent()
          ) {
            return;
          }
          const expandedRowsForDepth =
            axis === 'row' ? resolvedExpanded : expandedRowsRef.current;
          const expandedColsForDepth =
            axis === 'col' ? resolvedExpanded : expandedColsRef.current;
          const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
            expandedRowsForDepth,
            expandedColsForDepth,
            currentTree,
          );
          const requiredDepth =
            axis === 'row' ? visibleColDepth : visibleRowDepth;
          const nodes = axis === 'row' ? currentTree.rows : currentTree.cols;
          const { plan, targets } = planGroupedExpansionTargets({
            axis,
            expandedKeys: resolvedExpanded,
            nodes,
            requiredOppositeDepth: requiredDepth,
            fetchedCoverage: fetchedCoverageRef.current,
            getCoverageKey,
            shouldFetchChildren,
          });
          if (plan.fetchKeys.size === 0) {
            break;
          }
          // eslint-disable-next-line no-await-in-loop
          const results = await fetchExpansionTargets({
            targets,
            context: { visibleRowDepth, visibleColDepth },
            runtime: fetchRuntime,
            singleRequestKind: 'branch',
            batchRequestKind: 'batch',
            transactionId: requestId,
            buildRequestGroupId,
          });
          if (
            dataEpochRef.current !== requestEpoch ||
            !requestScope.isCurrent()
          ) {
            return;
          }
          const resultDeltas = collectFetchResultDeltas({
            results,
            seedFetchedCoverage: seedFetchedCoverageFromFactBatches,
          });
          for (const {
            targets: deltaTargets,
            data: deltaTree,
          } of resultDeltas) {
            for (const target of deltaTargets) {
              touchedKeys.add(target.pathKey);
            }
            currentTree = applyFetchDelta(
              currentTree,
              axis,
              deltaTargets.map(target => target.pathKey),
              deltaTree,
            );
          }
          if (resultDeltas.length === 0) {
            break;
          }
          const nextResolvedExpanded = resolveExpandedForMetrics(
            axis,
            baseExpanded,
            currentTree,
          );
          resolvedExpanded = nextResolvedExpanded;
        }

        if (!requestScope.isCurrent()) {
          return;
        }
        const committedExpanded =
          axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
        const combinedExpanded = new Set(committedExpanded);
        manualExpandedRef.current.forEach(key => combinedExpanded.add(key));
        const touchedPrefixes = Array.from(touchedKeys).map(key =>
          parsePath(key),
        );
        const preserveMetricChildren =
          axis === 'col' &&
          metricIndexForCols !== undefined &&
          metricIndexForCols >= groupbyColumnsLength;
        const preservedTree =
          touchedPrefixes.length > 0
            ? pruneTreeByPrefixes(treeRef.current, axis, touchedPrefixes, {
                preserveMetricChildren,
                isMetricTokenValue,
              })
            : treeRef.current;
        const mergedTree = mergeTrees(currentTree, preservedTree);
        const finalExpanded = resolveExpandedForMetrics(
          axis,
          combinedExpanded,
          mergedTree,
        );
        treeRef.current = mergedTree;
        setTree(mergedTree);
        setExpandedState(axis, finalExpanded);
        persistExpansionState(
          axis === 'row' ? finalExpanded : expandedRowsRef.current,
          axis === 'col' ? finalExpanded : expandedColsRef.current,
        );
      } finally {
        inFlightMap.delete(inFlightId);
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      }
    },
    [
      addWarnings,
      applyFetchDelta,
      buildRequestGroupId,
      computeVisibleDepths,
      expansionRequestLifecycle,
      fetchFormData,
      getCoverageKey,
      groupbyColumnsLength,
      isMetricTokenValue,
      metricIndexForCols,
      persistExpansionState,
      resolveExpandedForMetrics,
      seedFetchedCoverageFromFactBatches,
      setExpandedState,
      shouldFetchChildren,
      trackRequestInScope,
      updateLoadingKey,
    ],
  );

  const collapseNode = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const pending =
        axis === 'row' ? pendingRowsRef.current : pendingColsRef.current;
      const manualExpandedRef =
        axis === 'row' ? explicitExpandedRowsRef : explicitExpandedColsRef;
      const manualCollapsedRef =
        axis === 'row' ? explicitCollapsedRowsRef : explicitCollapsedColsRef;
      const nodes =
        axis === 'row' ? treeRef.current.rows : treeRef.current.cols;

      manualExpandedRef.current = dropDescendants(
        node.path,
        manualExpandedRef.current,
        nodes,
      );
      manualCollapsedRef.current = dropDescendants(
        node.path,
        manualCollapsedRef.current,
        nodes,
      );
      manualCollapsedRef.current.add(node.key);

      const nextExpanded = dropDescendants(node.path, expanded, nodes);
      nextExpanded.delete(node.key);

      const nextPending = dropDescendants(node.path, pending, nodes);
      nextPending.delete(node.key);

      pruneFetchedCoverageForCollapsedNode({
        fetchedCoverage: fetchedCoverageRef.current,
        axis,
        parentPath: node.path,
        nodes,
        parentKey: node.key,
      });

      const resolvedExpanded = resolveExpandedForMetrics(
        axis,
        nextExpanded,
        treeRef.current,
      );
      setExpandedState(axis, resolvedExpanded);
      setPendingState(axis, nextPending);
      persistExpansionState(
        axis === 'row' ? resolvedExpanded : expandedRowsRef.current,
        axis === 'col' ? resolvedExpanded : expandedColsRef.current,
      );
    },
    [
      persistExpansionState,
      resolveExpandedForMetrics,
      setExpandedState,
      setPendingState,
    ],
  );

  const hydrateAtomic = useCallback(
    async (
      reason: 'prefetch' | 'cross-axis',
      options?: {
        showLoader?: boolean;
        activeAxis?: PivotAxis;
        planRows?: boolean;
        planCols?: boolean;
      },
    ) => {
      const shouldShowLoader = options?.showLoader ?? false;
      const shouldPlanRows = options?.planRows ?? true;
      const shouldPlanCols = options?.planCols ?? true;
      const requestScope = expansionRequestLifecycle.beginScope();
      const transactionId = requestScope.id;
      clearLoadingState();
      if (shouldShowLoader) {
        setHydratingState(true);
      }

      try {
        const stagingBaseTree = treeRef.current;
        const stagedDeltas = new Map<string, PivotTreeData>();
        const buildHydrationTree = () => {
          let merged = stagingBaseTree;
          Array.from(stagedDeltas.keys())
            .sort()
            .forEach(key => {
              const delta = stagedDeltas.get(key);
              if (delta) {
                merged = mergeTrees(merged, delta);
              }
            });
          return merged;
        };
        const fetchRuntime: ExpansionFetchRuntime = {
          requestScope,
          fetchFormData,
          factStore: factStoreRef.current,
          trackRequestInScope,
          addWarnings,
          updateLoadingKey,
        };

        for (
          let iteration = 0;
          iteration < MAX_HYDRATION_ITERATIONS;
          iteration += 1
        ) {
          if (!requestScope.isCurrent()) {
            return;
          }
          const stagedTree = buildHydrationTree();
          const desiredRows = buildDesiredExpanded('row', stagedTree);
          const desiredCols = buildDesiredExpanded('col', stagedTree);
          const hydrationPlan = planHydrationIteration({
            tree: stagedTree,
            desiredRows,
            desiredCols,
            fetchedCoverage: fetchedCoverageRef.current,
            config: visibilityConfig,
            getCoverageKey,
            activeAxis: options?.activeAxis,
            pendingRows: pendingRowsRef.current,
            pendingCols: pendingColsRef.current,
            planRows: shouldPlanRows,
            planCols: shouldPlanCols,
          });
          const { visibleRowDepth, visibleColDepth } = hydrationPlan;

          if (hydrationPlan.kind === 'complete') {
            let mergedTree = buildHydrationTree();
            const orderedDeltas = Array.from(stagedDeltas.entries()).sort(
              ([a], [b]) => a.localeCompare(b),
            );
            for (const [key, delta] of orderedDeltas) {
              const parsed = JSON.parse(key) as [PivotAxis, string];
              const axis = parsed[0];
              const targetKey = parsed[1];
              const parent =
                axis === 'row'
                  ? mergedTree.rows[targetKey]
                  : mergedTree.cols[targetKey];
              mergedTree = pruneMergedTree({
                axis,
                tree: mergedTree,
                parent,
                branch: delta,
              });
            }
            const resolvedRows = resolveExpandedForMetrics(
              'row',
              desiredRows,
              mergedTree,
            );
            const resolvedCols = resolveExpandedForMetrics(
              'col',
              desiredCols,
              mergedTree,
            );
            treeRef.current = mergedTree;
            setTree(mergedTree);
            setExpandedState('row', resolvedRows);
            setExpandedState('col', resolvedCols);
            setPendingState('row', new Set());
            setPendingState('col', new Set());
            if (reason === 'cross-axis') {
              persistExpansionState(resolvedRows, resolvedCols);
            }
            return;
          }
          const { targets } = hydrationPlan;

          // eslint-disable-next-line no-await-in-loop
          const results = await fetchExpansionTargets({
            targets,
            context: { visibleRowDepth, visibleColDepth },
            runtime: fetchRuntime,
            singleRequestKind: `hydrate:${reason}`,
            transactionId,
            buildRequestGroupId,
          });

          if (!requestScope.isCurrent()) {
            return;
          }

          const resultDeltas = collectFetchResultDeltas({
            results,
            seedFetchedCoverage: seedFetchedCoverageFromFactBatches,
          });
          for (const {
            targets: deltaTargets,
            data: deltaTree,
          } of resultDeltas) {
            for (const target of deltaTargets) {
              const deltaKey = JSON.stringify([target.axis, target.pathKey]);
              stagedDeltas.set(deltaKey, deltaTree);
            }
          }
        }
      } finally {
        if (shouldShowLoader) {
          setHydratingState(false);
        }
      }
    },
    [
      addWarnings,
      buildDesiredExpanded,
      buildRequestGroupId,
      clearLoadingState,
      expansionRequestLifecycle,
      fetchFormData,
      getCoverageKey,
      persistExpansionState,
      pruneMergedTree,
      resolveExpandedForMetrics,
      seedFetchedCoverageFromFactBatches,
      setExpandedState,
      setHydratingState,
      setPendingState,
      trackRequestInScope,
      updateLoadingKey,
      visibilityConfig,
    ],
  );

  const handleToggle = useCallback(
    (axis: PivotAxis, node: PivotTreeNode) => {
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const pending =
        axis === 'row' ? pendingRowsRef.current : pendingColsRef.current;
      const isOpen = expanded.has(node.key) || pending.has(node.key);
      if (isOpen) {
        invalidateInFlightRequests();
        clearLoadingState();
        setHydratingState(false);
        collapseNode(axis, node);
        return;
      }

      const otherPending =
        axis === 'row' ? pendingColsRef.current : pendingRowsRef.current;
      const otherInFlight =
        axis === 'row'
          ? inFlightColsRef.current > 0
          : inFlightRowsRef.current > 0;
      const { visibleRowDepth, visibleColDepth } = computeVisibleDepths(
        expandedRowsRef.current,
        expandedColsRef.current,
        treeRef.current,
      );
      const oppositeVisibleDepth =
        axis === 'row' ? visibleColDepth : visibleRowDepth;
      const isAtomic =
        oppositeVisibleDepth > 0 && (otherPending.size > 0 || otherInFlight);

      if (isAtomic) {
        const nextPending = new Set(pending);
        addAncestors(node.path, nextPending, expanded);
        setPendingState(axis, nextPending);
        const manualExpandedRef =
          axis === 'row' ? explicitExpandedRowsRef : explicitExpandedColsRef;
        addAncestors(node.path, manualExpandedRef.current, expanded);
        const manualCollapsedRef =
          axis === 'row' ? explicitCollapsedRowsRef : explicitCollapsedColsRef;
        manualCollapsedRef.current.delete(node.key);
        hydrateAtomic('cross-axis', {
          activeAxis: axis,
          showLoader: false,
        }).catch(error => {
          reportAsyncError(error);
          setHydratingState(false);
        });
        return;
      }
      expandSameAxis(axis, node).catch(reportAsyncError);
    },
    [
      collapseNode,
      computeVisibleDepths,
      expandSameAxis,
      hydrateAtomic,
      invalidateInFlightRequests,
      reportAsyncError,
      clearLoadingState,
      setHydratingState,
      setPendingState,
    ],
  );

  useEffect(() => {
    const previousSignature = expandedStateSignatureRef.current;
    const shouldResetExpandedState =
      previousSignature !== expandedStateSignature;
    const isInitialMount = previousSignature === null;
    expandedStateSignatureRef.current = expandedStateSignature;
    const previousSharedSignature = expandedStateSharedSignatureRef.current;
    const sharedSignatureChanged =
      previousSharedSignature !== expandedStateSharedSignature;
    expandedStateSharedSignatureRef.current = expandedStateSharedSignature;
    const prevExpandRowsLevelRaw = prevExpandRowsLevelRawRef.current;
    const prevExpandColsLevelRaw = prevExpandColsLevelRawRef.current;
    const expandRowsLevelChanged =
      prevExpandRowsLevelRaw !== expandRowsLevelRaw;
    const expandColsLevelChanged =
      prevExpandColsLevelRaw !== expandColumnsLevelRaw;
    const isRowsLevelCleared =
      expandRowsLevelRaw === undefined && prevExpandRowsLevelRaw !== undefined;
    const isColsLevelCleared =
      expandColumnsLevelRaw === undefined &&
      prevExpandColsLevelRaw !== undefined;
    const effectiveExpandRowsLevel = isRowsLevelCleared
      ? 0
      : resolvedExpandRowsLevel;
    const effectiveExpandColsLevel = isColsLevelCleared
      ? 0
      : resolvedExpandColumnsLevel;
    const sessionExpansionState =
      expansionStateStoreRef.current?.init({
        persistedState: persistedExpansionStateRef.current,
        defaultRowKeys: groupbyRowKeys,
        defaultColKeys: groupbyColumnKeys,
      }) ??
      ({
        rowKeys: groupbyRowKeys,
        colKeys: groupbyColumnKeys,
        rows: [],
        cols: [],
        collapsedRows: [],
        collapsedCols: [],
      } satisfies PivotExpansionStateKeys);
    const currentLayout = {
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
    };
    const previousLayout = previousLayoutRef.current;
    const hasNewData = previousDataRef.current !== data;
    const shouldReinitialize =
      isInitialMount ||
      shouldResetExpandedState ||
      sharedSignatureChanged ||
      hasNewData ||
      expandRowsLevelChanged ||
      expandColsLevelChanged;
    if (!shouldReinitialize) {
      return;
    }
    previousLayoutRef.current = currentLayout;
    previousDataRef.current = data;
    const {
      rowsChanged,
      colsChanged,
      shouldExpandRows,
      shouldExpandCols,
      layoutChanged,
      normalizedTree,
      rowStablePrefix,
      colStablePrefix,
      autoExpandRowsLevelForDesired,
      autoExpandColsLevelForDesired,
    } = resolveLayoutTransition({
      data,
      currentTree: treeRef.current,
      previousLayout,
      currentLayout,
      sessionLayout: {
        rows: sessionExpansionState.rowKeys,
        cols: sessionExpansionState.colKeys,
      },
      hasNewData,
      effectiveExpandRowsLevel,
      effectiveExpandColsLevel,
    });
    const shouldResetExpandedRows =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (rowsChanged && !shouldExpandRows));
    const shouldResetExpandedCols =
      shouldResetExpandedState &&
      (sharedSignatureChanged || (colsChanged && !shouldExpandCols));
    const shouldResetExpanded =
      shouldResetExpandedRows || shouldResetExpandedCols;
    autoExpandRowsLevelRef.current = autoExpandRowsLevelForDesired;
    autoExpandColsLevelRef.current = autoExpandColsLevelForDesired;
    const nextFetchedCoverage = createFetchedFactCoverageState();

    dataEpochRef.current += 1;
    invalidateInFlightRequests();
    const nextFactStore = createPivotFactStore();
    nextFactStore.upsertBatches(factBatches);
    factStoreRef.current = nextFactStore;
    setHydratingState(false);
    warningsRef.current = new Map();
    setWarnings([]);
    treeRef.current = normalizedTree;
    setTree(normalizedTree);
    setErrorMessage(undefined);
    fetchedCoverageRef.current = nextFetchedCoverage;
    clearLoadingState();
    inFlightExpandedRowsRef.current.clear();
    inFlightExpandedColsRef.current.clear();
    inFlightExpansionIdRef.current = 0;

    const reinitializedExpansion = resolveReinitializedExpansionState({
      tree: normalizedTree,
      currentLayout,
      sessionState: sessionExpansionState,
      persistedExpansionState: persistedExpansionStateRef.current,
      shouldPersistExpansionState,
      effectiveExpandRowsLevel,
      effectiveExpandColsLevel,
      autoExpandRowsLevelForDesired,
      autoExpandColsLevelForDesired,
      prevAutoExpandRows: prevAutoExpandRowsRef.current,
      prevAutoExpandCols: prevAutoExpandColsRef.current,
      rowStablePrefix,
      colStablePrefix,
      shouldExpandMetricRows,
      shouldExpandMetricCols,
      shouldResetExpandedRows,
      shouldResetExpandedCols,
      rowsChanged,
      colsChanged,
      hasNewData,
      metricIndexForRows,
      metricIndexForCols,
      groupbyRowsLength,
      groupbyColumnsLength,
      metricLabelSet,
      countDimDepth,
      isMetricTokenValue,
    });
    if (reinitializedExpansion.clearedState) {
      persistExpansionStateToStore(reinitializedExpansion.clearedState);
    }
    const { persistedState } = reinitializedExpansion;
    explicitExpandedRowsRef.current = new Set(persistedState.rows);
    explicitExpandedColsRef.current = new Set(persistedState.cols);
    explicitCollapsedRowsRef.current = new Set(persistedState.collapsedRows);
    explicitCollapsedColsRef.current = new Set(persistedState.collapsedCols);
    persistExpansionStateToStore(persistedState, {
      persist:
        reinitializedExpansion.shouldResetPersistedLayout ||
        (!isInitialMount && shouldResetExpanded),
    });

    const resolvedRows = resolveExpandedForMetrics(
      'row',
      reinitializedExpansion.expandedRows,
      normalizedTree,
    );
    const resolvedCols = resolveExpandedForMetrics(
      'col',
      reinitializedExpansion.expandedCols,
      normalizedTree,
    );

    setExpandedState('row', resolvedRows);
    setExpandedState('col', resolvedCols);
    setPendingState('row', new Set());
    setPendingState('col', new Set());

    prevAutoExpandRowsRef.current = effectiveExpandRowsLevel;
    prevAutoExpandColsRef.current = effectiveExpandColsLevel;
    prevExpandRowsLevelRawRef.current = expandRowsLevelRaw;
    prevExpandColsLevelRawRef.current = expandColumnsLevelRaw;

    const shouldPlanRows =
      effectiveExpandRowsLevel > 0 ||
      persistedState.rows.length > 0 ||
      persistedState.collapsedRows.length > 0;
    const shouldPlanCols =
      effectiveExpandColsLevel > 0 ||
      persistedState.cols.length > 0 ||
      persistedState.collapsedCols.length > 0;
    if (factBatches.length > 0 && (hasNewData || !layoutChanged)) {
      seedFetchedCoverageFromFactBatches(factBatches);
    }
    const { rowPlan: nextRowPlan, colPlan: nextColPlan } =
      planHydrationIteration({
        tree: normalizedTree,
        desiredRows: resolvedRows,
        desiredCols: resolvedCols,
        fetchedCoverage: fetchedCoverageRef.current,
        config: visibilityConfig,
        getCoverageKey,
        pendingRows: new Set(),
        pendingCols: new Set(),
        planRows: shouldPlanRows,
        planCols: shouldPlanCols,
      });
    const shouldSkipRootPrefetch =
      resolvedRows.size === 1 &&
      resolvedRows.has(rootKey) &&
      resolvedCols.size === 1 &&
      resolvedCols.has(rootKey) &&
      persistedState.rows.length === 0 &&
      persistedState.cols.length === 0 &&
      persistedState.collapsedRows.length === 0 &&
      persistedState.collapsedCols.length === 0 &&
      autoExpandRowsLevelForDesired <= 0 &&
      autoExpandColsLevelForDesired <= 0 &&
      !Object.keys(normalizedTree.rows).some(key => key !== rootKey) &&
      !Object.keys(normalizedTree.cols).some(key => key !== rootKey);
    const shouldShowPrefetchLoader =
      hasNestedPendingKeys(nextRowPlan.pendingKeys) ||
      hasNestedPendingKeys(nextColPlan.pendingKeys);
    if (nextRowPlan.pendingKeys.size + nextColPlan.pendingKeys.size > 0) {
      if (shouldSkipRootPrefetch) {
        setHydratingState(false);
        return;
      }
      if (!shouldShowPrefetchLoader) {
        setHydratingState(false);
      }
      hydrateAtomic('prefetch', {
        showLoader: shouldShowPrefetchLoader,
        planRows: shouldPlanRows,
        planCols: shouldPlanCols,
      }).catch(error => {
        reportAsyncError(error);
        setHydratingState(false);
      });
      return;
    }
    setHydratingState(false);
  }, [
    clearLoadingState,
    countDimDepth,
    data,
    expandedStateSignature,
    expandedStateSharedSignature,
    factBatches,
    expandColumnsLevelRaw,
    expandRowsLevelRaw,
    groupbyColumnKeys,
    groupbyColumnsLength,
    groupbyRowKeys,
    groupbyRowsLength,
    isMetricTokenValue,
    metricLabelSet,
    metricIndexForCols,
    metricIndexForRows,
    persistExpansionStateToStore,
    shouldPersistExpansionState,
    resolvedExpandColumnsLevel,
    resolvedExpandRowsLevel,
    shouldExpandMetricCols,
    shouldExpandMetricRows,
    hydrateAtomic,
    invalidateInFlightRequests,
    resolveExpandedForMetrics,
    reportAsyncError,
    getCoverageKey,
    seedFetchedCoverageFromFactBatches,
    setExpandedState,
    setHydratingState,
    setPendingState,
    visibilityConfig,
  ]);

  const handleRetry = useCallback(() => {
    setErrorMessage(undefined);
    warningsRef.current = new Map();
    setWarnings([]);

    hydrateAtomic('prefetch', { showLoader: true }).catch(reportAsyncError);
  }, [hydrateAtomic, reportAsyncError]);

  return {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    pendingRows,
    pendingCols,
    isHydrating,
    errorMessage,
    warnings,
    handleToggle,
    handleRetry,
  };
};
