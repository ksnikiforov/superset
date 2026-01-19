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
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BinaryQueryObjectFilterClause,
  DataRecordValue,
  GenericDataType,
  type JsonObject,
  addAlpha,
  getColumnLabel,
  getNumberFormatter,
  safeHtmlSpan,
  supersetTheme,
  styled,
  t,
} from '@superset-ui/core';
import {
  MetricFormattingScope,
  METRIC_FORMATTING_FIELDS,
  MetricFormattingField,
  DIMENSION_FORMATTING_FIELDS,
  DimensionFormattingField,
  DimensionFormattingScope,
  MetricsLayoutEnum,
  PivotTableProps,
  PivotTreeData,
  PivotTreeNode,
  PivotDimensionFormattingMap,
  PivotDimensionSortingMap,
  PivotResultCell,
  PivotMetricDatabarMap,
  PivotSortOrder,
  PivotSortMode,
} from './types';
import {
  isMetricsPlaceholder,
  isSubtotalToken,
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  collectMetricDatabarMetricsForQuery,
  collectMetricFormattingMetricsForQuery,
  DEFAULT_DATABAR_NEGATIVE_COLOR,
  DEFAULT_DATABAR_POSITIVE_COLOR,
  decodeMetricKey,
  encodeMetricKey,
  getFormattingMetricKey,
  getMetricKey,
  getMetricKeys,
  getStableColumnKey,
  mergeMetrics,
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  normalizeMetricDatabarMapWithKeys,
  normalizeSubtotalLevels,
  parseThemeColors,
  PIVOT_THEME_PRESETS,
  resolveMetricPlacement,
  resolveExpandLevel,
  serializeCellKey,
  serializePath,
  SUBTOTAL_LABEL,
} from './utils';
import {
  buildColumnHeaderRows,
  compareValues,
  findChildren,
  formatMetricValue,
  rootKey,
  sortByOrder,
} from './pivot/viewModel';
import { PivotTableView } from './pivot/render/PivotTableView';
import {
  buildRenderModel,
  type RenderModelConfig,
} from './pivot/render/renderModel';
import { type FormattingKeys } from './pivot/shared/types';
import { getVisibleExpansionKeys as getVisibleExpansionKeysBase } from './pivot/engine/expansionStateModel';
import { useExpansionEngine } from './pivot/engine/useExpansionEngine';
import { buildColumnDisplayPath } from './pivot/columnDisplay';
import {
  countDimDepth as countDimDepthBase,
  getMetricDepthForParent as getMetricDepthForParentBase,
  getMetricLabelFromPath as getMetricLabelFromPathBase,
  getMetricTierNodes as getMetricTierNodesBase,
  getNonMetricPathParts as getNonMetricPathPartsBase,
  getNodeDimDepth as getNodeDimDepthBase,
  isExplicitSubtotalNode as isExplicitSubtotalNodeBase,
  isExplicitTotalNode as isExplicitTotalNodeBase,
  isMetricGrandTotalNode as isMetricGrandTotalNodeBase,
  isMetricSubtotalNode as isMetricSubtotalNodeBase,
} from './pivot/metricsTotals';
import { getExpandedDepths } from './pivot/visibility';
import { buildCellFilters, buildContextMenuFilters } from './pivot/filters';
import {
  buildFormattingValueMaps,
  deriveMetricKey as deriveMetricKeyBase,
  formatNodeLabel as formatNodeLabelBase,
  shouldHideRowValues as shouldHideRowValuesBase,
} from './pivot/cellUtils';

const DatabarContent = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  overflow: hidden;
  box-sizing: border-box;
  flex: 1;
`;

const DatabarSpacer = styled.div`
  height: ${({ theme }) => theme.sizeUnit * 4}px;
  visibility: hidden;
  pointer-events: none;
`;

const DatabarScale = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
`;

const DatabarLabel = styled.div`
  position: absolute;
  white-space: nowrap;
  background-color: ${({ theme }) => addAlpha(theme.colorBgContainer, 0.6)};
  padding: 0 ${({ theme }) => theme.sizeUnit * 0.5}px;
  z-index: 2;
  pointer-events: none;
`;

const DatabarBaseline = styled.div<{ $color: string }>`
  position: absolute;
  top: 0;
  bottom: 0;
  width: ${({ theme }) => Math.max(2, theme.sizeUnit * 0.5)}px;
  background-color: ${({ $color }) => $color};
  transform: translateX(-50%);
  z-index: 1;
`;

const DatabarConnector = styled.div<{ $color: string; $width: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  width: ${({ $width }) => $width}px;
  background-color: ${({ $color }) => $color};
  transform: translateX(-50%);
  z-index: 1;
`;

const DatabarDottedConnector = styled.div<{ $color: string; $width: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  width: ${({ $width }) => $width}px;
  background-image: ${({ $color }) =>
    `repeating-linear-gradient(
      to bottom,
      ${$color},
      ${$color} 2px,
      transparent 2px,
      transparent 4px
    )`};
  background-repeat: repeat;
  background-size: 100% 4px;
  transform: translateX(-50%);
  z-index: 1;
`;

const DatabarRect = styled.div<{
  $color: string;
  $height: number | string;
}>`
  position: absolute;
  height: ${({ $height }) =>
    typeof $height === 'number' ? `${$height}px` : $height};
  background-color: ${({ $color }) => $color};
  z-index: 1;
`;

const DatabarLine = styled.div<{ $color: string }>`
  position: absolute;
  height: 2px;
  background-color: ${({ $color }) => $color};
  z-index: 1;
`;

const DatabarDot = styled.div<{ $color: string }>`
  width: ${({ theme }) => theme.sizeUnit * 1.8}px;
  height: ${({ theme }) => theme.sizeUnit * 1.8}px;
  border-radius: 50%;
  background-color: ${({ $color }) => $color};
  flex-shrink: 0;
  z-index: 1;
`;

type DimensionFormattingKeys = {
  [key in DimensionFormattingField]?: string;
} & { applyTo: DimensionFormattingScope };

type DimensionSortingKeys = {
  metricKey?: string;
  order: PivotSortOrder;
  mode: PivotSortMode;
};

const DEFAULT_DIMENSION_SORT_ORDER: PivotSortOrder = 'asc';

const HEX_COLOR_PATTERN =
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const normalizeHexColor = (value: string) => {
  if (!HEX_COLOR_PATTERN.test(value)) {
    return undefined;
  }
  const hex = value.toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (hex.length === 5) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${hex[4]}${hex[4]}`;
  }
  return hex;
};

const parseRgbChannel = (value: string) => {
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 255) {
    return null;
  }
  return numeric;
};

const parseAlphaChannel = (value: string) => {
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return null;
  }
  return numeric;
};

const normalizeCssColor = (rawValue: DataRecordValue) => {
  if (typeof rawValue !== 'string') {
    return undefined;
  }
  const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
  if (!value) {
    return undefined;
  }
  const hex = normalizeHexColor(value);
  if (hex) {
    return hex;
  }
  const rgbMatch = value.match(/^rgba?\((.*)\)$/i);
  if (!rgbMatch) {
    const hslMatch = value.match(/^hsla?\((.*)\)$/i);
    if (hslMatch) {
      const parts = hslMatch[1]
        .split(',')
        .map(part => part.trim())
        .filter(part => part.length > 0);
      const isHsla = value.toLowerCase().startsWith('hsla');
      if ((isHsla && parts.length !== 4) || (!isHsla && parts.length !== 3)) {
        return undefined;
      }
      return value;
    }
    if (/^[a-zA-Z]+$/.test(value)) {
      return value;
    }
    return undefined;
  }
  const parts = rgbMatch[1]
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  const isRgba = value.toLowerCase().startsWith('rgba');
  if ((isRgba && parts.length !== 4) || (!isRgba && parts.length !== 3)) {
    return undefined;
  }
  const [r, g, b] = parts.slice(0, 3).map(parseRgbChannel);
  if (r === null || g === null || b === null) {
    return undefined;
  }
  if (isRgba) {
    const alpha = parseAlphaChannel(parts[3]);
    if (alpha === null) {
      return undefined;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
};

const CONNECTOR_ALPHA_LEVELS = [0.75, 0.6, 0.45, 0.3];

const resolveConnectorAlpha = (depth: number) => {
  const boundedDepth = Math.max(0, depth);
  const idx = Math.min(boundedDepth, CONNECTOR_ALPHA_LEVELS.length - 1);
  return CONNECTOR_ALPHA_LEVELS[idx];
};

const applyAlphaToColor = (rawColor: string, alpha: number) => {
  const normalized = normalizeCssColor(rawColor) ?? rawColor.trim();
  const hex = normalizeHexColor(normalized);
  if (hex) {
    const base = hex.length === 9 ? hex.slice(0, 7) : hex;
    const baseAlpha =
      hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : undefined;
    const resolvedAlpha = baseAlpha === undefined ? alpha : baseAlpha * alpha;
    return addAlpha(base, resolvedAlpha);
  }
  const rgbMatch = normalized.match(/^rgba?\((.*)\)$/i);
  if (!rgbMatch) {
    return normalized;
  }
  const parts = rgbMatch[1]
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  const [r, g, b] = parts.slice(0, 3).map(parseRgbChannel);
  if (r === null || g === null || b === null) {
    return normalized;
  }
  const parsedAlpha = parts.length === 4 ? parseAlphaChannel(parts[3]) : null;
  const resolvedAlpha = parsedAlpha === null ? alpha : parsedAlpha * alpha;
  return `rgba(${r}, ${g}, ${b}, ${resolvedAlpha})`;
};

const normalizeD3Format = (rawValue: DataRecordValue) => {
  if (typeof rawValue !== 'string') {
    return undefined;
  }
  const value = rawValue.trim();
  return value.length > 0 ? value : undefined;
};

type DatabarScale = {
  min: number;
  max: number;
};

type WaterfallOffset = {
  start: number;
  end: number;
  scaleKey: string;
  connectAbove: boolean;
  connectBelow: boolean;
  connectAboveValue?: number;
  connectBelowValue?: number;
};

const getStablePrefixLength = (prev: string[], next: string[]) => {
  const limit = Math.min(prev.length, next.length);
  let idx = 0;
  while (idx < limit && prev[idx] === next[idx]) {
    idx += 1;
  }
  return idx;
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const resolveScaleBounds = (scale: DatabarScale) => {
  const min = Number.isFinite(scale.min) ? scale.min : 0;
  const max = Number.isFinite(scale.max) ? scale.max : 0;
  const boundedMin = Math.min(min, 0);
  const boundedMax = Math.max(max, 0);
  const span = boundedMax - boundedMin || 1;
  const zeroPct = (0 - boundedMin) / span;
  return {
    boundedMin,
    boundedMax,
    span,
    zeroPct,
  };
};

const toPercent = (value: number, scale: DatabarScale) => {
  const { boundedMin, boundedMax, span } = resolveScaleBounds(scale);
  const clamped = clampValue(value, boundedMin, boundedMax);
  return (clamped - boundedMin) / span;
};

const STALE_PIVOT_REQUEST = Symbol('pivot-table-stale-request');

const resolveScaleGroupKey = (
  metricKey: string,
  databarMap: PivotMetricDatabarMap,
) => {
  let current = metricKey;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const config = databarMap[current];
    if (!config?.scaleLike) {
      break;
    }
    const next = getFormattingMetricKey(config.scaleLike);
    if (!next || next === current) {
      break;
    }
    current = next;
  }
  return current;
};

const getNumericValue = (value: DataRecordValue | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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
    expandRowsLevel: expandRowsLevelProp,
    expandColumnsLevel: expandColumnsLevelProp,
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
  const fetchFormData = queryFormData || formData;
  const resolvedStartCollapsed =
    startCollapsed ?? formData.startCollapsed ?? true;
  const resolvedInitialDepth = initialDepth ?? formData.initialDepth ?? 1;
  const expandRowsLevelRaw =
    expandRowsLevelProp ?? formData.expandRowsLevel ?? undefined;
  const expandColumnsLevelRaw =
    expandColumnsLevelProp ?? formData.expandColumnsLevel ?? undefined;
  const resolvedExpandRowsLevel = useMemo(
    () =>
      resolveExpandLevel(
        expandRowsLevelRaw,
        groupbyRows.length,
        resolvedStartCollapsed,
        resolvedInitialDepth,
      ),
    [
      expandRowsLevelRaw,
      groupbyRows.length,
      resolvedInitialDepth,
      resolvedStartCollapsed,
    ],
  );
  const resolvedExpandColumnsLevel = useMemo(
    () =>
      resolveExpandLevel(
        expandColumnsLevelRaw,
        groupbyColumns.length,
        resolvedStartCollapsed,
        resolvedInitialDepth,
      ),
    [
      expandColumnsLevelRaw,
      groupbyColumns.length,
      resolvedInitialDepth,
      resolvedStartCollapsed,
    ],
  );
  const resolvedMetricsLayout =
    (formData.metricsLayout as MetricsLayoutEnum) || metricsLayout;
  const persistExpansionState = persistExpansionStateProp ?? true;
  const metricFormattingScope =
    (formData.metricFormattingScope as MetricFormattingScope) ||
    'values_totals';
  const resolvedStickyHeaders = formData.stickyHeaders ?? stickyHeaders;
  const metricFormatting = normalizeMetricFormattingMapWithKeys(
    formData.metricFormatting,
    metrics,
  );
  const metricDatabars = useMemo(
    () => normalizeMetricDatabarMapWithKeys(formData.metricDatabars, metrics),
    [formData.metricDatabars, metrics],
  );
  const rowFormatting = useMemo(
    () =>
      normalizeDimensionFormattingMapWithKeys(
        formData.rowFormatting,
        groupbyRows,
      ),
    [formData.rowFormatting, groupbyRows],
  );
  const colFormatting = useMemo(
    () =>
      normalizeDimensionFormattingMapWithKeys(
        formData.colFormatting,
        groupbyColumns,
      ),
    [formData.colFormatting, groupbyColumns],
  );
  const rowSorting = useMemo(
    () =>
      normalizeDimensionSortingMapWithKeys(formData.rowSorting, groupbyRows),
    [formData.rowSorting, groupbyRows],
  );
  const colSorting = useMemo(
    () =>
      normalizeDimensionSortingMapWithKeys(formData.colSorting, groupbyColumns),
    [formData.colSorting, groupbyColumns],
  );
  const formattingKeyMap = useMemo(() => {
    const next: Record<string, FormattingKeys> = {};
    Object.entries(metricFormatting).forEach(([metricKey, formatting]) => {
      if (!metricKey) {
        return;
      }
      const formattingKeys = METRIC_FORMATTING_FIELDS.reduce((acc, field) => {
        const formattingMetric = formatting?.[field];
        const key = formattingMetric
          ? getFormattingMetricKey(formattingMetric)
          : '';
        if (key) {
          acc[field] = key;
        }
        return acc;
      }, {} as FormattingKeys);
      if (Object.keys(formattingKeys).length > 0) {
        next[metricKey] = formattingKeys;
      }
    });
    return next;
  }, [metricFormatting]);
  const buildDimensionFormattingKeyMap = useCallback(
    (formatting: PivotDimensionFormattingMap) => {
      const next: Record<string, DimensionFormattingKeys> = {};
      Object.entries(formatting).forEach(
        ([dimensionKey, dimensionFormatting]) => {
          if (!dimensionKey) {
            return;
          }
          const formattingKeys = DIMENSION_FORMATTING_FIELDS.reduce(
            (acc, field) => {
              const formattingMetric = dimensionFormatting?.[field];
              const key = formattingMetric
                ? getFormattingMetricKey(formattingMetric)
                : '';
              if (key) {
                acc[field] = key;
              }
              return acc;
            },
            {} as Omit<DimensionFormattingKeys, 'applyTo'>,
          );
          if (Object.keys(formattingKeys).length > 0) {
            next[dimensionKey] = {
              ...formattingKeys,
              applyTo: dimensionFormatting.applyTo ?? 'all',
            };
          }
        },
      );
      return next;
    },
    [],
  );
  const buildDimensionSortingKeyMap = useCallback(
    (sorting: PivotDimensionSortingMap) => {
      const next: Record<string, DimensionSortingKeys> = {};
      Object.entries(sorting).forEach(([dimensionKey, dimensionSorting]) => {
        if (!dimensionKey) {
          return;
        }
        const metricKey = dimensionSorting.metric
          ? getFormattingMetricKey(dimensionSorting.metric)
          : '';
        next[dimensionKey] = {
          metricKey: metricKey || undefined,
          order: dimensionSorting.order ?? DEFAULT_DIMENSION_SORT_ORDER,
          mode: dimensionSorting.mode ?? 'total',
        };
      });
      return next;
    },
    [],
  );
  const rowFormattingKeyMap = useMemo(
    () => buildDimensionFormattingKeyMap(rowFormatting),
    [buildDimensionFormattingKeyMap, rowFormatting],
  );
  const colFormattingKeyMap = useMemo(
    () => buildDimensionFormattingKeyMap(colFormatting),
    [buildDimensionFormattingKeyMap, colFormatting],
  );
  const rowSortingKeyMap = useMemo(
    () => buildDimensionSortingKeyMap(rowSorting),
    [buildDimensionSortingKeyMap, rowSorting],
  );
  const colSortingKeyMap = useMemo(
    () => buildDimensionSortingKeyMap(colSorting),
    [buildDimensionSortingKeyMap, colSorting],
  );
  const hasRowSorting = useMemo(
    () => Object.keys(rowSortingKeyMap).length > 0,
    [rowSortingKeyMap],
  );
  const resolvedRowTotalPosition =
    formData.rowTotalPosition || rowTotalPosition;
  const resolvedRowSubtotalPosition =
    formData.rowSubtotalPosition || rowSubtotalPosition;
  const resolvedColTotalPosition =
    formData.colTotalPosition || colTotalPosition;
  const resolvedColSubtotalPosition =
    formData.colSubtotalPosition || colSubtotalPosition;

  const normalizedRowSubtotalLevels = useMemo(
    () =>
      normalizeSubtotalLevels(
        rowSubtotalLevels,
        Math.max(groupbyRows.length - 1, 0),
        colTotals,
        rowSubTotals ?? true,
      ),
    [colTotals, groupbyRows.length, rowSubTotals, rowSubtotalLevels],
  );
  const rowSubtotalDepths = useMemo(
    () => normalizedRowSubtotalLevels.filter(level => level > 0),
    [normalizedRowSubtotalLevels],
  );
  const normalizedColSubtotalLevels = useMemo(
    () =>
      normalizeSubtotalLevels(
        colSubtotalLevels,
        Math.max(groupbyColumns.length - 1, 0),
        rowTotals,
        false,
      ),
    [colSubtotalLevels, groupbyColumns.length, rowTotals],
  );
  const metricPlacement = useMemo(
    () =>
      resolveMetricPlacement(formData.groupbyRows, formData.groupbyColumns, {
        hasMetrics: metrics.length > 0,
        preferredAxis: resolvedMetricsLayout,
      }),
    [
      formData.groupbyColumns,
      formData.groupbyRows,
      metrics.length,
      resolvedMetricsLayout,
    ],
  );
  const metricInsertIndexOnRows = useMemo(() => {
    if (
      resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
      metricPlacement.metricPosition < 0
    ) {
      return undefined;
    }
    return Math.min(metricPlacement.metricPosition, groupbyRows.length);
  }, [
    groupbyRows.length,
    metricPlacement.metricPosition,
    resolvedMetricsLayout,
  ]);
  const metricInsertIndexOnCols = useMemo(() => {
    if (
      resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS ||
      metricPlacement.metricPosition < 0
    ) {
      return undefined;
    }
    return Math.min(metricPlacement.metricPosition, groupbyColumns.length);
  }, [
    groupbyColumns.length,
    metricPlacement.metricPosition,
    resolvedMetricsLayout,
  ]);
  const shouldExpandMetricRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricPlacement.metricPosition === 0 &&
    resolvedExpandRowsLevel > 0;
  const shouldExpandMetricCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricPlacement.metricPosition === 0 &&
    resolvedExpandColumnsLevel > 0;
  const metricsForQueryWithFormatting = useMemo(() => {
    const formattingMetrics = collectMetricFormattingMetricsForQuery(
      metricFormatting,
      metrics,
    );
    const databarMetrics = collectMetricDatabarMetricsForQuery(
      metricDatabars,
      metrics,
    );
    const rowFormattingMetrics = collectDimensionFormattingMetricsForQuery(
      rowFormatting,
      groupbyRows,
      metrics,
    );
    const colFormattingMetrics = collectDimensionFormattingMetricsForQuery(
      colFormatting,
      groupbyColumns,
      metrics,
    );
    const rowSortingMetrics = collectDimensionSortingMetricsForQuery(
      rowSorting,
      groupbyRows,
      metrics,
    );
    const colSortingMetrics = collectDimensionSortingMetricsForQuery(
      colSorting,
      groupbyColumns,
      metrics,
    );
    const metricsForQuery = mergeMetrics(metrics, formattingMetrics);
    return mergeMetrics(metricsForQuery, [
      ...databarMetrics,
      ...rowFormattingMetrics,
      ...colFormattingMetrics,
      ...rowSortingMetrics,
      ...colSortingMetrics,
    ]);
  }, [
    colFormatting,
    colSorting,
    groupbyColumns,
    groupbyRows,
    metricDatabars,
    metricFormatting,
    metrics,
    rowFormatting,
    rowSorting,
  ]);
  const metricInsertIndex = useMemo(() => {
    if (resolvedMetricsLayout === MetricsLayoutEnum.ROWS) {
      return metricPlacement.metricPosition >= 0
        ? Math.min(metricPlacement.metricPosition, groupbyRows.length)
        : groupbyRows.length;
    }
    return metricPlacement.metricPosition >= 0
      ? Math.min(metricPlacement.metricPosition, groupbyColumns.length)
      : groupbyColumns.length;
  }, [
    groupbyColumns.length,
    groupbyRows.length,
    metricPlacement.metricPosition,
    resolvedMetricsLayout,
  ]);
  const groupbyRowKeys = useMemo(
    () => groupbyRows.map(getStableColumnKey),
    [groupbyRows],
  );
  const groupbyColumnKeys = useMemo(
    () => groupbyColumns.map(getStableColumnKey),
    [groupbyColumns],
  );
  const treeDataSignature = useMemo(() => {
    if (formData.treeDataSignature) {
      return formData.treeDataSignature;
    }
    return JSON.stringify({
      rows: groupbyRowKeys,
      cols: groupbyColumnKeys,
      metrics: getMetricKeys(metricsForQueryWithFormatting),
      metricsLayout: resolvedMetricsLayout,
      metricInsertIndex,
      rowSubtotalLevels: normalizedRowSubtotalLevels,
      colSubtotalLevels: normalizedColSubtotalLevels.filter(level => level > 0),
    });
  }, [
    formData.treeDataSignature,
    metricInsertIndex,
    metricsForQueryWithFormatting,
    groupbyColumnKeys,
    groupbyRowKeys,
    normalizedColSubtotalLevels,
    normalizedRowSubtotalLevels,
    resolvedMetricsLayout,
  ]);
  const expandedStateSignature = useMemo(
    () =>
      JSON.stringify({
        rows: groupbyRowKeys,
        cols: groupbyColumnKeys,
        metrics: metrics.map(getMetricKey),
        metricsLayout: resolvedMetricsLayout,
        metricPosition: metricPlacement.metricPosition,
        rowSubtotalLevels: normalizedRowSubtotalLevels,
        colSubtotalLevels: normalizedColSubtotalLevels,
        rowTotals,
        colTotals,
        rowSubTotals,
        expandRowsLevel: resolvedExpandRowsLevel,
        expandColumnsLevel: resolvedExpandColumnsLevel,
      }),
    [
      colTotals,
      groupbyColumnKeys,
      groupbyRowKeys,
      metricPlacement.metricPosition,
      metrics,
      normalizedColSubtotalLevels,
      normalizedRowSubtotalLevels,
      resolvedMetricsLayout,
      rowSubTotals,
      rowTotals,
      resolvedExpandColumnsLevel,
      resolvedExpandRowsLevel,
    ],
  );

  const treeRef = useRef<PivotTreeData>(data);
  const [headerOffset, setHeaderOffset] = useState(0);
  const [headerRowOffsets, setHeaderRowOffsets] = useState<number[]>([]);
  const headerRef = useRef<HTMLTableSectionElement | null>(null);
  const ownStateRef = useRef<JsonObject>(ownState ?? {});

  useEffect(() => {
    ownStateRef.current = ownState ?? {};
  }, [ownState]);

  const mergeOwnState = useCallback((partial: JsonObject) => {
    const next = { ...ownStateRef.current, ...partial };
    ownStateRef.current = next;
    return next;
  }, []);
  const numberFormatter = useMemo(
    () => getNumberFormatter(valueFormat),
    [valueFormat],
  );

  const metricLabels = useMemo(
    () => metrics.map(getMetricKey).filter(label => label.length > 0),
    [metrics],
  );
  const metricLabelSet = useMemo(() => new Set(metricLabels), [metricLabels]);
  const metricOrderMap = useMemo(
    () => new Map(metricLabels.map((label, idx) => [label, idx])),
    [metricLabels],
  );
  const isMetricTokenValue = useCallback(
    (val: unknown) => {
      const decoded = decodeMetricKey(val);
      return !!decoded && metricLabelSet.has(decoded);
    },
    [metricLabelSet],
  );
  const isMultiMetric = metricLabels.length > 1;
  const maxColDimDepth = useMemo(
    () =>
      Object.values(data.cols).reduce(
        (max, node) =>
          Math.max(
            max,
            getNonMetricPathPartsBase(node.path, metricLabelSet).length,
          ),
        0,
      ),
    [data.cols, metricLabelSet],
  );

  const findMetricIndex = useCallback(
    (nodes: Record<string, PivotTreeNode>) => {
      let found: number | undefined;
      let foundFromSubtotal: number | undefined;
      Object.values(nodes).forEach(node => {
        const idx = node.path.findIndex(val => isMetricTokenValue(val));
        if (idx < 0) {
          return;
        }
        if (node.path.some(val => isSubtotalToken(val))) {
          foundFromSubtotal =
            foundFromSubtotal === undefined
              ? idx
              : Math.max(foundFromSubtotal, idx);
          return;
        }
        found = found === undefined ? idx : Math.max(found, idx);
      });
      return found ?? foundFromSubtotal;
    },
    [isMetricTokenValue],
  );

  const metricIndexOnRows = useMemo(() => {
    const treeIndex = findMetricIndex(data.rows);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnRows;
  }, [data.rows, findMetricIndex, metricInsertIndexOnRows]);
  const metricIndexOnCols = useMemo(() => {
    const treeIndex = findMetricIndex(data.cols);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnCols;
  }, [data.cols, findMetricIndex, metricInsertIndexOnCols]);
  const metricIntentIndexOnRows =
    metricInsertIndexOnRows ?? metricIndexOnRows;
  const metricIntentIndexOnCols =
    metricInsertIndexOnCols ?? metricIndexOnCols;
  const metricDimIndexOnRows = useMemo(() => {
    if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
      return undefined;
    }
    const maxDimDepth = Object.values(data.rows).reduce((max, node) => {
      if (node.path.some(val => isSubtotalToken(val))) {
        return max;
      }
      return Math.max(max, countDimDepthBase(node.path, metricLabelSet));
    }, 0);
    let found: number | undefined;
    Object.values(data.rows).forEach(node => {
      if (node.path.some(val => isSubtotalToken(val))) {
        return;
      }
      if (countDimDepthBase(node.path, metricLabelSet) !== maxDimDepth) {
        return;
      }
      const idx = node.path.findIndex(val => isMetricTokenValue(val));
      if (idx < 0) {
        return;
      }
      let dimIndex = 0;
      for (let i = 0; i < idx; i += 1) {
        const val = node.path[i];
        if (isMetricTokenValue(val)) {
          continue;
        }
        if (isSubtotalToken(val)) {
          continue;
        }
        dimIndex += 1;
      }
      found = found === undefined ? dimIndex : Math.min(found, dimIndex);
    });
    return found;
  }, [data.rows, isMetricTokenValue, metricLabelSet, resolvedMetricsLayout]);
  const formRowsHasPlaceholder = useMemo(
    () =>
      Array.isArray(formData.groupbyRows) &&
      formData.groupbyRows.some(isMetricsPlaceholder),
    [formData.groupbyRows],
  );
  const formColsHasPlaceholder = useMemo(
    () =>
      Array.isArray(formData.groupbyColumns) &&
      formData.groupbyColumns.some(isMetricsPlaceholder),
    [formData.groupbyColumns],
  );
  const metricLayoutIndexOnRows = formRowsHasPlaceholder
    ? (metricInsertIndexOnRows ?? metricIndexOnRows)
    : metricIndexOnRows;
  const metricLayoutIndexOnCols = useMemo(() => {
    if (formColsHasPlaceholder) {
      return metricInsertIndexOnCols ?? metricIndexOnCols;
    }
    if (metricIndexOnCols === undefined) {
      return metricIndexOnCols;
    }
    if (maxColDimDepth < groupbyColumns.length) {
      return groupbyColumns.length;
    }
    return metricIndexOnCols;
  }, [
    formColsHasPlaceholder,
    groupbyColumns.length,
    maxColDimDepth,
    metricIndexOnCols,
    metricInsertIndexOnCols,
  ]);
  const metricsAtRowEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    metricInsertIndexOnRows !== undefined &&
    metricInsertIndexOnRows >= groupbyRows.length;
  const metricsAtColEnd =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricInsertIndexOnCols !== undefined &&
    metricInsertIndexOnCols >= groupbyColumns.length;
  const metricsFirstOnRows =
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS && metricIndexOnRows === 0;
  const metricsFirstOnCols =
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
    metricIndexOnCols === 0;
  const forceRowSubtotalEnd =
    rowSubTotals &&
    isMultiMetric &&
    resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
    !metricsFirstOnRows;
  const effectiveRowSubtotalPosition = forceRowSubtotalEnd
    ? 'end'
    : resolvedRowSubtotalPosition;
  const forceColSubtotalEnd =
    isMultiMetric && resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS;
  const effectiveColSubtotalPosition = forceColSubtotalEnd
    ? 'end'
    : resolvedColSubtotalPosition;

  const hideMetricHeaderOnRows = useMemo(
    () =>
      resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
      metricLabels.length === 1 &&
      metricIndexOnRows !== undefined &&
      metricIndexOnRows === groupbyRows.length,
    [
      groupbyRows.length,
      metricIndexOnRows,
      metricLabels.length,
      resolvedMetricsLayout,
    ],
  );
  const hideMetricHeaderOnCols = useMemo(
    () =>
      resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
      metricLabels.length === 1 &&
      metricIndexOnCols !== undefined &&
      metricIndexOnCols === groupbyColumns.length,
    [
      groupbyColumns.length,
      metricIndexOnCols,
      metricLabels.length,
      resolvedMetricsLayout,
    ],
  );

  const getMetricLabelFromPath = useCallback(
    (path: PivotTreeNode['path']) =>
      getMetricLabelFromPathBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const getFetchPath = useCallback(
    (path: PivotTreeNode['path']) =>
      path.map(val => {
        const decoded = decodeMetricKey(val);
        if (decoded && metricLabelSet.has(decoded)) {
          return decoded;
        }
        return val;
      }),
    [metricLabelSet],
  );

  const compareMetricOrder = useCallback(
    (a: PivotTreeNode, b: PivotTreeNode) => {
      const aMetric = getMetricLabelFromPath(a.path);
      const bMetric = getMetricLabelFromPath(b.path);
      if (!aMetric || !bMetric || aMetric === bMetric) {
        return 0;
      }
      const aIndex = metricOrderMap.get(aMetric);
      const bIndex = metricOrderMap.get(bMetric);
      if (aIndex === undefined || bIndex === undefined) {
        return 0;
      }
      return aIndex - bIndex;
    },
    [getMetricLabelFromPath, metricOrderMap],
  );

  const getNonMetricPathParts = useCallback(
    (path: PivotTreeNode['path']) =>
      getNonMetricPathPartsBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const getDimensionKeyForNode = useCallback(
    (node: PivotTreeNode, axis: 'row' | 'col') => {
      const nonMetricParts = getNonMetricPathParts(node.path);
      const nonSubtotalParts = nonMetricParts.filter(
        part => !isSubtotalToken(part),
      );
      if (nonSubtotalParts.length === 0) {
        return undefined;
      }
      const dimensionIndex = nonSubtotalParts.length - 1;
      const dimension =
        axis === 'row'
          ? groupbyRows[dimensionIndex]
          : groupbyColumns[dimensionIndex];
      if (!dimension) {
        return undefined;
      }
      return getColumnLabel(dimension);
    },
    [getNonMetricPathParts, groupbyColumns, groupbyRows],
  );

  const isMetricGrandTotalNode = useCallback(
    (node?: PivotTreeNode) =>
      isMetricGrandTotalNodeBase(node, {
        metricLabelSet,
        metricsFirstOnRows,
        metricsFirstOnCols,
      }),
    [metricLabelSet, metricsFirstOnCols, metricsFirstOnRows],
  );

  const isMetricSubtotalNode = useCallback(
    (node?: PivotTreeNode) => isMetricSubtotalNodeBase(node, metricLabelSet),
    [metricLabelSet],
  );

  const isExplicitSubtotalNode = useCallback(
    (node?: PivotTreeNode) => isExplicitSubtotalNodeBase(node),
    [],
  );

  const metricIndexForRows = metricLayoutIndexOnRows ?? metricIndexOnRows;
  const metricIndexForCols = metricLayoutIndexOnCols ?? metricIndexOnCols;

  const getMetricDepthForParent = useCallback(
    (nodes: Record<string, PivotTreeNode>, parent: PivotTreeNode) =>
      getMetricDepthForParentBase(nodes, parent, metricLabelSet),
    [metricLabelSet],
  );

  const getMetricTierNodes = useCallback(
    (
      nodes: Record<string, PivotTreeNode>,
      parent: PivotTreeNode,
      metricDepth: number,
    ) => getMetricTierNodesBase(nodes, parent, metricDepth, metricLabelSet),
    [metricLabelSet],
  );

  const countDimDepth = useCallback(
    (path: PivotTreeNode['path']) => countDimDepthBase(path, metricLabelSet),
    [metricLabelSet],
  );
  const countEngineDimDepth = useCallback(
    (path: PivotTreeNode['path']) =>
      countDimDepthBase(
        path.filter(val => !isSubtotalToken(val)),
        metricLabelSet,
      ),
    [metricLabelSet],
  );

  const getRowSubtotalPosition = useCallback(
    (node: PivotTreeNode) => {
      if (!forceRowSubtotalEnd) {
        return resolvedRowSubtotalPosition;
      }
      const metricIndex = node.path.findIndex(val => isMetricTokenValue(val));
      if (metricIndex < 0) {
        return 'end';
      }
      return node.path.length > metricIndex + 1
        ? resolvedRowSubtotalPosition
        : 'end';
    },
    [forceRowSubtotalEnd, isMetricTokenValue, resolvedRowSubtotalPosition],
  );

  const getCollapsedRowChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      if (
        !isMultiMetric ||
        resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
        expandedSet.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent)) {
        return [] as PivotTreeNode[];
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(nodes, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(nodes, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyRows.length;
      const metricLabels = Array.from(
        new Set(
          metricNodes
            .map(node => decodeMetricKey(node.path[metricDepth]))
            .filter((label): label is string => !!label),
        ),
      );
      return metricLabels.map(metricLabel => {
        const metricToken = encodeMetricKey(metricLabel);
        const collapsedPath = [...parent.path, metricToken];
        const collapsedKey = serializePath(collapsedPath);
        const existing = nodes[collapsedKey];
        if (existing) {
          const hasChildren = metricsAtRowEnd
            ? false
            : findChildren(nodes, existing).length > 0 || hasMetricChildren;
          return { ...existing, hasChildren };
        }
        const sourceNode = metricNodes.find(node => {
          const decoded = decodeMetricKey(node.path[metricDepth]);
          return decoded === metricLabel;
        });
        const hasChildren = metricsAtRowEnd
          ? false
          : Object.values(nodes).some(
              node =>
                node.path.length === collapsedPath.length + 1 &&
                collapsedPath.every((val, idx) => val === node.path[idx]),
            ) || hasMetricChildren;
        return {
          ...(sourceNode || metricNodes[0]),
          key: collapsedKey,
          path: collapsedPath,
          label: metricLabel,
          formattedLabel: metricLabel,
          level: collapsedPath.length,
          hasChildren,
        };
      });
    },
    [
      isExplicitSubtotalNode,
      getMetricDepthForParent,
      getMetricTierNodes,
      groupbyRows.length,
      isMultiMetric,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricsAtRowEnd,
      resolvedMetricsLayout,
    ],
  );

  const getCollapsedColLeavesForNodes = useCallback(
    (
      parent: PivotTreeNode,
      expandedSet: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      if (
        !isMultiMetric ||
        resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS ||
        expandedSet.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(nodes, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(nodes, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyColumns.length;
      const metricLabels = Array.from(
        new Set(
          metricNodes
            .map(node => decodeMetricKey(node.path[metricDepth]))
            .filter((label): label is string => !!label),
        ),
      );
      return metricLabels.map(metricLabel => {
        const metricToken = encodeMetricKey(metricLabel);
        const collapsedPath = [...parent.path, metricToken];
        const collapsedKey = serializePath(collapsedPath);
        const sourceNode = metricNodes.find(node => {
          const decoded = decodeMetricKey(node.path[metricDepth]);
          return decoded === metricLabel;
        });
        const existing = nodes[collapsedKey];
        if (existing) {
          const hasChildren = metricsAtColEnd
            ? false
            : findChildren(nodes, existing).length > 0 || hasMetricChildren;
          if (isMetricSubtotalNode(existing)) {
            return {
              ...existing,
              label: metricLabel,
              formattedLabel: metricLabel,
              isSubtotal: false,
              hasChildren,
            };
          }
          return { ...existing, hasChildren };
        }
        const hasChildren = metricsAtColEnd
          ? false
          : findChildren(nodes, { ...parent, path: collapsedPath }).length >
              0 || hasMetricChildren;
        return {
          ...(sourceNode || metricNodes[0]),
          key: collapsedKey,
          path: collapsedPath,
          label: metricLabel,
          formattedLabel: metricLabel,
          level: collapsedPath.length,
          hasChildren,
        };
      });
    },
    [
      getMetricDepthForParent,
      getMetricTierNodes,
      groupbyColumns.length,
      isMultiMetric,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricsAtColEnd,
      resolvedMetricsLayout,
    ],
  );

  const getRowChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
      metricIndexOverride?: number,
    ) => {
      const rowSubtotalPositionForParent = getRowSubtotalPosition(parent);
      const isMetricSubtotalAtMetricTier = (node: PivotTreeNode) => {
        if (
          resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
          !isMultiMetric
        ) {
          return false;
        }
        const subtotalIndex = node.path.findIndex(val => isSubtotalToken(val));
        if (subtotalIndex <= 0) {
          return false;
        }
        const prev = node.path[subtotalIndex - 1];
        return isMetricTokenValue(prev);
      };
      const children = findChildren(nodes, parent);
      const parentHasMetric = parent.path.some(val => isMetricTokenValue(val));
      const filteredByMetricPosition = parentHasMetric
        ? children
        : children.filter(child => {
            const metricIndex = metricIndexOverride ?? metricIndexOnRows;
            if (metricIndex === undefined) {
              return true;
            }
            if (child.path.length <= metricIndex) {
              return true;
            }
            const metricAtIndex = isMetricTokenValue(child.path[metricIndex]);
            // When metrics sit at the front, ensure we only surface nodes that
            // include the metric at that index, so placeholder/base nodes without
            // metric labels do not render as empty rows.
            return metricAtIndex;
          });
      let filtered = filteredByMetricPosition;
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        parent.axis === 'row' &&
        parent.level < groupbyRows.length &&
        (metricLayoutIndexOnRows === undefined ||
          metricLayoutIndexOnRows > parent.level)
      ) {
        const hasNonMetricChildren = children.some(child => {
          const metricAtLevel = isMetricTokenValue(child.path[parent.level]);
          return !metricAtLevel;
        });
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = isMetricTokenValue(child.path[parent.level]);
          if (!metricAtLevel) {
            return true;
          }
          if (hasNonMetricChildren) {
            if (
              !colTotals &&
              metricLayoutIndexOnRows !== undefined &&
              parent.level < metricLayoutIndexOnRows &&
              metricIndexOnRows === 0
            ) {
              return false;
            }
            return isMetricGrandTotalNode(child);
          }
          return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
        });
        filtered = withoutMetrics.length > 0 ? withoutMetrics : children;
      }
      if (
        hideMetricHeaderOnRows &&
        parent.axis === 'row' &&
        parent.level >= groupbyRows.length
      ) {
        filtered = filtered.filter(
          child => !isMetricTokenValue(child.path[parent.level]),
        );
      }
      if (metricsFirstOnRows) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      if (resolvedMetricsLayout === MetricsLayoutEnum.ROWS && !isMultiMetric) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      if (!rowSubTotals || rowSubtotalPositionForParent === 'start') {
        filtered = filtered.filter(child => {
          if (child.path.length === 0) {
            return true;
          }
          if (!isExplicitSubtotalNode(child)) {
            return true;
          }
          return isMetricGrandTotalNode(child);
        });
      }
      if (rowSubTotals && rowSubtotalPositionForParent === 'end') {
        const requireMetricLabel =
          resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
          isMultiMetric &&
          metricDimIndexOnRows !== undefined &&
          countDimDepth(parent.path) > metricDimIndexOnRows;
        const isSubtotalLevelToken = (val: unknown) => isSubtotalToken(val);
        const subtotalDescendants = Object.values(nodes).filter(node => {
          if (node.path.length <= parent.path.length) {
            return false;
          }
          if (!parent.path.every((val, idx) => val === node.path[idx])) {
            return false;
          }
          if (
            resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
            !isMultiMetric &&
            isMetricGrandTotalNode(node)
          ) {
            return false;
          }
          if (!isSubtotalLevelToken(node.path[parent.path.length])) {
            return false;
          }
          if (hideMetricHeaderOnRows) {
            return !node.path.some(val => isMetricTokenValue(val));
          }
          if (requireMetricLabel) {
            return node.path.some(val => isMetricTokenValue(val));
          }
          return true;
        });
        if (subtotalDescendants.length > 0) {
          const seen = new Set(filtered.map(child => child.key));
          subtotalDescendants.forEach(node => {
            if (isMetricSubtotalAtMetricTier(node)) {
              return;
            }
            if (!seen.has(node.key)) {
              filtered.push(node);
            }
          });
        }
      }
      if (
        rowSubTotals &&
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        isMultiMetric
      ) {
        filtered = filtered.filter(child => {
          if (!isExplicitSubtotalNode(child)) {
            return true;
          }
          if (isMetricGrandTotalNode(child)) {
            return true;
          }
          return child.path.some(val => isMetricTokenValue(val));
        });
      }
      if (
        rowSubTotals &&
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        isMultiMetric &&
        metricDimIndexOnRows !== undefined &&
        metricLayoutIndexOnRows !== undefined &&
        metricLayoutIndexOnRows < groupbyRows.length &&
        metricLayoutIndexOnRows > 1
      ) {
        const suppressDepth = metricDimIndexOnRows + 1;
        filtered = filtered.filter(child => {
          if (!isExplicitSubtotalNode(child)) {
            return true;
          }
          if (metricLayoutIndexOnRows > 1) {
            return true;
          }
          const dimDepth = countDimDepth(child.path);
          const subtotalDepth = child.path.some(val => isSubtotalToken(val))
            ? Math.max(dimDepth - 1, 0)
            : dimDepth;
          return subtotalDepth !== suppressDepth;
        });
      }
      if (rowSubTotals && !isMultiMetric) {
        filtered = filtered.filter(
          child => !isMetricSubtotalAtMetricTier(child),
        );
      }
      return filtered;
    },
    [
      countDimDepth,
      getRowSubtotalPosition,
      groupbyRows.length,
      metricIndexOnRows,
      metricLayoutIndexOnRows,
      hideMetricHeaderOnRows,
      isMetricTokenValue,
      metricDimIndexOnRows,
      resolvedMetricsLayout,
      isMultiMetric,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricsFirstOnRows,
      colTotals,
      rowSubTotals,
    ],
  );

  const pruneCollapsedMetricRows = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      expanded: Set<string>,
    ) => {
      if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows === undefined) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows <= parent.level) {
        return currentTree;
      }
      const removedRowKeys = new Set<string>();
      const shouldPruneLeafChildren =
        metricLayoutIndexOnRows < groupbyRows.length &&
        metricLayoutIndexOnRows > parent.level;
      const rowNodes = Object.values(currentTree.rows);
      const expandedCollapsedNodes = Array.from(expanded)
        .map(key => currentTree.rows[key])
        .filter((node): node is PivotTreeNode => {
          if (!node) {
            return false;
          }
          if (node.path.length <= parent.path.length) {
            return false;
          }
          if (!parent.path.every((val, idx) => val === node.path[idx])) {
            return false;
          }
          const metricIdx = node.path.findIndex(val => isMetricTokenValue(val));
          return metricIdx === parent.level;
        });
      const isUnderExpandedCollapsedNode = (node: PivotTreeNode) =>
        expandedCollapsedNodes.some(
          expandedNode =>
            expandedNode.path.length <= node.path.length &&
            expandedNode.path.every((val, idx) => val === node.path[idx]),
        );
      const hasMetricAtLayoutIndex = (node: PivotTreeNode) =>
        rowNodes.some(descendant => {
          if (descendant.path.length <= metricLayoutIndexOnRows) {
            return false;
          }
          if (!node.path.every((val, idx) => val === descendant.path[idx])) {
            return false;
          }
          const valAtIndex = descendant.path[metricLayoutIndexOnRows];
          return isMetricTokenValue(valAtIndex);
        });
      const shouldPruneCollapsedChildren = hasMetricAtLayoutIndex(parent);
      rowNodes.forEach(node => {
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        if (
          shouldPruneCollapsedChildren &&
          node.path.length === parent.path.length + 1 &&
          !isExplicitSubtotalNode(node) &&
          !isMetricGrandTotalNode(node) &&
          !isMetricSubtotalNode(node) &&
          !hasMetricAtLayoutIndex(node)
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedRowKeys.add(node.key);
          return;
        }
        if (
          shouldPruneLeafChildren &&
          node.path.length === parent.path.length + 1 &&
          !node.hasChildren
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedRowKeys.add(node.key);
        }
      });
      if (removedRowKeys.size === 0) {
        return currentTree;
      }
      const nextRows: PivotTreeData['rows'] = { ...currentTree.rows };
      removedRowKeys.forEach(key => {
        delete nextRows[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedRowKeys.has(cell.rowKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, rows: nextRows, cells: nextCells };
    },
    [
      groupbyRows.length,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricLayoutIndexOnRows,
      resolvedMetricsLayout,
    ],
  );
  const pruneStaleCollapsedRows = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      branch?: PivotTreeData,
    ) => {
      if (!branch) {
        return currentTree;
      }
      if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows === undefined) {
        return currentTree;
      }
      if (metricLayoutIndexOnRows <= parent.level) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      const branchParent = branch.rows[parent.key];
      if (!branchParent) {
        return currentTree;
      }
      const branchChildren = findChildren(branch.rows, branchParent);
      if (branchChildren.length === 0) {
        return currentTree;
      }
      const validChildKeys = new Set(branchChildren.map(child => child.key));
      const removedPrefixes: PivotTreeNode['path'][] = [];
      Object.values(currentTree.rows).forEach(node => {
        if (node.path.length !== parent.path.length + 1) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        if (validChildKeys.has(node.key)) {
          return;
        }
        if (
          isExplicitSubtotalNode(node) ||
          isMetricGrandTotalNode(node) ||
          isMetricSubtotalNode(node)
        ) {
          return;
        }
        removedPrefixes.push(node.path);
      });
      if (removedPrefixes.length === 0) {
        return currentTree;
      }
      const removedKeys = new Set<string>();
      Object.values(currentTree.rows).forEach(node => {
        if (
          removedPrefixes.some(prefix =>
            prefix.every((val, idx) => val === node.path[idx]),
          )
        ) {
          removedKeys.add(node.key);
        }
      });
      const nextRows: PivotTreeData['rows'] = { ...currentTree.rows };
      removedKeys.forEach(key => {
        delete nextRows[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedKeys.has(cell.rowKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, rows: nextRows, cells: nextCells };
    },
    [
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricLayoutIndexOnRows,
      resolvedMetricsLayout,
    ],
  );

  const pruneCollapsedMetricCols = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      expanded: Set<string>,
    ) => {
      if (resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols === undefined) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols <= parent.level) {
        return currentTree;
      }
      const removedColKeys = new Set<string>();
      const shouldPruneLeafChildren =
        metricLayoutIndexOnCols < groupbyColumns.length &&
        metricLayoutIndexOnCols > parent.level;
      const colNodes = Object.values(currentTree.cols);
      const expandedCollapsedNodes = Array.from(expanded)
        .map(key => currentTree.cols[key])
        .filter((node): node is PivotTreeNode => {
          if (!node) {
            return false;
          }
          if (node.path.length <= parent.path.length) {
            return false;
          }
          if (!parent.path.every((val, idx) => val === node.path[idx])) {
            return false;
          }
          const metricIdx = node.path.findIndex(val => isMetricTokenValue(val));
          return metricIdx === parent.level;
        });
      const isUnderExpandedCollapsedNode = (node: PivotTreeNode) =>
        expandedCollapsedNodes.some(
          expandedNode =>
            expandedNode.path.length <= node.path.length &&
            expandedNode.path.every((val, idx) => val === node.path[idx]),
        );
      const hasMetricAtLayoutIndex = (node: PivotTreeNode) =>
        colNodes.some(descendant => {
          if (descendant.path.length <= metricLayoutIndexOnCols) {
            return false;
          }
          if (!node.path.every((val, idx) => val === descendant.path[idx])) {
            return false;
          }
          const valAtIndex = descendant.path[metricLayoutIndexOnCols];
          return isMetricTokenValue(valAtIndex);
        });
      const shouldPruneCollapsedChildren = hasMetricAtLayoutIndex(parent);
      colNodes.forEach(node => {
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        const metricIdx = node.path.findIndex(val => isMetricTokenValue(val));
        if (
          shouldPruneCollapsedChildren &&
          node.path.length === parent.path.length + 1 &&
          !isExplicitSubtotalNode(node) &&
          !isMetricGrandTotalNode(node) &&
          !isMetricSubtotalNode(node) &&
          metricIdx === parent.level &&
          !hasMetricAtLayoutIndex(node)
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedColKeys.add(node.key);
          return;
        }
        if (
          shouldPruneLeafChildren &&
          node.path.length === parent.path.length + 1 &&
          !node.hasChildren
        ) {
          if (isUnderExpandedCollapsedNode(node)) {
            return;
          }
          removedColKeys.add(node.key);
        }
      });
      if (removedColKeys.size === 0) {
        return currentTree;
      }
      const nextCols: PivotTreeData['cols'] = { ...currentTree.cols };
      removedColKeys.forEach(key => {
        delete nextCols[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedColKeys.has(cell.colKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, cols: nextCols, cells: nextCells };
    },
    [
      groupbyColumns.length,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricLayoutIndexOnCols,
      resolvedMetricsLayout,
    ],
  );

  const pruneStaleCollapsedCols = useCallback(
    (
      currentTree: PivotTreeData,
      parent: PivotTreeNode,
      branch?: PivotTreeData,
    ) => {
      if (!branch) {
        return currentTree;
      }
      if (resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols === undefined) {
        return currentTree;
      }
      if (metricLayoutIndexOnCols <= parent.level) {
        return currentTree;
      }
      if (parent.path.some(val => isMetricTokenValue(val))) {
        return currentTree;
      }
      const branchParent = branch.cols[parent.key];
      if (!branchParent) {
        return currentTree;
      }
      const branchChildren = findChildren(branch.cols, branchParent);
      if (branchChildren.length === 0) {
        return currentTree;
      }
      const validChildKeys = new Set(branchChildren.map(child => child.key));
      const removedPrefixes: PivotTreeNode['path'][] = [];
      Object.values(currentTree.cols).forEach(node => {
        if (node.path.length !== parent.path.length + 1) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        if (validChildKeys.has(node.key)) {
          return;
        }
        if (
          isExplicitSubtotalNode(node) ||
          isMetricGrandTotalNode(node) ||
          isMetricSubtotalNode(node)
        ) {
          return;
        }
        removedPrefixes.push(node.path);
      });
      if (removedPrefixes.length === 0) {
        return currentTree;
      }
      const removedKeys = new Set<string>();
      Object.values(currentTree.cols).forEach(node => {
        if (
          removedPrefixes.some(prefix =>
            prefix.every((val, idx) => val === node.path[idx]),
          )
        ) {
          removedKeys.add(node.key);
        }
      });
      const nextCols: PivotTreeData['cols'] = { ...currentTree.cols };
      removedKeys.forEach(key => {
        delete nextCols[key];
      });
      const nextCells: PivotTreeData['cells'] = {};
      Object.entries(currentTree.cells).forEach(([key, cell]) => {
        if (removedKeys.has(cell.colKey)) {
          return;
        }
        nextCells[key] = cell;
      });
      return { ...currentTree, cols: nextCols, cells: nextCells };
    },
    [
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricLayoutIndexOnCols,
      resolvedMetricsLayout,
    ],
  );

  const getColChildrenForNodes = useCallback(
    (
      parent: PivotTreeNode,
      nodes: Record<string, PivotTreeNode>,
      metricIndexOverride?: number,
    ) => {
      const children = findChildren(nodes, parent);
      const parentHasMetric = parent.path.some(val => isMetricTokenValue(val));
      const filteredByMetricPosition = parentHasMetric
        ? children
        : children.filter(child => {
            const metricIndex = metricIndexOverride ?? metricIndexOnCols;
            if (metricIndex === undefined) {
              return true;
            }
            if (child.path.length <= metricIndex) {
              return true;
            }
            const metricAtIndex = isMetricTokenValue(child.path[metricIndex]);
            return metricAtIndex;
          });
      let filtered = filteredByMetricPosition;
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
        parent.axis === 'col' &&
        parent.level < groupbyColumns.length &&
        (metricLayoutIndexOnCols === undefined ||
          metricLayoutIndexOnCols > parent.level)
      ) {
        const allowMetricSubtotals = normalizedColSubtotalLevels.length > 0;
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = isMetricTokenValue(child.path[parent.level]);
          if (!metricAtLevel) {
            return true;
          }
          if (allowMetricSubtotals) {
            return isMetricGrandTotalNode(child) || isMetricSubtotalNode(child);
          }
          return isMetricGrandTotalNode(child);
        });
        filtered = withoutMetrics.length > 0 ? withoutMetrics : children;
      }
      if (
        hideMetricHeaderOnCols &&
        parent.axis === 'col' &&
        parent.level >= groupbyColumns.length
      ) {
        filtered = filtered.filter(
          child => !isMetricTokenValue(child.path[parent.level]),
        );
      }
      if (metricsFirstOnCols) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      return filtered;
    },
    [
      groupbyColumns.length,
      metricLayoutIndexOnCols,
      hideMetricHeaderOnCols,
      isMetricTokenValue,
      metricIndexOnCols,
      normalizedColSubtotalLevels.length,
      resolvedMetricsLayout,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricsFirstOnCols,
    ],
  );

  const depthSorter = useCallback(
    (_a: PivotTreeNode, _b: PivotTreeNode) => 0,
    [],
  );
  const buildEngineRenderModelConfig = useCallback(
    (
      nextExpandedRows: Set<string>,
      nextExpandedCols: Set<string>,
      nextTree: PivotTreeData,
    ): RenderModelConfig => {
      const metricIndexForRowsResolved =
        findMetricIndex(nextTree.rows) ??
        metricLayoutIndexOnRows ??
        metricIndexOnRows;
      const metricIndexForColsResolved =
        findMetricIndex(nextTree.cols) ??
        metricLayoutIndexOnCols ??
        metricIndexOnCols;
      return {
        groupbyRowsLength: groupbyRows.length,
        groupbyColumnsLength: groupbyColumns.length,
        normalizedRowSubtotalLevels,
        normalizedColSubtotalLevels,
        rowTotals,
        colTotals,
        rowTotalPosition: resolvedColTotalPosition,
        colTotalPosition: resolvedRowTotalPosition,
        resolvedColSubtotalPosition: effectiveColSubtotalPosition,
        resolvedMetricsLayout,
        isMultiMetric,
        metricsFirstOnCols,
        hideMetricHeaderOnRows,
        hideMetricHeaderOnCols,
        rowSorter: depthSorter,
        colSorter: depthSorter,
        getRowChildren: parent =>
          getRowChildrenForNodes(
            parent,
            nextTree.rows,
            metricIndexForRowsResolved,
          ),
        getCollapsedRowChildren: parent =>
          getCollapsedRowChildrenForNodes(
            parent,
            nextExpandedRows,
            nextTree.rows,
          ),
        getColChildren: parent =>
          getColChildrenForNodes(
            parent,
            nextTree.cols,
            metricIndexForColsResolved,
          ),
        getCollapsedColLeaves: parent =>
          getCollapsedColLeavesForNodes(
            parent,
            nextExpandedCols,
            nextTree.cols,
          ),
        countDimDepth,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
        isMetricTokenValue,
      };
    },
    [
      colTotals,
      countDimDepth,
      depthSorter,
      effectiveColSubtotalPosition,
      findMetricIndex,
      getCollapsedColLeavesForNodes,
      getCollapsedRowChildrenForNodes,
      getColChildrenForNodes,
      getRowChildrenForNodes,
      groupbyColumns.length,
      groupbyRows.length,
      hideMetricHeaderOnCols,
      hideMetricHeaderOnRows,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      isMultiMetric,
      metricIndexOnCols,
      metricIndexOnRows,
      metricLayoutIndexOnCols,
      metricLayoutIndexOnRows,
      metricsFirstOnCols,
      normalizedColSubtotalLevels,
      normalizedRowSubtotalLevels,
      resolvedColTotalPosition,
      resolvedMetricsLayout,
      resolvedRowTotalPosition,
      rowTotals,
    ],
  );

  const getVisibleExpansionKeys = useCallback(
    (nextRows: Set<string>, nextCols: Set<string>, nextTree: PivotTreeData) => {
      const metricIndexForRowsResolved =
        findMetricIndex(nextTree.rows) ??
        metricLayoutIndexOnRows ??
        metricIndexOnRows;
      const metricIndexForColsResolved =
        findMetricIndex(nextTree.cols) ??
        metricLayoutIndexOnCols ??
        metricIndexOnCols;
      const nextRenderModel = buildRenderModel({
        tree: nextTree,
        expandedRows: nextRows,
        expandedCols: nextCols,
        config: buildEngineRenderModelConfig(nextRows, nextCols, nextTree),
      });
      return getVisibleExpansionKeysBase({
        rowsNodes: nextTree.rows,
        colsNodes: nextTree.cols,
        expandedRows: nextRows,
        expandedCols: nextCols,
        rowSorter: depthSorter,
        colSorter: depthSorter,
        skipRowRoot: nextRenderModel.skipRowRoot,
        showRowRoot: nextRenderModel.showRowRoot,
        rowTotalPosition: resolvedColTotalPosition,
        getRowChildren: parent =>
          getRowChildrenForNodes(
            parent,
            nextTree.rows,
            metricIndexForRowsResolved,
          ),
        getCollapsedRowChildren: parent =>
          getCollapsedRowChildrenForNodes(parent, nextRows, nextTree.rows),
        skipColRoot: nextRenderModel.skipColRoot,
        countDimDepth,
        normalizedColSubtotalLevels,
        showColRoot: nextRenderModel.showColRoot,
        rowTotals,
        colTotalPosition: resolvedRowTotalPosition,
        resolvedColSubtotalPosition: effectiveColSubtotalPosition,
        getColChildren: parent =>
          getColChildrenForNodes(
            parent,
            nextTree.cols,
            metricIndexForColsResolved,
          ),
        getCollapsedColLeaves: parent =>
          getCollapsedColLeavesForNodes(parent, nextCols, nextTree.cols),
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
        isMetricTokenValue,
        shouldHideMetricGrandTotalsOnRows:
          nextRenderModel.shouldHideMetricGrandTotalsOnRows,
        shouldHideMetricGrandTotalsOnCols:
          nextRenderModel.shouldHideMetricGrandTotalsOnCols,
        shouldSuppressColRoot: nextRenderModel.shouldSuppressColRoot,
      });
    },
    [
      buildEngineRenderModelConfig,
      countDimDepth,
      depthSorter,
      effectiveColSubtotalPosition,
      findMetricIndex,
      getCollapsedColLeavesForNodes,
      getCollapsedRowChildrenForNodes,
      getColChildrenForNodes,
      getRowChildrenForNodes,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      metricIndexOnCols,
      metricIndexOnRows,
      metricLayoutIndexOnCols,
      metricLayoutIndexOnRows,
      normalizedColSubtotalLevels,
      resolvedColTotalPosition,
      resolvedRowTotalPosition,
      rowTotals,
    ],
  );

  const pruneMergedTree = useCallback(
    ({
      axis,
      tree: nextTree,
      parent,
      branch,
      expandedRows: nextExpandedRows,
      expandedCols: nextExpandedCols,
    }: {
      axis: 'row' | 'col';
      tree: PivotTreeData;
      parent?: PivotTreeNode;
      branch?: PivotTreeData;
      expandedRows: Set<string>;
      expandedCols: Set<string>;
    }) => {
      if (!parent || !branch) {
        return nextTree;
      }
      if (axis === 'row') {
        let pruned = pruneCollapsedMetricRows(
          nextTree,
          parent,
          nextExpandedRows,
        );
        pruned = pruneStaleCollapsedRows(pruned, parent, branch);
        return pruned;
      }
      let pruned = pruneCollapsedMetricCols(nextTree, parent, nextExpandedCols);
      pruned = pruneStaleCollapsedCols(pruned, parent, branch);
      return pruned;
    },
    [
      pruneCollapsedMetricCols,
      pruneCollapsedMetricRows,
      pruneStaleCollapsedCols,
      pruneStaleCollapsedRows,
    ],
  );

  const {
    tree,
    expandedRows,
    expandedCols,
    loadingKeys,
    errorMessage,
    isHydrating,
    handleToggle,
  } = useExpansionEngine({
    data,
    expandedStateSignature,
    fetchFormData,
    groupbyRowKeys,
    groupbyColumnKeys,
    groupbyRowsLength: groupbyRows.length,
    groupbyColumnsLength: groupbyColumns.length,
    resolvedExpandRowsLevel,
    resolvedExpandColumnsLevel,
    shouldExpandMetricRows,
    shouldExpandMetricCols,
    metricLabelSet,
    metricIndexForRows: metricIntentIndexOnRows,
    metricIndexForCols: metricIntentIndexOnCols,
    isMetricTokenValue,
    countDimDepth: countEngineDimDepth,
    expandRowsLevelRaw,
    expandColumnsLevelRaw,
    setControlValue,
    pivotExpansionState: formData.pivotExpansionState,
    shouldPersistExpansionState: persistExpansionState,
    getVisibleExpansionKeys,
    buildRenderModelConfig: buildEngineRenderModelConfig,
    getFetchPath,
    pruneMergedTree,
  });

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const {
    rowValuesMap: rowFormattingValuesMap,
    colValuesMap: colFormattingValuesMap,
  } = useMemo(
    () =>
      buildFormattingValueMaps({
        cells: tree.cells,
        rows: tree.rows,
        cols: tree.cols,
        getNonMetricPathParts,
        rootKey,
      }),
    [getNonMetricPathParts, tree.cells, tree.cols, tree.rows],
  );
  const rowSortingValuesMap = rowFormattingValuesMap;
  const colSortingValuesMap = colFormattingValuesMap;
  const resolveDimensionStyle = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode, target: 'label' | 'cell') => {
      if (node.path.length === 0 || isMetricGrandTotalNode(node)) {
        return undefined;
      }
      const dimensionKey = getDimensionKeyForNode(node, axis);
      const formattingMap =
        axis === 'row' ? rowFormattingKeyMap : colFormattingKeyMap;
      const formatting = dimensionKey ? formattingMap[dimensionKey] : undefined;
      if (!formatting) {
        return undefined;
      }
      if (target === 'cell' && formatting.applyTo !== 'all') {
        return undefined;
      }
      const nonMetricKey = serializePath(getNonMetricPathParts(node.path));
      const values =
        axis === 'row'
          ? rowFormattingValuesMap.get(nonMetricKey)
          : colFormattingValuesMap.get(nonMetricKey);
      if (!values) {
        return undefined;
      }
      const backgroundColor = formatting.backgroundColor
        ? normalizeCssColor(values[formatting.backgroundColor])
        : undefined;
      const textColor = formatting.textColor
        ? normalizeCssColor(values[formatting.textColor])
        : undefined;
      if (!backgroundColor && !textColor) {
        return undefined;
      }
      return {
        ...(backgroundColor ? { backgroundColor } : {}),
        ...(textColor ? { color: textColor } : {}),
      };
    },
    [
      colFormattingKeyMap,
      colFormattingValuesMap,
      getDimensionKeyForNode,
      getNonMetricPathParts,
      isMetricGrandTotalNode,
      rowFormattingKeyMap,
      rowFormattingValuesMap,
    ],
  );
  const resolveSortConfig = useCallback(
    (axis: 'row' | 'col', a: PivotTreeNode, b: PivotTreeNode) => {
      const dimensionKey =
        getDimensionKeyForNode(a, axis) || getDimensionKeyForNode(b, axis);
      if (!dimensionKey) {
        return undefined;
      }
      const map = axis === 'row' ? rowSortingKeyMap : colSortingKeyMap;
      return map[dimensionKey];
    },
    [colSortingKeyMap, getDimensionKeyForNode, rowSortingKeyMap],
  );
  const getSortValue = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode, metricKey: string) => {
      const nonMetricKey = serializePath(getNonMetricPathParts(node.path));
      const valuesMap =
        axis === 'row' ? rowSortingValuesMap : colSortingValuesMap;
      return valuesMap.get(nonMetricKey)?.[metricKey];
    },
    [colSortingValuesMap, getNonMetricPathParts, rowSortingValuesMap],
  );
  const compareMetricSort = useCallback(
    (axis: 'row' | 'col', a: PivotTreeNode, b: PivotTreeNode) => {
      const config = resolveSortConfig(axis, a, b);
      if (!config) {
        return 0;
      }
      if (!config.metricKey) {
        const dimensionKey =
          getDimensionKeyForNode(a, axis) || getDimensionKeyForNode(b, axis);
        const type = dimensionKey ? colTypeMap?.[dimensionKey] : undefined;
        const cmp = compareValues(a.label, b.label, type);
        return config.order === 'asc' ? cmp : -cmp;
      }
      if (config.mode !== 'total') {
        return 0;
      }
      const aValue = getSortValue(axis, a, config.metricKey);
      const bValue = getSortValue(axis, b, config.metricKey);
      if (aValue === undefined || bValue === undefined) {
        return 0;
      }
      const type =
        typeof aValue === 'number' && typeof bValue === 'number'
          ? GenericDataType.Numeric
          : undefined;
      const cmp = compareValues(aValue, bValue, type);
      return config.order === 'asc' ? cmp : -cmp;
    },
    [colTypeMap, getDimensionKeyForNode, getSortValue, resolveSortConfig],
  );

  const rowSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      rowOrder,
      colTypeMap,
      groupbyRows.map(getColumnLabel),
    );
    const pushMetricTotalsToEnd =
      (colTotals && resolvedColTotalPosition === 'end') ||
      (rowSubTotals && effectiveRowSubtotalPosition === 'end');
    const pullMetricTotalsToStart =
      colTotals && resolvedColTotalPosition === 'start';
    if (
      !rowSubTotals &&
      !pushMetricTotalsToEnd &&
      !pullMetricTotalsToStart &&
      !hasRowSorting
    ) {
      return baseSorter;
    }
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      if (pullMetricTotalsToStart) {
        const aMetricTotal = isMetricGrandTotalNode(a) ? 1 : 0;
        const bMetricTotal = isMetricGrandTotalNode(b) ? 1 : 0;
        if (aMetricTotal !== bMetricTotal) {
          return bMetricTotal - aMetricTotal;
        }
      }
      const aSubtotal =
        isExplicitSubtotalNode(a) ||
        (pushMetricTotalsToEnd && isMetricGrandTotalNode(a))
          ? 1
          : 0;
      const bSubtotal =
        isExplicitSubtotalNode(b) ||
        (pushMetricTotalsToEnd && isMetricGrandTotalNode(b))
          ? 1
          : 0;
      if (aSubtotal !== bSubtotal) {
        return aSubtotal - bSubtotal;
      }
      const metricOrder = compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      const metricSort = compareMetricSort('row', a, b);
      if (metricSort !== 0) {
        return metricSort;
      }
      return baseSorter(a, b);
    };
  }, [
    colTypeMap,
    compareMetricSort,
    compareMetricOrder,
    effectiveRowSubtotalPosition,
    groupbyRows,
    hasRowSorting,
    isExplicitSubtotalNode,
    isMetricGrandTotalNode,
    rowOrder,
    colTotals,
    resolvedColTotalPosition,
    rowSubTotals,
  ]);
  const colSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      colOrder,
      colTypeMap,
      groupbyColumns.map(getColumnLabel),
    );
    return (a: PivotTreeNode, b: PivotTreeNode) => {
      const metricOrder = compareMetricOrder(a, b);
      if (metricOrder !== 0) {
        return metricOrder;
      }
      const metricSort = compareMetricSort('col', a, b);
      if (metricSort !== 0) {
        return metricSort;
      }
      return baseSorter(a, b);
    };
  }, [
    colOrder,
    colTypeMap,
    compareMetricOrder,
    compareMetricSort,
    groupbyColumns,
  ]);

  const buildRenderModelConfig = useCallback(
    (
      nextExpandedRows: Set<string>,
      nextExpandedCols: Set<string>,
      nextTree: PivotTreeData,
    ): RenderModelConfig => {
      const metricIndexForRowsResolved =
        findMetricIndex(nextTree.rows) ??
        metricLayoutIndexOnRows ??
        metricIndexOnRows;
      const metricIndexForColsResolved =
        findMetricIndex(nextTree.cols) ??
        metricLayoutIndexOnCols ??
        metricIndexOnCols;
      return {
        groupbyRowsLength: groupbyRows.length,
        groupbyColumnsLength: groupbyColumns.length,
        normalizedRowSubtotalLevels,
        normalizedColSubtotalLevels,
        rowTotals,
        colTotals,
        rowTotalPosition: resolvedColTotalPosition,
        colTotalPosition: resolvedRowTotalPosition,
        resolvedColSubtotalPosition: effectiveColSubtotalPosition,
        resolvedMetricsLayout,
        isMultiMetric,
        metricsFirstOnCols,
        hideMetricHeaderOnRows,
        hideMetricHeaderOnCols,
        rowSorter,
        colSorter,
        getRowChildren: parent =>
          getRowChildrenForNodes(
            parent,
            nextTree.rows,
            metricIndexForRowsResolved,
          ),
        getCollapsedRowChildren: parent =>
          getCollapsedRowChildrenForNodes(
            parent,
            nextExpandedRows,
            nextTree.rows,
          ),
        getColChildren: parent =>
          getColChildrenForNodes(
            parent,
            nextTree.cols,
            metricIndexForColsResolved,
          ),
        getCollapsedColLeaves: parent =>
          getCollapsedColLeavesForNodes(
            parent,
            nextExpandedCols,
            nextTree.cols,
          ),
        countDimDepth,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
        isMetricTokenValue,
      };
    },
    [
      colSorter,
      colTotals,
      countDimDepth,
      effectiveColSubtotalPosition,
      findMetricIndex,
      getCollapsedColLeavesForNodes,
      getCollapsedRowChildrenForNodes,
      getColChildrenForNodes,
      getRowChildrenForNodes,
      groupbyColumns.length,
      groupbyRows.length,
      hideMetricHeaderOnCols,
      hideMetricHeaderOnRows,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      isMetricTokenValue,
      isMultiMetric,
      metricIndexOnCols,
      metricIndexOnRows,
      metricLayoutIndexOnCols,
      metricLayoutIndexOnRows,
      metricsFirstOnCols,
      normalizedColSubtotalLevels,
      normalizedRowSubtotalLevels,
      resolvedColTotalPosition,
      resolvedMetricsLayout,
      resolvedRowTotalPosition,
      rowSorter,
      rowTotals,
    ],
  );

  const renderModel = useMemo(
    () =>
      buildRenderModel({
        tree,
        expandedRows,
        expandedCols,
        config: buildRenderModelConfig(expandedRows, expandedCols, tree),
      }),
    [buildRenderModelConfig, expandedCols, expandedRows, tree],
  );
  const { showRowRoot, visibleRows, visibleCols } = renderModel;
  const showRowSpinner = useCallback(
    (key: string) => loadingKeys.has(key),
    [loadingKeys],
  );
  const showColSpinner = useCallback(
    (key: string) => loadingKeys.has(key),
    [loadingKeys],
  );
  const showGlobalLoader = isHydrating;
  const colNonMetricDepths = useMemo(() => {
    const depthMap = new Map<string, number>();
    Object.values(tree.cols).forEach(node => {
      const parts = getNonMetricPathParts(node.path);
      for (let i = 0; i <= parts.length; i += 1) {
        const prefixKey = serializePath(parts.slice(0, i));
        const prev = depthMap.get(prefixKey) ?? 0;
        if (parts.length > prev) {
          depthMap.set(prefixKey, parts.length);
        }
      }
    });
    return depthMap;
  }, [getNonMetricPathParts, tree.cols]);
  const hasDeeperNonMetricDescendants = useCallback(
    (col: PivotTreeNode) => {
      const parts = getNonMetricPathParts(col.path);
      const key = serializePath(parts);
      const maxDepth = colNonMetricDepths.get(key) ?? parts.length;
      return maxDepth > parts.length;
    },
    [colNonMetricDepths, getNonMetricPathParts],
  );
  const getColumnDisplayPath = useCallback(
    (col: PivotTreeNode, maxDepth: number) => {
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
        metricsFirstOnCols &&
        expandedCols.has(col.key)
      ) {
        const metricLabel = getMetricLabelFromPath(col.path);
        if (metricLabel && col.path.length < maxDepth) {
          const totalLabel = metricLabel;
          return [
            ...col.path,
            ...Array(Math.max(maxDepth - col.path.length, 0)).fill(totalLabel),
          ];
        }
      }
      return buildColumnDisplayPath(col, maxDepth, {
        metricsLayout: resolvedMetricsLayout,
        metricsFirstOnCols,
        metricsAtColEnd,
        allowMetricSubtotalLabels: normalizedColSubtotalLevels.length > 0,
        hasDeeperNonMetricDescendants,
        metricLabels,
        isExplicitSubtotalNode,
        getMetricLabelFromPath,
        getNonMetricPathParts,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
      });
    },
    [
      getMetricLabelFromPath,
      getNonMetricPathParts,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricLabels,
      normalizedColSubtotalLevels.length,
      hasDeeperNonMetricDescendants,
      metricsAtColEnd,
      metricsFirstOnCols,
      expandedCols,
      resolvedMetricsLayout,
    ],
  );
  const columnHeaderRows = useMemo(
    () => buildColumnHeaderRows(visibleCols, tree.cols, getColumnDisplayPath),
    [getColumnDisplayPath, tree.cols, visibleCols],
  );
  const renderModelWithHeaders = useMemo(
    () => ({ ...renderModel, columnHeaderRows }),
    [columnHeaderRows, renderModel],
  );
  useLayoutEffect(() => {
    if (!resolvedStickyHeaders) {
      setHeaderOffset(prev => (prev === 0 ? prev : 0));
      setHeaderRowOffsets(prev => (prev.length === 0 ? prev : []));
      return;
    }
    const rows = Array.from(headerRef.current?.querySelectorAll('tr') ?? []);
    let runningOffset = 0;
    const nextRowOffsets = rows.map(row => {
      const currentOffset = runningOffset;
      runningOffset += row.getBoundingClientRect().height;
      return currentOffset;
    });
    const nextOffset = runningOffset;
    setHeaderOffset(prev => (prev === nextOffset ? prev : nextOffset));
    setHeaderRowOffsets(prev => {
      if (prev.length !== nextRowOffsets.length) {
        return nextRowOffsets;
      }
      const isSame = prev.every((value, idx) => value === nextRowOffsets[idx]);
      return isSame ? prev : nextRowOffsets;
    });
  }, [columnHeaderRows, resolvedStickyHeaders, width]);
  const themeColor = useMemo(() => {
    if (pivotTheme === 'custom') {
      return parseThemeColors(pivotThemeColors)[0];
    }
    return PIVOT_THEME_PRESETS[pivotTheme];
  }, [pivotTheme, pivotThemeColors]);
  const getTotalBackground = useCallback(
    (row?: PivotTreeNode) => {
      if (!themeColor) {
        return undefined;
      }
      const isRowTotal = row?.key === rootKey && showRowRoot;
      return isRowTotal ? themeColor : undefined;
    },
    [showRowRoot, themeColor],
  );
  const expandedRowDepths = useMemo(
    () =>
      getExpandedDepths(
        expandedRows,
        tree.rows,
        groupbyRows.length,
        countDimDepth,
      ),
    [countDimDepth, expandedRows, groupbyRows.length, tree.rows],
  );
  const expandedColDepths = useMemo(
    () =>
      getExpandedDepths(
        expandedCols,
        tree.cols,
        groupbyColumns.length,
        countDimDepth,
      ),
    [countDimDepth, expandedCols, groupbyColumns.length, tree.cols],
  );
  const isExplicitTotalNode = useCallback(
    (node: PivotTreeNode) =>
      isExplicitTotalNodeBase(node, {
        metricLabelSet,
        metricsFirstOnRows,
        metricsFirstOnCols,
      }),
    [metricLabelSet, metricsFirstOnCols, metricsFirstOnRows],
  );
  const getNodeDimDepth = useCallback(
    (node: PivotTreeNode) =>
      getNodeDimDepthBase(node, {
        metricLabelSet,
        metricsLayout: resolvedMetricsLayout,
        hideMetricHeaderOnRows,
        metricLayoutIndexOnRows,
      }),
    [
      hideMetricHeaderOnRows,
      metricLayoutIndexOnRows,
      metricLabelSet,
      resolvedMetricsLayout,
    ],
  );
  const shouldShowToggle = useCallback(
    (axis: 'row' | 'col', node?: PivotTreeNode) => {
      if (!node || !node.hasChildren || node.path.length === 0) {
        return false;
      }
      if (isExplicitSubtotalNode(node) || isMetricGrandTotalNode(node)) {
        return false;
      }
      const hideMetricParentToggle =
        axis === 'row'
          ? resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
            isMultiMetric &&
            metricLayoutIndexOnRows !== undefined &&
            metricLayoutIndexOnRows > 0 &&
            metricLayoutIndexOnRows < groupbyRows.length &&
            node.path.length === metricLayoutIndexOnRows &&
            !node.path.some(val => isMetricTokenValue(val))
          : resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
            isMultiMetric &&
            metricLayoutIndexOnCols !== undefined &&
            metricLayoutIndexOnCols > 0 &&
            metricLayoutIndexOnCols < groupbyColumns.length &&
            node.path.length === metricLayoutIndexOnCols &&
            !node.path.some(val => isMetricTokenValue(val));
      if (hideMetricParentToggle) {
        return false;
      }
      return true;
    },
    [
      groupbyColumns.length,
      groupbyRows.length,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMultiMetric,
      metricLayoutIndexOnCols,
      metricLayoutIndexOnRows,
      isMetricTokenValue,
      resolvedMetricsLayout,
    ],
  );
  const isRowAggregateBold = useCallback(
    (row?: PivotTreeNode) => {
      if (!row) {
        return false;
      }
      if (isExplicitTotalNode(row)) {
        return true;
      }
      if (!row.hasChildren) {
        return false;
      }
      const dimDepth = countDimDepth(row.path);
      if (dimDepth >= groupbyRows.length) {
        return false;
      }
      return expandedRowDepths.has(dimDepth);
    },
    [countDimDepth, expandedRowDepths, groupbyRows.length, isExplicitTotalNode],
  );
  const isColAggregateBold = useCallback(
    (col?: PivotTreeNode) => {
      if (!col) {
        return false;
      }
      if (isExplicitTotalNode(col)) {
        return true;
      }
      if (!col.hasChildren) {
        return false;
      }
      const dimDepth = countDimDepth(col.path);
      if (dimDepth >= groupbyColumns.length) {
        return false;
      }
      return expandedColDepths.has(dimDepth);
    },
    [
      countDimDepth,
      expandedColDepths,
      groupbyColumns.length,
      isExplicitTotalNode,
    ],
  );

  const renderValue = useCallback(
    (metric: string, value: DataRecordValue, d3FormatOverride?: string) =>
      formatMetricValue(
        metric,
        value,
        columnFormats,
        currencyFormats,
        val => numberFormatter(val as number),
        d3FormatOverride,
      ),
    [columnFormats, currencyFormats, numberFormatter],
  );

  const handleCellClick = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      if (!emitCrossFilters) {
        return;
      }
      const filters = buildCellFilters({
        rowNode,
        colNode,
        groupbyRows,
        groupbyColumns,
        metrics,
        metricsLayout: resolvedMetricsLayout,
      });
      const binaryFilters = filters.filter(
        (filter): filter is BinaryQueryObjectFilterClause => 'val' in filter,
      );
      setDataMask({
        extraFormData: {
          filters: filters as any,
        },
        filterState: {
          value: binaryFilters.map(filter => filter.val),
          selectedFilters: binaryFilters.reduce(
            (acc, filter) => {
              const key = String(
                'col' in filter ? (filter as any).col : (filter as any).subject,
              );
              return {
                ...acc,
                [key]: [filter.val],
              };
            },
            {} as Record<string, DataRecordValue[]>,
          ),
        },
        ownState: {
          ...mergeOwnState({
            treeData: treeRef.current,
            treeDataSignature,
          }),
        },
      });
    },
    [
      emitCrossFilters,
      groupbyColumns,
      groupbyRows,
      mergeOwnState,
      metrics,
      resolvedMetricsLayout,
      setDataMask,
      treeDataSignature,
    ],
  );

  const handleCellKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLTableCellElement>,
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      handleCellClick(rowNode, colNode);
    },
    [handleCellClick],
  );

  const handleCellContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLTableCellElement>,
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ) => {
      if (!onContextMenu) {
        return;
      }
      event.preventDefault();
      const contextFilters = buildContextMenuFilters({
        rowNode,
        colNode,
        groupbyRows,
        groupbyColumns,
        metrics,
        metricsLayout: resolvedMetricsLayout,
        dateFormatters,
        timeGrainSqla,
      });

      onContextMenu(event.clientX, event.clientY, {
        drillToDetail: contextFilters,
        crossFilter: emitCrossFilters
          ? {
              dataMask: {
                extraFormData: { filters: contextFilters as any },
                filterState: {
                  value: contextFilters.map(filter => filter.val),
                  selectedFilters: contextFilters.reduce(
                    (acc, filter) => ({
                      ...acc,
                      [String(filter.col)]: [filter.val],
                    }),
                    {},
                  ),
                },
                ownState: {
                  ...(ownState ?? {}),
                  treeData: treeRef.current,
                  treeDataSignature,
                },
              },
              isCurrentValueSelected: false,
            }
          : undefined,
      });
    },
    [
      dateFormatters,
      emitCrossFilters,
      groupbyColumns,
      groupbyRows,
      metrics,
      ownState,
      resolvedMetricsLayout,
      onContextMenu,
      treeDataSignature,
      timeGrainSqla,
    ],
  );

  const deriveMetricKey = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) =>
      deriveMetricKeyBase({
        rowNode,
        colNode,
        metrics,
        metricsLayout: resolvedMetricsLayout,
        cells: tree.cells,
      }),
    [metrics, resolvedMetricsLayout, tree.cells],
  );

  const isRowGrandTotalNode = useCallback(
    (rowNode: PivotTreeNode) =>
      rowNode.path.length === 0 || isMetricGrandTotalNode(rowNode),
    [isMetricGrandTotalNode],
  );

  const databarMetricKeys = useMemo(
    () => Object.keys(metricDatabars),
    [metricDatabars],
  );
  const databarScaleWidth = theme.sizeUnit * 12;
  const databarPaddingX = theme.sizeUnit * 2;
  const scaleLikeTargets = useMemo(() => {
    const targets = new Set<string>();
    databarMetricKeys.forEach(metricKey => {
      const scaleLike = metricDatabars[metricKey]?.scaleLike;
      if (!scaleLike) {
        return;
      }
      const scaleKey = getFormattingMetricKey(scaleLike);
      if (scaleKey) {
        targets.add(scaleKey);
      }
    });
    return targets;
  }, [databarMetricKeys, metricDatabars]);
  const metricsForScale = useMemo(
    () => new Set<string>([...databarMetricKeys, ...scaleLikeTargets]),
    [databarMetricKeys, scaleLikeTargets],
  );
  const isRowTotalAtStart = resolvedColTotalPosition === 'start' && showRowRoot;
  const visibleCells = renderModel.visibleCellEntries;
  const {
    databarScales,
    waterfallOffsets,
    waterfallScales,
    databarLabelSpaces,
    databarColumnMinWidths,
    waterfallBridgeOffsets,
  } = useMemo(() => {
    const emptyScaleMap = new Map<string, DatabarScale>();
    const emptyOffsets = new Map<string, WaterfallOffset>();
    const emptyLabelSpaces = new Map<
      string,
      { positive: number; negative: number }
    >();
    const emptyWidths = new Map<string, number>();
    const emptyBridges = new Map<
      string,
      Array<{ value: number; depth: number; scaleKey: string }>
    >();
    if (metricsForScale.size === 0) {
      return {
        databarScales: emptyScaleMap,
        waterfallOffsets: emptyOffsets,
        waterfallScales: emptyScaleMap,
        databarLabelSpaces: emptyLabelSpaces,
        databarColumnMinWidths: emptyWidths,
        waterfallBridgeOffsets: emptyBridges,
      };
    }

    const scaleMap = new Map<string, DatabarScale>();
    visibleCells.forEach(({ rowNode, colNode, cell }) => {
      if (isRowGrandTotalNode(rowNode)) {
        return;
      }
      const metricKey = deriveMetricKey(rowNode, colNode);
      if (!metricsForScale.has(metricKey)) {
        return;
      }
      const value = getNumericValue(cell.values[metricKey]);
      if (value === undefined) {
        return;
      }
      const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
      const current = scaleMap.get(scaleKey);
      if (!current) {
        scaleMap.set(scaleKey, { min: value, max: value });
      } else {
        current.min = Math.min(current.min, value);
        current.max = Math.max(current.max, value);
      }
    });

    const offsets = new Map<string, WaterfallOffset>();
    const cumulative = new Map<string, number>();
    const prevKeys = new Map<string, string>();
    visibleRows.forEach(rowNode => {
      const isGrandTotalRow = isRowGrandTotalNode(rowNode);
      const shouldReset = isExplicitSubtotalNode(rowNode) && !isGrandTotalRow;
      const isExpandedGroup =
        rowNode.hasChildren && expandedRows.has(rowNode.key);
      if (shouldReset) {
        cumulative.clear();
        prevKeys.clear();
      }
      visibleCols.forEach(colNode => {
        const cellKey = serializeCellKey(rowNode.key, colNode.key);
        const cell = tree.cells[cellKey];
        if (!cell) {
          return;
        }
        const metricKey = deriveMetricKey(rowNode, colNode);
        const config = metricDatabars[metricKey];
        if (!config || config.type !== 'waterfall') {
          return;
        }
        const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
        const value = getNumericValue(cell.values[metricKey]);
        if (value === undefined) {
          return;
        }
        const cumulativeKey = serializeCellKey(colNode.key, metricKey);
        const prevEndValue = cumulative.get(cumulativeKey) ?? 0;
        const start = shouldReset || isGrandTotalRow ? 0 : prevEndValue;
        const isTotalRow =
          isGrandTotalRow ||
          isExplicitSubtotalNode(rowNode) ||
          isMetricSubtotalNode(rowNode);
        const delta = isTotalRow || !isRowTotalAtStart ? value : -value;
        const end = start + delta;
        const prevKey = prevKeys.get(cumulativeKey);
        const connectAbove = !shouldReset && !!prevKey;
        offsets.set(cellKey, {
          start,
          end,
          scaleKey,
          connectAbove,
          connectBelow: false,
          connectAboveValue: connectAbove ? prevEndValue : undefined,
          connectBelowValue: end,
        });
        if (connectAbove && prevKey) {
          const prevOffset = offsets.get(prevKey);
          if (prevOffset) {
            offsets.set(prevKey, { ...prevOffset, connectBelow: true });
          }
        }
        const shouldHoldCumulative =
          isExpandedGroup && !(isGrandTotalRow && isRowTotalAtStart);
        const nextCumulative = shouldReset
          ? 0
          : shouldHoldCumulative
            ? start
            : end;
        cumulative.set(cumulativeKey, nextCumulative);
        if (!shouldReset) {
          prevKeys.set(cumulativeKey, cellKey);
        }
      });
    });

    const waterfallScaleMap = new Map<string, DatabarScale>();
    if (offsets.size === 0) {
      scaleMap.forEach((value, key) => {
        waterfallScaleMap.set(key, value);
      });
    } else {
      offsets.forEach(({ start, end, scaleKey }) => {
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        const current = waterfallScaleMap.get(scaleKey);
        if (!current) {
          waterfallScaleMap.set(scaleKey, { min, max });
        } else {
          current.min = Math.min(current.min, min);
          current.max = Math.max(current.max, max);
        }
      });
    }

    const labelOffset = theme.sizeUnit;
    const labelPadding = theme.sizeUnit * 0.5;
    const labelCharWidth = theme.sizeUnit * 1.6;
    const spaceMap = new Map<string, { positive: number; negative: number }>();
    if (databarMetricKeys.length > 0) {
      const shouldHide = (rowNode: PivotTreeNode) =>
        shouldHideRowValuesBase({
          rowNode,
          rowSubTotals,
          effectiveRowSubtotalPosition: getRowSubtotalPosition(rowNode),
          isMetricTokenValue,
          expandedRows,
          countDimDepth,
          rowSubtotalDepths,
          isExplicitSubtotalNode,
        });
      visibleCells.forEach(({ rowNode, colNode, cell }) => {
        if (shouldHide(rowNode)) {
          return;
        }
        const metricKey = deriveMetricKey(rowNode, colNode);
        const config = metricDatabars[metricKey];
        if (!config?.type) {
          return;
        }
        const rawValue = cell.values[metricKey];
        const value = getNumericValue(rawValue);
        if (value === undefined) {
          return;
        }
        const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
        const scale =
          config.type === 'waterfall'
            ? waterfallScaleMap.get(scaleKey)
            : scaleMap.get(scaleKey);
        if (!scale) {
          return;
        }
        const formattingKeys = formattingKeyMap[metricKey];
        const d3FormatOverride = formattingKeys?.d3Format
          ? normalizeD3Format(cell.values[formattingKeys.d3Format])
          : undefined;
        const formatted = renderValue(metricKey, rawValue, d3FormatOverride);
        const labelText =
          formatted === null || formatted === undefined
            ? ''
            : String(formatted).replace(/<[^>]*>/g, '');
        const labelWidth =
          labelText.length * labelCharWidth + labelOffset + labelPadding * 2;
        const existing = spaceMap.get(scaleKey) ?? { positive: 0, negative: 0 };
        if (value >= 0) {
          existing.positive = Math.max(existing.positive, labelWidth);
        } else {
          existing.negative = Math.max(existing.negative, labelWidth);
        }
        spaceMap.set(scaleKey, existing);
      });
    }

    const widthMap = new Map<string, number>();
    if (databarMetricKeys.length > 0) {
      visibleCells.forEach(({ cell, colNode, rowNode }) => {
        const metricKey = deriveMetricKey(rowNode, colNode);
        const config = metricDatabars[metricKey];
        if (!config?.type) {
          return;
        }
        const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
        const labelSpace = spaceMap.get(scaleKey);
        const minWidth =
          (labelSpace?.positive ?? 0) +
          (labelSpace?.negative ?? 0) +
          databarScaleWidth +
          databarPaddingX * 2;
        const current = widthMap.get(cell.colKey) ?? 0;
        if (minWidth > current) {
          widthMap.set(cell.colKey, minWidth);
        }
      });
    }

    const bridgeMap = new Map<
      string,
      Array<{ value: number; depth: number; scaleKey: string }>
    >();
    if (offsets.size > 0) {
      visibleCols.forEach(colNode => {
        const lastExpandedTotals = new Map<
          number,
          { index: number; value: number; scaleKey: string }
        >();
        visibleRows.forEach((rowNode, rowIndex) => {
          const cellKey = serializeCellKey(rowNode.key, colNode.key);
          const offset = offsets.get(cellKey);
          if (!offset) {
            return;
          }
          const depth = getNodeDimDepth(rowNode);
          const previous = lastExpandedTotals.get(depth);
          if (previous && rowIndex - previous.index > 1) {
            for (let idx = previous.index; idx <= rowIndex; idx += 1) {
              const betweenRow = visibleRows[idx];
              const betweenKey = serializeCellKey(betweenRow.key, colNode.key);
              const betweenOffset = offsets.get(betweenKey);
              const betweenScaleKey =
                betweenOffset?.scaleKey ?? previous.scaleKey;
              if (betweenOffset && betweenScaleKey !== previous.scaleKey) {
                continue;
              }
              const entry = {
                value: previous.value,
                depth,
                scaleKey: betweenScaleKey,
              };
              const existing = bridgeMap.get(betweenKey);
              if (existing) {
                const alreadySet = existing.some(
                  item =>
                    item.value === entry.value && item.depth === entry.depth,
                );
                if (!alreadySet) {
                  existing.push(entry);
                }
              } else {
                bridgeMap.set(betweenKey, [entry]);
              }
            }
          }
          if (rowNode.hasChildren && expandedRows.has(rowNode.key)) {
            lastExpandedTotals.set(depth, {
              index: rowIndex,
              value: offset.end,
              scaleKey: offset.scaleKey,
            });
          } else if (previous) {
            lastExpandedTotals.delete(depth);
          }
        });
      });
    }

    return {
      databarScales: scaleMap,
      waterfallOffsets: offsets,
      waterfallScales: waterfallScaleMap,
      databarLabelSpaces: spaceMap,
      databarColumnMinWidths: widthMap,
      waterfallBridgeOffsets: bridgeMap,
    };
  }, [
    countDimDepth,
    databarMetricKeys,
    databarPaddingX,
    databarScaleWidth,
    deriveMetricKey,
    expandedRows,
    formattingKeyMap,
    getNodeDimDepth,
    getRowSubtotalPosition,
    isExplicitSubtotalNode,
    isMetricSubtotalNode,
    isMetricTokenValue,
    isRowTotalAtStart,
    isRowGrandTotalNode,
    metricDatabars,
    metricsForScale,
    renderValue,
    rowSubTotals,
    rowSubtotalDepths,
    theme.sizeUnit,
    tree.cells,
    visibleCells,
    visibleCols,
    visibleRows,
  ]);

  const shouldHideRowValues = useCallback(
    (rowNode: PivotTreeNode) =>
      shouldHideRowValuesBase({
        rowNode,
        rowSubTotals,
        effectiveRowSubtotalPosition: getRowSubtotalPosition(rowNode),
        isMetricTokenValue,
        expandedRows,
        countDimDepth,
        rowSubtotalDepths,
        isExplicitSubtotalNode,
      }),
    [
      countDimDepth,
      expandedRows,
      getRowSubtotalPosition,
      isExplicitSubtotalNode,
      isMetricTokenValue,
      rowSubtotalDepths,
      rowSubTotals,
    ],
  );

  const renderCellContent = useCallback(
    (
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
      metricKeyOverride?: string,
      d3FormatOverride?: string,
    ) => {
      if (shouldHideRowValues(rowNode)) {
        return '';
      }
      const cell = tree.cells[serializeCellKey(rowNode.key, colNode.key)];
      if (!cell) {
        return '';
      }
      const metricKey = metricKeyOverride || deriveMetricKey(rowNode, colNode);
      const value = renderValue(
        metricKey,
        cell.values[metricKey],
        d3FormatOverride,
      );
      if (allowRenderHtml && typeof value === 'string' && value.includes('<')) {
        return safeHtmlSpan(value);
      }
      return value;
    },
    [
      allowRenderHtml,
      deriveMetricKey,
      renderValue,
      shouldHideRowValues,
      tree.cells,
    ],
  );

  const renderDatabarContent = useCallback(
    (
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
      cell: PivotResultCell | undefined,
      metricKey: string,
      d3FormatOverride?: string,
    ) => {
      const labelNode = cell
        ? renderCellContent(rowNode, colNode, metricKey, d3FormatOverride)
        : '';
      const hasLabel =
        labelNode !== '' && labelNode !== null && labelNode !== undefined;
      const config = metricDatabars[metricKey];
      if (!config?.type) {
        return labelNode;
      }
      const rawValue = cell?.values[metricKey];
      const value = getNumericValue(rawValue);
      const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
      const scale =
        config.type === 'waterfall'
          ? waterfallScales.get(scaleKey)
          : databarScales.get(scaleKey);
      if (!scale) {
        return labelNode;
      }
      const scaleBounds = resolveScaleBounds(scale);
      const baselinePct = scaleBounds.zeroPct;
      const baselineColor =
        theme.colorTextTertiary || theme.colorBorder || theme.colorText;
      const baselineWidth = Math.max(2, theme.sizeUnit * 0.5);
      const connectorWidth = Math.max(1, Math.round(baselineWidth / 2));
      const barHeightPct = 85;
      const barGapPct = (100 - barHeightPct) / 2;
      const barTopPct = barGapPct;
      const barBottomPct = barGapPct + barHeightPct;
      const barHeight = `${barHeightPct}%`;
      const lineHeight = 2;
      const labelOffset = theme.sizeUnit;
      const labelSpace = databarLabelSpaces.get(scaleKey);
      const contentStyle = {
        paddingLeft: `${databarPaddingX + (labelSpace?.negative ?? 0)}px`,
        paddingRight: `${databarPaddingX + (labelSpace?.positive ?? 0)}px`,
      };

      const offsetKey = serializeCellKey(rowNode.key, colNode.key);
      const waterfallOffset = waterfallOffsets.get(offsetKey);
      const connectorAboveValue =
        config.type === 'waterfall'
          ? waterfallOffset?.connectAboveValue
          : undefined;
      const connectorBelowValue =
        config.type === 'waterfall'
          ? waterfallOffset?.connectBelowValue
          : undefined;
      const connectorAbovePct =
        connectorAboveValue === undefined
          ? undefined
          : toPercent(connectorAboveValue, scale);
      const connectorBelowPct =
        connectorBelowValue === undefined
          ? undefined
          : toPercent(connectorBelowValue, scale);
      const renderConnector =
        config.type === 'waterfall' && value !== undefined;
      const connectorTopStyle =
        connectorAbovePct === undefined
          ? undefined
          : {
              left: `${connectorAbovePct * 100}%`,
              top: '0%',
              bottom: `${100 - barBottomPct}%`,
            };
      const connectorBottomStyle =
        connectorBelowPct === undefined
          ? undefined
          : {
              left: `${connectorBelowPct * 100}%`,
              top: `${barTopPct}%`,
              bottom: '0%',
            };
      const bridgeEntries =
        config.type === 'waterfall'
          ? waterfallBridgeOffsets.get(offsetKey)
          : undefined;
      const bridgeRenderables =
        bridgeEntries
          ?.filter(entry => entry.scaleKey === scaleKey)
          .map(entry => {
            const pct = toPercent(entry.value, scale);
            const color = applyAlphaToColor(
              baselineColor,
              resolveConnectorAlpha(entry.depth),
            );
            return {
              key: `${entry.scaleKey}-${entry.value}-${entry.depth}`,
              color,
              style: {
                left: `${pct * 100}%`,
                top: '0%',
                bottom: '0%',
              },
            };
          }) ?? [];

      let barStart = baselinePct;
      let barEnd = baselinePct;
      let barWidthPct = 0;
      let barColor = baselineColor;
      let labelStyle: React.CSSProperties | undefined;
      let isPositive = false;
      if (value !== undefined) {
        let startPct = baselinePct;
        let endPct = toPercent(value, scale);
        if (config.type === 'waterfall') {
          const startValue = waterfallOffset?.start ?? 0;
          const endValue = waterfallOffset?.end ?? value;
          startPct = toPercent(startValue, scale);
          endPct = toPercent(endValue, scale);
        }
        barStart = Math.min(startPct, endPct);
        barEnd = Math.max(startPct, endPct);
        barWidthPct = Math.max(barEnd - barStart, 0);
        const colorMetricKey =
          config.colorMode === 'byMetric' && config.colorMetric
            ? getFormattingMetricKey(config.colorMetric)
            : undefined;
        const metricColor =
          cell && colorMetricKey
            ? normalizeCssColor(cell.values[colorMetricKey])
            : undefined;
        isPositive = value >= 0;
        const defaultPositiveColor =
          theme.colorSuccess ||
          (theme as { colors?: { success?: { base?: string } } }).colors
            ?.success?.base ||
          supersetTheme.colorSuccess ||
          DEFAULT_DATABAR_POSITIVE_COLOR;
        const defaultNegativeColor =
          theme.colorError ||
          (theme as { colors?: { error?: { base?: string } } }).colors?.error
            ?.base ||
          supersetTheme.colorError ||
          DEFAULT_DATABAR_NEGATIVE_COLOR;
        const positiveColor = config.positiveColor ?? defaultPositiveColor;
        const negativeColor = config.negativeColor ?? defaultNegativeColor;
        barColor = metricColor || (isPositive ? positiveColor : negativeColor);
        labelStyle = isPositive
          ? {
              left: `calc(${Math.min(barEnd, 1) * 100}% + ${labelOffset}px)`,
              top: '50%',
              transform: 'translateY(-50%)',
            }
          : {
              left: `calc(${Math.max(barStart, 0) * 100}% - ${labelOffset}px)`,
              top: '50%',
              transform: 'translate(-100%, -50%)',
            };
      }

      return (
        <>
          <DatabarContent data-test="pivot-databar" style={contentStyle}>
            <DatabarScale
              data-test="pivot-databar-scale"
              style={{ maxWidth: `${databarScaleWidth}px`, width: '100%' }}
            >
              <DatabarBaseline
                $color={baselineColor}
                style={{ left: `${baselinePct * 100}%` }}
              />
              {bridgeRenderables.map(bridge => (
                <DatabarDottedConnector
                  key={bridge.key}
                  $color={bridge.color}
                  $width={connectorWidth}
                  style={bridge.style}
                />
              ))}
              {renderConnector &&
                waterfallOffset?.connectAbove &&
                connectorTopStyle && (
                  <DatabarConnector
                    $color={baselineColor}
                    $width={connectorWidth}
                    style={connectorTopStyle}
                  />
                )}
              {renderConnector &&
                waterfallOffset?.connectBelow &&
                connectorBottomStyle && (
                  <DatabarConnector
                    $color={baselineColor}
                    $width={connectorWidth}
                    style={connectorBottomStyle}
                  />
                )}
              {value !== undefined ? (
                config.type === 'lollipop' ? (
                  <>
                    <DatabarLine
                      $color={barColor}
                      style={{
                        left: `${barStart * 100}%`,
                        width: `${barWidthPct * 100}%`,
                        top: `calc(50% - ${lineHeight / 2}px)`,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: `${(isPositive ? barEnd : barStart) * 100}%`,
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      <DatabarDot $color={barColor} />
                    </div>
                  </>
                ) : (
                  <DatabarRect
                    $color={barColor}
                    $height={barHeight}
                    data-test="pivot-databar-bar"
                    style={{
                      left: `${barStart * 100}%`,
                      width: `${barWidthPct * 100}%`,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  />
                )
              ) : null}
              {value !== undefined && hasLabel && labelStyle ? (
                <DatabarLabel style={labelStyle}>{labelNode}</DatabarLabel>
              ) : null}
            </DatabarScale>
          </DatabarContent>
          <DatabarSpacer aria-hidden="true" />
        </>
      );
    },
    [
      databarLabelSpaces,
      databarPaddingX,
      databarScales,
      databarScaleWidth,
      metricDatabars,
      renderCellContent,
      theme,
      waterfallBridgeOffsets,
      waterfallOffsets,
      waterfallScales,
    ],
  );

  const formatLabel = useCallback(
    (node: PivotTreeNode, axis: 'row' | 'col') =>
      formatNodeLabelBase({
        node,
        axis,
        metricsLayout: resolvedMetricsLayout,
        metricIndexOnRows,
        isMetricGrandTotalNode,
        getMetricLabelFromPath,
        translate: t,
        subtotalLabel: SUBTOTAL_LABEL,
        isSubtotalToken,
      }),
    [
      getMetricLabelFromPath,
      isMetricGrandTotalNode,
      metricIndexOnRows,
      resolvedMetricsLayout,
    ],
  );
  return (
    <PivotTableView
      height={height}
      width={width}
      renderModel={renderModelWithHeaders}
      tree={tree}
      expandedRows={expandedRows}
      expandedCols={expandedCols}
      errorMessage={errorMessage}
      showGlobalLoader={showGlobalLoader}
      stickyHeaders={resolvedStickyHeaders}
      headerOffset={headerOffset}
      headerRowOffsets={headerRowOffsets}
      headerRef={headerRef}
      themeColor={themeColor}
      rowTotalPosition={resolvedColTotalPosition}
      metricFormattingScope={metricFormattingScope}
      metricDatabars={metricDatabars}
      formattingKeyMap={formattingKeyMap}
      databarColumnMinWidths={databarColumnMinWidths}
      onToggleNode={handleToggle}
      shouldShowToggle={shouldShowToggle}
      showRowSpinner={showRowSpinner}
      showColSpinner={showColSpinner}
      formatLabel={formatLabel}
      isRowAggregateBold={isRowAggregateBold}
      isColAggregateBold={isColAggregateBold}
      getNodeDimDepth={getNodeDimDepth}
      getTotalBackground={getTotalBackground}
      resolveDimensionStyle={resolveDimensionStyle}
      deriveMetricKey={deriveMetricKey}
      isMetricGrandTotalNode={isMetricGrandTotalNode}
      isMetricSubtotalNode={isMetricSubtotalNode}
      renderCellContent={renderCellContent}
      renderDatabarContent={renderDatabarContent}
      emitCrossFilters={emitCrossFilters}
      handleCellClick={handleCellClick}
      handleCellKeyDown={handleCellKeyDown}
      handleCellContextMenu={handleCellContextMenu}
    />
  );
}

export default PivotTableChart;
