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
  QueryFormColumn,
  QueryFormMetric,
  QueryObjectFilterClause,
  UnaryQueryObjectFilterClause,
  getColumnLabel,
} from '@superset-ui/core';
import { DateFormatter, MetricsLayoutEnum, PivotTreeNode } from '../types';
import { decodeMetricKey, getMetricKeys, isSubtotalToken } from '../utils';

const stripMetricPath = (
  path: PivotTreeNode['path'],
  axis: 'row' | 'col',
  metricsLayout: MetricsLayoutEnum,
  metricLabels: Set<string>,
) => {
  const shouldStripMetric =
    (axis === 'row' && metricsLayout === MetricsLayoutEnum.ROWS) ||
    (axis === 'col' && metricsLayout === MetricsLayoutEnum.COLUMNS);
  return path.filter(val => {
    if (isSubtotalToken(val)) {
      return false;
    }
    const decoded = decodeMetricKey(val);
    return !(shouldStripMetric && decoded && metricLabels.has(decoded));
  });
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
  const metricLabelSet = new Set(getMetricKeys(metrics));
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
  const toFilter = (
    col: QueryFormColumn,
    val: PivotTreeNode['path'][number],
  ): QueryObjectFilterClause => {
    if (val === null || val === undefined) {
      const clause: UnaryQueryObjectFilterClause = { col, op: 'IS NULL' };
      return clause;
    }
    const clause: BinaryQueryObjectFilterClause = { col, op: '==', val };
    return clause;
  };
  return [
    ...normalizedRowPath.map((val, i) => toFilter(groupbyRows[i], val)),
    ...normalizedColPath.map((val, i) => toFilter(groupbyColumns[i], val)),
  ];
};

type ContextFiltersParams = {
  rowNode: PivotTreeNode;
  colNode: PivotTreeNode;
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricsLayout: MetricsLayoutEnum;
  dateFormatters: Record<string, DateFormatter | undefined>;
  timeGrainSqla?: string;
};

const buildAxisContextFilters = (
  node: PivotTreeNode,
  columns: QueryFormColumn[],
  axis: 'row' | 'col',
  metricsLayout: MetricsLayoutEnum,
  metricLabels: Set<string>,
  dateFormatters: Record<string, DateFormatter | undefined>,
  timeGrainSqla?: string,
) =>
  stripMetricPath(node.path, axis, metricsLayout, metricLabels).map(
    (val, idx) => {
      const col = columns[idx];
      const colLabel = getColumnLabel(col);
      const formatter = dateFormatters[colLabel];
      const normalizedVal = val === undefined ? null : val;
      return {
        col,
        op: '==',
        val: normalizedVal,
        formattedVal:
          typeof formatter === 'function'
            ? (formatter as unknown as (value: DataRecordValue) => string)(
                normalizedVal,
              )
            : String(normalizedVal),
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
  const metricLabelSet = new Set(getMetricKeys(metrics));
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
