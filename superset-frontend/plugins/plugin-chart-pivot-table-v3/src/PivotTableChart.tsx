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
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { isEqual } from 'lodash';
import {
  AppSection,
  DataRecordValue,
  ensureIsArray,
  GenericDataType,
  getColumnLabel,
  getTimeFormatter,
  SMART_DATE_ID,
  SupersetClient,
  supersetTheme,
  TimeFormats,
  type JsonObject,
  type QueryObjectFilterClause,
  styled,
  t,
} from '@superset-ui/core';
import { Loading } from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
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
  isSameRuntimeLayout,
  shouldFetchRuntimeLayout,
} from './pivot/runtime/coverage';
import {
  normalizeRuntimeLayout,
  resolveInteractionFormData,
} from './pivot/layout/resolveInteractionLayout';
import {
  buildSelectionFilterClauses,
  mergeExtraFilters as mergeSelectionExtraFilters,
} from './pivot/update/initialUpdatePlan';
import { supersetChartDataClient } from './pivot/data/SupersetChartDataClient';
import { normalizeFormDataExtraFilters } from './pivot/query/normalizeExtraFormData';
import { type QuerySpec } from './pivot/query/types';
import { type ChartDataWarning } from './pivot/data/ChartDataClient';
import {
  applyDimensionDrag,
  applyValueDrag,
  INTERACTION_DIMENSION_DND_TYPE,
  INTERACTION_VALUE_DND_TYPE,
} from './pivot/layout/interactionDrag';
import {
  findMeasureLeafIdInPath,
  getMetricKeys,
  getStableColumnKey,
  isSubtotalToken,
  coerceEpochMsStringToNumber,
} from './utils';
import {
  buildMeasureLeafOutputKey,
  resolveMeasureSortMetricKey,
} from './pivot/measureLeaves';
import { type PivotFactStoreBatch } from './pivot/runtime/ingestQueryResults';
import { createLatestRequestLifecycle } from './pivot/runtime/requestLifecycle';
import { fetchAndMaterializeSeamlessRuntimeUpdate } from './pivot/runtime/seamlessRuntimeUpdate';
import { stableStringify } from './pivot/shared/stableStringify';

const PANEL_WIDTH = 230;
const TOP_CHIPS_HEIGHT = 36;
const SIDE_CHIPS_WIDTH = 24;
const DIMENSION_VALUES_REQUEST_GROUP = 'pivot-v3-dimension-values';
const DIMENSION_VALUES_QUERY_PREFIX = 'pivot_v3|dimension-values';
const EMPTY_FILTER_VALUES: DataRecordValue[] = [];
const EMPTY_SELECTED_FILTERS: Record<string, DataRecordValue[]> = {};
const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];
const hasSelectedFilters = (
  filters: Record<string, DataRecordValue[]>,
): boolean => Object.keys(filters).length > 0;
const selectedFiltersSignature = (
  filters: Record<string, DataRecordValue[]>,
) => (hasSelectedFilters(filters) ? stableStringify(filters) : null);
const firstSelectedFilters = (
  ...sources: Array<Record<string, DataRecordValue[]>>
) => sources.find(hasSelectedFilters) ?? EMPTY_SELECTED_FILTERS;

const { DATABASE_DATETIME } = TimeFormats;

const buildDimensionValuesQueryName = (dimensionKey: string) =>
  `${DIMENSION_VALUES_QUERY_PREFIX}|${dimensionKey}`;

const buildDimensionValueSearchFilters = ({
  dimension,
  dimensionKey,
  colTypeMap,
  search,
}: {
  dimension: PivotTableProps['groupbyRows'][number];
  dimensionKey: string;
  colTypeMap?: Record<string, GenericDataType>;
  search: string;
}): QueryObjectFilterClause[] => {
  const normalizedSearch = search.trim();
  if (!normalizedSearch) {
    return [];
  }
  const label = getColumnLabel(dimension);
  const dimensionType = colTypeMap?.[label] ?? colTypeMap?.[dimensionKey];
  if (
    dimensionType === GenericDataType.String ||
    (dimensionType === GenericDataType.Numeric &&
      !Number.isNaN(Number(normalizedSearch)))
  ) {
    return [
      {
        col: dimension,
        op: 'ILIKE',
        val: `%${normalizedSearch}%`,
      },
    ];
  }
  return [];
};

const InteractionLayout = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
`;

const InteractionPanelWrap = styled.div`
  width: ${PANEL_WIDTH}px;
  flex: 0 0 ${PANEL_WIDTH}px;
  padding: ${({ theme }) =>
    `${theme.sizeXXS}px ${theme.sizeSM}px ${theme.sizeXXS}px ${theme.sizeXXS}px`};
  border-right: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  height: 100%;
  overflow: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
`;

const InteractionTableWrap = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const MetaLoadingWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
`;

const ChipRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXS}px;
  padding: ${({ theme }) => theme.sizeXXS}px ${({ theme }) => theme.sizeSM}px;
  height: ${TOP_CHIPS_HEIGHT}px;
  border-bottom: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  overflow: hidden;
`;

const ChipRowDropZone = styled.div`
  flex: 1 1 auto;
  min-width: ${({ theme }) => theme.sizeSM}px;
  height: 100%;
`;

const ChipColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeXS}px;
  padding: 0;
  width: ${SIDE_CHIPS_WIDTH}px;
  border-right: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  overflow: hidden;
  align-items: center;
`;

const ChipColumnDropZone = styled.div`
  flex: 1 1 auto;
  min-height: ${({ theme }) => theme.sizeSM}px;
  width: 100%;
  align-self: stretch;
`;

const Chip = styled.div`
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colorFillSecondary};
  background-clip: padding-box;
  overflow: hidden;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXXS}px;
  cursor: grab;
`;

const ValueChip = styled(Chip)`
  background: ${({ theme }) => theme.colorPrimaryBg};
  color: ${({ theme }) => theme.colorPrimaryText};
  border: 1px solid ${({ theme }) => theme.colorPrimaryBorder};
`;

const ChipLabel = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
`;

const ChipCloseButton = styled.button`
  border: 0;
  background: ${({ theme }) => theme.colorFill};
  padding: 0;
  margin: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colorTextSecondary};
  cursor: pointer;
`;

const VerticalChip = styled(Chip)`
  position: relative;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  padding: 18px 2px 2px;
`;

const VerticalValueChip = styled(ValueChip)`
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
`;

const VerticalChipLabel = styled(ChipLabel)`
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  transform-origin: center;
`;

const VerticalChipCloseButton = styled(ChipCloseButton)`
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
`;

const DragPreviewWrap = styled.div`
  position: fixed;
  pointer-events: none;
  z-index: 2000;
  top: 0;
  left: 0;
`;

const DragPreviewChip = styled(Chip)`
  box-shadow: ${({ theme }) => theme.boxShadowSecondary};
`;

const DragPreviewValueChip = styled(ValueChip)`
  box-shadow: ${({ theme }) => theme.boxShadowSecondary};
`;

const TableRow = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
`;

const TableArea = styled.div<{ $height: number; $width: number }>`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  width: ${({ $width }) => $width}px;
  height: ${({ $height }) => $height}px;
`;

type InteractionChipProps = {
  axis: PivotAxis;
  chip: ChipItem;
  chipIndex: number;
  vertical?: boolean;
  onRegisterRef?: (node: HTMLDivElement | null) => void;
  onDropDimension: (
    dimensionKey: string,
    targetAxis: PivotAxis,
    targetChipIndex: number,
    insertBeforeValue: boolean,
    sourceAxis?: PivotAxis,
    sourceChipIndex?: number,
  ) => void;
  onDropValue: (
    targetAxis: PivotAxis,
    targetChipIndex: number,
    sourceAxis: PivotAxis,
    sourceChipIndex?: number,
  ) => void;
  onRemove?: (dimensionKey: string) => void;
};

const dimensionDndType =
  INTERACTION_DIMENSION_DND_TYPE || 'pivot-v3-interaction-dimension';
const valueDndType = INTERACTION_VALUE_DND_TYPE || 'pivot-v3-interaction-value';

const InteractionChip = ({
  axis,
  chip,
  chipIndex,
  vertical = false,
  onRegisterRef,
  onDropDimension,
  onDropValue,
  onRemove,
}: InteractionChipProps) => {
  const isValue = chip.kind === 'value';
  const ref = useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag, preview] = useDrag<
    DragItem,
    void,
    { isDragging: boolean }
  >({
    item: isValue
      ? {
          type: valueDndType,
          kind: 'value',
          label: chip.label,
          sourceAxis: axis,
          sourceChipIndex: chipIndex,
        }
      : {
          type: dimensionDndType,
          kind: 'dimension',
          label: chip.label,
          dimensionKey: chip.id,
          sourceAxis: axis,
          sourceChipIndex: chipIndex,
        },
    collect: monitor => ({
      isDragging: monitor.isDragging(),
    }),
  });

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  const [, drop] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: (item, monitor) => {
      const clientOffset = monitor.getClientOffset();
      const rect = ref.current?.getBoundingClientRect();
      const dropRatio = 0.33;
      const isAfter =
        rect && clientOffset
          ? vertical
            ? clientOffset.y > rect.top + rect.height * dropRatio
            : clientOffset.x > rect.left + rect.width * dropRatio
          : false;
      const targetChipIndex = chipIndex + (isAfter ? 1 : 0);
      const insertBeforeValue = isValue && !isAfter;

      if (item.kind === 'dimension') {
        if (item.dimensionKey === chip.id && item.sourceAxis === axis) {
          return;
        }
        onDropDimension(
          item.dimensionKey,
          axis,
          targetChipIndex,
          insertBeforeValue,
          item.sourceAxis,
          item.sourceChipIndex,
        );
        return;
      }
      if (!(isValue && item.sourceAxis === axis && !isAfter)) {
        onDropValue(
          axis,
          targetChipIndex,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      }
    },
  });

  drag(drop(ref));
  useEffect(() => {
    onRegisterRef?.(ref.current);
    return () => {
      onRegisterRef?.(null);
    };
  }, [onRegisterRef]);
  const ChipComponent =
    chip.kind === 'value'
      ? vertical
        ? VerticalValueChip
        : ValueChip
      : vertical
        ? VerticalChip
        : Chip;
  const LabelComponent = vertical ? VerticalChipLabel : ChipLabel;
  const CloseComponent = vertical ? VerticalChipCloseButton : ChipCloseButton;

  return (
    <ChipComponent ref={ref} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <LabelComponent>{chip.label}</LabelComponent>
      {chip.kind === 'dimension' && onRemove ? (
        <CloseComponent
          type="button"
          onClick={event => {
            event.stopPropagation();
            onRemove(chip.id);
          }}
          aria-label={t('Remove dimension')}
        >
          <Icons.CloseOutlined iconSize="xs" iconColor="currentColor" />
        </CloseComponent>
      ) : null}
    </ChipComponent>
  );
};

type StripDropZoneProps = {
  axis: PivotAxis;
  chipCount: number;
  onDropDimension: InteractionChipProps['onDropDimension'];
  onDropValue: InteractionChipProps['onDropValue'];
};

const StripDropZone = ({
  axis,
  chipCount,
  onDropDimension,
  onDropValue,
}: StripDropZoneProps) => {
  const [, drop] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: item => {
      if (item.kind === 'dimension') {
        onDropDimension(
          item.dimensionKey,
          axis,
          chipCount,
          false,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      } else {
        onDropValue(axis, chipCount, item.sourceAxis, item.sourceChipIndex);
      }
    },
  });

  return axis === 'row' ? (
    <ChipColumnDropZone ref={drop} />
  ) : (
    <ChipRowDropZone ref={drop} />
  );
};

const useStripDropTarget = (
  axis: PivotAxis,
  getDropIndex: (
    axis: PivotAxis,
    clientOffset: { x: number; y: number } | null,
  ) => number,
  onDropDimension: InteractionChipProps['onDropDimension'],
  onDropValue: InteractionChipProps['onDropValue'],
) => {
  const [, drop] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: (item, monitor) => {
      if (monitor.didDrop()) {
        return;
      }
      const targetChipIndex = getDropIndex(axis, monitor.getClientOffset());
      if (item.kind === 'dimension') {
        onDropDimension(
          item.dimensionKey,
          axis,
          targetChipIndex,
          false,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      } else {
        onDropValue(
          axis,
          targetChipIndex,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      }
    },
  });
  return drop;
};

const PivotDragLayer = memo(() => {
  const dragLayer = useDragLayer(monitor => ({
    item: monitor.getItem() as DragItem | null,
    isDragging: monitor.isDragging(),
    currentOffset: monitor.getClientOffset(),
  }));

  if (
    !dragLayer.isDragging ||
    !dragLayer.item?.label ||
    !dragLayer.currentOffset
  ) {
    return null;
  }

  return (
    <DragPreviewWrap
      style={{
        transform: `translate(${dragLayer.currentOffset.x}px, ${dragLayer.currentOffset.y}px) translate(-50%, -50%)`,
      }}
    >
      {dragLayer.item.kind === 'value' ? (
        <DragPreviewValueChip>
          <ChipLabel>{dragLayer.item.label}</ChipLabel>
        </DragPreviewValueChip>
      ) : (
        <DragPreviewChip>
          <ChipLabel>{dragLayer.item.label}</ChipLabel>
        </DragPreviewChip>
      )}
    </DragPreviewWrap>
  );
});

type ChipItem = {
  id: string;
  label: string;
  kind: 'dimension' | 'value';
};

type DimensionDragItem = {
  type: string;
  kind: 'dimension';
  label?: string;
  dimensionKey: string;
  sourceAxis?: PivotAxis;
  sourceChipIndex?: number;
};

type ValueDragItem = {
  type: string;
  kind: 'value';
  label?: string;
  sourceAxis: PivotAxis;
  sourceChipIndex?: number;
};

type DragItem = DimensionDragItem | ValueDragItem;
type PivotViewProps = ComponentProps<typeof PivotTableView>;
type PivotDisplaySnapshot = Pick<
  PivotViewProps,
  'renderModel' | 'tree' | 'expandedRows' | 'expandedCols'
>;
type UiColumnSortState = {
  colKey: string;
  displayColKey?: string;
  metricKey: string;
  order: 'asc' | 'desc';
};

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
    useState<UiColumnSortState | null>(null);
  const [pendingDisplaySnapshot, setPendingDisplaySnapshot] =
    useState<PivotDisplaySnapshot | null>(null);
  const pendingSeamlessLayoutRef = useRef<PivotRuntimeLayout | null>(null);
  const lastUpstreamQueryContextRef = useRef<{
    data: PivotTreeData;
    signature: string;
  } | null>(null);
  const expandedRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const expandedColsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingColsForSeamlessRef = useRef<Set<string>>(new Set());
  const displaySnapshotRef = useRef<PivotDisplaySnapshot | null>(null);
  const lastSeamlessSyncRef = useRef<{
    filtersSignature: string | null;
    layoutSignature: string;
    upstreamSignature: string;
  } | null>(null);
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

  useEffect(() => {
    ownStateRef.current = ownState ?? {};
  }, [ownState]);

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
  const dimensionMap = useMemo(() => {
    const map = new Map<string, PivotTableProps['groupbyRows'][number]>();
    dimensionList.forEach(dimension => {
      map.set(getStableColumnKey(dimension), dimension);
    });
    return map;
  }, [dimensionList]);
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
    if (
      isDashboardRuntimeSync &&
      pendingPersistedRuntimeLayoutSyncRef.current
    ) {
      return;
    }
    if (pendingSeamlessLayoutRef.current) {
      return;
    }
    setCommittedRuntimeLayout(current =>
      isSameRuntimeLayout(current, runtimeLayout) ? current : runtimeLayout,
    );
  }, [isDashboardRuntimeSync, runtimeLayout]);
  useEffect(() => {
    if (
      !isDashboardRuntimeSync ||
      !pendingPersistedRuntimeLayoutSyncRef.current
    ) {
      return;
    }
    if (
      isSameRuntimeLayout(runtimeLayout, lastPersistedRuntimeLayoutRef.current)
    ) {
      pendingPersistedRuntimeLayoutSyncRef.current = false;
    }
  }, [isDashboardRuntimeSync, runtimeLayout]);
  const appliedMetricKeysBase = useMemo(
    () =>
      getMetricKeys(
        ensureIsArray(
          appliedFormData.metricsBase ?? appliedFormData.metrics ?? metrics,
        ),
      ),
    [appliedFormData.metrics, appliedFormData.metricsBase, metrics],
  );
  const appliedMetricKeys = useMemo(() => {
    if (!isUserControlled) {
      return appliedMetricKeysBase;
    }
    const committedMetrics = committedRuntimeLayout.metrics ?? [];
    if (committedMetrics.length === 0) {
      return appliedMetricKeysBase;
    }
    const merged = [...appliedMetricKeysBase];
    committedMetrics.forEach(metricKey => {
      if (!merged.includes(metricKey)) {
        merged.push(metricKey);
      }
    });
    return merged;
  }, [appliedMetricKeysBase, committedRuntimeLayout.metrics, isUserControlled]);
  const appliedRuntimeLayout = useMemo(() => {
    if (!isUserControlled) {
      return runtimeLayout;
    }
    return normalizeRuntimeLayout(
      committedRuntimeLayout,
      appliedDimensionKeys,
      appliedMetricKeys,
    );
  }, [
    appliedDimensionKeys,
    appliedMetricKeys,
    committedRuntimeLayout,
    isUserControlled,
    runtimeLayout,
  ]);
  const appliedLayoutFormData = useMemo(() => {
    if (!isUserControlled) {
      return appliedFormData;
    }
    const metricsForLayout =
      appliedFormData.metricsBase ??
      formData.metricsBase ??
      appliedFormData.metrics ??
      formData.metrics;
    const leavesForLayout =
      appliedFormData.measureLeavesByMetricBase ??
      formData.measureLeavesByMetricBase ??
      appliedFormData.measureLeavesByMetric ??
      formData.measureLeavesByMetric;
    return resolveInteractionFormData({
      formData: {
        ...appliedFormData,
        metrics: metricsForLayout ?? appliedFormData.metrics,
        measureLeavesByMetric:
          leavesForLayout ?? appliedFormData.measureLeavesByMetric,
      },
      runtimeLayout: appliedRuntimeLayout,
    });
  }, [appliedFormData, appliedRuntimeLayout, formData, isUserControlled]);
  const layoutMetrics = useMemo(
    () =>
      isUserControlled ? ensureIsArray(appliedLayoutFormData.metrics) : metrics,
    [appliedLayoutFormData.metrics, isUserControlled, metrics],
  );
  const layoutGroupbyRows = useMemo(
    () =>
      isUserControlled
        ? ensureIsArray(appliedLayoutFormData.groupbyRows)
        : groupbyRows,
    [appliedLayoutFormData.groupbyRows, groupbyRows, isUserControlled],
  );
  const layoutGroupbyColumns = useMemo(
    () =>
      isUserControlled
        ? ensureIsArray(appliedLayoutFormData.groupbyColumns)
        : groupbyColumns,
    [appliedLayoutFormData.groupbyColumns, groupbyColumns, isUserControlled],
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
  const layoutMetricsLayout = isUserControlled
    ? (appliedLayoutFormData.metricsLayout ?? metricsLayout)
    : metricsLayout;

  const normalizeSelectedFilters = useCallback(
    (filters?: Record<string, DataRecordValue[]>) => {
      if (!filters) {
        return {};
      }
      const normalized: Record<string, DataRecordValue[]> = {};
      Object.entries(filters).forEach(([key, values]) => {
        if (dimensionMap.has(key)) {
          normalized[key] = values;
          return;
        }
        const match = dimensionList.find(
          dimension => getColumnLabel(dimension) === key,
        );
        if (match) {
          normalized[getStableColumnKey(match)] = values;
        }
      });
      return normalized;
    },
    [dimensionList, dimensionMap],
  );

  const committedSelectionFilters = useMemo(
    () =>
      buildSelectionFilterClauses({
        formData: fetchFormDataBaseWithFormatters,
        selection: committedFilters,
      }),
    [committedFilters, fetchFormDataBaseWithFormatters],
  );

  const fetchFormData = useMemo(() => {
    if (!isUserControlled || committedSelectionFilters.length === 0) {
      return appliedLayoutFormData;
    }
    const merged = {
      ...appliedLayoutFormData,
      extra_form_data: mergeSelectionExtraFilters(
        appliedLayoutFormData.extra_form_data,
        committedSelectionFilters,
      ),
    };
    return normalizeFormDataExtraFilters(merged);
  }, [appliedLayoutFormData, committedSelectionFilters, isUserControlled]);

  const upstreamDashboardQueryContextSignature = useMemo(() => {
    if (!isDashboardRuntimeSync || !queryFormData) {
      return null;
    }
    const normalizedQueryFormData =
      normalizeFormDataExtraFilters(queryFormData);
    return stableStringify({
      adhoc_filters: normalizedQueryFormData.adhoc_filters ?? [],
      extra_form_data: normalizedQueryFormData.extra_form_data ?? null,
      extras: normalizedQueryFormData.extras ?? null,
      granularity_sqla: normalizedQueryFormData.granularity_sqla ?? null,
      time_grain_sqla: normalizedQueryFormData.time_grain_sqla ?? null,
      time_offsets: normalizedQueryFormData.time_offsets ?? [],
      time_range: normalizedQueryFormData.time_range ?? null,
    });
  }, [isDashboardRuntimeSync, queryFormData]);

  const persistedInteractionFilters = useMemo(() => {
    if (!isUserControlled) {
      return EMPTY_SELECTED_FILTERS;
    }
    return normalizeSelectedFilters(
      firstSelectedFilters(
        selectedFiltersFromFormData,
        selectedFiltersFromOwnState,
      ),
    );
  }, [
    isUserControlled,
    normalizeSelectedFilters,
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
  ]);
  const persistedInteractionFiltersSignature = selectedFiltersSignature(
    persistedInteractionFilters,
  );
  const upstreamSeamlessSignature = useMemo(
    () =>
      stableStringify({
        dashboardQueryContext:
          upstreamDashboardQueryContextSignature ?? EMPTY_SELECTED_FILTERS,
        treeDataSignature: formData.treeDataSignature ?? null,
      }),
    [formData.treeDataSignature, upstreamDashboardQueryContextSignature],
  );
  const hasLocalSyncForCurrentDashboardQueryContext =
    isDashboardContext &&
    upstreamDashboardQueryContextSignature !== null &&
    lastLocalSyncDashboardQueryContextRef.current ===
      upstreamDashboardQueryContextSignature;
  const shouldSyncCommittedTreeFromProps =
    !isUserControlled ||
    (!hasLocalSyncForCurrentDashboardQueryContext &&
      !hasSelectedFilters(persistedInteractionFilters) &&
      isSameRuntimeLayout(runtimeLayout, committedRuntimeLayout) &&
      isEqual(selectedFiltersForTreeSync, committedFilters));
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

  useEffect(() => {
    if (
      isUserControlled &&
      isDashboardContext &&
      pendingPersistedRuntimeLayoutSyncRef.current
    ) {
      return;
    }
    if (pendingSeamlessLayoutRef.current) {
      return;
    }
    updateUiRuntimeLayout(runtimeLayout);
  }, [
    isDashboardContext,
    isUserControlled,
    runtimeLayout,
    updateUiRuntimeLayout,
  ]);

  const persistedSelectedFilters = useMemo(() => {
    if (!isUserControlled) {
      return normalizeSelectedFilters(selectedFiltersFromProps);
    }
    return normalizeSelectedFilters(
      firstSelectedFilters(
        selectedFiltersFromFormData,
        selectedFiltersFromOwnState,
        committedFilters,
        selectedFiltersFromProps,
      ),
    );
  }, [
    committedFilters,
    isUserControlled,
    normalizeSelectedFilters,
    selectedFiltersFromFormData,
    selectedFiltersFromOwnState,
    selectedFiltersFromProps,
  ]);

  useEffect(() => {
    if (!isUserControlled || !pendingPersistedSelectionSyncRef.current) {
      return;
    }
    if (isEqual(persistedSelectedFilters, lastPersistedSelectionRef.current)) {
      pendingPersistedSelectionSyncRef.current = false;
    }
  }, [isUserControlled, persistedSelectedFilters]);

  useEffect(() => {
    if (isUserControlled && pendingPersistedSelectionSyncRef.current) {
      return;
    }
    const shouldSyncFilters =
      !isEqual(persistedSelectedFilters, committedFilters) ||
      !isEqual(persistedSelectedFilters, uiSelectedFilters);
    if (!shouldSyncFilters) {
      return;
    }
    if (!isUserControlled) {
      setCommittedFilters(persistedSelectedFilters);
      setUiSelectedFilters(persistedSelectedFilters);
      return;
    }
    const hasLocalFilters =
      hasSelectedFilters(uiSelectedFilters) ||
      hasSelectedFilters(committedFilters);
    if (!hasLocalFilters) {
      if (
        suppressStalePersistedFilterRestoreRef.current &&
        hasSelectedFilters(persistedSelectedFilters)
      ) {
        return;
      }
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
      if (
        isDashboardRuntimeSync &&
        !isSameRuntimeLayout(lastPersistedRuntimeLayoutRef.current, layout)
      ) {
        lastPersistedRuntimeLayoutRef.current = layout;
        pendingPersistedRuntimeLayoutSyncRef.current = true;
      }
      if (isDashboardRuntimeSync) {
        lastLocalSyncDashboardQueryContextRef.current =
          upstreamDashboardQueryContextSignature;
      }
      if (!isEqual(lastPersistedSelectionRef.current, filters)) {
        lastPersistedSelectionRef.current = filters;
        pendingPersistedSelectionSyncRef.current = true;
      }
      setCommittedRuntimeLayout(current =>
        isSameRuntimeLayout(current, layout) ? current : layout,
      );
      const nextOwnState = mergeOwnState({
        pivotRuntimeLayout: layout,
        pivotSelectedFilters: filters,
      });
      if (setControlValue) {
        setControlValue('pivotRuntimeLayout', layout);
        setControlValue('pivotSelectedFilters', filters);
      }
      if (shouldPersistOwnState) {
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
      lastSeamlessSyncRef.current = {
        filtersSignature: selectedFiltersSignature(nextFilters),
        layoutSignature: stableStringify(normalized),
        upstreamSignature: upstreamSeamlessSignature,
      };
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
  const staleCoverageRecoverySignatureRef = useRef<string | null>(null);

  const handleRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      const fetchBaselineLayout =
        pendingSeamlessLayoutRef.current ?? committedRuntimeLayout;
      if (
        shouldFetchRuntimeLayout({
          factBatches: committedFactBatches,
          previousLayout: fetchBaselineLayout,
          nextLayout: normalized,
        })
      ) {
        pendingSeamlessLayoutRef.current = normalized;
        updateUiRuntimeLayout(normalized);
        applySeamlessUpdate(normalized, uiSelectedFilters);
        return;
      }
      updateUiRuntimeLayout(normalized);
      persistRuntimeState(normalized, uiSelectedFilters);
      lastSeamlessSyncRef.current = {
        filtersSignature: selectedFiltersSignature(uiSelectedFilters),
        layoutSignature: stableStringify(normalized),
        upstreamSignature: upstreamSeamlessSignature,
      };
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
    if (!upstreamDashboardQueryContextSignature) {
      lastUpstreamQueryContextRef.current = null;
      return;
    }
    const previous = lastUpstreamQueryContextRef.current;
    lastUpstreamQueryContextRef.current = {
      data,
      signature: upstreamDashboardQueryContextSignature,
    };
    if (!previous) {
      return;
    }
    if (previous.signature === upstreamDashboardQueryContextSignature) {
      return;
    }
    if (previous.data !== data) {
      return;
    }
    applySeamlessUpdate(uiRuntimeLayout, uiSelectedFilters);
  }, [
    applySeamlessUpdate,
    data,
    uiRuntimeLayout,
    uiSelectedFilters,
    upstreamDashboardQueryContextSignature,
  ]);

  useEffect(() => {
    if (!isUserControlled || !hasSelectedFilters(persistedInteractionFilters)) {
      return;
    }
    if (
      !isEqual(committedFilters, persistedInteractionFilters) ||
      !isEqual(uiSelectedFilters, persistedInteractionFilters)
    ) {
      return;
    }
    const layoutSignature = stableStringify(uiRuntimeLayout);
    const currentSync = lastSeamlessSyncRef.current;
    if (
      currentSync?.filtersSignature === persistedInteractionFiltersSignature &&
      currentSync.layoutSignature === layoutSignature &&
      currentSync.upstreamSignature === upstreamSeamlessSignature
    ) {
      return;
    }
    applySeamlessUpdate(uiRuntimeLayout, persistedInteractionFilters);
  }, [
    applySeamlessUpdate,
    committedFilters,
    isUserControlled,
    persistedInteractionFilters,
    persistedInteractionFiltersSignature,
    uiRuntimeLayout,
    uiSelectedFilters,
    upstreamSeamlessSignature,
  ]);

  useEffect(() => {
    if (
      !isUserControlled ||
      !shouldFetchRuntimeLayout({
        factBatches: committedFactBatches,
        previousLayout: committedRuntimeLayout,
        nextLayout: committedRuntimeLayout,
      })
    ) {
      staleCoverageRecoverySignatureRef.current = null;
      return;
    }
    if (
      !isDashboardRuntimeSync ||
      hasSelectedFilters(persistedInteractionFilters) ||
      seamlessLoading
    ) {
      return;
    }
    const recoverySignature = stableStringify({
      layout: uiRuntimeLayout,
      filters: uiSelectedFilters,
      upstreamSignature: upstreamSeamlessSignature,
    });
    if (staleCoverageRecoverySignatureRef.current === recoverySignature) {
      return;
    }
    staleCoverageRecoverySignatureRef.current = recoverySignature;
    applySeamlessUpdate(uiRuntimeLayout, uiSelectedFilters);
  }, [
    applySeamlessUpdate,
    committedFactBatches,
    committedRuntimeLayout,
    isDashboardRuntimeSync,
    isUserControlled,
    persistedInteractionFilters,
    seamlessLoading,
    uiRuntimeLayout,
    uiSelectedFilters,
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

  const chipItems = useCallback(
    (axis: 'row' | 'col') => {
      const keys = axis === 'row' ? uiRuntimeLayout.rows : uiRuntimeLayout.cols;
      const labels: ChipItem[] = keys.map(key => ({
        id: key,
        label: dimensionLabelMap.get(key) ?? key,
        kind: 'dimension' as const,
      }));
      if (
        metricKeys.length === 0 ||
        uiRuntimeLayout.valuePlacement.axis !== axis
      ) {
        return labels;
      }
      const valueIndex = Math.max(
        0,
        Math.min(uiRuntimeLayout.valuePlacement.index, labels.length),
      );
      const next = [...labels];
      next.splice(valueIndex, 0, {
        id: 'value',
        label: t('Value'),
        kind: 'value' as const,
      });
      return next;
    },
    [dimensionLabelMap, metricKeys.length, uiRuntimeLayout],
  );

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

  useEffect(() => {
    expandedRowsForSeamlessRef.current = expandedRows;
    expandedColsForSeamlessRef.current = expandedCols;
    pendingRowsForSeamlessRef.current = pendingRows;
    pendingColsForSeamlessRef.current = pendingCols;
  }, [expandedCols, expandedRows, pendingCols, pendingRows]);

  useEffect(() => {
    if (!pendingDisplaySnapshot) {
      return;
    }
    const settled =
      !seamlessLoading &&
      !isHydrating &&
      loadingKeys.size === 0 &&
      pendingRows.size === 0 &&
      pendingCols.size === 0;
    if (settled) {
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

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

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

  const resolveColumnSortMetric = useCallback(
    (node: PivotTreeNode) => {
      const metricKey = layoutResult.getMetricLabelFromPath(node.path);
      if (!metricKey) {
        return undefined;
      }
      if (layoutResult.measureHierarchy.kind !== 'measureStackV1') {
        return metricKey;
      }
      const fallbackMetricKey = resolveMeasureSortMetricKey({
        metricKey,
        measureHierarchy: layoutResult.measureHierarchy,
      });
      const leafId = findMeasureLeafIdInPath(node.path);
      if (!leafId) {
        return fallbackMetricKey;
      }
      const leaf = layoutResult.measureHierarchy.groups
        .find(candidate => candidate.metricKey === metricKey)
        ?.leaves.find(candidate => candidate.id === leafId);
      return leaf
        ? buildMeasureLeafOutputKey(metricKey, leaf)
        : fallbackMetricKey;
    },
    [layoutResult],
  );

  const resolveColumnSortDataKey = useCallback(
    (node: PivotTreeNode, metricKey: string) => {
      const baseMetricKey = layoutResult.getMetricLabelFromPath(node.path);
      if (!baseMetricKey) {
        return node.key;
      }
      if (layoutResult.measureHierarchy.kind !== 'measureStackV1') {
        return node.key;
      }
      const sortLeafId = layoutResult.measureHierarchy.groups
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
      Object.values(renderTree.cols).forEach(candidate => {
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
    },
    [layoutResult, renderTree.cols],
  );

  const isColumnSortable = useCallback(
    (node: PivotTreeNode) => Boolean(resolveColumnSortMetric(node)),
    [resolveColumnSortMetric],
  );

  const getColumnSortOrder = useCallback(
    (node: PivotTreeNode) =>
      (activeColumnSort?.displayColKey ?? activeColumnSort?.colKey) === node.key
        ? activeColumnSort?.order
        : undefined,
    [activeColumnSort],
  );

  const handleColumnSort = useCallback(
    (node: PivotTreeNode) => {
      const metricKey = resolveColumnSortMetric(node);
      if (!metricKey) {
        return;
      }
      const dataColKey = resolveColumnSortDataKey(node, metricKey);
      setActiveColumnSort(current => {
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
      });
    },
    [resolveColumnSortDataKey, resolveColumnSortMetric],
  );

  useEffect(() => {
    setActiveColumnSort(current => {
      if (!current) {
        return current;
      }
      const displayNode =
        (current.displayColKey && renderTree.cols[current.displayColKey]) ||
        renderTree.cols[current.colKey];
      if (!displayNode) {
        return null;
      }
      const nextMetricKey = resolveColumnSortMetric(displayNode);
      if (!nextMetricKey) {
        return null;
      }
      const nextDataColKey = resolveColumnSortDataKey(
        displayNode,
        nextMetricKey,
      );
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
    });
  }, [renderTree.cols, resolveColumnSortDataKey, resolveColumnSortMetric]);

  const treeDimensionFilterValues = useMemo(() => {
    const valuesMap = new Map<string, Set<DataRecordValue>>();
    const aliasMap = new Map<string, Set<string>>();
    const addAlias = (from?: string, to?: string) => {
      if (!from || !to) {
        return;
      }
      const set = aliasMap.get(from) ?? new Set<string>();
      set.add(to);
      aliasMap.set(from, set);
    };
    dimensionList.forEach(dimension => {
      const stableKey = getStableColumnKey(dimension);
      const labelKey = getColumnLabel(dimension);
      addAlias(stableKey, stableKey);
      addAlias(labelKey, stableKey);
    });
    Object.entries(resolvedVerboseMap ?? {}).forEach(([key, verbose]) => {
      if (typeof verbose !== 'string' || verbose.length === 0) {
        return;
      }
      addAlias(key, verbose);
      addAlias(verbose, verbose);
    });
    const addValue = (key: string, value: DataRecordValue) => {
      const set = valuesMap.get(key) ?? new Set<DataRecordValue>();
      set.add(value);
      valuesMap.set(key, set);
    };
    const resolveAliases = (key: string) => aliasMap.get(key) ?? new Set([key]);
    const collectValues = (
      nodes: Record<string, PivotTreeNode>,
      axis: 'row' | 'col',
    ) => {
      Object.values(nodes).forEach(node => {
        if (node.isSubtotal) {
          return;
        }
        const dimensionKey = layoutResult.getDimensionKeyForNode(node, axis);
        if (!dimensionKey) {
          return;
        }
        const parts = layoutResult
          .getNonMetricPathParts(node.path)
          .filter(part => !isSubtotalToken(part));
        if (parts.length === 0) {
          return;
        }
        const normalized = (parts[parts.length - 1] ?? null) as DataRecordValue;
        resolveAliases(dimensionKey).forEach(key => {
          addValue(key, normalized);
        });
      });
    };
    collectValues(renderTree.rows, 'row');
    collectValues(renderTree.cols, 'col');
    return Object.fromEntries(
      Array.from(valuesMap.entries()).map(([key, set]) => [
        key,
        Array.from(set.values()),
      ]),
    );
  }, [
    dimensionList,
    layoutResult,
    renderTree.cols,
    renderTree.rows,
    resolvedVerboseMap,
  ]);
  const [fetchedDimensionFilterValues, setFetchedDimensionFilterValues] =
    useState<Record<string, DataRecordValue[]>>({});
  const [dimensionFilterSearchText, setDimensionFilterSearchText] = useState<
    Record<string, string>
  >({});
  const [dimensionFilterLoading, setDimensionFilterLoading] = useState<
    Record<string, boolean>
  >({});
  const dimensionFilterValues = useMemo(
    () =>
      Object.fromEntries(
        dimensionList.map(dimension => {
          const dimensionKey = getStableColumnKey(dimension);
          const search = dimensionFilterSearchText[dimensionKey]?.trim() ?? '';
          const fetchedValues =
            fetchedDimensionFilterValues[dimensionKey] ?? EMPTY_FILTER_VALUES;
          if (search.length > 0) {
            return [dimensionKey, fetchedValues];
          }
          const treeValues =
            treeDimensionFilterValues[dimensionKey] ?? EMPTY_FILTER_VALUES;
          return [
            dimensionKey,
            Array.from(new Set([...treeValues, ...fetchedValues])),
          ];
        }),
      ),
    [
      dimensionFilterSearchText,
      dimensionList,
      fetchedDimensionFilterValues,
      treeDimensionFilterValues,
    ],
  );
  const dimensionFilterValuesVersion = useRef(0);
  const dimensionFilterRequestVersion = useRef<Record<string, number>>({});
  const dimensionFilterValuesRef = useRef(treeDimensionFilterValues);

  useEffect(() => {
    if (isEqual(dimensionFilterValuesRef.current, treeDimensionFilterValues)) {
      return;
    }
    dimensionFilterValuesRef.current = treeDimensionFilterValues;
    dimensionFilterValuesVersion.current += 1;
    setFetchedDimensionFilterValues({});
    setDimensionFilterSearchText({});
  }, [treeDimensionFilterValues]);

  const handleFetchDimensionValues = useCallback(
    async (dimension: PivotTableProps['groupbyRows'][number], search = '') => {
      const dimensionKey = getStableColumnKey(dimension);
      const normalizedSearch = search.trim();
      setDimensionFilterSearchText(current =>
        current[dimensionKey] === normalizedSearch
          ? current
          : { ...current, [dimensionKey]: normalizedSearch },
      );
      setDimensionFilterLoading(current => ({
        ...current,
        [dimensionKey]: true,
      }));
      const requestVersion = dimensionFilterValuesVersion.current;
      const nextRequestVersion =
        (dimensionFilterRequestVersion.current[dimensionKey] ?? 0) + 1;
      dimensionFilterRequestVersion.current[dimensionKey] = nextRequestVersion;
      try {
        const selection = { ...uiSelectedFilters };
        delete selection[dimensionKey];
        const filters = buildSelectionFilterClauses({
          formData: fetchFormDataBaseWithFormatters,
          selection,
        });
        const pendingFormData =
          filters.length > 0
            ? {
                ...fetchFormDataBaseWithFormatters,
                extra_form_data: mergeSelectionExtraFilters(
                  fetchFormDataBaseWithFormatters.extra_form_data,
                  filters,
                ),
              }
            : fetchFormDataBaseWithFormatters;
        const normalizedFormData =
          normalizeFormDataExtraFilters(pendingFormData);
        const spec: QuerySpec = {
          queryName: buildDimensionValuesQueryName(dimensionKey),
          columns: [dimension],
          metrics: [],
          filters: buildDimensionValueSearchFilters({
            dimension,
            dimensionKey,
            colTypeMap,
            search: normalizedSearch,
          }),
        };
        const results = await supersetChartDataClient.fetch({
          formData: normalizedFormData,
          specs: [spec],
          requestGroupId: `${DIMENSION_VALUES_REQUEST_GROUP}-${dimensionKey}`,
        });
        if (
          dimensionFilterValuesVersion.current !== requestVersion ||
          dimensionFilterRequestVersion.current[dimensionKey] !==
            nextRequestVersion
        ) {
          return;
        }
        const result = results[0];
        const label = getColumnLabel(dimension);
        const values = new Set<DataRecordValue>();
        (result?.data ?? []).forEach(row => {
          if (row && typeof row === 'object' && label in row) {
            values.add((row as Record<string, DataRecordValue>)[label]);
          }
        });
        setFetchedDimensionFilterValues(current => ({
          ...current,
          [dimensionKey]: Array.from(values.values()),
        }));
      } catch (error) {
        if (
          typeof DOMException !== 'undefined' &&
          error instanceof DOMException &&
          error.name === 'AbortError'
        ) {
          return;
        }
        // Ignore errors for dimension value lookups; filtering still works.
      } finally {
        if (
          dimensionFilterRequestVersion.current[dimensionKey] ===
          nextRequestVersion
        ) {
          setDimensionFilterLoading(current => {
            if (!current[dimensionKey]) {
              return current;
            }
            const next = { ...current };
            delete next[dimensionKey];
            return next;
          });
        }
      }
    },
    [colTypeMap, fetchFormDataBaseWithFormatters, uiSelectedFilters],
  );

  const handleDimensionFilterChange = useCallback(
    (
      dimension: PivotTableProps['groupbyRows'][number],
      values: DataRecordValue[],
    ) => {
      const dimensionKey = getStableColumnKey(dimension);
      const nextSelected = { ...uiSelectedFilters };
      if (values.length > 0) {
        suppressStalePersistedFilterRestoreRef.current = false;
        nextSelected[dimensionKey] = values;
      } else {
        delete nextSelected[dimensionKey];
        if (
          hasSelectedFilters(uiSelectedFilters) &&
          !hasSelectedFilters(nextSelected)
        ) {
          suppressStalePersistedFilterRestoreRef.current = true;
        }
      }
      setUiSelectedFilters(nextSelected);
      applySeamlessUpdate(uiRuntimeLayout, nextSelected);
    },
    [applySeamlessUpdate, uiRuntimeLayout, uiSelectedFilters],
  );

  const handleClearAllFilters = useCallback(() => {
    if (!hasSelectedFilters(uiSelectedFilters)) {
      return;
    }
    suppressStalePersistedFilterRestoreRef.current = true;
    const nextSelected: Record<string, DataRecordValue[]> = {};
    setUiSelectedFilters(nextSelected);
    applySeamlessUpdate(uiRuntimeLayout, nextSelected);
  }, [applySeamlessUpdate, uiRuntimeLayout, uiSelectedFilters]);

  const { headerOffset, headerRowOffsets, headerRef } = useStickyHeaders({
    enabled: resolvedStickyHeaders,
    columnHeaderRows: renderModelResult.renderModel.columnHeaderRows,
    width: isUserControlled
      ? Math.max(0, width - PANEL_WIDTH - SIDE_CHIPS_WIDTH)
      : width,
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
  const tableWidth = isUserControlled
    ? Math.max(0, width - PANEL_WIDTH - SIDE_CHIPS_WIDTH)
    : width;
  const tableHeight = isUserControlled
    ? Math.max(0, height - TOP_CHIPS_HEIGHT)
    : height;
  const liveDisplaySnapshot: PivotDisplaySnapshot = {
    renderModel: renderModelResult.renderModel,
    tree: renderTree,
    expandedRows: renderModelResult.expandedRowsForRender,
    expandedCols: renderModelResult.expandedColsForRender,
  };
  displaySnapshotRef.current = liveDisplaySnapshot;
  const activeDisplaySnapshot = pendingDisplaySnapshot ?? liveDisplaySnapshot;
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
  };
  const rowChips = chipItems('row');
  const colChips = chipItems('col');
  const rowChipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const colChipRefs = useRef<Array<HTMLDivElement | null>>([]);

  const getStripDropIndex = useCallback(
    (axis: PivotAxis, clientOffset: { x: number; y: number } | null) => {
      const chips = axis === 'row' ? rowChips : colChips;
      const refs = axis === 'row' ? rowChipRefs.current : colChipRefs.current;
      const nodes = refs
        .slice(0, chips.length)
        .filter((node): node is HTMLDivElement => node !== null);
      if (!clientOffset || nodes.length === 0) {
        return 0;
      }
      const dropRatio = 0.33;
      for (let index = 0; index < nodes.length; index += 1) {
        const rect = nodes[index].getBoundingClientRect();
        const pivot =
          axis === 'row'
            ? rect.top + rect.height * dropRatio
            : rect.left + rect.width * dropRatio;
        const offset = axis === 'row' ? clientOffset.y : clientOffset.x;
        if (offset < pivot) {
          return index;
        }
      }
      return nodes.length;
    },
    [colChips, rowChips],
  );

  const removeDimensionFromLayout = useCallback((dimensionKey: string) => {
    const currentLayout = uiRuntimeLayoutRef.current;
    const rowIndex = currentLayout.rows.indexOf(dimensionKey);
    const colIndex = currentLayout.cols.indexOf(dimensionKey);
    if (rowIndex < 0 && colIndex < 0) {
      return currentLayout;
    }
    const nextRows = currentLayout.rows.filter(key => key !== dimensionKey);
    const nextCols = currentLayout.cols.filter(key => key !== dimensionKey);
    const nextValuePlacement = { ...currentLayout.valuePlacement };
    if (rowIndex >= 0 && nextValuePlacement.axis === 'row') {
      if (rowIndex < nextValuePlacement.index) {
        nextValuePlacement.index = Math.max(0, nextValuePlacement.index - 1);
      }
    }
    if (colIndex >= 0 && nextValuePlacement.axis === 'col') {
      if (colIndex < nextValuePlacement.index) {
        nextValuePlacement.index = Math.max(0, nextValuePlacement.index - 1);
      }
    }
    return {
      ...currentLayout,
      rows: nextRows,
      cols: nextCols,
      valuePlacement: nextValuePlacement,
    };
  }, []);

  const handleChipRemove = useCallback(
    (dimensionKey: string) => {
      handleRuntimeLayoutChange(removeDimensionFromLayout(dimensionKey));
    },
    [handleRuntimeLayoutChange, removeDimensionFromLayout],
  );

  const metricsAvailable = metricKeys.length > 0;

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
        metricsAvailable,
      });
      handleRuntimeLayoutChange(nextLayout);
    },
    [handleRuntimeLayoutChange, metricsAvailable],
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
        metricsAvailable,
      });
      handleRuntimeLayoutChange(nextLayout);
    },
    [handleRuntimeLayoutChange, metricsAvailable],
  );

  const dropOnRowStrip = useStripDropTarget(
    'row',
    getStripDropIndex,
    handleDimensionDrop,
    handleValueDrop,
  );

  const dropOnColStrip = useStripDropTarget(
    'col',
    getStripDropIndex,
    handleDimensionDrop,
    handleValueDrop,
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
    <InteractionLayout style={height ? { height } : undefined}>
      <InteractionPanelWrap>
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
      </InteractionPanelWrap>
      <InteractionTableWrap>
        <PivotDragLayer />
        <ChipRow ref={dropOnColStrip} data-test="pivot-v3-col-chip-strip">
          {colChips.map((chip, index) => (
            <InteractionChip
              key={`col-${chip.id}`}
              axis="col"
              chip={chip}
              chipIndex={index}
              onRegisterRef={node => {
                colChipRefs.current[index] = node;
              }}
              onDropDimension={handleDimensionDrop}
              onDropValue={handleValueDrop}
              onRemove={handleChipRemove}
            />
          ))}
          <StripDropZone
            axis="col"
            chipCount={colChips.length}
            onDropDimension={handleDimensionDrop}
            onDropValue={handleValueDrop}
          />
        </ChipRow>
        <TableRow>
          <ChipColumn ref={dropOnRowStrip} data-test="pivot-v3-row-chip-strip">
            {rowChips.map((chip, index) => (
              <InteractionChip
                key={`row-${chip.id}`}
                axis="row"
                chip={chip}
                chipIndex={index}
                onRegisterRef={node => {
                  rowChipRefs.current[index] = node;
                }}
                vertical
                onDropDimension={handleDimensionDrop}
                onDropValue={handleValueDrop}
                onRemove={handleChipRemove}
              />
            ))}
            <StripDropZone
              axis="row"
              chipCount={rowChips.length}
              onDropDimension={handleDimensionDrop}
              onDropValue={handleValueDrop}
            />
          </ChipColumn>
          <TableArea $height={tableHeight} $width={tableWidth}>
            <PivotTableView
              {...sharedPivotViewProps}
              height={tableHeight}
              width={tableWidth}
            />
          </TableArea>
        </TableRow>
      </InteractionTableWrap>
    </InteractionLayout>
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
