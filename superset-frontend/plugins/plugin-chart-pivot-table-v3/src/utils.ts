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
  DataRecord,
  DataRecordValue,
  getColumnLabel,
  getMetricLabel,
  Metric,
  QueryFormColumn,
  QueryFormMetric,
  ensureIsArray,
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
  PivotTreeData,
  PivotTreeNode,
} from './types';
import { formatQueryName } from './buildQuery';

export const PATH_DIVIDER = '__';
export const METRICS_PLACEHOLDER = '__MEASURES__';
export const METRICS_PLACEHOLDER_LABEL = 'Σ Values';
export const SUBTOTAL_TOKEN = '__subtotal__';
export const SUBTOTAL_LABEL = 'Subtotal';
export const PIVOT_THEME_PRESETS: Record<string, string> = {
  blue: '#DDEBF7',
  peach: '#FCE4D6',
  grey: '#E7E6E6',
};
export const DEFAULT_DATABAR_POSITIVE_COLOR = '#5ac189';
export const DEFAULT_DATABAR_NEGATIVE_COLOR = '#e04355';

export const isSubtotalToken = (val: unknown) =>
  val === SUBTOTAL_TOKEN || val === SUBTOTAL_LABEL;

export const parseThemeColors = (value?: string) =>
  (value || '')
    .split(',')
    .map(color => color.trim())
    .filter(color => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color));

export const normalizePlaceholder = (val: QueryFormColumn) => {
  if (val === METRICS_PLACEHOLDER) return METRICS_PLACEHOLDER;
  if (
    typeof val === 'object' &&
    ((val as any).column_name === METRICS_PLACEHOLDER ||
      (val as any).label === METRICS_PLACEHOLDER)
  ) {
    return METRICS_PLACEHOLDER;
  }
  return val;
};

export const isMetricsPlaceholder = (val: QueryFormColumn) =>
  normalizePlaceholder(val) === METRICS_PLACEHOLDER;

export const stripMetricsPlaceholder = (groupby: QueryFormColumn[]) =>
  groupby.filter(col => {
    if (isMetricsPlaceholder(col)) return false;
    return true;
  });

export const serializePath = (path: PivotPath = []) => path.join(PATH_DIVIDER);

export const getMetricKey = (metric: QueryFormMetric | Metric) => {
  if (typeof metric === 'string') {
    return metric;
  }
  if ('expressionType' in metric) {
    return getMetricLabel(metric) || '';
  }
  if ('metric_name' in metric && metric.metric_name) {
    return metric.metric_name;
  }
  return getMetricLabel(metric) || '';
};

export const getMetricKeys = (metrics: QueryFormMetric[]) =>
  metrics.map(getMetricKey).filter((m): m is string => !!m);

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

const getMetricOptionName = (metric: QueryFormMetric | Metric) => {
  if (isRecord(metric)) {
    const optionName = metric.optionName;
    if (typeof optionName === 'string' && optionName.trim().length > 0) {
      return optionName;
    }
  }
  return undefined;
};

export const getFormattingMetricKey = (metric: QueryFormMetric | Metric) =>
  getMetricOptionName(metric) || getMetricKey(metric);

const coerceExpressionType = (
  value: Record<string, unknown>,
): QueryFormMetric | undefined => {
  const expressionType = value.expressionType;
  if (typeof expressionType === 'string' && expressionType.length > 0) {
    return value as QueryFormMetric;
  }
  const sqlExpression = value.sqlExpression;
  if (typeof sqlExpression === 'string' && sqlExpression.trim().length > 0) {
    return { ...value, expressionType: 'SQL' } as QueryFormMetric;
  }
  const aggregate = value.aggregate;
  const column = value.column;
  if (
    typeof aggregate === 'string' &&
    aggregate.length > 0 &&
    isRecord(column)
  ) {
    return { ...value, expressionType: 'SIMPLE' } as QueryFormMetric;
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
    const key = value.key;
    if (typeof key === 'string' && key.trim().length > 0) {
      return key;
    }
    if (typeof key === 'number') {
      return String(key);
    }
    const name = value.name;
    if (typeof name === 'string' && name.trim().length > 0) {
      return name;
    }
    const metricName = value.metric_name;
    if (typeof metricName === 'string' && metricName.trim().length > 0) {
      return metricName;
    }
    const expressionType = value.expressionType;
    if (typeof expressionType === 'string') {
      return value as QueryFormMetric;
    }
    const label = value.label;
    if (typeof label === 'string' && label.trim().length > 0) {
      return label;
    }
    const title = value.title;
    if (typeof title === 'string' && title.trim().length > 0) {
      return title;
    }
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
        const normalized = normalizeMetricFormattingValue(formatting[field]);
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
        typeof config.scaleGroup === 'string' && config.scaleGroup.trim().length > 0
          ? config.scaleGroup.trim()
          : undefined;
      const positiveColor =
        typeof config.positiveColor === 'string' && config.positiveColor.trim().length > 0
          ? config.positiveColor
          : DEFAULT_DATABAR_POSITIVE_COLOR;
      const negativeColor =
        typeof config.negativeColor === 'string' && config.negativeColor.trim().length > 0
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
        const normalized = normalizeMetricFormattingValue(
          formattingValue[field],
        );
        if (normalized !== undefined) {
          nextFormatting[field] = normalized;
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
  const axis = value.axis;
  const path = value.path;
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
): QueryFormMetric[] => {
  return Object.values(
    normalizeMetricFormattingMap(metricFormatting),
  ).flatMap(formatting =>
    METRIC_FORMATTING_FIELDS.map(field =>
      normalizeMetricFormattingValue(formatting[field]),
    )
      .filter((metric): metric is QueryFormMetric => metric !== undefined)
      .map(metric => resolveMetricReferenceForQuery(metric, metrics))
      .map(metric =>
        metrics.includes(metric)
          ? metric
          : normalizeFormattingMetricForQuery(metric),
      ),
  );
};

export const collectDimensionFormattingMetricsForQuery = (
  formatting: PivotDimensionFormattingMap | undefined,
  columns: QueryFormColumn[],
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] => {
  return Object.values(
    normalizeDimensionFormattingMapWithKeys(formatting, columns),
  ).flatMap(dimensionFormatting =>
    DIMENSION_FORMATTING_FIELDS.map(field =>
      normalizeMetricFormattingValue(dimensionFormatting[field]),
    )
      .filter((metric): metric is QueryFormMetric => metric !== undefined)
      .map(metric => resolveMetricReferenceForQuery(metric, metrics))
      .map(metric =>
        metrics.includes(metric)
          ? metric
          : normalizeFormattingMetricForQuery(metric),
      ),
  );
};

export const collectDimensionSortingMetricsForQuery = (
  sorting: PivotDimensionSortingMap | undefined,
  columns: QueryFormColumn[],
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] => {
  return Object.values(
    normalizeDimensionSortingMapWithKeys(sorting, columns),
  ).flatMap(entry =>
    entry.metric
      ? [
          (() => {
            const resolved = resolveMetricReferenceForQuery(entry.metric, metrics);
            return metrics.includes(resolved)
              ? resolved
              : normalizeFormattingMetricForQuery(resolved);
          })(),
        ]
      : [],
  );
};

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
      const resolved = labelToKey.get(candidate) || verboseNameToKey.get(candidate);
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
        const { scaleLike, ...rest } = config;
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
): QueryFormMetric[] => {
  return Object.values(
    normalizeMetricFormattingMap(metricFormatting),
  ).flatMap(formatting =>
    METRIC_FORMATTING_FIELDS.map(field =>
      normalizeMetricFormattingValue(formatting[field]),
    ).filter((metric): metric is QueryFormMetric => metric !== undefined),
  );
};

export const collectMetricDatabarMetrics = (
  metricDatabars?: PivotMetricDatabarMap,
): QueryFormMetric[] => {
  return Object.values(
    normalizeMetricDatabarMap(metricDatabars),
  ).flatMap(config =>
    config.colorMode === 'byMetric' && config.colorMetric
      ? [config.colorMetric]
      : [],
  );
};

export const collectMetricDatabarMetricsForQuery = (
  metricDatabars?: PivotMetricDatabarMap,
  metrics: QueryFormMetric[] = [],
): QueryFormMetric[] => {
  return Object.values(
    normalizeMetricDatabarMap(metricDatabars),
  ).flatMap(config => {
    if (config.colorMode !== 'byMetric' || !config.colorMetric) {
      return [];
    }
    const resolved = resolveMetricReferenceForQuery(config.colorMetric, metrics);
    return [
      metrics.includes(resolved)
        ? resolved
        : normalizeFormattingMetricForQuery(resolved),
    ];
  });
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

export const injectRowSubtotalLeaves = (
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) => {
  if (depth <= 0 || depth >= fullDepth) {
    return tree;
  }
  const next: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };
  const subtotalNodes = Object.values(tree.rows).filter(
    node =>
      node.path.length === depth &&
      node.path.length > 0 &&
      !node.path.some(val => isSubtotalToken(val) || val === 'Total'),
  );
  subtotalNodes.forEach(node => {
    const subtotalPath = [...node.path, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    if (!next.rows[subtotalKey]) {
      next.rows[subtotalKey] = {
        ...node,
        key: subtotalKey,
        path: subtotalPath,
        label: SUBTOTAL_LABEL,
        formattedLabel: SUBTOTAL_LABEL,
        level: subtotalPath.length,
        hasChildren: false,
        isSubtotal: true,
      };
    }
  });
  Object.values(tree.cells).forEach(cell => {
    const baseRowPath = tree.rows[cell.rowKey]?.path;
    if (
      !baseRowPath ||
      baseRowPath.length !== depth ||
      baseRowPath.length === 0 ||
      baseRowPath.some(val => isSubtotalToken(val) || val === 'Total')
    ) {
      return;
    }
    const subtotalRowKey = serializePath([...baseRowPath, SUBTOTAL_TOKEN]);
    const cellKey = `${subtotalRowKey}|${cell.colKey}`;
    next.cells[cellKey] = {
      ...cell,
      rowKey: subtotalRowKey,
      isSubtotal: true,
    };
  });
  return next;
};

export const labelRowSubtotalLeaves = (
  tree: PivotTreeData,
  metrics: QueryFormMetric[],
) => {
  const metricLabels = new Set(getMetricKeys(metrics));
  const isSingleMetric = metricLabels.size === 1;
  const nextRows: Record<string, PivotTreeNode> = { ...tree.rows };
  let hasChanges = false;

  Object.values(tree.rows).forEach(node => {
    const subtotalIndex = node.path.findIndex(isSubtotalToken);
    if (subtotalIndex < 0) {
      return;
    }
    let baseLabel = '';
    let baseLabelIndex: number | undefined;
    for (let i = subtotalIndex - 1; i >= 0; i -= 1) {
      const val = node.path[i];
      if (!metricLabels.has(String(val ?? '')) && !isSubtotalToken(val)) {
        baseLabel = String(val ?? '');
        baseLabelIndex = i;
        break;
      }
    }
    if (!baseLabel) {
      return;
    }
    let metricLabel: string | undefined;
    let metricLabelIndex: number | undefined;
    for (let i = subtotalIndex + 1; i < node.path.length; i += 1) {
      const val = node.path[i];
      if (metricLabels.has(String(val ?? ''))) {
        metricLabel = String(val ?? '');
        metricLabelIndex = i;
        break;
      }
    }
    if (!metricLabel) {
      for (let i = subtotalIndex - 1; i >= 0; i -= 1) {
        const val = node.path[i];
        if (metricLabels.has(String(val ?? ''))) {
          metricLabel = String(val ?? '');
          metricLabelIndex = i;
          break;
        }
      }
    }
    const hasMetricLabel = !!metricLabel;
    const metricBeforeBase =
      metricLabelIndex !== undefined &&
      baseLabelIndex !== undefined &&
      metricLabelIndex < baseLabelIndex;
    const useMetricLabel =
      !isSingleMetric && hasMetricLabel && !metricBeforeBase;
    const nextLabel = useMetricLabel
      ? `${baseLabel} ${metricLabel}`
      : `${baseLabel} Total`;
    if (node.label !== nextLabel || node.formattedLabel !== nextLabel) {
      nextRows[node.key] = {
        ...node,
        label: nextLabel,
        formattedLabel: nextLabel,
      };
      hasChanges = true;
    }
  });

  if (!hasChanges) {
    return tree;
  }
  return { ...tree, rows: nextRows };
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

export const mergeTrees = (
  left?: PivotTreeData,
  right?: PivotTreeData,
): PivotTreeData => {
  const mergeNodeMaps = (
    target?: Record<string, PivotTreeNode>,
    source?: Record<string, PivotTreeNode>,
  ) => {
    const result: Record<string, PivotTreeNode> = { ...(target || {}) };
    Object.entries(source || {}).forEach(([key, node]) => {
      const existing = result[key];
      if (!existing) {
        result[key] = node;
        return;
      }
      const mergedValues =
        node.values && Object.keys(node.values).length > 0
          ? { ...(existing.values || {}), ...node.values }
          : existing.values;
      result[key] = {
        ...existing,
        ...node,
        ...(mergedValues ? { values: mergedValues } : {}),
      };
    });
    return result;
  };

  const mergeCells = (
    target?: Record<string, PivotResultCell>,
    source?: Record<string, PivotResultCell>,
  ) => {
    const result: Record<string, PivotResultCell> = { ...(target || {}) };
    Object.entries(source || {}).forEach(([key, cell]) => {
      const existing = result[key];
      if (!existing) {
        result[key] = cell;
        return;
      }
      const mergedValues =
        cell.values && Object.keys(cell.values).length > 0
          ? { ...(existing.values || {}), ...cell.values }
          : existing.values;
      result[key] = {
        ...existing,
        ...cell,
        ...(mergedValues ? { values: mergedValues } : {}),
        isSubtotal: cell.isSubtotal ?? existing.isSubtotal,
      };
    });
    return result;
  };

  return {
    rows: mergeNodeMaps(left?.rows, right?.rows),
    cols: mergeNodeMaps(left?.cols, right?.cols),
    cells: mergeCells(left?.cells, right?.cells),
  };
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

export const applyMetricAxis = (
  tree: PivotTreeData,
  metrics: QueryFormMetric[],
  metricsLayout: MetricsLayoutEnum,
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  metricPosition?: number,
): PivotTreeData => {
  const metricKeys = getMetricKeys(metrics);
  if (metricKeys.length === 0) {
    return tree;
  }

  const result: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const metricLabelSet = new Set(metricKeys);

  const ensureNode = (
    axis: 'row' | 'col',
    path: PivotPath,
    fullDepth: number,
    isSubtotal?: boolean,
  ) => {
    const nodes = axis === 'row' ? result.rows : result.cols;
    const key = serializePath(path);
    if (nodes[key]) return nodes[key];
    const label =
      path.length === 0
        ? 'Grand total'
        : path[path.length - 1]?.toString() ?? 'Grand total';
    const isMetricNode = metricLabelSet.has(
      String(path[path.length - 1] ?? ''),
    );
    let hasChildren = path.length < fullDepth;
    if (isMetricNode) {
      if (
        axis === 'row' &&
        metricsLayout === MetricsLayoutEnum.ROWS &&
        (metricPosition ?? rowGroupby.length) >= rowGroupby.length
      ) {
        hasChildren = false;
      }
      if (
        axis === 'col' &&
        metricsLayout === MetricsLayoutEnum.COLUMNS &&
        (metricPosition ?? colGroupby.length) >= colGroupby.length
      ) {
        hasChildren = false;
      }
    }
    const isSubtotalValue =
      isSubtotal ??
      (path.length < fullDepth &&
        !(isMetricNode && hasChildren === false));
    const node = {
      axis,
      key,
      path,
      label,
      formattedLabel: label,
      level: path.length,
      hasChildren,
      isSubtotal: isSubtotalValue,
    };
    nodes[key] = node;
    return node;
  };

  if (metricsLayout === MetricsLayoutEnum.ROWS) {
    const rowDepthWithMetrics = rowGroupby.length + 1;
    const insertIndex = Math.min(
      metricPosition ?? rowGroupby.length,
      rowGroupby.length,
    );

    // Preserve the original row hierarchy so dimensions remain expandable when
    // metrics are inserted ahead of them.
    Object.values(tree.rows).forEach(rowNode =>
      ensureNode(
        'row',
        rowNode.path,
        rowGroupby.length,
        rowNode.isSubtotal || undefined,
      ),
    );

    // preserve column nodes
    Object.values(tree.cols).forEach(colNode => {
      ensureNode(
        'col',
        colNode.path,
        colGroupby.length,
        colNode.isSubtotal || undefined,
      );
    });

    Object.values(tree.cells).forEach(cell => {
      const baseRow = tree.rows[cell.rowKey];
      const baseCol = tree.cols[cell.colKey];
      const rowPath = baseRow?.path || [];
      const colPath = baseCol?.path || [];
      const rowPrefix = rowPath.slice(0, insertIndex);
      const rowSuffix = rowPath.slice(insertIndex);

      const rowKey = serializePath(rowPath);

      metricKeys.forEach(metric => {
        const mergedValues = {
          [metric]: cell.values[metric],
          ...cell.values,
        };
        const hasSubtotalAtInsert =
          rowSuffix.length > 0 &&
          (isSubtotalToken(rowSuffix[0]) || rowSuffix[0] === 'Total');
        const newRowPath = hasSubtotalAtInsert
          ? [...rowPrefix, rowSuffix[0], metric, ...rowSuffix.slice(1)]
          : [...rowPrefix, metric, ...rowSuffix];
        // ensure row hierarchy nodes
        for (let depth = 0; depth <= newRowPath.length; depth += 1) {
          const subPath = newRowPath.slice(0, depth);
          ensureNode(
            'row',
            subPath,
            rowDepthWithMetrics,
            baseRow?.isSubtotal || undefined,
          );
        }
        const newRowKey = serializePath(newRowPath);

        const colKey = serializePath(colPath);
        ensureNode(
          'col',
          colPath,
          colGroupby.length,
          baseCol?.isSubtotal || undefined,
        );

        result.cells[`${newRowKey}|${colKey}`] = {
          rowKey: newRowKey,
          colKey,
          values: mergedValues,
          isSubtotal: cell.isSubtotal,
        };
        // If there is only one metric and the metric tier is at the end,
        // also surface the value at the base row path so collapsed views
        // (before expanding into the metric tier) can render.
        if (
          metricKeys.length === 1 &&
          metricPosition !== 0
        ) {
          result.cells[`${rowKey}|${colKey}`] =
            result.cells[`${rowKey}|${colKey}`] || {
              rowKey,
              colKey,
              values: mergedValues,
              isSubtotal: cell.isSubtotal,
            };
        }
      });
    });
  } else {
    const colDepthWithMetrics = colGroupby.length + 1;
    const insertIndex = Math.min(
      metricPosition ?? colGroupby.length,
      colGroupby.length,
    );

    // Preserve the original column hierarchy so dimensions remain expandable when
    // metrics are inserted ahead of them.
    Object.values(tree.cols).forEach(colNode =>
      ensureNode(
        'col',
        colNode.path,
        colGroupby.length,
        colNode.isSubtotal || undefined,
      ),
    );

    // preserve row nodes
    Object.values(tree.rows).forEach(rowNode =>
      ensureNode(
        'row',
        rowNode.path,
        rowGroupby.length,
        rowNode.isSubtotal || undefined,
      ),
    );

    Object.values(tree.cells).forEach(cell => {
      const baseRow = tree.rows[cell.rowKey];
      const baseCol = tree.cols[cell.colKey];
      const rowPath = baseRow?.path || [];
      const colPath = baseCol?.path || [];
      const colPrefix = colPath.slice(0, insertIndex);
      const colSuffix = colPath.slice(insertIndex);

      const colKey = serializePath(colPath);

      metricKeys.forEach(metric => {
        const mergedValues = {
          [metric]: cell.values[metric],
          ...cell.values,
        };
        const newColPath = [...colPrefix, metric, ...colSuffix];
        for (let depth = 0; depth <= newColPath.length; depth += 1) {
          const subPath = newColPath.slice(0, depth);
          ensureNode(
            'col',
            subPath,
            colDepthWithMetrics,
            baseCol?.isSubtotal || undefined,
          );
        }
        const newColKey = serializePath(newColPath);

        const rowKey = serializePath(rowPath);
        ensureNode(
          'row',
          rowPath,
          rowGroupby.length,
          baseRow?.isSubtotal || undefined,
        );

        result.cells[`${rowKey}|${newColKey}`] = {
          rowKey,
          colKey: newColKey,
          values: mergedValues,
          isSubtotal: cell.isSubtotal,
        };
        if (metricKeys.length === 1 && metricPosition === 0) {
          const rootColKey = serializePath(colPrefix);
          result.cells[`${rowKey}|${rootColKey}`] =
            result.cells[`${rowKey}|${rootColKey}`] || {
              rowKey,
              colKey: rootColKey,
              values: mergedValues,
              isSubtotal: cell.isSubtotal,
            };
        }
        // If there is only one metric and the metric tier is at the end,
        // also surface the value at the base column path so collapsed views
        // (before expanding into the metric tier) can render.
        if (
          metricKeys.length === 1 &&
          (metricPosition === undefined ||
            metricPosition >= colGroupby.length ||
            metricPosition === 0)
        ) {
          const baseColKey = serializePath(colPath);
          result.cells[`${rowKey}|${baseColKey}`] =
            result.cells[`${rowKey}|${baseColKey}`] || {
              rowKey,
              colKey: baseColKey,
              values: mergedValues,
              isSubtotal: cell.isSubtotal,
            };
        }
      });
    });
  }

  return result;
};

export const buildTreeFromRecords = (
  records: DataRecord[],
  metrics: QueryFormMetric[],
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  rowDepth: number,
  colDepth: number,
): PivotTreeData => {
  const tree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const metricKeys = getMetricKeys(metrics);
  const rootKey = serializePath([]);
  let grandTotalValues: Record<string, DataRecordValue> = {};

  const ensureNode = (
    axis: 'row' | 'col',
    path: DataRecordValue[],
    totalLabel: string,
  ) => {
    const nodes = axis === 'row' ? tree.rows : tree.cols;
    const key = serializePath(path);
    if (nodes[key]) return;
    const label =
      path.length === 0
        ? 'Grand total'
        : path[path.length - 1]?.toString() ?? totalLabel;
    nodes[key] = {
      axis,
      key,
      path,
      label,
      formattedLabel: label,
      level: path.length,
      hasChildren:
        path.length < (axis === 'row' ? rowGroupby.length : colGroupby.length),
      isSubtotal:
        path.length < (axis === 'row' ? rowGroupby.length : colGroupby.length),
    };
  };

  records.forEach(record => {
    const rowPath = rowGroupby
      .slice(0, rowDepth)
      .map(col => record[getColumnLabel(col)]);
    const colPath = colGroupby
      .slice(0, colDepth)
      .map(col => record[getColumnLabel(col)]);

    // create intermediate row nodes
    for (let i = 0; i <= rowPath.length; i += 1) {
      ensureNode('row', rowPath.slice(0, i), 'Total');
    }
    // create intermediate col nodes
    for (let i = 0; i <= colPath.length; i += 1) {
      ensureNode('col', colPath.slice(0, i), 'Total');
    }

    const rowKey = serializePath(rowPath);
    const colKey = serializePath(colPath);

    const values = metricKeys.reduce(
      (acc, key) => ({
        ...acc,
        [key]: record[key as string],
      }),
      {} as Record<string, DataRecordValue>,
    );

    tree.rows[rowKey].values = { ...(tree.rows[rowKey].values || {}), ...values };
    tree.cols[colKey].values = { ...(tree.cols[colKey].values || {}), ...values };
    tree.cells[`${rowKey}|${colKey}`] = {
      rowKey,
      colKey,
      values,
      isSubtotal:
        rowPath.length < rowGroupby.length || colPath.length < colGroupby.length,
    };

    if (rowPath.length === 0 && colPath.length === 0) {
      grandTotalValues = { ...grandTotalValues, ...values };
    }
  });

  ensureNode('row', [], 'Grand total');
  ensureNode('col', [], 'Grand total');
  const mergedRootValues = {
    ...(tree.rows[rootKey]?.values || {}),
    ...(tree.cols[rootKey]?.values || {}),
    ...(Object.keys(grandTotalValues).length > 0 ? grandTotalValues : {}),
  };
  const hasGrandTotalValues = Object.keys(grandTotalValues).length > 0;
  const allowRootFallback = rowDepth === 0 && colDepth === 0;
  const rootValues = hasGrandTotalValues
    ? mergedRootValues
    : allowRootFallback && Object.keys(mergedRootValues).length > 0
    ? mergedRootValues
    : undefined;
  if (rootValues && !tree.cells[`${rootKey}|${rootKey}`]) {
    tree.cells[`${rootKey}|${rootKey}`] = {
      rowKey: rootKey,
      colKey: rootKey,
      values: rootValues,
      isSubtotal: true,
    };
  }

  return tree;
};
