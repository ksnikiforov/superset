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
import { useState } from 'react';
import { fireEvent, render, screen } from '../../../testUtils';
import { PivotInteractionPanel } from '../../../../src/pivot/chart/PivotInteractionPanel';
import { PivotRuntimeLayout } from '../../../../src/types';
import {
  buildBuiltInLeaf,
  buildValueLeaf,
} from '../../../../src/pivot/measureLeaves';

const baseLayout: PivotRuntimeLayout = {
  version: 1,
  rows: [],
  cols: [],
  metrics: ['sum__sales'],
  leafSelection: {},
  valuePlacement: { axis: 'col', index: 0 },
};

const InteractionHarness = ({
  dimensions,
  metrics,
  runtimeLayout = baseLayout,
}: {
  dimensions: string[];
  metrics: string[];
  runtimeLayout?: PivotRuntimeLayout;
}) => {
  const [layout, setLayout] = useState<PivotRuntimeLayout>(runtimeLayout);
  return (
    <PivotInteractionPanel
      dimensions={dimensions}
      metrics={metrics}
      runtimeLayout={layout}
      onChange={setLayout}
    />
  );
};

const LayoutHarness = ({
  dimensions,
  metrics,
  runtimeLayout = baseLayout,
}: {
  dimensions: string[];
  metrics: string[];
  runtimeLayout?: PivotRuntimeLayout;
}) => {
  const [layout, setLayout] = useState<PivotRuntimeLayout>(runtimeLayout);
  return (
    <>
      <PivotInteractionPanel
        dimensions={dimensions}
        metrics={metrics}
        runtimeLayout={layout}
        onChange={setLayout}
      />
      <div data-test="layout-cols">{layout.cols.join(',')}</div>
      <div data-test="layout-value">
        {`${layout.valuePlacement.axis}:${layout.valuePlacement.index}`}
      </div>
    </>
  );
};

const LeafOrderHarness = ({
  dimensions,
  metrics,
  runtimeLayout = baseLayout,
  measureLeavesByMetric,
}: {
  dimensions: string[];
  metrics: string[];
  runtimeLayout?: PivotRuntimeLayout;
  measureLeavesByMetric?: Record<string, ReturnType<typeof buildValueLeaf>[]>;
}) => {
  const [layout, setLayout] = useState<PivotRuntimeLayout>(runtimeLayout);
  return (
    <>
      <PivotInteractionPanel
        dimensions={dimensions}
        metrics={metrics}
        runtimeLayout={layout}
        measureLeavesByMetric={measureLeavesByMetric}
        onChange={setLayout}
      />
      <div data-test="leaf-order">{(layout.leafOrder ?? []).join(',')}</div>
    </>
  );
};

describe('PivotInteractionPanel', () => {
  it('commits metrics order when the measures popover closes', () => {
    const onChange = jest.fn();
    render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales', 'sum__profit']}
        runtimeLayout={baseLayout}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('Select measures'));
    fireEvent.click(screen.getByLabelText('Toggle measure sum__profit'));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Select measures'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].metrics).toEqual([
      'sum__sales',
      'sum__profit',
    ]);
  });

  it('uses metric labels in the measures selector', () => {
    render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales']}
        metricLabelMap={{ sum__sales: 'Total Sales' }}
        runtimeLayout={baseLayout}
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Select measures'));

    expect(
      screen.getByLabelText('Toggle measure Total Sales'),
    ).toBeInTheDocument();
  });

  it('uses dimension labels from the label map', () => {
    render(
      <PivotInteractionPanel
        dimensions={['shipMode']}
        metrics={['sum__sales']}
        dimensionLabelMap={{ shipMode: 'Delivery Type' }}
        runtimeLayout={baseLayout}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Delivery Type')).toBeInTheDocument();
  });

  it('respects the order that measures are selected', () => {
    const onChange = jest.fn();
    render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales', 'sum__profit', 'sum__margin']}
        runtimeLayout={baseLayout}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('Select measures'));
    fireEvent.click(screen.getByLabelText('Toggle measure sum__profit'));
    fireEvent.click(screen.getByLabelText('Toggle measure sum__sales'));
    fireEvent.click(screen.getByLabelText('Toggle measure sum__sales'));
    fireEvent.click(screen.getByText('Select measures'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].metrics).toEqual([
      'sum__profit',
      'sum__sales',
    ]);
  });

  it('shows order numbers for row selections and clears them when deselected', () => {
    render(
      <InteractionHarness
        dimensions={['country', 'state']}
        metrics={['sum__sales']}
      />,
    );

    const rowButtons = screen.getAllByLabelText('Toggle row dimension');
    expect(rowButtons[0]).toHaveTextContent('');
    expect(rowButtons[1]).toHaveTextContent('');

    fireEvent.click(rowButtons[0]);
    const rowButtonsAfterFirst = screen.getAllByLabelText(
      'Toggle row dimension',
    );
    expect(rowButtonsAfterFirst[0]).toHaveTextContent('1');

    fireEvent.click(rowButtonsAfterFirst[1]);
    const rowButtonsAfterSecond = screen.getAllByLabelText(
      'Toggle row dimension',
    );
    expect(rowButtonsAfterSecond[1]).toHaveTextContent('2');

    fireEvent.click(rowButtonsAfterSecond[0]);
    const rowButtonsAfterClear = screen.getAllByLabelText(
      'Toggle row dimension',
    );
    expect(rowButtonsAfterClear[0]).toHaveTextContent('');
  });

  it('keeps row/column selections mutually exclusive', () => {
    render(
      <InteractionHarness dimensions={['country']} metrics={['sum__sales']} />,
    );

    const rowButton = screen.getByLabelText('Toggle row dimension');
    const colButton = screen.getByLabelText('Toggle column dimension');

    fireEvent.click(rowButton);
    expect(rowButton).toHaveTextContent('1');
    expect(colButton).toHaveTextContent('');

    fireEvent.click(colButton);
    const rowButtonAfter = screen.getByLabelText('Toggle row dimension');
    const colButtonAfter = screen.getByLabelText('Toggle column dimension');
    expect(rowButtonAfter).toHaveTextContent('');
    expect(colButtonAfter).toHaveTextContent('1');
  });

  it('shows order numbers for column selections', () => {
    render(
      <InteractionHarness
        dimensions={['country', 'state']}
        metrics={['sum__sales']}
      />,
    );

    const colButtons = screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(colButtons[0]);
    fireEvent.click(colButtons[1]);

    const colButtonsAfter = screen.getAllByLabelText('Toggle column dimension');
    expect(colButtonsAfter[0]).toHaveTextContent('1');
    expect(colButtonsAfter[1]).toHaveTextContent('2');
  });

  it('inserts new column dimensions at the end when value is in the middle', () => {
    const onChange = jest.fn();
    const layout: PivotRuntimeLayout = {
      ...baseLayout,
      cols: ['col1', 'col2'],
      valuePlacement: { axis: 'col', index: 1 },
    };
    render(
      <PivotInteractionPanel
        dimensions={['col1', 'col2', 'col3']}
        metrics={['sum__sales']}
        runtimeLayout={layout}
        onChange={onChange}
      />,
    );

    const colButtons = screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(colButtons[2]);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].cols).toEqual(['col1', 'col2', 'col3']);
    expect(onChange.mock.calls[0][0].valuePlacement).toEqual({
      axis: 'col',
      index: 1,
    });
  });

  it('keeps value placement stable when re-adding a column dimension', () => {
    render(
      <LayoutHarness
        dimensions={['col1', 'col2', 'col3']}
        metrics={['sum__sales']}
        runtimeLayout={{
          ...baseLayout,
          cols: ['col1', 'col2'],
          valuePlacement: { axis: 'col', index: 1 },
        }}
      />,
    );

    const colButtons = screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(colButtons[2]);
    fireEvent.click(colButtons[1]);
    fireEvent.click(colButtons[1]);

    expect(screen.getByTestId('layout-cols')).toHaveTextContent(
      'col1,col3,col2',
    );
    expect(screen.getByTestId('layout-value')).toHaveTextContent('col:1');
  });

  it('inserts before value when value is last on the target axis', () => {
    const onChange = jest.fn();
    const layout: PivotRuntimeLayout = {
      ...baseLayout,
      cols: ['col1', 'col2'],
      valuePlacement: { axis: 'col', index: 2 },
    };
    render(
      <PivotInteractionPanel
        dimensions={['col1', 'col2', 'col3']}
        metrics={['sum__sales']}
        runtimeLayout={layout}
        onChange={onChange}
      />,
    );

    const colButtons = screen.getAllByLabelText('Toggle column dimension');
    fireEvent.click(colButtons[2]);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].cols).toEqual(['col1', 'col2', 'col3']);
    expect(onChange.mock.calls[0][0].valuePlacement).toEqual({
      axis: 'col',
      index: 3,
    });
  });

  it('inserts before value when value is the only chip on the target axis', () => {
    const onChange = jest.fn();
    const layout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: [],
      cols: [],
      valuePlacement: { axis: 'row', index: 0 },
    };
    render(
      <PivotInteractionPanel
        dimensions={['row1']}
        metrics={['sum__sales']}
        runtimeLayout={layout}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Toggle row dimension'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].rows).toEqual(['row1']);
    expect(onChange.mock.calls[0][0].valuePlacement).toEqual({
      axis: 'row',
      index: 1,
    });
  });

  it('moves a dimension to the column axis when the column checkbox is clicked', () => {
    const onChange = jest.fn();
    const layout: PivotRuntimeLayout = {
      ...baseLayout,
      rows: ['country'],
      cols: [],
    };
    render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales']}
        runtimeLayout={layout}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Toggle column dimension'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].rows).toEqual([]);
    expect(onChange.mock.calls[0][0].cols).toEqual(['country']);
  });

  it('shows leaf chips only when non-value leaves exist', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales']}
        runtimeLayout={baseLayout}
        measureLeavesByMetric={{
          sum__sales: [buildValueLeaf()],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByText('IX 1YA')).not.toBeInTheDocument();

    rerender(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales']}
        runtimeLayout={baseLayout}
        measureLeavesByMetric={{
          sum__sales: [
            buildValueLeaf(),
            buildBuiltInLeaf('ix', { n: 1, unit: 'year', direction: 'past' }),
          ],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('IX 1YA')).toBeInTheDocument();
  });

  it('keeps leaf order in user selection order across value deselect/reselect', () => {
    const valueLeaf = buildValueLeaf();
    const ixLeaf = buildBuiltInLeaf('ix', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const deltaLeaf = buildBuiltInLeaf('delta', {
      n: 1,
      unit: 'year',
      direction: 'past',
    });
    const initialLayout: PivotRuntimeLayout = {
      ...baseLayout,
      leafSelection: {
        [valueLeaf.id]: true,
        [ixLeaf.id]: false,
        [deltaLeaf.id]: false,
      },
      leafOrder: [valueLeaf.id],
    };
    render(
      <LeafOrderHarness
        dimensions={['country']}
        metrics={['sum__sales']}
        runtimeLayout={initialLayout}
        measureLeavesByMetric={{
          sum__sales: [valueLeaf, ixLeaf, deltaLeaf],
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText('Toggle leaf IX 1YA'));
    fireEvent.click(screen.getByLabelText('Toggle leaf Value'));
    fireEvent.click(screen.getByLabelText('Toggle leaf Value'));
    fireEvent.click(screen.getByLabelText('Toggle leaf ∆ 1YA'));

    expect(screen.getByTestId('leaf-order')).toHaveTextContent(
      [ixLeaf.id, valueLeaf.id, deltaLeaf.id].join(','),
    );
  });

  it('clears all filters from the header control', () => {
    const onChange = jest.fn();
    const onClearFilters = jest.fn();
    render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales']}
        runtimeLayout={baseLayout}
        selectedFilters={{ country: ['US'] }}
        onClearFilters={onClearFilters}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Clear filters'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('closes filter popover and discards pending values when clearing all filters', async () => {
    const onChange = jest.fn();
    const onClearFilters = jest.fn();
    const onFilterChange = jest.fn();
    render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales']}
        runtimeLayout={baseLayout}
        selectedFilters={{ country: ['US'] }}
        dimensionFilterValues={{ country: ['US', 'CA'] }}
        onFilterChange={onFilterChange}
        onClearFilters={onClearFilters}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter values' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    fireEvent.click(screen.getByText('CA'));
    fireEvent.click(screen.getByLabelText('Clear filters'));

    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders an apply button when enabled', () => {
    const onChange = jest.fn();
    const onApply = jest.fn();
    render(
      <PivotInteractionPanel
        dimensions={['country']}
        metrics={['sum__sales']}
        runtimeLayout={baseLayout}
        onChange={onChange}
        onApply={onApply}
        showApply
      />,
    );

    fireEvent.click(screen.getByText('Update chart'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
