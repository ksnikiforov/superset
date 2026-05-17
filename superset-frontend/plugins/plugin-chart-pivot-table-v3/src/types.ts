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
  AppSection,
  ContextMenuFilters,
  Currency,
  DataRecordValue,
  JsonObject,
  NumberFormatter,
  QueryFormColumn,
  QueryFormData,
  QueryFormMetric,
  SetDataMaskHook,
  HandlerFunction,
  SupersetTheme,
  TimeFormatter,
  TimeGranularity,
  GenericDataType,
} from '@superset-ui/core';
import { type PivotFactStoreBatch } from './pivot/runtime/factStore';

export type PivotAxis = 'row' | 'col';
export type PivotPathValue = DataRecordValue | undefined;
export type PivotPath = PivotPathValue[];
export type TotalPosition = 'start' | 'end';
export type PivotTheme = 'none' | 'blue' | 'peach' | 'grey' | 'custom';
export type PivotInteractionMode = 'fixed' | 'user_controlled';

export type PivotRuntimeLayout = {
  version: 1;
  rows: string[];
  cols: string[];
  metrics: string[];
  leafSelection: Record<string, boolean>;
  leafOrder?: string[];
  valuePlacement: { axis: PivotAxis; index: number };
};

export interface PivotTableStylesProps {
  height: number;
  width: number;
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

export type MetricFormattingScope =
  | 'values'
  | 'values_totals'
  | 'values_totals_grand_totals';

export type DateFormatter =
  | TimeFormatter
  | NumberFormatter
  | ((value: DataRecordValue) => string);

export const METRIC_FORMATTING_FIELDS = [
  'backgroundColor',
  'textColor',
  'd3Format',
] as const;

export type MetricFormattingField = (typeof METRIC_FORMATTING_FIELDS)[number];

export type PivotDatabarType = 'bar' | 'lollipop' | 'waterfall';

export type MeasureLeafOffsetUnit = 'year' | 'month' | 'week' | 'day';

export type MeasureLeafOffsetDirection = 'past' | 'future';

export type MeasureLeafOffset = {
  n: number;
  unit: MeasureLeafOffsetUnit;
  direction: MeasureLeafOffsetDirection;
};

export type MeasureLeafOperator =
  | 'value'
  | 'ix'
  | 'delta'
  | 'delta_pct'
  | 'offset_value';

export type MeasureLeafId = string;

export type MeasureLeafSpec =
  | {
      kind: 'builtIn';
      id: MeasureLeafId;
      operator: MeasureLeafOperator;
      offset?: MeasureLeafOffset;
      label: string;
    }
  | {
      kind: 'custom';
      id: MeasureLeafId;
      label: string;
      metric: QueryFormMetric;
      offset?: MeasureLeafOffset;
    };

export type MeasureLeavesByMetricKey = Record<string, MeasureLeafSpec[]>;

export type MeasureHierarchy =
  | { kind: 'flatMetrics'; metricKeys: string[] }
  | {
      kind: 'measureStackV1';
      groups: Array<{
        metricKey: string;
        leaves: MeasureLeafSpec[];
      }>;
      leafTierVisibility: 'hidden' | 'visible';
    };

export type PivotMetricDatabar = {
  type?: PivotDatabarType;
  scaleGroup?: string;
  scaleLike?: QueryFormMetric;
  colorMode?: 'static' | 'byMetric';
  colorMetric?: QueryFormMetric;
  positiveColor?: string;
  negativeColor?: string;
};

export type PivotMetricDatabarMap = Record<string, PivotMetricDatabar>;

export const DIMENSION_FORMATTING_FIELDS = [
  'backgroundColor',
  'textColor',
] as const;

export type DimensionFormattingField =
  (typeof DIMENSION_FORMATTING_FIELDS)[number];

export type DimensionFormattingScope = 'all' | 'label';

export type PivotMetricFormatting = Partial<
  Record<MetricFormattingField, PivotMetricFormattingValue>
>;

export type PivotMetricFormattingMap = Record<string, PivotMetricFormatting>;

export type PivotExcelFormula = {
  kind: 'excel';
  formula: string;
};

export type PivotMetricFormattingValue = QueryFormMetric | PivotExcelFormula;

export type PivotDimensionFormattingValue = PivotMetricFormattingValue;

export type PivotDimensionFormatting = Partial<
  Record<DimensionFormattingField, PivotDimensionFormattingValue>
> & { applyTo?: DimensionFormattingScope };

export type PivotDimensionFormattingMap = Record<
  string,
  PivotDimensionFormatting
>;

export type PivotSortOrder = 'asc' | 'desc';
export type PivotSortMode = 'total' | 'axis_value';

export type PivotAxisValueRef = {
  axis: PivotAxis;
  path: PivotPath;
};

export type PivotExpansionState = {
  rowKeys: string[];
  colKeys: string[];
  rows: PivotPath[];
  cols: PivotPath[];
  collapsedRows?: PivotPath[];
  collapsedCols?: PivotPath[];
};

export type PivotDimensionSorting = {
  metric?: QueryFormMetric;
  order?: PivotSortOrder;
  mode?: PivotSortMode;
  axisValueRef?: PivotAxisValueRef;
};

export type PivotDimensionSortingMap = Record<string, PivotDimensionSorting>;

export interface PivotTableCustomizeProps {
  interactionMode?: PivotInteractionMode;
  dimensions?: QueryFormColumn[];
  groupbyRows: QueryFormColumn[];
  groupbyColumns: QueryFormColumn[];
  metrics: QueryFormMetric[];
  metricLabelMap?: Record<string, string>;
  pivotRuntimeLayout?: PivotRuntimeLayout;
  pivotSelectedFilters?: Record<string, DataRecordValue[]>;
  measureLeavesByMetric?: MeasureLeavesByMetricKey;
  metricFormatting?: PivotMetricFormattingMap;
  metricDatabars?: PivotMetricDatabarMap;
  metricFormattingScope?: MetricFormattingScope;
  rowFormatting?: PivotDimensionFormattingMap;
  colFormatting?: PivotDimensionFormattingMap;
  rowSorting?: PivotDimensionSortingMap;
  colSorting?: PivotDimensionSortingMap;
  aggregateFunction?: string;
  expandRowsLevel?: number;
  expandColumnsLevel?: number;
  pivotExpansionState?: PivotExpansionState;
  rowTotals: boolean;
  colTotals: boolean;
  rowSubTotals?: boolean;
  rowSubtotalLevels?: number[];
  colSubtotalLevels?: number[];
  rowOrder: string;
  colOrder: string;
  valueFormat?: string;
  dateFormat?: string;
  currencyFormat?: Currency;
  allowRenderHtml?: boolean;
  metricsLayout?: MetricsLayoutEnum;
  rowTotalPosition?: TotalPosition;
  rowSubtotalPosition?: TotalPosition;
  colTotalPosition?: TotalPosition;
  colSubtotalPosition?: TotalPosition;
  pivotTheme?: PivotTheme;
  pivotThemeColors?: string;
  stickyHeaders?: boolean;
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
    dateFormatters: Record<string, DateFormatter | undefined>;
    colTypeMap?: Record<string, GenericDataType>;
    order_desc: boolean;
    onContextMenu?: (
      clientX: number,
      clientY: number,
      filters?: ContextMenuFilters,
    ) => void;
    timeGrainSqla?: TimeGranularity;
    time_grain_sqla?: TimeGranularity;
    granularity_sqla?: string;
    treeDataSignature?: string;
  };

export interface PivotTableProps {
  width: number;
  height: number;
  data: PivotTreeData;
  factBatches: PivotFactStoreBatch[];
  formData: PivotTableQueryFormData;
  queryFormData?: PivotTableQueryFormData;
  persistExpansionState?: boolean;
  sourceMetrics: QueryFormMetric[];
  sourceMeasureLeavesByMetric: MeasureLeavesByMetricKey;
  emitCrossFilters?: boolean;
  setControlValue?: HandlerFunction;
  setDataMask: SetDataMaskHook;
  ownState?: JsonObject;
  theme?: SupersetTheme;
  appSection?: AppSection;
  selectedFilters?: Record<string, DataRecordValue[]>;
  onContextMenu?: (
    clientX: number,
    clientY: number,
    filters?: ContextMenuFilters,
  ) => void;
}
