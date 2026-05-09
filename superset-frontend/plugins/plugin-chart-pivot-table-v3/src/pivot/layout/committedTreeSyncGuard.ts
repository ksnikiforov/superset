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
import { type PivotRuntimeLayout } from '../../types';
import { type PivotFactStoreBatch } from '../runtime/factStore';

export const factBatchesCoverRuntimeLayout = (
  factBatches: PivotFactStoreBatch[],
  runtimeLayout: PivotRuntimeLayout,
) => {
  const requiredRowDepth = runtimeLayout.rows.length > 0 ? 1 : 0;
  const requiredColumnDepth = runtimeLayout.cols.length > 0 ? 1 : 0;
  return (
    runtimeLayout.metrics.length === 0 ||
    (requiredRowDepth === 0 && requiredColumnDepth === 0) ||
    factBatches.some(
      ({ coverage, scope }) =>
        (scope.kind === 'bootstrap' || scope.kind === 'root') &&
        coverage.rowDepth === requiredRowDepth &&
        coverage.columnDepth === requiredColumnDepth,
    )
  );
};

type ShouldSyncCommittedTreeFromPropsConfig = {
  isUserControlled: boolean;
  isDashboardContext: boolean;
  hasLocalSyncForCurrentDashboardQueryContext: boolean;
  hasPersistedInteractionFilters: boolean;
  runtimeLayoutMatchesCommitted: boolean;
  selectedFiltersMatchCommitted: boolean;
};

export const shouldSyncCommittedTreeFromProps = ({
  isUserControlled,
  isDashboardContext,
  hasLocalSyncForCurrentDashboardQueryContext,
  hasPersistedInteractionFilters,
  runtimeLayoutMatchesCommitted,
  selectedFiltersMatchCommitted,
}: ShouldSyncCommittedTreeFromPropsConfig) => {
  if (!isUserControlled) {
    return true;
  }
  if (isDashboardContext && hasLocalSyncForCurrentDashboardQueryContext) {
    return false;
  }
  if (hasPersistedInteractionFilters) {
    return false;
  }
  if (!runtimeLayoutMatchesCommitted) {
    return false;
  }
  if (!selectedFiltersMatchCommitted) {
    return false;
  }
  return true;
};
