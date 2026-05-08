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
  type PivotPath,
  type PivotTableQueryFormData,
  type PivotTreeData,
} from '../../types';
import {
  applyMeasureHierarchyAxis,
  formatPivotLabelValue,
  injectRowSubtotalLeaves,
  labelRowSubtotalLeaves,
  mergeTrees,
} from '../core/tree';
import { serializeCellKey, serializePath } from '../core/path';
import { getMetricKeys, SUBTOTAL_LABEL, SUBTOTAL_TOKEN } from '../core/tokens';
import { applyMeasureLeafValuesToTree } from '../measureLeaves';
import { type LayoutContext } from '../layout/LayoutContext';
import { type PlannedQuerySpec } from '../query/specs';
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

function injectColumnSubtotalLeaves(
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) {
  if (depth <= 0 || depth >= fullDepth) {
    return tree;
  }
  const next: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };
  const subtotalNodes = Object.values(tree.cols).filter(
    node => node.path.length === depth && node.path.length > 0,
  );
  subtotalNodes.forEach(node => {
    const subtotalPath = [...node.path, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    if (!next.cols[subtotalKey]) {
      next.cols[subtotalKey] = {
        ...node,
        key: subtotalKey,
        path: subtotalPath,
        label: SUBTOTAL_LABEL,
        formattedLabel: SUBTOTAL_LABEL,
        level: subtotalPath.length,
        hasChildren: subtotalPath.length < fullDepth,
        isSubtotal: true,
      };
    }
  });
  Object.values(tree.cells).forEach(cell => {
    const baseColPath = tree.cols[cell.colKey]?.path;
    if (
      !baseColPath ||
      baseColPath.length !== depth ||
      baseColPath.length === 0
    ) {
      return;
    }
    const subtotalColKey = serializePath([...baseColPath, SUBTOTAL_TOKEN]);
    const cellKey = serializeCellKey(cell.rowKey, subtotalColKey);
    next.cells[cellKey] = {
      ...cell,
      colKey: subtotalColKey,
      isSubtotal: true,
    };
  });
  return next;
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
