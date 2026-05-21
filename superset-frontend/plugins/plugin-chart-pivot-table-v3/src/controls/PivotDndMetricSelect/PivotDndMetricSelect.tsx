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
import { t, tn } from '@apache-superset/core/translation';
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDragLayer } from 'react-dnd';
import { nanoid } from 'nanoid';
import {
  ensureIsArray,
  getMetricLabel,
  isAdhocMetricSimple,
  isSavedMetric,
  Metric,
  QueryFormMetric,
} from '@superset-ui/core';
import { GenericDataType } from '@apache-superset/core/common';
import {
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
} from '@superset-ui/core/components';
import { isEqual } from 'lodash';
import { ColumnMeta } from '@superset-ui/chart-controls';
import {
  AdhocMetric,
  AdhocMetricPopoverTrigger,
  AGGREGATES,
  DatasourcePanelDndItem,
  type DndControlProps,
  DndItemType,
  isDatasourcePanelDndItem,
  type savedMetricType,
} from '../../exploreImports';
import PivotDndSelectLabel from '../PivotDndColumnSelect/PivotSelectLabel';
import PivotMetricDefinitionValue, {
  MetricFormatSelector,
} from './PivotMetricDefinitionValue';
import MeasureLeafValue from './MeasureLeafValue';
import {
  PivotMetricFormatting,
  PivotMetricFormattingMap,
  PivotMetricDatabar,
  PivotMetricDatabarMap,
  METRIC_FORMATTING_FIELDS,
  PivotMetricFormattingValue,
  MeasureLeafOffsetDirection,
  MeasureLeafOffsetUnit,
  MeasureLeafOperator,
  MeasureLeavesByMetricKey,
} from '../../types';
import {
  collectMetricFormattingMetrics,
  collectMetricDatabarMetrics,
  buildMetricLabelMap,
  resolveMetricDisplayLabel,
  normalizeMetricDatabarMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
} from '../../utils';
import { getMetricKey } from '../../pivot/metrics';
import {
  buildBuiltInLeaf,
  buildCustomLeaf,
  buildMeasureLeafLabel,
  buildMeasureLeafOutputKey,
  buildValueLeaf,
  coerceMeasureLeavesByMetric,
  isValueLeaf,
  sortMeasureLeaves,
} from '../../pivot/measureLeaves';
import { isPivotExcelFormula } from '../../pivot/formatting/excelFormulaReferences';

const EMPTY_OBJECT: Record<string, never> = {};
const DND_ACCEPTED_TYPES = [DndItemType.Column, DndItemType.Metric];
const LEAF_OPERATOR_OPTIONS: Array<{
  value: MeasureLeafOperator;
  label: string;
}> = [
  { value: 'ix', label: 'IX' },
  { value: 'delta', label: '∆' },
  { value: 'delta_pct', label: '∆%' },
  { value: 'offset_value', label: t('Value') },
];
const LEAF_UNIT_OPTIONS: Array<{
  value: MeasureLeafOffsetUnit;
  label: string;
}> = [
  { value: 'year', label: t('Year') },
  { value: 'month', label: t('Month') },
  { value: 'week', label: t('Week') },
  { value: 'day', label: t('Day') },
];
const LEAF_DIRECTION_OPTIONS: Array<{
  value: MeasureLeafOffsetDirection;
  label: string;
}> = [
  { value: 'past', label: t('Ago') },
  { value: 'future', label: t('Later') },
];
type AdhocMetricPopoverDatasource = ComponentProps<
  typeof AdhocMetricPopoverTrigger
>['datasource'];

const isDictionaryForAdhocMetric = (value: QueryFormMetric) =>
  value &&
  typeof value !== 'string' &&
  !(value instanceof AdhocMetric) &&
  'expressionType' in value;

const coerceMetrics = (
  addedMetrics: QueryFormMetric | QueryFormMetric[] | undefined | null,
  savedMetrics: Metric[],
  columns: ColumnMeta[],
) => {
  if (!addedMetrics) {
    return [] as Array<Metric | AdhocMetric | QueryFormMetric>;
  }
  const metricsCompatibleWithDataset = ensureIsArray(addedMetrics).filter(
    metric => {
      if (isAdhocMetricSimple(metric)) {
        return columns.some(
          column => column.column_name === metric.column.column_name,
        );
      }
      return true;
    },
  );

  return metricsCompatibleWithDataset.map(metric => {
    if (
      isSavedMetric(metric) &&
      !savedMetrics.some(savedMetric => savedMetric.metric_name === metric)
    ) {
      return {
        metric_name: metric,
        error_text: t('This metric might be incompatible with current dataset'),
        uuid: nanoid(),
      } as Metric;
    }
    if (!isDictionaryForAdhocMetric(metric)) {
      return metric;
    }
    if (isAdhocMetricSimple(metric)) {
      const column = columns.find(
        col => col.column_name === metric.column.column_name,
      );
      if (column) {
        return new AdhocMetric({ ...metric, column });
      }
    }
    return new AdhocMetric(metric);
  });
};

const getOptionsForSavedMetrics = (
  savedMetrics: savedMetricType[],
  currentMetricValues: (string | AdhocMetric)[],
  currentMetric?: string,
) =>
  savedMetrics?.filter(savedMetric =>
    Array.isArray(currentMetricValues)
      ? !currentMetricValues.includes(savedMetric.metric_name ?? '') ||
        savedMetric.metric_name === currentMetric
      : savedMetric,
  ) ?? [];

type ValueType = Metric | AdhocMetric | QueryFormMetric;

const resolveMetricLabel = (
  option: ValueType,
  metricLabelMap?: Record<string, string>,
) => {
  const metricKey = getMetricKey(option as QueryFormMetric | Metric);
  if (metricKey) {
    return resolveMetricDisplayLabel(metricKey, {
      metricLabelMap,
      metrics: [option as QueryFormMetric | Metric],
    });
  }
  if (option instanceof AdhocMetric) {
    return getMetricLabel(option as QueryFormMetric);
  }
  return t('Metric');
};

const resolveMetricReferenceKey = (metric?: QueryFormMetric) => {
  if (!metric) {
    return undefined;
  }
  const metricKey = getMetricKey(metric as QueryFormMetric | Metric);
  return metricKey || undefined;
};

const normalizeMetricReferenceValue = (metric: ValueType): QueryFormMetric => {
  if (typeof metric === 'string') {
    return metric;
  }
  if ('metric_name' in metric) {
    const metricName = metric.metric_name;
    if (typeof metricName === 'string') {
      return metricName;
    }
  }
  if (metric instanceof AdhocMetric) {
    return {
      expressionType: metric.expressionType,
      column: metric.column,
      aggregate: metric.aggregate,
      sqlExpression: metric.sqlExpression,
      label: metric.label,
      hasCustomLabel: metric.hasCustomLabel,
      optionName: metric.optionName,
    };
  }
  if ('expressionType' in metric) {
    const adhocMetric = new AdhocMetric(metric);
    return {
      expressionType: adhocMetric.expressionType,
      column: adhocMetric.column,
      aggregate: adhocMetric.aggregate,
      sqlExpression: adhocMetric.sqlExpression,
      label: metric.label || adhocMetric.label,
      hasCustomLabel: metric.hasCustomLabel ?? adhocMetric.hasCustomLabel,
      optionName:
        typeof metric.optionName === 'string' ? metric.optionName : undefined,
    };
  }
  return metric as unknown as QueryFormMetric;
};

export const updateMetricConfigForRename = ({
  metricFormatting,
  metricDatabars,
  oldMetric,
  newMetric,
}: {
  metricFormatting: PivotMetricFormattingMap;
  metricDatabars: PivotMetricDatabarMap;
  oldMetric: ValueType;
  newMetric: ValueType;
}) => {
  const oldKey = resolveMetricReferenceKey(oldMetric as QueryFormMetric);
  const nextKey = resolveMetricReferenceKey(newMetric as QueryFormMetric);
  if (!oldKey || !nextKey) {
    return { metricFormatting, metricDatabars };
  }
  const replacementMetric = normalizeMetricReferenceValue(newMetric);

  const replaceMetricReference = (
    metric?: QueryFormMetric,
  ): QueryFormMetric | undefined => {
    if (!metric) {
      return metric;
    }
    return resolveMetricReferenceKey(metric) === oldKey
      ? replacementMetric
      : metric;
  };

  const replaceFormattingReference = (
    metric?: PivotMetricFormattingValue,
  ): PivotMetricFormattingValue | undefined => {
    if (!metric) {
      return metric;
    }
    if (isPivotExcelFormula(metric)) {
      return metric;
    }
    return replaceMetricReference(metric);
  };

  const renameMapKey = <T extends Record<string, unknown>>(
    map: Record<string, T>,
  ) => {
    if (oldKey === nextKey || !(oldKey in map)) {
      return map;
    }
    const existing = map[nextKey];
    const value = map[oldKey];
    const merged =
      existing && typeof existing === 'object'
        ? { ...value, ...existing }
        : existing || value;
    const next = { ...map, [nextKey]: merged };
    delete next[oldKey];
    return next;
  };

  const updatedFormattingBase = renameMapKey(metricFormatting);
  const updatedFormatting = Object.entries(
    updatedFormattingBase,
  ).reduce<PivotMetricFormattingMap>((acc, [key, formatting]) => {
    const nextFormatting = { ...formatting };
    METRIC_FORMATTING_FIELDS.forEach(field => {
      const updatedMetric = replaceFormattingReference(formatting[field]);
      if (updatedMetric !== formatting[field]) {
        nextFormatting[field] = updatedMetric;
      }
    });
    acc[key] = nextFormatting;
    return acc;
  }, {});

  const updatedDatabarsBase = renameMapKey(metricDatabars);
  const updatedDatabars = Object.entries(
    updatedDatabarsBase,
  ).reduce<PivotMetricDatabarMap>((acc, [key, config]) => {
    const nextConfig: PivotMetricDatabar = { ...config };
    const nextScaleLike = replaceMetricReference(config.scaleLike);
    const nextColorMetric = replaceMetricReference(config.colorMetric);
    if (nextScaleLike !== config.scaleLike) {
      nextConfig.scaleLike = nextScaleLike;
    }
    if (nextColorMetric !== config.colorMetric) {
      nextConfig.colorMetric = nextColorMetric;
    }
    acc[key] = nextConfig;
    return acc;
  }, {});

  return {
    metricFormatting: updatedFormatting,
    metricDatabars: updatedDatabars,
  };
};

const dedupeMetrics = (metrics: ValueType[]) => {
  const seen = new Set<string>();
  return metrics.filter(metric => {
    const key = getMetricKey(metric as QueryFormMetric | Metric);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const collectActiveMetricKeys = (metrics: ValueType[]) => {
  const keys = new Set<string>();
  metrics.forEach(metric => {
    const key = getMetricKey(metric as QueryFormMetric | Metric);
    if (key) {
      keys.add(key);
    }
  });
  return keys;
};

export type PivotDndMetricSelectProps = DndControlProps<QueryFormMetric> & {
  columns: ColumnMeta[];
  savedMetrics: Metric[];
  datasource?: AdhocMetricPopoverDatasource;
  datasourceType?: string;
};

export default function PivotDndMetricSelect(props: PivotDndMetricSelectProps) {
  const { onChange, multi, datasource, savedMetrics } = props;
  const setControlValue = props.actions?.setControlValue;
  const metricLabelMap = useMemo(
    () =>
      buildMetricLabelMap(
        savedMetrics,
        props.formData?.metricLabelMap as Record<string, string> | undefined,
      ),
    [props.formData?.metricLabelMap, savedMetrics],
  );
  const savedMetricsOptions = useMemo<savedMetricType[]>(
    () =>
      savedMetrics.map(metric => ({
        metric_name: metric.metric_name,
        verbose_name: metric.verbose_name,
        expression: metric.expression ?? '',
      })),
    [savedMetrics],
  );
  const metricFormatting = useMemo(() => {
    const rawMetricFormatting =
      (props.formData?.metricFormatting as PivotMetricFormattingMap) || {};
    return normalizeMetricFormattingMapWithKeys(
      rawMetricFormatting,
      ensureIsArray(props.value),
    );
  }, [props.formData, props.value]);
  const metricDatabars = useMemo(() => {
    const rawMetricDatabars =
      (props.formData?.metricDatabars as PivotMetricDatabarMap) || {};
    return normalizeMetricDatabarMapWithKeys(
      rawMetricDatabars,
      ensureIsArray(props.value),
    );
  }, [props.formData, props.value]);
  const metricFormattingRef =
    useRef<PivotMetricFormattingMap>(metricFormatting);
  const metricDatabarsRef = useRef<PivotMetricDatabarMap>(metricDatabars);
  const metricFormattingPendingRef = useRef<PivotMetricFormattingMap | null>(
    null,
  );
  const metricDatabarsPendingRef = useRef<PivotMetricDatabarMap | null>(null);
  const [localMetricFormatting, setLocalMetricFormatting] =
    useState<PivotMetricFormattingMap>(metricFormatting);
  const [localMetricDatabars, setLocalMetricDatabars] =
    useState<PivotMetricDatabarMap>(metricDatabars);

  useEffect(() => {
    if (metricFormattingPendingRef.current) {
      if (isEqual(metricFormatting, metricFormattingPendingRef.current)) {
        metricFormattingPendingRef.current = null;
        metricFormattingRef.current = metricFormatting;
        if (!isEqual(metricFormatting, localMetricFormatting)) {
          setLocalMetricFormatting(metricFormatting);
        }
      }
      return;
    }
    metricFormattingRef.current = metricFormatting;
    if (!isEqual(metricFormatting, localMetricFormatting)) {
      setLocalMetricFormatting(metricFormatting);
    }
  }, [localMetricFormatting, metricFormatting]);

  useEffect(() => {
    if (metricDatabarsPendingRef.current) {
      if (isEqual(metricDatabars, metricDatabarsPendingRef.current)) {
        metricDatabarsPendingRef.current = null;
        metricDatabarsRef.current = metricDatabars;
        if (!isEqual(metricDatabars, localMetricDatabars)) {
          setLocalMetricDatabars(metricDatabars);
        }
      }
      return;
    }
    metricDatabarsRef.current = metricDatabars;
    if (!isEqual(metricDatabars, localMetricDatabars)) {
      setLocalMetricDatabars(metricDatabars);
    }
  }, [localMetricDatabars, metricDatabars]);

  const extra = useMemo<{ disallow_adhoc_metrics?: boolean }>(() => {
    let parsedExtra: { disallow_adhoc_metrics?: boolean } = {};
    if (!datasource?.extra) {
      return parsedExtra;
    }
    if (typeof datasource.extra === 'string') {
      try {
        parsedExtra = JSON.parse(datasource.extra);
      } catch {
        parsedExtra = {};
      }
      return parsedExtra;
    }
    if (typeof datasource.extra === 'object') {
      return datasource.extra as { disallow_adhoc_metrics?: boolean };
    }
    return parsedExtra;
  }, [datasource?.extra]);

  const savedMetricSet = useMemo(
    () => new Set(savedMetrics.map(({ metric_name }) => metric_name)),
    [savedMetrics],
  );

  const [value, setValue] = useState<ValueType[]>(
    coerceMetrics(
      props.value as QueryFormMetric | QueryFormMetric[] | null,
      savedMetrics,
      props.columns,
    ),
  );
  const metricKeys = useMemo(
    () =>
      value
        .map(metric => getMetricKey(metric as QueryFormMetric | Metric))
        .filter((key): key is string => Boolean(key)),
    [value],
  );
  const measureLeavesFromFormData = useMemo(
    () =>
      coerceMeasureLeavesByMetric(
        metricKeys,
        props.formData?.measureLeavesByMetric as
          | MeasureLeavesByMetricKey
          | undefined,
      ),
    [metricKeys, props.formData?.measureLeavesByMetric],
  );
  const [measureLeavesByMetric, setMeasureLeavesByMetric] =
    useState<MeasureLeavesByMetricKey>(measureLeavesFromFormData);
  const measureLeavesRef = useRef<MeasureLeavesByMetricKey>(
    measureLeavesFromFormData,
  );
  const [droppedItem, setDroppedItem] = useState<
    DatasourcePanelDndItem | typeof EMPTY_OBJECT
  >({});
  const [newMetricPopoverVisible, setNewMetricPopoverVisible] = useState(false);
  const [measureSelectorVisible, setMeasureSelectorVisible] = useState(false);
  const [measureSelectorMetricKey, setMeasureSelectorMetricKey] = useState<
    string | null
  >(null);
  const [measureSelectorMetricLabel, setMeasureSelectorMetricLabel] =
    useState('');
  const [leafOperator, setLeafOperator] = useState<MeasureLeafOperator>('ix');
  const [leafOffsetN, setLeafOffsetN] = useState(1);
  const [leafOffsetUnit, setLeafOffsetUnit] =
    useState<MeasureLeafOffsetUnit>('year');
  const [leafOffsetDirection, setLeafOffsetDirection] =
    useState<MeasureLeafOffsetDirection>('past');
  const [customMeasureEnabled, setCustomMeasureEnabled] = useState(false);
  const [customMeasureLabel, setCustomMeasureLabel] = useState('');
  const [customMeasureMetric, setCustomMeasureMetric] =
    useState<QueryFormMetric>();
  const [customMeasureOffsetEnabled, setCustomMeasureOffsetEnabled] =
    useState(false);
  const [customMeasureError, setCustomMeasureError] = useState<
    string | undefined
  >(undefined);

  const coercedMetrics = useMemo(
    () =>
      coerceMetrics(
        props.value as QueryFormMetric | QueryFormMetric[] | null,
        savedMetrics,
        props.columns,
      ),
    [props.columns, props.value, savedMetrics],
  );

  useEffect(() => {
    setValue(coercedMetrics);
  }, [coercedMetrics]);
  useEffect(() => {
    if (!isEqual(measureLeavesRef.current, measureLeavesFromFormData)) {
      measureLeavesRef.current = measureLeavesFromFormData;
      setMeasureLeavesByMetric(measureLeavesFromFormData);
    }
  }, [measureLeavesFromFormData]);

  const metricRowType = useMemo(
    () => `${DndItemType.AdhocMetricOption}_${props.name}_${props.label}`,
    [props.label, props.name],
  );
  const { itemType: dragItemType, item: dragItem } = useDragLayer(monitor => ({
    itemType: monitor.getItemType(),
    item: monitor.getItem() as { dragIndex?: number } | null,
  }));
  const draggedMetricKey = useMemo(() => {
    if (typeof dragItemType === 'string') {
      if (dragItemType.startsWith('measure-leaf-')) {
        return dragItemType.replace('measure-leaf-', '');
      }
    }
    if (dragItemType !== metricRowType || !dragItem) {
      return null;
    }
    const { dragIndex } = dragItem;
    if (typeof dragIndex !== 'number' || dragIndex < 0) {
      return null;
    }
    const metric = value[dragIndex];
    return metric ? getMetricKey(metric as QueryFormMetric | Metric) : null;
  }, [dragItem, dragItemType, metricRowType, value]);

  const updateMeasureLeaves = useCallback(
    (next: MeasureLeavesByMetricKey, persist = false) => {
      const sorted = Object.fromEntries(
        Object.entries(next).map(([metricKey, leaves]) => [
          metricKey,
          sortMeasureLeaves(leaves),
        ]),
      );
      measureLeavesRef.current = sorted;
      setMeasureLeavesByMetric(sorted);
      if (persist && setControlValue) {
        setControlValue('measureLeavesByMetric', sorted);
      }
    },
    [setControlValue],
  );

  const handleChange = useCallback(
    (opts: ValueType | ValueType[] | null) => {
      if (opts === null) {
        onChange(null);
        return;
      }

      const transformedOpts = ensureIsArray(opts);
      const optionValues = transformedOpts
        .map(option => {
          if (typeof option === 'string') {
            return option;
          }
          if ('metric_name' in option && option.metric_name) {
            return option.metric_name;
          }
          return option as QueryFormMetric;
        })
        .filter(option => option);
      const nextMetricKeys = optionValues
        .map(option => getMetricKey(option as QueryFormMetric | Metric))
        .filter((key): key is string => Boolean(key));
      const nextLeaves = coerceMeasureLeavesByMetric(
        nextMetricKeys,
        measureLeavesRef.current,
      );
      if (setControlValue) {
        const activeMetricKeys = collectActiveMetricKeys(
          optionValues as ValueType[],
        );
        Object.entries(nextLeaves).forEach(([metricKey, leaves]) => {
          leaves.forEach(leaf => {
            activeMetricKeys.add(buildMeasureLeafOutputKey(metricKey, leaf));
          });
        });
        const baseFormatting = metricFormattingRef.current || {};
        const nextFormatting = Object.fromEntries(
          Object.entries(baseFormatting).filter(([key]) =>
            activeMetricKeys.has(key),
          ),
        ) as PivotMetricFormattingMap;
        if (!isEqual(baseFormatting, nextFormatting)) {
          metricFormattingPendingRef.current = nextFormatting;
          metricFormattingRef.current = nextFormatting;
          setLocalMetricFormatting(nextFormatting);
          setControlValue('metricFormatting', nextFormatting);
        }
        const baseDatabars = metricDatabarsRef.current || {};
        const nextDatabars = Object.fromEntries(
          Object.entries(baseDatabars).filter(([key]) =>
            activeMetricKeys.has(key),
          ),
        ) as PivotMetricDatabarMap;
        const cleanedDatabars = Object.entries(
          nextDatabars,
        ).reduce<PivotMetricDatabarMap>((acc, [key, config]) => {
          const scaleLikeKey = config.scaleLike
            ? getMetricKey(config.scaleLike as QueryFormMetric)
            : '';
          if (scaleLikeKey && !activeMetricKeys.has(scaleLikeKey)) {
            acc[key] = { ...config, scaleLike: undefined };
          } else {
            acc[key] = config;
          }
          return acc;
        }, {});
        if (!isEqual(baseDatabars, cleanedDatabars)) {
          metricDatabarsPendingRef.current = cleanedDatabars;
          metricDatabarsRef.current = cleanedDatabars;
          setLocalMetricDatabars(cleanedDatabars);
          setControlValue('metricDatabars', cleanedDatabars);
        }
        if (!isEqual(nextLeaves, measureLeavesRef.current)) {
          updateMeasureLeaves(nextLeaves, true);
        }
      }
      onChange(multi ? optionValues : optionValues[0]);
    },
    [multi, onChange, setControlValue, updateMeasureLeaves],
  );

  const handleMetricFormattingChange = useCallback(
    (
      metricKey: string,
      field: keyof PivotMetricFormatting,
      metric?: PivotMetricFormattingValue,
    ) => {
      if (!setControlValue) {
        return;
      }
      const baseFormatting = metricFormattingRef.current || {};
      const current = baseFormatting[metricKey] || {};
      const updated = {
        ...current,
        [field]: metric,
      };
      if (!metric) {
        delete updated[field];
      }
      const hasValues = Object.values(updated).some(Boolean);
      const nextFormatting = { ...baseFormatting };
      if (hasValues) {
        nextFormatting[metricKey] = updated;
      } else {
        delete nextFormatting[metricKey];
      }
      setLocalMetricFormatting(nextFormatting);
      metricFormattingPendingRef.current = nextFormatting;
      metricFormattingRef.current = nextFormatting;
      setControlValue('metricFormatting', nextFormatting);
    },
    [setControlValue],
  );

  const handleMetricDatabarChange = useCallback(
    (
      metricKey: string,
      field: keyof PivotMetricDatabar,
      nextValue?: PivotMetricDatabar[keyof PivotMetricDatabar],
    ) => {
      if (!setControlValue) {
        return;
      }
      const baseDatabars = metricDatabarsRef.current || {};
      if (field === 'scaleLike' && nextValue) {
        const activeMetricKeys = collectActiveMetricKeys(value);
        const { sources, targets } = Object.entries(baseDatabars).reduce<{
          sources: Set<string>;
          targets: Set<string>;
        }>(
          (acc, [key, config]) => {
            const scaleLikeKey = config.scaleLike
              ? getMetricKey(config.scaleLike as QueryFormMetric)
              : undefined;
            if (scaleLikeKey) {
              acc.sources.add(key);
              acc.targets.add(scaleLikeKey);
            }
            return acc;
          },
          { sources: new Set(), targets: new Set() },
        );
        const targetKey = getMetricKey(nextValue as QueryFormMetric | Metric);
        if (
          !targetKey ||
          targetKey === metricKey ||
          !activeMetricKeys.has(targetKey) ||
          sources.has(targetKey) ||
          targets.has(metricKey)
        ) {
          return;
        }
      }
      const current = baseDatabars[metricKey] || {};
      const updated: PivotMetricDatabar = {
        ...current,
        [field]: nextValue,
      };
      if (field === 'colorMetric' && nextValue) {
        updated.colorMode = 'byMetric';
      }
      if (field === 'colorMode' && nextValue !== 'byMetric') {
        delete updated.colorMetric;
      }
      if (field === 'colorMetric' && !nextValue) {
        updated.colorMode = 'static';
      }
      const nextDatabars = { ...baseDatabars };
      if (!updated.type) {
        delete nextDatabars[metricKey];
      } else {
        nextDatabars[metricKey] = updated;
      }
      setLocalMetricDatabars(nextDatabars);
      metricDatabarsPendingRef.current = nextDatabars;
      metricDatabarsRef.current = nextDatabars;
      setControlValue('metricDatabars', nextDatabars);
    },
    [setControlValue, value],
  );

  const availableMetrics = useMemo(() => {
    const selectedMetrics = value;
    const formattingMetrics = collectMetricFormattingMetrics(
      localMetricFormatting,
    );
    const databarMetrics = collectMetricDatabarMetrics(localMetricDatabars);
    const savedMetricNames = savedMetrics
      .map(metric => metric.metric_name)
      .filter(Boolean) as ValueType[];
    return dedupeMetrics([
      ...selectedMetrics,
      ...formattingMetrics,
      ...databarMetrics,
      ...savedMetricNames,
    ]);
  }, [localMetricDatabars, localMetricFormatting, savedMetrics, value]);
  const measureSelectorMetrics = useMemo(
    () => dedupeMetrics([...value, ...savedMetrics]),
    [savedMetrics, value],
  );

  const openMeasureSelector = useCallback(
    (metricKey: string, metricLabel: string) => {
      setMeasureSelectorMetricKey(metricKey);
      setMeasureSelectorMetricLabel(metricLabel);
      setLeafOperator('ix');
      setLeafOffsetN(1);
      setLeafOffsetUnit('year');
      setLeafOffsetDirection('past');
      setCustomMeasureEnabled(false);
      setCustomMeasureLabel('');
      setCustomMeasureMetric(undefined);
      setCustomMeasureOffsetEnabled(false);
      setCustomMeasureError(undefined);
      setMeasureSelectorVisible(true);
    },
    [],
  );

  const closeMeasureSelector = useCallback(() => {
    setMeasureSelectorVisible(false);
    setCustomMeasureError(undefined);
  }, []);

  const handleSaveMeasureLeaf = useCallback(() => {
    if (!measureSelectorMetricKey) {
      return;
    }
    setCustomMeasureError(undefined);
    const offset = {
      n: leafOffsetN,
      unit: leafOffsetUnit,
      direction: leafOffsetDirection,
    };
    const nextLeaf = customMeasureEnabled
      ? (() => {
          const label = customMeasureLabel.trim();
          if (!label) {
            setCustomMeasureError(t('Custom label is empty.'));
            return null;
          }
          if (!customMeasureMetric) {
            setCustomMeasureError(t('Select a custom measure.'));
            return null;
          }
          if (isPivotExcelFormula(customMeasureMetric)) {
            setCustomMeasureError(t('Custom Excel is not supported here.'));
            return null;
          }
          const normalizedMetric = normalizeMetricReferenceValue(
            customMeasureMetric as ValueType,
          );
          return buildCustomLeaf({
            label,
            metric: normalizedMetric,
            offset: customMeasureOffsetEnabled ? offset : undefined,
          });
        })()
      : buildBuiltInLeaf(leafOperator, offset);
    if (!nextLeaf) {
      return;
    }
    const leaves = measureLeavesRef.current[measureSelectorMetricKey] ?? [
      buildValueLeaf(),
    ];
    const existingIndex = leaves.findIndex(
      leaf => leaf.label === nextLeaf.label,
    );
    const nextLeaves = [...leaves];
    if (existingIndex >= 0) {
      nextLeaves[existingIndex] = nextLeaf;
    } else {
      nextLeaves.push(nextLeaf);
    }
    updateMeasureLeaves(
      {
        ...measureLeavesRef.current,
        [measureSelectorMetricKey]: nextLeaves,
      },
      true,
    );
    closeMeasureSelector();
  }, [
    closeMeasureSelector,
    customMeasureEnabled,
    customMeasureLabel,
    customMeasureMetric,
    customMeasureOffsetEnabled,
    leafOffsetDirection,
    leafOffsetN,
    leafOffsetUnit,
    leafOperator,
    measureSelectorMetricKey,
    updateMeasureLeaves,
  ]);

  const handleRemoveMeasureLeaf = useCallback(
    (metricKey: string, index: number) => {
      const leaves = measureLeavesRef.current[metricKey] ?? [buildValueLeaf()];
      const target = leaves[index];
      if (target && isValueLeaf(target)) {
        return;
      }
      const nextLeaves = leaves.filter((_, idx) => idx !== index);
      const resolvedLeaves =
        nextLeaves.length > 0 ? nextLeaves : [buildValueLeaf()];
      updateMeasureLeaves(
        { ...measureLeavesRef.current, [metricKey]: resolvedLeaves },
        true,
      );
    },
    [updateMeasureLeaves],
  );

  const moveMeasureLeaf = useCallback(
    (metricKey: string, dragIndex: number, hoverIndex: number) => {
      const leaves = measureLeavesRef.current[metricKey] ?? [];
      if (!leaves[dragIndex] || !leaves[hoverIndex]) {
        return;
      }
      const nextLeaves = [...leaves];
      [nextLeaves[hoverIndex], nextLeaves[dragIndex]] = [
        nextLeaves[dragIndex],
        nextLeaves[hoverIndex],
      ];
      updateMeasureLeaves(
        { ...measureLeavesRef.current, [metricKey]: nextLeaves },
        false,
      );
    },
    [updateMeasureLeaves],
  );

  const handleDropMeasureLeaf = useCallback(() => {
    updateMeasureLeaves({ ...measureLeavesRef.current }, true);
  }, [updateMeasureLeaves]);

  const canDrop = useCallback(
    (item: DatasourcePanelDndItem) => {
      if (
        extra.disallow_adhoc_metrics &&
        (item.type !== DndItemType.Metric ||
          !savedMetricSet.has(item.value.metric_name))
      ) {
        return false;
      }

      const isMetricAlreadyInValues =
        item.type === 'metric'
          ? value.some(existing => {
              if (typeof existing === 'string') {
                return existing === item.value.metric_name;
              }
              return (
                'metric_name' in existing &&
                existing.metric_name === item.value.metric_name
              );
            })
          : false;
      return !isMetricAlreadyInValues;
    },
    [extra.disallow_adhoc_metrics, savedMetricSet, value],
  );

  const onNewMetric = useCallback(
    (newMetric: Metric) => {
      const newValue = props.multi ? [...value, newMetric] : [newMetric];
      setValue(newValue);
      handleChange(newValue);
    },
    [handleChange, props.multi, value],
  );

  const onMetricEdit = useCallback(
    (changedMetric: Metric | AdhocMetric, oldMetric: Metric | AdhocMetric) => {
      if (oldMetric instanceof AdhocMetric && oldMetric.equals(changedMetric)) {
        return;
      }
      if (setControlValue) {
        const baseFormatting = metricFormattingRef.current || {};
        const baseDatabars = metricDatabarsRef.current || {};
        const {
          metricFormatting: nextFormatting,
          metricDatabars: nextDatabars,
        } = updateMetricConfigForRename({
          metricFormatting: baseFormatting,
          metricDatabars: baseDatabars,
          oldMetric,
          newMetric: changedMetric,
        });
        if (!isEqual(baseFormatting, nextFormatting)) {
          metricFormattingPendingRef.current = nextFormatting;
          metricFormattingRef.current = nextFormatting;
          setLocalMetricFormatting(nextFormatting);
          setControlValue('metricFormatting', nextFormatting);
        }
        if (!isEqual(baseDatabars, nextDatabars)) {
          metricDatabarsPendingRef.current = nextDatabars;
          metricDatabarsRef.current = nextDatabars;
          setLocalMetricDatabars(nextDatabars);
          setControlValue('metricDatabars', nextDatabars);
        }
      }
      const oldKey = getMetricKey(oldMetric as QueryFormMetric | Metric);
      const nextKey = getMetricKey(changedMetric as QueryFormMetric | Metric);
      if (oldKey && nextKey && oldKey !== nextKey) {
        const nextLeaves = { ...measureLeavesRef.current };
        if (nextLeaves[oldKey]) {
          nextLeaves[nextKey] = nextLeaves[oldKey];
          delete nextLeaves[oldKey];
          updateMeasureLeaves(nextLeaves, true);
        }
      }
      const newValue = value.map(value => {
        if (
          ('metric_name' in oldMetric && value === oldMetric.metric_name) ||
          (oldMetric instanceof AdhocMetric &&
            value instanceof AdhocMetric &&
            value.optionName === oldMetric.optionName)
        ) {
          return changedMetric;
        }
        return value;
      });
      setValue(newValue);
      handleChange(newValue);
    },
    [handleChange, setControlValue, updateMeasureLeaves, value],
  );

  const onRemoveMetric = useCallback(
    (index: number) => {
      if (!Array.isArray(value)) {
        return;
      }
      const valuesCopy = [...value];
      valuesCopy.splice(index, 1);
      setValue(valuesCopy);
      handleChange(valuesCopy);
    },
    [handleChange, value],
  );

  const moveLabel = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      const newValues = [...value];
      [newValues[hoverIndex], newValues[dragIndex]] = [
        newValues[dragIndex],
        newValues[hoverIndex],
      ];
      setValue(newValues);
    },
    [value],
  );

  const newSavedMetricOptions = useMemo(
    () =>
      getOptionsForSavedMetrics(
        savedMetricsOptions,
        ensureIsArray(props.value) as (string | AdhocMetric)[],
      ),
    [props.value, savedMetricsOptions],
  );

  const getSavedMetricOptionsForMetric = useCallback(
    (index: number) => {
      const currentMetric = (
        ensureIsArray(props.value) as (string | AdhocMetric)[]
      )[index];
      return getOptionsForSavedMetrics(
        savedMetricsOptions,
        ensureIsArray(props.value) as (string | AdhocMetric)[],
        typeof currentMetric === 'string' ? currentMetric : undefined,
      );
    },
    [props.value, savedMetricsOptions],
  );

  const handleDropLabel = useCallback(() => {
    const normalized = value.map(normalizeMetricReferenceValue);
    onChange(multi ? normalized : normalized[0]);
  }, [multi, onChange, value]);

  const valueRenderer = useCallback(
    (option: ValueType, index: number) => (
      <PivotMetricDefinitionValue
        key={index}
        index={index}
        option={option}
        onMetricEdit={onMetricEdit}
        onRemoveMetric={onRemoveMetric}
        onAddMeasureLeaf={openMeasureSelector}
        columns={props.columns}
        savedMetrics={savedMetrics}
        savedMetricsOptions={getSavedMetricOptionsForMetric(index)}
        availableMetrics={availableMetrics}
        selectedMetrics={value}
        metricLabelMap={metricLabelMap}
        metricFormatting={localMetricFormatting}
        onMetricFormattingChange={handleMetricFormattingChange}
        metricDatabars={localMetricDatabars}
        onMetricDatabarChange={handleMetricDatabarChange}
        datasource={props.datasource}
        onMoveLabel={moveLabel}
        onDropLabel={handleDropLabel}
        type={metricRowType}
        multi={multi}
        datasourceWarningMessage={
          option instanceof AdhocMetric && option.datasourceWarning
            ? t('This metric might be incompatible with current dataset')
            : undefined
        }
      />
    ),
    [
      availableMetrics,
      getSavedMetricOptionsForMetric,
      handleMetricDatabarChange,
      handleMetricFormattingChange,
      handleDropLabel,
      localMetricDatabars,
      localMetricFormatting,
      metricLabelMap,
      metricRowType,
      moveLabel,
      multi,
      value,
      onMetricEdit,
      onRemoveMetric,
      openMeasureSelector,
      props.columns,
      props.datasource,
      savedMetrics,
    ],
  );

  const valuesRenderer = useCallback(
    () =>
      value.flatMap((metric, index) => {
        const metricKey = getMetricKey(metric as QueryFormMetric | Metric);
        const metricLabel = resolveMetricLabel(metric, metricLabelMap);
        const baseRow = valueRenderer(metric, index);
        if (!metricKey) {
          return [baseRow];
        }
        const leaves = measureLeavesByMetric[metricKey] ?? [];
        const isGroupDragging =
          !!draggedMetricKey && draggedMetricKey === metricKey;
        const leafRows = leaves
          .map((leaf, leafIndex) => ({ leaf, leafIndex }))
          .filter(({ leaf }) => !isValueLeaf(leaf))
          .map(({ leaf, leafIndex }) => (
            <MeasureLeafValue
              key={`${metricKey}-${leaf.id}`}
              metricLabel={metricLabel}
              metricKey={metricKey}
              leaf={leaf}
              index={leafIndex}
              onRemoveLeaf={leafIdx =>
                handleRemoveMeasureLeaf(metricKey, leafIdx)
              }
              onMoveLeaf={(dragIndex, hoverIndex) =>
                moveMeasureLeaf(metricKey, dragIndex, hoverIndex)
              }
              onDropLeaf={handleDropMeasureLeaf}
              metricFormatting={localMetricFormatting}
              onMetricFormattingChange={handleMetricFormattingChange}
              metricDatabars={localMetricDatabars}
              onMetricDatabarChange={handleMetricDatabarChange}
              availableMetrics={availableMetrics}
              selectedMetrics={value}
              metricLabelMap={metricLabelMap}
              savedMetrics={savedMetrics}
              columns={props.columns}
              datasource={props.datasource}
              type={`measure-leaf-${metricKey}`}
              isGroupDragging={isGroupDragging}
            />
          ));
        return [baseRow, ...leafRows];
      }),
    [
      availableMetrics,
      draggedMetricKey,
      handleDropMeasureLeaf,
      handleMetricDatabarChange,
      handleMetricFormattingChange,
      handleRemoveMeasureLeaf,
      localMetricDatabars,
      localMetricFormatting,
      metricLabelMap,
      measureLeavesByMetric,
      moveMeasureLeaf,
      props.columns,
      props.datasource,
      savedMetrics,
      value,
      valueRenderer,
    ],
  );

  const togglePopover = useCallback((visible: boolean) => {
    setNewMetricPopoverVisible(visible);
  }, []);

  const closePopover = useCallback(() => {
    togglePopover(false);
  }, [togglePopover]);

  const handleDrop = useCallback(
    (item: DatasourcePanelDndItem) => {
      if (item.type === DndItemType.Metric) {
        onNewMetric(item.value as Metric);
      }
      if (item.type === DndItemType.Column) {
        setDroppedItem(item);
        togglePopover(true);
      }
    },
    [onNewMetric, togglePopover],
  );

  const handleClickGhostButton = useCallback(() => {
    setDroppedItem({});
    togglePopover(true);
  }, [togglePopover]);

  const adhocMetric = useMemo(() => {
    if (
      isDatasourcePanelDndItem(droppedItem) &&
      droppedItem.type === DndItemType.Column
    ) {
      const itemValue = droppedItem.value as ColumnMeta;
      const config: Partial<AdhocMetric> = {
        column: itemValue,
      };
      if (itemValue.type_generic === GenericDataType.Numeric) {
        config.aggregate = AGGREGATES.SUM;
      } else if (
        itemValue.type_generic === GenericDataType.String ||
        itemValue.type_generic === GenericDataType.Boolean ||
        itemValue.type_generic === GenericDataType.Temporal
      ) {
        config.aggregate = AGGREGATES.COUNT_DISTINCT;
      }
      return new AdhocMetric(config);
    }
    return new AdhocMetric({});
  }, [droppedItem]);

  const ghostButtonText = tn(
    'Drop a column/metric here or click',
    'Drop columns/metrics here or click',
    multi ? 2 : 1,
  );
  const datasourceForPopover =
    props.datasource as unknown as AdhocMetricPopoverDatasource;
  const popoverColumns = useMemo(
    () =>
      props.columns.map(column => ({
        column_name: column.column_name,
        type: column.type ?? '',
      })),
    [props.columns],
  );
  const leafPreviewLabel = useMemo(() => {
    if (customMeasureEnabled) {
      const label = customMeasureLabel.trim();
      return label || t('Custom');
    }
    return buildMeasureLeafLabel(leafOperator, {
      n: leafOffsetN,
      unit: leafOffsetUnit,
      direction: leafOffsetDirection,
    });
  }, [
    customMeasureEnabled,
    customMeasureLabel,
    leafOffsetDirection,
    leafOffsetN,
    leafOffsetUnit,
    leafOperator,
  ]);
  const canSaveMeasureLeaf =
    !!measureSelectorMetricKey &&
    (!customMeasureEnabled ||
      (customMeasureLabel.trim().length > 0 && !!customMeasureMetric));

  return (
    <div className="metrics-select">
      <PivotDndSelectLabel
        onDrop={handleDrop}
        canDrop={canDrop}
        valuesRenderer={valuesRenderer}
        accept={DND_ACCEPTED_TYPES}
        ghostButtonText={ghostButtonText}
        displayGhostButton={multi || value.length === 0}
        onClickGhostButton={handleClickGhostButton}
        {...props}
      />
      <Modal
        title={t('Measure selector')}
        show={measureSelectorVisible}
        onHide={closeMeasureSelector}
        onHandledPrimaryAction={handleSaveMeasureLeaf}
        primaryButtonName={t('Save')}
        disablePrimaryButton={!canSaveMeasureLeaf}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {t('Metric: %s', measureSelectorMetricLabel)}
          </Typography.Text>
          <Space align="center" size={8}>
            <Switch
              checked={customMeasureEnabled}
              onChange={checked => {
                setCustomMeasureEnabled(checked);
                setCustomMeasureError(undefined);
              }}
            />
            <Typography.Text>{t('Custom measure')}</Typography.Text>
          </Space>
          {customMeasureEnabled ? (
            <>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text>{t('Custom label')}</Typography.Text>
                <Input
                  aria-label={t('Custom label')}
                  placeholder={t('Label')}
                  value={customMeasureLabel}
                  onChange={event => setCustomMeasureLabel(event.target.value)}
                />
              </Space>
              <MetricFormatSelector
                enableExcel
                allowExcel={false}
                label={t('Measure')}
                tooltip={t('Metric used for this custom measure.')}
                value={customMeasureMetric}
                metrics={measureSelectorMetrics}
                onChange={metric => {
                  if (metric && isPivotExcelFormula(metric)) {
                    return;
                  }
                  setCustomMeasureMetric(metric);
                  setCustomMeasureError(undefined);
                }}
                columns={props.columns}
                savedMetrics={savedMetrics}
                datasource={props.datasource}
                allowCustomSql={!extra.disallow_adhoc_metrics}
                allowSavedMetrics
              />
              <Space align="center" size={8}>
                <Switch
                  checked={customMeasureOffsetEnabled}
                  onChange={checked => setCustomMeasureOffsetEnabled(checked)}
                />
                <Typography.Text>{t('Apply time offset')}</Typography.Text>
              </Space>
              {customMeasureOffsetEnabled && (
                <>
                  <Space
                    direction="vertical"
                    size={8}
                    style={{ width: '100%' }}
                  >
                    <Typography.Text>{t('Period')}</Typography.Text>
                    <Space size={8}>
                      <InputNumber
                        min={1}
                        value={leafOffsetN}
                        onChange={value =>
                          setLeafOffsetN(
                            typeof value === 'number' && value > 0 ? value : 1,
                          )
                        }
                      />
                      <Select
                        ariaLabel={t('Period unit')}
                        options={LEAF_UNIT_OPTIONS}
                        value={leafOffsetUnit}
                        onChange={value =>
                          setLeafOffsetUnit(value as MeasureLeafOffsetUnit)
                        }
                        css={{ width: 160 }}
                      />
                    </Space>
                  </Space>
                  <Space
                    direction="vertical"
                    size={8}
                    style={{ width: '100%' }}
                  >
                    <Typography.Text>{t('Direction')}</Typography.Text>
                    <Radio.Group
                      options={LEAF_DIRECTION_OPTIONS}
                      optionType="button"
                      value={leafOffsetDirection}
                      onChange={event =>
                        setLeafOffsetDirection(
                          event.target.value as MeasureLeafOffsetDirection,
                        )
                      }
                    />
                  </Space>
                </>
              )}
            </>
          ) : (
            <>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text>{t('Operation')}</Typography.Text>
                <Select
                  ariaLabel={t('Operation')}
                  options={LEAF_OPERATOR_OPTIONS}
                  value={leafOperator}
                  onChange={value =>
                    setLeafOperator(value as MeasureLeafOperator)
                  }
                  css={{ width: 220 }}
                />
              </Space>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text>{t('Period')}</Typography.Text>
                <Space size={8}>
                  <InputNumber
                    min={1}
                    value={leafOffsetN}
                    onChange={value =>
                      setLeafOffsetN(
                        typeof value === 'number' && value > 0 ? value : 1,
                      )
                    }
                  />
                  <Select
                    ariaLabel={t('Period unit')}
                    options={LEAF_UNIT_OPTIONS}
                    value={leafOffsetUnit}
                    onChange={value =>
                      setLeafOffsetUnit(value as MeasureLeafOffsetUnit)
                    }
                    css={{ width: 160 }}
                  />
                </Space>
              </Space>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text>{t('Direction')}</Typography.Text>
                <Radio.Group
                  options={LEAF_DIRECTION_OPTIONS}
                  optionType="button"
                  value={leafOffsetDirection}
                  onChange={event =>
                    setLeafOffsetDirection(
                      event.target.value as MeasureLeafOffsetDirection,
                    )
                  }
                />
              </Space>
            </>
          )}
          {customMeasureError && (
            <Typography.Text type="danger">
              {customMeasureError}
            </Typography.Text>
          )}
          <Typography.Text>
            {t('Preview: %s', leafPreviewLabel)}
          </Typography.Text>
        </Space>
      </Modal>
      <AdhocMetricPopoverTrigger
        adhocMetric={adhocMetric}
        onMetricEdit={onNewMetric}
        columns={popoverColumns}
        savedMetricsOptions={newSavedMetricOptions}
        savedMetric={{ metric_name: '', expression: '' }}
        datasource={datasourceForPopover}
        isControlledComponent
        visible={newMetricPopoverVisible}
        togglePopover={togglePopover}
        closePopover={closePopover}
        isNew
      >
        <div />
      </AdhocMetricPopoverTrigger>
    </div>
  );
}
