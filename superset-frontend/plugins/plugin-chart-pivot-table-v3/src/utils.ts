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
  DataRecordValue,
} from '@superset-ui/core';
import { supersetTheme } from '@apache-superset/core/theme';
import {
  METRIC_FORMATTING_FIELDS,
  DIMENSION_FORMATTING_FIELDS,
  DimensionFormattingScope,
  PivotDimensionFormattingMap,
  PivotDimensionSorting,
  PivotDimensionSortingMap,
  PivotAxisValueRef,
  PivotMetricFormattingMap,
  PivotMetricDatabarMap,
  PivotMetricDatabar,
  PivotSortMode,
  PivotSortOrder,
  PivotPath,
  PivotMetricFormattingValue,
  PivotDimensionFormattingValue,
  MeasureHierarchy,
} from './types';
import {
  extractMetricReferencesFromExcelFormula,
  isPivotExcelFormula,
  normalizePivotExcelFormula,
} from './pivot/formatting/excelFormulaReferences';
import { isMetricsPlaceholder } from './pivot/core/tokens';
import { getMetricKey, getMetricKeys } from './pivot/metrics';

export const PIVOT_THEME_PRESETS: Record<string, string> = {
  blue: supersetTheme.colorPrimaryBg,
  peach: supersetTheme.colorWarningBg,
  grey: supersetTheme.colorFillSecondary,
};
export const DEFAULT_DATABAR_POSITIVE_COLOR = supersetTheme.colorSuccess;
export const DEFAULT_DATABAR_NEGATIVE_COLOR = supersetTheme.colorError;

const EPOCH_MS_ABS_THRESHOLD = 1e11;

// Cube/Postgres can return temporal values as epoch-ms strings. Superset time
// formatters expect `number | Date`, so coerce only epoch-like values.
export const coerceEpochMsStringToNumber = (
  value: DataRecordValue,
): DataRecordValue => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return Math.abs(numeric) >= EPOCH_MS_ABS_THRESHOLD ? numeric : value;
};

export const buildMetricLabelMap = (
  savedMetrics: Metric[],
  overrides?: Record<string, string>,
): Record<string, string> => {
  const merged: Record<string, string> = { ...overrides };
  savedMetrics.forEach(metric => {
    const metricKey = metric.metric_name;
    if (!metricKey || merged[metricKey]) {
      return;
    }
    const label = metric.verbose_name || metricKey;
    merged[metricKey] = label;
  });
  return merged;
};

type MetricLabelLookup = Record<string, string> | Map<string, string>;

const normalizeMetricLabelToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getMetricLookupLabel = (
  lookup: MetricLabelLookup | undefined,
  key: string,
): string | undefined => {
  if (!lookup) {
    return undefined;
  }
  if (lookup instanceof Map) {
    return normalizeMetricLabelToken(lookup.get(key));
  }
  return normalizeMetricLabelToken(lookup[key]);
};

const getMetricObjectField = (
  metric: QueryFormMetric | Metric,
  field: 'verbose_name' | 'label',
): string | undefined => {
  if (typeof metric === 'string') {
    return undefined;
  }
  const metricObject = metric as unknown as {
    metric_name?: unknown;
    verbose_name?: unknown;
    label?: unknown;
  };
  const value = metricObject[field];
  return normalizeMetricLabelToken(value);
};

const getMetricIntrinsicLabel = (
  metric: QueryFormMetric | Metric,
): string | undefined => {
  const verboseName = getMetricObjectField(metric, 'verbose_name');
  if (verboseName) {
    return verboseName;
  }
  const label = getMetricObjectField(metric, 'label');
  if (label) {
    return label;
  }
  return normalizeMetricLabelToken(getMetricLabel(metric as QueryFormMetric));
};

export const resolveMetricDisplayLabel = (
  metricKey: string,
  options?: {
    metricLabelMap?: MetricLabelLookup;
    verboseMap?: Record<string, string>;
    metrics?: Array<QueryFormMetric | Metric>;
  },
): string => {
  const normalizedKey = normalizeMetricLabelToken(metricKey);
  if (!normalizedKey) {
    return metricKey;
  }

  const { metricLabelMap, verboseMap, metrics = [] } = options ?? {};
  const mappedLabel = getMetricLookupLabel(metricLabelMap, normalizedKey);
  const verboseLabel = normalizeMetricLabelToken(verboseMap?.[normalizedKey]);
  if (mappedLabel && mappedLabel !== normalizedKey) {
    return mappedLabel;
  }
  if (verboseLabel) {
    return verboseLabel;
  }
  if (mappedLabel) {
    return mappedLabel;
  }
  const metric = metrics.find(
    candidate => getMetricKey(candidate) === normalizedKey,
  );
  return getMetricIntrinsicLabel(metric ?? metricKey) ?? normalizedKey;
};

export const buildResolvedMetricLabelMap = ({
  metrics,
  metricLabelMap,
  verboseMap,
}: {
  metrics: Array<QueryFormMetric | Metric>;
  metricLabelMap?: MetricLabelLookup;
  verboseMap?: Record<string, string>;
}): Map<string, string> => {
  const resolved = new Map<string, string>();
  const seed = (key: string, label: string) => {
    const normalizedKey = normalizeMetricLabelToken(key);
    const normalizedLabel = normalizeMetricLabelToken(label);
    if (!normalizedKey || !normalizedLabel) {
      return;
    }
    resolved.set(normalizedKey, normalizedLabel);
  };

  if (metricLabelMap instanceof Map) {
    metricLabelMap.forEach((label, key) => seed(key, label));
  } else {
    Object.entries(metricLabelMap ?? {}).forEach(([key, label]) =>
      seed(key, label),
    );
  }

  metrics.forEach(metric => {
    const metricKey = normalizeMetricLabelToken(getMetricKey(metric));
    if (!metricKey) {
      return;
    }
    const mappedLabel = getMetricLookupLabel(resolved, metricKey);
    const verboseLabel = normalizeMetricLabelToken(verboseMap?.[metricKey]);
    const label =
      mappedLabel && mappedLabel !== metricKey
        ? mappedLabel
        : (verboseLabel ??
          mappedLabel ??
          getMetricIntrinsicLabel(metric) ??
          metricKey);
    resolved.set(metricKey, label);
  });

  return resolved;
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const normalizeMetricFormattingValue = (
  value: unknown,
): QueryFormMetric | undefined => {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : undefined;
  }
  if (isRecord(value)) {
    const { expressionType } = value;
    if (typeof expressionType === 'string' && expressionType.length > 0) {
      return value as unknown as QueryFormMetric;
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

/** Normalizes the formatting fields shared by metric and dimension controls. */
const normalizeFormattingMap = <Field extends string>(
  settings: Record<string, Partial<Record<Field, unknown>>> | undefined,
  fields: readonly Field[],
): Record<string, Partial<Record<Field, PivotMetricFormattingValue>>> =>
  Object.fromEntries(
    Object.entries(settings ?? {}).flatMap(([key, value]) => {
      if (!key || !value) return [];
      const normalized = Object.fromEntries(
        fields.flatMap(field => {
          const metric = normalizePivotMetricFormattingValue(value[field]);
          return metric === undefined ? [] : [[field, metric]];
        }),
      );
      return Object.keys(normalized).length
        ? [
            [
              key,
              normalized as Partial<Record<Field, PivotMetricFormattingValue>>,
            ],
          ]
        : [];
    }),
  );

export const normalizeMetricFormattingMap = (
  formatting?: PivotMetricFormattingMap,
): PivotMetricFormattingMap =>
  normalizeFormattingMap(formatting, METRIC_FORMATTING_FIELDS);

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
): PivotDimensionFormattingMap =>
  Object.fromEntries(
    Object.entries(
      normalizeFormattingMap(formatting, DIMENSION_FORMATTING_FIELDS),
    ).map(([key, value]) => [
      key,
      {
        ...value,
        applyTo: normalizeDimensionFormattingScope(formatting?.[key].applyTo),
      },
    ]),
  );

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
  const metricKey = getMetricKey(metric);
  if (!metricKey) {
    return metric;
  }
  const resolved = metrics.find(
    candidate => getMetricKey(candidate) === metricKey,
  );
  return resolved || metric;
};

const normalizeMetricReferenceForQuery = (
  metric: QueryFormMetric,
  metrics: QueryFormMetric[],
): QueryFormMetric => {
  const resolved = resolveMetricReferenceForQuery(metric, metrics);
  return metrics.includes(resolved)
    ? resolved
    : normalizeFormattingMetricForQuery(resolved);
};

const collectMetricFormattingValuesForQuery = (
  values: Array<PivotMetricFormattingValue | PivotDimensionFormattingValue>,
  metrics: QueryFormMetric[],
): QueryFormMetric[] =>
  values.flatMap(value => {
    if (isPivotExcelFormula(value)) {
      return extractMetricReferencesFromExcelFormula(value.formula);
    }
    const metric = normalizeMetricFormattingValue(value);
    return metric ? [normalizeMetricReferenceForQuery(metric, metrics)] : [];
  });

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const buildDimensionKeySet = (columns: QueryFormColumn[]) =>
  new Set(
    columns
      .filter(column => !isMetricsPlaceholder(column))
      .map(getColumnLabel)
      .filter(Boolean),
  );

const filterDimensionSettingKeys = <Value extends object>(
  settings: Record<string, Value>,
  columns: QueryFormColumn[],
): Record<string, Value> => {
  const keys = buildDimensionKeySet(columns);
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => keys.has(key)),
  );
};

export const normalizeDimensionFormattingMapWithKeys = (
  formatting: PivotDimensionFormattingMap | undefined,
  columns: QueryFormColumn[],
): PivotDimensionFormattingMap => {
  const normalized = normalizeDimensionFormattingMap(formatting);
  return filterDimensionSettingKeys(normalized, columns);
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
  return filterDimensionSettingKeys(normalized, columns);
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
  const previous = {
    row: buildDimensionKeySet(prevRows),
    col: buildDimensionKeySet(prevCols),
  };
  const moved = {
    row: [...buildDimensionKeySet(nextRows)].filter(
      key => !previous.row.has(key) && previous.col.has(key),
    ),
    col: [...buildDimensionKeySet(nextCols)].filter(
      key => !previous.col.has(key) && previous.row.has(key),
    ),
  };
  const result = {
    rowFormatting: normalizeDimensionFormattingMapWithKeys(
      settings.rowFormatting,
      prevRows,
    ),
    colFormatting: normalizeDimensionFormattingMapWithKeys(
      settings.colFormatting,
      prevCols,
    ),
    rowSorting: normalizeDimensionSortingMapWithKeys(
      settings.rowSorting,
      prevRows,
    ),
    colSorting: normalizeDimensionSortingMapWithKeys(
      settings.colSorting,
      prevCols,
    ),
    hasAxisChanges: moved.row.length > 0 || moved.col.length > 0,
  };
  for (const kind of ['Formatting', 'Sorting'] as const) {
    for (const axis of ['row', 'col'] as const) {
      const destination = result[`${axis}${kind}`];
      const source = result[`${axis === 'row' ? 'col' : 'row'}${kind}`];
      for (const key of moved[axis]) {
        if (source[key]) {
          destination[key] = source[key];
          delete source[key];
        }
      }
    }
  }
  return result;
};

export const collectMetricFormattingMetricsForQuery = (
  metricFormatting?: PivotMetricFormattingMap,
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] =>
  Object.values(normalizeMetricFormattingMap(metricFormatting)).flatMap(
    formatting =>
      collectMetricFormattingValuesForQuery(
        METRIC_FORMATTING_FIELDS.map(field => formatting[field]).filter(
          isDefined,
        ),
        metrics,
      ),
  );

export const collectDimensionFormattingMetricsForQuery = (
  formatting: PivotDimensionFormattingMap | undefined,
  columns: QueryFormColumn[],
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] =>
  Object.values(
    normalizeDimensionFormattingMapWithKeys(formatting, columns),
  ).flatMap(dimensionFormatting =>
    collectMetricFormattingValuesForQuery(
      DIMENSION_FORMATTING_FIELDS.map(
        field => dimensionFormatting[field],
      ).filter(isDefined),
      metrics,
    ),
  );

export const collectDimensionSortingMetricsForQuery = (
  sorting: PivotDimensionSortingMap | undefined,
  columns: QueryFormColumn[],
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] =>
  Object.values(normalizeDimensionSortingMapWithKeys(sorting, columns)).flatMap(
    entry =>
      entry.metric
        ? [normalizeMetricReferenceForQuery(entry.metric, metrics)]
        : [],
  );

export const normalizeMetricFormattingMapWithKeys = (
  formatting: PivotMetricFormattingMap | undefined,
  metrics: QueryFormMetric[],
): PivotMetricFormattingMap => {
  const normalized = normalizeMetricFormattingMap(formatting);
  const keys = new Set(getMetricKeys(metrics));
  return metrics.length
    ? Object.fromEntries(
        Object.entries(normalized).filter(([key]) => keys.has(key)),
      )
    : normalized;
};

export const normalizeMetricDatabarMapWithKeys = (
  databars: PivotMetricDatabarMap | undefined,
  metrics: QueryFormMetric[],
): PivotMetricDatabarMap => {
  const normalized = normalizeMetricDatabarMap(databars);
  if (!metrics.length) return normalized;
  const keys = new Set(getMetricKeys(metrics));
  const targets = new Set<string>();
  for (const [key, config] of Object.entries(normalized)) {
    const target = config.scaleLike
      ? getMetricKey(config.scaleLike)
      : undefined;
    if (target && keys.has(target) && target !== key) {
      config.scaleLike = target;
      targets.add(target);
    } else delete config.scaleLike;
  }
  for (const target of targets) delete normalized[target]?.scaleLike;
  return normalized;
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
    return [normalizeMetricReferenceForQuery(config.colorMetric, metrics)];
  });

export const collectMeasureLeafMetricsForQuery = (
  measureHierarchy: MeasureHierarchy | undefined,
  metrics: QueryFormMetric[] = [],
  availableMetrics: QueryFormMetric[] = metrics,
): QueryFormMetric[] => {
  if (!measureHierarchy) {
    return [];
  }
  const existingMetricKeys = new Set<string>();
  metrics.forEach(metric => {
    const metricKey = getMetricKey(metric);
    if (metricKey) {
      existingMetricKeys.add(metricKey);
    }
  });

  const referencedMetrics: QueryFormMetric[] = [];
  const referencedMetricKeys = new Set<string>();
  const addMetric = (metric: QueryFormMetric) => {
    const resolved = resolveMetricReferenceForQuery(metric, availableMetrics);
    const metricKey = getMetricKey(resolved);
    if (
      !metricKey ||
      existingMetricKeys.has(metricKey) ||
      referencedMetricKeys.has(metricKey)
    ) {
      return;
    }
    referencedMetricKeys.add(metricKey);
    referencedMetrics.push(
      availableMetrics.includes(resolved)
        ? resolved
        : normalizeFormattingMetricForQuery(resolved),
    );
  };
  measureHierarchy.groups.forEach(group => {
    group.leaves.forEach(leaf => {
      if (leaf.kind !== 'custom') {
        return;
      }
      addMetric(leaf.metric);
    });
  });
  return referencedMetrics;
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
  includeRootTotal?: boolean,
  includeAllSubtotals?: boolean,
) => {
  const base = Array.isArray(levels)
    ? levels
        .map(l => Number(l))
        .filter(l => Number.isFinite(l) && l <= maxDepth && l >= 0)
    : [];
  const next = new Set(base);
  if (includeRootTotal) {
    next.add(0);
  }
  if (includeAllSubtotals) {
    for (let i = 1; i <= maxDepth; i += 1) {
      next.add(i);
    }
  }
  return Array.from(next).sort((a, b) => a - b);
};
