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
import { useControlMap } from '../useControlMap';
import { normalizeEditorMetric, disallowsAdhocMetrics } from '../metricInput';
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
  DndSelectLabel as PivotDndSelectLabel,
} from '../../exploreImports';
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
type AdhocMetricInput = ConstructorParameters<typeof AdhocMetric>[0];
type AdhocMetricColumn = NonNullable<AdhocMetricInput['column']>;

const toAdhocMetricColumn = (column: ColumnMeta): AdhocMetricColumn => ({
  ...column,
  column_name: column.column_name,
  verbose_name: column.verbose_name ?? undefined,
});

const toAdhocMetricInput = (
  metric: Exclude<QueryFormMetric, string>,
): AdhocMetricInput => metric as AdhocMetricInput;

const isDictionaryForAdhocMetric = (
  value: QueryFormMetric,
): value is Exclude<QueryFormMetric, string> =>
  Boolean(value) &&
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
        return new AdhocMetric({
          ...toAdhocMetricInput(metric),
          column: toAdhocMetricColumn(column),
        });
      }
    }
    return new AdhocMetric(toAdhocMetricInput(metric));
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
  const replacementMetric = normalizeEditorMetric(newMetric);

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

type MeasureEditor = {
  open: boolean;
  metricKey: string | null;
  metricLabel: string;
  operator: MeasureLeafOperator;
  offsetN: number;
  offsetUnit: MeasureLeafOffsetUnit;
  offsetDirection: MeasureLeafOffsetDirection;
  custom: boolean;
  customLabel: string;
  customMetric?: QueryFormMetric;
  customOffset: boolean;
  error?: string;
};
const INITIAL_MEASURE_EDITOR: MeasureEditor = {
  open: false,
  metricKey: null,
  metricLabel: '',
  operator: 'ix',
  offsetN: 1,
  offsetUnit: 'year',
  offsetDirection: 'past',
  custom: false,
  customLabel: '',
  customOffset: false,
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
  const formattingControl = useControlMap(
    'metricFormatting',
    metricFormatting,
    setControlValue,
  );
  const databarControl = useControlMap(
    'metricDatabars',
    metricDatabars,
    setControlValue,
  );
  const {
    value: localMetricFormatting,
    read: readMetricFormatting,
    replace: commitFormatting,
    update: updateFormatting,
  } = formattingControl;
  const {
    value: localMetricDatabars,
    read: readMetricDatabars,
    replace: commitDatabars,
    update: updateDatabar,
  } = databarControl;

  const disallowAdhocMetrics = disallowsAdhocMetrics(datasource?.extra);

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
  const [editor, setEditor] = useState(INITIAL_MEASURE_EDITOR);
  const edit = (patch: Partial<MeasureEditor>) =>
    setEditor(previous => ({ ...previous, ...patch }));

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
      if (setControlValue !== undefined) {
        const activeMetricKeys = collectActiveMetricKeys(
          optionValues as ValueType[],
        );
        Object.entries(nextLeaves).forEach(([metricKey, leaves]) => {
          leaves.forEach(leaf => {
            activeMetricKeys.add(buildMeasureLeafOutputKey(metricKey, leaf));
          });
        });
        const baseFormatting = readMetricFormatting() || {};
        const nextFormatting = Object.fromEntries(
          Object.entries(baseFormatting).filter(([key]) =>
            activeMetricKeys.has(key),
          ),
        ) as PivotMetricFormattingMap;
        if (!isEqual(baseFormatting, nextFormatting)) {
          commitFormatting(nextFormatting);
        }
        const baseDatabars = readMetricDatabars() || {};
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
          commitDatabars(cleanedDatabars);
        }
        if (!isEqual(nextLeaves, measureLeavesRef.current)) {
          updateMeasureLeaves(nextLeaves, true);
        }
      }
      onChange(multi ? optionValues : optionValues[0]);
    },
    [
      multi,
      onChange,
      setControlValue,
      updateMeasureLeaves,
      readMetricFormatting,
      commitFormatting,
      readMetricDatabars,
      commitDatabars,
    ],
  );

  const handleMetricFormattingChange = useCallback(
    (
      metricKey: string,
      field: keyof PivotMetricFormatting,
      metric?: PivotMetricFormattingValue,
    ) => {
      updateFormatting(metricKey, current => {
        const next = { ...current, [field]: metric };
        if (!metric) delete next[field];
        return Object.values(next).some(Boolean) ? next : undefined;
      });
    },
    [updateFormatting],
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
      const baseDatabars = readMetricDatabars() || {};
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
      updateDatabar(metricKey, current => {
        const next: PivotMetricDatabar = { ...current, [field]: nextValue };
        if (field === 'colorMetric')
          next.colorMode = nextValue ? 'byMetric' : 'static';
        if (field === 'colorMode' && nextValue !== 'byMetric')
          delete next.colorMetric;
        return next.type ? next : undefined;
      });
    },
    [setControlValue, value, readMetricDatabars, updateDatabar],
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
      setEditor({
        ...INITIAL_MEASURE_EDITOR,
        open: true,
        metricKey,
        metricLabel,
      });
    },
    [],
  );
  const closeMeasureSelector = () => edit({ open: false, error: undefined });

  const handleSaveMeasureLeaf = () => {
    if (!editor.metricKey) {
      return;
    }
    edit({ error: undefined });
    const offset = {
      n: editor.offsetN,
      unit: editor.offsetUnit,
      direction: editor.offsetDirection,
    };
    const nextLeaf = editor.custom
      ? (() => {
          const label = editor.customLabel.trim();
          if (!label) {
            edit({ error: t('Custom label is empty.') });
            return null;
          }
          if (!editor.customMetric) {
            edit({ error: t('Select a custom measure.') });
            return null;
          }
          if (isPivotExcelFormula(editor.customMetric)) {
            edit({ error: t('Custom Excel is not supported here.') });
            return null;
          }
          const normalizedMetric = normalizeEditorMetric(
            editor.customMetric as ValueType,
          );
          return buildCustomLeaf({
            label,
            metric: normalizedMetric,
            offset: editor.customOffset ? offset : undefined,
          });
        })()
      : buildBuiltInLeaf(editor.operator, offset);
    if (!nextLeaf) {
      return;
    }
    const leaves = measureLeavesRef.current[editor.metricKey] ?? [
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
        [editor.metricKey]: nextLeaves,
      },
      true,
    );
    closeMeasureSelector();
  };

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
        disallowAdhocMetrics &&
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
    [disallowAdhocMetrics, savedMetricSet, value],
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
      if (
        oldMetric instanceof AdhocMetric &&
        changedMetric instanceof AdhocMetric &&
        oldMetric.equals(changedMetric)
      ) {
        return;
      }
      if (setControlValue !== undefined) {
        const baseFormatting = readMetricFormatting() || {};
        const baseDatabars = readMetricDatabars() || {};
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
          commitFormatting(nextFormatting);
        }
        if (!isEqual(baseDatabars, nextDatabars)) {
          commitDatabars(nextDatabars);
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
    [
      handleChange,
      setControlValue,
      updateMeasureLeaves,
      value,
      readMetricFormatting,
      readMetricDatabars,
      commitFormatting,
      commitDatabars,
    ],
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
    const normalized = value.map(normalizeEditorMetric);
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
        column: toAdhocMetricColumn(itemValue),
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
  const leafPreviewLabel = editor.custom
    ? editor.customLabel.trim() || t('Custom')
    : buildMeasureLeafLabel(editor.operator, {
        n: editor.offsetN,
        unit: editor.offsetUnit,
        direction: editor.offsetDirection,
      });
  const canSaveMeasureLeaf =
    !!editor.metricKey &&
    (!editor.custom ||
      (editor.customLabel.trim().length > 0 && !!editor.customMetric));

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
        show={editor.open}
        onHide={closeMeasureSelector}
        onHandledPrimaryAction={handleSaveMeasureLeaf}
        primaryButtonName={t('Save')}
        disablePrimaryButton={!canSaveMeasureLeaf}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {t('Metric: %s', editor.metricLabel)}
          </Typography.Text>
          <Space align="center" size={8}>
            <Switch
              checked={editor.custom}
              onChange={checked => {
                edit({ custom: checked, error: undefined });
              }}
            />
            <Typography.Text>{t('Custom measure')}</Typography.Text>
          </Space>
          {editor.custom ? (
            <>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text>{t('Custom label')}</Typography.Text>
                <Input
                  aria-label={t('Custom label')}
                  placeholder={t('Label')}
                  value={editor.customLabel}
                  onChange={event => edit({ customLabel: event.target.value })}
                />
              </Space>
              <MetricFormatSelector
                enableExcel
                allowExcel={false}
                label={t('Measure')}
                tooltip={t('Metric used for this custom measure.')}
                value={editor.customMetric}
                metrics={measureSelectorMetrics}
                onChange={metric => {
                  if (metric && isPivotExcelFormula(metric)) {
                    return;
                  }
                  edit({ customMetric: metric, error: undefined });
                }}
                columns={props.columns}
                savedMetrics={savedMetrics}
                datasource={props.datasource}
                allowCustomSql={!disallowAdhocMetrics}
                allowSavedMetrics
              />
              <Space align="center" size={8}>
                <Switch
                  checked={editor.customOffset}
                  onChange={checked => edit({ customOffset: checked })}
                />
                <Typography.Text>{t('Apply time offset')}</Typography.Text>
              </Space>
            </>
          ) : (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text>{t('Operation')}</Typography.Text>
              <Select
                ariaLabel={t('Operation')}
                options={LEAF_OPERATOR_OPTIONS}
                value={editor.operator}
                onChange={value =>
                  edit({ operator: value as MeasureLeafOperator })
                }
                css={{ width: 220 }}
              />
            </Space>
          )}
          {(!editor.custom || editor.customOffset) && (
            <>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text>{t('Period')}</Typography.Text>
                <Space size={8}>
                  <InputNumber
                    min={1}
                    value={editor.offsetN}
                    onChange={value =>
                      edit({
                        offsetN:
                          typeof value === 'number' && value > 0 ? value : 1,
                      })
                    }
                  />
                  <Select
                    ariaLabel={t('Period unit')}
                    options={LEAF_UNIT_OPTIONS}
                    value={editor.offsetUnit}
                    onChange={value =>
                      edit({ offsetUnit: value as MeasureLeafOffsetUnit })
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
                  value={editor.offsetDirection}
                  onChange={event =>
                    edit({
                      offsetDirection: event.target
                        .value as MeasureLeafOffsetDirection,
                    })
                  }
                />
              </Space>
            </>
          )}
          {editor.error && (
            <Typography.Text type="danger">{editor.error}</Typography.Text>
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
