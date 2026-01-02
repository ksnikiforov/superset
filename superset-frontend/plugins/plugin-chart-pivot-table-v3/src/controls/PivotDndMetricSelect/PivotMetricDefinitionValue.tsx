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
import { ReactNode, useCallback, useMemo } from 'react';
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
import MetricDefinitionValue from 'src/explore/components/controls/MetricControl/MetricDefinitionValue';
import AdhocMetric from 'src/explore/components/controls/MetricControl/AdhocMetric';
import AdhocMetricPopoverTrigger from 'src/explore/components/controls/MetricControl/AdhocMetricPopoverTrigger';
import { savedMetricType } from 'src/explore/components/controls/MetricControl/types';
import {
  MetricFormattingField,
  PivotMetricFormatting,
  PivotMetricFormattingMap,
} from '../../types';
import { getMetricKey } from '../../utils';

const MetricRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit}px;
  width: 100%;
`;

const MetricLabelWrap = styled.div`
  flex: 1;
  min-width: 0;
`;

type ValueType = Metric | AdhocMetric | QueryFormMetric;

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

type MetricOption = {
  label: string;
  value: string;
  metric: ValueType;
};

const buildMetricOptions = (metrics: ValueType[]) => {
  const seen = new Set<string>();
  return metrics.reduce<MetricOption[]>((acc, metric) => {
    const label = resolveMetricLabel(metric);
    const value = resolveMetricKey(metric) || (label !== t('Metric') ? label : '');
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
  metric: Metric | AdhocMetric | QueryFormMetric,
): QueryFormMetric => {
  if (typeof metric === 'string') {
    return metric;
  }
  if ('metric_name' in metric && metric.metric_name) {
    return metric.metric_name;
  }
  if (metric instanceof AdhocMetric) {
    return {
      expressionType: metric.expressionType,
      column: metric.column,
      aggregate: metric.aggregate,
      sqlExpression: metric.sqlExpression,
      label: metric.label,
      hasCustomLabel: metric.hasCustomLabel,
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
    };
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

const MetricFormatSelector = ({
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
  value?: QueryFormMetric;
  metrics: ValueType[];
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
    const key = resolveMetricKey(value);
    if (key) {
      return key;
    }
    const label = resolveMetricLabel(value);
    return label !== t('Metric') ? label : undefined;
  }, [value]);
  const newAdhocMetric = useMemo(() => new AdhocMetric({}), []);

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
          value={selectedValue}
          options={options.map(option => ({
            label: option.label,
            value: option.value,
          }))}
          onChange={nextValue => {
            if (!nextValue) {
              onChange(undefined);
              return;
            }
            const nextValueKey =
              typeof nextValue === 'string' ? nextValue : String(nextValue);
            const nextMetric = optionMap.get(nextValueKey);
            onChange(
              normalizeFormattingMetric(nextMetric ?? nextValueKey),
            );
          }}
          onClear={() => onChange(undefined)}
          showSearch
          optionFilterProps={['label', 'value']}
        />
        <AdhocMetricPopoverTrigger
          adhocMetric={newAdhocMetric}
          onMetricEdit={newMetric =>
            onChange(normalizeFormattingMetric(newMetric))
          }
          columns={columns}
          savedMetricsOptions={savedMetrics as savedMetricType[]}
          savedMetric={{ metric_name: '', expression: '' }}
          datasource={datasource}
          isNew
        >
          <Tooltip title={t('Add metric')}>
            <Button
              aria-label={t('Add metric')}
              icon={<Icons.PlusOutlined iconSize="m" />}
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
  const formatting = props.metricFormatting[metricKey] || {};
  const handleFormattingChange = useCallback(
    (field: keyof PivotMetricFormatting, metric?: QueryFormMetric) => {
      if (!metricKey) {
        return;
      }
      props.onMetricFormattingChange(metricKey, field, metric);
    },
    [metricKey, props.onMetricFormattingChange],
  );

  return (
    <MetricRow>
      <MetricLabelWrap>
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
        />
      </MetricLabelWrap>
      <Popover
        content={
          <Space direction="vertical" size={8}>
            <Typography.Text strong>
              {t('Conditional formatting')}
            </Typography.Text>
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
                onChange={metric =>
                  handleFormattingChange(selector.field, metric)
                }
                columns={props.columns}
                savedMetrics={props.savedMetrics}
                datasource={props.datasource}
              />
            ))}
          </Space>
        }
        overlayStyle={{ minWidth: 420 }}
        trigger="click"
        placement="right"
      >
        <Tooltip title={t('Add conditional formatting')}>
          <Button
            aria-label={t('Add conditional formatting for %s', metricLabel)}
            data-test="pivot-metric-formatting-button"
            icon={<Icons.PlusOutlined iconSize="m" />}
            size="small"
            type="text"
          />
        </Tooltip>
      </Popover>
    </MetricRow>
  );
}
