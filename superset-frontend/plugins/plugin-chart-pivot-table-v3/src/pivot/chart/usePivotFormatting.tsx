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
import { t } from '@apache-superset/core/translation';
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
} from '@superset-ui/core';
import { supersetTheme, styled } from '@apache-superset/core/theme';
import {
  type DimensionFormattingScope,
  DIMENSION_FORMATTING_FIELDS,
  type MetricFormattingField,
  type DimensionFormattingField,
  type PivotMetricFormattingValue,
  type MetricFormattingScope,
  METRIC_FORMATTING_FIELDS,
  type PivotMetricDatabarMap,
  type PivotResultCell,
  type PivotTableProps,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import {
  DEFAULT_DATABAR_NEGATIVE_COLOR,
  DEFAULT_DATABAR_POSITIVE_COLOR,
  normalizeDimensionFormattingMapWithKeys,
  normalizeMetricDatabarMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  parseThemeColors,
  PIVOT_THEME_PRESETS,
} from '../../utils';
import { SUBTOTAL_LABEL, isSubtotalToken } from '../core/tokens';
import { getMetricKey } from '../metrics';
import { serializeCellKey, serializePath } from '../core/path';
import { formatMetricValue, rootKey } from '../viewModel';
import { buildMeasureLeafOutputKey, isValueLeaf } from '../measureLeaves';
import {
  deriveMetricKey as deriveMetricKeyBase,
  hasVisiblePartialData,
  formatNodeLabel as formatNodeLabelBase,
  shouldHideRowValues as shouldHideRowValuesBase,
} from '../cellUtils';
import { createMetricNodePolicy } from '../metricsTotals';
import { type RenderModel } from '../render/renderModel';
import { type PivotLayoutResult } from './usePivotLayout';
import { compileExcelFormula } from '../formatting/excelFormula';
import { isPivotExcelFormula } from '../formatting/excelFormulaReferences';
import {
  buildDatabarRuntimeModel,
  getNumericValue,
  resolveScaleBounds,
  resolveScaleGroupKey,
  toPercent,
} from './databarRuntime';

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

type FormattingValues = Record<string, DataRecordValue | undefined>;
type FormattingRule = (
  values: FormattingValues | undefined,
  currentValue: DataRecordValue | undefined,
) => unknown;
type FormattingRules<Field extends string> = Record<
  string,
  {
    fields: Partial<Record<Field, FormattingRule>>;
    applyTo: DimensionFormattingScope;
  }
>;

export type PivotFormattingResult = {
  hasPartialData: boolean;
  metricFormattingScope: MetricFormattingScope;
  metricDatabars: PivotMetricDatabarMap;
  databarColumnMinWidths: Map<string, number>;
  themeColor?: string;
  resolveDimensionStyle: (
    axis: 'row' | 'col',
    node: PivotTreeNode,
    target: 'label' | 'cell',
  ) => CSSProperties | undefined;
  resolveMetricCellFormatting: (
    metricKey: string,
    cell: PivotResultCell,
    isSubtotal: boolean,
    isGrandTotal: boolean,
  ) => CSSProperties & { d3FormatOverride?: string };
  deriveMetricKey: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => string;
  formatExportCell: (
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
  ) => string | number;
  renderCellContent: (
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
    metricKey: string,
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

const normalizeMetricCssColor = (rawValue: unknown) =>
  rawValue === null || rawValue === undefined
    ? undefined
    : String(rawValue).trim() || undefined;

const shouldApplyMetricFormatting = (
  scope: MetricFormattingScope,
  isSubtotal: boolean,
  isGrandTotal: boolean,
) =>
  scope === 'values'
    ? !isSubtotal && !isGrandTotal
    : scope === 'values_totals'
      ? !isGrandTotal
      : true;

/** Compiles every formatting source to the same field resolver. */
const buildFormattingRuntimeMap = <Field extends string>(
  formatting: Record<
    string,
    Partial<Record<Field, PivotMetricFormattingValue>> & {
      applyTo?: DimensionFormattingScope;
    }
  >,
  fieldNames: readonly Field[],
): FormattingRules<Field> =>
  Object.fromEntries(
    Object.entries(formatting).map(([key, config]) => {
      const fields: Partial<Record<Field, FormattingRule>> = {};
      for (const field of fieldNames) {
        const metric = config[field];
        if (!metric) continue;
        if (isPivotExcelFormula(metric)) {
          const formula = compileExcelFormula(metric.formula);
          fields[field] = (values, currentValue) =>
            !values && formula.metricReferences.length
              ? undefined
              : formula.evaluate(values ?? {}, currentValue);
        } else {
          const queryKey = getMetricKey(metric);
          if (queryKey) fields[field] = values => values?.[queryKey];
        }
      }
      return [key, { fields, applyTo: config.applyTo ?? 'all' }];
    }),
  );

export const usePivotFormatting = ({
  tree,
  renderModel,
  expandedRows,
  formData,
  layout,
  rowValuesMap,
  colValuesMap,
  getNodeDimDepth,
  theme: inputTheme,
}: {
  tree: PivotTreeData;
  renderModel: RenderModel;
  expandedRows: Set<string>;
  formData: PivotTableProps['formData'];
  layout: PivotLayoutResult;
  rowValuesMap: Map<string, Record<string, DataRecordValue>>;
  colValuesMap: Map<string, Record<string, DataRecordValue>>;
  getNodeDimDepth: (node: PivotTreeNode) => number;
  theme: PivotTableProps['theme'];
}): PivotFormattingResult => {
  const theme = inputTheme ?? supersetTheme;
  const {
    allowRenderHtml,
    columnFormats,
    currencyFormats,
    pivotTheme,
    pivotThemeColors,
    valueFormat,
  } = formData;
  const metricFormattingScope =
    (formData.metricFormattingScope as MetricFormattingScope) ||
    'values_totals';
  const { metrics, pivotProgram } = layout.layout;
  const { rowSubTotals } = layout.layout;

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
        pivotProgram.rowDimensions,
      ),
    [formData.rowFormatting, pivotProgram.rowDimensions],
  );
  const colFormatting = useMemo(
    () =>
      normalizeDimensionFormattingMapWithKeys(
        formData.colFormatting,
        pivotProgram.columnDimensions,
      ),
    [formData.colFormatting, pivotProgram.columnDimensions],
  );
  const derivedFormatOverrides = useMemo(() => {
    const columnOverrides: Record<string, string> = {};
    const currencyOverrides: Record<string, Currency> = {};
    layout.layout.measureHierarchy.groups.forEach(group => {
      group.leaves.forEach(leaf => {
        if (isValueLeaf(leaf)) {
          return;
        }
        const outputKey = buildMeasureLeafOutputKey(group.metricKey, leaf);
        const customMetricKey =
          leaf.kind === 'custom' ? getMetricKey(leaf.metric) : undefined;
        const formatMetricKey =
          leaf.kind === 'custom' ? customMetricKey : group.metricKey;
        const leafFormat = formatMetricKey
          ? columnFormats?.[formatMetricKey]
          : undefined;
        const leafCurrency = formatMetricKey
          ? currencyFormats?.[formatMetricKey]
          : undefined;
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
  }, [columnFormats, currencyFormats, layout.layout.measureHierarchy]);

  const effectiveColumnFormats = useMemo(
    () => ({ ...derivedFormatOverrides.columnOverrides, ...columnFormats }),
    [columnFormats, derivedFormatOverrides.columnOverrides],
  );
  const effectiveCurrencyFormats = useMemo(
    () => ({ ...derivedFormatOverrides.currencyOverrides, ...currencyFormats }),
    [currencyFormats, derivedFormatOverrides.currencyOverrides],
  );

  const metricFormattingRules = useMemo(
    () => buildFormattingRuntimeMap(metricFormatting, METRIC_FORMATTING_FIELDS),
    [metricFormatting],
  );
  const resolveMetricD3Format = useCallback(
    (
      metricKey: string,
      cell: PivotResultCell,
      currentValue: DataRecordValue | undefined,
    ) =>
      normalizeD3Format(
        metricFormattingRules[metricKey]?.fields.d3Format?.(
          cell.values,
          currentValue,
        ) as DataRecordValue,
      ),
    [metricFormattingRules],
  );

  const resolveMetricCellFormatting = useCallback(
    (
      metricKey: string,
      cell: PivotResultCell,
      isSubtotal: boolean,
      isGrandTotal: boolean,
    ) => {
      const currentValue = cell.values[metricKey];
      const rules = metricFormattingRules[metricKey];
      const applyColorFormatting = shouldApplyMetricFormatting(
        metricFormattingScope,
        isSubtotal,
        isGrandTotal,
      );
      const resolveColor = (field: MetricFormattingField) =>
        applyColorFormatting
          ? normalizeMetricCssColor(
              rules?.fields[field]?.(cell.values, currentValue),
            )
          : undefined;
      const backgroundColor = resolveColor('backgroundColor');
      const color = resolveColor('textColor');
      const d3FormatOverride = resolveMetricD3Format(
        metricKey,
        cell,
        currentValue,
      );
      return {
        ...(backgroundColor ? { backgroundColor } : {}),
        ...(color ? { color } : {}),
        ...(d3FormatOverride ? { d3FormatOverride } : {}),
      };
    },
    [metricFormattingRules, metricFormattingScope, resolveMetricD3Format],
  );

  const rowFormattingRuntimeMap = useMemo(
    () => buildFormattingRuntimeMap(rowFormatting, DIMENSION_FORMATTING_FIELDS),
    [rowFormatting],
  );
  const colFormattingRuntimeMap = useMemo(
    () => buildFormattingRuntimeMap(colFormatting, DIMENSION_FORMATTING_FIELDS),
    [colFormatting],
  );

  const metricNodePolicy = useMemo(
    () => createMetricNodePolicy(layout.layout.pivotProgram),
    [layout.layout.pivotProgram],
  );

  const resolveDimensionStyle = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode, target: 'label' | 'cell') => {
      if (
        node.path.length === 0 ||
        metricNodePolicy.isMetricGrandTotalNode(node)
      ) {
        return undefined;
      }
      const dimensionKey = metricNodePolicy.getDimensionKeyForNode(node, axis);
      const formatting = dimensionKey
        ? (axis === 'row' ? rowFormattingRuntimeMap : colFormattingRuntimeMap)[
            dimensionKey
          ]
        : undefined;
      if (!formatting || (target === 'cell' && formatting.applyTo !== 'all'))
        return undefined;
      const nonMetricParts = metricNodePolicy.getNonMetricPathParts(node.path);
      const nonMetricKey = serializePath(nonMetricParts);
      const dimensionValue =
        nonMetricParts.length > 0
          ? nonMetricParts[nonMetricParts.length - 1]
          : (node.path[node.path.length - 1] ?? node.label ?? undefined);
      const values =
        axis === 'row'
          ? rowValuesMap.get(nonMetricKey)
          : colValuesMap.get(nonMetricKey);
      const resolveColor = (field: DimensionFormattingField) => {
        const result = formatting.fields[field]?.(values, dimensionValue);
        return typeof result === 'string'
          ? normalizeCssColor(result)
          : undefined;
      };
      const backgroundColor = resolveColor('backgroundColor');
      const textColor = resolveColor('textColor');
      if (!backgroundColor && !textColor) {
        return undefined;
      }
      return {
        ...(backgroundColor ? { backgroundColor } : {}),
        ...(textColor ? { color: textColor } : {}),
      };
    },
    [
      colFormattingRuntimeMap,
      colValuesMap,
      metricNodePolicy,
      rowFormattingRuntimeMap,
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
        program: layout.layout.pivotProgram,
        measureHierarchy: layout.layout.measureHierarchy,
      }),
    [layout.layout.measureHierarchy, layout.layout.pivotProgram],
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

  const databarScaleWidth = theme.sizeUnit * 12;
  const databarPaddingX = theme.sizeUnit * 2;

  const metricsForScale = useMemo(() => {
    const targets = new Set<string>();
    Object.entries(metricDatabars).forEach(([metricKey, config]) => {
      targets.add(metricKey);
      const scaleKey = config.scaleLike ? getMetricKey(config.scaleLike) : '';
      if (scaleKey) {
        targets.add(scaleKey);
      }
    });
    return targets;
  }, [metricDatabars]);

  const isRowTotalAtStart =
    layout.layout.colTotalPosition === 'start' && renderModel.showRowRoot;
  const visibleCells = renderModel.visibleCellEntries;
  const { visibleRows, visibleCols } = renderModel;

  const shouldHideRowValues = useCallback(
    (rowNode: PivotTreeNode) =>
      shouldHideRowValuesBase({
        rowNode,
        rowSubTotals,
        effectiveRowSubtotalPosition: layout.getRowSubtotalPosition(rowNode),
        metricLabelSet: metricNodePolicy.metricLabelSet,
        expandedRows,
        countDimDepth: metricNodePolicy.countDimDepth,
        rowSubtotalLevels: layout.layout.rowSubtotalLevels,
      }),
    [expandedRows, layout, metricNodePolicy, rowSubTotals],
  );

  const {
    databarScales,
    waterfallOffsets,
    waterfallScales,
    databarLabelSpaces,
    databarColumnMinWidths,
    waterfallBridgeOffsets,
  } = useMemo(
    () =>
      buildDatabarRuntimeModel({
        metricDatabars,
        metricsForScale,
        visibleCells,
        visibleRows,
        visibleCols,
        cells: tree.cells,
        expandedRows,
        isRowTotalAtStart,
        databarScaleWidth,
        databarPaddingX,
        themeSizeUnit: theme.sizeUnit,
        pivotProgram: layout.layout.pivotProgram,
        deriveMetricKey,
        getNodeDimDepth,
        shouldHideRowValues,
        resolveMetricD3Format,
        renderValue,
      }),
    [
      databarPaddingX,
      databarScaleWidth,
      deriveMetricKey,
      expandedRows,
      getNodeDimDepth,
      isRowTotalAtStart,
      layout.layout.pivotProgram,
      metricDatabars,
      metricsForScale,
      renderValue,
      resolveMetricD3Format,
      shouldHideRowValues,
      theme.sizeUnit,
      tree.cells,
      visibleCells,
      visibleCols,
      visibleRows,
    ],
  );

  const getCellValue = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode, metricKey: string) =>
      shouldHideRowValues(rowNode)
        ? undefined
        : tree.cells[serializeCellKey(rowNode.key, colNode.key)]?.values[
            metricKey
          ],
    [shouldHideRowValues, tree.cells],
  );
  const formatExportCell = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      const metricKey = deriveMetricKey(rowNode, colNode);
      const value = getCellValue(rowNode, colNode, metricKey);
      if (value === undefined) return '';
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const cell = tree.cells[serializeCellKey(rowNode.key, colNode.key)];
      const override = cell
        ? resolveMetricD3Format(metricKey, cell, value)
        : undefined;
      const formatted = renderValue(metricKey, value, override);
      return typeof formatted === 'string' || typeof formatted === 'number'
        ? formatted
        : '';
    },
    [
      deriveMetricKey,
      getCellValue,
      renderValue,
      resolveMetricD3Format,
      tree.cells,
    ],
  );

  const renderCellContent = useCallback(
    (
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
      metricKey: string,
      d3FormatOverride?: string,
    ) => {
      const rawValue = getCellValue(rowNode, colNode, metricKey);
      if (rawValue === undefined) return '';
      const value = renderValue(metricKey, rawValue, d3FormatOverride);
      if (allowRenderHtml && typeof value === 'string' && value.includes('<')) {
        return safeHtmlSpan(value);
      }
      return value;
    },
    [allowRenderHtml, renderValue, getCellValue],
  );

  const renderDatabarContent = useCallback(
    (
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
      cell: PivotResultCell | undefined,
      metricKey: string,
      d3FormatOverride?: string,
    ) => {
      if (shouldHideRowValues(rowNode)) return '';
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
            ? getMetricKey(config.colorMetric)
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
      shouldHideRowValues,
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
        program: layout.layout.pivotProgram,
        getMetricDisplayLabelForKey: layout.getMetricDisplayLabelForKey,
        translate: t,
        subtotalLabel: SUBTOTAL_LABEL,
        isSubtotalToken,
      }),
    [layout],
  );

  return {
    hasPartialData: hasVisiblePartialData(
      renderModel,
      deriveMetricKey,
      shouldHideRowValues,
    ),
    metricFormattingScope,
    metricDatabars,
    databarColumnMinWidths,
    themeColor,
    resolveDimensionStyle,
    resolveMetricCellFormatting,
    deriveMetricKey,
    formatExportCell,
    renderCellContent,
    renderDatabarContent,
    formatLabel,
    getTotalBackground,
  };
};
