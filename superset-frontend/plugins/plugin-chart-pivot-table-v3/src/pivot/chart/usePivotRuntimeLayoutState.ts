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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { isEqual } from 'lodash';
import {
  type DataRecordValue,
  type HandlerFunction,
  type JsonObject,
  type QueryFormColumn,
  type SetDataMaskHook,
} from '@superset-ui/core';
import { type PivotRuntimeLayout } from '../../types';
import { buildRuntimeSelectionSyncState, hasSelectedFilters } from '../filters';
import { isSameRuntimeLayout } from '../runtime/seamlessRuntimeUpdate';
import { useSyncRef } from '../shared/useSyncRef';

type RuntimeSelection = Record<string, DataRecordValue[]>;

type UsePivotRuntimeLayoutStateConfig = {
  isDashboardContext: boolean;
  runtimeLayout: PivotRuntimeLayout;
  committedRuntimeLayout?: PivotRuntimeLayout;
  dimensions: QueryFormColumn[];
  selectedFiltersFromFormData: RuntimeSelection;
  selectedFiltersFromOwnState: RuntimeSelection;
  selectedFiltersFromProps: RuntimeSelection;
  upstreamDashboardQueryContextSignature: string | null;
  suppressStalePersistedFilterRestoreRef: MutableRefObject<boolean>;
  mergeOwnState: (partial: JsonObject) => JsonObject;
  setControlValue?: HandlerFunction;
  setDataMask: SetDataMaskHook;
};

export const usePivotRuntimeLayoutState = ({
  isDashboardContext,
  runtimeLayout,
  committedRuntimeLayout: committedRuntimeLayoutProp,
  dimensions,
  selectedFiltersFromFormData,
  selectedFiltersFromOwnState,
  selectedFiltersFromProps,
  upstreamDashboardQueryContextSignature,
  suppressStalePersistedFilterRestoreRef,
  mergeOwnState,
  setControlValue,
  setDataMask,
}: UsePivotRuntimeLayoutStateConfig) => {
  const isDashboardRuntimeSync = isDashboardContext;
  const shouldPersistOwnState = !isDashboardRuntimeSync;
  const committedRuntimeLayoutInput =
    committedRuntimeLayoutProp ?? runtimeLayout;
  const lastPersistedRuntimeLayoutRef = useRef(runtimeLayout);
  const persistedRuntimeLayoutSyncRef = useRef(false);
  const lastPersistedSelectionRef = useRef(selectedFiltersFromProps);
  const pendingPersistedSelectionSyncRef = useRef(false);
  const lastLocalSyncDashboardQueryContextRef = useRef<string | null>(null);
  const [committedFilters, setCommittedFilters] = useState<RuntimeSelection>(
    selectedFiltersFromProps,
  );
  const [uiSelectedFilters, setUiSelectedFilters] = useState<RuntimeSelection>(
    selectedFiltersFromProps,
  );

  const {
    selectedFiltersForTreeSync,
    persistedInteractionFilters,
    persistedSelectedFilters,
  } = useMemo(
    () =>
      buildRuntimeSelectionSyncState({
        dimensions,
        selectedFiltersFromFormData,
        selectedFiltersFromOwnState,
        selectedFiltersFromProps,
        committedFilters,
      }),
    [
      committedFilters,
      dimensions,
      selectedFiltersFromFormData,
      selectedFiltersFromOwnState,
      selectedFiltersFromProps,
    ],
  );

  const [committedRuntimeLayout, setCommittedRuntimeLayout] =
    useState<PivotRuntimeLayout>(committedRuntimeLayoutInput);
  const committedRuntimeLayoutRef = useRef(committedRuntimeLayout);
  useSyncRef(committedRuntimeLayoutRef, committedRuntimeLayout);

  const [uiRuntimeLayout, setUiRuntimeLayout] =
    useState<PivotRuntimeLayout>(runtimeLayout);
  const uiRuntimeLayoutRef = useRef(runtimeLayout);
  const updateUiRuntimeLayout = useCallback((layout: PivotRuntimeLayout) => {
    uiRuntimeLayoutRef.current = layout;
    setUiRuntimeLayout(layout);
  }, []);

  const commitRuntimeLayout = useCallback((layout: PivotRuntimeLayout) => {
    committedRuntimeLayoutRef.current = layout;
    setCommittedRuntimeLayout(current =>
      isSameRuntimeLayout(current, layout) ? current : layout,
    );
  }, []);

  const persistRuntimeState = useCallback(
    (
      layout: PivotRuntimeLayout,
      filters: RuntimeSelection,
      options: { commit?: boolean } = {},
    ) => {
      if (
        isDashboardRuntimeSync &&
        !isSameRuntimeLayout(lastPersistedRuntimeLayoutRef.current, layout)
      ) {
        lastPersistedRuntimeLayoutRef.current = layout;
        persistedRuntimeLayoutSyncRef.current = true;
      }
      if (isDashboardRuntimeSync) {
        lastLocalSyncDashboardQueryContextRef.current =
          upstreamDashboardQueryContextSignature;
      }
      if (!isEqual(lastPersistedSelectionRef.current, filters)) {
        lastPersistedSelectionRef.current = filters;
        pendingPersistedSelectionSyncRef.current = true;
      }
      if (options.commit !== false) {
        commitRuntimeLayout(layout);
      }
      if (setControlValue) {
        setControlValue('pivotRuntimeLayout', layout);
        setControlValue('pivotSelectedFilters', filters);
      }
      if (shouldPersistOwnState) {
        const nextOwnState = mergeOwnState({
          pivotRuntimeLayout: layout,
          pivotSelectedFilters: filters,
        });
        setDataMask({ ownState: { ...nextOwnState } });
      }
    },
    [
      commitRuntimeLayout,
      isDashboardRuntimeSync,
      mergeOwnState,
      setControlValue,
      setDataMask,
      shouldPersistOwnState,
      upstreamDashboardQueryContextSignature,
    ],
  );

  useEffect(() => {
    const hasPendingRuntimeLayout = !isSameRuntimeLayout(
      uiRuntimeLayoutRef.current,
      committedRuntimeLayoutRef.current,
    );
    const shouldSyncLayout =
      !(isDashboardRuntimeSync && persistedRuntimeLayoutSyncRef.current) &&
      !hasPendingRuntimeLayout;
    if (shouldSyncLayout) {
      commitRuntimeLayout(runtimeLayout);
    }
    if (
      isDashboardRuntimeSync &&
      persistedRuntimeLayoutSyncRef.current &&
      isSameRuntimeLayout(runtimeLayout, lastPersistedRuntimeLayoutRef.current)
    ) {
      persistedRuntimeLayoutSyncRef.current = false;
    }
    if (shouldSyncLayout) {
      updateUiRuntimeLayout(runtimeLayout);
    }
  }, [
    commitRuntimeLayout,
    isDashboardRuntimeSync,
    lastPersistedRuntimeLayoutRef,
    persistedRuntimeLayoutSyncRef,
    runtimeLayout,
    updateUiRuntimeLayout,
  ]);

  useEffect(() => {
    if (
      pendingPersistedSelectionSyncRef.current &&
      isEqual(persistedSelectedFilters, lastPersistedSelectionRef.current)
    ) {
      pendingPersistedSelectionSyncRef.current = false;
    }
    if (
      !pendingPersistedSelectionSyncRef.current &&
      (!isEqual(persistedSelectedFilters, committedFilters) ||
        !isEqual(persistedSelectedFilters, uiSelectedFilters)) &&
      !hasSelectedFilters(uiSelectedFilters) &&
      !hasSelectedFilters(committedFilters) &&
      !(
        suppressStalePersistedFilterRestoreRef.current &&
        hasSelectedFilters(persistedSelectedFilters)
      )
    ) {
      setCommittedFilters(persistedSelectedFilters);
      setUiSelectedFilters(persistedSelectedFilters);
    }
  }, [
    committedFilters,
    persistedSelectedFilters,
    suppressStalePersistedFilterRestoreRef,
    uiSelectedFilters,
  ]);

  return {
    committedFilters,
    uiSelectedFilters,
    updateUiSelectedFilters: setUiSelectedFilters,
    commitFilters: setCommittedFilters,
    selectedFiltersForTreeSync,
    persistedInteractionFilters,
    committedRuntimeLayout,
    committedRuntimeLayoutRef,
    uiRuntimeLayout,
    uiRuntimeLayoutRef,
    updateUiRuntimeLayout,
    lastLocalSyncDashboardQueryContextRef,
    persistRuntimeState,
  };
};
