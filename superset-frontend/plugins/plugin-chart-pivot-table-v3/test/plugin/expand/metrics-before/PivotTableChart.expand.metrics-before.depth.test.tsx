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

import { render, fireEvent, waitFor, within } from '../../../testUtils';
import PivotTableChart from '../../fixtures/TestPivotTableChart';
import { PivotTreeData } from '../../../../src/types';
import { baseFormData, buildFormData } from '../../fixtures/pivotFormData';
import { serializePath } from '../../../../src/utils';
import { fetchPivotBranch } from '../../../../src/fetchPivotBranch';

jest.mock('../../../../src/fetchPivotBranch', () => {
  const actual = jest.requireActual('../../../../src/fetchPivotBranch');
  return {
    ...actual,
    fetchPivotBranch: jest.fn().mockResolvedValue({ data: undefined }),
    peekPivotBranchCache: jest.fn(),
  };
});

describe('PivotTableChart expansion with metrics before dimensions (depth)', () => {
  const fetchPivotBranchMock = fetchPivotBranch as jest.Mock;
  beforeEach(() => {
    fetchPivotBranchMock.mockClear();
  });

  const buildLabels = (prefix: string, depth: number) =>
    Array.from({ length: depth }, (_, index) => `${prefix}${index + 1}`);

  const buildRowsTree = (depth: number) => {
    const rootKey = serializePath([]);
    const labels = buildLabels('L', depth);
    const rows: PivotTreeData['rows'] = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: true,
      },
    };
    labels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      rows[serializePath(nextPath)] = {
        axis: 'row',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < labels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
    const cols: PivotTreeData['cols'] = {
      [rootKey]: {
        axis: 'col',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: false,
      },
    };
    return {
      tree: { rows, cols, cells: {} } as PivotTreeData,
      groupbyRows: labels.map((_, index) => `r${index + 1}`),
    };
  };

  const buildColsTree = (depth: number) => {
    const rootKey = serializePath([]);
    const labels = buildLabels('C', depth);
    const cols: PivotTreeData['cols'] = {
      [rootKey]: {
        axis: 'col',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: true,
      },
    };
    labels.reduce((path, label, idx) => {
      const nextPath = [...path, label];
      cols[serializePath(nextPath)] = {
        axis: 'col',
        key: serializePath(nextPath),
        path: nextPath,
        label,
        formattedLabel: label,
        level: idx + 1,
        hasChildren: idx < labels.length - 1,
      };
      return nextPath;
    }, [] as string[]);
    const rows: PivotTreeData['rows'] = {
      [rootKey]: {
        axis: 'row',
        key: rootKey,
        path: [],
        label: 'Total',
        formattedLabel: 'Total',
        level: 0,
        hasChildren: false,
      },
    };
    return {
      tree: { rows, cols, cells: {} } as PivotTreeData,
      groupbyColumns: labels.map((_, index) => `c${index + 1}`),
    };
  };

  const expansionDepths = [3, 5, 7];

  test.each(expansionDepths)(
    'expands a %i-level row hierarchy sequentially',
    async depth => {
      fetchPivotBranchMock.mockReset();
      fetchPivotBranchMock.mockResolvedValue({ data: undefined });
      const { tree, groupbyRows } = buildRowsTree(depth);
      const { container } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...baseFormData,
            groupbyRows,
            groupbyColumns: [],
            metrics: ['m1'],
          })}
          metrics={['m1']}
          groupbyRows={groupbyRows}
          groupbyColumns={[]}
          aggregateFunction="Sum"
          width={400}
          height={300}
          startCollapsed
          initialDepth={1}
          maxDepthPerFetch={1}
          rowTotals={false}
          colTotals={false}
          rowSubTotals={false}
          colSubTotals={false}
          rowSubtotalLevels={[]}
          colSubtotalLevels={[]}
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

      const tbody = container.querySelector('tbody') as HTMLElement;
      const steps = Math.max(depth - 1, 1);
      await Array.from({ length: steps }, (_, index) => index + 1).reduce(
        async (promise, step) => {
          await promise;
          const plusToggles = within(tbody).getAllByLabelText('plus-square');
          fireEvent.click(plusToggles[0]);
          await waitFor(() =>
            expect(fetchPivotBranchMock).toHaveBeenCalledTimes(step),
          );
        },
        Promise.resolve(),
      );
    },
  );

  test.each(expansionDepths)(
    'expands a %i-level column hierarchy sequentially',
    async depth => {
      fetchPivotBranchMock.mockReset();
      fetchPivotBranchMock.mockResolvedValue({ data: undefined });
      const { tree, groupbyColumns } = buildColsTree(depth);
      const { container } = render(
        <PivotTableChart
          data={tree}
          formData={buildFormData({
            ...baseFormData,
            groupbyRows: [],
            groupbyColumns,
            metrics: ['m1'],
            colTotals: false,
          })}
          metrics={['m1']}
          groupbyRows={[]}
          groupbyColumns={groupbyColumns}
          aggregateFunction="Sum"
          width={400}
          height={300}
          startCollapsed
          initialDepth={1}
          maxDepthPerFetch={1}
          rowTotals={false}
          colTotals={false}
          rowSubTotals={false}
          colSubTotals={false}
          rowSubtotalLevels={[]}
          colSubtotalLevels={[]}
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

      const thead = container.querySelector('thead') as HTMLElement;
      const steps = Math.max(depth - 1, 1);
      await Array.from({ length: steps }, (_, index) => index + 1).reduce(
        async (promise, step) => {
          await promise;
          const plusToggles = within(thead).getAllByLabelText('plus-square');
          fireEvent.click(plusToggles[0]);
          await waitFor(() =>
            expect(fetchPivotBranchMock).toHaveBeenCalledTimes(step),
          );
        },
        Promise.resolve(),
      );
    },
  );
});
