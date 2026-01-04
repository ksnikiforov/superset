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
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from 'spec/helpers/testing-library';
import { QueryFormMetric } from '@superset-ui/core';
import PivotDndMetricSelect from '../../../src/controls/PivotDndMetricSelect/PivotDndMetricSelect';

jest.setTimeout(60000);

const baseProps = {
  name: 'metrics',
  label: 'Metrics',
  onChange: jest.fn(),
  value: ['sum__value', 'avg__value'],
  columns: [],
  savedMetrics: [],
  multi: true,
};

describe('PivotDndMetricSelect', () => {
  it('renders a formatting button for each metric', () => {
    render(<PivotDndMetricSelect {...baseProps} />, { useDnd: true });

    const buttons = screen.getAllByTestId('pivot-metric-formatting-button');
    expect(buttons).toHaveLength(2);
  });

  it('opens the formatting popover on click', async () => {
    render(<PivotDndMetricSelect {...baseProps} />, { useDnd: true });

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
      { useDnd: true },
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
      { useDnd: true },
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
      expect(setControlValue).toHaveBeenLastCalledWith(
        'metricFormatting',
        {
          sum__value: {
            backgroundColor: 'sum__value',
            textColor: 'avg__value',
          },
        },
      ),
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
      { useDnd: true },
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
      { useDnd: true },
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
      { useDnd: true },
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
      { useDnd: true },
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
      { useDnd: true },
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
