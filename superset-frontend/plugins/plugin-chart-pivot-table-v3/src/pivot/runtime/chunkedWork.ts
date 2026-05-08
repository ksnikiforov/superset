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

export type RuntimeYield = () => Promise<void>;

export type ChunkedWorkOptions = {
  chunkSize?: number;
  shouldContinue?: () => boolean;
  yieldToMain?: RuntimeYield;
};

export const DEFAULT_RUNTIME_CHUNK_SIZE = 1000;

export class StaleChunkedWorkError extends Error {
  constructor() {
    super('Chunked runtime work is stale');
    this.name = 'StaleChunkedWorkError';
  }
}

export const assertChunkedWorkCurrent = (shouldContinue?: () => boolean) => {
  if (shouldContinue && !shouldContinue()) {
    throw new StaleChunkedWorkError();
  }
};

export const yieldChunkedWork = async ({
  shouldContinue,
  yieldToMain,
}: ChunkedWorkOptions): Promise<void> => {
  assertChunkedWorkCurrent(shouldContinue);
  if (yieldToMain) {
    await yieldToMain();
  }
  assertChunkedWorkCurrent(shouldContinue);
};

export const maybeYieldChunkedWork = async ({
  processed,
  chunkSize = DEFAULT_RUNTIME_CHUNK_SIZE,
  shouldContinue,
  yieldToMain,
}: ChunkedWorkOptions & { processed: number }): Promise<void> => {
  assertChunkedWorkCurrent(shouldContinue);
  if (processed > 0 && processed % chunkSize === 0) {
    await yieldChunkedWork({ shouldContinue, yieldToMain });
  }
};
