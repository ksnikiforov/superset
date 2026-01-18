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

import { PivotAxis } from '../../types';

export type FetchTarget = {
  axis: PivotAxis;
  pathKey: string;
  childDepth: number;
  requiredOppositeDepth: number;
  batchSignature?: string;
};

export type FetchCoordinatorResult<T> = {
  status: 'applied' | 'ignored' | 'cancelled';
  epochId: number;
  results: Array<{ target: FetchTarget; data: T; cached: boolean }>;
};

export type FetchCoordinator<T> = {
  getEpochId: () => number;
  bumpEpoch: () => number;
  cancelTransaction: (transactionId: string) => void;
  dispatch: (params: {
    targets: FetchTarget[];
    fetcher: (target: FetchTarget) => Promise<T>;
    transactionId?: string;
  }) => Promise<FetchCoordinatorResult<T>>;
  peekCache: (target: FetchTarget) => T | undefined;
  primeCache: (target: FetchTarget, data: T) => void;
};

export const buildFetchTargetKey = (target: FetchTarget) =>
  JSON.stringify([
    target.axis,
    target.pathKey,
    target.childDepth,
    target.requiredOppositeDepth,
    target.batchSignature ?? '',
  ]);

export const createFetchCoordinator = <T>({
  maxCacheEntries = 200,
}: {
  maxCacheEntries?: number;
} = {}): FetchCoordinator<T> => {
  let epochId = 0;
  const inFlight = new Map<string, Promise<T>>();
  const cache = new Map<string, T>();
  const cancelledTransactions = new Set<string>();

  const touchCache = (key: string, value: T) => {
    if (cache.has(key)) {
      cache.delete(key);
    }
    cache.set(key, value);
    if (cache.size > maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
  };

  const readCache = (key: string) => {
    if (!cache.has(key)) {
      return undefined;
    }
    const cached = cache.get(key) as T;
    touchCache(key, cached);
    return cached;
  };

  const peekCache = (target: FetchTarget) =>
    readCache(buildFetchTargetKey(target));

  const primeCache = (target: FetchTarget, data: T) =>
    touchCache(buildFetchTargetKey(target), data);

  const bumpEpoch = () => {
    epochId += 1;
    inFlight.clear();
    cache.clear();
    cancelledTransactions.clear();
    return epochId;
  };

  const cancelTransaction = (transactionId: string) => {
    cancelledTransactions.add(transactionId);
  };

  const dispatch = async ({
    targets,
    fetcher,
    transactionId,
  }: {
    targets: FetchTarget[];
    fetcher: (target: FetchTarget) => Promise<T>;
    transactionId?: string;
  }): Promise<FetchCoordinatorResult<T>> => {
    const requestEpoch = epochId;
    if (transactionId && cancelledTransactions.has(transactionId)) {
      return { status: 'cancelled', epochId: requestEpoch, results: [] };
    }

    const uniqueTargets = new Map<string, FetchTarget>();
    targets.forEach(target => {
      uniqueTargets.set(buildFetchTargetKey(target), target);
    });

    const tasks = Array.from(uniqueTargets.entries()).map(([key, target]) => {
      const cached = readCache(key);
      if (cached !== undefined) {
        return Promise.resolve({ target, data: cached, cached: true });
      }
      const existingPromise = inFlight.get(key);
      const fetchPromise =
        existingPromise ??
        fetcher(target).then(result => {
          if (requestEpoch === epochId) {
            touchCache(key, result);
          }
          return result;
        });
      if (!existingPromise) {
        inFlight.set(key, fetchPromise);
      }
      return fetchPromise
        .finally(() => {
          if (inFlight.get(key) === fetchPromise) {
            inFlight.delete(key);
          }
        })
        .then(result => ({ target, data: result, cached: false }));
    });

    const results = await Promise.all(tasks);
    if (requestEpoch !== epochId) {
      return { status: 'ignored', epochId: requestEpoch, results: [] };
    }
    if (transactionId && cancelledTransactions.has(transactionId)) {
      return { status: 'cancelled', epochId: requestEpoch, results: [] };
    }
    return { status: 'applied', epochId: requestEpoch, results };
  };

  return {
    getEpochId: () => epochId,
    bumpEpoch,
    cancelTransaction,
    dispatch,
    peekCache,
    primeCache,
  };
};
