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
import { useEffect, useMemo, useRef } from 'react';
import { nanoid } from 'nanoid';
import { createLatestRequestLifecycle } from '../runtime/requestLifecycle';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { createExpansionRequestHelpers } from './fetchExecution';

export const useExpansionRequestRuntime = ({
  fetchCoverageSignature,
  resetFetchedCoverage,
}: {
  fetchCoverageSignature: string;
  resetFetchedCoverage: () => void;
}) => {
  const requestGroupPrefixRef = useRef(nanoid());
  const fetchCoverageSignatureRef = useRef(fetchCoverageSignature);
  const expansionRequestLifecycle = useMemo(
    () =>
      createLatestRequestLifecycle({
        cancel: requestGroupId =>
          supersetChartDataClient.cancel(requestGroupId),
      }),
    [],
  );

  if (fetchCoverageSignatureRef.current !== fetchCoverageSignature) {
    expansionRequestLifecycle.invalidate();
    resetFetchedCoverage();
    fetchCoverageSignatureRef.current = fetchCoverageSignature;
  }

  const expansionRequestHelpers = useMemo(
    () =>
      createExpansionRequestHelpers({
        lifecycle: expansionRequestLifecycle,
        instanceId: requestGroupPrefixRef.current,
      }),
    [expansionRequestLifecycle],
  );

  useEffect(
    () => () => {
      expansionRequestLifecycle.invalidate();
    },
    [expansionRequestLifecycle],
  );

  return {
    expansionRequestLifecycle,
    expansionRequestHelpers,
  };
};
