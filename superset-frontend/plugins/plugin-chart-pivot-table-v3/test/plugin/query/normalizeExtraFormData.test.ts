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
import { GenericDataType } from '@superset-ui/core';
import { normalizeFormDataExtraFilters } from '../../../src/pivot/query/normalizeExtraFormData';
import { buildFormData } from '../fixtures/pivotFormData';

describe('normalizeFormDataExtraFilters', () => {
  it('does not infer temporal coercion without explicit temporal metadata', () => {
    const formData = buildFormData({
      extra_form_data: {
        filters: [{ col: 'orderYear', op: '==', val: '1483228800000' }],
      },
    });

    const normalized = normalizeFormDataExtraFilters(formData);

    expect(normalized.extra_form_data?.filters).toEqual([
      { col: 'orderYear', op: '==', val: '1483228800000' },
    ]);
  });

  it('coerces epoch-like temporal strings only when column is explicitly temporal', () => {
    const formData = buildFormData({
      colTypeMap: { orderYear: GenericDataType.Temporal },
      extra_form_data: {
        filters: [{ col: 'orderYear', op: '==', val: '1483228800000' }],
      },
    });

    const normalized = normalizeFormDataExtraFilters(formData);

    expect(normalized.extra_form_data?.filters).toEqual([
      { col: 'orderYear', op: '==', val: 1483228800000 },
    ]);
  });

  it('keeps non-epoch temporal strings unchanged', () => {
    const formData = buildFormData({
      colTypeMap: { orderYear: GenericDataType.Temporal },
      extra_form_data: {
        filters: [{ col: 'orderYear', op: '==', val: '2017-01-01T00:00:00Z' }],
      },
    });

    const normalized = normalizeFormDataExtraFilters(formData);

    expect(normalized.extra_form_data?.filters).toEqual([
      { col: 'orderYear', op: '==', val: '2017-01-01T00:00:00Z' },
    ]);
  });

  it('coerces IN filters for explicit temporal columns only', () => {
    const formData = buildFormData({
      temporal_columns_lookup: { orderYear: true },
      extra_form_data: {
        filters: [
          {
            col: 'orderYear',
            op: 'IN',
            val: ['1483228800000', '1514764800000'],
          },
        ],
      },
    });

    const normalized = normalizeFormDataExtraFilters(formData);

    expect(normalized.extra_form_data?.filters).toEqual([
      {
        col: 'orderYear',
        op: 'IN',
        val: [1483228800000, 1514764800000],
      },
    ]);
  });
});
