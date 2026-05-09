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
import { type PivotTreeData } from '../../types';
import { getStablePrefixLength, isSameLayout } from './engine';

export type PivotLayoutKeyState = {
  rows: string[];
  cols: string[];
};

type ResolveLayoutTransitionInput = {
  data: PivotTreeData;
  currentTree: PivotTreeData;
  previousLayout: PivotLayoutKeyState;
  currentLayout: PivotLayoutKeyState;
  sessionLayout?: Partial<PivotLayoutKeyState>;
  hasNewData: boolean;
  effectiveExpandRowsLevel: number;
  effectiveExpandColsLevel: number;
};

export const isPrefix = (prefix: string[], target: string[]) =>
  prefix.length <= target.length &&
  prefix.every((value, idx) => value === target[idx]);

export const resolveLayoutTransition = ({
  data,
  currentTree,
  previousLayout,
  currentLayout,
  sessionLayout,
  hasNewData,
  effectiveExpandRowsLevel,
  effectiveExpandColsLevel,
}: ResolveLayoutTransitionInput) => {
  const rowsChanged = !isSameLayout(previousLayout.rows, currentLayout.rows);
  const colsChanged = !isSameLayout(previousLayout.cols, currentLayout.cols);
  const shouldExpandRows =
    currentLayout.rows.length > previousLayout.rows.length &&
    isPrefix(previousLayout.rows, currentLayout.rows);
  const shouldExpandCols =
    currentLayout.cols.length > previousLayout.cols.length &&
    isPrefix(previousLayout.cols, currentLayout.cols);
  const layoutChanged = rowsChanged || colsChanged;
  const sourceTree = hasNewData || !layoutChanged ? data : currentTree;
  const layoutChangedWithoutNewData = layoutChanged && !hasNewData;
  const layoutRowsForPrune = rowsChanged
    ? previousLayout.rows
    : (sessionLayout?.rows ?? previousLayout.rows);
  const layoutColsForPrune = colsChanged
    ? previousLayout.cols
    : (sessionLayout?.cols ?? previousLayout.cols);
  const rowStablePrefix = getStablePrefixLength(
    layoutRowsForPrune,
    currentLayout.rows,
  );
  const colStablePrefix = getStablePrefixLength(
    layoutColsForPrune,
    currentLayout.cols,
  );
  const autoExpandRowsLevelForDesired =
    layoutChangedWithoutNewData && rowsChanged && rowStablePrefix > 0
      ? Math.min(effectiveExpandRowsLevel, Math.max(rowStablePrefix - 1, 0))
      : effectiveExpandRowsLevel;
  const autoExpandColsLevelForDesired =
    layoutChangedWithoutNewData && colsChanged && colStablePrefix > 0
      ? Math.min(effectiveExpandColsLevel, Math.max(colStablePrefix - 1, 0))
      : effectiveExpandColsLevel;
  return {
    rowsChanged,
    colsChanged,
    shouldExpandRows,
    shouldExpandCols,
    layoutChanged,
    normalizedTree: sourceTree,
    rowStablePrefix,
    colStablePrefix,
    autoExpandRowsLevelForDesired,
    autoExpandColsLevelForDesired,
  };
};
