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
  getColumnLabel,
  getMetricLabel,
  Metric,
  QueryFormColumn,
  QueryFormMetric,
  ensureIsArray,
  supersetTheme,
} from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  METRIC_FORMATTING_FIELDS,
  DIMENSION_FORMATTING_FIELDS,
  DimensionFormattingScope,
  PivotDimensionFormatting,
  PivotDimensionFormattingMap,
  PivotDimensionSorting,
  PivotDimensionSortingMap,
  PivotAxisValueRef,
  PivotMetricFormattingMap,
  PivotMetricFormatting,
  PivotMetricDatabarMap,
  PivotMetricDatabar,
  PivotSortMode,
  PivotSortOrder,
  PivotPath,
  PivotMetricFormattingValue,
  PivotDimensionFormattingValue,
  MeasureHierarchy,
} from './types';
import { formatQueryName } from './pivot/query/queryName';
import {
  extractMetricReferencesFromExcelFormula,
  isPivotExcelFormula,
  normalizePivotExcelFormula,
} from './pivot/formatting/excelFormulaReferences';
import {
  getFormattingMetricKey,
  getMetricKey,
  getMetricKeys,
  encodeMeasureLeafKey,
  decodeMeasureLeafId,
  isMeasureLeafToken,
  isMetricsPlaceholder,
  METRICS_PLACEHOLDER,
  normalizePlaceholder,
} from './pivot/core/tokens';

export {
  CELL_KEY_DIVIDER,
  parseCellKey,
  parsePath,
  PATH_DIVIDER,
  serializeCellKey,
  serializePath,
} from './pivot/core/path';
export {
  decodeMetricKey,
  encodeMetricKey,
  encodeMeasureLeafKey,
  decodeMeasureLeafId,
  getFormattingMetricKey,
  getMetricKey,
  getMetricKeys,
  isMetricToken,
  isMeasureLeafToken,
  isMetricsPlaceholder,
  isSubtotalToken,
  METRICS_PLACEHOLDER,
  METRICS_PLACEHOLDER_LABEL,
  METRIC_TOKEN_PREFIX,
  normalizePlaceholder,
  stripMetricsPlaceholder,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from './pivot/core/tokens';
export {
  applyMeasureHierarchyAxis,
  applyMetricAxis,
  buildTreeFromRecords,
  formatPivotLabelValue,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  mergeTrees,
} from './pivot/core/tree';
export const PIVOT_THEME_PRESETS: Record<string, string> = {
  blue: supersetTheme.colorPrimaryBg,
  peach: supersetTheme.colorWarningBg,
  grey: supersetTheme.colorFillSecondary,
};
export const DEFAULT_DATABAR_POSITIVE_COLOR = supersetTheme.colorSuccess;
export const DEFAULT_DATABAR_NEGATIVE_COLOR = supersetTheme.colorError;

const normalizeThemeHexColor = (value: string) => {
  if (!/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return null;
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

const parseThemeRgbChannel = (value: string) => {
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 255) {
    return null;
  }
  return numeric;
};

const parseThemeAlphaChannel = (value: string) => {
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return null;
  }
  return numeric;
};

const splitThemeColors = (value: string) => {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
};

const normalizeThemeColor = (rawValue: string) => {
  const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
  if (!value) {
    return null;
  }
  const hex = normalizeThemeHexColor(value);
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
        return null;
      }
      return value;
    }
    if (/^[a-zA-Z]+$/.test(value)) {
      return value;
    }
    return null;
  }
  const parts = rgbMatch[1]
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  const isRgba = value.toLowerCase().startsWith('rgba');
  if ((isRgba && parts.length !== 4) || (!isRgba && parts.length !== 3)) {
    return null;
  }
  const [r, g, b] = parts.slice(0, 3).map(parseThemeRgbChannel);
  if (r === null || g === null || b === null) {
    return null;
  }
  if (isRgba) {
    const alpha = parseThemeAlphaChannel(parts[3]);
    if (alpha === null) {
      return null;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
};

export const parseThemeColors = (value?: string) =>
  splitThemeColors(value || '')
    .map(color => normalizeThemeColor(color))
    .filter((color): color is string => !!color);

export const getStableColumnKey = (column: QueryFormColumn) =>
  typeof column === 'string'
    ? column
    : column.sqlExpression || column.label || '';

type MetricSelectValue = {
  value: string | number;
  label?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isMetricSelectValue = (value: unknown): value is MetricSelectValue =>
  isRecord(value) &&
  'value' in value &&
  (typeof value.value === 'string' || typeof value.value === 'number');

const coerceExpressionType = (
  value: Record<string, unknown>,
): QueryFormMetric | undefined => {
  const { expressionType } = value;
  if (typeof expressionType === 'string' && expressionType.length > 0) {
    return value as unknown as QueryFormMetric;
  }
  const { sqlExpression } = value;
  if (typeof sqlExpression === 'string' && sqlExpression.trim().length > 0) {
    return { ...value, expressionType: 'SQL' } as unknown as QueryFormMetric;
  }
  const { aggregate } = value;
  const { column } = value;
  if (
    typeof aggregate === 'string' &&
    aggregate.length > 0 &&
    isRecord(column)
  ) {
    return { ...value, expressionType: 'SIMPLE' } as unknown as QueryFormMetric;
  }
  return undefined;
};

export const normalizeMetricFormattingValue = (
  value: unknown,
): QueryFormMetric | undefined => {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : undefined;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeMetricFormattingValue(entry);
      if (normalized !== undefined) {
        return normalized;
      }
    }
    return undefined;
  }
  if (isRecord(value)) {
    if ('value' in value) {
      const nested = normalizeMetricFormattingValue(value.value);
      if (nested !== undefined) {
        return nested;
      }
    }
    if ('metric' in value) {
      const nested = normalizeMetricFormattingValue(value.metric);
      if (nested !== undefined) {
        return nested;
      }
    }
    const inferred = coerceExpressionType(value);
    if (inferred !== undefined) {
      return inferred;
    }
    if (isMetricSelectValue(value)) {
      const nextValue = String(value.value);
      return nextValue.length > 0 ? nextValue : undefined;
    }
    const { key } = value;
    if (typeof key === 'string' && key.trim().length > 0) {
      return key;
    }
    if (typeof key === 'number') {
      return String(key);
    }
    const { name } = value;
    if (typeof name === 'string' && name.trim().length > 0) {
      return name;
    }
    const metricName = value.metric_name;
    if (typeof metricName === 'string' && metricName.trim().length > 0) {
      return metricName;
    }
    const { expressionType } = value;
    if (typeof expressionType === 'string') {
      return value as unknown as QueryFormMetric;
    }
    const { label } = value;
    if (typeof label === 'string' && label.trim().length > 0) {
      return label;
    }
    const { title } = value;
    if (typeof title === 'string' && title.trim().length > 0) {
      return title;
    }
  }
  return undefined;
};

const normalizePivotMetricFormattingValue = (
  value: unknown,
): PivotMetricFormattingValue | undefined => {
  const excel = normalizePivotExcelFormula(value);
  if (excel) {
    return excel;
  }
  const metric = normalizeMetricFormattingValue(value);
  if (metric !== undefined) {
    return metric;
  }
  return undefined;
};

export const normalizeMetricFormattingMap = (
  metricFormatting?: PivotMetricFormattingMap,
): PivotMetricFormattingMap => {
  if (!metricFormatting) {
    return {};
  }
  return Object.entries(metricFormatting).reduce<PivotMetricFormattingMap>(
    (acc, [metricKey, formatting]) => {
      if (!metricKey || !formatting) {
        return acc;
      }
      const nextFormatting: PivotMetricFormatting = {};
      METRIC_FORMATTING_FIELDS.forEach(field => {
        const normalized = normalizePivotMetricFormattingValue(
          formatting[field],
        );
        if (normalized !== undefined) {
          nextFormatting[field] = normalized;
        }
      });
      if (Object.keys(nextFormatting).length > 0) {
        acc[metricKey] = nextFormatting;
      }
      return acc;
    },
    {},
  );
};

const normalizeDatabarType = (value: unknown): PivotMetricDatabar['type'] => {
  if (value === 'bar' || value === 'lollipop' || value === 'waterfall') {
    return value;
  }
  return undefined;
};

export const normalizeMetricDatabarMap = (
  metricDatabars?: PivotMetricDatabarMap,
): PivotMetricDatabarMap => {
  if (!metricDatabars) {
    return {};
  }
  return Object.entries(metricDatabars).reduce<PivotMetricDatabarMap>(
    (acc, [metricKey, config]) => {
      if (!metricKey || !config) {
        return acc;
      }
      const type = normalizeDatabarType(config.type);
      if (!type) {
        return acc;
      }
      const scaleLike = normalizeMetricFormattingValue(config.scaleLike);
      const colorMetric = normalizeMetricFormattingValue(config.colorMetric);
      const colorMode =
        (config.colorMode === 'byMetric' || colorMetric) && colorMetric
          ? 'byMetric'
          : 'static';
      const scaleGroup =
        typeof config.scaleGroup === 'string' &&
        config.scaleGroup.trim().length > 0
          ? config.scaleGroup.trim()
          : undefined;
      const positiveColor =
        typeof config.positiveColor === 'string' &&
        config.positiveColor.trim().length > 0
          ? config.positiveColor
          : DEFAULT_DATABAR_POSITIVE_COLOR;
      const negativeColor =
        typeof config.negativeColor === 'string' &&
        config.negativeColor.trim().length > 0
          ? config.negativeColor
          : DEFAULT_DATABAR_NEGATIVE_COLOR;
      acc[metricKey] = {
        type,
        scaleLike,
        scaleGroup,
        colorMode,
        colorMetric: colorMode === 'byMetric' ? colorMetric : undefined,
        positiveColor,
        negativeColor,
      };
      return acc;
    },
    {},
  );
};

const normalizeDimensionFormattingScope = (
  value: unknown,
): DimensionFormattingScope => {
  if (value === 'label' || value === 'all') {
    return value;
  }
  if (value === 'value') {
    return 'label';
  }
  if (typeof value === 'boolean') {
    return value ? 'all' : 'label';
  }
  return 'all';
};

export const normalizeDimensionFormattingMap = (
  formatting?: PivotDimensionFormattingMap,
): PivotDimensionFormattingMap => {
  if (!formatting) {
    return {};
  }
  return Object.entries(formatting).reduce<PivotDimensionFormattingMap>(
    (acc, [dimensionKey, formattingValue]) => {
      if (!dimensionKey || !formattingValue) {
        return acc;
      }
      const nextFormatting: PivotDimensionFormatting = {};
      DIMENSION_FORMATTING_FIELDS.forEach(field => {
        const normalized = normalizePivotMetricFormattingValue(
          formattingValue[field],
        );
        if (normalized !== undefined) {
          nextFormatting[field] = normalized as PivotDimensionFormattingValue;
        }
      });
      if (Object.keys(nextFormatting).length > 0) {
        nextFormatting.applyTo = normalizeDimensionFormattingScope(
          formattingValue.applyTo,
        );
        acc[dimensionKey] = nextFormatting;
      }
      return acc;
    },
    {},
  );
};

const normalizeFormattingMetricForQuery = (
  metric: QueryFormMetric,
): QueryFormMetric => {
  if (typeof metric === 'string') {
    return metric;
  }
  const getMetricOptionName = (value: QueryFormMetric) => {
    if (typeof value === 'string') {
      return undefined;
    }
    if (isRecord(value)) {
      const { optionName } = value;
      if (typeof optionName === 'string' && optionName.trim().length > 0) {
        return optionName;
      }
    }
    return undefined;
  };
  const optionName = getMetricOptionName(metric);
  if (optionName && metric.label !== optionName) {
    return { ...metric, label: optionName };
  }
  return metric;
};

const resolveMetricReferenceForQuery = (
  metric: QueryFormMetric,
  metrics: QueryFormMetric[],
): QueryFormMetric => {
  if (metrics.length === 0) {
    return metric;
  }
  const referenceCandidates = new Set<string>();
  if (typeof metric === 'string') {
    if (metric.length > 0) {
      referenceCandidates.add(metric);
    }
  } else {
    [
      getFormattingMetricKey(metric),
      getMetricKey(metric),
      getMetricLabel(metric),
    ]
      .filter((key): key is string => Boolean(key))
      .forEach(key => referenceCandidates.add(key));
  }
  if (referenceCandidates.size === 0) {
    return metric;
  }
  const resolved = metrics.find(candidate => {
    if (typeof candidate === 'string') {
      return referenceCandidates.has(candidate);
    }
    const candidateKeys = [
      getFormattingMetricKey(candidate),
      getMetricKey(candidate),
      getMetricLabel(candidate),
    ].filter((key): key is string => Boolean(key));
    return candidateKeys.some(key => referenceCandidates.has(key));
  });
  return resolved || metric;
};

const buildDimensionKeyMap = (columns: QueryFormColumn[]) => {
  const keyMap = new Map<string, string>();
  columns.forEach(column => {
    const key = getColumnLabel(column);
    if (!key) {
      return;
    }
    const candidates = new Set<string>([key]);
    if (typeof column !== 'string') {
      if (column.label) {
        candidates.add(column.label);
      }
      if (column.sqlExpression) {
        candidates.add(column.sqlExpression);
      }
    }
    candidates.forEach(candidate => {
      if (!keyMap.has(candidate)) {
        keyMap.set(candidate, key);
      }
    });
  });
  return keyMap;
};

export const normalizeDimensionFormattingMapWithKeys = (
  formatting: PivotDimensionFormattingMap | undefined,
  columns: QueryFormColumn[],
): PivotDimensionFormattingMap => {
  const normalized = normalizeDimensionFormattingMap(formatting);
  if (columns.length === 0) {
    return normalized;
  }
  const keyMap = buildDimensionKeyMap(columns);
  return Object.entries(normalized).reduce<PivotDimensionFormattingMap>(
    (acc, [dimensionKey, dimensionFormatting]) => {
      const resolvedKey = keyMap.get(dimensionKey);
      if (!resolvedKey) {
        return acc;
      }
      acc[resolvedKey] = {
        ...(acc[resolvedKey] || {}),
        ...dimensionFormatting,
      };
      return acc;
    },
    {},
  );
};

const DEFAULT_DIMENSION_SORT_ORDER: PivotSortOrder = 'asc';

const normalizeDimensionSortingOrder = (value: unknown): PivotSortOrder =>
  value === 'desc' ? 'desc' : 'asc';

const normalizeDimensionSortingMode = (value: unknown): PivotSortMode =>
  value === 'axis_value' ? 'axis_value' : 'total';

const normalizeAxisValueRef = (
  value: unknown,
): PivotAxisValueRef | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { axis } = value;
  const { path } = value;
  if (axis !== 'row' && axis !== 'col') {
    return undefined;
  }
  if (!Array.isArray(path)) {
    return undefined;
  }
  return { axis, path: path as PivotPath };
};

export const normalizeDimensionSortingMap = (
  sorting?: PivotDimensionSortingMap,
): PivotDimensionSortingMap => {
  if (!sorting) {
    return {};
  }
  return Object.entries(sorting).reduce<PivotDimensionSortingMap>(
    (acc, [dimensionKey, sortingValue]) => {
      if (!dimensionKey || !sortingValue || !isRecord(sortingValue)) {
        return acc;
      }
      const hasOrder = 'order' in sortingValue;
      const hasMode = 'mode' in sortingValue;
      const hasAxisRefKey = 'axisValueRef' in sortingValue;
      const axisValueRef = normalizeAxisValueRef(sortingValue.axisValueRef);
      const metric = normalizeMetricFormattingValue(sortingValue.metric);
      const shouldKeep =
        metric !== undefined || hasOrder || hasMode || hasAxisRefKey;
      if (!shouldKeep) {
        return acc;
      }
      const next: PivotDimensionSorting = {
        order: hasOrder
          ? normalizeDimensionSortingOrder(sortingValue.order)
          : DEFAULT_DIMENSION_SORT_ORDER,
        mode: hasMode
          ? normalizeDimensionSortingMode(sortingValue.mode)
          : 'total',
        ...(metric !== undefined ? { metric } : {}),
        ...(axisValueRef ? { axisValueRef } : {}),
      };
      acc[dimensionKey] = next;
      return acc;
    },
    {},
  );
};

export const normalizeDimensionSortingMapWithKeys = (
  sorting: PivotDimensionSortingMap | undefined,
  columns: QueryFormColumn[],
): PivotDimensionSortingMap => {
  const normalized = normalizeDimensionSortingMap(sorting);
  if (columns.length === 0) {
    return normalized;
  }
  const keyMap = buildDimensionKeyMap(columns);
  return Object.entries(normalized).reduce<PivotDimensionSortingMap>(
    (acc, [dimensionKey, dimensionSorting]) => {
      const resolvedKey = keyMap.get(dimensionKey);
      if (!resolvedKey) {
        return acc;
      }
      acc[resolvedKey] = {
        ...(acc[resolvedKey] || {}),
        ...dimensionSorting,
      };
      return acc;
    },
    {},
  );
};

export const hasTotalSorting = (
  sorting: PivotDimensionSortingMap | undefined,
  columns: QueryFormColumn[],
): boolean => {
  const normalized = normalizeDimensionSortingMapWithKeys(sorting, columns);
  return Object.values(normalized).some(
    entry => entry.metric !== undefined && (entry.mode ?? 'total') === 'total',
  );
};

const normalizeDimensionFormattingMapForAxis = (
  formatting: PivotDimensionFormattingMap | undefined,
  columns: QueryFormColumn[],
): PivotDimensionFormattingMap => {
  const normalized = normalizeDimensionFormattingMap(formatting);
  if (columns.length === 0) {
    return normalized;
  }
  const keyMap = buildDimensionKeyMap(columns);
  return Object.entries(normalized).reduce<PivotDimensionFormattingMap>(
    (acc, [dimensionKey, dimensionFormatting]) => {
      const resolvedKey = keyMap.get(dimensionKey) ?? dimensionKey;
      acc[resolvedKey] = {
        ...(acc[resolvedKey] || {}),
        ...dimensionFormatting,
      };
      return acc;
    },
    {},
  );
};

const normalizeDimensionSortingMapForAxis = (
  sorting: PivotDimensionSortingMap | undefined,
  columns: QueryFormColumn[],
): PivotDimensionSortingMap => {
  const normalized = normalizeDimensionSortingMap(sorting);
  if (columns.length === 0) {
    return normalized;
  }
  const keyMap = buildDimensionKeyMap(columns);
  return Object.entries(normalized).reduce<PivotDimensionSortingMap>(
    (acc, [dimensionKey, dimensionSorting]) => {
      const resolvedKey = keyMap.get(dimensionKey) ?? dimensionKey;
      acc[resolvedKey] = {
        ...(acc[resolvedKey] || {}),
        ...dimensionSorting,
      };
      return acc;
    },
    {},
  );
};

const getDimensionKeyFromColumn = (
  column: QueryFormColumn,
): string | undefined => {
  if (isMetricsPlaceholder(column)) {
    return undefined;
  }
  const key = getColumnLabel(column);
  return key || undefined;
};

const buildDimensionKeySet = (columns: QueryFormColumn[]) => {
  const keys = new Set<string>();
  columns.forEach(column => {
    const key = getDimensionKeyFromColumn(column);
    if (key) {
      keys.add(key);
    }
  });
  return keys;
};

type DimensionSettingsTransferResult = {
  rowFormatting: PivotDimensionFormattingMap;
  colFormatting: PivotDimensionFormattingMap;
  rowSorting: PivotDimensionSortingMap;
  colSorting: PivotDimensionSortingMap;
  hasAxisChanges: boolean;
};

export const transferDimensionSettingsAcrossAxes = (
  prevRows: QueryFormColumn[],
  prevCols: QueryFormColumn[],
  nextRows: QueryFormColumn[],
  nextCols: QueryFormColumn[],
  settings: {
    rowFormatting?: PivotDimensionFormattingMap;
    colFormatting?: PivotDimensionFormattingMap;
    rowSorting?: PivotDimensionSortingMap;
    colSorting?: PivotDimensionSortingMap;
  },
): DimensionSettingsTransferResult => {
  const prevRowKeys = buildDimensionKeySet(prevRows);
  const prevColKeys = buildDimensionKeySet(prevCols);
  const nextRowKeys = buildDimensionKeySet(nextRows);
  const nextColKeys = buildDimensionKeySet(nextCols);

  const movedToRows = new Set(
    Array.from(nextRowKeys).filter(
      key => !prevRowKeys.has(key) && prevColKeys.has(key),
    ),
  );
  const movedToCols = new Set(
    Array.from(nextColKeys).filter(
      key => !prevColKeys.has(key) && prevRowKeys.has(key),
    ),
  );
  const hasAxisChanges = movedToRows.size > 0 || movedToCols.size > 0;

  const rowFormatting = normalizeDimensionFormattingMapForAxis(
    settings.rowFormatting,
    prevRows,
  );
  const colFormatting = normalizeDimensionFormattingMapForAxis(
    settings.colFormatting,
    prevCols,
  );
  const rowSorting = normalizeDimensionSortingMapForAxis(
    settings.rowSorting,
    prevRows,
  );
  const colSorting = normalizeDimensionSortingMapForAxis(
    settings.colSorting,
    prevCols,
  );

  if (!hasAxisChanges) {
    return {
      rowFormatting,
      colFormatting,
      rowSorting,
      colSorting,
      hasAxisChanges,
    };
  }

  const nextRowFormatting = { ...rowFormatting };
  const nextColFormatting = { ...colFormatting };
  const nextRowSorting = { ...rowSorting };
  const nextColSorting = { ...colSorting };

  movedToCols.forEach(key => {
    if (rowFormatting[key]) {
      nextColFormatting[key] = rowFormatting[key];
      delete nextRowFormatting[key];
    }
    if (rowSorting[key]) {
      nextColSorting[key] = rowSorting[key];
      delete nextRowSorting[key];
    }
  });

  movedToRows.forEach(key => {
    if (colFormatting[key]) {
      nextRowFormatting[key] = colFormatting[key];
      delete nextColFormatting[key];
    }
    if (colSorting[key]) {
      nextRowSorting[key] = colSorting[key];
      delete nextColSorting[key];
    }
  });

  return {
    rowFormatting: nextRowFormatting,
    colFormatting: nextColFormatting,
    rowSorting: nextRowSorting,
    colSorting: nextColSorting,
    hasAxisChanges,
  };
};

export const collectMetricFormattingMetricsForQuery = (
  metricFormatting?: PivotMetricFormattingMap,
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] =>
  Object.values(normalizeMetricFormattingMap(metricFormatting)).flatMap(
    formatting =>
      METRIC_FORMATTING_FIELDS.flatMap(field => {
        const value = formatting[field];
        if (!value) {
          return [];
        }
        if (isPivotExcelFormula(value)) {
          return extractMetricReferencesFromExcelFormula(value.formula);
        }
        const metric = normalizeMetricFormattingValue(value);
        if (!metric) {
          return [];
        }
        const resolved = resolveMetricReferenceForQuery(metric, metrics);
        return [
          metrics.includes(resolved)
            ? resolved
            : normalizeFormattingMetricForQuery(resolved),
        ];
      }),
  );

export const collectDimensionFormattingMetricsForQuery = (
  formatting: PivotDimensionFormattingMap | undefined,
  columns: QueryFormColumn[],
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] =>
  Object.values(
    normalizeDimensionFormattingMapWithKeys(formatting, columns),
  ).flatMap(dimensionFormatting =>
    DIMENSION_FORMATTING_FIELDS.flatMap(field => {
      const value = dimensionFormatting[field];
      if (!value) {
        return [];
      }
      if (isPivotExcelFormula(value)) {
        return extractMetricReferencesFromExcelFormula(value.formula);
      }
      const metric = normalizeMetricFormattingValue(value);
      if (!metric) {
        return [];
      }
      const resolved = resolveMetricReferenceForQuery(metric, metrics);
      return [
        metrics.includes(resolved)
          ? resolved
          : normalizeFormattingMetricForQuery(resolved),
      ];
    }),
  );

export const collectDimensionSortingMetricsForQuery = (
  sorting: PivotDimensionSortingMap | undefined,
  columns: QueryFormColumn[],
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] =>
  Object.values(normalizeDimensionSortingMapWithKeys(sorting, columns)).flatMap(
    entry =>
      entry.metric
        ? [
            (() => {
              const resolved = resolveMetricReferenceForQuery(
                entry.metric,
                metrics,
              );
              return metrics.includes(resolved)
                ? resolved
                : normalizeFormattingMetricForQuery(resolved);
            })(),
          ]
        : [],
  );

export const normalizeMetricFormattingMapWithKeys = (
  metricFormatting: PivotMetricFormattingMap | undefined,
  metrics: QueryFormMetric[],
  savedMetrics?: Metric[],
): PivotMetricFormattingMap => {
  const normalized = normalizeMetricFormattingMap(metricFormatting);
  if (metrics.length === 0) {
    return normalized;
  }
  const metricKeys = new Set(getMetricKeys(metrics));
  const verboseNameToKey = (savedMetrics || []).reduce<Map<string, string>>(
    (acc, metric) => {
      if (metric.verbose_name && metric.metric_name) {
        acc.set(metric.verbose_name, metric.metric_name);
      }
      return acc;
    },
    new Map(),
  );
  const labelToKey = metrics.reduce<Map<string, string>>((acc, metric) => {
    const key = getMetricKey(metric);
    const label = getMetricLabel(metric);
    if (key && label && key !== label && !acc.has(label)) {
      acc.set(label, key);
    }
    return acc;
  }, new Map());
  return Object.entries(normalized).reduce<PivotMetricFormattingMap>(
    (acc, [metricKey, formatting]) => {
      const resolvedKey = metricKeys.has(metricKey)
        ? metricKey
        : labelToKey.get(metricKey) ||
          verboseNameToKey.get(metricKey) ||
          metricKey;
      if (!resolvedKey) {
        return acc;
      }
      acc[resolvedKey] = { ...(acc[resolvedKey] || {}), ...formatting };
      return acc;
    },
    {},
  );
};

export const normalizeMetricDatabarMapWithKeys = (
  metricDatabars: PivotMetricDatabarMap | undefined,
  metrics: QueryFormMetric[],
  savedMetrics?: Metric[],
): PivotMetricDatabarMap => {
  const normalized = normalizeMetricDatabarMap(metricDatabars);
  if (metrics.length === 0) {
    return normalized;
  }
  const metricKeys = new Set(getMetricKeys(metrics));
  const verboseNameToKey = (savedMetrics || []).reduce<Map<string, string>>(
    (acc, metric) => {
      if (metric.verbose_name && metric.metric_name) {
        acc.set(metric.verbose_name, metric.metric_name);
      }
      return acc;
    },
    new Map(),
  );
  const labelToKey = metrics.reduce<Map<string, string>>((acc, metric) => {
    const key = getMetricKey(metric);
    const label = getMetricLabel(metric);
    if (key && label && key !== label && !acc.has(label)) {
      acc.set(label, key);
    }
    return acc;
  }, new Map());
  const resolveMetricReference = (metric?: QueryFormMetric) => {
    if (!metric) {
      return undefined;
    }
    const candidates = [
      getFormattingMetricKey(metric),
      getMetricKey(metric as QueryFormMetric | Metric),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      if (metricKeys.has(candidate)) {
        return candidate;
      }
    }
    for (const candidate of candidates) {
      const resolved =
        labelToKey.get(candidate) || verboseNameToKey.get(candidate);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  };
  const merged = Object.entries(normalized).reduce<PivotMetricDatabarMap>(
    (acc, [metricKey, config]) => {
      const resolvedKey = metricKeys.has(metricKey)
        ? metricKey
        : labelToKey.get(metricKey) ||
          verboseNameToKey.get(metricKey) ||
          metricKey;
      if (!resolvedKey) {
        return acc;
      }
      acc[resolvedKey] = {
        ...(acc[resolvedKey] || {}),
        ...config,
      };
      return acc;
    },
    {},
  );
  const mapped = Object.entries(merged).reduce<PivotMetricDatabarMap>(
    (acc, [metricKey, config]) => {
      const scaleLikeKey = resolveMetricReference(config.scaleLike);
      const nextConfig: PivotMetricDatabar = { ...config };
      if (scaleLikeKey && scaleLikeKey !== metricKey) {
        nextConfig.scaleLike = scaleLikeKey;
      } else if (nextConfig.scaleLike) {
        delete nextConfig.scaleLike;
      }
      acc[metricKey] = nextConfig;
      return acc;
    },
    {},
  );
  const scaleLikeTargets = Object.entries(mapped).reduce<Set<string>>(
    (targets, [metricKey, config]) => {
      const scaleLikeKey = config.scaleLike
        ? getFormattingMetricKey(config.scaleLike)
        : undefined;
      if (scaleLikeKey && scaleLikeKey !== metricKey) {
        targets.add(scaleLikeKey);
      }
      return targets;
    },
    new Set(),
  );
  if (scaleLikeTargets.size === 0) {
    return mapped;
  }
  return Object.entries(mapped).reduce<PivotMetricDatabarMap>(
    (acc, [metricKey, config]) => {
      if (scaleLikeTargets.has(metricKey) && config.scaleLike) {
        const rest = { ...config };
        delete rest.scaleLike;
        acc[metricKey] = rest;
        return acc;
      }
      acc[metricKey] = config;
      return acc;
    },
    {},
  );
};

export const collectMetricFormattingMetrics = (
  metricFormatting?: PivotMetricFormattingMap,
): QueryFormMetric[] =>
  Object.values(normalizeMetricFormattingMap(metricFormatting)).flatMap(
    formatting =>
      METRIC_FORMATTING_FIELDS.map(field => formatting[field])
        .filter(
          (value): value is Exclude<PivotMetricFormattingValue, undefined> =>
            Boolean(value),
        )
        .flatMap(value => (isPivotExcelFormula(value) ? [] : [value])),
  );

export const collectMetricDatabarMetrics = (
  metricDatabars?: PivotMetricDatabarMap,
): QueryFormMetric[] =>
  Object.values(normalizeMetricDatabarMap(metricDatabars)).flatMap(config =>
    config.colorMode === 'byMetric' && config.colorMetric
      ? [config.colorMetric]
      : [],
  );

export const collectMetricDatabarMetricsForQuery = (
  metricDatabars?: PivotMetricDatabarMap,
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] =>
  Object.values(normalizeMetricDatabarMap(metricDatabars)).flatMap(config => {
    if (config.colorMode !== 'byMetric' || !config.colorMetric) {
      return [];
    }
    const resolved = resolveMetricReferenceForQuery(
      config.colorMetric,
      metrics,
    );
    return [
      metrics.includes(resolved)
        ? resolved
        : normalizeFormattingMetricForQuery(resolved),
    ];
  });

export const collectMeasureLeafMetricsForQuery = (
  measureHierarchy: MeasureHierarchy | undefined,
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] => {
  if (!measureHierarchy || measureHierarchy.kind !== 'measureStackV1') {
    return [];
  }
  const existingMetricKeys = new Set<string>();
  metrics.forEach(metric => {
    [
      getFormattingMetricKey(metric),
      getMetricKey(metric),
      getMetricLabel(metric),
    ]
      .filter((key): key is string => Boolean(key))
      .forEach(key => existingMetricKeys.add(key));
  });

  const referencedMetrics = new Set<string>();
  measureHierarchy.groups.forEach(group => {
    group.leaves.forEach(leaf => {
      if (leaf.kind !== 'custom') {
        return;
      }
      extractMetricReferencesFromExcelFormula(leaf.formula).forEach(ref => {
        if (!existingMetricKeys.has(ref)) {
          referencedMetrics.add(ref);
        }
      });
    });
  });
  return Array.from(referencedMetrics);
};

export const mergeMetrics = (
  metrics: QueryFormMetric[],
  extraMetrics: QueryFormMetric[],
) => {
  const seen = new Set<string>();
  const result: QueryFormMetric[] = [];
  const addMetric = (metric: QueryFormMetric) => {
    const key = getMetricKey(metric);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(metric);
  };
  metrics.forEach(addMetric);
  extraMetrics.forEach(addMetric);
  return result;
};

export const normalizeSubtotalLevels = (
  levels: number[] | undefined,
  maxDepth: number,
  legacyTotal?: boolean,
  legacySubtotals?: boolean,
) => {
  const base = Array.isArray(levels)
    ? levels
        .map(l => Number(l))
        .filter(l => Number.isFinite(l) && l <= maxDepth && l >= 0)
    : [];
  const next = new Set(base);
  if (legacyTotal) {
    next.add(0);
  }
  if (legacySubtotals) {
    // legacy boolean meant all levels; here we add every level greater than 0
    for (let i = 1; i <= maxDepth; i += 1) {
      next.add(i);
    }
  }
  return Array.from(next).sort((a, b) => a - b);
};

export const parseDepth = (queryName?: string) => {
  if (
    !queryName ||
    !queryName.startsWith(formatQueryName(0, 0).split('|')[0])
  ) {
    return { rowDepth: 0, colDepth: 0 };
  }
  const [, rowLabel = '', colLabel = ''] = queryName.split('|');
  const rowDepth = Number(rowLabel.replace('row', '')) || 0;
  const colDepth = Number(colLabel.replace('col', '')) || 0;
  return { rowDepth, colDepth };
};

export const normalizeExpandLevel = (rawLevel: number | undefined) => {
  if (rawLevel === undefined || rawLevel === null) {
    return undefined;
  }
  const parsed = Number(rawLevel);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.floor(parsed);
};

export const resolveExpandLevel = (
  rawLevel: number | undefined,
  groupbyLength: number,
  startCollapsed: boolean,
  initialDepth: number,
) => {
  const parsed = normalizeExpandLevel(rawLevel);
  if (parsed !== undefined) {
    return Math.min(Math.max(parsed, 0), groupbyLength);
  }
  if (!startCollapsed) {
    return groupbyLength;
  }
  const resolvedDepth = Math.max(initialDepth || 1, 1) - 1;
  return Math.min(Math.max(resolvedDepth, 0), groupbyLength);
};

export const resolveMetricPlacement = (
  rowsRaw: QueryFormColumn[] = [],
  colsRaw: QueryFormColumn[] = [],
  options: {
    hasMetrics: boolean;
    preferredAxis?: MetricsLayoutEnum;
    lastMoved?: 'row' | 'col';
  },
) => {
  const normalizeGroupby = (values: QueryFormColumn[] = []) =>
    ensureIsArray(values).map(normalizePlaceholder);
  const rowsNormalized = normalizeGroupby(rowsRaw);
  const colsNormalized = normalizeGroupby(colsRaw);
  const rowsBase = rowsNormalized.filter(val => !isMetricsPlaceholder(val));
  const colsBase = colsNormalized.filter(val => !isMetricsPlaceholder(val));
  const preferred =
    options.preferredAxis === MetricsLayoutEnum.ROWS ? 'row' : 'col';

  if (!options.hasMetrics) {
    const layout =
      options.preferredAxis === MetricsLayoutEnum.ROWS
        ? MetricsLayoutEnum.ROWS
        : MetricsLayoutEnum.COLUMNS;
    return {
      rows: rowsBase,
      cols: colsBase,
      axis: preferred,
      layout,
      metricPosition: -1,
    };
  }

  const rowsHas = rowsNormalized.some(isMetricsPlaceholder);
  const colsHas = colsNormalized.some(isMetricsPlaceholder);

  let axis: 'row' | 'col' = preferred;
  if (rowsHas && !colsHas) {
    axis = 'row';
  } else if (colsHas && !rowsHas) {
    axis = 'col';
  } else if (rowsHas && colsHas) {
    axis = options.lastMoved || preferred;
  } else if (!rowsHas && !colsHas) {
    axis = options.lastMoved || preferred;
  }

  const insertIndex =
    axis === 'row'
      ? Math.min(
          rowsHas
            ? rowsNormalized.indexOf(METRICS_PLACEHOLDER)
            : rowsBase.length,
          rowsBase.length,
        )
      : Math.min(
          colsHas
            ? colsNormalized.indexOf(METRICS_PLACEHOLDER)
            : colsBase.length,
          colsBase.length,
        );

  const rows =
    axis === 'row'
      ? [
          ...rowsBase.slice(0, insertIndex),
          METRICS_PLACEHOLDER,
          ...rowsBase.slice(insertIndex),
        ]
      : rowsBase;
  const cols =
    axis === 'col'
      ? [
          ...colsBase.slice(0, insertIndex),
          METRICS_PLACEHOLDER,
          ...colsBase.slice(insertIndex),
        ]
      : colsBase;

  const layout =
    axis === 'row' ? MetricsLayoutEnum.ROWS : MetricsLayoutEnum.COLUMNS;

  return { rows, cols, axis, layout, metricPosition: insertIndex };
};
