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
  type DataRecord,
  type DataRecordValue,
  ensureIsArray,
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import {
  type MeasureHierarchy,
  type MetricsLayoutEnum,
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
import { type PivotFactCoverage } from './types';
import {
  createPivotFactStore,
  type PivotFact,
  type PivotFactRole,
  type PivotFactStoreBatch,
  type PivotFactStore,
} from './factStore';

export { buildPivotFactKey, createPivotFactStore } from './factStore';
export type {
  PivotFact,
  PivotFactRole,
  PivotFactStore,
  PivotFactStoreBatch,
} from './factStore';

export type QueryResultWithData = {
  data?: DataRecord[];
  query?: {
    query_name?: unknown;
  };
  query_name?: unknown;
};

export type IngestedQueryResult<T extends QueryResultWithData> = {
  spec: PlannedQuerySpec;
  result: T;
  facts: PivotFact[];
};

type QueryResultFallback = 'index' | 'empty';

export const getQueryResultName = (
  result: QueryResultWithData,
): string | undefined => {
  if (typeof result.query?.query_name === 'string') {
    return result.query.query_name;
  }
  if (typeof result.query_name === 'string') {
    return result.query_name;
  }
  return undefined;
};

export const orderQueryResultsForSpecs = <T extends QueryResultWithData>({
  specs,
  results,
  fallback = 'index',
}: {
  specs: PlannedQuerySpec[];
  results: T[];
  fallback?: QueryResultFallback;
}): QueryResultWithData[] => {
  const resultsByName = new Map<string, T>();
  results.forEach(result => {
    const name = getQueryResultName(result);
    if (name) {
      resultsByName.set(name, result);
    }
  });
  if (resultsByName.size === 0) {
    return results;
  }
  return specs.map(
    (spec, idx) =>
      resultsByName.get(spec.queryName) ??
      (fallback === 'index' ? results[idx] : undefined) ??
      {},
  );
};

const getMetricValueKeysFromRecord = (
  record: DataRecord | undefined,
  metrics: QueryFormMetric[],
) => {
  const metricKeys = getMetricKeys(metrics);
  const metricKeySet = new Set(metricKeys);
  const metricPrefixes = metricKeys.map(key => `${key}__`);
  if (!record || metricPrefixes.length === 0) {
    return metricKeys;
  }
  return [
    ...metricKeys,
    ...Object.keys(record).filter(
      key =>
        !metricKeySet.has(key) &&
        metricPrefixes.some(prefix => key.startsWith(prefix)),
    ),
  ];
};

const pathFromRecord = (record: DataRecord, columns: QueryFormColumn[]) =>
  columns.map(column => record[getColumnLabel(column)]);

const factsFromRecords = ({
  result,
  metrics,
  rowGroupby,
  colGroupby,
  rowDepth,
  colDepth,
  queryName,
  coverage,
  materializedMetrics,
}: {
  result: QueryResultWithData;
  metrics: QueryFormMetric[];
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowDepth: number;
  colDepth: number;
  queryName: string;
  coverage?: PivotFactCoverage;
  materializedMetrics: QueryFormMetric[];
}): PivotFact[] => {
  const records = result.data ?? [];
  const valueKeys = getMetricValueKeysFromRecord(records[0], metrics);
  const visibleValueKeys = new Set(getMetricKeys(materializedMetrics));
  const rowColumns = rowGroupby.slice(0, rowDepth);
  const columnColumns = colGroupby.slice(0, colDepth);
  const roleForValueKey = (valueKey: string): PivotFactRole =>
    visibleValueKeys.has(valueKey) ? 'visible' : 'support';

  return records.flatMap(record => {
    const rowPath = pathFromRecord(record, rowColumns);
    const columnPath = pathFromRecord(record, columnColumns);
    return valueKeys.map(valueKey => ({
      rowPath,
      columnPath,
      valueKey,
      value: record[valueKey],
      role: roleForValueKey(valueKey),
      coverage,
      queryName,
    }));
  });
};

export const ingestQueryResultFacts = ({
  spec,
  result,
}: {
  spec: PlannedQuerySpec;
  result: QueryResultWithData;
}): PivotFact[] =>
  factsFromRecords({
    result,
    metrics: spec.metrics,
    rowGroupby: spec.meta.rowGroupbyForQueryFull,
    colGroupby: spec.meta.colGroupbyForQueryFull,
    rowDepth: spec.meta.rowDepth,
    colDepth: spec.meta.colDepth,
    queryName: spec.queryName,
    coverage: spec.meta.coverage,
    materializedMetrics: spec.meta.materializedMetrics,
  });

export const ingestQueryResults = <T extends QueryResultWithData>({
  specs,
  results,
  fallback,
}: {
  specs: PlannedQuerySpec[];
  results: T[];
  fallback?: QueryResultFallback;
}): IngestedQueryResult<QueryResultWithData>[] => {
  const orderedResults = orderQueryResultsForSpecs({
    specs,
    results,
    fallback,
  });
  return specs.map((spec, idx) => {
    const result = orderedResults[idx] ?? {};
    return {
      spec,
      result,
      facts: ingestQueryResultFacts({ spec, result }),
    };
  });
};

type MaterializationFactBatch = {
  facts: PivotFact[];
  rowDepth: number;
  colDepth: number;
};

const factStoreBatchScopeFromSpec = (
  spec: PlannedQuerySpec,
): PivotFactStoreBatch['scope'] => {
  if (spec.meta.kind === 'branch') {
    if (!spec.meta.axis) {
      return undefined;
    }
    return {
      kind: 'branch',
      axis: spec.meta.axis,
      path: spec.meta.path ?? [],
      rowDepth: spec.meta.rowDepth,
      colDepth: spec.meta.colDepth,
    };
  }
  if (spec.meta.kind === 'batch') {
    if (!spec.meta.axis) {
      return undefined;
    }
    return {
      kind: 'batch',
      axis: spec.meta.axis,
      parentPath: spec.meta.parentPath ?? [],
      siblingValues: spec.meta.siblingValues ?? [],
      rowDepth: spec.meta.rowDepth,
      colDepth: spec.meta.colDepth,
    };
  }
  return {
    kind: spec.meta.kind,
    rowDepth: spec.meta.rowDepth,
    colDepth: spec.meta.colDepth,
  };
};

const factStoreBatchFromIngested = ({
  spec,
  facts,
}: Pick<
  IngestedQueryResult<QueryResultWithData>,
  'spec' | 'facts'
>): PivotFactStoreBatch => ({
  coverage: spec.meta.coverage,
  queryName: spec.queryName,
  scope: factStoreBatchScopeFromSpec(spec),
  facts,
});

export const upsertIngestedFactsIntoStore = ({
  store,
  ingested,
}: {
  store: PivotFactStore;
  ingested: Array<IngestedQueryResult<QueryResultWithData>>;
}): PivotFactStoreBatch[] => {
  const batches = ingested.map(factStoreBatchFromIngested);
  store.upsertBatches(batches);
  return batches;
};

export const upsertQueryResultsIntoFactStore = <T extends QueryResultWithData>({
  store,
  specs,
  results,
  fallback,
}: {
  store: PivotFactStore;
  specs: PlannedQuerySpec[];
  results: T[];
  fallback?: QueryResultFallback;
}): PivotFactStoreBatch[] => {
  const ingested = ingestQueryResults({
    specs,
    results,
    fallback,
  });
  return upsertIngestedFactsIntoStore({ store, ingested });
};

const buildFactStore = (
  batches: IngestedQueryResult<QueryResultWithData>[],
) => {
  const store = createPivotFactStore();
  upsertIngestedFactsIntoStore({ store, ingested: batches });
  return store;
};

const factBatchFromStore = ({
  store,
  spec,
}: {
  store: PivotFactStore;
  spec: PlannedQuerySpec;
}): MaterializationFactBatch => ({
  facts: store.getFacts({
    coverage: spec.meta.coverage,
    queryName: spec.queryName,
  }),
  rowDepth: spec.meta.rowDepth,
  colDepth: spec.meta.colDepth,
});

const buildTreeFromFacts = ({
  facts,
  rowGroupby,
  colGroupby,
  dateFormatters,
}: {
  facts: PivotFact[];
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
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
    const groupby = axis === 'row' ? rowGroupby : colGroupby;
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
        path.length < (axis === 'row' ? rowGroupby.length : colGroupby.length),
      isSubtotal:
        path.length < (axis === 'row' ? rowGroupby.length : colGroupby.length),
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
  rowGroupby,
  colGroupby,
  rowSubtotalLevels,
  colSubtotalLevels,
}: {
  batch: MaterializationFactBatch;
  formData: PivotTableQueryFormData;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
}) => {
  let tree = buildTreeFromFacts({
    facts: batch.facts,
    rowGroupby,
    colGroupby,
    dateFormatters: formData.dateFormatters,
  });
  if (colSubtotalLevels.includes(batch.colDepth)) {
    tree = injectColumnSubtotalLeaves(tree, batch.colDepth, colGroupby.length);
  }
  const rowSubtotalDepths = rowSubtotalLevels.filter(
    level => level > 0 && level <= batch.rowDepth,
  );
  rowSubtotalDepths.forEach(depth => {
    tree = injectRowSubtotalLeaves(tree, depth, rowGroupby.length);
  });
  return tree;
};

const buildBranchTreeFromFactBatches = ({
  batches,
  metricsForQuery,
  formData,
  measureHierarchy,
  materializedMetrics,
  materializedMeasureHierarchy,
  rowGroupby,
  colGroupby,
  rowSubtotalLevels,
  colSubtotalLevels,
  metricsLayoutResolved,
  metricInsertIndex,
}: {
  batches: MaterializationFactBatch[];
  metricsForQuery: QueryFormMetric[];
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
  materializedMetrics?: QueryFormMetric[];
  materializedMeasureHierarchy?: MeasureHierarchy;
  rowGroupby: QueryFormColumn[];
  colGroupby: QueryFormColumn[];
  rowSubtotalLevels: number[];
  colSubtotalLevels: number[];
  metricsLayoutResolved: MetricsLayoutEnum;
  metricInsertIndex: number;
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
          rowGroupby,
          colGroupby,
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
    metricsLayoutResolved,
    rowGroupby,
    colGroupby,
    metricInsertIndex,
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
}) =>
  specs.every(spec =>
    store.hasCoverage({
      coverage: spec.meta.coverage,
      queryName: spec.queryName,
    }),
  );

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
  return buildBranchTreeFromFactBatches({
    batches: specs.map(spec => factBatchFromStore({ store, spec })),
    metricsForQuery: firstSpec.metrics,
    formData,
    measureHierarchy,
    materializedMetrics: firstSpec.meta.materializedMetrics,
    materializedMeasureHierarchy: firstSpec.meta.materializedMeasureHierarchy,
    rowGroupby: firstSpec.meta.rowGroupbyForQueryFull,
    colGroupby: firstSpec.meta.colGroupbyForQueryFull,
    rowSubtotalLevels: firstSpec.meta.rowSubtotalLevels,
    colSubtotalLevels: firstSpec.meta.colSubtotalLevels,
    metricsLayoutResolved: firstSpec.meta.metricsLayoutResolved,
    metricInsertIndex: firstSpec.meta.metricInsertIndex,
  });
};

export const buildBranchTreeFromSpecResults = ({
  specs,
  results,
  formData,
  measureHierarchy,
}: {
  specs: PlannedQuerySpec[];
  results: QueryResultWithData[];
  formData: PivotTableQueryFormData;
  measureHierarchy: MeasureHierarchy;
}): PivotTreeData => {
  const firstSpec = specs[0];
  if (!firstSpec) {
    return { rows: {}, cols: {}, cells: {} };
  }
  const ingested = ingestQueryResults({
    specs,
    results,
    fallback: 'empty',
  });
  const store = buildFactStore(ingested);
  return buildBranchTreeFromFactStore({
    specs,
    store,
    formData,
    measureHierarchy,
  });
};

export const buildInitialRuntimeFromSpecResults = ({
  specs,
  results,
  layout,
  formData,
}: {
  specs: PlannedQuerySpec[];
  results: QueryResultWithData[];
  layout: LayoutContext;
  formData: PivotTableQueryFormData;
}): { tree: PivotTreeData; factBatches: PivotFactStoreBatch[] } => {
  const rootKey = serializePath([]);
  const emptyTree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const ingested = ingestQueryResults({ specs, results });
  const store = buildFactStore(ingested);
  const factBatches = ingested.map(factStoreBatchFromIngested);
  const mergedTree = ingested.reduce((acc, { spec }) => {
    const nextTree = buildBranchTreeFromFactBatches({
      batches: [factBatchFromStore({ store, spec })],
      metricsForQuery: spec.metrics,
      formData,
      measureHierarchy: layout.measureHierarchy,
      materializedMetrics: spec.meta.materializedMetrics,
      materializedMeasureHierarchy: spec.meta.materializedMeasureHierarchy,
      rowGroupby: spec.meta.rowGroupbyForQueryFull,
      colGroupby: spec.meta.colGroupbyForQueryFull,
      rowSubtotalLevels: spec.meta.rowSubtotalLevels,
      colSubtotalLevels: spec.meta.colSubtotalLevels,
      metricsLayoutResolved: spec.meta.metricsLayoutResolved,
      metricInsertIndex: spec.meta.metricInsertIndex,
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
  return {
    tree: applyMeasureLeafValuesToTree({
      tree: mergedTree,
      measureHierarchy: layout.measureHierarchy,
    }),
    factBatches,
  };
};

export const buildInitialTreeFromSpecResults = (
  params: Parameters<typeof buildInitialRuntimeFromSpecResults>[0],
): PivotTreeData => buildInitialRuntimeFromSpecResults(params).tree;
