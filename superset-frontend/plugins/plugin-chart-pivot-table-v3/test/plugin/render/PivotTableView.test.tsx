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

import { createRef } from 'react';
import { fireEvent, render, screen } from '../../testUtils';
import {
  PivotTableView,
  type PivotTableViewProps,
} from '../../../src/pivot/render/PivotTableView';
import { type RenderModel } from '../../../src/pivot/render/renderModel';
import { type PivotTreeData, type PivotTreeNode } from '../../../src/types';
import { serializePath } from '../../../src/pivot/core/path';
import { type PivotFormattingResult } from '../../../src/pivot/chart/usePivotFormatting';
import { getPivotV3ExportSheetDataForChart } from '../../../src/export/buildPivotV3ExportTable';
import { compilePivotProgram } from '../../../src/pivot/runtime/compilePivotProgram';

const basePivotProgram = compilePivotProgram({
  groupbyRows: [],
  groupbyColumns: [],
  metrics: [],
});

const baseRenderModel: RenderModel = {
  visibleRows: [],
  visibleCols: [],
  columnHeaderRows: [],
  visibleCellEntries: [],
  showRowRoot: false,
};

const baseTree: PivotTreeData = {
  rows: {},
  cols: {},
  cells: {},
};

const baseFormatting: PivotFormattingResult = {
  hasPartialData: false,
  metricFormattingScope: 'values',
  metricDatabars: {},
  databarColumnMinWidths: new Map(),
  resolveDimensionStyle: () => undefined,
  resolveMetricCellFormatting: () => ({}),
  deriveMetricKey: () => '',
  formatExportCell: () => '',
  renderCellContent: () => null,
  renderDatabarContent: () => null,
  formatLabel: node => node.label,
  getTotalBackground: () => undefined,
};

const renderView = (
  showGlobalLoader: boolean,
  overrides: Partial<PivotTableViewProps> = {},
) =>
  render(
    <PivotTableView
      height={300}
      width={400}
      renderModel={baseRenderModel}
      pivotProgram={basePivotProgram}
      tree={baseTree}
      expandedRows={new Set()}
      expandedCols={new Set()}
      showGlobalLoader={showGlobalLoader}
      onRetry={jest.fn()}
      stickyHeaders={false}
      headerOffset={0}
      headerRowOffsets={[]}
      headerRef={createRef()}
      colTotalPosition="start"
      formatting={baseFormatting}
      onToggleNode={jest.fn()}
      shouldShowToggle={() => false}
      showSpinner={() => false}
      isRowAggregateBold={() => false}
      isColAggregateBold={() => false}
      getNodeDimDepth={() => 0}
      handleCellClick={jest.fn()}
      handleCellKeyDown={jest.fn()}
      handleCellContextMenu={jest.fn()}
      {...overrides}
    />,
  );

describe('PivotTableView', () => {
  test('marks exportable table with pivot-v3 selector class', () => {
    const { container } = renderView(false);
    const table = container.querySelector('table');
    expect(table).toHaveClass('pivot-v3-table');
  });

  test('registers worksheet export data for the chart id', () => {
    render(
      <PivotTableView
        height={300}
        width={400}
        renderModel={baseRenderModel}
        pivotProgram={basePivotProgram}
        tree={baseTree}
        expandedRows={new Set()}
        expandedCols={new Set()}
        showGlobalLoader={false}
        onRetry={jest.fn()}
        stickyHeaders={false}
        headerOffset={0}
        headerRowOffsets={[]}
        headerRef={createRef()}
        colTotalPosition="start"
        formatting={baseFormatting}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 0}
        handleCellClick={jest.fn()}
        handleCellKeyDown={jest.fn()}
        handleCellContextMenu={jest.fn()}
        exportChartId={371}
      />,
    );

    expect(getPivotV3ExportSheetDataForChart(371)).toEqual([
      [{ value: 'Rows', type: 'string', isHeader: true }],
    ]);
  });

  test('registers export data from the containing chart id as a fallback', () => {
    render(
      <div id="chart-id-372">
        <PivotTableView
          height={300}
          width={400}
          renderModel={baseRenderModel}
          pivotProgram={basePivotProgram}
          tree={baseTree}
          expandedRows={new Set()}
          expandedCols={new Set()}
          showGlobalLoader={false}
          onRetry={jest.fn()}
          stickyHeaders={false}
          headerOffset={0}
          headerRowOffsets={[]}
          headerRef={createRef()}
          colTotalPosition="start"
          formatting={baseFormatting}
          onToggleNode={jest.fn()}
          shouldShowToggle={() => false}
          showSpinner={() => false}
          isRowAggregateBold={() => false}
          isColAggregateBold={() => false}
          getNodeDimDepth={() => 0}
          handleCellClick={jest.fn()}
          handleCellKeyDown={jest.fn()}
          handleCellContextMenu={jest.fn()}
        />
      </div>,
    );

    expect(getPivotV3ExportSheetDataForChart(372)).toEqual([
      [{ value: 'Rows', type: 'string', isHeader: true }],
    ]);
  });

  test('renders the rows header when not loading', () => {
    renderView(false);
    expect(screen.getByText('Rows')).toBeInTheDocument();
  });

  test('hides the table when loading', () => {
    renderView(true);
    expect(screen.queryByText('Rows')).not.toBeInTheDocument();
  });

  test('marks actual null labels as muted', () => {
    const nullRow: PivotTreeNode = {
      axis: 'row',
      key: serializePath([null]),
      path: [null],
      label: '(NULL)',
      formattedLabel: '(NULL)',
      level: 1,
      hasChildren: false,
    };
    const renderModel: RenderModel = {
      ...baseRenderModel,
      visibleRows: [nullRow],
      visibleCols: [],
      columnHeaderRows: [],
    };
    render(
      <PivotTableView
        height={300}
        width={400}
        renderModel={renderModel}
        pivotProgram={basePivotProgram}
        tree={baseTree}
        expandedRows={new Set()}
        expandedCols={new Set()}
        showGlobalLoader={false}
        onRetry={jest.fn()}
        stickyHeaders={false}
        headerOffset={0}
        headerRowOffsets={[]}
        headerRef={createRef()}
        colTotalPosition="start"
        formatting={baseFormatting}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 0}
        handleCellClick={jest.fn()}
        handleCellKeyDown={jest.fn()}
        handleCellContextMenu={jest.fn()}
      />,
    );

    const nullLabel = screen.getByText('(NULL)');
    expect(nullLabel).toHaveClass('pivot-null-label');
  });

  test('preallocates row toggle slot even when a row has no toggle', () => {
    const rowNode: PivotTreeNode = {
      axis: 'row',
      key: serializePath(['A']),
      path: ['A'],
      label: 'A',
      formattedLabel: 'A',
      level: 1,
      hasChildren: true,
    };
    const colNode: PivotTreeNode = {
      axis: 'col',
      key: serializePath(['m1']),
      path: ['m1'],
      label: 'm1',
      formattedLabel: 'm1',
      level: 1,
      hasChildren: false,
    };
    const renderModel: RenderModel = {
      ...baseRenderModel,
      visibleRows: [rowNode],
      visibleCols: [colNode],
      columnHeaderRows: [],
    };
    render(
      <PivotTableView
        height={300}
        width={400}
        renderModel={renderModel}
        pivotProgram={basePivotProgram}
        tree={baseTree}
        expandedRows={new Set()}
        expandedCols={new Set()}
        showGlobalLoader={false}
        onRetry={jest.fn()}
        stickyHeaders={false}
        headerOffset={0}
        headerRowOffsets={[]}
        headerRef={createRef()}
        colTotalPosition="start"
        formatting={baseFormatting}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 0}
        handleCellClick={jest.fn()}
        handleCellKeyDown={jest.fn()}
        handleCellContextMenu={jest.fn()}
      />,
    );

    const rowHeader = screen.getByText('A').closest('th');
    expect(rowHeader).not.toBeNull();
    const slot = rowHeader?.querySelector('.pivot-row-toggle-slot');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('button')).toBeNull();
  });

  test('uses compact indentation for nested row labels', () => {
    const rowNode: PivotTreeNode = {
      axis: 'row',
      key: serializePath(['A']),
      path: ['A'],
      label: 'A',
      formattedLabel: 'A',
      level: 1,
      hasChildren: false,
    };
    const colNode: PivotTreeNode = {
      axis: 'col',
      key: serializePath(['m1']),
      path: ['m1'],
      label: 'm1',
      formattedLabel: 'm1',
      level: 1,
      hasChildren: false,
    };
    const renderModel: RenderModel = {
      ...baseRenderModel,
      visibleRows: [rowNode],
      visibleCols: [colNode],
      columnHeaderRows: [],
    };
    render(
      <PivotTableView
        height={300}
        width={400}
        renderModel={renderModel}
        pivotProgram={basePivotProgram}
        tree={baseTree}
        expandedRows={new Set()}
        expandedCols={new Set()}
        showGlobalLoader={false}
        onRetry={jest.fn()}
        stickyHeaders={false}
        headerOffset={0}
        headerRowOffsets={[]}
        headerRef={createRef()}
        colTotalPosition="start"
        formatting={baseFormatting}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 1}
        handleCellClick={jest.fn()}
        handleCellKeyDown={jest.fn()}
        handleCellContextMenu={jest.fn()}
      />,
    );

    const rowHeader = screen.getByText('A').closest('th');
    expect(rowHeader).not.toBeNull();
    const headerCell = rowHeader?.querySelector('div');
    expect(headerCell).toHaveStyle('padding-left: 14px');
  });

  test('uses 3px icon-label gap for both row and column headers', () => {
    const rowNode: PivotTreeNode = {
      axis: 'row',
      key: serializePath(['row-a']),
      path: ['row-a'],
      label: 'row-a',
      formattedLabel: 'row-a',
      level: 1,
      hasChildren: false,
    };
    const colNode: PivotTreeNode = {
      axis: 'col',
      key: serializePath(['col-x']),
      path: ['col-x'],
      label: 'col-x',
      formattedLabel: 'col-x',
      level: 1,
      hasChildren: false,
    };
    const renderModel: RenderModel = {
      ...baseRenderModel,
      visibleRows: [rowNode],
      visibleCols: [colNode],
      columnHeaderRows: [[{ node: colNode, colSpan: 1, rowSpan: 1 }]],
    };
    render(
      <PivotTableView
        height={300}
        width={400}
        renderModel={renderModel}
        pivotProgram={basePivotProgram}
        tree={baseTree}
        expandedRows={new Set()}
        expandedCols={new Set()}
        showGlobalLoader={false}
        onRetry={jest.fn()}
        stickyHeaders={false}
        headerOffset={0}
        headerRowOffsets={[]}
        headerRef={createRef()}
        colTotalPosition="start"
        formatting={baseFormatting}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 0}
        handleCellClick={jest.fn()}
        handleCellKeyDown={jest.fn()}
        handleCellContextMenu={jest.fn()}
      />,
    );

    const rowHeaderCell = screen.getByText('row-a').closest('div');
    const colHeaderCell = screen.getByText('col-x').closest('div');
    expect(rowHeaderCell).toHaveStyle('gap: 3px');
    expect(colHeaderCell).toHaveStyle('gap: 3px');
  });

  test('emits the visible row depth count for export', () => {
    const grandTotal: PivotTreeNode = {
      axis: 'row',
      key: serializePath(['grand']),
      path: ['grand'],
      label: 'Grand total',
      formattedLabel: 'Grand total',
      level: 1,
      hasChildren: false,
    };
    const parent: PivotTreeNode = {
      axis: 'row',
      key: serializePath(['West']),
      path: ['West'],
      label: 'West',
      formattedLabel: 'West',
      level: 1,
      hasChildren: true,
    };
    const child: PivotTreeNode = {
      axis: 'row',
      key: serializePath(['West', 'SF']),
      path: ['West', 'SF'],
      label: 'SF',
      formattedLabel: 'SF',
      level: 2,
      hasChildren: false,
    };
    const renderModel: RenderModel = {
      ...baseRenderModel,
      visibleRows: [grandTotal, parent, child],
    };
    const { container } = render(
      <PivotTableView
        height={300}
        width={400}
        renderModel={renderModel}
        pivotProgram={basePivotProgram}
        tree={baseTree}
        expandedRows={new Set()}
        expandedCols={new Set()}
        showGlobalLoader={false}
        onRetry={jest.fn()}
        stickyHeaders={false}
        headerOffset={0}
        headerRowOffsets={[]}
        headerRef={createRef()}
        colTotalPosition="start"
        formatting={baseFormatting}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={node => node.path.length}
        handleCellClick={jest.fn()}
        handleCellKeyDown={jest.fn()}
        handleCellContextMenu={jest.fn()}
        rowAxisLabels={['Region', 'City', 'Store']}
        exportChartId={18}
      />,
    );

    expect(container.querySelector('table')).toBeInTheDocument();
    const exportRows = getPivotV3ExportSheetDataForChart(18)?.map(row =>
      row.map(cell => cell.value),
    );
    expect(exportRows).toEqual([
      ['Region', 'City'],
      ['Grand total', ''],
      ['West', ''],
      ['West', 'SF'],
    ]);
  });
});

test('sortable headers support keyboard sorting and contextual expansion labels', () => {
  const col: PivotTreeNode = {
    axis: 'col',
    key: 'North',
    path: ['North'],
    label: 'North',
    formattedLabel: 'North',
    level: 1,
    hasChildren: true,
  };
  const sort = jest.fn();
  renderView(false, {
    renderModel: {
      ...baseRenderModel,
      visibleCols: [col],
      columnHeaderRows: [[{ node: col, colSpan: 1, rowSpan: 1 }]],
    },
    isColumnSortable: () => true,
    onSortColumn: sort,
    shouldShowToggle: () => true,
  });
  const toggle = screen.getByRole('button', { name: 'Expand North' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const header = toggle.closest('th');
  expect(header).toHaveAttribute('tabindex', '0');
  expect(header).toHaveAttribute('aria-sort', 'none');
  if (!header) throw new Error('Missing sortable column header');
  fireEvent.keyDown(header, { key: 'Enter' });
  fireEvent.keyDown(header, { key: ' ' });
  expect(sort).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(toggle, { key: 'Enter' });
  expect(sort).toHaveBeenCalledTimes(2);
});

test('partial data uses the shared compact tooltip and leaves worksheet contents unchanged', async () => {
  renderView(false, {
    formatting: { ...baseFormatting, hasPartialData: true },
    exportChartId: 378,
  });
  const warning = screen.getByLabelText('Partial data');
  expect(warning.closest('th')).toHaveClass('pivot-sticky-corner');
  fireEvent.mouseOver(warning);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'The row limit set for the chart was reached',
  );
  expect(
    screen.queryByText(
      'Pivot results reached the row limit. Increase the limit or narrow the filters.',
    ),
  ).not.toBeInTheDocument();
  expect(getPivotV3ExportSheetDataForChart(378)).toEqual([
    [{ value: 'Rows', type: 'string', isHeader: true }],
  ]);
});

test('complete visible data has no partial-data icon', () => {
  renderView(false);
  expect(screen.queryByLabelText('Partial data')).not.toBeInTheDocument();
});
