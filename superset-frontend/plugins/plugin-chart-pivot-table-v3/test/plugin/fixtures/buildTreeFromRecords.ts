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
  DataRecord,
  DataRecordValue,
  getColumnLabel,
  QueryFormColumn,
  QueryFormMetric,
} from '@superset-ui/core';
import { type DateFormatter, PivotTreeData } from '../../../src/types';
import { serializeCellKey, serializePath } from '../../../src/pivot/core/path';
import { SUBTOTAL_TOKEN } from '../../../src/pivot/core/tokens';
import { formatPivotLabelValue } from '../../../src/pivot/viewModel';
import { getMetricKeys } from '../../../src/pivot/metrics';

export const buildTreeFromRecords = (
  records: DataRecord[],
  metrics: QueryFormMetric[],
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  rowDepth: number,
  colDepth: number,
  dateFormatters?: Record<string, DateFormatter | undefined>,
): PivotTreeData => {
  const tree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const metricKeys = getMetricKeys(metrics);
  const metricKeySet = new Set(metricKeys);
  const metricPrefixes = metricKeys.map(key => `${key}__`);
  const firstRecord = records[0];
  const metricValueKeys =
    firstRecord && metricPrefixes.length > 0
      ? [
          ...metricKeys,
          ...Object.keys(firstRecord).filter(
            key =>
              !metricKeySet.has(key) &&
              metricPrefixes.some(prefix => key.startsWith(prefix)),
          ),
        ]
      : metricKeys;
  const rootKey = serializePath([]);
  let grandTotalValues: Record<string, DataRecordValue> = {};

  const ensureNode = (
    axis: 'row' | 'col',
    path: DataRecordValue[],
    totalLabel: string,
  ) => {
    const nodes = axis === 'row' ? tree.rows : tree.cols;
    const key = serializePath(path);
    if (nodes[key]) return;
    const rawValue = path[path.length - 1];
    const isSubtotalPath = path.includes(SUBTOTAL_TOKEN);
    const label =
      path.length === 0
        ? 'Grand total'
        : rawValue === SUBTOTAL_TOKEN
          ? 'Subtotal'
          : formatPivotLabelValue(rawValue, totalLabel);
    const groupby = axis === 'row' ? rowGroupby : colGroupby;
    const dimensionDepth = path.filter(
      value => value !== SUBTOTAL_TOKEN,
    ).length;
    const column = groupby[dimensionDepth - 1];
    const columnLabel = column ? getColumnLabel(column) : undefined;
    const formatter = columnLabel ? dateFormatters?.[columnLabel] : undefined;
    const formattedLabel =
      path.length === 0 ||
      isSubtotalPath ||
      rawValue === null ||
      rawValue === undefined
        ? label
        : formatter
          ? (formatter as (value: DataRecordValue) => string)(rawValue)
          : label;
    const fullDepth = axis === 'row' ? rowGroupby.length : colGroupby.length;
    nodes[key] = {
      axis,
      key,
      path,
      label,
      formattedLabel,
      level: path.length,
      hasChildren: !isSubtotalPath && path.length < fullDepth,
      isSubtotal: path.length === 0 || isSubtotalPath,
    };
  };

  records.forEach(record => {
    const rowPath = rowGroupby
      .slice(0, rowDepth)
      .map(col => record[getColumnLabel(col)]);
    const colPath = colGroupby
      .slice(0, colDepth)
      .map(col => record[getColumnLabel(col)]);

    for (let i = 0; i <= rowPath.length; i += 1) {
      ensureNode('row', rowPath.slice(0, i), 'Total');
    }
    for (let i = 0; i <= colPath.length; i += 1) {
      ensureNode('col', colPath.slice(0, i), 'Total');
    }

    const cellRowPath =
      rowPath.length > 0 && rowPath.length < rowGroupby.length
        ? [...rowPath, SUBTOTAL_TOKEN]
        : rowPath;
    const cellColPath =
      colPath.length > 0 && colPath.length < colGroupby.length
        ? [...colPath, SUBTOTAL_TOKEN]
        : colPath;
    if (cellRowPath !== rowPath) {
      ensureNode('row', cellRowPath, 'Total');
    }
    if (cellColPath !== colPath) {
      ensureNode('col', cellColPath, 'Total');
    }

    const rowKey = serializePath(cellRowPath);
    const colKey = serializePath(cellColPath);

    const values = metricValueKeys.reduce(
      (acc, key) => ({
        ...acc,
        [key]: record[key as string],
      }),
      {} as Record<string, DataRecordValue>,
    );

    const isRowTotalRecord = colPath.length === 0;
    const isColTotalRecord = rowPath.length === 0;
    if (isRowTotalRecord) {
      tree.rows[rowKey].values = {
        ...(tree.rows[rowKey].values || {}),
        ...values,
      };
    }
    if (isColTotalRecord) {
      tree.cols[colKey].values = {
        ...(tree.cols[colKey].values || {}),
        ...values,
      };
    }
    tree.cells[serializeCellKey(rowKey, colKey)] = {
      rowKey,
      colKey,
      values,
      isSubtotal:
        rowPath.length < rowGroupby.length ||
        colPath.length < colGroupby.length,
    };

    if (rowPath.length === 0 && colPath.length === 0) {
      grandTotalValues = { ...grandTotalValues, ...values };
    }
  });

  ensureNode('row', [], 'Grand total');
  ensureNode('col', [], 'Grand total');
  const mergedRootValues = {
    ...(tree.rows[rootKey]?.values || {}),
    ...(tree.cols[rootKey]?.values || {}),
    ...(Object.keys(grandTotalValues).length > 0 ? grandTotalValues : {}),
  };
  const hasGrandTotalValues = Object.keys(grandTotalValues).length > 0;
  const allowRootFallback = rowDepth === 0 && colDepth === 0;
  const rootValues = hasGrandTotalValues
    ? mergedRootValues
    : allowRootFallback && Object.keys(mergedRootValues).length > 0
      ? mergedRootValues
      : undefined;
  const rootCellKey = serializeCellKey(rootKey, rootKey);
  if (rootValues && !tree.cells[rootCellKey]) {
    tree.cells[rootCellKey] = {
      rowKey: rootKey,
      colKey: rootKey,
      values: rootValues,
      isSubtotal: true,
    };
  }

  return tree;
};
