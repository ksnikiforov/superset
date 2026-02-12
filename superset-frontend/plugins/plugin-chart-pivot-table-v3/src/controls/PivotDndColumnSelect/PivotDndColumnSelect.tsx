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
  type ComponentProps,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DropTargetMonitor } from 'react-dnd';
import { useDispatch } from 'react-redux';
import {
  AdhocColumn,
  ensureIsArray,
  getColumnLabel,
  Metric,
  tn,
  QueryFormColumn,
  QueryFormMetric,
  styled,
  t,
  isAdhocColumn,
} from '@superset-ui/core';
import {
  Button,
  Popover,
  Radio,
  Space,
  Tooltip,
  Typography,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { ColumnMeta, isColumnMeta } from '@superset-ui/chart-controls';
import { isEmpty, isEqual } from 'lodash';
import {
  ColumnSelectPopoverTrigger,
  type DndControlProps,
  DndItemType,
  isDatasourcePanelDndItem,
  setControlValueAction,
} from '../../exploreImports';
import {
  METRICS_PLACEHOLDER,
  buildMetricLabelMap,
  mergeMetrics,
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  transferDimensionSettingsAcrossAxes,
} from '../../utils';
import {
  DimensionFormattingField,
  DimensionFormattingScope,
  PivotDimensionFormatting,
  PivotDimensionFormattingMap,
  PivotDimensionSorting,
  PivotDimensionSortingMap,
  PivotSortMode,
  PivotSortOrder,
  MetricsLayoutEnum,
  PivotDimensionFormattingValue,
} from '../../types';
import {
  MetricFormatSelector,
  MetricOptionValue,
} from '../PivotDndMetricSelect/PivotMetricDefinitionValue';
import PivotOptionWrapper from './PivotOptionWrapper';
import PivotDndSelectLabel from './PivotSelectLabel';
import { OptionSelector } from './optionSelector';

const DEFAULT_DRAG_TYPE = 'pivot_v3_dnd';
const NOOP_CLICK_CLOSE = () => {};

const DEFAULT_DIMENSION_FORMATTING_SCOPE: DimensionFormattingScope = 'all';
const DEFAULT_DIMENSION_SORT_ORDER: PivotSortOrder = 'asc';
const DEFAULT_DIMENSION_SORT_MODE: PivotSortMode = 'total';

const isColumnMetaValue = (
  column: ColumnMeta | AdhocColumn | string,
): column is ColumnMeta => typeof column !== 'string' && isColumnMeta(column);

const DIMENSION_FORMAT_SELECTOR_CONFIG: Array<{
  field: DimensionFormattingField;
  label: string;
  tooltip: ReactNode;
}> = [
  {
    field: 'backgroundColor',
    label: t('Background color metric'),
    tooltip: t(
      "Metric that returns a color for the row or column background (HEX, RGB, or RGBA). Example: '#111111'.",
    ),
  },
  {
    field: 'textColor',
    label: t('Text color metric'),
    tooltip: t(
      "Metric that returns a color for the row or column text (HEX, RGB, or RGBA). Example: '#ffffff'.",
    ),
  },
];

const DimensionFormattingButton = styled(Button)`
  height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-width: ${({ theme }) => theme.sizeUnit * 5}px;
  width: ${({ theme }) => theme.sizeUnit * 5}px;
  padding: 0;
`;

const DimensionFormattingButtonWrap = styled.div`
  display: flex;
  align-items: center;
  padding-right: ${({ theme }) => theme.sizeUnit}px;
`;

const DimensionSortingButton = styled(Button)`
  height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-width: ${({ theme }) => theme.sizeUnit * 5}px;
  width: ${({ theme }) => theme.sizeUnit * 5}px;
  padding: 0;
`;

const DimensionSortingButtonWrap = styled.div`
  display: flex;
  align-items: center;
  padding-right: ${({ theme }) => theme.sizeUnit}px;
`;

type WindowWithPivotDebug = Window & { PIVOT_V3_DEBUG_PLACEMENT?: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type DroppedColumn = ColumnMeta | AdhocColumn | QueryFormColumn;

const isDroppedColumn = (value: unknown): value is DroppedColumn =>
  typeof value === 'string' ||
  (typeof value === 'object' && value !== null && isColumnMeta(value)) ||
  isAdhocColumn(value as QueryFormColumn);

const getDroppedColumnValue = (item: unknown): DroppedColumn | undefined => {
  if (isDatasourcePanelDndItem(item)) {
    return isDroppedColumn(item.value) ? item.value : undefined;
  }
  if (isRecord(item)) {
    const candidate = item.value ?? item.column;
    return isDroppedColumn(candidate) ? candidate : undefined;
  }
  return undefined;
};

export type PivotPlacement = {
  axis: 'rows' | 'cols';
  rows: QueryFormColumn[];
  cols: QueryFormColumn[];
  hasMetrics: boolean;
  preferredAxis?: MetricsLayoutEnum;
  controlNames?: { rows: string; cols: string };
  resolve?: (
    rows: QueryFormColumn[],
    cols: QueryFormColumn[],
    options: {
      hasMetrics: boolean;
      preferredAxis?: MetricsLayoutEnum;
      lastMoved?: 'row' | 'col';
    },
  ) => {
    rows: QueryFormColumn[];
    cols: QueryFormColumn[];
    layout?: MetricsLayoutEnum;
  };
  setControlValue?: (
    name: string,
    value: QueryFormColumn[] | QueryFormColumn | null | undefined,
    errors?: string[],
  ) => void;
};

export type PivotDndColumnSelectProps = DndControlProps<QueryFormColumn> & {
  options: ColumnMeta[];
  savedMetrics?: Metric[];
  datasource?: ComponentProps<typeof MetricFormatSelector>['datasource'];
  isTemporal?: boolean;
  disabledTabs?: Set<string>;
  dragTypeOverride?: string;
  listId?: string;
  pivotPlacement?: PivotPlacement;
};

function PivotDndColumnSelect(props: PivotDndColumnSelectProps) {
  const dispatch = useDispatch();
  const {
    value,
    options,
    multi = true,
    onChange,
    canDelete = true,
    ghostButtonText,
    name,
    isTemporal,
    disabledTabs,
    dragTypeOverride,
    listId,
    pivotPlacement,
    formData,
    savedMetrics = [],
    datasource,
  } = props;
  const [newColumnPopoverVisible, setNewColumnPopoverVisible] = useState(false);
  const lastHoverRef = useRef<{ index: number | null; listId?: string }>({
    index: null,
    listId: undefined,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragType = dragTypeOverride || DEFAULT_DRAG_TYPE;
  const currentListId = listId || name;
  const axis: 'row' | 'col' =
    pivotPlacement?.axis === 'cols'
      ? 'col'
      : pivotPlacement?.axis === 'rows'
        ? 'row'
        : name === 'groupbyColumns'
          ? 'col'
          : 'row';
  const formattingControlName: 'rowFormatting' | 'colFormatting' =
    axis === 'row' ? 'rowFormatting' : 'colFormatting';
  const sortingControlName: 'rowSorting' | 'colSorting' =
    axis === 'row' ? 'rowSorting' : 'colSorting';
  const setControlValue = props.actions?.setControlValue;

  const optionSelector = useMemo(() => {
    const optionsMap = Object.fromEntries(
      options.map(option => [option.column_name, option]),
    );

    return new OptionSelector(optionsMap, multi, value);
  }, [multi, options, value]);

  const dimensionFormatting = useMemo(() => {
    const rawFormatting =
      (formData?.[formattingControlName] as PivotDimensionFormattingMap) || {};
    return normalizeDimensionFormattingMapWithKeys(
      rawFormatting,
      ensureIsArray<QueryFormColumn>(value),
    );
  }, [formData, formattingControlName, value]);
  const dimensionSorting = useMemo(() => {
    const rawSorting =
      (formData?.[sortingControlName] as PivotDimensionSortingMap) || {};
    return normalizeDimensionSortingMapWithKeys(
      rawSorting,
      ensureIsArray<QueryFormColumn>(value),
    );
  }, [formData, sortingControlName, value]);
  const formattingRef =
    useRef<PivotDimensionFormattingMap>(dimensionFormatting);
  const formattingPendingRef = useRef<PivotDimensionFormattingMap | null>(null);
  const [localFormatting, setLocalFormatting] =
    useState<PivotDimensionFormattingMap>(dimensionFormatting);
  const sortingRef = useRef<PivotDimensionSortingMap>(dimensionSorting);
  const sortingPendingRef = useRef<PivotDimensionSortingMap | null>(null);
  const [localSorting, setLocalSorting] =
    useState<PivotDimensionSortingMap>(dimensionSorting);

  useEffect(() => {
    if (formattingPendingRef.current) {
      if (isEqual(dimensionFormatting, formattingPendingRef.current)) {
        formattingPendingRef.current = null;
        formattingRef.current = dimensionFormatting;
        if (!isEqual(dimensionFormatting, localFormatting)) {
          setLocalFormatting(dimensionFormatting);
        }
      }
      return;
    }
    formattingRef.current = dimensionFormatting;
    if (!isEqual(dimensionFormatting, localFormatting)) {
      setLocalFormatting(dimensionFormatting);
    }
  }, [dimensionFormatting, localFormatting]);

  useEffect(() => {
    if (sortingPendingRef.current) {
      if (isEqual(dimensionSorting, sortingPendingRef.current)) {
        sortingPendingRef.current = null;
        sortingRef.current = dimensionSorting;
        if (!isEqual(dimensionSorting, localSorting)) {
          setLocalSorting(dimensionSorting);
        }
      }
      return;
    }
    sortingRef.current = dimensionSorting;
    if (!isEqual(dimensionSorting, localSorting)) {
      setLocalSorting(dimensionSorting);
    }
  }, [dimensionSorting, localSorting]);

  const toArray = useCallback(
    (val: QueryFormColumn[] | QueryFormColumn | null | undefined) =>
      Array.isArray(val) ? val : val == null ? [] : [val],
    [],
  );

  const availableMetrics = useMemo(() => {
    const selectedMetrics = ensureIsArray<QueryFormMetric>(formData?.metrics);
    const savedMetricNames = savedMetrics
      .map(metric => metric.metric_name)
      .filter(Boolean) as QueryFormMetric[];
    return mergeMetrics(selectedMetrics, savedMetricNames);
  }, [formData?.metrics, savedMetrics]);

  const metricLabelMap = useMemo(
    () =>
      buildMetricLabelMap(
        savedMetrics,
        formData?.metricLabelMap as Record<string, string> | undefined,
      ),
    [formData?.metricLabelMap, savedMetrics],
  );

  const resetHover = useCallback(() => {
    lastHoverRef.current = { index: null, listId: undefined };
  }, []);

  const applyChange = useCallback(
    (nextValue: QueryFormColumn[] | QueryFormColumn | null | undefined) => {
      const debugOn = Boolean(
        (window as WindowWithPivotDebug).PIVOT_V3_DEBUG_PLACEMENT,
      );
      if (
        pivotPlacement?.resolve &&
        pivotPlacement.controlNames?.rows &&
        pivotPlacement.controlNames?.cols
      ) {
        const prevRows = toArray(pivotPlacement.rows);
        const prevCols = toArray(pivotPlacement.cols);
        let rowsNext =
          pivotPlacement.axis === 'rows' ? toArray(nextValue) : prevRows;
        let colsNext =
          pivotPlacement.axis === 'cols' ? toArray(nextValue) : prevCols;
        if (pivotPlacement.axis === 'rows') {
          colsNext = colsNext.filter(
            val => val === METRICS_PLACEHOLDER || !rowsNext.includes(val),
          );
        } else {
          rowsNext = rowsNext.filter(
            val => val === METRICS_PLACEHOLDER || !colsNext.includes(val),
          );
        }
        const resolved = pivotPlacement.resolve(rowsNext, colsNext, {
          hasMetrics: pivotPlacement.hasMetrics,
          preferredAxis: pivotPlacement.preferredAxis,
          lastMoved: pivotPlacement.axis === 'rows' ? 'row' : 'col',
        });
        if (debugOn) {
          // eslint-disable-next-line no-console
          console.log('[pivot-v3] DnD applyChange', {
            axis: pivotPlacement.axis,
            rowsNext,
            colsNext,
            resolved,
          });
        }
        const setControl = (
          controlName: string,
          val: QueryFormColumn[],
          errors: string[] = [],
        ) => {
          if (pivotPlacement.setControlValue) {
            pivotPlacement.setControlValue(controlName, val, errors);
            return;
          }
          dispatch(setControlValueAction(controlName, val, errors));
        };
        const transferredSettings = transferDimensionSettingsAcrossAxes(
          prevRows,
          prevCols,
          resolved.rows,
          resolved.cols,
          {
            rowFormatting: formData?.rowFormatting,
            colFormatting: formData?.colFormatting,
            rowSorting: formData?.rowSorting,
            colSorting: formData?.colSorting,
          },
        );
        const { controlNames } = pivotPlacement;
        if (!controlNames) {
          return;
        }
        // Defer control updates to avoid unmounting drop targets mid-drag,
        // which can trigger react-dnd's "Expected to find a valid target".
        requestAnimationFrame(() => {
          setControl(controlNames.rows, resolved.rows);
          setControl(controlNames.cols, resolved.cols);
          if (transferredSettings.hasAxisChanges && setControlValue) {
            if (
              !isEqual(
                formData?.rowFormatting || {},
                transferredSettings.rowFormatting,
              )
            ) {
              setControlValue(
                'rowFormatting',
                transferredSettings.rowFormatting,
              );
            }
            if (
              !isEqual(
                formData?.colFormatting || {},
                transferredSettings.colFormatting,
              )
            ) {
              setControlValue(
                'colFormatting',
                transferredSettings.colFormatting,
              );
            }
            if (
              !isEqual(
                formData?.rowSorting || {},
                transferredSettings.rowSorting,
              )
            ) {
              setControlValue('rowSorting', transferredSettings.rowSorting);
            }
            if (
              !isEqual(
                formData?.colSorting || {},
                transferredSettings.colSorting,
              )
            ) {
              setControlValue('colSorting', transferredSettings.colSorting);
            }
          }
        });
        resetHover();
        return;
      }
      if (debugOn) {
        // eslint-disable-next-line no-console
        console.log('[pivot-v3] DnD fallback applyChange', {
          axis: pivotPlacement?.axis,
          pivotPlacementPresent: !!pivotPlacement,
          nextValue,
        });
      }
      onChange(nextValue);
      resetHover();
    },
    [
      dispatch,
      formData,
      onChange,
      pivotPlacement,
      resetHover,
      setControlValue,
      toArray,
    ],
  );

  const setLastHoverIndex = useCallback(
    (idx: number) => {
      lastHoverRef.current = {
        ...lastHoverRef.current,
        index: idx,
        listId: currentListId,
      };
    },
    [currentListId],
  );

  const setLastHoverList = useCallback((hoverListId?: string) => {
    lastHoverRef.current = {
      ...lastHoverRef.current,
      listId: hoverListId,
    };
  }, []);

  const computeInsertIndex = useCallback(
    (monitor?: DropTargetMonitor) => {
      const clientOffset = monitor?.getClientOffset();
      if (clientOffset && containerRef.current) {
        const items = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(
            '[data-option-index]',
          ),
        );
        for (let idx = 0; idx < items.length; idx += 1) {
          const rect = items[idx].getBoundingClientRect();
          if (clientOffset.y < rect.top + rect.height / 2) {
            return idx;
          }
        }
        if (items.length > 0) {
          return items.length;
        }
      }
      if (
        lastHoverRef.current.listId === currentListId &&
        lastHoverRef.current.index !== null
      ) {
        return lastHoverRef.current.index;
      }
      return optionSelector.values.length;
    },
    [currentListId, optionSelector.values.length],
  );

  const onDrop = useCallback(
    (item: unknown, monitor?: DropTargetMonitor) => {
      const column = getDroppedColumnValue(item);
      if (!column) {
        return;
      }
      const columnValue: QueryFormColumn = isColumnMetaValue(column)
        ? column.column_name
        : (column as QueryFormColumn);
      if (!optionSelector.multi && !isEmpty(optionSelector.values)) {
        optionSelector.replace(0, columnValue);
        applyChange(optionSelector.getValues());
        resetHover();
        return;
      }
      const insertAt = computeInsertIndex(monitor);
      if ((window as WindowWithPivotDebug).PIVOT_V3_DEBUG_PLACEMENT) {
        // eslint-disable-next-line no-console
        console.log('[pivot-v3] DnD drop details', {
          listId: currentListId,
          lastHover: lastHoverRef.current,
          insertAt,
          values: optionSelector.getValues(),
        });
      }
      if (!optionSelector.has(columnValue)) {
        const baseValues = toArray(optionSelector.getValues());
        const clampedIndex = Math.max(0, Math.min(insertAt, baseValues.length));
        baseValues.splice(clampedIndex, 0, columnValue);
        applyChange(baseValues);
      } else {
        applyChange(optionSelector.getValues());
      }
      resetHover();
    },
    [
      applyChange,
      computeInsertIndex,
      currentListId,
      optionSelector,
      resetHover,
      toArray,
    ],
  );

  const canDrop = useCallback(
    (item: unknown) => {
      const column = getDroppedColumnValue(item);
      if (!column) {
        return false;
      }
      if (isColumnMetaValue(column)) {
        return !optionSelector.has(column.column_name);
      }
      if (typeof column === 'string' || isAdhocColumn(column)) {
        return !optionSelector.has(column as QueryFormColumn);
      }
      return false;
    },
    [optionSelector],
  );

  const onClickClose = useCallback(
    (indexToDelete: number) => {
      optionSelector.del(indexToDelete);
      applyChange(optionSelector.getValues());
    },
    [applyChange, optionSelector],
  );

  const onShiftOptions = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      optionSelector.swap(dragIndex, hoverIndex);
      applyChange(optionSelector.getValues());
    },
    [applyChange, optionSelector],
  );

  const updateFormatting = useCallback(
    (
      dimensionKey: string,
      field: DimensionFormattingField | 'applyTo',
      value?: PivotDimensionFormattingValue | DimensionFormattingScope,
    ) => {
      if (!dimensionKey || !setControlValue) {
        return;
      }
      const baseFormatting = formattingRef.current || {};
      const nextFormatting: PivotDimensionFormattingMap = { ...baseFormatting };
      const nextEntry: PivotDimensionFormatting = {
        ...(baseFormatting[dimensionKey] || {}),
      };

      if (field === 'applyTo') {
        nextEntry.applyTo =
          (value as DimensionFormattingScope) ??
          DEFAULT_DIMENSION_FORMATTING_SCOPE;
      } else if (value) {
        nextEntry[field] = value as PivotDimensionFormattingValue;
      } else {
        delete nextEntry[field];
      }

      const hasMetricFormatting = DIMENSION_FORMAT_SELECTOR_CONFIG.some(
        selector => nextEntry[selector.field],
      );
      if (hasMetricFormatting) {
        nextEntry.applyTo =
          nextEntry.applyTo ?? DEFAULT_DIMENSION_FORMATTING_SCOPE;
        nextFormatting[dimensionKey] = nextEntry;
      } else {
        delete nextFormatting[dimensionKey];
      }

      setLocalFormatting(nextFormatting);
      formattingPendingRef.current = nextFormatting;
      formattingRef.current = nextFormatting;
      setControlValue(formattingControlName, nextFormatting);
    },
    [formattingControlName, setControlValue],
  );

  const updateSortingMetric = useCallback(
    (dimensionKey: string, metric?: QueryFormMetric) => {
      if (!dimensionKey || !setControlValue) {
        return;
      }
      const baseSorting = sortingRef.current || {};
      const nextSorting: PivotDimensionSortingMap = { ...baseSorting };
      if (!metric) {
        const existing = baseSorting[dimensionKey];
        if (existing) {
          const rest = { ...existing };
          delete rest.metric;
          if (Object.keys(rest).length === 0) {
            delete nextSorting[dimensionKey];
          } else {
            nextSorting[dimensionKey] = rest;
          }
        } else {
          delete nextSorting[dimensionKey];
        }
      } else {
        const existing = baseSorting[dimensionKey] || {};
        const nextEntry: PivotDimensionSorting = {
          ...existing,
          metric,
          order: existing.order ?? DEFAULT_DIMENSION_SORT_ORDER,
          mode: existing.mode ?? DEFAULT_DIMENSION_SORT_MODE,
        };
        nextSorting[dimensionKey] = nextEntry;
      }
      setLocalSorting(nextSorting);
      sortingPendingRef.current = nextSorting;
      sortingRef.current = nextSorting;
      setControlValue(sortingControlName, nextSorting);
    },
    [setControlValue, sortingControlName],
  );

  const updateSortingOrder = useCallback(
    (dimensionKey: string, order: PivotSortOrder) => {
      if (!dimensionKey || !setControlValue) {
        return;
      }
      const baseSorting = sortingRef.current || {};
      const existing = baseSorting[dimensionKey];
      const nextSorting: PivotDimensionSortingMap = {
        ...baseSorting,
        [dimensionKey]: {
          ...(existing || {}),
          order,
          mode: existing?.mode ?? DEFAULT_DIMENSION_SORT_MODE,
        },
      };
      setLocalSorting(nextSorting);
      sortingPendingRef.current = nextSorting;
      sortingRef.current = nextSorting;
      setControlValue(sortingControlName, nextSorting);
    },
    [setControlValue, sortingControlName],
  );

  const getDimensionKey = useCallback(
    (column: ColumnMeta | AdhocColumn | string) => {
      if (isColumnMetaValue(column)) {
        return column.column_name;
      }
      return getColumnLabel(column as QueryFormColumn);
    },
    [],
  );

  const getDimensionLabel = useCallback(
    (column: ColumnMeta | AdhocColumn | string) => {
      if (isColumnMetaValue(column)) {
        return column.verbose_name || column.column_name;
      }
      return getColumnLabel(column as QueryFormColumn);
    },
    [],
  );

  const getOptionKey = useCallback(
    (
      column: QueryFormColumn | ColumnMeta | AdhocColumn | string,
      idx: number,
    ) => {
      if (
        column === METRICS_PLACEHOLDER ||
        (isColumnMetaValue(column) &&
          column.column_name === METRICS_PLACEHOLDER)
      ) {
        return `${currentListId}-placeholder`;
      }
      if (isColumnMetaValue(column)) {
        return `${currentListId}-col-${column.column_name}`;
      }
      if (isAdhocColumn(column)) {
        return `${currentListId}-adhoc-${column.label || column.sqlExpression || idx}`;
      }
      if (typeof column === 'string') {
        return `${currentListId}-str-${column}`;
      }
      return `${currentListId}-idx-${idx}`;
    },
    [currentListId],
  );

  const valuesRenderer = useCallback(
    () =>
      optionSelector.values.map((column, idx) => {
        const isPlaceholder =
          column === METRICS_PLACEHOLDER ||
          (isColumnMetaValue(column) &&
            column.column_name === METRICS_PLACEHOLDER);
        const resolvedColumn =
          typeof column === 'string'
            ? options.find(option => option.column_name === column)
            : column;
        const datasourceWarningMessage =
          isAdhocColumn(column) && column.datasourceWarning
            ? t('This column might be incompatible with current dataset')
            : undefined;
        const hasErrorText =
          !isPlaceholder &&
          typeof column !== 'string' &&
          'error_text' in column &&
          Boolean(column.error_text);
        const withCaret =
          !isPlaceholder && (isAdhocColumn(column) || !hasErrorText);
        const dimensionKey = !isPlaceholder
          ? getDimensionKey(column)
          : undefined;
        const dimensionLabel = !isPlaceholder
          ? getDimensionLabel(column)
          : undefined;
        const optionLabel = resolvedColumn ? undefined : dimensionLabel;
        const formatting =
          dimensionKey && localFormatting[dimensionKey]
            ? localFormatting[dimensionKey]
            : undefined;
        const sorting =
          dimensionKey && localSorting[dimensionKey]
            ? localSorting[dimensionKey]
            : undefined;
        const sortingMetric = sorting?.metric;
        const sortingOrder = sorting?.order ?? DEFAULT_DIMENSION_SORT_ORDER;
        const formattingScope =
          formatting?.applyTo ?? DEFAULT_DIMENSION_FORMATTING_SCOPE;
        const hasFormatting = Boolean(
          formatting?.backgroundColor || formatting?.textColor,
        );
        const hasSorting = Boolean(sorting);
        const formattingPopoverContent =
          dimensionKey && dimensionLabel ? (
            <div data-ignore-control-popover>
              <Space direction="vertical" size={8}>
                <Typography.Text strong>
                  {t('Conditional formatting')}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {axis === 'row'
                    ? t('Row: %s', dimensionLabel)
                    : t('Column: %s', dimensionLabel)}
                </Typography.Text>
                {DIMENSION_FORMAT_SELECTOR_CONFIG.map(selector => (
                  <MetricFormatSelector
                    key={selector.field}
                    label={selector.label}
                    tooltip={selector.tooltip}
                    enableExcel
                    value={formatting?.[selector.field]}
                    metrics={availableMetrics as MetricOptionValue[]}
                    metricLabelMap={metricLabelMap}
                    onChange={metric =>
                      updateFormatting(dimensionKey, selector.field, metric)
                    }
                    columns={options}
                    savedMetrics={savedMetrics}
                    datasource={datasource}
                  />
                ))}
                <Radio.Group
                  value={formattingScope}
                  onChange={event =>
                    updateFormatting(
                      dimensionKey,
                      'applyTo',
                      event.target.value,
                    )
                  }
                >
                  <Radio value="all">
                    {axis === 'row'
                      ? t('Apply to whole row')
                      : t('Apply to whole column')}
                  </Radio>
                  <Radio value="label">{t('Apply to value')}</Radio>
                </Radio.Group>
              </Space>
            </div>
          ) : null;
        const sortingPopoverContent =
          dimensionKey && dimensionLabel ? (
            <div data-ignore-control-popover>
              <Space direction="vertical" size={8}>
                <Typography.Text strong>{t('Sorting')}</Typography.Text>
                <Typography.Text type="secondary">
                  {axis === 'row'
                    ? t('Row: %s', dimensionLabel)
                    : t('Column: %s', dimensionLabel)}
                </Typography.Text>
                <MetricFormatSelector
                  label={t('Sort by metric')}
                  tooltip={t(
                    'Metric that defines the ordering for this dimension.',
                  )}
                  value={sortingMetric}
                  metrics={availableMetrics as MetricOptionValue[]}
                  metricLabelMap={metricLabelMap}
                  onChange={metric => updateSortingMetric(dimensionKey, metric)}
                  columns={options}
                  savedMetrics={savedMetrics}
                  datasource={datasource}
                />
                <Radio.Group
                  value={sortingOrder}
                  onChange={event =>
                    updateSortingOrder(
                      dimensionKey,
                      event.target.value as PivotSortOrder,
                    )
                  }
                >
                  <Radio value="asc">{t('Ascending')}</Radio>
                  <Radio value="desc">{t('Descending')}</Radio>
                </Radio.Group>
              </Space>
            </div>
          ) : null;
        const sortingControl =
          dimensionKey && dimensionLabel ? (
            <Popover
              content={sortingPopoverContent}
              overlayStyle={{ width: 'fit-content' }}
              trigger="click"
              placement="right"
              getPopupContainer={() => document.body}
            >
              <Tooltip title={t('Add sorting')}>
                <DimensionSortingButtonWrap
                  data-ignore-control-popover
                  onClick={event => event.stopPropagation()}
                  onMouseDown={event => event.stopPropagation()}
                >
                  <DimensionSortingButton
                    aria-label={t('Add sorting for %s', dimensionLabel)}
                    data-test="pivot-dimension-sorting-button"
                    icon={
                      hasSorting ? (
                        sortingOrder === 'desc' ? (
                          <Icons.DownOutlined iconSize="s" />
                        ) : (
                          <Icons.UpOutlined iconSize="s" />
                        )
                      ) : (
                        <Icons.SortAscendingOutlined iconSize="s" />
                      )
                    }
                    size="small"
                    buttonStyle={hasSorting ? 'primary' : 'tertiary'}
                  />
                </DimensionSortingButtonWrap>
              </Tooltip>
            </Popover>
          ) : undefined;
        const formattingControl =
          dimensionKey && dimensionLabel ? (
            <Popover
              content={formattingPopoverContent}
              overlayStyle={{ width: 'fit-content' }}
              trigger="click"
              placement="right"
              getPopupContainer={() => document.body}
            >
              <Tooltip title={t('Add conditional formatting')}>
                <DimensionFormattingButtonWrap
                  data-ignore-control-popover
                  onClick={event => event.stopPropagation()}
                  onMouseDown={event => event.stopPropagation()}
                >
                  <DimensionFormattingButton
                    aria-label={t(
                      'Add conditional formatting for %s',
                      dimensionLabel,
                    )}
                    data-test="pivot-dimension-formatting-button"
                    icon={<Icons.FormatPainterOutlined iconSize="s" />}
                    size="small"
                    buttonStyle={hasFormatting ? 'primary' : 'tertiary'}
                  />
                </DimensionFormattingButtonWrap>
              </Tooltip>
            </Popover>
          ) : undefined;
        const controlButtons =
          sortingControl || formattingControl ? (
            <Space size={0}>
              {sortingControl}
              {formattingControl}
            </Space>
          ) : undefined;
        const optionNode = (
          <PivotOptionWrapper
            key={getOptionKey(column, idx)}
            index={idx}
            clickClose={
              !isPlaceholder && canDelete ? onClickClose : NOOP_CLICK_CLOSE
            }
            onShiftOptions={onShiftOptions}
            onHoverIndex={setLastHoverIndex}
            onHoverListId={setLastHoverList}
            type={dragType}
            listId={currentListId}
            canDelete={!isPlaceholder && canDelete}
            label={optionLabel}
            column={resolvedColumn}
            datasourceWarningMessage={datasourceWarningMessage}
            withCaret={withCaret}
            isPlaceholder={isPlaceholder}
            rightNode={controlButtons}
            tooltipOverlay={
              isPlaceholder
                ? t(
                    'Values placeholder for metrics placement; it cannot be removed.',
                  )
                : undefined
            }
          />
        );

        if (isPlaceholder) {
          return optionNode;
        }

        return (
          <ColumnSelectPopoverTrigger
            key={idx}
            columns={options}
            onColumnEdit={newColumn => {
              if (isColumnMeta(newColumn)) {
                optionSelector.replace(idx, newColumn.column_name);
              } else {
                optionSelector.replace(idx, newColumn as AdhocColumn);
              }
              applyChange(optionSelector.getValues());
            }}
            editedColumn={resolvedColumn}
            isTemporal={isTemporal}
            disabledTabs={disabledTabs}
          >
            {optionNode}
          </ColumnSelectPopoverTrigger>
        );
      }),
    [
      applyChange,
      availableMetrics,
      axis,
      canDelete,
      currentListId,
      datasource,
      disabledTabs,
      dragType,
      getDimensionKey,
      getDimensionLabel,
      getOptionKey,
      isTemporal,
      localFormatting,
      localSorting,
      metricLabelMap,
      onClickClose,
      onShiftOptions,
      optionSelector,
      options,
      savedMetrics,
      setLastHoverIndex,
      setLastHoverList,
      updateFormatting,
      updateSortingMetric,
      updateSortingOrder,
    ],
  );

  const addNewColumnWithPopover = useCallback(
    (newColumn: ColumnMeta | AdhocColumn) => {
      if (isColumnMeta(newColumn)) {
        optionSelector.add(newColumn.column_name);
      } else {
        optionSelector.add(newColumn as AdhocColumn);
      }
      applyChange(optionSelector.getValues());
    },
    [applyChange, optionSelector],
  );

  const togglePopover = useCallback((visible: boolean) => {
    setNewColumnPopoverVisible(visible);
  }, []);

  const closePopover = useCallback(() => {
    togglePopover(false);
  }, [togglePopover]);

  const openPopover = useCallback(() => {
    togglePopover(true);
  }, [togglePopover]);

  const labelGhostButtonText = useMemo(
    () =>
      ghostButtonText ??
      tn(
        'Drop a column here or click',
        'Drop columns here or click',
        multi ? 2 : 1,
      ),
    [ghostButtonText, multi],
  );

  return (
    <div>
      <PivotDndSelectLabel
        onDrop={onDrop}
        canDrop={canDrop}
        valuesRenderer={valuesRenderer}
        accept={[DndItemType.Column, dragType]}
        displayGhostButton={multi || optionSelector.values.length === 0}
        ghostButtonText={labelGhostButtonText}
        onClickGhostButton={openPopover}
        containerRef={containerRef}
        {...props}
      />
      <ColumnSelectPopoverTrigger
        columns={options}
        onColumnEdit={addNewColumnWithPopover}
        isControlledComponent
        togglePopover={togglePopover}
        closePopover={closePopover}
        visible={newColumnPopoverVisible}
        isTemporal={isTemporal}
        disabledTabs={disabledTabs}
      >
        <div />
      </ColumnSelectPopoverTrigger>
    </div>
  );
}

export default PivotDndColumnSelect;
