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
  buildTreeFromRecords,
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

export type QueryResultWithData = {
  data?: DataRecord[];
  query?: {
    query_name?: unknown;
  };
  query_name?: unknown;
};

export type PivotFact = {
  rowPath: PivotPath;
  columnPath: PivotPath;
  valueKey: string;
  value: DataRecordValue;
  coverage?: PivotFactCoverage;
  queryName: string;
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

export const ingestQueryResultFacts = ({
  spec,
  result,
}: {
  spec: PlannedQuerySpec;
  result: QueryResultWithData;
}): PivotFact[] => {
  const records = result.data ?? [];
  const valueKeys = getMetricValueKeysFromRecord(records[0], spec.metrics);
  const rowColumns = spec.meta.rowGroupbyForQueryFull.slice(
    0,
    spec.meta.rowDepth,
  );
  const columnColumns = spec.meta.colGroupbyForQueryFull.slice(
    0,
    spec.meta.colDepth,
  );

  return records.flatMap(record => {
    const rowPath = pathFromRecord(record, rowColumns);
    const columnPath = pathFromRecord(record, columnColumns);
    return valueKeys.map(valueKey => ({
      rowPath,
      columnPath,
      valueKey,
      value: record[valueKey],
      coverage: spec.meta.coverage,
      queryName: spec.queryName,
    }));
  });
};

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

export const buildBranchTreeFromResults = ({
  results,
  queryPairs,
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
  results: Array<{ data?: DataRecord[] }>;
  queryPairs: Array<{ rowDepth: number; colDepth: number }>;
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
  const branchTree = queryPairs.reduce<PivotTreeData>(
    (acc, pair, idx) =>
      mergeTrees(
        acc,
        (() => {
          let tree = buildTreeFromRecords(
            results[idx]?.data || [],
            queryMetrics,
            rowGroupby,
            colGroupby,
            pair.rowDepth,
            pair.colDepth,
            formData.dateFormatters,
          );
          if (colSubtotalLevels.includes(pair.colDepth)) {
            tree = injectColumnSubtotalLeaves(
              tree,
              pair.colDepth,
              colGroupby.length,
            );
          }
          const rowSubtotalDepths = rowSubtotalLevels.filter(
            level => level > 0 && level <= pair.rowDepth,
          );
          rowSubtotalDepths.forEach(depth => {
            tree = injectRowSubtotalLeaves(tree, depth, rowGroupby.length);
          });
          return tree;
        })(),
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
  return buildBranchTreeFromResults({
    results: ingested.map(({ result }) => result),
    queryPairs: specs.map(spec => ({
      rowDepth: spec.meta.rowDepth,
      colDepth: spec.meta.colDepth,
    })),
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

export const buildInitialTreeFromSpecResults = ({
  specs,
  results,
  layout,
  formData,
}: {
  specs: PlannedQuerySpec[];
  results: QueryResultWithData[];
  layout: LayoutContext;
  formData: PivotTableQueryFormData;
}): PivotTreeData => {
  const rootKey = serializePath([]);
  const emptyTree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const ingested = ingestQueryResults({ specs, results });
  const mergedTree = ingested.reduce((acc, { spec, result }) => {
    const nextTree = buildBranchTreeFromResults({
      results: [result],
      queryPairs: [
        { rowDepth: spec.meta.rowDepth, colDepth: spec.meta.colDepth },
      ],
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
  return applyMeasureLeafValuesToTree({
    tree: mergedTree,
    measureHierarchy: layout.measureHierarchy,
  });
};
