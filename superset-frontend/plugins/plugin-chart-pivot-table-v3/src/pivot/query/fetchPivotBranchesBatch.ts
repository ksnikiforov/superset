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
import type { PivotTableQueryFormData, PivotTreeData } from '../../types';
import { parsePath } from '../core/path';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { buildLayoutContext } from '../layout/LayoutContext';
import { buildFactCoverage } from '../runtime/coverage';
import {
  createPivotFactStore,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { upsertQueryResultsIntoFactStore } from '../runtime/ingestQueryResults';
import {
  buildBranchTreeFromFactStore,
  buildFactStoreBatchesFromSpecs,
  canMaterializeSpecsFromFactStore,
} from '../runtime/materializePivotTree';
import { type BatchGroup } from './fetchPlanOptimizer';
import { buildBatchQuerySpecs } from './specs';

export type FetchPivotBranchesBatchParams = {
  formData: PivotTableQueryFormData;
  batch: BatchGroup;
  currentTree?: PivotTreeData;
  visibleRowDepth: number;
  visibleColDepth: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

export type FetchPivotBranchesBatchResult = {
  data?: PivotTreeData;
  factStoreHit?: boolean;
  factBatches: PivotFactStoreBatch[];
  warnings?: ChartDataWarning[];
  error?: Error;
};

const EMPTY_FACT_BATCHES: PivotFactStoreBatch[] = [];

const isAbortError = (error: unknown): boolean => {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
};

export const fetchPivotBranchesBatch = async ({
  formData,
  batch,
  visibleRowDepth,
  visibleColDepth,
  requestGroupId,
  factStore,
}: FetchPivotBranchesBatchParams): Promise<FetchPivotBranchesBatchResult> => {
  const layout = buildLayoutContext(formData);
  const specs = buildBatchQuerySpecs({
    formData,
    layout,
    batch,
    visibleRowDepth,
    visibleColDepth,
    chunkIndex: 0,
  });
  if (specs.length === 0) {
    const batchMarker: PivotFactStoreBatch = {
      coverage: buildFactCoverage({
        reason: 'expand',
        rowDimensions: layout.pivotProgram.rowDimensions,
        columnDimensions: layout.pivotProgram.columnDimensions,
        rowDepth: visibleRowDepth,
        columnDepth: visibleColDepth,
      }),
      scope: {
        kind: 'batch',
        axis: batch.axis,
        parentPath: parsePath(batch.parentPathKey),
        siblingValues: batch.siblingValues,
      },
      facts: [],
    };
    factStore?.upsertBatch(batchMarker);
    return { data: undefined, factBatches: [batchMarker] };
  }
  if (
    factStore &&
    canMaterializeSpecsFromFactStore({
      specs,
      store: factStore,
    })
  ) {
    const factBatches = buildFactStoreBatchesFromSpecs({
      specs,
      store: factStore,
    });
    const data = buildBranchTreeFromFactStore({
      specs,
      store: factStore,
      formData,
      measureHierarchy: layout.measureHierarchy,
    });
    return {
      data,
      factStoreHit: true,
      factBatches,
    };
  }
  const metricsForQuery = specs[0].metrics;
  const queryFormData =
    metricsForQuery.length > 0
      ? { ...formData, metrics: metricsForQuery }
      : formData;
  const timeOffsets = Array.from(
    new Set([
      ...(formData.time_offsets ?? []),
      ...specs.flatMap(spec => spec.meta.requiredTimeOffsets),
    ]),
  );
  const queryFormDataWithOffsets =
    timeOffsets.length > 0
      ? { ...queryFormData, time_offsets: timeOffsets }
      : queryFormData;

  try {
    const results = await supersetChartDataClient.fetch({
      formData: queryFormDataWithOffsets,
      specs,
      requestGroupId,
    });
    const warnings = results.flatMap(result => result.warnings ?? []);
    const store = factStore ?? createPivotFactStore();
    const factBatches = upsertQueryResultsIntoFactStore({
      store,
      specs,
      results,
      fallback: 'empty',
    });
    const tree = buildBranchTreeFromFactStore({
      specs,
      store,
      formData,
      measureHierarchy: layout.measureHierarchy,
    });
    return {
      data: tree,
      factBatches,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { factBatches: EMPTY_FACT_BATCHES };
    }
    return {
      factBatches: EMPTY_FACT_BATCHES,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};
