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
  getColumnLabel,
  type QueryFormColumn,
  type QueryFormMetric,
} from '@superset-ui/core';
import { type PivotTableQueryFormData, type PivotTreeData } from '../../types';
import { getMetricKeys } from '../core/tokens';
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
import {
  factStoreSelectorFromSpec,
  materializeInitialPivotTreeFromFactStore,
} from './materializePivotTree';

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
  coverage,
  materializedMetrics,
}: {
  result: QueryResultWithData;
  metrics: QueryFormMetric[];
  coverage: PivotFactCoverage;
  materializedMetrics: QueryFormMetric[];
}): PivotFact[] => {
  const records = result.data ?? [];
  const valueKeys = getMetricValueKeysFromRecord(records[0], metrics);
  const visibleValueKeys = new Set(getMetricKeys(materializedMetrics));
  const rowColumns = coverage.rowDimensions;
  const columnColumns = coverage.columnDimensions;
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

const factStoreBatchFromIngested = ({
  spec,
  facts,
}: Pick<
  IngestedQueryResult<QueryResultWithData>,
  'spec' | 'facts'
>): PivotFactStoreBatch => ({
  ...factStoreSelectorFromSpec(spec),
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
  const ingested = ingestQueryResults({ specs, results });
  const store = buildFactStore(ingested);
  const factBatches = ingested.map(factStoreBatchFromIngested);
  return {
    tree: materializeInitialPivotTreeFromFactStore({
      specs,
      store,
      layout,
      formData,
    }),
    factBatches,
  };
};

export const buildInitialTreeFromSpecResults = (
  params: Parameters<typeof buildInitialRuntimeFromSpecResults>[0],
): PivotTreeData => buildInitialRuntimeFromSpecResults(params).tree;
