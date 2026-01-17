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

import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { PivotAxis, PivotTreeData, PivotTreeNode } from '../types';

export type FetchExpandedBranchesResult = {
  didLoadData: boolean;
  hasMissingNodes: boolean;
  hasPendingTargets: boolean;
};

export type FetchExpandedBranches = (
  axis: PivotAxis,
  expanded: Set<string>,
  nodes: Record<string, PivotTreeNode>,
) => Promise<FetchExpandedBranchesResult>;

export const usePivotHydration = ({
  expandedRows,
  expandedCols,
  expandedRowsRef,
  expandedColsRef,
  prefetchRowsRef,
  prefetchColsRef,
  prefetchFromPersistenceRef,
  shouldAutoFetchRef,
  treeRef,
  fetchExpandedBranches,
  groupbyRowsLength,
  groupbyColumnsLength,
  onError,
  onFinish,
}: {
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  expandedRowsRef: MutableRefObject<Set<string>>;
  expandedColsRef: MutableRefObject<Set<string>>;
  prefetchRowsRef: MutableRefObject<string[]>;
  prefetchColsRef: MutableRefObject<string[]>;
  prefetchFromPersistenceRef: MutableRefObject<boolean>;
  shouldAutoFetchRef: MutableRefObject<boolean>;
  treeRef: MutableRefObject<PivotTreeData>;
  fetchExpandedBranches: FetchExpandedBranches;
  groupbyRowsLength: number;
  groupbyColumnsLength: number;
  onError: (message: string) => void;
  onFinish: () => void;
}) => {
  const [isHydrating, setIsHydrating] = useState(false);
  const onErrorRef = useRef(onError);
  const onFinishRef = useRef(onFinish);
  const fetchExpandedBranchesRef = useRef(fetchExpandedBranches);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    fetchExpandedBranchesRef.current = fetchExpandedBranches;
  }, [fetchExpandedBranches]);

  useEffect(() => {
    if (!shouldAutoFetchRef.current && !prefetchFromPersistenceRef.current) {
      return undefined;
    }
    let cancelled = false;
    setIsHydrating(true);

    const maxIterations = Math.max(groupbyRowsLength, groupbyColumnsLength) + 4;

    const runIteration = async (iteration: number): Promise<void> => {
      if (cancelled) {
        return;
      }
      if (iteration >= maxIterations) {
        return;
      }
      const shouldHydrateFromPersistence = prefetchFromPersistenceRef.current;
      const prefetchRows = prefetchRowsRef.current;
      const prefetchCols = prefetchColsRef.current;
      const currentExpandedRows = shouldHydrateFromPersistence
        ? new Set([...expandedRowsRef.current, ...prefetchRows])
        : expandedRowsRef.current;
      const currentExpandedCols = shouldHydrateFromPersistence
        ? new Set([...expandedColsRef.current, ...prefetchCols])
        : expandedColsRef.current;
      const [rowResult, colResult] = await Promise.all([
        fetchExpandedBranchesRef.current(
          'row',
          currentExpandedRows,
          treeRef.current.rows,
        ),
        fetchExpandedBranchesRef.current(
          'col',
          currentExpandedCols,
          treeRef.current.cols,
        ),
      ]);
      if (cancelled) {
        return;
      }
      if (shouldHydrateFromPersistence) {
        if (!rowResult.hasPendingTargets && !colResult.hasPendingTargets) {
          return;
        }
      } else {
        const didLoadData = rowResult.didLoadData || colResult.didLoadData;
        if (!didLoadData) {
          return;
        }
      }
      await runIteration(iteration + 1);
    };

    const run = () => runIteration(0);

    run()
      .then(() => {
        if (cancelled) {
          return;
        }
        onFinishRef.current();
        setIsHydrating(false);
      })
      .catch(error => {
        if (cancelled) {
          return;
        }
        onErrorRef.current(
          error instanceof Error ? error.message : String(error),
        );
        onFinishRef.current();
        setIsHydrating(false);
      });

    return () => {
      cancelled = true;
      setIsHydrating(false);
    };
  }, [
    expandedRows,
    expandedCols,
    groupbyColumnsLength,
    groupbyRowsLength,
    prefetchColsRef,
    prefetchFromPersistenceRef,
    prefetchRowsRef,
    shouldAutoFetchRef,
    treeRef,
    expandedColsRef,
    expandedRowsRef,
  ]);

  return { isHydrating };
};
