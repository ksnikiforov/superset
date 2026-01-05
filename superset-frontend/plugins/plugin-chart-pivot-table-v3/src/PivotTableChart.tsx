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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LoadingOutlined,
  MinusSquareOutlined,
  PlusSquareOutlined,
} from '@ant-design/icons';
import {
  BinaryQueryObjectFilterClause,
  DataRecordValue,
  GenericDataType,
  getColumnLabel,
  getNumberFormatter,
  styled,
  t,
} from '@superset-ui/core';
import { fetchPivotBranch, peekPivotBranchCache } from './fetchPivotBranch';
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
  PivotSortOrder,
  PivotSortMode,
} from './types';
import {
  isMetricsPlaceholder,
  isSubtotalToken,
  getFormattingMetricKey,
  getMetricKey,
  mergeTrees,
  normalizeDimensionFormattingMapWithKeys,
  normalizeDimensionSortingMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
  normalizeSubtotalLevels,
  parseThemeColors,
  PIVOT_THEME_PRESETS,
  resolveMetricPlacement,
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
import {
  buildVisibleCols,
  buildVisibleRows,
  createColLeavesBuilder,
  getExpandedDepths,
  getVisibleDepths,
  hasLoadedChildren as hasLoadedChildrenBase,
} from './pivot/visibility';
import { buildCellFilters, buildContextMenuFilters } from './pivot/filters';
import {
  deriveMetricKey as deriveMetricKeyBase,
  formatNodeLabel as formatNodeLabelBase,
  shouldHideRowValues as shouldHideRowValuesBase,
} from './pivot/cellUtils';

const Container = styled.div<{ height: number; width: number | string }>`
  ${({ height, width }) => `
    height: ${height}px;
    width: ${typeof width === 'string' ? width : `${width}px`};
    overflow: auto;
  `}
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th,
  td {
    border: 1px solid ${({ theme }) => (theme as any).colors?.grayscale?.light2 || (theme as any).colorBorder};
    padding: 6px 8px;
  }

  thead th {
    background: ${({ theme }) =>
      (theme as any).colors?.grayscale?.light4 || (theme as any).colorBgLayout};
    text-align: left;
    vertical-align: top;
  }

  td.value-cell {
    text-align: right;
  }

  tbody th {
    background: ${({ theme }) =>
      (theme as any).colorBgContainer || '#fff'};
    text-align: left;
    vertical-align: top;
  }

  .subtotal-cell {
    font-weight: 600;
  }
`;

const HeaderCell = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => ((theme as any).gridUnit || 4) * 1.5}px;
`;

const ColumnHeaderCell = styled(HeaderCell)`
  align-items: flex-start;
  line-height: 1.2;
`;

const ROW_INDENT_PX = 16;

const ToggleButton = styled.button`
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  color: ${({ theme }) => (theme as any).colors?.grayscale?.base || (theme as any).colorText};

  &:disabled {
    cursor: default;
    color: ${({ theme }) => (theme as any).colors?.grayscale?.light1 || (theme as any).colorTextQuaternary};
  }
`;

const Spinner = styled(LoadingOutlined)`
  font-size: 12px;
`;

type FormattingKeys = {
  [key in MetricFormattingField]?: string;
};

type DimensionFormattingKeys = {
  [key in DimensionFormattingField]?: string;
} & { applyTo: DimensionFormattingScope };

type DimensionSortingKeys = {
  metricKey?: string;
  order: PivotSortOrder;
  mode: PivotSortMode;
};

const DEFAULT_DIMENSION_SORT_ORDER: PivotSortOrder = 'asc';

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

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
  if (HEX_COLOR_PATTERN.test(value)) {
    return value;
  }
  const rgbMatch = value.match(/^rgba?\((.*)\)$/i);
  if (!rgbMatch) {
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

const normalizeD3Format = (rawValue: DataRecordValue) => {
  if (typeof rawValue !== 'string') {
    return undefined;
  }
  const value = rawValue.trim();
  return value.length > 0 ? value : undefined;
};

const shouldApplyMetricFormatting = (
  scope: MetricFormattingScope,
  isTotalCell: boolean,
  isGrandTotalCell: boolean,
) => {
  if (scope === 'values') {
    return !isTotalCell;
  }
  if (scope === 'values_totals') {
    return !isGrandTotalCell;
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
    maxDepthPerFetch,
    rowOrder,
    colOrder,
    valueFormat,
    columnFormats,
    currencyFormats,
    allowRenderHtml,
    setDataMask,
    emitCrossFilters,
    onContextMenu,
    timeGrainSqla,
    dateFormatters = {},
    colTypeMap,
    metricsLayout = MetricsLayoutEnum.COLUMNS,
    rowSubtotalLevels = [],
    colSubtotalLevels = [],
    rowTotals = false,
    colTotals = false,
    rowSubTotals = false,
    colSubTotals = false,
    rowTotalPosition = 'start',
    rowSubtotalPosition = 'start',
    colTotalPosition = 'start',
    colSubtotalPosition = 'start',
    pivotTheme = 'none',
    pivotThemeColors = '',
  } = props;
  const fetchFormData = queryFormData || formData;
  const resolvedMetricsLayout =
    (formData.metricsLayout as MetricsLayoutEnum) || metricsLayout;
  const metricFormattingScope =
    (formData.metricFormattingScope as MetricFormattingScope) || 'values';
  const metricFormatting = normalizeMetricFormattingMapWithKeys(
    formData.metricFormatting,
    metrics,
  );
  const rowFormatting = useMemo(
    () => normalizeDimensionFormattingMapWithKeys(
      formData.rowFormatting,
      groupbyRows,
    ),
    [formData.rowFormatting, groupbyRows],
  );
  const colFormatting = useMemo(
    () => normalizeDimensionFormattingMapWithKeys(
      formData.colFormatting,
      groupbyColumns,
    ),
    [formData.colFormatting, groupbyColumns],
  );
  const rowSorting = useMemo(
    () => normalizeDimensionSortingMapWithKeys(
      formData.rowSorting,
      groupbyRows,
    ),
    [formData.rowSorting, groupbyRows],
  );
  const colSorting = useMemo(
    () => normalizeDimensionSortingMapWithKeys(
      formData.colSorting,
      groupbyColumns,
    ),
    [formData.colSorting, groupbyColumns],
  );
  const formattingKeyMap = useMemo(() => {
    const next: Record<string, FormattingKeys> = {};
    Object.entries(metricFormatting).forEach(([metricKey, formatting]) => {
      if (!metricKey) {
        return;
      }
      const formattingKeys = METRIC_FORMATTING_FIELDS.reduce(
        (acc, field) => {
          const key = formatting?.[field]
            ? getFormattingMetricKey(formatting[field])
            : '';
          if (key) {
            acc[field] = key;
          }
          return acc;
        },
        {} as FormattingKeys,
      );
      if (Object.keys(formattingKeys).length > 0) {
        next[metricKey] = formattingKeys;
      }
    });
    return next;
  }, [metricFormatting]);
  const buildDimensionFormattingKeyMap = useCallback(
    (formatting: PivotDimensionFormattingMap) => {
      const next: Record<string, DimensionFormattingKeys> = {};
      Object.entries(formatting).forEach(([dimensionKey, dimensionFormatting]) => {
        if (!dimensionKey) {
          return;
        }
        const formattingKeys = DIMENSION_FORMATTING_FIELDS.reduce(
          (acc, field) => {
            const key = dimensionFormatting?.[field]
              ? getFormattingMetricKey(dimensionFormatting[field])
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
      });
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
    () => rowSubtotalLevels.filter(level => level === 0),
    [rowSubtotalLevels],
  );
  const rowSubtotalDepths = useMemo(
    () => rowSubtotalLevels.filter(level => level > 0),
    [rowSubtotalLevels],
  );
  const normalizedColSubtotalLevels = useMemo(
    () =>
      normalizeSubtotalLevels(
        colSubtotalLevels,
        Math.max(groupbyColumns.length - 1, 0),
        false,
        colSubtotalLevels.length === 0 && colSubTotals,
      ),
    [colSubtotalLevels, colSubTotals, groupbyColumns.length],
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
  }, [groupbyRows.length, metricPlacement.metricPosition, resolvedMetricsLayout]);
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

  const [tree, setTree] = useState<PivotTreeData>(data);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const expandedRowsRef = useRef(expandedRows);
  const expandedColsRef = useRef(expandedCols);
  const [fullyExpandedRows, setFullyExpandedRows] = useState<Set<string>>(
    new Set(),
  );
  const [fullyExpandedCols, setFullyExpandedCols] = useState<Set<string>>(
    new Set(),
  );
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const loadingCountsRef = useRef<Map<string, number>>(new Map());
  const [errorMessage, setErrorMessage] = useState<string>();
  const [fetchedRowKeys, setFetchedRowKeys] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [fetchedColKeys, setFetchedColKeys] = useState<Map<string, number>>(
    () => new Map(),
  );

  const updateLoadingKey = useCallback((key: string, delta: number) => {
    const counts = new Map(loadingCountsRef.current);
    const nextCount = (counts.get(key) ?? 0) + delta;
    if (nextCount <= 0) {
      counts.delete(key);
    } else {
      counts.set(key, nextCount);
    }
    loadingCountsRef.current = counts;
    setLoadingKeys(new Set(counts.keys()));
  }, []);
  const setExpandedRowsState = useCallback((next: Set<string>) => {
    expandedRowsRef.current = next;
    setExpandedRows(next);
  }, []);
  const setExpandedColsState = useCallback((next: Set<string>) => {
    expandedColsRef.current = next;
    setExpandedCols(next);
  }, []);

  const numberFormatter = useMemo(
    () => getNumberFormatter(valueFormat),
    [valueFormat],
  );

  useEffect(() => {
    setTree(data);
    const resolvedInitialDepth = initialDepth ?? 1;
    const maxRowDepth =
      Object.values(data.rows).reduce(
        (max, node) => Math.max(max, node.level),
        0,
      ) + 1;
    const maxColDepth =
      Object.values(data.cols).reduce(
        (max, node) => Math.max(max, node.level),
        0,
      ) + 1;
    const seedRowDepth = startCollapsed ? 0 : maxRowDepth;
    const seedColDepth = startCollapsed ? 0 : maxColDepth;
    const seedExpanded = (nodes: Record<string, PivotTreeNode>) => {
      const next = new Set<string>([rootKey]);
      Object.values(nodes).forEach(node => {
        const depthLimit = nodes === data.rows ? seedRowDepth : seedColDepth;
        if (node.level > 0 && node.level <= depthLimit) {
          next.add(node.key);
        }
      });
      return next;
    };
    setExpandedRowsState(seedExpanded(data.rows));
    setExpandedColsState(seedExpanded(data.cols));
    setFullyExpandedRows(new Set());
    setFullyExpandedCols(new Set());
    setFetchedRowKeys(new Map());
    setFetchedColKeys(new Map());
    loadingCountsRef.current = new Map();
    setLoadingKeys(new Set());
  }, [data, initialDepth, setExpandedColsState, setExpandedRowsState, startCollapsed]);

  const metricLabels = metrics.map(m =>
    typeof m === 'string' ? m : getColumnLabel(m as any),
  );
  const metricOrderKey = metricLabels.join('|');
  const metricLabelSet = useMemo(
    () => new Set(metricLabels),
    [metricOrderKey],
  );
  const metricOrderMap = useMemo(
    () => new Map(metricLabels.map((label, idx) => [label, idx])),
    [metricOrderKey],
  );
  const isMultiMetric = metricLabels.length > 1;
  const maxColDimDepth = useMemo(
    () =>
      Object.values(tree.cols).reduce(
        (max, node) =>
          Math.max(
            max,
            getNonMetricPathPartsBase(node.path, metricLabelSet).length,
          ),
        0,
      ),
    [metricLabelSet, tree.cols],
  );

  const findMetricIndex = useCallback(
    (nodes: Record<string, PivotTreeNode>) => {
      let found: number | undefined;
      let foundFromSubtotal: number | undefined;
      Object.values(nodes).forEach(node => {
        const idx = node.path.findIndex(val =>
          metricLabelSet.has(String(val ?? '')),
        );
        if (idx < 0) {
          return;
        }
        if (node.path.some(val => isSubtotalToken(val) || val === 'Total')) {
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
    [metricLabelSet],
  );

  const metricIndexOnRows = useMemo(() => {
    const treeIndex = findMetricIndex(tree.rows);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnRows;
  }, [findMetricIndex, metricInsertIndexOnRows, tree.rows]);
  const metricIndexOnCols = useMemo(() => {
    const treeIndex = findMetricIndex(tree.cols);
    if (treeIndex !== undefined) {
      return treeIndex;
    }
    return metricInsertIndexOnCols;
  }, [findMetricIndex, metricInsertIndexOnCols, tree.cols]);
  const metricDimIndexOnRows = useMemo(() => {
    if (resolvedMetricsLayout !== MetricsLayoutEnum.ROWS) {
      return undefined;
    }
    const maxDimDepth = Object.values(tree.rows).reduce((max, node) => {
      if (node.path.some(val => isSubtotalToken(val) || val === 'Total')) {
        return max;
      }
      return Math.max(max, countDimDepthBase(node.path, metricLabelSet));
    }, 0);
    let found: number | undefined;
    Object.values(tree.rows).forEach(node => {
      if (node.path.some(val => isSubtotalToken(val) || val === 'Total')) {
        return;
      }
      if (countDimDepthBase(node.path, metricLabelSet) !== maxDimDepth) {
        return;
      }
      const idx = node.path.findIndex(val =>
        metricLabelSet.has(String(val ?? '')),
      );
      if (idx < 0) {
        return;
      }
      let dimIndex = 0;
      for (let i = 0; i < idx; i += 1) {
        const val = node.path[i];
        if (metricLabelSet.has(String(val ?? ''))) {
          continue;
        }
        if (isSubtotalToken(val) || val === 'Total') {
          continue;
        }
        dimIndex += 1;
      }
      found = found === undefined ? dimIndex : Math.min(found, dimIndex);
    });
    return found;
  }, [metricLabelSet, resolvedMetricsLayout, tree.rows]);
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
    ? metricInsertIndexOnRows ?? metricIndexOnRows
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
    resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS && metricIndexOnCols === 0;
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

  const getRowSubtotalPosition = useCallback(
    (node: PivotTreeNode) => {
      if (!forceRowSubtotalEnd) {
        return resolvedRowSubtotalPosition;
      }
      const metricIndex = node.path.findIndex(val =>
        metricLabelSet.has(String(val ?? '')),
      );
      if (metricIndex < 0) {
        return 'end';
      }
      return node.path.length > metricIndex + 1
        ? resolvedRowSubtotalPosition
        : 'end';
    },
    [
      forceRowSubtotalEnd,
      metricLabelSet,
      resolvedRowSubtotalPosition,
    ],
  );

  const getRawRowChildren = useCallback(
    (parent: PivotTreeNode) => findChildren(tree.rows, parent),
    [tree.rows],
  );

  const getRawColChildren = useCallback(
    (parent: PivotTreeNode) => findChildren(tree.cols, parent),
    [tree.cols],
  );

  const getCollapsedRowChildren = useCallback(
    (parent: PivotTreeNode) => {
      if (
        !isMultiMetric ||
        resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
        expandedRows.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (isExplicitSubtotalNode(parent) || isMetricSubtotalNode(parent)) {
        return [] as PivotTreeNode[];
      }
      if (
        parent.path.some(val => metricLabelSet.has(String(val ?? '')))
      ) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(tree.rows, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(tree.rows, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyRows.length;
      const metricLabels = Array.from(
        new Set(
          metricNodes.map(node => String(node.path[metricDepth] ?? '')),
        ),
      );
      return metricLabels.map(metricLabel => {
        const collapsedPath = [...parent.path, metricLabel];
        const collapsedKey = serializePath(collapsedPath);
        const existing = tree.rows[collapsedKey];
        if (existing) {
          const hasChildren = metricsAtRowEnd
            ? false
            : getRawRowChildren(existing).length > 0 || hasMetricChildren;
          return { ...existing, hasChildren };
        }
        const sourceNode = metricNodes.find(
          node => String(node.path[metricDepth] ?? '') === metricLabel,
        );
        const hasChildren = metricsAtRowEnd
          ? false
          : Object.values(tree.rows).some(
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
      expandedRows,
      isExplicitSubtotalNode,
      getMetricDepthForParent,
      getMetricTierNodes,
      getRawRowChildren,
      groupbyRows.length,
      isMultiMetric,
      isMetricSubtotalNode,
      metricLabelSet,
      metricsAtRowEnd,
      resolvedMetricsLayout,
      tree.rows,
    ],
  );

  const getCollapsedColLeaves = useCallback(
    (parent: PivotTreeNode) => {
      if (
        !isMultiMetric ||
        resolvedMetricsLayout !== MetricsLayoutEnum.COLUMNS ||
        expandedCols.has(parent.key)
      ) {
        return [] as PivotTreeNode[];
      }
      if (
        parent.path.some(val => metricLabelSet.has(String(val ?? '')))
      ) {
        return [] as PivotTreeNode[];
      }
      const metricDepth = getMetricDepthForParent(tree.cols, parent);
      if (metricDepth === undefined || parent.path.length > metricDepth) {
        return [] as PivotTreeNode[];
      }
      const metricNodes = getMetricTierNodes(tree.cols, parent, metricDepth);
      if (metricNodes.length === 0) {
        return [] as PivotTreeNode[];
      }
      const hasMetricChildren = metricDepth < groupbyColumns.length;
      const metricLabels = Array.from(
        new Set(
          metricNodes.map(node => String(node.path[metricDepth] ?? '')),
        ),
      );
      return metricLabels.map(metricLabel => {
        const collapsedPath = [...parent.path, metricLabel];
        const collapsedKey = serializePath(collapsedPath);
        const sourceNode = metricNodes.find(
          node => String(node.path[metricDepth] ?? '') === metricLabel,
        );
        const existing = tree.cols[collapsedKey];
        if (existing) {
          const hasChildren =
            metricsAtColEnd
              ? false
              : getRawColChildren(existing).length > 0 || hasMetricChildren;
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
          : getRawColChildren({ ...parent, path: collapsedPath }).length > 0 ||
            hasMetricChildren;
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
      expandedCols,
      getMetricDepthForParent,
      getMetricTierNodes,
      getRawColChildren,
      groupbyColumns.length,
      isMultiMetric,
      isMetricSubtotalNode,
      metricLabelSet,
      metricsAtColEnd,
      resolvedMetricsLayout,
      tree.cols,
    ],
  );

  const getRowChildren = useCallback(
    (parent: PivotTreeNode) => {
      const rowSubtotalPositionForParent = getRowSubtotalPosition(parent);
      const isMetricSubtotalAtMetricTier = (node: PivotTreeNode) => {
        if (
          resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
          !isMultiMetric
        ) {
          return false;
        }
        const subtotalIndex = node.path.findIndex(val =>
          isSubtotalToken(val) || val === 'Total',
        );
        if (subtotalIndex <= 0) {
          return false;
        }
        const prev = node.path[subtotalIndex - 1];
        return metricLabelSet.has(String(prev ?? ''));
      };
      const children = getRawRowChildren(parent);
      const parentHasMetric = parent.path.some(val =>
        metricLabelSet.has(String(val ?? '')),
      );
      const filteredByMetricPosition = parentHasMetric
        ? children
        : children.filter(child => {
            if (metricIndexForRows === undefined) {
              return true;
            }
            if (child.path.length <= metricIndexForRows) {
              return true;
            }
            const metricAtIndex = metricLabelSet.has(
              String(child.path[metricIndexForRows] ?? ''),
            );
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
          const metricAtLevel = metricLabelSet.has(
            String(child.path[parent.level] ?? ''),
          );
          return !metricAtLevel;
        });
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = metricLabelSet.has(
            String(child.path[parent.level] ?? ''),
          );
          if (!metricAtLevel) {
            return true;
          }
          if (hasNonMetricChildren) {
            if (
              !rowTotals &&
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
          child => !metricLabelSet.has(String(child.path[parent.level] ?? '')),
        );
      }
      if (metricsFirstOnRows) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      if (
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        !isMultiMetric
      ) {
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
        const isSubtotalLevelToken = (val: unknown) =>
          isSubtotalToken(val) || val === 'Total';
        const subtotalDescendants = Object.values(tree.rows).filter(node => {
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
            return !node.path.some(val =>
              metricLabelSet.has(String(val ?? '')),
            );
          }
          if (requireMetricLabel) {
            return node.path.some(val =>
              metricLabelSet.has(String(val ?? '')),
            );
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
          return child.path.some(val => metricLabelSet.has(String(val ?? '')));
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
          const label = child.label ?? '';
          const formattedLabel = child.formattedLabel ?? '';
          if (
            metricLayoutIndexOnRows !== undefined &&
            metricLayoutIndexOnRows > 1 &&
            (child.path.some(val => val === 'Total') ||
              (typeof label === 'string' && label.endsWith(' Total')) ||
              (typeof formattedLabel === 'string' &&
                formattedLabel.endsWith(' Total')))
          ) {
            return true;
          }
          const dimDepth = countDimDepth(child.path);
          const subtotalDepth =
            child.path.some(val => isSubtotalToken(val) || val === 'Total')
              ? Math.max(dimDepth - 1, 0)
              : dimDepth;
          return subtotalDepth !== suppressDepth;
        });
      }
      if (rowSubTotals && !isMultiMetric) {
        filtered = filtered.filter(child => !isMetricSubtotalAtMetricTier(child));
      }
      return filtered;
    },
    [
      countDimDepth,
      getRowSubtotalPosition,
      getRawRowChildren,
      groupbyRows.length,
      metricIndexForRows,
      metricIndexOnRows,
      metricLayoutIndexOnRows,
      hideMetricHeaderOnRows,
      metricLabelSet,
      metricDimIndexOnRows,
      resolvedMetricsLayout,
      isMultiMetric,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      metricsFirstOnRows,
      rowTotals,
      rowSubTotals,
      tree.rows,
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
      if (parent.path.some(val => metricLabelSet.has(String(val ?? '')))) {
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
          const metricIdx = node.path.findIndex(val =>
            metricLabelSet.has(String(val ?? '')),
          );
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
          return metricLabelSet.has(String(valAtIndex ?? ''));
        });
      const shouldPruneCollapsedChildren = hasMetricAtLayoutIndex(parent);
      rowNodes.forEach(node => {
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        const metricIdx = node.path.findIndex(val =>
          metricLabelSet.has(String(val ?? '')),
        );
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
      metricLabelSet,
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
      if (parent.path.some(val => metricLabelSet.has(String(val ?? '')))) {
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
      metricLabelSet,
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
      if (parent.path.some(val => metricLabelSet.has(String(val ?? '')))) {
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
          const metricIdx = node.path.findIndex(val =>
            metricLabelSet.has(String(val ?? '')),
          );
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
          return metricLabelSet.has(String(valAtIndex ?? ''));
        });
      const shouldPruneCollapsedChildren = hasMetricAtLayoutIndex(parent);
      colNodes.forEach(node => {
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        const metricIdx = node.path.findIndex(val =>
          metricLabelSet.has(String(val ?? '')),
        );
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
      metricLabelSet,
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
      if (parent.path.some(val => metricLabelSet.has(String(val ?? '')))) {
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
      metricLabelSet,
      metricLayoutIndexOnCols,
      resolvedMetricsLayout,
    ],
  );

  const getColChildren = useCallback(
    (parent: PivotTreeNode) => {
      const children = getRawColChildren(parent);
      const filteredByMetricPosition = children.filter(child => {
        if (metricIndexForCols === undefined) {
          return true;
        }
        if (child.path.length <= metricIndexForCols) {
          return true;
        }
        const metricAtIndex = metricLabelSet.has(
          String(child.path[metricIndexForCols] ?? ''),
        );
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
        const allowMetricSubtotals =
          colSubTotals || normalizedColSubtotalLevels.length > 0;
        const withoutMetrics = children.filter(child => {
          const metricAtLevel = metricLabelSet.has(
            String(child.path[parent.level] ?? ''),
          );
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
          child => !metricLabelSet.has(String(child.path[parent.level] ?? '')),
        );
      }
      if (metricsFirstOnCols) {
        filtered = filtered.filter(child => !isMetricGrandTotalNode(child));
      }
      return filtered;
    },
    [
      colSubTotals,
      getRawColChildren,
      groupbyColumns.length,
      metricIndexForCols,
      metricLayoutIndexOnCols,
      hideMetricHeaderOnCols,
      metricLabelSet,
      normalizedColSubtotalLevels.length,
      resolvedMetricsLayout,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricsFirstOnCols,
    ],
  );

  const buildFormattingValuesMap = useCallback(
    (axis: 'row' | 'col') => {
      const valuesMap = new Map<string, Record<string, DataRecordValue>>();
      Object.values(tree.cells).forEach(cell => {
        const rowNode = tree.rows[cell.rowKey];
        const colNode = tree.cols[cell.colKey];
        if (!rowNode || !colNode) {
          return;
        }
        const rowKey = serializePath(getNonMetricPathParts(rowNode.path));
        const colKey = serializePath(getNonMetricPathParts(colNode.path));
        if (axis === 'row') {
          if (colKey !== rootKey || valuesMap.has(rowKey)) {
            return;
          }
          valuesMap.set(rowKey, cell.values);
          return;
        }
        if (rowKey !== rootKey || valuesMap.has(colKey)) {
          return;
        }
        valuesMap.set(colKey, cell.values);
      });
      return valuesMap;
    },
    [getNonMetricPathParts, tree.cells, tree.cols, tree.rows],
  );
  const rowFormattingValuesMap = useMemo(
    () => buildFormattingValuesMap('row'),
    [buildFormattingValuesMap],
  );
  const colFormattingValuesMap = useMemo(
    () => buildFormattingValuesMap('col'),
    [buildFormattingValuesMap],
  );
  const rowSortingValuesMap = useMemo(
    () => buildFormattingValuesMap('row'),
    [buildFormattingValuesMap],
  );
  const colSortingValuesMap = useMemo(
    () => buildFormattingValuesMap('col'),
    [buildFormattingValuesMap],
  );
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
    [
      colTypeMap,
      compareValues,
      getDimensionKeyForNode,
      getSortValue,
      resolveSortConfig,
    ],
  );

  const rowSorter = useMemo(() => {
    const baseSorter = sortByOrder(
      rowOrder,
      colTypeMap,
      groupbyRows.map(getColumnLabel),
    );
    const pushMetricTotalsToEnd =
      (rowTotals && resolvedRowTotalPosition === 'end') ||
      (rowSubTotals && effectiveRowSubtotalPosition === 'end');
    const pullMetricTotalsToStart =
      rowTotals && resolvedRowTotalPosition === 'start';
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
    rowTotals,
    resolvedRowTotalPosition,
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
  }, [colOrder, colTypeMap, compareMetricOrder, compareMetricSort, groupbyColumns]);

  const showRowRootBase =
    groupbyRows.length > 0 &&
    (normalizedRowSubtotalLevels.includes(0) || rowTotals);
  const showRowRoot =
    showRowRootBase &&
    !(
      resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
      isMultiMetric
    );
  const showColRoot =
    groupbyColumns.length > 0 &&
    (normalizedColSubtotalLevels.includes(0) || colTotals || colSubTotals);

  const skipRowRoot = groupbyRows.length > 0 && !showRowRoot;
  const skipColRoot = groupbyColumns.length === 0 || !showColRoot;

  const shouldHideMetricGrandTotalsOnRows = !showRowRootBase;
  const visibleRowsBase = useMemo(
    () =>
      buildVisibleRows({
        rows: tree.rows,
        expandedRows,
        rowSorter,
        skipRowRoot,
        showRowRoot,
        rowTotalPosition: resolvedRowTotalPosition,
        getRowChildren,
        getCollapsedRowChildren,
      }),
    [
      expandedRows,
      getCollapsedRowChildren,
      getRowChildren,
      resolvedRowTotalPosition,
      rowSorter,
      showRowRoot,
      skipRowRoot,
      tree.rows,
    ],
  );
  const visibleRows = useMemo(
    () =>
      shouldHideMetricGrandTotalsOnRows
        ? visibleRowsBase.filter(row => !isMetricGrandTotalNode(row))
        : visibleRowsBase,
    [isMetricGrandTotalNode, shouldHideMetricGrandTotalsOnRows, visibleRowsBase],
  );

  const buildColLeavesWithSubtotals = useMemo(
    () =>
      createColLeavesBuilder({
        getColChildren,
        getCollapsedColLeaves,
        colSorter,
        countDimDepth,
        expandedCols,
        normalizedColSubtotalLevels,
        showColRoot,
        colTotals,
        resolvedColTotalPosition,
        resolvedColSubtotalPosition: effectiveColSubtotalPosition,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
      }),
    [
      colSorter,
      colTotals,
      countDimDepth,
      expandedCols,
      getColChildren,
      getCollapsedColLeaves,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      normalizedColSubtotalLevels,
      effectiveColSubtotalPosition,
      resolvedColTotalPosition,
      showColRoot,
    ],
  );

  const shouldHideMetricGrandTotalsOnCols = !showColRoot;
  const visibleColsBase = useMemo(
    () =>
      buildVisibleCols({
        cols: tree.cols,
        skipColRoot,
        colSorter,
        getColChildren,
        buildColLeavesWithSubtotals,
      }),
    [buildColLeavesWithSubtotals, colSorter, getColChildren, skipColRoot, tree.cols],
  );
  const visibleCols = useMemo(
    () =>
      shouldHideMetricGrandTotalsOnCols
        ? visibleColsBase.filter(col => !isMetricGrandTotalNode(col))
        : visibleColsBase,
    [isMetricGrandTotalNode, shouldHideMetricGrandTotalsOnCols, visibleColsBase],
  );
  const { visibleRowDepth, visibleColDepth } = useMemo(
    () => getVisibleDepths(visibleRows, visibleCols, countDimDepth),
    [countDimDepth, visibleCols, visibleRows],
  );
  const lastVisibleRowDepthRef = useRef(visibleRowDepth);
  const lastVisibleColDepthRef = useRef(visibleColDepth);
  useEffect(() => {
    if (visibleRowDepth > lastVisibleRowDepthRef.current) {
      lastVisibleRowDepthRef.current = visibleRowDepth;
      setFetchedColKeys(new Map());
    } else {
      lastVisibleRowDepthRef.current = visibleRowDepth;
    }
  }, [visibleRowDepth]);
  useEffect(() => {
    if (visibleColDepth > lastVisibleColDepthRef.current) {
      lastVisibleColDepthRef.current = visibleColDepth;
      setFetchedRowKeys(new Map());
    } else {
      lastVisibleColDepthRef.current = visibleColDepth;
    }
  }, [visibleColDepth]);
  const hasLoadedChildren = useCallback(
    (axis: 'row' | 'col', node: PivotTreeNode) =>
      hasLoadedChildrenBase({
        axis,
        node,
        getRawChildren: (targetAxis, parent) =>
          targetAxis === 'row'
            ? getRawRowChildren(parent)
            : getRawColChildren(parent),
        groupbyRowsLength: groupbyRows.length,
        groupbyColsLength: groupbyColumns.length,
        metricLabelSet,
        metricIndexForRows,
        metricIndexForCols,
        cells: tree.cells,
        rows: tree.rows,
        cols: tree.cols,
        visibleRowDepth,
        visibleColDepth,
        countDimDepth,
      }),
    [
      countDimDepth,
      getRawColChildren,
      getRawRowChildren,
      groupbyColumns.length,
      groupbyRows.length,
      metricIndexForCols,
      metricIndexForRows,
      metricLabelSet,
      tree.cells,
      tree.cols,
      tree.rows,
      visibleColDepth,
      visibleRowDepth,
    ],
  );
  const getColumnDisplayPath = useCallback(
    (col: PivotTreeNode, maxDepth: number) =>
      buildColumnDisplayPath(col, maxDepth, {
        metricsLayout: resolvedMetricsLayout,
        metricsFirstOnCols,
        metricsAtColEnd,
        allowMetricSubtotalLabels:
          colSubTotals || normalizedColSubtotalLevels.length > 0,
        hasDeeperNonMetricDescendants,
        metricLabels,
        isExplicitSubtotalNode,
        getMetricLabelFromPath,
        getNonMetricPathParts,
        isMetricGrandTotalNode,
        isMetricSubtotalNode,
      }),
    [
      getMetricLabelFromPath,
      getNonMetricPathParts,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      isMetricSubtotalNode,
      metricLabels,
      colSubTotals,
      normalizedColSubtotalLevels.length,
      hasDeeperNonMetricDescendants,
      metricsAtColEnd,
      metricsFirstOnCols,
      resolvedMetricsLayout,
    ],
  );
  const columnHeaderRows = useMemo(
    () => buildColumnHeaderRows(visibleCols, tree.cols, getColumnDisplayPath),
    [getColumnDisplayPath, visibleCols, tree.cols],
  );
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
            !node.path.some(val => metricLabelSet.has(String(val ?? '')))
          : resolvedMetricsLayout === MetricsLayoutEnum.COLUMNS &&
            isMultiMetric &&
            metricLayoutIndexOnCols !== undefined &&
            metricLayoutIndexOnCols > 0 &&
            metricLayoutIndexOnCols < groupbyColumns.length &&
            node.path.length === metricLayoutIndexOnCols &&
            !node.path.some(val => metricLabelSet.has(String(val ?? '')));
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
      metricLabelSet,
      resolvedMetricsLayout,
    ],
  );

  type CollapsedMetricExpansion = {
    metric: string;
    suffix: PivotTreeNode['path'];
    dimDepth: number;
  };

  const collectCollapsedMetricExpansions = useCallback(
    (parent: PivotTreeNode, expanded: Set<string>) => {
      if (
        resolvedMetricsLayout !== MetricsLayoutEnum.ROWS ||
        metricLayoutIndexOnRows === undefined ||
        metricLayoutIndexOnRows <= parent.level
      ) {
        return [] as CollapsedMetricExpansion[];
      }
      const parentPath = parent.path;
      const expansions: CollapsedMetricExpansion[] = [];
      expanded.forEach(key => {
        const node = tree.rows[key];
        if (!node || node.path.length <= parentPath.length) {
          return;
        }
        if (!parentPath.every((val, idx) => val === node.path[idx])) {
          return;
        }
        const metricLabel = node.path[parentPath.length];
        if (!metricLabelSet.has(String(metricLabel ?? ''))) {
          return;
        }
        const suffix = node.path.slice(parentPath.length + 1);
        const dimDepth = countDimDepthBase(node.path, metricLabelSet);
        expansions.push({
          metric: String(metricLabel ?? ''),
          suffix,
          dimDepth,
        });
      });
      return expansions;
    },
    [
      metricLabelSet,
      metricLayoutIndexOnRows,
      resolvedMetricsLayout,
      tree.rows,
    ],
  );

  const collectDimPrefixes = useCallback(
    (
      parentPath: PivotTreeNode['path'],
      targetDepth: number,
      nodes: Record<string, PivotTreeNode>,
    ) => {
      if (parentPath.length >= targetDepth) {
        return [parentPath];
      }
      let active = [parentPath];
      const results: PivotTreeNode['path'][] = [];
      const seen = new Set<string>();
      const addUnique = (path: PivotTreeNode['path']) => {
        const key = serializePath(path);
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        results.push(path);
      };
      for (let depth = parentPath.length; depth < targetDepth; depth += 1) {
        const next: PivotTreeNode['path'][] = [];
        active.forEach(prefix => {
          const parentNode = nodes[serializePath(prefix)];
          if (!parentNode) {
            addUnique(prefix);
            return;
          }
          const children = findChildren(nodes, parentNode).filter(child => {
            const val = child.path[depth];
            if (
              metricLabelSet.has(String(val ?? '')) ||
              isSubtotalToken(val) ||
              val === 'Total'
            ) {
              return false;
            }
            return true;
          });
          if (children.length === 0) {
            addUnique(prefix);
            return;
          }
          children.forEach(child => next.push(child.path));
        });
        if (next.length === 0) {
          return results.length > 0 ? results : [parentPath];
        }
        active = next;
      }
      active.forEach(addUnique);
      return results;
    },
    [metricLabelSet],
  );

  const recomputeExpandedRows = useCallback(
    (expanded: Set<string>) => {
      const visible = buildVisibleRows({
        rows: tree.rows,
        expandedRows: expanded,
        rowSorter,
        skipRowRoot,
        showRowRoot,
        rowTotalPosition: resolvedRowTotalPosition,
        getRowChildren,
        getCollapsedRowChildren,
      });
      const visibleKeys = new Set(visible.map(row => row.key));
      const next = new Set(expanded);
      expanded.forEach(key => {
        const node = tree.rows[key];
        if (!node) {
          next.delete(key);
          return;
        }
        if (!visibleKeys.has(key)) {
          return;
        }
        const hasVisibleDescendant = visible.some(
          row =>
            row.path.length > node.path.length &&
            node.path.every((val, idx) => val === row.path[idx]),
        );
        if (!hasVisibleDescendant) {
          next.delete(key);
        }
      });
      return next;
    },
    [
      getCollapsedRowChildren,
      getRowChildren,
      resolvedRowTotalPosition,
      rowSorter,
      showRowRoot,
      skipRowRoot,
      tree.rows,
    ],
  );
  type ExpansionState = {
    expanded: Set<string>;
    fullyExpanded: Set<string>;
  };
  const prunePartialExpansions = useCallback(
    (
      parent: PivotTreeNode,
      expanded: Set<string>,
      fullyExpanded: Set<string>,
      nodes: Record<string, PivotTreeNode>,
    ): ExpansionState => {
      const next = new Set(expanded);
      const nextFull = new Set(fullyExpanded);
      expanded.forEach(key => {
        if (key === parent.key) {
          return;
        }
        const node = nodes[key];
        if (!node) {
          next.delete(key);
          nextFull.delete(key);
          return;
        }
        if (node.path.length <= parent.path.length) {
          return;
        }
        if (!parent.path.every((val, idx) => val === node.path[idx])) {
          return;
        }
        if (fullyExpanded.has(key)) {
          return;
        }
        next.delete(key);
        nextFull.delete(key);
      });
      return { expanded: next, fullyExpanded: nextFull };
    },
    [],
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
    [
      countDimDepth,
      expandedRowDepths,
      groupbyRows.length,
      isExplicitTotalNode,
    ],
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
  const handleToggle = useCallback(
    async (axis: 'row' | 'col', node: PivotTreeNode) => {
      if (!shouldShowToggle(axis, node)) {
        return;
      }
      const expanded =
        axis === 'row' ? expandedRowsRef.current : expandedColsRef.current;
      const updateExpanded =
        axis === 'row' ? setExpandedRowsState : setExpandedColsState;
      const fullExpanded =
        axis === 'row' ? fullyExpandedRows : fullyExpandedCols;
      const updateFullExpanded =
        axis === 'row' ? setFullyExpandedRows : setFullyExpandedCols;
      const isOpen = expanded.has(node.key);

      if (isOpen) {
        let next = new Set(expanded);
        next.delete(node.key);
        let nextFull = new Set(fullExpanded);
        nextFull.delete(node.key);
        const pruned = prunePartialExpansions(
          node,
          next,
          nextFull,
          axis === 'row' ? tree.rows : tree.cols,
        );
        next = pruned.expanded;
        nextFull = pruned.fullyExpanded;
        if (axis === 'row') {
          next = recomputeExpandedRows(next);
        }
        nextFull = new Set(
          Array.from(nextFull).filter(key => next.has(key)),
        );
        updateExpanded(next);
        updateFullExpanded(nextFull);
        return;
      }

      let rootLoading = false;
      const beginRootLoading = () => {
        if (rootLoading) {
          return;
        }
        rootLoading = true;
        updateLoadingKey(node.key, 1);
      };
      const finishRootLoading = () => {
        if (!rootLoading) {
          return;
        }
        rootLoading = false;
        updateLoadingKey(node.key, -1);
      };

      try {
        const fetchedKeys = axis === 'row' ? fetchedRowKeys : fetchedColKeys;
        const requiredDepth = axis === 'row' ? visibleColDepth : visibleRowDepth;
        const fetchedDepth = fetchedKeys.get(node.key) ?? -1;
        const markFetched =
          axis === 'row' ? setFetchedRowKeys : setFetchedColKeys;
      const expandedMetricLabels =
        axis === 'row' &&
        resolvedMetricsLayout === MetricsLayoutEnum.ROWS &&
        metricLayoutIndexOnRows !== undefined &&
        metricLayoutIndexOnRows > node.level
          ? Array.from(metricLabelSet).filter(label =>
              expanded.has(serializePath([...node.path, label])),
            )
          : [];
        const collapsedMetricExpansions =
          axis === 'row' ? collectCollapsedMetricExpansions(node, expanded) : [];
        let nextTree = tree;
        let fetchedBranch: PivotTreeData | undefined;
        const fetchBranchForNode = async (targetNode: PivotTreeNode) => {
          if (!targetNode.hasChildren) {
            return;
          }
          const targetFetchedDepth = fetchedKeys.get(targetNode.key) ?? -1;
          const directChildren =
            axis === 'row'
              ? findChildren(nextTree.rows, targetNode)
              : findChildren(nextTree.cols, targetNode);
          if (targetFetchedDepth === requiredDepth && directChildren.length > 0) {
            return;
          }
          const cached = peekPivotBranchCache({
            axis,
            path: targetNode.path,
            formData: fetchFormData,
            maxDepthPerFetch,
            currentTree: nextTree,
            visibleRowDepth,
            visibleColDepth,
          });
          if (cached) {
            const merged = mergeTrees(nextTree, cached);
            nextTree = merged;
            setTree(merged);
            if (targetNode.key === node.key) {
              fetchedBranch = cached;
            }
            markFetched(prev => {
              const next = new Map(prev);
              next.set(targetNode.key, requiredDepth);
              return next;
            });
            return;
          }
          beginRootLoading();
          if (targetNode.key !== node.key) {
            updateLoadingKey(targetNode.key, 1);
          }
          try {
            const result = await fetchPivotBranch({
              axis,
              path: targetNode.path,
              formData: fetchFormData,
              maxDepthPerFetch,
              currentTree: nextTree,
              visibleRowDepth,
              visibleColDepth,
            });
            if (result.error) {
              setErrorMessage(result.error.message);
            }
            if (result.data) {
              const merged = mergeTrees(nextTree, result.data);
              nextTree = merged;
              setTree(merged);
              if (targetNode.key === node.key) {
                fetchedBranch = result.data;
              }
              markFetched(prev => {
                const next = new Map(prev);
                next.set(targetNode.key, requiredDepth);
                return next;
              });
            }
          } finally {
            if (targetNode.key !== node.key) {
              updateLoadingKey(targetNode.key, -1);
            }
          }
        };

        if (
          node.hasChildren &&
          (!hasLoadedChildren(axis, node) || fetchedDepth !== requiredDepth)
        ) {
          const cached = peekPivotBranchCache({
            axis,
            path: node.path,
            formData: fetchFormData,
            maxDepthPerFetch,
            currentTree: tree,
            visibleRowDepth,
            visibleColDepth,
          });
          if (cached) {
            const merged = mergeTrees(tree, cached);
            nextTree = merged;
            setTree(merged);
            fetchedBranch = cached;
            markFetched(prev => {
              const next = new Map(prev);
              next.set(node.key, requiredDepth);
              return next;
            });
          } else {
            beginRootLoading();
            const result = await fetchPivotBranch({
              axis,
              path: node.path,
              formData: fetchFormData,
              maxDepthPerFetch,
              currentTree: tree,
              visibleRowDepth,
              visibleColDepth,
            });
            if (result.error) {
              setErrorMessage(result.error.message);
            }
            if (result.data) {
              const merged = mergeTrees(tree, result.data);
              nextTree = merged;
              setTree(merged);
              fetchedBranch = result.data;
              markFetched(prev => {
                const next = new Map(prev);
                next.set(node.key, requiredDepth);
                return next;
              });
            }
          }
        }
        if (axis === 'row') {
          let prunedTree = pruneCollapsedMetricRows(nextTree, node, expanded);
          prunedTree = pruneStaleCollapsedRows(prunedTree, node, fetchedBranch);
          if (prunedTree !== nextTree) {
            nextTree = prunedTree;
            setTree(prunedTree);
          }
        }
        if (axis === 'col') {
          let prunedTree = pruneCollapsedMetricCols(nextTree, node, expanded);
          prunedTree = pruneStaleCollapsedCols(prunedTree, node, fetchedBranch);
          if (prunedTree !== nextTree) {
            nextTree = prunedTree;
            setTree(prunedTree);
          }
        }
        const next = new Set(expanded);
        const nextFull = new Set(fullExpanded);
        const markPartial = (key: string) => {
          nextFull.delete(key);
        };
        next.add(node.key);
        markPartial(node.key);
        if (axis === 'row' && expandedMetricLabels.length > 0) {
          Object.values(nextTree.rows).forEach(rowNode => {
            if (
              !rowNode.hasChildren ||
              rowNode.path.length <= node.path.length
            ) {
              return;
            }
            if (!node.path.every((val, idx) => val === rowNode.path[idx])) {
              return;
            }
            if (
              isExplicitSubtotalNode(rowNode) ||
              isMetricGrandTotalNode(rowNode)
            ) {
              return;
            }
            const lastLabel = String(rowNode.path[rowNode.path.length - 1] ?? '');
            if (!expandedMetricLabels.includes(lastLabel)) {
              return;
            }
            next.add(rowNode.key);
            markPartial(rowNode.key);
          });
        }
        const shouldRemapMetricExpansions =
          axis === 'row' &&
          metricLayoutIndexOnRows !== undefined &&
          metricLayoutIndexOnRows > node.level;
        let metricPrefixes: PivotTreeNode['path'][] = [];
        if (shouldRemapMetricExpansions && expandedMetricLabels.length > 0) {
          metricPrefixes = collectDimPrefixes(
            node.path,
            metricLayoutIndexOnRows,
            nextTree.rows,
          );
        }
        if (
          axis === 'row' &&
          expandedMetricLabels.length > 0 &&
          metricPrefixes.length > 0
        ) {
          const hasNonSubtotalChildren = (parentNode: PivotTreeNode) =>
            findChildren(nextTree.rows, parentNode).some(child => {
              const val = child.path[parentNode.path.length];
              if (isSubtotalToken(val) || val === 'Total') {
                return false;
              }
              return true;
            });
          const metricNodesToFetch = metricPrefixes
            .flatMap(prefix =>
              expandedMetricLabels.map(label => {
                const key = serializePath([...prefix, label]);
                return nextTree.rows[key];
              }),
            )
            .filter((metricNode): metricNode is PivotTreeNode => !!metricNode)
            .filter(metricNode => !hasNonSubtotalChildren(metricNode));
          for (const metricNode of metricNodesToFetch) {
            await fetchBranchForNode(metricNode);
          }
        }
        const mappedExpansionPaths = new Set<string>();
        if (
          axis === 'row' &&
          collapsedMetricExpansions.length > 0 &&
          shouldRemapMetricExpansions &&
          metricPrefixes.length > 0
        ) {
          metricPrefixes.forEach(prefix => {
            collapsedMetricExpansions.forEach(expansion => {
              if (expansion.suffix.length === 0) {
                return;
              }
              const mappedPath = [
                ...prefix,
                expansion.metric,
                ...expansion.suffix,
              ];
              const mappedKey = serializePath(mappedPath);
              mappedExpansionPaths.add(mappedKey);
              next.add(mappedKey);
              markPartial(mappedKey);
            });
          });
        }
        if (axis === 'row' && mappedExpansionPaths.size > 0) {
          const hasNonSubtotalChildren = (parentNode: PivotTreeNode) =>
            findChildren(nextTree.rows, parentNode).some(child => {
              const val = child.path[parentNode.path.length];
              if (isSubtotalToken(val) || val === 'Total') {
                return false;
              }
              return true;
            });
          const expansionNodesToFetch = Array.from(mappedExpansionPaths)
            .map(key => nextTree.rows[key])
            .filter((rowNode): rowNode is PivotTreeNode => !!rowNode)
            .filter(rowNode => !hasNonSubtotalChildren(rowNode));
          for (const rowNode of expansionNodesToFetch) {
            await fetchBranchForNode(rowNode);
          }
        }
        updateExpanded(next);
        updateFullExpanded(nextFull);
      } finally {
        finishRootLoading();
      }
    },
    [
      collectCollapsedMetricExpansions,
      collectDimPrefixes,
      fullyExpandedCols,
      fullyExpandedRows,
      fetchedColKeys,
      fetchedRowKeys,
      formData,
      groupbyRows.length,
      hasLoadedChildren,
      isExplicitSubtotalNode,
      isMetricGrandTotalNode,
      maxDepthPerFetch,
      metricLabelSet,
      metricLayoutIndexOnRows,
      peekPivotBranchCache,
      pruneCollapsedMetricCols,
      pruneCollapsedMetricRows,
      pruneStaleCollapsedCols,
      pruneStaleCollapsedRows,
      recomputeExpandedRows,
      resolvedMetricsLayout,
      setExpandedColsState,
      setExpandedRowsState,
      shouldShowToggle,
      tree,
      prunePartialExpansions,
      updateLoadingKey,
      visibleColDepth,
      visibleRowDepth,
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
          selectedFilters: binaryFilters.reduce((acc, filter) => {
            const key = String(
              'col' in filter ? (filter as any).col : (filter as any).subject,
            );
            return {
              ...acc,
              [key]: [filter.val],
            };
          }, {} as Record<string, DataRecordValue[]>),
        },
      });
    },
    [
      emitCrossFilters,
      groupbyColumns,
      groupbyRows,
      metrics,
      resolvedMetricsLayout,
      setDataMask,
    ],
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
      resolvedMetricsLayout,
      onContextMenu,
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

  const shouldHideRowValues = useCallback(
    (rowNode: PivotTreeNode) =>
      shouldHideRowValuesBase({
        rowNode,
        rowSubTotals,
        effectiveRowSubtotalPosition: getRowSubtotalPosition(rowNode),
        metricLabelSet,
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
      metricLabelSet,
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
      const cell = tree.cells[`${rowNode.key}|${colNode.key}`];
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
        return <span dangerouslySetInnerHTML={{ __html: value }} />;
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
      t,
    ],
  );

  return (
    <Container height={height} width={width}>
      {errorMessage && <div>{t('Error loading branch: %s', errorMessage)}</div>}
      <StyledTable>
        <thead>
          {columnHeaderRows.length === 0 ? (
            <tr>
              <th
                style={
                  themeColor
                    ? { backgroundColor: themeColor, fontWeight: 600 }
                    : { fontWeight: 600 }
                }
              >
                {t('Rows')}
              </th>
            </tr>
          ) : (
            columnHeaderRows.map((rowCells, rowIdx) => (
              <tr key={`col-header-row-${rowIdx}`}>
                {rowIdx === 0 && (
                  <th
                    rowSpan={columnHeaderRows.length}
                    style={
                      themeColor
                        ? { backgroundColor: themeColor, fontWeight: 600 }
                        : { fontWeight: 600 }
                    }
                  >
                    {t('Rows')}
                  </th>
                )}
                {rowCells.map(cell => {
                  const showToggle = shouldShowToggle('col', cell.node);
                  const isSubtotalHeader = isColAggregateBold(cell.node);
                  const colHeaderFormatting = resolveDimensionStyle(
                    'col',
                    cell.node,
                    'label',
                  );
                  const colHeaderStyle = {
                    ...(themeColor ? { backgroundColor: themeColor } : {}),
                    ...(colHeaderFormatting || {}),
                  };
                  const colHeaderStyleResolved =
                    Object.keys(colHeaderStyle).length > 0
                      ? colHeaderStyle
                      : undefined;
                  return (
                    <th
                      key={`col-header-${cell.node.key}-${rowIdx}`}
                      colSpan={cell.colSpan}
                      rowSpan={cell.rowSpan}
                      className={isSubtotalHeader ? 'subtotal-cell' : undefined}
                      style={colHeaderStyleResolved}
                    >
                      <ColumnHeaderCell>
                        {showToggle && (
                          <ToggleButton
                            type="button"
                            onClick={() => handleToggle('col', cell.node)}
                          >
                            {expandedCols.has(cell.node.key) ? (
                              <MinusSquareOutlined />
                            ) : (
                              <PlusSquareOutlined />
                            )}
                          </ToggleButton>
                        )}
                        <span>{formatLabel(cell.node, 'col')}</span>
                        {loadingKeys.has(cell.node.key) && <Spinner />}
                      </ColumnHeaderCell>
                    </th>
                  );
                })}
              </tr>
            ))
          )}
        </thead>
        <tbody>
          {visibleRows.map(row => {
            const showToggle = shouldShowToggle('row', row);
            const rowAggregateBold = isRowAggregateBold(row);
            const isSubtotalHeader = rowAggregateBold;
            const rowTotalBg = getTotalBackground(row);
            const rowHeaderFormatting = resolveDimensionStyle(
              'row',
              row,
              'label',
            );
            const rowHeaderStyle = {
              ...(rowTotalBg ? { backgroundColor: rowTotalBg } : {}),
              ...(rowHeaderFormatting || {}),
            };
            const rowHeaderStyleResolved =
              Object.keys(rowHeaderStyle).length > 0
                ? rowHeaderStyle
                : undefined;
            const rowIndent = getNodeDimDepth(row) * ROW_INDENT_PX;
            return (
              <tr key={row.key}>
                <th
                  className={isSubtotalHeader ? 'subtotal-cell' : undefined}
                  style={rowHeaderStyleResolved}
                >
                  <HeaderCell style={{ paddingLeft: rowIndent }}>
                    {showToggle ? (
                      <ToggleButton
                        type="button"
                        onClick={() => handleToggle('row', row)}
                      >
                        {expandedRows.has(row.key) ? (
                          <MinusSquareOutlined />
                        ) : (
                          <PlusSquareOutlined />
                        )}
                      </ToggleButton>
                    ) : null}
                    <span>{formatLabel(row, 'row')}</span>
                    {loadingKeys.has(row.key) && <Spinner />}
                  </HeaderCell>
                </th>
                {visibleCols.map(col => {
                  const cellKey = `${row.key}|${col.key}`;
                  const cell = tree.cells[cellKey];
                  const metricKey = cell ? deriveMetricKey(row, col) : '';
                  const formattingKeys = metricKey
                    ? formattingKeyMap[metricKey]
                    : undefined;
                  const colAggregateBold = isColAggregateBold(col);
                  const isSubtotalCell = rowAggregateBold || colAggregateBold;
                  const isGrandTotalCell =
                    row.path.length === 0 ||
                    col.path.length === 0 ||
                    isMetricGrandTotalNode(row) ||
                    isMetricGrandTotalNode(col);
                  const rowCellFormatting = !isGrandTotalCell
                    ? resolveDimensionStyle('row', row, 'cell')
                    : undefined;
                  const colCellFormatting = !isGrandTotalCell
                    ? resolveDimensionStyle('col', col, 'cell')
                    : undefined;
                  const applyColorFormatting = !!(
                    cell &&
                    formattingKeys &&
                    shouldApplyMetricFormatting(
                      metricFormattingScope,
                      isSubtotalCell,
                      isGrandTotalCell,
                    )
                  );
                  const applyD3Formatting = !!(
                    cell && formattingKeys?.d3Format
                  );
                  const backgroundColor =
                    applyColorFormatting && formattingKeys?.backgroundColor
                      ? normalizeCssColor(
                          cell.values[formattingKeys.backgroundColor],
                        )
                      : undefined;
                  const textColor =
                    applyColorFormatting && formattingKeys?.textColor
                      ? normalizeCssColor(cell.values[formattingKeys.textColor])
                      : undefined;
                  const d3FormatOverride =
                    applyD3Formatting
                      ? normalizeD3Format(
                          cell.values[formattingKeys.d3Format],
                        )
                      : undefined;
                  const cellTotalBg = rowTotalBg;
                  const cellClassName = isSubtotalCell
                    ? 'subtotal-cell value-cell'
                    : 'value-cell';
                  const cellStyle = {
                    ...(cellTotalBg ? { backgroundColor: cellTotalBg } : {}),
                    ...(colCellFormatting?.backgroundColor
                      ? { backgroundColor: colCellFormatting.backgroundColor }
                      : {}),
                    ...(colCellFormatting?.color
                      ? { color: colCellFormatting.color }
                      : {}),
                    ...(rowCellFormatting?.backgroundColor
                      ? { backgroundColor: rowCellFormatting.backgroundColor }
                      : {}),
                    ...(rowCellFormatting?.color
                      ? { color: rowCellFormatting.color }
                      : {}),
                    ...(backgroundColor ? { backgroundColor } : {}),
                    ...(textColor ? { color: textColor } : {}),
                  };
                  const style =
                    Object.keys(cellStyle).length > 0 ? cellStyle : undefined;
                  return (
                    <td
                      key={cellKey}
                      className={cellClassName}
                      style={style}
                      onClick={() => handleCellClick(row, col)}
                      onContextMenu={event =>
                        handleCellContextMenu(event, row, col)
                      }
                    >
                      {renderCellContent(row, col, metricKey, d3FormatOverride)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </StyledTable>
    </Container>
  );
}

export default PivotTableChart;
