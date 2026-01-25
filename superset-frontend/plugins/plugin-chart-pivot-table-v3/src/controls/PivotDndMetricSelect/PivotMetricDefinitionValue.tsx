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
  ReactNode,
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  getCategoricalSchemeRegistry,
  getMetricLabel,
  Metric,
  QueryFormMetric,
  styled,
  t,
  useTheme,
} from '@superset-ui/core';
import {
  Button,
  ColorPicker,
  type ColorValue,
  Divider,
  InfoTooltip,
  Input,
  EmptyState,
  Popover,
  Select,
  Space,
  Tooltip,
  Typography,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import Tabs from '@superset-ui/core/components/Tabs';
import { ColumnMeta } from '@superset-ui/chart-controls';
import {
  AdhocMetric,
  AdhocMetricPopoverTrigger,
  type savedMetricType,
} from '../../exploreImports';
import MetricDefinitionValue from './MetricDefinitionValue';
import {
  MetricFormattingField,
  PivotDatabarType,
  PivotMetricDatabar,
  PivotMetricDatabarMap,
  PivotExcelFormula,
  PivotMetricFormatting,
  PivotMetricFormattingMap,
  PivotMetricFormattingValue,
} from '../../types';
import {
  DEFAULT_DATABAR_NEGATIVE_COLOR,
  DEFAULT_DATABAR_POSITIVE_COLOR,
  getFormattingMetricKey,
  getMetricKey,
} from '../../utils';
import {
  isPivotExcelFormula,
  normalizePivotExcelFormula,
} from '../../pivot/formatting/excelFormulaReferences';
import { validateExcelFormula } from '../../pivot/formatting/excelFormula';

const MetricFormattingButton = styled(Button)`
  height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-width: ${({ theme }) => theme.sizeUnit * 5}px;
  width: ${({ theme }) => theme.sizeUnit * 5}px;
  padding: 0;
`;

const MetricFormattingButtonWrap = styled.div`
  display: flex;
  align-items: center;
  padding-right: ${({ theme }) => theme.sizeUnit}px;
`;

const MeasureLeafButton = styled(Button)`
  height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-width: ${({ theme }) => theme.sizeUnit * 5}px;
  width: ${({ theme }) => theme.sizeUnit * 5}px;
  padding: 0;
  font-weight: ${({ theme }) => theme.fontWeightStrong};
`;

type ValueType = Metric | AdhocMetric | QueryFormMetric | PivotExcelFormula;
type SavedMetric = savedMetricType & { error_text?: string };
type AdhocMetricPopoverDatasource = ComponentProps<
  typeof AdhocMetricPopoverTrigger
>['datasource'];

const rgbToHex = (color: ColorValue): string => {
  const { r, g, b, a = 1 } = color.toRgb();
  const toHex = (value: number) => {
    const hex = Math.round(value).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  if (a !== 1) {
    return `${base}${toHex(Math.round(a * 255))}`;
  }
  return base;
};

const DATABAR_TYPE_OPTIONS: Array<{
  label: string;
  value: PivotDatabarType | 'none';
}> = [
  { label: t('None'), value: 'none' },
  { label: t('Filled bar'), value: 'bar' },
  { label: t('Lollipop bar'), value: 'lollipop' },
  { label: t('Waterfall'), value: 'waterfall' },
];

export type MetricSelectValue = {
  value: string | number;
  label?: string;
};

export type MetricOptionValue = ValueType | MetricSelectValue;

type PivotMetricDefinitionValueProps = {
  option: ValueType;
  index: number;
  onMetricEdit: (
    changedMetric: Metric | AdhocMetric,
    oldMetric: Metric | AdhocMetric,
  ) => void;
  onRemoveMetric: (index: number) => void;
  onMoveLabel: (dragIndex: number, hoverIndex: number) => void;
  onDropLabel: () => void;
  onAddMeasureLeaf?: (metricKey: string, metricLabel: string) => void;
  columns: ColumnMeta[];
  savedMetrics: Metric[];
  savedMetricsOptions: savedMetricType[];
  availableMetrics: ValueType[];
  selectedMetrics: ValueType[];
  metricFormatting: PivotMetricFormattingMap;
  onMetricFormattingChange: (
    metricKey: string,
    field: keyof PivotMetricFormatting,
    metric?: PivotMetricFormattingValue,
  ) => void;
  metricDatabars: PivotMetricDatabarMap;
  onMetricDatabarChange: (
    metricKey: string,
    field: keyof PivotMetricDatabar,
    value?: PivotMetricDatabar[keyof PivotMetricDatabar],
  ) => void;
  multi?: boolean;
  datasource?: AdhocMetricPopoverDatasource;
  datasourceWarningMessage?: string;
  type?: string;
};

const isMetricSelectValue = (option: unknown): option is MetricSelectValue =>
  typeof option === 'object' && option !== null && 'value' in option;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getSelectValueKey = (option: unknown) => {
  if (typeof option === 'string' || typeof option === 'number') {
    return String(option);
  }
  if (isMetricSelectValue(option)) {
    const rawValue = option.value;
    if (typeof rawValue === 'string' || typeof rawValue === 'number') {
      return String(rawValue);
    }
  }
  return undefined;
};

const EXCEL_FORMULA_OPTION_PREFIX = '__excel__';

const hashString = (input: string): string => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

const formatExcelFormulaLabel = (formula: string): string => {
  const trimmed = formula.trim();
  const maxLen = 48;
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLen - 1)}…`;
};

const getExcelFormulaOptionValue = (formula: PivotExcelFormula): string =>
  `${EXCEL_FORMULA_OPTION_PREFIX}:${hashString(formula.formula)}`;

const resolveMetricLabel = (option: MetricOptionValue) => {
  if (isMetricSelectValue(option)) {
    if (typeof option.label === 'string' && option.label.length > 0) {
      return option.label;
    }
    const key = getSelectValueKey(option);
    return key || t('Metric');
  }
  if (isPivotExcelFormula(option)) {
    return `${t('Custom Excel')}: ${formatExcelFormulaLabel(option.formula)}`;
  }
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

const resolveMetricKey = (option: MetricOptionValue) => {
  const selectKey = getSelectValueKey(option);
  if (selectKey) {
    return selectKey;
  }
  if (isPivotExcelFormula(option)) {
    return getExcelFormulaOptionValue(option);
  }
  if (isMetricSelectValue(option)) {
    return undefined;
  }
  return getMetricKey(option as QueryFormMetric | Metric);
};

const isIxMetricIdentifier = (value?: string) => {
  if (!value) {
    return false;
  }
  const lowered = value.toLowerCase();
  if (lowered.includes('__calc__ix:') || lowered.includes('__mleaf__ix:')) {
    return true;
  }
  return /\bix\b/i.test(value);
};

const getMetricOptionValue = (
  option: MetricOptionValue,
): string | undefined => {
  const selectValue = getSelectValueKey(option);
  if (selectValue) {
    return selectValue;
  }
  if (isPivotExcelFormula(option)) {
    return getExcelFormulaOptionValue(option);
  }
  if (option instanceof AdhocMetric) {
    if (typeof option.optionName === 'string' && option.optionName.length > 0) {
      return option.optionName;
    }
    const label = resolveMetricLabel(option);
    return label !== t('Metric') ? label : undefined;
  }
  if (isRecord(option) && !isMetricSelectValue(option)) {
    const optionRecord = option as Record<string, unknown>;
    const { optionName } = optionRecord;
    if (typeof optionName === 'string' && optionName.length > 0) {
      return optionName;
    }
    if ('metric_name' in optionRecord) {
      const metricName = optionRecord.metric_name;
      if (typeof metricName === 'string' && metricName.length > 0) {
        return metricName;
      }
    }
  }
  const key = resolveMetricKey(option);
  return key || undefined;
};

type MetricOption = {
  label: string;
  value: string;
  metric: MetricOptionValue;
};

const buildMetricOptions = (metrics: MetricOptionValue[]) => {
  const seen = new Set<string>();
  return metrics.reduce<MetricOption[]>((acc, metric) => {
    const label = resolveMetricLabel(metric);
    const value =
      getMetricOptionValue(metric) || (label !== t('Metric') ? label : '');
    if (!value || seen.has(value)) {
      return acc;
    }
    seen.add(value);
    acc.push({
      value,
      label,
      metric,
    });
    return acc;
  }, []);
};

const normalizeFormattingMetric = (
  metric: MetricOptionValue,
): PivotMetricFormattingValue => {
  const selectValueKey = getSelectValueKey(metric);
  if (selectValueKey) {
    return selectValueKey;
  }
  if (isPivotExcelFormula(metric)) {
    return metric;
  }
  if (isRecord(metric) && 'metric_name' in metric) {
    const metricName = metric.metric_name;
    if (typeof metricName === 'string' && metricName.length > 0) {
      return metricName;
    }
  }
  if (metric instanceof AdhocMetric) {
    const normalized: QueryFormMetric = {
      expressionType: metric.expressionType,
      column: metric.column,
      aggregate: metric.aggregate,
      sqlExpression: metric.sqlExpression,
      label: metric.label,
      hasCustomLabel: metric.hasCustomLabel,
      optionName: metric.optionName,
    };
    return normalized;
  }
  if (
    isRecord(metric) &&
    !isMetricSelectValue(metric) &&
    'expressionType' in metric
  ) {
    const adhocMetricValue = metric as Exclude<QueryFormMetric, string>;
    const adhocMetric = new AdhocMetric(adhocMetricValue);
    const rawLabel =
      typeof adhocMetricValue.label === 'string'
        ? adhocMetricValue.label
        : undefined;
    const rawHasCustomLabel =
      typeof adhocMetricValue.hasCustomLabel === 'boolean'
        ? adhocMetricValue.hasCustomLabel
        : undefined;
    const rawOptionName =
      typeof adhocMetricValue.optionName === 'string'
        ? adhocMetricValue.optionName
        : undefined;
    const normalized: QueryFormMetric = {
      expressionType: adhocMetric.expressionType,
      column: adhocMetric.column,
      aggregate: adhocMetric.aggregate,
      sqlExpression: adhocMetric.sqlExpression,
      label: rawLabel || adhocMetric.label,
      hasCustomLabel: rawHasCustomLabel ?? adhocMetric.hasCustomLabel,
      optionName: rawOptionName,
    };
    return normalized;
  }
  return metric as QueryFormMetric;
};

const FORMAT_SELECTOR_CONFIG: Array<{
  field: MetricFormattingField;
  label: string;
  tooltip: ReactNode;
}> = [
  {
    field: 'backgroundColor',
    label: t('Background color metric'),
    tooltip: t(
      "Metric that returns a color for the cell background (HEX, RGB, or RGBA). Example: '#111111'.",
    ),
  },
  {
    field: 'textColor',
    label: t('Text color metric'),
    tooltip: t(
      "Metric that returns a color for the cell text (HEX, RGB, or RGBA). Example: '#ffffff'.",
    ),
  },
  {
    field: 'd3Format',
    label: t('D3 format string metric'),
    tooltip: t(
      "Metric that returns a d3-format string used to render values. Example: '.2f'.",
    ),
  },
];

const METRIC_SELECT_WIDTH = 220;

type MetricFormatSelectorSharedProps = {
  label: string;
  tooltip: ReactNode;
  metrics: MetricOptionValue[];
  disabled?: boolean;
  columns: ColumnMeta[];
  savedMetrics: Metric[];
  datasource?: AdhocMetricPopoverDatasource;
  allowCustomSql?: boolean;
  allowSavedMetrics?: boolean;
  excelOnly?: boolean;
};

type MetricFormatSelectorProps =
  | (MetricFormatSelectorSharedProps & {
      enableExcel: true;
      value?: MetricOptionValue;
      onChange: (metric?: PivotMetricFormattingValue) => void;
    })
  | (MetricFormatSelectorSharedProps & {
      enableExcel?: false;
      value?: MetricOptionValue;
      onChange: (metric?: QueryFormMetric) => void;
    });

export const MetricFormatSelector = (props: MetricFormatSelectorProps) => {
  const { label, tooltip, value, metrics, columns, savedMetrics, datasource } =
    props;
  const disabled = props.disabled ?? false;
  const enableExcel = props.enableExcel === true;
  const excelOnly = props.excelOnly === true;
  const allowCustomSql = !excelOnly && (props.allowCustomSql ?? true);
  const allowSavedMetrics = !excelOnly && (props.allowSavedMetrics ?? true);

  const handleChangeValue = useCallback(
    (next?: PivotMetricFormattingValue) => {
      if (excelOnly && next && !isPivotExcelFormula(next)) {
        return;
      }
      if (props.enableExcel) {
        props.onChange(next);
        return;
      }
      if (next && isPivotExcelFormula(next)) {
        return;
      }
      props.onChange(next);
    },
    [props],
  );

  const options = useMemo(() => {
    const baseMetrics = excelOnly
      ? metrics.filter(isPivotExcelFormula)
      : metrics;
    return buildMetricOptions(value ? [...baseMetrics, value] : baseMetrics);
  }, [excelOnly, metrics, value]);
  const popoverColumns = useMemo(
    () =>
      columns.map(column => ({
        column_name: column.column_name,
        type: column.type ?? '',
      })),
    [columns],
  );
  const savedMetricsForPopover = useMemo<savedMetricType[]>(
    () =>
      savedMetrics.map(metric => ({
        metric_name: metric.metric_name,
        verbose_name: metric.verbose_name,
        expression: metric.expression ?? '',
      })),
    [savedMetrics],
  );
  const optionMap = useMemo(
    () => new Map(options.map(option => [option.value, option.metric])),
    [options],
  );
  const selectedValue = useMemo(() => {
    if (!value) {
      return undefined;
    }
    const key = getMetricOptionValue(value);
    if (key) {
      return key;
    }
    const label = resolveMetricLabel(value);
    return label !== t('Metric') ? label : undefined;
  }, [value]);
  const datasourceForPopover = datasource;
  const savedMetricForPopover = useMemo(() => {
    if (typeof value === 'string') {
      const savedMetric = savedMetrics.find(
        metric => metric.metric_name === value,
      );
      if (savedMetric) {
        return {
          metric_name: savedMetric.metric_name,
          verbose_name: savedMetric.verbose_name,
          expression: savedMetric.expression ?? '',
        };
      }
    }
    if (
      isRecord(value) &&
      'metric_name' in value &&
      typeof value.metric_name === 'string'
    ) {
      const savedMetric = savedMetrics.find(
        metric => metric.metric_name === value.metric_name,
      );
      if (savedMetric) {
        return {
          metric_name: savedMetric.metric_name,
          verbose_name: savedMetric.verbose_name,
          expression: savedMetric.expression ?? '',
        };
      }
    }
    return undefined;
  }, [enableExcel, savedMetrics, value]);
  const savedMetricOptions = useMemo(
    () =>
      savedMetricsForPopover
        .filter(metric => metric.metric_name)
        .map(metric => ({
          value: metric.metric_name,
          label: metric.verbose_name || metric.metric_name,
        })),
    [savedMetricsForPopover],
  );
  const adhocMetricForPopover = useMemo(() => {
    if (enableExcel) {
      return new AdhocMetric({});
    }
    if (value instanceof AdhocMetric) {
      return value;
    }
    if (savedMetricForPopover) {
      return new AdhocMetric({});
    }
    if (
      isRecord(value) &&
      !isMetricSelectValue(value) &&
      'expressionType' in value
    ) {
      const metricValue = value as Exclude<QueryFormMetric, string>;
      const rawLabel = metricValue.label;
      const inferredHasCustomLabel =
        typeof metricValue.hasCustomLabel === 'boolean'
          ? metricValue.hasCustomLabel
          : typeof rawLabel === 'string' && rawLabel.trim().length > 0;
      return new AdhocMetric({
        ...metricValue,
        hasCustomLabel: inferredHasCustomLabel,
      });
    }
    const rawValue = getSelectValueKey(value);
    if (rawValue) {
      return new AdhocMetric({
        expressionType: 'SQL',
        sqlExpression: rawValue,
      });
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return new AdhocMetric({
        expressionType: 'SQL',
        sqlExpression: value,
      });
    }
    return new AdhocMetric({});
  }, [enableExcel, savedMetricForPopover, value]);

  const disallowAdhocMetrics = useMemo(() => {
    const rawExtra = datasource?.extra;
    if (!rawExtra) {
      return false;
    }
    if (typeof rawExtra === 'string') {
      try {
        const parsed = JSON.parse(rawExtra) as {
          disallow_adhoc_metrics?: boolean;
        };
        return Boolean(parsed.disallow_adhoc_metrics);
      } catch {
        return false;
      }
    }
    if (typeof rawExtra === 'object') {
      const parsed = rawExtra as {
        disallow_adhoc_metrics?: boolean;
      };
      return Boolean(parsed.disallow_adhoc_metrics);
    }
    return false;
  }, [datasource?.extra]);

  const addMetricButton = (
    <Tooltip title={t('Add metric')}>
      <Button
        aria-label={t('Add metric')}
        icon={<Icons.PlusOutlined iconSize="s" />}
        size="small"
        type="text"
        disabled={disabled || (!datasourceForPopover && !enableExcel)}
      />
    </Tooltip>
  );

  const [customMetricPopoverOpen, setCustomMetricPopoverOpen] = useState(false);
  const [customMetricTab, setCustomMetricTab] = useState<
    'sql' | 'excel' | 'saved'
  >('sql');
  const [customSqlLabel, setCustomSqlLabel] = useState('');
  const [customSqlExpression, setCustomSqlExpression] = useState('');
  const [customExcelFormula, setCustomExcelFormula] = useState('');
  const [customSavedMetricName, setCustomSavedMetricName] = useState('');
  const [customMetricError, setCustomMetricError] = useState<string>();

  useEffect(() => {
    if (customMetricTab === 'saved' && !allowSavedMetrics) {
      setCustomMetricTab('excel');
    }
    if (customMetricTab === 'sql' && !allowCustomSql) {
      setCustomMetricTab('excel');
    }
  }, [allowCustomSql, allowSavedMetrics, customMetricTab]);

  const openCustomMetricPopover = useCallback(() => {
    setCustomMetricError(undefined);
    if (isPivotExcelFormula(value)) {
      setCustomMetricTab('excel');
      setCustomExcelFormula(value.formula);
      setCustomSqlExpression('');
      setCustomSqlLabel('');
      setCustomSavedMetricName('');
      return;
    }
    if (
      allowSavedMetrics &&
      ((typeof value === 'string' && value.length > 0) ||
        (isRecord(value) &&
          'metric_name' in value &&
          typeof value.metric_name === 'string'))
    ) {
      const metricName =
        typeof value === 'string'
          ? value
          : (value.metric_name as string | undefined);
      if (
        metricName &&
        savedMetricsForPopover.some(metric => metric.metric_name === metricName)
      ) {
        setCustomMetricTab('saved');
        setCustomSavedMetricName(metricName);
        setCustomExcelFormula('');
        setCustomSqlExpression('');
        setCustomSqlLabel('');
        return;
      }
    }
    if (
      allowCustomSql &&
      isRecord(value) &&
      !isMetricSelectValue(value) &&
      'expressionType' in value &&
      value.expressionType === 'SQL'
    ) {
      const sqlExpression =
        typeof value.sqlExpression === 'string' ? value.sqlExpression : '';
      setCustomMetricTab(
        disallowAdhocMetrics || !allowCustomSql ? 'excel' : 'sql',
      );
      setCustomSqlExpression(sqlExpression);
      setCustomSqlLabel(typeof value.label === 'string' ? value.label : '');
      setCustomExcelFormula('');
      setCustomSavedMetricName('');
      return;
    }
    if (allowSavedMetrics && savedMetricOptions.length > 0) {
      setCustomMetricTab('saved');
    } else if (disallowAdhocMetrics || !allowCustomSql) {
      setCustomMetricTab('excel');
    } else {
      setCustomMetricTab('sql');
    }
    setCustomSqlExpression('');
    setCustomSqlLabel('');
    setCustomExcelFormula('');
    setCustomSavedMetricName('');
  }, [
    allowCustomSql,
    allowSavedMetrics,
    disallowAdhocMetrics,
    savedMetricOptions,
    savedMetricsForPopover,
    value,
  ]);

  const closeCustomMetricPopover = useCallback(() => {
    setCustomMetricPopoverOpen(false);
    setCustomMetricError(undefined);
  }, []);

  const saveCustomExcelFormula = useCallback(() => {
    const normalized = normalizePivotExcelFormula({
      kind: 'excel',
      formula: customExcelFormula,
    });
    if (!normalized) {
      setCustomMetricError(t('Custom Excel formula is empty.'));
      return;
    }
    const validation = validateExcelFormula(normalized.formula);
    if (!validation.valid) {
      setCustomMetricError(validation.message);
      return;
    }
    handleChangeValue(normalized);
    closeCustomMetricPopover();
  }, [closeCustomMetricPopover, customExcelFormula, handleChangeValue]);

  const saveCustomSqlMetric = useCallback(() => {
    if (!datasourceForPopover) {
      return;
    }
    if (disallowAdhocMetrics || !allowCustomSql) {
      return;
    }
    const sqlExpression = customSqlExpression.trim();
    if (!sqlExpression) {
      setCustomMetricError(t('Custom SQL expression is empty.'));
      return;
    }
    const labelValue = customSqlLabel.trim();
    const metric = new AdhocMetric({
      expressionType: 'SQL',
      sqlExpression,
      ...(labelValue ? { label: labelValue, hasCustomLabel: true } : {}),
    });
    handleChangeValue(normalizeFormattingMetric(metric));
    closeCustomMetricPopover();
  }, [
    allowCustomSql,
    closeCustomMetricPopover,
    customSqlExpression,
    customSqlLabel,
    datasourceForPopover,
    disallowAdhocMetrics,
    handleChangeValue,
  ]);
  const saveCustomSavedMetric = useCallback(() => {
    if (!customSavedMetricName) {
      setCustomMetricError(t('Select a saved metric.'));
      return;
    }
    handleChangeValue(customSavedMetricName);
    closeCustomMetricPopover();
  }, [closeCustomMetricPopover, customSavedMetricName, handleChangeValue]);

  const canSaveCustomSql =
    allowCustomSql &&
    !disabled &&
    Boolean(datasourceForPopover) &&
    !disallowAdhocMetrics;
  const canSaveCustomExcel = !disabled;
  const canSaveCustomSaved =
    allowSavedMetrics && !disabled && Boolean(customSavedMetricName);

  const customMetricPopoverContent = (
    <div data-ignore-control-popover>
      <Space direction="vertical" size={8}>
        <Tabs
          activeKey={customMetricTab}
          onChange={key => setCustomMetricTab(key as 'sql' | 'excel' | 'saved')}
          items={[
            ...(allowSavedMetrics
              ? [
                  {
                    key: 'saved',
                    label: t('Saved'),
                    children:
                      savedMetricOptions.length > 0 ? (
                        <Space direction="vertical" size={8}>
                          <Select
                            ariaLabel={t('Saved metric')}
                            placeholder={t('Select a saved metric')}
                            options={savedMetricOptions}
                            value={customSavedMetricName || undefined}
                            onChange={nextValue =>
                              setCustomSavedMetricName(
                                typeof nextValue === 'string' ? nextValue : '',
                              )
                            }
                            allowClear
                          />
                        </Space>
                      ) : (
                        <EmptyState
                          image="empty.svg"
                          size="small"
                          title={t('No saved metrics found')}
                          description={t(
                            'Add metrics to dataset in "Edit datasource" modal',
                          )}
                        />
                      ),
                  },
                ]
              : []),
            ...(allowCustomSql
              ? [
                  {
                    key: 'sql',
                    label: disallowAdhocMetrics ? (
                      <Tooltip
                        title={t(
                          'Custom SQL ad-hoc metrics are not enabled for this dataset',
                        )}
                      >
                        {t('Custom SQL')}
                      </Tooltip>
                    ) : (
                      t('Custom SQL')
                    ),
                    disabled: !datasourceForPopover || disallowAdhocMetrics,
                    children: (
                      <Space direction="vertical" size={8}>
                        <Input
                          aria-label={t('Metric label')}
                          placeholder={t('Optional metric label')}
                          value={customSqlLabel}
                          onChange={event =>
                            setCustomSqlLabel(event.target.value)
                          }
                        />
                        <Input.TextArea
                          aria-label={t('Custom SQL')}
                          placeholder={t('SQL expression')}
                          autoSize={{ minRows: 3, maxRows: 8 }}
                          value={customSqlExpression}
                          onChange={event =>
                            setCustomSqlExpression(event.target.value)
                          }
                        />
                      </Space>
                    ),
                  },
                ]
              : []),
            {
              key: 'excel',
              label: t('Custom Excel'),
              children: (
                <Space direction="vertical" size={8}>
                  <Typography.Text type="secondary">
                    {t(
                      "Use 'value' for the current measure value and [metric] to reference another metric value.",
                    )}
                  </Typography.Text>
                  <Input.TextArea
                    aria-label={t('Custom Excel')}
                    placeholder={t('Excel formula')}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    value={customExcelFormula}
                    onChange={event =>
                      setCustomExcelFormula(event.target.value)
                    }
                  />
                </Space>
              ),
            },
          ]}
        />
        {customMetricError && (
          <Typography.Text type="danger">{customMetricError}</Typography.Text>
        )}
        <Space size={8}>
          <Button
            size="small"
            buttonStyle="secondary"
            onClick={closeCustomMetricPopover}
          >
            {t('Close')}
          </Button>
          <Button
            size="small"
            buttonStyle="primary"
            disabled={
              customMetricTab === 'excel'
                ? !canSaveCustomExcel
                : customMetricTab === 'saved'
                  ? !canSaveCustomSaved
                  : !canSaveCustomSql
            }
            onClick={
              customMetricTab === 'excel'
                ? saveCustomExcelFormula
                : customMetricTab === 'saved'
                  ? saveCustomSavedMetric
                  : saveCustomSqlMetric
            }
          >
            {t('Save')}
          </Button>
        </Space>
      </Space>
    </div>
  );

  const addMetricPopover = enableExcel ? (
    <Popover
      content={customMetricPopoverContent}
      overlayStyle={{ width: 360 }}
      trigger="click"
      placement="right"
      getPopupContainer={() => document.body}
      open={customMetricPopoverOpen}
      onOpenChange={open => {
        if (open) {
          openCustomMetricPopover();
        }
        setCustomMetricPopoverOpen(open);
      }}
    >
      {addMetricButton}
    </Popover>
  ) : datasourceForPopover ? (
    <AdhocMetricPopoverTrigger
      adhocMetric={adhocMetricForPopover}
      onMetricEdit={newMetric =>
        handleChangeValue(normalizeFormattingMetric(newMetric))
      }
      columns={popoverColumns}
      savedMetricsOptions={savedMetricsForPopover}
      savedMetric={savedMetricForPopover || { metric_name: '', expression: '' }}
      datasource={datasourceForPopover}
      isNew
    >
      {addMetricButton}
    </AdhocMetricPopoverTrigger>
  ) : (
    addMetricButton
  );

  return (
    <Space direction="vertical" size={4}>
      <Space align="center" size={4}>
        <Typography.Text>{label}</Typography.Text>
        <InfoTooltip tooltip={tooltip} />
      </Space>
      <Space size={8} align="start">
        <Select
          allowClear
          allowNewOptions={!excelOnly}
          ariaLabel={label}
          placeholder={t('Select a metric')}
          css={{ width: METRIC_SELECT_WIDTH }}
          disabled={disabled}
          value={selectedValue}
          options={options.map(option => ({
            label: option.label,
            value: option.value,
          }))}
          onChange={nextValue => {
            if (!nextValue) {
              handleChangeValue(undefined);
              return;
            }
            const nextValueKey = getSelectValueKey(nextValue);
            if (!nextValueKey) {
              handleChangeValue(undefined);
              return;
            }
            const nextMetric = optionMap.get(nextValueKey);
            handleChangeValue(
              normalizeFormattingMetric(nextMetric ?? nextValueKey),
            );
          }}
          onClear={() => handleChangeValue(undefined)}
          showSearch
          optionFilterProps={['label', 'value']}
        />
        {addMetricPopover}
      </Space>
    </Space>
  );
};

export default function PivotMetricDefinitionValue(
  props: PivotMetricDefinitionValueProps,
) {
  const theme = useTheme();
  const {
    metricDatabars,
    metricFormatting,
    onMetricDatabarChange,
    onMetricFormattingChange,
    option,
    savedMetrics,
  } = props;
  const defaultPositiveColor =
    theme.colorSuccess || DEFAULT_DATABAR_POSITIVE_COLOR;
  const defaultNegativeColor =
    theme.colorError || DEFAULT_DATABAR_NEGATIVE_COLOR;
  const metricLabel = useMemo(() => resolveMetricLabel(option), [option]);
  const metricKey = useMemo(() => {
    const key = resolveMetricKey(option);
    if (key) {
      return key;
    }
    return metricLabel !== t('Metric') ? metricLabel : '';
  }, [metricLabel, option]);
  const isIxMetric = useMemo(
    () => isIxMetricIdentifier(metricLabel) || isIxMetricIdentifier(metricKey),
    [metricKey, metricLabel],
  );
  const handleAddMeasureLeaf = useCallback(() => {
    if (!metricKey || metricLabel === t('Metric')) {
      return;
    }
    props.onAddMeasureLeaf?.(metricKey, metricLabel);
  }, [metricKey, metricLabel, props]);
  const presetColors = useMemo(() => {
    const categoricalScheme = getCategoricalSchemeRegistry().get();
    return categoricalScheme?.colors.slice(0, 9) || [];
  }, []);
  const formattingKey = useMemo(() => {
    const candidateKeys = [metricKey, metricLabel].filter(
      (candidate): candidate is string => !!candidate,
    );
    const savedMetricMatch = savedMetrics.find(metric => {
      if (
        metric.metric_name === metricKey ||
        metric.metric_name === metricLabel
      ) {
        return true;
      }
      if (
        metric.verbose_name === metricKey ||
        metric.verbose_name === metricLabel
      ) {
        return true;
      }
      return false;
    });
    if (savedMetricMatch) {
      if (savedMetricMatch.metric_name) {
        candidateKeys.push(savedMetricMatch.metric_name);
      }
      if (savedMetricMatch.verbose_name) {
        candidateKeys.push(savedMetricMatch.verbose_name);
      }
    }
    if (typeof option === 'object' && option !== null) {
      if ('metric_name' in option && typeof option.metric_name === 'string') {
        candidateKeys.push(option.metric_name);
      }
      if ('label' in option && typeof option.label === 'string') {
        candidateKeys.push(option.label);
      }
      if ('verbose_name' in option && typeof option.verbose_name === 'string') {
        candidateKeys.push(option.verbose_name);
      }
    }
    return candidateKeys.find(key => metricFormatting[key]) || metricKey;
  }, [metricFormatting, metricKey, metricLabel, option, savedMetrics]);
  const databarKey = useMemo(() => {
    const candidateKeys = [metricKey, metricLabel].filter(
      (candidate): candidate is string => !!candidate,
    );
    const savedMetricMatch = savedMetrics.find(metric => {
      if (
        metric.metric_name === metricKey ||
        metric.metric_name === metricLabel
      ) {
        return true;
      }
      if (
        metric.verbose_name === metricKey ||
        metric.verbose_name === metricLabel
      ) {
        return true;
      }
      return false;
    });
    if (savedMetricMatch) {
      if (savedMetricMatch.metric_name) {
        candidateKeys.push(savedMetricMatch.metric_name);
      }
      if (savedMetricMatch.verbose_name) {
        candidateKeys.push(savedMetricMatch.verbose_name);
      }
    }
    if (typeof option === 'object' && option !== null) {
      if ('metric_name' in option && typeof option.metric_name === 'string') {
        candidateKeys.push(option.metric_name);
      }
      if ('label' in option && typeof option.label === 'string') {
        candidateKeys.push(option.label);
      }
      if ('verbose_name' in option && typeof option.verbose_name === 'string') {
        candidateKeys.push(option.verbose_name);
      }
    }
    return candidateKeys.find(key => metricDatabars[key]) || metricKey;
  }, [metricDatabars, metricKey, metricLabel, option, savedMetrics]);
  const formatting = (formattingKey && metricFormatting[formattingKey]) || {};
  const databar = (databarKey && metricDatabars[databarKey]) || {};
  const hasFormatting = Boolean(
    formatting.backgroundColor ||
      formatting.textColor ||
      formatting.d3Format ||
      databar.type,
  );
  const handleFormattingChange = useCallback(
    (
      field: keyof PivotMetricFormatting,
      metric?: PivotMetricFormattingValue,
    ) => {
      if (!formattingKey) {
        return;
      }
      onMetricFormattingChange(formattingKey, field, metric);
    },
    [formattingKey, onMetricFormattingChange],
  );
  const handleDatabarChange = useCallback(
    (
      field: keyof PivotMetricDatabar,
      value?: PivotMetricDatabar[keyof PivotMetricDatabar],
    ) => {
      if (!databarKey) {
        return;
      }
      onMetricDatabarChange(databarKey, field, value);
    },
    [databarKey, onMetricDatabarChange],
  );
  const handleDatabarTypeChange = useCallback(
    (value: string) => {
      const nextType =
        value === 'none' ? undefined : (value as PivotDatabarType);
      handleDatabarChange('type', nextType);
      if (nextType) {
        if (!databar.positiveColor) {
          handleDatabarChange('positiveColor', defaultPositiveColor);
        }
        if (!databar.negativeColor) {
          handleDatabarChange('negativeColor', defaultNegativeColor);
        }
      }
    },
    [
      databar.negativeColor,
      databar.positiveColor,
      defaultNegativeColor,
      defaultPositiveColor,
      handleDatabarChange,
    ],
  );
  const databarTypeValue = databar.type ?? 'none';
  const colorMode = databar.colorMode === 'byMetric' ? 'byMetric' : 'static';
  const showDatabarControls = databarTypeValue !== 'none';
  const { scaleLikeSources, scaleLikeTargets } = useMemo(() => {
    const sources = new Set<string>();
    const targets = new Set<string>();
    Object.entries(metricDatabars).forEach(([key, config]) => {
      const targetKey = config.scaleLike
        ? getFormattingMetricKey(config.scaleLike as QueryFormMetric | Metric)
        : undefined;
      if (targetKey) {
        sources.add(key);
        targets.add(targetKey);
      }
    });
    return { scaleLikeSources: sources, scaleLikeTargets: targets };
  }, [metricDatabars]);
  const scaleLikeMetricKey = databarKey || metricKey;
  const scaleLikeDisabled = Boolean(
    scaleLikeMetricKey && scaleLikeTargets.has(scaleLikeMetricKey),
  );
  const scaleLikeMetrics = useMemo(() => {
    if (!scaleLikeMetricKey) {
      return props.selectedMetrics;
    }
    return props.selectedMetrics.filter(metric => {
      const candidateKey =
        getFormattingMetricKey(metric as QueryFormMetric | Metric) ||
        resolveMetricKey(metric as MetricOptionValue);
      if (!candidateKey) {
        return false;
      }
      if (candidateKey === scaleLikeMetricKey) {
        return false;
      }
      if (scaleLikeSources.has(candidateKey)) {
        return false;
      }
      return true;
    });
  }, [props.selectedMetrics, scaleLikeMetricKey, scaleLikeSources]);

  const formattingPopoverContent = (
    <div data-ignore-control-popover>
      <Space direction="vertical" size={8}>
        <Typography.Text strong>{t('Conditional formatting')}</Typography.Text>
        <Typography.Text type="secondary">
          {t('Metric: %s', metricLabel)}
        </Typography.Text>
        {FORMAT_SELECTOR_CONFIG.map(selector => (
          <MetricFormatSelector
            key={selector.field}
            enableExcel
            excelOnly={isIxMetric}
            label={selector.label}
            tooltip={selector.tooltip}
            value={formatting[selector.field]}
            metrics={props.availableMetrics}
            onChange={metric => handleFormattingChange(selector.field, metric)}
            columns={props.columns}
            savedMetrics={props.savedMetrics}
            datasource={props.datasource}
          />
        ))}
        <Divider style={{ margin: 0 }} />
        <Typography.Text strong>{t('Databars')}</Typography.Text>
        <Typography.Text type="secondary">
          {t('Metric: %s', metricLabel)}
        </Typography.Text>
        <Space direction="vertical" size={8}>
          <div>
            <Typography.Text>{t('Databar type')}</Typography.Text>
            <Select
              ariaLabel={t('Databar type')}
              options={DATABAR_TYPE_OPTIONS}
              value={databarTypeValue}
              css={{ width: METRIC_SELECT_WIDTH }}
              onChange={handleDatabarTypeChange}
            />
          </div>
          {showDatabarControls && (
            <>
              <MetricFormatSelector
                label={t('Scale like')}
                tooltip={t('Scale this databar to the selected metric.')}
                value={databar.scaleLike}
                metrics={scaleLikeMetrics}
                onChange={metric => handleDatabarChange('scaleLike', metric)}
                disabled={scaleLikeDisabled}
                columns={props.columns}
                savedMetrics={props.savedMetrics}
                datasource={props.datasource}
              />
              <MetricFormatSelector
                label={t('Color by metric')}
                tooltip={t('Metric that returns a color for the databar.')}
                value={databar.colorMetric}
                metrics={props.availableMetrics}
                onChange={metric => handleDatabarChange('colorMetric', metric)}
                columns={props.columns}
                savedMetrics={props.savedMetrics}
                datasource={props.datasource}
              />
              <Space direction="vertical" size={4}>
                <Typography.Text>{t('Positive color')}</Typography.Text>
                <ColorPicker
                  presets={[{ label: t('Theme colors'), colors: presetColors }]}
                  value={databar.positiveColor ?? defaultPositiveColor}
                  disabled={colorMode === 'byMetric'}
                  onChangeComplete={color =>
                    handleDatabarChange('positiveColor', rgbToHex(color))
                  }
                  showText
                />
              </Space>
              <Space direction="vertical" size={4}>
                <Typography.Text>{t('Negative color')}</Typography.Text>
                <ColorPicker
                  presets={[{ label: t('Theme colors'), colors: presetColors }]}
                  value={databar.negativeColor ?? defaultNegativeColor}
                  disabled={colorMode === 'byMetric'}
                  onChangeComplete={color =>
                    handleDatabarChange('negativeColor', rgbToHex(color))
                  }
                  showText
                />
              </Space>
            </>
          )}
        </Space>
      </Space>
    </div>
  );

  const formattingControl = (
    <Space size={4}>
      {props.onAddMeasureLeaf && (
        <Tooltip title={t('Add measure leaf')}>
          <MeasureLeafButton
            aria-label={t('Add measure leaf for %s', metricLabel)}
            size="small"
            buttonStyle="tertiary"
            onClick={handleAddMeasureLeaf}
          >
            IX
          </MeasureLeafButton>
        </Tooltip>
      )}
      <Popover
        content={formattingPopoverContent}
        overlayStyle={{ width: 'fit-content' }}
        trigger="click"
        placement="right"
        getPopupContainer={() => document.body}
      >
        <Tooltip title={t('Add conditional formatting')}>
          <MetricFormattingButtonWrap data-ignore-control-popover>
            <MetricFormattingButton
              aria-label={t('Add conditional formatting for %s', metricLabel)}
              data-test="pivot-metric-formatting-button"
              icon={<Icons.FormatPainterOutlined iconSize="s" />}
              size="small"
              buttonStyle={hasFormatting ? 'primary' : 'tertiary'}
            />
          </MetricFormattingButtonWrap>
        </Tooltip>
      </Popover>
    </Space>
  );

  const normalizedSavedMetrics = useMemo<SavedMetric[]>(
    () =>
      props.savedMetrics.map(metric => ({
        metric_name: metric.metric_name,
        verbose_name: metric.verbose_name,
        expression: metric.expression ?? '',
        ...(isRecord(metric) && 'error_text' in metric
          ? { error_text: metric.error_text as string | undefined }
          : {}),
      })),
    [props.savedMetrics],
  );
  const resolvedMetricOption = useMemo<Metric | AdhocMetric | string>(() => {
    if (
      props.option instanceof AdhocMetric ||
      typeof props.option === 'string'
    ) {
      return props.option;
    }
    if (isRecord(props.option) && 'expressionType' in props.option) {
      return new AdhocMetric(props.option as QueryFormMetric);
    }
    return props.option as Metric;
  }, [props.option]);

  return (
    <MetricDefinitionValue
      option={resolvedMetricOption}
      index={props.index}
      onMetricEdit={props.onMetricEdit}
      onRemoveMetric={props.onRemoveMetric}
      columns={props.columns}
      savedMetrics={normalizedSavedMetrics}
      savedMetricsOptions={props.savedMetricsOptions}
      datasource={props.datasource}
      onMoveLabel={props.onMoveLabel}
      onDropLabel={props.onDropLabel}
      type={props.type}
      multi={props.multi}
      datasourceWarningMessage={props.datasourceWarningMessage}
      rightNode={formattingControl}
    />
  );
}
