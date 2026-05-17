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
import { createExpansionRequestHelpers } from '../../../src/pivot/expansion/fetchExecution';
import { createLatestRequestLifecycle } from '../../../src/pivot/runtime/requestLifecycle';

describe('createExpansionRequestHelpers', () => {
  it('builds stable expansion request group ids from the active transaction', () => {
    const lifecycle = createLatestRequestLifecycle();
    lifecycle.beginScope();
    const helpers = createExpansionRequestHelpers({
      lifecycle,
      instanceId: 'pivot-instance',
    });

    expect(
      helpers.buildRequestGroupId({
        kind: 'branch',
        axis: 'row',
      }),
    ).toBe(
      '{"axis":"row","instanceId":"pivot-instance","kind":"branch","transactionId":1}',
    );
  });

  it('finishes scoped requests after success', async () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });
    const helpers = createExpansionRequestHelpers({
      lifecycle,
      instanceId: 'pivot-instance',
    });
    const scope = lifecycle.beginScope();

    await expect(
      helpers.trackRequestInScope(scope, 'branch:a', async () => 'ok'),
    ).resolves.toBe('ok');
    scope.beginRequest('branch:a');

    expect(cancel).not.toHaveBeenCalled();
  });

  it('finishes scoped requests after errors', async () => {
    const cancel = jest.fn();
    const lifecycle = createLatestRequestLifecycle({ cancel });
    const helpers = createExpansionRequestHelpers({
      lifecycle,
      instanceId: 'pivot-instance',
    });
    const scope = lifecycle.beginScope();

    await expect(
      helpers.trackRequestInScope(scope, 'branch:a', async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    scope.beginRequest('branch:a');

    expect(cancel).not.toHaveBeenCalled();
  });
});
