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
  SMART_DATE_ID,
  TimeFormats,
} from '@superset-ui/core';
import { getColorFormatters } from '@superset-ui/chart-controls';
import { PivotTableQueryFormData, PivotTreeData } from './types';
import { buildTreeFromRecords, mergeTrees, parseDepth } from './utils';

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
  const { groupbyRows = [], groupbyColumns = [], metrics = [] } = formData;
  const granularity = extractTimegrain(rawFormData);

  const combinedData = queriesData.flatMap(({ data }) => data || []);
  const colnames = queriesData[0]?.colnames || [];
  const coltypes = queriesData[0]?.coltypes || [];

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
        let formatter;
        if (formData.dateFormat === SMART_DATE_ID) {
          if (granularity) {
            formatter = getTimeFormatterForGranularity(granularity);
          } else if (
            combinedData.every(
              row =>
                row[temporalColname] === null ||
                row[temporalColname] === undefined ||
                typeof row[temporalColname] === 'number',
            )
          ) {
            formatter = getTimeFormatter(DATABASE_DATETIME);
          }
        } else if (formData.dateFormat) {
          formatter = getTimeFormatter(formData.dateFormat);
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

  const nextTree = queriesData.reduce<PivotTreeData>((acc, query) => {
    const { rowDepth, colDepth } = parseDepth(query?.query_name);
    const branch = buildTreeFromRecords(
      query.data || [],
      metrics,
      groupbyRows,
      groupbyColumns,
      rowDepth,
      colDepth,
    );
    return mergeTrees(acc, branch);
  }, ownState?.treeData as PivotTreeData | undefined);

  const { selectedFilters } = filterState;

  return {
    width,
    height,
    margin: (formData as any).margin ?? 0,
    data: nextTree,
    formData,
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
    metricsLayout: formData.metricsLayout,
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
  };
}
