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
  type MutableRefObject,
} from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { isEqual } from 'lodash';
import {
  AppSection,
  DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  getTimeFormatter,
  SMART_DATE_ID,
  SupersetClient,
  supersetTheme,
  TimeFormats,
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
  buildTreeDimensionFilterValues,
  firstSelectedFilters,
  normalizePivotSelectedFilters,
} from './pivot/filters';
import { useDimensionFilterValues } from './pivot/chart/useDimensionFilterValues';
import { supersetChartDataClient } from './pivot/data/SupersetChartDataClient';
import { type ChartDataWarning } from './pivot/data/ChartDataClient';
import {
  applyDimensionDrag,
  applyValueDrag,
  buildInteractionChips,
  removeDimensionFromLayout,
} from './pivot/layout/interactionDrag';
import {
  getMetricKeys,
  getStableColumnKey,
  coerceEpochMsStringToNumber,
} from './utils';
import {
  buildPivotColumnSortStateForClick,
  getPivotColumnSortOrder,
  reconcilePivotColumnSortState,
  resolvePivotColumnSortMetric,
  type PivotColumnSortState,
} from './pivot/chart/columnSort';
import { type PivotFactStoreBatch } from './pivot/runtime/ingestQueryResults';
import { createLatestRequestLifecycle } from './pivot/runtime/requestLifecycle';
import {
  buildSeamlessRuntimeSyncSnapshot,
  buildSeamlessRuntimeUpstreamSignature,
  fetchAndMaterializeSeamlessRuntimeUpdate,
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

const EMPTY_SELECTED_FILTERS: Record<string, DataRecordValue[]> = {};
const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

const { DATABASE_DATETIME } = TimeFormats;

const MetaLoadingWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
`;

type PivotViewProps = ComponentProps<typeof PivotTableView>;
type PivotDisplaySnapshot = Pick<
  PivotViewProps,
  'renderModel' | 'tree' | 'expandedRows' | 'expandedCols'
>;

type DatasetColumnMeta = {
  column_name?: string;
  verbose_name?: string | null;
  python_date_format?: string | null;
};

type DatasetMeta = {
  verboseMap?: Record<string, string>;
  verbose_map?: Record<string, string>;
  columns?: DatasetColumnMeta[];
};

type MetaState = 'idle' | 'loading' | 'ready' | 'failed';

const datasetMetaCache = new Map<number, DatasetMeta>();

const buildDateFormattersFromColumns = (
  columns: DatasetColumnMeta[],
  verboseMap: Record<string, string>,
) =>
  columns.reduce<Record<string, (value: DataRecordValue) => string>>(
    (acc, column) => {
      const columnName = column.column_name;
      const format = column.python_date_format;
      if (columnName && typeof format === 'string' && format.length > 0) {
        const base = getTimeFormatter(format);
        const formatter = (value: DataRecordValue) =>
          base(
            coerceEpochMsStringToNumber(value) as
              | number
              | Date
              | null
              | undefined,
          );
        acc[columnName] = formatter;
        const verbose = column.verbose_name || verboseMap[columnName];
        if (verbose) {
          acc[verbose] = formatter;
        }
      }
      return acc;
    },
    {},
  );

const useSyncRef = <Value,>(ref: MutableRefObject<Value>, value: Value) => {
  useEffect(() => {
    const targetRef = ref;
    targetRef.current = value;
  }, [ref, value]);
};

function PivotTableChart(props: PivotTableProps) {
  const {
    data,
    factBatches = EMPTY_FACT_BATCHES,
    formData,
    queryFormData,
    width,
    height,
    metrics,
    groupbyRows,
    groupbyColumns,
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

  const [extraVerboseMap, setExtraVerboseMap] = useState<
    Record<string, string>
  >({});
  const [extraDateFormatters, setExtraDateFormatters] = useState<
    Record<string, (value: DataRecordValue) => string>
  >({});
  const [metaState, setMetaState] = useState<MetaState>('idle');
  const resolvedVerboseMap = useMemo(
    () => ({ ...extraVerboseMap, ...(verboseMap ?? {}) }),
    [extraVerboseMap, verboseMap],
  );
  const resolvedDateFormatters = useMemo(() => {
    const merged: Record<string, PivotTableProps['dateFormatters'][string]> = {
      // Prefer dataset column formats (python_date_format) when available.
      // Dashboard payloads may omit python_date_format, so transformProps falls
      // back to a generic formatter. The dataset meta fetch should override
      // that fallback.
      ...dateFormatters,
      ...extraDateFormatters,
    };

    const temporalLookup = fetchFormDataBase.temporal_columns_lookup ?? {};
    const shouldCreateFallback =
      Object.keys(temporalLookup).length > 0 &&
      typeof fetchFormDataBase.dateFormat === 'string';
    if (!shouldCreateFallback) {
      return merged;
    }

    const formatId =
      fetchFormDataBase.dateFormat === SMART_DATE_ID
        ? DATABASE_DATETIME
        : fetchFormDataBase.dateFormat;
    const base = getTimeFormatter(formatId);
    const fallbackFormatter = (value: DataRecordValue) => {
      const normalized = coerceEpochMsStringToNumber(value);
      if (normalized === null || normalized === undefined) {
        return `${normalized}`;
      }
      if (typeof normalized === 'number' || normalized instanceof Date) {
        return base(normalized as number | Date | null | undefined);
      }
      if (typeof normalized === 'string') {
        const parsed = Date.parse(normalized);
        if (Number.isFinite(parsed)) {
          return base(parsed);
        }
      }
      return String(value);
    };

    Object.entries(temporalLookup).forEach(([columnLabel, isTemporal]) => {
      if (!isTemporal || merged[columnLabel]) {
        return;
      }
      merged[columnLabel] = fallbackFormatter;
      const verbose = resolvedVerboseMap[columnLabel];
      if (verbose && !merged[verbose]) {
        merged[verbose] = fallbackFormatter;
      }
    });

    return merged;
  }, [
    dateFormatters,
    extraDateFormatters,
    fetchFormDataBase.dateFormat,
    fetchFormDataBase.temporal_columns_lookup,
    resolvedVerboseMap,
  ]);

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
  const [seamlessLoading, setSeamlessLoading] = useState(false);
  const [seamlessWarnings, setSeamlessWarnings] = useState<ChartDataWarning[]>(
    [],
  );
  const [seamlessError, setSeamlessError] = useState<string | undefined>(
    undefined,
  );
  const [activeColumnSort, setActiveColumnSort] =
    useState<PivotColumnSortState | null>(null);
  const [pendingDisplaySnapshot, setPendingDisplaySnapshot] =
    useState<PivotDisplaySnapshot | null>(null);
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
  const seamlessRequestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );
  const seamlessMaterializationLifecycle = useMemo(
    () => createLatestRequestLifecycle(),
    [],
  );

  const treeRef = useRef<PivotTableProps['data']>(dataForRender);
  const ownStateRef = useRef<JsonObject>(ownState ?? {});
  useSyncRef(ownStateRef, ownState ?? {});

  const mergeOwnState = useCallback((partial: JsonObject) => {
    const next = { ...ownStateRef.current, ...partial };
    ownStateRef.current = next;
    return next;
  }, []);

  const dimensionList = useMemo(
    () => ensureIsArray(formData.dimensions),
    [formData.dimensions],
  );
  const dimensionKeys = useMemo(
    () => dimensionList.map(dimension => getStableColumnKey(dimension)),
    [dimensionList],
  );
  const appliedDimensionKeys = useMemo(
    () =>
      ensureIsArray(appliedFormData.dimensions).map(dimension =>
        getStableColumnKey(dimension),
      ),
    [appliedFormData.dimensions],
  );
  const datasourceId = useMemo(() => {
    const datasource = formData.datasource || '';
    const [idPart] = datasource.split('__');
    const id = Number(idPart);
    return Number.isFinite(id) ? id : null;
  }, [formData.datasource]);
  useEffect(() => {
    setMetaState('idle');
    setExtraVerboseMap({});
    setExtraDateFormatters({});
  }, [datasourceId]);
  const needsVerboseMap = useMemo(
    () =>
      dimensionList.some(dimension => {
        const key = getStableColumnKey(dimension);
        const mapped =
          resolvedVerboseMap[key] ||
          (typeof dimension === 'string'
            ? resolvedVerboseMap[dimension]
            : null);
        return !mapped;
      }),
    [dimensionList, resolvedVerboseMap],
  );
  const needsDateFormatters = useMemo(() => {
    const lookup = formData.temporal_columns_lookup ?? {};
    return Object.entries(lookup).some(([key, isTemporal]) => {
      if (!isTemporal) {
        return false;
      }
      const verbose = resolvedVerboseMap[key];
      return (
        !resolvedDateFormatters[key] &&
        (!verbose || !resolvedDateFormatters[verbose])
      );
    });
  }, [
    formData.temporal_columns_lookup,
    resolvedDateFormatters,
    resolvedVerboseMap,
  ]);

  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
    };

    if (datasourceId === null) {
      setMetaState('ready');
      return cleanup;
    }
    if (!needsVerboseMap && !needsDateFormatters) {
      setMetaState('ready');
      return cleanup;
    }
    const cached = datasetMetaCache.get(datasourceId);
    if (cached) {
      const cachedVerbose = cached.verboseMap ?? cached.verbose_map ?? {};
      setExtraVerboseMap(cachedVerbose);
      const cachedColumns = Array.isArray(cached.columns) ? cached.columns : [];
      setExtraDateFormatters(
        buildDateFormattersFromColumns(cachedColumns, cachedVerbose),
      );
      setMetaState('ready');
      return cleanup;
    }
    setMetaState('loading');
    SupersetClient.get({ endpoint: `/api/v1/dataset/${datasourceId}` })
      .then(({ json }) => {
        if (cancelled) {
          return;
        }
        const { result } = json as { result?: DatasetMeta };
        if (!result) {
          setMetaState('failed');
          return;
        }
        datasetMetaCache.set(datasourceId, result);
        const verboseFromApi = result.verboseMap ?? result.verbose_map ?? {};
        const columnsFromApi = Array.isArray(result.columns)
          ? result.columns
          : [];
        setExtraVerboseMap(verboseFromApi);
        setExtraDateFormatters(
          buildDateFormattersFromColumns(columnsFromApi, verboseFromApi),
        );
        setMetaState('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setMetaState('failed');
        }
      });
    return cleanup;
  }, [datasourceId, needsDateFormatters, needsVerboseMap]);
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
  const selectedFiltersForTreeSync = useMemo(
    () =>
      isUserControlled
        ? firstSelectedFilters(
            selectedFiltersFromFormData,
            selectedFiltersFromOwnState,
            selectedFiltersFromProps,
          )
        : selectedFiltersFromProps,
    [
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
  const {
    appliedLayoutFormData,
    layoutMetrics,
    layoutGroupbyRows,
    layoutGroupbyColumns,
    layoutMetricsLayout,
  } = useMemo(
    () =>
      resolveAppliedInteractionLayout({
        isUserControlled,
        appliedFormData,
        formData,
        metrics,
        groupbyRows,
        groupbyColumns,
        metricsLayout,
        runtimeLayout,
        committedRuntimeLayout,
        appliedDimensionKeys,
      }),
    [
      appliedDimensionKeys,
      appliedFormData,
      committedRuntimeLayout,
      formData,
      groupbyColumns,
      groupbyRows,
      isUserControlled,
      metrics,
      metricsLayout,
      runtimeLayout,
    ],
  );
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

  const persistedInteractionFilters = useMemo(() => {
    if (!isUserControlled) {
      return EMPTY_SELECTED_FILTERS;
    }
    return normalizePivotSelectedFilters({
      filters: firstSelectedFilters(
        selectedFiltersFromFormData,
        selectedFiltersFromOwnState,
      ),
      dimensions: dimensionList,
    });
  }, [
    dimensionList,
    isUserControlled,
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
  ]);
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
    // Ignore stale upstream updates while a local interaction update is still
    // pending.
    if (!shouldSyncCommittedTreeFromProps) {
      return;
    }
    seamlessMaterializationLifecycle.invalidate();
    setCommittedTree(data);
    setCommittedFactBatches(factBatches);
    setSeamlessWarnings([]);
    setSeamlessError(undefined);
    setSeamlessLoading(false);
    setPendingDisplaySnapshot(null);
    pendingSeamlessLayoutRef.current = null;
  }, [
    data,
    factBatches,
    seamlessMaterializationLifecycle,
    shouldSyncCommittedTreeFromProps,
  ]);

  const persistedSelectedFilters = useMemo(() => {
    if (!isUserControlled) {
      return normalizePivotSelectedFilters({
        filters: selectedFiltersFromProps,
        dimensions: dimensionList,
      });
    }
    return normalizePivotSelectedFilters({
      filters: firstSelectedFilters(
        selectedFiltersFromFormData,
        selectedFiltersFromOwnState,
        committedFilters,
        selectedFiltersFromProps,
      ),
      dimensions: dimensionList,
    });
  }, [
    committedFilters,
    dimensionList,
    isUserControlled,
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
    selectedFiltersFromProps,
  ]);

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

  const applySeamlessUpdate = useCallback(
    async (
      nextLayout: PivotRuntimeLayout,
      nextFilters: Record<string, DataRecordValue[]>,
    ) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      const displaySnapshot = displaySnapshotRef.current;
      if (displaySnapshot) {
        setPendingDisplaySnapshot(displaySnapshot);
      }
      const updateResult = await fetchAndMaterializeSeamlessRuntimeUpdate({
        requestLifecycle: seamlessRequestLifecycle,
        materializationLifecycle: seamlessMaterializationLifecycle,
        baseFormData: fetchFormDataBaseWithFormatters,
        sourceFormData: formData,
        runtimeLayout: normalized,
        selection: nextFilters,
        expandedRows: expandedRowsForSeamlessRef.current,
        expandedCols: expandedColsForSeamlessRef.current,
        pendingRows: pendingRowsForSeamlessRef.current,
        pendingCols: pendingColsForSeamlessRef.current,
        fetchData: params => supersetChartDataClient.fetch(params),
        onFetchStart: () => {
          setSeamlessLoading(true);
          setSeamlessError(undefined);
        },
        onError: error => {
          setSeamlessError(
            error instanceof Error ? error.message : t('Failed to update data'),
          );
        },
      });
      if (updateResult.status === 'stale') {
        return;
      }
      if (updateResult.status !== 'success') {
        pendingSeamlessLayoutRef.current = null;
        setSeamlessLoading(false);
        return;
      }

      unstable_batchedUpdates(() => {
        setCommittedTree(updateResult.tree);
        setCommittedFactBatches(updateResult.factBatches);
        updateUiRuntimeLayout(normalized);
        setCommittedFilters(nextFilters);
        setSeamlessWarnings(updateResult.warnings);
        persistRuntimeState(normalized, nextFilters);
      });
      lastSeamlessSyncRef.current = buildSeamlessRuntimeSyncSnapshot({
        runtimeLayout: normalized,
        selection: nextFilters,
        upstreamSignature: upstreamSeamlessSignature,
      });
      pendingSeamlessLayoutRef.current = null;
      setSeamlessLoading(false);
    },
    [
      dimensionKeys,
      fetchFormDataBaseWithFormatters,
      formData,
      metricKeys,
      persistRuntimeState,
      seamlessMaterializationLifecycle,
      seamlessRequestLifecycle,
      upstreamSeamlessSignature,
      updateUiRuntimeLayout,
    ],
  );
  const handleRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const action = prepareSeamlessRuntimeLayoutChange({
        nextLayout,
        dimensionKeys,
        metricKeys,
        factBatches: committedFactBatches,
        pendingSeamlessLayout: pendingSeamlessLayoutRef.current,
        committedRuntimeLayout,
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
      committedRuntimeLayout,
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
    metrics: layoutMetrics,
    groupbyRows: layoutGroupbyRows,
    groupbyColumns: layoutGroupbyColumns,
    metricsLayout: layoutMetricsLayout,
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
      setPendingDisplaySnapshot(null);
    }
  }, [
    isHydrating,
    loadingKeys,
    pendingCols,
    pendingDisplaySnapshot,
    pendingRows,
    seamlessLoading,
  ]);

  useSyncRef(treeRef, tree);

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
    groupbyRows: layoutGroupbyRows,
    groupbyColumns: layoutGroupbyColumns,
    metrics: layoutMetrics,
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
    treeRef,
    treeDataSignature: formatting.treeDataSignature,
    groupbyRows: layoutGroupbyRows,
    groupbyColumns: layoutGroupbyColumns,
    metrics: layoutMetrics,
    resolvedMetricsLayout: layoutResult.resolvedMetricsLayout,
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
