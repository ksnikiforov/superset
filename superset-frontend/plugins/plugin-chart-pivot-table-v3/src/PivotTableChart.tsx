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
import { useExpansionEngine } from './pivot/engine/useExpansionEngine';
import { usePivotLayout } from './pivot/chart/usePivotLayout';
import { usePivotRenderModel } from './pivot/chart/usePivotRenderModel';
import { useStickyHeaders } from './pivot/chart/useStickyHeaders';
import { usePivotFormatting } from './pivot/chart/usePivotFormatting';
import { usePivotInteractions } from './pivot/chart/usePivotInteractions';
import { PivotInteractionPanel } from './pivot/chart/PivotInteractionPanel';
import { resolveInteractionFormData } from './pivot/layout/resolveInteractionLayout';
import { buildLayoutContext } from './pivot/layout/LayoutContext';
import { shouldFetchForLayoutChange } from './pivot/layout/shouldFetchForLayoutChange';
import { buildInitialQuerySpecs } from './pivot/query/specs';
import {
  buildInitialPivotUpdatePlan,
  buildSelectionFilterClauses,
  mergeExtraFilters as mergeSelectionExtraFilters,
} from './pivot/update/initialUpdatePlan';
import { supersetChartDataClient } from './pivot/data/SupersetChartDataClient';
import { normalizeFormDataExtraFilters } from './pivot/query/normalizeExtraFormData';
import { type QuerySpec } from './pivot/query/types';
import {
  type ChartDataQueryResult,
  type ChartDataWarning,
} from './pivot/data/ChartDataClient';
import {
  applyDimensionDrag,
  applyValueDrag,
  INTERACTION_DIMENSION_DND_TYPE,
  INTERACTION_VALUE_DND_TYPE,
} from './pivot/layout/interactionDrag';
import {
  mergeTrees,
  decodeMeasureLeafId,
  getMetricKey,
  getMetricKeys,
  getStableColumnKey,
  METRICS_PLACEHOLDER,
  isSubtotalToken,
  coerceEpochMsStringToNumber,
  parsePath,
  serializePath,
} from './utils';
import {
  applyMeasureLeafValuesToTree,
  buildOffsetMetricKey,
  buildMeasureLeafOutputKey,
  coerceMeasureLeavesByMetric,
  resolveMeasureSortMetricKey,
} from './pivot/measureLeaves';
import { buildBranchTreeFromResults } from './fetchPivotBranch';
import { stableStringify } from './pivot/shared/stableStringify';

const PANEL_WIDTH = 230;
const TOP_CHIPS_HEIGHT = 36;
const SIDE_CHIPS_WIDTH = 24;
const SEAMLESS_REQUEST_GROUP = 'pivot-v3-seamless';
const DIMENSION_VALUES_REQUEST_GROUP = 'pivot-v3-dimension-values';
const DIMENSION_VALUES_QUERY_PREFIX = 'pivot_v3|dimension-values';
const EMPTY_FILTER_VALUES: DataRecordValue[] = [];
const EMPTY_SELECTED_FILTERS: Record<string, DataRecordValue[]> = {};
const hasSelectedFilters = (
  filters: Record<string, DataRecordValue[]>,
): boolean => Object.keys(filters).length > 0;

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

const resolveQueryName = (result: ChartDataQueryResult): string | undefined => {
  if (typeof result.query?.query_name === 'string') {
    return result.query.query_name;
  }
  if (typeof result.query_name === 'string') {
    return result.query_name;
  }
  return undefined;
};

const buildTreeFromQueryResults = ({
  results,
  specs,
  layout,
  formData,
}: {
  results: ChartDataQueryResult[];
  specs: ReturnType<typeof buildInitialQuerySpecs>;
  layout: ReturnType<typeof buildLayoutContext>;
  formData: PivotTableProps['formData'];
}): PivotTreeData => {
  const rootKey = serializePath([]);
  const emptyTree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const resultsByName = new Map<string, ChartDataQueryResult>();
  results.forEach(result => {
    const name = resolveQueryName(result);
    if (name) {
      resultsByName.set(name, result);
    }
  });
  const mergedTree = specs.reduce((acc, spec, idx) => {
    const fallbackResult = results[idx] ?? { data: [] };
    const result = resultsByName.get(spec.queryName) ?? fallbackResult;
    const nextTree = buildBranchTreeFromResults({
      results: [result],
      queryPairs: [
        { rowDepth: spec.meta.rowDepth, colDepth: spec.meta.colDepth },
      ],
      metricsForQuery: spec.metrics,
      formData,
      measureHierarchy: layout.measureHierarchy,
      rowGroupby: spec.meta.rowGroupbyForQueryFull,
      colGroupby: spec.meta.colGroupbyForQueryFull,
      rowSubtotalLevels: spec.meta.rowSubtotalLevels,
      colSubtotalLevels: spec.meta.colSubtotalLevels,
      metricsLayoutResolved: spec.meta.metricsLayoutResolved,
      metricInsertIndex: spec.meta.metricInsertIndex,
    });
    return mergeTrees(acc, nextTree);
  }, emptyTree);
  if (mergedTree.rows[rootKey]) {
    mergedTree.rows[rootKey] = {
      ...mergedTree.rows[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }
  if (mergedTree.cols[rootKey]) {
    mergedTree.cols[rootKey] = {
      ...mergedTree.cols[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }
  return applyMeasureLeafValuesToTree({
    tree: mergedTree,
    measureHierarchy: layout.measureHierarchy,
  });
};

const materializeTreeForMeasureLeaves = ({
  tree,
  formData,
}: {
  tree: PivotTreeData;
  formData: PivotTableProps['formData'];
}): PivotTreeData => {
  const metricKeys = getMetricKeys(ensureIsArray(formData.metrics));
  if (metricKeys.length === 0) {
    return tree;
  }
  const leavesByMetric = coerceMeasureLeavesByMetric(
    metricKeys,
    formData.measureLeavesByMetric,
  );
  const groups = metricKeys.map(metricKey => ({
    metricKey,
    leaves: leavesByMetric[metricKey] ?? [],
  }));
  const hasDerivedLeaves = groups.some(group =>
    group.leaves.some(
      leaf =>
        buildMeasureLeafOutputKey(group.metricKey, leaf) !== group.metricKey,
    ),
  );
  if (!hasDerivedLeaves) {
    return tree;
  }
  return applyMeasureLeafValuesToTree({
    tree,
    measureHierarchy: {
      kind: 'measureStackV1',
      groups,
    },
  });
};

const collectRequiredMeasureLeafSourceKeys = (
  formData: PivotTableProps['formData'],
): string[] => {
  const metricKeys = getMetricKeys(ensureIsArray(formData.metrics));
  if (metricKeys.length === 0) {
    return [];
  }
  const leavesByMetric = coerceMeasureLeavesByMetric(
    metricKeys,
    formData.measureLeavesByMetric,
  );
  const required = new Set<string>();
  metricKeys.forEach(metricKey => {
    (leavesByMetric[metricKey] ?? []).forEach(leaf => {
      if (leaf.kind === 'custom') {
        const customMetricKey = getMetricKey(leaf.metric);
        if (!customMetricKey) {
          return;
        }
        const sourceKey = leaf.offset
          ? buildOffsetMetricKey(customMetricKey, leaf.offset)
          : customMetricKey;
        required.add(sourceKey);
        return;
      }
      if (leaf.operator === 'value' || !leaf.offset) {
        return;
      }
      required.add(buildOffsetMetricKey(metricKey, leaf.offset));
    });
  });
  return Array.from(required);
};

const treeHasRequiredMeasureLeafSourceData = ({
  tree,
  formData,
}: {
  tree: PivotTreeData;
  formData: PivotTableProps['formData'];
}): boolean => {
  const requiredKeys = collectRequiredMeasureLeafSourceKeys(formData);
  if (requiredKeys.length === 0) {
    return true;
  }
  const unresolved = new Set(requiredKeys);
  Object.values(tree.cells).forEach(cell => {
    if (unresolved.size === 0) {
      return;
    }
    unresolved.forEach(key => {
      if (cell.values[key] !== undefined) {
        unresolved.delete(key);
      }
    });
  });
  return unresolved.size === 0;
};

const collectWarnings = (results: ChartDataQueryResult[]): ChartDataWarning[] =>
  results.flatMap(result => result.warnings ?? []);

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
type UiColumnSortState = {
  colKey: string;
  displayColKey?: string;
  metricKey: string;
  order: 'asc' | 'desc';
};

const dimensionDndType =
  INTERACTION_DIMENSION_DND_TYPE || 'pivot-v3-interaction-dimension';
const valueDndType = INTERACTION_VALUE_DND_TYPE || 'pivot-v3-interaction-value';

const normalizeRuntimeLayout = (
  layout: PivotRuntimeLayout | undefined,
  dimensionKeys: string[],
  metricKeys: string[],
): PivotRuntimeLayout => {
  const base: PivotRuntimeLayout =
    layout && layout.version === 1
      ? layout
      : {
          version: 1,
          rows: [],
          cols: [],
          metrics: metricKeys,
          leafSelection: {},
          valuePlacement: { axis: 'col', index: 0 },
        };
  const rows = base.rows.filter(key => dimensionKeys.includes(key));
  const cols = base.cols.filter(key => dimensionKeys.includes(key));
  const metrics = base.metrics.filter(key => metricKeys.includes(key));
  return {
    ...base,
    rows,
    cols,
    metrics: metrics.length > 0 ? metrics : metricKeys,
  };
};

const arraysEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const hasSameSet = (left: string[], right: string[]) =>
  left.length === right.length && left.every(value => right.includes(value));

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

const selectionSignature = (selection: PivotRuntimeLayout['leafSelection']) =>
  stableStringify(selection ?? {});

const valuePlacementSignature = (
  placement: PivotRuntimeLayout['valuePlacement'],
) => stableStringify(placement ?? {});

const leafOrderSignature = (order?: PivotRuntimeLayout['leafOrder']) =>
  stableStringify(order ?? []);

const addValuePlaceholder = ({
  keys,
  shouldInsert,
  index,
}: {
  keys: string[];
  shouldInsert: boolean;
  index: number;
}) => {
  if (!shouldInsert) {
    return keys;
  }
  const next = [...keys];
  const safeIndex = Math.max(0, Math.min(index, next.length));
  next.splice(safeIndex, 0, METRICS_PLACEHOLDER);
  return next;
};

const buildExpansionLayoutKeys = (layout: PivotRuntimeLayout) => ({
  rowKeys: addValuePlaceholder({
    keys: layout.rows,
    shouldInsert: layout.valuePlacement.axis === 'row',
    index: layout.valuePlacement.index,
  }),
  colKeys: addValuePlaceholder({
    keys: layout.cols,
    shouldInsert: layout.valuePlacement.axis === 'col',
    index: layout.valuePlacement.index,
  }),
});

const isMetricOrderOnlyChange = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
) => {
  if (!arraysEqual(prev.rows, next.rows)) {
    return false;
  }
  if (!arraysEqual(prev.cols, next.cols)) {
    return false;
  }
  if (!hasSameSet(prev.metrics, next.metrics)) {
    return false;
  }
  if (arraysEqual(prev.metrics, next.metrics)) {
    return false;
  }
  if (
    selectionSignature(prev.leafSelection) !==
    selectionSignature(next.leafSelection)
  ) {
    return false;
  }
  if (
    leafOrderSignature(prev.leafOrder) !== leafOrderSignature(next.leafOrder)
  ) {
    return false;
  }
  if (
    valuePlacementSignature(prev.valuePlacement) !==
    valuePlacementSignature(next.valuePlacement)
  ) {
    return false;
  }
  return true;
};

const isSameRuntimeLayout = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
) => {
  if (!arraysEqual(prev.rows, next.rows)) {
    return false;
  }
  if (!arraysEqual(prev.cols, next.cols)) {
    return false;
  }
  if (!arraysEqual(prev.metrics, next.metrics)) {
    return false;
  }
  if (
    selectionSignature(prev.leafSelection) !==
    selectionSignature(next.leafSelection)
  ) {
    return false;
  }
  if (
    leafOrderSignature(prev.leafOrder) !== leafOrderSignature(next.leafOrder)
  ) {
    return false;
  }
  if (
    valuePlacementSignature(prev.valuePlacement) !==
    valuePlacementSignature(next.valuePlacement)
  ) {
    return false;
  }
  return true;
};

function PivotTableChart(props: PivotTableProps) {
  const {
    data,
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
  const shouldPersistControlValue = true;
  const shouldPersistOwnState = !(isUserControlled && isDashboardContext);
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

  const dimensionLabelOverrides = useMemo(
    () =>
      Object.entries(resolvedVerboseMap ?? {}).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (typeof value === 'string') {
            acc[key] = value;
          }
          return acc;
        },
        {},
      ),
    [resolvedVerboseMap],
  );

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
  const [frozenUserViewProps, setFrozenUserViewProps] =
    useState<PivotViewProps | null>(null);
  const seamlessRequestRef = useRef(0);
  const pendingSeamlessLayoutRef = useRef<PivotRuntimeLayout | null>(null);
  const lastUpstreamQueryContextRef = useRef<{
    data: PivotTreeData;
    signature: string;
  } | null>(null);
  const expandedRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const expandedColsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingRowsForSeamlessRef = useRef<Set<string>>(new Set());
  const pendingColsForSeamlessRef = useRef<Set<string>>(new Set());
  const currentUserViewPropsRef = useRef<PivotViewProps | null>(null);
  const lastSeamlessSyncRef = useRef<{
    filtersSignature: string | null;
    layoutSignature: string;
    upstreamSignature: string;
  } | null>(null);
  const dataForRender = isUserControlled ? committedTree : data;

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
  const appliedDimensionList = useMemo(
    () => ensureIsArray(appliedFormData.dimensions),
    [appliedFormData.dimensions],
  );
  const dimensionKeys = useMemo(
    () => dimensionList.map(dimension => getStableColumnKey(dimension)),
    [dimensionList],
  );
  const appliedDimensionKeys = useMemo(
    () => appliedDimensionList.map(dimension => getStableColumnKey(dimension)),
    [appliedDimensionList],
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
  const appliedMetrics = useMemo(
    () => appliedFormData.metricsBase ?? appliedFormData.metrics ?? metrics,
    [appliedFormData.metrics, appliedFormData.metricsBase, metrics],
  );
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
  const [uiSelectedFilters, setUiSelectedFilters] = useState<
    Record<string, DataRecordValue[]>
  >(selectedFilters ?? EMPTY_SELECTED_FILTERS);
  const selectedFiltersFromProps = selectedFilters ?? EMPTY_SELECTED_FILTERS;
  const lastPersistedSelectionRef = useRef(selectedFiltersFromProps);
  const pendingPersistedSelectionSyncRef = useRef(false);
  const suppressStalePersistedFilterRestoreRef = useRef(false);
  const selectedFiltersFromOwnState =
    (ownState?.pivotSelectedFilters as
      | Record<string, DataRecordValue[]>
      | undefined) ?? EMPTY_SELECTED_FILTERS;
  const selectedFiltersForTreeSync = useMemo(() => {
    if (!isUserControlled) {
      return selectedFiltersFromProps;
    }
    if (
      formData.pivotSelectedFilters &&
      Object.keys(formData.pivotSelectedFilters).length > 0
    ) {
      return formData.pivotSelectedFilters;
    }
    if (Object.keys(selectedFiltersFromOwnState).length > 0) {
      return selectedFiltersFromOwnState;
    }
    return selectedFiltersFromProps;
  }, [
    formData.pivotSelectedFilters,
    isUserControlled,
    selectedFiltersFromOwnState,
    selectedFiltersFromProps,
  ]);

  useEffect(() => {
    const pendingLayout = pendingSeamlessLayoutRef.current;
    if (pendingLayout && isSameRuntimeLayout(runtimeLayout, pendingLayout)) {
      return;
    }
    setCommittedRuntimeLayout(current =>
      isSameRuntimeLayout(current, runtimeLayout) ? current : runtimeLayout,
    );
  }, [runtimeLayout]);
  const appliedMetricKeysBase = useMemo(
    () => getMetricKeys(ensureIsArray(appliedMetrics)),
    [appliedMetrics],
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
  const committedTreeFromProps = useMemo(
    () =>
      isUserControlled
        ? materializeTreeForMeasureLeaves({
            tree: data,
            formData: appliedLayoutFormData,
          })
        : data,
    [appliedLayoutFormData, data, isUserControlled],
  );
  const committedTreeFromPropsHasLeafSources = useMemo(
    () =>
      !isUserControlled ||
      treeHasRequiredMeasureLeafSourceData({
        tree: committedTreeFromProps,
        formData: appliedLayoutFormData,
      }),
    [appliedLayoutFormData, committedTreeFromProps, isUserControlled],
  );
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
    () => layoutGroupbyRows.map(dimension => getColumnLabel(dimension)),
    [layoutGroupbyRows],
  );
  const layoutMetricsLayout = useMemo(
    () =>
      isUserControlled
        ? (appliedLayoutFormData.metricsLayout ?? metricsLayout)
        : metricsLayout,
    [appliedLayoutFormData.metricsLayout, isUserControlled, metricsLayout],
  );

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
    if (!isUserControlled || !isDashboardContext || !queryFormData) {
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
  }, [isDashboardContext, isUserControlled, queryFormData]);

  const persistedInteractionFilters = useMemo(() => {
    if (!isUserControlled) {
      return EMPTY_SELECTED_FILTERS;
    }
    if (
      formData.pivotSelectedFilters &&
      Object.keys(formData.pivotSelectedFilters).length > 0
    ) {
      return normalizeSelectedFilters(formData.pivotSelectedFilters);
    }
    const ownFilters = ownState?.pivotSelectedFilters as
      | Record<string, DataRecordValue[]>
      | undefined;
    if (ownFilters && Object.keys(ownFilters).length > 0) {
      return normalizeSelectedFilters(ownFilters);
    }
    return EMPTY_SELECTED_FILTERS;
  }, [
    formData.pivotSelectedFilters,
    isUserControlled,
    normalizeSelectedFilters,
    ownState?.pivotSelectedFilters,
  ]);
  const persistedInteractionFiltersSignature = useMemo(
    () =>
      hasSelectedFilters(persistedInteractionFilters)
        ? stableStringify(persistedInteractionFilters)
        : null,
    [persistedInteractionFilters],
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
  const shouldSyncCommittedTreeFromProps = useMemo(() => {
    if (!isUserControlled) {
      return true;
    }
    if (hasSelectedFilters(persistedInteractionFilters)) {
      return false;
    }
    if (!isSameRuntimeLayout(runtimeLayout, committedRuntimeLayout)) {
      return false;
    }
    if (!isEqual(selectedFiltersForTreeSync, committedFilters)) {
      return false;
    }
    return committedTreeFromPropsHasLeafSources;
  }, [
    committedFilters,
    committedRuntimeLayout,
    committedTreeFromPropsHasLeafSources,
    isUserControlled,
    persistedInteractionFilters,
    runtimeLayout,
    selectedFiltersForTreeSync,
  ]);
  useEffect(() => {
    // Ignore stale upstream updates while a local interaction update is still
    // pending or while upstream data is incompatible with active measure leaves.
    if (!shouldSyncCommittedTreeFromProps) {
      return;
    }
    setCommittedTree(committedTreeFromProps);
    setSeamlessWarnings([]);
    setSeamlessError(undefined);
    setSeamlessLoading(false);
    setFrozenUserViewProps(null);
    pendingSeamlessLayoutRef.current = null;
  }, [committedTreeFromProps, shouldSyncCommittedTreeFromProps]);

  useEffect(() => {
    const pendingLayout = pendingSeamlessLayoutRef.current;
    if (pendingLayout && isSameRuntimeLayout(runtimeLayout, pendingLayout)) {
      return;
    }
    setUiRuntimeLayout(runtimeLayout);
  }, [runtimeLayout]);

  const persistedSelectedFilters = useMemo(() => {
    if (!isUserControlled) {
      return normalizeSelectedFilters(selectedFilters);
    }
    if (
      formData.pivotSelectedFilters &&
      Object.keys(formData.pivotSelectedFilters).length > 0
    ) {
      return normalizeSelectedFilters(formData.pivotSelectedFilters);
    }
    const ownFilters = ownState?.pivotSelectedFilters as
      | Record<string, DataRecordValue[]>
      | undefined;
    if (ownFilters && Object.keys(ownFilters).length > 0) {
      return normalizeSelectedFilters(ownFilters);
    }
    if (Object.keys(committedFilters).length > 0) {
      return normalizeSelectedFilters(committedFilters);
    }
    return normalizeSelectedFilters(selectedFilters);
  }, [
    committedFilters,
    isUserControlled,
    normalizeSelectedFilters,
    formData.pivotSelectedFilters,
    ownState?.pivotSelectedFilters,
    selectedFilters,
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
      if (shouldPersistControlValue && setControlValue) {
        setControlValue('pivotRuntimeLayout', layout);
        setControlValue('pivotSelectedFilters', filters);
      }
      if (shouldPersistOwnState) {
        setDataMask({ ownState: { ...nextOwnState } });
      }
    },
    [
      mergeOwnState,
      setControlValue,
      setDataMask,
      shouldPersistControlValue,
      shouldPersistOwnState,
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
      const metricsForLayout =
        formData.metricsBase ??
        formData.metrics ??
        fetchFormDataBaseWithFormatters.metrics;
      const leavesForLayout =
        formData.measureLeavesByMetricBase ??
        formData.measureLeavesByMetric ??
        fetchFormDataBaseWithFormatters.measureLeavesByMetric;
      const liveSnapshot = currentUserViewPropsRef.current;
      const expandedRowsForPlan = new Set<string>([
        ...(liveSnapshot?.expandedRows ?? expandedRowsForSeamlessRef.current),
        ...pendingRowsForSeamlessRef.current,
      ]);
      const expandedColsForPlan = new Set<string>([
        ...(liveSnapshot?.expandedCols ?? expandedColsForSeamlessRef.current),
        ...pendingColsForSeamlessRef.current,
      ]);
      const toExpansionPaths = (keys: Set<string>) =>
        Array.from(keys).map(key => parsePath(key));
      const formDataForPlan = (() => {
        if (!isUserControlled) {
          return fetchFormDataBaseWithFormatters;
        }
        const { rowKeys, colKeys } = buildExpansionLayoutKeys(normalized);
        return {
          ...fetchFormDataBaseWithFormatters,
          pivotExpansionState: {
            rowKeys,
            colKeys,
            rows: toExpansionPaths(expandedRowsForPlan),
            cols: toExpansionPaths(expandedColsForPlan),
            collapsedRows: [],
            collapsedCols: [],
          },
        };
      })();
      const {
        formData: resolvedFormDataWithOffsets,
        layout,
        specs,
      } = buildInitialPivotUpdatePlan({
        formData: formDataForPlan,
        runtimeLayout: normalized,
        selection: nextFilters,
        metricsOverride: isUserControlled ? metricsForLayout : undefined,
        measureLeavesByMetricOverride: isUserControlled
          ? leavesForLayout
          : undefined,
      });
      if (isUserControlled) {
        const snapshot = liveSnapshot;
        if (snapshot) {
          setFrozenUserViewProps({
            ...snapshot,
            expandedRows: new Set(snapshot.expandedRows),
            expandedCols: new Set(snapshot.expandedCols),
            warnings: [...(snapshot.warnings ?? [])],
            showGlobalLoader: false,
            showCornerLoader: true,
            showRowSpinner: () => false,
            showColSpinner: () => false,
          });
        }
      }
      const requestId = seamlessRequestRef.current + 1;
      seamlessRequestRef.current = requestId;
      supersetChartDataClient.cancel(SEAMLESS_REQUEST_GROUP);
      setSeamlessLoading(true);
      setSeamlessError(undefined);
      try {
        const results = await supersetChartDataClient.fetch({
          formData: resolvedFormDataWithOffsets,
          specs,
          requestGroupId: SEAMLESS_REQUEST_GROUP,
        });
        if (requestId !== seamlessRequestRef.current) {
          return;
        }
        const nextTree = buildTreeFromQueryResults({
          results,
          specs,
          layout,
          formData: resolvedFormDataWithOffsets,
        });
        unstable_batchedUpdates(() => {
          setCommittedTree(nextTree);
          setUiRuntimeLayout(normalized);
          setCommittedFilters(nextFilters);
          setSeamlessWarnings(collectWarnings(results));
          persistRuntimeState(normalized, nextFilters);
        });
        lastSeamlessSyncRef.current = {
          filtersSignature:
            Object.keys(nextFilters).length > 0
              ? stableStringify(nextFilters)
              : null,
          layoutSignature: stableStringify(normalized),
          upstreamSignature: upstreamSeamlessSignature,
        };
      } catch (error) {
        if (requestId !== seamlessRequestRef.current) {
          return;
        }
        if (
          typeof DOMException !== 'undefined' &&
          error instanceof DOMException &&
          error.name === 'AbortError'
        ) {
          return;
        }
        setSeamlessError(
          error instanceof Error ? error.message : t('Failed to update data'),
        );
      } finally {
        if (requestId === seamlessRequestRef.current) {
          pendingSeamlessLayoutRef.current = null;
          setSeamlessLoading(false);
        }
      }
    },
    [
      dimensionKeys,
      fetchFormDataBaseWithFormatters,
      formData,
      isUserControlled,
      metricKeys,
      persistRuntimeState,
      setCommittedFilters,
      setCommittedTree,
      setSeamlessError,
      setSeamlessLoading,
      setSeamlessWarnings,
      upstreamSeamlessSignature,
    ],
  );

  const handleRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      const skipMetricOrderCommit =
        isUserControlled &&
        queryFormData &&
        isMetricOrderOnlyChange(committedRuntimeLayout, normalized);
      if (shouldFetchForLayoutChange(committedRuntimeLayout, normalized)) {
        const shouldDeferUiLayoutCommit =
          committedRuntimeLayout.valuePlacement.axis !==
            normalized.valuePlacement.axis ||
          committedRuntimeLayout.valuePlacement.index !==
            normalized.valuePlacement.index;
        if (shouldDeferUiLayoutCommit) {
          pendingSeamlessLayoutRef.current = normalized;
        }
        if (!shouldDeferUiLayoutCommit) {
          setUiRuntimeLayout(normalized);
        }
        applySeamlessUpdate(normalized, uiSelectedFilters);
        return;
      }
      setUiRuntimeLayout(normalized);
      if (skipMetricOrderCommit) {
        return;
      }
      persistRuntimeState(normalized, uiSelectedFilters);
    },
    [
      applySeamlessUpdate,
      committedRuntimeLayout,
      dimensionKeys,
      metricKeys,
      persistRuntimeState,
      queryFormData,
      isUserControlled,
      uiSelectedFilters,
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

  const dimensionLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    dimensionList.forEach(dimension => {
      const key = getStableColumnKey(dimension);
      const baseLabel = getColumnLabel(dimension);
      const label =
        typeof dimension === 'string'
          ? (dimensionLabelOverrides[key] ?? baseLabel)
          : baseLabel;
      map.set(key, label);
    });
    return map;
  }, [dimensionLabelOverrides, dimensionList]);

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
  const shouldPersistExpansionState = persistExpansionState;
  const expansionSetControlValue = shouldPersistControlValue
    ? setControlValue
    : undefined;
  const expansionSetDataMask = shouldPersistOwnState ? setDataMask : undefined;
  const expansionMergeOwnState = shouldPersistOwnState
    ? mergeOwnState
    : undefined;

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
    countDimDepth: layoutResult.countEngineDimDepth,
    expandRowsLevelRaw: layoutResult.expandRowsLevelRaw,
    expandColumnsLevelRaw: layoutResult.expandColumnsLevelRaw,
    setControlValue: expansionSetControlValue,
    setDataMask: expansionSetDataMask,
    mergeOwnState: expansionMergeOwnState,
    persistedExpansionState:
      appliedLayoutFormData.pivotExpansionState ??
      ownState?.pivotExpansionState,
    shouldPersistExpansionState,
    getFetchPath: layoutResult.getFetchPath,
    pruneMergedTree: layoutResult.pruneMergedTree,
  });
  const treeForRender = useMemo(
    () =>
      materializeTreeForMeasureLeaves({
        tree,
        formData: appliedLayoutFormData,
      }),
    [appliedLayoutFormData, tree],
  );

  useEffect(() => {
    expandedRowsForSeamlessRef.current = expandedRows;
  }, [expandedRows]);

  useEffect(() => {
    expandedColsForSeamlessRef.current = expandedCols;
  }, [expandedCols]);

  useEffect(() => {
    pendingRowsForSeamlessRef.current = pendingRows;
  }, [pendingRows]);

  useEffect(() => {
    pendingColsForSeamlessRef.current = pendingCols;
  }, [pendingCols]);

  useEffect(() => {
    if (!frozenUserViewProps) {
      return;
    }
    const settled =
      !seamlessLoading &&
      !isHydrating &&
      loadingKeys.size === 0 &&
      pendingRows.size === 0 &&
      pendingCols.size === 0;
    if (settled) {
      setFrozenUserViewProps(null);
    }
  }, [
    frozenUserViewProps,
    isHydrating,
    loadingKeys,
    pendingCols,
    pendingRows,
    seamlessLoading,
  ]);

  useEffect(() => {
    treeRef.current = treeForRender;
  }, [treeForRender]);

  const renderModelResult = usePivotRenderModel({
    tree: treeForRender,
    expandedRows,
    expandedCols,
    loadingKeys,
    isHydrating,
    formData: appliedLayoutFormData,
    rowOrder,
    colOrder,
    groupbyRows: layoutResult.layout.groupbyRows,
    groupbyColumns: layoutResult.layout.groupbyColumns,
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
      const leafId = [...node.path]
        .reverse()
        .map(value => decodeMeasureLeafId(value))
        .find((value): value is string => Boolean(value));
      if (!leafId) {
        return resolveMeasureSortMetricKey({
          metricKey,
          measureHierarchy: layoutResult.measureHierarchy,
        });
      }
      const group = layoutResult.measureHierarchy.groups.find(
        candidate => candidate.metricKey === metricKey,
      );
      const leaf = group?.leaves.find(candidate => candidate.id === leafId);
      if (!leaf) {
        return resolveMeasureSortMetricKey({
          metricKey,
          measureHierarchy: layoutResult.measureHierarchy,
        });
      }
      return buildMeasureLeafOutputKey(metricKey, leaf);
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
      const nodeLeafId = [...node.path]
        .reverse()
        .map(value => decodeMeasureLeafId(value))
        .find((value): value is string => Boolean(value));
      if (nodeLeafId === sortLeafId) {
        return node.key;
      }
      const descendant = Object.values(renderTree.cols)
        .filter(candidate => {
          if (candidate.key === node.key) {
            return false;
          }
          if (candidate.path.length <= node.path.length) {
            return false;
          }
          return node.path.every(
            (value, index) => candidate.path[index] === value,
          );
        })
        .map(candidate => {
          const candidateLeafId = [...candidate.path]
            .reverse()
            .map(value => decodeMeasureLeafId(value))
            .find((value): value is string => Boolean(value));
          return { candidate, candidateLeafId };
        })
        .filter(
          (
            entry,
          ): entry is { candidate: PivotTreeNode; candidateLeafId: string } =>
            entry.candidateLeafId === sortLeafId,
        )
        .sort(
          (left, right) =>
            left.candidate.path.length - right.candidate.path.length,
        )[0];
      return descendant?.candidate.key ?? node.key;
    },
    [layoutResult, renderTree.cols],
  );

  const isColumnSortable = useCallback(
    (node: PivotTreeNode) => Boolean(resolveColumnSortMetric(node)),
    [resolveColumnSortMetric],
  );

  const getColumnSortOrder = useCallback(
    (node: PivotTreeNode) => {
      if (!activeColumnSort) {
        return undefined;
      }
      return (activeColumnSort.displayColKey ?? activeColumnSort.colKey) ===
        node.key
        ? activeColumnSort.order
        : undefined;
    },
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
    layoutGroupbyColumns,
    layoutGroupbyRows,
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
    ? seamlessLoading || renderModelResult.showGlobalLoader
    : renderModelResult.showGlobalLoader;
  const tableOverlayVisible =
    !isUserControlled && renderModelResult.showGlobalLoader;
  const tableWidth = isUserControlled
    ? Math.max(0, width - PANEL_WIDTH - SIDE_CHIPS_WIDTH)
    : width;
  const tableHeight = isUserControlled
    ? Math.max(0, height - TOP_CHIPS_HEIGHT)
    : height;
  const liveUserPivotViewProps: PivotViewProps = {
    height: tableHeight,
    width: tableWidth,
    renderModel: renderModelResult.renderModel,
    tree: renderTree,
    expandedRows: renderModelResult.expandedRowsForRender,
    expandedCols: renderModelResult.expandedColsForRender,
    errorMessage: activeErrorMessage,
    onRetry: handleRetry,
    warnings: combinedWarnings,
    showGlobalLoader: false,
    showCornerLoader: cornerLoaderVisible,
    stickyHeaders: resolvedStickyHeaders,
    headerOffset,
    headerRowOffsets,
    headerRef,
    themeColor: formatting.themeColor,
    colTotalPosition: layoutResult.resolvedColTotalPosition,
    metricFormattingScope: formatting.metricFormattingScope,
    metricDatabars: formatting.metricDatabars,
    formattingKeyMap: formatting.formattingKeyMap,
    evaluateExcelMetricFormatting: formatting.evaluateExcelMetricFormatting,
    databarColumnMinWidths: formatting.databarColumnMinWidths,
    onToggleNode: handleToggle,
    onSortColumn: handleColumnSort,
    isColumnSortable,
    getColumnSortOrder,
    shouldShowToggle: renderModelResult.shouldShowToggle,
    showRowSpinner: renderModelResult.showRowSpinner,
    showColSpinner: renderModelResult.showColSpinner,
    formatLabel: formatting.formatLabel,
    isRowAggregateBold: renderModelResult.isRowAggregateBold,
    isColAggregateBold: renderModelResult.isColAggregateBold,
    getNodeDimDepth: renderModelResult.getNodeDimDepth,
    getTotalBackground: formatting.getTotalBackground,
    resolveDimensionStyle: formatting.resolveDimensionStyle,
    deriveMetricKey: formatting.deriveMetricKey,
    isMetricGrandTotalNode: layoutResult.isMetricGrandTotalNode,
    renderCellContent: formatting.renderCellContent,
    renderDatabarContent: formatting.renderDatabarContent,
    emitCrossFilters,
    handleCellClick: interactions.handleCellClick,
    handleCellKeyDown: interactions.handleCellKeyDown,
    handleCellContextMenu: interactions.handleCellContextMenu,
    rowAxisLabels,
  };
  if (isUserControlled) {
    currentUserViewPropsRef.current = liveUserPivotViewProps;
  }
  const activeUserPivotViewProps =
    frozenUserViewProps ?? liveUserPivotViewProps;
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

  const removeDimensionFromLayout = useCallback(
    (dimensionKey: string) => {
      const rowIndex = uiRuntimeLayout.rows.indexOf(dimensionKey);
      const colIndex = uiRuntimeLayout.cols.indexOf(dimensionKey);
      if (rowIndex < 0 && colIndex < 0) {
        return uiRuntimeLayout;
      }
      const nextRows = uiRuntimeLayout.rows.filter(key => key !== dimensionKey);
      const nextCols = uiRuntimeLayout.cols.filter(key => key !== dimensionKey);
      const nextValuePlacement = { ...uiRuntimeLayout.valuePlacement };
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
        ...uiRuntimeLayout,
        rows: nextRows,
        cols: nextCols,
        valuePlacement: nextValuePlacement,
      };
    },
    [uiRuntimeLayout],
  );

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
      const nextLayout = applyDimensionDrag(uiRuntimeLayout, {
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
    [handleRuntimeLayoutChange, metricsAvailable, uiRuntimeLayout],
  );

  const handleValueDrop = useCallback(
    (
      targetAxis: PivotAxis,
      targetChipIndex: number | undefined,
      sourceAxis: PivotAxis,
      sourceChipIndex?: number,
    ) => {
      const nextLayout = applyValueDrag(uiRuntimeLayout, {
        targetAxis,
        targetChipIndex,
        sourceAxis,
        sourceChipIndex,
        metricsAvailable,
      });
      handleRuntimeLayoutChange(nextLayout);
    },
    [handleRuntimeLayoutChange, metricsAvailable, uiRuntimeLayout],
  );

  const [, dropOnRowStrip] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: (item, monitor) => {
      if (monitor.didDrop()) {
        return;
      }
      const targetChipIndex = getStripDropIndex(
        'row',
        monitor.getClientOffset(),
      );
      if (item.kind === 'dimension') {
        handleDimensionDrop(
          item.dimensionKey,
          'row',
          targetChipIndex,
          false,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      } else {
        handleValueDrop(
          'row',
          targetChipIndex,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      }
    },
  });

  const [, dropOnColStrip] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: (item, monitor) => {
      if (monitor.didDrop()) {
        return;
      }
      const targetChipIndex = getStripDropIndex(
        'col',
        monitor.getClientOffset(),
      );
      if (item.kind === 'dimension') {
        handleDimensionDrop(
          item.dimensionKey,
          'col',
          targetChipIndex,
          false,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      } else {
        handleValueDrop(
          'col',
          targetChipIndex,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      }
    },
  });

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
          dimensionLabelMap={dimensionLabelOverrides}
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
          <TableArea
            $height={tableHeight}
            $width={tableWidth}
            style={frozenUserViewProps ? { pointerEvents: 'none' } : undefined}
          >
            <PivotTableView {...activeUserPivotViewProps} />
            {tableOverlayVisible ? <Loading /> : null}
          </TableArea>
        </TableRow>
      </InteractionTableWrap>
    </InteractionLayout>
  ) : (
    <PivotTableView
      height={height}
      width={width}
      renderModel={renderModelResult.renderModel}
      tree={renderTree}
      expandedRows={renderModelResult.expandedRowsForRender}
      expandedCols={renderModelResult.expandedColsForRender}
      errorMessage={activeErrorMessage}
      onRetry={handleRetry}
      warnings={combinedWarnings}
      showGlobalLoader={renderModelResult.showGlobalLoader}
      showCornerLoader={renderModelResult.showGlobalLoader}
      stickyHeaders={resolvedStickyHeaders}
      headerOffset={headerOffset}
      headerRowOffsets={headerRowOffsets}
      headerRef={headerRef}
      themeColor={formatting.themeColor}
      colTotalPosition={layoutResult.resolvedColTotalPosition}
      metricFormattingScope={formatting.metricFormattingScope}
      metricDatabars={formatting.metricDatabars}
      formattingKeyMap={formatting.formattingKeyMap}
      evaluateExcelMetricFormatting={formatting.evaluateExcelMetricFormatting}
      databarColumnMinWidths={formatting.databarColumnMinWidths}
      onToggleNode={handleToggle}
      onSortColumn={handleColumnSort}
      isColumnSortable={isColumnSortable}
      getColumnSortOrder={getColumnSortOrder}
      shouldShowToggle={renderModelResult.shouldShowToggle}
      showRowSpinner={renderModelResult.showRowSpinner}
      showColSpinner={renderModelResult.showColSpinner}
      formatLabel={formatting.formatLabel}
      isRowAggregateBold={renderModelResult.isRowAggregateBold}
      isColAggregateBold={renderModelResult.isColAggregateBold}
      getNodeDimDepth={renderModelResult.getNodeDimDepth}
      getTotalBackground={formatting.getTotalBackground}
      resolveDimensionStyle={formatting.resolveDimensionStyle}
      deriveMetricKey={formatting.deriveMetricKey}
      isMetricGrandTotalNode={layoutResult.isMetricGrandTotalNode}
      renderCellContent={formatting.renderCellContent}
      renderDatabarContent={formatting.renderDatabarContent}
      emitCrossFilters={emitCrossFilters}
      handleCellClick={interactions.handleCellClick}
      handleCellKeyDown={interactions.handleCellKeyDown}
      handleCellContextMenu={interactions.handleCellContextMenu}
      rowAxisLabels={rowAxisLabels}
    />
  );
}

export default PivotTableChart;
