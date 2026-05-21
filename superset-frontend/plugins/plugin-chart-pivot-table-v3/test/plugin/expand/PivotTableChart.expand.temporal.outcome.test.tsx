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
import { GenericDataType } from '@apache-superset/core/common';
import { SupersetClient } from '@superset-ui/core';
import { fireEvent, render, screen, waitFor } from '../../testUtils';
import PivotTableChart from '../fixtures/TestPivotTableChart';

import { MetricsLayoutEnum } from '../../../src/types';
import { buildFormData } from '../fixtures/pivotFormData';
import { buildTreeFromRecords } from '../fixtures/buildTreeFromRecords';
import { applyMetricAxis } from '../fixtures/metricAxis';

jest.mock('@superset-ui/core', () => {
  const actual = jest.requireActual('@superset-ui/core');
  return {
    ...actual,
    SupersetClient: {
      post: jest.fn(),
      get: jest.fn(),
    },
  };
});

type QueryFilter = {
  op?: string;
  val?: unknown;
};

type QueryPayload = {
  queries?: Array<{ filters?: QueryFilter[] }>;
};

const responseLike = {
  toString: () => '[object Response]',
};

const hasInvalidTemporalLiteral = (payload?: QueryPayload): boolean =>
  (payload?.queries ?? []).some(query =>
    (query.filters ?? []).some(
      filter =>
        filter.op === '==' &&
        typeof filter.val === 'string' &&
        /T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(filter.val),
    ),
  );

describe('PivotTableChart temporal expansion outcome', () => {
  const postMock = SupersetClient.post as jest.MockedFunction<
    typeof SupersetClient.post
  >;
  const getMock = SupersetClient.get as jest.MockedFunction<
    typeof SupersetClient.get
  >;

  const rowGroupby = ['orderYear', 'orderMonth'];
  const metrics = ['grossSales'];
  const fullRecords = [
    {
      orderYear: 1483228800000,
      orderMonth: 'Jan',
      grossSales: 10,
    },
    {
      orderYear: 1483228800000,
      orderMonth: 'Feb',
      grossSales: 11,
    },
  ];

  const buildTree = (rowDepth: number) =>
    applyMetricAxis(
      buildTreeFromRecords(fullRecords, metrics, rowGroupby, [], rowDepth, 0),
      metrics,
      MetricsLayoutEnum.COLUMNS,
      rowGroupby,
      [],
    );

  const renderChart = () => {
    const baseTree = buildTree(1);
    const formData = buildFormData({
      groupbyRows: rowGroupby,
      groupbyColumns: [],
      metrics,
      metricsLayout: MetricsLayoutEnum.COLUMNS,
      startCollapsed: true,
      initialDepth: 1,
      rowTotals: false,
      colTotals: false,
      rowSubTotals: false,
      time_grain_sqla: 'P1D',
      temporal_columns_lookup: {
        orderYear: true,
        orderMonth: true,
      },
      colTypeMap: {
        orderYear: GenericDataType.Temporal,
        orderMonth: GenericDataType.Temporal,
        grossSales: GenericDataType.Numeric,
      },
    });

    return render(
      <PivotTableChart
        data={baseTree}
        formData={formData}
        metrics={metrics}
        groupbyRows={rowGroupby}
        groupbyColumns={[]}
        aggregateFunction="Sum"
        width={640}
        height={320}
        startCollapsed
        initialDepth={1}
        colTotals={false}
        rowTotals={false}
        rowSubTotals={false}
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
  };

  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    getMock.mockResolvedValue({
      response: { status: 200 } as Response,
      json: {
        result: {
          verbose_map: {
            orderYear: 'orderYear',
            orderMonth: 'orderMonth',
          },
          columns: [
            {
              column_name: 'orderYear',
              python_date_format: '%Y',
            },
            {
              column_name: 'orderMonth',
              python_date_format: '%Y-%m',
            },
          ],
        },
      },
    } as Awaited<ReturnType<typeof SupersetClient.get>>);
  });

  it('expanding temporal parent does not show chart error and reveals child values', async () => {
    postMock.mockImplementation(async ({ jsonPayload }) => {
      const payload = (jsonPayload as QueryPayload | undefined) ?? {};
      if (hasInvalidTemporalLiteral(payload)) {
        return Promise.reject(responseLike);
      }
      return {
        response: { status: 200 } as Response,
        json: {
          result: (payload.queries ?? []).map(() => ({ data: fullRecords })),
        },
      } as Awaited<ReturnType<typeof SupersetClient.post>>;
    });

    const { container } = renderChart();

    const toggle = await screen.findByLabelText('plus-square');
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1),
    );
    expect(
      screen.queryByText('Error loading Pivot Table'),
    ).not.toBeInTheDocument();
  });

  it('keeps retry flow available after backend-like response errors', async () => {
    let callCount = 0;
    postMock.mockImplementation(async ({ jsonPayload }) => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(responseLike);
      }
      const payload = (jsonPayload as QueryPayload | undefined) ?? {};
      return {
        response: { status: 200 } as Response,
        json: {
          result: (payload.queries ?? []).map(() => ({ data: fullRecords })),
        },
      } as Awaited<ReturnType<typeof SupersetClient.post>>;
    });

    const { container } = renderChart();

    fireEvent.click(await screen.findByLabelText('plus-square'));
    await waitFor(() =>
      expect(screen.getByText('Error loading Pivot Table')).toBeInTheDocument(),
    );
    expect(screen.getByText('[object Response]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1),
    );
    expect(
      screen.queryByText('Error loading Pivot Table'),
    ).not.toBeInTheDocument();
  });
});
