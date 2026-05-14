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
import { DataRecordValue, QueryFormMetric } from '@superset-ui/core';
import {
  MeasureLeafOffset,
  MeasureLeafOperator,
  MeasureLeafSpec,
  MeasureLeavesByMetricKey,
  MeasureHierarchy,
} from '../types';
import { getMetricKey } from './core/tokens';

export const MEASURE_CALC_PREFIX = '__calc__';

const OFFSET_UNIT_LABELS: Record<MeasureLeafOffset['unit'], string> = {
  year: 'Y',
  month: 'M',
  week: 'W',
  day: 'D',
};

const OFFSET_DIRECTION_LABELS: Record<MeasureLeafOffset['direction'], string> =
  {
    past: 'A',
    future: 'L',
  };

export const formatOffsetLabel = (offset: MeasureLeafOffset): string =>
  `${offset.n}${OFFSET_UNIT_LABELS[offset.unit]}${OFFSET_DIRECTION_LABELS[offset.direction]}`;

export const formatTimeOffset = (offset: MeasureLeafOffset): string =>
  `${offset.n} ${offset.unit} ${offset.direction === 'past' ? 'ago' : 'later'}`;

export const buildMeasureLeafId = ({
  operator,
  offset,
  label,
}: {
  operator?: MeasureLeafOperator;
  offset?: MeasureLeafOffset;
  label?: string;
}): string => {
  if (operator === 'value') {
    return 'value';
  }
  if (operator) {
    if (!offset) {
      return operator;
    }
    return `${operator}:${offset.n}:${offset.unit}:${offset.direction}`;
  }
  if (label) {
    return `custom:${label}`;
  }
  return 'custom';
};

export const buildMeasureLeafLabel = (
  operator: MeasureLeafOperator,
  offset?: MeasureLeafOffset,
): string => {
  if (operator === 'value') {
    return 'Value';
  }
  const offsetLabel = offset ? formatOffsetLabel(offset) : '';
  if (operator === 'offset_value') {
    return offsetLabel || 'Value';
  }
  if (operator === 'ix') {
    return `IX ${offsetLabel}`.trim();
  }
  if (operator === 'delta') {
    return `∆ ${offsetLabel}`.trim();
  }
  if (operator === 'delta_pct') {
    return `∆% ${offsetLabel}`.trim();
  }
  return offsetLabel;
};

export const buildValueLeaf = (): MeasureLeafSpec => ({
  kind: 'builtIn',
  operator: 'value',
  id: buildMeasureLeafId({ operator: 'value' }),
  label: buildMeasureLeafLabel('value'),
});

export const isValueLeaf = (leaf: MeasureLeafSpec): boolean =>
  leaf.kind === 'builtIn' && leaf.operator === 'value';

export const sortMeasureLeaves = (
  leaves: MeasureLeafSpec[],
): MeasureLeafSpec[] => {
  const valueLeaf = leaves.find(isValueLeaf) ?? buildValueLeaf();
  const nonValueLeaves = leaves.filter(leaf => !isValueLeaf(leaf));
  return [valueLeaf, ...nonValueLeaves];
};

export const buildBuiltInLeaf = (
  operator: MeasureLeafOperator,
  offset?: MeasureLeafOffset,
): MeasureLeafSpec => ({
  kind: 'builtIn',
  operator,
  offset,
  id: buildMeasureLeafId({ operator, offset }),
  label: buildMeasureLeafLabel(operator, offset),
});

export const buildCustomLeaf = ({
  label,
  metric,
  offset,
}: {
  label: string;
  metric: QueryFormMetric;
  offset?: MeasureLeafOffset;
}): MeasureLeafSpec => ({
  kind: 'custom',
  id: buildMeasureLeafId({ label }),
  label,
  metric,
  ...(offset ? { offset } : {}),
});

export const buildMeasureLeafOutputKey = (
  metricKey: string,
  leaf: MeasureLeafSpec,
): string => {
  if (isValueLeaf(leaf)) {
    return metricKey;
  }
  return `${MEASURE_CALC_PREFIX}${leaf.id}__${metricKey}`;
};

export const resolveMeasureSortMetricKey = ({
  metricKey,
  measureHierarchy,
}: {
  metricKey: string;
  measureHierarchy?: MeasureHierarchy;
}): string => {
  if (measureHierarchy?.kind !== 'measureStackV1') {
    return metricKey;
  }
  const group = measureHierarchy.groups.find(
    candidate => candidate.metricKey === metricKey,
  );
  if (!group || group.leaves.length === 0) {
    return metricKey;
  }
  const preferredLeaf = group.leaves.find(isValueLeaf) ?? group.leaves[0];
  return buildMeasureLeafOutputKey(metricKey, preferredLeaf);
};

export const buildOffsetMetricKey = (
  metricKey: string,
  offset: MeasureLeafOffset,
): string => `${metricKey}__${formatTimeOffset(offset)}`;

export const getRequiredOffsetsForLeaves = (
  leaves: MeasureLeafSpec[],
): MeasureLeafOffset[] =>
  leaves.flatMap(leaf =>
    leaf.kind === 'custom'
      ? leaf.offset
        ? [leaf.offset]
        : []
      : leaf.operator === 'value'
        ? []
        : leaf.offset
          ? [leaf.offset]
          : [],
  );

export const collectRequiredTimeOffsets = (
  measureHierarchy:
    | { kind: 'flatMetrics'; metricKeys: string[] }
    | {
        kind: 'measureStackV1';
        groups: Array<{ metricKey: string; leaves: MeasureLeafSpec[] }>;
      },
): string[] => {
  if (measureHierarchy.kind !== 'measureStackV1') {
    return [];
  }
  const offsets = new Set<string>();
  measureHierarchy.groups.forEach(group => {
    getRequiredOffsetsForLeaves(group.leaves).forEach(offset => {
      offsets.add(formatTimeOffset(offset));
    });
  });
  return Array.from(offsets);
};

export const coerceMeasureLeavesByMetric = (
  metrics: string[],
  existing?: MeasureLeavesByMetricKey,
): MeasureLeavesByMetricKey => {
  const next: MeasureLeavesByMetricKey = {};
  metrics.forEach(metricKey => {
    const existingLeaves = existing?.[metricKey] ?? [];
    const resolvedLeaves =
      existingLeaves.length > 0 ? existingLeaves : [buildValueLeaf()];
    next[metricKey] = resolvedLeaves;
  });
  return next;
};

const resolveOffsetValue = (
  values: Record<string, DataRecordValue>,
  metricKey: string,
  offset?: MeasureLeafOffset,
): DataRecordValue | undefined => {
  if (!offset) {
    return undefined;
  }
  return values[buildOffsetMetricKey(metricKey, offset)];
};

export const computeMeasureLeafValue = ({
  values,
  metricKey,
  leaf,
}: {
  values: Record<string, DataRecordValue>;
  metricKey: string;
  leaf: MeasureLeafSpec;
}): DataRecordValue | undefined => {
  const baseValue = values[metricKey];
  if (leaf.kind === 'custom') {
    const customMetricKey = getMetricKey(leaf.metric);
    if (!customMetricKey) {
      return undefined;
    }
    if (leaf.offset) {
      return resolveOffsetValue(values, customMetricKey, leaf.offset);
    }
    return values[customMetricKey];
  }
  if (leaf.operator === 'value') {
    return baseValue;
  }
  const offsetValue = resolveOffsetValue(values, metricKey, leaf.offset);
  const baseMissing = baseValue === undefined || baseValue === null;
  const offsetMissing = offsetValue === undefined || offsetValue === null;
  if (offsetMissing || baseMissing) {
    if (leaf.operator === 'offset_value') {
      return offsetValue;
    }
    return undefined;
  }
  if (leaf.operator === 'offset_value') {
    return offsetValue;
  }
  const baseNumber = Number(baseValue);
  const offsetNumber = Number(offsetValue);
  if (!Number.isFinite(baseNumber) || !Number.isFinite(offsetNumber)) {
    return undefined;
  }
  if (leaf.operator === 'delta') {
    return baseNumber - offsetNumber;
  }
  if (leaf.operator === 'delta_pct') {
    if (offsetNumber === 0) {
      return undefined;
    }
    return (baseNumber - offsetNumber) / offsetNumber;
  }
  if (leaf.operator === 'ix') {
    if (offsetNumber === 0) {
      return undefined;
    }
    return (baseNumber / offsetNumber) * 100;
  }
  return undefined;
};
