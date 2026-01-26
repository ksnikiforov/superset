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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  supersetTheme,
  type JsonObject,
  styled,
  t,
} from '@superset-ui/core';
import { Icons } from '@superset-ui/core/components/Icons';
import {
  type PivotTableProps,
  MetricsLayoutEnum,
  PivotRuntimeLayout,
} from './types';
import { PivotTableView } from './pivot/render/PivotTableView';
import { useExpansionEngine } from './pivot/engine/useExpansionEngine';
import { usePivotLayout } from './pivot/chart/usePivotLayout';
import { usePivotRenderModel } from './pivot/chart/usePivotRenderModel';
import { useStickyHeaders } from './pivot/chart/useStickyHeaders';
import { usePivotFormatting } from './pivot/chart/usePivotFormatting';
import { usePivotInteractions } from './pivot/chart/usePivotInteractions';
import { PivotInteractionPanel } from './pivot/chart/PivotInteractionPanel';
import { stableStringify } from './pivot/shared/stableStringify';
import { resolveInteractionFormData } from './pivot/layout/resolveInteractionLayout';
import {
  getMetricKeys,
  getStableColumnKey,
  isSubtotalToken,
  METRICS_PLACEHOLDER,
} from './utils';

const PANEL_WIDTH = 280;
const TOP_CHIPS_HEIGHT = 36;
const SIDE_CHIPS_WIDTH = 24;

const InteractionLayout = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
`;

const InteractionPanelWrap = styled.div`
  width: ${PANEL_WIDTH}px;
  flex: 0 0 ${PANEL_WIDTH}px;
  padding: ${({ theme }) =>
    `${theme.sizeMD}px 0 ${theme.sizeMD}px ${theme.sizeMD}px`};
  border-right: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  height: 100%;
  overflow: auto;
`;

const InteractionTableWrap = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
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

const Chip = styled.div`
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colorFillSecondary};
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXXS}px;
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

const TableRow = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
`;

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
  } = props;

  const { interactionMode } = formData;
  const isUserControlled = interactionMode === 'user_controlled';
  const isDashboardView = !setControlValue;

  const fetchFormData = queryFormData || formData;
  const appliedFormData = fetchFormData;
  const persistExpansionState = persistExpansionStateProp ?? true;
  const resolvedStickyHeaders = formData.stickyHeaders ?? stickyHeaders;

  const treeRef = useRef<PivotTableProps['data']>(data);
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
  const metricsForUi = useMemo(
    () => formData.metricsBase ?? formData.metrics ?? metrics,
    [formData.metrics, formData.metricsBase, metrics],
  );
  const metricKeys = useMemo(() => getMetricKeys(metricsForUi), [metricsForUi]);
  const appliedMetrics = useMemo(
    () => appliedFormData.metricsBase ?? appliedFormData.metrics ?? metrics,
    [appliedFormData.metrics, appliedFormData.metricsBase, metrics],
  );
  const appliedMetricKeys = useMemo(
    () => getMetricKeys(ensureIsArray(appliedMetrics)),
    [appliedMetrics],
  );
  const runtimeLayout = useMemo(() => {
    const persisted =
      formData.pivotRuntimeLayout ??
      (ownState?.pivotRuntimeLayout as PivotRuntimeLayout | undefined);
    return normalizeRuntimeLayout(persisted, dimensionKeys, metricKeys);
  }, [dimensionKeys, formData.pivotRuntimeLayout, metricKeys, ownState]);
  const [uiRuntimeLayout, setUiRuntimeLayout] =
    useState<PivotRuntimeLayout>(runtimeLayout);
  const [uiSelectedFilters, setUiSelectedFilters] = useState<
    Record<string, DataRecordValue[]>
  >(selectedFilters ?? {});
  const appliedRuntimeLayout = useMemo(() => {
    if (!isUserControlled) {
      return runtimeLayout;
    }
    const persisted =
      queryFormData?.pivotRuntimeLayout ??
      (!queryFormData
        ? (formData.pivotRuntimeLayout ??
          (ownState?.pivotRuntimeLayout as PivotRuntimeLayout | undefined))
        : undefined);
    return normalizeRuntimeLayout(
      persisted,
      appliedDimensionKeys,
      appliedMetricKeys,
    );
  }, [
    appliedDimensionKeys,
    appliedMetricKeys,
    formData.pivotRuntimeLayout,
    isUserControlled,
    ownState?.pivotRuntimeLayout,
    queryFormData,
    runtimeLayout,
  ]);
  const appliedLayoutFormData = useMemo(() => {
    if (!isUserControlled) {
      return appliedFormData;
    }
    return resolveInteractionFormData({
      formData: appliedFormData,
      runtimeLayout: appliedRuntimeLayout,
    });
  }, [appliedFormData, appliedRuntimeLayout, isUserControlled]);
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

  useEffect(() => {
    setUiRuntimeLayout(runtimeLayout);
  }, [runtimeLayout]);

  useEffect(() => {
    setUiSelectedFilters(normalizeSelectedFilters(selectedFilters));
  }, [normalizeSelectedFilters, selectedFilters]);

  const handleRuntimeLayoutChange = useCallback(
    (nextLayout: PivotRuntimeLayout) => {
      const normalized = normalizeRuntimeLayout(
        nextLayout,
        dimensionKeys,
        metricKeys,
      );
      setUiRuntimeLayout(normalized);
      if (!isDashboardView && setControlValue) {
        setControlValue('pivotRuntimeLayout', normalized);
        return;
      }
      if (!isDashboardView) {
        const nextOwnState = mergeOwnState({ pivotRuntimeLayout: normalized });
        setDataMask({ ownState: { ...nextOwnState } });
      }
    },
    [
      dimensionKeys,
      isDashboardView,
      mergeOwnState,
      metricKeys,
      setControlValue,
      setDataMask,
    ],
  );

  const appliedLayoutSignature = useMemo(
    () => stableStringify(runtimeLayout),
    [runtimeLayout],
  );
  const uiLayoutSignature = useMemo(
    () => stableStringify(uiRuntimeLayout),
    [uiRuntimeLayout],
  );
  const hasPendingLayoutChanges = uiLayoutSignature !== appliedLayoutSignature;

  const handleApplyRuntimeLayout = useCallback(() => {
    if (!isDashboardView) {
      return;
    }
    const normalized = normalizeRuntimeLayout(
      uiRuntimeLayout,
      dimensionKeys,
      metricKeys,
    );
    const nextOwnState = mergeOwnState({ pivotRuntimeLayout: normalized });
    setDataMask({ ownState: { ...nextOwnState } });
  }, [
    dimensionKeys,
    isDashboardView,
    mergeOwnState,
    metricKeys,
    setDataMask,
    uiRuntimeLayout,
  ]);

  const dimensionLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    dimensionList.forEach(dimension => {
      map.set(getStableColumnKey(dimension), getColumnLabel(dimension));
    });
    return map;
  }, [dimensionList]);

  const chipItems = useCallback(
    (axis: 'row' | 'col') => {
      const keys = axis === 'row' ? uiRuntimeLayout.rows : uiRuntimeLayout.cols;
      const labels = keys.map(key => ({
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
    data,
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
    errorMessage,
    warnings,
    isHydrating,
    handleToggle,
    handleRetry,
  } = useExpansionEngine({
    data,
    expandedStateSignature: layoutResult.expandedStateSignature,
    fetchFormData,
    groupbyRowKeys: layoutResult.groupbyRowKeys,
    groupbyColumnKeys: layoutResult.groupbyColumnKeys,
    groupbyRowsLength: layoutGroupbyRows.length,
    groupbyColumnsLength: layoutGroupbyColumns.length,
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
    setControlValue,
    setDataMask,
    mergeOwnState,
    persistedExpansionState:
      appliedLayoutFormData.pivotExpansionState ??
      ownState?.pivotExpansionState,
    shouldPersistExpansionState: persistExpansionState,
    getFetchPath: layoutResult.getFetchPath,
    pruneMergedTree: layoutResult.pruneMergedTree,
  });

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const renderModelResult = usePivotRenderModel({
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    isHydrating,
    formData: appliedLayoutFormData,
    rowOrder,
    colOrder,
    groupbyRows: layoutGroupbyRows,
    groupbyColumns: layoutGroupbyColumns,
    colTypeMap,
    rowTotals,
    colTotals,
    rowSubTotals,
    layout: layoutResult,
  });

  const dimensionFilterValues = useMemo(() => {
    const valuesMap = new Map<string, Set<DataRecordValue>>();
    const rowKeys = layoutGroupbyRows
      .filter(column => getStableColumnKey(column) !== METRICS_PLACEHOLDER)
      .map(column => getStableColumnKey(column));
    const colKeys = layoutGroupbyColumns
      .filter(column => getStableColumnKey(column) !== METRICS_PLACEHOLDER)
      .map(column => getStableColumnKey(column));
    const collectValues = (
      nodes: Record<
        string,
        { path: (DataRecordValue | undefined)[]; isSubtotal?: boolean }
      >,
      keys: string[],
    ) => {
      Object.values(nodes).forEach(node => {
        if (node.isSubtotal) {
          return;
        }
        const parts = layoutResult
          .getNonMetricPathParts(node.path)
          .filter(part => !isSubtotalToken(part));
        parts.forEach((value, index) => {
          const key = keys[index];
          if (!key) {
            return;
          }
          const normalized = value ?? null;
          const set = valuesMap.get(key) ?? new Set<DataRecordValue>();
          set.add(normalized);
          valuesMap.set(key, set);
        });
      });
    };
    collectValues(tree.rows, rowKeys);
    collectValues(tree.cols, colKeys);
    return Object.fromEntries(
      Array.from(valuesMap.entries()).map(([key, set]) => [
        key,
        Array.from(set.values()),
      ]),
    );
  }, [
    layoutGroupbyColumns,
    layoutGroupbyRows,
    layoutResult,
    tree.cols,
    tree.rows,
  ]);

  const handleDimensionFilterChange = useCallback(
    (
      dimension: PivotTableProps['groupbyRows'][number],
      values: DataRecordValue[],
    ) => {
      const dimensionKey = getStableColumnKey(dimension);
      const nextSelected = { ...uiSelectedFilters };
      if (values.length > 0) {
        nextSelected[dimensionKey] = values;
      } else {
        delete nextSelected[dimensionKey];
      }
      setUiSelectedFilters(nextSelected);
      const filterKeys = Object.keys(nextSelected);
      const filters =
        filterKeys.length === 0
          ? undefined
          : filterKeys.map(key => {
              const col = dimensionMap.get(key) ?? key;
              const vals = nextSelected[key] ?? [];
              if (
                vals.length === 1 &&
                (vals[0] === null || vals[0] === undefined)
              ) {
                return { col, op: 'IS NULL' as const };
              }
              return {
                col,
                op: 'IN' as const,
                val: vals as (string | number | boolean)[],
              };
            });
      const filterStateSelected = Object.entries(nextSelected).reduce<
        Record<string, DataRecordValue[]>
      >((acc, [key, vals]) => {
        const col = dimensionMap.get(key);
        const label = col ? getColumnLabel(col) : key;
        acc[label] = vals;
        return acc;
      }, {});
      setDataMask({
        extraFormData: {
          filters,
        },
        filterState: {
          value:
            filterKeys.length > 0 ? Object.values(filterStateSelected) : null,
          selectedFilters: filterKeys.length > 0 ? filterStateSelected : null,
        },
      });
    },
    [dimensionMap, setDataMask, uiSelectedFilters],
  );

  const handleClearAllFilters = useCallback(() => {
    if (Object.keys(uiSelectedFilters).length === 0) {
      return;
    }
    setUiSelectedFilters({});
    setDataMask({
      extraFormData: {
        filters: undefined,
      },
      filterState: {
        value: null,
        selectedFilters: null,
      },
    });
  }, [setDataMask, uiSelectedFilters]);

  const { headerOffset, headerRowOffsets, headerRef } = useStickyHeaders({
    enabled: resolvedStickyHeaders,
    columnHeaderRows: renderModelResult.renderModel.columnHeaderRows,
    width: isUserControlled
      ? Math.max(0, width - PANEL_WIDTH - SIDE_CHIPS_WIDTH)
      : width,
  });

  const formatting = usePivotFormatting({
    tree,
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
    dateFormatters,
    timeGrainSqla,
  });

  const tableWidth = isUserControlled
    ? Math.max(0, width - PANEL_WIDTH - SIDE_CHIPS_WIDTH)
    : width;
  const tableHeight = isUserControlled
    ? Math.max(0, height - TOP_CHIPS_HEIGHT)
    : height;
  const rowChips = chipItems('row');
  const colChips = chipItems('col');

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

  return isUserControlled ? (
    <InteractionLayout>
      <InteractionPanelWrap>
        <PivotInteractionPanel
          dimensions={dimensionList}
          metrics={metricsForUi}
          measureLeavesByMetric={
            formData.measureLeavesByMetricBase ?? formData.measureLeavesByMetric
          }
          metricLabelMap={formData.metricLabelMap}
          dimensionFilterValues={dimensionFilterValues}
          selectedFilters={uiSelectedFilters}
          onFilterChange={handleDimensionFilterChange}
          onClearFilters={handleClearAllFilters}
          onApply={handleApplyRuntimeLayout}
          showApply={isDashboardView}
          applyDisabled={!hasPendingLayoutChanges}
          runtimeLayout={uiRuntimeLayout}
          onChange={handleRuntimeLayoutChange}
        />
      </InteractionPanelWrap>
      <InteractionTableWrap>
        <ChipRow>
          {colChips.map(chip =>
            chip.kind === 'value' ? (
              <ValueChip key={`col-${chip.id}`} title={chip.label}>
                <ChipLabel>{chip.label}</ChipLabel>
              </ValueChip>
            ) : (
              <Chip key={`col-${chip.id}`} title={chip.label}>
                <ChipLabel>{chip.label}</ChipLabel>
                <ChipCloseButton
                  type="button"
                  onClick={() => handleChipRemove(chip.id)}
                  aria-label={t('Remove dimension')}
                >
                  <Icons.CloseOutlined iconSize="xs" iconColor="currentColor" />
                </ChipCloseButton>
              </Chip>
            ),
          )}
        </ChipRow>
        <TableRow>
          <ChipColumn>
            {rowChips.map(chip =>
              chip.kind === 'value' ? (
                <VerticalValueChip key={`row-${chip.id}`} title={chip.label}>
                  <VerticalChipLabel>{chip.label}</VerticalChipLabel>
                </VerticalValueChip>
              ) : (
                <VerticalChip key={`row-${chip.id}`} title={chip.label}>
                  <VerticalChipLabel>{chip.label}</VerticalChipLabel>
                  <VerticalChipCloseButton
                    type="button"
                    onClick={() => handleChipRemove(chip.id)}
                    aria-label={t('Remove dimension')}
                  >
                    <Icons.CloseOutlined
                      iconSize="xs"
                      iconColor="currentColor"
                    />
                  </VerticalChipCloseButton>
                </VerticalChip>
              ),
            )}
          </ChipColumn>
          <PivotTableView
            height={tableHeight}
            width={tableWidth}
            renderModel={renderModelResult.renderModel}
            tree={tree}
            expandedRows={renderModelResult.expandedRowsForRender}
            expandedCols={renderModelResult.expandedColsForRender}
            errorMessage={errorMessage}
            onRetry={handleRetry}
            warnings={warnings}
            showGlobalLoader={renderModelResult.showGlobalLoader}
            stickyHeaders={resolvedStickyHeaders}
            headerOffset={headerOffset}
            headerRowOffsets={headerRowOffsets}
            headerRef={headerRef}
            themeColor={formatting.themeColor}
            colTotalPosition={layoutResult.resolvedColTotalPosition}
            metricFormattingScope={formatting.metricFormattingScope}
            metricDatabars={formatting.metricDatabars}
            formattingKeyMap={formatting.formattingKeyMap}
            evaluateExcelMetricFormatting={
              formatting.evaluateExcelMetricFormatting
            }
            databarColumnMinWidths={formatting.databarColumnMinWidths}
            onToggleNode={handleToggle}
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
          />
        </TableRow>
      </InteractionTableWrap>
    </InteractionLayout>
  ) : (
    <PivotTableView
      height={height}
      width={width}
      renderModel={renderModelResult.renderModel}
      tree={tree}
      expandedRows={renderModelResult.expandedRowsForRender}
      expandedCols={renderModelResult.expandedColsForRender}
      errorMessage={errorMessage}
      onRetry={handleRetry}
      warnings={warnings}
      showGlobalLoader={renderModelResult.showGlobalLoader}
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
    />
  );
}

export default PivotTableChart;
