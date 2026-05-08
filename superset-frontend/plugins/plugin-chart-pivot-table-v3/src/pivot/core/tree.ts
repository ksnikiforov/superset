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
  MeasureHierarchy,
  MeasureLeafSpec,
  type DateFormatter,
  PivotPath,
  PivotResultCell,
  PivotTreeData,
  PivotTreeNode,
} from '../../types';
import { serializeCellKey, serializePath } from './path';
import {
  decodeMetricKey,
  decodeMeasureLeafId,
  encodeMetricKey,
  encodeMeasureLeafKey,
  getMetricKeys,
  isSubtotalToken,
  METRICS_PLACEHOLDER,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from './tokens';
import { buildValueLeaf, isValueLeaf } from '../measureLeaves';
import { compilePivotProgram } from '../runtime/compilePivotProgram';
import type { PivotProgram } from '../runtime/types';

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
  metricLabelMap?: Record<string, string>,
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
  const getDisplayLabel = (metricKey: string) =>
    metricLabelMap?.[metricKey] ?? metricKey;
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
    const basePath =
      baseLabelIndex !== undefined
        ? node.path.slice(0, baseLabelIndex + 1)
        : undefined;
    const baseNode =
      basePath && basePath.length > 0
        ? tree.rows[serializePath(basePath)]
        : undefined;
    const resolvedBaseLabel = baseNode?.formattedLabel ?? baseLabel;
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
      ? `${resolvedBaseLabel} ${getDisplayLabel(metricLabel ?? '')}`
      : `${resolvedBaseLabel} Total`;
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

type MeasureAxisGroup = {
  metricKey: string;
  leaves: MeasureLeafSpec[];
};

type ApplyMeasureAxisInput = {
  tree: PivotTreeData;
  groups: MeasureAxisGroup[];
  leafTierVisible: boolean;
  program: PivotProgram;
  metricLabelMap?: Record<string, string>;
  preserveValueAxisSourceNodes: boolean;
  promoteExistingNodes: boolean;
};

const getValueAxis = (program: PivotProgram): 'row' | 'col' =>
  program.valueAxis ??
  (program.metricsLayoutResolved === MetricsLayoutEnum.ROWS ? 'row' : 'col');

const getAxisDimensions = (program: PivotProgram, axis: 'row' | 'col') =>
  axis === 'row' ? program.rowDimensions : program.columnDimensions;

const getAxisProgram = (program: PivotProgram, axis: 'row' | 'col') =>
  axis === 'row' ? program.rows : program.columns;

const getValuesInsertIndex = (program: PivotProgram) => {
  const valueAxis = getValueAxis(program);
  const axisProgram = getAxisProgram(program, valueAxis);
  const valuesIndex = axisProgram.findIndex(level => level.kind === 'values');
  if (valuesIndex < 0) {
    return getAxisDimensions(program, valueAxis).length;
  }
  return axisProgram
    .slice(0, valuesIndex)
    .filter(level => level.kind === 'dimension').length;
};

const buildMetricAxisProgram = ({
  metrics,
  metricsLayout,
  rowGroupby,
  colGroupby,
  metricPosition,
}: {
  metrics: QueryFormMetric[];
  metricsLayout: MetricsLayoutEnum;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  metricPosition?: number;
}): PivotProgram => {
  const valueAxis =
    metricsLayout === MetricsLayoutEnum.ROWS ? 'row' : ('col' as const);
  const axisDepth = valueAxis === 'row' ? rowGroupby.length : colGroupby.length;
  const metricInsertIndex = Math.min(metricPosition ?? axisDepth, axisDepth);
  const withValuesPlaceholder = (columns: QueryFormColumn[]) => [
    ...columns.slice(0, metricInsertIndex),
    METRICS_PLACEHOLDER,
    ...columns.slice(metricInsertIndex),
  ];
  return compilePivotProgram({
    groupbyRows:
      valueAxis === 'row' ? withValuesPlaceholder(rowGroupby) : rowGroupby,
    groupbyColumns:
      valueAxis === 'col' ? withValuesPlaceholder(colGroupby) : colGroupby,
    metrics,
    metricsLayout,
  });
};

const applyMeasureAxis = ({
  tree,
  groups,
  leafTierVisible,
  program,
  metricLabelMap,
  preserveValueAxisSourceNodes,
  promoteExistingNodes,
}: ApplyMeasureAxisInput): PivotTreeData => {
  if (groups.length === 0) {
    return tree;
  }
  const valueAxis = getValueAxis(program);
  const rowGroupby = program.rowDimensions;
  const colGroupby = program.columnDimensions;
  const insertIndex = getValuesInsertIndex(program);
  const valueAxisDepth =
    valueAxis === 'row' ? rowGroupby.length : colGroupby.length;
  const valuesAtEnd = insertIndex >= valueAxisDepth;
  const metricKeys = groups.map(group => group.metricKey);
  const metricTokenSet = new Set(metricKeys.map(encodeMetricKey));
  const leafLabelMap = new Map<string, string>();
  const singleLeafByMetric = new Map<
    string,
    { label: string; isValue: boolean }
  >();
  groups.forEach(group => {
    group.leaves.forEach(leaf => {
      if (!leafLabelMap.has(leaf.id)) {
        leafLabelMap.set(leaf.id, leaf.label);
      }
    });
    if (group.leaves.length === 1) {
      const leaf = group.leaves[0];
      singleLeafByMetric.set(group.metricKey, {
        label: leaf.label,
        isValue: isValueLeaf(leaf),
      });
    }
  });

  const result: PivotTreeData = { rows: {}, cols: {}, cells: {} };

  const ensureNode = (
    axis: 'row' | 'col',
    path: PivotPath,
    fullDepth: number,
    isSubtotal?: boolean,
  ) => {
    const nodes = axis === 'row' ? result.rows : result.cols;
    const key = serializePath(path);
    if (nodes[key]) {
      const existing = nodes[key];
      // A base tree node can be terminal before we inject metric/leaf tiers.
      // Promote it to an internal node when a deeper hierarchy is added.
      if (
        promoteExistingNodes &&
        path.length < fullDepth &&
        !existing.hasChildren
      ) {
        nodes[key] = {
          ...existing,
          hasChildren: true,
          isSubtotal: true,
        };
      }
      return nodes[key];
    }
    const sourceNodes = axis === 'row' ? tree.rows : tree.cols;
    const sourceNode = sourceNodes[key];
    const rawValue = path[path.length - 1];
    const rawLabel =
      path.length === 0
        ? 'Grand total'
        : formatPivotLabelValue(rawValue ?? null, 'Grand total');
    const baseLabel = sourceNode?.formattedLabel ?? rawLabel;
    const metricKey = decodeMetricKey(rawValue);
    const metricDisplayLabel = metricKey
      ? (metricLabelMap?.[metricKey] ?? metricKey)
      : undefined;
    const leafId = decodeMeasureLeafId(rawValue);
    let label = metricDisplayLabel || baseLabel;
    if (leafId) {
      label = leafLabelMap.get(leafId) ?? baseLabel;
    }
    if (metricKey && !leafTierVisible) {
      const leaf = singleLeafByMetric.get(metricKey);
      if (leaf && !leaf.isValue) {
        label = `${metricDisplayLabel ?? metricKey} ${leaf.label}`;
      }
    }
    const isMetricNode = metricTokenSet.has(
      String(path[path.length - 1] ?? ''),
    );
    const isLeafNode = leafId !== undefined;
    let hasChildren = path.length < fullDepth;
    if (isMetricNode && !leafTierVisible) {
      if (
        axis === 'row' &&
        valueAxis === 'row' &&
        insertIndex >= rowGroupby.length
      ) {
        hasChildren = false;
      }
      if (
        axis === 'col' &&
        valueAxis === 'col' &&
        insertIndex >= colGroupby.length
      ) {
        hasChildren = false;
      }
    }
    if (isLeafNode && !leafTierVisible) {
      hasChildren = false;
    }
    const isSubtotalValue =
      isSubtotal ??
      (path.length < fullDepth &&
        !(isMetricNode && hasChildren === false) &&
        !(isLeafNode && hasChildren === false));
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

  if (valueAxis === 'row') {
    const rowDepthWithMeasures = rowGroupby.length + (leafTierVisible ? 2 : 1);

    if (preserveValueAxisSourceNodes) {
      Object.values(tree.rows).forEach(rowNode =>
        ensureNode(
          'row',
          rowNode.path,
          rowGroupby.length,
          rowNode.isSubtotal || undefined,
        ),
      );
    }

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
      const colKey = serializePath(colPath);
      const isTotalRow = rowPath.length === 0 || rowPath.some(isSubtotalToken);
      if (valuesAtEnd && rowPath.length < rowGroupby.length && !isTotalRow) {
        ensureNode(
          'row',
          rowPath,
          rowGroupby.length,
          baseRow?.isSubtotal || undefined,
        );
        ensureNode(
          'col',
          colPath,
          colGroupby.length,
          baseCol?.isSubtotal || undefined,
        );
        const cellKey = serializeCellKey(rowKey, colKey);
        result.cells[cellKey] = result.cells[cellKey] || {
          rowKey,
          colKey,
          values: cell.values,
          isSubtotal: cell.isSubtotal,
        };
        return;
      }

      groups.forEach(group => {
        const metric = group.metricKey;
        const mergedValues = {
          [metric]: cell.values[metric],
          ...cell.values,
        };
        const metricToken = encodeMetricKey(metric);
        const hasSubtotalAtInsert =
          rowSuffix.length > 0 && isSubtotalToken(rowSuffix[0]);
        const metricAxisPath = hasSubtotalAtInsert
          ? [...rowPrefix, rowSuffix[0], metricToken]
          : [...rowPrefix, metricToken];
        const rowTail = hasSubtotalAtInsert ? rowSuffix.slice(1) : rowSuffix;

        const leafTargets = leafTierVisible ? group.leaves : [group.leaves[0]];
        leafTargets.forEach(leaf => {
          const newRowPath = leafTierVisible
            ? [...metricAxisPath, encodeMeasureLeafKey(leaf.id), ...rowTail]
            : [...metricAxisPath, ...rowTail];
          for (let depth = 0; depth <= newRowPath.length; depth += 1) {
            const subPath = newRowPath.slice(0, depth);
            ensureNode(
              'row',
              subPath,
              rowDepthWithMeasures,
              baseRow?.isSubtotal || undefined,
            );
          }
          const newRowKey = serializePath(newRowPath);

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
          if (metricKeys.length === 1) {
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
    });
  } else {
    const colDepthWithMeasures = colGroupby.length + (leafTierVisible ? 2 : 1);

    if (preserveValueAxisSourceNodes) {
      Object.values(tree.cols).forEach(colNode =>
        ensureNode(
          'col',
          colNode.path,
          colGroupby.length,
          colNode.isSubtotal || undefined,
        ),
      );
    }

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

      groups.forEach(group => {
        const metric = group.metricKey;
        const mergedValues = {
          [metric]: cell.values[metric],
          ...cell.values,
        };
        const metricToken = encodeMetricKey(metric);
        const baseMetricPath = [...colPrefix, metricToken];
        const colTail = colSuffix;
        const leafTargets = leafTierVisible ? group.leaves : [group.leaves[0]];
        leafTargets.forEach(leaf => {
          const newColPath = leafTierVisible
            ? [...baseMetricPath, encodeMeasureLeafKey(leaf.id), ...colTail]
            : [...baseMetricPath, ...colTail];
          for (let depth = 0; depth <= newColPath.length; depth += 1) {
            const subPath = newColPath.slice(0, depth);
            ensureNode(
              'col',
              subPath,
              colDepthWithMeasures,
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
          if (metricKeys.length === 1 && insertIndex === 0) {
            const rootColKey = serializePath(colPrefix);
            const cellKey = serializeCellKey(rowKey, rootColKey);
            result.cells[cellKey] = result.cells[cellKey] || {
              rowKey,
              colKey: rootColKey,
              values: mergedValues,
              isSubtotal: cell.isSubtotal,
            };
          }
          if (
            metricKeys.length === 1 &&
            (insertIndex >= colGroupby.length ||
              insertIndex === 0 ||
              (insertIndex > 0 &&
                insertIndex < colGroupby.length &&
                colPath.length <= insertIndex))
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
    });
  }

  return result;
};

// Legacy flat-metric wrapper kept for direct tree fixtures.
export const applyMetricAxis = (
  tree: PivotTreeData,
  metrics: QueryFormMetric[],
  metricsLayout: MetricsLayoutEnum,
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  metricPosition?: number,
  metricLabelMap?: Record<string, string>,
): PivotTreeData => {
  const program = buildMetricAxisProgram({
    metrics,
    metricsLayout,
    rowGroupby,
    colGroupby,
    metricPosition,
  });
  const { metricKeys } = program;
  const valueAxis = getValueAxis(program);
  const insertIndex = getValuesInsertIndex(program);
  const axisDepth = getAxisDimensions(program, valueAxis).length;
  return applyMeasureAxis({
    tree,
    groups: metricKeys.map(metricKey => ({
      metricKey,
      leaves: [buildValueLeaf()],
    })),
    leafTierVisible: false,
    program,
    metricLabelMap,
    preserveValueAxisSourceNodes: insertIndex === 0 || insertIndex >= axisDepth,
    promoteExistingNodes: true,
  });
};

export function applyMeasureHierarchyAxis(
  tree: PivotTreeData,
  measureHierarchy: MeasureHierarchy,
  program: PivotProgram,
  metricLabelMap?: Record<string, string>,
): PivotTreeData;
export function applyMeasureHierarchyAxis(
  tree: PivotTreeData,
  measureHierarchy: MeasureHierarchy,
  metricsLayout: MetricsLayoutEnum,
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  metricPosition?: number,
  metricLabelMap?: Record<string, string>,
): PivotTreeData;
export function applyMeasureHierarchyAxis(
  tree: PivotTreeData,
  measureHierarchy: MeasureHierarchy,
  programOrMetricsLayout: PivotProgram | MetricsLayoutEnum,
  metricLabelMapOrRowGroupby?: Record<string, string> | QueryFormColumn[],
  colGroupby?: QueryFormColumn[],
  metricPosition?: number,
  legacyMetricLabelMap?: Record<string, string>,
): PivotTreeData {
  // Temporary runtime bridge until measure-axis construction fully moves under
  // runtime/materializePivotTree.
  const usesProgram = typeof programOrMetricsLayout === 'object';
  const program = usesProgram
    ? programOrMetricsLayout
    : buildMetricAxisProgram({
        metrics:
          measureHierarchy.kind === 'flatMetrics'
            ? measureHierarchy.metricKeys
            : measureHierarchy.groups.map(group => group.metricKey),
        metricsLayout: programOrMetricsLayout,
        rowGroupby: Array.isArray(metricLabelMapOrRowGroupby)
          ? metricLabelMapOrRowGroupby
          : [],
        colGroupby: colGroupby ?? [],
        metricPosition,
      });
  const metricLabelMap = usesProgram
    ? (metricLabelMapOrRowGroupby as Record<string, string> | undefined)
    : legacyMetricLabelMap;
  if (measureHierarchy.kind === 'flatMetrics') {
    const insertIndex = getValuesInsertIndex(program);
    const valueAxis = getValueAxis(program);
    const axisDepth = getAxisDimensions(program, valueAxis).length;
    return applyMeasureAxis({
      tree,
      groups: measureHierarchy.metricKeys.map(metricKey => ({
        metricKey,
        leaves: [buildValueLeaf()],
      })),
      leafTierVisible: false,
      program,
      metricLabelMap,
      preserveValueAxisSourceNodes:
        insertIndex === 0 || insertIndex >= axisDepth,
      promoteExistingNodes: true,
    });
  }
  return applyMeasureAxis({
    tree,
    groups: measureHierarchy.groups,
    leafTierVisible: measureHierarchy.leafTierVisibility === 'visible',
    program,
    metricLabelMap,
    preserveValueAxisSourceNodes: true,
    promoteExistingNodes: false,
  });
}

// Legacy raw-record tree fixture helper. Production paths materialize facts via
// runtime/materializePivotTree.
export const buildTreeFromRecords = (
  records: DataRecord[],
  metrics: QueryFormMetric[],
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  rowDepth: number,
  colDepth: number,
  dateFormatters?: Record<string, DateFormatter | undefined>,
): PivotTreeData => {
  const tree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const metricKeys = getMetricKeys(metrics);
  const metricKeySet = new Set(metricKeys);
  const metricPrefixes = metricKeys.map(key => `${key}__`);
  const firstRecord = records[0];
  const metricValueKeys =
    firstRecord && metricPrefixes.length > 0
      ? [
          ...metricKeys,
          ...Object.keys(firstRecord).filter(
            key =>
              !metricKeySet.has(key) &&
              metricPrefixes.some(prefix => key.startsWith(prefix)),
          ),
        ]
      : metricKeys;
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
    const groupby = axis === 'row' ? rowGroupby : colGroupby;
    const column = groupby[path.length - 1];
    const columnLabel = column ? getColumnLabel(column) : undefined;
    const formatter = columnLabel ? dateFormatters?.[columnLabel] : undefined;
    const formattedLabel =
      path.length === 0 || rawValue === null || rawValue === undefined
        ? label
        : formatter
          ? (formatter as (value: DataRecordValue) => string)(rawValue)
          : label;
    nodes[key] = {
      axis,
      key,
      path,
      label,
      formattedLabel,
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

    const values = metricValueKeys.reduce(
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
