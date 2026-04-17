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

const shouldFetchForLeadingKeyChange = (
  prevAxisKeys: string[],
  nextAxisKeys: string[],
) => {
  const prevLeading = prevAxisKeys[0];
  const nextLeading = nextAxisKeys[0];
  if (prevLeading === nextLeading) {
    return false;
  }
  // Collapsing an axis to totals-only reuses existing aggregate rows/cols.
  if (prevLeading !== undefined && nextLeading === undefined) {
    return false;
  }
  return true;
};

const movedLeadingKeyAcrossAxes = ({
  prevSource,
  nextSource,
  nextTarget,
}: {
  prevSource: string[];
  nextSource: string[];
  nextTarget: string[];
}) => {
  const leading = prevSource[0];
  if (!leading) {
    return false;
  }
  if (nextSource.includes(leading)) {
    return false;
  }
  return nextTarget.includes(leading);
};

const canProjectFirstColumnDimensionWithoutFetch = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
) =>
  prev.valuePlacement.axis === 'col' &&
  prev.valuePlacement.index === 0 &&
  next.valuePlacement.index === 0 &&
  prev.cols.length === 0 &&
  next.cols.length > 0 &&
  prev.rows.length > 0 &&
  arraysEqual(prev.rows, next.rows);

export const shouldFetchForDimensionAxisChange = ({
  prevRows,
  prevCols,
  nextRows,
  nextCols,
}: {
  prevRows: string[];
  prevCols: string[];
  nextRows: string[];
  nextCols: string[];
}) => {
  if (shouldFetchForLeadingKeyChange(prevRows, nextRows)) {
    return true;
  }
  if (shouldFetchForLeadingKeyChange(prevCols, nextCols)) {
    return true;
  }
  if (
    movedLeadingKeyAcrossAxes({
      prevSource: prevRows,
      nextSource: nextRows,
      nextTarget: nextCols,
    })
  ) {
    return true;
  }
  if (
    movedLeadingKeyAcrossAxes({
      prevSource: prevCols,
      nextSource: nextCols,
      nextTarget: nextRows,
    })
  ) {
    return true;
  }
  return false;
};

export const shouldFetchForLayoutChange = (
  prev: PivotRuntimeLayout,
  next: PivotRuntimeLayout,
): boolean => {
  // Switching Values axis fundamentally changes metric-tier orientation.
  if (prev.valuePlacement.axis !== next.valuePlacement.axis) {
    return true;
  }

  // Dimension axis edits are rendered optimistically; data is fetched when users
  // change the leading key on either axis (top-level path changes). This keeps
  // first-on-stack transitions robust while avoiding unnecessary mid-stack loads.
  if (
    !arraysEqual(prev.rows, next.rows) ||
    !arraysEqual(prev.cols, next.cols)
  ) {
    if (canProjectFirstColumnDimensionWithoutFetch(prev, next)) {
      return false;
    }
    return shouldFetchForDimensionAxisChange({
      prevRows: prev.rows,
      prevCols: prev.cols,
      nextRows: next.rows,
      nextCols: next.cols,
    });
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
    const prevValueAxis =
      prev.valuePlacement.axis === 'row' ? prev.rows : prev.cols;
    const nextValueAxis =
      next.valuePlacement.axis === 'row' ? next.rows : next.cols;
    const indexChanged =
      prev.valuePlacement.index !== next.valuePlacement.index;
    if (
      indexChanged &&
      (prevValueAxis.length > 0 || nextValueAxis.length > 0)
    ) {
      return true;
    }
    return false;
  }
  return false;
};
