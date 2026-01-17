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
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { nanoid } from 'nanoid';
import {
  ensureIsArray,
  GenericDataType,
  getMetricLabel,
  isAdhocMetricSimple,
  isSavedMetric,
  Metric,
  QueryFormMetric,
  t,
  tn,
} from '@superset-ui/core';
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
import PivotMetricDefinitionValue from './PivotMetricDefinitionValue';
import {
  PivotMetricFormatting,
  PivotMetricFormattingMap,
  PivotMetricDatabar,
  PivotMetricDatabarMap,
  METRIC_FORMATTING_FIELDS,
} from '../../types';
import {
  collectMetricFormattingMetrics,
  collectMetricDatabarMetrics,
  getFormattingMetricKey,
  getMetricKey,
  normalizeMetricDatabarMapWithKeys,
  normalizeMetricFormattingMapWithKeys,
} from '../../utils';

const EMPTY_OBJECT: Record<string, never> = {};
const DND_ACCEPTED_TYPES = [DndItemType.Column, DndItemType.Metric];
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

const resolveMetricLabel = (option: ValueType) => {
  if (option instanceof AdhocMetric) {
    return getMetricLabel(option as QueryFormMetric);
  }
  if (typeof option === 'string') {
    return option;
  }
  if ('verbose_name' in option && option.verbose_name) {
    return option.verbose_name;
  }
  if ('label' in option && typeof option.label === 'string') {
    return option.label;
  }
  if ('metric_name' in option && option.metric_name) {
    return option.metric_name;
  }
  if ('expressionType' in option) {
    return getMetricLabel(option as QueryFormMetric);
  }
  return t('Metric');
};

const resolveMetricKey = (option: ValueType) =>
  getMetricKey(option as QueryFormMetric | Metric);

const collectMetricIdentifiers = (metric: ValueType) => {
  const identifiers = new Set<string>();
  if (typeof metric === 'string') {
    if (metric.length > 0) {
      identifiers.add(metric);
    }
    return identifiers;
  }
  const formattingKey = getFormattingMetricKey(
    metric as QueryFormMetric | Metric,
  );
  if (formattingKey) {
    identifiers.add(formattingKey);
  }
  const metricKey = getMetricKey(metric as QueryFormMetric | Metric);
  if (metricKey) {
    identifiers.add(metricKey);
  }
  const label = resolveMetricLabel(metric);
  if (label && label !== t('Metric')) {
    identifiers.add(label);
  }
  if ('metric_name' in metric && typeof metric.metric_name === 'string') {
    identifiers.add(metric.metric_name);
  }
  if ('verbose_name' in metric && typeof metric.verbose_name === 'string') {
    identifiers.add(metric.verbose_name);
  }
  return identifiers;
};

const resolveMetricReferenceKey = (metric?: QueryFormMetric) => {
  if (!metric) {
    return undefined;
  }
  if (typeof metric === 'string') {
    return metric.length > 0 ? metric : undefined;
  }
  const metricKey = getMetricKey(metric as QueryFormMetric | Metric);
  if (metricKey) {
    return metricKey;
  }
  return undefined;
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
  const oldIdentifiers = collectMetricIdentifiers(oldMetric);
  const nextLabel = resolveMetricLabel(newMetric);
  const nextKey =
    resolveMetricReferenceKey(newMetric as QueryFormMetric) ||
    (nextLabel !== t('Metric') ? nextLabel : undefined);
  if (!nextKey || oldIdentifiers.size === 0) {
    return { metricFormatting, metricDatabars };
  }
  const replacementMetric = normalizeMetricReferenceValue(newMetric);

  const replaceReference = (metric?: QueryFormMetric) => {
    if (!metric) {
      return metric;
    }
    if (typeof metric === 'string') {
      return oldIdentifiers.has(metric) ? replacementMetric : metric;
    }
    const identifiers = collectMetricIdentifiers(metric as ValueType);
    for (const identifier of identifiers) {
      if (oldIdentifiers.has(identifier)) {
        return replacementMetric;
      }
    }
    return metric;
  };

  const renameMapKey = <T extends Record<string, unknown>>(
    map: Record<string, T>,
  ) => {
    let next = { ...map };
    oldIdentifiers.forEach(identifier => {
      if (identifier && identifier !== nextKey && identifier in next) {
        const existing = next[nextKey];
        const value = next[identifier];
        const merged =
          existing && typeof existing === 'object'
            ? { ...value, ...existing }
            : existing || value;
        next = { ...next, [nextKey]: merged };
        delete next[identifier];
      }
    });
    return next;
  };

  const updatedFormattingBase = renameMapKey(metricFormatting);
  const updatedFormatting = Object.entries(
    updatedFormattingBase,
  ).reduce<PivotMetricFormattingMap>((acc, [key, formatting]) => {
    const nextFormatting = { ...formatting };
    METRIC_FORMATTING_FIELDS.forEach(field => {
      const updatedMetric = replaceReference(formatting[field]);
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
    const nextScaleLike = replaceReference(config.scaleLike);
    const nextColorMetric = replaceReference(config.colorMetric);
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
    const key =
      getFormattingMetricKey(metric as QueryFormMetric | Metric) ||
      resolveMetricKey(metric);
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
    collectMetricIdentifiers(metric).forEach(identifier => {
      if (identifier) {
        keys.add(identifier);
      }
    });
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
      savedMetrics,
    );
  }, [props.formData, props.value, savedMetrics]);
  const metricDatabars = useMemo(() => {
    const rawMetricDatabars =
      (props.formData?.metricDatabars as PivotMetricDatabarMap) || {};
    return normalizeMetricDatabarMapWithKeys(
      rawMetricDatabars,
      ensureIsArray(props.value),
      savedMetrics,
    );
  }, [props.formData, props.value, savedMetrics]);
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
      if (setControlValue) {
        const activeMetricKeys = collectActiveMetricKeys(
          optionValues as ValueType[],
        );
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
            ? getFormattingMetricKey(config.scaleLike as QueryFormMetric)
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
      }
      onChange(multi ? optionValues : optionValues[0]);
    },
    [multi, onChange, setControlValue],
  );

  const [value, setValue] = useState<ValueType[]>(
    coerceMetrics(
      props.value as QueryFormMetric | QueryFormMetric[] | null,
      savedMetrics,
      props.columns,
    ),
  );
  const [droppedItem, setDroppedItem] = useState<
    DatasourcePanelDndItem | typeof EMPTY_OBJECT
  >({});
  const [newMetricPopoverVisible, setNewMetricPopoverVisible] = useState(false);

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

  const handleMetricFormattingChange = useCallback(
    (
      metricKey: string,
      field: keyof PivotMetricFormatting,
      metric?: QueryFormMetric,
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
              ? getFormattingMetricKey(config.scaleLike as QueryFormMetric)
              : undefined;
            if (scaleLikeKey) {
              acc.sources.add(key);
              acc.targets.add(scaleLikeKey);
            }
            return acc;
          },
          { sources: new Set(), targets: new Set() },
        );
        const targetKey = getFormattingMetricKey(
          nextValue as QueryFormMetric | Metric,
        );
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
    [handleChange, setControlValue, value],
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
        columns={props.columns}
        savedMetrics={savedMetrics}
        savedMetricsOptions={getSavedMetricOptionsForMetric(index)}
        availableMetrics={availableMetrics}
        selectedMetrics={value}
        metricFormatting={localMetricFormatting}
        onMetricFormattingChange={handleMetricFormattingChange}
        metricDatabars={localMetricDatabars}
        onMetricDatabarChange={handleMetricDatabarChange}
        datasource={props.datasource}
        onMoveLabel={moveLabel}
        onDropLabel={handleDropLabel}
        type={`${DndItemType.AdhocMetricOption}_${props.name}_${props.label}`}
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
      moveLabel,
      multi,
      value,
      onMetricEdit,
      onRemoveMetric,
      props.columns,
      props.datasource,
      props.label,
      props.name,
      savedMetrics,
    ],
  );

  const valuesRenderer = useCallback(
    () => value.map((value, index) => valueRenderer(value, index)),
    [value, valueRenderer],
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
