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
  type DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import {
  type MeasureHierarchy,
  type MeasureLeafSpec,
  MetricsLayoutEnum,
  type PivotPath,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { formatPivotLabelValue, mergeTrees } from '../core/tree';
import { serializeCellKey, serializePath } from '../core/path';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  encodeMeasureLeafKey,
  encodeMetricKey,
  getMetricKeys,
  isSubtotalToken,
  METRICS_PLACEHOLDER,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from '../core/tokens';
import {
  applyMeasureLeafValuesToTree,
  buildValueLeaf,
  isValueLeaf,
} from '../measureLeaves';
import { type LayoutContext } from '../layout/LayoutContext';
import { type PlannedQuerySpec } from '../query/specs';
import { compilePivotProgram } from './compilePivotProgram';
import { type PivotFactCoverage, type PivotProgram } from './types';
import {
  type PivotFact,
  type PivotFactSelector,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from './factStore';

type MaterializationFactBatch = {
  facts: PivotFact[];
  coverage: PivotFactCoverage;
};

export const factStoreBatchScopeFromSpec = (
  spec: PlannedQuerySpec,
): PivotFactStoreBatch['scope'] => {
  if (spec.meta.kind === 'branch') {
    if (!spec.meta.axis) {
      throw new Error('Branch fact-store batch requires an axis');
    }
    return {
      kind: 'branch',
      axis: spec.meta.axis,
      path: spec.meta.path ?? [],
    };
  }
  if (spec.meta.kind === 'batch') {
    if (!spec.meta.axis) {
      throw new Error('Batch fact-store batch requires an axis');
    }
    return {
      kind: 'batch',
      axis: spec.meta.axis,
      parentPath: spec.meta.parentPath ?? [],
      siblingValues: spec.meta.siblingValues ?? [],
    };
  }
  return {
    kind: spec.meta.kind,
  };
};

export const factStoreSelectorFromSpec = (
  spec: PlannedQuerySpec,
): PivotFactSelector => ({
  coverage: spec.meta.coverage,
  scope: factStoreBatchScopeFromSpec(spec),
});

export const buildFactStoreBatchesFromSpecs = ({
  store,
  specs,
}: {
  store: PivotFactStore;
  specs: PlannedQuerySpec[];
}): PivotFactStoreBatch[] =>
  specs.map(spec => ({
    ...factStoreSelectorFromSpec(spec),
    facts: store.getFacts(factStoreSelectorFromSpec(spec)),
  }));

const factBatchFromStore = ({
  store,
  spec,
}: {
  store: PivotFactStore;
  spec: PlannedQuerySpec;
}): MaterializationFactBatch => ({
  facts: store.getFacts(factStoreSelectorFromSpec(spec)),
  coverage: spec.meta.coverage,
});

const buildTreeFromFacts = ({
  facts,
  rowColumns,
  columnColumns,
  rowFullDepth,
  columnFullDepth,
  dateFormatters,
}: {
  facts: PivotFact[];
  rowColumns: QueryFormColumn[];
  columnColumns: QueryFormColumn[];
  rowFullDepth: number;
  columnFullDepth: number;
  dateFormatters?: PivotTableQueryFormData['dateFormatters'];
}): PivotTreeData => {
  const tree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const rootKey = serializePath([]);
  let grandTotalValues: Record<string, DataRecordValue> = {};

  const ensureNode = (
    axis: 'row' | 'col',
    path: PivotPath,
    totalLabel: string,
  ) => {
    const nodes = axis === 'row' ? tree.rows : tree.cols;
    const key = serializePath(path);
    if (nodes[key]) {
      return;
    }
    const rawValue = path[path.length - 1];
    const label =
      path.length === 0
        ? 'Grand total'
        : formatPivotLabelValue(rawValue, totalLabel);
    const groupby = axis === 'row' ? rowColumns : columnColumns;
    const column = groupby[path.length - 1];
    const columnLabel = column ? getColumnLabel(column) : undefined;
    const formatter = columnLabel ? dateFormatters?.[columnLabel] : undefined;
    const formattedLabel =
      path.length === 0 || rawValue === null || rawValue === undefined
        ? label
        : formatter
          ? formatter(rawValue)
          : label;
    nodes[key] = {
      axis,
      key,
      path,
      label,
      formattedLabel,
      level: path.length,
      hasChildren:
        path.length < (axis === 'row' ? rowFullDepth : columnFullDepth),
      isSubtotal:
        path.length < (axis === 'row' ? rowFullDepth : columnFullDepth),
    };
  };

  facts.forEach(({ rowPath, columnPath: colPath, valueKey, value }) => {
    for (let idx = 0; idx <= rowPath.length; idx += 1) {
      ensureNode('row', rowPath.slice(0, idx), 'Total');
    }
    for (let idx = 0; idx <= colPath.length; idx += 1) {
      ensureNode('col', colPath.slice(0, idx), 'Total');
    }

    const rowKey = serializePath(rowPath);
    const colKey = serializePath(colPath);
    const values = { [valueKey]: value };

    if (colPath.length === 0) {
      tree.rows[rowKey].values = {
        ...(tree.rows[rowKey].values || {}),
        ...values,
      };
    }
    if (rowPath.length === 0) {
      tree.cols[colKey].values = {
        ...(tree.cols[colKey].values || {}),
        ...values,
      };
    }

    const cellKey = serializeCellKey(rowKey, colKey);
    const existingCell = tree.cells[cellKey];
    tree.cells[cellKey] = {
      rowKey,
      colKey,
      values: {
        ...(existingCell?.values || {}),
        ...values,
      },
      isSubtotal:
        rowPath.length < rowFullDepth || colPath.length < columnFullDepth,
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
  const rootValues =
    hasGrandTotalValues || Object.keys(mergedRootValues).length > 0
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

const injectAxisSubtotalLeaves = ({
  tree,
  axis,
  depth,
  fullDepth,
}: {
  tree: PivotTreeData;
  axis: 'row' | 'col';
  depth: number;
  fullDepth: number;
}) => {
  if (depth <= 0 || depth >= fullDepth) {
    return tree;
  }
  const next: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };
  const sourceNodes = axis === 'row' ? tree.rows : tree.cols;
  const nextNodes = axis === 'row' ? next.rows : next.cols;
  const subtotalNodes = Object.values(sourceNodes).filter(
    node =>
      node.path.length === depth &&
      node.path.length > 0 &&
      (axis === 'col' || !node.path.some(val => isSubtotalToken(val))),
  );
  subtotalNodes.forEach(node => {
    const subtotalPath = [...node.path, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    if (!nextNodes[subtotalKey]) {
      nextNodes[subtotalKey] = {
        ...node,
        key: subtotalKey,
        path: subtotalPath,
        label: SUBTOTAL_LABEL,
        formattedLabel: SUBTOTAL_LABEL,
        level: subtotalPath.length,
        hasChildren: axis === 'col' ? subtotalPath.length < fullDepth : false,
        isSubtotal: true,
      };
    }
  });
  Object.values(tree.cells).forEach(cell => {
    const basePath =
      axis === 'row'
        ? tree.rows[cell.rowKey]?.path
        : tree.cols[cell.colKey]?.path;
    if (
      !basePath ||
      basePath.length !== depth ||
      basePath.length === 0 ||
      (axis === 'row' && basePath.some(val => isSubtotalToken(val)))
    ) {
      return;
    }
    const subtotalKey = serializePath([...basePath, SUBTOTAL_TOKEN]);
    if (axis === 'row') {
      const cellKey = serializeCellKey(subtotalKey, cell.colKey);
      next.cells[cellKey] = {
        ...cell,
        rowKey: subtotalKey,
        isSubtotal: true,
      };
      return;
    }
    const cellKey = serializeCellKey(cell.rowKey, subtotalKey);
    next.cells[cellKey] = {
      ...cell,
      colKey: subtotalKey,
      isSubtotal: true,
    };
  });
  return next;
};

export const injectRowSubtotalLeaves = (
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) => injectAxisSubtotalLeaves({ tree, axis: 'row', depth, fullDepth });

const injectColumnSubtotalLeaves = (
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) => injectAxisSubtotalLeaves({ tree, axis: 'col', depth, fullDepth });

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

const buildTreeFromFactBatch = ({
  batch,
  formData,
  pivotProgram,
  rowSubtotalLevels,
  colSubtotalLevels,
}: {
  batch: MaterializationFactBatch;
  formData: PivotTableQueryFormData;
  pivotProgram: PivotProgram;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
}) => {
  const { coverage } = batch;
  const rowFullDepth = pivotProgram.rowDimensions.length;
  const columnFullDepth = pivotProgram.columnDimensions.length;
  let tree = buildTreeFromFacts({
    facts: batch.facts,
    rowColumns: coverage.rowDimensions,
    columnColumns: coverage.columnDimensions,
    rowFullDepth,
    columnFullDepth,
    dateFormatters: formData.dateFormatters,
  });
  if (colSubtotalLevels.includes(coverage.columnDepth)) {
    tree = injectColumnSubtotalLeaves(
      tree,
      coverage.columnDepth,
      columnFullDepth,
    );
  }
  const rowSubtotalDepths = rowSubtotalLevels.filter(
    level => level > 0 && level <= coverage.rowDepth,
  );
  rowSubtotalDepths.forEach(depth => {
    tree = injectRowSubtotalLeaves(tree, depth, rowFullDepth);
  });
  return tree;
};

export const materializePivotTree = ({
  batches,
  metricsForQuery,
  formData,
  measureHierarchy,
  materializedMetrics,
  materializedMeasureHierarchy,
  rowSubtotalLevels,
  colSubtotalLevels,
  pivotProgram,
}: {
  batches: MaterializationFactBatch[];
  metricsForQuery: QueryFormMetric[];
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
  materializedMetrics?: QueryFormMetric[];
  materializedMeasureHierarchy?: MeasureHierarchy;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  pivotProgram: PivotProgram;
}): PivotTreeData => {
  const queryMetrics =
    metricsForQuery.length > 0 ? metricsForQuery : formData.metrics;
  const visibleMetrics = materializedMetrics ?? queryMetrics;
  const visibleMeasureHierarchy =
    materializedMeasureHierarchy ?? measureHierarchy;
  const branchTree = batches.reduce<PivotTreeData>(
    (acc, batch) =>
      mergeTrees(
        acc,
        buildTreeFromFactBatch({
          batch,
          formData,
          pivotProgram,
          rowSubtotalLevels,
          colSubtotalLevels,
        }),
      ),
    {} as PivotTreeData,
  );
  const branchWithMeasures = applyMeasureHierarchyAxis(
    applyMeasureLeafValuesToTree({
      tree: branchTree,
      measureHierarchy: visibleMeasureHierarchy,
    }),
    visibleMeasureHierarchy,
    pivotProgram,
    formData.metricLabelMap as Record<string, string> | undefined,
  );
  return labelRowSubtotalLeaves(
    branchWithMeasures,
    ensureIsArray(visibleMetrics),
    formData.metricLabelMap as Record<string, string> | undefined,
  );
};

export const canMaterializeSpecsFromFactStore = ({
  specs,
  store,
}: {
  specs: PlannedQuerySpec[];
  store: PivotFactStore;
}) => specs.every(spec => store.hasCoverage(factStoreSelectorFromSpec(spec)));

export const buildBranchTreeFromFactStore = ({
  specs,
  store,
  formData,
  measureHierarchy,
}: {
  specs: PlannedQuerySpec[];
  store: PivotFactStore;
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
}): PivotTreeData => {
  const firstSpec = specs[0];
  if (!firstSpec) {
    return { rows: {}, cols: {}, cells: {} };
  }
  return materializePivotTree({
    batches: specs.map(spec => factBatchFromStore({ store, spec })),
    metricsForQuery: firstSpec.metrics,
    formData,
    measureHierarchy,
    materializedMetrics: firstSpec.meta.materializedMetrics,
    materializedMeasureHierarchy: firstSpec.meta.materializedMeasureHierarchy,
    rowSubtotalLevels: firstSpec.meta.rowSubtotalLevels,
    colSubtotalLevels: firstSpec.meta.colSubtotalLevels,
    pivotProgram: firstSpec.meta.pivotProgram,
  });
};

export const materializeInitialPivotTreeFromFactStore = ({
  specs,
  store,
  layout,
  formData,
}: {
  specs: PlannedQuerySpec[];
  store: PivotFactStore;
  layout: LayoutContext;
  formData: PivotTableQueryFormData;
}): PivotTreeData => {
  const rootKey = serializePath([]);
  const emptyTree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const mergedTree = specs.reduce((acc, spec) => {
    const nextTree = materializePivotTree({
      batches: [factBatchFromStore({ store, spec })],
      metricsForQuery: spec.metrics,
      formData,
      measureHierarchy: layout.measureHierarchy,
      materializedMetrics: spec.meta.materializedMetrics,
      materializedMeasureHierarchy: spec.meta.materializedMeasureHierarchy,
      rowSubtotalLevels: spec.meta.rowSubtotalLevels,
      colSubtotalLevels: spec.meta.colSubtotalLevels,
      pivotProgram: spec.meta.pivotProgram,
    });
    return mergeTrees(acc, nextTree);
  }, emptyTree);
  if (mergedTree.rows[rootKey]) {
    mergedTree.rows[rootKey] = {
      ...mergedTree.rows[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }
  if (mergedTree.cols[rootKey]) {
    mergedTree.cols[rootKey] = {
      ...mergedTree.cols[rootKey],
      label: 'Grand total',
      formattedLabel: 'Grand total',
    };
  }
  return applyMeasureLeafValuesToTree({
    tree: mergedTree,
    measureHierarchy: layout.measureHierarchy,
  });
};
