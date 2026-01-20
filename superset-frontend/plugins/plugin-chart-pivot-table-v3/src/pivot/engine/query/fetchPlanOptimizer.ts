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
import { PivotAxis, PivotPathValue } from '../../../types';
import { parsePath, serializePath } from '../../../utils';
import { FetchTarget } from '../fetchCoordinator';

export type BatchCandidate = FetchTarget & {
  batchSignature: string;
};

export type BatchGroup = {
  axis: PivotAxis;
  childDepth: number;
  requiredOppositeDepth: number;
  signature: string;
  parentPathKey: string;
  siblingValues: PivotPathValue[];
  targets: BatchCandidate[];
};

export type BatchPlan = {
  batches: BatchGroup[];
  singles: BatchCandidate[];
};

export const MAX_BATCH_SIBLINGS = 50;

type CandidateWithPath = BatchCandidate & {
  parentPathKey: string;
  siblingValue: PivotPathValue;
};

type BatchGroupSeed = {
  axis: PivotAxis;
  childDepth: number;
  requiredOppositeDepth: number;
  signature: string;
  parentPathKey: string;
  nonNullTargets: CandidateWithPath[];
  nullTargets: CandidateWithPath[];
};

const isNullish = (value: PivotPathValue) =>
  value === null || value === undefined;

const chunkTargets = (
  targets: CandidateWithPath[],
  chunkSize: number,
): CandidateWithPath[][] => {
  const sorted = [...targets].sort((a, b) =>
    a.pathKey.localeCompare(b.pathKey),
  );
  const chunks: CandidateWithPath[][] = [];
  for (let idx = 0; idx < sorted.length; idx += chunkSize) {
    chunks.push(sorted.slice(idx, idx + chunkSize));
  }
  return chunks;
};

const buildBatchGroups = (
  seed: BatchGroupSeed,
  targets: CandidateWithPath[],
  maxBatchSize: number,
): BatchGroup[] =>
  chunkTargets(targets, maxBatchSize).map(chunk => ({
    axis: seed.axis,
    childDepth: seed.childDepth,
    requiredOppositeDepth: seed.requiredOppositeDepth,
    signature: seed.signature,
    parentPathKey: seed.parentPathKey,
    siblingValues: chunk.map(target => target.siblingValue),
    targets: chunk,
  }));

export const optimizeFetchPlan = ({
  targets,
  maxBatchSize = MAX_BATCH_SIBLINGS,
}: {
  targets: BatchCandidate[];
  maxBatchSize?: number;
}): BatchPlan => {
  const singles: BatchCandidate[] = [];
  const groups = new Map<string, BatchGroupSeed>();

  targets.forEach(target => {
    const path = parsePath(target.pathKey);
    if (path.length === 0) {
      singles.push(target);
      return;
    }
    const parentPath = path.slice(0, -1);
    const parentPathKey = serializePath(parentPath);
    const siblingValue = path[path.length - 1];
    const groupKey = JSON.stringify([
      target.axis,
      target.childDepth,
      target.requiredOppositeDepth,
      target.batchSignature,
      parentPathKey,
    ]);
    const seed = groups.get(groupKey) ?? {
      axis: target.axis,
      childDepth: target.childDepth,
      requiredOppositeDepth: target.requiredOppositeDepth,
      signature: target.batchSignature,
      parentPathKey,
      nonNullTargets: [],
      nullTargets: [],
    };
    const candidate: CandidateWithPath = {
      ...target,
      parentPathKey,
      siblingValue,
    };
    if (isNullish(siblingValue)) {
      seed.nullTargets.push(candidate);
    } else {
      seed.nonNullTargets.push(candidate);
    }
    groups.set(groupKey, seed);
  });

  const batches: BatchGroup[] = [];
  groups.forEach(seed => {
    const nonNullBatches = buildBatchGroups(
      seed,
      seed.nonNullTargets,
      maxBatchSize,
    );
    const nullBatches = buildBatchGroups(seed, seed.nullTargets, maxBatchSize);
    [...nonNullBatches, ...nullBatches].forEach(group => {
      if (group.targets.length <= 1) {
        singles.push(...group.targets);
        return;
      }
      batches.push(group);
    });
  });

  return { batches, singles };
};
