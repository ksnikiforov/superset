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
import { decodeMetricKey, isMeasureLeafToken } from '../core/tokens';
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
  valueKeys?: string[];
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
  getCompatibleFacts: (selector: PivotFactSelector) => PivotFact[];
  hasCoverage: (selector: PivotFactSelector) => boolean;
  hasCompatibleCoverage: (selector: PivotFactSelector) => boolean;
  getAll: () => PivotFact[];
  size: () => number;
};

export const normalizeFactValueKeys = (valueKeys: string[] = []) =>
  Array.from(new Set(valueKeys)).sort();

export const buildPivotFactRequestKey = ({
  coverage,
  scope,
  valueKeys,
}: PivotFactSelector) =>
  stableStringify([coverage, scope, normalizeFactValueKeys(valueKeys)]);

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

const buildCoverageShapeKey = ({
  rowDepth,
  columnDepth,
  rowDimensions,
  columnDimensions,
}: PivotFactCoverage) =>
  stableStringify([rowDepth, columnDepth, rowDimensions, columnDimensions]);

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
  const selectorByRequest = new Map<string, PivotFactSelector>();

  const upsertBatch = (batch: PivotFactStoreBatch) => {
    const { facts } = batch;
    const selector = {
      coverage: batch.coverage,
      scope: batch.scope,
      valueKeys: normalizeFactValueKeys(
        batch.valueKeys ?? facts.map(fact => fact.valueKey),
      ),
    };
    const key = buildPivotFactRequestKey(selector);
    const requestFactKeys = factKeysByRequest.get(key) ?? new Set<string>();
    selectorByRequest.set(key, selector);
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

  const sameCoverageShape = (
    left: PivotFactCoverage,
    right: PivotFactCoverage,
  ) => buildCoverageShapeKey(left) === buildCoverageShapeKey(right);

  const selectorValueKeysCover = (
    candidate: PivotFactSelector,
    requested: PivotFactSelector,
  ) => {
    const requestedValueKeys = normalizeFactValueKeys(requested.valueKeys);
    if (requestedValueKeys.length === 0) {
      return true;
    }
    const candidateValueKeys = new Set(
      normalizeFactValueKeys(candidate.valueKeys),
    );
    return requestedValueKeys.every(valueKey =>
      candidateValueKeys.has(valueKey),
    );
  };

  const startsWithPath = (path: PivotPath, prefix: PivotPath) =>
    prefix.every((value, index) => path[index] === value);

  const factMatchesScope = (
    fact: PivotFact,
    scope: PivotFactStoreBatchScope,
  ) => {
    switch (scope.kind) {
      case 'bootstrap':
      case 'root':
        return true;
      case 'branch':
        return startsWithPath(
          scope.axis === 'row' ? fact.rowPath : fact.columnPath,
          scope.path,
        );
      case 'batch':
        return scope.siblingValues.some(value =>
          startsWithPath(
            scope.axis === 'row' ? fact.rowPath : fact.columnPath,
            [...scope.parentPath, value],
          ),
        );
      default:
        return false;
    }
  };

  const pathContainsValuesToken = (path: PivotPath) =>
    path.some(value => decodeMetricKey(value) || isMeasureLeafToken(value));

  const scopeContainsValuesToken = (scope: PivotFactStoreBatchScope) => {
    switch (scope.kind) {
      case 'branch':
        return pathContainsValuesToken(scope.path);
      case 'batch':
        return scope.siblingValues.some(value =>
          pathContainsValuesToken([...scope.parentPath, value]),
        );
      default:
        return false;
    }
  };

  const isCompatibleSelector = (
    candidate: PivotFactSelector,
    requested: PivotFactSelector,
  ) => {
    if (!sameCoverageShape(candidate.coverage, requested.coverage)) {
      return false;
    }
    if (!selectorValueKeysCover(candidate, requested)) {
      return false;
    }
    if (
      requested.scope.kind === 'bootstrap' ||
      requested.scope.kind === 'root'
    ) {
      return (
        candidate.scope.kind === 'bootstrap' || candidate.scope.kind === 'root'
      );
    }
    if (
      candidate.scope.kind === 'bootstrap' ||
      candidate.scope.kind === 'root'
    ) {
      return !scopeContainsValuesToken(requested.scope);
    }
    return (
      buildPivotFactRequestKey(candidate) ===
      buildPivotFactRequestKey(requested)
    );
  };

  const getCompatibleRequestSelectors = (selector: PivotFactSelector) =>
    Array.from(selectorByRequest.entries())
      .filter(([, candidate]) => isCompatibleSelector(candidate, selector))
      .map(([key, candidate]) => ({ key, selector: candidate }));

  const getCompatibleRequestSelectorsForRead = (
    selector: PivotFactSelector,
  ) => {
    const exactKey = buildPivotFactRequestKey(selector);
    const exactSelector = selectorByRequest.get(exactKey);
    if (exactSelector) {
      return [{ key: exactKey, selector: exactSelector }];
    }
    return getCompatibleRequestSelectors(selector);
  };

  const getCompatibleFacts = (selector: PivotFactSelector) =>
    getCompatibleRequestSelectorsForRead(selector).flatMap(candidate => {
      const facts = Array.from(factKeysByRequest.get(candidate.key) ?? [])
        .map(key => factsByKey.get(key))
        .filter((fact): fact is PivotFact => fact !== undefined);
      if (
        buildPivotFactRequestKey(candidate.selector) ===
        buildPivotFactRequestKey(selector)
      ) {
        return facts;
      }
      const requestedValueKeys = new Set(
        normalizeFactValueKeys(selector.valueKeys),
      );
      return facts.filter(
        fact =>
          factMatchesScope(fact, selector.scope) &&
          (requestedValueKeys.size === 0 ||
            requestedValueKeys.has(fact.valueKey)),
      );
    });

  return {
    upsertBatch,
    upsertBatches: batches => batches.forEach(upsertBatch),
    getFacts,
    getCompatibleFacts,
    hasCoverage: selector =>
      factKeysByRequest.has(buildPivotFactRequestKey(selector)),
    hasCompatibleCoverage: selector =>
      getCompatibleRequestSelectors(selector).length > 0,
    getAll: () => Array.from(factsByKey.values()),
    size: () => factsByKey.size,
  };
};
