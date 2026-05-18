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
import { getMetricKeys } from '../metrics';
import { type LayoutContext } from '../layout/LayoutContext';
import { type PlannedQuerySpec } from '../query/specs';
import {
  type ChartDataQueryResult,
  type ChartDataWarning,
} from '../data/ChartDataClient';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { type PivotFactCoverage } from './types';
import {
  createPivotFactStore,
  type PivotFact,
  type PivotFactStoreBatch,
  type PivotFactStore,
} from './factStore';
import {
  materializeLoadedPivotTreeFromFactStore,
  materializeLoadedPivotTreeFromFactStoreAsync,
} from './materializePivotTree';
import {
  assertChunkedWorkCurrent,
  type ChunkedWorkOptions,
  maybeYieldChunkedWork,
  yieldChunkedWork,
} from './chunkedWork';

export { createPivotFactStore } from './factStore';
export type {
  PivotFact,
  PivotFactStore,
  PivotFactStoreBatch,
} from './factStore';

export const collectPlannedQueryWarnings = (
  results: ChartDataQueryResult[],
): ChartDataWarning[] => results.flatMap(result => result.warnings ?? []);

type QueryResultWithData = {
  data?: DataRecord[] | Record<string, unknown>[];
  query?:
    | string
    | {
        query_name?: unknown;
      };
  query_name?: unknown;
};

type IngestedQueryResult<T extends QueryResultWithData> = {
  spec: PlannedQuerySpec;
  result: T;
  facts: PivotFact[];
};

const getQueryResultName = (
  result: QueryResultWithData,
): string | undefined => {
  if (
    typeof result.query === 'object' &&
    result.query !== null &&
    typeof result.query.query_name === 'string'
  ) {
    return result.query.query_name;
  }
  if (typeof result.query_name === 'string') {
    return result.query_name;
  }
  return undefined;
};

const orderQueryResultsForSpecs = <T extends QueryResultWithData>({
  specs,
  results,
}: {
  specs: PlannedQuerySpec[];
  results: T[];
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
  return specs.map(spec => resultsByName.get(spec.queryName) ?? {});
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
}: {
  result: QueryResultWithData;
  metrics: QueryFormMetric[];
  coverage: PivotFactCoverage;
}): PivotFact[] => {
  const records = (result.data ?? []) as DataRecord[];
  const valueKeys = getMetricValueKeysFromRecord(records[0], metrics);
  const rowColumns = coverage.rowDimensions;
  const columnColumns = coverage.columnDimensions;

  return records.flatMap(record => {
    const rowPath = pathFromRecord(record, rowColumns);
    const columnPath = pathFromRecord(record, columnColumns);
    return valueKeys.map(valueKey => ({
      rowPath,
      columnPath,
      valueKey,
      value: record[valueKey],
    }));
  });
};

const factsFromRecordsAsync = async ({
  result,
  metrics,
  coverage,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: {
  result: QueryResultWithData;
  metrics: QueryFormMetric[];
  coverage: PivotFactCoverage;
} & ChunkedWorkOptions): Promise<PivotFact[]> => {
  const records = (result.data ?? []) as DataRecord[];
  const valueKeys = getMetricValueKeysFromRecord(records[0], metrics);
  const rowColumns = coverage.rowDimensions;
  const columnColumns = coverage.columnDimensions;
  const facts: PivotFact[] = [];

  for (let idx = 0; idx < records.length; idx += 1) {
    const record = records[idx];
    const rowPath = pathFromRecord(record, rowColumns);
    const columnPath = pathFromRecord(record, columnColumns);
    valueKeys.forEach(valueKey => {
      facts.push({
        rowPath,
        columnPath,
        valueKey,
        value: record[valueKey],
      });
    });
    // eslint-disable-next-line no-await-in-loop
    await maybeYieldChunkedWork({
      processed: idx + 1,
      chunkSize,
      shouldContinue,
      yieldToMain,
    });
  }
  assertChunkedWorkCurrent(shouldContinue);
  return facts;
};

const ingestQueryResultFacts = ({
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
  });

export const ingestQueryResults = <T extends QueryResultWithData>({
  specs,
  results,
}: {
  specs: PlannedQuerySpec[];
  results: T[];
}): IngestedQueryResult<QueryResultWithData>[] => {
  const orderedResults = orderQueryResultsForSpecs({
    specs,
    results,
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

const ingestQueryResultsAsync = async <T extends QueryResultWithData>({
  specs,
  results,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: {
  specs: PlannedQuerySpec[];
  results: T[];
} & ChunkedWorkOptions): Promise<
  IngestedQueryResult<QueryResultWithData>[]
> => {
  const orderedResults = orderQueryResultsForSpecs({
    specs,
    results,
  });
  const ingested: IngestedQueryResult<QueryResultWithData>[] = [];
  for (let idx = 0; idx < specs.length; idx += 1) {
    const spec = specs[idx];
    const result = orderedResults[idx] ?? {};
    ingested.push({
      spec,
      result,
      // eslint-disable-next-line no-await-in-loop
      facts: await factsFromRecordsAsync({
        result,
        metrics: spec.metrics,
        coverage: spec.meta.coverage,
        chunkSize,
        shouldContinue,
        yieldToMain,
      }),
    });
    // eslint-disable-next-line no-await-in-loop
    await maybeYieldChunkedWork({
      processed: idx + 1,
      chunkSize,
      shouldContinue,
      yieldToMain,
    });
  }
  return ingested;
};

const factStoreBatchFromIngested = ({
  spec,
  facts,
}: Pick<
  IngestedQueryResult<QueryResultWithData>,
  'spec' | 'facts'
>): PivotFactStoreBatch => ({
  ...spec.meta.factSelector,
  facts,
});

const upsertIngestedFactsIntoStore = ({
  store,
  ingested,
}: {
  store: PivotFactStore;
  ingested: Array<IngestedQueryResult<QueryResultWithData>>;
}): PivotFactStoreBatch[] => {
  const batches = ingested.map(factStoreBatchFromIngested);
  batches.forEach(store.upsertBatch);
  return batches;
};

export const upsertQueryResultsIntoFactStore = <T extends QueryResultWithData>({
  store,
  specs,
  results,
}: {
  store: PivotFactStore;
  specs: PlannedQuerySpec[];
  results: T[];
}): PivotFactStoreBatch[] => {
  const ingested = ingestQueryResults({
    specs,
    results,
  });
  return upsertIngestedFactsIntoStore({ store, ingested });
};

export const fetchPlannedQuerySpecs = async ({
  formData,
  specs,
  requestGroupId,
  factStore,
}: {
  formData: PivotTableQueryFormData;
  specs: PlannedQuerySpec[];
  requestGroupId?: string;
  factStore?: PivotFactStore;
}): Promise<{ results: ChartDataQueryResult[] }> => {
  const missingSpecs = specs.filter(
    spec => !factStore?.hasCompatibleCoverage(spec.meta.factSelector),
  );
  if (missingSpecs.length === 0) {
    return { results: [] };
  }
  const metricsForQuery = missingSpecs[0]?.metrics;
  const timeOffsets = Array.from(
    new Set([
      ...(formData.time_offsets ?? []),
      ...missingSpecs.flatMap(spec => spec.meta.requiredTimeOffsets),
    ]),
  );
  const results = await supersetChartDataClient.fetch({
    formData: {
      ...formData,
      ...(metricsForQuery && metricsForQuery.length > 0
        ? { metrics: metricsForQuery }
        : {}),
      ...(timeOffsets.length > 0 ? { time_offsets: timeOffsets } : {}),
    },
    specs: missingSpecs,
    requestGroupId,
  });
  if (factStore) {
    upsertQueryResultsIntoFactStore({
      store: factStore,
      specs: missingSpecs,
      results,
    });
  }
  return { results };
};

const upsertFactBatchIntoStoreAsync = async ({
  store,
  batch,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: {
  store: PivotFactStore;
  batch: PivotFactStoreBatch;
} & ChunkedWorkOptions): Promise<void> => {
  if (batch.facts.length === 0) {
    store.upsertBatch(batch);
    // eslint-disable-next-line no-await-in-loop
    await yieldChunkedWork({ shouldContinue, yieldToMain });
    return;
  }
  const resolvedChunkSize = chunkSize ?? batch.facts.length;
  for (let start = 0; start < batch.facts.length; start += resolvedChunkSize) {
    store.upsertBatch({
      ...batch,
      facts: batch.facts.slice(start, start + resolvedChunkSize),
    });
    // eslint-disable-next-line no-await-in-loop
    await yieldChunkedWork({ shouldContinue, yieldToMain });
  }
};

const buildFactStore = (
  batches: IngestedQueryResult<QueryResultWithData>[],
) => {
  const store = createPivotFactStore();
  upsertIngestedFactsIntoStore({ store, ingested: batches });
  return store;
};

const buildFactStoreAsync = async ({
  ingested,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: {
  ingested: IngestedQueryResult<QueryResultWithData>[];
} & ChunkedWorkOptions) => {
  const store = createPivotFactStore();
  for (let idx = 0; idx < ingested.length; idx += 1) {
    // eslint-disable-next-line no-await-in-loop
    await upsertFactBatchIntoStoreAsync({
      store,
      batch: factStoreBatchFromIngested(ingested[idx]),
      chunkSize,
      shouldContinue,
      yieldToMain,
    });
  }
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
    tree: materializeLoadedPivotTreeFromFactStore({
      store,
      layout,
      formData,
    }),
    factBatches,
  };
};

export const buildInitialRuntimeFromSpecResultsAsync = async ({
  specs,
  results,
  layout,
  formData,
  chunkSize,
  shouldContinue,
  yieldToMain,
}: {
  specs: PlannedQuerySpec[];
  results: QueryResultWithData[];
  layout: LayoutContext;
  formData: PivotTableQueryFormData;
} & ChunkedWorkOptions): Promise<{
  tree: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
}> => {
  const ingested = await ingestQueryResultsAsync({
    specs,
    results,
    chunkSize,
    shouldContinue,
    yieldToMain,
  });
  const factBatches = ingested.map(factStoreBatchFromIngested);
  const store = await buildFactStoreAsync({
    ingested,
    chunkSize,
    shouldContinue,
    yieldToMain,
  });
  await yieldChunkedWork({ shouldContinue, yieldToMain });
  return {
    tree: await materializeLoadedPivotTreeFromFactStoreAsync({
      store,
      layout,
      formData,
      chunkSize,
      shouldContinue,
      yieldToMain,
    }),
    factBatches,
  };
};
