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
import { type PivotTreeData } from '../../../src/types';

const baseRenderModel: RenderModel = {
  visibleRows: [],
  visibleCols: [],
  colLeaves: [],
  columnHeaderRows: [],
  visibleCellEntries: [],
  showRowRoot: false,
  showColRoot: false,
  skipRowRoot: true,
  skipColRoot: true,
  hideMetricHeaderOnRows: false,
  hideMetricHeaderOnCols: false,
  shouldHideMetricGrandTotalsOnRows: false,
  shouldHideMetricGrandTotalsOnCols: false,
  shouldSuppressColRoot: false,
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
      stickyHeaders={false}
      headerOffset={0}
      headerRowOffsets={[]}
      headerRef={createRef()}
      rowTotalPosition="start"
      metricFormattingScope="values"
      metricDatabars={{}}
      formattingKeyMap={{}}
      databarColumnMinWidths={new Map()}
      onToggleNode={jest.fn()}
      shouldShowToggle={() => false}
      showRowSpinner={() => false}
      showColSpinner={() => false}
      formatLabel={node => node.label}
      isRowAggregateBold={() => false}
      isColAggregateBold={() => false}
      getNodeDimDepth={() => 0}
      getTotalBackground={() => undefined}
      resolveDimensionStyle={() => undefined}
      deriveMetricKey={() => ''}
      isMetricGrandTotalNode={() => false}
      isMetricSubtotalNode={() => false}
      isExplicitSubtotalNode={() => false}
      renderCellContent={() => null}
      renderDatabarContent={() => null}
      handleCellClick={jest.fn()}
      handleCellKeyDown={jest.fn()}
      handleCellContextMenu={jest.fn()}
    />,
  );

describe('PivotTableView', () => {
  it('renders the rows header when not loading', () => {
    renderView(false);
    expect(screen.getByText('Rows')).toBeInTheDocument();
  });

  it('hides the table when loading', () => {
    renderView(true);
    expect(screen.queryByText('Rows')).not.toBeInTheDocument();
  });
});
