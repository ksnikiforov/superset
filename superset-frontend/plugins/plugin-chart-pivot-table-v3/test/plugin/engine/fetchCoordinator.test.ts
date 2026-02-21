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
  createFetchCoordinator,
  FetchTarget,
} from '../../../src/pivot/engine/fetchCoordinator';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
};

const makeTarget = (pathKey: string): FetchTarget => ({
  axis: 'row',
  pathKey,
  childDepth: 1,
  requiredOppositeDepth: 1,
});

describe('fetchCoordinator', () => {
  it('dedupes in-flight requests across dispatch calls', async () => {
    const coordinator = createFetchCoordinator<string>();
    const deferred = createDeferred<string>();
    const fetcher = jest.fn(() => deferred.promise);
    const target = makeTarget('A');

    const pendingA = coordinator.dispatch({
      targets: [target],
      fetcher,
      transactionId: 'txn-a',
    });
    const pendingB = coordinator.dispatch({
      targets: [target],
      fetcher,
      transactionId: 'txn-b',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);

    deferred.resolve('payload');
    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);

    expect(resultA.status).toBe('applied');
    expect(resultB.status).toBe('applied');
    expect(resultA.results).toHaveLength(1);
    expect(resultB.results).toHaveLength(1);
  });

  it('serves cached results without refetching', async () => {
    const coordinator = createFetchCoordinator<string>();
    const fetcher = jest.fn(async () => 'payload');
    const target = makeTarget('A');

    const first = await coordinator.dispatch({ targets: [target], fetcher });
    const second = await coordinator.dispatch({ targets: [target], fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');
    expect(second.results[0].cached).toBe(true);
  });

  it('ignores results after an epoch bump', async () => {
    const coordinator = createFetchCoordinator<string>();
    const deferred = createDeferred<string>();
    const fetcher = jest.fn(() => deferred.promise);
    const target = makeTarget('A');

    const pending = coordinator.dispatch({ targets: [target], fetcher });
    coordinator.bumpEpoch();

    deferred.resolve('payload');
    const result = await pending;

    expect(result.status).toBe('ignored');
    expect(result.results).toHaveLength(0);
    expect(coordinator.peekCache(target)).toBeUndefined();
  });

  it('starts all fetches in parallel', async () => {
    const coordinator = createFetchCoordinator<string>();
    const deferredA = createDeferred<string>();
    const deferredB = createDeferred<string>();
    const fetcher = jest
      .fn()
      .mockImplementationOnce(() => deferredA.promise)
      .mockImplementationOnce(() => deferredB.promise);

    const pending = coordinator.dispatch({
      targets: [makeTarget('A'), makeTarget('B')],
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);

    deferredA.resolve('first');
    deferredB.resolve('second');
    const result = await pending;

    expect(result.status).toBe('applied');
    expect(result.results).toHaveLength(2);
  });

  it('cancels in-flight transactions and ignores results', async () => {
    const coordinator = createFetchCoordinator<string>();
    const deferred = createDeferred<string>();
    const fetcher = jest.fn(() => deferred.promise);
    const target = makeTarget('A');

    const pending = coordinator.dispatch({
      targets: [target],
      fetcher,
      transactionId: 'txn-cancel',
    });
    coordinator.cancelTransaction('txn-cancel');

    deferred.resolve('payload');
    const result = await pending;

    expect(result.status).toBe('cancelled');
    expect(result.results).toHaveLength(0);
  });

  it('skips dispatch when the transaction is already cancelled', async () => {
    const coordinator = createFetchCoordinator<string>();
    const fetcher = jest.fn(async () => 'payload');
    const target = makeTarget('A');

    coordinator.cancelTransaction('txn-cancel');
    const result = await coordinator.dispatch({
      targets: [target],
      fetcher,
      transactionId: 'txn-cancel',
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    expect(result.results).toHaveLength(0);
  });
});
