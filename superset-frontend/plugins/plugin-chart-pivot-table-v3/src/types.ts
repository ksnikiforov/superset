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
  ContextMenuFilters,
  Currency,
  DataRecordValue,
  JsonObject,
  NumberFormatter,
  QueryFormColumn,
  QueryFormData,
  QueryFormMetric,
  ChartProps as BaseChartProps,
  SetDataMaskHook,
  TimeFormatter,
  TimeGranularity,
} from '@superset-ui/core';
import { ColorFormatters } from '@superset-ui/chart-controls';

export type PivotAxis = 'row' | 'col';
export type PivotPath = DataRecordValue[];

export interface PivotTableStylesProps {
  height: number;
  width: number | string;
  margin: number;
}

export interface PivotTreeNode {
  axis: PivotAxis;
  key: string;
  path: PivotPath;
  label: string;
  formattedLabel: string;
  level: number;
  isSubtotal?: boolean;
  hasChildren: boolean;
  values?: Record<string, DataRecordValue>;
}

export interface PivotResultCell {
  rowKey: string;
  colKey: string;
  values: Record<string, DataRecordValue>;
  isSubtotal?: boolean;
}

export interface PivotTreeData {
  rows: Record<string, PivotTreeNode>;
  cols: Record<string, PivotTreeNode>;
  cells: Record<string, PivotResultCell>;
}

export enum MetricsLayoutEnum {
  ROWS = 'ROWS',
  COLUMNS = 'COLUMNS',
}

export type DateFormatter =
  | TimeFormatter
  | NumberFormatter
  | ((value: DataRecordValue) => string);

export interface PivotTableCustomizeProps {
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  aggregateFunction: string;
  startCollapsed: boolean;
  initialDepth?: number;
  maxDepthPerFetch?: number;
  rowTotals: boolean;
  colTotals: boolean;
  rowSubTotals: boolean;
  colSubTotals: boolean;
  rowOrder: string;
  colOrder: string;
  valueFormat?: string;
  dateFormat?: string;
  currencyFormat?: Currency;
  allowRenderHtml?: boolean;
  metricsLayout?: MetricsLayoutEnum;
  transposePivot?: boolean;
  combineMetric?: boolean;
}

export type PivotTableQueryFormData = QueryFormData &
  PivotTableStylesProps &
  PivotTableCustomizeProps & {
    setDataMask: SetDataMaskHook;
    emitCrossFilters?: boolean;
    selectedFilters?: Record<string, DataRecordValue[]>;
    verboseMap: JsonObject;
    columnFormats: JsonObject;
    currencyFormats: Record<string, Currency>;
    metricColorFormatters: ColorFormatters;
    dateFormatters: Record<string, DateFormatter | undefined>;
    legacy_order_by: QueryFormMetric[] | QueryFormMetric | null;
    order_desc: boolean;
    onContextMenu?: (
      clientX: number,
      clientY: number,
      filters?: ContextMenuFilters,
    ) => void;
    timeGrainSqla?: TimeGranularity;
    time_grain_sqla?: TimeGranularity;
    granularity_sqla?: string;
    treeData?: PivotTreeData;
  };

export interface PivotTableProps
  extends BaseChartProps<PivotTableQueryFormData>,
    PivotTableStylesProps {
  data: PivotTreeData;
  formData: PivotTableQueryFormData;
  metrics: QueryFormMetric[];
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  aggregateFunction: string;
  startCollapsed: boolean;
  initialDepth?: number;
  maxDepthPerFetch?: number;
  rowTotals: boolean;
  colTotals: boolean;
  rowSubTotals: boolean;
  colSubTotals: boolean;
  rowOrder: string;
  colOrder: string;
  valueFormat?: string;
  dateFormat?: string;
  currencyFormat?: Currency;
  allowRenderHtml?: boolean;
  metricsLayout?: MetricsLayoutEnum;
  transposePivot?: boolean;
  combineMetric?: boolean;
  emitCrossFilters?: boolean;
  setDataMask: SetDataMaskHook;
  selectedFilters?: Record<string, DataRecordValue[]>;
  verboseMap: JsonObject;
  columnFormats: JsonObject;
  currencyFormats: Record<string, Currency>;
  metricColorFormatters: ColorFormatters;
  dateFormatters: Record<string, DateFormatter | undefined>;
  onContextMenu?: (
    clientX: number,
    clientY: number,
    filters?: ContextMenuFilters,
  ) => void;
  timeGrainSqla?: TimeGranularity;
  extraControls?: {
    formData: PivotTableCustomizeProps;
  };
}
