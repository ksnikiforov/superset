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
  QueryFormColumn,
  QueryFormMetric,
  ensureIsArray,
} from '@superset-ui/core';
import { MetricsLayoutEnum, PivotPath, PivotTreeData, PivotTreeNode } from './types';
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

export const getMetricKeys = (metrics: QueryFormMetric[]) =>
  metrics
    .map(metric => (typeof metric === 'string' ? metric : metric.label))
    .filter((m): m is string => !!m);

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
    for (let i = subtotalIndex - 1; i >= 0; i -= 1) {
      const val = node.path[i];
      if (!metricLabels.has(String(val ?? '')) && !isSubtotalToken(val)) {
        baseLabel = String(val ?? '');
        break;
      }
    }
    if (!baseLabel) {
      return;
    }
    let metricLabel: string | undefined;
    for (let i = subtotalIndex + 1; i < node.path.length; i += 1) {
      const val = node.path[i];
      if (metricLabels.has(String(val ?? ''))) {
        metricLabel = String(val ?? '');
        break;
      }
    }
    if (!metricLabel) {
      for (let i = subtotalIndex - 1; i >= 0; i -= 1) {
        const val = node.path[i];
        if (metricLabels.has(String(val ?? ''))) {
          break;
        }
      }
    }
    const hasMetricAfterSubtotal = !!metricLabel;
    const nextLabel =
      !isSingleMetric && hasMetricAfterSubtotal
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
    const node = {
      axis,
      key,
      path,
      label,
      formattedLabel: label,
      level: path.length,
      hasChildren: path.length < fullDepth,
      isSubtotal: isSubtotal ?? path.length < fullDepth,
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

      metricKeys.forEach(metric => {
        const newRowPath = [...rowPrefix, metric, ...rowSuffix];
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
          values: { [metric]: cell.values[metric] },
          isSubtotal: cell.isSubtotal,
        };
        // If there is only one metric and the metric tier is at the end,
        // also surface the value at the base row path so collapsed views
        // (before expanding into the metric tier) can render.
        if (
          metricKeys.length === 1 &&
          metricPosition !== 0
        ) {
          const baseRowKey = serializePath(rowPath);
          result.cells[`${baseRowKey}|${colKey}`] =
            result.cells[`${baseRowKey}|${colKey}`] || {
              rowKey: baseRowKey,
              colKey,
              values: { [metric]: cell.values[metric] },
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

      metricKeys.forEach(metric => {
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
          values: { [metric]: cell.values[metric] },
          isSubtotal: cell.isSubtotal,
        };
        if (metricKeys.length === 1 && metricPosition === 0) {
          const rootColKey = serializePath(colPrefix);
          result.cells[`${rowKey}|${rootColKey}`] =
            result.cells[`${rowKey}|${rootColKey}`] || {
              rowKey,
              colKey: rootColKey,
              values: { [metric]: cell.values[metric] },
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
              values: { [metric]: cell.values[metric] },
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
