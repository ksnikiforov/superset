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
  D3_TIME_FORMAT_OPTIONS,
  getStandardizedControls,
  sharedControls,
} from '@superset-ui/chart-controls';
import {
  ensureIsArray,
  isAdhocColumn,
  isPhysicalColumn,
  SMART_DATE_ID,
  t,
  validateNonEmpty,
} from '@superset-ui/core';
import { MetricsLayoutEnum } from './types';
import { METRICS_PLACEHOLDER } from './utils';

const withMetricsPlaceholder = (config: any) => ({
  ...config,
  mapStateToProps: (state: any, controlState: any, chart: any) => {
    const base =
      typeof config.mapStateToProps === 'function'
        ? config.mapStateToProps(state, controlState, chart)
        : {};
    const metricsValue = ensureIsArray(state?.controls?.metrics?.value);
    const options = ensureIsArray(base?.options);
    const hasPlaceholder = options.some(
      (opt: any) => (opt?.column_name || opt?.label) === METRICS_PLACEHOLDER,
    );
    const placeholderOption = {
      column_name: METRICS_PLACEHOLDER,
      verbose_name: t('Measures'),
      label: t('Measures'),
    };
    const nextOptions = metricsValue.length
      ? hasPlaceholder
        ? options
        : [...options, placeholderOption]
      : options.filter(
          (opt: any) => (opt?.column_name || opt?.label) !== METRICS_PLACEHOLDER,
        );
    return {
      ...base,
      options: nextOptions,
    };
  },
});

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'groupbyColumns',
            config: withMetricsPlaceholder({
              ...sharedControls.groupby,
              label: t('Columns'),
              description: t('Columns to group by on the columns'),
            }),
          },
        ],
        [
          {
            name: 'groupbyRows',
            config: withMetricsPlaceholder({
              ...sharedControls.groupby,
              label: t('Rows'),
              description: t('Columns to group by on the rows'),
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
              validators: [validateNonEmpty],
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
          {
            name: 'aggregateFunction',
            config: {
              type: 'SelectControl',
              label: t('Aggregation function'),
              clearable: false,
              choices: [
                ['Count', t('Count')],
                ['Count Unique Values', t('Count Unique Values')],
                ['Sum', t('Sum')],
                ['Average', t('Average')],
                ['Median', t('Median')],
                ['Minimum', t('Minimum')],
                ['Maximum', t('Maximum')],
              ],
              default: 'Sum',
              description: t(
                'Server-side aggregation used for totals and prefetched branches.',
              ),
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'startCollapsed',
            config: {
              type: 'CheckboxControl',
              label: t('Start collapsed'),
              default: true,
              renderTrigger: true,
              description: t(
                'Load top-level totals first. Branches fetch lazily as you expand.',
              ),
            },
          },
        ],
        [
          {
            name: 'initialDepth',
            config: {
              type: 'TextControl',
              label: t('Initial depth'),
              default: 1,
              isInt: true,
              renderTrigger: true,
              description: t(
                'How many levels to fetch/expand on initial load when collapsed.',
              ),
            },
          },
          {
            name: 'maxDepthPerFetch',
            config: {
              type: 'TextControl',
              label: t('Max depth per fetch'),
              default: 1,
              isInt: true,
              renderTrigger: true,
              description: t('Depth fetched for each expanded branch.'),
            },
          },
        ],
        [
          {
            name: 'rowTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show rows total'),
              default: false,
              renderTrigger: true,
              description: t('Display row level total from the database.'),
            },
          },
          {
            name: 'rowSubTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show rows subtotal'),
              default: false,
              renderTrigger: true,
              description: t('Display row level subtotal from the database.'),
            },
          },
        ],
        [
          {
            name: 'colTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show columns total'),
              default: false,
              renderTrigger: true,
              description: t('Display column level total from the database.'),
            },
          },
          {
            name: 'colSubTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show columns subtotal'),
              default: false,
              renderTrigger: true,
              description: t('Display column level subtotal from the database.'),
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
          {
            name: 'metricsLayout',
            config: {
              type: 'RadioButtonControl',
              renderTrigger: true,
              label: t('Apply metrics on'),
              default: MetricsLayoutEnum.COLUMNS,
              options: [
                [MetricsLayoutEnum.COLUMNS, t('Columns')],
                [MetricsLayoutEnum.ROWS, t('Rows')],
              ],
              description: t(
                'Show metrics grouped with columns or grouped with rows.',
              ),
            },
          },
          {
            name: 'transposePivot',
            config: {
              type: 'CheckboxControl',
              label: t('Transpose pivot'),
              default: false,
              description: t('Swap rows and columns'),
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'combineMetric',
            config: {
              type: 'CheckboxControl',
              label: t('Combine metrics'),
              default: false,
              description: t('Display metrics together within each dimension.'),
              renderTrigger: true,
            },
          },
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

    // Auto-insert the measures placeholder into columns when metrics exist and
    // it isn't already placed. Remove it when no metrics are selected.
    const hasPlaceholderInRows = rows.includes(METRICS_PLACEHOLDER);
    const hasPlaceholderInCols = cols.includes(METRICS_PLACEHOLDER);
    const shouldInsertPlaceholder = metrics.length > 0;
    const sanitizedRows = shouldInsertPlaceholder
      ? rows
      : rows.filter(col => col !== METRICS_PLACEHOLDER);
    const sanitizedCols = shouldInsertPlaceholder
      ? cols
      : cols.filter(col => col !== METRICS_PLACEHOLDER);

    const groupbyColumns = getStandardizedControls().controls.columns.filter(
      col => !sanitizedRows.includes(col),
    );
    getStandardizedControls().controls.columns =
      getStandardizedControls().controls.columns.filter(
        col => !groupbyColumns.includes(col),
      );

    const nextGroupbyColumns =
      shouldInsertPlaceholder && !hasPlaceholderInRows && !hasPlaceholderInCols
        ? [...sanitizedCols, METRICS_PLACEHOLDER]
        : sanitizedCols;

    return {
      ...formData,
      metrics: getStandardizedControls().popAllMetrics(),
      groupbyRows: sanitizedRows,
      groupbyColumns: nextGroupbyColumns,
    };
  },
};

export default config;
