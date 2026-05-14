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
  buildDateFormattersFromColumns,
  buildResolvedDateFormatters,
  needsDatasetDateFormatters,
  needsDatasetVerboseMap,
} from '../../../../src/pivot/chart/usePivotDatasetMeta';
import { buildFormData } from '../../fixtures/pivotFormData';

test('builds dataset date formatters for raw and verbose column labels', () => {
  const formatters = buildDateFormattersFromColumns(
    [
      {
        column_name: 'order_date',
        verbose_name: 'Order date',
        python_date_format: '%Y-%m-%d',
      },
    ],
    {},
  );

  expect(formatters.order_date).toBeDefined();
  expect(formatters['Order date']).toBe(formatters.order_date);
});

test('adds fallback temporal date formatters for raw and verbose labels', () => {
  const formData = buildFormData({
    dateFormat: '%Y-%m-%d',
    temporal_columns_lookup: {
      order_date: true,
      country: false,
    },
  });
  const formatters = buildResolvedDateFormatters({
    dateFormatters: {},
    extraDateFormatters: {},
    fetchFormDataBase: formData,
    resolvedVerboseMap: {
      order_date: 'Order date',
    },
  });

  expect(formatters.order_date).toBeDefined();
  expect(formatters['Order date']).toBe(formatters.order_date);
  expect(formatters.country).toBeUndefined();
});

test('detects missing dataset verbose labels and temporal formatters', () => {
  expect(
    needsDatasetVerboseMap({
      dimensions: ['country', 'city'],
      resolvedVerboseMap: {
        country: 'Country',
      },
    }),
  ).toBe(true);

  expect(
    needsDatasetVerboseMap({
      dimensions: ['country'],
      resolvedVerboseMap: {
        country: 'Country',
      },
    }),
  ).toBe(false);

  const formData = buildFormData({
    temporal_columns_lookup: {
      order_date: true,
    },
  });

  expect(
    needsDatasetDateFormatters({
      formData,
      resolvedDateFormatters: {},
      resolvedVerboseMap: {
        order_date: 'Order date',
      },
    }),
  ).toBe(true);

  expect(
    needsDatasetDateFormatters({
      formData,
      resolvedDateFormatters: {
        'Order date': value => String(value),
      },
      resolvedVerboseMap: {
        order_date: 'Order date',
      },
    }),
  ).toBe(false);
});
