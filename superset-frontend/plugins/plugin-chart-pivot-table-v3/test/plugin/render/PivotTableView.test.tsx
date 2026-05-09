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
import { render, screen } from '../../testUtils';
import { PivotTableView } from '../../../src/pivot/render/PivotTableView';
import { type RenderModel } from '../../../src/pivot/shared/types';
import { type PivotTreeData, type PivotTreeNode } from '../../../src/types';
import { serializePath } from '../../../src/utils';

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

const renderView = (showGlobalLoader: boolean) =>
  render(
    <PivotTableView
      height={300}
      width={400}
      renderModel={baseRenderModel}
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
      metricFormattingScope="values"
      metricDatabars={{}}
      formattingKeyMap={{}}
      evaluateExcelMetricFormatting={() => undefined}
      databarColumnMinWidths={new Map()}
      onToggleNode={jest.fn()}
      shouldShowToggle={() => false}
      showSpinner={() => false}
      formatLabel={node => node.label}
      isRowAggregateBold={() => false}
      isColAggregateBold={() => false}
      getNodeDimDepth={() => 0}
      getTotalBackground={() => undefined}
      resolveDimensionStyle={() => undefined}
      deriveMetricKey={() => ''}
      isMetricGrandTotalNode={() => false}
      renderCellContent={() => null}
      renderDatabarContent={() => null}
      handleCellClick={jest.fn()}
      handleCellKeyDown={jest.fn()}
      handleCellContextMenu={jest.fn()}
    />,
  );

describe('PivotTableView', () => {
  it('marks exportable table with pivot-v3 selector class', () => {
    const { container } = renderView(false);
    const table = container.querySelector('table');
    expect(table).toHaveClass('pivot-v3-table');
  });

  it('renders the rows header when not loading', () => {
    renderView(false);
    expect(screen.getByText('Rows')).toBeInTheDocument();
  });

  it('hides the table when loading', () => {
    renderView(true);
    expect(screen.queryByText('Rows')).not.toBeInTheDocument();
  });

  it('marks actual null labels as muted', () => {
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
        metricFormattingScope="values"
        metricDatabars={{}}
        formattingKeyMap={{}}
        evaluateExcelMetricFormatting={() => undefined}
        databarColumnMinWidths={new Map()}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        formatLabel={node => node.label}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 0}
        getTotalBackground={() => undefined}
        resolveDimensionStyle={() => undefined}
        deriveMetricKey={() => ''}
        isMetricGrandTotalNode={() => false}
        renderCellContent={() => null}
        renderDatabarContent={() => null}
        handleCellClick={jest.fn()}
        handleCellKeyDown={jest.fn()}
        handleCellContextMenu={jest.fn()}
      />,
    );

    const nullLabel = screen.getByText('(NULL)');
    expect(nullLabel).toHaveClass('pivot-null-label');
  });

  it('preallocates row toggle slot even when a row has no toggle', () => {
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
        metricFormattingScope="values"
        metricDatabars={{}}
        formattingKeyMap={{}}
        evaluateExcelMetricFormatting={() => undefined}
        databarColumnMinWidths={new Map()}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        formatLabel={node => node.label}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 0}
        getTotalBackground={() => undefined}
        resolveDimensionStyle={() => undefined}
        deriveMetricKey={() => ''}
        isMetricGrandTotalNode={() => false}
        renderCellContent={() => null}
        renderDatabarContent={() => null}
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

  it('uses compact indentation for nested row labels', () => {
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
        metricFormattingScope="values"
        metricDatabars={{}}
        formattingKeyMap={{}}
        evaluateExcelMetricFormatting={() => undefined}
        databarColumnMinWidths={new Map()}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        formatLabel={node => node.label}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 1}
        getTotalBackground={() => undefined}
        resolveDimensionStyle={() => undefined}
        deriveMetricKey={() => ''}
        isMetricGrandTotalNode={() => false}
        renderCellContent={() => null}
        renderDatabarContent={() => null}
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

  it('uses 3px icon-label gap for both row and column headers', () => {
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
        metricFormattingScope="values"
        metricDatabars={{}}
        formattingKeyMap={{}}
        evaluateExcelMetricFormatting={() => undefined}
        databarColumnMinWidths={new Map()}
        onToggleNode={jest.fn()}
        shouldShowToggle={() => false}
        showSpinner={() => false}
        formatLabel={node => node.label}
        isRowAggregateBold={() => false}
        isColAggregateBold={() => false}
        getNodeDimDepth={() => 0}
        getTotalBackground={() => undefined}
        resolveDimensionStyle={() => undefined}
        deriveMetricKey={() => ''}
        isMetricGrandTotalNode={() => false}
        renderCellContent={() => null}
        renderDatabarContent={() => null}
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
});
