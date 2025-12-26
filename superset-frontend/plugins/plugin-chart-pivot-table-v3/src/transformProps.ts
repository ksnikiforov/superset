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
  ChartProps,
  DataRecordValue,
  extractTimegrain,
  GenericDataType,
  getTimeFormatter,
  getTimeFormatterForGranularity,
  getColumnLabel,
  SMART_DATE_ID,
  TimeFormats,
  ensureIsArray,
} from '@superset-ui/core';
import { getColorFormatters } from '@superset-ui/chart-controls';
import {
  MetricsLayoutEnum,
  PivotTableQueryFormData,
  PivotTreeData,
} from './types';
import {
  applyMetricAxis,
  METRICS_PLACEHOLDER,
  buildTreeFromRecords,
  mergeTrees,
  parseDepth,
  stripMetricsPlaceholder,
} from './utils';

const { DATABASE_DATETIME } = TimeFormats;

export default function transformProps(
  chartProps: ChartProps<PivotTableQueryFormData>,
) {
  const {
    width,
    height,
    queriesData,
    formData,
    rawFormData,
    hooks: { setDataMask = () => {}, onContextMenu },
    filterState,
    datasource: { verboseMap = {}, columnFormats = {}, currencyFormats = {} },
    emitCrossFilters,
    theme,
    ownState,
  } = chartProps;
  const groupbyRowsRaw = ensureIsArray(formData.groupbyRows || []);
  const groupbyColumnsRaw = ensureIsArray(formData.groupbyColumns || []);
  const rowPlaceholderIndex = groupbyRowsRaw.indexOf(METRICS_PLACEHOLDER);
  const colPlaceholderIndex = groupbyColumnsRaw.indexOf(METRICS_PLACEHOLDER);
  const groupbyRows = stripMetricsPlaceholder(groupbyRowsRaw);
  const groupbyColumns = stripMetricsPlaceholder(groupbyColumnsRaw);
  const metricsLayout =
    rowPlaceholderIndex >= 0
      ? MetricsLayoutEnum.ROWS
      : colPlaceholderIndex >= 0
      ? MetricsLayoutEnum.COLUMNS
      : formData.metricsLayout || MetricsLayoutEnum.COLUMNS;
  const metricInsertIndex =
    metricsLayout === MetricsLayoutEnum.ROWS
      ? rowPlaceholderIndex >= 0
        ? Math.min(rowPlaceholderIndex, groupbyRows.length)
        : groupbyRows.length
      : colPlaceholderIndex >= 0
      ? Math.min(colPlaceholderIndex, groupbyColumns.length)
      : groupbyColumns.length;
  const metrics = ensureIsArray(formData.metrics || []);
  const granularity = extractTimegrain(rawFormData);

  const combinedData = queriesData.flatMap(({ data }) => data || []);
  const colnames = queriesData[0]?.colnames || [];
  const coltypes = queriesData[0]?.coltypes || [];
  const colTypeMap: Record<string, GenericDataType> = {};
  colnames.forEach((name: string, idx: number) => {
    colTypeMap[name] = coltypes[idx];
  });

  const dateFormatters = colnames
    .filter(
      (colname: string, index: number) =>
        coltypes[index] === GenericDataType.Temporal,
    )
    .reduce(
      (
        acc: Record<string, ((value: DataRecordValue) => string) | undefined>,
        temporalColname: string,
      ) => {
        let formatter: ((value: DataRecordValue) => string) | undefined;
        if (formData.dateFormat === SMART_DATE_ID) {
          if (granularity) {
            const base = getTimeFormatterForGranularity(granularity);
            formatter = (value: DataRecordValue) =>
              base(value as number | Date | null | undefined);
          } else if (
            combinedData.every(
              row =>
                row[temporalColname] === null ||
                row[temporalColname] === undefined ||
                typeof row[temporalColname] === 'number',
            )
          ) {
            const base = getTimeFormatter(DATABASE_DATETIME);
            formatter = (value: DataRecordValue) =>
              base(value as number | Date | null | undefined);
          }
        } else if (formData.dateFormat) {
          const base = getTimeFormatter(formData.dateFormat);
          formatter = (value: DataRecordValue) =>
            base(value as number | Date | null | undefined);
        }
        if (formatter) {
          acc[temporalColname] = formatter;
        }
        return acc;
      },
      {},
    );

  const metricColorFormatters = getColorFormatters(
    // @ts-ignore legacy conditional formatting name
    formData.conditionalFormatting || formData.conditional_formatting,
    combinedData,
    theme,
  );

  const nextTreeRaw = queriesData.reduce<PivotTreeData>((acc, query) => {
    const queryName = (query as any)?.query_name || (query as any)?.queryName;
    let { rowDepth, colDepth } = parseDepth(queryName);

    // Fallback: if query_name is missing or unparsable, infer how many groupby
    // levels were included in this query by inspecting returned column names.
    if (rowDepth === 0 && colDepth === 0) {
      const colSet = new Set((query.colnames || []).map((name: any) => String(name)));
      rowDepth = groupbyRows.filter(col =>
        colSet.has(String(getColumnLabel(col))),
      ).length;
      colDepth = groupbyColumns.filter(col =>
        colSet.has(String(getColumnLabel(col))),
      ).length;
      // If inference still yields zero but data exists, assume full depth so tree populates.
      if ((rowDepth === 0 && colDepth === 0) && (query.data || []).length > 0) {
        rowDepth = groupbyRows.length;
        colDepth = groupbyColumns.length;
      }
    }

    // Clamp to the configured groupby lengths to avoid over-reading.
    rowDepth = Math.min(rowDepth || 0, groupbyRows.length);
    colDepth = Math.min(colDepth || 0, groupbyColumns.length);

    const branch = buildTreeFromRecords(
      query.data || [],
      metrics,
      groupbyRows,
      groupbyColumns,
      rowDepth,
      colDepth,
    );
    return mergeTrees(acc, branch);
  }, ownState?.treeData || ({} as PivotTreeData));
  const nextTree = applyMetricAxis(
    nextTreeRaw,
    metrics,
    metricsLayout,
    groupbyRows,
    groupbyColumns,
    metricInsertIndex,
  );

  const { selectedFilters } = filterState;

  return {
    width,
    height,
    margin: (formData as any).margin ?? 0,
    data: nextTree,
    formData: { ...formData, metricsLayout },
    metrics,
    groupbyRows,
    groupbyColumns,
    aggregateFunction: formData.aggregateFunction,
    startCollapsed: formData.startCollapsed ?? true,
    initialDepth: formData.initialDepth ?? 1,
    maxDepthPerFetch: formData.maxDepthPerFetch,
    rowTotals: formData.rowTotals,
    colTotals: formData.colTotals,
    rowSubTotals: formData.rowSubTotals,
    colSubTotals: formData.colSubTotals,
    rowOrder: formData.rowOrder,
    colOrder: formData.colOrder,
    valueFormat: formData.valueFormat,
    dateFormat: formData.dateFormat,
    currencyFormat: formData.currencyFormat,
    allowRenderHtml: formData.allowRenderHtml,
    metricsLayout,
    transposePivot: formData.transposePivot,
    combineMetric: formData.combineMetric,
    emitCrossFilters,
    setDataMask,
    selectedFilters,
    verboseMap,
    columnFormats,
    currencyFormats,
    metricColorFormatters,
    dateFormatters,
    onContextMenu,
    timeGrainSqla: formData.time_grain_sqla,
    treeData: nextTree,
    colTypeMap,
  };
}
