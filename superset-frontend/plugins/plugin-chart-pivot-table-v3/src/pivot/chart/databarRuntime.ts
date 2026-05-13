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
import { type DataRecordValue } from '@superset-ui/core';
import {
  type PivotMetricDatabarMap,
  type PivotResultCell,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../types';
import { getFormattingMetricKey, serializeCellKey } from '../../utils';
import { type VisibleCellEntry } from '../cellUtils';

export type DatabarScaleBounds = {
  boundedMin: number;
  boundedMax: number;
  span: number;
  zeroPct: number;
};

export type DatabarScale = {
  min: number;
  max: number;
};

export type WaterfallOffset = {
  start: number;
  end: number;
  scaleKey: string;
  connectAbove: boolean;
  connectBelow: boolean;
  connectAboveValue?: number;
  connectBelowValue?: number;
};

export type DatabarLabelSpace = {
  positive: number;
  negative: number;
};

export type WaterfallBridgeOffset = {
  value: number;
  depth: number;
  scaleKey: string;
};

export type DatabarRuntimeModel = {
  databarScales: Map<string, DatabarScale>;
  waterfallOffsets: Map<string, WaterfallOffset>;
  waterfallScales: Map<string, DatabarScale>;
  databarLabelSpaces: Map<string, DatabarLabelSpace>;
  databarColumnMinWidths: Map<string, number>;
  waterfallBridgeOffsets: Map<string, WaterfallBridgeOffset[]>;
};

export type BuildDatabarRuntimeModelParams = {
  metricDatabars: PivotMetricDatabarMap;
  metricsForScale: Set<string>;
  visibleCells: VisibleCellEntry[];
  visibleRows: PivotTreeNode[];
  visibleCols: PivotTreeNode[];
  cells: PivotTreeData['cells'];
  expandedRows: Set<string>;
  isRowTotalAtStart: boolean;
  databarScaleWidth: number;
  databarPaddingX: number;
  themeSizeUnit: number;
  deriveMetricKey: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => string;
  getNodeDimDepth: (node: PivotTreeNode) => number;
  isExplicitSubtotalNode: (node: PivotTreeNode) => boolean;
  isMetricGrandTotalNode: (node: PivotTreeNode) => boolean;
  isMetricSubtotalNode: (node: PivotTreeNode) => boolean;
  shouldHideRowValues: (rowNode: PivotTreeNode) => boolean;
  resolveMetricD3Format: (
    metricKey: string,
    cell: PivotResultCell,
    currentValue: DataRecordValue | undefined,
  ) => string | undefined;
  renderValue: (
    metricKey: string,
    value: DataRecordValue,
    d3FormatOverride?: string,
  ) => unknown;
};

export const getNumericValue = (value: DataRecordValue | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const resolveScaleBounds = (scale: DatabarScale): DatabarScaleBounds => {
  const min = Number.isFinite(scale.min) ? scale.min : 0;
  const max = Number.isFinite(scale.max) ? scale.max : 0;
  const boundedMin = Math.min(min, 0);
  const boundedMax = Math.max(max, 0);
  const span = boundedMax - boundedMin || 1;
  const zeroPct = (0 - boundedMin) / span;
  return {
    boundedMin,
    boundedMax,
    span,
    zeroPct,
  };
};

export const toPercent = (value: number, scale: DatabarScale) => {
  const { boundedMin, boundedMax, span } = resolveScaleBounds(scale);
  const clamped = clampValue(value, boundedMin, boundedMax);
  return (clamped - boundedMin) / span;
};

export const resolveScaleGroupKey = (
  metricKey: string,
  databarMap: PivotMetricDatabarMap,
) => {
  let current = metricKey;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const config = databarMap[current];
    if (!config?.scaleLike) {
      break;
    }
    const next = getFormattingMetricKey(config.scaleLike);
    if (!next || next === current) {
      break;
    }
    current = next;
  }
  return current;
};

const emptyDatabarRuntimeModel = (): DatabarRuntimeModel => {
  const emptyScaleMap = new Map<string, DatabarScale>();
  return {
    databarScales: emptyScaleMap,
    waterfallOffsets: new Map<string, WaterfallOffset>(),
    waterfallScales: emptyScaleMap,
    databarLabelSpaces: new Map<string, DatabarLabelSpace>(),
    databarColumnMinWidths: new Map<string, number>(),
    waterfallBridgeOffsets: new Map<string, WaterfallBridgeOffset[]>(),
  };
};

export const buildDatabarRuntimeModel = ({
  metricDatabars,
  metricsForScale,
  visibleCells,
  visibleRows,
  visibleCols,
  cells,
  expandedRows,
  isRowTotalAtStart,
  databarScaleWidth,
  databarPaddingX,
  themeSizeUnit,
  deriveMetricKey,
  getNodeDimDepth,
  isExplicitSubtotalNode,
  isMetricGrandTotalNode,
  isMetricSubtotalNode,
  shouldHideRowValues,
  resolveMetricD3Format,
  renderValue,
}: BuildDatabarRuntimeModelParams): DatabarRuntimeModel => {
  if (metricsForScale.size === 0) {
    return emptyDatabarRuntimeModel();
  }

  const scaleMap = new Map<string, DatabarScale>();
  visibleCells.forEach(({ rowNode, colNode, cell }) => {
    const metricKey = deriveMetricKey(rowNode, colNode);
    if (!metricsForScale.has(metricKey)) {
      return;
    }
    const value = getNumericValue(cell.values[metricKey]);
    if (value === undefined) {
      return;
    }
    const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
    const current = scaleMap.get(scaleKey);
    if (!current) {
      scaleMap.set(scaleKey, { min: value, max: value });
    } else {
      current.min = Math.min(current.min, value);
      current.max = Math.max(current.max, value);
    }
  });

  const offsets = new Map<string, WaterfallOffset>();
  const cumulative = new Map<string, number>();
  const prevKeys = new Map<string, string>();
  visibleRows.forEach(rowNode => {
    const isGrandTotalRow =
      rowNode.path.length === 0 || isMetricGrandTotalNode(rowNode);
    const shouldReset = isExplicitSubtotalNode(rowNode) && !isGrandTotalRow;
    const isExpandedGroup =
      rowNode.hasChildren && expandedRows.has(rowNode.key);
    if (shouldReset) {
      cumulative.clear();
      prevKeys.clear();
    }
    visibleCols.forEach(colNode => {
      const cellKey = serializeCellKey(rowNode.key, colNode.key);
      const metricKey = deriveMetricKey(rowNode, colNode);
      if (!metricKey) {
        return;
      }
      const config = metricDatabars[metricKey];
      if (!config || config.type !== 'waterfall') {
        return;
      }
      const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
      const cell = cells[cellKey];
      const value = getNumericValue(cell?.values[metricKey]);
      const deltaValue = value ?? 0;
      const cumulativeKey = serializeCellKey(colNode.key, metricKey);
      const prevEndValue = cumulative.get(cumulativeKey) ?? 0;
      const start = shouldReset || isGrandTotalRow ? 0 : prevEndValue;
      const isTotalRow =
        isGrandTotalRow ||
        isExplicitSubtotalNode(rowNode) ||
        isMetricSubtotalNode(rowNode);
      const delta = isTotalRow || !isRowTotalAtStart ? deltaValue : -deltaValue;
      const end = start + delta;
      const prevKey = prevKeys.get(cumulativeKey);
      const connectAbove = !shouldReset && !!prevKey;
      offsets.set(cellKey, {
        start,
        end,
        scaleKey,
        connectAbove,
        connectBelow: false,
        connectAboveValue: connectAbove ? prevEndValue : undefined,
        connectBelowValue: end,
      });
      if (connectAbove && prevKey) {
        const prevOffset = offsets.get(prevKey);
        if (prevOffset) {
          offsets.set(prevKey, { ...prevOffset, connectBelow: true });
        }
      }
      const shouldHoldCumulative =
        isExpandedGroup && !(isGrandTotalRow && isRowTotalAtStart);
      const nextCumulative = shouldReset
        ? 0
        : shouldHoldCumulative
          ? start
          : end;
      cumulative.set(cumulativeKey, nextCumulative);
      if (!shouldReset) {
        prevKeys.set(cumulativeKey, cellKey);
      }
    });
  });

  const waterfallScaleMap =
    offsets.size === 0 ? scaleMap : new Map<string, DatabarScale>();
  if (offsets.size > 0) {
    offsets.forEach(({ start, end, scaleKey }) => {
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      const current = waterfallScaleMap.get(scaleKey);
      if (!current) {
        waterfallScaleMap.set(scaleKey, { min, max });
      } else {
        current.min = Math.min(current.min, min);
        current.max = Math.max(current.max, max);
      }
    });
  }

  const labelOffset = themeSizeUnit;
  const labelPadding = themeSizeUnit * 0.5;
  const labelCharWidth = themeSizeUnit * 1.6;
  const spaceMap = new Map<string, DatabarLabelSpace>();
  visibleCells.forEach(({ rowNode, colNode, cell }) => {
    if (shouldHideRowValues(rowNode)) {
      return;
    }
    const metricKey = deriveMetricKey(rowNode, colNode);
    const config = metricDatabars[metricKey];
    if (!config?.type) {
      return;
    }
    const rawValue = cell.values[metricKey];
    const value = getNumericValue(rawValue);
    if (value === undefined) {
      return;
    }
    const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
    const scale =
      config.type === 'waterfall'
        ? waterfallScaleMap.get(scaleKey)
        : scaleMap.get(scaleKey);
    if (!scale) {
      return;
    }
    const d3FormatOverride = resolveMetricD3Format(metricKey, cell, rawValue);
    const formatted = renderValue(metricKey, rawValue, d3FormatOverride);
    const labelText =
      formatted === null || formatted === undefined
        ? ''
        : String(formatted).replace(/<[^>]*>/g, '');
    const labelWidth =
      labelText.length * labelCharWidth + labelOffset + labelPadding * 2;
    const existing = spaceMap.get(scaleKey) ?? { positive: 0, negative: 0 };
    if (value >= 0) {
      existing.positive = Math.max(existing.positive, labelWidth);
    } else {
      existing.negative = Math.max(existing.negative, labelWidth);
    }
    spaceMap.set(scaleKey, existing);
  });

  const widthMap = new Map<string, number>();
  visibleCells.forEach(({ cell, colNode, rowNode }) => {
    const metricKey = deriveMetricKey(rowNode, colNode);
    const config = metricDatabars[metricKey];
    if (!config?.type) {
      return;
    }
    const scaleKey = resolveScaleGroupKey(metricKey, metricDatabars);
    const labelSpace = spaceMap.get(scaleKey);
    const minWidth =
      (labelSpace?.positive ?? 0) +
      (labelSpace?.negative ?? 0) +
      databarScaleWidth +
      databarPaddingX * 2;
    const current = widthMap.get(cell.colKey) ?? 0;
    if (minWidth > current) {
      widthMap.set(cell.colKey, minWidth);
    }
  });

  const bridgeMap = new Map<string, WaterfallBridgeOffset[]>();
  if (offsets.size > 0) {
    visibleCols.forEach(colNode => {
      const lastExpandedTotals = new Map<
        number,
        { index: number; value: number; scaleKey: string }
      >();
      visibleRows.forEach((rowNode, rowIndex) => {
        const cellKey = serializeCellKey(rowNode.key, colNode.key);
        const offset = offsets.get(cellKey);
        if (!offset) {
          return;
        }
        const depth = getNodeDimDepth(rowNode);
        const previous = lastExpandedTotals.get(depth);
        if (previous && rowIndex - previous.index > 1) {
          for (let idx = previous.index; idx <= rowIndex; idx += 1) {
            const betweenRow = visibleRows[idx];
            const betweenKey = serializeCellKey(betweenRow.key, colNode.key);
            const betweenOffset = offsets.get(betweenKey);
            const betweenScaleKey =
              betweenOffset?.scaleKey ?? previous.scaleKey;
            if (betweenOffset && betweenScaleKey !== previous.scaleKey) {
              continue;
            }
            const entry = {
              value: previous.value,
              depth,
              scaleKey: betweenScaleKey,
            };
            const existing = bridgeMap.get(betweenKey);
            if (existing) {
              const alreadySet = existing.some(
                item =>
                  item.value === entry.value && item.depth === entry.depth,
              );
              if (!alreadySet) {
                existing.push(entry);
              }
            } else {
              bridgeMap.set(betweenKey, [entry]);
            }
          }
        }
        if (rowNode.hasChildren && expandedRows.has(rowNode.key)) {
          lastExpandedTotals.set(depth, {
            index: rowIndex,
            value: offset.end,
            scaleKey: offset.scaleKey,
          });
        } else if (previous) {
          lastExpandedTotals.delete(depth);
        }
      });
    });
  }

  return {
    databarScales: scaleMap,
    waterfallOffsets: offsets,
    waterfallScales: waterfallScaleMap,
    databarLabelSpaces: spaceMap,
    databarColumnMinWidths: widthMap,
    waterfallBridgeOffsets: bridgeMap,
  };
};
