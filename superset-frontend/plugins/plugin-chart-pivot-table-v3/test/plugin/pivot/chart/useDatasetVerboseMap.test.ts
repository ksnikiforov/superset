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
import { renderHook } from '@testing-library/react-hooks';
import { SupersetClient } from '@superset-ui/core';
import { waitFor } from '../../../testUtils';
import {
  buildDatasetVerboseMap,
  clearDatasetVerboseMapCache,
  getDatasetIdFromKey,
  useDatasetVerboseMap,
} from '../../../../src/pivot/chart/useDatasetVerboseMap';

jest.mock('@superset-ui/core', () => {
  const actual = jest.requireActual('@superset-ui/core');
  return {
    ...actual,
    SupersetClient: {
      ...actual.SupersetClient,
      get: jest.fn(),
    },
  };
});

const getMock = SupersetClient.get as jest.Mock;

beforeEach(() => {
  clearDatasetVerboseMapCache();
  getMock.mockReset();
});

test('builds a verbose map from dataset columns and verbose_map', () => {
  expect(
    buildDatasetVerboseMap({
      columns: [
        { column_name: 'quarter', verbose_name: 'DT| Quarter' },
        { column_name: 'brand', verbose_name: 'PD| Brand' },
      ],
      verbose_map: {
        brand: 'Brand override',
        income: '',
        month: 'DT| Month',
      },
    }),
  ).toEqual({
    quarter: 'DT| Quarter',
    brand: 'Brand override',
    month: 'DT| Month',
  });
});

test('parses dataset ids from Superset datasource keys', () => {
  expect(getDatasetIdFromKey('29__table')).toBe('29');
  expect(getDatasetIdFromKey('')).toBeUndefined();
  expect(getDatasetIdFromKey(undefined)).toBeUndefined();
});

test('does not fetch when disabled', () => {
  const { result } = renderHook(() =>
    useDatasetVerboseMap({ datasourceKey: '29__table', enabled: false }),
  );

  expect(result.current).toEqual({ verboseMap: {}, loading: false });
  expect(getMock).not.toHaveBeenCalled();
});

test('fetches and caches full dataset verbose metadata', async () => {
  getMock.mockResolvedValue({
    json: {
      result: {
        columns: [{ column_name: 'quarter', verbose_name: 'DT| Quarter' }],
        verbose_map: { month: 'DT| Month' },
      },
    },
  });

  const first = renderHook(() =>
    useDatasetVerboseMap({ datasourceKey: '29__table', enabled: true }),
  );

  expect(first.result.current.loading).toBe(true);

  await waitFor(() =>
    expect(first.result.current.verboseMap).toEqual({
      quarter: 'DT| Quarter',
      month: 'DT| Month',
    }),
  );
  expect(first.result.current.loading).toBe(false);
  expect(getMock).toHaveBeenCalledTimes(1);
  expect(getMock).toHaveBeenCalledWith({ endpoint: '/api/v1/dataset/29' });

  const second = renderHook(() =>
    useDatasetVerboseMap({ datasourceKey: '29__table', enabled: true }),
  );

  expect(second.result.current).toEqual({
    verboseMap: {
      quarter: 'DT| Quarter',
      month: 'DT| Month',
    },
    loading: false,
  });
  expect(getMock).toHaveBeenCalledTimes(1);
});

test('stops loading and returns an empty map when metadata fetch fails', async () => {
  getMock.mockRejectedValue(new Error('metadata unavailable'));

  const { result } = renderHook(() =>
    useDatasetVerboseMap({ datasourceKey: '29__table', enabled: true }),
  );

  expect(result.current.loading).toBe(true);

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.verboseMap).toEqual({});
});
