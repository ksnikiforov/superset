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

import { fireEvent, render, waitFor, within } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';
import { MetricsLayoutEnum, PivotTreeData } from '../../../src/types';
import { baseFormData, buildFormData } from '../fixtures/pivotFormData';
import { mergeTrees } from '../../../src/pivot/core/tree';
import { serializeCellKey, serializePath } from '../../../src/pivot/core/path';
import {
  METRICS_PLACEHOLDER,
  SUBTOTAL_LABEL,
  SUBTOTAL_TOKEN,
} from '../../../src/pivot/core/tokens';
import { fetchPivotBranch } from '../../../src/pivot/query/fetchPivotBranch';
import { resolveMockBranchFetchResult } from '../fixtures/factBatches';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

jest.mock('../../../src/pivot/query/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../src/pivot/query/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest
      .fn()
      .mockResolvedValue({ data: undefined, factBatches: [] }),
  };
});

const injectColumnSubtotalLeaves = (
  tree: PivotTreeData,
  depth: number,
  fullDepth: number,
) => {
  if (depth <= 0 || depth >= fullDepth) {
    return tree;
  }
  const next: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };
  const subtotalNodes = Object.values(tree.cols).filter(
    node => node.path.length === depth && node.path.length > 0,
  );
  subtotalNodes.forEach(node => {
    const subtotalPath = [...node.path, SUBTOTAL_TOKEN];
    const subtotalKey = serializePath(subtotalPath);
    if (!next.cols[subtotalKey]) {
      next.cols[subtotalKey] = {
        ...node,
        key: subtotalKey,
        path: subtotalPath,
        label: SUBTOTAL_LABEL,
        formattedLabel: SUBTOTAL_LABEL,
        level: subtotalPath.length,
        hasChildren: subtotalPath.length < fullDepth,
        isSubtotal: true,
      };
    }
  });
  Object.values(tree.cells).forEach(cell => {
    const baseColPath = tree.cols[cell.colKey]?.path;
    if (
      !baseColPath ||
      baseColPath.length !== depth ||
      baseColPath.length === 0
    ) {
      return;
    }
    const subtotalColKey = serializePath([...baseColPath, SUBTOTAL_TOKEN]);
    const cellKey = serializeCellKey(cell.rowKey, subtotalColKey);
    next.cells[cellKey] = {
      ...cell,
      colKey: subtotalColKey,
      isSubtotal: true,
    };
  });
  return next;
};

describe('PivotTableChart column subtotal placement during expansion', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;

  const metrics = ['measure1', 'measure2', 'measure3', 'measure4'];
  const rowGroupby = ['orderPriority', 'discountBand', 'customerSegment'];
  const colGroupby = ['col1', 'col2', 'col3', 'col4'];
  const records: Array<Record<string, string | number>> = [
    {
      orderPriority: '1-URGENT',
      discountBand: 'LOW',
      customerSegment: 'CONSUMER',
      col1: 'C1-A',
      col2: 'C2-A',
      col3: 'C3-A',
      col4: 'C4-A',
      measure1: 10,
      measure2: 20,
      measure3: 30,
      measure4: 40,
    },
    {
      orderPriority: '1-URGENT',
      discountBand: 'LOW',
      customerSegment: 'CONSUMER',
      col1: 'C1-A',
      col2: 'C2-B',
      col3: 'C3-B',
      col4: 'C4-B',
      measure1: 11,
      measure2: 21,
      measure3: 31,
      measure4: 41,
    },
    {
      orderPriority: '1-URGENT',
      discountBand: 'LOW',
      customerSegment: 'CONSUMER',
      col1: 'C1-B',
      col2: 'C2-C',
      col3: 'C3-C',
      col4: 'C4-C',
      measure1: 12,
      measure2: 22,
      measure3: 32,
      measure4: 42,
    },
  ];

  const buildMetricTree = (tree: PivotTreeData) =>
    applyMetricAxis(
      tree,
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      colGroupby,
      colGroupby.length,
    );

  const buildTreeWithDepths = (depths: number[]) => {
    let merged: PivotTreeData = { rows: {}, cols: {}, cells: {} };
    depths.forEach(depth => {
      let partial = buildTreeFromRecords(
        records,
        metrics,
        rowGroupby,
        colGroupby,
        rowGroupby.length,
        depth,
      );
      if (depth < colGroupby.length) {
        partial = injectColumnSubtotalLeaves(partial, depth, colGroupby.length);
      }
      merged = mergeTrees(merged, partial);
    });
    return buildMetricTree(merged);
  };

  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
    fetchPivotBranchMock.mockImplementation(resolveMockBranchFetchResult());
  });

  it('keeps column subtotals adjacent to their col2 groups after expanding col1 then col2 (5 levels)', async () => {
    const baseTree = buildMetricTree(
      buildTreeFromRecords(
        records,
        metrics,
        rowGroupby,
        colGroupby,
        rowGroupby.length,
        1,
      ),
    );
    const depth2Tree = buildTreeWithDepths([1, 2]);
    const depth4Tree = buildTreeWithDepths([1, 2, 3, 4]);

    fetchPivotBranchMock
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: depth2Tree }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: depth4Tree }),
      );

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [...colGroupby, METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colSubtotalLevels: [1, 2, 3],
          rowSubTotals: true,
          colSubtotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={320}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1, 2, 3]}
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
      />,
    );

    let headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    const col1Row = headerRows.find(row =>
      within(row).queryByText('C1-A'),
    ) as HTMLElement;
    const col1Cell = within(col1Row)
      .getByText('C1-A')
      .closest('th') as HTMLElement;
    fireEvent.click(within(col1Cell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    expect(await findByText('C2-A')).toBeInTheDocument();

    headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    const col2RowForToggle = headerRows.find(row =>
      within(row).queryByText('C2-A'),
    ) as HTMLElement;
    const col2Cell = within(col2RowForToggle)
      .getByText('C2-A')
      .closest('th') as HTMLElement;
    fireEvent.click(within(col2Cell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });
    expect(await findByText('C3-A')).toBeInTheDocument();

    headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    const col2Row = headerRows.find(row =>
      within(row).queryByText('C2-A'),
    ) as HTMLElement;
    const col2Labels = within(col2Row)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows') as string[];
    const firstCol2Index = col2Labels.indexOf('C2-A');
    const secondCol2Index = col2Labels.indexOf('C2-B');
    expect(firstCol2Index).toBeGreaterThanOrEqual(0);
    expect(secondCol2Index).toBeGreaterThan(firstCol2Index);
    const labelsBetween = col2Labels.slice(firstCol2Index + 1, secondCol2Index);
    const metricSubtotalLabels = metrics.map(metric => `C2-A ${metric}`);
    expect(labelsBetween).toEqual(expect.arrayContaining(metricSubtotalLabels));
  });

  it('keeps grand totals at the end after expanding col1 then col2', async () => {
    const baseTree = buildMetricTree(
      buildTreeFromRecords(
        records,
        metrics,
        rowGroupby,
        colGroupby,
        rowGroupby.length,
        1,
      ),
    );
    const depth2Tree = buildTreeWithDepths([1, 2]);
    const depth4Tree = buildTreeWithDepths([1, 2, 3, 4]);

    fetchPivotBranchMock
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: depth2Tree }),
      )
      .mockImplementationOnce(
        resolveMockBranchFetchResult({ data: depth4Tree }),
      );

    const { container, findByText } = render(
      <PivotTableChart
        data={baseTree}
        formData={buildFormData({
          ...baseFormData,
          groupbyRows: rowGroupby,
          groupbyColumns: [...colGroupby, METRICS_PLACEHOLDER],
          metricsLayout: MetricsLayoutEnum.COLUMNS,
          metrics,
          colSubtotalLevels: [1, 2, 3],
          rowSubTotals: true,
          rowTotals: true,
          rowTotalPosition: 'end',
          colTotalPosition: 'end',
        })}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={colGroupby}
        aggregateFunction="Sum"
        width={500}
        height={320}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals
        rowSubTotals
        rowSubtotalLevels={[]}
        colSubtotalLevels={[1, 2, 3]}
        colTotalPosition="end"
        rowOrder="key_a_to_z"
        colOrder="key_a_to_z"
        valueFormat=""
        columnFormats={{}}
        currencyFormats={{}}
        allowRenderHtml={false}
        emitCrossFilters={false}
        setDataMask={jest.fn()}
        metricColorFormatters={[]}
        dateFormatters={{}}
      />,
    );

    let headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    const col1Row = headerRows.find(row =>
      within(row).queryByText('C1-A'),
    ) as HTMLElement;
    const col1Cell = within(col1Row)
      .getByText('C1-A')
      .closest('th') as HTMLElement;
    fireEvent.click(within(col1Cell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(1);
    });
    expect(await findByText('C2-A')).toBeInTheDocument();

    headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    const col2RowForToggle = headerRows.find(row =>
      within(row).queryByText('C2-A'),
    ) as HTMLElement;
    const col2Cell = within(col2RowForToggle)
      .getByText('C2-A')
      .closest('th') as HTMLElement;
    fireEvent.click(within(col2Cell).getByLabelText('plus-square'));

    await waitFor(() => {
      expect(fetchPivotBranchMock).toHaveBeenCalledTimes(2);
    });
    expect(await findByText('C3-A')).toBeInTheDocument();

    headerRows = Array.from(
      container.querySelectorAll('thead tr'),
    ) as HTMLElement[];
    const col1HeaderRow = headerRows.find(row =>
      within(row).queryByText('C1-A'),
    ) as HTMLElement;
    const col1Labels = within(col1HeaderRow)
      .getAllByRole('columnheader')
      .map(cell => cell.textContent?.trim())
      .filter(label => label && label !== 'Rows') as string[];
    const grandTotalIndex = col1Labels.indexOf('Grand total');
    expect(grandTotalIndex).toBeGreaterThanOrEqual(0);
    const lastCol1Index = Math.max(
      col1Labels.indexOf('C1-A'),
      col1Labels.indexOf('C1-B'),
    );
    expect(grandTotalIndex).toBeGreaterThan(lastCol1Index);
  });
});
