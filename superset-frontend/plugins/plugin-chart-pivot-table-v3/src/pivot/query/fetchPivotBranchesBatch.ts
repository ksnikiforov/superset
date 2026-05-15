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
import { type ChartDataWarning } from '../data/ChartDataClient';
import { buildLayoutContext } from '../layout/LayoutContext';
import { buildFactCoverage } from '../runtime/coverage';
import {
  buildFactValueKeys,
  type PivotFactStore,
  type PivotFactStoreBatch,
} from '../runtime/factStore';
import { type BatchGroup } from './fetchPlanOptimizer';
import {
  fetchPivotQuerySpecsIntoBranchTree,
  resolvePivotQueryLocalResultFromFactStore,
} from './fetchPivotBranch';
import { buildBatchQuerySpecs } from './specs';

export type FetchPivotBranchesBatchParams = {
  formData: PivotTableQueryFormData;
  batch: BatchGroup;
  visibleRowDepth: number;
  visibleColDepth: number;
  requestGroupId?: string;
  factStore?: PivotFactStore;
};

export type FetchPivotBranchesBatchResult = {
  data?: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  warnings?: ChartDataWarning[];
  error?: Error;
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
      valueKeys: buildFactValueKeys({
        metricKeys: layout.pivotProgram.metricKeys,
      }),
      facts: [],
    };
    factStore?.upsertBatch(batchMarker);
    return { data: undefined, factBatches: [batchMarker] };
  }
  const localResult = resolvePivotQueryLocalResultFromFactStore({
    specs,
    store: factStore,
    formData,
    measureHierarchy: layout.measureHierarchy,
  });
  if (localResult) {
    return localResult;
  }
  return fetchPivotQuerySpecsIntoBranchTree({
    formData,
    specs,
    requestGroupId,
    factStore,
    measureHierarchy: layout.measureHierarchy,
  });
};
