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
  BinaryQueryObjectFilterClause,
  DataRecordValue,
  getColumnLabel,
  QueryFormColumn,
  QueryFormMetric,
  QueryObjectFilterClause,
} from '@superset-ui/core';
import { MetricsLayoutEnum, PivotTreeNode } from '../types';

const getMetricLabels = (metrics: QueryFormMetric[]) =>
  metrics.map(m => (typeof m === 'string' ? m : getColumnLabel(m as any)));

const stripMetricPath = (
  path: PivotTreeNode['path'],
  axis: 'row' | 'col',
  metricsLayout: MetricsLayoutEnum,
  metricLabels: Set<string>,
) => {
  if (axis === 'row' && metricsLayout === MetricsLayoutEnum.ROWS) {
    return path.filter(val => !metricLabels.has(String(val ?? '')));
  }
  if (axis === 'col' && metricsLayout === MetricsLayoutEnum.COLUMNS) {
    return path.filter(val => !metricLabels.has(String(val ?? '')));
  }
  return path;
};

type CellFiltersParams = {
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricsLayout: MetricsLayoutEnum;
};

export const buildCellFilters = ({
  rowNode,
  colNode,
  groupbyRows,
  groupbyColumns,
  metrics,
  metricsLayout,
}: CellFiltersParams): QueryObjectFilterClause[] => {
  const metricLabelSet = new Set(getMetricLabels(metrics));
  const normalizedRowPath = stripMetricPath(
    rowNode.path,
    'row',
    metricsLayout,
    metricLabelSet,
  );
  const normalizedColPath = stripMetricPath(
    colNode.path,
    'col',
    metricsLayout,
    metricLabelSet,
  );
  return [
    ...normalizedRowPath.map((val, i) => ({
      col: getColumnLabel(groupbyRows[i]),
      op: (val === null || val === undefined ? 'IS NULL' : '==') as any,
      val: val === undefined ? null : val,
    })),
    ...normalizedColPath.map((val, i) => ({
      col: getColumnLabel(groupbyColumns[i]),
      op: (val === null || val === undefined ? 'IS NULL' : '==') as any,
      val: val === undefined ? null : val,
    })),
  ];
};

type ContextFiltersParams = {
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricsLayout: MetricsLayoutEnum;
  dateFormatters: Record<string, ((value: DataRecordValue) => string) | undefined>;
  timeGrainSqla?: string;
};

const buildAxisContextFilters = (
  node: PivotTreeNode,
  columns: QueryFormColumn[],
  axis: 'row' | 'col',
  metricsLayout: MetricsLayoutEnum,
  metricLabels: Set<string>,
  dateFormatters: Record<string, ((value: DataRecordValue) => string) | undefined>,
  timeGrainSqla?: string,
) =>
  stripMetricPath(node.path, axis, metricsLayout, metricLabels).map(
    (val, idx) => {
      const col = getColumnLabel(columns[idx]);
      const formatter = dateFormatters[col];
      return {
        col,
        op: '==',
        val,
        formattedVal:
          typeof formatter === 'function' ? formatter(val as any) : String(val),
        grain: formatter && axis === 'row' ? timeGrainSqla : undefined,
      } as BinaryQueryObjectFilterClause;
    },
  );

export const buildContextMenuFilters = ({
  rowNode,
  colNode,
  groupbyRows,
  groupbyColumns,
  metrics,
  metricsLayout,
  dateFormatters,
  timeGrainSqla,
}: ContextFiltersParams): BinaryQueryObjectFilterClause[] => {
  const metricLabelSet = new Set(getMetricLabels(metrics));
  return [
    ...buildAxisContextFilters(
      rowNode,
      groupbyRows,
      'row',
      metricsLayout,
      metricLabelSet,
      dateFormatters,
      timeGrainSqla,
    ),
    ...buildAxisContextFilters(
      colNode,
      groupbyColumns,
      'col',
      metricsLayout,
      metricLabelSet,
      dateFormatters,
      timeGrainSqla,
    ),
  ];
};
