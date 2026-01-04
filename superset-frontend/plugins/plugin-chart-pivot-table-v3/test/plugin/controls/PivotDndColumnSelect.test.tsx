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
import PivotDndColumnSelect from '../../../src/controls/PivotDndColumnSelect/PivotDndColumnSelect';

jest.setTimeout(60000);

const baseProps = {
  name: 'groupbyRows',
  label: 'Rows',
  onChange: jest.fn(),
  value: ['country'],
  options: [{ column_name: 'country', verbose_name: 'Country' }],
  multi: true,
  savedMetrics: [],
};

describe('PivotDndColumnSelect', () => {
  it('renders a formatting button for each column', () => {
    render(<PivotDndColumnSelect {...baseProps} />, {
      useDnd: true,
      useRedux: true,
    });

    const buttons = screen.getAllByTestId('pivot-dimension-formatting-button');
    expect(buttons).toHaveLength(1);
  });

  it('renders a sorting button for each column', () => {
    render(<PivotDndColumnSelect {...baseProps} />, {
      useDnd: true,
      useRedux: true,
    });

    const buttons = screen.getAllByTestId('pivot-dimension-sorting-button');
    expect(buttons).toHaveLength(1);
  });

  it('merges background and text formatting selections for rows', async () => {
    const setControlValue = jest.fn();
    render(
      <PivotDndColumnSelect
        {...baseProps}
        actions={{ setControlValue }}
        formData={{
          datasource: '1__table',
          metrics: ['metric1', 'metric2'],
          rowFormatting: {},
          viz_type: 'pivot_table_v3',
        }}
      />,
      { useDnd: true, useRedux: true },
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-dimension-formatting-button')[0],
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
      within(screen.getByRole('listbox')).getByText('metric1'),
    );
    await userEvent.click(backgroundOption);

    await userEvent.click(textSelect);
    const textOption = await waitFor(() =>
      within(screen.getByRole('listbox')).getByText('metric2'),
    );
    await userEvent.click(textOption);

    await waitFor(() =>
      expect(setControlValue).toHaveBeenLastCalledWith('rowFormatting', {
        country: {
          backgroundColor: 'metric1',
          textColor: 'metric2',
          applyTo: 'all',
        },
      }),
    );
  });

  it('updates sorting metric and order for rows', async () => {
    const setControlValue = jest.fn();
    render(
      <PivotDndColumnSelect
        {...baseProps}
        actions={{ setControlValue }}
        formData={{
          datasource: '1__table',
          metrics: ['metric1', 'metric2'],
          rowSorting: {},
          viz_type: 'pivot_table_v3',
        }}
      />,
      { useDnd: true, useRedux: true },
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-dimension-sorting-button')[0],
    );
    await screen.findByText('Sorting');

    const metricSelect = screen.getByRole('combobox', {
      name: /sort by metric/i,
    });
    await userEvent.click(metricSelect);
    const metricOption = await waitFor(() =>
      within(screen.getByRole('listbox')).getByText('metric1'),
    );
    await userEvent.click(metricOption);

    await waitFor(() =>
      expect(setControlValue).toHaveBeenLastCalledWith('rowSorting', {
        country: {
          metric: 'metric1',
          order: 'asc',
          mode: 'total',
        },
      }),
    );

    await userEvent.click(
      screen.getByRole('radio', { name: /descending/i }),
    );

    await waitFor(() =>
      expect(setControlValue).toHaveBeenLastCalledWith('rowSorting', {
        country: {
          metric: 'metric1',
          order: 'desc',
          mode: 'total',
        },
      }),
    );
  });

  it('updates the apply-to scope when toggled', async () => {
    const setControlValue = jest.fn();
    render(
      <PivotDndColumnSelect
        {...baseProps}
        actions={{ setControlValue }}
        formData={{
          datasource: '1__table',
          metrics: ['metric1'],
          rowFormatting: {},
          viz_type: 'pivot_table_v3',
        }}
      />,
      { useDnd: true, useRedux: true },
    );

    await userEvent.click(
      screen.getAllByTestId('pivot-dimension-formatting-button')[0],
    );
    await screen.findByText('Conditional formatting');

    const backgroundSelect = screen.getByRole('combobox', {
      name: /background color metric/i,
    });
    await userEvent.click(backgroundSelect);
    const backgroundOption = await waitFor(() =>
      within(screen.getByRole('listbox')).getByText('metric1'),
    );
    await userEvent.click(backgroundOption);

    await userEvent.click(
      screen.getByRole('radio', { name: /apply to value/i }),
    );

    await waitFor(() =>
      expect(setControlValue).toHaveBeenLastCalledWith('rowFormatting', {
        country: {
          backgroundColor: 'metric1',
          applyTo: 'label',
        },
      }),
    );
  });
});
