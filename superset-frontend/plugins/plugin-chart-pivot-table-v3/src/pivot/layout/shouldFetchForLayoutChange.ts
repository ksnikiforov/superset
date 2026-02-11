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
import { PivotRuntimeLayout } from '../../types';
import { stableStringify } from '../shared/stableStringify';

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, idx) => value === b[idx]);

const sortedUnique = (keys: string[]) => Array.from(new Set(keys)).sort();

const hasSameSet = (a: string[], b: string[]) =>
  arraysEqual(sortedUnique(a), sortedUnique(b));

const selectionSignature = (selection: PivotRuntimeLayout['leafSelection']) =>
  stableStringify(selection ?? {});

const valuePlacementSignature = (
  placement: PivotRuntimeLayout['valuePlacement'],
) => stableStringify(placement ?? {});

const valueAxisKeys = (layout: PivotRuntimeLayout): string[] =>
  layout.valuePlacement.axis === 'row' ? layout.rows : layout.cols;

export const shouldFetchForLayoutChange = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
): boolean => {
  // Switching Values axis fundamentally changes metric-tier orientation.
  if (prev.valuePlacement.axis !== next.valuePlacement.axis) {
    return true;
  }

  // Dimension axis edits are rendered optimistically; data is fetched when users
  // change the leading key on the active Values axis (top-level path changes).
  if (
    !arraysEqual(prev.rows, next.rows) ||
    !arraysEqual(prev.cols, next.cols)
  ) {
    const prevValueAxis = valueAxisKeys(prev);
    const nextValueAxis = valueAxisKeys(next);
    if (arraysEqual(prevValueAxis, nextValueAxis)) {
      return false;
    }
    return prevValueAxis[0] !== nextValueAxis[0];
  }
  if (!hasSameSet(prev.metrics, next.metrics)) {
    return true;
  }
  if (
    selectionSignature(prev.leafSelection) !==
    selectionSignature(next.leafSelection)
  ) {
    return true;
  }
  if (
    valuePlacementSignature(prev.valuePlacement) !==
    valuePlacementSignature(next.valuePlacement)
  ) {
    return false;
  }
  return false;
};
