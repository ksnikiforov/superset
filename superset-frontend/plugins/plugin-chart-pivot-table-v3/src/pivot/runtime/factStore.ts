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
  type PivotPathValue,
} from '../../types';
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
};

export type PivotFactSelector = {
  coverage: PivotFactCoverage;
  scope: PivotFactStoreBatchScope;
};

export type PivotFactStoreBatch = PivotFactSelector & {
  facts: PivotFact[];
};

export type PivotFactStoreBatchScope =
  | {
      kind: 'bootstrap' | 'root';
    }
  | {
      kind: 'branch';
      axis: PivotAxis;
      path: PivotPath;
    }
  | {
      kind: 'batch';
      axis: PivotAxis;
      parentPath: PivotPath;
      siblingValues: PivotPathValue[];
    };

export type PivotFactStore = {
  upsertBatch: (batch: PivotFactStoreBatch) => void;
  upsertBatches: (batches: PivotFactStoreBatch[]) => void;
  getFacts: (selector: PivotFactSelector) => PivotFact[];
  hasCoverage: (selector: PivotFactSelector) => boolean;
  getAll: () => PivotFact[];
  size: () => number;
};

export const buildPivotFactRequestKey = ({
  coverage,
  scope,
}: PivotFactSelector) => stableStringify([coverage, scope]);

export const buildPivotFactKey = (
  selector: PivotFactSelector,
  fact: PivotFact,
) =>
  stableStringify([
    buildPivotFactRequestKey(selector),
    serializePath(fact.rowPath),
    serializePath(fact.columnPath),
    fact.valueKey,
    fact.role,
  ]);

export const createPivotFactStore = (): PivotFactStore => {
  const factsByKey = new Map<string, PivotFact>();
  const factKeysByRequest = new Map<string, Set<string>>();

  const upsertBatch = (batch: PivotFactStoreBatch) => {
    const { facts } = batch;
    const selector = {
      coverage: batch.coverage,
      scope: batch.scope,
    };
    const key = buildPivotFactRequestKey(selector);
    const requestFactKeys = factKeysByRequest.get(key) ?? new Set<string>();
    facts.forEach(fact => {
      const factKey = buildPivotFactKey(selector, fact);
      factsByKey.set(factKey, fact);
      requestFactKeys.add(factKey);
    });
    factKeysByRequest.set(key, requestFactKeys);
  };

  const getFacts = (selector: PivotFactSelector) =>
    Array.from(factKeysByRequest.get(buildPivotFactRequestKey(selector)) ?? [])
      .map(key => factsByKey.get(key))
      .filter((fact): fact is PivotFact => fact !== undefined);

  return {
    upsertBatch,
    upsertBatches: batches => batches.forEach(upsertBatch),
    getFacts,
    hasCoverage: selector =>
      factKeysByRequest.has(buildPivotFactRequestKey(selector)),
    getAll: () => Array.from(factsByKey.values()),
    size: () => factsByKey.size,
  };
};
