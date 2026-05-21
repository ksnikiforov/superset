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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DataRecordValue,
  getColumnLabel,
  type QueryFormColumn,
  type QueryObjectFilterClause,
} from '@superset-ui/core';
import { GenericDataType } from '@apache-superset/core/common';
import { isEqual } from 'lodash';
import { type PivotTableQueryFormData } from '../../types';
import { getStableColumnKey } from '../../utils';
import { supersetChartDataClient } from '../data/SupersetChartDataClient';
import { buildSelectionFilteredFormData, type QuerySpec } from '../query/specs';
import { type PivotSelectedFilters } from '../filters';

const DIMENSION_VALUES_REQUEST_GROUP = 'pivot-v3-dimension-values';
const DIMENSION_VALUES_QUERY_PREFIX = 'pivot_v3|dimension-values';
const EMPTY_FILTER_VALUES: DataRecordValue[] = [];

export const buildDimensionValuesQueryName = (dimensionKey: string) =>
  `${DIMENSION_VALUES_QUERY_PREFIX}|${dimensionKey}`;

export const buildDimensionValueSearchFilters = ({
  dimension,
  dimensionKey,
  colTypeMap,
  search,
}: {
  dimension: QueryFormColumn;
  dimensionKey: string;
  colTypeMap?: Record<string, GenericDataType>;
  search: string;
}): QueryObjectFilterClause[] => {
  const normalizedSearch = search.trim();
  if (!normalizedSearch) {
    return [];
  }
  const label = getColumnLabel(dimension);
  const dimensionType = colTypeMap?.[label] ?? colTypeMap?.[dimensionKey];
  if (
    dimensionType === GenericDataType.String ||
    (dimensionType === GenericDataType.Numeric &&
      !Number.isNaN(Number(normalizedSearch)))
  ) {
    return [
      {
        col: dimension,
        op: 'ILIKE',
        val: `%${normalizedSearch}%`,
      },
    ];
  }
  return [];
};

export const buildDimensionFilterValues = ({
  dimensions,
  searchText,
  fetchedValues,
  treeValues,
}: {
  dimensions: QueryFormColumn[];
  searchText: Record<string, string>;
  fetchedValues: Record<string, DataRecordValue[]>;
  treeValues: PivotSelectedFilters;
}): Record<string, DataRecordValue[]> =>
  Object.fromEntries(
    dimensions.map(dimension => {
      const dimensionKey = getStableColumnKey(dimension);
      const search = searchText[dimensionKey]?.trim() ?? '';
      const fetched = fetchedValues[dimensionKey] ?? EMPTY_FILTER_VALUES;
      if (search.length > 0) {
        return [dimensionKey, fetched];
      }
      const tree = treeValues[dimensionKey] ?? EMPTY_FILTER_VALUES;
      return [dimensionKey, Array.from(new Set([...tree, ...fetched]))];
    }),
  );

export const useDimensionFilterValues = ({
  dimensions,
  treeValues,
  formData,
  selectedFilters,
  colTypeMap,
}: {
  dimensions: QueryFormColumn[];
  treeValues: PivotSelectedFilters;
  formData: PivotTableQueryFormData;
  selectedFilters: PivotSelectedFilters;
  colTypeMap?: Record<string, GenericDataType>;
}) => {
  const [fetchedValues, setFetchedValues] = useState<
    Record<string, DataRecordValue[]>
  >({});
  const [searchText, setSearchText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const values = useMemo(
    () =>
      buildDimensionFilterValues({
        dimensions,
        searchText,
        fetchedValues,
        treeValues,
      }),
    [dimensions, fetchedValues, searchText, treeValues],
  );
  const valuesVersion = useRef(0);
  const requestVersion = useRef<Record<string, number>>({});
  const treeValuesRef = useRef(treeValues);

  useEffect(() => {
    if (isEqual(treeValuesRef.current, treeValues)) {
      return;
    }
    treeValuesRef.current = treeValues;
    valuesVersion.current += 1;
    setFetchedValues({});
    setSearchText({});
  }, [treeValues]);

  const fetchValues = useCallback(
    async (dimension: QueryFormColumn, search = '') => {
      const dimensionKey = getStableColumnKey(dimension);
      const normalizedSearch = search.trim();
      setSearchText(current =>
        current[dimensionKey] === normalizedSearch
          ? current
          : { ...current, [dimensionKey]: normalizedSearch },
      );
      setLoading(current => ({
        ...current,
        [dimensionKey]: true,
      }));
      const currentValuesVersion = valuesVersion.current;
      const nextRequestVersion =
        (requestVersion.current[dimensionKey] ?? 0) + 1;
      requestVersion.current[dimensionKey] = nextRequestVersion;
      try {
        const selection = { ...selectedFilters };
        delete selection[dimensionKey];
        const normalizedFormData = buildSelectionFilteredFormData({
          formData,
          selection,
        });
        const spec: QuerySpec = {
          queryName: buildDimensionValuesQueryName(dimensionKey),
          columns: [dimension],
          metrics: [],
          filters: buildDimensionValueSearchFilters({
            dimension,
            dimensionKey,
            colTypeMap,
            search: normalizedSearch,
          }),
        };
        const results = await supersetChartDataClient.fetch({
          formData: normalizedFormData,
          specs: [spec],
          requestGroupId: `${DIMENSION_VALUES_REQUEST_GROUP}-${dimensionKey}`,
        });
        if (
          valuesVersion.current !== currentValuesVersion ||
          requestVersion.current[dimensionKey] !== nextRequestVersion
        ) {
          return;
        }
        const result = results[0];
        const label = getColumnLabel(dimension);
        const values = new Set<DataRecordValue>();
        (result?.data ?? []).forEach(row => {
          if (row && typeof row === 'object' && label in row) {
            values.add((row as Record<string, DataRecordValue>)[label]);
          }
        });
        setFetchedValues(current => ({
          ...current,
          [dimensionKey]: Array.from(values.values()),
        }));
      } catch (error) {
        if (
          typeof DOMException !== 'undefined' &&
          error instanceof DOMException &&
          error.name === 'AbortError'
        ) {
          return;
        }
        // Ignore errors for dimension value lookups; filtering still works.
      } finally {
        if (requestVersion.current[dimensionKey] === nextRequestVersion) {
          setLoading(current => {
            if (!current[dimensionKey]) {
              return current;
            }
            const next = { ...current };
            delete next[dimensionKey];
            return next;
          });
        }
      }
    },
    [colTypeMap, formData, selectedFilters],
  );

  return {
    values,
    loading,
    fetchValues,
  };
};
