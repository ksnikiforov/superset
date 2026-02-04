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
import { PivotAxis, PivotRuntimeLayout } from '../../types';

export const INTERACTION_DIMENSION_DND_TYPE = 'pivot-v3-interaction-dimension';
export const INTERACTION_VALUE_DND_TYPE = 'pivot-v3-interaction-value';

type AxisListKey = 'rows' | 'cols';

const clampIndex = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getAxisKey = (axis: PivotAxis): AxisListKey =>
  axis === 'row' ? 'rows' : 'cols';

const resolveValueIndex = (
  layout: PivotRuntimeLayout,
  axis: PivotAxis,
  dimCount: number,
  metricsAvailable: boolean,
) =>
  metricsAvailable && layout.valuePlacement.axis === axis
    ? clampIndex(layout.valuePlacement.index, 0, dimCount)
    : undefined;

type RemoveResult = {
  layout: PivotRuntimeLayout;
  removedAxis?: PivotAxis;
  removedIndex?: number;
};

const removeDimension = (
  layout: PivotRuntimeLayout,
  dimensionKey: string,
): RemoveResult => {
  const rowIndex = layout.rows.indexOf(dimensionKey);
  const colIndex = layout.cols.indexOf(dimensionKey);
  const nextRows = layout.rows.filter(key => key !== dimensionKey);
  const nextCols = layout.cols.filter(key => key !== dimensionKey);
  const nextValuePlacement = { ...layout.valuePlacement };
  if (rowIndex >= 0 && nextValuePlacement.axis === 'row') {
    if (rowIndex < nextValuePlacement.index) {
      nextValuePlacement.index = Math.max(0, nextValuePlacement.index - 1);
    }
  }
  if (colIndex >= 0 && nextValuePlacement.axis === 'col') {
    if (colIndex < nextValuePlacement.index) {
      nextValuePlacement.index = Math.max(0, nextValuePlacement.index - 1);
    }
  }
  const removedAxis: PivotAxis | undefined =
    rowIndex >= 0 ? 'row' : colIndex >= 0 ? 'col' : undefined;
  const removedIndex =
    removedAxis === 'row' ? rowIndex : removedAxis === 'col' ? colIndex : -1;
  return {
    layout: {
      ...layout,
      rows: nextRows,
      cols: nextCols,
      valuePlacement: nextValuePlacement,
    },
    removedAxis,
    removedIndex,
  };
};

const chipIndexToDimensionIndex = (chipIndex: number, valueIndex?: number) => {
  if (valueIndex === undefined) {
    return chipIndex;
  }
  return chipIndex > valueIndex ? chipIndex - 1 : chipIndex;
};

const defaultInsertIndex = (
  layout: PivotRuntimeLayout,
  axis: PivotAxis,
  metricsAvailable: boolean,
) => {
  const list = layout[getAxisKey(axis)];
  const valueIndex = resolveValueIndex(
    layout,
    axis,
    list.length,
    metricsAvailable,
  );
  if (valueIndex !== undefined && valueIndex < list.length) {
    return valueIndex;
  }
  return list.length;
};

export type DimensionDragOptions = {
  dimensionKey: string;
  targetAxis: PivotAxis;
  targetChipIndex?: number;
  insertBeforeValue?: boolean;
  sourceAxis?: PivotAxis;
  sourceChipIndex?: number;
  metricsAvailable: boolean;
};

export const applyDimensionDrag = (
  layout: PivotRuntimeLayout,
  options: DimensionDragOptions,
): PivotRuntimeLayout => {
  const {
    dimensionKey,
    targetAxis,
    targetChipIndex,
    insertBeforeValue = false,
    sourceAxis,
    sourceChipIndex,
    metricsAvailable,
  } = options;
  const hasExplicitTarget = targetChipIndex !== undefined;
  const removed = removeDimension(layout, dimensionKey);
  const cleaned = removed.layout;
  const axisKey = getAxisKey(targetAxis);
  const list = [...cleaned[axisKey]];
  const dimCount = list.length;

  let insertIndex = targetChipIndex;
  if (insertIndex === undefined) {
    insertIndex = defaultInsertIndex(cleaned, targetAxis, metricsAvailable);
  } else if (sourceAxis === targetAxis && typeof sourceChipIndex === 'number') {
    if (sourceChipIndex < insertIndex) {
      insertIndex -= 1;
    }
  }
  const valueIndex = resolveValueIndex(
    cleaned,
    targetAxis,
    dimCount,
    metricsAvailable,
  );
  const chipCount = dimCount + (valueIndex !== undefined ? 1 : 0);
  insertIndex = clampIndex(insertIndex, 0, chipCount);
  const dimInsertIndex = chipIndexToDimensionIndex(insertIndex, valueIndex);
  let shouldInsertBeforeValue = insertBeforeValue;
  if (
    !hasExplicitTarget &&
    valueIndex !== undefined &&
    dimInsertIndex === valueIndex &&
    valueIndex < dimCount
  ) {
    shouldInsertBeforeValue = true;
  }

  const nextValuePlacement = { ...cleaned.valuePlacement };
  if (
    valueIndex !== undefined &&
    (dimInsertIndex < valueIndex ||
      (shouldInsertBeforeValue && dimInsertIndex === valueIndex))
  ) {
    nextValuePlacement.index = valueIndex + 1;
  }
  list.splice(dimInsertIndex, 0, dimensionKey);

  return {
    ...cleaned,
    [axisKey]: list,
    valuePlacement: nextValuePlacement,
    lastMoved: targetAxis,
  };
};

export type ValueDragOptions = {
  targetAxis: PivotAxis;
  targetChipIndex?: number;
  sourceAxis: PivotAxis;
  sourceChipIndex?: number;
  metricsAvailable: boolean;
};

export const applyValueDrag = (
  layout: PivotRuntimeLayout,
  options: ValueDragOptions,
): PivotRuntimeLayout => {
  const {
    targetAxis,
    targetChipIndex,
    sourceAxis,
    sourceChipIndex,
    metricsAvailable,
  } = options;
  if (!metricsAvailable) {
    return layout;
  }
  const axisKey = getAxisKey(targetAxis);
  const dimCount = layout[axisKey].length;
  let insertIndex = targetChipIndex ?? dimCount;
  if (sourceAxis === targetAxis && typeof sourceChipIndex === 'number') {
    if (sourceChipIndex < insertIndex) {
      insertIndex -= 1;
    }
  }
  insertIndex = clampIndex(insertIndex, 0, dimCount);
  return {
    ...layout,
    valuePlacement: { axis: targetAxis, index: insertIndex },
    lastMoved: targetAxis,
  };
};
