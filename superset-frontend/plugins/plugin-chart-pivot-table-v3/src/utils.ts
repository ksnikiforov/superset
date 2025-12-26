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
import { MetricsLayoutEnum, PivotPath, PivotTreeData } from './types';
import { formatQueryName } from './buildQuery';

export const PATH_DIVIDER = '__';

export const serializePath = (path: PivotPath = []) => path.join(PATH_DIVIDER);

export const getMetricKeys = (metrics: QueryFormMetric[]) =>
  metrics
    .map(metric => (typeof metric === 'string' ? metric : metric.label))
    .filter((m): m is string => !!m);

export const parseDepth = (queryName?: string) => {
  if (
    !queryName ||
    !queryName.startsWith(formatQueryName(0, 0).split('|')[0])
  ) {
    return { rowDepth: 0, colDepth: 0 };
  }
  const [, rowLabel = '', colLabel = ''] = queryName.split('|');
  const rowDepth = Number(rowLabel.replace('row', '')) || 0;
  const colDepth = Number(colLabel.replace('col', '')) || 0;
  return { rowDepth, colDepth };
};

export const mergeTrees = (
  left?: PivotTreeData,
  right?: PivotTreeData,
): PivotTreeData => ({
  rows: { ...(left?.rows || {}), ...(right?.rows || {}) },
  cols: { ...(left?.cols || {}), ...(right?.cols || {}) },
  cells: { ...(left?.cells || {}), ...(right?.cells || {}) },
});

export const applyMetricAxis = (
  tree: PivotTreeData,
  metrics: QueryFormMetric[],
  metricsLayout: MetricsLayoutEnum,
): PivotTreeData => {
  const metricKeys = getMetricKeys(metrics);
  if (metricKeys.length === 0) {
    return tree;
  }

  const result: PivotTreeData = {
    rows: { ...tree.rows },
    cols: { ...tree.cols },
    cells: { ...tree.cells },
  };

  if (metricsLayout === MetricsLayoutEnum.ROWS) {
    Object.values(tree.rows).forEach(rowNode => {
      metricKeys.forEach(metric => {
        const metricPath = [...rowNode.path, metric];
        const metricKey = serializePath(metricPath);
        if (result.rows[metricKey]) {
          return;
        }
        result.rows[metricKey] = {
          axis: 'row',
          key: metricKey,
          path: metricPath,
          label: metric,
          formattedLabel: metric,
          level: rowNode.level + 1,
          hasChildren: false,
          isSubtotal: rowNode.isSubtotal,
        };

        Object.values(tree.cols).forEach(colNode => {
          const baseCell = tree.cells[`${rowNode.key}|${colNode.key}`];
          const val = baseCell?.values?.[metric];
          result.cells[`${metricKey}|${colNode.key}`] = {
            rowKey: metricKey,
            colKey: colNode.key,
            values: { [metric]: val },
            isSubtotal: baseCell?.isSubtotal,
          };
        });
      });
    });
  } else {
    Object.values(tree.cols).forEach(colNode => {
      metricKeys.forEach(metric => {
        const metricPath = [...colNode.path, metric];
        const metricKey = serializePath(metricPath);
        if (result.cols[metricKey]) {
          return;
        }
        result.cols[metricKey] = {
          axis: 'col',
          key: metricKey,
          path: metricPath,
          label: metric,
          formattedLabel: metric,
          level: colNode.level + 1,
          hasChildren: false,
          isSubtotal: colNode.isSubtotal,
        };

        Object.values(tree.rows).forEach(rowNode => {
          const baseCell = tree.cells[`${rowNode.key}|${colNode.key}`];
          const val = baseCell?.values?.[metric];
          result.cells[`${rowNode.key}|${metricKey}`] = {
            rowKey: rowNode.key,
            colKey: metricKey,
            values: { [metric]: val },
            isSubtotal: baseCell?.isSubtotal,
          };
        });
      });
    });
  }

  return result;
};

export const buildTreeFromRecords = (
  records: DataRecord[],
  metrics: QueryFormMetric[],
  rowGroupby: QueryFormColumn[],
  colGroupby: QueryFormColumn[],
  rowDepth: number,
  colDepth: number,
): PivotTreeData => {
  const tree: PivotTreeData = { rows: {}, cols: {}, cells: {} };
  const metricKeys = getMetricKeys(metrics);

  records.forEach(record => {
    const rowPath = rowGroupby
      .slice(0, rowDepth)
      .map(col => record[getColumnLabel(col)]);
    const colPath = colGroupby
      .slice(0, colDepth)
      .map(col => record[getColumnLabel(col)]);

    const rowKey = serializePath(rowPath);
    const colKey = serializePath(colPath);

    if (!tree.rows[rowKey]) {
      tree.rows[rowKey] = {
        axis: 'row',
        key: rowKey,
        path: rowPath,
        label: rowPath[rowPath.length - 1]?.toString() ?? 'Total',
        formattedLabel: rowPath[rowPath.length - 1]?.toString() ?? 'Total',
        level: rowPath.length,
        hasChildren: rowPath.length < rowGroupby.length,
        isSubtotal: rowPath.length < rowGroupby.length,
      };
    }
    if (!tree.cols[colKey]) {
      tree.cols[colKey] = {
        axis: 'col',
        key: colKey,
        path: colPath,
        label: colPath[colPath.length - 1]?.toString() ?? 'Total',
        formattedLabel: colPath[colPath.length - 1]?.toString() ?? 'Total',
        level: colPath.length,
        hasChildren: colPath.length < colGroupby.length,
        isSubtotal: colPath.length < colGroupby.length,
      };
    }

    const values = metricKeys.reduce(
      (acc, key) => ({
        ...acc,
        [key]: record[key as string],
      }),
      {} as Record<string, DataRecordValue>,
    );

    tree.rows[rowKey].values = { ...(tree.rows[rowKey].values || {}), ...values };
    tree.cols[colKey].values = { ...(tree.cols[colKey].values || {}), ...values };
    tree.cells[`${rowKey}|${colKey}`] = {
      rowKey,
      colKey,
      values,
      isSubtotal:
        rowPath.length < rowGroupby.length || colPath.length < colGroupby.length,
    };
  });

  const rootKey = serializePath([]);
  if (!tree.rows[rootKey]) {
    tree.rows[rootKey] = {
      axis: 'row',
      key: rootKey,
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: rowGroupby.length > 0,
      isSubtotal: rowGroupby.length > 0,
    };
  }
  if (!tree.cols[rootKey]) {
    tree.cols[rootKey] = {
      axis: 'col',
      key: rootKey,
      path: [],
      label: 'Total',
      formattedLabel: 'Total',
      level: 0,
      hasChildren: colGroupby.length > 0,
      isSubtotal: colGroupby.length > 0,
    };
  }

  return tree;
};
