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
  ReactNode,
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isEqual } from 'lodash';
import {
  DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  QueryFormColumn,
  QueryFormMetric,
  t,
  styled,
} from '@superset-ui/core';
import {
  Button,
  Divider,
  Popover,
  Select,
  Space,
  Tooltip,
  Typography,
} from '@superset-ui/core/components';
import type { SelectProps } from '@superset-ui/core/components/Select';
import { Icons } from '@superset-ui/core/components/Icons';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import {
  DateFormatter,
  MeasureLeavesByMetricKey,
  PivotRuntimeLayout,
} from '../../types';
import {
  getMetricKey,
  getStableColumnKey,
  resolveMetricDisplayLabel,
} from '../../utils';
import { isValueLeaf } from '../measureLeaves';
import { INTERACTION_DIMENSION_DND_TYPE } from '../layout/interactionDrag';

const PanelSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeXXS}px;
  width: 100%;
`;

const MeasuresSection = styled(PanelSection)`
  padding-bottom: ${({ theme }) => theme.sizeXXS}px;
`;

const PanelStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeXXS}px;
  width: 100%;
  height: 100%;
  min-height: 0;
`;

const SectionTitle = styled(Typography.Text)`
  font-size: 12px;
  color: ${({ theme }) => theme.colorTextSecondary};
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.sizeXS}px;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.sizeXS}px;
  width: 100%;
`;

const OptionRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXS}px;
`;

const OrderedToggle = styled.button<{ $checked: boolean }>`
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 1px solid
    ${({ theme, $checked }) =>
      $checked ? theme.colorPrimary : theme.colorBorder};
  background: ${({ theme, $checked }) =>
    $checked ? theme.colorPrimaryBg : theme.colorBgContainer};
  color: ${({ theme, $checked }) =>
    $checked ? theme.colorPrimaryText : theme.colorText};
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
`;

const ToggleLabel = styled(Typography.Text)`
  font-size: 12px;
`;

const ToggleIcon = styled.svg`
  display: block;
  width: 12px;
  height: 12px;
`;

const ActionButton = styled(Button)`
  width: 100%;
`;

const DimensionsHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXS}px;
  flex: 1 1 auto;
  min-width: 0;
`;

const DimensionsHeaderControls = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXXS}px;
  flex: 0 0 auto;
`;

const DimensionsHeaderIcon = styled.span`
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colorTextSecondary};
`;

const DimensionRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.sizeXXS}px;
  padding: 2px 0;
  border-bottom: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  width: 100%;

  &:last-child {
    border-bottom: 0;
  }
`;

const DimensionControls = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXXS}px;
`;

const DimensionDragRegion = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXXS}px;
  min-width: 0;
  flex: 1 1 auto;
  cursor: grab;
`;

const DimensionLeft = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXS}px;
  min-width: 0;
  flex: 1 1 auto;
  width: 100%;
`;

const DimensionRight = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
`;

const DimensionsList = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
`;

const DimensionLabel = styled(Typography.Text)`
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MeasuresMenu = styled.div`
  max-height: 240px;
  overflow-y: auto;
  padding-right: ${({ theme }) => theme.sizeXXS}px;
`;

const MeasuresList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeXXS}px;
`;

const LeafChip = styled.button<{ $active: boolean }>`
  border: 1px solid
    ${({ theme, $active }) =>
      $active ? theme.colorPrimaryBorder : theme.colorBorderSecondary};
  background: ${({ theme, $active }) =>
    $active ? theme.colorPrimaryBg : theme.colorFillSecondary};
  color: ${({ theme, $active }) =>
    $active ? theme.colorPrimaryText : theme.colorTextSecondary};
  border-radius: 10px;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.2;
  cursor: pointer;
`;

const FilterIconButton = styled.button<{ $active: boolean }>`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme, $active }) =>
    $active ? theme.colorPrimaryBg : 'transparent'};
  color: ${({ theme, $active }) =>
    $active ? theme.colorPrimaryText : theme.colorTextSecondary};
  cursor: pointer;
`;

const FilterMenu = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeXS}px;
  min-width: 280px;
`;

const PanelFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: ${({ theme }) => theme.sizeXXS}px;
  margin-top: auto;
`;

const CompactDivider = styled(Divider)`
  margin: ${({ theme }) => theme.sizeXXS}px 0;
`;

const DimensionsSection = styled(PanelSection)`
  flex: 1 1 auto;
  min-height: 0;
`;

const ClearFiltersButton = styled(Button)`
  min-height: ${({ theme }) => theme.sizeUnit * 4}px;
  height: ${({ theme }) => theme.sizeUnit * 4}px;
  padding: 0 ${({ theme }) => theme.sizeXXS}px;
`;

type MetricOption = {
  key: string;
  label: string;
};

type LeafOption = {
  id: string;
  label: string;
};

type DimensionDragItem = {
  type: string;
  kind: 'dimension';
  label?: string;
  dimensionKey: string;
};

const EMPTY_FILTER_VALUES: DataRecordValue[] = [];
const NULL_FILTER_LABEL = '<NULL>';

const areDataRecordValueArraysEqual = (
  previous: DataRecordValue[],
  next: DataRecordValue[],
): boolean =>
  previous === next ||
  (previous.length === next.length &&
    previous.every((value, index) => value === next[index]));

type PivotInteractionPanelProps = {
  dimensions: QueryFormColumn[];
  metrics: QueryFormMetric[];
  measureLeavesByMetric?: MeasureLeavesByMetricKey;
  metricLabelMap?: Record<string, string>;
  dimensionLabelMap?: Record<string, string>;
  dateFormatters?: Record<string, DateFormatter | undefined>;
  dimensionFilterValues?: Record<string, DataRecordValue[]>;
  dimensionFilterLoading?: Record<string, boolean>;
  selectedFilters?: Record<string, DataRecordValue[]>;
  onFilterValuesOpen?: (dimension: QueryFormColumn) => void;
  onFilterChange?: (
    dimension: QueryFormColumn,
    values: DataRecordValue[],
  ) => void;
  onClearFilters?: () => void;
  onApply?: () => void;
  showApply?: boolean;
  applyDisabled?: boolean;
  runtimeLayout: PivotRuntimeLayout;
  onChange: (next: PivotRuntimeLayout) => void;
};

const buildMetricOptions = (
  metrics: PivotInteractionPanelProps['metrics'],
  metricLabelMap?: Record<string, string>,
): MetricOption[] =>
  ensureIsArray(metrics)
    .map(metric => {
      const key = getMetricKey(metric);
      if (!key) {
        return undefined;
      }
      const label = resolveMetricDisplayLabel(key, {
        metricLabelMap,
        metrics,
      });
      return { key, label };
    })
    .filter((option): option is MetricOption => Boolean(option));

const buildLeafOptions = (
  measureLeavesByMetric?: MeasureLeavesByMetricKey,
): LeafOption[] => {
  if (!measureLeavesByMetric) {
    return [];
  }
  const map = new Map<string, string>();
  Object.values(measureLeavesByMetric).forEach(leaves => {
    leaves.forEach(leaf => {
      if (!map.has(leaf.id)) {
        map.set(leaf.id, leaf.label);
      }
    });
  });
  return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
};

const hasComparisonLeaves = (
  measureLeavesByMetric?: MeasureLeavesByMetricKey,
): boolean => {
  if (!measureLeavesByMetric) {
    return false;
  }
  return Object.values(measureLeavesByMetric).some(leaves =>
    leaves.some(leaf => !isValueLeaf(leaf)),
  );
};

const normalizeLayout = (
  runtimeLayout: PivotRuntimeLayout,
  dimensionKeys: string[],
  metricKeys: string[],
): PivotRuntimeLayout => {
  const rows = runtimeLayout.rows.filter(key => dimensionKeys.includes(key));
  const cols = runtimeLayout.cols.filter(key => dimensionKeys.includes(key));
  const metrics = runtimeLayout.metrics.filter(key => metricKeys.includes(key));
  return {
    ...runtimeLayout,
    rows,
    cols,
    metrics: metrics.length > 0 ? metrics : metricKeys,
  };
};

const encodeFilterValue = (value: DataRecordValue): string => {
  if (value === null || value === undefined) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'string') {
    return `str:${value}`;
  }
  if (type === 'number') {
    return `num:${value}`;
  }
  if (type === 'boolean') {
    return `bool:${value}`;
  }
  return `other:${String(value)}`;
};

const formatFilterValue = (
  value: DataRecordValue,
  formatter?: DateFormatter,
): string => {
  if (value === null || value === undefined) {
    return NULL_FILTER_LABEL;
  }
  if (formatter) {
    const safeFormatter = formatter as (value: DataRecordValue) => string;
    return safeFormatter(value);
  }
  return String(value);
};

const openFilterCombobox = (container: HTMLElement | null): void => {
  const combobox = container?.querySelector<HTMLElement>('[role="combobox"]');
  if (!combobox || combobox.getAttribute('aria-expanded') === 'true') {
    return;
  }
  (['mousedown', 'mouseup', 'click'] as const).forEach(eventType => {
    combobox.dispatchEvent(
      new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  });
};

const dimensionDndType =
  INTERACTION_DIMENSION_DND_TYPE || 'pivot-v3-interaction-dimension';

const DimensionDragHandle = ({
  dimensionKey,
  label,
  children,
}: {
  dimensionKey: string;
  label: string;
  children: ReactNode;
}) => {
  const [{ isDragging }, drag, preview] = useDrag<
    DimensionDragItem,
    void,
    { isDragging: boolean }
  >({
    item: {
      type: dimensionDndType,
      kind: 'dimension',
      label,
      dimensionKey,
    },
    collect: monitor => ({
      isDragging: monitor.isDragging(),
    }),
  });
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);
  return (
    <DimensionDragRegion ref={drag} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {children}
    </DimensionDragRegion>
  );
};

type SelectWithOpenProps = Omit<SelectProps, 'ref'> & {
  defaultActiveFirstOption?: boolean;
};

const SelectWithOpen = Select as ComponentType<SelectWithOpenProps>;

type DimensionFilterPopoverProps = {
  dimension: QueryFormColumn;
  dimensionKey: string;
  formatter?: DateFormatter;
  isFilterOpen: boolean;
  isFilterLoading: boolean;
  availableValues: DataRecordValue[];
  pendingValues: DataRecordValue[];
  hasFilter: boolean;
  onFilterPopoverChange: (
    dimensionKey: string,
    dimension: QueryFormColumn,
    open: boolean,
  ) => void;
  onPendingFilterValuesChange: (
    dimensionKey: string,
    values: DataRecordValue[],
  ) => void;
};

const DimensionFilterPopover = memo(
  ({
    dimension,
    dimensionKey,
    formatter,
    isFilterOpen,
    isFilterLoading,
    availableValues,
    pendingValues,
    hasFilter,
    onFilterPopoverChange,
    onPendingFilterValuesChange,
  }: DimensionFilterPopoverProps) => {
    const [sessionAvailableValues, setSessionAvailableValues] =
      useState<DataRecordValue[]>(availableValues);
    const previousOpenRef = useRef(isFilterOpen);
    const filterMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const wasOpen = previousOpenRef.current;
      setSessionAvailableValues(current => {
        if (!isFilterOpen) {
          return availableValues;
        }
        if (!wasOpen) {
          return availableValues;
        }
        if (current.length === 0 && availableValues.length > 0) {
          return availableValues;
        }
        return current;
      });
      let frameId: number | undefined;
      if (isFilterOpen && !wasOpen) {
        frameId = window.requestAnimationFrame(() => {
          openFilterCombobox(filterMenuRef.current);
        });
      }
      previousOpenRef.current = isFilterOpen;
      return () => {
        if (frameId !== undefined) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }, [availableValues, isFilterOpen]);

    const { options, valueMap } = useMemo(() => {
      const nextValueMap = new Map<string, DataRecordValue>();
      const nextOptions = sessionAvailableValues.map(value => {
        const encodedValue = encodeFilterValue(value);
        nextValueMap.set(encodedValue, value);
        return {
          value: encodedValue,
          label: formatFilterValue(value, formatter),
        };
      });
      return {
        options: nextOptions,
        valueMap: nextValueMap,
      };
    }, [formatter, sessionAvailableValues]);
    const selectedValueKeys = useMemo(
      () => pendingValues.map(value => encodeFilterValue(value)),
      [pendingValues],
    );
    const handleOpenChange = useCallback(
      (open: boolean) => {
        onFilterPopoverChange(dimensionKey, dimension, open);
      },
      [dimension, dimensionKey, onFilterPopoverChange],
    );
    const handleChange = useCallback(
      (values: unknown) => {
        const nextValues = (values as string[])
          .map(value => valueMap.get(value))
          .filter((value): value is DataRecordValue => value !== undefined);
        onPendingFilterValuesChange(dimensionKey, nextValues);
      },
      [dimensionKey, onPendingFilterValuesChange, valueMap],
    );
    return (
      <Popover
        trigger="click"
        overlayStyle={{ minWidth: 280 }}
        open={isFilterOpen}
        onOpenChange={handleOpenChange}
        destroyOnHidden
        content={
          <FilterMenu ref={filterMenuRef}>
            <SelectWithOpen
              mode="multiple"
              allowClear
              allowSelectAll
              defaultActiveFirstOption={false}
              loading={isFilterLoading}
              ariaLabel={t('Filter values')}
              placeholder={t('Filter values')}
              options={options}
              value={selectedValueKeys}
              onChange={handleChange}
              showSearch
              optionFilterProps={['label']}
              css={{ width: '100%' }}
              maxTagCount="responsive"
              notFoundContent={t('No values')}
              getPopupContainer={triggerNode =>
                (triggerNode?.parentNode as HTMLElement) ?? document.body
              }
            />
          </FilterMenu>
        }
      >
        <FilterIconButton
          type="button"
          $active={hasFilter}
          aria-label={t('Filter values')}
        >
          <Icons.FilterOutlined iconSize="s" iconColor="currentColor" />
        </FilterIconButton>
      </Popover>
    );
  },
  (previous, next) =>
    previous.dimension === next.dimension &&
    previous.dimensionKey === next.dimensionKey &&
    previous.formatter === next.formatter &&
    previous.isFilterOpen === next.isFilterOpen &&
    previous.isFilterLoading === next.isFilterLoading &&
    previous.hasFilter === next.hasFilter &&
    previous.onFilterPopoverChange === next.onFilterPopoverChange &&
    previous.onPendingFilterValuesChange === next.onPendingFilterValuesChange &&
    areDataRecordValueArraysEqual(
      previous.availableValues,
      next.availableValues,
    ) &&
    areDataRecordValueArraysEqual(previous.pendingValues, next.pendingValues),
);

const RowLinesIcon = () => (
  <ToggleIcon viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" />
    <line x1="1" y1="4.5" x2="11" y2="4.5" stroke="currentColor" />
    <line x1="1" y1="7" x2="11" y2="7" stroke="currentColor" />
    <line x1="1" y1="9.5" x2="11" y2="9.5" stroke="currentColor" />
  </ToggleIcon>
);

const ColLinesIcon = () => (
  <ToggleIcon viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <line x1="2" y1="1" x2="2" y2="11" stroke="currentColor" />
    <line x1="4.5" y1="1" x2="4.5" y2="11" stroke="currentColor" />
    <line x1="7" y1="1" x2="7" y2="11" stroke="currentColor" />
    <line x1="9.5" y1="1" x2="9.5" y2="11" stroke="currentColor" />
  </ToggleIcon>
);

export const PivotInteractionPanel = ({
  dimensions,
  metrics,
  measureLeavesByMetric,
  metricLabelMap,
  dimensionLabelMap,
  dateFormatters,
  dimensionFilterValues,
  dimensionFilterLoading,
  selectedFilters,
  onFilterValuesOpen,
  onFilterChange,
  onClearFilters,
  onApply,
  showApply = false,
  applyDisabled = false,
  runtimeLayout,
  onChange,
}: PivotInteractionPanelProps) => {
  const dimensionList = ensureIsArray(dimensions);
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);
  const [pendingFilterValues, setPendingFilterValues] = useState<
    Record<string, DataRecordValue[]>
  >({});
  const pendingFilterValuesRef = useRef(pendingFilterValues);
  const selectedFiltersRef = useRef(selectedFilters);
  const previousOpenFilterKeyRef = useRef<string | null>(openFilterKey);
  useEffect(() => {
    pendingFilterValuesRef.current = pendingFilterValues;
  }, [pendingFilterValues]);
  useEffect(() => {
    selectedFiltersRef.current = selectedFilters;
  }, [selectedFilters]);
  const dimensionKeys = useMemo(
    () => dimensionList.map(dim => getStableColumnKey(dim)),
    [dimensionList],
  );
  const dimensionByKey = useMemo(() => {
    const entries = dimensionList.map(dimension => [
      getStableColumnKey(dimension),
      dimension,
    ]);
    return new Map<string, QueryFormColumn>(entries);
  }, [dimensionList]);
  const metricOptions = useMemo(
    () => buildMetricOptions(metrics, metricLabelMap),
    [metrics, metricLabelMap],
  );
  const metricKeys = useMemo(
    () => metricOptions.map(option => option.key),
    [metricOptions],
  );
  const leafOptions = useMemo(
    () => buildLeafOptions(measureLeavesByMetric),
    [measureLeavesByMetric],
  );
  const showLeafChips = useMemo(
    () => hasComparisonLeaves(measureLeavesByMetric),
    [measureLeavesByMetric],
  );
  const resolveDimensionLabel = useCallback(
    (dimension: QueryFormColumn) => {
      const key = getStableColumnKey(dimension);
      const mapped =
        dimensionLabelMap?.[key] ||
        (typeof dimension === 'string' ? dimensionLabelMap?.[dimension] : null);
      return mapped || getColumnLabel(dimension);
    },
    [dimensionLabelMap],
  );
  const resolveFilterFormatter = useCallback(
    (dimension: QueryFormColumn) => {
      const label = getColumnLabel(dimension);
      const key = getStableColumnKey(dimension);
      return dateFormatters?.[label] || dateFormatters?.[key];
    },
    [dateFormatters],
  );
  const hasAnyFilters = useMemo(
    () => Object.keys(selectedFilters ?? {}).length > 0,
    [selectedFilters],
  );
  const handleClearAllFilters = useCallback(() => {
    if (!onClearFilters) {
      return;
    }
    pendingFilterValuesRef.current = {};
    setPendingFilterValues({});
    previousOpenFilterKeyRef.current = null;
    setOpenFilterKey(null);
    onClearFilters();
  }, [onClearFilters]);
  const commitPendingFilterValues = useCallback(
    (dimensionKey: string) => {
      const pending = pendingFilterValuesRef.current[dimensionKey];
      const selected = selectedFiltersRef.current?.[dimensionKey] ?? [];
      const dimension = dimensionByKey.get(dimensionKey);

      if (
        pending &&
        dimension &&
        onFilterChange &&
        !isEqual(pending, selected)
      ) {
        onFilterChange(dimension, pending);
      }

      setPendingFilterValues(current => {
        if (!current[dimensionKey]) {
          return current;
        }
        const next = { ...current };
        delete next[dimensionKey];
        return next;
      });
    },
    [dimensionByKey, onFilterChange],
  );
  useEffect(() => {
    const previousOpenFilterKey = previousOpenFilterKeyRef.current;
    if (!previousOpenFilterKey || previousOpenFilterKey === openFilterKey) {
      previousOpenFilterKeyRef.current = openFilterKey;
      return;
    }
    commitPendingFilterValues(previousOpenFilterKey);
    previousOpenFilterKeyRef.current = openFilterKey;
  }, [commitPendingFilterValues, openFilterKey]);
  const handleFilterPopoverChange = useCallback(
    (dimensionKey: string, dimension: QueryFormColumn, open: boolean) => {
      setOpenFilterKey(open ? dimensionKey : null);
      if (open) {
        onFilterValuesOpen?.(dimension);
        setPendingFilterValues(current => {
          if (current[dimensionKey]) {
            return current;
          }
          const selected = selectedFiltersRef.current?.[dimensionKey] ?? [];
          return { ...current, [dimensionKey]: selected };
        });
      }
    },
    [onFilterValuesOpen],
  );
  const handlePendingFilterValuesChange = useCallback(
    (dimensionKey: string, values: DataRecordValue[]) => {
      setPendingFilterValues(current => {
        if (isEqual(current[dimensionKey], values)) {
          return current;
        }
        return {
          ...current,
          [dimensionKey]: values,
        };
      });
    },
    [],
  );

  const resolvedLayout = useMemo(
    () => normalizeLayout(runtimeLayout, dimensionKeys, metricKeys),
    [dimensionKeys, metricKeys, runtimeLayout],
  );
  const baseLeafOrder = useMemo(
    () => leafOptions.map(option => option.id),
    [leafOptions],
  );

  const [measuresOpen, setMeasuresOpen] = useState(false);
  const [pendingMetrics, setPendingMetrics] = useState<string[]>(
    resolvedLayout.metrics,
  );

  useEffect(() => {
    if (!measuresOpen) {
      setPendingMetrics(resolvedLayout.metrics);
    }
  }, [measuresOpen, resolvedLayout.metrics]);

  const commitMetrics = useCallback(() => {
    const nextMetrics = pendingMetrics.length > 0 ? pendingMetrics : metricKeys;
    onChange({ ...resolvedLayout, metrics: nextMetrics });
  }, [metricKeys, onChange, pendingMetrics, resolvedLayout]);

  const handleMeasuresOpenChange = useCallback(
    (open: boolean) => {
      setMeasuresOpen(open);
      if (!open) {
        commitMetrics();
      }
    },
    [commitMetrics],
  );

  const toggleMetric = useCallback((metricKey: string) => {
    setPendingMetrics(current => {
      const index = current.indexOf(metricKey);
      if (index >= 0) {
        return current.filter(key => key !== metricKey);
      }
      return [...current, metricKey];
    });
  }, []);

  const hasExplicitLeafSelection =
    Object.keys(resolvedLayout.leafSelection).length > 0;

  const toggleLeaf = useCallback(
    (leafId: string) => {
      const nextSelection = hasExplicitLeafSelection
        ? { ...resolvedLayout.leafSelection }
        : Object.fromEntries(baseLeafOrder.map(id => [id, true] as const));
      const selectedLeafIds = baseLeafOrder.filter(
        id => nextSelection[id] === true,
      );
      const providedOrder = resolvedLayout.leafOrder ?? [];
      const nextOrder = [
        ...providedOrder.filter(id => selectedLeafIds.includes(id)),
        ...selectedLeafIds.filter(id => !providedOrder.includes(id)),
      ];
      const current = nextSelection[leafId] === true;
      nextSelection[leafId] = !current;
      if (current) {
        const index = nextOrder.indexOf(leafId);
        if (index >= 0) {
          nextOrder.splice(index, 1);
        }
      } else {
        const index = nextOrder.indexOf(leafId);
        if (index >= 0) {
          nextOrder.splice(index, 1);
        }
        nextOrder.push(leafId);
      }
      onChange({
        ...resolvedLayout,
        leafSelection: nextSelection,
        leafOrder: nextOrder,
      });
    },
    [baseLeafOrder, hasExplicitLeafSelection, onChange, resolvedLayout],
  );

  const moveDimension = useCallback(
    (dimensionKey: string, targetAxis?: 'row' | 'col') => {
      const rowIndex = resolvedLayout.rows.indexOf(dimensionKey);
      const colIndex = resolvedLayout.cols.indexOf(dimensionKey);
      const nextRows = resolvedLayout.rows.filter(key => key !== dimensionKey);
      const nextCols = resolvedLayout.cols.filter(key => key !== dimensionKey);
      const nextValuePlacement = { ...resolvedLayout.valuePlacement };
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
      if (targetAxis === 'row') {
        const rowLength = nextRows.length;
        const valueOnRows = nextValuePlacement.axis === 'row';
        const valueAtEnd = nextValuePlacement.index === rowLength;
        if (valueOnRows && valueAtEnd) {
          nextRows.splice(nextValuePlacement.index, 0, dimensionKey);
          nextValuePlacement.index += 1;
        } else {
          nextRows.push(dimensionKey);
        }
      } else if (targetAxis === 'col') {
        const colLength = nextCols.length;
        const valueOnCols = nextValuePlacement.axis === 'col';
        const valueAtEnd = nextValuePlacement.index === colLength;
        if (valueOnCols && valueAtEnd) {
          nextCols.splice(nextValuePlacement.index, 0, dimensionKey);
          nextValuePlacement.index += 1;
        } else {
          nextCols.push(dimensionKey);
        }
      }
      onChange({
        ...resolvedLayout,
        rows: nextRows,
        cols: nextCols,
        valuePlacement: nextValuePlacement,
      });
    },
    [onChange, resolvedLayout],
  );

  const measuresContent = (
    <MeasuresMenu>
      <MeasuresList>
        {metricOptions.map(option => {
          const orderIndex = pendingMetrics.indexOf(option.key);
          const selected = orderIndex >= 0;
          return (
            <Row key={option.key}>
              <OptionRow>
                <OrderedToggle
                  type="button"
                  $checked={selected}
                  onClick={() => toggleMetric(option.key)}
                  aria-pressed={selected}
                  aria-label={`Toggle measure ${option.label}`}
                >
                  {selected ? orderIndex + 1 : ''}
                </OrderedToggle>
                <ToggleLabel>{option.label}</ToggleLabel>
              </OptionRow>
            </Row>
          );
        })}
      </MeasuresList>
    </MeasuresMenu>
  );

  return (
    <PanelStack>
      <MeasuresSection>
        <Popover
          content={measuresContent}
          trigger="click"
          open={measuresOpen}
          onOpenChange={handleMeasuresOpenChange}
        >
          <ActionButton size="small" type="primary" ghost>
            {t('Select measures')}
          </ActionButton>
        </Popover>
      </MeasuresSection>

      {showLeafChips ? (
        <PanelSection>
          <Space wrap size={[4, 4]}>
            {leafOptions.map(leaf => {
              const enabled = hasExplicitLeafSelection
                ? resolvedLayout.leafSelection[leaf.id] === true
                : true;
              return (
                <LeafChip
                  key={leaf.id}
                  $active={enabled}
                  onClick={() => toggleLeaf(leaf.id)}
                  aria-label={`Toggle leaf ${leaf.label}`}
                  aria-pressed={enabled}
                >
                  {leaf.label}
                </LeafChip>
              );
            })}
          </Space>
        </PanelSection>
      ) : null}

      <CompactDivider />

      <DimensionsSection>
        <SectionHeader>
          <DimensionsHeaderLeft>
            <DimensionsHeaderControls>
              <Tooltip title={t('Select row placement')}>
                <DimensionsHeaderIcon>
                  <RowLinesIcon />
                </DimensionsHeaderIcon>
              </Tooltip>
              <Tooltip title={t('Select column placement')}>
                <DimensionsHeaderIcon>
                  <ColLinesIcon />
                </DimensionsHeaderIcon>
              </Tooltip>
            </DimensionsHeaderControls>
            <SectionTitle>{t('Dimensions')}</SectionTitle>
          </DimensionsHeaderLeft>
          {onClearFilters ? (
            <Tooltip title={t('Clear filters')}>
              <ClearFiltersButton
                type="text"
                size="small"
                icon={<Icons.ClearOutlined iconSize="s" />}
                disabled={!hasAnyFilters}
                onClick={handleClearAllFilters}
                aria-label={t('Clear filters')}
              />
            </Tooltip>
          ) : null}
        </SectionHeader>
        <DimensionsList>
          {dimensionList.map(dimension => {
            const dimensionKey = getStableColumnKey(dimension);
            const rowIndex = resolvedLayout.rows.indexOf(dimensionKey);
            const colIndex = resolvedLayout.cols.indexOf(dimensionKey);
            const label = resolveDimensionLabel(dimension);
            const formatter = resolveFilterFormatter(dimension);
            const isFilterOpen = openFilterKey === dimensionKey;
            const isFilterLoading =
              dimensionFilterLoading?.[dimensionKey] === true;
            const availableValues =
              dimensionFilterValues?.[dimensionKey] ?? EMPTY_FILTER_VALUES;
            const pendingValues =
              pendingFilterValues[dimensionKey] ??
              selectedFilters?.[dimensionKey] ??
              EMPTY_FILTER_VALUES;
            const hasFilter =
              (selectedFilters?.[dimensionKey] ?? EMPTY_FILTER_VALUES).length >
              0;
            return (
              <DimensionRow key={dimensionKey}>
                <DimensionLeft>
                  <DimensionControls>
                    <OrderedToggle
                      type="button"
                      $checked={rowIndex >= 0}
                      onClick={() =>
                        rowIndex >= 0
                          ? moveDimension(dimensionKey)
                          : moveDimension(dimensionKey, 'row')
                      }
                      aria-pressed={rowIndex >= 0}
                      aria-label={t('Toggle row dimension')}
                    >
                      {rowIndex >= 0 ? rowIndex + 1 : ''}
                    </OrderedToggle>
                    <OrderedToggle
                      type="button"
                      $checked={colIndex >= 0}
                      onClick={() =>
                        colIndex >= 0
                          ? moveDimension(dimensionKey)
                          : moveDimension(dimensionKey, 'col')
                      }
                      aria-pressed={colIndex >= 0}
                      aria-label={t('Toggle column dimension')}
                    >
                      {colIndex >= 0 ? colIndex + 1 : ''}
                    </OrderedToggle>
                  </DimensionControls>
                  <DimensionDragHandle
                    dimensionKey={dimensionKey}
                    label={label}
                  >
                    <DimensionLabel ellipsis={{ tooltip: label }}>
                      {label}
                    </DimensionLabel>
                  </DimensionDragHandle>
                </DimensionLeft>
                {onFilterChange ? (
                  <DimensionRight>
                    <DimensionFilterPopover
                      dimension={dimension}
                      dimensionKey={dimensionKey}
                      formatter={formatter}
                      isFilterOpen={isFilterOpen}
                      isFilterLoading={isFilterLoading}
                      availableValues={availableValues}
                      pendingValues={pendingValues}
                      hasFilter={hasFilter}
                      onFilterPopoverChange={handleFilterPopoverChange}
                      onPendingFilterValuesChange={
                        handlePendingFilterValuesChange
                      }
                    />
                  </DimensionRight>
                ) : null}
              </DimensionRow>
            );
          })}
        </DimensionsList>
      </DimensionsSection>
      {showApply ? (
        <PanelFooter>
          <ActionButton
            type="primary"
            size="small"
            onClick={onApply}
            disabled={applyDisabled}
          >
            {t('Update chart')}
          </ActionButton>
        </PanelFooter>
      ) : null}
    </PanelStack>
  );
};
