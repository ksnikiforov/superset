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
  isAbortError,
} from '../../../../src/pivot/runtime/requestLifecycle';

describe('requestLifecycle', () => {
  it('starts monotonically increasing requests and cancels active groups', () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });

    const first = lifecycle.beginScope();
    first.beginRequest('pivot-v3-seamless');
    const second = lifecycle.beginScope();
    second.beginRequest('pivot-v3-seamless');

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

    scope.beginRequest('branch:a');
    scope.beginRequest('batch:b');

    expect(scope.id).toBe(1);
    expect(scope.isCurrent()).toBe(true);

    lifecycle.invalidate();

    expect(scope.isCurrent()).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith('branch:a');
    expect(cancel).toHaveBeenCalledWith('batch:b');
  });

  it('finishes scoped requests without cancelling completed groups later', () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });
    const scope = lifecycle.beginScope();
    scope.beginRequest('branch:a');

    scope.finish('branch:a');
    scope.beginRequest('branch:a');

    expect(cancel).not.toHaveBeenCalled();
  });

  it('marks previous scopes stale when a newer scope starts', () => {
    const lifecycle = createLatestRequestLifecycle();

    const firstScope = lifecycle.beginScope();
    firstScope.beginRequest('pivot-v3-seamless');
    const secondScope = lifecycle.beginScope();
    secondScope.beginRequest('pivot-v3-seamless');

    expect(firstScope.isCurrent()).toBe(false);
    expect(secondScope.isCurrent()).toBe(true);
  });

  it('does not let stale completion unregister a newer reused request group', () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });
    const firstScope = lifecycle.beginScope();
    firstScope.beginRequest('pivot-v3-seamless');
    const secondScope = lifecycle.beginScope();
    secondScope.beginRequest('pivot-v3-seamless');

    firstScope.finish('pivot-v3-seamless');
    lifecycle.invalidate();

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenNthCalledWith(1, 'pivot-v3-seamless');
    expect(cancel).toHaveBeenNthCalledWith(2, 'pivot-v3-seamless');
  });

  it('detects abort errors', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('network failed'))).toBe(false);
  });
});
