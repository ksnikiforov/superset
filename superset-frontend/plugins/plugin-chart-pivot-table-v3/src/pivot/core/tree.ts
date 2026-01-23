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
} from '@superset-ui/core';
import {
  MetricsLayoutEnum,
  PivotPath,
  PivotResultCell,
  PivotTreeData,
  PivotTreeNode,
} from '../../types';
import { serializeCellKey, serializePath } from './path';
import {
  decodeMetricKey,
  encodeMetricKey,
  getMetricKeys,
  isSubtotalToken,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from './tokens';

export const formatPivotLabelValue = (
  value: DataRecordValue,
  fallback = '',
) => {
  if (value === null) {
    return '(NULL)';
  }
  if (value === undefined) {
    return fallback;
  }
  return String(value);
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
    const result = { ...(target ?? {}) } as Record<string, PivotResultCell>;
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
      !node.path.some(val => isSubtotalToken(val)),
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
      baseRowPath.some(val => isSubtotalToken(val))
    ) {
      return;
    }
    const subtotalRowKey = serializePath([...baseRowPath, SUBTOTAL_TOKEN]);
    const cellKey = serializeCellKey(subtotalRowKey, cell.colKey);
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
  const getMetricLabelFromValue = (val: unknown) => {
    const decoded = decodeMetricKey(val);
    if (!decoded) {
      return undefined;
    }
    return metricLabels.has(decoded) ? decoded : undefined;
  };
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
      if (!getMetricLabelFromValue(val) && !isSubtotalToken(val)) {
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
      const decoded = getMetricLabelFromValue(val);
      if (!decoded) {
        continue;
      }
      metricLabel = decoded;
      metricLabelIndex = i;
      break;
    }
    if (!metricLabel) {
      for (let i = subtotalIndex - 1; i >= 0; i -= 1) {
        const val = node.path[i];
        const decoded = getMetricLabelFromValue(val);
        if (!decoded) {
          continue;
        }
        metricLabel = decoded;
        metricLabelIndex = i;
        break;
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
  const metricTokenSet = new Set(metricKeys.map(encodeMetricKey));

  const ensureNode = (
    axis: 'row' | 'col',
    path: PivotPath,
    fullDepth: number,
    isSubtotal?: boolean,
  ) => {
    const nodes = axis === 'row' ? result.rows : result.cols;
    const key = serializePath(path);
    if (nodes[key]) return nodes[key];
    const rawValue = path[path.length - 1];
    const rawLabel =
      path.length === 0
        ? 'Grand total'
        : formatPivotLabelValue(rawValue, 'Grand total');
    const metricLabel = decodeMetricKey(rawValue);
    const label = metricLabel || rawLabel;
    const isMetricNode = metricTokenSet.has(
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
      (path.length < fullDepth && !(isMetricNode && hasChildren === false));
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
        const metricToken = encodeMetricKey(metric);
        const hasSubtotalAtInsert =
          rowSuffix.length > 0 && isSubtotalToken(rowSuffix[0]);
        const newRowPath = hasSubtotalAtInsert
          ? [...rowPrefix, rowSuffix[0], metricToken, ...rowSuffix.slice(1)]
          : [...rowPrefix, metricToken, ...rowSuffix];
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

        result.cells[serializeCellKey(newRowKey, colKey)] = {
          rowKey: newRowKey,
          colKey,
          values: mergedValues,
          isSubtotal: cell.isSubtotal,
        };
        // If there is only one metric, also surface the value at the base row
        // path so collapsed views (before expanding into the metric tier) can render.
        if (metricKeys.length === 1 && metricPosition !== 0) {
          const cellKey = serializeCellKey(rowKey, colKey);
          result.cells[cellKey] = result.cells[cellKey] || {
            rowKey,
            colKey,
            values: mergedValues,
            isSubtotal: cell.isSubtotal,
          };
        }
        if (metricKeys.length === 1 && metricPosition === 0) {
          const cellKey = serializeCellKey(rowKey, colKey);
          result.cells[cellKey] = result.cells[cellKey] || {
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

      metricKeys.forEach(metric => {
        const mergedValues = {
          [metric]: cell.values[metric],
          ...cell.values,
        };
        const metricToken = encodeMetricKey(metric);
        const newColPath = [...colPrefix, metricToken, ...colSuffix];
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

        result.cells[serializeCellKey(rowKey, newColKey)] = {
          rowKey,
          colKey: newColKey,
          values: mergedValues,
          isSubtotal: cell.isSubtotal,
        };
        if (metricKeys.length === 1 && metricPosition === 0) {
          const rootColKey = serializePath(colPrefix);
          const cellKey = serializeCellKey(rowKey, rootColKey);
          result.cells[cellKey] = result.cells[cellKey] || {
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
          const cellKey = serializeCellKey(rowKey, baseColKey);
          result.cells[cellKey] = result.cells[cellKey] || {
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
    const rawValue = path[path.length - 1];
    const label =
      path.length === 0
        ? 'Grand total'
        : formatPivotLabelValue(rawValue, totalLabel);
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

    const isRowTotalRecord = colPath.length === 0;
    const isColTotalRecord = rowPath.length === 0;
    if (isRowTotalRecord) {
      tree.rows[rowKey].values = {
        ...(tree.rows[rowKey].values || {}),
        ...values,
      };
    }
    if (isColTotalRecord) {
      tree.cols[colKey].values = {
        ...(tree.cols[colKey].values || {}),
        ...values,
      };
    }
    tree.cells[serializeCellKey(rowKey, colKey)] = {
      rowKey,
      colKey,
      values,
      isSubtotal:
        rowPath.length < rowGroupby.length ||
        colPath.length < colGroupby.length,
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
  const rootCellKey = serializeCellKey(rootKey, rootKey);
  if (rootValues && !tree.cells[rootCellKey]) {
    tree.cells[rootCellKey] = {
      rowKey: rootKey,
      colKey: rootKey,
      values: rootValues,
      isSubtotal: true,
    };
  }

  return tree;
};
