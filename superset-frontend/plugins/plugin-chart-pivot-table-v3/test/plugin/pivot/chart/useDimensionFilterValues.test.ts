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
import {
  buildDimensionFilterValues,
  buildDimensionValueSearchFilters,
  buildDimensionValuesQueryName,
} from '../../../../src/pivot/chart/useDimensionFilterValues';

test('builds dimension values query names', () => {
  expect(buildDimensionValuesQueryName('country')).toBe(
    'pivot_v3|dimension-values|country',
  );
});

test('builds dimension value search filters for searchable types', () => {
  expect(
    buildDimensionValueSearchFilters({
      dimension: 'country',
      dimensionKey: 'country',
      colTypeMap: { country: GenericDataType.String },
      search: ' France ',
    }),
  ).toEqual([
    {
      col: 'country',
      op: 'ILIKE',
      val: '%France%',
    },
  ]);

  expect(
    buildDimensionValueSearchFilters({
      dimension: 'age',
      dimensionKey: 'age',
      colTypeMap: { age: GenericDataType.Numeric },
      search: '42',
    }),
  ).toEqual([
    {
      col: 'age',
      op: 'ILIKE',
      val: '%42%',
    },
  ]);

  expect(
    buildDimensionValueSearchFilters({
      dimension: 'age',
      dimensionKey: 'age',
      colTypeMap: { age: GenericDataType.Numeric },
      search: 'forty-two',
    }),
  ).toEqual([]);
});

test('combines tree and fetched dimension filter values unless searching', () => {
  expect(
    buildDimensionFilterValues({
      dimensions: ['country', 'city'],
      searchText: {},
      fetchedValues: {
        country: ['France', 'Germany'],
        city: ['Paris'],
      },
      treeValues: {
        country: ['France', 'Spain'],
      },
    }),
  ).toEqual({
    country: ['France', 'Spain', 'Germany'],
    city: ['Paris'],
  });

  expect(
    buildDimensionFilterValues({
      dimensions: ['country'],
      searchText: { country: 'fra' },
      fetchedValues: {
        country: ['France'],
      },
      treeValues: {
        country: ['Spain'],
      },
    }),
  ).toEqual({
    country: ['France'],
  });
});
