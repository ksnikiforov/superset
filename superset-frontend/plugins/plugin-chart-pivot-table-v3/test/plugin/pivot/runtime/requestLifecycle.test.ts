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
  createLatestRequestLifecycle,
  executeLatestRequest,
  executeScheduledLatestRequest,
  isAbortError,
} from '../../../../src/pivot/runtime/requestLifecycle';

describe('requestLifecycle', () => {
  it('starts monotonically increasing requests and cancels active groups', () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });

    const first = lifecycle.begin('pivot-v3-seamless');
    const second = lifecycle.begin('pivot-v3-seamless');

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenNthCalledWith(1, 'pivot-v3-seamless');
  });

  it('tracks multiple request groups in one current scope', () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });
    const scope = lifecycle.beginScope();

    const first = scope.beginRequest('branch:a');
    const second = scope.beginRequest('batch:b');

    expect(first.id).toBe(1);
    expect(second.id).toBe(1);
    expect(first.isCurrent()).toBe(true);
    expect(second.isCurrent()).toBe(true);

    lifecycle.invalidate();

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith('branch:a');
    expect(cancel).toHaveBeenCalledWith('batch:b');
  });

  it('commits only the latest successful request', async () => {
    const lifecycle = createLatestRequestLifecycle();
    const onSuccess = jest.fn();
    const onSettled = jest.fn();
    let resolveFirst: ((value: string) => void) | undefined;
    const firstPromise = new Promise<string>(resolve => {
      resolveFirst = resolve;
    });

    const first = executeLatestRequest({
      lifecycle,
      requestGroupId: 'pivot-v3-seamless',
      run: () => firstPromise,
      onSuccess,
      onSettled,
    });
    const second = executeLatestRequest({
      lifecycle,
      requestGroupId: 'pivot-v3-seamless',
      run: async () => 'second',
      onSuccess,
      onSettled,
    });

    await expect(second).resolves.toMatchObject({ status: 'success' });
    resolveFirst?.('first');
    await expect(first).resolves.toMatchObject({ status: 'stale' });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      'second',
      expect.objectContaining({ id: 2 }),
    );
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('does not let stale completion unregister a newer reused request group', async () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });
    let resolveFirst: ((value: string) => void) | undefined;
    const firstPromise = new Promise<string>(resolve => {
      resolveFirst = resolve;
    });

    const first = executeLatestRequest({
      lifecycle,
      requestGroupId: 'pivot-v3-seamless',
      run: () => firstPromise,
    });
    const second = executeLatestRequest({
      lifecycle,
      requestGroupId: 'pivot-v3-seamless',
      run: () => new Promise(() => undefined),
    });

    resolveFirst?.('first');
    await expect(first).resolves.toMatchObject({ status: 'stale' });

    lifecycle.invalidate();

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenNthCalledWith(1, 'pivot-v3-seamless');
    expect(cancel).toHaveBeenNthCalledWith(2, 'pivot-v3-seamless');
    expect(second).toBeInstanceOf(Promise);
  });

  it('treats current aborts as settled requests without calling error handlers', async () => {
    const lifecycle = createLatestRequestLifecycle();
    const onError = jest.fn();
    const onSettled = jest.fn();
    const abortError = { name: 'AbortError' };

    await expect(
      executeLatestRequest({
        lifecycle,
        requestGroupId: 'pivot-v3-seamless',
        run: async () => {
          throw abortError;
        },
        onError,
        onSettled,
      }),
    ).resolves.toMatchObject({ error: abortError, status: 'aborted' });

    expect(isAbortError(abortError)).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('defers scheduled work until the scheduler yields', async () => {
    const lifecycle = createLatestRequestLifecycle();
    const run = jest.fn(() => 'done');
    const onSuccess = jest.fn();
    let releaseYield: (() => void) | undefined;
    const yieldToMain = jest.fn(
      () =>
        new Promise<void>(resolve => {
          releaseYield = resolve;
        }),
    );

    const request = executeScheduledLatestRequest({
      lifecycle,
      requestGroupId: 'pivot-v3-materialize',
      run,
      onSuccess,
      yieldBeforeSuccess: false,
      yieldToMain,
    });

    expect(yieldToMain).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    releaseYield?.();
    await expect(request).resolves.toMatchObject({ status: 'success' });

    expect(run).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      'done',
      expect.objectContaining({ id: 1 }),
    );
  });

  it('skips scheduled work when the token becomes stale before execution', async () => {
    const lifecycle = createLatestRequestLifecycle();
    const run = jest.fn(() => 'stale-result');
    let releaseYield: (() => void) | undefined;
    const yieldToMain = jest.fn(
      () =>
        new Promise<void>(resolve => {
          releaseYield = resolve;
        }),
    );

    const request = executeScheduledLatestRequest({
      lifecycle,
      requestGroupId: 'pivot-v3-materialize',
      run,
      yieldBeforeSuccess: false,
      yieldToMain,
    });

    lifecycle.invalidate();
    releaseYield?.();

    await expect(request).resolves.toMatchObject({ status: 'stale' });
    expect(run).not.toHaveBeenCalled();
  });

  it('drops scheduled results when the token becomes stale before success', async () => {
    const lifecycle = createLatestRequestLifecycle();
    const run = jest.fn(() => 'late-result');
    const onSuccess = jest.fn();
    const releaseYields: Array<() => void> = [];
    const yieldToMain = jest.fn(
      () =>
        new Promise<void>(resolve => {
          releaseYields.push(resolve);
        }),
    );

    const request = executeScheduledLatestRequest({
      lifecycle,
      requestGroupId: 'pivot-v3-materialize',
      run,
      onSuccess,
      yieldToMain,
    });

    releaseYields[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);
    expect(yieldToMain).toHaveBeenCalledTimes(2);

    lifecycle.invalidate();
    releaseYields[1]?.();

    await expect(request).resolves.toMatchObject({ status: 'stale' });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
