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
  isSubtotalToken,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from '../core/tokens';
import { getMetricKeys } from '../metrics';
import {
  buildMeasureLeafOutputKey,
  buildValueLeaf,
  computeMeasureLeafValue,
  isValueLeaf,
} from '../measureLeaves';
import { type LayoutContext } from '../layout/LayoutContext';
import { type PlannedQuerySpec } from '../query/specs';
import { type PivotFactCoverage, type PivotProgram } from './types';
import { projectionQueryFilterPath, resolveAxisProjection } from './projection';
import {
  buildFactValueKeys,
  type PivotFact,
  type PivotFactSelector,
  type PivotFactStore,
  type PivotFactStoreBatch,
  type PivotFactStoreBatchMaterialization,
} from './factStore';
import {
  assertChunkedWorkCurrent,
  type ChunkedWorkOptions,
  maybeYieldChunkedWork,
  yieldChunkedWork,
} from './chunkedWork';

type MaterializationFactBatch = {
  facts: PivotFact[];
  coverage: PivotFactCoverage;
};

type MaterializePivotTreeInput = {
  batches: MaterializationFactBatch[];
  metricsForQuery: QueryFormMetric[];
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
  materializedMetrics?: QueryFormMetric[];
  materializedMeasureHierarchy?: MeasureHierarchy;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  pivotProgram: PivotProgram;
};

const emptyPivotTree = (): PivotTreeData => ({ rows: {}, cols: {}, cells: {} });

const projectFactStorePath = (
  spec: PlannedQuerySpec,
  axis: 'row' | 'col',
  path: PivotPath,
) =>
  projectionQueryFilterPath(
    resolveAxisProjection({
      program: spec.meta.pivotProgram,
      axis,
      path,
    }),
  );

const factStoreBatchScopeFromSpec = (
  spec: PlannedQuerySpec,
): PivotFactStoreBatch['scope'] => {
  if (spec.meta.kind === 'branch') {
    if (!spec.meta.axis) {
      throw new Error('Branch fact-store batch requires an axis');
    }
    return {
      kind: 'branch',
      axis: spec.meta.axis,
      path: projectFactStorePath(spec, spec.meta.axis, spec.meta.path ?? []),
    };
  }
  if (spec.meta.kind === 'batch') {
    if (!spec.meta.axis) {
      throw new Error('Batch fact-store batch requires an axis');
    }
    return {
      kind: 'batch',
      axis: spec.meta.axis,
      parentPath: projectFactStorePath(
        spec,
        spec.meta.axis,
        spec.meta.parentPath ?? [],
      ),
      siblingValues: spec.meta.siblingValues ?? [],
    };
  }
  if (spec.meta.kind === 'intersection') {
    return {
      kind: 'intersection',
      rowPaths: (spec.meta.rowPaths ?? []).map(path =>
        projectFactStorePath(spec, 'row', path),
      ),
      columnPaths: (spec.meta.columnPaths ?? []).map(path =>
        projectFactStorePath(spec, 'col', path),
      ),
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
  valueKeys: buildFactValueKeys({
    metricKeys: getMetricKeys(spec.metrics),
    requiredTimeOffsets: spec.meta.requiredTimeOffsets,
  }),
});

export const factStoreMaterializationFromSpec = (
  spec: PlannedQuerySpec,
): PivotFactStoreBatchMaterialization => ({
  metricsForQuery: spec.metrics,
  materializedMetrics: spec.meta.materializedMetrics,
  materializedMeasureHierarchy: spec.meta.materializedMeasureHierarchy,
  rowSubtotalLevels: spec.meta.rowSubtotalLevels,
  colSubtotalLevels: spec.meta.colSubtotalLevels,
  pivotProgram: spec.meta.pivotProgram,
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
    materialization: factStoreMaterializationFromSpec(spec),
    facts: store.getCompatibleFacts(factStoreSelectorFromSpec(spec)),
  }));

const materializationInputFromSpecs = ({
  store,
  specs,
  formData,
  measureHierarchy,
}: {
  store: PivotFactStore;
  specs: PlannedQuerySpec[];
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
}): MaterializePivotTreeInput | undefined => {
  const firstSpec = specs[0];
  if (!firstSpec) {
    return undefined;
  }
  return {
    batches: buildFactStoreBatchesFromSpecs({ store, specs }),
    metricsForQuery: firstSpec.metrics,
    formData,
    measureHierarchy,
    materializedMetrics: firstSpec.meta.materializedMetrics,
    materializedMeasureHierarchy: firstSpec.meta.materializedMeasureHierarchy,
    rowSubtotalLevels: firstSpec.meta.rowSubtotalLevels,
    colSubtotalLevels: firstSpec.meta.colSubtotalLevels,
    pivotProgram: firstSpec.meta.pivotProgram,
  };
};

export function applyMeasureLeafValuesToTree({
  tree,
  measureHierarchy,
}: {
  tree: PivotTreeData;
  measureHierarchy: {
    kind: 'flatMetrics' | 'measureStackV1';
    groups?: Array<{ metricKey: string; leaves: MeasureLeafSpec[] }>;
  };
}) {
  if (measureHierarchy.kind !== 'measureStackV1') {
    return tree;
  }
  const groups = measureHierarchy.groups ?? [];
  if (groups.length === 0) {
    return tree;
  }

  const applyToValues = (values?: Record<string, DataRecordValue>) => {
    if (!values) {
      return values;
    }
    const next = { ...values };
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
        }
      });
    });
    return next;
  };

  const nextCells = Object.fromEntries(
    Object.entries(tree.cells).map(([key, cell]) => [
      key,
      { ...cell, values: applyToValues(cell.values) ?? cell.values },
    ]),
  );
  const nextRows = Object.fromEntries(
    Object.entries(tree.rows).map(([key, node]) => [
      key,
      node.values ? { ...node, values: applyToValues(node.values) } : node,
    ]),
  );
  const nextCols = Object.fromEntries(
    Object.entries(tree.cols).map(([key, node]) => [
      key,
      node.values ? { ...node, values: applyToValues(node.values) } : node,
    ]),
  );

  return { rows: nextRows, cols: nextCols, cells: nextCells };
}

const finalizeInitialPivotTree = ({ tree }: { tree: PivotTreeData }) => {
  const rootKey = serializePath([]);
  const finalizedTree = tree;
  (['rows', 'cols'] as const).forEach(axis => {
    const root = finalizedTree[axis][rootKey];
    if (root) {
      finalizedTree[axis][rootKey] = {
        ...root,
        label: 'Grand total',
        formattedLabel: 'Grand total',
      };
    }
  });
  return finalizedTree;
};

type FactTreeBuilderInput = {
  rowColumns: QueryFormColumn[];
  columnColumns: QueryFormColumn[];
  rowFullDepth: number;
  columnFullDepth: number;
  dateFormatters?: PivotTableQueryFormData['dateFormatters'];
};

const createFactTreeBuilder = ({
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
    if (nodes[key]) {
      return;
    }
    const rawValue = path[path.length - 1];
    const label =
      path.length === 0
        ? 'Grand total'
        : formatPivotLabelValue(rawValue ?? null, totalLabel);
    const groupby = axis === 'row' ? rowColumns : columnColumns;
    const column = groupby[path.length - 1];
    const columnLabel = column ? getColumnLabel(column) : undefined;
    const formatter = columnLabel ? dateFormatters?.[columnLabel] : undefined;
    const formattedLabel =
      path.length === 0 || rawValue === null || rawValue === undefined
        ? label
        : formatter
          ? (formatter as (value: NonNullable<typeof rawValue>) => string)(
              rawValue,
            )
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
  };

  const finish = () => {
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

  return {
    addFact,
    finish,
  };
};

const buildTreeFromFacts = ({
  facts,
  ...params
}: FactTreeBuilderInput & {
  facts: PivotFact[];
}): PivotTreeData => {
  const builder = createFactTreeBuilder(params);
  facts.forEach(builder.addFact);
  return builder.finish();
};

const buildTreeFromFactsAsync = async ({
  facts,
  chunkSize,
  shouldContinue,
  yieldToMain,
  ...params
}: FactTreeBuilderInput &
  ChunkedWorkOptions & {
    facts: PivotFact[];
  }): Promise<PivotTreeData> => {
  const builder = createFactTreeBuilder(params);
  for (let idx = 0; idx < facts.length; idx += 1) {
    builder.addFact(facts[idx]);
    // eslint-disable-next-line no-await-in-loop
    await maybeYieldChunkedWork({
      processed: idx + 1,
      chunkSize,
      shouldContinue,
      yieldToMain,
    });
  }
  assertChunkedWorkCurrent(shouldContinue);
  return builder.finish();
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

  const addCell = ({
    rowPath,
    colPath,
    values,
    isSubtotal,
    overwrite = false,
  }: {
    rowPath: PivotPath;
    colPath: PivotPath;
    values: Record<string, DataRecordValue>;
    isSubtotal?: boolean;
    overwrite?: boolean;
  }) => {
    const rowKey = serializePath(rowPath);
    const colKey = serializePath(colPath);
    const cellKey = serializeCellKey(rowKey, colKey);
    if (!overwrite && result.cells[cellKey]) {
      return;
    }
    result.cells[cellKey] = {
      rowKey,
      colKey,
      values,
      isSubtotal,
    };
  };

  const addSingleMetricBaseCells = ({
    valuePath,
    oppositePath,
    colPrefix,
    values,
    isSubtotal,
  }: {
    valuePath: PivotPath;
    oppositePath: PivotPath;
    colPrefix?: PivotPath;
    values: Record<string, DataRecordValue>;
    isSubtotal?: boolean;
  }) => {
    if (metricKeys.length !== 1) {
      return;
    }
    if (valueAxis === 'row') {
      addCell({
        rowPath: valuePath,
        colPath: oppositePath,
        values,
        isSubtotal,
      });
      return;
    }
    if (insertIndex === 0) {
      addCell({
        rowPath: oppositePath,
        colPath: colPrefix ?? [],
        values,
        isSubtotal,
      });
    }
    if (
      insertIndex >= colGroupby.length ||
      insertIndex === 0 ||
      (insertIndex > 0 &&
        insertIndex < colGroupby.length &&
        valuePath.length <= insertIndex)
    ) {
      addCell({
        rowPath: oppositePath,
        colPath: valuePath,
        values,
        isSubtotal,
      });
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

  Object.values(tree.cells).forEach(cell => {
    const baseRow = tree.rows[cell.rowKey];
    const baseCol = tree.cols[cell.colKey];
    const valueNode = valueAxis === 'row' ? baseRow : baseCol;
    const oppositeNode = valueAxis === 'row' ? baseCol : baseRow;
    const valuePath = valueNode?.path || [];
    const oppositePath = oppositeNode?.path || [];
    const valuePrefix = valuePath.slice(0, insertIndex);
    const valueSuffix = valuePath.slice(insertIndex);

    const isTotalValuePath =
      valuePath.length === 0 || valuePath.some(isSubtotalToken);
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
      addCell({
        rowPath: valuePath,
        colPath: oppositePath,
        values: cell.values,
        isSubtotal: cell.isSubtotal,
      });
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

      leafTargets.forEach(leaf => {
        const projectedValuePath = leafTierVisible
          ? [...metricAxisPath, encodeMeasureLeafKey(leaf.id), ...valueTail]
          : [...metricAxisPath, ...valueTail];
        for (let depth = 0; depth <= projectedValuePath.length; depth += 1) {
          ensureNode(
            valueAxis,
            projectedValuePath.slice(0, depth),
            valueDepthWithMeasures,
            valueNode?.isSubtotal || undefined,
          );
        }
        ensureNode(
          oppositeAxis,
          oppositePath,
          oppositeAxisDepth,
          oppositeNode?.isSubtotal || undefined,
        );

        addCell({
          rowPath: valueAxis === 'row' ? projectedValuePath : oppositePath,
          colPath: valueAxis === 'col' ? projectedValuePath : oppositePath,
          values: mergedValues,
          isSubtotal: cell.isSubtotal,
          overwrite: true,
        });
        addSingleMetricBaseCells({
          valuePath,
          oppositePath,
          colPrefix: valuePrefix,
          values: mergedValues,
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
): PivotTreeData => {
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
};

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
  rowSubtotalLevels
    .filter(level => level > 0 && level <= coverage.rowDepth)
    .forEach(depth => {
      tree = injectRowSubtotalLeaves(tree, depth, rowFullDepth);
    });
  return tree;
};

const buildTreeFromFactBatchAsync = async ({
  batch,
  formData,
  pivotProgram,
  rowSubtotalLevels,
  colSubtotalLevels,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: {
  batch: MaterializationFactBatch;
  formData: PivotTableQueryFormData;
  pivotProgram: PivotProgram;
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
} & ChunkedWorkOptions) => {
  const { coverage } = batch;
  const rowFullDepth = pivotProgram.rowDimensions.length;
  const columnFullDepth = pivotProgram.columnDimensions.length;
  let tree = await buildTreeFromFactsAsync({
    facts: batch.facts,
    rowColumns: coverage.rowDimensions,
    columnColumns: coverage.columnDimensions,
    rowFullDepth,
    columnFullDepth,
    dateFormatters: formData.dateFormatters,
    chunkSize,
    shouldContinue,
    yieldToMain,
  });
  if (colSubtotalLevels.includes(coverage.columnDepth)) {
    // eslint-disable-next-line no-await-in-loop
    await yieldChunkedWork({ shouldContinue, yieldToMain });
    tree = injectColumnSubtotalLeaves(
      tree,
      coverage.columnDepth,
      columnFullDepth,
    );
  }
  for (const depth of rowSubtotalLevels.filter(
    level => level > 0 && level <= coverage.rowDepth,
  )) {
    // eslint-disable-next-line no-await-in-loop
    await yieldChunkedWork({ shouldContinue, yieldToMain });
    tree = injectRowSubtotalLeaves(tree, depth, rowFullDepth);
  }
  assertChunkedWorkCurrent(shouldContinue);
  return tree;
};

const materializePivotTree = ({
  batches,
  metricsForQuery,
  formData,
  measureHierarchy,
  materializedMetrics,
  materializedMeasureHierarchy,
  rowSubtotalLevels,
  colSubtotalLevels,
  pivotProgram,
}: MaterializePivotTreeInput): PivotTreeData => {
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

const materializePivotTreeAsync = async ({
  batches,
  metricsForQuery,
  formData,
  measureHierarchy,
  materializedMetrics,
  materializedMeasureHierarchy,
  rowSubtotalLevels,
  colSubtotalLevels,
  pivotProgram,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: MaterializePivotTreeInput & ChunkedWorkOptions): Promise<PivotTreeData> => {
  const queryMetrics =
    metricsForQuery.length > 0 ? metricsForQuery : formData.metrics;
  const visibleMetrics = materializedMetrics ?? queryMetrics;
  const visibleMeasureHierarchy =
    materializedMeasureHierarchy ?? measureHierarchy;
  let branchTree = {} as PivotTreeData;
  for (let idx = 0; idx < batches.length; idx += 1) {
    // eslint-disable-next-line no-await-in-loop
    const nextTree = await buildTreeFromFactBatchAsync({
      batch: batches[idx],
      formData,
      pivotProgram,
      rowSubtotalLevels,
      colSubtotalLevels,
      chunkSize,
      shouldContinue,
      yieldToMain,
    });
    // eslint-disable-next-line no-await-in-loop
    await yieldChunkedWork({ shouldContinue, yieldToMain });
    branchTree = mergeTrees(branchTree, nextTree);
  }
  await yieldChunkedWork({ shouldContinue, yieldToMain });
  const treeWithLeafValues = applyMeasureLeafValuesToTree({
    tree: branchTree,
    measureHierarchy: visibleMeasureHierarchy,
  });
  await yieldChunkedWork({ shouldContinue, yieldToMain });
  const branchWithMeasures = applyMeasureHierarchyAxis(
    treeWithLeafValues,
    visibleMeasureHierarchy,
    pivotProgram,
    formData.metricLabelMap as Record<string, string> | undefined,
  );
  await yieldChunkedWork({ shouldContinue, yieldToMain });
  return labelRowSubtotalLeaves(
    branchWithMeasures,
    ensureIsArray(visibleMetrics),
    formData.metricLabelMap as Record<string, string> | undefined,
  );
};

const materializeFactStoreBatches = ({
  batches,
  formData,
  measureHierarchy,
}: {
  batches: PivotFactStoreBatch[];
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
}): PivotTreeData => {
  const batchesByMaterialization = new Map<
    string,
    {
      materialization: PivotFactStoreBatchMaterialization;
      batches: MaterializationFactBatch[];
    }
  >();
  batches.forEach(batch => {
    if (!batch.materialization) {
      return;
    }
    const key = JSON.stringify(batch.materialization);
    const entry = batchesByMaterialization.get(key) ?? {
      materialization: batch.materialization,
      batches: [],
    };
    entry.batches.push({
      facts: batch.facts,
      coverage: batch.coverage,
    });
    batchesByMaterialization.set(key, entry);
  });
  return Array.from(batchesByMaterialization.values()).reduce<PivotTreeData>(
    (tree, { materialization, batches: materializationBatches }) =>
      mergeTrees(
        tree,
        materializePivotTree({
          batches: materializationBatches,
          metricsForQuery: materialization.metricsForQuery,
          formData,
          measureHierarchy,
          materializedMetrics: materialization.materializedMetrics,
          materializedMeasureHierarchy:
            materialization.materializedMeasureHierarchy,
          rowSubtotalLevels: materialization.rowSubtotalLevels,
          colSubtotalLevels: materialization.colSubtotalLevels,
          pivotProgram: materialization.pivotProgram,
        }),
      ),
    emptyPivotTree(),
  );
};

export const materializeLoadedPivotTreeFromFactStore = ({
  store,
  layout,
  formData,
}: {
  store: PivotFactStore;
  layout: LayoutContext;
  formData: PivotTableQueryFormData;
}): PivotTreeData =>
  finalizeInitialPivotTree({
    tree: materializeFactStoreBatches({
      batches: store.getFactBatches(),
      formData,
      measureHierarchy: layout.measureHierarchy,
    }),
  });

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
  const input = materializationInputFromSpecs({
    store,
    specs,
    formData,
    measureHierarchy,
  });
  if (!input) {
    return emptyPivotTree();
  }
  return materializePivotTree(input);
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
  const { measureHierarchy } = layout;
  const input = materializationInputFromSpecs({
    store,
    specs,
    formData,
    measureHierarchy,
  });
  const mergedTree = input ? materializePivotTree(input) : emptyPivotTree();
  return finalizeInitialPivotTree({
    tree: mergedTree,
  });
};

export const materializeInitialPivotTreeFromFactStoreAsync = async ({
  specs,
  store,
  layout,
  formData,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: {
  specs: PlannedQuerySpec[];
  store: PivotFactStore;
  layout: LayoutContext;
  formData: PivotTableQueryFormData;
} & ChunkedWorkOptions): Promise<PivotTreeData> => {
  const { measureHierarchy } = layout;
  const input = materializationInputFromSpecs({
    store,
    specs,
    formData,
    measureHierarchy,
  });
  const mergedTree = input
    ? await materializePivotTreeAsync({
        ...input,
        chunkSize,
        shouldContinue,
        yieldToMain,
      })
    : emptyPivotTree();
  return finalizeInitialPivotTree({
    tree: mergedTree,
  });
};
