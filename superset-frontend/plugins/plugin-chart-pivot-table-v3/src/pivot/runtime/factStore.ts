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
import { type PivotPath } from '../../types';
import { serializePath } from '../core/path';
import { stableStringify } from '../shared/stableStringify';
import { type PivotFactCoverage } from './types';

export type PivotFactRole = 'visible' | 'support';

export type PivotFact = {
  rowPath: PivotPath;
  columnPath: PivotPath;
  valueKey: string;
  value: DataRecordValue;
  role: PivotFactRole;
  coverage?: PivotFactCoverage;
  queryName: string;
};

type PivotFactSelector = {
  coverage?: PivotFactCoverage;
  queryName: string;
};

export type PivotFactStoreBatch = PivotFactSelector & {
  facts: PivotFact[];
};

export type PivotFactStore = {
  upsertBatch: (batch: PivotFactStoreBatch) => void;
  upsertBatches: (batches: PivotFactStoreBatch[]) => void;
  upsertMany: (facts: PivotFact[]) => void;
  getFacts: (selector: PivotFactSelector) => PivotFact[];
  hasCoverage: (selector: PivotFactSelector) => boolean;
  getAll: () => PivotFact[];
  size: () => number;
};

const coverageKey = ({ coverage, queryName }: PivotFactSelector) =>
  coverage ? stableStringify(coverage) : `query:${queryName}`;

export const buildPivotFactKey = (fact: PivotFact) =>
  stableStringify([
    coverageKey(fact),
    serializePath(fact.rowPath),
    serializePath(fact.columnPath),
    fact.valueKey,
    fact.role,
  ]);

export const createPivotFactStore = (): PivotFactStore => {
  const factsByKey = new Map<string, PivotFact>();
  const factKeysByCoverage = new Map<string, Set<string>>();

  const upsertBatch = ({ facts, ...selector }: PivotFactStoreBatch) => {
    const key = coverageKey(selector);
    const coverageFactKeys = factKeysByCoverage.get(key) ?? new Set<string>();
    facts.forEach(fact => {
      const factKey = buildPivotFactKey(fact);
      factsByKey.set(factKey, fact);
      coverageFactKeys.add(factKey);
    });
    factKeysByCoverage.set(key, coverageFactKeys);
  };

  const upsertMany = (facts: PivotFact[]) => {
    const batchesByCoverage = new Map<string, PivotFactStoreBatch>();
    facts.forEach(fact => {
      const key = coverageKey(fact);
      const batch =
        batchesByCoverage.get(key) ??
        ({
          coverage: fact.coverage,
          queryName: fact.queryName,
          facts: [],
        } satisfies PivotFactStoreBatch);
      batch.facts.push(fact);
      batchesByCoverage.set(key, batch);
    });
    Array.from(batchesByCoverage.values()).forEach(upsertBatch);
  };

  const getFacts = (selector: PivotFactSelector) =>
    Array.from(factKeysByCoverage.get(coverageKey(selector)) ?? [])
      .map(key => factsByKey.get(key))
      .filter((fact): fact is PivotFact => fact !== undefined);

  return {
    upsertBatch,
    upsertBatches: batches => batches.forEach(upsertBatch),
    upsertMany,
    getFacts,
    hasCoverage: selector => factKeysByCoverage.has(coverageKey(selector)),
    getAll: () => Array.from(factsByKey.values()),
    size: () => factsByKey.size,
  };
};
