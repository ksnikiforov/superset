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
import { type PivotRuntimeLayout } from '../../types';
import { isSameRuntimeLayout } from '../runtime/coverage';
import { prepareRuntimeLayoutPropSync } from '../runtime/seamlessRuntimeUpdate';
import { useSyncRef } from '../shared/useSyncRef';

type UsePivotRuntimeLayoutStateConfig = {
  isUserControlled: boolean;
  isDashboardContext: boolean;
  isDashboardRuntimeSync: boolean;
  runtimeLayout: PivotRuntimeLayout;
  pendingPersistedRuntimeLayoutSyncRef: MutableRefObject<boolean>;
  pendingSeamlessLayoutRef: MutableRefObject<PivotRuntimeLayout | null>;
  lastPersistedRuntimeLayoutRef: MutableRefObject<PivotRuntimeLayout>;
};

export const usePivotRuntimeLayoutState = ({
  isUserControlled,
  isDashboardContext,
  isDashboardRuntimeSync,
  runtimeLayout,
  pendingPersistedRuntimeLayoutSyncRef,
  pendingSeamlessLayoutRef,
  lastPersistedRuntimeLayoutRef,
}: UsePivotRuntimeLayoutStateConfig) => {
  const persistedRuntimeLayoutSyncRef = pendingPersistedRuntimeLayoutSyncRef;
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
  };
};
