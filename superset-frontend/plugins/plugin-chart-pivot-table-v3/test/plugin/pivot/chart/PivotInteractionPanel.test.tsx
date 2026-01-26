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

  it('shows comparison chips only when non-value leaves exist', () => {
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

    expect(screen.queryByText('Comparisons')).not.toBeInTheDocument();

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

    expect(screen.getByText('Comparisons')).toBeInTheDocument();
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

    fireEvent.click(screen.getByText('Apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
