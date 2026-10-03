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
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import {
  type MeasureHierarchy,
  type MeasureLeafSpec,
  type PivotAxis,
  type PivotPath,
  type PivotResultCell,
  type PivotTableQueryFormData,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { serializeCellKey, serializePath } from '../core/path';
import {
  decodeMeasureLeafId,
  decodeMetricKey,
  encodeMeasureLeafKey,
  encodeMetricKey,
  isSubtotalToken,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from '../core/tokens';
import { getMetricKey, getMetricKeys } from '../metrics';
import { createMetricNodePolicy } from '../metricsTotals';
import {
  buildMeasureLeafOutputKey,
  computeMeasureLeafValue,
  getMeasureLeafValueKeys,
  isValueLeaf,
} from '../measureLeaves';
import { type LayoutContext } from '../layout/LayoutContext';
import { type PivotFactCoverage, type PivotProgram } from './types';
import {
  buildPivotFactQueryContextKey,
  type PivotFact,
  type PivotFactMaterialization,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from './factStore';
import {
  assertChunkedWorkCurrent,
  type ChunkedWorkOptions,
  DEFAULT_RUNTIME_CHUNK_SIZE,
  yieldChunkedWork,
} from './chunkedWork';
import { formatPivotLabelValue } from '../viewModel';

type MaterializationFactBatch = {
  complete?: boolean;
  facts: PivotFact[];
  coverage: PivotFactCoverage;
};

type MaterializePivotTreeInput = {
  batches: MaterializationFactBatch[];
  metrics: QueryFormMetric[];
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  pivotProgram: PivotProgram;
};

const emptyPivotTree = (): PivotTreeData => ({ rows: {}, cols: {}, cells: {} });

const mergeValues = <T extends { isSubtotal?: boolean }>(
  existingValues: Record<string, DataRecordValue> | undefined,
  incomingValues: Record<string, DataRecordValue> | undefined,
  existing: T,
  incoming: T,
) => {
  if (!incomingValues || Object.keys(incomingValues).length === 0) {
    return existingValues;
  }
  if (incoming.isSubtotal) {
    return { ...incomingValues, ...existingValues };
  }
  return { ...existingValues, ...incomingValues };
};

const mergeTreeValueMapsInto = <
  T extends {
    values?: Record<string, DataRecordValue>;
    isSubtotal?: boolean;
    isPartial?: boolean;
  },
>(
  result: Record<string, T>,
  incoming: Record<string, T>,
) => {
  Object.entries(incoming).forEach(([key, item]) => {
    const existing = result[key];
    if (!existing) {
      result[key] = item;
      return;
    }
    const values = mergeValues(existing.values, item.values, existing, item);
    result[key] = {
      ...existing,
      ...item,
      isPartial: (existing.isPartial && item.isPartial) || undefined,
      ...(values ? { values } : {}),
    };
  });
};

const mergeTreeCellsInto = (
  result: PivotTreeData['cells'],
  incoming: PivotTreeData['cells'],
) => {
  Object.entries(incoming).forEach(([key, cell]) => {
    const existing = result[key];
    if (!existing) {
      result[key] = cell;
      return;
    }
    const values = mergeValues(existing.values, cell.values, existing, cell)!;
    const partialValueKeys: string[] = [];
    if (existing.partialValueKeys?.length || cell.partialValueKeys?.length) {
      const existingPartialKeys = new Set(existing.partialValueKeys);
      const incomingPartialKeys = new Set(cell.partialValueKeys);
      const partialKeys = new Set([
        ...existingPartialKeys,
        ...incomingPartialKeys,
      ]);
      partialKeys.forEach(valueKey => {
        const existingHasValue = Object.hasOwn(existing.values, valueKey);
        const incomingHasValue = Object.hasOwn(cell.values, valueKey);
        const existingPartial = existingPartialKeys.has(valueKey);
        const incomingPartial = incomingPartialKeys.has(valueKey);
        // A complete value supersedes a partial value, regardless of batch order.
        const useIncoming =
          incomingHasValue &&
          (!existingHasValue ||
            (existingPartial && !incomingPartial) ||
            (Boolean(existingPartial) === Boolean(incomingPartial) &&
              !cell.isSubtotal));
        const source = useIncoming ? cell : existing;
        values[valueKey] = source.values[valueKey];
        if (
          useIncoming
            ? incomingPartialKeys.has(valueKey)
            : existingPartialKeys.has(valueKey)
        )
          partialValueKeys.push(valueKey);
      });
    }
    result[key] = {
      ...existing,
      ...cell,
      partialValueKeys: partialValueKeys.length ? partialValueKeys : undefined,
      ...(values ? { values } : {}),
      isSubtotal: cell.isSubtotal ?? existing.isSubtotal,
    };
  });
};

/** Merges into a privately owned accumulator, without copying the growing tree. */
const mergeTreeInto = (target: PivotTreeData, source: PivotTreeData) => {
  mergeTreeValueMapsInto(target.rows, source.rows);
  mergeTreeValueMapsInto(target.cols, source.cols);
  mergeTreeCellsInto(target.cells, source.cells);
};

const buildBatchMaterializationProgram = ({
  program,
  coverage,
  materialization,
}: {
  program: PivotProgram;
  coverage: PivotFactCoverage;
  materialization?: PivotFactMaterialization;
}): PivotProgram => {
  if (!materialization || materialization.valueAxis !== program.valueAxis) {
    return program;
  }

  const rowDimensions =
    materialization.valueAxis === 'row'
      ? coverage.rowDimensions
      : program.rowDimensions;
  const columnDimensions =
    materialization.valueAxis === 'col'
      ? coverage.columnDimensions
      : program.columnDimensions;
  const metricInsertIndex = Math.max(
    0,
    Math.min(
      materialization.valueInsertIndex,
      materialization.valueAxis === 'row'
        ? rowDimensions.length
        : columnDimensions.length,
    ),
  );

  return {
    ...program,
    rowDimensions,
    columnDimensions,
    metricInsertIndex,
  };
};

const deriveBatchMaterializationPlan = ({
  batch,
  layout,
}: {
  batch: PivotFactStoreBatch;
  layout: LayoutContext;
}) => {
  const valueKeys = new Set(batch.valueKeys);
  const valueKeyList = Array.from(valueKeys);
  const loadedMetrics = layout.metrics.filter(metric => {
    const metricKey = getMetricKey(metric);
    return metricKey
      ? valueKeys.has(metricKey) ||
          valueKeyList.some(valueKey => valueKey.startsWith(`${metricKey}__`))
      : false;
  });
  const loadedMetricKeys = new Set(getMetricKeys(loadedMetrics));
  const materializedMeasureHierarchy: MeasureHierarchy = {
    ...layout.measureHierarchy,
    groups: layout.measureHierarchy.groups.filter(group =>
      loadedMetricKeys.has(group.metricKey),
    ),
  };

  const pivotProgram = buildBatchMaterializationProgram({
    program: layout.pivotProgram,
    coverage: batch.coverage,
    materialization: batch.materialization,
  });

  return {
    metrics: loadedMetrics,
    measureHierarchy: materializedMeasureHierarchy,
    rowSubtotalLevels: layout.rowSubtotalLevels,
    colSubtotalLevels: layout.colSubtotalLevelsForQuery,
    pivotProgram,
  };
};

const applyMeasureLeafValues = (
  cell: PivotResultCell,
  groups: MeasureAxisGroup[],
) => {
  const next = { ...cell.values };
  const partialKeys = cell.partialValueKeys?.length
    ? new Set(cell.partialValueKeys)
    : undefined;
  groups.forEach(group => {
    group.leaves.forEach(leaf => {
      const outputKey = buildMeasureLeafOutputKey(group.metricKey, leaf);
      if (outputKey in next) {
        return;
      }
      const computed = computeMeasureLeafValue({
        values: next,
        metricKey: group.metricKey,
        leaf,
      });
      if (computed !== undefined) {
        next[outputKey] = computed;
        if (
          getMeasureLeafValueKeys(group.metricKey, leaf).some(key =>
            partialKeys?.has(key),
          )
        ) {
          partialKeys?.add(outputKey);
        }
      }
    });
  });
  return {
    values: next,
    partialValueKeys: partialKeys?.size ? Array.from(partialKeys) : undefined,
  };
};

const createDimensionDisplayLabels = (
  path: PivotPath,
  totalLabel: string,
  dateFormatters?: PivotTableQueryFormData['dateFormatters'],
  dimensionKey?: string,
  sourceLabel?: string,
) => {
  const rawValue = path[path.length - 1];
  const label =
    sourceLabel ??
    (path.length === 0
      ? 'Grand total'
      : formatPivotLabelValue(rawValue ?? null, totalLabel));
  const formatter =
    path.length > 0 &&
    rawValue !== null &&
    rawValue !== undefined &&
    dimensionKey !== undefined
      ? dateFormatters?.[dimensionKey]
      : undefined;
  return {
    label,
    formattedLabel: formatter
      ? (formatter as (value: DataRecordValue) => string)(
          rawValue as DataRecordValue,
        )
      : label,
  };
};

type FactTreeBuilderInput = {
  complete?: boolean;
  rowColumns: QueryFormColumn[];
  columnColumns: QueryFormColumn[];
  rowFullDepth: number;
  columnFullDepth: number;
  dateFormatters?: PivotTableQueryFormData['dateFormatters'];
};

const createFactTreeBuilder = ({
  complete,
  rowColumns,
  columnColumns,
  rowFullDepth,
  columnFullDepth,
  dateFormatters,
}: FactTreeBuilderInput) => {
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
    if (Object.prototype.hasOwnProperty.call(nodes, key)) {
      return;
    }
    const groupby = axis === 'row' ? rowColumns : columnColumns;
    const column = groupby[path.length - 1];
    const { label, formattedLabel } = createDimensionDisplayLabels(
      path,
      totalLabel,
      dateFormatters,
      column ? getColumnLabel(column) : undefined,
    );
    nodes[key] = {
      axis,
      key,
      path,
      label,
      formattedLabel,
      isPartial: (complete === false && path.length > 0) || undefined,
      level: path.length,
      hasChildren:
        path.length < (axis === 'row' ? rowFullDepth : columnFullDepth),
      isSubtotal:
        path.length < (axis === 'row' ? rowFullDepth : columnFullDepth),
    };
  };

  const addFact = ({
    rowPath,
    columnPath: colPath,
    valueKey,
    value,
  }: PivotFact) => {
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
        ...tree.rows[rowKey].values,
        ...values,
      };
    }
    if (rowPath.length === 0) {
      tree.cols[colKey].values = {
        ...tree.cols[colKey].values,
        ...values,
      };
    }

    const cellKey = serializeCellKey(rowKey, colKey);
    const existingCell = tree.cells[cellKey];
    tree.cells[cellKey] = {
      rowKey,
      colKey,
      partialValueKeys:
        complete === false
          ? [...(existingCell?.partialValueKeys ?? []), valueKey]
          : undefined,
      values: {
        ...existingCell?.values,
        ...values,
      },
      isSubtotal:
        rowPath.length < rowFullDepth || colPath.length < columnFullDepth,
    };

    if (rowPath.length === 0 && colPath.length === 0) {
      grandTotalValues = { ...grandTotalValues, ...values };
    }
  };

  const finish = () => {
    ensureNode('row', [], 'Grand total');
    ensureNode('col', [], 'Grand total');
    const mergedRootValues = {
      ...tree.rows[rootKey]?.values,
      ...tree.cols[rootKey]?.values,
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
        partialValueKeys:
          complete === false ? Object.keys(rootValues) : undefined,
        isSubtotal: true,
      };
    }

    return tree;
  };

  return {
    addFact,
    finish,
  };
};

const injectAxisSubtotalLeaves = ({
  tree,
  axis,
  depths,
  fullDepth,
}: {
  tree: PivotTreeData;
  axis: 'row' | 'col';
  depths: number[];
  fullDepth: number;
}) => {
  const levels = new Set(
    depths.filter(depth => depth > 0 && depth < fullDepth),
  );
  if (!levels.size) {
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
      levels.has(node.path.length) &&
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
      !levels.has(basePath.length) ||
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
) =>
  injectAxisSubtotalLeaves({ tree, axis: 'row', depths: [depth], fullDepth });

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
    const nextParentKey =
      metricLabelIndex !== undefined &&
      metricLabelIndex > subtotalIndex &&
      basePath &&
      basePath.length > 0
        ? serializePath(basePath)
        : node.parentKey;
    if (
      node.label !== nextLabel ||
      node.formattedLabel !== nextLabel ||
      node.parentKey !== nextParentKey
    ) {
      nextRows[node.key] = {
        ...node,
        parentKey: nextParentKey,
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
  colSubtotalLevels: number[];
  metricLabelMap?: Record<string, string>;
  dateFormatters?: PivotTableQueryFormData['dateFormatters'];
};

const applyMeasureAxis = ({
  tree,
  groups,
  leafTierVisible,
  program,
  colSubtotalLevels,
  metricLabelMap,
  dateFormatters,
}: ApplyMeasureAxisInput): PivotTreeData => {
  if (groups.length === 0) {
    return tree;
  }
  const {
    valueAxis,
    rowDimensions: rowGroupby,
    columnDimensions: colGroupby,
    metricInsertIndex: insertIndex,
  } = program;
  const valueAxisDepth =
    valueAxis === 'row' ? rowGroupby.length : colGroupby.length;
  const valuesAtEnd = insertIndex >= valueAxisDepth;
  const metricKeys = groups.map(group => group.metricKey);
  const hasSingleMetric = groups.length === 1;
  const preserveValueAxisSourceNodes =
    leafTierVisible ||
    (hasSingleMetric && (insertIndex === 0 || insertIndex >= valueAxisDepth));
  const promoteExistingNodes = !leafTierVisible;
  const metricNodePolicy = createMetricNodePolicy(program);
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
  const oppositeAxis = valueAxis === 'row' ? 'col' : 'row';
  const valueDepthWithMeasures = valueAxisDepth + (leafTierVisible ? 2 : 1);
  const oppositeAxisDepth =
    oppositeAxis === 'row' ? rowGroupby.length : colGroupby.length;

  const ensureNode = (
    axis: 'row' | 'col',
    path: PivotPath,
    fullDepth: number,
    isSubtotal?: boolean,
  ) => {
    const nodes = axis === 'row' ? result.rows : result.cols;
    const key = serializePath(path);
    if (Object.prototype.hasOwnProperty.call(nodes, key)) {
      const existing = nodes[key];
      if (
        promoteExistingNodes &&
        path.length < fullDepth &&
        !existing.hasChildren &&
        !existing.isCollapsedMetricAlias
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
    const metricKey = decodeMetricKey(rawValue);
    const leafId = decodeMeasureLeafId(rawValue);
    const dimension = (axis === 'row' ? rowGroupby : colGroupby)[
      metricNodePolicy.getNonMetricPathParts(path).length - 1
    ];
    const dimensionKey =
      !metricKey && !leafId && !isSubtotalToken(rawValue) && dimension
        ? getColumnLabel(dimension)
        : undefined;
    const { formattedLabel: baseLabel } = createDimensionDisplayLabels(
      path,
      'Grand total',
      dateFormatters,
      dimensionKey,
      sourceNode?.formattedLabel,
    );
    const metricDisplayLabel = metricKey
      ? (metricLabelMap?.[metricKey] ?? metricKey)
      : undefined;
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
    const isMetricNode = metricTokenSet.has(String(rawValue ?? ''));
    const isLeafNode = leafId !== undefined;
    const isConfiguredColumnMetricSubtotal =
      axis === 'col' &&
      valueAxis === 'col' &&
      valuesAtEnd &&
      isMetricNode &&
      !leafTierVisible &&
      colSubtotalLevels.includes(metricNodePolicy.countDimDepth(path));
    let hasChildren = path.length < fullDepth;
    if (isMetricNode && !leafTierVisible) {
      if (axis === valueAxis && valuesAtEnd) hasChildren = false;
    }
    if (isLeafNode && !leafTierVisible) {
      hasChildren = false;
    }
    const isSubtotalValue =
      isSubtotal ??
      (isConfiguredColumnMetricSubtotal ||
        (path.length < fullDepth &&
          !(isMetricNode && hasChildren === false) &&
          !(isLeafNode && hasChildren === false)));
    const node = {
      axis,
      key,
      path,
      label,
      formattedLabel: label,
      level: path.length,
      hasChildren,
      isSubtotal: isSubtotalValue,
      isPartial:
        (!metricKey &&
          !leafId &&
          path.length > 0 &&
          (
            sourceNode ??
            sourceNodes[
              serializePath(metricNodePolicy.getNonMetricPathParts(path))
            ]
          )?.isPartial) ||
        undefined,
    };
    nodes[key] = node;
    return node;
  };

  const addCell = (
    valuePath: PivotPath,
    oppositePath: PivotPath,
    content: Pick<
      PivotResultCell,
      'values' | 'partialValueKeys' | 'isSubtotal'
    >,
    overwrite = false,
  ) => {
    const valueKey = serializePath(valuePath);
    const oppositeKey = serializePath(oppositePath);
    const rowKey = valueAxis === 'row' ? valueKey : oppositeKey;
    const colKey = valueAxis === 'col' ? valueKey : oppositeKey;
    const cellKey = serializeCellKey(rowKey, colKey);
    if (overwrite || !result.cells[cellKey])
      result.cells[cellKey] = { rowKey, colKey, ...content };
  };

  const addSingleMetricBaseCells = (
    valuePath: PivotPath,
    oppositePath: PivotPath,
    prefix: PivotPath,
    content: Pick<
      PivotResultCell,
      'values' | 'partialValueKeys' | 'isSubtotal'
    >,
  ) => {
    if (!hasSingleMetric) return;
    if (valueAxis === 'row') {
      addCell(valuePath, oppositePath, content);
    } else {
      if (insertIndex === 0) addCell(prefix, oppositePath, content);
      if (valuesAtEnd || insertIndex === 0 || valuePath.length <= insertIndex)
        addCell(valuePath, oppositePath, content);
    }
  };

  const sourceNodesForAxis = (axis: 'row' | 'col') =>
    axis === 'row' ? tree.rows : tree.cols;

  if (preserveValueAxisSourceNodes) {
    Object.values(sourceNodesForAxis(valueAxis)).forEach(node =>
      ensureNode(
        valueAxis,
        node.path,
        valueAxisDepth,
        node.isSubtotal || undefined,
      ),
    );
  }

  Object.values(sourceNodesForAxis(oppositeAxis)).forEach(node =>
    ensureNode(
      oppositeAxis,
      node.path,
      oppositeAxisDepth,
      node.isSubtotal || undefined,
    ),
  );
  ensureNode(
    valueAxis,
    [],
    valueAxisDepth,
    sourceNodesForAxis(valueAxis)[serializePath([])]?.isSubtotal || undefined,
  );

  Object.values(tree.cells).forEach(cell => {
    const baseRow = tree.rows[cell.rowKey];
    const baseCol = tree.cols[cell.colKey];
    const valueNode = valueAxis === 'row' ? baseRow : baseCol;
    const oppositeNode = valueAxis === 'row' ? baseCol : baseRow;
    const valuePath = valueNode?.path || [];
    const oppositePath = oppositeNode?.path || [];
    const valuePrefix = valuePath.slice(0, insertIndex);
    const valueSuffix = valuePath.slice(insertIndex);
    const { values: cellValues, partialValueKeys } = applyMeasureLeafValues(
      cell,
      groups,
    );
    const ensureValueAxisNode = (path: PivotPath) =>
      ensureNode(
        valueAxis,
        path,
        valueDepthWithMeasures,
        valueNode?.isSubtotal || undefined,
      );
    const updateValueAxisNode = (
      path: PivotPath,
      updates: Partial<PivotTreeNode>,
    ) => {
      const node = ensureValueAxisNode(path);
      const valueNodes = valueAxis === 'row' ? result.rows : result.cols;
      valueNodes[node.key] = { ...node, ...updates };
    };
    const ensureCollapsedMetricAlias = (path: PivotPath, isAlias: boolean) => {
      const key = serializePath(path);
      const valueNodes = valueAxis === 'row' ? result.rows : result.cols;
      if (valueNodes[key]?.isSubtotal) {
        return;
      }
      updateValueAxisNode(path, {
        hasChildren:
          valueAxis === 'row' && path.length < valueDepthWithMeasures,
        isSubtotal: false,
        isCollapsedMetric: true,
        isCollapsedMetricAlias: isAlias || undefined,
      });
    };
    const addColumnSubtotalMetricAlias = (
      path: PivotPath,
      values: Record<string, DataRecordValue>,
    ) => {
      updateValueAxisNode(path, {
        hasChildren: false,
        isSubtotal: true,
        isCollapsedMetric: undefined,
      });
      addCell(
        path,
        oppositePath,
        { values, partialValueKeys, isSubtotal: true },
        true,
      );
    };

    const isTotalValuePath =
      valuePath.length === 0 || valuePath.some(isSubtotalToken);
    const skipProjectedMetricsForPartialRow =
      valueAxis === 'row' &&
      valuesAtEnd &&
      valuePath.length < rowGroupby.length &&
      !isTotalValuePath &&
      oppositeAxisDepth > 1;
    if (
      valueAxis === 'row' &&
      valuesAtEnd &&
      valuePath.length < rowGroupby.length &&
      !isTotalValuePath
    ) {
      ensureNode(
        valueAxis,
        valuePath,
        valueAxisDepth,
        valueNode?.isSubtotal || undefined,
      );
      ensureNode(
        oppositeAxis,
        oppositePath,
        oppositeAxisDepth,
        oppositeNode?.isSubtotal || undefined,
      );
      addCell(valuePath, oppositePath, {
        values: cellValues,
        partialValueKeys,
        isSubtotal: cell.isSubtotal,
      });
      if (skipProjectedMetricsForPartialRow) {
        return;
      }
    }

    groups.forEach(group => {
      const metric = group.metricKey;
      const mergedValues = {
        [metric]: cellValues[metric],
        ...cellValues,
      };
      const metricToken = encodeMetricKey(metric);
      const hasSubtotalAtInsert =
        valueAxis === 'row' &&
        valueSuffix.length > 0 &&
        isSubtotalToken(valueSuffix[0]);
      const metricAxisPath = hasSubtotalAtInsert
        ? [...valuePrefix, valueSuffix[0], metricToken]
        : [...valuePrefix, metricToken];
      const valueTail = hasSubtotalAtInsert
        ? valueSuffix.slice(1)
        : valueSuffix;
      const leafTargets = leafTierVisible ? group.leaves : [group.leaves[0]];

      if (
        (valueAxis === 'row' || !cell.isSubtotal) &&
        !valuePath.some(isSubtotalToken) &&
        (valueAxis === 'row' || oppositeAxisDepth <= 1)
      ) {
        const aliasDepthLimit =
          valueAxis === 'row'
            ? valuesAtEnd
              ? (valuePrefix.length - 1) * Number(oppositeAxisDepth <= 1)
              : valuePrefix.length
            : valuePrefix.length - 1;
        for (let depth = 1; depth <= aliasDepthLimit; depth += 1) {
          ensureCollapsedMetricAlias(
            [...valuePrefix.slice(0, depth), metricToken],
            valuesAtEnd || depth < valuePrefix.length,
          );
        }
      }

      leafTargets.forEach(leaf => {
        const leafPath = leafTierVisible
          ? [...metricAxisPath, encodeMeasureLeafKey(leaf.id)]
          : metricAxisPath;
        const leafValue = computeMeasureLeafValue({
          values: cellValues,
          metricKey: metric,
          leaf,
        });
        if (
          leafTierVisible &&
          valueTail.length > 0 &&
          leafValue === undefined
        ) {
          for (let depth = 0; depth <= leafPath.length; depth += 1) {
            ensureValueAxisNode(leafPath.slice(0, depth));
          }
          ensureNode(
            oppositeAxis,
            oppositePath,
            oppositeAxisDepth,
            oppositeNode?.isSubtotal || undefined,
          );
          return;
        }
        const projectedValuePath = leafTierVisible
          ? [...leafPath, ...valueTail]
          : [...metricAxisPath, ...valueTail];
        for (let depth = 0; depth <= projectedValuePath.length; depth += 1) {
          ensureValueAxisNode(projectedValuePath.slice(0, depth));
        }
        ensureNode(
          oppositeAxis,
          oppositePath,
          oppositeAxisDepth,
          oppositeNode?.isSubtotal || undefined,
        );

        addCell(
          projectedValuePath,
          oppositePath,
          {
            values: mergedValues,
            partialValueKeys,
            isSubtotal: cell.isSubtotal,
          },
          true,
        );
        if (
          valueAxis === 'row' &&
          cell.isSubtotal &&
          valuePath.length > 0 &&
          valueTail.length === 0 &&
          !valuePath.some(isSubtotalToken)
        ) {
          updateValueAxisNode(projectedValuePath, {
            isSubtotal: false,
            ...(!valuesAtEnd && !leafTierVisible
              ? { isCollapsedMetric: true }
              : {}),
          });
        }
        if (valueAxis === 'col' && !leafTierVisible && cell.isSubtotal) {
          const subtotalIndex = valuePath.findIndex(isSubtotalToken);
          if (subtotalIndex > 0 && colSubtotalLevels.includes(subtotalIndex)) {
            addColumnSubtotalMetricAlias(
              [...valuePath.slice(0, subtotalIndex), metricToken],
              mergedValues,
            );
          } else if (colSubtotalLevels.includes(valuePath.length)) {
            addColumnSubtotalMetricAlias(metricAxisPath, mergedValues);
          }
        }
        addSingleMetricBaseCells(valuePath, oppositePath, valuePrefix, {
          values: mergedValues,
          partialValueKeys,
          isSubtotal: cell.isSubtotal,
        });
      });
    });
  });

  return result;
};

export const applyMeasureHierarchyAxis = (
  tree: PivotTreeData,
  measureHierarchy: MeasureHierarchy,
  program: PivotProgram,
  metricLabelMap?: Record<string, string>,
  dateFormatters?: PivotTableQueryFormData['dateFormatters'],
  colSubtotalLevels: number[] = [],
): PivotTreeData => {
  const leafTierVisible = measureHierarchy.leafTierVisibility === 'visible';
  return applyMeasureAxis({
    tree,
    groups: measureHierarchy.groups,
    leafTierVisible,
    program,
    colSubtotalLevels,
    metricLabelMap,
    dateFormatters,
  });
};

const buildBatchMaterializationProjection = ({
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

  return {
    complete: batch.complete,
    facts: batch.facts,
    rowColumns: coverage.rowDimensions,
    columnColumns: coverage.columnDimensions,
    rowFullDepth,
    columnFullDepth,
    dateFormatters: formData.dateFormatters,
    rowSubtotalDepths: rowSubtotalLevels.filter(
      level => level > 0 && level <= coverage.rowDepth,
    ),
    columnSubtotalDepth: colSubtotalLevels.includes(coverage.columnDepth)
      ? coverage.columnDepth
      : undefined,
  };
};

const applyBatchSubtotalLeaves = (
  tree: PivotTreeData,
  projection: ReturnType<typeof buildBatchMaterializationProjection>,
) =>
  injectAxisSubtotalLeaves({
    tree: injectAxisSubtotalLeaves({
      tree,
      axis: 'col',
      depths:
        projection.columnSubtotalDepth === undefined
          ? []
          : [projection.columnSubtotalDepth],
      fullDepth: projection.columnFullDepth,
    }),
    axis: 'row',
    depths: projection.rowSubtotalDepths,
    fullDepth: projection.rowFullDepth,
  });

const finalizeMaterializedTree = (
  tree: PivotTreeData,
  {
    metrics,
    formData,
    measureHierarchy,
    pivotProgram,
    colSubtotalLevels,
  }: MaterializePivotTreeInput,
) =>
  labelRowSubtotalLeaves(
    applyMeasureHierarchyAxis(
      tree,
      measureHierarchy,
      pivotProgram,
      formData.metricLabelMap as Record<string, string> | undefined,
      formData.dateFormatters,
      colSubtotalLevels,
    ),
    metrics,
    formData.metricLabelMap as Record<string, string> | undefined,
  );

const groupFactStoreBatchesByMaterializationPlan = ({
  batches,
  layout,
}: {
  batches: PivotFactStoreBatch[];
  layout: LayoutContext;
}) => {
  const batchesByPlan = new Map<
    string,
    {
      plan: ReturnType<typeof deriveBatchMaterializationPlan>;
      batches: MaterializationFactBatch[];
    }
  >();
  batches.forEach(batch => {
    const plan = deriveBatchMaterializationPlan({ batch, layout });
    const key = JSON.stringify(plan);
    const entry = batchesByPlan.get(key) ?? { plan, batches: [] };
    entry.batches.push({
      complete: batch.complete,
      facts: batch.facts,
      coverage: batch.coverage,
    });
    batchesByPlan.set(key, entry);
  });
  return Array.from(batchesByPlan.values());
};

const materializeInputFromPlanGroup = (
  formData: PivotTableQueryFormData,
  {
    plan,
    batches,
  }: ReturnType<typeof groupFactStoreBatchesByMaterializationPlan>[number],
): MaterializePivotTreeInput => ({
  ...plan,
  batches,
  formData,
});

const columnRefKey = (column: QueryFormColumn) =>
  typeof column === 'string' ? column : getColumnLabel(column);

const sameColumnRef = (left: QueryFormColumn, right?: QueryFormColumn) =>
  right !== undefined && columnRefKey(left) === columnRefKey(right);

const coverageMatchesProgramAxis = ({
  coverageDimensions,
  programDimensions,
  materialization,
  axis,
}: {
  coverageDimensions: QueryFormColumn[];
  programDimensions: QueryFormColumn[];
  materialization: PivotFactStoreBatch['materialization'];
  axis: PivotAxis;
}) => {
  if (materialization?.valueAxis !== axis) {
    return coverageDimensions.every((dimension, index) =>
      sameColumnRef(dimension, programDimensions[index]),
    );
  }

  const insertIndex = Math.min(
    Math.max(materialization.valueInsertIndex, 0),
    programDimensions.length,
  );
  if (
    !coverageDimensions
      .slice(0, insertIndex)
      .every((dimension, index) =>
        sameColumnRef(dimension, programDimensions[index]),
      )
  ) {
    return false;
  }

  let programIndex = insertIndex;
  return coverageDimensions.slice(insertIndex).every(dimension => {
    const matchedIndex = programDimensions.findIndex(
      (programDimension, index) =>
        index >= programIndex && sameColumnRef(dimension, programDimension),
    );
    programIndex = matchedIndex + 1;
    return matchedIndex >= 0;
  });
};

const coverageMatchesProgram = (
  batch: PivotFactStoreBatch,
  program: PivotProgram,
) => {
  const { coverage, materialization } = batch;
  return (
    coverage.rowDepth <= program.rowDimensions.length &&
    coverage.columnDepth <= program.columnDimensions.length &&
    coverageMatchesProgramAxis({
      coverageDimensions: coverage.rowDimensions,
      programDimensions: program.rowDimensions,
      materialization,
      axis: 'row',
    }) &&
    coverageMatchesProgramAxis({
      coverageDimensions: coverage.columnDimensions,
      programDimensions: program.columnDimensions,
      materialization,
      axis: 'col',
    })
  );
};

type MaterializationInput = {
  store: PivotFactStore;
  layout: LayoutContext;
  formData: PivotTableQueryFormData;
};

/** One traversal for immediate and scheduled execution; only completed trees escape. */
function* materializeWork(
  { store, layout, formData }: MaterializationInput,
  chunkSize = DEFAULT_RUNTIME_CHUNK_SIZE,
): Generator<void, PivotTreeData> {
  const result = emptyPivotTree();
  const groups = groupFactStoreBatchesByMaterializationPlan({
    batches: store
      .getFactBatches(buildPivotFactQueryContextKey(formData))
      .filter(batch => coverageMatchesProgram(batch, layout.pivotProgram)),
    layout,
  });
  for (const group of groups) {
    const input = materializeInputFromPlanGroup(formData, group);
    const branch = emptyPivotTree();
    for (const batch of input.batches) {
      const projection = buildBatchMaterializationProjection({
        ...input,
        batch,
      });
      const builder = createFactTreeBuilder(projection);
      for (let i = 0; i < projection.facts.length; i += 1) {
        builder.addFact(projection.facts[i]);
        if ((i + 1) % chunkSize === 0) yield;
      }
      if (
        projection.columnSubtotalDepth !== undefined ||
        projection.rowSubtotalDepths.length
      )
        yield;
      const batchTree = applyBatchSubtotalLeaves(builder.finish(), projection);
      yield;
      mergeTreeInto(branch, batchTree);
    }
    yield;
    const tree = finalizeMaterializedTree(branch, input);
    yield;
    mergeTreeInto(result, tree);
  }
  return result;
}

export const materializeLoadedPivotTreeFromFactStore = (
  input: MaterializationInput,
): PivotTreeData => {
  const work = materializeWork(input);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
};

export const materializeLoadedPivotTreeFromFactStoreAsync = async (
  input: MaterializationInput & ChunkedWorkOptions,
): Promise<PivotTreeData> => {
  const work = materializeWork(input, input.chunkSize);
  assertChunkedWorkCurrent(input.shouldContinue);
  let step = work.next();
  while (!step.done) {
    // eslint-disable-next-line no-await-in-loop
    await yieldChunkedWork(input);
    step = work.next();
  }
  assertChunkedWorkCurrent(input.shouldContinue);
  return step.value;
};
