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
  ControlPanelConfig,
  ControlPanelState,
  ControlState,
  ControlHeader,
  ControlSubSectionHeader,
  D3_TIME_FORMAT_OPTIONS,
  getStandardizedControls,
  sharedControls,
} from '@superset-ui/chart-controls';
import {
  ensureIsArray,
  getColumnLabel,
  isAdhocColumn,
  isPhysicalColumn,
  SMART_DATE_ID,
  supersetTheme,
  t,
  validateNonEmpty,
} from '@superset-ui/core';
import { Checkbox, Space, Typography } from '@superset-ui/core/components';
import { CheckboxChangeEvent } from '@superset-ui/core/components/Checkbox/types';
import { MetricsLayoutEnum } from './types';
import {
  METRICS_PLACEHOLDER,
  METRICS_PLACEHOLDER_LABEL,
  parseThemeColors,
  PIVOT_THEME_PRESETS,
  resolveMetricPlacement,
  stripMetricsPlaceholder,
  normalizeSubtotalLevels,
} from './utils';
import PivotDndColumnSelect from './controls/PivotDndColumnSelect/PivotDndColumnSelect';
import PivotDndMetricSelect from './controls/PivotDndMetricSelect/PivotDndMetricSelect';

type WindowWithPivotDebug = Window & { PIVOT_V3_DEBUG_PLACEMENT?: boolean };

const THEME_BLUE = 'blue';
const THEME_PEACH = 'peach';
const THEME_GREY = 'grey';

const themeOptions = [
  {
    value: THEME_BLUE,
    label: t('Blue'),
    colors: [PIVOT_THEME_PRESETS.blue],
  },
  {
    value: THEME_PEACH,
    label: t('Peach'),
    colors: [PIVOT_THEME_PRESETS.peach],
  },
  {
    value: THEME_GREY,
    label: t('Grey'),
    colors: [PIVOT_THEME_PRESETS.grey],
  },
  { value: 'custom', label: t('Custom'), colors: [] },
  { value: 'none', label: t('None'), colors: [] },
];

const renderThemeSwatches = (colors: string[]) => (
  <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>
    {colors.map(color => (
      <span
        key={color}
        style={{
          width: 12,
          height: 12,
          borderRadius: 2,
          border: `1px solid ${supersetTheme.colorBorder}`,
          backgroundColor: color,
        }}
      />
    ))}
  </span>
);

const renderThemeOption = (option: any) => (
  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
    <span>{option.label}</span>
    {option.colors?.length ? renderThemeSwatches(option.colors) : null}
  </span>
);

const withMetricsPlaceholder = (axis: 'row' | 'col') => (config: any) => ({
  ...config,
  shouldMapStateToProps: () => true,
  mapStateToProps: (state: any, controlState: any, chart: any) => {
    const base =
      typeof config.mapStateToProps === 'function'
        ? config.mapStateToProps(state, controlState, chart)
        : {};
    const metricsValue = ensureIsArray(state?.controls?.metrics?.value);
    const hasMetrics = metricsValue.length > 0;
    const options = ensureIsArray(base?.options);
    const hasPlaceholder = options.some(
      (opt: any) => (opt?.column_name || opt?.label) === METRICS_PLACEHOLDER,
    );
    const placeholderOption = {
      column_name: METRICS_PLACEHOLDER,
      verbose_name: t(METRICS_PLACEHOLDER_LABEL),
      label: t(METRICS_PLACEHOLDER_LABEL),
      type: 'VARCHAR',
      groupby: true,
      filterable: false,
      is_dttm: false,
      is_placeholder: true,
      canDelete: false,
    };
    const nextOptions = hasMetrics
      ? hasPlaceholder
        ? options
        : [...options, placeholderOption]
      : options.filter(
          (opt: any) =>
            (opt?.column_name || opt?.label) !== METRICS_PLACEHOLDER,
        );
    const rowsRaw =
      axis === 'row'
        ? ensureIsArray(controlState?.value)
        : ensureIsArray(state?.controls?.groupbyRows?.value);
    const colsRaw =
      axis === 'col'
        ? ensureIsArray(controlState?.value)
        : ensureIsArray(state?.controls?.groupbyColumns?.value);
    const preferredLayout =
      (state?.controls?.metricsLayout?.value as MetricsLayoutEnum) ||
      (state?.form_data?.metricsLayout as MetricsLayoutEnum) ||
      MetricsLayoutEnum.COLUMNS;
    const resolved = resolveMetricPlacement(rowsRaw, colsRaw, {
      hasMetrics,
      preferredAxis: preferredLayout,
    });
    if ((window as WindowWithPivotDebug).PIVOT_V3_DEBUG_PLACEMENT) {
      // eslint-disable-next-line no-console
      console.log('[pivot-v3] placement', {
        axis,
        rowsRaw,
        colsRaw,
        resolvedRows: resolved.rows,
        resolvedCols: resolved.cols,
        preferredLayout,
        hasMetrics,
        hasSetControlValue: !!state?.actions?.setControlValue,
      });
    }
    const value = axis === 'row' ? resolved.rows : resolved.cols;
    return {
      ...base,
      options: nextOptions,
      value,
      placeholder: !hasMetrics,
      pivotPlacement: {
        axis: axis === 'row' ? 'rows' : 'cols',
        rows: resolved.rows,
        cols: resolved.cols,
        preferredAxis: resolved.layout,
        hasMetrics,
        controlNames: { rows: 'groupbyRows', cols: 'groupbyColumns' },
        resolve: resolveMetricPlacement,
        setControlValue: state?.actions?.setControlValue,
      },
    };
  },
});

type ColumnSubtotalOption = {
  value: number;
  label: string;
};

type SetControlValue = (
  controlName: string,
  value: boolean | number[],
  errors?: string[],
) => void;

type ColumnSubtotalSelectorProps = {
  name?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  validationErrors?: string[];
  renderTrigger?: boolean;
  value?: number[];
  options: ColumnSubtotalOption[];
  enabled: boolean;
  onChange?: (value: number[]) => void;
  setControlValue?: SetControlValue;
};

const ColumnSubtotalSelector = ({
  name,
  label,
  description,
  validationErrors,
  renderTrigger,
  value,
  options,
  enabled,
  onChange,
  setControlValue,
}: ColumnSubtotalSelectorProps) => {
  const selectedValues = ensureIsArray<number>(value);
  const allValues = options.map(option => option.value);
  const hasOptions = options.length > 0;
  const allSelected = hasOptions && selectedValues.length === options.length;
  const isIndeterminate =
    selectedValues.length > 0 && selectedValues.length < options.length;

  const setEnabled = (nextEnabled: boolean) => {
    setControlValue?.('colSubTotals', nextEnabled, []);
  };

  const updateLevels = (nextLevels: number[]) => {
    const next = [...new Set(nextLevels)].sort((a, b) => a - b);
    onChange?.(next);
    setEnabled(next.length > 0);
  };

  const handleEnabledChange = (event: CheckboxChangeEvent) => {
    const nextEnabled = event.target.checked;
    if (!nextEnabled) {
      updateLevels([]);
      return;
    }
    if (selectedValues.length === 0) {
      updateLevels(allValues);
      return;
    }
    setEnabled(true);
  };

  const handleSelectAllChange = (event: CheckboxChangeEvent) => {
    updateLevels(event.target.checked ? allValues : []);
  };

  const handleOptionChange =
    (level: number) => (event: CheckboxChangeEvent) => {
      const nextLevels = event.target.checked
        ? [...selectedValues, level]
        : selectedValues.filter(valueItem => valueItem !== level);
      updateLevels(nextLevels);
    };

  return (
    <div>
      <ControlHeader
        name={name}
        label={label}
        description={description}
        validationErrors={validationErrors}
        renderTrigger={renderTrigger}
      />
      <Space direction="vertical" size="small">
        <Checkbox
          checked={enabled}
          onChange={handleEnabledChange}
          disabled={!hasOptions}
        >
          {t('Show column subtotals')}
        </Checkbox>
        <Space direction="vertical" size="small">
          <Typography.Text type="secondary">
            {t('Subtotal levels')}
          </Typography.Text>
          <Checkbox
            indeterminate={isIndeterminate}
            checked={allSelected}
            onChange={handleSelectAllChange}
            disabled={!enabled || !hasOptions}
          >
            {t('Select all')}
          </Checkbox>
          <Space direction="vertical" size="small">
            {hasOptions ? (
              options.map(option => (
                <Checkbox
                  key={option.value}
                  checked={selectedValues.includes(option.value)}
                  onChange={handleOptionChange(option.value)}
                  disabled={!enabled}
                >
                  {option.label}
                </Checkbox>
              ))
            ) : (
              <Typography.Text type="secondary">
                {t('No subtotal levels available')}
              </Typography.Text>
            )}
          </Space>
        </Space>
      </Space>
    </div>
  );
};

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'groupbyRows',
            config: withMetricsPlaceholder('row')({
              ...sharedControls.groupby,
              type: PivotDndColumnSelect,
              dragTypeOverride: 'pivot_v3_dnd',
              label: t('Rows'),
              description: t('Columns to group by on the rows'),
              mapStateToProps: (
                state: ControlPanelState,
                controlState: ControlState,
                chartState?: Record<string, unknown>,
              ) => {
                const base =
                  typeof sharedControls.groupby.mapStateToProps === 'function'
                    ? sharedControls.groupby.mapStateToProps(
                        state,
                        controlState,
                        chartState,
                      )
                    : {};
                return {
                  ...base,
                  formData: state.form_data,
                  datasource: state.datasource,
                };
              },
            }),
          },
        ],
        [
          {
            name: 'groupbyColumns',
            config: withMetricsPlaceholder('col')({
              ...sharedControls.groupby,
              type: PivotDndColumnSelect,
              dragTypeOverride: 'pivot_v3_dnd',
              label: t('Columns'),
              description: t('Columns to group by on the columns'),
              mapStateToProps: (
                state: ControlPanelState,
                controlState: ControlState,
                chartState?: Record<string, unknown>,
              ) => {
                const base =
                  typeof sharedControls.groupby.mapStateToProps === 'function'
                    ? sharedControls.groupby.mapStateToProps(
                        state,
                        controlState,
                        chartState,
                      )
                    : {};
                return {
                  ...base,
                  formData: state.form_data,
                  datasource: state.datasource,
                };
              },
            }),
          },
        ],
        [
          {
            name: 'time_grain_sqla',
            config: {
              ...sharedControls.time_grain_sqla,
              visibility: ({ controls }) => {
                const dttmLookup = Object.fromEntries(
                  ensureIsArray(controls?.groupbyColumns?.options).map(
                    option => [option.column_name, option.is_dttm],
                  ),
                );

                return [
                  ...ensureIsArray(controls?.groupbyColumns.value),
                  ...ensureIsArray(controls?.groupbyRows.value),
                ]
                  .map(selection => {
                    if (isAdhocColumn(selection)) {
                      return true;
                    }
                    if (isPhysicalColumn(selection)) {
                      return !!dttmLookup[selection];
                    }
                    return false;
                  })
                  .some(Boolean);
              },
            },
          },
          'temporal_columns_lookup',
        ],
        [
          {
            name: 'metrics',
            config: {
              ...sharedControls.metrics,
              type: PivotDndMetricSelect,
              validators: [validateNonEmpty],
              mapStateToProps: (
                state: ControlPanelState,
                controlState: ControlState,
                chartState?: Record<string, unknown>,
              ) => {
                const base =
                  typeof sharedControls.metrics.mapStateToProps === 'function'
                    ? sharedControls.metrics.mapStateToProps(
                        state,
                        controlState,
                        chartState,
                      )
                    : {};
                return {
                  ...base,
                  formData: state.form_data,
                };
              },
            },
          },
        ],
        [
          {
            name: 'metricFormattingScope',
            config: {
              type: 'SelectControl',
              label: t('Conditional formatting scope'),
              description: t(
                'Apply conditional formatting to values only, totals, or include grand totals.',
              ),
              clearable: false,
              default: 'values_totals',
              renderTrigger: true,
              choices: [
                ['values', t('Values only')],
                ['values_totals', t('Values + totals')],
                [
                  'values_totals_grand_totals',
                  t('Values + totals + grand totals'),
                ],
              ],
            },
          },
        ],
        [
          {
            name: 'metricFormatting',
            config: {
              type: 'HiddenControl',
              default: {},
            },
          },
        ],
        [
          {
            name: 'metricDatabars',
            config: {
              type: 'HiddenControl',
              default: {},
            },
          },
        ],
        [
          {
            name: 'rowFormatting',
            config: {
              type: 'HiddenControl',
              default: {},
            },
          },
        ],
        [
          {
            name: 'colFormatting',
            config: {
              type: 'HiddenControl',
              default: {},
            },
          },
        ],
        [
          {
            name: 'rowSorting',
            config: {
              type: 'HiddenControl',
              default: {},
            },
          },
        ],
        [
          {
            name: 'colSorting',
            config: {
              type: 'HiddenControl',
              default: {},
            },
          },
        ],
        [
          {
            name: 'expansionState',
            config: {
              type: 'HiddenControl',
              default: null,
              dontRefreshOnChange: true,
            },
          },
        ],
        ['adhoc_filters'],
        ['series_limit'],
        [
          {
            name: 'row_limit',
            config: {
              ...sharedControls.row_limit,
              label: t('Row limit'),
            },
          },
        ],
        [
          {
            name: 'series_limit_metric',
            config: {
              ...sharedControls.series_limit_metric,
              description: t(
                'Metric used to define how the top series are sorted when limits are applied.',
              ),
            },
          },
        ],
        [
          {
            name: 'order_desc',
            config: {
              type: 'CheckboxControl',
              label: t('Sort Descending'),
              default: true,
              description: t('Whether to sort descending or ascending'),
            },
          },
        ],
      ],
    },
    {
      label: t('Options'),
      expanded: true,
      controlSetRows: [
        [
          <ControlSubSectionHeader key="pivot-expansion">
            {t('Expansion')}
          </ControlSubSectionHeader>,
        ],
        [
          {
            name: 'expandRowsLevel',
            config: {
              type: 'TextControl',
              label: t('Auto-expand row levels'),
              isInt: true,
              min: 0,
              placeholder: t('0'),
              renderTrigger: true,
              description: t(
                'Number of row levels to expand on initial load. Leave blank or use 0 to keep rows collapsed.',
              ),
            },
          },
        ],
        [
          {
            name: 'expandColumnsLevel',
            config: {
              type: 'TextControl',
              label: t('Auto-expand column levels'),
              isInt: true,
              min: 0,
              placeholder: t('0'),
              renderTrigger: true,
              description: t(
                'Number of column levels to expand on initial load. Leave blank or use 0 to keep columns collapsed.',
              ),
            },
          },
        ],
        [
          {
            name: 'stickyHeaders',
            config: {
              type: 'CheckboxControl',
              label: t('Sticky headers'),
              default: true,
              renderTrigger: true,
              description: t(
                'Keep row and column headers visible while scrolling the table.',
              ),
            },
          },
        ],
        [
          <ControlSubSectionHeader key="pivot-row-options">
            {t('Row options')}
          </ControlSubSectionHeader>,
        ],
        [
          {
            name: 'rowTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Row total'),
              description: t('Show grand total for rows.'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'rowTotalPosition',
            config: {
              type: 'SelectControl',
              label: t('Row total position'),
              description: t('Show the row grand total at the top or bottom.'),
              clearable: false,
              default: 'start',
              renderTrigger: true,
              choices: [
                ['start', t('Top')],
                ['end', t('Bottom')],
              ],
            },
          },
        ],
        [
          {
            name: 'rowSubTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Row subtotals'),
              description: t('Show subtotals for row groups.'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'rowSubtotalPosition',
            config: {
              type: 'SelectControl',
              label: t('Row subtotal position'),
              description: t(
                'Show row subtotals inline or as a row at the bottom.',
              ),
              clearable: false,
              default: 'start',
              renderTrigger: true,
              choices: [
                ['start', t('Top')],
                ['end', t('Bottom')],
              ],
            },
          },
        ],
        [
          {
            name: 'rowOrder',
            config: {
              type: 'SelectControl',
              label: t('Sort rows by'),
              default: 'key_a_to_z',
              choices: [
                ['key_a_to_z', t('key a-z')],
                ['key_z_to_a', t('key z-a')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          <ControlSubSectionHeader key="pivot-column-options">
            {t('Column options')}
          </ControlSubSectionHeader>,
        ],
        [
          {
            name: 'colTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Column total'),
              description: t('Show grand total for columns.'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'colTotalPosition',
            config: {
              type: 'SelectControl',
              label: t('Column total position'),
              description: t(
                'Place the grand total column at the start or end.',
              ),
              clearable: false,
              default: 'start',
              renderTrigger: true,
              choices: [
                ['start', t('Front')],
                ['end', t('End')],
              ],
            },
          },
        ],
        [
          {
            name: 'colSubTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Column subtotals'),
              description: t('Show subtotals for column groups.'),
              default: false,
              renderTrigger: true,
              hidden: true,
            },
          },
        ],
        [
          {
            name: 'colSubtotalLevels',
            config: {
              type: ColumnSubtotalSelector,
              label: t('Column subtotals'),
              description: t(
                'Select which column levels should show subtotals. Grand total is controlled separately.',
              ),
              default: [],
              renderTrigger: true,
              shouldMapStateToProps: () => true,
              mapStateToProps: (
                state: ControlPanelState & {
                  actions?: { setControlValue?: SetControlValue };
                },
              ) => {
                const colsRaw = ensureIsArray(
                  state?.controls?.groupbyColumns?.value,
                );
                const colGroupby = stripMetricsPlaceholder(colsRaw);
                const colDepth = colGroupby.length;
                const maxSubtotalDepth = Math.max(colDepth - 1, 0);
                const options =
                  maxSubtotalDepth > 0
                    ? Array.from({ length: maxSubtotalDepth }).map((_, idx) => {
                        const labelColumn = colGroupby[idx];
                        const levelLabel = t('Level %s', idx + 1);
                        const label = labelColumn
                          ? `${levelLabel}: ${getColumnLabel(labelColumn)}`
                          : levelLabel;
                        return {
                          value: idx + 1,
                          label,
                        };
                      })
                    : [];
                const rawValue = ensureIsArray<number>(
                  state?.controls?.colSubtotalLevels?.value,
                );
                const legacyEnabled =
                  rawValue.length === 0 &&
                  !!state?.controls?.colSubTotals?.value;
                const normalizedValue = normalizeSubtotalLevels(
                  rawValue,
                  maxSubtotalDepth,
                  false,
                  legacyEnabled,
                ).filter(level => level > 0 && level <= maxSubtotalDepth);
                const enabled =
                  !!state?.controls?.colSubTotals?.value ||
                  normalizedValue.length > 0;
                return {
                  options,
                  value: normalizedValue,
                  enabled,
                  setControlValue: state?.actions?.setControlValue,
                };
              },
            },
          },
        ],
        [
          {
            name: 'colSubtotalPosition',
            config: {
              type: 'SelectControl',
              label: t('Column subtotal position'),
              description: t(
                'Place subtotal columns before or after their group.',
              ),
              clearable: false,
              default: 'start',
              renderTrigger: true,
              choices: [
                ['start', t('Front')],
                ['end', t('End')],
              ],
            },
          },
        ],
        [
          {
            name: 'colOrder',
            config: {
              type: 'SelectControl',
              label: t('Sort columns by'),
              default: 'key_a_to_z',
              choices: [
                ['key_a_to_z', t('key a-z')],
                ['key_z_to_a', t('key z-a')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          <ControlSubSectionHeader key="pivot-theme">
            {t('Theme')}
          </ControlSubSectionHeader>,
        ],
        [
          {
            name: 'pivotTheme',
            config: {
              type: 'SelectControl',
              label: t('Pivot table theme'),
              clearable: false,
              default: 'none',
              renderTrigger: true,
              options: themeOptions,
              optionRenderer: renderThemeOption,
              valueRenderer: renderThemeOption,
              description: t(
                'Choose a preset theme for headers and grand totals.',
              ),
            },
          },
        ],
        [
          {
            name: 'pivotThemeColors',
            config: {
              type: 'TextControl',
              label: t('Custom theme colors'),
              default: '',
              renderTrigger: true,
              mapStateToProps: state => {
                const rawValue = String(
                  state?.controls?.pivotThemeColors?.value || '',
                );
                const colors = parseThemeColors(rawValue).slice(0, 1);
                return {
                  description: colors.length
                    ? renderThemeSwatches(colors)
                    : t(
                        'Single hex color for header and grand totals, e.g. #DDEBF7',
                      ),
                };
              },
            },
          },
        ],
        [
          <ControlSubSectionHeader key="pivot-formatting">
            {t('Formatting')}
          </ControlSubSectionHeader>,
        ],
        [
          {
            name: 'valueFormat',
            config: {
              ...sharedControls.y_axis_format,
              label: t('Value format'),
            },
          },
        ],
        ['currency_format'],
        [
          {
            name: 'dateFormat',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Date format'),
              default: SMART_DATE_ID,
              renderTrigger: true,
              choices: D3_TIME_FORMAT_OPTIONS,
              description: t('D3 time format for datetime columns'),
            },
          },
        ],
        [
          {
            name: 'allowRenderHtml',
            config: {
              type: 'CheckboxControl',
              label: t('Render cells as HTML'),
              renderTrigger: true,
              default: true,
              description: t(
                'Render returned strings as HTML when safe. Useful for links or rich text.',
              ),
            },
          },
        ],
      ],
    },
  ],
  formDataOverrides: formData => {
    const metrics = ensureIsArray(formData.metrics);
    const rows = ensureIsArray(formData.groupbyRows);
    const cols = ensureIsArray(formData.groupbyColumns);
    const resolved = resolveMetricPlacement(rows, cols, {
      hasMetrics: metrics.length > 0,
      preferredAxis: formData.metricsLayout as MetricsLayoutEnum,
    });

    return {
      ...formData,
      metrics: getStandardizedControls().popAllMetrics(),
      metricsLayout: resolved.layout,
      groupbyRows: resolved.rows,
      groupbyColumns: resolved.cols,
      maxDepthPerFetch: 1,
    };
  },
};

export default config;
