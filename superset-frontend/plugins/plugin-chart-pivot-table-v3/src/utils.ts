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

  const ensureNode = (
    axis: 'row' | 'col',
    path: DataRecordValue[],
    totalLabel: string,
  ) => {
    const nodes = axis === 'row' ? tree.rows : tree.cols;
    const key = serializePath(path);
    if (nodes[key]) return;
    const label =
      path.length === 0
        ? totalLabel
        : path[path.length - 1]?.toString() ?? totalLabel;
    nodes[key] = {
      axis,
      key,
      path,
      label,
      formattedLabel: label,
      level: path.length,
      hasChildren:
        path.length < (axis === 'row' ? rowGroupby.length : colGroupby.length),
      isSubtotal:
        path.length < (axis === 'row' ? rowGroupby.length : colGroupby.length),
    };
  };

  records.forEach(record => {
    const rowPath = rowGroupby
      .slice(0, rowDepth)
      .map(col => record[getColumnLabel(col)]);
    const colPath = colGroupby
      .slice(0, colDepth)
      .map(col => record[getColumnLabel(col)]);

    // create intermediate row nodes
    for (let i = 0; i <= rowPath.length; i += 1) {
      ensureNode('row', rowPath.slice(0, i), 'Total');
    }
    // create intermediate col nodes
    for (let i = 0; i <= colPath.length; i += 1) {
      ensureNode('col', colPath.slice(0, i), 'Total');
    }

    const rowKey = serializePath(rowPath);
    const colKey = serializePath(colPath);

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

  ensureNode('row', [], 'Total');
  ensureNode('col', [], 'Total');

  return tree;
};
