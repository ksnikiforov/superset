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
import { type ComponentProps } from 'react';
import { QueryFormMetric } from '@superset-ui/core';
import { render, screen, userEvent, waitFor, within } from '../../testUtils';
import PivotDndMetricSelect, {
  updateMetricConfigForRename,
} from '../../../src/controls/PivotDndMetricSelect/PivotDndMetricSelect';

jest.setTimeout(60000);

type MetricSelectDatasource = ComponentProps<
  typeof PivotDndMetricSelect
>['datasource'];

const baseDatasource = { type: 'table' } as MetricSelectDatasource;

const baseProps = {
  type: PivotDndMetricSelect,
  actions: { setControlValue: jest.fn() },
  name: 'metrics',
  label: 'Metrics',
  onChange: jest.fn(),
  value: ['sum__value', 'avg__value'],
  columns: [],
  savedMetrics: [],
  multi: true,
  datasource: baseDatasource,
};

const renderOptions = {
  useDnd: true,
  useRedux: true,
  initialState: {
    explore: {
      datasource: baseDatasource,
    },
  },
};

describe('PivotDndMetricSelect', () => {
  it('renders a formatting button for each metric', () => {
    render(<PivotDndMetricSelect {...baseProps} />, renderOptions);

    const buttons = screen.getAllByTestId('pivot-metric-formatting-button');
    expect(buttons).toHaveLength(2);
  });

  it('opens the formatting popover on click', async () => {
    render(<PivotDndMetricSelect {...baseProps} />, renderOptions);

    const buttons = screen.getAllByTestId('pivot-metric-formatting-button');
    await userEvent.click(buttons[0]);

    expect(
      await screen.findByText('Conditional formatting'),
    ).toBeInTheDocument();
  });

  it('shows manual metric input options for formatting metrics', async () => {
    const setControlValue = jest.fn();
    render(
      <PivotDndMetricSelect
        {...baseProps}
        actions={{ setControlValue }}
        formData={{
          datasource: '1__table',
          metricFormatting: {},
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[0],
    );
    await screen.findByText('Conditional formatting');

    const backgroundSelect = screen.getByRole('combobox', {
      name: /background color metric/i,
    });
    await userEvent.click(backgroundSelect);
    await userEvent.clear(backgroundSelect);
    await userEvent.type(backgroundSelect, 'color_metric', { delay: 10 });

    const manualOption = await waitFor(() =>
      within(screen.getByRole('listbox')).getByText('color_metric'),
    );
    expect(manualOption).toBeInTheDocument();
  });

  it('merges background and text formatting selections', async () => {
    const setControlValue = jest.fn();
    render(
      <PivotDndMetricSelect
        {...baseProps}
        actions={{ setControlValue }}
        formData={{
          datasource: '1__table',
          metricFormatting: {},
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[0],
    );
    await screen.findByText('Conditional formatting');

    const backgroundSelect = screen.getByRole('combobox', {
      name: /background color metric/i,
    });
    const textSelect = screen.getByRole('combobox', {
      name: /text color metric/i,
    });
    await userEvent.click(backgroundSelect);
    const backgroundOption = await waitFor(() =>
      within(screen.getByRole('listbox')).getByText('sum__value'),
    );
    await userEvent.click(backgroundOption);
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );

    await userEvent.click(textSelect);
    const textOption = await waitFor(() =>
      within(screen.getByRole('listbox')).getByText('avg__value'),
    );
    await userEvent.click(textOption);

    await waitFor(() =>
      expect(setControlValue).toHaveBeenLastCalledWith('metricFormatting', {
        sum__value: {
          backgroundColor: 'sum__value',
          textColor: 'avg__value',
        },
      }),
    );
  });

  it('stores databar configuration when a type is selected', async () => {
    const setControlValue = jest.fn();
    render(
      <PivotDndMetricSelect
        {...baseProps}
        actions={{ setControlValue }}
        formData={{
          datasource: '1__table',
          metricFormatting: {},
          metricDatabars: {},
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[0],
    );
    await screen.findByText('Databars');

    const typeSelect = screen.getByRole('combobox', { name: /databar type/i });
    await userEvent.click(typeSelect);
    await userEvent.click(await screen.findByText('Filled bar'));

    await waitFor(() =>
      expect(setControlValue).toHaveBeenCalledWith(
        'metricDatabars',
        expect.objectContaining({
          sum__value: expect.objectContaining({
            type: 'bar',
          }),
        }),
      ),
    );
  });

  it('disables scale-like for metrics that are already scale targets', async () => {
    render(
      <PivotDndMetricSelect
        {...baseProps}
        formData={{
          datasource: '1__table',
          metricFormatting: {},
          metricDatabars: {
            sum__value: {
              type: 'bar',
              scaleLike: 'avg__value',
            },
            avg__value: {
              type: 'bar',
            },
          },
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[1],
    );
    await screen.findByText('Databars');

    const scaleLikeSelect = screen.getByRole('combobox', {
      name: /scale like/i,
    });
    await userEvent.click(scaleLikeSelect);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters scale-like targets to prevent chaining', async () => {
    render(
      <PivotDndMetricSelect
        {...baseProps}
        value={['sum__value', 'avg__value', 'count__value']}
        formData={{
          datasource: '1__table',
          metricFormatting: {},
          metricDatabars: {
            sum__value: {
              type: 'bar',
              scaleLike: 'avg__value',
            },
            avg__value: {
              type: 'bar',
            },
            count__value: {
              type: 'bar',
            },
          },
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[2],
    );
    await screen.findByText('Databars');

    const scaleLikeSelect = screen.getByRole('combobox', {
      name: /scale like/i,
    });
    await userEvent.click(scaleLikeSelect);

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByText('sum__value')).not.toBeInTheDocument();
    expect(within(listbox).getByText('avg__value')).toBeInTheDocument();
  });

  it('keeps databar references when a metric is renamed', () => {
    const oldMetric: QueryFormMetric = {
      expressionType: 'SQL',
      sqlExpression: 'SUM(value)',
      label: 'OldMetric',
    };
    const newMetric: QueryFormMetric = {
      expressionType: 'SQL',
      sqlExpression: 'SUM(value)',
      label: 'NewMetric',
    };
    const { metricDatabars, metricFormatting } = updateMetricConfigForRename({
      metricFormatting: {
        metricA: {
          backgroundColor: 'OldMetric',
        },
      },
      metricDatabars: {
        metricA: {
          type: 'bar',
          scaleLike: 'OldMetric',
        },
        OldMetric: {
          type: 'bar',
        },
      },
      oldMetric,
      newMetric,
    });

    expect(metricDatabars.OldMetric).toBeUndefined();
    expect(metricDatabars.NewMetric).toEqual(
      expect.objectContaining({ type: 'bar' }),
    );
    expect(metricDatabars.metricA?.scaleLike).toEqual(
      expect.objectContaining({
        expressionType: 'SQL',
        sqlExpression: 'SUM(value)',
        label: 'NewMetric',
      }),
    );
    expect(metricFormatting.metricA?.backgroundColor).toEqual(
      expect.objectContaining({
        expressionType: 'SQL',
        sqlExpression: 'SUM(value)',
        label: 'NewMetric',
      }),
    );
  });

  it('keeps formatting references when a metric formula changes', () => {
    const oldMetric: QueryFormMetric = {
      expressionType: 'SQL',
      sqlExpression: 'MEASURE(grossRevenue)',
      label: 'grossRevenue',
      optionName: 'metric_abc123',
    };
    const newMetric: QueryFormMetric = {
      expressionType: 'SQL',
      sqlExpression: 'MEASURE(grossRevenue) / 100',
      label: 'grossRevenue / 100',
      optionName: 'metric_abc123',
    };
    const { metricDatabars, metricFormatting } = updateMetricConfigForRename({
      metricFormatting: {
        metricB: {
          backgroundColor: oldMetric,
        },
      },
      metricDatabars: {
        metricB: {
          type: 'bar',
          scaleLike: oldMetric,
        },
      },
      oldMetric,
      newMetric,
    });

    expect(typeof metricDatabars.metricB?.scaleLike).toBe('object');
    expect(metricDatabars.metricB?.scaleLike).toEqual(
      expect.objectContaining({
        sqlExpression: 'MEASURE(grossRevenue) / 100',
        label: 'grossRevenue / 100',
      }),
    );
    expect(metricFormatting.metricB?.backgroundColor).toEqual(
      expect.objectContaining({
        sqlExpression: 'MEASURE(grossRevenue) / 100',
        label: 'grossRevenue / 100',
      }),
    );
  });

  it('keeps formatting for adhoc metrics with verbose labels', async () => {
    const setControlValue = jest.fn();
    const adhocMetric: QueryFormMetric = {
      expressionType: 'SIMPLE',
      aggregate: 'SUM',
      column: {
        column_name: 'sales',
        verbose_name: 'Sales',
      },
    };
    const metricKey = 'SUM(Sales)';

    render(
      <PivotDndMetricSelect
        {...baseProps}
        actions={{ setControlValue }}
        value={[adhocMetric]}
        columns={[{ column_name: 'sales', verbose_name: 'Sales' }]}
        savedMetrics={[]}
        formData={{
          datasource: '1__table',
          metricFormatting: {
            [metricKey]: { backgroundColor: 'color_metric' },
          },
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await waitFor(() => expect(setControlValue).not.toHaveBeenCalled());
  });

  it('hydrates formatting selections from persisted labeled values', async () => {
    render(
      <PivotDndMetricSelect
        {...baseProps}
        formData={{
          datasource: '1__table',
          metricFormatting: {
            sum__value: {
              backgroundColor: { value: { key: 'color_metric' } },
            },
          },
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[0],
    );
    await screen.findByText('Conditional formatting');

    const backgroundSelect = screen.getByRole('combobox', {
      name: /background color metric/i,
    });
    const selectContainer = backgroundSelect.closest('.ant-select');
    expect(selectContainer).not.toBeNull();

    await waitFor(() => {
      expect(
        selectContainer?.querySelector('.ant-select-selection-item')
          ?.textContent,
      ).toContain('color_metric');
    });
  });

  it('hydrates formatting metrics missing expressionType', async () => {
    render(
      <PivotDndMetricSelect
        {...baseProps}
        formData={{
          datasource: '1__table',
          metricFormatting: {
            sum__value: {
              backgroundColor: {
                sqlExpression: 'SUM(orders)',
                label: 'cond_format',
                hasCustomLabel: true,
              },
            },
          },
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[0],
    );
    await screen.findByText('Conditional formatting');

    const backgroundSelect = screen.getByRole('combobox', {
      name: /background color metric/i,
    });
    const selectContainer = backgroundSelect.closest('.ant-select');
    expect(selectContainer).not.toBeNull();

    await waitFor(() => {
      expect(
        selectContainer?.querySelector('.ant-select-selection-item')
          ?.textContent,
      ).toContain('cond_format');
    });
  });

  it('hydrates formatting when formatting key matches the metric label', async () => {
    const savedMetric = {
      metric_name: 'avg__order_value',
      verbose_name: 'averageOrderValue',
      uuid: 'metric-1',
    };
    render(
      <PivotDndMetricSelect
        {...baseProps}
        value={[savedMetric.metric_name]}
        savedMetrics={[savedMetric]}
        formData={{
          datasource: '1__table',
          metricFormatting: {
            averageOrderValue: {
              backgroundColor: 'cond_format',
            },
          },
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[0],
    );
    await screen.findByText('Conditional formatting');

    const backgroundSelect = screen.getByRole('combobox', {
      name: /background color metric/i,
    });
    const selectContainer = backgroundSelect.closest('.ant-select');
    expect(selectContainer).not.toBeNull();

    await waitFor(() => {
      expect(
        selectContainer?.querySelector('.ant-select-selection-item')
          ?.textContent,
      ).toContain('cond_format');
    });
  });

  it('keeps distinct adhoc formatting metrics with identical labels', async () => {
    const formattingMetricOne: QueryFormMetric = {
      expressionType: 'SQL',
      sqlExpression: 'SUM(a)',
      label: 'formatting',
      hasCustomLabel: true,
      optionName: 'metric_formatting_1',
    };
    const formattingMetricTwo: QueryFormMetric = {
      expressionType: 'SQL',
      sqlExpression: 'SUM(b)',
      label: 'formatting',
      hasCustomLabel: true,
      optionName: 'metric_formatting_2',
    };

    render(
      <PivotDndMetricSelect
        {...baseProps}
        value={['sum__value']}
        formData={{
          datasource: '1__table',
          metricFormatting: {
            sum__value: {
              backgroundColor: formattingMetricOne,
              textColor: formattingMetricTwo,
            },
          },
          viz_type: 'pivot_table_v3',
        }}
      />,
      renderOptions,
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-metric-formatting-button')[0],
    );
    await screen.findByText('Conditional formatting');

    const backgroundSelect = screen.getByRole('combobox', {
      name: /background color metric/i,
    });
    await userEvent.click(backgroundSelect);
    const listbox = await screen.findByRole('listbox');

    expect(within(listbox).getAllByText('formatting')).toHaveLength(2);
  });
});
