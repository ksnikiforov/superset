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
import { useCallback, useMemo } from 'react';
import {
  getCategoricalSchemeRegistry,
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
  Popover,
  Select,
  Space,
  Tooltip,
  Typography,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { ColumnMeta } from '@superset-ui/chart-controls';
import {
  DEFAULT_DATABAR_NEGATIVE_COLOR,
  DEFAULT_DATABAR_POSITIVE_COLOR,
  getFormattingMetricKey,
  getMetricKey,
} from '../../utils';
import {
  MeasureLeafSpec,
  MetricFormattingField,
  PivotDatabarType,
  PivotMetricDatabar,
  PivotMetricDatabarMap,
  PivotMetricFormatting,
  PivotMetricFormattingMap,
  PivotMetricFormattingValue,
} from '../../types';
import {
  buildMeasureLeafOutputKey,
  isValueLeaf,
} from '../../pivot/measureLeaves';
import OptionControlLabel from './OptionControlLabel';
import {
  MetricFormatSelector,
  type MetricOptionValue,
} from './PivotMetricDefinitionValue';

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

const METRIC_SELECT_WIDTH = 220;

export type MeasureLeafValueProps = {
  metricLabel: string;
  metricKey: string;
  leaf: MeasureLeafSpec;
  index: number;
  onRemoveLeaf: (index: number) => void;
  onMoveLeaf: (dragIndex: number, hoverIndex: number) => void;
  onDropLeaf: () => void;
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
  availableMetrics: MetricOptionValue[];
  selectedMetrics: MetricOptionValue[];
  savedMetrics: Metric[];
  columns: ColumnMeta[];
  datasource?: React.ComponentProps<
    typeof import('../../exploreImports').AdhocMetricPopoverTrigger
  >['datasource'];
  type: string;
  removable?: boolean;
  isGroupDragging?: boolean;
};

const FORMAT_SELECTOR_CONFIG: Array<{
  field: MetricFormattingField;
  label: string;
  tooltip: React.ReactNode;
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

export default function MeasureLeafValue({
  metricLabel,
  metricKey,
  leaf,
  index,
  onRemoveLeaf,
  onMoveLeaf,
  onDropLeaf,
  metricFormatting,
  onMetricFormattingChange,
  metricDatabars,
  onMetricDatabarChange,
  availableMetrics,
  selectedMetrics,
  savedMetrics,
  columns,
  datasource,
  type,
  removable = true,
  isGroupDragging = false,
}: MeasureLeafValueProps) {
  const theme = useTheme();
  const defaultPositiveColor =
    theme.colorSuccess || DEFAULT_DATABAR_POSITIVE_COLOR;
  const defaultNegativeColor =
    theme.colorError || DEFAULT_DATABAR_NEGATIVE_COLOR;
  const outputKey = useMemo(
    () => buildMeasureLeafOutputKey(metricKey, leaf),
    [leaf, metricKey],
  );
  const formatting = metricFormatting[outputKey] || {};
  const databar = metricDatabars[outputKey] || {};
  const isIxLeaf = leaf.kind === 'builtIn' && leaf.operator === 'ix';
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
      onMetricFormattingChange(outputKey, field, metric);
    },
    [onMetricFormattingChange, outputKey],
  );
  const handleDatabarChange = useCallback(
    (
      field: keyof PivotMetricDatabar,
      value?: PivotMetricDatabar[keyof PivotMetricDatabar],
    ) => {
      onMetricDatabarChange(outputKey, field, value);
    },
    [onMetricDatabarChange, outputKey],
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
  const scaleLikeMetricKey = outputKey;
  const scaleLikeDisabled = Boolean(
    scaleLikeMetricKey && scaleLikeTargets.has(scaleLikeMetricKey),
  );
  const scaleLikeMetrics = useMemo(() => {
    if (!scaleLikeMetricKey) {
      return selectedMetrics;
    }
    return selectedMetrics.filter(metric => {
      const candidateKey =
        getFormattingMetricKey(metric as QueryFormMetric | Metric) ||
        getMetricKey(metric as QueryFormMetric | Metric);
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
  }, [scaleLikeMetricKey, scaleLikeSources, selectedMetrics]);
  const presetColors = useMemo(() => {
    const categoricalScheme = getCategoricalSchemeRegistry().get();
    return categoricalScheme?.colors.slice(0, 9) || [];
  }, []);

  const formattingPopoverContent = (
    <div data-ignore-control-popover>
      <Space direction="vertical" size={8}>
        <Typography.Text strong>{t('Conditional formatting')}</Typography.Text>
        <Typography.Text type="secondary">
          {t('Metric: %s', `${metricLabel} ${leaf.label}`.trim())}
        </Typography.Text>
        {FORMAT_SELECTOR_CONFIG.map(selector => (
          <MetricFormatSelector
            key={selector.field}
            enableExcel
            excelOnly={isIxLeaf}
            label={selector.label}
            tooltip={selector.tooltip}
            value={formatting[selector.field]}
            metrics={availableMetrics}
            onChange={metric => handleFormattingChange(selector.field, metric)}
            columns={columns}
            savedMetrics={savedMetrics}
            datasource={datasource}
          />
        ))}
        <Divider style={{ margin: 0 }} />
        <Typography.Text strong>{t('Databars')}</Typography.Text>
        <Typography.Text type="secondary">
          {t('Metric: %s', `${metricLabel} ${leaf.label}`.trim())}
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
                columns={columns}
                savedMetrics={savedMetrics}
                datasource={datasource}
              />
              <MetricFormatSelector
                label={t('Color by metric')}
                tooltip={t('Metric that returns a color for the databar.')}
                value={databar.colorMetric}
                metrics={availableMetrics}
                onChange={metric => handleDatabarChange('colorMetric', metric)}
                columns={columns}
                savedMetrics={savedMetrics}
                datasource={datasource}
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
            aria-label={t('Add conditional formatting for %s', leaf.label)}
            data-test="pivot-metric-formatting-button"
            icon={<Icons.FormatPainterOutlined iconSize="s" />}
            size="small"
            buttonStyle={hasFormatting ? 'primary' : 'tertiary'}
          />
        </MetricFormattingButtonWrap>
      </Tooltip>
    </Popover>
  );

  const handleRemove = useCallback(
    () => onRemoveLeaf(index),
    [index, onRemoveLeaf],
  );
  const containerIndent = theme.sizeUnit * 2;

  return (
    <OptionControlLabel
      label={leaf.label}
      onRemove={handleRemove}
      onMoveLabel={onMoveLeaf}
      onDropLabel={onDropLeaf}
      withCaret={false}
      type={type}
      index={index}
      multi
      rightNode={formattingControl}
      containerIndent={containerIndent}
      showRemove={removable && !isValueLeaf(leaf)}
      isGroupDragging={isGroupDragging}
    />
  );
}
