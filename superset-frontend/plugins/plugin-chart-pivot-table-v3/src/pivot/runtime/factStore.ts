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
import {
  buildCoverageNeedFromFactSelector,
  diffCoverageManifest,
  normalizeFactValueKeys,
} from './coverage';
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
  valueKeys: string[];
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
    }
  | {
      kind: 'intersection';
      rowPaths: PivotPath[];
      columnPaths: PivotPath[];
    };

export type PivotFactStore = {
  upsertBatch: (batch: PivotFactStoreBatch) => void;
  upsertBatches: (batches: PivotFactStoreBatch[]) => void;
  getCompatibleFacts: (selector: PivotFactSelector) => PivotFact[];
  getCoverageBatches: () => PivotFactStoreBatch[];
  getFactBatches: () => PivotFactStoreBatch[];
  hasCompatibleCoverage: (selector: PivotFactSelector) => boolean;
};

const buildPivotFactRequestKey = ({
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

const buildPivotFactKey = (selector: PivotFactSelector, fact: PivotFact) =>
  stableStringify([
    buildPivotFactRequestKey(selector),
    serializePath(fact.rowPath),
    serializePath(fact.columnPath),
    fact.valueKey,
    fact.role,
  ]);

const normalizeSelector = ({
  coverage,
  scope,
  valueKeys,
}: PivotFactSelector): PivotFactSelector => ({
  coverage,
  scope,
  valueKeys: normalizeFactValueKeys(valueKeys),
});

const valueKeysCover = (
  available: string[] | undefined,
  required: string[],
) => {
  const requiredValueKeys = normalizeFactValueKeys(required);
  if (requiredValueKeys.length === 0) {
    return true;
  }
  const availableValueKeys = new Set(normalizeFactValueKeys(available));
  return requiredValueKeys.every(valueKey => availableValueKeys.has(valueKey));
};

const startsWithPath = (path: PivotPath, prefix: PivotPath) =>
  prefix.every((value, index) => path[index] === value);

const factMatchesScope = (fact: PivotFact, scope: PivotFactStoreBatchScope) => {
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
        startsWithPath(scope.axis === 'row' ? fact.rowPath : fact.columnPath, [
          ...scope.parentPath,
          value,
        ]),
      );
    case 'intersection':
      return (
        scope.rowPaths.some(path => startsWithPath(fact.rowPath, path)) &&
        scope.columnPaths.some(path => startsWithPath(fact.columnPath, path))
      );
    default:
      return false;
  }
};

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
          selector.scope.kind !== 'intersection' ||
          factMatchesScope(fact, selector.scope),
      )
      .forEach(fact => {
        const factKey = buildPivotFactKey(selector, fact);
        factsByFactKey.set(factKey, fact);
      });
    factsByRequest.set(key, Array.from(factsByFactKey.values()));
  };

  const hasCompatibleCoverage = (selector: PivotFactSelector) => {
    const candidateSelectors = Array.from(selectorByRequest.values()).filter(
      candidate =>
        selector.scope.kind !== 'bootstrap' && selector.scope.kind !== 'root'
          ? true
          : candidate.scope.kind === 'bootstrap' ||
            candidate.scope.kind === 'root',
    );
    return (
      diffCoverageManifest({
        required: [buildCoverageNeedFromFactSelector(selector)],
        factBatches: candidateSelectors.map(candidate => ({
          ...candidate,
          facts: [],
        })),
      }).length === 0
    );
  };

  const coverageShapeKey = (coverage: PivotFactCoverage) =>
    stableStringify({
      rowDepth: coverage.rowDepth,
      columnDepth: coverage.columnDepth,
      rowDimensions: coverage.rowDimensions,
      columnDimensions: coverage.columnDimensions,
    });

  const hasExactCoverageShape = (
    candidate: PivotFactSelector,
    requested: PivotFactSelector,
  ) =>
    coverageShapeKey(candidate.coverage) ===
    coverageShapeKey(requested.coverage);

  const selectorCanContributeToRead = (
    candidate: PivotFactSelector,
    requested: PivotFactSelector,
  ) => {
    if (!hasExactCoverageShape(candidate, requested)) {
      return false;
    }
    if (!valueKeysCover(candidate.valueKeys, requested.valueKeys)) {
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
    return true;
  };

  const getCompatibleRequestSelectorsForRead = (
    selector: PivotFactSelector,
  ) => {
    const exactKey = buildPivotFactRequestKey(selector);
    const exactSelector = selectorByRequest.get(exactKey);
    if (exactSelector) {
      return [{ key: exactKey, selector: exactSelector }];
    }
    if (!hasCompatibleCoverage(selector)) {
      return [];
    }
    return Array.from(selectorByRequest.entries())
      .filter(([, candidate]) =>
        selectorCanContributeToRead(candidate, selector),
      )
      .map(([key, candidate]) => ({ key, selector: candidate }));
  };

  const getCompatibleFacts = (selector: PivotFactSelector) =>
    getCompatibleRequestSelectorsForRead(selector).flatMap(candidate => {
      const facts = factsByRequest.get(candidate.key) ?? [];
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
    getCompatibleFacts,
    getCoverageBatches: () =>
      Array.from(selectorByRequest.values()).map(selector => ({
        ...selector,
        facts: [],
      })),
    getFactBatches: () =>
      Array.from(selectorByRequest.entries()).map(([key, selector]) => ({
        ...selector,
        facts: factsByRequest.get(key) ?? [],
      })),
    hasCompatibleCoverage,
  };
};
