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
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { isEqual } from 'lodash';
import { t } from '@apache-superset/core/translation';
import {
  type DataRecordValue,
  type QueryFormColumn,
  type HandlerFunction,
  type JsonObject,
  type SetDataMaskHook,
} from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotRuntimeLayout,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
  type PivotExpansionState,
} from '../../types';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import {
  createLatestRequestLifecycle,
  isAbortError,
} from '../runtime/requestLifecycle';
import {
  fetchAndMaterializeSeamlessRuntimeUpdate,
  isSameRuntimeLayout,
  buildSeamlessRuntimeSyncSnapshot,
} from '../runtime/seamlessRuntimeUpdate';
import {
  createPivotFactStoreFromBatches,
  buildPivotFactQueryContextKey,
  assignMissingPivotFactQueryContextKey,
  type PivotFactStoreBatch,
  type PivotFactStore,
} from '../runtime/factStore';
import { materializeLoadedPivotTreeFromFactStore } from '../runtime/materializePivotTree';
import { buildInitialPivotUpdatePlan } from '../query/specs';
import { normalizeRuntimeLayout } from '../layout/resolveInteractionLayout';
import {
  applyDimensionFilterSelectionChange,
  buildClearSelectedFiltersUpdate,
  hasSelectedFilters,
  buildRuntimeSelectionSyncState,
} from '../filters';
import {
  applyDimensionDrag,
  applyValueDrag,
  removeDimensionFromLayout,
} from '../layout/interactionDrag';
import { getStableColumnKey } from '../../utils';
import {
  ExpansionSession,
  expansionStateKeysToIntent,
} from '../expansion/ExpansionSession';
import {
  coerceExpansionStateForLayout,
  type PivotExpansionStateKeys,
} from '../expansion/stateModel';
import {
  reconcileExpansionState,
  resolveExpandedByAxisForTree,
  resolveCollapsedExpansionState,
  resolveExpansionToggleDecision,
  resolveExpandedForMetrics,
} from '../expansion/stateTransitions';
import { planHydrationIteration } from '../expansion/planner';
import { parsePath } from '../core/path';
import { StaleChunkedWorkError } from '../runtime/chunkedWork';
import { stableStringify } from '../shared/stableStringify';
import { rootKey } from '../viewModel';
import { usePivotLayout } from './usePivotLayout';

type RuntimeSelection = Record<string, DataRecordValue[]>;

const runtimeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : t('Failed to update data');
type UsePivotRuntimeConfig = {
  dimensionKeys: string[];
  metricKeys: string[];
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  upstreamDashboardQueryContextSignature: string | null;
  runtimeLayout: PivotRuntimeLayout;
  initialCommittedLayout: PivotRuntimeLayout;
  dimensions: QueryFormColumn[];
  selectedFiltersFromFormData: RuntimeSelection;
  selectedFiltersFromOwnState: RuntimeSelection;
  selectedFiltersFromProps: RuntimeSelection;
  baseFormData: PivotTableQueryFormData;
  sourceMetrics: PivotTableQueryFormData['metrics'];
  sourceMeasureLeavesByMetric: PivotTableQueryFormData['measureLeavesByMetric'];
  isDashboardContext: boolean;
  mergeOwnState: (partial: JsonObject) => JsonObject;
  setControlValue?: HandlerFunction;
  setDataMask: SetDataMaskHook;
  persistedExpansionState?: unknown;
  shouldPersistExpansionState?: boolean;
};

type Projection = ReturnType<typeof buildInitialPivotUpdatePlan>;
type AxisSetMap = Record<PivotAxis, Set<string>>;
type Visible = {
  layout: PivotRuntimeLayout;
  filters: RuntimeSelection;
  tree: PivotTreeData;
  expanded: AxisSetMap;
  plan: Projection;
  store: PivotFactStore;
  intent: PivotExpansionStateKeys;
};
type RuntimeModel = {
  draft: { layout: PivotRuntimeLayout; filters: RuntimeSelection };
  visible: Visible;
  pending?: Visible;
  busy: 'layout' | 'filters' | 'initial' | null;
  loadingKeys: Set<string>;
  error?: string;
  failed?: 'layout' | 'filters' | 'expansion';
  epoch: number;
  local: boolean;
  clearedFilters: boolean;
  source: {
    data: PivotTreeData;
    factBatches: PivotFactStoreBatch[];
    dashboardContext: string | null;
  };
  syncSignature?: string;
};
const emptyExpansion = (): PivotExpansionStateKeys => ({
  rows: [],
  cols: [],
  collapsedRows: [],
  collapsedCols: [],
});
const layoutKeys = (plan: Projection) => ({
  rows: plan.layout.pivotProgram.rowDimensions.map(getStableColumnKey),
  cols: plan.layout.pivotProgram.columnDimensions.map(getStableColumnKey),
});
const planFor = (
  config: UsePivotRuntimeConfig,
  layout: PivotRuntimeLayout,
  filters: RuntimeSelection,
) =>
  buildInitialPivotUpdatePlan({
    formData: config.baseFormData,
    runtimeLayout: layout,
    selection: filters,
    metricsOverride: config.sourceMetrics,
    measureLeavesByMetricOverride: config.sourceMeasureLeavesByMetric,
  });
const hasCells = (tree: PivotTreeData) => Object.keys(tree.cells).length > 0;

/** Owns one fact store and publishes layout, tree and expansion as a single checkpoint. */
export const usePivotRuntime = (config: UsePivotRuntimeConfig) => {
  const [, render] = useReducer((revision: number) => revision + 1, 0);
  const modelRef = useRef<RuntimeModel>();
  const sessionRef = useRef<ExpansionSession>();
  const lifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: group => supersetChartDataClient.cancel(group),
      }),
    [],
  );
  if (!modelRef.current) {
    const plan = planFor(
      config,
      config.initialCommittedLayout,
      config.selectedFiltersFromProps,
    );
    const keys = layoutKeys(plan);
    const initial =
      coerceExpansionStateForLayout({
        value: config.persistedExpansionState,
        rowKeys: keys.rows,
        colKeys: keys.cols,
      }) ?? emptyExpansion();
    const expansion = reconcileExpansionState({
      tree: config.data,
      reset: true,
      previousLayout: keys,
      currentLayout: keys,
      state: initial,
      axisCoverageNeeds: plan.layout.axisCoverageNeeds,
      program: plan.layout.pivotProgram,
      isLeafTierVisible:
        plan.layout.measureHierarchy.leafTierVisibility === 'visible',
    });
    const context = buildPivotFactQueryContextKey(plan.formData);
    modelRef.current = {
      draft: {
        layout: config.runtimeLayout,
        filters: config.selectedFiltersFromProps,
      },
      visible: {
        layout: config.initialCommittedLayout,
        filters: config.selectedFiltersFromProps,
        tree: config.data,
        expanded: expansion.expanded,
        plan,
        intent: expansion.persistedState,
        store: createPivotFactStoreFromBatches(
          config.factBatches.map(batch =>
            assignMissingPivotFactQueryContextKey(batch, context),
          ),
        ),
      },
      busy: null,
      loadingKeys: new Set(),
      epoch: 0,
      local: false,
      clearedFilters: false,
      source: {
        data: config.data,
        factBatches: config.factBatches,
        dashboardContext: config.upstreamDashboardQueryContextSignature,
      },
    };
    sessionRef.current = new ExpansionSession(
      expansion.persistedState,
      group => supersetChartDataClient.cancel(group),
      keys => {
        modelRef.current!.loadingKeys = keys;
        render();
      },
    );
  }
  const model = modelRef.current;
  const session = sessionRef.current!;
  const layoutResult = usePivotLayout({
    formData: model.visible.plan.formData,
    pivotProgram: model.visible.plan.layout.pivotProgram,
  });
  const upstreamSignature = buildPivotFactQueryContextKey({
    ...config.baseFormData,
    metrics: config.sourceMetrics,
  });
  const syncSignature = (
    layout: PivotRuntimeLayout,
    filters: RuntimeSelection,
  ) =>
    stableStringify(
      buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout: layout,
        selection: filters,
        upstreamSignature,
      }),
    );
  const selectionSync = buildRuntimeSelectionSyncState({
    dimensions: config.dimensions,
    selectedFiltersFromFormData: config.selectedFiltersFromFormData,
    selectedFiltersFromOwnState: config.selectedFiltersFromOwnState,
    selectedFiltersFromProps: config.selectedFiltersFromProps,
    committedFilters: model.visible.filters,
  });

  const persist = (layout: PivotRuntimeLayout, filters: RuntimeSelection) => {
    if (config.setControlValue) {
      config.setControlValue('pivotRuntimeLayout', layout);
      config.setControlValue('pivotSelectedFilters', filters);
    }
    model.syncSignature = syncSignature(layout, filters);
  };
  const persistExpansion = () => {
    if (!config.shouldPersistExpansionState) return;
    const keys = layoutKeys(model.visible.plan);
    const state = session.committedState;
    const payload: PivotExpansionState = {
      rowKeys: keys.rows,
      colKeys: keys.cols,
      rows: state.rows.map(parsePath),
      cols: state.cols.map(parsePath),
      collapsedRows: state.collapsedRows.map(parsePath),
      collapsedCols: state.collapsedCols.map(parsePath),
    };
    if (config.setControlValue)
      config.setControlValue('pivotExpansionState', payload);
    else if (!config.isDashboardContext)
      config.setDataMask({
        ownState: { ...config.mergeOwnState({ pivotExpansionState: payload }) },
      });
  };
  const expandedFor = (
    tree: PivotTreeData,
    plan: Projection,
    expanded = session.intent.expanded,
  ) =>
    resolveExpandedByAxisForTree({
      tree,
      axisCoverageNeeds: plan.layout.axisCoverageNeeds,
      manualExpanded: expanded,
      manualCollapsed: session.intent.collapsed,
      program: plan.layout.pivotProgram,
      isLeafTierVisible:
        plan.layout.measureHierarchy.leafTierVisibility === 'visible',
    });
  const needsHydration = (store: PivotFactStore, plan: Projection) => {
    const { state } = session;
    const context = buildPivotFactQueryContextKey(plan.formData);
    const intent = expansionStateKeysToIntent(state);
    return (
      planHydrationIteration({
        desired: {
          row: new Set([rootKey, ...intent.expanded.row]),
          col: new Set([rootKey, ...intent.expanded.col]),
        },
        axisCoverageNeeds: plan.layout.axisCoverageNeeds,
        rootCoverageNeeds: store.getFactBatches(context).length
          ? []
          : plan.layout.rootCoverageNeeds,
        factSelectors: store.getCoverageSelectors(context),
        program: plan.layout.pivotProgram,
        queryContextKey: context,
      }).kind === 'fetch'
    );
  };
  const reportError = (
    error: unknown,
    failed: 'layout' | 'filters' | 'expansion',
  ) => {
    if (error instanceof StaleChunkedWorkError || isAbortError(error)) return;
    model.error = runtimeErrorMessage(error);
    model.failed = failed;
    render();
  };
  const hydrate = async (
    visible: Visible,
    store: PivotFactStore,
    loadingKeys?: Set<string>,
    skip = false,
  ) => {
    const { plan } = visible;
    return session.hydrate({
      axisCoverageNeeds: plan.layout.axisCoverageNeeds,
      completeBehavior: skip ? 'skip' : 'returnTree',
      currentTree: visible.tree,
      factStore: store,
      fetchFormData: plan.formData,
      fetchLayout: plan.layout,
      program: plan.layout.pivotProgram,
      queryContextKey: buildPivotFactQueryContextKey(plan.formData),
      visibleLoadingKeys: loadingKeys,
    });
  };
  const revealExpansion = async (loadingKeys?: Set<string>, skip = false) => {
    const { epoch } = model;
    const visible = model.pending ?? model.visible;
    try {
      const result = await hydrate(visible, visible.store, loadingKeys, skip);
      if (
        epoch !== model.epoch ||
        !result.tree ||
        (skip && hasCells(visible.tree) && !hasCells(result.tree))
      )
        return;
      model.visible = {
        ...visible,
        tree: result.tree,
        intent: session.committedState,
        expanded: expandedFor(
          result.tree,
          visible.plan,
          'revealedExpanded' in result ? result.revealedExpanded : undefined,
        ),
      };
      model.pending = undefined;
      persistExpansion();
      render();
    } catch (error) {
      if (epoch === model.epoch) reportError(error, 'expansion');
    }
  };
  const reconcile = (tree: PivotTreeData, plan: Projection) => {
    const previous = model.visible;
    const next = reconcileExpansionState({
      tree,
      reset:
        !isEqual(
          previous.plan.layout.measureHierarchy,
          plan.layout.measureHierarchy,
        ) ||
        !isEqual(
          previous.plan.layout.axisCoverageNeeds,
          plan.layout.axisCoverageNeeds,
        ),
      previousLayout: layoutKeys(previous.plan),
      currentLayout: layoutKeys(plan),
      state: session.committedState,
      axisCoverageNeeds: plan.layout.axisCoverageNeeds,
      program: plan.layout.pivotProgram,
      isLeafTierVisible:
        plan.layout.measureHierarchy.leafTierVisibility === 'visible',
    });
    session.reset(next.persistedState);
    return next.expanded;
  };
  const refresh = async (kind: 'layout' | 'filters') => {
    const target = model.draft;
    const factBatches = (model.pending ?? model.visible).store.getFactBatches();
    model.epoch += 1;
    const { epoch } = model;
    session.reset(model.visible.intent);
    model.pending = undefined;
    model.busy = kind;
    model.error = undefined;
    model.failed = undefined;
    render();
    const result = await fetchAndMaterializeSeamlessRuntimeUpdate({
      requestLifecycle: lifecycle,
      baseFormData: config.baseFormData,
      sourceMetrics: config.sourceMetrics,
      sourceMeasureLeavesByMetric: config.sourceMeasureLeavesByMetric,
      runtimeLayout: target.layout,
      selection: target.filters,
      factBatches,
    });
    if (epoch !== model.epoch || result.status === 'stale') return;
    if (result.status !== 'success') {
      model.busy = null;
      reportError(result.error, kind);
      return;
    }
    const plan = planFor(config, target.layout, target.filters);
    const store = createPivotFactStoreFromBatches(result.factBatches);
    const expanded = reconcile(result.tree, plan);
    let visible: Visible = {
      layout: target.layout,
      filters: target.filters,
      tree: result.tree,
      expanded,
      plan,
      store,
      intent: session.committedState,
    };
    model.pending = visible;
    try {
      if (needsHydration(store, plan)) {
        const hydrated = await hydrate(visible, store, new Set());
        if (epoch !== model.epoch) return;
        if (!hydrated.tree) return;
        visible = {
          ...visible,
          tree: hydrated.tree,
          expanded: expandedFor(hydrated.tree, plan),
          intent: session.committedState,
        };
      }
      model.visible = visible;
      model.pending = undefined;
      model.busy = null;
      persist(target.layout, target.filters);
      persistExpansion();
      render();
    } catch (error) {
      if (epoch === model.epoch) {
        model.busy = null;
        reportError(error, kind);
      }
    }
  };
  const applyRuntimeLayoutChange = (next: PivotRuntimeLayout) => {
    const layout = normalizeRuntimeLayout(
      next,
      config.dimensionKeys,
      config.metricKeys,
    );
    model.draft = { ...model.draft, layout };
    model.local = true;
    persist(layout, model.draft.filters);
    refresh('layout');
  };
  const changeFilters = (filters: RuntimeSelection, cleared: boolean) => {
    model.local = true;
    model.clearedFilters = cleared;
    model.draft = { ...model.draft, filters };
    refresh('filters');
  };
  const handleToggle = (axis: PivotAxis, node: PivotTreeNode) => {
    const { visible } = model;
    const decision = resolveExpansionToggleDecision({
      node,
      expanded: visible.expanded[axis],
      manualExpanded: session.intent.expanded[axis],
      manualCollapsed: session.intent.collapsed[axis],
    });
    const failedRefresh =
      model.failed === 'layout' ||
      model.failed === 'filters' ||
      (model.failed === 'expansion' && model.pending !== undefined);
    if (!failedRefresh) model.error = undefined;
    if (decision.kind === 'expand') {
      session.updateAxis(
        axis,
        decision.nextManualExpanded,
        decision.nextManualCollapsed,
      );
      revealExpansion(new Set([node.key]));
    } else {
      model.epoch += 1;
      lifecycle.invalidate();
      session.reset(visible.intent);
      const refreshKind =
        model.busy === 'layout' || model.busy === 'filters' ? model.busy : null;
      const pendingSource = model.pending;
      if (!failedRefresh) model.failed = undefined;
      model.busy = null;
      const { intent } = session;
      const collapsed = resolveCollapsedExpansionState({
        node,
        expanded: visible.expanded[axis],
        manualExpanded: intent.expanded[axis],
        manualCollapsed: intent.collapsed[axis],
        nodes: axis === 'row' ? visible.tree.rows : visible.tree.cols,
      });
      session.updateAxis(
        axis,
        collapsed.nextManualExpanded,
        collapsed.nextManualCollapsed,
      );
      session.acceptCurrent();
      const expanded = resolveExpandedForMetrics({
        axis,
        expanded: collapsed.nextExpanded,
        tree: visible.tree,
        collapsed: collapsed.nextManualCollapsed,
        program: visible.plan.layout.pivotProgram,
        isLeafTierVisible:
          visible.plan.layout.measureHierarchy.leafTierVisibility === 'visible',
      });
      model.visible = {
        ...visible,
        expanded: { ...visible.expanded, [axis]: expanded },
        intent: session.committedState,
      };
      persistExpansion();
      render();
      if (refreshKind) {
        refresh(refreshKind);
      } else if (pendingSource) {
        model.pending = {
          ...pendingSource,
          expanded: reconcile(pendingSource.tree, pendingSource.plan),
          intent: session.committedState,
        };
        if (!failedRefresh) revealExpansion();
      } else {
        model.pending = undefined;
      }
    }
  };

  useEffect(
    () => () => {
      model.epoch += 1;
      session.dispose();
      lifecycle.invalidate();
    },
    [model, session, lifecycle],
  );
  useEffect(() => {
    const shouldHydrate = needsHydration(
      model.visible.store,
      model.visible.plan,
    );
    const { tree } = model.visible;
    const displayable =
      hasCells(tree) ||
      [tree.rows, tree.cols].some(nodes =>
        Object.keys(nodes).some(key => key !== rootKey),
      );
    if (
      shouldHydrate &&
      !displayable &&
      (session.state.rows.length || session.state.cols.length)
    ) {
      model.busy = 'initial';
      render();
    }
    revealExpansion(undefined, true).finally(() => {
      if (model.busy === 'initial') {
        model.busy = null;
        render();
      }
    });
    // Initial restoration runs once; later source receipts use the adoption transition below.
  }, []);
  useEffect(() => {
    const previous = model.source;
    const context = config.upstreamDashboardQueryContextSignature;
    const upstreamChanged =
      previous.dashboardContext !== null &&
      context !== null &&
      previous.dashboardContext !== context;
    const restore =
      hasSelectedFilters(selectionSync.persistedInteractionFilters) &&
      !(model.clearedFilters && !hasSelectedFilters(model.draft.filters));
    const selection = upstreamChanged
      ? model.draft.filters
      : selectionSync.persistedInteractionFilters;
    const signature = syncSignature(model.draft.layout, selection);
    model.source = { ...previous, dashboardContext: context };
    if ((upstreamChanged || restore) && model.syncSignature !== signature) {
      model.syncSignature = signature;
      if (!model.local)
        model.draft = { layout: config.runtimeLayout, filters: selection };
      refresh('filters');
      return;
    }
    const acceptsPendingSource =
      previous.data !== config.data &&
      isSameRuntimeLayout(config.runtimeLayout, model.draft.layout);
    if (
      (model.busy && !acceptsPendingSource) ||
      (config.isDashboardContext && model.local && !upstreamChanged)
    )
      return;
    const layout = config.runtimeLayout;
    if (
      model.local &&
      ((!isSameRuntimeLayout(layout, model.visible.layout) &&
        !isSameRuntimeLayout(layout, model.draft.layout)) ||
        !isEqual(
          selectionSync.selectedFiltersForTreeSync,
          model.visible.filters,
        ))
    )
      return;
    const plan = planFor(
      config,
      layout,
      selectionSync.selectedFiltersForTreeSync,
    );
    if (
      previous.data === config.data &&
      previous.factBatches === config.factBatches &&
      isSameRuntimeLayout(layout, model.visible.layout) &&
      isEqual(plan.layout, model.visible.plan.layout)
    ) {
      if (!isEqual(plan.formData, model.visible.plan.formData)) {
        model.visible = { ...model.visible, plan };
        render();
      }
      return;
    }
    const contextKey = buildPivotFactQueryContextKey(plan.formData);
    if (
      restore &&
      !config.factBatches.every(batch => batch.queryContextKey === contextKey)
    )
      return;
    model.source = {
      data: config.data,
      factBatches: config.factBatches,
      dashboardContext: context,
    };
    model.epoch += 1;
    model.busy = null;
    lifecycle.invalidate();
    const store = createPivotFactStoreFromBatches(
      config.factBatches.map(batch =>
        assignMissingPivotFactQueryContextKey(batch, contextKey),
      ),
    );
    const materialized = materializeLoadedPivotTreeFromFactStore({
      store,
      layout: plan.layout,
      formData: plan.formData,
    });
    const tree =
      hasCells(config.data) && !hasCells(materialized)
        ? config.data
        : materialized;
    const expanded = reconcile(tree, plan);
    const visible: Visible = {
      layout,
      filters: selectionSync.selectedFiltersForTreeSync,
      tree,
      expanded,
      plan,
      store,
      intent: session.committedState,
    };
    if (!model.local) model.draft = { layout, filters: visible.filters };
    model.error = undefined;
    const { epoch } = model;
    const pending = needsHydration(store, plan);
    if (
      !pending ||
      (!visible.intent.rows.length && !visible.intent.cols.length)
    ) {
      model.visible = visible;
      model.pending = undefined;
      render();
    }
    if (pending) {
      model.pending = visible;
      // A refreshed root cannot replace the covered hierarchy before its children arrive.
      hydrate(visible, store, new Set())
        .then(result => {
          if (
            epoch !== model.epoch ||
            !result.tree ||
            (hasCells(visible.tree) && !hasCells(result.tree))
          )
            return;
          model.visible = {
            ...visible,
            tree: result.tree,
            expanded: expandedFor(result.tree, plan),
            intent: session.committedState,
          };
          model.pending = undefined;
          render();
        })
        .catch(error => {
          if (epoch === model.epoch) reportError(error, 'expansion');
        });
    }
    // Handlers operate on the single model; prop receipts, not rendered revisions, trigger adoption.
  }, [
    config.data,
    config.factBatches,
    config.runtimeLayout,
    config.baseFormData,
    config.upstreamDashboardQueryContextSignature,
    config.selectedFiltersFromFormData,
    config.selectedFiltersFromOwnState,
    config.selectedFiltersFromProps,
  ]);

  const retry = () => {
    model.error = undefined;
    if (model.failed === 'layout' || model.failed === 'filters')
      refresh(model.failed);
    else revealExpansion();
  };
  return {
    uiRuntimeLayout: model.draft.layout,
    uiSelectedFilters: model.draft.filters,
    tree: model.visible.tree,
    expandedRows: model.visible.expanded.row,
    expandedCols: model.visible.expanded.col,
    layoutResult,
    appliedLayoutFormData: model.visible.plan.formData,
    loadingKeys: model.loadingKeys,
    isInitialExpansionHydrating: model.busy === 'initial',
    cornerLoading: model.busy === 'layout',
    errorMessage: model.error,
    handleToggle,
    handleRetry: retry,
    applyRuntimeLayoutChange,
    applyDimensionFilterChange: (
      dimension: QueryFormColumn,
      values: DataRecordValue[],
    ) => {
      const update = applyDimensionFilterSelectionChange({
        selection: model.draft.filters,
        dimensionKey: getStableColumnKey(dimension),
        values,
      });
      changeFilters(
        update.selection,
        update.suppressStalePersistedFilterRestore,
      );
    },
    clearAllFilters: () => {
      const update = buildClearSelectedFiltersUpdate(model.draft.filters);
      if (update)
        changeFilters(
          update.selection,
          update.suppressStalePersistedFilterRestore,
        );
    },
    removeRuntimeDimension: (key: string) =>
      applyRuntimeLayoutChange(
        removeDimensionFromLayout(model.draft.layout, key),
      ),
    dropRuntimeDimension: (
      dimensionKey: string,
      targetAxis: PivotAxis,
      targetChipIndex: number | undefined,
      insertBeforeValue: boolean,
      sourceAxis?: PivotAxis,
      sourceChipIndex?: number,
    ) =>
      applyRuntimeLayoutChange(
        applyDimensionDrag(model.draft.layout, {
          dimensionKey,
          targetAxis,
          targetChipIndex,
          insertBeforeValue,
          sourceAxis,
          sourceChipIndex,
          metricsAvailable: config.metricKeys.length > 0,
        }),
      ),
    dropRuntimeValue: (
      targetAxis: PivotAxis,
      targetChipIndex: number | undefined,
      sourceAxis: PivotAxis,
      sourceChipIndex?: number,
    ) =>
      applyRuntimeLayoutChange(
        applyValueDrag(model.draft.layout, {
          targetAxis,
          targetChipIndex,
          sourceAxis,
          sourceChipIndex,
          metricsAvailable: config.metricKeys.length > 0,
        }),
      ),
  };
};
