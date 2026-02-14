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
  type CSSProperties,
  type ReactNode,
  useCallback,
  useMemo,
} from 'react';
import {
  DataRecordValue,
  Currency,
  addAlpha,
  getNumberFormatter,
  NumberFormats,
  safeHtmlSpan,
  styled,
  supersetTheme,
  t,
} from '@superset-ui/core';
import {
  type DimensionFormattingField,
  type DimensionFormattingScope,
  DIMENSION_FORMATTING_FIELDS,
  type MetricFormattingField,
  type MetricFormattingScope,
  METRIC_FORMATTING_FIELDS,
  type PivotDimensionFormattingMap,
  type PivotMetricDatabarMap,
  type PivotMetricFormattingMap,
  type PivotResultCell,
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  SUBTOTAL_LABEL,
  collectDimensionFormattingMetricsForQuery,
  collectDimensionSortingMetricsForQuery,
  collectMetricDatabarMetricsForQuery,
  collectMetricFormattingMetricsForQuery,
  DEFAULT_DATABAR_NEGATIVE_COLOR,
  DEFAULT_DATABAR_POSITIVE_COLOR,
  getFormattingMetricKey,
  getMetricKey,
  getMetricKeys,
  isSubtotalToken,
  mergeMetrics,
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  normalizeMetricDatabarMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  parseThemeColors,
  PIVOT_THEME_PRESETS,
  serializeCellKey,
  serializePath,
} from '../../utils';
import { formatMetricValue, rootKey } from '../viewModel';
import { buildMeasureLeafOutputKey, isValueLeaf } from '../measureLeaves';
import {
  deriveMetricKey as deriveMetricKeyBase,
  formatNodeLabel as formatNodeLabelBase,
  shouldHideRowValues as shouldHideRowValuesBase,
} from '../cellUtils';
import { type FormattingKeys, type RenderModel } from '../shared/types';
import { type PivotLayoutResult } from './usePivotLayout';
import {
  compileExcelFormula,
  type CompiledExcelFormula,
} from '../formatting/excelFormula';
import { isPivotExcelFormula } from '../formatting/excelFormulaReferences';

const { PERCENT, INTEGER } = NumberFormats;

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

type DatabarScaleBounds = {
  boundedMin: number;
  boundedMax: number;
  span: number;
  zeroPct: number;
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

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const resolveScaleBounds = (scale: DatabarScale): DatabarScaleBounds => {
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

export type PivotFormattingResult = {
  metricFormattingScope: MetricFormattingScope;
  metricDatabars: PivotMetricDatabarMap;
  formattingKeyMap: Record<string, FormattingKeys>;
  evaluateExcelMetricFormatting: (
    metricKey: string,
    field: MetricFormattingField,
    values: Record<string, DataRecordValue | undefined>,
    currentValue: DataRecordValue | undefined,
  ) => unknown;
  databarColumnMinWidths: Map<string, number>;
  themeColor?: string;
  treeDataSignature: string;
  resolveDimensionStyle: (
    axis: 'row' | 'col',
    node: PivotTreeNode,
    target: 'label' | 'cell',
  ) => CSSProperties | undefined;
  deriveMetricKey: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => string;
  renderCellContent: (
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
    metricKeyOverride?: string,
    d3FormatOverride?: string,
  ) => ReactNode;
  renderDatabarContent: (
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
    cell: PivotResultCell | undefined,
    metricKey: string,
    d3FormatOverride?: string,
  ) => ReactNode;
  formatLabel: (node: PivotTreeNode, axis: 'row' | 'col') => string;
  getTotalBackground: (row?: PivotTreeNode) => string | undefined;
};

const buildFormattingKeyMap = (metricFormatting: PivotMetricFormattingMap) => {
  const next: Record<string, FormattingKeys> = {};
  Object.entries(metricFormatting).forEach(([metricKey, formatting]) => {
    if (!metricKey) {
      return;
    }
    const formattingKeys = METRIC_FORMATTING_FIELDS.reduce((acc, field) => {
      const formattingMetric = formatting?.[field];
      const key = formattingMetric
        ? isPivotExcelFormula(formattingMetric)
          ? ''
          : getFormattingMetricKey(formattingMetric)
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
};

const buildDimensionFormattingKeyMap = (
  formatting: PivotDimensionFormattingMap,
): Record<string, DimensionFormattingKeys> => {
  const next: Record<string, DimensionFormattingKeys> = {};
  Object.entries(formatting).forEach(([dimensionKey, dimensionFormatting]) => {
    if (!dimensionKey) {
      return;
    }
    const formattingKeys = DIMENSION_FORMATTING_FIELDS.reduce(
      (acc, field) => {
        const formattingMetric = dimensionFormatting?.[field];
        if (!formattingMetric || isPivotExcelFormula(formattingMetric)) {
          return acc;
        }
        const key = getFormattingMetricKey(formattingMetric);
        if (key) {
          acc[field] = key;
        }
        return acc;
      },
      {} as Omit<DimensionFormattingKeys, 'applyTo'>,
    );
    const hasExcelFormula = DIMENSION_FORMATTING_FIELDS.some(field => {
      const value = dimensionFormatting?.[field];
      return Boolean(value && isPivotExcelFormula(value));
    });
    if (Object.keys(formattingKeys).length > 0 || hasExcelFormula) {
      next[dimensionKey] = {
        ...formattingKeys,
        applyTo: dimensionFormatting.applyTo ?? 'all',
      };
    }
  });
  return next;
};

const buildDimensionExcelFormattingMap = (
  formatting: PivotDimensionFormattingMap,
): Record<
  string,
  Partial<Record<DimensionFormattingField, CompiledExcelFormula>>
> => {
  const next: Record<
    string,
    Partial<Record<DimensionFormattingField, CompiledExcelFormula>>
  > = {};
  Object.entries(formatting).forEach(([dimensionKey, dimensionFormatting]) => {
    if (!dimensionKey) {
      return;
    }
    const compiled: Partial<
      Record<DimensionFormattingField, CompiledExcelFormula>
    > = {};
    DIMENSION_FORMATTING_FIELDS.forEach(field => {
      const value = dimensionFormatting?.[field];
      if (value && isPivotExcelFormula(value)) {
        compiled[field] = compileExcelFormula(value.formula);
      }
    });
    if (Object.keys(compiled).length > 0) {
      next[dimensionKey] = compiled;
    }
  });
  return next;
};

export const usePivotFormatting = ({
  tree,
  renderModel,
  expandedRows,
  formData,
  groupbyRows,
  groupbyColumns,
  metrics,
  layout,
  rowValuesMap,
  colValuesMap,
  getNodeDimDepth,
  rowSubTotals,
  valueFormat,
  columnFormats,
  currencyFormats,
  allowRenderHtml,
  pivotTheme,
  pivotThemeColors,
  theme,
}: {
  tree: PivotTreeData;
  renderModel: RenderModel;
  expandedRows: Set<string>;
  formData: PivotTableProps['formData'];
  groupbyRows: PivotTableProps['groupbyRows'];
  groupbyColumns: PivotTableProps['groupbyColumns'];
  metrics: PivotTableProps['metrics'];
  layout: PivotLayoutResult;
  rowValuesMap: Map<string, Record<string, DataRecordValue>>;
  colValuesMap: Map<string, Record<string, DataRecordValue>>;
  getNodeDimDepth: (node: PivotTreeNode) => number;
  rowSubTotals: boolean;
  valueFormat?: PivotTableProps['valueFormat'];
  columnFormats: PivotTableProps['columnFormats'];
  currencyFormats: PivotTableProps['currencyFormats'];
  allowRenderHtml?: boolean;
  pivotTheme: PivotTableProps['pivotTheme'];
  pivotThemeColors: PivotTableProps['pivotThemeColors'];
  theme: PivotTableProps['theme'];
}): PivotFormattingResult => {
  const metricFormattingScope =
    (formData.metricFormattingScope as MetricFormattingScope) ||
    'values_totals';

  const metricFormatting = useMemo(
    () =>
      normalizeMetricFormattingMapWithKeys(formData.metricFormatting, metrics),
    [formData.metricFormatting, metrics],
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

  const derivedFormatOverrides = useMemo(() => {
    if (layout.measureHierarchy.kind !== 'measureStackV1') {
      return { columnOverrides: {}, currencyOverrides: {} };
    }
    const columnOverrides: Record<string, string> = {};
    const currencyOverrides: Record<string, Currency> = {};
    layout.measureHierarchy.groups.forEach(group => {
      group.leaves.forEach(leaf => {
        if (isValueLeaf(leaf)) {
          return;
        }
        const outputKey = buildMeasureLeafOutputKey(group.metricKey, leaf);
        const customMetricKey =
          leaf.kind === 'custom' ? getMetricKey(leaf.metric) : undefined;
        const formatMetricKey =
          leaf.kind === 'custom' ? customMetricKey : group.metricKey;
        const leafFormat = columnFormats?.[formatMetricKey];
        const leafCurrency = currencyFormats?.[formatMetricKey];
        if (leaf.kind === 'builtIn' && leaf.operator === 'delta_pct') {
          columnOverrides[outputKey] = PERCENT;
          return;
        }
        if (leaf.kind === 'builtIn' && leaf.operator === 'ix') {
          columnOverrides[outputKey] = INTEGER;
          return;
        }
        if (leafFormat) {
          columnOverrides[outputKey] = leafFormat;
        }
        if (leafCurrency) {
          currencyOverrides[outputKey] = leafCurrency;
        }
      });
    });
    return { columnOverrides, currencyOverrides };
  }, [columnFormats, currencyFormats, layout.measureHierarchy]);

  const effectiveColumnFormats = useMemo(
    () => ({ ...derivedFormatOverrides.columnOverrides, ...columnFormats }),
    [columnFormats, derivedFormatOverrides.columnOverrides],
  );
  const effectiveCurrencyFormats = useMemo(
    () => ({ ...derivedFormatOverrides.currencyOverrides, ...currencyFormats }),
    [currencyFormats, derivedFormatOverrides.currencyOverrides],
  );

  const formattingKeyMap = useMemo(
    () => buildFormattingKeyMap(metricFormatting),
    [metricFormatting],
  );

  const excelMetricFormattingMap = useMemo(() => {
    const next: Record<
      string,
      Partial<Record<MetricFormattingField, CompiledExcelFormula>>
    > = {};
    Object.entries(metricFormatting).forEach(([metricKey, formatting]) => {
      const compiled: Partial<
        Record<MetricFormattingField, CompiledExcelFormula>
      > = {};
      METRIC_FORMATTING_FIELDS.forEach(field => {
        const value = formatting[field];
        if (value && isPivotExcelFormula(value)) {
          compiled[field] = compileExcelFormula(value.formula);
        }
      });
      if (Object.keys(compiled).length > 0) {
        next[metricKey] = compiled;
      }
    });
    return next;
  }, [metricFormatting]);

  const evaluateExcelMetricFormatting = useCallback(
    (
      metricKey: string,
      field: MetricFormattingField,
      values: Record<string, DataRecordValue | undefined>,
      currentValue: DataRecordValue | undefined,
    ) => {
      const compiled = excelMetricFormattingMap[metricKey]?.[field];
      if (!compiled) {
        return undefined;
      }
      return compiled.evaluate(values, currentValue);
    },
    [excelMetricFormattingMap],
  );

  const rowFormattingKeyMap = useMemo(
    () => buildDimensionFormattingKeyMap(rowFormatting),
    [rowFormatting],
  );
  const colFormattingKeyMap = useMemo(
    () => buildDimensionFormattingKeyMap(colFormatting),
    [colFormatting],
  );
  const rowExcelFormattingMap = useMemo(
    () => buildDimensionExcelFormattingMap(rowFormatting),
    [rowFormatting],
  );
  const colExcelFormattingMap = useMemo(
    () => buildDimensionExcelFormattingMap(colFormatting),
    [colFormatting],
  );

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

  const treeDataSignature = useMemo(() => {
    if (formData.treeDataSignature) {
      return formData.treeDataSignature;
    }
    return JSON.stringify({
      rows: layout.groupbyRowKeys,
      cols: layout.groupbyColumnKeys,
      metrics: getMetricKeys(metricsForQueryWithFormatting),
      metricsLayout: layout.resolvedMetricsLayout,
      metricInsertIndex: layout.metricInsertIndex,
      rowSubtotalLevels: layout.normalizedRowSubtotalLevels,
      colSubtotalLevels: layout.layout.colSubtotalLevelsForQuery,
      measureHierarchy: layout.measureHierarchy,
    });
  }, [
    formData.treeDataSignature,
    layout.groupbyColumnKeys,
    layout.groupbyRowKeys,
    layout.layout.colSubtotalLevelsForQuery,
    layout.measureHierarchy,
    layout.metricInsertIndex,
    layout.normalizedRowSubtotalLevels,
    layout.resolvedMetricsLayout,
    metricsForQueryWithFormatting,
  ]);

  const resolveDimensionStyle = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode, target: 'label' | 'cell') => {
      if (node.path.length === 0 || layout.isMetricGrandTotalNode(node)) {
        return undefined;
      }
      const dimensionKey = layout.getDimensionKeyForNode(node, axis);
      const formattingMap =
        axis === 'row' ? rowFormattingKeyMap : colFormattingKeyMap;
      const excelFormattingMap =
        axis === 'row' ? rowExcelFormattingMap : colExcelFormattingMap;
      const formatting = dimensionKey ? formattingMap[dimensionKey] : undefined;
      const excelFormatting = dimensionKey
        ? excelFormattingMap[dimensionKey]
        : undefined;
      if (!formatting) {
        if (!excelFormatting) {
          return undefined;
        }
      }
      const applyTo = formatting?.applyTo ?? 'all';
      if (target === 'cell' && applyTo !== 'all') {
        return undefined;
      }
      const nonMetricParts = layout.getNonMetricPathParts(node.path);
      const nonSubtotalParts = nonMetricParts.filter(
        part => !isSubtotalToken(part),
      );
      const nonMetricKey = serializePath(nonMetricParts);
      const dimensionValue =
        nonSubtotalParts.length > 0
          ? nonSubtotalParts[nonSubtotalParts.length - 1]
          : (node.path[node.path.length - 1] ?? node.label ?? undefined);
      const values =
        axis === 'row'
          ? rowValuesMap.get(nonMetricKey)
          : colValuesMap.get(nonMetricKey);
      const resolveExcelValue = (formula: CompiledExcelFormula | undefined) => {
        if (!formula) {
          return undefined;
        }
        if (!values && formula.metricReferences.length > 0) {
          return undefined;
        }
        const resolvedValues = values ?? {};
        const result = formula.evaluate(resolvedValues, dimensionValue);
        return typeof result === 'string'
          ? normalizeCssColor(result)
          : undefined;
      };
      const backgroundColor =
        resolveExcelValue(excelFormatting?.backgroundColor) ??
        (formatting?.backgroundColor && values
          ? normalizeCssColor(values[formatting.backgroundColor])
          : undefined);
      const textColor =
        resolveExcelValue(excelFormatting?.textColor) ??
        (formatting?.textColor && values
          ? normalizeCssColor(values[formatting.textColor])
          : undefined);
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
      colExcelFormattingMap,
      colValuesMap,
      layout,
      rowFormattingKeyMap,
      rowExcelFormattingMap,
      rowValuesMap,
    ],
  );

  const numberFormatter = useMemo(
    () => getNumberFormatter(valueFormat),
    [valueFormat],
  );
  const renderValue = useCallback(
    (metric: string, value: DataRecordValue, d3FormatOverride?: string) =>
      formatMetricValue(
        metric,
        value,
        effectiveColumnFormats,
        effectiveCurrencyFormats,
        val => numberFormatter(val as number),
        d3FormatOverride,
      ),
    [effectiveColumnFormats, effectiveCurrencyFormats, numberFormatter],
  );

  const deriveMetricKey = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) =>
      deriveMetricKeyBase({
        rowNode,
        colNode,
        metrics,
        metricsLayout: layout.resolvedMetricsLayout,
        cells: tree.cells,
        measureHierarchy: layout.measureHierarchy,
      }),
    [
      layout.measureHierarchy,
      layout.resolvedMetricsLayout,
      metrics,
      tree.cells,
    ],
  );

  const themeColor = useMemo(() => {
    if (pivotTheme === 'custom') {
      return parseThemeColors(pivotThemeColors)[0];
    }
    return PIVOT_THEME_PRESETS[pivotTheme ?? 'none'];
  }, [pivotTheme, pivotThemeColors]);

  const getTotalBackground = useCallback(
    (row?: PivotTreeNode) => {
      if (!themeColor) {
        return undefined;
      }
      const isRowTotal = row?.key === rootKey && renderModel.showRowRoot;
      return isRowTotal ? themeColor : undefined;
    },
    [renderModel.showRowRoot, themeColor],
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

  const isRowGrandTotalNode = useCallback(
    (rowNode: PivotTreeNode) =>
      rowNode.path.length === 0 || layout.isMetricGrandTotalNode(rowNode),
    [layout],
  );

  const isRowTotalAtStart =
    layout.resolvedColTotalPosition === 'start' && renderModel.showRowRoot;
  const visibleCells = renderModel.visibleCellEntries;
  const { visibleRows, visibleCols } = renderModel;

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
      const shouldReset =
        layout.isExplicitSubtotalNode(rowNode) && !isGrandTotalRow;
      const isExpandedGroup =
        rowNode.hasChildren && expandedRows.has(rowNode.key);
      if (shouldReset) {
        cumulative.clear();
        prevKeys.clear();
      }
      visibleCols.forEach(colNode => {
        const cellKey = serializeCellKey(rowNode.key, colNode.key);
        const metricKey = deriveMetricKey(rowNode, colNode);
        if (!metricKey) {
          return;
        }
        const config = metricDatabars[metricKey];
        if (!config || config.type !== 'waterfall') {
          return;
        }
        const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
        const cell = tree.cells[cellKey];
        const value = getNumericValue(cell?.values[metricKey]);
        const deltaValue = value ?? 0;
        const cumulativeKey = serializeCellKey(colNode.key, metricKey);
        const prevEndValue = cumulative.get(cumulativeKey) ?? 0;
        const start = shouldReset || isGrandTotalRow ? 0 : prevEndValue;
        const isTotalRow =
          isGrandTotalRow ||
          layout.isExplicitSubtotalNode(rowNode) ||
          layout.isMetricSubtotalNode(rowNode);
        const delta =
          isTotalRow || !isRowTotalAtStart ? deltaValue : -deltaValue;
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
          effectiveRowSubtotalPosition: layout.getRowSubtotalPosition(rowNode),
          isMetricTokenValue: layout.isMetricTokenValue,
          expandedRows,
          countDimDepth: layout.countDimDepth,
          rowSubtotalDepths: layout.rowSubtotalDepths,
          isExplicitSubtotalNode: layout.isExplicitSubtotalNode,
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
        const d3FormatKey = formattingKeys?.d3Format;
        const excelFormatResult = evaluateExcelMetricFormatting(
          metricKey,
          'd3Format',
          cell.values,
          rawValue,
        );
        const excelOverride =
          typeof excelFormatResult === 'string'
            ? normalizeD3Format(excelFormatResult)
            : undefined;
        const d3FormatOverride =
          excelOverride ??
          (d3FormatKey
            ? normalizeD3Format(cell.values[d3FormatKey])
            : undefined);
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
    databarMetricKeys,
    databarPaddingX,
    databarScaleWidth,
    deriveMetricKey,
    evaluateExcelMetricFormatting,
    expandedRows,
    formattingKeyMap,
    getNodeDimDepth,
    isRowGrandTotalNode,
    isRowTotalAtStart,
    layout,
    metricDatabars,
    metricsForScale,
    renderValue,
    rowSubTotals,
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
        effectiveRowSubtotalPosition: layout.getRowSubtotalPosition(rowNode),
        isMetricTokenValue: layout.isMetricTokenValue,
        expandedRows,
        countDimDepth: layout.countDimDepth,
        rowSubtotalDepths: layout.rowSubtotalDepths,
        isExplicitSubtotalNode: layout.isExplicitSubtotalNode,
      }),
    [expandedRows, layout, rowSubTotals],
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
      const renderConnector = config.type === 'waterfall' && !!waterfallOffset;
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
      let labelStyle: CSSProperties | undefined;
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
        metricsLayout: layout.resolvedMetricsLayout,
        metricIndexOnRows: layout.metricIndexOnRows,
        isMetricGrandTotalNode: layout.isMetricGrandTotalNode,
        getMetricKeyFromPath: layout.getMetricLabelFromPath,
        getMetricDisplayLabelForKey: layout.getMetricDisplayLabelForKey,
        translate: t,
        subtotalLabel: SUBTOTAL_LABEL,
        isSubtotalToken,
      }),
    [layout],
  );

  return {
    metricFormattingScope,
    metricDatabars,
    formattingKeyMap,
    evaluateExcelMetricFormatting,
    databarColumnMinWidths,
    themeColor,
    treeDataSignature,
    resolveDimensionStyle,
    deriveMetricKey,
    renderCellContent,
    renderDatabarContent,
    formatLabel,
    getTotalBackground,
  };
};
