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
import {
  buildPathFilters,
  coerceValueForColumn,
} from '../../../src/pivot/query/pathFilters';

describe('pathFilters temporal coercion contract', () => {
  const colTypeMap = {
    orderYear: GenericDataType.Temporal,
    grossSales: GenericDataType.Numeric,
    category: GenericDataType.String,
  };

  it('keeps temporal epoch numbers backend-safe for equality filters', () => {
    const filters = buildPathFilters(
      ['orderYear'],
      [1483228800000],
      colTypeMap,
    );
    expect(filters).toEqual([
      { col: 'orderYear', op: '==', val: 1483228800000 },
    ]);
  });

  it('handles temporal strings for epoch-like and non-epoch-like values', () => {
    expect(coerceValueForColumn('1483228800000', 'orderYear', colTypeMap)).toBe(
      1483228800000,
    );
    expect(coerceValueForColumn('2017-01-01', 'orderYear', colTypeMap)).toBe(
      '2017-01-01',
    );
  });

  it('emits IS NULL for nullish temporal path values', () => {
    expect(buildPathFilters(['orderYear'], [null], colTypeMap)).toEqual([
      { col: 'orderYear', op: 'IS NULL' },
    ]);
    expect(buildPathFilters(['orderYear'], [undefined], colTypeMap)).toEqual([
      { col: 'orderYear', op: 'IS NULL' },
    ]);
  });

  it('keeps non-temporal coercion behavior unchanged', () => {
    expect(coerceValueForColumn('42', 'grossSales', colTypeMap)).toBe(42);
    expect(coerceValueForColumn('A', 'category', colTypeMap)).toBe('A');
  });
});
