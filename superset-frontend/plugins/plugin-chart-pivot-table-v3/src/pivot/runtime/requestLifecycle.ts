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

export type LatestRequestToken = {
  id: number;
  requestGroupId: string;
  isCurrent: () => boolean;
};

export type LatestRequestScope = {
  id: number;
  beginRequest: (requestGroupId: string) => LatestRequestToken;
  isCurrent: () => boolean;
};

export type LatestRequestLifecycle = {
  begin: (requestGroupId: string) => LatestRequestToken;
  beginScope: () => LatestRequestScope;
  currentId: () => number;
  currentScope: () => LatestRequestScope;
  finish: (token: LatestRequestToken) => void;
  invalidate: () => number;
};

export type LatestRequestLifecycleOptions = {
  cancel?: (requestGroupId: string) => void;
};

export const isAbortError = (error: unknown): boolean => {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
};

export const createLatestRequestLifecycle = ({
  cancel,
}: LatestRequestLifecycleOptions = {}): LatestRequestLifecycle => {
  let currentRequestId = 0;
  const activeRequestGroupIds = new Map<string, Set<number>>();

  const cancelRequestGroup = (requestGroupId: string) => {
    cancel?.(requestGroupId);
  };

  const cancelActiveRequestGroups = () => {
    activeRequestGroupIds.forEach((_ids, requestGroupId) => {
      cancelRequestGroup(requestGroupId);
    });
    activeRequestGroupIds.clear();
  };

  const activateRequestGroup = ({
    requestGroupId,
    requestId,
  }: {
    requestGroupId: string;
    requestId: number;
  }) => {
    const ids = activeRequestGroupIds.get(requestGroupId) ?? new Set<number>();
    ids.add(requestId);
    activeRequestGroupIds.set(requestGroupId, ids);
  };

  const createScope = (requestId: number): LatestRequestScope => ({
    id: requestId,
    beginRequest(requestGroupId: string) {
      if (activeRequestGroupIds.has(requestGroupId)) {
        cancelRequestGroup(requestGroupId);
        activeRequestGroupIds.delete(requestGroupId);
      }
      activateRequestGroup({ requestGroupId, requestId });
      return {
        id: requestId,
        requestGroupId,
        isCurrent: () => requestId === currentRequestId,
      };
    },
    isCurrent: () => requestId === currentRequestId,
  });

  const beginScope = () => {
    currentRequestId += 1;
    cancelActiveRequestGroups();
    return createScope(currentRequestId);
  };

  return {
    begin(requestGroupId: string) {
      return beginScope().beginRequest(requestGroupId);
    },
    beginScope,
    currentId() {
      return currentRequestId;
    },
    currentScope() {
      return createScope(currentRequestId);
    },
    finish(token: LatestRequestToken) {
      const activeIds = activeRequestGroupIds.get(token.requestGroupId);
      if (!activeIds) {
        return;
      }
      activeIds.delete(token.id);
      if (activeIds.size === 0) {
        activeRequestGroupIds.delete(token.requestGroupId);
      }
    },
    invalidate() {
      currentRequestId += 1;
      cancelActiveRequestGroups();
      return currentRequestId;
    },
  };
};

export type ExecuteLatestRequestResult<T> =
  | {
      status: 'success';
      token: LatestRequestToken;
      value: T;
    }
  | {
      status: 'stale';
      token: LatestRequestToken;
    }
  | {
      error: unknown;
      status: 'aborted' | 'error';
      token: LatestRequestToken;
    };

export type ExecuteLatestRequestParams<T> = {
  lifecycle: LatestRequestLifecycle;
  requestGroupId: string;
  run: (token: LatestRequestToken) => Promise<T>;
  onStart?: (token: LatestRequestToken) => void;
  onSuccess?: (value: T, token: LatestRequestToken) => void;
  onError?: (error: unknown, token: LatestRequestToken) => void;
  onSettled?: (token: LatestRequestToken) => void;
};

export const executeLatestRequest = async <T>({
  lifecycle,
  requestGroupId,
  run,
  onStart,
  onSuccess,
  onError,
  onSettled,
}: ExecuteLatestRequestParams<T>): Promise<ExecuteLatestRequestResult<T>> => {
  const token = lifecycle.begin(requestGroupId);
  onStart?.(token);

  try {
    const value = await run(token);
    if (!token.isCurrent()) {
      return { status: 'stale', token };
    }
    onSuccess?.(value, token);
    return { status: 'success', token, value };
  } catch (error) {
    if (!token.isCurrent()) {
      return { status: 'stale', token };
    }
    if (isAbortError(error)) {
      return { error, status: 'aborted', token };
    }
    onError?.(error, token);
    return { error, status: 'error', token };
  } finally {
    lifecycle.finish(token);
    if (token.isCurrent()) {
      onSettled?.(token);
    }
  }
};
