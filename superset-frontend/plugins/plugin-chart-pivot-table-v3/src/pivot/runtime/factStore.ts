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
import { type DataRecordValue } from '@superset-ui/core';
import {
  type PivotAxis,
  type PivotPath,
  type PivotTableQueryFormData,
} from '../../types';
import { serializePath } from '../core/path';
import { stableStringify } from '../shared/stableStringify';
import { normalizeFactValueKeys } from './coverage';
import { type PivotFactCoverage } from './types';

export type PivotFact = {
  rowPath: PivotPath;
  columnPath: PivotPath;
  valueKey: string;
  value: DataRecordValue;
};

export type PivotFactSelector = {
  coverage: PivotFactCoverage;
  scope: PivotFactStoreBatchScope;
  valueKeys: string[];
  queryContextKey: string;
  materialization?: PivotFactMaterialization;
};

export type PivotFactStoreBatch = PivotFactSelector & {
  facts: PivotFact[];
};

export type PivotFactStoreBatchScope =
  | {
      kind: 'root';
    }
  | {
      kind: 'axisPaths';
      axis: PivotAxis;
      paths: PivotPath[];
    }
  | {
      kind: 'scopedFull';
      axis: PivotAxis;
      ancestorPaths: PivotPath[];
    }
  | {
      kind: 'intersection';
      rowPaths: PivotPath[];
      columnPaths: PivotPath[];
    };

export type PivotFactMaterialization = {
  valueAxis: PivotAxis;
  valueInsertIndex: number;
};

export type PivotFactStore = {
  upsertBatch: (batch: PivotFactStoreBatch) => void;
  getCoverageSelectors: (queryContextKey?: string) => PivotFactSelector[];
  getFactBatches: (queryContextKey?: string) => PivotFactStoreBatch[];
};

const buildPivotFactRequestKey = ({
  coverage,
  materialization,
  queryContextKey,
  scope,
  valueKeys,
}: PivotFactSelector) =>
  stableStringify([
    queryContextKey,
    coverage,
    scope,
    materialization,
    normalizeFactValueKeys(valueKeys),
  ]);

export const buildPivotFactQueryContextKey = (
  formData: PivotTableQueryFormData,
) =>
  stableStringify({
    adhoc_filters: formData.adhoc_filters ?? [],
    extra_form_data: formData.extra_form_data ?? null,
    extras: formData.extras ?? null,
    granularity_sqla: formData.granularity_sqla ?? null,
    time_grain_sqla: formData.time_grain_sqla ?? null,
    time_offsets: formData.time_offsets ?? [],
    time_range: formData.time_range ?? null,
  });

export const buildFactValueKeys = ({
  metricKeys,
  requiredTimeOffsets = [],
}: {
  metricKeys: string[];
  requiredTimeOffsets?: string[];
}) =>
  normalizeFactValueKeys([
    ...metricKeys,
    ...metricKeys.flatMap(metricKey =>
      requiredTimeOffsets.map(offset => `${metricKey}__${offset}`),
    ),
  ]);

const buildPivotFactKey = (selector: PivotFactSelector, fact: PivotFact) =>
  stableStringify([
    buildPivotFactRequestKey(selector),
    serializePath(fact.rowPath),
    serializePath(fact.columnPath),
    fact.valueKey,
  ]);

const normalizeSelector = ({
  coverage,
  materialization,
  queryContextKey,
  scope,
  valueKeys,
}: PivotFactSelector): PivotFactSelector => ({
  coverage,
  materialization,
  queryContextKey,
  scope,
  valueKeys: normalizeFactValueKeys(valueKeys),
});

const startsWithPath = (path: PivotPath, prefix: PivotPath) =>
  prefix.every((value, index) => path[index] === value);

const factMatchesIntersectionScope = (
  fact: PivotFact,
  scope: Extract<PivotFactStoreBatchScope, { kind: 'intersection' }>,
) =>
  scope.rowPaths.some(path => startsWithPath(fact.rowPath, path)) &&
  scope.columnPaths.some(path => startsWithPath(fact.columnPath, path));

const factMatchesCoverage = (fact: PivotFact, coverage: PivotFactCoverage) =>
  fact.rowPath.length === coverage.rowDepth &&
  fact.columnPath.length === coverage.columnDepth;

export const createPivotFactStore = (): PivotFactStore => {
  const factsByRequest = new Map<string, PivotFact[]>();
  const selectorByRequest = new Map<string, PivotFactSelector>();

  const upsertBatch = (batch: PivotFactStoreBatch) => {
    const { facts } = batch;
    const selector = normalizeSelector(batch);
    const key = buildPivotFactRequestKey(selector);
    const factsByFactKey = new Map(
      (factsByRequest.get(key) ?? []).map(fact => [
        buildPivotFactKey(selector, fact),
        fact,
      ]),
    );
    selectorByRequest.set(key, selector);
    facts
      .filter(
        fact =>
          factMatchesCoverage(fact, selector.coverage) &&
          (selector.scope.kind !== 'intersection' ||
            factMatchesIntersectionScope(fact, selector.scope)),
      )
      .forEach(fact => {
        const factKey = buildPivotFactKey(selector, fact);
        factsByFactKey.set(factKey, fact);
      });
    factsByRequest.set(key, Array.from(factsByFactKey.values()));
  };

  const selectors = (queryContextKey?: string) =>
    Array.from(selectorByRequest.values()).filter(
      selector =>
        queryContextKey === undefined ||
        selector.queryContextKey === queryContextKey,
    );

  return {
    upsertBatch,
    getCoverageSelectors: selectors,
    getFactBatches: queryContextKey =>
      selectors(queryContextKey).map(selector => ({
        ...selector,
        facts: factsByRequest.get(buildPivotFactRequestKey(selector)) ?? [],
      })),
  };
};

export const createPivotFactStoreFromBatches = (
  batches: PivotFactStoreBatch[],
): PivotFactStore => {
  const store = createPivotFactStore();
  batches.forEach(store.upsertBatch);
  return store;
};
