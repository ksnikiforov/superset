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
import { ReactNode, useCallback, useMemo, useState } from 'react';
import {
  getMetricLabel,
  Metric,
  QueryFormMetric,
  styled,
  t,
} from '@superset-ui/core';
import {
  Button,
  InfoTooltip,
  Popover,
  Select,
  Space,
  Tooltip,
  Typography,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { ColumnMeta } from '@superset-ui/chart-controls';
import AdhocMetric from 'src/explore/components/controls/MetricControl/AdhocMetric';
import AdhocMetricPopoverTrigger from 'src/explore/components/controls/MetricControl/AdhocMetricPopoverTrigger';
import { savedMetricType } from 'src/explore/components/controls/MetricControl/types';
import MetricDefinitionValue from './MetricDefinitionValue';
import {
  MetricFormattingField,
  PivotMetricFormatting,
  PivotMetricFormattingMap,
} from '../../types';
import { getMetricKey } from '../../utils';

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

type ValueType = Metric | AdhocMetric | QueryFormMetric;

export type MetricSelectValue = {
  value: string | number;
  label?: string;
};

export type MetricOptionValue = ValueType | MetricSelectValue;

type PivotMetricDefinitionValueProps = {
  option: ValueType;
  index: number;
  onMetricEdit: (changedMetric: Metric | AdhocMetric, oldMetric: Metric | AdhocMetric) => void;
  onRemoveMetric: (index: number) => void;
  onMoveLabel: (dragIndex: number, hoverIndex: number) => void;
  onDropLabel: () => void;
  columns: ColumnMeta[];
  savedMetrics: Metric[];
  savedMetricsOptions: savedMetricType[];
  availableMetrics: ValueType[];
  metricFormatting: PivotMetricFormattingMap;
  onMetricFormattingChange: (
    metricKey: string,
    field: keyof PivotMetricFormatting,
    metric?: QueryFormMetric,
  ) => void;
  multi?: boolean;
  datasource?: Record<string, unknown>;
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

const resolveMetricLabel = (option: MetricOptionValue) => {
  if (isMetricSelectValue(option)) {
    if (typeof option.label === 'string' && option.label.length > 0) {
      return option.label;
    }
    const key = getSelectValueKey(option);
    return key || t('Metric');
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

const resolveMetricKey = (option: MetricOptionValue) =>
  getSelectValueKey(option) || getMetricKey(option as QueryFormMetric | Metric);

const getMetricOptionValue = (option: MetricOptionValue): string | undefined => {
  const selectValue = getSelectValueKey(option);
  if (selectValue) {
    return selectValue;
  }
  if (option instanceof AdhocMetric) {
    if (typeof option.optionName === 'string' && option.optionName.length > 0) {
      return option.optionName;
    }
    const label = resolveMetricLabel(option);
    return label !== t('Metric') ? label : undefined;
  }
  if (isRecord(option)) {
    const optionName = option.optionName;
    if (typeof optionName === 'string' && optionName.length > 0) {
      return optionName;
    }
    const metricName = option.metric_name;
    if (typeof metricName === 'string' && metricName.length > 0) {
      return metricName;
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
    const value = getMetricOptionValue(metric) || (label !== t('Metric') ? label : '');
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
): QueryFormMetric => {
  const selectValueKey = getSelectValueKey(metric);
  if (selectValueKey) {
    return selectValueKey;
  }
  if ('metric_name' in metric && metric.metric_name) {
    return metric.metric_name;
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
  if ('expressionType' in metric) {
    const adhocMetric = new AdhocMetric(metric);
    const normalized: QueryFormMetric = {
      expressionType: adhocMetric.expressionType,
      column: adhocMetric.column,
      aggregate: adhocMetric.aggregate,
      sqlExpression: adhocMetric.sqlExpression,
      label: metric.label || adhocMetric.label,
      hasCustomLabel: metric.hasCustomLabel ?? adhocMetric.hasCustomLabel,
      optionName:
        typeof metric.optionName === 'string' ? metric.optionName : undefined,
    };
    return normalized;
  }
  if (isRecord(metric)) {
    const sqlExpression = metric.sqlExpression;
    if (typeof sqlExpression === 'string' && sqlExpression.trim().length > 0) {
      return {
        ...metric,
        expressionType: 'SQL',
        optionName:
          typeof metric.optionName === 'string' ? metric.optionName : undefined,
      } as QueryFormMetric;
    }
    const aggregate = metric.aggregate;
    const column = metric.column;
    if (
      typeof aggregate === 'string' &&
      aggregate.length > 0 &&
      isRecord(column)
    ) {
      return {
        ...metric,
        expressionType: 'SIMPLE',
        optionName:
          typeof metric.optionName === 'string' ? metric.optionName : undefined,
      } as QueryFormMetric;
    }
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

export const MetricFormatSelector = ({
  label,
  tooltip,
  value,
  metrics,
  onChange,
  columns,
  savedMetrics,
  datasource,
}: {
  label: string;
  tooltip: ReactNode;
  value?: QueryFormMetric | MetricSelectValue;
  metrics: MetricOptionValue[];
  onChange: (metric?: QueryFormMetric) => void;
  columns: ColumnMeta[];
  savedMetrics: Metric[];
  datasource?: Record<string, unknown>;
}) => {
  const options = useMemo(
    () => buildMetricOptions(value ? [...metrics, value] : metrics),
    [metrics, value],
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
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
  }, [savedMetrics, value]);
  const adhocMetricForPopover = useMemo(() => {
    if (value instanceof AdhocMetric) {
      return value;
    }
    if (savedMetricForPopover) {
      return new AdhocMetric({});
    }
    if (isRecord(value) && 'expressionType' in value) {
      const rawLabel = value.label;
      const inferredHasCustomLabel =
        typeof value.hasCustomLabel === 'boolean'
          ? value.hasCustomLabel
          : typeof rawLabel === 'string' && rawLabel.trim().length > 0;
      return new AdhocMetric({
        ...(value as QueryFormMetric),
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
  }, [savedMetricForPopover, value]);

  return (
    <Space direction="vertical" size={4}>
      <Space align="center" size={4}>
        <Typography.Text>{label}</Typography.Text>
        <InfoTooltip tooltip={tooltip} />
      </Space>
      <Space size={8} align="start">
        <Select
          allowClear
          allowNewOptions
          ariaLabel={label}
          placeholder={t('Select a metric')}
          style={{ width: METRIC_SELECT_WIDTH }}
          open={isDropdownOpen}
          onOpenChange={setIsDropdownOpen}
          value={selectedValue}
          options={options.map(option => ({
            label: option.label,
            value: option.value,
          }))}
          onChange={nextValue => {
            if (!nextValue) {
              onChange(undefined);
              setIsDropdownOpen(false);
              return;
            }
            const nextValueKey = getSelectValueKey(nextValue);
            if (!nextValueKey) {
              onChange(undefined);
              setIsDropdownOpen(false);
              return;
            }
            const nextMetric = optionMap.get(nextValueKey);
            onChange(
              normalizeFormattingMetric(nextMetric ?? nextValueKey),
            );
            setIsDropdownOpen(false);
          }}
          onClick={() => setIsDropdownOpen(true)}
          onClear={() => onChange(undefined)}
          showSearch
          optionFilterProps={['label', 'value']}
        />
        <AdhocMetricPopoverTrigger
          adhocMetric={adhocMetricForPopover}
          onMetricEdit={newMetric =>
            onChange(normalizeFormattingMetric(newMetric))
          }
          columns={columns}
          savedMetricsOptions={savedMetrics as savedMetricType[]}
          savedMetric={
            savedMetricForPopover || { metric_name: '', expression: '' }
          }
          datasource={datasource}
          isNew
        >
          <Tooltip title={t('Add metric')}>
            <Button
              aria-label={t('Add metric')}
              icon={<Icons.PlusOutlined iconSize="s" />}
              size="small"
              type="text"
            />
          </Tooltip>
        </AdhocMetricPopoverTrigger>
      </Space>
    </Space>
  );
};

export default function PivotMetricDefinitionValue(
  props: PivotMetricDefinitionValueProps,
) {
  const metricLabel = useMemo(
    () => resolveMetricLabel(props.option),
    [props.option],
  );
  const metricKey = useMemo(() => {
    const key = resolveMetricKey(props.option);
    if (key) {
      return key;
    }
    return metricLabel !== t('Metric') ? metricLabel : '';
  }, [metricLabel, props.option]);
  const formattingKey = useMemo(() => {
    const candidateKeys = [metricKey, metricLabel].filter(
      (candidate): candidate is string => !!candidate,
    );
    const savedMetricMatch = props.savedMetrics.find(metric => {
      if (metric.metric_name === metricKey || metric.metric_name === metricLabel) {
        return true;
      }
      if (metric.verbose_name === metricKey || metric.verbose_name === metricLabel) {
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
    if (typeof props.option === 'object' && props.option !== null) {
      if (
        'metric_name' in props.option &&
        typeof props.option.metric_name === 'string'
      ) {
        candidateKeys.push(props.option.metric_name);
      }
      if (
        'label' in props.option &&
        typeof props.option.label === 'string'
      ) {
        candidateKeys.push(props.option.label);
      }
      if (
        'verbose_name' in props.option &&
        typeof props.option.verbose_name === 'string'
      ) {
        candidateKeys.push(props.option.verbose_name);
      }
    }
    return (
      candidateKeys.find(key => props.metricFormatting[key]) || metricKey
    );
  }, [metricKey, metricLabel, props.metricFormatting, props.option]);
  const formatting =
    (formattingKey && props.metricFormatting[formattingKey]) || {};
  const hasFormatting = Boolean(
    formatting.backgroundColor ||
      formatting.textColor ||
      formatting.d3Format,
  );
  const handleFormattingChange = useCallback(
    (field: keyof PivotMetricFormatting, metric?: QueryFormMetric) => {
      if (!formattingKey) {
        return;
      }
      props.onMetricFormattingChange(formattingKey, field, metric);
    },
    [formattingKey, props.onMetricFormattingChange],
  );

  const formattingPopoverContent = (
    <div
      data-ignore-control-popover
      onClick={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
    >
      <Space direction="vertical" size={8}>
        <Typography.Text strong>{t('Conditional formatting')}</Typography.Text>
        <Typography.Text type="secondary">
          {t('Metric: %s', metricLabel)}
        </Typography.Text>
        {FORMAT_SELECTOR_CONFIG.map(selector => (
          <MetricFormatSelector
            key={selector.field}
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
      </Space>
    </div>
  );

  const formattingControl = (
    <Popover
      content={formattingPopoverContent}
      overlayStyle={{ width: 'fit-content' }}
      trigger="click"
      placement="right"
      getPopupContainer={() => document.body}
    >
      <Tooltip title={t('Add conditional formatting')}>
        <MetricFormattingButtonWrap
          data-ignore-control-popover
          onClick={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
        >
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
  );

  return (
    <MetricDefinitionValue
      option={props.option as QueryFormMetric}
      index={props.index}
      onMetricEdit={props.onMetricEdit}
      onRemoveMetric={props.onRemoveMetric}
      columns={props.columns}
      savedMetrics={props.savedMetrics}
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
