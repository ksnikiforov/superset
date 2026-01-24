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
import { type KeyboardEvent, type MouseEvent, useCallback } from 'react';
import {
  type ContextMenuFilters,
  type DataRecordValue,
  type JsonObject,
  type QueryObjectFilterClause,
  getColumnLabel,
} from '@superset-ui/core';
import {
  type PivotTableProps,
  type PivotTreeData,
  MetricsLayoutEnum,
  type PivotTreeNode,
} from '../../types';
import { buildCellFilters, buildContextMenuFilters } from '../filters';

export type PivotInteractionsResult = {
  handleCellClick: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => void;
  handleCellKeyDown: (
    event: KeyboardEvent<HTMLTableCellElement>,
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
  ) => void;
  handleCellContextMenu: (
    event: MouseEvent<HTMLTableCellElement>,
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
  ) => void;
};

const buildSelectedFilters = (
  filters: QueryObjectFilterClause[],
): Record<string, DataRecordValue[]> => {
  const selected: Record<string, DataRecordValue[]> = {};
  filters.forEach(filter => {
    const key = getColumnLabel(filter.col);
    const value: DataRecordValue = 'val' in filter ? filter.val : null;
    selected[key] = [value];
  });
  return selected;
};

const buildFilterStateValues = (filters: QueryObjectFilterClause[]) =>
  filters.map(filter => ('val' in filter ? filter.val : null));

export const usePivotInteractions = ({
  emitCrossFilters,
  setDataMask,
  mergeOwnState,
  treeRef,
  treeDataSignature,
  groupbyRows,
  groupbyColumns,
  metrics,
  resolvedMetricsLayout,
  onContextMenu,
  ownState,
  dateFormatters,
  timeGrainSqla,
}: {
  emitCrossFilters?: PivotTableProps['emitCrossFilters'];
  setDataMask: PivotTableProps['setDataMask'];
  mergeOwnState: (partial: JsonObject) => JsonObject;
  treeRef: { current: PivotTreeData };
  treeDataSignature: string;
  groupbyRows: PivotTableProps['groupbyRows'];
  groupbyColumns: PivotTableProps['groupbyColumns'];
  metrics: PivotTableProps['metrics'];
  resolvedMetricsLayout: MetricsLayoutEnum;
  onContextMenu?: PivotTableProps['onContextMenu'];
  ownState?: PivotTableProps['ownState'];
  dateFormatters: PivotTableProps['dateFormatters'];
  timeGrainSqla?: PivotTableProps['timeGrainSqla'];
}): PivotInteractionsResult => {
  const handleCellClick = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      if (!emitCrossFilters) {
        return;
      }
      const filters = buildCellFilters({
        rowNode,
        colNode,
        groupbyRows,
        groupbyColumns,
        metrics,
        metricsLayout: resolvedMetricsLayout,
      });
      setDataMask({
        extraFormData: {
          filters,
        },
        filterState: {
          value: buildFilterStateValues(filters),
          selectedFilters: buildSelectedFilters(filters),
        },
        ownState: {
          ...mergeOwnState({
            treeData: treeRef.current,
            treeDataSignature,
          }),
        },
      });
    },
    [
      emitCrossFilters,
      groupbyColumns,
      groupbyRows,
      mergeOwnState,
      metrics,
      resolvedMetricsLayout,
      setDataMask,
      treeDataSignature,
      treeRef,
    ],
  );

  const handleCellKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLTableCellElement>,
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      handleCellClick(rowNode, colNode);
    },
    [handleCellClick],
  );

  const handleCellContextMenu = useCallback(
    (
      event: MouseEvent<HTMLTableCellElement>,
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ) => {
      if (!onContextMenu) {
        return;
      }
      event.preventDefault();
      const contextFilters = buildContextMenuFilters({
        rowNode,
        colNode,
        groupbyRows,
        groupbyColumns,
        metrics,
        metricsLayout: resolvedMetricsLayout,
        dateFormatters,
        timeGrainSqla,
      });

      const contextMenuPayload: ContextMenuFilters = {
        drillToDetail: contextFilters,
        crossFilter: emitCrossFilters
          ? {
              dataMask: {
                extraFormData: { filters: contextFilters },
                filterState: {
                  value: contextFilters.map(filter => filter.val),
                  selectedFilters: contextFilters.reduce(
                    (acc, filter) => ({
                      ...acc,
                      [getColumnLabel(filter.col)]: [filter.val],
                    }),
                    {},
                  ),
                },
                ownState: {
                  ...(ownState ?? {}),
                  treeData: treeRef.current,
                  treeDataSignature,
                },
              },
              isCurrentValueSelected: false,
            }
          : undefined,
      };

      onContextMenu(event.clientX, event.clientY, contextMenuPayload);
    },
    [
      dateFormatters,
      emitCrossFilters,
      groupbyColumns,
      groupbyRows,
      metrics,
      onContextMenu,
      ownState,
      resolvedMetricsLayout,
      treeDataSignature,
      treeRef,
      timeGrainSqla,
    ],
  );

  return {
    handleCellClick,
    handleCellKeyDown,
    handleCellContextMenu,
  };
};
