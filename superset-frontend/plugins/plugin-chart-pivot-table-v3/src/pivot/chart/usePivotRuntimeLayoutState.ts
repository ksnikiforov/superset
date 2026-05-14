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
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  type DataRecordValue,
  type HandlerFunction,
  type JsonObject,
  type SetDataMaskHook,
} from '@superset-ui/core';
import { type PivotRuntimeLayout } from '../../types';
import { isSameRuntimeLayout } from '../runtime/coverage';
import {
  prepareRuntimeLayoutPropSync,
  prepareRuntimeStatePersistence,
} from '../runtime/seamlessRuntimeUpdate';
import { useSyncRef } from '../shared/useSyncRef';

type RuntimeSelection = Record<string, DataRecordValue[]>;

type UsePivotRuntimeLayoutStateConfig = {
  isUserControlled: boolean;
  isDashboardContext: boolean;
  isDashboardRuntimeSync: boolean;
  shouldPersistOwnState: boolean;
  runtimeLayout: PivotRuntimeLayout;
  selectedFiltersFromProps: RuntimeSelection;
  upstreamDashboardQueryContextSignature: string | null;
  pendingSeamlessLayoutRef: MutableRefObject<PivotRuntimeLayout | null>;
  mergeOwnState: (partial: JsonObject) => JsonObject;
  setControlValue?: HandlerFunction;
  setDataMask: SetDataMaskHook;
};

export const usePivotRuntimeLayoutState = ({
  isUserControlled,
  isDashboardContext,
  isDashboardRuntimeSync,
  shouldPersistOwnState,
  runtimeLayout,
  selectedFiltersFromProps,
  upstreamDashboardQueryContextSignature,
  pendingSeamlessLayoutRef,
  mergeOwnState,
  setControlValue,
  setDataMask,
}: UsePivotRuntimeLayoutStateConfig) => {
  const lastPersistedRuntimeLayoutRef = useRef(runtimeLayout);
  const persistedRuntimeLayoutSyncRef = useRef(false);
  const lastPersistedSelectionRef = useRef(selectedFiltersFromProps);
  const pendingPersistedSelectionSyncRef = useRef(false);
  const lastLocalSyncDashboardQueryContextRef = useRef<string | null>(null);

  const [committedRuntimeLayout, setCommittedRuntimeLayout] =
    useState<PivotRuntimeLayout>(runtimeLayout);
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
    (layout: PivotRuntimeLayout, filters: RuntimeSelection) => {
      const persistencePlan = prepareRuntimeStatePersistence({
        layout,
        selection: filters,
        isDashboardRuntimeSync,
        lastPersistedRuntimeLayout: lastPersistedRuntimeLayoutRef.current,
        lastPersistedSelection: lastPersistedSelectionRef.current,
        upstreamDashboardQueryContextSignature,
      });
      if (persistencePlan.persistedRuntimeLayout) {
        lastPersistedRuntimeLayoutRef.current =
          persistencePlan.persistedRuntimeLayout;
        persistedRuntimeLayoutSyncRef.current = true;
      }
      if (persistencePlan.localSyncDashboardQueryContext !== undefined) {
        lastLocalSyncDashboardQueryContextRef.current =
          persistencePlan.localSyncDashboardQueryContext;
      }
      if (persistencePlan.persistedSelection) {
        lastPersistedSelectionRef.current = persistencePlan.persistedSelection;
        pendingPersistedSelectionSyncRef.current = true;
      }
      commitRuntimeLayout(layout);
      if (setControlValue) {
        setControlValue('pivotRuntimeLayout', layout);
        setControlValue('pivotSelectedFilters', filters);
      }
      if (shouldPersistOwnState) {
        const nextOwnState = mergeOwnState(persistencePlan.ownStatePatch);
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
    const propSync = prepareRuntimeLayoutPropSync({
      isUserControlled,
      isDashboardContext,
      isDashboardRuntimeSync,
      pendingPersistedRuntimeLayoutSync: persistedRuntimeLayoutSyncRef.current,
      hasPendingSeamlessLayout: pendingSeamlessLayoutRef.current !== null,
      runtimeLayout,
      lastPersistedRuntimeLayout: lastPersistedRuntimeLayoutRef.current,
    });
    if (propSync.shouldSyncCommittedRuntimeLayout) {
      commitRuntimeLayout(runtimeLayout);
    }
    if (propSync.hasPersistedRuntimeLayoutSyncSettled) {
      persistedRuntimeLayoutSyncRef.current = false;
    }
    if (propSync.shouldSyncUiRuntimeLayout) {
      updateUiRuntimeLayout(runtimeLayout);
    }
  }, [
    commitRuntimeLayout,
    isDashboardContext,
    isDashboardRuntimeSync,
    isUserControlled,
    lastPersistedRuntimeLayoutRef,
    pendingSeamlessLayoutRef,
    persistedRuntimeLayoutSyncRef,
    runtimeLayout,
    updateUiRuntimeLayout,
  ]);

  return {
    committedRuntimeLayout,
    committedRuntimeLayoutRef,
    uiRuntimeLayout,
    uiRuntimeLayoutRef,
    updateUiRuntimeLayout,
    commitRuntimeLayout,
    lastPersistedSelectionRef,
    pendingPersistedSelectionSyncRef,
    lastLocalSyncDashboardQueryContextRef,
    persistRuntimeState,
  };
};
