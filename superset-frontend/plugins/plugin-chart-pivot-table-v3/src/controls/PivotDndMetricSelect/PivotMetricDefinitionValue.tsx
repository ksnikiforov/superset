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
import { t } from '@apache-superset/core/translation';
import { useTheme, styled } from '@apache-superset/core/theme';
import {
  ReactNode,
  type ComponentProps,
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  getCategoricalSchemeRegistry,
  getMetricLabel,
  isAdhocMetricSimple,
  isAdhocMetricSQL,
  Metric,
  QueryFormMetric,
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
import { MetricDefinitionValue } from '../../exploreImports';
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
  buildMetricLabelMap,
  resolveMetricDisplayLabel,
} from '../../utils';
import { getMetricKey } from '../../pivot/metrics';
import {
  isPivotExcelFormula,
  normalizePivotExcelFormula,
} from '../../pivot/formatting/excelFormulaReferences';
import { normalizeEditorMetric, disallowsAdhocMetrics } from '../metricInput';
import { SettingsPopover } from '../SettingsPopover';
import { validateExcelFormula } from '../../pivot/formatting/excelFormula';

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
type AdhocMetricInput = ConstructorParameters<typeof AdhocMetric>[0];

const toAdhocMetricInput = (
  metric: Exclude<QueryFormMetric, string>,
): AdhocMetricInput => metric as AdhocMetricInput;

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
  metricLabelMap?: Record<string, string>;
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
  return (hash < 0 ? hash + 0x100000000 : hash).toString(36);
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

const resolveMetricLabel = (
  option: MetricOptionValue,
  metricLabelMap?: Record<string, string>,
) => {
  if (isMetricSelectValue(option)) {
    if (typeof option.label === 'string' && option.label.length > 0) {
      return option.label;
    }
    const key = getSelectValueKey(option);
    if (key && metricLabelMap?.[key]) {
      return metricLabelMap[key];
    }
    return key || t('Metric');
  }
  if (isPivotExcelFormula(option)) {
    return `${t('Custom Excel')}: ${formatExcelFormulaLabel(option.formula)}`;
  }
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

const buildMetricOptions = (
  metrics: MetricOptionValue[],
  metricLabelMap?: Record<string, string>,
) => {
  const seen = new Set<string>();
  return metrics.reduce<MetricOption[]>((acc, metric) => {
    const label = resolveMetricLabel(metric, metricLabelMap);
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
  return normalizeEditorMetric(
    metric as Metric | AdhocMetric | QueryFormMetric,
  );
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
  metricLabelMap?: Record<string, string>;
  disabled?: boolean;
  columns: ColumnMeta[];
  savedMetrics: Metric[];
  datasource?: AdhocMetricPopoverDatasource;
  allowCustomSql?: boolean;
  allowSavedMetrics?: boolean;
  excelOnly?: boolean;
  allowExcel?: boolean;
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
  const {
    label,
    tooltip,
    value,
    metrics,
    metricLabelMap,
    columns,
    savedMetrics,
    datasource,
  } = props;
  const disabled = props.disabled ?? false;
  const enableExcel = props.enableExcel === true;
  const excelOnly = props.excelOnly === true;
  const allowCustomSql = !excelOnly && (props.allowCustomSql ?? true);
  const allowSavedMetrics = !excelOnly && (props.allowSavedMetrics ?? true);
  const allowExcel = enableExcel && (props.allowExcel ?? true);

  const mergedMetricLabelMap = useMemo(
    () => buildMetricLabelMap(savedMetrics, metricLabelMap),
    [metricLabelMap, savedMetrics],
  );

  const handleChangeValue = useCallback(
    (next?: PivotMetricFormattingValue) => {
      if (!allowExcel && next && isPivotExcelFormula(next)) {
        return;
      }
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
    [allowExcel, excelOnly, props],
  );

  const options = useMemo(() => {
    const baseMetrics = allowExcel
      ? metrics
      : metrics.filter(metric => !isPivotExcelFormula(metric));
    const resolvedMetrics = excelOnly
      ? baseMetrics.filter(isPivotExcelFormula)
      : baseMetrics;
    return buildMetricOptions(
      value ? [...resolvedMetrics, value] : resolvedMetrics,
      mergedMetricLabelMap,
    );
  }, [allowExcel, excelOnly, mergedMetricLabelMap, metrics, value]);
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
    const label = resolveMetricLabel(value, mergedMetricLabelMap);
    return label !== t('Metric') ? label : undefined;
  }, [mergedMetricLabelMap, value]);
  const datasourceForPopover = datasource;
  const savedMetricForPopover = useMemo(() => {
    const key =
      typeof value === 'string'
        ? value
        : isRecord(value) && 'metric_name' in value
          ? value.metric_name
          : undefined;
    return savedMetricsForPopover.find(metric => metric.metric_name === key);
  }, [savedMetricsForPopover, value]);
  const savedMetricOptions = useMemo(
    () =>
      savedMetricsForPopover
        .filter(metric => metric.metric_name)
        .map(metric => ({
          value: metric.metric_name,
          label:
            mergedMetricLabelMap[metric.metric_name] ||
            metric.verbose_name ||
            metric.metric_name,
        })),
    [mergedMetricLabelMap, savedMetricsForPopover],
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
    if (isAdhocMetricSimple(value) || isAdhocMetricSQL(value)) {
      const metricValue = value;
      const rawLabel = metricValue.label;
      const inferredHasCustomLabel =
        typeof metricValue.hasCustomLabel === 'boolean'
          ? metricValue.hasCustomLabel
          : typeof rawLabel === 'string' && rawLabel.trim().length > 0;
      return new AdhocMetric({
        ...toAdhocMetricInput(metricValue),
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

  const disallowAdhocMetrics = disallowsAdhocMetrics(datasource?.extra);

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

  type Editor = {
    tab: 'sql' | 'excel' | 'saved';
    sqlLabel: string;
    sqlExpression: string;
    excelFormula: string;
    savedMetricName: string;
    error?: string;
  };
  const emptyEditor: Editor = {
    tab:
      allowSavedMetrics && savedMetricOptions.length
        ? 'saved'
        : allowCustomSql && !disallowAdhocMetrics
          ? 'sql'
          : 'excel',
    sqlLabel: '',
    sqlExpression: '',
    excelFormula: '',
    savedMetricName: '',
  };
  const [customMetricPopoverOpen, setCustomMetricPopoverOpen] = useState(false);
  const [editor, setEditor] = useState(emptyEditor);
  const edit = (patch: Partial<Editor>) =>
    setEditor(previous => ({ ...previous, ...patch, error: undefined }));
  const {
    sqlLabel: customSqlLabel,
    sqlExpression: customSqlExpression,
    excelFormula: customExcelFormula,
    savedMetricName: customSavedMetricName,
    error: customMetricError,
  } = editor;
  const availableTabs = {
    sql: allowCustomSql,
    excel: allowExcel,
    saved: allowSavedMetrics,
  };
  const customMetricTab = availableTabs[editor.tab]
    ? editor.tab
    : emptyEditor.tab;
  const openCustomMetricPopover = () => {
    const metricName =
      typeof value === 'string' ? value : savedMetricForPopover?.metric_name;
    if (allowExcel && isPivotExcelFormula(value)) {
      setEditor({ ...emptyEditor, tab: 'excel', excelFormula: value.formula });
    } else if (
      allowSavedMetrics &&
      savedMetricsForPopover.some(metric => metric.metric_name === metricName)
    ) {
      setEditor({
        ...emptyEditor,
        tab: 'saved',
        savedMetricName: metricName ?? '',
      });
    } else if (allowCustomSql && isAdhocMetricSQL(value)) {
      setEditor({
        ...emptyEditor,
        tab: disallowAdhocMetrics ? emptyEditor.tab : 'sql',
        sqlExpression: value.sqlExpression,
        sqlLabel: typeof value.label === 'string' ? value.label : '',
      });
    } else {
      setEditor(emptyEditor);
    }
  };
  const closeCustomMetricPopover = () => {
    setCustomMetricPopoverOpen(false);
    edit({ error: undefined });
  };
  const saveCustomMetric = () => {
    let next: PivotMetricFormattingValue | undefined;
    let error: string | undefined;
    if (customMetricTab === 'excel') {
      const formula = normalizePivotExcelFormula({
        kind: 'excel',
        formula: customExcelFormula,
      });
      if (!formula) error = t('Custom Excel formula is empty.');
      else {
        const validation = validateExcelFormula(formula.formula);
        if (validation.valid) next = formula;
        else error = validation.message;
      }
    } else if (customMetricTab === 'saved') {
      if (!customSavedMetricName) error = t('Select a saved metric.');
      else next = customSavedMetricName;
    } else {
      if (!datasourceForPopover || disallowAdhocMetrics || !allowCustomSql)
        return;
      const sqlExpression = customSqlExpression.trim();
      const label = customSqlLabel.trim();
      if (!sqlExpression) error = t('Custom SQL expression is empty.');
      else
        next = normalizeFormattingMetric(
          new AdhocMetric({
            expressionType: 'SQL',
            sqlExpression,
            ...(label ? { label, hasCustomLabel: true } : {}),
          }),
        );
    }
    if (error) setEditor(previous => ({ ...previous, error }));
    else {
      handleChangeValue(next);
      closeCustomMetricPopover();
    }
  };

  const canSaveCustomSql =
    allowCustomSql &&
    !disabled &&
    Boolean(datasourceForPopover) &&
    !disallowAdhocMetrics;
  const canSaveCustomExcel = allowExcel && !disabled;
  const canSaveCustomSaved =
    allowSavedMetrics && !disabled && Boolean(customSavedMetricName);

  const customMetricPopoverContent = (
    <div data-ignore-control-popover>
      <Space direction="vertical" size={8}>
        <Tabs
          activeKey={customMetricTab}
          onChange={key => edit({ tab: key as Editor['tab'] })}
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
                              edit({
                                savedMetricName:
                                  typeof nextValue === 'string'
                                    ? nextValue
                                    : '',
                              })
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
                            edit({ sqlLabel: event.target.value })
                          }
                        />
                        <Input.TextArea
                          aria-label={t('Custom SQL')}
                          placeholder={t('SQL expression')}
                          autoSize={{ minRows: 3, maxRows: 8 }}
                          value={customSqlExpression}
                          onChange={event =>
                            edit({ sqlExpression: event.target.value })
                          }
                        />
                      </Space>
                    ),
                  },
                ]
              : []),
            ...(allowExcel
              ? [
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
                            edit({ excelFormula: event.target.value })
                          }
                        />
                      </Space>
                    ),
                  },
                ]
              : []),
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
              customMetricTab === 'saved'
                ? !canSaveCustomSaved
                : customMetricTab === 'excel'
                  ? !canSaveCustomExcel
                  : !canSaveCustomSql
            }
            onClick={saveCustomMetric}
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

type MetricFormattingControlProps = {
  metricKey: string;
  metricLabel: string;
  ariaLabel: string;
  excelOnly?: boolean;
  formatting: PivotMetricFormatting;
  databar: PivotMetricDatabar;
  metricDatabars: PivotMetricDatabarMap;
  availableMetrics: MetricOptionValue[];
  selectedMetrics: MetricOptionValue[];
  metricLabelMap?: Record<string, string>;
  columns: ColumnMeta[];
  savedMetrics: Metric[];
  datasource?: AdhocMetricPopoverDatasource;
  onFormattingChange: (
    field: keyof PivotMetricFormatting,
    metric?: PivotMetricFormattingValue,
  ) => void;
  onDatabarChange: (
    field: keyof PivotMetricDatabar,
    value?: PivotMetricDatabar[keyof PivotMetricDatabar],
  ) => void;
};

export const MetricFormattingControl = ({
  metricKey,
  metricLabel,
  ariaLabel,
  excelOnly = false,
  formatting,
  databar,
  metricDatabars,
  availableMetrics,
  selectedMetrics,
  metricLabelMap,
  columns,
  savedMetrics,
  datasource,
  onFormattingChange,
  onDatabarChange,
}: MetricFormattingControlProps) => {
  const theme = useTheme();
  const defaultPositiveColor =
    theme.colorSuccess || DEFAULT_DATABAR_POSITIVE_COLOR;
  const defaultNegativeColor =
    theme.colorError || DEFAULT_DATABAR_NEGATIVE_COLOR;
  const presetColors = useMemo(() => {
    const categoricalScheme = getCategoricalSchemeRegistry().get();
    return categoricalScheme?.colors.slice(0, 9) || [];
  }, []);
  const hasFormatting = Boolean(
    formatting.backgroundColor ||
    formatting.textColor ||
    formatting.d3Format ||
    databar.type,
  );
  const handleDatabarTypeChange = useCallback(
    (value: string) => {
      const nextType =
        value === 'none' ? undefined : (value as PivotDatabarType);
      onDatabarChange('type', nextType);
      if (nextType) {
        if (!databar.positiveColor) {
          onDatabarChange('positiveColor', defaultPositiveColor);
        }
        if (!databar.negativeColor) {
          onDatabarChange('negativeColor', defaultNegativeColor);
        }
      }
    },
    [
      databar.negativeColor,
      databar.positiveColor,
      defaultNegativeColor,
      defaultPositiveColor,
      onDatabarChange,
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
        ? getMetricKey(config.scaleLike as QueryFormMetric | Metric)
        : undefined;
      if (targetKey) {
        sources.add(key);
        targets.add(targetKey);
      }
    });
    return { scaleLikeSources: sources, scaleLikeTargets: targets };
  }, [metricDatabars]);
  const scaleLikeDisabled = Boolean(
    metricKey && scaleLikeTargets.has(metricKey),
  );
  const scaleLikeMetrics = useMemo(() => {
    if (!metricKey) {
      return selectedMetrics;
    }
    return selectedMetrics.filter(metric => {
      const candidateKey = getMetricKey(metric as QueryFormMetric | Metric);
      return (
        !!candidateKey &&
        candidateKey !== metricKey &&
        !scaleLikeSources.has(candidateKey)
      );
    });
  }, [metricKey, scaleLikeSources, selectedMetrics]);

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
            excelOnly={excelOnly}
            label={selector.label}
            tooltip={selector.tooltip}
            value={formatting[selector.field]}
            metrics={availableMetrics}
            metricLabelMap={metricLabelMap}
            onChange={metric => onFormattingChange(selector.field, metric)}
            columns={columns}
            savedMetrics={savedMetrics}
            datasource={datasource}
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
                metricLabelMap={metricLabelMap}
                onChange={metric => onDatabarChange('scaleLike', metric)}
                disabled={scaleLikeDisabled}
                columns={columns}
                savedMetrics={savedMetrics}
                datasource={datasource}
              />
              <MetricFormatSelector
                label={t('Color by metric')}
                tooltip={t('Metric that returns a color for the databar.')}
                value={databar.colorMetric}
                metrics={availableMetrics}
                metricLabelMap={metricLabelMap}
                onChange={metric => onDatabarChange('colorMetric', metric)}
                columns={columns}
                savedMetrics={savedMetrics}
                datasource={datasource}
              />
              {(
                [
                  ['positiveColor', t('Positive color'), defaultPositiveColor],
                  ['negativeColor', t('Negative color'), defaultNegativeColor],
                ] as const
              ).map(([field, label, fallback]) => (
                <Space key={field} direction="vertical" size={4}>
                  <Typography.Text>{label}</Typography.Text>
                  <ColorPicker
                    presets={[
                      { label: t('Theme colors'), colors: presetColors },
                    ]}
                    value={databar[field] ?? fallback}
                    disabled={colorMode === 'byMetric'}
                    onChangeComplete={color =>
                      onDatabarChange(field, rgbToHex(color))
                    }
                    showText
                  />
                </Space>
              ))}
            </>
          )}
        </Space>
      </Space>
    </div>
  );

  return (
    <SettingsPopover
      content={formattingPopoverContent}
      title={t('Add conditional formatting')}
      ariaLabel={ariaLabel}
      testId="pivot-metric-formatting-button"
      icon={<Icons.FormatPainterOutlined iconSize="s" />}
      active={hasFormatting}
    />
  );
};

export default function PivotMetricDefinitionValue(
  props: PivotMetricDefinitionValueProps,
) {
  const {
    metricDatabars,
    metricFormatting,
    metricLabelMap,
    onMetricDatabarChange,
    onMetricFormattingChange,
    option,
    savedMetrics,
  } = props;
  const mergedMetricLabelMap = useMemo(
    () => buildMetricLabelMap(savedMetrics, metricLabelMap),
    [metricLabelMap, savedMetrics],
  );
  const metricLabel = useMemo(
    () => resolveMetricLabel(option, mergedMetricLabelMap),
    [mergedMetricLabelMap, option],
  );
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
  const formattingKey = metricKey;
  const databarKey = metricKey;
  const formatting = (formattingKey && metricFormatting[formattingKey]) || {};
  const databar = (databarKey && metricDatabars[databarKey]) || {};
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
      <MetricFormattingControl
        metricKey={metricKey}
        metricLabel={metricLabel}
        ariaLabel={t('Add conditional formatting for %s', metricLabel)}
        excelOnly={isIxMetric}
        formatting={formatting}
        databar={databar}
        metricDatabars={metricDatabars}
        availableMetrics={props.availableMetrics}
        selectedMetrics={props.selectedMetrics}
        metricLabelMap={mergedMetricLabelMap}
        columns={props.columns}
        savedMetrics={props.savedMetrics}
        datasource={props.datasource}
        onFormattingChange={handleFormattingChange}
        onDatabarChange={handleDatabarChange}
      />
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
    if (
      isRecord(props.option) &&
      !isPivotExcelFormula(props.option) &&
      'expressionType' in props.option
    ) {
      return new AdhocMetric(
        toAdhocMetricInput(props.option as Exclude<QueryFormMetric, string>),
      );
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
