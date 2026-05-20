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
  finish: (token: LatestRequestToken) => void;
  isCurrent: () => boolean;
};

export type LatestRequestLifecycle = {
  beginScope: () => LatestRequestScope;
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

  const finishToken = (token: LatestRequestToken) => {
    const activeIds = activeRequestGroupIds.get(token.requestGroupId);
    if (!activeIds) {
      return;
    }
    activeIds.delete(token.id);
    if (activeIds.size === 0) {
      activeRequestGroupIds.delete(token.requestGroupId);
    }
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
    finish: finishToken,
    isCurrent: () => requestId === currentRequestId,
  });

  const beginScope = () => {
    currentRequestId += 1;
    cancelActiveRequestGroups();
    return createScope(currentRequestId);
  };

  return {
    beginScope,
    finish: finishToken,
    invalidate() {
      currentRequestId += 1;
      cancelActiveRequestGroups();
      return currentRequestId;
    },
  };
};

export type MainThreadYield = () => Promise<void>;

export const yieldToMainThread = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });
