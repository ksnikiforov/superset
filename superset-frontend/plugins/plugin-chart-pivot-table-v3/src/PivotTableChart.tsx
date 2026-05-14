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
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { isEqual } from 'lodash';
import {
  AppSection,
  DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  supersetTheme,
  type JsonObject,
  styled,
  t,
} from '@superset-ui/core';
import { Loading } from '@superset-ui/core/components';
import {
  type PivotTableProps,
  MetricsLayoutEnum,
  type PivotAxis,
  PivotRuntimeLayout,
  type PivotTreeData,
  type PivotTreeNode,
} from './types';
import { PivotTableView } from './pivot/render/PivotTableView';
import { useExpansionEngine } from './pivot/expansion/useExpansionEngine';
import { usePivotLayout } from './pivot/chart/usePivotLayout';
import { usePivotRenderModel } from './pivot/chart/usePivotRenderModel';
import { useStickyHeaders } from './pivot/chart/useStickyHeaders';
import { usePivotFormatting } from './pivot/chart/usePivotFormatting';
import { usePivotInteractions } from './pivot/chart/usePivotInteractions';
import { usePivotDatasetMeta } from './pivot/chart/usePivotDatasetMeta';
import { PivotInteractionPanel } from './pivot/chart/PivotInteractionPanel';
import {
  INTERACTION_PANEL_WIDTH,
  INTERACTION_SIDE_CHIPS_WIDTH,
  INTERACTION_TOP_CHIPS_HEIGHT,
  PivotInteractionLayout,
} from './pivot/chart/PivotInteractionLayout';
import { isSameRuntimeLayout } from './pivot/runtime/coverage';
import {
  normalizeRuntimeLayout,
  resolveAppliedInteractionLayout,
} from './pivot/layout/resolveInteractionLayout';
import { buildSelectionFilteredFormData } from './pivot/update/initialUpdatePlan';
import {
  applyDimensionFilterSelectionChange,
  buildClearSelectedFiltersUpdate,
  buildRuntimeSelectionSyncState,
  buildTreeDimensionFilterValues,
} from './pivot/filters';
import { useDimensionFilterValues } from './pivot/chart/useDimensionFilterValues';
import {
  applyDimensionDrag,
  applyValueDrag,
  buildInteractionChips,
  removeDimensionFromLayout,
} from './pivot/layout/interactionDrag';
import { getMetricKeys, getStableColumnKey } from './utils';
import {
  buildPivotColumnSortStateForClick,
  getPivotColumnSortOrder,
  reconcilePivotColumnSortState,
  resolvePivotColumnSortMetric,
  type PivotColumnSortState,
} from './pivot/chart/columnSort';
import { type PivotFactStoreBatch } from './pivot/runtime/ingestQueryResults';
import { useSyncRef } from './pivot/shared/useSyncRef';
import {
  buildSeamlessRuntimeUpstreamSignature,
  isSeamlessDisplaySnapshotSettled,
  prepareRuntimeLayoutPropSync,
  prepareRuntimeStatePersistence,
  prepareSeamlessRuntimeUpdateEffect,
  prepareSeamlessRuntimeLayoutChange,
  shouldSyncCommittedRuntimeFromProps,
  shouldSyncPersistedSelectedFilters,
  type SeamlessRuntimeSyncSnapshot,
  type SeamlessRuntimeUpstreamState,
} from './pivot/runtime/seamlessRuntimeUpdate';
import {
  type PivotDisplaySnapshot,
  usePivotSeamlessRuntimeUpdate,
} from './pivot/chart/usePivotSeamlessRuntimeUpdate';

const EMPTY_SELECTED_FILTERS: Record<string, DataRecordValue[]> = {};
const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

const MetaLoadingWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
`;

type PivotViewProps = ComponentProps<typeof PivotTableView>;

function PivotTableChart(props: PivotTableProps) {
  const {
    data,
    factBatches = EMPTY_FACT_BATCHES,
    formData,
    queryFormData,
    width,
    height,
    metrics,
    startCollapsed = true,
    initialDepth = 1,
    expandRowsLevel,
    expandColumnsLevel,
    rowOrder,
    colOrder,
    valueFormat,
    columnFormats,
    verboseMap,
    currencyFormats,
    allowRenderHtml,
    ownState,
    setDataMask,
    setControlValue,
    emitCrossFilters,
    selectedFilters,
    persistExpansionState: persistExpansionStateProp,
    onContextMenu,
    timeGrainSqla,
    dateFormatters = {},
    colTypeMap,
    metricsLayout = MetricsLayoutEnum.COLUMNS,
    rowSubtotalLevels = [],
    colSubtotalLevels = [],
    rowTotals = false,
    colTotals = true,
    rowSubTotals = false,
    rowTotalPosition = 'start',
    rowSubtotalPosition = 'start',
    colTotalPosition = 'start',
    colSubtotalPosition = 'start',
    pivotTheme = 'none',
    pivotThemeColors = '',
    stickyHeaders = true,
    theme = supersetTheme,
    appSection,
  } = props;

  const { interactionMode } = formData;
  const isUserControlled = interactionMode === 'user_controlled';
  const isDashboardContext =
    appSection === AppSection.Dashboard || formData.dashboardId !== undefined;
  const isDashboardRuntimeSync = isUserControlled && isDashboardContext;
  const shouldPersistOwnState = !isDashboardRuntimeSync;
  const fetchFormDataBase = queryFormData || formData;
  const dimensionList = useMemo(
    () => ensureIsArray(formData.dimensions),
    [formData.dimensions],
  );
  const dimensionKeys = useMemo(
    () => dimensionList.map(dimension => getStableColumnKey(dimension)),
    [dimensionList],
  );
  const datasourceId = useMemo(() => {
    const datasource = formData.datasource || '';
    const [idPart] = datasource.split('__');
    const id = Number(idPart);
    return Number.isFinite(id) ? id : null;
  }, [formData.datasource]);
  const {
    resolvedVerboseMap,
    resolvedDateFormatters,
    metaState,
    needsVerboseMap,
    needsDateFormatters,
  } = usePivotDatasetMeta({
    datasourceId,
    dimensions: dimensionList,
    formData,
    fetchFormDataBase,
    verboseMap,
    dateFormatters,
  });
  const fetchFormDataBaseWithFormatters = useMemo(
    () => ({
      ...fetchFormDataBase,
      dateFormatters: resolvedDateFormatters,
      verboseMap: resolvedVerboseMap,
    }),
    [fetchFormDataBase, resolvedDateFormatters, resolvedVerboseMap],
  );

  const appliedFormData = fetchFormDataBaseWithFormatters;
  const persistExpansionState = persistExpansionStateProp ?? true;
  const resolvedStickyHeaders = formData.stickyHeaders ?? stickyHeaders;

  const [committedTree, setCommittedTree] = useState<PivotTreeData>(data);
  const [committedFactBatches, setCommittedFactBatches] =
    useState<PivotFactStoreBatch[]>(factBatches);
  const [committedFilters, setCommittedFilters] = useState<
    Record<string, DataRecordValue[]>
  >(selectedFilters ?? EMPTY_SELECTED_FILTERS);
  const [activeColumnSort, setActiveColumnSort] =
    useState<PivotColumnSortState | null>(null);
  const pendingSeamlessLayoutRef = useRef<PivotRuntimeLayout | null>(null);
  const lastUpstreamQueryContextRef =
    useRef<SeamlessRuntimeUpstreamState>(null);
  const expandedRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const expandedColsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingColsForSeamlessRef = useRef<Set<string>>(new Set());
  const displaySnapshotRef = useRef<PivotDisplaySnapshot | null>(null);
  const lastSeamlessSyncRef = useRef<SeamlessRuntimeSyncSnapshot | null>(null);
  const lastLocalSyncDashboardQueryContextRef = useRef<string | null>(null);
  const dataForRender = isUserControlled ? committedTree : data;
  const factBatchesForRender = isUserControlled
    ? committedFactBatches
    : factBatches;

  const ownStateRef = useRef<JsonObject>(ownState ?? {});
  useSyncRef(ownStateRef, ownState ?? {});

  const mergeOwnState = useCallback((partial: JsonObject) => {
    const next = { ...ownStateRef.current, ...partial };
    ownStateRef.current = next;
    return next;
  }, []);

  const appliedDimensionKeys = useMemo(
    () =>
      ensureIsArray(appliedFormData.dimensions).map(dimension =>
        getStableColumnKey(dimension),
      ),
    [appliedFormData.dimensions],
  );
  const metricsForUi = useMemo(
    () => formData.metricsBase ?? formData.metrics ?? metrics,
    [formData.metrics, formData.metricsBase, metrics],
  );
  const metricKeys = useMemo(() => getMetricKeys(metricsForUi), [metricsForUi]);
  const runtimeLayout = useMemo(() => {
    const persisted =
      (ownState?.pivotRuntimeLayout as PivotRuntimeLayout | undefined) ??
      formData.pivotRuntimeLayout;
    return normalizeRuntimeLayout(persisted, dimensionKeys, metricKeys);
  }, [dimensionKeys, formData.pivotRuntimeLayout, metricKeys, ownState]);
  const [committedRuntimeLayout, setCommittedRuntimeLayout] =
    useState<PivotRuntimeLayout>(runtimeLayout);
  const committedRuntimeLayoutRef = useRef(committedRuntimeLayout);
  useSyncRef(committedRuntimeLayoutRef, committedRuntimeLayout);
  const [uiRuntimeLayout, setUiRuntimeLayout] =
    useState<PivotRuntimeLayout>(runtimeLayout);
  const uiRuntimeLayoutRef = useRef(runtimeLayout);
  const updateUiRuntimeLayout = useCallback((layout: PivotRuntimeLayout) => {
    uiRuntimeLayoutRef.current = layout;
    setUiRuntimeLayout(layout);
  }, []);
  const [uiSelectedFilters, setUiSelectedFilters] = useState<
    Record<string, DataRecordValue[]>
  >(selectedFilters ?? EMPTY_SELECTED_FILTERS);
  const lastPersistedRuntimeLayoutRef = useRef(runtimeLayout);
  const pendingPersistedRuntimeLayoutSyncRef = useRef(false);
  const selectedFiltersFromProps = selectedFilters ?? EMPTY_SELECTED_FILTERS;
  const lastPersistedSelectionRef = useRef(selectedFiltersFromProps);
  const pendingPersistedSelectionSyncRef = useRef(false);
  const suppressStalePersistedFilterRestoreRef = useRef(false);
  const selectedFiltersFromFormData =
    formData.pivotSelectedFilters ?? EMPTY_SELECTED_FILTERS;
  const selectedFiltersFromOwnState =
    (ownState?.pivotSelectedFilters as
      | Record<string, DataRecordValue[]>
      | undefined) ?? EMPTY_SELECTED_FILTERS;
  const {
    selectedFiltersForTreeSync,
    persistedInteractionFilters,
    persistedSelectedFilters,
  } = useMemo(
    () =>
      buildRuntimeSelectionSyncState({
        isUserControlled,
        dimensions: dimensionList,
        selectedFiltersFromFormData,
        selectedFiltersFromOwnState,
        selectedFiltersFromProps,
        committedFilters,
      }),
    [
      committedFilters,
      dimensionList,
      isUserControlled,
      selectedFiltersFromFormData,
      selectedFiltersFromOwnState,
      selectedFiltersFromProps,
    ],
  );

  useEffect(() => {
    const propSync = prepareRuntimeLayoutPropSync({
      isUserControlled,
      isDashboardContext,
      isDashboardRuntimeSync,
      pendingPersistedRuntimeLayoutSync:
        pendingPersistedRuntimeLayoutSyncRef.current,
      hasPendingSeamlessLayout: pendingSeamlessLayoutRef.current !== null,
      runtimeLayout,
      lastPersistedRuntimeLayout: lastPersistedRuntimeLayoutRef.current,
    });
    if (propSync.shouldSyncCommittedRuntimeLayout) {
      committedRuntimeLayoutRef.current = runtimeLayout;
      setCommittedRuntimeLayout(current =>
        isSameRuntimeLayout(current, runtimeLayout) ? current : runtimeLayout,
      );
    }
    if (propSync.hasPersistedRuntimeLayoutSyncSettled) {
      pendingPersistedRuntimeLayoutSyncRef.current = false;
    }
    if (propSync.shouldSyncUiRuntimeLayout) {
      updateUiRuntimeLayout(runtimeLayout);
    }
  }, [
    isDashboardContext,
    isDashboardRuntimeSync,
    isUserControlled,
    runtimeLayout,
    updateUiRuntimeLayout,
  ]);
  const { appliedLayoutFormData } = resolveAppliedInteractionLayout({
    isUserControlled,
    appliedFormData,
    formData,
    runtimeLayout,
    committedRuntimeLayout: committedRuntimeLayoutRef.current,
    appliedDimensionKeys,
  });
  const fetchFormData = useMemo(() => {
    if (!isUserControlled) {
      return appliedLayoutFormData;
    }
    return buildSelectionFilteredFormData({
      formData: appliedLayoutFormData,
      selection: committedFilters,
    });
  }, [appliedLayoutFormData, committedFilters, isUserControlled]);

  const upstreamDashboardQueryContextSignature = useMemo(() => {
    if (!isDashboardRuntimeSync) {
      return null;
    }
    return buildSeamlessRuntimeUpstreamSignature(queryFormData);
  }, [isDashboardRuntimeSync, queryFormData]);

  const upstreamSeamlessSignature =
    upstreamDashboardQueryContextSignature ?? '';
  const hasLocalSyncForCurrentDashboardQueryContext =
    isDashboardContext &&
    upstreamDashboardQueryContextSignature !== null &&
    lastLocalSyncDashboardQueryContextRef.current ===
      upstreamDashboardQueryContextSignature;
  const shouldSyncCommittedTreeFromProps = shouldSyncCommittedRuntimeFromProps({
    isUserControlled,
    hasLocalSyncForCurrentDashboardQueryContext,
    persistedInteractionFilters,
    runtimeLayout,
    committedRuntimeLayout,
    selectedFiltersForTreeSync,
    committedFilters,
  });
  useEffect(() => {
    if (
      isUserControlled &&
      pendingPersistedSelectionSyncRef.current &&
      isEqual(persistedSelectedFilters, lastPersistedSelectionRef.current)
    ) {
      pendingPersistedSelectionSyncRef.current = false;
    }
    if (
      shouldSyncPersistedSelectedFilters({
        isUserControlled,
        pendingPersistedSelectionSync: pendingPersistedSelectionSyncRef.current,
        persistedSelectedFilters,
        committedFilters,
        uiSelectedFilters,
        suppressStalePersistedFilterRestore:
          suppressStalePersistedFilterRestoreRef.current,
      })
    ) {
      setCommittedFilters(persistedSelectedFilters);
      setUiSelectedFilters(persistedSelectedFilters);
    }
  }, [
    committedFilters,
    isUserControlled,
    persistedSelectedFilters,
    uiSelectedFilters,
  ]);

  const persistRuntimeState = useCallback(
    (
      layout: PivotRuntimeLayout,
      filters: Record<string, DataRecordValue[]>,
    ) => {
      const persistencePlan = prepareRuntimeStatePersistence({
        layout,
        selection: filters,
        isDashboardRuntimeSync,
        lastPersistedRuntimeLayout: lastPersistedRuntimeLayoutRef.current,
        lastPersistedSelection: lastPersistedSelectionRef.current,
        upstreamDashboardQueryContextSignature,
      });
      if (persistencePlan.persistedRuntimeLayout) {
        lastPersistedRuntimeLayoutRef.current =
          persistencePlan.persistedRuntimeLayout;
        pendingPersistedRuntimeLayoutSyncRef.current = true;
      }
      if (persistencePlan.localSyncDashboardQueryContext !== undefined) {
        lastLocalSyncDashboardQueryContextRef.current =
          persistencePlan.localSyncDashboardQueryContext;
      }
      if (persistencePlan.persistedSelection) {
        lastPersistedSelectionRef.current = persistencePlan.persistedSelection;
        pendingPersistedSelectionSyncRef.current = true;
      }
      committedRuntimeLayoutRef.current = layout;
      setCommittedRuntimeLayout(current =>
        isSameRuntimeLayout(current, layout) ? current : layout,
      );
      if (setControlValue) {
        setControlValue('pivotRuntimeLayout', layout);
        setControlValue('pivotSelectedFilters', filters);
      }
      if (shouldPersistOwnState) {
        const nextOwnState = mergeOwnState(persistencePlan.ownStatePatch);
        setDataMask({ ownState: { ...nextOwnState } });
      }
    },
    [
      isDashboardRuntimeSync,
      mergeOwnState,
      setControlValue,
      setDataMask,
      shouldPersistOwnState,
      upstreamDashboardQueryContextSignature,
    ],
  );

  const {
    seamlessLoading,
    seamlessWarnings,
    seamlessError,
    pendingDisplaySnapshot,
    applySeamlessUpdate,
    clearPendingDisplaySnapshot,
    resetSeamlessRuntimeState,
  } = usePivotSeamlessRuntimeUpdate({
    dimensionKeys,
    metricKeys,
    baseFormData: fetchFormDataBaseWithFormatters,
    sourceFormData: formData,
    upstreamSignature: upstreamSeamlessSignature,
    displaySnapshotRef,
    pendingSeamlessLayoutRef,
    seamlessSyncRef: lastSeamlessSyncRef,
    expandedRowsRef: expandedRowsForSeamlessRef,
    expandedColsRef: expandedColsForSeamlessRef,
    pendingRowsRef: pendingRowsForSeamlessRef,
    pendingColsRef: pendingColsForSeamlessRef,
    commitTree: setCommittedTree,
    commitFactBatches: setCommittedFactBatches,
    commitFilters: setCommittedFilters,
    commitUiRuntimeLayout: updateUiRuntimeLayout,
    persistRuntimeState,
  });

  useEffect(() => {
    // Ignore stale upstream updates while a local interaction update is still
    // pending.
    if (!shouldSyncCommittedTreeFromProps) {
      return;
    }
    setCommittedTree(data);
    setCommittedFactBatches(factBatches);
    resetSeamlessRuntimeState();
  }, [
    data,
    factBatches,
    resetSeamlessRuntimeState,
    shouldSyncCommittedTreeFromProps,
  ]);

  const handleRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const action = prepareSeamlessRuntimeLayoutChange({
        nextLayout,
        dimensionKeys,
        metricKeys,
        factBatches: committedFactBatches,
        pendingSeamlessLayout: pendingSeamlessLayoutRef.current,
        committedRuntimeLayout: committedRuntimeLayoutRef.current,
        selection: uiSelectedFilters,
        upstreamSignature: upstreamSeamlessSignature,
      });
      if (action.kind === 'fetch') {
        pendingSeamlessLayoutRef.current = action.runtimeLayout;
        updateUiRuntimeLayout(action.runtimeLayout);
        applySeamlessUpdate(action.runtimeLayout, uiSelectedFilters);
        return;
      }
      updateUiRuntimeLayout(action.runtimeLayout);
      persistRuntimeState(action.runtimeLayout, uiSelectedFilters);
      lastSeamlessSyncRef.current = action.syncSnapshot;
    },
    [
      applySeamlessUpdate,
      committedFactBatches,
      dimensionKeys,
      metricKeys,
      persistRuntimeState,
      uiSelectedFilters,
      updateUiRuntimeLayout,
      upstreamSeamlessSignature,
    ],
  );

  useEffect(() => {
    const updatePlan = prepareSeamlessRuntimeUpdateEffect({
      upstreamDashboardQueryContextSignature,
      previousUpstreamState: lastUpstreamQueryContextRef.current,
      data,
      isUserControlled,
      isDashboardRuntimeSync,
      persistedInteractionFilters,
      committedFactBatches,
      committedRuntimeLayout,
      committedFilters,
      uiSelectedFilters,
      lastSync: lastSeamlessSyncRef.current,
      uiRuntimeLayout,
      upstreamSeamlessSignature,
    });
    lastUpstreamQueryContextRef.current = updatePlan.nextUpstreamState;
    updatePlan.updates.forEach(({ runtimeLayout: nextLayout, selection }) => {
      applySeamlessUpdate(nextLayout, selection);
    });
  }, [
    applySeamlessUpdate,
    committedFactBatches,
    committedFilters,
    committedRuntimeLayout,
    data,
    isDashboardRuntimeSync,
    isUserControlled,
    persistedInteractionFilters,
    uiRuntimeLayout,
    uiSelectedFilters,
    upstreamDashboardQueryContextSignature,
    upstreamSeamlessSignature,
  ]);

  const dimensionLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    dimensionList.forEach(dimension => {
      const key = getStableColumnKey(dimension);
      const baseLabel = getColumnLabel(dimension);
      const label =
        typeof dimension === 'string'
          ? (resolvedVerboseMap[key] ?? baseLabel)
          : baseLabel;
      map.set(key, label);
    });
    return map;
  }, [dimensionList, resolvedVerboseMap]);

  const layoutResult = usePivotLayout({
    data: dataForRender,
    formData: appliedLayoutFormData,
    metricsLayout,
    startCollapsed,
    initialDepth,
    expandRowsLevel,
    expandColumnsLevel,
    rowTotals,
    colTotals,
    rowSubTotals,
    rowSubtotalLevels,
    colSubtotalLevels,
    rowTotalPosition,
    rowSubtotalPosition,
    colTotalPosition,
    colSubtotalPosition,
  });
  const layoutGroupbyRows = layoutResult.layout.groupbyRows;
  const rowAxisLabels = useMemo(
    () =>
      layoutGroupbyRows.map(dimension => {
        const baseLabel = getColumnLabel(dimension);
        const stableKey = getStableColumnKey(dimension);
        return (
          resolvedVerboseMap[stableKey] ??
          (typeof dimension === 'string'
            ? (resolvedVerboseMap[dimension] ?? baseLabel)
            : baseLabel)
        );
      }),
    [layoutGroupbyRows, resolvedVerboseMap],
  );
  const {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    pendingRows,
    pendingCols,
    errorMessage,
    warnings,
    isHydrating,
    handleToggle,
    handleRetry,
  } = useExpansionEngine({
    data: dataForRender,
    factBatches: factBatchesForRender,
    expandedStateSignature: layoutResult.expandedStateSignature,
    expandedStateSharedSignature: layoutResult.expandedStateSharedSignature,
    fetchFormData,
    groupbyRowKeys: layoutResult.groupbyRowKeys,
    groupbyColumnKeys: layoutResult.groupbyColumnKeys,
    groupbyRowsLength: layoutResult.layout.groupbyRows.length,
    groupbyColumnsLength: layoutResult.layout.groupbyColumns.length,
    resolvedExpandRowsLevel: layoutResult.resolvedExpandRowsLevel,
    resolvedExpandColumnsLevel: layoutResult.resolvedExpandColumnsLevel,
    shouldExpandMetricRows: layoutResult.shouldExpandMetricRows,
    shouldExpandMetricCols: layoutResult.shouldExpandMetricCols,
    metricLabelSet: layoutResult.metricLabelSet,
    metricIndexForRows: layoutResult.metricIntentIndexOnRows,
    metricIndexForCols: layoutResult.metricIntentIndexOnCols,
    isMetricTokenValue: layoutResult.isMetricTokenValue,
    pivotProgram: layoutResult.layout.pivotProgram,
    countDimDepth: layoutResult.countEngineDimDepth,
    expandRowsLevelRaw: layoutResult.expandRowsLevelRaw,
    expandColumnsLevelRaw: layoutResult.expandColumnsLevelRaw,
    setControlValue,
    setDataMask: shouldPersistOwnState ? setDataMask : undefined,
    mergeOwnState: shouldPersistOwnState ? mergeOwnState : undefined,
    persistedExpansionState:
      appliedLayoutFormData.pivotExpansionState ??
      ownState?.pivotExpansionState,
    shouldPersistExpansionState: persistExpansionState,
    pruneMergedTree: layoutResult.pruneMergedTree,
  });

  useSyncRef(expandedRowsForSeamlessRef, expandedRows);
  useSyncRef(expandedColsForSeamlessRef, expandedCols);
  useSyncRef(pendingRowsForSeamlessRef, pendingRows);
  useSyncRef(pendingColsForSeamlessRef, pendingCols);

  useEffect(() => {
    if (
      pendingDisplaySnapshot &&
      isSeamlessDisplaySnapshotSettled({
        seamlessLoading,
        isHydrating,
        loadingKeys,
        pendingRows,
        pendingCols,
      })
    ) {
      clearPendingDisplaySnapshot();
    }
  }, [
    clearPendingDisplaySnapshot,
    isHydrating,
    loadingKeys,
    pendingCols,
    pendingDisplaySnapshot,
    pendingRows,
    seamlessLoading,
  ]);

  const renderModelResult = usePivotRenderModel({
    tree,
    expandedRows,
    expandedCols,
    formData: appliedLayoutFormData,
    rowOrder,
    colOrder,
    colTypeMap,
    rowTotals,
    colTotals,
    rowSubTotals,
    layout: layoutResult,
    uiColumnSort: activeColumnSort,
  });
  const { renderTree } = renderModelResult;

  const isColumnSortable = useCallback(
    (node: PivotTreeNode) =>
      Boolean(resolvePivotColumnSortMetric({ node, layout: layoutResult })),
    [layoutResult],
  );

  const getColumnSortOrder = useCallback(
    (node: PivotTreeNode) =>
      getPivotColumnSortOrder({ current: activeColumnSort, node }),
    [activeColumnSort],
  );

  const handleColumnSort = useCallback(
    (node: PivotTreeNode) => {
      setActiveColumnSort(current => {
        const next = buildPivotColumnSortStateForClick({
          current,
          node,
          layout: layoutResult,
          columnNodes: renderTree.cols,
        });
        return next === undefined ? current : next;
      });
    },
    [layoutResult, renderTree.cols],
  );

  useEffect(() => {
    setActiveColumnSort(current => {
      const next = reconcilePivotColumnSortState({
        current,
        layout: layoutResult,
        columnNodes: renderTree.cols,
      });
      return next === current ? current : next;
    });
  }, [layoutResult, renderTree.cols]);

  const treeDimensionFilterValues = useMemo(
    () =>
      buildTreeDimensionFilterValues({
        dimensions: dimensionList,
        rows: renderTree.rows,
        cols: renderTree.cols,
        layout: layoutResult,
        verboseMap: resolvedVerboseMap,
      }),
    [
      dimensionList,
      layoutResult,
      renderTree.cols,
      renderTree.rows,
      resolvedVerboseMap,
    ],
  );
  const {
    values: dimensionFilterValues,
    loading: dimensionFilterLoading,
    fetchValues: handleFetchDimensionValues,
  } = useDimensionFilterValues({
    dimensions: dimensionList,
    treeValues: treeDimensionFilterValues,
    formData: fetchFormDataBaseWithFormatters,
    selectedFilters: uiSelectedFilters,
    colTypeMap,
  });

  const handleDimensionFilterChange = useCallback(
    (
      dimension: PivotTableProps['groupbyRows'][number],
      values: DataRecordValue[],
    ) => {
      const dimensionKey = getStableColumnKey(dimension);
      const { selection: nextSelected, suppressStalePersistedFilterRestore } =
        applyDimensionFilterSelectionChange({
          selection: uiSelectedFilters,
          dimensionKey,
          values,
        });
      suppressStalePersistedFilterRestoreRef.current =
        suppressStalePersistedFilterRestore;
      setUiSelectedFilters(nextSelected);
      applySeamlessUpdate(uiRuntimeLayout, nextSelected);
    },
    [applySeamlessUpdate, uiRuntimeLayout, uiSelectedFilters],
  );

  const handleClearAllFilters = useCallback(() => {
    const update = buildClearSelectedFiltersUpdate(uiSelectedFilters);
    if (!update) {
      return;
    }
    suppressStalePersistedFilterRestoreRef.current =
      update.suppressStalePersistedFilterRestore;
    const nextSelected = update.selection;
    setUiSelectedFilters(nextSelected);
    applySeamlessUpdate(uiRuntimeLayout, nextSelected);
  }, [applySeamlessUpdate, uiRuntimeLayout, uiSelectedFilters]);

  const tableWidth = isUserControlled
    ? Math.max(
        0,
        width - INTERACTION_PANEL_WIDTH - INTERACTION_SIDE_CHIPS_WIDTH,
      )
    : width;

  const { headerOffset, headerRowOffsets, headerRef } = useStickyHeaders({
    enabled: resolvedStickyHeaders,
    columnHeaderRows: renderModelResult.renderModel.columnHeaderRows,
    width: tableWidth,
  });

  const formatting = usePivotFormatting({
    tree: renderTree,
    renderModel: renderModelResult.renderModel,
    expandedRows: renderModelResult.expandedRowsForRender,
    formData: appliedLayoutFormData,
    layout: layoutResult,
    rowValuesMap: renderModelResult.rowValuesMap,
    colValuesMap: renderModelResult.colValuesMap,
    getNodeDimDepth: renderModelResult.getNodeDimDepth,
    rowSubTotals,
    valueFormat,
    columnFormats,
    currencyFormats,
    allowRenderHtml,
    pivotTheme,
    pivotThemeColors,
    theme,
  });

  const interactions = usePivotInteractions({
    emitCrossFilters,
    setDataMask,
    mergeOwnState,
    tree,
    treeDataSignature: formatting.treeDataSignature,
    layout: layoutResult,
    onContextMenu,
    ownState,
    dateFormatters: resolvedDateFormatters,
    timeGrainSqla,
  });

  const combinedWarnings = useMemo(
    () => [...warnings, ...seamlessWarnings],
    [seamlessWarnings, warnings],
  );
  const activeErrorMessage = seamlessError ?? errorMessage;
  const cornerLoaderVisible = isUserControlled
    ? seamlessLoading || isHydrating
    : isHydrating;
  const tableHeight = isUserControlled
    ? Math.max(0, height - INTERACTION_TOP_CHIPS_HEIGHT)
    : height;
  const liveDisplaySnapshot: PivotDisplaySnapshot = {
    renderModel: renderModelResult.renderModel,
    tree: renderTree,
    expandedRows: renderModelResult.expandedRowsForRender,
    expandedCols: renderModelResult.expandedColsForRender,
  };
  displaySnapshotRef.current = liveDisplaySnapshot;
  const activeDisplaySnapshot = pendingDisplaySnapshot ?? liveDisplaySnapshot;
  const exportChartId =
    typeof formData.slice_id === 'number' ||
    typeof formData.slice_id === 'string'
      ? formData.slice_id
      : undefined;
  const sharedPivotViewProps: Omit<PivotViewProps, 'height' | 'width'> = {
    renderModel: activeDisplaySnapshot.renderModel,
    tree: activeDisplaySnapshot.tree,
    expandedRows: activeDisplaySnapshot.expandedRows,
    expandedCols: activeDisplaySnapshot.expandedCols,
    errorMessage: activeErrorMessage,
    onRetry: handleRetry,
    warnings: combinedWarnings,
    showGlobalLoader: false,
    showCornerLoader: cornerLoaderVisible,
    stickyHeaders: resolvedStickyHeaders,
    headerOffset,
    headerRowOffsets,
    headerRef,
    colTotalPosition: layoutResult.resolvedColTotalPosition,
    formatting,
    onToggleNode: handleToggle,
    onSortColumn: handleColumnSort,
    isColumnSortable,
    getColumnSortOrder,
    shouldShowToggle: renderModelResult.shouldShowToggle,
    showSpinner: key =>
      !pendingDisplaySnapshot && !seamlessLoading && loadingKeys.has(key),
    isRowAggregateBold: renderModelResult.isRowAggregateBold,
    isColAggregateBold: renderModelResult.isColAggregateBold,
    getNodeDimDepth: renderModelResult.getNodeDimDepth,
    isMetricGrandTotalNode: layoutResult.isMetricGrandTotalNode,
    emitCrossFilters,
    handleCellClick: interactions.handleCellClick,
    handleCellKeyDown: interactions.handleCellKeyDown,
    handleCellContextMenu: interactions.handleCellContextMenu,
    rowAxisLabels,
    exportChartId,
  };
  const hasMetrics = metricKeys.length > 0;
  const rowChips = useMemo(
    () =>
      buildInteractionChips({
        axis: 'row',
        layout: uiRuntimeLayout,
        dimensionLabelMap,
        hasMetrics,
        valueLabel: t('Value'),
      }),
    [dimensionLabelMap, hasMetrics, uiRuntimeLayout],
  );
  const colChips = useMemo(
    () =>
      buildInteractionChips({
        axis: 'col',
        layout: uiRuntimeLayout,
        dimensionLabelMap,
        hasMetrics,
        valueLabel: t('Value'),
      }),
    [dimensionLabelMap, hasMetrics, uiRuntimeLayout],
  );
  const handleChipRemove = useCallback(
    (dimensionKey: string) => {
      handleRuntimeLayoutChange(
        removeDimensionFromLayout(uiRuntimeLayoutRef.current, dimensionKey),
      );
    },
    [handleRuntimeLayoutChange],
  );

  const handleDimensionDrop = useCallback(
    (
      dimensionKey: string,
      targetAxis: PivotAxis,
      targetChipIndex: number | undefined,
      insertBeforeValue: boolean,
      sourceAxis?: PivotAxis,
      sourceChipIndex?: number,
    ) => {
      const nextLayout = applyDimensionDrag(uiRuntimeLayoutRef.current, {
        dimensionKey,
        targetAxis,
        targetChipIndex,
        insertBeforeValue,
        sourceAxis,
        sourceChipIndex,
        metricsAvailable: hasMetrics,
      });
      handleRuntimeLayoutChange(nextLayout);
    },
    [handleRuntimeLayoutChange, hasMetrics],
  );

  const handleValueDrop = useCallback(
    (
      targetAxis: PivotAxis,
      targetChipIndex: number | undefined,
      sourceAxis: PivotAxis,
      sourceChipIndex?: number,
    ) => {
      const nextLayout = applyValueDrag(uiRuntimeLayoutRef.current, {
        targetAxis,
        targetChipIndex,
        sourceAxis,
        sourceChipIndex,
        metricsAvailable: hasMetrics,
      });
      handleRuntimeLayoutChange(nextLayout);
    },
    [handleRuntimeLayoutChange, hasMetrics],
  );

  const shouldDelayRender =
    !isUserControlled &&
    datasourceId !== null &&
    (metaState === 'loading' ||
      (metaState === 'idle' && (needsVerboseMap || needsDateFormatters)));

  if (shouldDelayRender) {
    return (
      <MetaLoadingWrap>
        <Loading />
      </MetaLoadingWrap>
    );
  }

  return isUserControlled ? (
    <PivotInteractionLayout
      height={height}
      tableHeight={tableHeight}
      tableWidth={tableWidth}
      rowChips={rowChips}
      colChips={colChips}
      onDropDimension={handleDimensionDrop}
      onDropValue={handleValueDrop}
      onRemoveDimension={handleChipRemove}
      panel={
        <PivotInteractionPanel
          dimensions={dimensionList}
          metrics={metricsForUi}
          measureLeavesByMetric={
            formData.measureLeavesByMetricBase ?? formData.measureLeavesByMetric
          }
          metricLabelMap={formData.metricLabelMap}
          dimensionLabelMap={resolvedVerboseMap}
          dateFormatters={resolvedDateFormatters}
          dimensionFilterValues={dimensionFilterValues}
          dimensionFilterLoading={dimensionFilterLoading}
          selectedFilters={uiSelectedFilters}
          onFilterChange={handleDimensionFilterChange}
          onClearFilters={handleClearAllFilters}
          onFilterValuesOpen={handleFetchDimensionValues}
          onFilterValuesSearch={handleFetchDimensionValues}
          runtimeLayout={uiRuntimeLayout}
          onChange={handleRuntimeLayoutChange}
        />
      }
    >
      <PivotTableView
        {...sharedPivotViewProps}
        height={tableHeight}
        width={tableWidth}
      />
    </PivotInteractionLayout>
  ) : (
    <PivotTableView
      {...sharedPivotViewProps}
      height={height}
      width={width}
      showGlobalLoader={isHydrating}
      showCornerLoader={isHydrating}
    />
  );
}

export default PivotTableChart;
