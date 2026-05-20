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

export type LatestRequestScope = {
  id: number;
  beginRequest: (requestGroupId: string) => void;
  finish: (requestGroupId: string) => void;
  isCurrent: () => boolean;
};

export type LatestRequestLifecycle = {
  beginScope: (options?: {
    cancelActive?: boolean;
    latestOnly?: boolean;
  }) => LatestRequestScope;
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
  let invalidationEpoch = 0;
  const activeRequestGroupIds = new Map<string, number>();

  const cancelRequestGroup = (requestGroupId: string) => {
    cancel?.(requestGroupId);
  };

  const cancelActiveRequestGroups = () => {
    activeRequestGroupIds.forEach((_requestId, requestGroupId) => {
      cancelRequestGroup(requestGroupId);
    });
    activeRequestGroupIds.clear();
  };

  const finishRequestGroup = (requestId: number, requestGroupId: string) => {
    if (activeRequestGroupIds.get(requestGroupId) === requestId) {
      activeRequestGroupIds.delete(requestGroupId);
    }
  };

  const createScope = (
    requestId: number,
    scopeInvalidationEpoch: number,
    latestOnly: boolean,
  ): LatestRequestScope => ({
    id: requestId,
    beginRequest(requestGroupId: string) {
      if (activeRequestGroupIds.has(requestGroupId)) {
        cancelRequestGroup(requestGroupId);
      }
      activeRequestGroupIds.set(requestGroupId, requestId);
    },
    finish(requestGroupId: string) {
      finishRequestGroup(requestId, requestGroupId);
    },
    isCurrent: () =>
      scopeInvalidationEpoch === invalidationEpoch &&
      (!latestOnly || requestId === currentRequestId),
  });

  const beginScope = ({
    cancelActive = true,
    latestOnly = true,
  }: {
    cancelActive?: boolean;
    latestOnly?: boolean;
  } = {}) => {
    currentRequestId += 1;
    if (cancelActive) {
      cancelActiveRequestGroups();
    }
    return createScope(currentRequestId, invalidationEpoch, latestOnly);
  };

  return {
    beginScope,
    invalidate() {
      currentRequestId += 1;
      invalidationEpoch += 1;
      cancelActiveRequestGroups();
      return currentRequestId;
    },
  };
};

export type MainThreadYield = () => Promise<void>;

export const yieldToMainThread = (): Promise<void> =>
  process.env.NODE_ENV === 'test'
    ? Promise.resolve()
    : new Promise(resolve => {
        setTimeout(resolve, 0);
      });
